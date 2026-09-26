/**
 * HTTP-level tests for the products / categories / operations API and pages.
 * Runs the real Express app against a throwaway in-memory MongoDB replica set.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret-for-api-tests';
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

const INVENTORY = [Warehouse, Location, Category, Product, StockQuant, StockMove, Operation, Counter];

let replSet;
let server;
let baseUrl;
const tokens = {};
let stockLoc, rackLoc, category;

/** Call the app. `as` = 'manager' | 'staff' | null (anonymous) */
const call = async (method, path, { as = 'manager', body, headers = {} } = {}) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    /* HTML page */
  }
  return { status: res.status, body: json, text, headers: res.headers };
};

const onHand = async (productId, location) => {
  const quant = await StockQuant.findOne({ product: productId, location: location._id }).lean();
  return quant ? quant.quantity : 0;
};

const newProduct = async (overrides = {}) => {
  const res = await call('POST', '/api/products', {
    body: { name: 'Widget', sku: `W-${Math.random().toString(36).slice(2, 8)}`, uom: 'Units', ...overrides },
  });
  assert.equal(res.status, 201, res.text);
  return res.body.data.product;
};

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri('stocksense-api-test'));
  await Promise.all([...INVENTORY, User].map((M) => M.init()));

  await User.create([
    { name: 'Test Manager', email: 'manager@api.test', password: 'manager-pass-1', role: 'manager' },
    { name: 'Test Staff', email: 'staff@api.test', password: 'staff-pass-1', role: 'staff' },
  ]);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const [role, password] of [['manager', 'manager-pass-1'], ['staff', 'staff-pass-1']]) {
    const res = await call('POST', '/auth/login', { as: null, body: { email: `${role}@api.test`, password } });
    assert.equal(res.status, 200, res.text);
    tokens[role] = res.body.token;
  }
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Promise.all(INVENTORY.map((M) => M.deleteMany({})));
  const wh = await Warehouse.create({ name: 'Main Warehouse', code: 'WH', address: '1 Test Road' });
  stockLoc = await Location.create({ name: 'Stock', warehouse: wh._id });
  rackLoc = await Location.create({ name: 'Rack A', warehouse: wh._id });
  category = await Category.create({ name: 'Raw Materials' });
});

/* ------------------------------ Access ------------------------------ */

