/**
 * Low-stock alerts (brief: "Alerts for low stock").
 *
 * When a validation pushes a product to or below its reorder level (or to
 * zero) an alert is stored, pushed live to every screen, and emailed to the
 * Inventory Managers (printed to the console in development without Gmail).
 */
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const Product = require('../models/Product');
const User = require('../models/User');
const stock = require('./stockService');
const liveHub = require('./liveHub');
const sendEmail = require('../utils/sendEmail');

const ALERT_WINDOW_DAYS = 30;

// Product / user names are user input: escape before putting them in email HTML
const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Which products crossed a threshold in one validation.
 * @param {Array} crossings [{ product, before, after }]
 * @param {Map} products productId -> { reorderLevel, ... }
 */
const detectCrossings = (crossings, products) => {
  const hits = [];
  for (const c of crossings) {
    const p = products.get(String(c.product));
    if (!p) continue;
    if (c.after <= 0 && c.before > 0) {
      hits.push({ ...c, kind: 'out_of_stock', product: p }); // c.product is only the id
    } else if (c.after > 0 && c.after <= p.reorderLevel && c.before > p.reorderLevel) {
      hits.push({ ...c, kind: 'low_stock', product: p });
    }
  }
  return hits;
};

const alertMessage = (hit) =>
  hit.kind === 'out_of_stock'
    ? `${hit.product.name} (${hit.product.sku}) is out of stock`
    : `${hit.product.name} (${hit.product.sku}) is low: ${hit.after} ${hit.product.uom} left (reorder level ${hit.product.reorderLevel})`;

const emailManagers = async (hits, operation) => {
  const managers = await User.find({ role: 'manager' }).select('email name').lean();
  if (managers.length === 0) return;
  const rows = hits
    .map((h) => `<li><strong>${esc(h.product.name)}</strong> (${esc(h.product.sku)}): ${h.after} ${esc(h.product.uom)} left - reorder level ${h.product.reorderLevel}</li>`)
    .join('');
  await Promise.allSettled(
    managers.map((m) =>
      sendEmail({
        to: m.email,
        subject: `StockSense alert: ${hits.length} product(s) need reordering`,
        html: `<p>Hi ${esc(m.name)},</p><p>After <strong>${esc(operation.reference)}</strong> was validated:</p><ul>${rows}</ul><p>Open StockSense &gt; Replenishment to order them in one click.</p>`,
      })
    )
  );
};

let started = false;

const start = () => {
  if (started) return;
  started = true;

  stock.events.on('operation', async ({ action, operation, crossings }) => {
    if (action !== 'validated' || !Array.isArray(crossings) || crossings.length === 0) return;
    try {
      const products = await Product.find({ _id: { $in: crossings.map((c) => c.product) } })
        .select('name sku uom reorderLevel')
        .lean();
      const hits = detectCrossings(crossings, new Map(products.map((p) => [String(p._id), p])));
      if (hits.length === 0) return;

      const alerts = await Alert.insertMany(
        hits.map((h) => ({
          kind: h.kind,
          product: h.product._id,
          operation: operation._id,
          reference: operation.reference,
          message: alertMessage(h),
          onHand: h.after,
          reorderLevel: h.product.reorderLevel,
        }))
      );
      alerts.forEach((a) =>
        liveHub.broadcast('alert', { id: String(a._id), kind: a.kind, message: a.message, product: String(a.product) })
      );
      await emailManagers(hits, operation);
    } catch (err) {
      console.error(`[Alerts] ${err.message}`);
    }
  });
};

const windowStart = () => new Date(Date.now() - ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

// Latest alerts plus how many this user has not read
const forUser = async (userId, limit = 15) => {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const [alerts, unread] = await Promise.all([
    Alert.find({ createdAt: { $gte: windowStart() } }).sort({ createdAt: -1 }).limit(limit).lean(),
    Alert.countDocuments({ createdAt: { $gte: windowStart() }, readBy: { $ne: uid } }),
  ]);
  return {
    unread,
    alerts: alerts.map((a) => ({ ...a, read: a.readBy.some((id) => id.equals(uid)) })),
  };
};

const markAllRead = (userId) =>
  Alert.updateMany({ createdAt: { $gte: windowStart() }, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } });

const unreadCount = (userId) =>
  Alert.countDocuments({ createdAt: { $gte: windowStart() }, readBy: { $ne: new mongoose.Types.ObjectId(String(userId)) } });

module.exports = {
  start,
  detectCrossings,
  forUser,
  markAllRead,
  unreadCount,
};
