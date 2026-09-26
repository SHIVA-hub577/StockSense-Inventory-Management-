/**
 * JSON API (cookie or Bearer token auth). Used by the pages via fetch().
 *
 * Roles: products & categories are managed by Inventory Managers; everyone
 * logged in can run operations, except validating inventory adjustments
 * (checked in operationController.apiValidate).
 */
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const products = require('../controllers/productController');
const categories = require('../controllers/categoryController');
const operations = require('../controllers/operationController');
const insight = require('../controllers/insightController');
const warehouses = require('../controllers/warehouseController');
const live = require('../controllers/liveController');

const manager = authorize('manager');

/**
 * Writes must be JSON (or carry X-Requested-With, which the app's fetch helper sends).
 * A plain HTML form on another site - or another port on the same host, which counts
 * as "same-site" for the lax session cookie - can set neither, so it cannot trigger
 * actions like validate/cancel with the user's cookie.
 */
const requireJsonWrites = (req, res, next) => {
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const isJson = (req.headers['content-type'] || '').toLowerCase().startsWith('application/json');
  if (isWrite && !isJson && !req.headers['x-requested-with']) {
    return res.status(415).json({ success: false, message: 'API writes must be sent as JSON (Content-Type: application/json)' });
  }
  next();
};

router.use(requireJsonWrites);
router.use(protect);

// Products
router.get('/products', products.apiList);
router.get('/products/:id', products.apiShow);
router.post('/products', manager, products.apiCreate);
router.patch('/products/:id', manager, products.apiUpdate);
router.post('/products/:id/archive', manager, products.apiArchive);
router.post('/products/:id/restore', manager, products.apiRestore);

// Categories
router.get('/categories', categories.apiList);
router.post('/categories', manager, categories.apiCreate);
router.patch('/categories/:id', manager, categories.apiUpdate);
router.delete('/categories/:id', manager, categories.apiDelete);

// Operations
router.get('/operations', operations.apiList);
router.get('/operations/:id', operations.apiShow);
router.post('/operations', operations.apiCreate);
router.patch('/operations/:id', operations.apiUpdate);
router.post('/operations/:id/confirm', operations.apiConfirm);
router.post('/operations/:id/validate', operations.apiValidate);
router.post('/operations/:id/cancel', operations.apiCancel);
router.post('/operations/:id/reset', operations.apiReset);
router.post('/operations/:id/duplicate', operations.apiDuplicate);
router.post('/operations/:id/pick', operations.apiDeliveryStep('pick'));
router.post('/operations/:id/pack', operations.apiDeliveryStep('pack'));
router.post('/operations/:id/scan', operations.apiScan);

// Stock
router.get('/stock/available', operations.apiAvailable);
router.get('/stock/at-location', operations.apiStockAtLocation);

// Insights: dashboard, product timeline, replenishment
router.get('/dashboard', insight.apiDashboard);
router.get('/products/:id/timeline', insight.apiTimeline);
router.get('/replenishment', insight.apiReplenishmentPlan);
router.post('/replenishment', insight.apiCreateReplenishment);

// Warehouses & locations
router.get('/warehouses', warehouses.apiList);
router.post('/warehouses', manager, warehouses.apiCreateWarehouse);
router.patch('/warehouses/:id', manager, warehouses.apiUpdateWarehouse);
router.post('/locations', manager, warehouses.apiCreateLocation);
router.patch('/locations/:id', manager, warehouses.apiRenameLocation);
router.post('/locations/:id/archive', manager, warehouses.apiLocationActive(false));
router.post('/locations/:id/restore', manager, warehouses.apiLocationActive(true));

// Live Warehouse, alerts, scanning
router.get('/live', live.stream);
router.get('/nav-counts', live.navCounts);
router.get('/alerts', live.alerts);
router.post('/alerts/read-all', live.alertsReadAll);
router.get('/scan/resolve', live.resolve);

module.exports = router;
