// Every business action. Each runs inside one database transaction while holding the write lock,
// re-checks the user's permission, validates its input, and returns the message shown to the user.
import { nextId } from './db.js';
import { hashPassword, verifyPassword, endUserSessions } from './auth.js';
import { fail, text, amount, whole, oneOf, isDate, today, EMAIL_RE, HttpError } from './util.js';
import { r2, inr, GSTIN_RE } from '../src/lib/utils.js';
import { buildItems, totalsOf } from '../src/lib/seed.js';
import { ROLE_LABEL, LEAD_STAGES, orderPaid, orderDue, outstanding } from '../src/lib/domain.js';
import { passwordProblem } from '../src/lib/password.js';

const PAY_MODES = ['UPI / GPay', 'Bank Transfer (NEFT)', 'Cheque', 'Cash'];

const allow = (x, ...perms) => {
  if (x.can('*') || perms.some(x.can)) return;
  fail('Your role does not have permission to do this.', 403);
};
const adminOnly = x => { if (!x.can('*')) fail('Only an admin can do this.', 403); };

/* ---------- orders ---------- */
export async function placeOrder(x, b) {
  allow(x, 'order.create');
  const c = x.S.customers.find(k => k.id === b.customerId);
  if (!c) fail('Select a customer.');
  if (c.onHold) fail(`${c.name} is on credit hold. Release the hold before placing an order.`);
  if (!Array.isArray(b.items) || !b.items.length) fail('Add at least one item.');
  if (b.items.length > 100) fail('An order can have at most 100 lines.');

  const wanted = new Map(); // one line per product, quantities added together
  for (const i of b.items) {
    const qty = whole(i && i.qty, 'Quantity', { min: 1, max: 1000000 });
    if (!x.S.products.some(p => p.id === (i && i.pid))) fail('One of the products no longer exists.');
    wanted.set(i.pid, (wanted.get(i.pid) || 0) + qty);
  }
  const items = buildItems([...wanted.entries()], x.S.products);
  const t = totalsOf(items);
  const exposure = r2(outstanding(x.S, c) + t.grandTotal);
  const exceeds = exposure > c.creditLimit;
  if (exceeds && !(x.can('*') && b.override === true)) {
    fail(`This order takes ${c.name} to ${inr(exposure)}, above the ${inr(c.creditLimit)} limit.${x.can('*') ? ' Tick the override to proceed.' : ' Ask an admin to approve an override.'}`);
  }
  const id = await nextId(x.c, 'ORD');
  await x.c.query(
    `INSERT INTO orders (id,date,customer_id,customer_name,market,items,subtotal,tax_total,grand_total,status,salesperson,credit_override,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending Review',$10,$11,$12)`,
    [id, today(), c.id, c.name, c.market, JSON.stringify(items), t.subtotal, t.taxTotal, t.grandTotal, x.me.id, exceeds, text(b.notes, { max: 500 })]);
  await x.log(`Created order ${id} for ${c.name} (${inr(t.grandTotal)})${exceeds ? ' with credit-limit override' : ''}`);
  return `Order ${id} placed and sent for review.`;
}

export async function advanceOrder(x, id) {
  const o = x.S.orders.find(k => k.id === id);
  if (!o) fail('Order not found.', 404);
  const c = x.S.customers.find(k => k.id === o.customerId);
  let next;
  if (o.status === 'Pending Review') {
    if (!x.can('*')) fail('Only an admin can approve orders for packing.', 403);
    if (c && c.onHold) fail(`${c.name} is on credit hold. Release the hold first.`);
    next = 'Pack Approval';
  } else if (o.status === 'Pack Approval') {
    allow(x, 'order.dispatch');
    const need = new Map();
    o.items.forEach(i => need.set(i.productId, (need.get(i.productId) || 0) + i.qty));
    const short = [...need].filter(([pid, q]) => { const p = x.S.products.find(k => k.id === pid); return !p || p.stock < q; });
    if (short.length) {
      fail('Not enough stock to dispatch: ' + short.map(([pid, q]) => {
        const p = x.S.products.find(k => k.id === pid);
        return `${p ? p.name : pid} (need ${q}, have ${p ? p.stock : 0})`;
      }).join('; '));
    }
    for (const [pid, q] of need) await x.c.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [q, pid]);
    await x.c.query(`UPDATE orders SET dispatched_on = $2 WHERE id = $1`, [id, today()]);
    next = 'Dispatched';
  } else if (o.status === 'Dispatched') {
    allow(x, 'order.deliver');
    await x.c.query(`UPDATE orders SET delivered_on = $2 WHERE id = $1`, [id, today()]);
    next = 'Delivered';
  } else fail('This order cannot move forward.');
  await x.c.query('UPDATE orders SET status = $2 WHERE id = $1', [id, next]);
  await x.log(`Moved order ${id} to ${next}`);
  return `Order ${id} is now ${next}.`;
}

