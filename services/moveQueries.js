/**
 * Move History: the stock ledger with filters, per-product running balance
 * and CSV export.
 */
const mongoose = require('mongoose');
const StockMove = require('../models/StockMove');
const Location = require('../models/Location');
const { OPERATION_TYPES } = require('../models/Operation');
const { parseDateInput } = require('../utils/requestHelpers');
const { roundQty } = require('./stockService');

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const DAY = 24 * 60 * 60 * 1000;

/**
 * Build a Mongo filter from query-string style filters.
 * @param {Object} f product, location, warehouse, type, user, from (YYYY-MM-DD), to (YYYY-MM-DD)
 */
const buildMatch = (f = {}) => {
  const match = {};
  if (mongoose.isValidObjectId(f.product)) match.product = oid(f.product);
  if (mongoose.isValidObjectId(f.location)) match.$or = [{ fromLocation: oid(f.location) }, { toLocation: oid(f.location) }];
  if (mongoose.isValidObjectId(f.warehouse)) match.warehouse = oid(f.warehouse);
  if (OPERATION_TYPES.includes(f.type)) match.operationType = f.type;
  if (mongoose.isValidObjectId(f.user)) match.user = oid(f.user);

  const from = parseDateInput(f.from);
  const to = parseDateInput(f.to);
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = from;
    if (to) match.date.$lt = new Date(to.getTime() + DAY); // inclusive "to" day
  }
  return match;
};

/**
 * Running on-hand balance after each move of one product, scoped to one
 * location or to all internal locations. Exact: computed from the product's
 * full ledger, not just the filtered page.
 * @returns {Promise<Map<string, number>>} moveId -> balance after that move
 */
const runningBalances = async (productId, locationId = null) => {
  const internalIds = locationId
    ? new Set([String(locationId)])
    : new Set((await Location.find({ type: 'internal' }).distinct('_id')).map(String));

  const moves = await StockMove.find({ product: productId })
    .select('date quantity fromLocation toLocation')
    .sort({ date: 1, _id: 1 })
    .lean();

  const balances = new Map();
  let balance = 0;
  for (const m of moves) {
    if (internalIds.has(String(m.toLocation))) balance += m.quantity;
    if (internalIds.has(String(m.fromLocation))) balance -= m.quantity;
    balance = roundQty(balance);
    balances.set(String(m._id), balance);
  }
  return balances;
};

/**
 * @returns {Promise<{rows, total, balances: Map|null}>}
 */
const listMoves = async (filters = {}, { skip = 0, limit = 50 } = {}) => {
  const match = buildMatch(filters);
  const [rows, total] = await Promise.all([
    StockMove.find(match)
      .sort({ date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate('product', 'name sku uom unitCost')
      .populate('fromLocation toLocation', 'fullName type')
      .populate('user', 'name')
      .lean(),
    StockMove.countDocuments(match),
  ]);

  const balances = mongoose.isValidObjectId(filters.product)
    ? await runningBalances(filters.product, mongoose.isValidObjectId(filters.location) ? filters.location : null)
    : null;

  return { rows, total, balances };
};

// Spreadsheet-safe CSV cell: quote, escape quotes, neutralise formula injection
const csvCell = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

/**
 * Ledger as CSV (max 10,000 rows, newest first).
 */
const movesCsv = async (filters = {}) => {
  const rows = await StockMove.find(buildMatch(filters))
    .sort({ date: -1, _id: -1 })
    .limit(10000)
    .populate('product', 'name sku uom unitCost')
    .populate('fromLocation toLocation', 'fullName')
    .populate('user', 'name')
    .lean();

  const header = ['Date', 'Reference', 'Type', 'Product', 'SKU', 'From', 'To', 'Quantity', 'Unit', 'Unit cost', 'Value', 'User'];
  const lines = rows.map((m) => {
    const cost = m.product ? m.product.unitCost || 0 : 0;
    return [
      new Date(m.date).toISOString(),
      m.reference,
      m.operationType,
      m.product ? m.product.name : '',
      m.product ? m.product.sku : '',
      m.fromLocation ? m.fromLocation.fullName : '',
      m.toLocation ? m.toLocation.fullName : '',
      m.quantity,
      m.product ? m.product.uom : '',
      cost,
      roundQty(m.quantity * cost),
      m.user ? m.user.name : '',
    ]
      .map(csvCell)
      .join(',');
  });
  return [header.map(csvCell).join(','), ...lines].join('\r\n');
};

module.exports = {
  buildMatch,
  listMoves,
  runningBalances,
  movesCsv,
  csvCell,
};
