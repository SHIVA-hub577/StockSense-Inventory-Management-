/**
 * Live Warehouse: pushes changes to every open screen with Server-Sent Events
 * and tracks who is looking at what (presence).
 *
 * Each logged-in page opens GET /api/live?view=<what it shows>, e.g.
 * "operation:<id>". Events sent to browsers:
 *   operation - something happened to an operation (activity feed item)
 *   alert     - a new low / out-of-stock alert
 *   presence  - the list of people viewing the same thing
 *   online    - who is connected right now (after joins/leaves settle)
 */
const HEARTBEAT_MS = 25000;
const MAX_CONNECTIONS_PER_USER = 8; // tabs per person
const MAX_CONNECTION_AGE_MS = 60 * 60 * 1000; // browsers reconnect (and re-authenticate) after this
const ONLINE_GRACE_MS = 1500; // page reloads reconnect within this, so they don't flicker
const VIEW_PATTERN = /^[a-z]+:[A-Za-z0-9_-]{1,40}$/;

const clients = new Map(); // id -> { id, res, user: { id, name, role }, view }
let nextId = 1;

const write = (client, event, data) => {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (err) {
    clients.delete(client.id);
  }
};

/**
 * Send an event to every connected client (optionally filtered).
 * @param {string} event
 * @param {Object} data
 * @param {(client) => boolean} [filter]
 */
const broadcast = (event, data, filter = null) => {
  for (const client of clients.values()) {
    if (!filter || filter(client)) write(client, event, data);
  }
};

// Distinct people currently viewing `view`
const viewersOf = (view) => {
  const seen = new Map();
  for (const c of clients.values()) {
    if (c.view === view && !seen.has(c.user.id)) {
      seen.set(c.user.id, { id: c.user.id, name: c.user.name, role: c.user.role });
    }
  }
  return [...seen.values()];
};

// Who is online: sent shortly after connects/disconnects settle
let onlineTimer = null;
const broadcastOnline = () => {
  clearTimeout(onlineTimer);
  onlineTimer = setTimeout(() => {
    broadcast('online', { users: onlineUsers().map((u) => ({ id: u.id, name: u.name, role: u.role })) });
  }, ONLINE_GRACE_MS);
  if (onlineTimer.unref) onlineTimer.unref();
};

const broadcastPresence = (view) => {
  if (!view) return;
  broadcast('presence', { view, viewers: viewersOf(view) }, (c) => c.view === view);
};

/**
 * Express handler body for GET /api/live (after `protect`).
 */
const connect = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const view = typeof req.query.view === 'string' && VIEW_PATTERN.test(req.query.view) ? req.query.view : null;
  const client = {
    id: nextId++,
    res,
    user: { id: String(req.user._id), name: req.user.name, role: req.user.role },
    view,
    since: Date.now(),
  };

  // Cap connections per person: close their oldest ones
  const mine = [...clients.values()].filter((c) => c.user.id === client.user.id).sort((a, b) => a.since - b.since);
  while (mine.length >= MAX_CONNECTIONS_PER_USER) {
    const oldest = mine.shift();
    clients.delete(oldest.id);
    try {
      oldest.res.end();
    } catch (e) {
      /* already closed */
    }
  }

  clients.set(client.id, client);
  write(client, 'hello', { clientId: client.id, online: onlineUsers().length });
  broadcastPresence(view);
  broadcastOnline();

  req.on('close', () => {
    clients.delete(client.id);
    broadcastPresence(view);
    broadcastOnline();
  });
};

// Distinct people connected right now
const onlineUsers = () => {
  const seen = new Map();
  for (const c of clients.values()) seen.set(c.user.id, c.user);
  return [...seen.values()];
};

// Keep connections open through proxies; comments are ignored by EventSource
const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const client of clients.values()) {
    try {
      if (now - client.since > MAX_CONNECTION_AGE_MS) {
        client.res.end(); // EventSource reconnects and passes the login check again
        continue;
      }
      client.res.write(': ping\n\n');
    } catch (err) {
      clients.delete(client.id);
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref();

module.exports = {
  connect,
  broadcast,
  viewersOf,
  onlineUsers,
  clientCount: () => clients.size,
};
