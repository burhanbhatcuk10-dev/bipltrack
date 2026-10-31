import React from 'react';
import { useStore } from '../store.jsx';
import { Pill, Icon } from '../components/ui.jsx';
import { inr, r2, monthKey } from '../lib/utils.js';
import { lowStock, outstanding, lastMonths, ROLE_LABEL, ORD_PILL } from '../lib/domain.js';

function BarChart({ months, a, b }) {
  const W = 620, H = 230, L = 52, B = 28, T = 12, R = 8;
  const max = Math.max(1, ...a, ...b);
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const m = max / p;
  const nice = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  const ih = H - T - B, iw = W - L - R, gw = iw / months.length, bw = Math.min(26, gw / 3);
  const y = v => T + ih - (v / nice) * ih;
  const fmt = v => (v >= 1e5 ? (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + 'L' : v >= 1e3 ? v / 1e3 + 'k' : v);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 460, height: 'auto', marginTop: 12 }} role="img" aria-label="Monthly sales and collections">
        {[0, 1, 2, 3, 4].map(i => {
          const v = (nice / 4) * i;
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={i ? '3 4' : undefined} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">₹{fmt(v)}</text>
            </g>
          );
        })}
        {months.map((mo, i) => {
          const cx = L + gw * i + gw / 2;
          return (
            <g key={mo.key}>
              <title>{`${mo.label} ${mo.year}: sales ${inr(a[i])}, collected ${inr(b[i])}`}</title>
              <rect x={cx - bw - 2} y={y(a[i])} width={bw} height={Math.max(0, T + ih - y(a[i]))} rx="3" fill="var(--brand)" />
              <rect x={cx + 2} y={y(b[i])} width={bw} height={Math.max(0, T + ih - y(b[i]))} rx="3" fill="var(--accent)" />
              <text x={cx} y={H - 9} textAnchor="middle" fontSize="11.5" fill="var(--muted)">{mo.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Dashboard({ goTab, newOrder }) {
  const { S, me, can } = useStore();
  const live = S.orders.filter(o => o.status !== 'Cancelled');
  const months = lastMonths(6);
  const sales = months.map(m => r2(live.filter(o => monthKey(o.date) === m.key).reduce((a, o) => a + o.grandTotal, 0)));
  const coll = months.map(m => r2(S.payments.filter(p => monthKey(p.date) === m.key).reduce((a, p) => a + p.amount, 0)));
  const cur = sales[5], prev = sales[4];
  const delta = prev ? Math.round(((cur - prev) / prev) * 100) : null;
  const receivable = r2(S.customers.reduce((a, c) => a + Math.max(0, outstanding(S, c)), 0));
  const pend = S.orders.filter(o => !['Delivered', 'Cancelled'].includes(o.status));
  const low = lowStock(S);
  const over = S.customers.filter(c => outstanding(S, c) >= c.creditLimit);

  const cat = {};
  let catTotal = 0;
  live.forEach(o => o.items.forEach(i => {
    const v = i.price * i.qty;
    const k = i.category || (S.products.find(p => p.id === i.productId) || {}).category || 'Other';
    cat[k] = (cat[k] || 0) + v;
    catTotal += v;
  }));
  const catRows = Object.entries(cat).sort((a, b) => b[1] - a[1]);
  const catColor = { Saffron: 'var(--brand)', Spices: 'var(--accent)', 'Food Items': 'var(--good)' };
  const debtors = S.customers.map(c => ({ c, o: outstanding(S, c) })).filter(x => x.o > 0).sort((a, b) => b.o - a.o).slice(0, 5);
  const actionOrders = S.orders.filter(o =>
    (can('*') && o.status === 'Pending Review') ||
    ((can('*') || can('order.dispatch')) && o.status === 'Pack Approval') ||
    ((can('*') || can('order.deliver')) && o.status === 'Dispatched')
  ).slice(0, 6);

  return (
    <div className="stack">
      <div className="card pad row between" style={{ background: 'linear-gradient(110deg,var(--brand),#0b2545)', color: '#fff', border: 0 }}>
        <div className="grow">
          <span className="chip">Operations overview</span>
          <h1 style={{ fontSize: 24, marginTop: 8 }}>Welcome, {me.name}</h1>
          <p style={{ margin: '6px 0 0', opacity: 0.85, maxWidth: '60ch' }}>
            Kashmiri saffron, spices and dry fruits distribution across the J&amp;K markets. {pend.length} order{pend.length === 1 ? '' : 's'} in the pipeline and {low.length} SKU{low.length === 1 ? '' : 's'} below safety stock.
          </p>
        </div>
        {(can('order.create') || can('*')) && <button className="btn accent" onClick={newOrder}><Icon name="plus" /> New order</button>}
      </div>

      <div className="kpis">
        <div className="card kpi"><div className="l">Sales this month</div><div className="v">{inr(cur)}</div>
          <div className={'d ' + (delta === null ? '' : delta >= 0 ? 'up' : 'down')}>{delta === null ? 'No sales last month to compare' : `${delta >= 0 ? '▲ ' : '▼ '}${Math.abs(delta)}% vs last month`}</div></div>
        <div className="card kpi"><div className="l">Collected this month</div><div className="v">{inr(coll[5])}</div><div className="d">{S.payments.length} receipts on record</div></div>
        <div className="card kpi"><div className="l">Receivables outstanding</div><div className="v">{inr(receivable)}</div><div className={'d ' + (over.length ? 'down' : '')}>{over.length} account{over.length === 1 ? '' : 's'} at or over credit limit</div></div>
        <div className="card kpi"><div className="l">Orders in pipeline</div><div className="v">{pend.length}</div><div className="d">{S.orders.filter(o => o.status === 'Pending Review').length} awaiting approval</div></div>
        <div className="card kpi"><div className="l">Low stock SKUs</div><div className={'v ' + (low.length ? 'down' : '')}>{low.length}</div><div className="d">of {S.products.length} products</div></div>
      </div>

      <div className="grid2">
        <div className="card pad">
          <div className="row between">
            <div><h2>Sales vs collections</h2><div className="sub">Last 6 months, incl. GST. Cancelled orders excluded.</div></div>
            <div className="row" style={{ gap: 14, fontSize: 12 }}>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--brand)', borderRadius: 2 }} /> Sales</span>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2 }} /> Collected</span>
            </div>
          </div>
          <BarChart months={months} a={sales} b={coll} />
        </div>
        <div className="card pad">
          <h2>Sales by category</h2><div className="sub">Share of billed value, all orders</div>
          <div className="lst" style={{ marginTop: 16 }}>
            {catRows.length ? catRows.map(([k, v]) => (
              <div key={k}>
                <div className="r1"><span>{k}</span><span className="num">{Math.round((v / catTotal) * 100)}% · {inr(Math.round(v))}</span></div>
                <div className="bar"><b style={{ width: `${(v / catTotal) * 100}%`, background: catColor[k] || 'var(--info)' }} /></div>
              </div>
            )) : <div className="empty">No orders yet</div>}
          </div>
        </div>
      </div>

      <div className="grid2e">
        <div className="card pad">
          <h2>Needs your action</h2><div className="sub">Orders you can move forward as {ROLE_LABEL[me.role]}</div>
          <div className="lst" style={{ marginTop: 14 }}>
            {actionOrders.length ? actionOrders.map(o => (
              <div className="row between" key={o.id}>
                <div className="grow"><b>{o.id}</b> · {o.customerName}<span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{inr(o.grandTotal)}</span></div>
                <Pill kind={ORD_PILL[o.status]}>{o.status}</Pill>
                <button className="btn sm" onClick={() => goTab('orders')}>Open</button>
              </div>
            )) : <div className="empty" style={{ padding: 18 }}>Nothing waiting on you.</div>}
          </div>
        </div>
        <div className="card pad">
          <h2>Low stock</h2><div className="sub">At or below the safety threshold</div>
          <div className="lst" style={{ marginTop: 14 }}>
            {low.length ? low.map(p => (
              <div className="row between" key={p.id}>
                <div className="grow"><b>{p.name}</b><span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{p.warehouse}</span></div>
                <span className="pill p-bad num">{p.stock} / min {p.minStock}</span>
              </div>
            )) : <div className="empty" style={{ padding: 18 }}>All SKUs are above safety stock.</div>}
          </div>
        </div>
        <div className="card pad">
          <h2>Top receivables</h2><div className="sub">Largest balances against credit limit</div>
          <div className="lst" style={{ marginTop: 14 }}>
            {debtors.length ? debtors.map(({ c, o }) => {
              const pct = Math.min(100, (o / c.creditLimit) * 100);
              return (
                <div key={c.id}>
                  <div className="r1"><span>{c.name}{c.onHold && <> <Pill kind="bad">On hold</Pill></>}</span><span className="num">{inr(o)}</span></div>
                  <div className="bar"><b style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--bad)' : pct >= 80 ? 'var(--warn)' : 'var(--brand)' }} /></div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{Math.round((o / c.creditLimit) * 100)}% of {inr(c.creditLimit)} limit</div>
                </div>
              );
            }) : <div className="empty" style={{ padding: 18 }}>No outstanding balances.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
