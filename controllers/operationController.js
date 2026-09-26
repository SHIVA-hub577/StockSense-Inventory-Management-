/**
 * Stock operations (receipts, deliveries, internal transfers, adjustments):
 * EJS pages + JSON API. All stock changes go through services/stockService.
 */
const mongoose = require('mongoose');
const Operation = require('../models/Operation');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const stock = require('../services/stockService');
const queries = require('../services/operationQueries');
const lookups = require('../services/lookupService');
const { OPERATION_META, buildQuery } = require('../utils/viewHelpers');
const { parsePage, parseDateInput, pick, ownKey } = require('../utils/requestHelpers');
const { paginationFor } = require('./productController');

const PAGE_SIZE = 20;
const WRITE_FIELDS = ['type', 'partner', 'sourceLocation', 'destLocation', 'location', 'scheduledDate', 'notes', 'lines'];

// Request body -> service input (whitelisted, dates parsed, lines normalised)
const readOperationInput = (body = {}) => {
  const data = pick(body, WRITE_FIELDS);
  if (data.scheduledDate !== undefined) {
    data.scheduledDate = parseDateInput(data.scheduledDate);
  }
  for (const key of ['partner', 'notes']) {
    if (typeof data[key] === 'string') {
      data[key] = data[key].trim().slice(0, 500);
    }
  }
  if (data.lines !== undefined) {
    if (!Array.isArray(data.lines)) {
      throw new AppError('Lines must be a list of { product, quantity }');
    }
    data.lines = data.lines.map((line) => ({
      product: line && line.product,
      quantity: line && line.quantity !== '' ? Number(line.quantity) : NaN,
    }));
  }
  return data;
};

const formLookups = async (type) => {
  const [products, locations, partners] = await Promise.all([
    lookups.getProductOptions(),
    lookups.getInternalLocations(),
    lookups.getRecentPartners(type),
  ]);
  return { products, locations, partners };
};

/* ------------------------------- Pages ------------------------------- */

const listPage = (type) => async (req, res) => {
  const tab = ownKey(queries.STATUS_TABS, req.query.tab) || 'todo';
  const filters = {
    tab,
    warehouse: (req.query.warehouse || '').toString(),
    search: (req.query.search || '').toString().trim(),
    late: req.query.late === '1' ? '1' : '',
  };
  const { page, limit, skip } = parsePage(req.query, PAGE_SIZE);

  const [result, warehouses] = await Promise.all([
    queries.listOperations({ type, ...filters, late: filters.late === '1', skip, limit }),
    lookups.getWarehouses(),
  ]);
  const pagination = paginationFor(page, limit, result.total);
  if (result.total > 0 && page > pagination.pages) {
    return res.redirect(`/${OPERATION_META[type].slug}${buildQuery(filters, { page: pagination.pages })}`);
  }

  res.render('operations/index', {
    title: `${OPERATION_META[type].plural} - StockSense`,
    activeNav: OPERATION_META[type].slug,
    type,
    meta: OPERATION_META[type],
    filters,
    tabs: queries.STATUS_TABS,
    tabCounts: result.tabCounts,
    lateCount: result.lateCount,
    operations: result.rows,
    warehouses,
    pagination,
  });
};

const newPage = (type) => async (req, res) => {
  const data = await formLookups(type);

  // Prefill from "Reorder" links: /receipts/new?product=<id>&qty=<n>
  const prefill = { lines: [] };
  if (mongoose.isValidObjectId(req.query.product)) {
    const product = await Product.findOne({ _id: req.query.product, isActive: true }).select('_id').lean();
    const qty = Number(req.query.qty);
    if (product) {
      prefill.lines.push({ product: product._id.toString(), quantity: Number.isFinite(qty) && qty > 0 ? qty : 1 });
    }
  }

  res.render('operations/form', {
    title: `New ${OPERATION_META[type].label} - StockSense`,
    activeNav: OPERATION_META[type].slug,
    type,
    meta: OPERATION_META[type],
    operation: null,
    prefill,
    ...data,
  });
};

const showPage = async (req, res) => {
  const { operation, shortages, moves } = await queries.getOperationDetail(req.params.id);
  res.render('operations/show', {
    title: `${operation.reference} - StockSense`,
    activeNav: OPERATION_META[operation.type].slug,
    meta: OPERATION_META[operation.type],
    operation,
    shortages,
    moves,
  });
};

