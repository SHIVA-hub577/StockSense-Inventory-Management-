/**
 * Global search for the command palette (Ctrl+K): products, operations and
 * locations matching a short query.
 */
const Product = require('../models/Product');
const Operation = require('../models/Operation');
const Location = require('../models/Location');
const { searchRegex } = require('../utils/requestHelpers');

const LIMIT = 6;

const search = async (q) => {
  const regex = searchRegex(q);
  if (!regex) return { products: [], operations: [], locations: [] };

  const [products, operations, locations] = await Promise.all([
    Product.find({ isActive: true, $or: [{ name: regex }, { sku: regex }] })
      .select('name sku uom')
      .sort({ name: 1 })
      .limit(LIMIT)
      .lean(),
    Operation.find({ $or: [{ reference: regex }, { partner: regex }] })
      .select('reference type status partner')
      .sort({ updatedAt: -1 })
      .limit(LIMIT)
      .lean(),
    Location.find({ type: 'internal', isActive: true, fullName: regex })
      .select('fullName')
      .sort({ fullName: 1 })
      .limit(LIMIT)
      .lean(),
  ]);
  return { products, operations, locations };
};

module.exports = { search };
