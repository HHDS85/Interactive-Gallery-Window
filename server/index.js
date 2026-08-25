/*
 * INTERACTIVE GALLERY WINDOW — Realtime Hub
 *
 * One Node process owns the truth for every window:
 *   · control lock (first come, first control)
 *   · session timers (inactivity warning + timeout)
 *   · idle rotation (artwork loop with CTA interstitial)
 *   · event log (JSONL) and price-request leads (JSONL)
 *
 * Screens and phones are thin renderers connected via WebSocket.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4680);
const BASE_URL = process.env.BASE_URL || null; // override for deployments / tunnels

/* ---------------------------------------------------------------- content */

const artworksFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'artworks.json'), 'utf8'));
const screensFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'screens.json'), 'utf8'));

const artists = new Map(artworksFile.artists.map((a) => [a.id, a]));
const artworks = new Map(artworksFile.artworks.map((a) => [a.id, a]));

function resolvePlaylist(screen) {
  return screen.playlist
    .map((id) => artworks.get(id))
    .filter(Boolean)
    .map((a) => ({ ...a, artist: artists.get(a.artistId) || null }));
}

/* ------------------------------------------------------------------ rooms */

const rooms = new Map(); // screenId -> room

for (const screen of screensFile.screens) {
  rooms.set(screen.id, {
    config: {
      idleDwellMs: 12000,
      ctaDwellMs: 9000,
      ctaEvery: 3,
      sessionTimeoutMs: 75000,
      sessionWarningMs: 30000,
      ...screen,
      sessionTimeoutMs: Number(process.env.SESSION_TIMEOUT_MS || screen.sessionTimeoutMs || 75000),
      sessionWarningMs: Number(process.env.SESSION_WARNING_MS || screen.sessionWarningMs || 30000),
    },
    playlist: resolvePlaylist(screen),
    mode: 'idle', // 'idle' | 'active'
    slide: { kind: 'artwork', index: 0 },
    lastIndex: 0, // last shown artwork index (survives CTA slides)
    sinceCta: 0,
    controller: null, // { ws, sessionId, claimedAt }
    sockets: new Set(), // every ws in this room (screens + phones)
    idleTimer: null,
    warnTimer: null,
    endTimer: null,
  });
}

/* -------------------------------------------------------------- analytics */

fs.mkdirSync(DATA_DIR, { recursive: true });
const stats = { byEvent: {}, byArtwork: {}, requests: 0 };

function track(room, sessionId, role, event, props = {}) {
  const entry = {
    ts: new Date().toISOString(),
    screenId: room ? room.config.id : null,
    sessionId: sessionId || null,
    role: role || null,
    event,
    props,
  };
  fs.appendFile(path.join(DATA_DIR, 'events.jsonl'), JSON.stringify(entry) + '\n', () => {});
  stats.byEvent[event] = (stats.byEvent[event] || 0) + 1;
  const artworkId = props && props.artworkId;
  if (artworkId) {
    const a = (stats.byArtwork[artworkId] = stats.byArtwork[artworkId] || {});
    a[event] = (a[event] || 0) + 1;
  }
}

/* ------------------------------------------------------------ room engine */

function dwellFor(room) {
  if (room.mode !== 'idle') return 0;
  return room.slide.kind === 'cta' ? room.config.ctaDwellMs : room.config.idleDwellMs;
}

function statePayload(room) {
  return {
    type: 'state',
    mode: room.mode,
    slide: room.slide,
    hasController: Boolean(room.controller),
    dwellMs: dwellFor(room),
  };
}

