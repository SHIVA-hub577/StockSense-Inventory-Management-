/**
 * Stock engine - the ONLY place that changes stock quantities.
 *
 * Receipts, deliveries, internal transfers and adjustments are all
 * "move product X from location A to location B", so they share one
 * lifecycle:  create (draft) -> confirm (waiting | ready) -> validate (done)
 *             and cancel (any open status).
 *
 * Validation runs in a MongoDB transaction: stock quantities (StockQuant),
 * the ledger (StockMove) and the operation status are committed together or
 * not at all. Transactions need a replica set (Atlas, or `npm run db` locally).
 */
const mongoose = require('mongoose');
const Operation = require('../models/Operation');
const Location = require('../models/Location');
const Warehouse = require('../models/Warehouse');
const Product = require('../models/Product');
const StockQuant = require('../models/StockQuant');
const StockMove = require('../models/StockMove');
const Counter = require('../models/Counter');
const AppError = require('../utils/AppError');

const { OPERATION_TYPES, REFERENCE_PREFIX } = Operation;

const QTY_DECIMALS = 3; // e.g. 0.125 kg
const EPSILON = 1e-9;
const OPEN_STATUSES = ['draft', 'waiting', 'ready'];
const INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK';

const roundQty = (value) => {
  const factor = 10 ** QTY_DECIMALS;
  return Math.round(Number(value) * factor) / factor;
};

// Accepts an id, an ObjectId or a (populated) document
const toId = (value) => (value && value._id ? value._id : value) || null;

// The warehouse an operation belongs to is the one of its internal location
// (the source for deliveries / transfers / adjustments, the destination for receipts)
const warehouseOf = (source, dest) => (source.type === 'internal' ? source : dest).warehouse;

/* ------------------------------------------------------------------ */
/* Input resolution                                                    */
/* ------------------------------------------------------------------ */

const loadInternalLocation = async (id, label) => {
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new AppError(`${label} is required`);
  }
  const location = await Location.findById(id);
  if (!location) {
    throw new AppError(`${label} not found`, 404);
  }
  if (location.type !== 'internal') {
    throw new AppError(`${label} must be a location inside a warehouse`);
  }
  if (!location.isActive) {
    throw new AppError(`${label} "${location.fullName}" is archived`);
  }
  return location;
};

/**
 * Work out source/destination locations for an operation type.
 * Virtual partner/adjustment locations are filled in automatically.
 */
const resolveLocations = async (type, data) => {
  switch (type) {
    case 'receipt':
      return {
        source: await Location.getVirtual('vendor'),
        dest: await loadInternalLocation(toId(data.destLocation), 'Destination location'),
      };
    case 'delivery':
      return {
        source: await loadInternalLocation(toId(data.sourceLocation), 'Source location'),
        dest: await Location.getVirtual('customer'),
      };
    case 'internal': {
      const source = await loadInternalLocation(toId(data.sourceLocation), 'Source location');
      const dest = await loadInternalLocation(toId(data.destLocation), 'Destination location');
      if (source._id.equals(dest._id)) {
        throw new AppError('Source and destination locations must be different');
      }
      return { source, dest };
    }
    case 'adjustment':
      return {
        source: await loadInternalLocation(toId(data.location || data.sourceLocation), 'Location'),
        dest: await Location.getVirtual('adjustment'),
      };
    default:
      throw new AppError(`Operation type must be one of: ${OPERATION_TYPES.join(', ')}`);
  }
};

/**
 * Validate product lines. Duplicate products are merged for moves;
 * for adjustments (counted quantities) duplicates are rejected.
 */
const normalizeLines = async (type, rawLines) => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new AppError('Add at least one product line');
  }

  const merged = new Map(); // productId -> quantity
  for (const raw of rawLines) {
    const productId = toId(raw && raw.product);
    if (!productId || !mongoose.isValidObjectId(productId)) {
      throw new AppError('Every line needs a product');
    }

    const quantity = roundQty(raw.quantity);
    if (!Number.isFinite(quantity)) {
      throw new AppError('Every line needs a numeric quantity');
    }
    if (type === 'adjustment' ? quantity < 0 : quantity <= 0) {
      throw new AppError(
        type === 'adjustment' ? 'Counted quantity cannot be negative' : 'Quantities must be greater than zero'
      );
    }

    const key = productId.toString();
    if (merged.has(key)) {
      if (type === 'adjustment') {
        throw new AppError('Each product can only be counted once per adjustment');
      }
      merged.set(key, roundQty(merged.get(key) + quantity));
    } else {
      merged.set(key, quantity);
    }
  }

  const products = await Product.find({ _id: { $in: [...merged.keys()] } })
    .select('name isActive')
    .lean();
  if (products.length !== merged.size) {
    throw new AppError('One or more products do not exist', 404);
  }
  const archived = products.find((p) => !p.isActive);
  if (archived) {
    throw new AppError(`Product "${archived.name}" is archived`);
  }

  return [...merged.entries()].map(([product, quantity]) => ({ product, quantity }));
};

