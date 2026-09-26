/**
 * Dashboard: the brief's KPIs and dynamic filters, the "Today" work board,
 * an in-vs-out value chart, stockout warnings and the activity feed.
 *
 * Filters (all optional): type (receipt|delivery|internal|adjustment),
 * status (draft|waiting|ready|done|canceled), warehouse, category.
 *  - KPIs follow warehouse + category (+ status for the operation KPIs)
 *  - the operations table follows all four
 *  - the board follows warehouse + category
 */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Operation = require('../models/Operation');
const StockMove = require('../models/StockMove');
const StockQuant = require('../models/StockQuant');
const insights = require('./insightsService');
const activity = require('./activityService');
const { roundQty } = require('./stockService');
const { toDateInput } = require('../utils/viewHelpers');
const { OPERATION_TYPES, OPERATION_STATUSES } = Operation;

const OPEN = ['draft', 'waiting', 'ready'];
const CHART_DAYS = 14;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const cleanFilters = (q = {}) => ({
  type: OPERATION_TYPES.includes(q.type) ? q.type : '',
  status: OPERATION_STATUSES.includes(q.status) ? q.status : '',
  warehouse: mongoose.isValidObjectId(q.warehouse) ? String(q.warehouse) : '',
  category: mongoose.isValidObjectId(q.category) ? String(q.category) : '',
});

// Operation filter from warehouse + category (+ optional status/type)
const operationScope = async (f, { withStatus = false, withType = false } = {}) => {
  const scope = {};
  if (f.warehouse) scope.warehouse = oid(f.warehouse);
  if (f.category) {
    const ids = await Product.find({ category: oid(f.category) }).distinct('_id');
    scope['lines.product'] = { $in: ids };
  }
  if (withStatus && f.status) scope.status = f.status;
  if (withType && f.type) scope.type = f.type;
  return scope;
};

/**
 * Product stock KPIs (optionally one warehouse / category).
 */
const stockKpis = async (f) => {
  const locationIds = f.warehouse ? await insights.internalLocationIds(f.warehouse) : null;
  const match = { isActive: true };
  if (f.category) match.category = oid(f.category);

  const [row] = await Product.aggregate([
    { $match: match },
    {
      $lookup: {
        from: StockQuant.collection.name,
        let: { pid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$product', '$$pid'] }, ...(locationIds ? { location: { $in: locationIds } } : {}) } },
        ],
        as: 'q',
      },
    },
    { $addFields: { onHand: { $sum: '$q.quantity' } } },
    {
      $group: {
        _id: null,
        products: { $sum: 1 },
        inStock: { $sum: { $cond: [{ $gt: ['$onHand', 0] }, 1, 0] } },
        low: { $sum: { $cond: [{ $and: [{ $gt: ['$onHand', 0] }, { $lte: ['$onHand', '$reorderLevel'] }] }, 1, 0] } },
        out: { $sum: { $cond: [{ $lte: ['$onHand', 0] }, 1, 0] } },
        value: { $sum: { $multiply: ['$onHand', { $ifNull: ['$unitCost', 0] }] } },
      },
    },
  ]);
  return {
    products: row ? row.products : 0,
    inStock: row ? row.inStock : 0,
    low: row ? row.low : 0,
    out: row ? row.out : 0,
    value: row ? roundQty(row.value) : 0,
  };
};

const operationKpis = async (f) => {
  const scope = await operationScope(f);
  const statusFilter = f.status ? [f.status] : OPEN;
  const rows = await Operation.aggregate([
    { $match: { ...scope, status: { $in: statusFilter } } },
    { $group: { _id: '$type', n: { $sum: 1 } } },
  ]);
  const byType = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const late = await Operation.countDocuments({ ...scope, status: { $in: OPEN }, scheduledDate: { $lt: insights.startOfDay() } });
  return {
    statusLabel: f.status || 'pending',
    receipts: byType.receipt || 0,
    deliveries: byType.delivery || 0,
    transfers: byType.internal || 0,
    adjustments: byType.adjustment || 0,
    late,
  };
};

/**
 * Today board: receive -> pick -> pack -> ready to ship, plus late work.
 */