function broadcast(room, payload) {
  const msg = JSON.stringify(payload);
  for (const ws of room.sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function currentArtwork(room) {
  if (room.slide.kind !== 'artwork') return null;
  return room.playlist[room.slide.index] || null;
}

/* idle rotation — the automatic exhibition */

function scheduleIdle(room) {
  clearTimeout(room.idleTimer);
  if (room.mode !== 'idle') return;
  room.idleTimer = setTimeout(() => idleTick(room), dwellFor(room));
}

function idleTick(room) {
  if (room.mode !== 'idle') return;
  if (room.slide.kind === 'artwork' && room.sinceCta + 1 >= room.config.ctaEvery) {
    room.slide = { kind: 'cta' };
    room.sinceCta = 0;
  } else {
    const cur = room.slide.kind === 'artwork' ? room.slide.index : room.lastIndex;
    const next = (cur + 1) % room.playlist.length;
    room.lastIndex = next;
    room.slide = { kind: 'artwork', index: next };
    room.sinceCta += 1;
  }
  broadcast(room, statePayload(room));
  scheduleIdle(room);
}

function enterIdle(room) {
  room.mode = 'idle';
  if (room.slide.kind !== 'artwork') room.slide = { kind: 'artwork', index: room.lastIndex || 0 };
  broadcast(room, statePayload(room));
  scheduleIdle(room);
}

/* session / control lock */

function resetSessionTimers(room) {
  clearTimeout(room.warnTimer);
  clearTimeout(room.endTimer);
  if (!room.controller) return;
  const { sessionTimeoutMs, sessionWarningMs } = room.config;
  room.warnTimer = setTimeout(() => {
    if (!room.controller) return;
    send(room.controller.ws, { type: 'warning', secondsLeft: Math.round(sessionWarningMs / 1000) });
  }, Math.max(0, sessionTimeoutMs - sessionWarningMs));
  room.endTimer = setTimeout(() => releaseControl(room, 'timeout'), sessionTimeoutMs);
}

function claimControl(room, ws) {
  if (room.controller && room.controller.ws !== ws) {
    send(ws, { type: 'role', role: 'viewer' });
    return;
  }
  room.controller = { ws, sessionId: ws.meta.sessionId, claimedAt: Date.now() };
  room.mode = 'active';
  clearTimeout(room.idleTimer);
  room.sinceCta = 0;
  if (room.slide.kind !== 'artwork') room.slide = { kind: 'artwork', index: room.lastIndex || 0 };
  ws.meta.role = 'controller';
  send(ws, {
    type: 'role',
    role: 'controller',
    timeoutMs: room.config.sessionTimeoutMs,
    warningMs: room.config.sessionWarningMs,
  });
  broadcast(room, { type: 'connected-flash' });
  broadcast(room, statePayload(room));
  resetSessionTimers(room);
  track(room, ws.meta.sessionId, 'phone', 'control_claimed');
}

function releaseControl(room, reason) {
  const controller = room.controller;
  if (!controller) return;
  room.controller = null;
  clearTimeout(room.warnTimer);
  clearTimeout(room.endTimer);
  const duration = Date.now() - controller.claimedAt;
  track(room, controller.sessionId, 'phone', 'control_released', { reason });
  track(room, controller.sessionId, 'phone', 'session_ended', { reason, durationMs: duration });
  if (controller.ws.readyState === WebSocket.OPEN) {
    controller.ws.meta.role = 'viewer';
    send(controller.ws, { type: 'session', status: 'ended', reason });
  }
  enterIdle(room);
  broadcast(room, { type: 'control-available' });
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

/* phone navigation */

function navigate(room, ws, dir, index) {
  if (!room.controller || room.controller.ws !== ws) return; // only the lock holder moves the window
  const n = room.playlist.length;
  let next;
  if (typeof index === 'number') {
    next = ((index % n) + n) % n;
  } else {
    const cur = room.slide.kind === 'artwork' ? room.slide.index : room.lastIndex || 0;
    next = (cur + (dir === 'prev' ? -1 : 1) + n) % n;
  }
  room.lastIndex = next;
  room.slide = { kind: 'artwork', index: next };
  broadcast(room, statePayload(room));
  resetSessionTimers(room);
  const artwork = currentArtwork(room);
  track(room, ws.meta.sessionId, 'phone', 'artwork_changed', {
    artworkId: artwork ? artwork.id : null,
    dir: dir || 'goto',
  });
}

/* --------------------------------------------------------------- web app */

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '64kb' }));
app.use(express.text({ type: ['text/*'], limit: '64kb' })); // sendBeacon fallback

// artworks are immutable-ish and heavy — cache them hard; everything else
// (HTML/CSS/JS, all tiny) stays uncached while the product iterates
app.use('/artworks', express.static(path.join(ROOT, 'public', 'artworks'), { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0, index: false }));

app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/screen/:screenId', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'screen', 'index.html')));
app.get('/control/:screenId', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'control', 'index.html')));

/* content API */

app.get('/api/screens', (_req, res) => {
  res.json({
    screens: [...rooms.values()].map((room) => ({
      id: room.config.id,
      label: room.config.label,
      gallery: room.config.gallery,
      works: room.playlist.length,
    })),
  });
});

app.get('/api/screens/:screenId', (req, res) => {
  const room = rooms.get(req.params.screenId);
  if (!room) return res.status(404).json({ error: 'unknown screen' });
  const { id, label, gallery, galleryClaim, idleDwellMs, ctaDwellMs, ctaEvery } = room.config;
  res.json({
    screen: { id, label, gallery, galleryClaim, idleDwellMs, ctaDwellMs, ctaEvery },
    artworks: room.playlist,
  });
});

/* price requests — leads */

app.post('/api/requests', (req, res) => {
  const { screenId, sessionId, artworkId, name, email, message } = req.body || {};
  const room = rooms.get(screenId);
  const artwork = artworks.get(artworkId);
  if (!room || !artwork) return res.status(400).json({ error: 'unknown screen or artwork' });
  if (!name || !email || !/.+@.+\..+/.test(String(email))) {
    return res.status(400).json({ error: 'name and a valid email are required' });
  }
  const lead = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    status: 'new',
    screenId,
    sessionId: sessionId || null,
    artworkId,
    artistId: artwork.artistId,
    artworkTitle: artwork.title,
    name: String(name).slice(0, 200),
    email: String(email).slice(0, 200),
    message: String(message || '').slice(0, 2000),
  };
  fs.appendFile(path.join(DATA_DIR, 'requests.jsonl'), JSON.stringify(lead) + '\n', () => {});
  stats.requests += 1;
  track(room, sessionId, 'phone', 'price_requested', { artworkId });
  res.json({ ok: true });
});

