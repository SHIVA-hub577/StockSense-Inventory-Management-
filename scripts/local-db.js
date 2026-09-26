/**
 * Local development MongoDB (no install / admin rights needed).
 *
 * Starts a single-node replica set (required for multi-document transactions,
 * which the stock engine uses) on 127.0.0.1:27017. Data is persisted in
 * ./.localdb so it survives restarts.
 *
 * Usage:  npm run db        (keep this terminal open, Ctrl+C to stop)
 * Then set in .env:
 *   MONGO_DB_URL=mongodb://127.0.0.1:27017/stocksense?replicaSet=rs0
 */
const fs = require('fs');
const path = require('path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const PORT = Number(process.env.LOCAL_DB_PORT) || 27017;
const DB_PATH = path.join(__dirname, '..', '.localdb');

const start = async () => {
  fs.mkdirSync(DB_PATH, { recursive: true });

  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port: PORT, ip: '127.0.0.1', dbPath: DB_PATH }],
  });

  console.log(`\n[Local DB] MongoDB replica set running on 127.0.0.1:${PORT}`);
  console.log(`[Local DB] Data directory: ${DB_PATH}`);
  console.log(`[Local DB] Use in .env: MONGO_DB_URL=mongodb://127.0.0.1:${PORT}/stocksense?replicaSet=rs0`);
  console.log('[Local DB] Press Ctrl+C to stop.\n');

  const shutdown = async () => {
    console.log('\n[Local DB] Stopping (data is kept)...');
    // doCleanup: false keeps ./.localdb on disk
    await replSet.stop({ doCleanup: false, force: false });
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

start().catch((err) => {
  console.error(`[Local DB] Failed to start: ${err.message}`);
  if (/EADDRINUSE|port/i.test(err.message)) {
    console.error(`[Local DB] Is port ${PORT} already in use? Set LOCAL_DB_PORT to use another port.`);
  }
  process.exit(1);
});
