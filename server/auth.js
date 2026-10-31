import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';

const scrypt = promisify(crypto.scrypt);

/* ---------- passwords: scrypt with a random salt ---------- */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return { salt, hash };
}
export async function verifyPassword(password, salt, hash) {
  const h = (await scrypt(password, salt || 'no-such-user-salt', 64)).toString('hex'); // same work either way
  if (!salt || !hash) return false;
  const a = Buffer.from(h), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- sessions: random token in an HttpOnly cookie, hash stored in the database ---------- */
export const COOKIE = 'bi_session';
export const IDLE_MINUTES = Number(process.env.IDLE_MINUTES) || 60;
const MAX_HOURS = 24;
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

export async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [sha(token), userId]);
  await db.query(`DELETE FROM sessions WHERE last_seen < now() - interval '2 days'`);
  return token;
}

/** Returns the user id for a valid, unexpired session; null otherwise. */
export async function findSession(token, { touch }) {
  if (!token) return null;
  const h = sha(token);
  const r = await pool.query(
    `SELECT s.user_id, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND u.active
       AND s.last_seen > now() - ($2 || ' minutes')::interval
       AND s.created_at > now() - ($3 || ' hours')::interval`,
    [h, String(IDLE_MINUTES), String(MAX_HOURS)]);
  if (!r.rows.length) return null;
  if (touch) await pool.query(`UPDATE sessions SET last_seen = now() WHERE token_hash = $1 AND last_seen < now() - interval '20 seconds'`, [h]);
  return r.rows[0].user_id;
}
export const endSession = token => pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
export const endUserSessions = (db, userId, exceptToken) =>
  db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, exceptToken ? sha(exceptToken) : '']);

export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) { /* skip bad cookie */ } }
  });
  return out;
}
export function cookieHeader(token, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export const clearCookieHeader = secure => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

/* ---------- lock-out after repeated wrong passwords ---------- */
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 5;
export async function lockMinutesLeft(email) {
  const r = await pool.query(`SELECT CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60) AS m FROM login_throttle WHERE email = $1 AND locked_until > now()`, [email]);
  return r.rows.length ? Math.max(1, Number(r.rows[0].m)) : 0;
}
/** Records a wrong attempt; returns true if this attempt locked the account. */
export async function recordFailure(email) {
  await pool.query(`DELETE FROM login_throttle WHERE updated_at < now() - interval '1 day'`);
  const r = await pool.query(
    `INSERT INTO login_throttle (email, fails, updated_at) VALUES ($1, 1, now())
     ON CONFLICT (email) DO UPDATE SET fails = CASE WHEN login_throttle.locked_until IS NOT NULL AND login_throttle.locked_until <= now() THEN 1 ELSE login_throttle.fails + 1 END,
       locked_until = CASE WHEN login_throttle.locked_until IS NOT NULL AND login_throttle.locked_until <= now() THEN NULL ELSE login_throttle.locked_until END,
       updated_at = now()
     RETURNING fails`, [email]);
  if (Number(r.rows[0].fails) >= MAX_FAILS) {
    await pool.query(`UPDATE login_throttle SET fails = 0, locked_until = now() + ($2 || ' minutes')::interval WHERE email = $1`, [email, String(LOCK_MINUTES)]);
    return true;
  }
  return false;
}
export const clearFailures = email => pool.query('DELETE FROM login_throttle WHERE email = $1', [email]);
