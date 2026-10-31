import { r2 } from '../src/lib/utils.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (msg, status = 400) => { throw new HttpError(status, msg); };

export const text = (v, { max = 200, required = false, label = 'Value' } = {}) => {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) fail(`${label} is required.`);
  if (s.length > max) fail(`${label} is too long (${max} characters at most).`);
  return s;
};
export const amount = (v, label, { min = 0, max = 1e9 } = {}) => {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max) fail(`${label} is not valid.`);
  return r2(n);
};
export const whole = (v, label, { min = 0, max = 1e9 } = {}) => {
  const n = Number(v);
  if (v === '' || v == null || !Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number${min > 0 ? ` of ${min} or more` : ''}.`);
  return n;
};
export const oneOf = (v, list, label) => { if (!list.includes(v)) fail(`${label} is not valid.`); return v; };
export const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const stamp = d => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ });
