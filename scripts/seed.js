/**
 * Seed demo data: warehouses, locations, categories, products, demo users and
 * 45 days of realistic history (daily deliveries, replenishments, transfers,
 * stock counts), plus open work for today. Everything goes through the stock
 * engine, so quantities and the ledger are always consistent; dates are then
 * backdated. The history is deterministic (seeded random numbers), so every
 * run produces the same data.
 *
 * WARNING: wipes all inventory data (warehouses, locations, categories, products,
 * stock, operations, ledger, alerts, activity). User accounts are kept; demo
 * users are upserted.
 *
 * Usage:  npm run seed               (local database only)
 *         npm run seed -- --force    (allow a remote database, e.g. a demo Atlas DB)
 */
require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Warehouse = require('../models/Warehouse');
const Location = require('../models/Location');
const Category = require('../models/Category');
const Product = require('../models/Product');
const StockQuant = require('../models/StockQuant');
const StockMove = require('../models/StockMove');
const Operation = require('../models/Operation');
const Counter = require('../models/Counter');
const Alert = require('../models/Alert');
const Activity = require('../models/Activity');
const stock = require('../services/stockService');
const insights = require('../services/insightsService');
const { describe } = require('../services/activityService');

const INVENTORY_MODELS = [Warehouse, Location, Category, Product, StockQuant, StockMove, Operation, Counter, Alert, Activity];
const HISTORY_DAYS = 45;

// Demo logins (local/demo databases only)
const DEMO_PASSWORD = 'Demo@1234';
const DEMO_USERS = [
  { key: 'maya', name: 'Maya Manager', email: 'manager@stocksense.test', role: 'manager' },
  { key: 'sam', name: 'Sam Staff', email: 'staff@stocksense.test', role: 'staff' },
  { key: 'priya', name: 'Priya Picker', email: 'priya@stocksense.test', role: 'staff' },
];

// sku, name, category, uom, reorderLevel, reorderQty, unitCost, supplier, leadTime, mean daily demand, target on hand today, stored in
const PRODUCTS = [
  ['STEEL-KG', 'Steel', 'Raw Materials', 'kg', 50, 200, 68, 'Tata Steel', 5, 4, 40, 'WH'],
  ['STEEL-ROD', 'Steel Rods', 'Raw Materials', 'Units', 20, 100, 450, 'Tata Steel', 5, 1.5, 50, 'WH'],
  ['COPPER-WIRE', 'Copper Wire', 'Raw Materials', 'm', 100, 500, 22, 'Hindalco Wires', 7, 28, 800, 'WH'],
  ['CHAIR-OFF', 'Office Chair', 'Furniture', 'Units', 10, 40, 3200, 'Urban Furniture Co.', 10, 1.4, 30, 'WH'],
  ['DESK-WOOD', 'Wooden Desk', 'Furniture', 'Units', 5, 20, 7800, 'Urban Furniture Co.', 14, 0.3, 12, 'WH'],
  ['MON-24', '24" LED Monitor', 'Electronics', 'Units', 8, 25, 9800, 'Dell Distributors', 6, 0.8, 20, 'WH'],
  ['KBD-USB', 'USB Keyboard', 'Electronics', 'Units', 15, 50, 650, 'Dell Distributors', 4, 3, 18, 'WH'],
  ['BOX-M', 'Cardboard Box (Medium)', 'Packaging', 'Units', 100, 500, 18, 'PackRight Supplies', 3, 12, 200, 'WH2'],
  ['TAPE-PK', 'Packing Tape', 'Packaging', 'Units', 20, 100, 45, 'PackRight Supplies', 3, 4, 0, 'WH2'],
  ['GLOVE-PR', 'Safety Gloves (pair)', 'Safety', 'Units', 30, 100, 120, 'SafeGear India', 5, 3, 25, 'WH'],
  ['PALLET-W', 'Wooden Pallet', 'Packaging', 'Units', 10, 30, 900, 'PackRight Supplies', 7, 0.5, 40, 'WH2'],
];
const CUSTOMERS = ['Acme Builders', 'BrightDesk Offices', 'Nova Retail', 'Metro Mart', 'Sunrise Traders', 'GreenLeaf Cafe', 'Orbit Tech Park'];

/* ------------------------------------------------------------------ */

