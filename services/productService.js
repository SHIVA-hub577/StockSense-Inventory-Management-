/**
 * Product catalogue: listing with live stock, product detail (stock per
 * location, forecast, open operations, recent moves) and create/update rules.
 */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Location = require('../models/Location');
const Operation = require('../models/Operation');
const StockMove = require('../models/StockMove');
const StockQuant = require('../models/StockQuant');
const AppError = require('../utils/AppError');
const stock = require('./stockService');
const insights = require('./insightsService');
const { searchRegex, pick } = require('../utils/requestHelpers');

const PRODUCT_FIELDS = ['name', 'sku', 'category', 'uom', 'reorderLevel', 'reorderQty', 'unitCost', 'preferredSupplier', 'leadTimeDays', 'description'];
const NUMBER_FIELDS = {
  reorderLevel: 'Reorder level',
  reorderQty: 'Reorder quantity',
  unitCost: 'Unit cost',
  leadTimeDays: 'Lead time',
};
const OPEN_STATUSES = ['draft', 'waiting', 'ready'];
// Operations counted in the forecast (confirmed, not drafts) - same as Odoo
const FORECAST_STATUSES = ['waiting', 'ready'];

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

// on hand <= 0 -> out, on hand <= reorder level -> low, otherwise ok
const STOCK_STATUS_EXPR = {
  $switch: {
    branches: [
      { case: { $lte: ['$onHand', 0] }, then: 'out' },
      { case: { $lte: ['$onHand', '$reorderLevel'] }, then: 'low' },
    ],
    default: 'ok',
  },
};

const withStockStages = () => [
  { $lookup: { from: StockQuant.collection.name, localField: '_id', foreignField: 'product', as: 'quants' } },
  { $addFields: { onHand: { $round: [{ $sum: '$quants.quantity' }, 3] } } },
  { $addFields: { stockStatus: STOCK_STATUS_EXPR } },
  { $project: { quants: 0 } },
];

const stockStatusOf = (onHand, reorderLevel) => {
  if (onHand <= 0) return 'out';
  if (onHand <= reorderLevel) return 'low';
  return 'ok';
};

/**
 * Confirmed incoming (receipts) and outgoing (deliveries) quantities per product.
 * @returns {Promise<Map<string, {incoming: number, outgoing: number}>>}
 */
const pendingQuantities = async (productIds) => {
  const ids = productIds.map(toObjectId);
  const rows = await Operation.aggregate([
    { $match: { status: { $in: FORECAST_STATUSES }, type: { $in: ['receipt', 'delivery'] }, 'lines.product': { $in: ids } } },
    { $unwind: '$lines' },
    { $match: { 'lines.product': { $in: ids } } },
    { $group: { _id: { product: '$lines.product', type: '$type' }, qty: { $sum: '$lines.quantity' } } },
  ]);

  const map = new Map(ids.map((id) => [id.toString(), { incoming: 0, outgoing: 0 }]));
  for (const row of rows) {
    const entry = map.get(row._id.product.toString());
    if (row._id.type === 'receipt') entry.incoming = stock.roundQty(row.qty);
    else entry.outgoing = stock.roundQty(row.qty);
  }
  return map;
};

/**
 * Products with on-hand stock, stock status and forecast.
 * @param {Object} opts search, category, stockStatus ('ok'|'low'|'out'|'attention'), archived, skip, limit
 * @returns {Promise<{rows, total, counts: {all, ok, low, out, attention}}>}
 */
