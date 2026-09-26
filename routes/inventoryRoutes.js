/**
 * Inventory web pages (EJS). Data changes happen through /api (see apiRoutes.js).
 */
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const appLocals = require('../middleware/appLocals');
const products = require('../controllers/productController');
const categories = require('../controllers/categoryController');
const operations = require('../controllers/operationController');
const insight = require('../controllers/insightController');
const warehouses = require('../controllers/warehouseController');
const live = require('../controllers/liveController');
const { OPERATION_META } = require('../utils/viewHelpers');

const page = [protect, appLocals];
const managerPage = [protect, authorize('manager'), appLocals];

// Dashboard & insights
router.get('/dashboard', page, insight.dashboardPage);
router.get('/moves', page, insight.movesPage);
router.get('/moves/export.csv', protect, insight.movesCsv);
router.get('/insights/time-machine', page, insight.timeMachinePage);
router.get('/replenishment', page, insight.replenishmentPage);

// Products & categories
router.get('/products', page, products.listPage);
router.get('/products/new', managerPage, products.newPage);
router.get('/products/:id', page, products.showPage);
router.get('/products/:id/edit', managerPage, products.editPage);
router.get('/categories', page, categories.listPage);

// Operations: /receipts, /deliveries, /transfers, /adjustments (+ /new)
for (const type of ['receipt', 'delivery', 'internal', 'adjustment']) {
  const { slug } = OPERATION_META[type];
  router.get(`/${slug}`, page, operations.listPage(type));
  router.get(`/${slug}/new`, page, operations.newPage(type));
}
router.get('/operations/:id', page, operations.showPage);
router.get('/operations/:id/edit', page, operations.editPage);
router.get('/operations/:id/print', protect, operations.printPage);

// Warehouses, bins, scanning, labels
router.get('/settings/warehouses', page, warehouses.settingsPage);
router.get('/locations/:id', page, warehouses.locationPage);
router.get('/scan', page, live.scanPage);
router.get('/labels', protect, live.labelsPage);
router.get('/styleguide', page, live.styleguidePage);

module.exports = router;
