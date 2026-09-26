/**
 * "Scan anything": turn a scanned/typed code into the page it belongs to.
 * Product SKU -> product, location label -> bin view, reference -> operation.
 */
const Product = require('../models/Product');
const Location = require('../models/Location');
const Operation = require('../models/Operation');
const AppError = require('../utils/AppError');
const { escapeRegex } = require('../utils/requestHelpers');

const resolveCode = async (rawCode) => {
  const code = String(rawCode || '').trim().slice(0, 120);
  if (!code) throw new AppError('Scan a barcode or type a code');
  const exact = new RegExp(`^${escapeRegex(code)}$`, 'i');

  const product = await Product.findOne({ sku: code.toUpperCase() }).select('name sku').lean();
  if (product) {
    return { kind: 'product', label: `${product.name} (${product.sku})`, url: `/products/${product._id}` };
  }
  const operation = await Operation.findOne({ reference: exact }).select('reference').lean();
  if (operation) {
    return { kind: 'operation', label: operation.reference, url: `/operations/${operation._id}` };
  }
  const location = await Location.findOne({ fullName: exact, type: 'internal' }).select('fullName').lean();
  if (location) {
    return { kind: 'location', label: location.fullName, url: `/locations/${location._id}` };
  }
  throw new AppError(`Nothing matches "${code}"`, 404);
};

module.exports = { resolveCode };
