/**
 * Stock insights, all derived from the ledger with plain, explainable math:
 *
 *  - Time Machine: exact stock per product / location on any past date
 *  - Timeline: a product's daily on-hand history + projected future
 *  - Forecast: average daily usage, days of cover, predicted stockout date,
 *    "order by" date (stockout - supplier lead time), suggested quantity
 *  - Replenishment plan: products heading for trouble, grouped by supplier,
 *    turned into draft receipts in one click
 *
 * Forecast model (per product, per future day d):
 *   projected(d) = onHand + confirmedReceipts(<= d) - max(confirmedDeliveries(<= d), avgDailyUsage * d)
 * i.e. we expect to ship at least what is already booked, and at least the
 * usual run-rate, whichever is more. Overdue operations count as "today".
 */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Location = require('../models/Location');
const Operation = require('../models/Operation');
const StockMove = require('../models/StockMove');
const StockQuant = require('../models/StockQuant');
const AppError = require('../utils/AppError');
const stock = require('./stockService');
const { parseDateInput, searchRegex } = require('../utils/requestHelpers');

const USAGE_WINDOW_DAYS = 30; // average usage is measured over this many days
const FORECAST_DAYS = 30; // how far ahead we project
const COVER_DAYS = 14; // suggested orders aim to cover lead time + this many days
const FORECAST_STATUSES = ['waiting', 'ready']; // confirmed operations only (like Odoo)

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const round = stock.roundQty;

const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const daysBetween = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / 86400000);

const internalLocationIds = async (warehouseId = null) => {
  const filter = { type: 'internal' };
  if (mongoose.isValidObjectId(warehouseId)) filter.warehouse = oid(warehouseId);
  return Location.find(filter).distinct('_id');
};

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

// productId -> total on hand (all internal locations)
const onHandMap = async (productIds = null) => {
  const match = productIds ? { product: { $in: productIds.map(oid) } } : {};
  const rows = await StockQuant.aggregate([{ $match: match }, { $group: { _id: '$product', q: { $sum: '$quantity' } } }]);
  return new Map(rows.map((r) => [r._id.toString(), round(r.q)]));
};

// productId -> average units delivered to customers per day (last 30 days)
const usageMap = async (productIds = null, days = USAGE_WINDOW_DAYS) => {
  // `days` calendar days including today
  const match = { operationType: 'delivery', date: { $gte: addDays(startOfDay(), -(days - 1)) } };
  if (productIds) match.product = { $in: productIds.map(oid) };
  const rows = await StockMove.aggregate([{ $match: match }, { $group: { _id: '$product', q: { $sum: '$quantity' } } }]);
  return new Map(rows.map((r) => [r._id.toString(), round(r.q / days)]));
};

// productId -> [{ date, qty (+in / -out), reference, type, operation }] for confirmed receipts & deliveries
const scheduledMap = async (productIds = null) => {
  const match = { status: { $in: FORECAST_STATUSES }, type: { $in: ['receipt', 'delivery'] } };
  if (productIds) match['lines.product'] = { $in: productIds.map(oid) };
  const rows = await Operation.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    ...(productIds ? [{ $match: { 'lines.product': { $in: productIds.map(oid) } } }] : []),
    {
      $project: {
        product: '$lines.product',
        qty: { $cond: [{ $eq: ['$type', 'receipt'] }, '$lines.quantity', { $multiply: ['$lines.quantity', -1] }] },
        date: '$scheduledDate',
        reference: 1,
        type: 1,
      },
    },
    { $sort: { date: 1 } },
  ]);
  const map = new Map();
  for (const r of rows) {
    const key = r.product.toString();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ date: r.date, qty: r.qty, reference: r.reference, type: r.type, operation: r._id });
  }
  return map;
};

/**
 * Forecast for one product (pure function - easy to test and explain).
 * @param {Object} product { reorderLevel, reorderQty, leadTimeDays }
 * @param {number} onHand
 * @param {number} avgDaily average daily usage
 * @param {Array} events scheduled [{ date, qty }]
 */