const editPage = async (req, res) => {
  const { operation } = await queries.getOperationDetail(req.params.id);
  if (operation.status !== 'draft' || operation.type === 'adjustment') {
    return res.redirect(`/operations/${operation._id}`);
  }
  const data = await formLookups(operation.type);
  res.render('operations/form', {
    title: `Edit ${operation.reference} - StockSense`,
    activeNav: OPERATION_META[operation.type].slug,
    type: operation.type,
    meta: OPERATION_META[operation.type],
    operation,
    prefill: { lines: [] },
    ...data,
  });
};

const printPage = async (req, res) => {
  const { operation, moves } = await queries.getOperationDetail(req.params.id);
  res.render('operations/print', {
    title: `${operation.reference} - StockSense`,
    meta: OPERATION_META[operation.type],
    operation,
    moves,
  });
};

/* -------------------------------- API -------------------------------- */

const apiList = async (req, res) => {
  const type = Object.keys(OPERATION_META).includes(req.query.type) ? req.query.type : null;
  if (!type) {
    throw new AppError(`Query parameter "type" must be one of: ${Object.keys(OPERATION_META).join(', ')}`);
  }
  const { page, limit, skip } = parsePage(req.query, PAGE_SIZE);
  const result = await queries.listOperations({
    type,
    tab: ownKey(queries.STATUS_TABS, req.query.tab) || 'all',
    warehouse: req.query.warehouse,
    search: req.query.search,
    late: req.query.late === '1',
    skip,
    limit,
  });
  res.json({
    success: true,
    data: {
      operations: result.rows,
      tabCounts: result.tabCounts,
      lateCount: result.lateCount,
      pagination: paginationFor(page, limit, result.total),
    },
  });
};

const apiShow = async (req, res) => {
  res.json({ success: true, data: await queries.getOperationDetail(req.params.id) });
};

const apiCreate = async (req, res) => {
  const operation = await stock.createOperation(readOperationInput(req.body), req.user);
  res.status(201).json({ success: true, message: `${operation.reference} created`, data: { operation } });
};

const apiUpdate = async (req, res) => {
  const input = readOperationInput(req.body);
  delete input.type; // the type of an operation never changes
  const operation = await stock.updateDraftOperation(req.params.id, input);
  res.json({ success: true, message: `${operation.reference} saved`, data: { operation } });
};

const apiConfirm = async (req, res) => {
  const { operation, shortages } = await stock.confirmOperation(req.params.id);
  const message =
    operation.status === 'ready'
      ? `${operation.reference} is ready to process`
      : `${operation.reference} is waiting for stock`;
  res.json({ success: true, message, data: { operation, shortages } });
};

const apiValidate = async (req, res) => {
  // Inventory adjustments change recorded stock without goods moving: managers only
  if (mongoose.isValidObjectId(req.params.id)) {
    const target = await Operation.findById(req.params.id).select('type').lean();
    if (target && target.type === 'adjustment' && req.user.role !== 'manager') {
      throw new AppError('Only an Inventory Manager can validate inventory adjustments', 403);
    }
  }
  const operation = await stock.validateOperation(req.params.id, req.user);
  res.json({ success: true, message: `${operation.reference} validated - stock updated`, data: { operation } });
};

const apiCancel = async (req, res) => {
  const operation = await stock.cancelOperation(req.params.id);
  res.json({ success: true, message: `${operation.reference} canceled`, data: { operation } });
};

const apiReset = async (req, res) => {
  const operation = await stock.resetToDraft(req.params.id);
  res.json({ success: true, message: `${operation.reference} is back to draft`, data: { operation } });
};

const apiDuplicate = async (req, res) => {
  const operation = await stock.duplicateOperation(req.params.id, req.user);
  res.status(201).json({ success: true, message: `${operation.reference} created as a copy`, data: { operation } });
};

const apiDeliveryStep = (step) => async (req, res) => {
  const operation = await stock.markDeliveryStep(req.params.id, step, req.user);
  res.json({
    success: true,
    message: `${operation.reference} ${step === 'pick' ? 'picked' : 'packed'}`,
    data: { operation },
  });
};

// GET /api/stock/available?location=<id>&products=<id>,<id>
const apiAvailable = async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.location)) {
    throw new AppError('Query parameter "location" must be a location id');
  }
  const productIds = String(req.query.products || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => mongoose.isValidObjectId(id))
    .slice(0, 200);
  const available = await stock.getAvailableAt(req.query.location, productIds);
  res.json({ success: true, data: { location: req.query.location, available: Object.fromEntries(available) } });
};

module.exports = {
  listPage,
  newPage,
  showPage,
  editPage,
  printPage,
  apiList,
  apiShow,
  apiCreate,
  apiUpdate,
  apiConfirm,
  apiValidate,
  apiCancel,
  apiReset,
  apiDuplicate,
  apiDeliveryStep,
  apiAvailable,
};
