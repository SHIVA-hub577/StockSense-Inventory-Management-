const mongoose = require('mongoose');

/**
 * Atomic sequence counters for human-readable references (WH/IN/0001, ...).
 */
const counterSchema = new mongoose.Schema({
  _id: {
    type: String, // sequence key, e.g. "WH/IN"
  },
  seq: {
    type: Number,
    default: 0,
  },
});

/**
 * Increment and return the next number of a sequence.
 * @param {string} key Sequence key, e.g. "WH/IN"
 */
counterSchema.statics.next = async function (key, session = null) {
  const counter = await this.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session }
  );
  return counter.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