const listProducts = async ({ search, category, stockStatus, archived = false, skip = 0, limit = 20 } = {}) => {
  const match = { isActive: !archived };
  const regex = searchRegex(search);
  if (regex) {
    match.$or = [{ name: regex }, { sku: regex }];
  }
  if (category && mongoose.isValidObjectId(category)) {
    match.category = toObjectId(category);
  }

  let statusMatch = {};
  if (stockStatus === 'attention') {
    statusMatch = { stockStatus: { $in: ['low', 'out'] } };
  } else if (stockStatus === 'instock') {
    statusMatch = { stockStatus: { $in: ['ok', 'low'] } };
  } else if (['ok', 'low', 'out'].includes(stockStatus)) {
    statusMatch = { stockStatus };
  }

  const [result] = await Product.aggregate([
    { $match: match },
    ...withStockStages(),
    {
      $facet: {
        counts: [{ $group: { _id: '$stockStatus', n: { $sum: 1 } } }],
        total: [{ $match: statusMatch }, { $count: 'n' }],
        rows: [
          { $match: statusMatch },
          { $sort: { name: 1, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          { $lookup: { from: Category.collection.name, localField: 'category', foreignField: '_id', as: 'category' } },
          { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
        ],
      },
    },
  ]);

  const counts = { ok: 0, low: 0, out: 0 };
  result.counts.forEach((c) => {
    counts[c._id] = c.n;
  });
  counts.all = counts.ok + counts.low + counts.out;
  counts.attention = counts.low + counts.out;

  // Forecast for the rows on this page
  const [pending, outlook] = await Promise.all([
    pendingQuantities(result.rows.map((r) => r._id)),
    insights.forecastsFor(result.rows),
  ]);
  const rows = result.rows.map((row) => {
    const { incoming, outgoing } = pending.get(row._id.toString());
    return {
      ...row,
      incoming,
      outgoing,
      forecast: stock.roundQty(row.onHand + incoming - outgoing),
      outlook: outlook.get(row._id.toString()),
    };
  });

  return { rows, total: result.total[0] ? result.total[0].n : 0, counts };
};

/**
 * Number of active products that are low or out of stock (sidebar badge).
 */
const countStockAlerts = async () => {
  const [row] = await Product.aggregate([
    { $match: { isActive: true } },
    ...withStockStages(),
    { $match: { stockStatus: { $in: ['low', 'out'] } } },
    { $count: 'n' },
  ]);
  return row ? row.n : 0;
};

const findProductOr404 = async (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Product not found', 404);
  }
  const product = await Product.findById(id);
  if (!product) {
    throw new AppError('Product not found', 404);
  }
  return product;
};

/**
 * Everything the product page shows.
 */
const getProductDetail = async (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Product not found', 404);
  }
  const product = await Product.findById(id).populate('category', 'name').lean();
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  const [locations, pending, moves, openOperations] = await Promise.all([
    stock.getStockByLocation(id),
    pendingQuantities([id]),
    StockMove.find({ product: id })
      .sort({ date: -1, _id: -1 })
      .limit(15)
      .populate('fromLocation toLocation', 'fullName type')
      .populate('user', 'name')
      .lean(),
    Operation.find({ 'lines.product': id, status: { $in: OPEN_STATUSES } })
      .sort({ scheduledDate: 1 })
      .limit(20)
      .populate('sourceLocation destLocation', 'fullName')
      .lean(),
  ]);

  const onHand = stock.roundQty(locations.reduce((sum, q) => sum + q.quantity, 0));
  const { incoming, outgoing } = pending.get(String(id));

  const outlook = (await insights.forecastsFor([product])).get(String(product._id));

  return {
    product,
    onHand,
    incoming,
    outgoing,
    outlook,
    forecast: stock.roundQty(onHand + incoming - outgoing),
    stockStatus: stockStatusOf(onHand, product.reorderLevel),
    locations,
    moves,
    openOperations: openOperations.map((op) => ({
      ...op,
      productQty: stock.roundQty(
        op.lines.filter((l) => l.product.toString() === String(id)).reduce((sum, l) => sum + l.quantity, 0)
      ),
    })),
  };
};

/**
 * Whitelist + normalise form input. Blank numbers become 0, blank category none.
 */
const cleanProductInput = async (data) => {
  const fields = pick(data, PRODUCT_FIELDS);

  for (const key of ['name', 'sku', 'description', 'uom', 'preferredSupplier']) {
    if (typeof fields[key] === 'string') {
      fields[key] = fields[key].trim();
    }
  }
  for (const [key, label] of Object.entries(NUMBER_FIELDS)) {
    if (fields[key] === '' || fields[key] === null) {
      fields[key] = key === 'leadTimeDays' ? 7 : 0;
    }
    if (fields[key] !== undefined) {
      const n = Number(fields[key]);
      if (!Number.isFinite(n) || n < 0) {
        throw new AppError(`${label} must be a number of 0 or more`);
      }
      fields[key] = key === 'leadTimeDays' ? Math.round(n) : stock.roundQty(n);
    }
  }
  if (fields.category === '' || fields.category === null) {
    fields.category = null;
  } else if (fields.category !== undefined) {
    if (!mongoose.isValidObjectId(fields.category) || !(await Category.exists({ _id: fields.category }))) {
      throw new AppError('Category not found', 404);
    }
  }
  return fields;
};

/**
 * Create a product, optionally with initial stock at a location
 * (booked as a validated inventory adjustment so it appears in the ledger).
 */
const createProduct = async (data, user = null) => {
  const fields = await cleanProductInput(data);

  const initialQty = data.initialQty === undefined || data.initialQty === '' ? 0 : Number(data.initialQty);
  if (!Number.isFinite(initialQty) || initialQty < 0) {
    throw new AppError('Initial stock must be a number of 0 or more');
  }

  let initialLocation = null;
  if (initialQty > 0) {
    if (!mongoose.isValidObjectId(data.initialLocation)) {
      throw new AppError('Choose where the initial stock is stored');
    }
    initialLocation = await Location.findOne({ _id: data.initialLocation, type: 'internal', isActive: true });
    if (!initialLocation) {
      throw new AppError('Initial stock location not found', 404);
    }
  }

  const product = await Product.create(fields);

  if (initialLocation) {
    let adjustment = null;
    try {
      adjustment = await stock.createOperation(
        {
          type: 'adjustment',
          location: initialLocation._id,
          lines: [{ product: product._id, quantity: initialQty }],
          notes: 'Initial stock',
        },
        user
      );
      await stock.validateOperation(adjustment._id, user);
    } catch (err) {
      // All or nothing: without its stock the product would be half-created and
      // a retry would fail on the duplicate SKU. Validation is transactional, so
      // no stock or ledger rows exist for it at this point.
      if (adjustment) {
        await Operation.deleteOne({ _id: adjustment._id, status: { $ne: 'done' } }).catch(() => {});
      }
      await Product.deleteOne({ _id: product._id }).catch(() => {});
      throw err;
    }
  }

  return product;
};

const updateProduct = async (id, data) => {
  const product = await findProductOr404(id);
  const fields = await cleanProductInput(data);

  if (fields.uom && fields.uom !== product.uom && (await StockMove.exists({ product: product._id }))) {
    throw new AppError('The unit of measure cannot change after stock has moved for this product', 409);
  }

  Object.assign(product, fields);
  await product.save();
  return product;
};

/**
 * Archive (hide) or restore a product. Archiving requires no stock on hand and
 * no open operations, so nothing gets stuck.
 */
const setProductActive = async (id, isActive) => {
  const product = await findProductOr404(id);

  if (!isActive) {
    const openCount = await Operation.countDocuments({ 'lines.product': product._id, status: { $in: OPEN_STATUSES } });
    if (openCount > 0) {
      throw new AppError(`Finish or cancel the ${openCount} open operation(s) using ${product.name} first`, 409);
    }
    const onHand = (await stock.getOnHandTotals({ productIds: [product._id] })).get(product._id.toString()) || 0;
    if (onHand > 0) {
      throw new AppError(`${product.name} still has ${onHand} ${product.uom} in stock. Deliver or adjust it to 0 first`, 409);
    }
  }

  product.isActive = Boolean(isActive);
  await product.save();
  return product;
};

module.exports = {
  listProducts,
  countStockAlerts,
  getProductDetail,
  createProduct,
  updateProduct,
  setProductActive,
  pendingQuantities,
  stockStatusOf,
};
