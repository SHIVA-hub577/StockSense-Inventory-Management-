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
const { OPERATION_META } = require('../utils/viewHelpers');

const page = [protect, appLocals];
const managerPage = [protect, authorize('manager'), appLocals];

// Products & categories
router.get('/products', page, products.listPage);
router.get('/products/new', managerPage, products.newPage);
router.get('/products/:id', page, products.showPage);
router.get('/products/:id/edit', managerPage, products.editPage);
router.get('/categories', page, categories.listPage);

// Operations: /receipts, /deliveries, /transfers (+ /new)
for (const type of ['receipt', 'delivery', 'internal']) {
  const { slug } = OPERATION_META[type];
  router.get(`/${slug}`, page, operations.listPage(type));
  router.get(`/${slug}/new`, page, operations.newPage(type));
}
router.get('/operations/:id', page, operations.showPage);
router.get('/operations/:id/edit', page, operations.editPage);
router.get('/operations/:id/print', protect, operations.printPage);

module.exports = router;