const forecastProduct = (product, onHand, avgDaily, events = [], horizon = FORECAST_DAYS, today = startOfDay()) => {
  const bookedIn = new Array(horizon + 1).fill(0);
  const bookedOut = new Array(horizon + 1).fill(0);
  for (const e of events) {
    const idx = Math.max(0, daysBetween(today, e.date)); // overdue -> today
    if (idx > horizon) continue;
    if (e.qty > 0) bookedIn[idx] += e.qty;
    else bookedOut[idx] += -e.qty;
  }

  const projected = [];
  let cumIn = 0;
  let cumOut = 0;
  for (let d = 0; d <= horizon; d += 1) {
    cumIn += bookedIn[d];
    cumOut += bookedOut[d];
    projected.push(round(onHand + cumIn - Math.max(cumOut, avgDaily * d)));
  }

  let stockoutDay = onHand <= 0 ? 0 : projected.findIndex((q) => q <= 0);
  if (stockoutDay < 0) stockoutDay = null;

  const leadTime = Number.isFinite(product.leadTimeDays) ? product.leadTimeDays : 7;
  const reorderLevel = product.reorderLevel || 0;
  const stockoutDate = stockoutDay === null ? null : addDays(today, stockoutDay);
  const orderByDate = stockoutDate ? addDays(stockoutDate, -leadTime) : null;

  let status = 'ok';
  if (onHand <= 0) status = 'out';
  else if (stockoutDay !== null && stockoutDay <= leadTime) status = 'critical';
  else if (stockoutDay !== null) status = 'soon';
  else if (onHand <= reorderLevel) status = 'low';

  // Aim to hold reorder level + usage over (lead time + cover days) once the order arrives
  // (stock already on its way counts, so we never re-order what is incoming)
  const atArrival = projected[Math.min(leadTime, horizon)];
  const target = reorderLevel + avgDaily * (leadTime + COVER_DAYS);
  let need = target - atArrival;
  if (need <= 0 && (status === 'out' || status === 'low') && atArrival <= reorderLevel) {
    need = Math.max(reorderLevel - atArrival, 1);
  }
  const suggestedQty = need > 0 ? Math.ceil(Math.max(need, product.reorderQty || 0)) : 0;

  return {
    onHand: round(onHand),
    avgDaily: round(avgDaily),
    // Days until stock actually runs out (booked orders included), else on hand ÷ usage
    daysOfCover: stockoutDay !== null ? stockoutDay : avgDaily > 0 ? Math.floor(onHand / avgDaily) : null,
    stockoutDay,
    stockoutDate,
    orderByDate,
    leadTime,
    status,
    suggestedQty,
    incoming: round(bookedIn.reduce((a, b) => a + b, 0)),
    outgoing: round(bookedOut.reduce((a, b) => a + b, 0)),
    projected,
  };
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Forecast metrics for several products at once (dashboard, lists).
 * @returns {Promise<Map<string, Object>>}
 */
const forecastsFor = async (products) => {
  const ids = products.map((p) => p._id);
  const [onHand, usage, scheduled] = await Promise.all([onHandMap(ids), usageMap(ids), scheduledMap(ids)]);
  const map = new Map();
  for (const p of products) {
    const key = p._id.toString();
    map.set(key, forecastProduct(p, onHand.get(key) || 0, usage.get(key) || 0, scheduled.get(key) || []));
  }
  return map;
};

/**
 * Daily on-hand history (from the ledger) + projected future for one product.
 */
const productTimeline = async (productId, { pastDays = 60, futureDays = FORECAST_DAYS } = {}) => {
  if (!mongoose.isValidObjectId(productId)) throw new AppError('Product not found', 404);
  const product = await Product.findById(productId).lean();
  if (!product) throw new AppError('Product not found', 404);

  const today = startOfDay();
  const start = addDays(today, -pastDays);
  const internal = new Set((await internalLocationIds()).map(String));

  const [onHandById, usage, scheduled, moves] = await Promise.all([
    onHandMap([productId]),
    usageMap([productId]),
    scheduledMap([productId]),
    StockMove.find({ product: productId, date: { $gte: start } }).select('date quantity fromLocation toLocation').lean(),
  ]);
  const onHand = onHandById.get(String(productId)) || 0;

  // Net change per day, then walk backwards from today's on-hand
  const netByDay = new Array(pastDays + 1).fill(0);
  for (const m of moves) {
    const idx = daysBetween(start, m.date);
    if (idx < 0 || idx > pastDays) continue;
    let signed = 0;
    if (internal.has(String(m.toLocation))) signed += m.quantity;
    if (internal.has(String(m.fromLocation))) signed -= m.quantity;
    netByDay[idx] += signed;
  }
  const history = new Array(pastDays + 1);
  history[pastDays] = onHand; // end of today
  for (let i = pastDays - 1; i >= 0; i -= 1) {
    history[i] = round(history[i + 1] - netByDay[i + 1]);
  }

  const events = scheduled.get(String(productId)) || [];
  const forecast = forecastProduct(product, onHand, usage.get(String(productId)) || 0, events, futureDays, today);

  const labels = [];
  for (let i = -pastDays; i <= futureDays; i += 1) labels.push(addDays(today, i));

  return {
    product,
    labels,
    todayIndex: pastDays,
    actual: [...history, ...new Array(futureDays).fill(null)],
    projected: [...new Array(pastDays).fill(null), ...forecast.projected],
    forecast,
    events,
  };
};

/**
 * Exact stock on a past date, rebuilt from the ledger.
 * @param {Object} opts date (YYYY-MM-DD), warehouse, category, search
 */
const stockAsOf = async ({ date, warehouse, category, search } = {}) => {
  const asOf = startOfDay(parseDateInput(date) || new Date());
  const end = addDays(asOf, 1);
  const locationIds = await internalLocationIds(warehouse);
  const locations = await Location.find({ _id: { $in: locationIds } }).select('fullName').lean();
  const locationName = new Map(locations.map((l) => [l._id.toString(), l.fullName]));

  // (archived products are included: they may have held stock on that date)
  const productFilter = {};
  if (mongoose.isValidObjectId(category)) productFilter.category = oid(category);
  const regex = searchRegex(search);
  if (regex) productFilter.$or = [{ name: regex }, { sku: regex }];
  const products = await Product.find(productFilter).populate('category', 'name').sort({ name: 1 }).lean();
  const productIds = products.map((p) => p._id);

  const grouped = await StockMove.aggregate([
    { $match: { date: { $lt: end }, product: { $in: productIds } } },
    {
      $project: {
        product: 1,
        entries: {
          $concatArrays: [
            { $cond: [{ $in: ['$toLocation', locationIds] }, [{ loc: '$toLocation', q: '$quantity' }], []] },
            { $cond: [{ $in: ['$fromLocation', locationIds] }, [{ loc: '$fromLocation', q: { $multiply: ['$quantity', -1] } }], []] },
          ],
        },
      },
    },
    { $unwind: '$entries' },
    { $group: { _id: { product: '$product', loc: '$entries.loc' }, qty: { $sum: '$entries.q' } } },
    { $project: { qty: { $round: ['$qty', 3] } } },
    { $match: { qty: { $ne: 0 } } },
  ]);

  const [currentRows, firstMove] = await Promise.all([
    StockQuant.aggregate([
      { $match: { product: { $in: productIds }, location: { $in: locationIds } } },
      { $group: { _id: '$product', q: { $sum: '$quantity' } } },
    ]),
    StockMove.findOne().sort({ date: 1 }).select('date').lean(),
  ]);
  const current = new Map(currentRows.map((r) => [r._id.toString(), round(r.q)]));

  const byProduct = new Map();
  for (const g of grouped) {
    const key = g._id.product.toString();
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push({ location: locationName.get(g._id.loc.toString()) || '?', qty: g.qty });
  }

  const rows = products
    .map((p) => {
      const locs = (byProduct.get(p._id.toString()) || []).sort((a, b) => b.qty - a.qty);
      const total = round(locs.reduce((sum, l) => sum + l.qty, 0));
      const now = current.get(p._id.toString()) || 0;
      return { product: p, total, locations: locs, current: now, delta: round(now - total), value: round(total * (p.unitCost || 0)) };
    })
    .filter((r) => r.total !== 0 || r.current !== 0);

  return {
    asOf,
    rows,
    totalValue: round(rows.reduce((sum, r) => sum + r.value, 0)),
    currentValue: round(rows.reduce((sum, r) => sum + r.current * (r.product.unitCost || 0), 0)),
    productsInStock: rows.filter((r) => r.total > 0).length,
    firstDate: firstMove ? startOfDay(firstMove.date) : asOf,
  };
};

/**
 * Number of stock moves per day from `from` to today (days without moves = 0),
 * in the server's time zone. Feeds the Time Machine scrubber histogram.
 */
const dailyActivity = async (from) => {
  const start = startOfDay(from);
  const today = startOfDay();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const rows = await StockMove.aggregate([
    { $match: { date: { $gte: start } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone } }, moves: { $sum: 1 } } },
  ]);
  const counts = new Map(rows.map((r) => [r._id, r.moves]));
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = [];
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    days.push({ day: key(d), moves: counts.get(key(d)) || 0 });
  }
  return days;
};

