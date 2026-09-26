/**
 * Phase 4 & 5 + signature features: Time Machine & forecast, replenishment,
 * low-stock alerts, Live Warehouse (activity + event stream + presence),
 * Scan & Pick, stock counts, move history, warehouses and the dashboard.
 * Runs the real app against a throwaway in-memory MongoDB replica set.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret-for-feature-tests';
const app = require('../app');
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
const moveQueries = require('../services/moveQueries');

const INVENTORY = [Warehouse, Location, Category, Product, StockQuant, StockMove, Operation, Counter, Alert, Activity];

let replSet;
let server;
let baseUrl;
const tokens = {};
const users = {};
let wh, wh2, stockLoc, rackLoc, wh2Stock, catA, catB;

const call = async (method, path, { as = 'manager', body, headers = {} } = {}) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    /* not JSON */
  }
  return { status: res.status, body: json, text };
};

const onHand = async (productId, location) => {
  const q = await StockQuant.findOne({ product: productId, location: location._id }).lean();
  return q ? q.quantity : 0;
};

const product = (fields = {}) =>
  Product.create({ name: 'Widget', sku: `W-${Math.random().toString(36).slice(2, 8)}`, uom: 'Units', ...fields });

// Validate a complete operation through the engine (deliveries: confirm -> pick -> pack)
const done = async (data, user = null) => {
  const op = await stock.createOperation(data, user);
  if (data.type === 'delivery') {
    await stock.confirmOperation(op._id, user);
    await stock.markDeliveryStep(op._id, 'pick', user);
    await stock.markDeliveryStep(op._id, 'pack', user);
  }
  return stock.validateOperation(op._id, user);
};
const backdateMoves = (op, daysAgo) =>
  StockMove.updateMany({ operation: op._id }, { date: insights.addDays(insights.startOfDay(), -daysAgo) });

const waitFor = async (fn, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
};

