/**
 * Activity feed: listens to the stock engine, stores a readable history
 * ("Maya validated WH/IN/0006") and pushes each item live to every screen.
 */
const Activity = require('../models/Activity');
const stock = require('./stockService');
const liveHub = require('./liveHub');
const { OPERATION_META } = require('../utils/viewHelpers');

const VERBS = {
  created: 'created',
  updated: 'edited',
  confirmed: 'marked ready',
  waiting: 'is waiting for stock:',
  ready: 'is now ready - stock arrived for',
  validated: 'validated',
  canceled: 'canceled',
  reset: 'moved back to draft',
  picked: 'picked',
  packed: 'packed',
  scanned: 'scanned an item on',
};

// Human sentence for an engine event
const describe = (action, operation, actorName, extra = {}) => {
  const label = OPERATION_META[operation.type] ? OPERATION_META[operation.type].label : 'operation';
  const partner = operation.partner ? ` (${operation.partner})` : '';
  if (action === 'ready') return `${operation.reference} is ready - stock arrived`;
  if (action === 'waiting') return `${operation.reference} is waiting for stock`;
  if (action === 'scanned' && extra.product) return `${actorName} scanned ${extra.product.name} on ${operation.reference}`;
  if (action === 'validated') {
    const outcome = {
      receipt: 'stock received',
      delivery: 'goods shipped',
      internal: 'stock moved',
      adjustment: 'count applied',
    }[operation.type];
    return `${actorName} validated ${operation.reference}${partner} - ${outcome}`;
  }
  return `${actorName} ${VERBS[action] || action} ${label.toLowerCase()} ${operation.reference}${partner}`;
};

const toPayload = (action, operation, user, message, at = new Date()) => ({
  action,
  id: String(operation._id),
  reference: operation.reference,
  type: operation.type,
  status: operation.status,
  actor: user ? { id: String(user._id), name: user.name } : null,
  message,
  at,
});

let started = false;

/**
 * Subscribe to the engine. Called once when the app starts (not by scripts
 * like the seed, which writes its own backdated history).
 */
const start = () => {
  if (started) return;
  started = true;

  stock.events.on('operation', async ({ action, operation, user, ...extra }) => {
    const actorName = user ? user.name : 'System';
    const message = describe(action, operation, actorName, extra);
    const payload = toPayload(action, operation, user, message);

    // Scans are live-only (too chatty for the stored history)
    if (action !== 'scanned') {
      try {
        await Activity.create({
          actor: user ? user._id : null,
          actorName,
          action,
          subjectType: 'operation',
          subject: operation._id,
          reference: operation.reference,
          operationType: operation.type,
          message,
        });
      } catch (err) {
        console.error(`[Activity] could not record "${message}": ${err.message}`);
      }
    }
    liveHub.broadcast('operation', payload);
  });
};

// Latest activity for the dashboard feed
const recent = (limit = 15) => Activity.find().sort({ createdAt: -1 }).limit(limit).lean();

module.exports = {
  start,
  recent,
  describe,
};