/**
 * Where a replenishment for a product should arrive: the location that holds
 * most of it, else the first "Stock" location, else any internal location.
 */
const defaultDestinations = async (productIds) => {
  const [quants, fallback] = await Promise.all([
    StockQuant.find({ product: { $in: productIds }, quantity: { $gt: 0 } }).sort({ quantity: -1 }).lean(),
    Location.findOne({ type: 'internal', isActive: true, name: 'Stock' }).sort({ fullName: 1 }).lean()
      .then((l) => l || Location.findOne({ type: 'internal', isActive: true }).sort({ fullName: 1 }).lean()),
  ]);
  const map = new Map();
  for (const q of quants) {
    const key = q.product.toString();
    if (!map.has(key)) map.set(key, q.location.toString());
  }
  return { map, fallback: fallback ? fallback._id.toString() : null };
};

/**
 * Products that need ordering, grouped by preferred supplier.
 */
const replenishmentPlan = async () => {
  const products = await Product.find({ isActive: true }).populate('category', 'name').lean();
  const forecasts = await forecastsFor(products);
  const { map: destinations, fallback } = await defaultDestinations(products.map((p) => p._id));
  const statusRank = { out: 0, critical: 1, soon: 2, low: 3 };

  const items = products
    .map((p) => ({ product: p, forecast: forecasts.get(p._id.toString()) }))
    .filter(({ forecast }) => forecast.status !== 'ok' && forecast.suggestedQty > 0)
    .map(({ product, forecast }) => ({
      product,
      forecast,
      suggestedQty: forecast.suggestedQty,
      value: round(forecast.suggestedQty * (product.unitCost || 0)),
      destination: destinations.get(product._id.toString()) || fallback,
    }))
    .sort((a, b) => statusRank[a.forecast.status] - statusRank[b.forecast.status] || (a.forecast.stockoutDay ?? 99) - (b.forecast.stockoutDay ?? 99));

  const groups = new Map();
  for (const item of items) {
    const supplier = item.product.preferredSupplier || '';
    if (!groups.has(supplier)) groups.set(supplier, { supplier, items: [], value: 0 });
    const g = groups.get(supplier);
    g.items.push(item);
    g.value = round(g.value + item.value);
  }
  // Group destination: the most common default among its items
  for (const g of groups.values()) {
    const counts = {};
    g.items.forEach((i) => {
      counts[i.destination] = (counts[i.destination] || 0) + 1;
    });
    g.destination = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  return [...groups.values()].sort((a, b) => (a.supplier === '') - (b.supplier === '') || a.supplier.localeCompare(b.supplier));
};

/**
 * Create one draft receipt per supplier group, marked ready (confirmed).
 * @param {Array} groups [{ supplier, destLocation, lines: [{ product, quantity }] }]
 */
const createReplenishment = async (groups, user = null) => {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new AppError('Choose at least one product to order');
  }
  if (groups.length > 50) {
    throw new AppError('Too many supplier groups at once');
  }
  // Check everything before creating anything (all-or-nothing)
  const planned = [];
  for (const g of groups) {
    const lines = (Array.isArray(g.lines) ? g.lines : [])
      .filter((l) => l && Number(l.quantity) > 0)
      .map((l) => ({ product: l.product, quantity: Number(l.quantity) }));
    if (lines.length === 0) continue;
    if (lines.some((l) => !Number.isFinite(l.quantity) || !mongoose.isValidObjectId(l.product))) {
      throw new AppError('Every line needs a product and a valid quantity');
    }
    if (!mongoose.isValidObjectId(g.destLocation) || !(await Location.exists({ _id: g.destLocation, type: 'internal', isActive: true }))) {
      throw new AppError('Choose an active warehouse location to receive into');
    }
    const products = await Product.find({ _id: { $in: lines.map((l) => l.product) }, isActive: true }).select('leadTimeDays').lean();
    if (products.length !== new Set(lines.map((l) => String(l.product))).size) {
      throw new AppError('One or more products no longer exist or are archived - reload the page', 409);
    }
    // Expected arrival = today + the longest supplier lead time in the order, so the
    // forecast keeps showing the gap until then instead of treating it as arrived today
    const leadTime = Math.max(...products.map((p) => (Number.isFinite(p.leadTimeDays) ? p.leadTimeDays : 7)));
    planned.push({ g, lines, arrival: addDays(startOfDay(), leadTime) });
  }
  if (planned.length === 0) {
    throw new AppError('Choose at least one product with a quantity above zero');
  }

  const created = [];
  try {
    for (const { g, lines, arrival } of planned) {
      const receipt = await stock.createOperation(
        {
          type: 'receipt',
          partner: typeof g.supplier === 'string' && g.supplier.trim() ? g.supplier.trim().slice(0, 200) : 'Supplier to confirm',
          destLocation: g.destLocation,
          scheduledDate: arrival,
          lines,
          notes: 'Replenishment suggested by StockSense forecast',
        },
        user
      );
      const { operation } = await stock.confirmOperation(receipt._id, user);
      created.push(operation);
    }
  } catch (err) {
    // Something changed mid-way: undo what was created so a retry cannot duplicate orders
    await Promise.allSettled(created.map((op) => stock.cancelOperation(op._id, user)));
    throw err;
  }
  return created;
};

module.exports = {
  USAGE_WINDOW_DAYS,
  FORECAST_DAYS,
  COVER_DAYS,
  startOfDay,
  addDays,
  forecastProduct,
  forecastsFor,
  productTimeline,
  stockAsOf,
  dailyActivity,
  replenishmentPlan,
  createReplenishment,
  internalLocationIds,
};
