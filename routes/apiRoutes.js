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

// Stock
router.get('/stock/available', operations.apiAvailable);

module.exports = router;
