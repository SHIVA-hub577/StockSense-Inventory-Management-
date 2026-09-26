const mongoose = require('mongoose');

/**
 * Stock ledger: one immutable row per product movement between two locations.
 * Written only when an operation is validated. Powers "Move History".
 */
const stockMoveSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [0, 'Move quantity cannot be negative'],
    },
    fromLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    toLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    operation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Operation',
      required: true,
    },
    // Denormalised for fast filtering / display in the ledger
    reference: {
      type: String,
      required: true,
    },
    operationType: {
      type: String,
      enum: ['receipt', 'delivery', 'internal', 'adjustment'],
      required: true,
    },
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      default: null,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

stockMoveSchema.index({ date: -1 });
stockMoveSchema.index({ product: 1, date: -1 });
stockMoveSchema.index({ operation: 1 });

module.exports = mongoose.model('StockMove', stockMoveSchema);
