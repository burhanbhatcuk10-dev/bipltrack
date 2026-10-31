import { stamp } from './util.js';

const num = v => Number(v);

/** Everything the app screens need, in the same shape the screens already use. Internal: includes emails. */
export async function loadState(db, meId, { logs = false } = {}) {
  const q = async (t, p) => (await db.query(t, p)).rows;

  const products = (await q('SELECT * FROM products ORDER BY ord DESC')).map(r => ({
    id: r.id, name: r.name, category: r.category, warehouse: r.warehouse,
    stock: num(r.stock), minStock: num(r.min_stock), price: num(r.price), gst: num(r.gst)
  }));
  const customers = (await q('SELECT * FROM customers ORDER BY ord ASC')).map(r => ({
    id: r.id, name: r.name, type: r.type, market: r.market, phone: r.phone, gstin: r.gstin,
    creditLimit: num(r.credit_limit), opening: num(r.opening), onHold: r.on_hold, notes: r.notes,
    ...(r.from_lead ? { fromLead: r.from_lead } : {})
  }));
  const leads = (await q('SELECT * FROM leads ORDER BY ord DESC')).map(r => ({
    id: r.id, businessName: r.business_name, contactPerson: r.contact_person, phone: r.phone, market: r.market,
    stage: r.stage, potential: num(r.potential), assignedTo: r.assigned_to, notes: r.notes
  }));
  const orders = (await q('SELECT * FROM orders ORDER BY date DESC, ord DESC')).map(r => ({
    id: r.id, date: r.date, customerId: r.customer_id, customerName: r.customer_name, market: r.market,
    items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items,
    subtotal: num(r.subtotal), taxTotal: num(r.tax_total), grandTotal: num(r.grand_total),
    status: r.status, salesperson: r.salesperson, creditOverride: r.credit_override, notes: r.notes,
    dispatchedOn: r.dispatched_on, deliveredOn: r.delivered_on
  }));
  const payments = (await q('SELECT * FROM payments ORDER BY date DESC, ord DESC')).map(r => ({
    id: r.id, orderId: r.order_id || '', customerId: r.customer_id, customerName: r.customer_name,
    date: r.date, mode: r.mode, amount: num(r.amount), reference: r.reference
  }));
  const users = (await q('SELECT id, name, title, role, email, active, must_change FROM users ORDER BY created_at, id')).map(r => ({
    id: r.id, name: r.name, title: r.title, role: r.role, email: r.email, active: r.active, mustChange: r.must_change
  }));
  const company = (await q('SELECT data FROM company WHERE id = 1'))[0];
  const logRows = logs ? (await q('SELECT n, ts, actor, action FROM logs ORDER BY n DESC LIMIT 500')).map(r => ({
    id: 'LOG-' + r.n, ts: stamp(r.ts), user: r.actor, action: r.action
  })) : [];

  return {
    products, customers, leads, orders, payments, users, logs: logRows,
    company: company ? (typeof company.data === 'string' ? JSON.parse(company.data) : company.data) : {},
    session: meId
  };
}

/** What a given user may see: staff names for everyone, emails and the audit trail for admins only. */
export function publicState(S, me) {
  const admin = me.role === 'admin';
  return {
    ...S,
    logs: admin ? S.logs : [],
    users: S.users.map(u => (admin || u.id === me.id
      ? u
      : { id: u.id, name: u.name, title: u.title, role: u.role, active: u.active }))
  };
}