const nextReference = async (warehouseId, type) => {
  const warehouse = await Warehouse.findById(warehouseId).select('code').lean();
  if (!warehouse) {
    throw new AppError('Warehouse not found', 404);
  }
  const key = `${warehouse.code}/${REFERENCE_PREFIX[type]}`;
  const seq = await Counter.next(key);
  return `${key}/${String(seq).padStart(4, '0')}`;
};

/* ------------------------------------------------------------------ */
/* Stock helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Atomically add `delta` to the on-hand quantity of a product at a location.
 * Decreases only succeed when enough stock exists (never goes negative).
 * @returns {Promise<boolean>} false when a decrease was refused
 */
const changeQuant = async (productId, locationId, delta, session) => {
  const newQty = { $round: [{ $add: [{ $ifNull: ['$quantity', 0] }, delta] }, QTY_DECIMALS] };

  if (delta >= 0) {
    await StockQuant.updateOne(
      { product: productId, location: locationId },
      // Mongoose only adds updatedAt to pipeline updates, so set createdAt on insert ourselves
      [{ $set: { quantity: newQty, createdAt: { $ifNull: ['$createdAt', '$$NOW'] } } }],
      { upsert: true, session, updatePipeline: true }
    );
    return true;
  }

  const result = await StockQuant.updateOne(
    { product: productId, location: locationId, quantity: { $gte: -delta - EPSILON } },
    [{ $set: { quantity: { $max: [0, newQty] } } }],
    { session, updatePipeline: true }
  );
  return result.matchedCount === 1;
};

/**
 * Products an outgoing operation (delivery / internal transfer) cannot fulfil
 * from its source location.
 * @returns {Promise<Array<{product, sku, name, required, available}>>} empty when all available
 */
const findShortages = async (operation, session = null) => {
  if (!['delivery', 'internal'].includes(operation.type)) {
    return [];
  }

  const required = new Map();
  for (const line of operation.lines) {
    const key = toId(line.product).toString();
    required.set(key, roundQty((required.get(key) || 0) + line.quantity));
  }

  const productIds = [...required.keys()];
  const quants = await StockQuant.find({
    location: toId(operation.sourceLocation),
    product: { $in: productIds },
  })
    .session(session)
    .lean();
  const available = new Map(quants.map((q) => [q.product.toString(), q.quantity]));

  const shortIds = productIds.filter((id) => (available.get(id) || 0) + EPSILON < required.get(id));
  if (shortIds.length === 0) {
    return [];
  }

  const products = await Product.find({ _id: { $in: shortIds } })
    .select('name sku')
    .session(session)
    .lean();
  return products.map((p) => ({
    product: p._id,
    sku: p.sku,
    name: p.name,
    required: required.get(p._id.toString()),
    available: available.get(p._id.toString()) || 0,
  }));
};

const shortageError = async (operation, shortages, session = null) => {
  const location = await Location.findById(toId(operation.sourceLocation))
    .select('fullName')
    .session(session)
    .lean();
  const list = shortages.map((s) => `${s.name} (need ${s.required}, have ${s.available})`).join(', ');
  const error = new AppError(
    `Not enough stock in ${location ? location.fullName : 'the source location'}: ${list}`,
    409,
    { shortages }
  );
  error.code = INSUFFICIENT_STOCK;
  return error;
};

const assertOpen = (operation, action) => {
  if (!OPEN_STATUSES.includes(operation.status)) {
    throw new AppError(`Cannot ${action} ${operation.reference}: it is already ${operation.status}`, 409);
  }
};

const findOperationOr404 = async (operationId, session = null) => {
  if (!mongoose.isValidObjectId(operationId)) {
    throw new AppError('Operation not found', 404);
  }
  const operation = await Operation.findById(operationId).session(session);
  if (!operation) {
    throw new AppError('Operation not found', 404);
  }
  return operation;
};

/**
 * After stock arrives somewhere, "waiting" operations taking stock from those
 * locations may now be fulfillable -> mark them ready.
 */