const board = async (f) => {
  const scope = await operationScope(f);
  const today = insights.startOfDay();
  const cols = {
    toReceive: { ...scope, type: 'receipt', status: { $in: ['waiting', 'ready'] } },
    toPick: { ...scope, type: 'delivery', status: 'ready', pickedAt: null },
    toPack: { ...scope, type: 'delivery', status: 'ready', pickedAt: { $ne: null }, packedAt: null },
    readyToShip: { ...scope, type: 'delivery', status: 'ready', packedAt: { $ne: null } },
    late: { ...scope, status: { $in: OPEN }, scheduledDate: { $lt: today } },
  };
  const entries = await Promise.all(
    Object.entries(cols).map(async ([key, filter]) => {
      const [items, count] = await Promise.all([
        Operation.find(filter).sort({ scheduledDate: 1 }).limit(5).select('reference type status partner scheduledDate lines').lean(),
        Operation.countDocuments(filter),
      ]);
      return [key, { items, count }];
    })
  );
  return Object.fromEntries(entries);
};

/**
 * Value of stock coming in vs going out per day (last 14 days).
 * In  = moves into internal locations from outside (receipts, positive counts)
 * Out = moves from internal locations to outside (deliveries, negative counts)
 */
const flowChart = async (f) => {
  const start = insights.addDays(insights.startOfDay(), -(CHART_DAYS - 1));
  const internal = await insights.internalLocationIds();
  const match = { date: { $gte: start } };
  if (f.warehouse) match.warehouse = oid(f.warehouse);

  const rows = await StockMove.aggregate([
    { $match: match },
    { $lookup: { from: Product.collection.name, localField: 'product', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    ...(f.category ? [{ $match: { 'p.category': oid(f.category) } }] : []),
    {
      $project: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: TIMEZONE } },
        value: { $multiply: ['$quantity', { $ifNull: ['$p.unitCost', 0] }] },
        toIn: { $in: ['$toLocation', internal] },
        fromIn: { $in: ['$fromLocation', internal] },
      },
    },
    {
      $group: {
        _id: '$day',
        inValue: { $sum: { $cond: [{ $and: ['$toIn', { $not: ['$fromIn'] }] }, '$value', 0] } },
        outValue: { $sum: { $cond: [{ $and: ['$fromIn', { $not: ['$toIn'] }] }, '$value', 0] } },
      },
    },
  ]);
  const byDay = new Map(rows.map((r) => [r._id, r]));
  const days = [];
  for (let i = 0; i < CHART_DAYS; i += 1) {
    const d = insights.addDays(start, i);
    const key = toDateInput(d);
    const r = byDay.get(key);
    days.push({ day: key, in: r ? roundQty(r.inValue) : 0, out: r ? roundQty(r.outValue) : 0 });
  }
  return days;
};

/**
 * Products that are out, low, or predicted to run out (top 8, most urgent first).
 */
const stockWarnings = async (f) => {
  const match = { isActive: true };
  if (f.category) match.category = oid(f.category);
  if (f.warehouse) {
    // Products stored in, or moving through, this warehouse (the forecast itself uses total stock)
    const locationIds = await insights.internalLocationIds(f.warehouse);
    const [stored, planned] = await Promise.all([
      StockQuant.distinct('product', { location: { $in: locationIds }, quantity: { $gt: 0 } }),
      Operation.distinct('lines.product', { warehouse: oid(f.warehouse), status: { $in: OPEN } }),
    ]);
    match._id = { $in: [...stored, ...planned] };
  }
  const products = await Product.find(match).select('name sku uom reorderLevel reorderQty leadTimeDays unitCost preferredSupplier').lean();
  const forecasts = await insights.forecastsFor(products);
  const rank = { out: 0, critical: 1, soon: 2, low: 3 };
  return products
    .map((p) => ({ product: p, forecast: forecasts.get(p._id.toString()) }))
    .filter((x) => x.forecast.status !== 'ok')
    .sort((a, b) => rank[a.forecast.status] - rank[b.forecast.status] || (a.forecast.stockoutDay ?? 99) - (b.forecast.stockoutDay ?? 99))
    .slice(0, 8);
};

const recentOperations = async (f) => {
  const scope = await operationScope(f, { withStatus: true, withType: true });
  return Operation.find(scope)
    .sort({ updatedAt: -1 })
    .limit(10)
    .populate('sourceLocation destLocation', 'fullName')
    .populate('lines.product', 'name')
    .lean();
};

const getDashboard = async (query) => {
  const filters = cleanFilters(query);
  const [stockStats, opStats, work, chart, warnings, operations, feed] = await Promise.all([
    stockKpis(filters),
    operationKpis(filters),
    board(filters),
    flowChart(filters),
    stockWarnings(filters),
    recentOperations(filters),
    activity.recent(12),
  ]);
  return { filters, stock: stockStats, ops: opStats, board: work, chart, warnings, operations, feed };
};

module.exports = {
  getDashboard,
  cleanFilters,
};
