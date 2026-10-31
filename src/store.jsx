import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { downloadFile, toCSV, today } from './lib/utils.js';
import { currentUser, canDo, orderPaid, orderDue, payStatus, outstanding } from './lib/domain.js';
import { passwordProblem } from './lib/password.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

// The browser holds a copy of the data. The server (and its database) is the source of truth.
const EMPTY = { products: [], customers: [], leads: [], orders: [], payments: [], users: [], logs: [], company: { name: 'Banday Impex ERP' }, session: null };
const POLL_MS = 15000;

async function request(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    const err = new Error('Cannot reach the server. Check your connection and try again.');
    err.offline = true;
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `The server returned an error (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function StoreProvider({ children }) {
  const [S, setS] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const version = useRef(0);
  const signedIn = useRef(false);
  const activity = useRef(false);
  const queue = useRef(Promise.resolve());
  const inflight = useRef(new Set());

  const toast = useCallback((msg, type = 'success') => {
    const id = Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'error' ? 5200 : 3200);
  }, []);

  const apply = useCallback(r => {
    if (r && r.state) {
      version.current = r.version || 0;
      signedIn.current = !!r.state.session;
      setS(r.state);
    }
  }, []);

  const loggedOut = useCallback(async message => {
    signedIn.current = false;
    version.current = 0;
    let name = EMPTY.company.name;
    try { name = (await request('GET', '/public')).company.name; } catch (e) { /* keep default */ }
    setS({ ...EMPTY, company: { name } });
    if (message) toast(message, 'error');
  }, [toast]);

  /* ---------- first load ---------- */
  useEffect(() => {
    (async () => {
      try { apply(await request('GET', '/state')); }
      catch (e) { await loggedOut(e.offline ? e.message : null); }
      setReady(true);
    })();
  }, [apply, loggedOut]);

  /* ---------- keep the screen current: other people's changes appear within seconds ---------- */
  useEffect(() => {
    const mark = () => { activity.current = true; };
    const ev = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    ev.forEach(e => window.addEventListener(e, mark, { passive: true }));
    let running = false;
    const poll = async () => {
      if (!signedIn.current || running || document.hidden) return;
      running = true;
      const active = activity.current;
      activity.current = false;
      try {
        const r = await request('GET', `/state?v=${version.current}&active=${active ? 1 : 0}`);
        setOnline(true);
        if (!r.unchanged) apply(r);
      } catch (e) {
        if (e.status === 401) await loggedOut('Your session has ended. Please sign in again.');
        else if (e.offline) setOnline(false);
      } finally { running = false; }
    };
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', poll);
    return () => {
      ev.forEach(e => window.removeEventListener(e, mark));
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', poll);
    };
  }, [apply, loggedOut]);

  /* ---------- one request at a time; an identical request already in flight (double-click) is ignored ---------- */
  const act = useCallback((method, path, body) => {
    const key = method + path + JSON.stringify(body || null);
    if (inflight.current.has(key)) return Promise.resolve(false);
    inflight.current.add(key);
    activity.current = true;
    const run = async () => {
      setBusy(true);
      try {
        const r = await request(method, path, body);
        setOnline(true);
        apply(r);
        if (r.message) toast(r.message);
        return true;
      } catch (e) {
        if (e.status === 401 && signedIn.current) await loggedOut('Your session has ended. Please sign in again.');
        else toast(e.message, 'error');
        return false;
      } finally {
        inflight.current.delete(key);
        setBusy(false);
      }
    };
    const p = queue.current.then(run, run);
    queue.current = p.catch(() => {});
    return p;
  }, [apply, loggedOut, toast]);

  const api = useMemo(() => {
    const me = currentUser(S);
    const can = a => canDo(S, a);
    const fail = msg => { toast(msg, 'error'); return Promise.resolve(false); };

    /* ---------- session ---------- */
    const login = async (email, password) => {
      if (!String(email || '').trim() || !password) return { ok: false, error: 'Enter your email and password.' };
      try {
        apply(await request('POST', '/login', { email, password }));
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    };
    const logout = async reason => {
      try { await request('POST', '/logout', {}); } catch (e) { /* the session ends on the server by itself */ }
      await loggedOut(reason ? reason + '. Please sign in again.' : null);
    };
    const changePassword = ({ current, next, confirm }) => {
      const bad = passwordProblem(next);
      if (bad) return fail(bad);
      if (next !== confirm) return fail('The two new passwords do not match.');
      return act('POST', '/password', { current, next, confirm });
    };
    const resetPassword = (id, password) => act('POST', `/users/${id}/password`, { password });

    /* ---------- orders ---------- */
    const placeOrder = draft => act('POST', '/orders', { customerId: draft.customerId, items: draft.items.map(i => ({ pid: i.pid, qty: i.qty })), override: !!draft.override, notes: draft.notes || '' });
    const advanceOrder = id => act('POST', `/orders/${id}/advance`);
    const cancelOrder = id => {
      if (!window.confirm(`Cancel order ${id}? This cannot be undone.`)) return Promise.resolve(false);
      return act('POST', `/orders/${id}/cancel`);
    };

    /* ---------- products ---------- */
    const saveProduct = (fd, editId) => (editId ? act('PUT', `/products/${editId}`, fd) : act('POST', '/products', fd));
    const saveStock = (fd, id) => act('POST', `/products/${id}/stock`, fd);

    /* ---------- customers & leads ---------- */
    const saveCustomer = (fd, editId, fromLead) => (editId ? act('PUT', `/customers/${editId}`, fd) : act('POST', '/customers', { ...fd, fromLead: fromLead || undefined }));
    const toggleHold = id => act('POST', `/customers/${id}/hold`);
    const saveLead = (fd, editId) => (editId ? act('PUT', `/leads/${editId}`, fd) : act('POST', '/leads', fd));
    const advanceLead = id => act('POST', `/leads/${id}/advance`);
    const markLost = id => act('POST', `/leads/${id}/lost`);

    /* ---------- payments ---------- */
    const savePayment = fd => act('POST', '/payments', fd);

    /* ---------- admin ---------- */
    const saveUser = fd => act('POST', '/users', fd);
    const toggleUser = id => act('POST', `/users/${id}/toggle`);
    const saveCompany = fd => act('PUT', '/company', fd);

    /* ---------- data tools ---------- */
    const backup = async () => {
      try {
        const data = await request('GET', '/backup');
        downloadFile(`banday-erp-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
        toast('Backup downloaded.');
      } catch (e) { toast(e.message, 'error'); }
    };
    const restore = file => {
      if (!file) return;
      const rd = new FileReader();
      rd.onload = async () => {
        let o;
        try { o = JSON.parse(rd.result); } catch (e) { return toast('That file is not a valid Banday ERP backup.', 'error'); }
        if (!o || !Array.isArray(o.products) || !Array.isArray(o.orders) || !Array.isArray(o.customers)) return toast('That file is not a valid Banday ERP backup.', 'error');
        if (!window.confirm('Replace ALL products, customers, leads, orders and payments with the contents of this backup? Staff accounts and passwords are kept. This cannot be undone, so download a backup first if unsure.')) return;
        await act('POST', '/restore', o);
      };
      rd.readAsText(file);
    };
    const exportCSV = kind => {
      let rows;
      if (kind === 'orders') rows = [['Order', 'Date', 'Customer', 'Market', 'Status', 'Payment', 'Taxable', 'GST', 'Total', 'Paid', 'Due']].concat(S.orders.map(o => [o.id, o.date, o.customerName, o.market, o.status, payStatus(S, o), o.subtotal, o.taxTotal, o.grandTotal, orderPaid(S, o), orderDue(S, o)]));
      if (kind === 'products') rows = [['SKU', 'Name', 'Category', 'Warehouse', 'Stock', 'Safety stock', 'Price', 'GST %']].concat(S.products.map(p => [p.id, p.name, p.category, p.warehouse, p.stock, p.minStock, p.price, p.gst]));
      if (kind === 'customers') rows = [['ID', 'Name', 'Type', 'Market', 'Phone', 'GSTIN', 'Credit limit', 'Outstanding', 'On hold']].concat(S.customers.map(c => [c.id, c.name, c.type, c.market, c.phone, c.gstin, c.creditLimit, outstanding(S, c), c.onHold ? 'Yes' : 'No']));
      if (kind === 'payments') rows = [['Receipt', 'Date', 'Customer', 'Order', 'Mode', 'Reference', 'Amount']].concat(S.payments.map(p => [p.id, p.date, p.customerName, p.orderId, p.mode, p.reference, p.amount]));
      if (!rows) return;
      downloadFile(`banday-${kind}-${today()}.csv`, toCSV(rows), 'text/csv');
      toast(`${kind} exported.`);
    };

    return {
      S, me, can, toast, ready, online, busy,
      login, logout, changePassword, resetPassword, placeOrder, advanceOrder, cancelOrder, saveProduct, saveStock,
      saveCustomer, toggleHold, saveLead, advanceLead, markLost, savePayment,
      saveUser, toggleUser, saveCompany, backup, restore, exportCSV
    };
  }, [S, ready, online, busy, act, apply, loggedOut, toast]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div id="toast" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={'t ' + (t.type === 'error' ? 'error' : '')}>{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  );
}
