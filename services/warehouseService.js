/**
 * Settings > Warehouses & locations (multi-warehouse support).
 */
const mongoose = require('mongoose');
const Warehouse = require('../models/Warehouse');
const Location = require('../models/Location');
const Operation = require('../models/Operation');
const StockQuant = require('../models/StockQuant');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const { pick } = require('../utils/requestHelpers');
const { roundQty } = require('./stockService');

const OPEN = ['draft', 'waiting', 'ready'];
const trimAll = (obj) => {
  for (const k of Object.keys(obj)) if (typeof obj[k] === 'string') obj[k] = obj[k].trim();
  return obj;
};

/**
 * Warehouses with their locations and what each location holds.
 */
const listWarehouses = async () => {
  const [warehouses, locations, stats] = await Promise.all([
    Warehouse.find().sort({ name: 1 }).lean(),
    Location.find({ type: 'internal' }).sort({ name: 1 }).lean(),
    StockQuant.aggregate([
      { $match: { quantity: { $gt: 0 } } },
      { $lookup: { from: Product.collection.name, localField: 'product', foreignField: '_id', as: 'p' } },
      { $unwind: '$p' },
      {
        $group: {
          _id: '$location',
          products: { $sum: 1 },
          value: { $sum: { $multiply: ['$quantity', { $ifNull: ['$p.unitCost', 0] }] } },
        },
      },
    ]),
  ]);
  const statByLocation = new Map(stats.map((s) => [String(s._id), s]));
  return warehouses.map((w) => {
    const locs = locations
      .filter((l) => String(l.warehouse) === String(w._id))
      .map((l) => {
        const s = statByLocation.get(String(l._id));
        return { ...l, products: s ? s.products : 0, value: s ? roundQty(s.value) : 0 };
      });
    return {
      ...w,
      locations: locs,
      products: locs.reduce((sum, l) => sum + l.products, 0),
      value: roundQty(locs.reduce((sum, l) => sum + l.value, 0)),
    };
  });
};

const findOr404 = async (Model, id, label) => {
  const doc = mongoose.isValidObjectId(id) ? await Model.findById(id) : null;
  if (!doc) throw new AppError(`${label} not found`, 404);
  return doc;
};

/**
 * New warehouse with a default "Stock" location.
 */
const createWarehouse = async (data) => {
  const fields = trimAll(pick(data, ['name', 'code', 'address']));
  const warehouse = await Warehouse.create(fields);
  await Location.create({ name: 'Stock', warehouse: warehouse._id });
  return warehouse;
};

// The code is part of every reference (WH/IN/0001), so it cannot change
const updateWarehouse = async (id, data) => {
  const warehouse = await findOr404(Warehouse, id, 'Warehouse');
  Object.assign(warehouse, trimAll(pick(data, ['name', 'address'])));
  await warehouse.save();
  return warehouse;
};

const createLocation = async (data) => {
  const warehouse = await findOr404(Warehouse, data.warehouse, 'Warehouse');
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw new AppError('Location name is required');
  return Location.create({ name, warehouse: warehouse._id });
};

const renameLocation = async (id, data) => {
  const location = await findOr404(Location, id, 'Location');
  if (location.type !== 'internal') throw new AppError('Virtual locations cannot be renamed');
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw new AppError('Location name is required');
  location.name = name;
  await location.save(); // fullName is recalculated by the model
  return location;
};

/**
 * Archive a location: it must be empty and not used by open operations.
 */
const setLocationActive = async (id, isActive) => {
  const location = await findOr404(Location, id, 'Location');
  if (location.type !== 'internal') throw new AppError('Virtual locations cannot be archived');

  if (!isActive) {
    const [stocked, open] = await Promise.all([
      StockQuant.countDocuments({ location: location._id, quantity: { $gt: 0 } }),
      Operation.countDocuments({ status: { $in: OPEN }, $or: [{ sourceLocation: location._id }, { destLocation: location._id }] }),
    ]);
    if (stocked > 0) throw new AppError(`${location.fullName} still holds ${stocked} product(s). Move them out first`, 409);
    if (open > 0) throw new AppError(`${location.fullName} is used by ${open} open operation(s). Finish or cancel them first`, 409);
  }
  location.isActive = Boolean(isActive);
  await location.save();
  return location;
};

/**
 * What a location holds right now (bin view, reached by scanning its label).
 */
const locationDetail = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Location not found', 404);
  const location = await Location.findById(id).populate('warehouse', 'name code').lean();
  if (!location || location.type !== 'internal') throw new AppError('Location not found', 404);
  const stock = await StockQuant.find({ location: location._id, quantity: { $gt: 0 } })
    .populate('product', 'name sku uom unitCost reorderLevel')
    .sort({ quantity: -1 })
    .lean();
  return {
    location,
    stock,
    value: roundQty(stock.reduce((sum, q) => sum + q.quantity * ((q.product && q.product.unitCost) || 0), 0)),
  };
};

module.exports = {
  listWarehouses,
  createWarehouse,
  updateWarehouse,
  createLocation,
  renameLocation,
  setLocationActive,
  locationDetail,
};
