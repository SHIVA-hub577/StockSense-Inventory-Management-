const mongoose = require('mongoose');

const warehouseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Warehouse name is required'],
      trim: true,
    },
    // Short code used in operation references, e.g. "WH" -> WH/IN/0001
    code: {
      type: String,
      required: [true, 'Warehouse short code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [5, 'Warehouse code can be at most 5 characters'],
      match: [/^[A-Z0-9]+$/, 'Warehouse code can only contain letters and numbers'],
    },
    address: {
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

module.exports = mongoose.model('Warehouse', warehouseSchema);
