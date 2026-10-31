import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { pool, migrate, withWrite, bump, readVersion } from './db.js';
import {
  COOKIE, hashPassword, verifyPassword, createSession, findSession, endSession, parseCookies, cookieHeader, clearCookieHeader,
  lockMinutesLeft, recordFailure, clearFailures
} from './auth.js';
import { bootstrap } from './bootstrap.js';
import { loadState, publicState } from './state.js';
import * as A from './actions.js';
import { HttpError, fail } from './util.js';
import { ROLE_LABEL, canDo, currentUser } from '../src/lib/domain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../dist');
const PORT = Number(process.env.PORT) || 3000;
const prod = process.env.NODE_ENV === 'production';

/* ---------- helpers ---------- */
const isSecure = req => req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = json ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', ch => {
      size += ch.length;
      if (size > limit) { reject(new HttpError(413, 'That upload is too large.')); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'Request was not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

// Writes must come from this site's own pages (blocks forged cross-site requests).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch (e) { return false; }
}

const securityHeaders = secure => ({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ...(secure ? { 'Strict-Transport-Security': 'max-age=15552000' } : {})
});

/* ---------- a write: lock, load fresh state, run the action, record a new data version ---------- */
async function mutate(userId, fn) {
  return withWrite(async c => {
    const S = await loadState(c, userId);
    const me = currentUser(S);
    if (!me) fail('Please sign in again.', 401);
    const x = {
      c, S, me,
      can: a => canDo(S, a),
      log: action => c.query('INSERT INTO logs (actor, action) VALUES ($1, $2)', [`${me.name} (${ROLE_LABEL[me.role]})`, action])
    };
    const message = await fn(x);
    await bump(c);
    return message;
  });
}

async function stateFor(userId) {
  const probe = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  const admin = probe.rows[0] && probe.rows[0].role === 'admin';
  const S = await loadState(pool, userId, { logs: admin });
  const me = currentUser(S);
  if (!me) throw new HttpError(401, 'Please sign in again.');
  return { state: publicState(S, me), version: await readVersion(pool) };
}

/* ---------- routes ---------- */
// Each handler gets { body, params, userId, token, query } and returns the JSON to send.
const done = async (ctx, message) => ({ ok: true, message, ...(await stateFor(ctx.userId)) });
const write = fn => async ctx => done(ctx, await mutate(ctx.userId, x => fn(x, ctx)));

