/**
 * Products: EJS pages + JSON API.
 */
const productService = require('../services/productService');
const lookups = require('../services/lookupService');
const { UNITS_OF_MEASURE } = require('../models/Product');
const { parsePage } = require('../utils/requestHelpers');
const { buildQuery } = require('../utils/viewHelpers');

const PAGE_SIZE = 20;

const paginationFor = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.max(1, Math.ceil(total / limit)),
  from: total === 0 ? 0 : (page - 1) * limit + 1,
  to: Math.min(page * limit, total),
});

const readListFilters = (query) => ({
  search: (query.search || '').toString().trim(),
  category: (query.category || '').toString(),
  status: ['ok', 'low', 'out', 'attention'].includes(query.status) ? query.status : '',
  archived: query.archived === '1' ? '1' : '',
});

/* ------------------------------- Pages ------------------------------- */

const listPage = async (req, res) => {
  const filters = readListFilters(req.query);
  const { page, limit, skip } = parsePage(req.query, PAGE_SIZE);

  const [{ rows, total, counts }, categories] = await Promise.all([
    productService.listProducts({
      search: filters.search,
      category: filters.category,
      stockStatus: filters.status,
      archived: filters.archived === '1',
      skip,
      limit,
    }),
    lookups.getCategories(),
  ]);
  const pagination = paginationFor(page, limit, total);
  if (total > 0 && page > pagination.pages) {
    return res.redirect(`/products${buildQuery(filters, { page: pagination.pages })}`);
  }

  res.render('products/index', {
    title: 'Products - StockSense',
    activeNav: 'products',
    filters,
    products: rows,
    counts,
    categories,
    pagination,
  });
};

const showPage = async (req, res) => {
  const detail = await productService.getProductDetail(req.params.id);
  res.render('products/show', {
    title: `${detail.product.name} - StockSense`,
    activeNav: 'products',
    ...detail,
  });
};

const renderForm = async (res, product) => {
  const [categories, locations] = await Promise.all([lookups.getCategories(), lookups.getInternalLocations()]);
  res.render('products/form', {
    title: `${product ? 'Edit' : 'New'} Product - StockSense`,
    activeNav: 'products',
    product,
    categories,
    locations,
    uoms: UNITS_OF_MEASURE,
  });
};

const newPage = (req, res) => renderForm(res, null);

const editPage = async (req, res) => {
  const { product } = await productService.getProductDetail(req.params.id);
  return renderForm(res, product);
};

/* -------------------------------- API -------------------------------- */

const apiList = async (req, res) => {
  const filters = readListFilters(req.query);
  const { page, limit, skip } = parsePage(req.query, PAGE_SIZE);
  const { rows, total, counts } = await productService.listProducts({
    search: filters.search,
    category: filters.category,
    stockStatus: filters.status,
    archived: filters.archived === '1',
    skip,
    limit,
  });
  res.json({ success: true, data: { products: rows, counts, pagination: paginationFor(page, limit, total) } });
};

const apiShow = async (req, res) => {
  const detail = await productService.getProductDetail(req.params.id);
  res.json({ success: true, data: detail });
};

const apiCreate = async (req, res) => {
  const product = await productService.createProduct(req.body, req.user);
  res.status(201).json({ success: true, message: `Product ${product.name} created`, data: { product } });
};

const apiUpdate = async (req, res) => {
  const product = await productService.updateProduct(req.params.id, req.body);
  res.json({ success: true, message: `Product ${product.name} updated`, data: { product } });
};

const apiArchive = async (req, res) => {
  const product = await productService.setProductActive(req.params.id, false);
  res.json({ success: true, message: `${product.name} archived`, data: { product } });
};

const apiRestore = async (req, res) => {
  const product = await productService.setProductActive(req.params.id, true);
  res.json({ success: true, message: `${product.name} restored`, data: { product } });
};

module.exports = {
  listPage,
  showPage,
  newPage,
  editPage,
  apiList,
  apiShow,
  apiCreate,
  apiUpdate,
  apiArchive,
  apiRestore,
  paginationFor,
};
