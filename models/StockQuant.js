const mongoose = require('mongoose');

/**
 * On-hand quantity of one product at one internal location.
 * Only the stock engine (services/stockService.js) should write to this collection,
 * always together with a StockMove ledger entry.
 */
const stockQuantSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    quantity: {
      type: Number,
      default: 0,
      min: [0, 'Stock quantity cannot be negative'],
    },
  },
  {
    timestamps: true,
  }
);

stockQuantSchema.index({ product: 1, location: 1 }, { unique: true });
stockQuantSchema.index({ location: 1 });

module.exports = mongoose.model('StockQuant', stockQuantSchema);