test('API requires login and always answers JSON (never a redirect)', async () => {
  const res = await call('GET', '/api/products', { as: null, headers: { Accept: 'text/html' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test('staff can read but cannot manage products or categories', async () => {
  assert.equal((await call('GET', '/api/products', { as: 'staff' })).status, 200);
  assert.equal((await call('POST', '/api/products', { as: 'staff', body: { name: 'X', sku: 'X1' } })).status, 403);
  assert.equal((await call('POST', '/api/categories', { as: 'staff', body: { name: 'Nope' } })).status, 403);
  assert.equal((await call('DELETE', `/api/categories/${category._id}`, { as: 'staff' })).status, 403);

  // Manager-only pages render an HTML 403 page for staff
  const page = await call('GET', '/products/new', { as: 'staff', headers: { Accept: 'text/html' } });
  assert.equal(page.status, 403);
  assert.match(page.text, /Access Denied/);
});

/* ----------------------------- Products ----------------------------- */

test('products: create with initial stock, uppercase SKU, duplicate SKU refused', async () => {
  const res = await call('POST', '/api/products', {
    body: {
      name: 'Steel Rods', sku: 'steel-rod', category: String(category._id), uom: 'Units',
      reorderLevel: '20', reorderQty: '100', initialQty: '50', initialLocation: String(stockLoc._id),
    },
  });
  assert.equal(res.status, 201, res.text);
  const product = res.body.data.product;
  assert.equal(product.sku, 'STEEL-ROD');
  assert.equal(await onHand(product._id, stockLoc), 50);

  // Initial stock is a validated adjustment in the ledger
  const move = await StockMove.findOne({ product: product._id }).lean();
  assert.equal(move.operationType, 'adjustment');
  assert.equal(move.quantity, 50);

  const dup = await call('POST', '/api/products', { body: { name: 'Other', sku: 'STEEL-ROD' } });
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /already exists/);

  const detail = await call('GET', `/api/products/${product._id}`);
  assert.equal(detail.body.data.onHand, 50);
  assert.equal(detail.body.data.stockStatus, 'ok');
  assert.equal(detail.body.data.locations[0].location.fullName, 'WH/Stock');
});

test('products: input is whitelisted and validated', async () => {
  const res = await call('POST', '/api/products', {
    body: { name: 'Sneaky', sku: 'SNK-1', isActive: false, _id: '000000000000000000000000', reorderLevel: -5 },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Reorder level/);

  const ok = await call('POST', '/api/products', { body: { name: 'Sneaky', sku: 'SNK-1', isActive: false, _id: '000000000000000000000000' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.product.isActive, true);
  assert.notEqual(ok.body.data.product._id, '000000000000000000000000');

  const badUom = await call('PATCH', `/api/products/${ok.body.data.product._id}`, { body: { uom: 'parsecs' } });
  assert.equal(badUom.status, 400);
});

test('products: unit of measure locked after stock moved; list filters by stock status', async () => {
  const low = await newProduct({ name: 'Low One', reorderLevel: 10, initialQty: 3, initialLocation: String(stockLoc._id) });
  await newProduct({ name: 'Empty One' });
  await newProduct({ name: 'Plenty One', reorderLevel: 1, initialQty: 30, initialLocation: String(stockLoc._id) });

  const lock = await call('PATCH', `/api/products/${low._id}`, { body: { uom: 'kg' } });
  assert.equal(lock.status, 409);
  assert.match(lock.body.message, /unit of measure cannot change/);

  const attention = await call('GET', '/api/products?status=attention');
  assert.deepEqual(attention.body.data.products.map((p) => p.name).sort(), ['Empty One', 'Low One']);
  assert.deepEqual(
    { ok: attention.body.data.counts.ok, low: attention.body.data.counts.low, out: attention.body.data.counts.out },
    { ok: 1, low: 1, out: 1 }
  );
  const search = await call('GET', '/api/products?search=plenty');
  assert.deepEqual(search.body.data.products.map((p) => p.name), ['Plenty One']);
});

test('products: archive needs zero stock and no open operations; archived cannot be used', async () => {
  const stocked = await newProduct({ initialQty: 5, initialLocation: String(stockLoc._id) });
  const blockedByStock = await call('POST', `/api/products/${stocked._id}/archive`);
  assert.equal(blockedByStock.status, 409);
  assert.match(blockedByStock.body.message, /still has 5/);

  const planned = await newProduct();
  await call('POST', '/api/operations', {
    body: { type: 'receipt', partner: 'V', destLocation: String(stockLoc._id), lines: [{ product: planned._id, quantity: 1 }] },
  });
  const blockedByOp = await call('POST', `/api/products/${planned._id}/archive`);
  assert.equal(blockedByOp.status, 409);
  assert.match(blockedByOp.body.message, /open operation/);

  const idle = await newProduct();
  assert.equal((await call('POST', `/api/products/${idle._id}/archive`)).status, 200);
  const useArchived = await call('POST', '/api/operations', {
    body: { type: 'receipt', partner: 'V', destLocation: String(stockLoc._id), lines: [{ product: idle._id, quantity: 1 }] },
  });
  assert.equal(useArchived.status, 400);
  assert.match(useArchived.body.message, /archived/);
  assert.equal((await call('POST', `/api/products/${idle._id}/restore`)).status, 200);
});

/* ---------------------------- Categories ---------------------------- */

test('categories: create, rename, refuse duplicates and deleting non-empty ones', async () => {
  const created = await call('POST', '/api/categories', { body: { name: 'Packaging', description: 'Boxes' } });
  assert.equal(created.status, 201);
  assert.equal((await call('POST', '/api/categories', { body: { name: 'Packaging' } })).status, 409);

  const id = created.body.data.category._id;
  const renamed = await call('PATCH', `/api/categories/${id}`, { body: { name: 'Packing' } });
  assert.equal(renamed.body.data.category.name, 'Packing');

  await newProduct({ category: id });
  const refused = await call('DELETE', `/api/categories/${id}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /still has 1 product/);

  const empty = await call('POST', '/api/categories', { body: { name: 'Empty' } });
  assert.equal((await call('DELETE', `/api/categories/${empty.body.data.category._id}`)).status, 200);
});

/* ---------------------------- Operations ---------------------------- */

test('receipt flow by staff: create -> confirm (ready) -> validate -> stock up', async () => {
  const p = await newProduct();
  const created = await call('POST', '/api/operations', {
    as: 'staff',
    body: { type: 'receipt', partner: 'Tata Steel', destLocation: String(stockLoc._id), scheduledDate: '2026-09-30', lines: [{ product: p._id, quantity: '40' }] },
  });
  assert.equal(created.status, 201, created.text);
  const op = created.body.data.operation;
  assert.equal(op.reference, 'WH/IN/0001');
  assert.equal(new Date(op.scheduledDate).getDate(), 30);

  const confirmed = await call('POST', `/api/operations/${op._id}/confirm`, { as: 'staff' });
  assert.equal(confirmed.body.data.operation.status, 'ready');

  const list = await call('GET', '/api/operations?type=receipt&tab=todo', { as: 'staff' });
  assert.equal(list.body.data.tabCounts.ready, 1);
  assert.equal(list.body.data.operations[0].lines[0].product.name, 'Widget');

  const validated = await call('POST', `/api/operations/${op._id}/validate`, { as: 'staff' });
  assert.equal(validated.status, 200, validated.text);
  assert.equal(await onHand(p._id, stockLoc), 40);
  assert.equal((await call('POST', `/api/operations/${op._id}/validate`, { as: 'staff' })).status, 409);
});

test('delivery flow: pick before pack, then validate removes stock', async () => {
  const p = await newProduct({ initialQty: 30, initialLocation: String(stockLoc._id) });
  const { body } = await call('POST', '/api/operations', {
    body: { type: 'delivery', partner: 'Acme', sourceLocation: String(stockLoc._id), lines: [{ product: p._id, quantity: 10 }] },
  });
  const id = body.data.operation._id;

  assert.equal((await call('POST', `/api/operations/${id}/pick`)).status, 409); // draft: not ready yet
  await call('POST', `/api/operations/${id}/confirm`);
  const tooEarly = await call('POST', `/api/operations/${id}/validate`);
  assert.equal(tooEarly.status, 409);
  assert.match(tooEarly.body.message, /Pick and pack/);
  const packFirst = await call('POST', `/api/operations/${id}/pack`);
  assert.equal(packFirst.status, 409);
  assert.match(packFirst.body.message, /Pick the items/);

  assert.equal((await call('POST', `/api/operations/${id}/pick`, { as: 'staff' })).status, 200);
  assert.equal((await call('POST', `/api/operations/${id}/pick`, { as: 'staff' })).status, 409); // already picked
  assert.equal((await call('POST', `/api/operations/${id}/pack`, { as: 'staff' })).status, 200);

  const detail = await call('GET', `/api/operations/${id}`);
  assert.ok(detail.body.data.operation.pickedAt && detail.body.data.operation.packedAt);
  assert.equal(detail.body.data.operation.pickedBy.name, 'Test Staff');

  assert.equal((await call('POST', `/api/operations/${id}/validate`, { as: 'staff' })).status, 200);
  assert.equal(await onHand(p._id, stockLoc), 20);
  const afterDone = await call('POST', `/api/operations/${id}/pick`);
  assert.equal(afterDone.status, 409); // done deliveries cannot be picked
});

test('shortage: waiting with details, refused validation, reset + edit + confirm -> ready', async () => {
  const p = await newProduct({ initialQty: 12, initialLocation: String(stockLoc._id) });
  const { body } = await call('POST', '/api/operations', {
    body: { type: 'delivery', partner: 'BrightDesk', sourceLocation: String(stockLoc._id), lines: [{ product: p._id, quantity: 20 }] },
  });
  const id = body.data.operation._id;

  const confirmed = await call('POST', `/api/operations/${id}/confirm`);
  assert.equal(confirmed.body.data.operation.status, 'waiting');
  assert.equal(confirmed.body.data.shortages[0].available, 12);

  const detail = await call('GET', `/api/operations/${id}`);
  assert.equal(detail.body.data.operation.lines[0].available, 12);
  assert.equal(detail.body.data.shortages.length, 1);

  const refused = await call('POST', `/api/operations/${id}/validate`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /must be ready/);
  assert.equal(await onHand(p._id, stockLoc), 12);

  const transfer = await call('POST', '/api/operations', {
    body: { type: 'internal', sourceLocation: String(stockLoc._id), destLocation: String(rackLoc._id), lines: [{ product: p._id, quantity: 20 }] },
  });
  const short = await call('POST', `/api/operations/${transfer.body.data.operation._id}/validate`);
  assert.equal(short.status, 409);
  assert.equal(short.body.details.shortages[0].required, 20);
  assert.equal(short.body.details.shortages[0].available, 12);

  // Editing is only allowed in draft
  assert.equal((await call('PATCH', `/api/operations/${id}`, { body: { lines: [{ product: p._id, quantity: 10 }] } })).status, 409);
  assert.equal((await call('POST', `/api/operations/${id}/reset`)).body.data.operation.status, 'draft');
  const edited = await call('PATCH', `/api/operations/${id}`, {
    body: { status: 'done', type: 'receipt', lines: [{ product: p._id, quantity: 10 }] },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.operation.status, 'draft'); // status/type in the body are ignored
  assert.equal(edited.body.data.operation.type, 'delivery');
  assert.equal((await call('POST', `/api/operations/${id}/confirm`)).body.data.operation.status, 'ready');
});

test('transfer, duplicate and cancel', async () => {
  const p = await newProduct({ initialQty: 8, initialLocation: String(stockLoc._id) });
  const { body } = await call('POST', '/api/operations', {
    as: 'staff',
    body: { type: 'internal', sourceLocation: String(stockLoc._id), destLocation: String(rackLoc._id), lines: [{ product: p._id, quantity: 5 }] },
  });
  const id = body.data.operation._id;
  assert.equal((await call('POST', `/api/operations/${id}/validate`, { as: 'staff' })).status, 200);
  assert.equal(await onHand(p._id, stockLoc), 3);
  assert.equal(await onHand(p._id, rackLoc), 5);

  const copy = await call('POST', `/api/operations/${id}/duplicate`, { as: 'staff' });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.data.operation.reference, 'WH/INT/0002');
  assert.equal(copy.body.data.operation.status, 'draft');
  assert.equal(copy.body.data.operation.lines[0].quantity, 5);

  const canceled = await call('POST', `/api/operations/${copy.body.data.operation._id}/cancel`, { as: 'staff' });
  assert.equal(canceled.body.data.operation.status, 'canceled');
  assert.equal((await call('POST', `/api/operations/${copy.body.data.operation._id}/validate`)).status, 409);
});

test('only managers validate inventory adjustments', async () => {
  const p = await newProduct({ initialQty: 10, initialLocation: String(stockLoc._id) });
  const { body } = await call('POST', '/api/operations', {
    as: 'staff',
    body: { type: 'adjustment', location: String(stockLoc._id), lines: [{ product: p._id, quantity: 7 }] },
  });
  const id = body.data.operation._id;
  const refused = await call('POST', `/api/operations/${id}/validate`, { as: 'staff' });
  assert.equal(refused.status, 403);
  assert.equal(await onHand(p._id, stockLoc), 10);
  assert.equal((await call('POST', `/api/operations/${id}/validate`, { as: 'manager' })).status, 200);
  assert.equal(await onHand(p._id, stockLoc), 7);
});

test('availability endpoint and late filter', async () => {
  const p = await newProduct({ initialQty: 4, initialLocation: String(stockLoc._id) });
  const avail = await call('GET', `/api/stock/available?location=${stockLoc._id}&products=${p._id},not-an-id`);
  assert.deepEqual(avail.body.data.available, { [p._id]: 4 });
  assert.equal((await call('GET', '/api/stock/available?location=nope')).status, 400);

  await call('POST', '/api/operations', {
    body: { type: 'receipt', partner: 'Late Co', destLocation: String(stockLoc._id), scheduledDate: '2020-01-01', lines: [{ product: p._id, quantity: 1 }] },
  });
  await call('POST', '/api/operations', {
    body: { type: 'receipt', partner: 'Future Co', destLocation: String(stockLoc._id), scheduledDate: '2099-01-01', lines: [{ product: p._id, quantity: 1 }] },
  });
  const late = await call('GET', '/api/operations?type=receipt&late=1');
  assert.deepEqual(late.body.data.operations.map((o) => o.partner), ['Late Co']);
  assert.equal(late.body.data.lateCount, 1);
  const search = await call('GET', `/api/operations?type=receipt&search=${encodeURIComponent('future')}`);
  assert.deepEqual(search.body.data.operations.map((o) => o.partner), ['Future Co']);
});

/* ---------------------------- Hardening ----------------------------- */

test('API writes must be JSON: a plain form post cannot trigger actions', async () => {
  const p = await newProduct();
  const { body } = await call('POST', '/api/operations', {
    body: { type: 'receipt', partner: 'V', destLocation: String(stockLoc._id), lines: [{ product: p._id, quantity: 1 }] },
  });
  const id = body.data.operation._id;
  const res = await fetch(`${baseUrl}/api/operations/${id}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.manager}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  });
  assert.equal(res.status, 415);
  assert.equal((await Operation.findById(id)).status, 'draft');
  // The browser helper's header is also accepted
  const viaFetchHelper = await fetch(`${baseUrl}/api/operations/${id}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.manager}`, 'X-Requested-With': 'fetch' },
  });
  assert.equal(viaFetchHelper.status, 200);
});

test('odd query strings: inherited tab names and out-of-range pages', async () => {
  await newProduct();
  const html = { headers: { Accept: 'text/html' } };
  for (const tab of ['constructor', '__proto__', 'toString']) {
    const res = await call('GET', `/receipts?tab=${tab}`, html);
    assert.equal(res.status, 200, `tab=${tab}`);
  }
  assert.equal((await call('GET', '/api/operations?type=receipt&tab=constructor')).status, 200);

  const far = await call('GET', '/products?page=50&search=Widget', html);
  assert.equal(far.status, 302);
  assert.equal(far.headers.get('location'), '/products?search=Widget&page=1');
  assert.equal((await call('GET', '/products?page=1000000000000000000000', html)).status, 302);
  const api = await call('GET', '/api/products?page=1000000000000000000000');
  assert.equal(api.status, 200);
  assert.deepEqual(api.body.data.products, []);
});

test('product with initial stock is all-or-nothing', async () => {
  const stock = require('../services/stockService');
  const original = stock.validateOperation;
  stock.validateOperation = async () => {
    throw new Error('simulated failure while booking initial stock');
  };
  try {
    const res = await call('POST', '/api/products', {
      body: { name: 'Half Made', sku: 'HALF-1', initialQty: 5, initialLocation: String(stockLoc._id) },
    });
    assert.equal(res.status, 500);
  } finally {
    stock.validateOperation = original;
  }
  assert.equal(await Product.countDocuments({ sku: 'HALF-1' }), 0);
  assert.equal(await Operation.countDocuments({ type: 'adjustment' }), 0);
  // ...so retrying works instead of failing on a duplicate SKU
  const retry = await call('POST', '/api/products', {
    body: { name: 'Half Made', sku: 'HALF-1', initialQty: 5, initialLocation: String(stockLoc._id) },
  });
  assert.equal(retry.status, 201);
});

test('adjustments: not duplicated, not edited with the move form', async () => {
  const p = await newProduct({ initialQty: 3, initialLocation: String(stockLoc._id) });
  const initial = await Operation.findOne({ type: 'adjustment' }).lean();
  const dup = await call('POST', `/api/operations/${initial._id}/duplicate`);
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /cannot be duplicated/);

  const { body } = await call('POST', '/api/operations', {
    body: { type: 'adjustment', location: String(stockLoc._id), lines: [{ product: p._id, quantity: 2 }] },
  });
  const edit = await call('GET', `/operations/${body.data.operation._id}/edit`, { headers: { Accept: 'text/html' } });
  assert.equal(edit.status, 302);
  const page = await call('GET', `/operations/${body.data.operation._id}`, { headers: { Accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('href="/adjustments"'));
  assert.ok(!page.text.includes('data-op-action="duplicate"'));
});

/* ------------------------------- Pages ------------------------------ */

test('pages escape user data and show HTML errors', async () => {
  const evil = await newProduct({ name: '<script>alert(1)</script>', sku: 'EVIL-1', description: '<img src=x onerror=alert(2)>' });
  const html = { headers: { Accept: 'text/html' } };

  const list = await call('GET', '/products', html);
  assert.equal(list.status, 200);
  assert.ok(list.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!list.text.includes('<script>alert(1)</script>'));

  const detail = await call('GET', `/products/${evil._id}`, html);
  assert.ok(!detail.text.includes('<img src=x onerror'));

  // Product names embedded as JSON in the operation form cannot close the script tag
  const form = await call('GET', '/receipts/new', html);
  assert.equal(form.status, 200);
  assert.ok(!form.text.includes('<script>alert(1)</script>'));
  assert.ok(form.text.includes('\\u003cscript\\u003e'));

  const missing = await call('GET', '/products/000000000000000000000000', html);
  assert.equal(missing.status, 404);
  assert.match(missing.text, /Page Not Found|Product not found/);
  assert.equal((await call('GET', '/api/products/000000000000000000000000')).body.message, 'Product not found');
});
