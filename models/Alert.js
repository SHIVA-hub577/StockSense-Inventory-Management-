const mongoose = require('mongoose');

/**
 * Stock alerts raised when a validation pushes a product to/below its
 * reorder level (low_stock) or to zero (out_of_stock).
 */
const alertSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['low_stock', 'out_of_stock'],
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    operation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Operation',
      default: null,
    },
    reference: {
      type: String,
      default: '',
    },
    message: {
      type: String,
      required: true,
    },
    onHand: {
      type: Number,
      default: 0,
    },
    reorderLevel: {
      type: Number,
      default: 0,
    },
    // Users who have seen / dismissed it
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  }
);

alertSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
