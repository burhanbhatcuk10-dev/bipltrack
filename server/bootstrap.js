import crypto from 'node:crypto';
import { withWrite, bump } from './db.js';
import { hashPassword } from './auth.js';
import { seed } from '../src/lib/seed.js';
import { passwordProblem } from '../src/lib/password.js';

const prod = process.env.NODE_ENV === 'production';
const randomPassword = () => 'Bi-' + crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x') + '7';
const truthy = v => ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());

async function addUser(c, u, password) {
  const { salt, hash } = await hashPassword(password);
  await c.query(
    `INSERT INTO users (id, name, title, role, email, active, pw_salt, pw_hash, must_change) VALUES ($1,$2,$3,$4,$5,true,$6,$7,true)`,
    [u.id, u.name, u.title, u.role, u.email, salt, hash]);
}

/** First start only: creates the admin account, company profile and counters (and demo data if asked). */
export async function bootstrap() {
  await withWrite(async c => {
    const n = await c.query('SELECT count(*)::int AS n FROM users');
    if (n.rows[0].n > 0) return;

    const demo = truthy(process.env.SEED_DEMO);
    const d = seed();
    const adminEmail = (process.env.ADMIN_EMAIL || 'zaffer@bandayimpex.com').trim();
    let adminPw = process.env.ADMIN_PASSWORD;
    let generated = false;
    if (adminPw && passwordProblem(adminPw)) {
      console.error('ADMIN_PASSWORD is ignored: ' + passwordProblem(adminPw));
      adminPw = '';
    }
    if (!adminPw) { adminPw = prod ? randomPassword() : 'Admin@123'; generated = prod; }

    const admin = { id: 'U-1', name: process.env.ADMIN_NAME || 'Mr. Zaffer Banday', title: 'Managing Director', role: 'admin', email: adminEmail };
    await addUser(c, admin, adminPw);
    const lines = [`Admin account created: ${adminEmail}`];
    if (generated) lines.push(`Initial admin password (shown once, change it at first sign-in): ${adminPw}`);
    else if (!prod) lines.push(`Development admin password: ${adminPw}`);

    await c.query(`INSERT INTO company (id, data) VALUES (1, $1)`, [JSON.stringify(d.company)]);
    let seq = { ORD: 1001, PAY: 1001, P: 101, C: 201, L: 301, U: 2 };

    if (demo) {
      seq = { ...d.seq, ORD: d.seq.ORD, PAY: d.seq.PAY };
      for (const u of d.users.filter(x => x.id !== 'U-1')) {
        const pw = prod ? randomPassword() : u.role === 'sales' ? 'Sales@123' : 'Store@123';
        await addUser(c, u, pw);
        lines.push(`Demo user ${u.email}: ${pw}`);
      }
      for (const p of [...d.products].reverse()) {
        await c.query(`INSERT INTO products (id,name,category,warehouse,stock,min_stock,price,gst) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [p.id, p.name, p.category, p.warehouse, p.stock, p.minStock, p.price, p.gst]);
      }
      for (const x of d.customers) {
        await c.query(`INSERT INTO customers (id,name,type,market,phone,gstin,credit_limit,opening,on_hold,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [x.id, x.name, x.type, x.market, x.phone, x.gstin, x.creditLimit, x.opening, x.onHold, x.notes || '']);
      }
      for (const l of [...d.leads].reverse()) {
        await c.query(`INSERT INTO leads (id,business_name,contact_person,phone,market,stage,potential,assigned_to,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [l.id, l.businessName, l.contactPerson, l.phone, l.market, l.stage, l.potential, l.assignedTo, l.notes || '']);
      }
      for (const o of [...d.orders].reverse()) {
        await c.query(`INSERT INTO orders (id,date,customer_id,customer_name,market,items,subtotal,tax_total,grand_total,status,salesperson,credit_override,notes,dispatched_on,delivered_on)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [o.id, o.date, o.customerId, o.customerName, o.market, JSON.stringify(o.items), o.subtotal, o.taxTotal, o.grandTotal, o.status, o.salesperson, o.creditOverride, o.notes || '', o.dispatchedOn, o.deliveredOn]);
      }
      for (const p of [...d.payments].reverse()) {
        await c.query(`INSERT INTO payments (id,order_id,customer_id,customer_name,date,mode,amount,reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [p.id, p.orderId || null, p.customerId, p.customerName, p.date, p.mode, p.amount, p.reference]);
      }
    }
    for (const [name, value] of Object.entries(seq)) {
      if (name === 'LOG') continue;
      await c.query(`INSERT INTO counters (name, value) VALUES ($1, $2)`, [name, value]);
    }
    await c.query(`INSERT INTO logs (actor, action) VALUES ('System', $1)`, [demo ? 'System created with demo data' : 'System created']);
    await bump(c);
    console.log('\n' + lines.join('\n') + '\n');
  });
}