/* analytics */

app.post('/api/track', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const { screenId, sessionId, role, event, props } = body || {};
  if (!event || typeof event !== 'string') return res.status(400).json({ error: 'event required' });
  track(rooms.get(screenId) || null, sessionId, role, event.slice(0, 64), props || {});
  res.json({ ok: true });
});

app.get('/api/stats', (_req, res) => {
  res.json({
    since: BOOTED_AT,
    requests: stats.requests,
    events: stats.byEvent,
    artworks: stats.byArtwork,
  });
});

/* QR — one per window, pointing at its control URL */

app.get('/qr/:screenId.svg', async (req, res) => {
  const room = rooms.get(req.params.screenId);
  if (!room) return res.status(404).end();
  const url = `${requestBase(req)}/control/${room.config.id}?src=qr`;
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: '#0A0A0Bff', light: '#00000000' },
  });
  res
    .type('image/svg+xml')
    .setHeader('Cache-Control', 'no-store')
    .setHeader('X-QR-Target', url) // debug/verification aid — the URL encoded in the QR
    .send(svg);
});

/* ------------------------------------------------------------- websocket */

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const room = rooms.get(params.get('screen'));
  const role = params.get('role') === 'screen' ? 'screen' : 'viewer';
  if (!room) {
    ws.close(4004, 'unknown screen');
    return;
  }
  ws.meta = { room, role, sessionId: params.get('session') || crypto.randomUUID(), alive: true };
  room.sockets.add(ws);

  send(ws, {
    ...statePayload(room),
    type: 'init', // after the spread — statePayload carries type:'state'
    screen: { id: room.config.id, label: room.config.label, gallery: room.config.gallery },
    you: { role: ws.meta.role, sessionId: ws.meta.sessionId },
  });

  if (role === 'screen') track(room, ws.meta.sessionId, 'screen', 'screen_view');
  else track(room, ws.meta.sessionId, 'phone', 'session_started', { src: params.get('src') || 'direct' });

  ws.on('pong', () => (ws.meta.alive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'claim':
        if (ws.meta.role !== 'screen') claimControl(room, ws);
        break;
      case 'navigate':
        navigate(room, ws, msg.dir);
        break;
      case 'goto':
        navigate(room, ws, null, msg.index);
        break;
      case 'heartbeat':
        if (room.controller && room.controller.ws === ws) resetSessionTimers(room);
        break;
      case 'release':
        if (room.controller && room.controller.ws === ws) releaseControl(room, 'released');
        break;
      case 'track':
        track(room, ws.meta.sessionId, ws.meta.role, String(msg.event || '').slice(0, 64), msg.props || {});
        break;
    }
  });

  ws.on('close', () => {
    room.sockets.delete(ws);
    if (room.controller && room.controller.ws === ws) releaseControl(room, 'disconnected');
  });
});

/* keepalive — drop dead sockets so the lock never sticks */

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.meta) continue;
    if (!ws.meta.alive) {
      ws.terminate();
      continue;
    }
    ws.meta.alive = false;
    ws.ping();
  }
}, 25000);

/* ----------------------------------------------------------------- boot */

const BOOTED_AT = new Date().toISOString();

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function baseUrl() {
  return BASE_URL || `http://${lanAddress()}:${PORT}`;
}

/* Public base for QR codes: explicit BASE_URL wins; otherwise derive it from
   the incoming request (works unchanged behind Render/Railway/tunnels — the
   QR always points at whatever host the screen was opened from). */
function requestBase(req) {
  if (BASE_URL) return BASE_URL;
  const host = req.get('host');
  if (!host) return baseUrl();
  let proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0];
  // public hostnames are always TLS in this product (Render, tunnels, domains);
  // some tunnels terminate TLS without setting x-forwarded-proto
  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (!isLocal) proto = 'https';
  return `${proto}://${host}`;
}

server.listen(PORT, () => {
  for (const room of rooms.values()) scheduleIdle(room);
  const base = baseUrl();
  console.log('\n  INTERACTIVE GALLERY WINDOW — hub running\n');
  for (const room of rooms.values()) {
    console.log(`  ${room.config.label}`);
    console.log(`    window   ${base}/screen/${room.config.id}`);
    console.log(`    control  ${base}/control/${room.config.id}`);
  }
  console.log(`\n  backstage  ${base}/`);
  console.log(`  stats      ${base}/api/stats\n`);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
