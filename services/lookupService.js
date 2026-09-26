/**
 * Small read-only lists used to fill form dropdowns and filters.
 */
const Warehouse = require('../models/Warehouse');
const Location = require('../models/Location');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Operation = require('../models/Operation');

const getWarehouses = () => Warehouse.find({ isActive: true }).sort({ name: 1 }).lean();

// Internal locations with their warehouse, sorted "WH/Rack A", "WH/Stock", ...
const getInternalLocations = () =>
  Location.find({ type: 'internal', isActive: true })
    .populate('warehouse', 'name code')
    .sort({ fullName: 1 })
    .lean();

const getCategories = () => Category.find().sort({ name: 1 }).lean();

// Active products for line pickers (name, SKU, unit, category name)
const getProductOptions = async () => {
  const products = await Product.find({ isActive: true })
    .select('name sku uom category')
    .populate('category', 'name')
    .sort({ name: 1 })
    .lean();
  return products.map((p) => ({
    _id: p._id.toString(),
    name: p.name,
    sku: p.sku,
    uom: p.uom,
    category: p.category ? p.category.name : 'Uncategorised',
  }));
};

// Partner names used before for this operation type (autocomplete)
const getRecentPartners = async (type) => {
  const partners = await Operation.distinct('partner', { type, partner: { $ne: '' } });
  return partners.sort((a, b) => a.localeCompare(b)).slice(0, 50);
};

module.exports = {
  getWarehouses,
  getInternalLocations,
  getCategories,
  getProductOptions,
  getRecentPartners,
};
