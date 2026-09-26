/**
 * Seed demo data: warehouses, locations, categories, products, demo users and
 * a realistic history of operations (all created through the stock engine, so
 * quantities and the ledger are consistent).
 *
 * WARNING: wipes all inventory data (warehouses, locations, categories, products,
 * stock, operations, ledger). User accounts are kept; demo users are upserted.
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
const stock = require('../services/stockService');

const INVENTORY_MODELS = [Warehouse, Location, Category, Product, StockQuant, StockMove, Operation, Counter];

// Demo logins (local/demo databases only)
const DEMO_PASSWORD = 'Demo@1234';
const DEMO_USERS = [
  { name: 'Maya Manager', email: 'manager@stocksense.test', role: 'manager' },
  { name: 'Sam Staff', email: 'staff@stocksense.test', role: 'staff' },
];

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

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
  if (!user) {
    user = new User({ name, email, role });
  }
  user.name = name;
  user.role = role;
  user.password = DEMO_PASSWORD; // hashed by the pre-save hook
  await user.save();
  return user;
};

// Create an operation through the engine and optionally move it along its lifecycle.
// `date` backdates it so the dashboard and move history look realistic.
const operation = async (data, { user, finalStatus = 'done', date = new Date() }) => {
  const op = await stock.createOperation({ ...data, scheduledDate: date }, user);

  if (finalStatus === 'done') {
    await stock.validateOperation(op._id, user);
    await Operation.updateOne({ _id: op._id }, { validatedAt: date });
    await StockMove.updateMany({ operation: op._id }, { date });
  } else if (finalStatus === 'ready' || finalStatus === 'waiting') {
    const { operation: confirmed } = await stock.confirmOperation(op._id);
    if (confirmed.status !== finalStatus) {
      throw new Error(`Seed data problem: ${op.reference} ended up ${confirmed.status}, expected ${finalStatus}`);
    }
  } else if (finalStatus === 'canceled') {
    await stock.cancelOperation(op._id);
  }
  return op;
};

const seed = async () => {
  const url = process.env.MONGO_DB_URL || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!url) {
    throw new Error('MONGO_DB_URL is not set. Run `npm run db` and see .env.example.');
  }
  if (!isLocalUrl(url) && !process.argv.includes('--force')) {
    throw new Error(
      'Refusing to wipe a non-local database. Re-run with `npm run seed -- --force` if you really mean it.'
    );
  }

  await mongoose.connect(url);
  console.log(`[Seed] Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);

  // Fresh inventory data; make sure collections + indexes exist before transactions run
  await Promise.all(INVENTORY_MODELS.map((M) => M.deleteMany({})));
  await Promise.all([...INVENTORY_MODELS, User].map((M) => M.init()));

  const [manager, staff] = await Promise.all(DEMO_USERS.map(upsertDemoUser));

  // Warehouses & locations
  const wh = await Warehouse.create({ name: 'Main Warehouse', code: 'WH', address: '12 Industrial Estate, Coimbatore' });
  const wh2 = await Warehouse.create({ name: 'Second Warehouse', code: 'WH2', address: '4 Lake Road, Ooty' });

  const loc = {};
  for (const name of ['Stock', 'Rack A', 'Rack B', 'Production Floor']) {
    loc[name] = await Location.create({ name, warehouse: wh._id });
  }
  loc.wh2Stock = await Location.create({ name: 'Stock', warehouse: wh2._id });

  // Categories & products
  const cat = {};
  for (const name of ['Raw Materials', 'Furniture', 'Electronics', 'Packaging']) {
    cat[name] = await Category.create({ name });
  }

  const productRows = [
    ['STEEL-KG', 'Steel', 'Raw Materials', 'kg', 50, 200],
    ['STEEL-ROD', 'Steel Rods', 'Raw Materials', 'Units', 20, 100],
    ['COPPER-WIRE', 'Copper Wire', 'Raw Materials', 'm', 100, 500],
    ['CHAIR-OFF', 'Office Chair', 'Furniture', 'Units', 10, 40],
    ['DESK-WOOD', 'Wooden Desk', 'Furniture', 'Units', 5, 20],
    ['MON-24', '24" LED Monitor', 'Electronics', 'Units', 8, 25],
    ['KBD-USB', 'USB Keyboard', 'Electronics', 'Units', 15, 50],
    ['BOX-M', 'Cardboard Box (Medium)', 'Packaging', 'Units', 100, 500],
    ['TAPE-PK', 'Packing Tape', 'Packaging', 'Units', 20, 100],
  ];
  const p = {};
  for (const [sku, name, category, uom, reorderLevel, reorderQty] of productRows) {
    p[sku] = await Product.create({ sku, name, category: cat[category]._id, uom, reorderLevel, reorderQty });
  }
  const line = (sku, quantity) => ({ product: p[sku]._id, quantity });

  // ---- History (done) ----
  await operation(
    { type: 'receipt', partner: 'Tata Steel', destLocation: loc.Stock._id,
      lines: [line('STEEL-KG', 100), line('STEEL-ROD', 50), line('COPPER-WIRE', 800)] },
    { user: staff, date: daysAgo(9) }
  );
  await operation(
    { type: 'receipt', partner: 'Urban Furniture Co.', destLocation: loc.Stock._id,
      lines: [line('CHAIR-OFF', 40), line('DESK-WOOD', 12)] },
    { user: staff, date: daysAgo(8) }
  );
  await operation(
    { type: 'receipt', partner: 'Dell Distributors', destLocation: loc.Stock._id,
      lines: [line('MON-24', 30), line('KBD-USB', 60)] },
    { user: manager, date: daysAgo(8) }
  );
  await operation(
    { type: 'receipt', partner: 'PackRight Supplies', destLocation: loc.wh2Stock._id,
      lines: [line('BOX-M', 300)] },
    { user: staff, date: daysAgo(7) }
  );
  // The brief's example: move steel to production, deliver 20, 3 kg damaged
  await operation(
    { type: 'internal', sourceLocation: loc.Stock._id, destLocation: loc['Production Floor']._id,
      lines: [line('STEEL-KG', 100)], notes: 'Steel for frame production' },
    { user: staff, date: daysAgo(6) }
  );
  await operation(
    { type: 'delivery', partner: 'Acme Builders', sourceLocation: loc['Production Floor']._id,
      lines: [line('STEEL-KG', 20)] },
    { user: staff, date: daysAgo(5) }
  );
  await operation(
    { type: 'adjustment', location: loc['Production Floor']._id,
      lines: [line('STEEL-KG', 77)], notes: '3 kg damaged during cutting' },
    { user: manager, date: daysAgo(5) }
  );
  await operation(
    { type: 'delivery', partner: 'BrightDesk Offices', sourceLocation: loc.Stock._id,
      lines: [line('CHAIR-OFF', 10)], notes: 'Sales order for 10 chairs' },
    { user: staff, date: daysAgo(4) }
  );
  await operation(
    { type: 'internal', sourceLocation: loc.Stock._id, destLocation: loc['Rack A']._id,
      lines: [line('MON-24', 10)] },
    { user: staff, date: daysAgo(3) }
  );
  await operation(
    { type: 'delivery', partner: 'Nova Retail', sourceLocation: loc.Stock._id,
      lines: [line('KBD-USB', 50)] },
    { user: staff, date: daysAgo(2) }
  );
  await operation(
    { type: 'internal', sourceLocation: loc.wh2Stock._id, destLocation: loc.Stock._id,
      lines: [line('BOX-M', 100)], notes: 'Warehouse 2 -> Warehouse 1' },
    { user: staff, date: daysAgo(1) }
  );

  // ---- Pending work (shows up in dashboard KPIs) ----
  await operation(
    { type: 'receipt', partner: 'Tata Steel', destLocation: loc.Stock._id, lines: [line('STEEL-ROD', 100)] },
    { user: staff, finalStatus: 'ready', date: daysAgo(-1) }
  );
  await operation(
    { type: 'receipt', partner: 'PackRight Supplies', destLocation: loc.wh2Stock._id, lines: [line('TAPE-PK', 200)] },
    { user: staff, finalStatus: 'draft', date: daysAgo(-2) }
  );
  await operation(
    { type: 'delivery', partner: 'Acme Builders', sourceLocation: loc.Stock._id, lines: [line('CHAIR-OFF', 5)] },
    { user: staff, finalStatus: 'ready', date: daysAgo(-1) }
  );
  await operation(
    { type: 'delivery', partner: 'BrightDesk Offices', sourceLocation: loc.Stock._id, lines: [line('DESK-WOOD', 20)] },
    { user: staff, finalStatus: 'waiting', date: daysAgo(-1) }
  );
  await operation(
    { type: 'delivery', partner: 'Nova Retail', sourceLocation: loc.Stock._id, lines: [line('MON-24', 5)] },
    { user: staff, finalStatus: 'draft', date: daysAgo(-3) }
  );
  await operation(
    { type: 'internal', sourceLocation: loc.Stock._id, destLocation: loc['Rack B']._id, lines: [line('CHAIR-OFF', 10)] },
    { user: staff, finalStatus: 'ready', date: daysAgo(-1) }
  );
  await operation(
    { type: 'adjustment', location: loc['Rack A']._id, lines: [line('MON-24', 9)], notes: 'Cycle count' },
    { user: staff, finalStatus: 'draft', date: daysAgo(0) }
  );
  await operation(
    { type: 'delivery', partner: 'Nova Retail', sourceLocation: loc.Stock._id, lines: [line('KBD-USB', 5)] },
    { user: staff, finalStatus: 'canceled', date: daysAgo(2) }
  );

  // ---- Summary ----
  const totals = await stock.getOnHandTotals();
  console.log('\n[Seed] On-hand stock:');
  for (const [sku, name, , uom, reorderLevel] of productRows) {
    const qty = totals.get(p[sku]._id.toString()) || 0;
    const flag = qty === 0 ? '  <- OUT OF STOCK' : qty <= reorderLevel ? '  <- LOW STOCK' : '';
    console.log(`  ${sku.padEnd(12)} ${name.padEnd(24)} ${String(qty).padStart(6)} ${uom}${flag}`);
  }

  const byStatus = await Operation.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log(`\n[Seed] Operations: ${byStatus.map((s) => `${s.n} ${s._id}`).join(', ')}`);
  console.log(`[Seed] Ledger rows: ${await StockMove.countDocuments()}`);
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
