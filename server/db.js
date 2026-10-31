import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Example: postgres://user:password@localhost:5432/banday_erp');
  process.exit(1);
}
const wantSsl = process.env.DATABASE_SSL === 'true' || /\.render\.com|sslmode=require/.test(url);
export const pool = new pg.Pool({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'false' ? false : wantSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
pool.on('error', e => console.error('Database pool error:', e.message));

const WRITE_LOCK = 727001; // every write waits its turn, so credit, stock and numbering checks can never race

/** Runs fn(client) in one transaction, serialised with every other write. */
export async function withWrite(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
    throw e;
  } finally {
    c.release();
  }
}

export const bump = c => c.query(
  `INSERT INTO meta (key, value) VALUES ('version', '1')
   ON CONFLICT (key) DO UPDATE SET value = (meta.value::bigint + 1)::text`);
export const readVersion = async db => {
  const r = await db.query(`SELECT value FROM meta WHERE key = 'version'`);
  return r.rows[0] ? Number(r.rows[0].value) : 0;
};
export async function nextId(c, prefix) {
  const r = await c.query(`UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value - 1 AS n`, [prefix]);
  if (!r.rows.length) throw new Error('Unknown counter ' + prefix);
  return `${prefix}-${Number(r.rows[0].n)}`;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  title text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('admin','sales','warehouse')),
  email text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  pw_salt text NOT NULL DEFAULT '',
  pw_hash text NOT NULL DEFAULT '',
  must_change boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS login_throttle (
  email text PRIMARY KEY,
  fails integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value bigint NOT NULL);

CREATE TABLE IF NOT EXISTS products (
  ord bigserial,
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  warehouse text NOT NULL DEFAULT '',
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock integer NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  price numeric(12,2) NOT NULL CHECK (price > 0),
  gst numeric(5,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
  ord bigserial,
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'Retail',
  market text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  credit_limit numeric(14,2) NOT NULL DEFAULT 0,
  opening numeric(14,2) NOT NULL DEFAULT 0,
  on_hold boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  from_lead text
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_gstin_uq ON customers (gstin) WHERE gstin <> '';

CREATE TABLE IF NOT EXISTS leads (
  ord bigserial,
  id text PRIMARY KEY,
  business_name text NOT NULL,
  contact_person text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  market text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'Initial Contact',
  potential numeric(14,2) NOT NULL DEFAULT 0,
  assigned_to text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS orders (
  ord bigserial,
  id text PRIMARY KEY,
  date text NOT NULL,
  customer_id text NOT NULL REFERENCES customers(id),
  customer_name text NOT NULL,
  market text NOT NULL DEFAULT '',
  items jsonb NOT NULL,
  subtotal numeric(14,2) NOT NULL,
  tax_total numeric(14,2) NOT NULL,
  grand_total numeric(14,2) NOT NULL,
  status text NOT NULL,
  salesperson text NOT NULL DEFAULT '',
  credit_override boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  dispatched_on text NOT NULL DEFAULT '',
  delivered_on text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id);

CREATE TABLE IF NOT EXISTS payments (
  ord bigserial,
  id text PRIMARY KEY,
  order_id text REFERENCES orders(id),
  customer_id text NOT NULL REFERENCES customers(id),
  customer_name text NOT NULL,
  date text NOT NULL,
  mode text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reference text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS payments_customer_idx ON payments (customer_id);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);

CREATE TABLE IF NOT EXISTS logs (
  n bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL
);
`;

export async function migrate() {
  await withWrite(async c => {
    await c.query(SCHEMA);
    await c.query(`INSERT INTO meta (key, value) VALUES ('version', '1') ON CONFLICT DO NOTHING`);
  });
}
