'use strict';
// One-consenting-device development MVP. Deploy only behind HTTPS.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const COOKIE_SECURE = process.env.PUBLIC_HTTPS === '1';
if (ADMIN_PASSWORD.length < 16 || DEVICE_TOKEN.length < 24) {
  console.error('Set ADMIN_PASSWORD (>=16 chars) and DEVICE_TOKEN (>=24 chars) before starting.');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const DB_PATH = path.join(DATA_DIR, 'state.json');
const baseState = { sharing: false, mode: 'native', lastHeartbeat: null, card: null, points: [] };
let state = baseState;
try { state = { ...baseState, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) }; }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const sessions = new Map(); // server restart invalidates viewer sessions
const attempts = new Map();
const encoder = new TextEncoder();

function save() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, DB_PATH);
}
function constantEqual(a, b) {
  const lhs = crypto.createHash('sha256').update(String(a)).digest();
  const rhs = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(lhs, rhs);
}
function hashCard(card, salt) { return crypto.scryptSync(card, salt, 32).toString('hex'); }
function parseCookie(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map(x => x.trim().split('=').slice(0, 2)).filter(x => x.length === 2));
}
function activeCard() { return !!state.card && !state.card.revoked && Date.now() < Date.parse(state.card.expiresAt); }
function activeSharing() {
  if (!state.sharing) return false;
  // Browser-only A test must keep the consent page open and send heartbeats.
  if (state.mode === 'web' && (!state.lastHeartbeat || Date.now()-Date.parse(state.lastHeartbeat) > 90000)) return false;
  return true;
}
function isViewer(request) {
  const token = parseCookie(request).viewer;
  if (!token || !activeCard()) return false;
  const session = sessions.get(token);
  return !!session && session.expires > Date.now() && session.cardVersion === state.card.version;
}
function requireAdmin(request) {
  return constantEqual(request.headers['x-admin-password'] || '', ADMIN_PASSWORD);
}
function requireDevice(request) {
  const match = /^Bearer (.+)$/.exec(request.headers.authorization || '');
  return !!match && constantEqual(match[1], DEVICE_TOKEN);
}
function json(response, status, obj, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  response.end(JSON.stringify(obj));
}
function fail(response, status, message) { return json(response, status, { error: message }); }
async function readJSON(request) {
  let raw = '';
  for await (const part of request) {
    raw += part.toString('utf8');
    if (raw.length > 250000) throw Object.assign(new Error('body too large'), { code: 413 });
  }
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('invalid JSON'), { code: 400 }); }
}
function limiter(request) {
  const ip = request.socket.remoteAddress || 'unknown';
  const existing = attempts.get(ip) || { start: Date.now(), count: 0 };
  if (Date.now() - existing.start > 15 * 60 * 1000) { existing.start = Date.now(); existing.count = 0; }
  existing.count++;
  attempts.set(ip, existing);
  return existing.count <= 12;
}
function pruneHistory() {
  const cutoff = Date.now() - 30 * 86400e3;
  state.points = state.points.filter(point => Date.parse(point.recordedAt) >= cutoff).slice(-16000);
}
function serveFile(req, res, pathname) {
  const files = { '/': 'index.html', '/admin': 'admin.html', '/a': 'device.html', '/device.js': 'device.js', '/styles.css': 'styles.css', '/viewer.js': 'viewer.js', '/admin.js': 'admin.js' };
  const fileName = files[pathname];
  if (!fileName) return fail(res, 404, 'not found');
  const mime = fileName.endsWith('.css') ? 'text/css' : fileName.endsWith('.js') ? 'text/javascript' : 'text/html';
  const body = fs.readFileSync(path.join(__dirname, 'public', fileName));
  res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://tile.openstreetmap.org https://unpkg.com; connect-src 'self' https://tile.openstreetmap.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  const route = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (req.method === 'GET' && !route.startsWith('/api/')) return serveFile(req, res, route);
    if (req.method === 'GET' && route === '/api/health') return json(res, 200, { ok: true });

    if (req.method === 'POST' && route === '/api/admin/cards') {
      if (!limiter(req)) return fail(res, 429, 'too many attempts; retry later');
      if (!requireAdmin(req)) return fail(res, 401, 'invalid admin credentials');
      const body = await readJSON(req);
      const expires = Date.parse(body.expiresAt);
      if (!Number.isFinite(expires) || expires <= Date.now() || expires - Date.now() > 5 * 365 * 86400e3)
        return fail(res, 400, 'expiry must be a future time within 5 years');
      const raw = crypto.randomBytes(15).toString('hex').toUpperCase();
      const code = raw.match(/.{1,5}/g).join('-');
      const salt = crypto.randomBytes(16).toString('hex');
      state.card = { version: crypto.randomUUID(), hash: hashCard(code, salt), salt,
                     expiresAt: new Date(expires).toISOString(), revoked: false };
      sessions.clear(); // only one active viewer at a time and old card invalidated
      save();
      return json(res, 201, { code, expiresAt: state.card.expiresAt });
    }
    if (req.method === 'POST' && route === '/api/admin/revoke') {
      if (!requireAdmin(req)) return fail(res, 401, 'invalid admin credentials');
      if (state.card) state.card.revoked = true;
      sessions.clear(); save();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && route === '/api/admin/status') {
      if (!requireAdmin(req)) return fail(res, 401, 'invalid admin credentials');
      return json(res, 200, { sharing: activeSharing(), cardActive: activeCard(),
                              expiresAt: state.card?.expiresAt || null, historyCount: state.points.length });
    }

    if (req.method === 'POST' && route === '/api/viewer/login') {
      if (!limiter(req)) return fail(res, 429, 'too many attempts; retry later');
      const { code } = await readJSON(req);
      if (typeof code !== 'string' || code.length > 100 || !activeCard() ||
          !constantEqual(hashCard(code.toUpperCase().trim(), state.card.salt), state.card.hash)) {
        return fail(res, 401, 'invalid or expired card');
      }
      sessions.clear(); // one B browser session at a time, not a physical-device guarantee
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { expires: Math.min(Date.now() + 12 * 3600e3, Date.parse(state.card.expiresAt)),
                            cardVersion: state.card.version });
      return json(res, 200, { ok: true, expiresAt: state.card.expiresAt }, {
        'Set-Cookie': `viewer=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${COOKIE_SECURE ? '; Secure' : ''}`
      });
    }
    if (req.method === 'POST' && route === '/api/viewer/logout') {
      const token = parseCookie(req).viewer;
      if (token) sessions.delete(token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': `viewer=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${COOKIE_SECURE ? '; Secure' : ''}` });
    }
    if (req.method === 'GET' && route === '/api/viewer/latest') {
      if (!isViewer(req)) return fail(res, 401, 'please log in again');
      if (!activeSharing()) return json(res, 200, { sharing: false, latest: null });
      pruneHistory();
      return json(res, 200, { sharing: true, latest: state.points.at(-1) || null });
    }
    if (req.method === 'GET' && route === '/api/viewer/history') {
      if (!isViewer(req)) return fail(res, 401, 'please log in again');
      if (!activeSharing()) return json(res, 200, { sharing: false, points: [] });
      const date = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams.get('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return fail(res, 400, 'date must be YYYY-MM-DD');
      pruneHistory();
      // UTC date for prototype, coordinate timezone display left to browser
      return json(res, 200, { sharing: true, points: state.points.filter(p => p.recordedAt.startsWith(date)) });
    }

    if (req.method === 'POST' && route === '/api/device/sharing') {
      if (!requireDevice(req)) return fail(res, 401, 'invalid device token');
      const body = await readJSON(req);
      if (typeof body.enabled !== 'boolean') return fail(res, 400, 'enabled must be boolean');
      state.sharing = body.enabled;
      state.mode = state.sharing && body.mode === 'web' ? 'web' : 'native';
      state.lastHeartbeat = state.sharing && state.mode === 'web' ? new Date().toISOString() : null;
      if (!state.sharing) sessions.clear(); // revoke B viewing immediately
      save();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && route === '/api/device/heartbeat') {
      if (!requireDevice(req)) return fail(res, 401, 'invalid device token');
      if (!state.sharing || state.mode !== 'web') return fail(res, 403, 'web sharing inactive');
      state.lastHeartbeat = new Date().toISOString();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && route === '/api/device/locations') {
      if (!requireDevice(req)) return fail(res, 401, 'invalid device token');
      if (!activeSharing()) return fail(res, 403, 'device sharing is disabled or expired');
      const body = await readJSON(req);
      if (!Array.isArray(body.points) || body.points.length > 200) return fail(res, 400, 'invalid batch');
      const current = Date.now();
      const existingIDs = new Set(state.points.map(p => p.id));
      let accepted = 0;
      for (const p of body.points) {
        const t = Date.parse(p.recordedAt);
        if (typeof p.id !== 'string' || p.id.length > 64 || typeof p.latitude !== 'number' ||
            typeof p.longitude !== 'number' || typeof p.accuracyMeters !== 'number' ||
            !Number.isFinite(t) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 ||
            p.accuracyMeters < 0 || p.accuracyMeters > 2000 ||
            t < current - 30 * 86400e3 || t > current + 300000) return fail(res, 400, 'invalid point');
        if (!existingIDs.has(p.id)) {
          state.points.push({ id: p.id, latitude: p.latitude, longitude: p.longitude,
                              accuracyMeters: p.accuracyMeters, recordedAt: new Date(t).toISOString() });
          existingIDs.add(p.id);
        }
        accepted++;
      }
      state.points.sort((a,b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
      pruneHistory(); save();
      return json(res, 200, { accepted });
    }
    if (req.method === 'POST' && route === '/api/device/delete-history') {
      if (!requireDevice(req)) return fail(res, 401, 'invalid device token');
      state.sharing = false;state.lastHeartbeat=null;
      state.points = [];
      sessions.clear(); save();
      return json(res, 200, { ok: true });
    }
    return fail(res, 404, 'not found');
  } catch (error) {
    const code = error.code === 413 ? 413 : error.code === 400 ? 400 : 500;
    if (code === 500) console.error('Request failed:', error.message);
    return fail(res, code, code === 500 ? 'server error' : error.message);
  }
});
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`Authorized location demo listening on port ${PORT}; public deployment requires HTTPS.`);
});
