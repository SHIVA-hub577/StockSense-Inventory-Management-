/**
 * Stock engine tests. Run with: npm test
 * Uses a throwaway in-memory MongoDB replica set (transactions need one).
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Warehouse = require('../models/Warehouse');
const Location = require('../models/Location');
const Category = require('../models/Category');
const Product = require('../models/Product');
const StockQuant = require('../models/StockQuant');
const StockMove = require('../models/StockMove');
const Operation = require('../models/Operation');
const Counter = require('../models/Counter');
const stock = require('../services/stockService');

const MODELS = [Warehouse, Location, Category, Product, StockQuant, StockMove, Operation, Counter];

let replSet;
let wh, mainStore, productionRack, steel, rods;

const onHand = async (product, location) => {
  const quant = await StockQuant.findOne({ product: product._id, location: location._id }).lean();
  return quant ? quant.quantity : 0;
};

// Deliveries follow confirm -> pick -> pack before they can be validated
const pickAndPack = async (id) => {
  await stock.confirmOperation(id);
  await stock.markDeliveryStep(id, 'pick');
  await stock.markDeliveryStep(id, 'pack');
};

// create + validate in one go
const done = async (data) => {
  const op = await stock.createOperation(data);
  if (data.type === 'delivery') {
    await pickAndPack(op._id);
  }
  return stock.validateOperation(op._id);
};

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri('stocksense-test'));
  await Promise.all(MODELS.map((M) => M.init()));
});

after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Promise.all(MODELS.map((M) => M.deleteMany({})));
  wh = await Warehouse.create({ name: 'Main Warehouse', code: 'WH' });
  mainStore = await Location.create({ name: 'Main Store', warehouse: wh._id });
  productionRack = await Location.create({ name: 'Production Rack', warehouse: wh._id });
  steel = await Product.create({ name: 'Steel', sku: 'STEEL-KG', uom: 'kg', reorderLevel: 50 });
  rods = await Product.create({ name: 'Steel Rods', sku: 'STEEL-ROD' });
});

test('brief example: receive 100, transfer, deliver 20, adjust -3 => 77 on hand, 4 ledger rows', async () => {
  // Step 1: receive 100 kg steel from vendor
  const receipt = await done({
    type: 'receipt', partner: 'Tata Steel', destLocation: mainStore._id,
    lines: [{ product: steel._id, quantity: 100 }],
  });
  assert.equal(receipt.status, 'done');
  assert.equal(await onHand(steel, mainStore), 100);

  // Step 2: move to production rack (total unchanged, location updated)
  await done({
    type: 'internal', sourceLocation: mainStore._id, destLocation: productionRack._id,
    lines: [{ product: steel._id, quantity: 100 }],
  });
  assert.equal(await onHand(steel, mainStore), 0);
  assert.equal(await onHand(steel, productionRack), 100);
  assert.equal((await stock.getOnHandTotals()).get(steel._id.toString()), 100);

  // Step 3: deliver 20
  await done({
    type: 'delivery', partner: 'Acme', sourceLocation: productionRack._id,
    lines: [{ product: steel._id, quantity: 20 }],
  });
  assert.equal(await onHand(steel, productionRack), 80);

  // Step 4: 3 kg damaged -> physical count is 77
  const adjustment = await done({
    type: 'adjustment', location: productionRack._id,
    lines: [{ product: steel._id, quantity: 77 }],
  });
  assert.equal(adjustment.lines[0].theoreticalQty, 80);
  assert.equal(await onHand(steel, productionRack), 77);
  assert.equal((await stock.getOnHandTotals()).get(steel._id.toString()), 77);

  // Everything logged in the ledger
  const moves = await StockMove.find({ product: steel._id }).populate('fromLocation toLocation').sort({ createdAt: 1 }).lean();
  assert.deepEqual(
    moves.map((m) => [m.operationType, m.fromLocation.fullName, m.toLocation.fullName, m.quantity]),
    [
      ['receipt', 'Partners/Vendors', 'WH/Main Store', 100],
      ['internal', 'WH/Main Store', 'WH/Production Rack', 100],
      ['delivery', 'WH/Production Rack', 'Partners/Customers', 20],
      ['adjustment', 'WH/Production Rack', 'Virtual/Inventory Adjustment', 3],
    ]
  );
});

test('references are sequential per warehouse and operation type', async () => {
  const lines = [{ product: steel._id, quantity: 1 }];
  const r1 = await stock.createOperation({ type: 'receipt', destLocation: mainStore._id, lines });
  const r2 = await stock.createOperation({ type: 'receipt', destLocation: mainStore._id, lines });
  const d1 = await stock.createOperation({ type: 'delivery', sourceLocation: mainStore._id, lines });
  const t1 = await stock.createOperation({ type: 'internal', sourceLocation: mainStore._id, destLocation: productionRack._id, lines });
  const a1 = await stock.createOperation({ type: 'adjustment', location: mainStore._id, lines });

  assert.deepEqual(
    [r1, r2, d1, t1, a1].map((op) => op.reference),
    ['WH/IN/0001', 'WH/IN/0002', 'WH/OUT/0001', 'WH/INT/0001', 'WH/ADJ/0001']
  );
  assert.ok([r1, r2, d1, t1, a1].every((op) => op.status === 'draft' && op.warehouse.equals(wh._id)));
});

test('not enough stock: delivery waits, validation is refused, nothing changes', async () => {
  await done({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: steel._id, quantity: 5 }] });

  const delivery = await stock.createOperation({
    type: 'delivery', sourceLocation: mainStore._id,
    lines: [{ product: steel._id, quantity: 20 }],
  });
  const { operation, shortages } = await stock.confirmOperation(delivery._id);
  assert.equal(operation.status, 'waiting');
  assert.deepEqual(shortages.map((s) => [s.sku, s.required, s.available]), [['STEEL-KG', 20, 5]]);
  await assert.rejects(stock.markDeliveryStep(delivery._id, 'pick'), /must be ready/);
  await assert.rejects(stock.validateOperation(delivery._id), /must be ready \(stock available\), picked and packed/);

  // Transfers validate directly, so the shortage itself is reported (and it is parked as waiting)
  const transfer = await stock.createOperation({
    type: 'internal', sourceLocation: mainStore._id, destLocation: productionRack._id,
    lines: [{ product: steel._id, quantity: 20 }],
  });
  await assert.rejects(stock.validateOperation(transfer._id), (err) => {
    assert.equal(err.statusCode, 409);
    assert.match(err.message, /Not enough stock in WH\/Main Store: Steel \(need 20, have 5\)/);
    return true;
  });
  assert.equal((await Operation.findById(transfer._id)).status, 'waiting');

  assert.equal(await onHand(steel, mainStore), 5);
  assert.equal(await StockMove.countDocuments({ operation: { $in: [delivery._id, transfer._id] } }), 0);
});

test('deliveries: pick before pack, validate only once packed', async () => {
  await done({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: rods._id, quantity: 10 }] });
  const delivery = await stock.createOperation({ type: 'delivery', sourceLocation: mainStore._id, lines: [{ product: rods._id, quantity: 4 }] });

  await assert.rejects(stock.validateOperation(delivery._id), /must be ready/); // still a draft
  await stock.confirmOperation(delivery._id);
  await assert.rejects(stock.validateOperation(delivery._id), /Pick and pack WH\/OUT\/0001 before validating/);
  await assert.rejects(stock.markDeliveryStep(delivery._id, 'pack'), /Pick the items/);
  await stock.markDeliveryStep(delivery._id, 'pick');
  await assert.rejects(stock.validateOperation(delivery._id), /Pick and pack/);
  await stock.markDeliveryStep(delivery._id, 'pack');
  assert.equal((await stock.validateOperation(delivery._id)).status, 'done');
  assert.equal(await onHand(rods, mainStore), 6);

  // Back to draft clears pick/pack progress
  const second = await stock.createOperation({ type: 'delivery', sourceLocation: mainStore._id, lines: [{ product: rods._id, quantity: 1 }] });
  await pickAndPack(second._id);
  const reset = await stock.resetToDraft(second._id);
  assert.equal(reset.status, 'draft');
  assert.equal(reset.pickedAt, null);
  assert.equal(reset.packedAt, null);
});

test('a packed delivery whose stock was taken meanwhile is refused and parked as waiting', async () => {
  await done({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: rods._id, quantity: 10 }] });
  const delivery = await stock.createOperation({ type: 'delivery', sourceLocation: mainStore._id, lines: [{ product: rods._id, quantity: 10 }] });
  await pickAndPack(delivery._id);

  // Someone moves the stock away before the delivery is validated
  await done({ type: 'internal', sourceLocation: mainStore._id, destLocation: productionRack._id, lines: [{ product: rods._id, quantity: 7 }] });

  await assert.rejects(stock.validateOperation(delivery._id), /Not enough stock in WH\/Main Store: Steel Rods \(need 10, have 3\)/);
  assert.equal((await Operation.findById(delivery._id)).status, 'waiting');
  assert.equal(await onHand(rods, mainStore), 3);
});

test('duplicate copies moves as a new draft but never adjustments', async () => {
  const receipt = await done({ type: 'receipt', partner: 'Tata Steel', destLocation: mainStore._id, lines: [{ product: steel._id, quantity: 3 }] });
  const copy = await stock.duplicateOperation(receipt._id);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.reference, 'WH/IN/0002');
  assert.equal(copy.partner, 'Tata Steel');
  assert.deepEqual(copy.lines.map((l) => l.quantity), [3]);
  assert.match(copy.notes, /Copy of WH\/IN\/0001/);

  const count = await done({ type: 'adjustment', location: mainStore._id, lines: [{ product: steel._id, quantity: 1 }] });
  await assert.rejects(stock.duplicateOperation(count._id), /cannot be duplicated/);
});

test('waiting delivery becomes ready once a receipt brings enough stock', async () => {
  const delivery = await stock.createOperation({
    type: 'delivery', sourceLocation: mainStore._id,
    lines: [{ product: rods._id, quantity: 10 }],
  });
  assert.equal((await stock.confirmOperation(delivery._id)).operation.status, 'waiting');

  await done({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: rods._id, quantity: 50 }] });
  assert.equal((await Operation.findById(delivery._id)).status, 'ready');

  await stock.markDeliveryStep(delivery._id, 'pick');
  await stock.markDeliveryStep(delivery._id, 'pack');
  await stock.validateOperation(delivery._id);
  assert.equal(await onHand(rods, mainStore), 40);
});

test('a failure mid-validation rolls back every stock change (transaction)', async () => {
  await done({
    type: 'receipt', destLocation: mainStore._id,
    lines: [{ product: steel._id, quantity: 100 }, { product: rods._id, quantity: 30 }],
  });
  const transfer = await stock.createOperation({
    type: 'internal', sourceLocation: mainStore._id, destLocation: productionRack._id,
    lines: [{ product: steel._id, quantity: 40 }, { product: rods._id, quantity: 10 }],
  });

  // Quants are already updated inside the transaction when the ledger write fails
  const originalInsertMany = StockMove.insertMany;
  StockMove.insertMany = async () => {
    throw new Error('simulated crash while writing the ledger');
  };
  try {
    await assert.rejects(stock.validateOperation(transfer._id), /simulated crash/);
  } finally {
    StockMove.insertMany = originalInsertMany;
  }

  assert.equal(await onHand(steel, mainStore), 100);
  assert.equal(await onHand(rods, mainStore), 30);
  assert.equal(await onHand(steel, productionRack), 0);
  assert.equal(await onHand(rods, productionRack), 0);
  assert.equal((await Operation.findById(transfer._id)).status, 'draft');

  // ...and it still validates normally afterwards
  await stock.validateOperation(transfer._id);
  assert.equal(await onHand(steel, productionRack), 40);
});

test('status rules: done cannot be validated twice or canceled; canceled cannot be validated', async () => {
  const receipt = await done({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: steel._id, quantity: 10 }] });
  await assert.rejects(stock.validateOperation(receipt._id), /already done/);
  await assert.rejects(stock.cancelOperation(receipt._id), /already done/);
  assert.equal(await onHand(steel, mainStore), 10);

  const draft = await stock.createOperation({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: steel._id, quantity: 10 }] });
  const canceled = await stock.cancelOperation(draft._id);
  assert.equal(canceled.status, 'canceled');
  await assert.rejects(stock.validateOperation(draft._id), /already canceled/);
  await assert.rejects(stock.updateDraftOperation(draft._id, { notes: 'x' }), /Only draft operations can be edited/);
  assert.equal(await onHand(steel, mainStore), 10);
});

test('adjustment with a higher count adds the difference from the adjustment location', async () => {
  await done({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: rods._id, quantity: 10 }] });
  await done({ type: 'adjustment', location: mainStore._id, lines: [{ product: rods._id, quantity: 12 }] });
  assert.equal(await onHand(rods, mainStore), 12);

  const move = await StockMove.findOne({ operationType: 'adjustment' }).populate('fromLocation toLocation').lean();
  assert.equal(move.fromLocation.fullName, 'Virtual/Inventory Adjustment');
  assert.equal(move.toLocation.fullName, 'WH/Main Store');
  assert.equal(move.quantity, 2);

  // Counting exactly what is recorded changes nothing and writes no move
  await done({ type: 'adjustment', location: mainStore._id, lines: [{ product: rods._id, quantity: 12 }] });
  assert.equal(await StockMove.countDocuments({ operationType: 'adjustment' }), 1);
});

test('decimal quantities do not drift', async () => {
  for (let i = 0; i < 3; i += 1) {
    await done({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: steel._id, quantity: 0.1 }] });
  }
  assert.equal(await onHand(steel, mainStore), 0.3);
  await done({ type: 'delivery', sourceLocation: mainStore._id, lines: [{ product: steel._id, quantity: 0.3 }] });
  assert.equal(await onHand(steel, mainStore), 0);
});

test('drafts can be edited; locations must stay in the same warehouse', async () => {
  const draft = await stock.createOperation({
    type: 'internal', sourceLocation: mainStore._id, destLocation: productionRack._id,
    lines: [{ product: steel._id, quantity: 5 }],
  });

  const edited = await stock.updateDraftOperation(draft._id, {
    partner: 'ignored for transfers is fine',
    notes: 'urgent',
    sourceLocation: productionRack._id,
    destLocation: mainStore._id,
    lines: [{ product: rods._id, quantity: 3 }, { product: steel._id, quantity: 2 }],
  });
  assert.equal(edited.notes, 'urgent');
  assert.ok(edited.sourceLocation.equals(productionRack._id));
  assert.ok(edited.destLocation.equals(mainStore._id));
  assert.deepEqual(edited.lines.map((l) => l.quantity), [3, 2]);
  assert.equal(edited.reference, draft.reference);

  // Moving the operation into another warehouse would make its reference wrong
  const wh2 = await Warehouse.create({ name: 'Second Warehouse', code: 'WH2' });
  const wh2Stock = await Location.create({ name: 'Stock', warehouse: wh2._id });
  await assert.rejects(
    stock.updateDraftOperation(draft._id, { sourceLocation: wh2Stock._id }),
    /same warehouse as WH\/INT\/0001/
  );
  await assert.rejects(
    stock.updateDraftOperation(draft._id, { lines: [{ product: steel._id, quantity: -1 }] }),
    /greater than zero/
  );

  // Cross-warehouse transfers are allowed at creation (Warehouse 1 -> Warehouse 2)
  const crossWh = await stock.createOperation({
    type: 'internal', sourceLocation: mainStore._id, destLocation: wh2Stock._id,
    lines: [{ product: steel._id, quantity: 1 }],
  });
  assert.equal(crossWh.reference, 'WH/INT/0002');
  assert.equal(wh2Stock.fullName, 'WH2/Stock');
});

test('locations: virtual ones are created once, internal ones need a real warehouse', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => Location.getVirtual('customer')));
  assert.equal(new Set(results.map((l) => l._id.toString())).size, 1);
  assert.equal(await Location.countDocuments({ type: 'customer' }), 1);

  await assert.rejects(
    Location.create({ name: 'Ghost', warehouse: new mongoose.Types.ObjectId() }),
    /Warehouse not found/
  );
  await assert.rejects(Location.create({ name: 'Nowhere' }), /need a warehouse/);
  await assert.rejects(Location.create({ name: 'Main Store', warehouse: wh._id }), /duplicate key/);
});

test('rejects invalid operations', async () => {
  const lines = [{ product: steel._id, quantity: 1 }];
  const vendors = await Location.getVirtual('vendor');

  await assert.rejects(stock.createOperation({ type: 'teleport', lines }), /Operation type must be one of/);
  await assert.rejects(stock.createOperation({ type: 'receipt', destLocation: vendors._id, lines }), /must be a location inside a warehouse/);
  await assert.rejects(
    stock.createOperation({ type: 'internal', sourceLocation: mainStore._id, destLocation: mainStore._id, lines }),
    /must be different/
  );
  await assert.rejects(stock.createOperation({ type: 'receipt', destLocation: mainStore._id, lines: [] }), /at least one product line/);
  await assert.rejects(
    stock.createOperation({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: steel._id, quantity: 0 }] }),
    /greater than zero/
  );
  await assert.rejects(
    stock.createOperation({ type: 'receipt', destLocation: mainStore._id, lines: [{ product: new mongoose.Types.ObjectId(), quantity: 1 }] }),
    /do not exist/
  );
  await assert.rejects(
    stock.createOperation({ type: 'adjustment', location: mainStore._id, lines: [...lines, ...lines] }),
    /counted once/
  );

  // Duplicate lines on a move are merged
  const merged = await stock.createOperation({ type: 'receipt', destLocation: mainStore._id, lines: [...lines, ...lines] });
  assert.deepEqual(merged.lines.map((l) => l.quantity), [2]);
});
