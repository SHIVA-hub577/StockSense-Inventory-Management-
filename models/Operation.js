const mongoose = require('mongoose');

/**
 * A stock operation (Odoo calls these "transfers"/"pickings").
 *
 *  type        from (sourceLocation)         to (destLocation)
 *  ----------  ----------------------------  ----------------------------
 *  receipt     Partners/Vendors (virtual)    internal location
 *  delivery    internal location             Partners/Customers (virtual)
 *  internal    internal location             another internal location
 *  adjustment  internal location (counted)   Virtual/Inventory Adjustment
 *
 * For adjustments each line's `quantity` is the COUNTED quantity; on validation
 * the engine records the on-hand quantity in `theoreticalQty` and moves only the
 * difference (in whichever direction is needed).
 *
 * Status flow:  draft -> (waiting | ready) -> done
 *               waiting | ready -> draft (reset, to edit again)
 *               any status except done -> canceled
 * Deliveries can additionally be marked picked -> packed while ready.
 */
const OPERATION_TYPES = ['receipt', 'delivery', 'internal', 'adjustment'];
const OPERATION_STATUSES = ['draft', 'waiting', 'ready', 'done', 'canceled'];

// Reference prefixes, e.g. WH/IN/0001
const REFERENCE_PREFIX = {
  receipt: 'IN',
  delivery: 'OUT',
  internal: 'INT',
  adjustment: 'ADJ',
};

const operationLineSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Each line needs a product'],
    },
    quantity: {
      type: Number,
      required: [true, 'Each line needs a quantity'],
      min: [0, 'Quantity cannot be negative'],
    },
    // Adjustments only: on-hand quantity at the moment of validation
    theoreticalQty: {
      type: Number,
      default: null,
    },
  },
  { _id: true }
);

const operationSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      required: [true, 'Operation type is required'],
      enum: {
        values: OPERATION_TYPES,
        message: 'Operation type must be one of: ' + OPERATION_TYPES.join(', '),
      },
    },
    status: {
      type: String,
      enum: {
        values: OPERATION_STATUSES,
        message: 'Status must be one of: ' + OPERATION_STATUSES.join(', '),
      },
      default: 'draft',
    },
    // Supplier (receipts) or customer (deliveries)
    partner: {
      type: String,
      trim: true,
      default: '',
    },
    sourceLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    destLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    // Warehouse the operation belongs to (used for references and filters)
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true,
    },
    scheduledDate: {
      type: Date,
      default: Date.now,
    },
    lines: {
      type: [operationLineSchema],
      validate: {
        validator: (lines) => Array.isArray(lines) && lines.length > 0,
        message: 'An operation needs at least one product line',
      },
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    validatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    validatedAt: {
      type: Date,
      default: null,
    },
    // Deliveries only: pick -> pack progress before validation
    pickedAt: {
      type: Date,
      default: null,
    },
    pickedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    packedAt: {
      type: Date,
      default: null,
    },
    packedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    canceledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    // Saving a stale copy (e.g. editing a draft someone just validated) fails instead of overwriting
    optimisticConcurrency: true,
  }
);

operationSchema.index({ type: 1, status: 1 });
operationSchema.index({ warehouse: 1, status: 1 });
operationSchema.index({ 'lines.product': 1 });
operationSchema.index({ scheduledDate: -1 });

const Operation = mongoose.model('Operation', operationSchema);

module.exports = Operation;
module.exports.OPERATION_TYPES = OPERATION_TYPES;
module.exports.OPERATION_STATUSES = OPERATION_STATUSES;
module.exports.REFERENCE_PREFIX = REFERENCE_PREFIX;
