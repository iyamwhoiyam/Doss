/**
 * Live sync.
 *
 * Every database mutation is pushed to every signed-in browser over Server-Sent
 * Events, so when one person moves a work order across the production board the
 * other twenty-four see it move without refreshing. SSE (rather than WebSockets)
 * because it survives proxies, reconnects on its own, and needs no extra
 * protocol on top of the existing cookie session.
 *
 * The same channel carries presence — who is online, and what record they are
 * looking at — so two people editing the same formula can see each other.
 */

const HEARTBEAT_MS = 25_000;
const PRESENCE_TTL_MS = 90_000;

export class RealtimeHub {
  constructor(db) {
    this.db = db;
    this.clients = new Map(); // clientId -> { res, user, viewing, since }
    this.nextId = 1;

    db.on('change', (event) => this.broadcastChange(event));

    this.heartbeat = setInterval(() => {
      for (const [id, client] of this.clients) {
        try {
          client.res.write(': ping\n\n');
        } catch {
          this.clients.delete(id);
        }
      }
      this.broadcastPresence();
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  /** Attach an Express response as an SSE client. */
  subscribe(req, res, user) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const id = String(this.nextId++);
    const client = { res, user, viewing: null, since: Date.now(), lastSeen: Date.now() };
    this.clients.set(id, client);

    this.send(client, 'hello', {
      clientId: id,
      serverTime: new Date().toISOString(),
      you: { id: user.id, name: user.name, role: user.role },
    });
    this.broadcastPresence();

    req.on('close', () => {
      this.clients.delete(id);
      this.broadcastPresence();
    });
    return id;
  }

  send(client, event, data) {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* the client vanished; the close handler will clean it up */
    }
  }

  broadcast(event, data, { exceptClientId } = {}) {
    for (const [id, client] of this.clients) {
      if (id === exceptClientId) continue;
      this.send(client, event, data);
    }
  }

  broadcastChange(event) {
    // Sessions are internal plumbing; presence covers what the UI needs.
    if (event.collection === 'sessions') return;
    const payload = {
      collection: event.collection,
      op: event.op,
      id: event.id,
      at: event.at,
      actorId: event.actorId,
      actorName: event.actorName,
      record: event.collection === 'users'
        ? { ...event.record, passwordHash: undefined, passwordSalt: undefined }
        : event.record,
    };
    for (const [, client] of this.clients) {
      // a notification is only interesting to the person it belongs to
      if (event.collection === 'notifications' && event.record?.userId !== client.user.id) continue;
      this.send(client, 'change', payload);
    }
  }

  setViewing(clientId, viewing) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    const next = viewing ?? null;
    client.lastSeen = Date.now();
    if (client.viewing === next) return true; // nothing changed: nobody needs telling
    client.viewing = next;
    this.broadcastPresence();
    return true;
  }

  presence() {
    const now = Date.now();
    const byUser = new Map();
    for (const [, client] of this.clients) {
      if (now - client.lastSeen > PRESENCE_TTL_MS) continue;
      const existing = byUser.get(client.user.id);
      if (existing) {
        existing.connections++;
        if (client.viewing) existing.viewing = client.viewing;
        continue;
      }
      byUser.set(client.user.id, {
        id: client.user.id,
        name: client.user.name,
        initials: client.user.initials,
        role: client.user.role,
        accentColor: client.user.accentColor,
        viewing: client.viewing,
        since: new Date(client.since).toISOString(),
        connections: 1,
      });
    }
    return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  broadcastPresence() {
    const online = this.presence();
    this.broadcast('presence', { online, count: online.length });
  }

  close() {
    clearInterval(this.heartbeat);
    for (const [, client] of this.clients) {
      try { client.res.end(); } catch { /* already gone */ }
    }
    this.clients.clear();
  }
}
