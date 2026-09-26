const mongoose = require('mongoose');

const UNITS_OF_MEASURE = ['Units', 'kg', 'g', 'L', 'mL', 'm', 'Box', 'Pack', 'Dozen'];

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'SKU / product code is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    uom: {
      type: String,
      enum: {
        values: UNITS_OF_MEASURE,
        message: 'Unit of measure must be one of: ' + UNITS_OF_MEASURE.join(', '),
      },
      default: 'Units',
    },
    // Reordering rule: stock at or below reorderLevel counts as "low stock",
    // and reorderQty is the suggested quantity to order.
    reorderLevel: {
      type: Number,
      min: [0, 'Reorder level cannot be negative'],
      default: 0,
    },
    reorderQty: {
      type: Number,
      min: [0, 'Reorder quantity cannot be negative'],
      default: 0,
    },
    // Cost of one unit (for stock value, variance value and value-based charts)
    unitCost: {
      type: Number,
      min: [0, 'Unit cost cannot be negative'],
      default: 0,
    },
    // Replenishment: who we usually buy from and how long they take to deliver
    preferredSupplier: {
      type: String,
      trim: true,
      default: '',
    },
    leadTimeDays: {
      type: Number,
      min: [0, 'Lead time cannot be negative'],
      default: 7,
    },
    description: {
      type: String,
      trim: true,
      default: '',
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

productSchema.index({ name: 1 });
productSchema.index({ category: 1 });

module.exports = mongoose.model('Product', productSchema);
module.exports.UNITS_OF_MEASURE = UNITS_OF_MEASURE;
