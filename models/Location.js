const mongoose = require('mongoose');

/**
 * Location types:
 * - internal   : a physical place inside a warehouse (Stock, Rack A, Production Floor). Holds stock.
 * - vendor     : virtual source of receipts (goods coming from suppliers).
 * - customer   : virtual destination of deliveries (goods leaving to customers).
 * - adjustment : virtual counterpart of inventory adjustments (found / lost / damaged goods).
 *
 * Every stock operation is a move from one location to another, so receipts,
 * deliveries, transfers and adjustments all share one engine.
 */
const LOCATION_TYPES = ['internal', 'vendor', 'customer', 'adjustment'];
const VIRTUAL_TYPES = ['vendor', 'customer', 'adjustment'];

const VIRTUAL_NAMES = {
  vendor: 'Partners/Vendors',
  customer: 'Partners/Customers',
  adjustment: 'Virtual/Inventory Adjustment',
};

const locationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Location name is required'],
      trim: true,
    },
    // Display name including the warehouse code, e.g. "WH/Rack A"
    fullName: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: {
        values: LOCATION_TYPES,
        message: 'Location type must be one of: ' + LOCATION_TYPES.join(', '),
      },
      default: 'internal',
    },
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      default: null,
      validate: {
        validator: function (value) {
          // Internal locations must belong to a warehouse; virtual ones must not
          return this.type === 'internal' ? Boolean(value) : !value;
        },
        message: 'Internal locations need a warehouse; virtual locations cannot have one',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Location names are unique within a warehouse; there is one location per virtual type
locationSchema.index({ warehouse: 1, name: 1 }, { unique: true });
locationSchema.index(
  { type: 1 },
  { unique: true, partialFilterExpression: { type: { $in: VIRTUAL_TYPES } } }
);

// Keep fullName in sync with the warehouse code
locationSchema.pre('validate', async function () {
  if (this.type !== 'internal') {
    this.fullName = VIRTUAL_NAMES[this.type];
    return;
  }
  if (this.isNew || this.isModified('name') || this.isModified('warehouse') || !this.fullName) {
    const Warehouse = mongoose.model('Warehouse');
    const warehouse = this.warehouse ? await Warehouse.findById(this.warehouse).select('code').lean() : null;
    if (this.warehouse && !warehouse) {
      this.invalidate('warehouse', 'Warehouse not found');
      return;
    }
    this.fullName = warehouse ? `${warehouse.code}/${this.name}` : this.name;
  }
});

/**
 * Get (or lazily create) the single virtual location of a given type.
 * @param {'vendor'|'customer'|'adjustment'} type
 */
locationSchema.statics.getVirtual = async function (type, session = null) {
  if (!VIRTUAL_TYPES.includes(type)) {
    throw new Error(`"${type}" is not a virtual location type`);
  }
  const upsert = () =>
    this.findOneAndUpdate(
      { type },
      { $setOnInsert: { type, name: VIRTUAL_NAMES[type], fullName: VIRTUAL_NAMES[type], warehouse: null } },
      { upsert: true, returnDocument: 'after', session }
    );
  try {
    return await upsert();
  } catch (err) {
    // Two requests creating it at the same moment: the loser just reads the winner's document
    if (err.code === 11000) {
      return upsert();
    }
    throw err;
  }
};

const Location = mongoose.model('Location', locationSchema);

module.exports = Location;
module.exports.LOCATION_TYPES = LOCATION_TYPES;
module.exports.VIRTUAL_TYPES = VIRTUAL_TYPES;
