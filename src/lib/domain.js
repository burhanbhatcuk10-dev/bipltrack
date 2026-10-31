// Pure business rules. Every function takes the state object `S` as its first argument.
import { r2, daysBetween, today, monthKey } from './utils.js';
import { totalsOf } from './seed.js';

export const PERMS = {
  admin: ['*'],
  sales: ['order.create', 'customer.add', 'lead.manage', 'payment.add', 'order.deliver'],
  warehouse: ['order.dispatch', 'order.deliver', 'stock.adjust']
};
export const ROLE_LABEL = { admin: 'Admin', sales: 'Salesperson', warehouse: 'Store' };
export const STAGES = ['Pending Review', 'Pack Approval', 'Dispatched', 'Delivered'];
export const LEAD_STAGES = ['Initial Contact', 'Qualified', 'Negotiation', 'Won', 'Lost'];
export const ORD_PILL = { 'Pending Review': 'warn', 'Pack Approval': 'info', Dispatched: 'violet', Delivered: 'good', Cancelled: 'mute' };
export const PAY_PILL = { Paid: 'good', Partial: 'warn', Unpaid: 'bad', Cancelled: 'mute' };

// The signed-in user, or null when nobody is signed in. There is no fallback user.
export const currentUser = S => S.users.find(u => u.id === S.session && u.active) || null;
export const canDo = (S, action) => {
  const u = currentUser(S);
  if (!u) return false;
  const p = PERMS[u.role] || [];
  return p.includes('*') || p.includes(action);
};
export const userName = (S, id) => (S.users.find(u => u.id === id) || { name: id || '—' }).name;

export const orderPaid = (S, o) => r2(S.payments.filter(p => p.orderId === o.id).reduce((a, p) => a + p.amount, 0));
export const orderDue = (S, o) => r2(Math.max(0, o.grandTotal - orderPaid(S, o)));
export function payStatus(S, o) {
  if (o.status === 'Cancelled') return 'Cancelled';
  const paid = orderPaid(S, o);
  return paid >= o.grandTotal - 0.005 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
}
export const custOrders = (S, c) => S.orders.filter(o => o.customerId === c.id && o.status !== 'Cancelled');
export const unallocated = (S, c) => r2(S.payments.filter(p => p.customerId === c.id && !p.orderId).reduce((a, p) => a + p.amount, 0));
export function outstanding(S, c) {
  const billed = custOrders(S, c).reduce((a, o) => a + o.grandTotal, 0);
  const paid = S.payments.filter(p => p.customerId === c.id).reduce((a, p) => a + p.amount, 0);
  return r2(c.opening + billed - paid);
}
export const stateCode = (S, g) => (g && /^\d{2}/.test(g) ? g.slice(0, 2) : (S.company.gstin || '01').slice(0, 2));
export const lowStock = S => S.products.filter(p => p.stock <= p.minStock);

export function agingRows(S) {
  return S.customers.map(c => {
    const b = [0, 0, 0, 0];
    custOrders(S, c).forEach(o => {
      const d = orderDue(S, o);
      if (d <= 0) return;
      const age = daysBetween(o.date, today());
      b[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += d;
    });
    return { c, b: b.map(r2), open: c.opening, adv: unallocated(S, c), net: outstanding(S, c) };
  });
}

export function lastMonths(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({
      key: x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'),
      label: x.toLocaleDateString('en-IN', { month: 'short' }),
      year: x.getFullYear()
    });
  }
  return out;
}

export function nextStageAction(S, o) {
  if (o.status === 'Pending Review') return canDo(S, '*') ? 'Approve for packing' : null;
  if (o.status === 'Pack Approval') return canDo(S, '*') || canDo(S, 'order.dispatch') ? 'Dispatch' : null;
  if (o.status === 'Dispatched') return canDo(S, '*') || canDo(S, 'order.deliver') ? 'Mark delivered' : null;
  return null;
}

export { totalsOf, monthKey };
