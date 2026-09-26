/**
 * Live Warehouse (event stream, presence, badges), alerts, and Scan & Pick
 * helpers (global scan page, code lookup, printable labels).
 */
const mongoose = require('mongoose');
const Operation = require('../models/Operation');
const Product = require('../models/Product');
const Location = require('../models/Location');
const liveHub = require('../services/liveHub');
const alertService = require('../services/alertService');
const productService = require('../services/productService');
const scanService = require('../services/scanService');
const AppError = require('../utils/AppError');

/* ------------------------------- Live -------------------------------- */

// GET /api/live?view=operation:<id>  (Server-Sent Events)
const stream = (req, res) => liveHub.connect(req, res);

// Sidebar badges + unread alerts, refreshed after live events
const navCounts = async (req, res) => {
  const [byType, stockAlerts, unreadAlerts] = await Promise.all([
    Operation.aggregate([{ $match: { status: { $in: ['waiting', 'ready'] } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    productService.countStockAlerts(),
    alertService.unreadCount(req.user._id),
  ]);
  const counts = { receipt: 0, delivery: 0, internal: 0, adjustment: 0, stockAlerts, unreadAlerts };
  byType.forEach((r) => {
    counts[r._id] = r.n;
  });
  res.json({ success: true, data: { counts, online: liveHub.onlineUsers().map((u) => ({ id: u.id, name: u.name })) } });
};

/* ------------------------------ Alerts ------------------------------- */

const alerts = async (req, res) => {
  res.json({ success: true, data: await alertService.forUser(req.user._id) });
};

const alertsReadAll = async (req, res) => {
  await alertService.markAllRead(req.user._id);
  res.json({ success: true, message: 'All alerts marked as read' });
};

/* ------------------------------- Scan -------------------------------- */

const scanPage = (req, res) => {
  res.render('scan/index', { title: 'Scan - StockSense', activeNav: 'scan' });
};

// GET /api/scan/resolve?code=...
const resolve = async (req, res) => {
  res.json({ success: true, data: await scanService.resolveCode(req.query.code) });
};

/**
 * Printable barcode labels.
 * /labels?product=<id> | ?products=all | ?warehouse=<id> | ?location=<id> | ?operation=<id>
 */
const labelsPage = async (req, res) => {
  const labels = [];
  const q = req.query;

  if (mongoose.isValidObjectId(q.product) || q.products === 'all') {
    const filter = q.products === 'all' ? { isActive: true } : { _id: q.product };
    const products = await Product.find(filter).select('name sku uom').sort({ name: 1 }).limit(500).lean();
    products.forEach((p) => labels.push({ kind: 'Product', code: p.sku, title: p.name, subtitle: `SKU ${p.sku} · ${p.uom}` }));
  }
  if (mongoose.isValidObjectId(q.warehouse) || mongoose.isValidObjectId(q.location)) {
    const filter = mongoose.isValidObjectId(q.location)
      ? { _id: q.location, type: 'internal' }
      : { warehouse: q.warehouse, type: 'internal', isActive: true };
    const locations = await Location.find(filter).populate('warehouse', 'name').sort({ fullName: 1 }).lean();
    locations.forEach((l) => labels.push({ kind: 'Location', code: l.fullName, title: l.fullName, subtitle: l.warehouse ? l.warehouse.name : '' }));
  }
  if (mongoose.isValidObjectId(q.operation)) {
    const op = await Operation.findById(q.operation).select('reference partner').lean();
    if (op) labels.push({ kind: 'Document', code: op.reference, title: op.reference, subtitle: op.partner || '' });
  }
  if (labels.length === 0) {
    throw new AppError('Nothing to print - choose a product, location, warehouse or document', 400);
  }
  res.render('labels/index', { title: 'Labels - StockSense', labels });
};

module.exports = {
  stream,
  navCounts,
  alerts,
  alertsReadAll,
  scanPage,
  resolve,
  labelsPage,
};
