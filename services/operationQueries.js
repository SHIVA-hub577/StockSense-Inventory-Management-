/**
 * Read side of operations: filtered lists with status-tab counts, and the
 * detail view (with live availability for outgoing operations).
 */
const mongoose = require('mongoose');
const Operation = require('../models/Operation');
const Product = require('../models/Product');
const StockMove = require('../models/StockMove');
const AppError = require('../utils/AppError');
const stock = require('./stockService');
const { searchRegex } = require('../utils/requestHelpers');
const { startOfToday } = require('../utils/viewHelpers');

const OPEN_STATUSES = ['draft', 'waiting', 'ready'];

// Tabs on list pages -> statuses they include (null = everything)
const STATUS_TABS = {
  todo: { label: 'To Do', statuses: OPEN_STATUSES },
  ready: { label: 'Ready', statuses: ['ready'] },
  waiting: { label: 'Waiting', statuses: ['waiting'] },
  draft: { label: 'Draft', statuses: ['draft'] },
  done: { label: 'Done', statuses: ['done'] },
  canceled: { label: 'Canceled', statuses: ['canceled'] },
  all: { label: 'All', statuses: null },
};

/**
 * @param {Object} opts type, tab (key of STATUS_TABS), warehouse, search, late, skip, limit
 * @returns {Promise<{rows, total, tabCounts, lateCount}>}
 */
const listOperations = async ({ type, tab = 'todo', warehouse, search, late = false, skip = 0, limit = 20 }) => {
  const base = { type };
  if (warehouse && mongoose.isValidObjectId(warehouse)) {
    base.warehouse = new mongoose.Types.ObjectId(String(warehouse));
  }

  const regex = searchRegex(search);
  if (regex) {
    // Match reference, partner or any product (name / SKU) on the lines
    const productIds = await Product.find({ $or: [{ name: regex }, { sku: regex }] }).distinct('_id');
    base.$or = [{ reference: regex }, { partner: regex }, { 'lines.product': { $in: productIds } }];
  }

  const lateCondition = { status: { $in: OPEN_STATUSES }, scheduledDate: { $lt: startOfToday() } };
  const scoped = late ? { $and: [base, lateCondition] } : base;

  // Counts per status for the tabs, plus how many are late (ignoring the tab)
  const [statusCounts, lateCount] = await Promise.all([
    Operation.aggregate([{ $match: scoped }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Operation.countDocuments({ $and: [base, lateCondition] }),
  ]);
  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.n]));
  const tabCounts = Object.fromEntries(
    Object.entries(STATUS_TABS).map(([key, def]) => [
      key,
      (def.statuses || Object.keys(byStatus)).reduce((sum, s) => sum + (byStatus[s] || 0), 0),
    ])
  );

  const tabDef = Object.hasOwn(STATUS_TABS, tab) ? STATUS_TABS[tab] : STATUS_TABS.todo;
  const filter = tabDef.statuses ? { $and: [scoped, { status: { $in: tabDef.statuses } }] } : scoped;
  // Open work: most urgent first. History: most recent first.
  const sort = tab === 'todo' || OPEN_STATUSES.includes(tab) ? { scheduledDate: 1, _id: 1 } : { updatedAt: -1, _id: -1 };

  const [rows, total] = await Promise.all([
    Operation.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('sourceLocation destLocation', 'fullName type')
      .populate('lines.product', 'name sku uom')
      .lean(),
    Operation.countDocuments(filter),
  ]);

  return { rows, total, tabCounts, lateCount };
};

/**
 * Operation with everything its page needs.
 * For open deliveries/transfers, each line gets `available` at the source location.
 */
const getOperationDetail = async (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Operation not found', 404);
  }
  const operation = await Operation.findById(id)
    .populate('sourceLocation destLocation', 'fullName type')
    .populate('warehouse', 'name code address')
    .populate('lines.product', 'name sku uom isActive')
    .populate('createdBy validatedBy pickedBy packedBy', 'name role')
    .lean();
  if (!operation) {
    throw new AppError('Operation not found', 404);
  }

  const isOutgoing = ['delivery', 'internal'].includes(operation.type);
  let shortages = [];
  if (isOutgoing && OPEN_STATUSES.includes(operation.status)) {
    const productIds = operation.lines.map((l) => l.product._id);
    const available = await stock.getAvailableAt(operation.sourceLocation._id, productIds);
    operation.lines.forEach((line) => {
      line.available = available.get(line.product._id.toString()) || 0;
    });
    shortages = await stock.findShortages({
      type: operation.type,
      sourceLocation: operation.sourceLocation._id,
      lines: operation.lines.map((l) => ({ product: l.product._id, quantity: l.quantity })),
    });
  }

  const moves =
    operation.status === 'done'
      ? await StockMove.find({ operation: operation._id })
          .populate('product', 'name sku uom')
          .populate('fromLocation toLocation', 'fullName')
          .sort({ _id: 1 })
          .lean()
      : [];

  return { operation, shortages, moves };
};

module.exports = {
  STATUS_TABS,
  listOperations,
  getOperationDetail,
};
