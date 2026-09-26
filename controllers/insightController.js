/**
 * Dashboard, Move History, Time Machine, Replenishment and product timelines.
 */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const dashboard = require('../services/dashboardService');
const moves = require('../services/moveQueries');
const insights = require('../services/insightsService');
const lookups = require('../services/lookupService');
const { OPERATION_TYPES } = require('../models/Operation');
const { parsePage } = require('../utils/requestHelpers');
const { buildQuery, toDateInput } = require('../utils/viewHelpers');
const { paginationFor } = require('./productController');

/* ----------------------------- Dashboard ----------------------------- */

const dashboardPage = async (req, res) => {
  const [data, warehouses, categories] = await Promise.all([
    dashboard.getDashboard(req.query),
    lookups.getWarehouses(),
    lookups.getCategories(),
  ]);
  res.render('dashboard', {
    title: 'Dashboard - StockSense',
    activeNav: 'dashboard',
    liveView: 'page:dashboard',
    ...data,
    warehouses,
    categories,
  });
};

const apiDashboard = async (req, res) => {
  res.json({ success: true, data: await dashboard.getDashboard(req.query) });
};

/* ---------------------------- Move History --------------------------- */

const readMoveFilters = (q) => ({
  product: mongoose.isValidObjectId(q.product) ? String(q.product) : '',
  location: mongoose.isValidObjectId(q.location) ? String(q.location) : '',
  warehouse: mongoose.isValidObjectId(q.warehouse) ? String(q.warehouse) : '',
  type: OPERATION_TYPES.includes(q.type) ? q.type : '',
  user: mongoose.isValidObjectId(q.user) ? String(q.user) : '',
  from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : '',
  to: /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : '',
});

const movesPage = async (req, res) => {
  const filters = readMoveFilters(req.query);
  const { page, limit, skip } = parsePage(req.query, 50);
  const [result, products, locations, warehouses, users] = await Promise.all([
    moves.listMoves(filters, { skip, limit }),
    Product.find().select('name sku').sort({ name: 1 }).lean(),
    lookups.getInternalLocations(),
    lookups.getWarehouses(),
    User.find().select('name').sort({ name: 1 }).lean(),
  ]);
  const pagination = paginationFor(page, limit, result.total);
  if (result.total > 0 && page > pagination.pages) {
    return res.redirect(`/moves${buildQuery(filters, { page: pagination.pages })}`);
  }
  res.render('moves/index', {
    title: 'Move History - StockSense',
    activeNav: 'history',
    liveView: 'page:moves',
    filters,
    moves: result.rows,
    balances: result.balances,
    products,
    locations,
    warehouses,
    users,
    pagination,
  });
};

const movesCsv = async (req, res) => {
  const csv = await moves.movesCsv(readMoveFilters(req.query));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="stocksense-moves-${toDateInput(new Date())}.csv"`);
  res.send(`﻿${csv}`); // BOM so Excel opens UTF-8 correctly
};

/* ---------------------------- Time Machine --------------------------- */

const timeMachinePage = async (req, res) => {
  const filters = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : toDateInput(insights.addDays(new Date(), -7)),
    warehouse: mongoose.isValidObjectId(req.query.warehouse) ? String(req.query.warehouse) : '',
    category: mongoose.isValidObjectId(req.query.category) ? String(req.query.category) : '',
    search: (req.query.search || '').toString().trim().slice(0, 100),
  };
  const [result, warehouses, categories] = await Promise.all([
    insights.stockAsOf(filters),
    lookups.getWarehouses(),
    lookups.getCategories(),
  ]);
  res.render('insights/time-machine', {
    title: 'Time Machine - StockSense',
    activeNav: 'timemachine',
    filters,
    ...result,
    warehouses,
    categories,
  });
};

/* ---------------------------- Replenishment -------------------------- */

const replenishmentPage = async (req, res) => {
  const [groups, locations] = await Promise.all([insights.replenishmentPlan(), lookups.getInternalLocations()]);
  res.render('insights/replenishment', {
    title: 'Replenishment - StockSense',
    activeNav: 'replenishment',
    groups,
    locations,
    horizon: insights.FORECAST_DAYS,
    coverDays: insights.COVER_DAYS,
    usageDays: insights.USAGE_WINDOW_DAYS,
  });
};

const apiReplenishmentPlan = async (req, res) => {
  res.json({ success: true, data: { groups: await insights.replenishmentPlan() } });
};

const apiCreateReplenishment = async (req, res) => {
  const created = await insights.createReplenishment((req.body || {}).groups, req.user);
  res.status(201).json({
    success: true,
    message: `${created.length} receipt(s) created: ${created.map((o) => o.reference).join(', ')}`,
    data: { operations: created.map((o) => ({ _id: o._id, reference: o.reference, status: o.status })) },
  });
};

const apiTimeline = async (req, res) => {
  res.json({ success: true, data: await insights.productTimeline(req.params.id) });
};

module.exports = {
  dashboardPage,
  apiDashboard,
  movesPage,
  movesCsv,
  timeMachinePage,
  replenishmentPage,
  apiReplenishmentPlan,
  apiCreateReplenishment,
  apiTimeline,
};
