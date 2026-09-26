/**
 * Stock operations (receipts, deliveries, internal transfers, adjustments):
 * EJS pages + JSON API. All stock changes go through services/stockService.
 */
const mongoose = require('mongoose');
const Operation = require('../models/Operation');
const Product = require('../models/Product');
const StockQuant = require('../models/StockQuant');
const AppError = require('../utils/AppError');
const stock = require('../services/stockService');
const queries = require('../services/operationQueries');
const lookups = require('../services/lookupService');
const { OPERATION_META, buildQuery } = require('../utils/viewHelpers');
const { parsePage, parseDateInput, pick, ownKey } = require('../utils/requestHelpers');
const { paginationFor } = require('./productController');

const PAGE_SIZE = 20;
const WRITE_FIELDS = ['type', 'partner', 'sourceLocation', 'destLocation', 'location', 'scheduledDate', 'notes', 'lines', 'blindCount'];

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
  if (data.blindCount !== undefined) {
    data.blindCount = data.blindCount === true || data.blindCount === 'true' || data.blindCount === '1';
  }
  if (data.lines !== undefined) {
    if (!Array.isArray(data.lines)) {
      throw new AppError('Lines must be a list of { product, quantity }');
    }
    data.lines = data.lines.map((line) => ({
      product: line && line.product,
      quantity: line && line.quantity !== '' ? Number(line.quantity) : NaN,
      ...(line && typeof line.reason === 'string' ? { reason: line.reason } : {}),
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

  if (type === 'adjustment') {
    // Count sheet, optionally prefilled from a product / location page
    return res.render('adjustments/form', {
      title: 'New Stock Count - StockSense',
      activeNav: 'adjustments',
      meta: OPERATION_META.adjustment,
      operation: null,
      prefill: {
        location: mongoose.isValidObjectId(req.query.location) ? String(req.query.location) : '',
        product: mongoose.isValidObjectId(req.query.product) ? String(req.query.product) : '',
      },
      ...data,
    });
  }

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
    liveView: `operation:${operation._id}`,
    meta: OPERATION_META[operation.type],
    operation,
    shortages,
    moves,
  });
};

const editPage = async (req, res) => {
  const { operation } = await queries.getOperationDetail(req.params.id);
  if (operation.status !== 'draft') {
    return res.redirect(`/operations/${operation._id}`);
  }
  const data = await formLookups(operation.type);
  if (operation.type === 'adjustment') {
    return res.render('adjustments/form', {
      title: `Edit ${operation.reference} - StockSense`,
      activeNav: 'adjustments',
      meta: OPERATION_META.adjustment,
      operation,
      prefill: { location: '', product: '' },
      ...data,
    });
  }
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
  const detail = await queries.getOperationDetail(req.params.id);
  if (detail.operation.blindCount && req.user.role !== 'manager') {
    detail.operation.lines.forEach((line) => {
      delete line.recorded;
    });
  }
  res.json({ success: true, data: detail });
};

const apiCreate = async (req, res) => {
  const operation = await stock.createOperation(readOperationInput(req.body), req.user);
  res.status(201).json({ success: true, message: `${operation.reference} created`, data: { operation } });
};

const apiUpdate = async (req, res) => {
  const input = readOperationInput(req.body);
  delete input.type; // the type of an operation never changes
  const operation = await stock.updateDraftOperation(req.params.id, input, req.user);
  res.json({ success: true, message: `${operation.reference} saved`, data: { operation } });
};

const apiConfirm = async (req, res) => {
  const { operation, shortages } = await stock.confirmOperation(req.params.id, req.user);
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
  const operation = await stock.cancelOperation(req.params.id, req.user);
  res.json({ success: true, message: `${operation.reference} canceled`, data: { operation } });
};

const apiReset = async (req, res) => {
  const operation = await stock.resetToDraft(req.params.id, req.user);
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

// POST /api/operations/:id/scan { code, quantity? }
const apiScan = async (req, res) => {
  const body = req.body || {};
  const result = await stock.scanCode(req.params.id, body.code, req.user, body.quantity);
  const { operation } = result;
  res.json({
    success: true,
    message: result.message,
    data: {
      kind: result.kind,
      complete: Boolean(result.complete),
      autoPicked: Boolean(result.autoPicked),
      product: result.product || null,
      operation: {
        _id: operation._id,
        status: operation.status,
        pickedAt: operation.pickedAt,
        lines: operation.lines.map((l) => ({ product: l.product, quantity: l.quantity, scannedQty: l.scannedQty, reason: l.reason })),
      },
    },
  });
};

// GET /api/stock/at-location?location=<id> -> everything stored there (count sheets)
const apiStockAtLocation = async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.location)) {
    throw new AppError('Query parameter "location" must be a location id');
  }
  const quants = await StockQuant.find({ location: req.query.location, quantity: { $gt: 0 } })
    .populate('product', 'name sku uom unitCost isActive')
    .lean();
  res.json({
    success: true,
    data: {
      stock: quants
        .filter((q) => q.product && q.product.isActive)
        .map((q) => ({ product: q.product._id, name: q.product.name, sku: q.product.sku, uom: q.product.uom, unitCost: q.product.unitCost || 0, quantity: q.quantity })),
    },
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
  apiScan,
  apiStockAtLocation,
};