// Read the Server-Sent Events stream like a browser would
const openStream = async (as, view) => {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/live${view ? `?view=${encodeURIComponent(view)}` : ''}`, {
    headers: { Authorization: `Bearer ${tokens[as]}` },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  (async () => {
    try {
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value);
      }
    } catch (e) {
      /* aborted */
    }
  })();
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    until: (predicate, ms) => waitFor(() => predicate(buffer), ms),
    text: () => buffer,
    close: () => controller.abort(),
  };
};

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri('stocksense-feature-test'));
  await Promise.all([...INVENTORY, User].map((M) => M.init()));
  const created = await User.create([
    { name: 'Test Manager', email: 'manager@feature.test', password: 'manager-pass-1', role: 'manager' },
    { name: 'Test Staff', email: 'staff@feature.test', password: 'staff-pass-1', role: 'staff' },
  ]);
  users.manager = created[0];
  users.staff = created[1];
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [role, password] of [['manager', 'manager-pass-1'], ['staff', 'staff-pass-1']]) {
    const res = await call('POST', '/auth/login', { as: null, body: { email: `${role}@feature.test`, password } });
    tokens[role] = res.body.token;
  }
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Promise.all(INVENTORY.map((M) => M.deleteMany({})));
  wh = await Warehouse.create({ name: 'Main Warehouse', code: 'WH' });
  wh2 = await Warehouse.create({ name: 'Second Warehouse', code: 'WH2' });
  stockLoc = await Location.create({ name: 'Stock', warehouse: wh._id });
  rackLoc = await Location.create({ name: 'Rack A', warehouse: wh._id });
  wh2Stock = await Location.create({ name: 'Stock', warehouse: wh2._id });
  catA = await Category.create({ name: 'Cat A' });
  catB = await Category.create({ name: 'Cat B' });
});

/* ---------------------- Time Machine & forecast ---------------------- */

test('forecast math: run-rate, booked deliveries, incoming stock and ordering advice', () => {
  const { forecastProduct, startOfDay, addDays } = insights;
  const today = startOfDay();

  // 30 on hand, 3/day usage -> out on day 10; lead time 4 -> order by day 6
  let f = forecastProduct({ reorderLevel: 5, reorderQty: 0, leadTimeDays: 4 }, 30, 3, [], 30, today);
  assert.equal(f.stockoutDay, 10);
  assert.equal(f.daysOfCover, 10);
  assert.equal(f.status, 'soon');
  assert.equal(f.orderByDate.getTime(), addDays(today, 6).getTime());
  // target = 5 + 3 x (4 + 14) = 59, stock when an order would arrive = 30 - 12 = 18 -> order 41
  assert.equal(f.suggestedQty, 41);

  // Booked deliveries beat the run-rate: out on day 3, inside the 5-day lead time -> critical
  f = forecastProduct({ reorderLevel: 0, leadTimeDays: 5 }, 10, 1, [
    { date: addDays(today, 1), qty: -8 },
    { date: addDays(today, 3), qty: -5 },
  ], 30, today);
  assert.equal(f.stockoutDay, 3);
  assert.equal(f.status, 'critical');

  // An incoming receipt covers the month -> healthy, nothing to order
  f = forecastProduct({ reorderLevel: 0, leadTimeDays: 5 }, 10, 1, [{ date: addDays(today, 2), qty: 50 }], 30, today);
  assert.equal(f.stockoutDay, null);
  assert.equal(f.status, 'ok');
  assert.equal(f.suggestedQty, 0);

  // Overdue deliveries count as today
  f = forecastProduct({ reorderLevel: 0, leadTimeDays: 3 }, 5, 0, [{ date: addDays(today, -2), qty: -6 }], 30, today);
  assert.equal(f.stockoutDay, 0);

  // Out of stock with no usage history still gets an order suggestion
  f = forecastProduct({ reorderLevel: 0, reorderQty: 25, leadTimeDays: 3 }, 0, 0, [], 30, today);
  assert.equal(f.status, 'out');
  assert.equal(f.suggestedQty, 25);

  // Low, but enough already incoming -> never ordered twice
  f = forecastProduct({ reorderLevel: 10, reorderQty: 20, leadTimeDays: 3 }, 5, 0, [{ date: addDays(today, 1), qty: 30 }], 30, today);
  assert.equal(f.status, 'low');
  assert.equal(f.suggestedQty, 0);
});

test('time machine rebuilds past days exactly and matches live stock today', async () => {
  const a = await product({ name: 'Alpha', category: catA._id, unitCost: 10 });
  const b = await product({ name: 'Beta', category: catB._id });
  const r1 = await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: a._id, quantity: 50 }, { product: b._id, quantity: 8 }] });
  await backdateMoves(r1, 10);
  const t1 = await done({ type: 'internal', sourceLocation: stockLoc._id, destLocation: rackLoc._id, lines: [{ product: a._id, quantity: 15 }] });
  await backdateMoves(t1, 6);
  const d1 = await done({ type: 'delivery', sourceLocation: stockLoc._id, lines: [{ product: a._id, quantity: 20 }] });
  await backdateMoves(d1, 2);
  await done({ type: 'receipt', destLocation: wh2Stock._id, lines: [{ product: b._id, quantity: 4 }] }); // today

  const day = (n) => require('../utils/viewHelpers').toDateInput(insights.addDays(new Date(), -n));
  const byName = (res) => Object.fromEntries(res.rows.map((r) => [r.product.name, r]));

  // Today: identical to the live quantities
  const now = byName(await insights.stockAsOf({ date: day(0) }));
  assert.equal(now.Alpha.total, (await onHand(a, stockLoc)) + (await onHand(a, rackLoc)));
  assert.equal(now.Alpha.total, 30);
  assert.equal(now.Beta.total, 12);
  assert.equal(now.Alpha.delta, 0);

  // 3 days ago: before the delivery, after the transfer (35 in Stock, 15 on Rack A)
  const past = byName(await insights.stockAsOf({ date: day(3) }));
  assert.equal(past.Alpha.total, 50);
  assert.deepEqual(past.Alpha.locations.map((l) => [l.location, l.qty]), [['WH/Stock', 35], ['WH/Rack A', 15]]);
  assert.equal(past.Alpha.value, 500);
  assert.equal(past.Alpha.delta, -20);
  assert.equal(past.Beta.total, 8);

  // Before anything arrived / filters
  const before = byName(await insights.stockAsOf({ date: day(11) }));
  assert.equal(before.Alpha.total, 0);
  const wh2Only = byName(await insights.stockAsOf({ date: day(0), warehouse: String(wh2._id) }));
  assert.deepEqual(Object.keys(wh2Only), ['Beta']);
  assert.equal(wh2Only.Beta.total, 4);
  const catOnly = await insights.stockAsOf({ date: day(0), category: String(catA._id) });
  assert.deepEqual(catOnly.rows.map((r) => r.product.name), ['Alpha']);
});

test('product timeline: history walks back from on-hand, future is projected', async () => {
  const p = await product({ reorderLevel: 5, leadTimeDays: 2 });
  const r = await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: p._id, quantity: 50 }] });
  await backdateMoves(r, 10);
  const d = await done({ type: 'delivery', sourceLocation: stockLoc._id, lines: [{ product: p._id, quantity: 21 }] });
  await backdateMoves(d, 3);

  const t = await insights.productTimeline(p._id, { pastDays: 60, futureDays: 30 });
  assert.equal(t.todayIndex, 60);
  assert.equal(t.actual[60], 29); // today
  assert.equal(t.actual[57], 29); // day of the delivery (end of day)
  assert.equal(t.actual[56], 50); // the day before
  assert.equal(t.actual[50], 50); // receipt day
  assert.equal(t.actual[49], 0); // before the receipt
  assert.equal(t.projected[60], 29); // projection starts from today's stock
  assert.equal(t.forecast.avgDaily, 0.7); // 21 delivered / 30 days
  assert.equal(t.forecast.stockoutDay, 30 > 29 / 0.7 ? Math.ceil(29 / 0.7) : null);
  assert.equal(t.labels.length, 91);

  const api = await call('GET', `/api/products/${p._id}/timeline`, { as: 'staff' });
  assert.equal(api.status, 200);
  assert.equal(api.body.data.actual[60], 29);
});

test('replenishment: grouped by supplier, one click creates ready receipts', async () => {
  const a = await product({ name: 'A', preferredSupplier: 'Supplier X', reorderQty: 30, unitCost: 2 });
  const b = await product({ name: 'B', preferredSupplier: 'Supplier X', reorderQty: 10 });
  const c = await product({ name: 'C', preferredSupplier: 'Supplier Y', reorderQty: 5 });
  const healthy = await product({ name: 'Healthy', preferredSupplier: 'Supplier Y' });
  await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: healthy._id, quantity: 100 }] });

  const plan = await insights.replenishmentPlan();
  assert.deepEqual(plan.map((g) => [g.supplier, g.items.map((i) => i.product.name).sort()]), [
    ['Supplier X', ['A', 'B']],
    ['Supplier Y', ['C']],
  ]);
  assert.equal(plan[0].items.find((i) => i.product.name === 'A').suggestedQty, 30);
  assert.equal(plan[0].value, 60);

  const res = await call('POST', '/api/replenishment', {
    as: 'staff',
    body: {
      groups: plan.map((g) => ({
        supplier: g.supplier,
        destLocation: String(stockLoc._id),
        lines: g.items.map((i) => ({ product: String(i.product._id), quantity: i.suggestedQty })),
      })),
    },
  });
  assert.equal(res.status, 201, res.text);
  const receipts = await Operation.find({ type: 'receipt', status: 'ready' }).sort({ reference: 1 }).lean();
  assert.deepEqual(receipts.map((o) => [o.partner, o.lines.length]), [['Supplier X', 2], ['Supplier Y', 1]]);
  assert.ok(receipts.every((o) => o.notes.includes('Replenishment')));
  const expected = insights.addDays(insights.startOfDay(), 7).getTime(); // default lead time
  assert.ok(receipts.every((o) => new Date(o.scheduledDate).getTime() === expected));

  // Once ordered, the products no longer need ordering
  assert.deepEqual(await insights.replenishmentPlan(), []);
  assert.equal((await call('POST', '/api/replenishment', { body: { groups: [] } })).status, 400);
  void c;
});

/* ----------------------------- Alerts -------------------------------- */

test('low-stock alerts: raised when crossing a threshold, read per user', async () => {
  const p = await product({ name: 'Gauge', reorderLevel: 10 });
  await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: p._id, quantity: 15 }] });

  const ship = async (qty) => {
    const { body } = await call('POST', '/api/operations', {
      body: { type: 'delivery', partner: 'C', sourceLocation: String(stockLoc._id), lines: [{ product: String(p._id), quantity: qty }] },
    });
    const id = body.data.operation._id;
    for (const step of ['confirm', 'pick', 'pack', 'validate']) {
      assert.equal((await call('POST', `/api/operations/${id}/${step}`)).status, 200);
    }
  };

  await ship(7); // 15 -> 8: crosses the reorder level
  assert.ok(await waitFor(async () => (await Alert.countDocuments({ kind: 'low_stock' })) === 1));
  await ship(3); // 8 -> 5: already low, no new alert
  await ship(5); // 5 -> 0: out of stock
  assert.ok(await waitFor(async () => (await Alert.countDocuments({ kind: 'out_of_stock' })) === 1));
  assert.equal(await Alert.countDocuments(), 2);

  const mine = await call('GET', '/api/alerts', { as: 'manager' });
  assert.equal(mine.body.data.unread, 2);
  assert.match(mine.body.data.alerts[0].message, /Gauge .* is out of stock/);
  assert.equal((await call('POST', '/api/alerts/read-all', { as: 'manager' })).status, 200);
  assert.equal((await call('GET', '/api/alerts', { as: 'manager' })).body.data.unread, 0);
  assert.equal((await call('GET', '/api/nav-counts', { as: 'staff' })).body.data.counts.unreadAlerts, 2);
});

/* -------------------------- Live Warehouse --------------------------- */

test('live warehouse: actions are recorded, streamed to screens, presence is shared', async () => {
  const p = await product({ name: 'Live Item' });
  const { body } = await call('POST', '/api/operations', {
    as: 'staff',
    body: { type: 'receipt', partner: 'Vendor', destLocation: String(stockLoc._id), lines: [{ product: String(p._id), quantity: 3 }] },
  });
  const op = body.data.operation;

  const watcher = await openStream('manager', `operation:${op._id}`);
  try {
    assert.equal(watcher.status, 200);
    assert.match(watcher.contentType, /text\/event-stream/);
    assert.ok(await watcher.until((t) => t.includes('event: hello')));

    // Someone else opens the same operation -> both see each other
    const other = await openStream('staff', `operation:${op._id}`);
    try {
      assert.ok(await watcher.until((t) => t.includes('Test Staff') && t.includes('event: presence')));
    } finally {
      other.close();
    }

    // Staff confirms -> the manager's screen receives it instantly
    assert.equal((await call('POST', `/api/operations/${op._id}/confirm`, { as: 'staff' })).status, 200);
    assert.ok(await watcher.until((t) => t.includes('event: operation') && t.includes(`Test Staff marked ready receipt ${op.reference}`)));
  } finally {
    watcher.close();
  }

  const activity = await Activity.find({ reference: op.reference }).sort({ createdAt: 1 }).lean();
  assert.deepEqual(activity.map((a) => a.action), ['created', 'confirmed']);
  assert.equal(activity[1].actorName, 'Test Staff');
  assert.equal((await call('GET', '/api/live', { as: null })).status, 401);
});

/* ---------------------------- Scan & Pick ---------------------------- */

test('scan & pick: right items count up, wrong item / bin and over-picks refused, auto-pick', async () => {
  const a = await product({ name: 'Apple Box', sku: 'APL-1' });
  const b = await product({ name: 'Berry Box', sku: 'BRY-1' });
  const other = await product({ name: 'Other', sku: 'OTH-1' });
  await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: a._id, quantity: 10 }, { product: b._id, quantity: 10 }] });

  const { body } = await call('POST', '/api/operations', {
    body: { type: 'delivery', partner: 'C', sourceLocation: String(stockLoc._id), lines: [{ product: String(a._id), quantity: 2 }, { product: String(b._id), quantity: 1 }] },
  });
  const id = body.data.operation._id;
  const scan = (code, extra = {}) => call('POST', `/api/operations/${id}/scan`, { as: 'staff', body: { code, ...extra } });

  assert.equal((await scan('APL-1')).status, 409); // draft: not ready to pick yet
  await call('POST', `/api/operations/${id}/confirm`);

  const bin = await scan('wh/stock');
  assert.equal(bin.status, 200);
  assert.equal(bin.body.data.kind, 'location');
  const wrongBin = await scan('WH/Rack A');
  assert.equal(wrongBin.status, 422);
  assert.match(wrongBin.body.message, /Wrong location/);

  const first = await scan('APL-1');
  assert.equal(first.status, 200);
  assert.match(first.body.message, /Apple Box: 1\/2/);
  assert.equal((await scan('bry-1')).status, 200); // case-insensitive
  const wrong = await scan('OTH-1');
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.details.code, 'WRONG_ITEM');
  assert.equal((await scan('NOPE-404')).status, 404);

  const last = await scan('APL-1');
  assert.equal(last.body.data.complete, true);
  assert.equal(last.body.data.autoPicked, true);
  const op = await Operation.findById(id).populate('pickedBy', 'name');
  assert.ok(op.pickedAt);
  assert.equal(op.pickedBy.name, 'Test Staff');
  const over = await scan('APL-1');
  assert.equal(over.status, 409);
  assert.equal(over.body.details.code, 'OVER_SCAN');

  // Pack + validate as normal; back to draft clears scan progress on another order
  assert.equal((await call('POST', `/api/operations/${id}/pack`)).status, 200);
  assert.equal((await call('POST', `/api/operations/${id}/validate`)).status, 200);
  assert.equal(await onHand(a, stockLoc), 8);

  const again = await call('POST', '/api/operations', {
    body: { type: 'delivery', partner: 'C', sourceLocation: String(stockLoc._id), lines: [{ product: String(b._id), quantity: 2 }] },
  });
  const againId = again.body.data.operation._id;
  await call('POST', `/api/operations/${againId}/confirm`);
  await call('POST', `/api/operations/${againId}/scan`, { body: { code: 'BRY-1' } });
  await call('POST', `/api/operations/${againId}/reset`);
  assert.equal((await Operation.findById(againId)).lines[0].scannedQty, 0);
  void other;
});

test('scan to count: scanning adds to counted quantities, including unexpected items', async () => {
  const a = await product({ name: 'Counted', sku: 'CNT-1' });
  const surprise = await product({ name: 'Surprise', sku: 'SUR-1' });
  const { body } = await call('POST', '/api/operations', {
    as: 'manager',
    body: { type: 'adjustment', location: String(rackLoc._id), blindCount: true, lines: [{ product: String(a._id), quantity: 0 }] },
  });
  const id = body.data.operation._id;
  assert.equal(body.data.operation.blindCount, true);
  const tooBig = await call('POST', `/api/operations/${id}/scan`, { as: 'staff', body: { code: 'CNT-1', quantity: 1e400 } });
  assert.equal(tooBig.status, 400); // Infinity is refused

  for (const code of ['CNT-1', 'CNT-1', 'SUR-1']) {
    assert.equal((await call('POST', `/api/operations/${id}/scan`, { as: 'staff', body: { code } })).status, 200);
  }
  await call('POST', `/api/operations/${id}/scan`, { as: 'staff', body: { code: 'CNT-1', quantity: 2.5 } });
  const op = await Operation.findById(id).lean();
  assert.deepEqual(op.lines.map((l) => [String(l.product), l.quantity, l.reason]), [
    [String(a._id), 4.5, 'count'],
    [String(surprise._id), 1, 'count'],
  ]);

  await call('POST', `/api/operations/${id}/confirm`, { as: 'staff' });
  assert.equal((await call('POST', `/api/operations/${id}/scan`, { as: 'staff', body: { code: 'CNT-1' } })).status, 409);
  assert.equal((await call('POST', `/api/operations/${id}/validate`, { as: 'manager' })).status, 200);
  assert.equal(await onHand(a, rackLoc), 4.5);
  assert.equal(await onHand(surprise, rackLoc), 1);
});

/* ---------------------------- Stock counts --------------------------- */

test('stock counts: reasons are stored, differences applied, bad reasons refused', async () => {
  const p = await product({ name: 'Crate', unitCost: 100 });
  await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: p._id, quantity: 10 }] });
  const bad = await call('POST', '/api/operations', {
    body: { type: 'adjustment', location: String(stockLoc._id), lines: [{ product: String(p._id), quantity: 7, reason: 'stolen?' }] },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /Reason must be one of/);

  const { body } = await call('POST', '/api/operations', {
    as: 'staff',
    body: { type: 'adjustment', location: String(stockLoc._id), lines: [{ product: String(p._id), quantity: 7, reason: 'damaged' }] },
  });
  const id = body.data.operation._id;
  await call('POST', `/api/operations/${id}/confirm`, { as: 'staff' });

  // The manager's approval screen shows recorded vs counted before applying
  const detail = await call('GET', `/api/operations/${id}`);
  assert.equal(detail.body.data.operation.lines[0].recorded, 10);
  assert.equal((await call('POST', `/api/operations/${id}/validate`, { as: 'staff' })).status, 403);
  assert.equal((await call('POST', `/api/operations/${id}/validate`, { as: 'manager' })).status, 200);
  const applied = await Operation.findById(id).lean();
  assert.equal(applied.lines[0].reason, 'damaged');
  assert.equal(applied.lines[0].theoreticalQty, 10);
  assert.equal(await onHand(p, stockLoc), 7);
});

/* ---------------------------- Move history --------------------------- */

test('move history: exact running balances and spreadsheet-safe CSV', async () => {
  const p = await product({ name: '=HYPERLINK("http://evil")', sku: 'CSV-1', unitCost: 5 });
  const r = await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: p._id, quantity: 10 }] });
  const d = await done({ type: 'delivery', sourceLocation: stockLoc._id, lines: [{ product: p._id, quantity: 3 }] });
  const t = await done({ type: 'internal', sourceLocation: stockLoc._id, destLocation: rackLoc._id, lines: [{ product: p._id, quantity: 2 }] });

  const all = await moveQueries.listMoves({ product: String(p._id) });
  const moveOf = async (op) => String((await StockMove.findOne({ operation: op._id }))._id);
  assert.equal(all.total, 3);
  assert.equal(all.balances.get(await moveOf(r)), 10);
  assert.equal(all.balances.get(await moveOf(d)), 7);
  assert.equal(all.balances.get(await moveOf(t)), 7); // internal move: total unchanged

  const rack = await moveQueries.listMoves({ product: String(p._id), location: String(rackLoc._id) });
  assert.equal(rack.total, 1);
  assert.equal(rack.balances.get(await moveOf(t)), 2);

  const deliveriesOnly = await moveQueries.listMoves({ type: 'delivery' });
  assert.equal(deliveriesOnly.total, 1);

  const csv = await call('GET', `/moves/export.csv?product=${p._id}`);
  assert.equal(csv.status, 200);
  assert.ok(csv.text.includes(`"'=HYPERLINK(""http://evil"")"`)); // quoted and neutralised
  assert.equal(csv.text.trim().split('\r\n').length, 4);
});

/* ---------------------------- Warehouses ----------------------------- */

test('warehouses & locations: default Stock bin, fixed code, rename, safe archiving', async () => {
  const created = await call('POST', '/api/warehouses', { body: { name: 'North Depot', code: 'nd', address: 'Hill Rd' } });
  assert.equal(created.status, 201);
  const w = created.body.data.warehouse;
  assert.equal(w.code, 'ND');
  assert.ok(await Location.exists({ warehouse: w._id, fullName: 'ND/Stock' }));
  assert.equal((await call('POST', '/api/warehouses', { as: 'staff', body: { name: 'X', code: 'X' } })).status, 403);

  const renamed = await call('PATCH', `/api/warehouses/${w._id}`, { body: { name: 'North Depot 2', code: 'ZZ' } });
  assert.equal(renamed.body.data.warehouse.code, 'ND'); // code is part of every reference: fixed

  const bay = await call('POST', '/api/locations', { body: { warehouse: w._id, name: 'Bay 1' } });
  assert.equal(bay.body.data.location.fullName, 'ND/Bay 1');
  const bayId = bay.body.data.location._id;
  assert.equal((await call('PATCH', `/api/locations/${bayId}`, { body: { name: 'Bay 9' } })).body.data.location.fullName, 'ND/Bay 9');

  // Archiving: refused while stocked or used by open operations
  const p = await product();
  await done({ type: 'receipt', destLocation: bayId, lines: [{ product: p._id, quantity: 1 }] });
  assert.equal((await call('POST', `/api/locations/${bayId}/archive`)).status, 409);
  await done({ type: 'delivery', sourceLocation: bayId, lines: [{ product: p._id, quantity: 1 }] });
  await call('POST', '/api/operations', { body: { type: 'receipt', partner: 'V', destLocation: bayId, lines: [{ product: String(p._id), quantity: 1 }] } });
  assert.match((await call('POST', `/api/locations/${bayId}/archive`)).body.message, /open operation/);
  await Operation.updateMany({ destLocation: bayId, status: 'draft' }, { status: 'canceled' });
  assert.equal((await call('POST', `/api/locations/${bayId}/archive`)).status, 200);

  // Scanning a bin label opens the bin
  const resolved = await call('GET', `/api/scan/resolve?code=${encodeURIComponent('nd/bay 9')}`, { as: 'staff' });
  assert.equal(resolved.body.data.kind, 'location');
  assert.equal(resolved.body.data.url, `/locations/${bayId}`);
  assert.equal((await call('GET', '/api/scan/resolve?code=nothing-here')).status, 404);
});

/* ----------------------------- Dashboard ----------------------------- */

test('dashboard: brief KPIs follow warehouse, category and status filters', async () => {
  const inA = await product({ name: 'In A', category: catA._id, reorderLevel: 5, unitCost: 10 });
  const lowB = await product({ name: 'Low B', category: catB._id, reorderLevel: 5 });
  await product({ name: 'Empty A', category: catA._id });
  await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: inA._id, quantity: 20 }] });
  await done({ type: 'receipt', destLocation: wh2Stock._id, lines: [{ product: lowB._id, quantity: 3 }] });

  // Pending work: a ready receipt (WH), a ready delivery to pick (WH), a draft transfer
  const receipt = await stock.createOperation({ type: 'receipt', partner: 'V', destLocation: stockLoc._id, lines: [{ product: inA._id, quantity: 5 }] });
  await stock.confirmOperation(receipt._id);
  const delivery = await stock.createOperation({ type: 'delivery', partner: 'C', sourceLocation: stockLoc._id, lines: [{ product: inA._id, quantity: 2 }] });
  await stock.confirmOperation(delivery._id);
  await stock.createOperation({ type: 'internal', sourceLocation: stockLoc._id, destLocation: rackLoc._id, lines: [{ product: inA._id, quantity: 1 }] });

  const all = (await call('GET', '/api/dashboard', { as: 'staff' })).body.data;
  assert.deepEqual(
    { inStock: all.stock.inStock, low: all.stock.low, out: all.stock.out, value: all.stock.value },
    { inStock: 2, low: 1, out: 1, value: 200 }
  );
  assert.deepEqual({ r: all.ops.receipts, d: all.ops.deliveries, t: all.ops.transfers }, { r: 1, d: 1, t: 1 });
  assert.equal(all.board.toPick.count, 1);
  assert.equal(all.board.toReceive.count, 1);

  const onlyWh2 = (await call('GET', `/api/dashboard?warehouse=${wh2._id}`)).body.data;
  assert.deepEqual({ inStock: onlyWh2.stock.inStock, low: onlyWh2.stock.low }, { inStock: 1, low: 1 });
  assert.equal(onlyWh2.ops.receipts, 0);

  const onlyCatB = (await call('GET', `/api/dashboard?category=${catB._id}`)).body.data;
  assert.equal(onlyCatB.stock.products, 1);
  assert.equal(onlyCatB.ops.deliveries, 0);

  const readyOnly = (await call('GET', '/api/dashboard?status=ready&type=delivery')).body.data;
  assert.equal(readyOnly.ops.transfers, 0);
  assert.deepEqual(readyOnly.operations.map((o) => o.type), ['delivery']);

  const junk = (await call('GET', '/api/dashboard?status=%24ne&type=constructor&warehouse=nope')).body.data;
  assert.deepEqual(junk.filters, { type: '', status: '', warehouse: '', category: '' });
});

/* ------------------------ Review hardening ------------------------- */

test('blind counts are enforced on the server, not just hidden in the page', async () => {
  const p = await product({ name: 'Secret Stock' });
  await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: p._id, quantity: 12 }] });

  // Staff cannot create a blind count (only a manager can impose one)...
  const own = await call('POST', '/api/operations', { as: 'staff', body: { type: 'adjustment', location: String(stockLoc._id), blindCount: true, lines: [{ product: String(p._id), quantity: 1 }] } });
  assert.equal(own.body.data.operation.blindCount, false);

  // ...nor lift one a manager set up
  const { body } = await call('POST', '/api/operations', { as: 'manager', body: { type: 'adjustment', location: String(stockLoc._id), blindCount: true, lines: [{ product: String(p._id), quantity: 0 }] } });
  const id = body.data.operation._id;
  const lifted = await call('PATCH', `/api/operations/${id}`, { as: 'staff', body: { blindCount: false, lines: [{ product: String(p._id), quantity: 11 }] } });
  assert.equal(lifted.status, 200);
  assert.equal(lifted.body.data.operation.blindCount, true);

  // Recorded quantities are withheld from staff, shown to managers
  const forStaff = await call('GET', `/api/operations/${id}`, { as: 'staff' });
  assert.equal(forStaff.body.data.operation.lines[0].recorded, undefined);
  const forManager = await call('GET', `/api/operations/${id}`, { as: 'manager' });
  assert.equal(forManager.body.data.operation.lines[0].recorded, 12);
});

test('replenishment is all-or-nothing when something changed since the page loaded', async () => {
  const a = await product({ name: 'Keep', preferredSupplier: 'S1', reorderQty: 5 });
  const gone = await product({ name: 'Gone', preferredSupplier: 'S2', reorderQty: 5 });
  await Product.updateOne({ _id: gone._id }, { isActive: false }); // archived by someone meanwhile
  const res = await call('POST', '/api/replenishment', {
    body: {
      groups: [
        { supplier: 'S1', destLocation: String(stockLoc._id), lines: [{ product: String(a._id), quantity: 5 }] },
        { supplier: 'S2', destLocation: String(stockLoc._id), lines: [{ product: String(gone._id), quantity: 5 }] },
      ],
    },
  });
  assert.equal(res.status, 409);
  assert.equal(await Operation.countDocuments({ type: 'receipt' }), 0); // nothing half-created
});

test('time machine keeps archived products that held stock on that date', async () => {
  const p = await product({ name: 'Retired' });
  const r = await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: p._id, quantity: 6 }] });
  await backdateMoves(r, 10);
  const d = await done({ type: 'delivery', sourceLocation: stockLoc._id, lines: [{ product: p._id, quantity: 6 }] });
  await backdateMoves(d, 2);
  await call('POST', `/api/products/${p._id}/archive`);

  const day = require('../utils/viewHelpers').toDateInput(insights.addDays(new Date(), -5));
  const past = await insights.stockAsOf({ date: day });
  assert.deepEqual(past.rows.map((row) => [row.product.name, row.total]), [['Retired', 6]]);
});

test('dashboard "in stock" count matches the list it links to', async () => {
  const ok = await product({ name: 'Plenty', reorderLevel: 1 });
  const low = await product({ name: 'Low', reorderLevel: 10 });
  await product({ name: 'None' });
  await done({ type: 'receipt', destLocation: stockLoc._id, lines: [{ product: ok._id, quantity: 50 }, { product: low._id, quantity: 2 }] });
  const dash = (await call('GET', '/api/dashboard')).body.data;
  const list = (await call('GET', '/api/products?status=instock')).body.data;
  assert.equal(dash.stock.inStock, 2);
  assert.equal(list.pagination.total, dash.stock.inStock);
});

test('live warehouse: "who is online" is pushed when people join and leave', async () => {
  const first = await openStream('manager');
  try {
    const second = await openStream('staff');
    try {
      assert.ok(await first.until((t) => /event: online\ndata: \{"users":\[[^\]]*Test Staff/.test(t), 4000));
    } finally {
      second.close();
    }
  } finally {
    first.close();
  }
});