const routes = [
  ['GET', /^\/api\/health$/, { public: true }, async () => { await pool.query('SELECT 1'); return { ok: true }; }],

  ['GET', /^\/api\/public$/, { public: true }, async () => {
    const r = await pool.query('SELECT data FROM company WHERE id = 1');
    const d = r.rows[0] ? (typeof r.rows[0].data === 'string' ? JSON.parse(r.rows[0].data) : r.rows[0].data) : {};
    return { company: { name: d.name || 'Banday Impex ERP' } };
  }],

  ['POST', /^\/api\/login$/, { public: true }, async (ctx, req, res) => {
    const email = String(ctx.body.email || '').trim().toLowerCase();
    const password = String(ctx.body.password || '');
    if (!email || !password) fail('Enter your email and password.');
    const locked = await lockMinutesLeft(email);
    if (locked) fail(`Too many wrong attempts. Try again in ${locked} minute(s).`, 429);
    const r = await pool.query('SELECT id, active, pw_salt, pw_hash FROM users WHERE lower(email) = $1', [email]);
    const u = r.rows[0];
    const good = await verifyPassword(password, u && u.pw_salt, u && u.pw_hash);
    if (!u || !good) {
      const nowLocked = await recordFailure(email);
      await pool.query(`INSERT INTO logs (actor, action) VALUES ('System', $1)`, [`Failed sign-in attempt for ${email.slice(0, 120)}${nowLocked ? ' (locked for 5 minutes)' : ''}`]);
      fail(nowLocked ? 'Too many wrong attempts. Try again in 5 minute(s).' : 'Incorrect email or password.', 401);
    }
    if (!u.active) fail('This account is disabled. Contact your admin.', 403);
    await clearFailures(email);
    const token = await createSession(pool, u.id);
    const who = await pool.query('SELECT name, role FROM users WHERE id = $1', [u.id]);
    await pool.query('INSERT INTO logs (actor, action) VALUES ($1, $2)', [`${who.rows[0].name} (${ROLE_LABEL[who.rows[0].role]})`, 'Signed in']);
    res.setHeader('Set-Cookie', cookieHeader(token, isSecure(req)));
    return { ok: true, ...(await stateFor(u.id)) };
  }],

  ['POST', /^\/api\/logout$/, { public: true }, async (ctx, req, res) => {
    if (ctx.token) {
      const uid = await findSession(ctx.token, { touch: false });
      if (uid) {
        const who = await pool.query('SELECT name, role FROM users WHERE id = $1', [uid]);
        if (who.rows[0]) await pool.query('INSERT INTO logs (actor, action) VALUES ($1, $2)', [`${who.rows[0].name} (${ROLE_LABEL[who.rows[0].role]})`, 'Signed out']);
      }
      await endSession(ctx.token);
    }
    res.setHeader('Set-Cookie', clearCookieHeader(isSecure(req)));
    return { ok: true };
  }],

  ['GET', /^\/api\/state$/, {}, async ctx => {
    const known = Number(ctx.query.get('v'));
    const version = await readVersion(pool);
    if (known && known === version && ctx.query.get('force') !== '1') return { unchanged: true, version };
    return stateFor(ctx.userId);
  }],

  ['POST', /^\/api\/password$/, {}, write((x, ctx) => A.changePassword(x, ctx.body, ctx.token))],

  ['POST', /^\/api\/orders$/, {}, write((x, ctx) => A.placeOrder(x, ctx.body))],
  ['POST', /^\/api\/orders\/([\w-]+)\/advance$/, {}, write((x, ctx) => A.advanceOrder(x, ctx.params[0]))],
  ['POST', /^\/api\/orders\/([\w-]+)\/cancel$/, {}, write((x, ctx) => A.cancelOrder(x, ctx.params[0]))],

  ['POST', /^\/api\/products$/, {}, write((x, ctx) => A.saveProduct(x, ctx.body, null))],
  ['PUT', /^\/api\/products\/([\w-]+)$/, {}, write((x, ctx) => A.saveProduct(x, ctx.body, ctx.params[0]))],
  ['POST', /^\/api\/products\/([\w-]+)\/stock$/, {}, write((x, ctx) => A.saveStock(x, ctx.body, ctx.params[0]))],

  ['POST', /^\/api\/customers$/, {}, write((x, ctx) => A.saveCustomer(x, ctx.body, null))],
  ['PUT', /^\/api\/customers\/([\w-]+)$/, {}, write((x, ctx) => A.saveCustomer(x, ctx.body, ctx.params[0]))],
  ['POST', /^\/api\/customers\/([\w-]+)\/hold$/, {}, write((x, ctx) => A.toggleHold(x, ctx.params[0]))],

  ['POST', /^\/api\/leads$/, {}, write((x, ctx) => A.saveLead(x, ctx.body, null))],
  ['PUT', /^\/api\/leads\/([\w-]+)$/, {}, write((x, ctx) => A.saveLead(x, ctx.body, ctx.params[0]))],
  ['POST', /^\/api\/leads\/([\w-]+)\/advance$/, {}, write((x, ctx) => A.advanceLead(x, ctx.params[0]))],
  ['POST', /^\/api\/leads\/([\w-]+)\/lost$/, {}, write((x, ctx) => A.markLost(x, ctx.params[0]))],

  ['POST', /^\/api\/payments$/, {}, write((x, ctx) => A.savePayment(x, ctx.body))],

  ['POST', /^\/api\/users$/, {}, write((x, ctx) => A.saveUser(x, ctx.body))],
  ['POST', /^\/api\/users\/([\w-]+)\/toggle$/, {}, write((x, ctx) => A.toggleUser(x, ctx.params[0]))],
  ['POST', /^\/api\/users\/([\w-]+)\/password$/, {}, write((x, ctx) => A.resetPassword(x, ctx.params[0], ctx.body.password))],
  ['PUT', /^\/api\/company$/, {}, write((x, ctx) => A.saveCompany(x, ctx.body))],

  ['GET', /^\/api\/backup$/, {}, async ctx => {
    const out = await withWrite(async c => {
      const S = await loadState(c, ctx.userId);
      const me = currentUser(S);
      if (!me) fail('Please sign in again.', 401);
      const x = { c, S, me, can: a => canDo(S, a) };
      const data = await A.exportBackup(x);
      await c.query('INSERT INTO logs (actor, action) VALUES ($1, $2)', [`${me.name} (${ROLE_LABEL[me.role]})`, 'Downloaded data backup']);
      return data;
    });
    return out;
  }],
  ['POST', /^\/api\/restore$/, { limit: 15 * 1024 * 1024 }, write((x, ctx) => A.restoreBackup(x, ctx.body))]
];