const refreshWaitingOperations = async (locationIds) => {
  const waiting = await Operation.find({
    status: 'waiting',
    type: { $in: ['delivery', 'internal'] },
    sourceLocation: { $in: locationIds },
  });
  for (const operation of waiting) {
    const shortages = await findShortages(operation);
    if (shortages.length === 0) {
      operation.status = 'ready';
      await operation.save().catch(() => {}); // best effort: a concurrent change wins
    }
  }
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a draft operation.
 * @param {Object} data
 *   type            'receipt' | 'delivery' | 'internal' | 'adjustment'
 *   lines           [{ product, quantity }]  (adjustments: quantity = counted qty)
 *   sourceLocation  delivery / internal
 *   destLocation    receipt / internal
 *   location        adjustment (the counted location)
 *   partner, scheduledDate, notes  optional
 * @param {Object} [user] the logged-in user (req.user)
 */
const createOperation = async (data = {}, user = null) => {
  const { type } = data;
  if (!OPERATION_TYPES.includes(type)) {
    throw new AppError(`Operation type must be one of: ${OPERATION_TYPES.join(', ')}`);
  }

  const { source, dest } = await resolveLocations(type, data);
  const lines = await normalizeLines(type, data.lines);
  const warehouse = warehouseOf(source, dest);
  const reference = await nextReference(warehouse, type);

  return Operation.create({
    reference,
    type,
    status: 'draft',
    partner: data.partner || '',
    sourceLocation: source._id,
    destLocation: dest._id,
    warehouse,
    scheduledDate: data.scheduledDate || Date.now(),
    lines,
    notes: data.notes || '',
    createdBy: toId(user),
  });
};

/**
 * Edit a draft operation (lines, locations, partner, date, notes).
 * Locations must stay in the same warehouse because the reference encodes it.
 */
const updateDraftOperation = async (operationId, data = {}) => {
  const operation = await findOperationOr404(operationId);
  if (operation.status !== 'draft') {
    throw new AppError(`Only draft operations can be edited (${operation.reference} is ${operation.status})`, 409);
  }

  if (data.sourceLocation !== undefined || data.destLocation !== undefined || data.location !== undefined) {
    const { source, dest } = await resolveLocations(operation.type, {
      sourceLocation: data.sourceLocation ?? operation.sourceLocation,
      destLocation: data.destLocation ?? operation.destLocation,
      location: data.location,
    });
    if (!warehouseOf(source, dest).equals(operation.warehouse)) {
      throw new AppError(`Locations must stay in the same warehouse as ${operation.reference}`);
    }
    operation.sourceLocation = source._id;
    operation.destLocation = dest._id;
  }

  if (data.lines !== undefined) {
    operation.lines = await normalizeLines(operation.type, data.lines);
  }
  for (const field of ['partner', 'scheduledDate', 'notes']) {
    if (data[field] !== undefined) {
      operation[field] = data[field];
    }
  }

  await operation.save();
  return operation;
};

/**
 * Mark a draft (or re-check a waiting) operation as ready to process.
 * Outgoing operations become "waiting" when stock is short.
 * @returns {{ operation, shortages }}
 */
const confirmOperation = async (operationId) => {
  const operation = await findOperationOr404(operationId);
  if (!['draft', 'waiting'].includes(operation.status)) {
    throw new AppError(`Only draft or waiting operations can be confirmed (${operation.reference} is ${operation.status})`, 409);
  }

  const shortages = await findShortages(operation);
  operation.status = shortages.length ? 'waiting' : 'ready';
  await operation.save();
  return { operation, shortages };
};

/**
 * Validate an operation: apply its stock changes, write the ledger and mark it done.
 * Works from draft, waiting or ready. All-or-nothing (transaction).
 */
const validateOperation = async (operationId, user = null) => {
  let validated;

  try {
    await mongoose.connection.transaction(async (session) => {
      const operation = await findOperationOr404(operationId, session);
      assertOpen(operation, 'validate');

      const shortages = await findShortages(operation, session);
      if (shortages.length) {
        throw await shortageError(operation, shortages, session);
      }

      const now = new Date();
      const source = operation.sourceLocation;
      const dest = operation.destLocation;
      const moveBase = {
        operation: operation._id,
        reference: operation.reference,
        operationType: operation.type,
        warehouse: operation.warehouse,
        date: now,
        user: toId(user),
      };
      const moves = [];

      for (const line of operation.lines) {
        const product = line.product;

        if (operation.type === 'adjustment') {
          // Counted vs. recorded: move only the difference
          const quant = await StockQuant.findOne({ product, location: source }).session(session).lean();
          const onHand = quant ? quant.quantity : 0;
          line.theoreticalQty = onHand;
          const diff = roundQty(line.quantity - onHand);

          if (diff > 0) {
            await changeQuant(product, source, diff, session);
            moves.push({ ...moveBase, product, quantity: diff, fromLocation: dest, toLocation: source });
          } else if (diff < 0) {
            await changeQuant(product, source, diff, session);
            moves.push({ ...moveBase, product, quantity: -diff, fromLocation: source, toLocation: dest });
          }
          continue;
        }

        // Deliveries and transfers take stock out of the source location
        if (operation.type !== 'receipt') {
          const ok = await changeQuant(product, source, -line.quantity, session);
          if (!ok) {
            // Stock changed since the check above (concurrent validation) -> abort everything
            throw await shortageError(operation, await findShortages(operation, session), session);
          }
        }
        // Receipts and transfers put stock into the destination location
        if (operation.type !== 'delivery') {
          await changeQuant(product, dest, line.quantity, session);
        }
        moves.push({ ...moveBase, product, quantity: line.quantity, fromLocation: source, toLocation: dest });
      }

      if (moves.length) {
        await StockMove.insertMany(moves, { session });
      }

      operation.status = 'done';
      operation.validatedBy = toId(user);
      operation.validatedAt = now;
      await operation.save({ session });
      validated = operation;
    });
  } catch (err) {
    if (err.code === INSUFFICIENT_STOCK) {
      // Not processable right now -> park it as waiting
      await Operation.updateOne(
        { _id: operationId, status: { $in: OPEN_STATUSES } },
        { $set: { status: 'waiting' }, $inc: { __v: 1 } }
      );
    }
    if (/replica set|Transaction numbers/i.test(err.message || '')) {
      throw new AppError(
        'Stock validation needs MongoDB transactions. Use MongoDB Atlas, or run `npm run db` for a local replica set.',
        500
      );
    }
    throw err;
  }

  // Stock arrived at the destination (receipt / transfer) or possibly at the
  // counted location (adjustment) -> waiting operations there may be ready now.
  // Best effort: the validation is already committed, so never fail because of this.
  const arrivedAt = validated.type === 'adjustment' ? validated.sourceLocation : validated.destLocation;
  if (validated.type !== 'delivery') {
    await refreshWaitingOperations([arrivedAt]).catch((err) => {
      console.error(`[Stock] Could not refresh waiting operations: ${err.message}`);
    });
  }

  return validated;
};

/**
 * Cancel an open operation. Done operations cannot be canceled
 * (reverse them with a new operation instead).
 */
const cancelOperation = async (operationId) => {
  if (!mongoose.isValidObjectId(operationId)) {
    throw new AppError('Operation not found', 404);
  }
  const operation = await Operation.findOneAndUpdate(
    { _id: operationId, status: { $in: OPEN_STATUSES } },
    { $set: { status: 'canceled', canceledAt: new Date() }, $inc: { __v: 1 } },
    { returnDocument: 'after' }
  );
  if (operation) {
    return operation;
  }

  const existing = await Operation.findById(operationId).select('reference status').lean();
  if (!existing) {
    throw new AppError('Operation not found', 404);
  }
  throw new AppError(`Cannot cancel ${existing.reference}: it is already ${existing.status}`, 409);
};

/**
 * Total on-hand quantity per product across internal locations.
 * @param {Object} [filter] { productIds, warehouseId }
 * @returns {Promise<Map<string, number>>} productId -> quantity
 */
const getOnHandTotals = async ({ productIds, warehouseId } = {}) => {
  const match = {};
  if (productIds) {
    match.product = { $in: productIds.map((id) => new mongoose.Types.ObjectId(String(toId(id)))) };
  }
  if (warehouseId) {
    const locationIds = await Location.find({ warehouse: warehouseId, type: 'internal' }).distinct('_id');
    match.location = { $in: locationIds };
  }

  const rows = await StockQuant.aggregate([
    { $match: match },
    { $group: { _id: '$product', quantity: { $sum: '$quantity' } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), roundQty(r.quantity)]));
};

/**
 * Where a product is stocked: [{ location: { fullName, warehouse }, quantity }]
 */
const getStockByLocation = async (productId) => {
  return StockQuant.find({ product: productId, quantity: { $gt: 0 } })
    .populate('location', 'fullName warehouse')
    .sort({ quantity: -1 })
    .lean();
};

module.exports = {
  createOperation,
  updateDraftOperation,
  confirmOperation,
  validateOperation,
  cancelOperation,
  findShortages,
  getOnHandTotals,
  getStockByLocation,
  roundQty,
  OPEN_STATUSES,
};