export async function cancelOrder(x, id) {
  adminOnly(x);
  const o = x.S.orders.find(k => k.id === id);
  if (!o) fail('Order not found.', 404);
  if (!['Pending Review', 'Pack Approval'].includes(o.status)) fail('Only orders not yet dispatched can be cancelled.');
  if (orderPaid(x.S, o) > 0) fail('This order has payments recorded. Move those payments to another order first.');
  await x.c.query(`UPDATE orders SET status = 'Cancelled' WHERE id = $1`, [id]);
  await x.log(`Cancelled order ${id}`);
  return `Order ${id} cancelled.`;
}

/* ---------- products ---------- */
function productFields(b) {
  const name = text(b.name, { max: 120, required: true, label: 'Product name' });
  const price = amount(b.price, 'Price', { min: 0.01, max: 1e7 });
  const minStock = whole(b.minStock === '' || b.minStock == null ? 0 : b.minStock, 'Safety stock', { max: 1e7 });
  const gst = amount(b.gst, 'GST %', { max: 40 });
  return { name, price, minStock, gst, category: text(b.category, { max: 60 }), warehouse: text(b.warehouse, { max: 80 }) };
}
export async function saveProduct(x, b, editId) {
  adminOnly(x);
  const f = productFields(b);
  if (editId) {
    if (!x.S.products.some(p => p.id === editId)) fail('Product not found.', 404);
    await x.c.query('UPDATE products SET name=$2, category=$3, warehouse=$4, min_stock=$5, price=$6, gst=$7 WHERE id=$1',
      [editId, f.name, f.category, f.warehouse, f.minStock, f.price, f.gst]);
    await x.log(`Edited product ${editId}`);
    return `${editId} updated.`;
  }
  const stock = whole(b.stock === '' || b.stock == null ? 0 : b.stock, 'Opening stock', { max: 1e8 });
  const id = await nextId(x.c, 'P');
  await x.c.query('INSERT INTO products (id,name,category,warehouse,stock,min_stock,price,gst) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, f.name, f.category, f.warehouse, stock, f.minStock, f.price, f.gst]);
  await x.log(`Added product ${id} ${f.name}`);
  return `${f.name} added.`;
}

export async function saveStock(x, b, id) {
  allow(x, 'stock.adjust');
  const p = x.S.products.find(k => k.id === id);
  if (!p) fail('Product not found.', 404);
  const kind = oneOf(b.kind, ['in', 'out', 'set'], 'Movement');
  const q = whole(b.qty, 'Quantity', { max: 1e8 });
  const reason = text(b.reason, { max: 200, required: true, label: 'Reason' });
  if (kind === 'out' && q > p.stock) fail(`Only ${p.stock} units are in stock.`);
  const after = kind === 'in' ? p.stock + q : kind === 'out' ? p.stock - q : q;
  await x.c.query('UPDATE products SET stock = $2 WHERE id = $1', [id, after]);
  await x.log(`Stock ${id}: ${p.stock} → ${after} (${reason})`);
  return `${id} stock is now ${after}.`;
}

/* ---------- customers & leads ---------- */
export async function saveCustomer(x, b, editId) {
  allow(x, 'customer.add');
  const gstin = text(b.gstin, { max: 15 }).toUpperCase();
  if (gstin && !GSTIN_RE.test(gstin)) fail('GSTIN format is invalid. It must be 15 characters, e.g. 01AABCR1234F1Z5.');
  if (gstin && x.S.customers.some(k => k.gstin === gstin && k.id !== editId)) fail('Another customer already uses this GSTIN.');
  const base = {
    name: text(b.name, { max: 120, required: true, label: 'Business name' }),
    type: oneOf(b.type, ['Retail', 'Wholesale'], 'Type'),
    market: text(b.market, { max: 120 }), phone: text(b.phone, { max: 40 }), notes: text(b.notes, { max: 500 })
  };
  const admin = x.can('*');
  if (editId) {
    const cur = x.S.customers.find(k => k.id === editId);
    if (!cur) fail('Customer not found.', 404);
    const limit = admin ? amount(b.creditLimit || 0, 'Credit limit', { max: 1e10 }) : cur.creditLimit;
    await x.c.query('UPDATE customers SET name=$2, type=$3, market=$4, phone=$5, gstin=$6, notes=$7, credit_limit=$8 WHERE id=$1',
      [editId, base.name, base.type, base.market, base.phone, gstin, base.notes, limit]);
    await x.log(`Edited customer ${editId}`);
    return `${base.name} updated.`;
  }
  const limit = admin ? amount(b.creditLimit || 0, 'Credit limit', { max: 1e10 }) : 50000;
  const opening = admin ? amount(b.opening || 0, 'Opening balance', { min: -1e10, max: 1e10 }) : 0;
  const id = await nextId(x.c, 'C');
  await x.c.query(
    'INSERT INTO customers (id,name,type,market,phone,gstin,credit_limit,opening,on_hold,notes,from_lead) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10)',
    [id, base.name, base.type, base.market, base.phone, gstin, limit, opening, base.notes, b.fromLead ? text(b.fromLead, { max: 40 }) : null]);
  await x.log(`Added customer ${id} ${base.name}`);
  return `${base.name} added.`;
}

export async function toggleHold(x, id) {
  adminOnly(x);
  const c = x.S.customers.find(k => k.id === id);
  if (!c) fail('Customer not found.', 404);
  await x.c.query('UPDATE customers SET on_hold = $2 WHERE id = $1', [id, !c.onHold]);
  await x.log(`${!c.onHold ? 'Placed' : 'Released'} credit hold on ${c.name}`);
  return `${c.name} is now ${c.onHold ? 'active' : 'on credit hold'}.`;
}

export async function saveLead(x, b, editId) {
  allow(x, 'lead.manage');
  const v = {
    businessName: text(b.businessName, { max: 120, required: true, label: 'Business name' }),
    contactPerson: text(b.contactPerson, { max: 80 }), phone: text(b.phone, { max: 40 }), market: text(b.market, { max: 120 }),
    potential: amount(b.potential || 0, 'Potential', { max: 1e10 }),
    stage: oneOf(b.stage, LEAD_STAGES, 'Stage'),
    assignedTo: x.S.users.some(u => u.id === b.assignedTo) ? b.assignedTo : x.me.id,
    notes: text(b.notes, { max: 500 })
  };
  if (editId) {
    if (!x.S.leads.some(l => l.id === editId)) fail('Lead not found.', 404);
    await x.c.query('UPDATE leads SET business_name=$2, contact_person=$3, phone=$4, market=$5, potential=$6, stage=$7, assigned_to=$8, notes=$9 WHERE id=$1',
      [editId, v.businessName, v.contactPerson, v.phone, v.market, v.potential, v.stage, v.assignedTo, v.notes]);
    await x.log(`Edited lead ${v.businessName}`);
    return 'Lead updated.';
  }
  const id = await nextId(x.c, 'L');
  await x.c.query('INSERT INTO leads (id,business_name,contact_person,phone,market,potential,stage,assigned_to,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, v.businessName, v.contactPerson, v.phone, v.market, v.potential, v.stage, v.assignedTo, v.notes]);
  await x.log(`Created lead ${id} ${v.businessName}`);
  return 'Lead added.';
}

export async function advanceLead(x, id) {
  allow(x, 'lead.manage');
  const order = ['Initial Contact', 'Qualified', 'Negotiation', 'Won'];
  const l = x.S.leads.find(k => k.id === id);
  if (!l) fail('Lead not found.', 404);
  const i = order.indexOf(l.stage);
  if (i < 0 || i >= 3) fail('This lead cannot move forward.');
  await x.c.query('UPDATE leads SET stage = $2 WHERE id = $1', [id, order[i + 1]]);
  await x.log(`Lead ${l.businessName} moved to ${order[i + 1]}`);
  return `${l.businessName}: ${order[i + 1]}.`;
}
export async function markLost(x, id) {
  allow(x, 'lead.manage');
  const l = x.S.leads.find(k => k.id === id);
  if (!l) fail('Lead not found.', 404);
  await x.c.query(`UPDATE leads SET stage = 'Lost' WHERE id = $1`, [id]);
  await x.log(`Marked lead ${l.businessName} as lost`);
  return `${l.businessName} marked as lost.`;
}

/* ---------- payments ---------- */
export async function savePayment(x, b) {
  allow(x, 'payment.add');
  const amt = amount(b.amount, 'Amount', { min: 0.01, max: 1e10 });
  const c = x.S.customers.find(k => k.id === b.customer);
  if (!c) fail('Select a customer.');
  const o = b.order ? x.S.orders.find(k => k.id === b.order) : null;
  if (b.order && !o) fail('That order no longer exists.');
  if (o) {
    if (o.customerId !== c.id) fail('That order belongs to a different customer.');
    if (o.status === 'Cancelled') fail('That order is cancelled.');
    if (amt > orderDue(x.S, o) + 0.005) fail(`${o.id} has only ${inr(orderDue(x.S, o))} due. Record the excess as an on-account payment.`);
  }
  const id = await nextId(x.c, 'PAY');
  const date = isDate(b.date) ? b.date : today();
  const reference = text(b.reference, { max: 60 }) || 'REF-' + String(Date.now()).slice(-6);
  await x.c.query('INSERT INTO payments (id,order_id,customer_id,customer_name,date,mode,amount,reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, o ? o.id : null, c.id, c.name, date, oneOf(b.mode, PAY_MODES, 'Payment mode'), amt, reference]);
  await x.log(`Recorded ${id} ${inr(amt)} from ${c.name}${o ? ' against ' + o.id : ' on account'}`);
  return `Payment of ${inr(amt)} recorded.`;
}

/* ---------- users, passwords, company ---------- */
export async function saveUser(x, b) {
  adminOnly(x);
  const email = text(b.email, { max: 120, required: true, label: 'Email' });
  if (!EMAIL_RE.test(email)) fail('Enter a valid email address.');
  oneOf(b.role, Object.keys(ROLE_LABEL), 'Role');
  if (x.S.users.some(u => u.email.trim().toLowerCase() === email.toLowerCase())) fail('A user with this email already exists.');
  const bad = passwordProblem(b.password);
  if (bad) fail(bad);
  const name = text(b.name, { max: 80, required: true, label: 'Name' });
  const id = await nextId(x.c, 'U');
  const { salt, hash } = await hashPassword(b.password);
  await x.c.query('INSERT INTO users (id,name,title,role,email,active,pw_salt,pw_hash,must_change) VALUES ($1,$2,$3,$4,$5,true,$6,$7,true)',
    [id, name, text(b.title, { max: 80 }), b.role, email, salt, hash]);
  await x.log(`Created user ${name} (${ROLE_LABEL[b.role]})`);
  return `${name} added.`;
}

export async function toggleUser(x, id) {
  adminOnly(x);
  const u = x.S.users.find(k => k.id === id);
  if (!u) fail('User not found.', 404);
  if (u.id === x.me.id) fail('You cannot disable your own account.');
  if (u.role === 'admin' && u.active && x.S.users.filter(k => k.role === 'admin' && k.active).length < 2) fail('At least one active admin is required.');
  await x.c.query('UPDATE users SET active = $2 WHERE id = $1', [id, !u.active]);
  if (u.active) await x.c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await x.log(`${!u.active ? 'Enabled' : 'Disabled'} user ${u.name}`);
  return `${u.name} ${!u.active ? 'enabled' : 'disabled'}.`;
}

export async function resetPassword(x, id, password) {
  adminOnly(x);
  const u = x.S.users.find(k => k.id === id);
  if (!u) fail('User not found.', 404);
  const bad = passwordProblem(password);
  if (bad) fail(bad);
  const { salt, hash } = await hashPassword(password);
  await x.c.query('UPDATE users SET pw_salt=$2, pw_hash=$3, must_change=true WHERE id=$1', [id, salt, hash]);
  await x.c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await x.c.query('DELETE FROM login_throttle WHERE email = $1', [u.email.trim().toLowerCase()]);
  await x.log(`Reset password for ${u.name}`);
  return `Temporary password set for ${u.name}. They must change it at next sign-in.`;
}

export async function changePassword(x, b, token) {
  const forced = x.me.mustChange;
  const row = (await x.c.query('SELECT pw_salt, pw_hash FROM users WHERE id = $1', [x.me.id])).rows[0];
  if (!forced && !(await verifyPassword(String(b.current || ''), row.pw_salt, row.pw_hash))) fail('Current password is incorrect.');
  const bad = passwordProblem(b.next);
  if (bad) fail(bad);
  if (b.next !== b.confirm) fail('The two new passwords do not match.');
  if (await verifyPassword(b.next, row.pw_salt, row.pw_hash)) fail('Choose a password different from the current one.');
  const { salt, hash } = await hashPassword(b.next);
  await x.c.query('UPDATE users SET pw_salt=$2, pw_hash=$3, must_change=false WHERE id=$1', [x.me.id, salt, hash]);
  await endUserSessions(x.c, x.me.id, token); // other devices must sign in again with the new password
  await x.log('Changed own password');
  return 'Password updated.';
}

export async function saveCompany(x, b) {
  adminOnly(x);
  const gstin = text(b.gstin, { max: 15 }).toUpperCase();
  if (!GSTIN_RE.test(gstin)) fail('Enter a valid 15-character GSTIN.');
  const data = {
    name: text(b.name, { max: 120, required: true, label: 'Legal name' }), gstin,
    address: text(b.address, { max: 300, required: true, label: 'Address' }),
    phone: text(b.phone, { max: 40 }), email: text(b.email, { max: 120 }),
    bank: text(b.bank, { max: 500 }), terms: text(b.terms, { max: 1000 })
  };
  await x.c.query('UPDATE company SET data = $1 WHERE id = 1', [JSON.stringify(data)]);
  await x.log('Updated company profile');
  return 'Company profile saved.';
}

/* ---------- backup & restore ---------- */
export async function exportBackup(x) {
  adminOnly(x);
  const counters = {};
  (await x.c.query('SELECT name, value FROM counters')).rows.forEach(r => { counters[r.name] = Number(r.value); });
  const { products, customers, leads, orders, payments, company } = x.S;
  const users = x.S.users.map(({ id, name, title, role, email, active }) => ({ id, name, title, role, email, active }));
  return { exportedAt: new Date().toISOString(), format: 'banday-erp-backup', products, customers, leads, orders, payments, users, company, seq: counters };
}

const numOf = id => { const m = /(\d+)$/.exec(String(id || '')); return m ? Number(m[1]) : 0; };
const str = (v, max = 500) => (v == null ? '' : String(v)).slice(0, max);
const dateOr = v => (isDate(v) ? v : today());

/** Replaces all business data with a backup file (this app's or the earlier browser-only version's). */
export async function restoreBackup(x, o) {
  adminOnly(x);
  const need = ['products', 'customers', 'leads', 'orders', 'payments'];
  if (!o || typeof o !== 'object' || need.some(k => !Array.isArray(o[k]))) fail('That file is not a valid Banday ERP backup.');
  const c = x.c;
  try {
    await c.query('SAVEPOINT restore');
    await c.query('TRUNCATE payments, orders, leads, customers, products');
    for (const p of [...o.products].reverse()) {
      await c.query('INSERT INTO products (id,name,category,warehouse,stock,min_stock,price,gst) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [str(p.id, 40), str(p.name, 120), str(p.category, 60), str(p.warehouse, 80), Math.max(0, Math.floor(Number(p.stock) || 0)), Math.max(0, Math.floor(Number(p.minStock) || 0)), Number(p.price), Number(p.gst) || 0]);
    }
    for (const k of o.customers) {
      await c.query('INSERT INTO customers (id,name,type,market,phone,gstin,credit_limit,opening,on_hold,notes,from_lead) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [str(k.id, 40), str(k.name, 120), k.type === 'Wholesale' ? 'Wholesale' : 'Retail', str(k.market, 120), str(k.phone, 40), str(k.gstin, 15).toUpperCase(), Number(k.creditLimit) || 0, Number(k.opening) || 0, !!k.onHold, str(k.notes), k.fromLead ? str(k.fromLead, 40) : null]);
    }
    for (const l of [...o.leads].reverse()) {
      await c.query('INSERT INTO leads (id,business_name,contact_person,phone,market,stage,potential,assigned_to,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [str(l.id, 40), str(l.businessName, 120), str(l.contactPerson, 80), str(l.phone, 40), str(l.market, 120), LEAD_STAGES.includes(l.stage) ? l.stage : 'Initial Contact', Number(l.potential) || 0, str(l.assignedTo, 40), str(l.notes)]);
    }
    for (const r of [...o.orders].reverse()) {
      await c.query(`INSERT INTO orders (id,date,customer_id,customer_name,market,items,subtotal,tax_total,grand_total,status,salesperson,credit_override,notes,dispatched_on,delivered_on)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [str(r.id, 40), dateOr(r.date), str(r.customerId, 40), str(r.customerName, 120), str(r.market, 120), JSON.stringify(Array.isArray(r.items) ? r.items : []),
        Number(r.subtotal) || 0, Number(r.taxTotal) || 0, Number(r.grandTotal) || 0, str(r.status, 30), str(r.salesperson, 40), !!r.creditOverride, str(r.notes),
        isDate(r.dispatchedOn) ? r.dispatchedOn : '', isDate(r.deliveredOn) ? r.deliveredOn : '']);
    }
    for (const p of [...o.payments].reverse()) {
      await c.query('INSERT INTO payments (id,order_id,customer_id,customer_name,date,mode,amount,reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [str(p.id, 40), p.orderId ? str(p.orderId, 40) : null, str(p.customerId, 40), str(p.customerName, 120), dateOr(p.date), str(p.mode, 40), Number(p.amount), str(p.reference, 60)]);
    }
    // Staff in the backup that this system does not have yet come back disabled, so old records keep their names.
    let added = 0;
    for (const u of Array.isArray(o.users) ? o.users : []) {
      const id = str(u.id, 40), email = str(u.email, 120).trim();
      if (!id || !email || !['admin', 'sales', 'warehouse'].includes(u.role)) continue;
      const r = await c.query(
        `INSERT INTO users (id,name,title,role,email,active,pw_salt,pw_hash,must_change) VALUES ($1,$2,$3,$4,$5,false,'','',true) ON CONFLICT DO NOTHING`,
        [id, str(u.name, 80) || id, str(u.title, 80), u.role, email]);
      added += r.rowCount || 0;
    }
    if (o.company && typeof o.company === 'object') {
      const k = o.company;
      await c.query('UPDATE company SET data = $1 WHERE id = 1', [JSON.stringify({
        name: str(k.name, 120) || 'Company', gstin: str(k.gstin, 15).toUpperCase(), address: str(k.address, 300), phone: str(k.phone, 40),
        email: str(k.email, 120), bank: str(k.bank), terms: str(k.terms, 1000)
      })]);
    }
    // Numbering continues after the highest number in the data, so new records never clash.
    const maxOf = (rows) => rows.reduce((m, r) => Math.max(m, numOf(r.id)), 0);
    const users = (await c.query('SELECT id FROM users')).rows;
    const next = {
      ORD: Math.max(Number(o.seq && o.seq.ORD) || 0, maxOf(o.orders) + 1, 1001),
      PAY: Math.max(Number(o.seq && o.seq.PAY) || 0, maxOf(o.payments) + 1, 1001),
      P: Math.max(Number(o.seq && o.seq.P) || 0, maxOf(o.products) + 1, 101),
      C: Math.max(Number(o.seq && o.seq.C) || 0, maxOf(o.customers) + 1, 201),
      L: Math.max(Number(o.seq && o.seq.L) || 0, maxOf(o.leads) + 1, 301),
      U: Math.max(Number(o.seq && o.seq.U) || 0, maxOf(users) + 1, 2)
    };
    for (const [name, v] of Object.entries(next)) {
      await c.query('INSERT INTO counters (name, value) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET value = GREATEST(counters.value, EXCLUDED.value)', [name, v]);
    }
    await c.query('RELEASE SAVEPOINT restore');
    await x.log(`Restored data from a backup (${o.orders.length} orders, ${o.customers.length} customers, ${o.products.length} products${added ? `, ${added} staff added as disabled` : ''})`);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await c.query('ROLLBACK TO SAVEPOINT restore').catch(() => {});
    fail('The backup could not be restored: ' + (e.detail || e.message || 'the data is inconsistent') + '. Nothing was changed.');
  }
  return 'Backup restored.';
}