async function api(req, res, url) {
  const secure = isSecure(req);
  const base = { 'Cache-Control': 'no-store', ...securityHeaders(secure) };
  Object.entries(base).forEach(([k, v]) => res.setHeader(k, v));
  try {
    const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
    if (!route) {
      if (routes.some(([, re]) => re.test(url.pathname))) fail('Method not allowed.', 405);
      fail('Not found.', 404);
    }
    const [method, re, opts, handler] = route;
    const ctx = { query: url.searchParams, params: (re.exec(url.pathname) || []).slice(1), body: {}, token: parseCookies(req.headers.cookie)[COOKIE] || '' };
    if (method !== 'GET') {
      if (!sameOrigin(req)) fail('Request blocked.', 403);
      const ct = String(req.headers['content-type'] || '');
      if (req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !ct.includes('application/json')) fail('Unsupported content type.', 415);
      ctx.body = await readBody(req, opts.limit || 1024 * 1024);
      if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body) && !opts.limit) ctx.body = {};
    }
    if (!opts.public) {
      // Polls that carry no real user activity must not keep a session alive.
      const touch = !(req.method === 'GET' && url.pathname === '/api/state' && ctx.query.get('active') !== '1');
      ctx.userId = await findSession(ctx.token, { touch });
      if (!ctx.userId) {
        res.setHeader('Set-Cookie', clearCookieHeader(secure));
        fail('Your session has ended. Please sign in again.', 401);
      }
    }
    send(res, 200, await handler(ctx, req, res));
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (e && e.code === '23505') return send(res, 409, { error: 'That record already exists.' });
    if (e && (e.code === '23503' || e.code === '23514')) return send(res, 409, { error: 'That change conflicts with existing records.' });
    console.error('Unhandled error on', req.method, url.pathname, e);
    send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  }
}

/* ---------- static files (the built React app) ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const gzCache = new Map();

function serveStatic(req, res, url) {
  Object.entries(securityHeaders(isSecure(req))).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'Bad request'); }
  let file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST + path.sep) && file !== DIST) return send(res, 403, 'Forbidden');
  let st = fs.existsSync(file) && fs.statSync(file);
  if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.existsSync(file) && fs.statSync(file); }
  if (!st) {
    if (path.extname(rel)) return send(res, 404, 'Not found');
    file = path.join(DIST, 'index.html'); // single-page app fallback
    st = fs.existsSync(file) && fs.statSync(file);
    if (!st) return send(res, 503, 'The web app has not been built yet. Run: npm run build');
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': file.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache'
  };
  const textual = ['.html', '.js', '.css', '.json', '.svg', '.txt'].includes(ext);
  if (textual && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    const key = file + ':' + st.mtimeMs;
    if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(fs.readFileSync(file)));
    const body = gzCache.get(key);
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': body.length });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------- start ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) api(req, res, url);
  else serveStatic(req, res, url);
});
server.keepAliveTimeout = 65000;

async function start() {
  for (let attempt = 1; ; attempt++) {
    try { await migrate(); break; } catch (e) {
      if (attempt >= 10) { console.error('Could not prepare the database:', e.message); process.exit(1); }
      console.error(`Database not ready (${e.message}). Retrying in ${attempt * 2}s…`);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  await bootstrap();
  server.listen(PORT, '0.0.0.0', () => console.log(`Banday Impex ERP listening on port ${PORT} (${prod ? 'production' : 'development'})`));
}
start().catch(e => { console.error('Startup failed:', e); process.exit(1); });

const stop = () => { server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 8000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
