const mongoose = require('mongoose');

/**
 * Activity feed: who did what, when ("Maya validated WH/IN/0006").
 * Also pushed live to every open screen (services/liveHub.js).
 */
const activitySchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorName: {
      type: String,
      default: 'System',
    },
    // e.g. created, confirmed, validated, canceled, reset, picked, packed, duplicated, scanned
    action: {
      type: String,
      required: true,
    },
    subjectType: {
      type: String,
      enum: ['operation', 'product', 'category', 'warehouse', 'location'],
      default: 'operation',
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    reference: {
      type: String,
      default: '',
    },
    operationType: {
      type: String,
      default: null,
    },
    message: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

activitySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Activity', activitySchema);