// Deterministic pseudo-random numbers (mulberry32)
const rng = (() => {
  let a = 20260926;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
const pickOne = (list) => list[Math.floor(rng() * list.length)];
// Poisson-ish daily demand around a mean
const demand = (mean) => {
  let k = 0;
  let p = 1;
  const l = Math.exp(-mean);
  do {
    k += 1;
    p *= rng();
  } while (p > l && k < 200);
  return k - 1;
};

const today = insights.startOfDay();
const at = (dayOffset, hour = 10, minute = 0) => {
  const d = insights.addDays(today, dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const isLocalUrl = (url) => {
  try {
    const hosts = url.replace(/^mongodb(\+srv)?:\/\//, '').split('/')[0].split('@').pop();
    return hosts.split(',').every((h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h));
  } catch (e) {
    return false;
  }
};

const upsertDemoUser = async ({ name, email, role }) => {
  let user = await User.findOne({ email });
  if (!user) user = new User({ name, email, role });
  user.name = name;
  user.role = role;
  user.password = DEMO_PASSWORD; // hashed by the pre-save hook
  await user.save();
  return user;
};

/**
 * Backdate an operation and its ledger rows (native updates: bypass Mongoose
 * timestamps so createdAt can be set too).
 */
const backdate = async (op, date, { created = date, picked = false } = {}) => {
  const set = { scheduledDate: date, createdAt: created, updatedAt: date };
  if (op.status === 'done' || op.validatedAt) set.validatedAt = date;
  if (picked) {
    set.pickedAt = new Date(date.getTime() - 40 * 60000);
    set.packedAt = new Date(date.getTime() - 15 * 60000);
  }
  await Operation.collection.updateOne({ _id: op._id }, { $set: set });
  await StockMove.collection.updateMany({ operation: op._id }, { $set: { date, createdAt: date, updatedAt: date } });
};

/**
 * Run an operation through its lifecycle as a real user would.
 * finalStatus: done | ready | waiting | draft | canceled | picked
 */
const run = async (data, { user, finalStatus = 'done', date, created }) => {
  const op = await stock.createOperation({ ...data, scheduledDate: date }, user);
  const isDelivery = data.type === 'delivery';

  if (finalStatus === 'done') {
    if (isDelivery) {
      await stock.confirmOperation(op._id, user);
      await stock.markDeliveryStep(op._id, 'pick', user);
      await stock.markDeliveryStep(op._id, 'pack', user);
    }
    const done = await stock.validateOperation(op._id, user);
    await backdate(done, date, { created, picked: isDelivery });
    return done;
  }
  if (['ready', 'waiting', 'picked'].includes(finalStatus)) {
    const { operation } = await stock.confirmOperation(op._id, user);
    const expected = finalStatus === 'picked' ? 'ready' : finalStatus;
    if (operation.status !== expected) {
      throw new Error(`Seed data problem: ${op.reference} ended up ${operation.status}, expected ${expected}`);
    }
    if (finalStatus === 'picked') await stock.markDeliveryStep(op._id, 'pick', user);
  } else if (finalStatus === 'canceled') {
    await stock.cancelOperation(op._id, user);
  }
  await Operation.collection.updateOne({ _id: op._id }, { $set: { scheduledDate: date, createdAt: created || at(-1, 16), updatedAt: created || at(-1, 16) } });
  return Operation.findById(op._id);
};

/* ------------------------------------------------------------------ */

const seed = async () => {
  const url = process.env.MONGO_DB_URL || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!url) throw new Error('MONGO_DB_URL is not set. Run `npm run db` and see .env.example.');
  if (!isLocalUrl(url) && !process.argv.includes('--force')) {
    throw new Error('Refusing to wipe a non-local database. Re-run with `npm run seed -- --force` if you really mean it.');
  }

  await mongoose.connect(url);
  console.log(`[Seed] Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  const started = Date.now();

  await Promise.all(INVENTORY_MODELS.map((M) => M.deleteMany({})));
  await Promise.all([...INVENTORY_MODELS, User].map((M) => M.init()));

  const users = {};
  for (const u of DEMO_USERS) users[u.key] = await upsertDemoUser(u);
  const { maya, sam, priya } = users;
  const staff = () => (rng() < 0.6 ? sam : priya);

  // Warehouses & locations
  const wh = await Warehouse.create({ name: 'Main Warehouse', code: 'WH', address: '12 Industrial Estate, Coimbatore' });
  const wh2 = await Warehouse.create({ name: 'Second Warehouse', code: 'WH2', address: '4 Lake Road, Ooty' });
  const loc = {};
  for (const name of ['Stock', 'Rack A', 'Rack B', 'Production Floor']) loc[name] = await Location.create({ name, warehouse: wh._id });
  loc.wh2Stock = await Location.create({ name: 'Stock', warehouse: wh2._id });
  loc.wh2Cold = await Location.create({ name: 'Dispatch Bay', warehouse: wh2._id });
  const home = { WH: loc.Stock, WH2: loc.wh2Stock };

  // Categories & products
  const cat = {};
  for (const name of ['Raw Materials', 'Furniture', 'Electronics', 'Packaging', 'Safety']) cat[name] = await Category.create({ name });
  const p = {};
  const spec = {};
  for (const [sku, name, category, uom, reorderLevel, reorderQty, unitCost, supplier, leadTimeDays, mean, target, store] of PRODUCTS) {
    p[sku] = await Product.create({ sku, name, category: cat[category]._id, uom, reorderLevel, reorderQty, unitCost, preferredSupplier: supplier, leadTimeDays });
    spec[sku] = { mean, target, store, supplier, reorderQty };
  }
  const line = (sku, quantity) => ({ product: p[sku]._id, quantity });

  /* ---------- Plan 45 days of demand, then size receipts to land on target ---------- */
  const days = [];
  for (let d = -HISTORY_DAYS + 1; d <= -1; d += 1) days.push(d);
  const plan = {}; // sku -> { day -> qty }
  const totals = {};
  for (const sku of Object.keys(spec)) {
    plan[sku] = {};
    totals[sku] = 0;
    for (const d of days) {
      const qty = demand(spec[sku].mean);
      if (qty > 0) {
        plan[sku][d] = qty;
        totals[sku] += qty;
      }
    }
  }
  // Two mid-history replenishments sized ~12 days of demand; opening stock covers the rest
  const midReceipts = [-30, -15];
  const opening = {};
  for (const sku of Object.keys(spec)) {
    const mid = Math.round(spec[sku].mean * 12);
    spec[sku].mid = mid;
    opening[sku] = Math.max(0, spec[sku].target + totals[sku] - mid * midReceipts.length);
  }
  // (the brief's steel example below brings its own 100 kg into the Production Floor)

  /* ---------- Day -45: opening stock, one receipt per supplier ---------- */
  const bySupplier = {};
  for (const sku of Object.keys(spec)) {
    if (opening[sku] <= 0) continue;
    const key = `${spec[sku].supplier}|${spec[sku].store}`;
    (bySupplier[key] = bySupplier[key] || []).push(line(sku, opening[sku]));
  }
  let hour = 9;
  for (const [key, lines] of Object.entries(bySupplier)) {
    const [supplier, store] = key.split('|');
    await run({ type: 'receipt', partner: supplier, destLocation: home[store]._id, lines }, { user: sam, date: at(-HISTORY_DAYS, hour++) });
  }

  // On-hand tracker so history never tries to ship what isn't there
  const onHand = {};
  for (const sku of Object.keys(spec)) onHand[sku] = opening[sku];

  /* ---------- Daily history ---------- */
  for (const d of days) {
    // Replenishment days
    if (midReceipts.includes(d)) {
      const groups = {};
      for (const sku of Object.keys(spec)) {
        if (spec[sku].mid <= 0) continue;
        const key = `${spec[sku].supplier}|${spec[sku].store}`;
        (groups[key] = groups[key] || []).push(line(sku, spec[sku].mid));
        onHand[sku] += spec[sku].mid;
      }
      let h = 8;
      for (const [key, lines] of Object.entries(groups)) {
        const [supplier, store] = key.split('|');
        await run({ type: 'receipt', partner: supplier, destLocation: home[store]._id, lines }, { user: staff(), date: at(d, h++) });
      }
    }

    // Customer orders: split the day's demand across 1-2 deliveries per warehouse
    for (const store of ['WH', 'WH2']) {
      const lines = [];
      for (const sku of Object.keys(spec)) {
        if (spec[sku].store !== store) continue;
        const want = Math.min(plan[sku][d] || 0, onHand[sku]);
        if (want > 0) {
          lines.push(line(sku, want));
          onHand[sku] -= want;
        }
      }
      if (lines.length === 0) continue;
      const split = lines.length > 2 && rng() < 0.5 ? Math.ceil(lines.length / 2) : lines.length;
      const batches = [lines.slice(0, split), lines.slice(split)].filter((b) => b.length);
      for (const [i, batch] of batches.entries()) {
        await run(
          { type: 'delivery', partner: pickOne(CUSTOMERS), sourceLocation: home[store]._id, lines: batch },
          { user: staff(), date: at(d, 11 + i * 3, Math.floor(rng() * 50)), created: at(d, 8 + i) }
        );
      }
    }

    // Weekly rack moves (then back, so the Stock location keeps feeding deliveries)
    if (d % 7 === 0 && onHand['MON-24'] >= 4) {
      await run(
        { type: 'internal', sourceLocation: loc.Stock._id, destLocation: loc['Rack A']._id, lines: [line('MON-24', 2)], notes: 'Weekly rack replenishment' },
        { user: staff(), date: at(d, 15) }
      );
      await run(
        { type: 'internal', sourceLocation: loc['Rack A']._id, destLocation: loc.Stock._id, lines: [line('MON-24', 2)], notes: 'Back to main stock' },
        { user: staff(), date: at(d, 17) }
      );
    }
  }

  /* ---------- The brief's example (days -6 .. -5) ---------- */
  await run({ type: 'receipt', partner: 'Tata Steel', destLocation: loc.Stock._id, lines: [line('STEEL-KG', 100)] }, { user: sam, date: at(-6, 9) });
  await run(
    { type: 'internal', sourceLocation: loc.Stock._id, destLocation: loc['Production Floor']._id, lines: [line('STEEL-KG', 100)], notes: 'Steel for frame production' },
    { user: sam, date: at(-6, 11) }
  );
  await run({ type: 'delivery', partner: 'Acme Builders', sourceLocation: loc['Production Floor']._id, lines: [line('STEEL-KG', 20)] }, { user: priya, date: at(-5, 12) });
  const damaged = await stock.createOperation(
    { type: 'adjustment', location: loc['Production Floor']._id, lines: [{ product: p['STEEL-KG']._id, quantity: 77, reason: 'damaged' }], notes: '3 kg damaged during cutting', scheduledDate: at(-5, 16) },
    sam
  );
  await stock.confirmOperation(damaged._id, sam);
  await backdate(await stock.validateOperation(damaged._id, maya), at(-5, 17), { created: at(-5, 16) });

  // A cycle count that found extra stock
  const found = await stock.createOperation(
    { type: 'adjustment', location: home.WH2._id, lines: [{ product: p['PALLET-W']._id, quantity: (onHand['PALLET-W'] || 0) + 2, reason: 'found' }], notes: 'Quarterly cycle count', scheduledDate: at(-3, 15) },
    priya
  );
  await stock.confirmOperation(found._id, priya);
  await backdate(await stock.validateOperation(found._id, maya), at(-3, 16));

  // Stock sitting on racks today (for the bin views and counts)
  await run({ type: 'internal', sourceLocation: loc.Stock._id, destLocation: loc['Rack A']._id, lines: [line('MON-24', 10)] }, { user: sam, date: at(-2, 10) });
  await run({ type: 'internal', sourceLocation: home.WH2._id, destLocation: loc.Stock._id, lines: [line('BOX-M', 60)], notes: 'Warehouse 2 -> Warehouse 1' }, { user: priya, date: at(-1, 14) });

  /* ---------- Open work for today ---------- */
  await run({ type: 'receipt', partner: 'Tata Steel', destLocation: loc.Stock._id, lines: [line('STEEL-ROD', 100)] }, { user: sam, finalStatus: 'ready', date: at(1, 10) });
  await run({ type: 'receipt', partner: 'PackRight Supplies', destLocation: home.WH2._id, lines: [line('TAPE-PK', 200), line('BOX-M', 300)] }, { user: sam, finalStatus: 'draft', date: at(2, 10) });
  await run({ type: 'delivery', partner: 'Acme Builders', sourceLocation: loc.Stock._id, lines: [line('CHAIR-OFF', 5)] }, { user: priya, finalStatus: 'ready', date: at(1, 11) });
  await run({ type: 'delivery', partner: 'Metro Mart', sourceLocation: loc.Stock._id, lines: [line('KBD-USB', 8), line('GLOVE-PR', 10)] }, { user: sam, finalStatus: 'picked', date: at(0, 12) });
  await run({ type: 'delivery', partner: 'Sunrise Traders', sourceLocation: loc.Stock._id, lines: [line('COPPER-WIRE', 150)] }, { user: priya, finalStatus: 'ready', date: at(-2, 15) });
  await run({ type: 'delivery', partner: 'BrightDesk Offices', sourceLocation: loc.Stock._id, lines: [line('DESK-WOOD', 20)] }, { user: sam, finalStatus: 'waiting', date: at(1, 9) });
  await run({ type: 'delivery', partner: 'Nova Retail', sourceLocation: loc.Stock._id, lines: [line('MON-24', 5)] }, { user: sam, finalStatus: 'draft', date: at(3, 10) });
  await run({ type: 'delivery', partner: 'Nova Retail', sourceLocation: loc.Stock._id, lines: [line('KBD-USB', 5)] }, { user: sam, finalStatus: 'canceled', date: at(-2, 10) });
  await run({ type: 'internal', sourceLocation: loc.Stock._id, destLocation: loc['Rack B']._id, lines: [line('CHAIR-OFF', 10)] }, { user: sam, finalStatus: 'ready', date: at(1, 14) });
  // Counts: a blind count set up by the manager, one submitted for approval
  const blind = await stock.createOperation(
    { type: 'adjustment', location: loc['Rack A']._id, lines: [{ product: p['MON-24']._id, quantity: 9, reason: 'count' }], blindCount: true, notes: 'Cycle count - Rack A (assigned to Priya)', scheduledDate: at(0, 9) },
    maya // only managers can make a count blind
  );
  await Operation.collection.updateOne({ _id: blind._id }, { $set: { createdAt: at(0, 9), updatedAt: at(0, 9) } });
  const submitted = await stock.createOperation(
    { type: 'adjustment', location: home.WH2._id, lines: [{ product: p['BOX-M']._id, quantity: Math.max(0, ((await StockQuant.findOne({ product: p['BOX-M']._id, location: home.WH2._id })) || { quantity: 6 }).quantity - 6), reason: 'damaged' }], notes: 'Water-damaged boxes found', scheduledDate: at(0, 8) },
    sam
  );
  await stock.confirmOperation(submitted._id, sam);

  /* ---------- Activity feed history + current alerts ---------- */
  const recentOps = await Operation.find({ status: { $in: ['done', 'ready', 'waiting', 'canceled'] } })
    .sort({ updatedAt: -1 })
    .limit(30)
    .populate('validatedBy createdBy', 'name')
    .lean();
  const actions = { done: 'validated', ready: 'confirmed', waiting: 'waiting', canceled: 'canceled' };
  await Activity.collection.insertMany(
    recentOps.map((op) => {
      const actor = op.validatedBy || op.createdBy;
      const action = actions[op.status];
      return {
        actor: actor ? actor._id : null,
        actorName: actor ? actor.name : 'System',
        action,
        subjectType: 'operation',
        subject: op._id,
        reference: op.reference,
        operationType: op.type,
        message: describe(action, op, actor ? actor.name : 'System'),
        createdAt: op.updatedAt,
        updatedAt: op.updatedAt,
      };
    })
  );

  const totalsNow = await stock.getOnHandTotals();
  const alerts = [];
  for (const [sku] of PRODUCTS) {
    const qty = totalsNow.get(p[sku]._id.toString()) || 0;
    if (qty <= p[sku].reorderLevel) {
      alerts.push({
        kind: qty <= 0 ? 'out_of_stock' : 'low_stock',
        product: p[sku]._id,
        reference: '',
        message: qty <= 0 ? `${p[sku].name} (${sku}) is out of stock` : `${p[sku].name} (${sku}) is low: ${qty} ${p[sku].uom} left (reorder level ${p[sku].reorderLevel})`,
        onHand: qty,
        reorderLevel: p[sku].reorderLevel,
        readBy: [],
        createdAt: at(-1, 18),
        updatedAt: at(-1, 18),
      });
    }
  }
  if (alerts.length) await Alert.collection.insertMany(alerts);

  /* ---------- Summary ---------- */
  const forecasts = await insights.forecastsFor(await Product.find().lean());
  console.log('\n[Seed] Stock today and 30-day outlook:');
  for (const [sku, name, , uom] of PRODUCTS) {
    const f = forecasts.get(p[sku]._id.toString());
    const out = f.stockoutDate ? `runs out in ${f.stockoutDay}d` : '';
    console.log(`  ${sku.padEnd(12)} ${name.padEnd(24)} ${String(f.onHand).padStart(6)} ${uom.padEnd(5)} ${f.status.padEnd(8)} ${out}`);
  }
  const byStatus = await Operation.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log(`\n[Seed] Operations: ${byStatus.map((s) => `${s.n} ${s._id}`).join(', ')}`);
  console.log(`[Seed] Ledger rows: ${await StockMove.countDocuments()} · activity: ${await Activity.countDocuments()} · alerts: ${await Alert.countDocuments()}`);
  console.log(`[Seed] Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`[Seed] Demo logins (password: ${DEMO_PASSWORD}):`);
  DEMO_USERS.forEach((u) => console.log(`  ${u.role.padEnd(8)} ${u.email}`));
};

seed()
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error(`[Seed] Failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
