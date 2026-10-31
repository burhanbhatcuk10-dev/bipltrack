import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { Pill, Icon, Empty } from '../components/ui.jsx';
import PaymentModal from '../components/PaymentModal.jsx';
import { inr, r2, fmtDate, daysBetween, today } from '../lib/utils.js';
import { orderDue, agingRows } from '../lib/domain.js';

export default function Payments() {
  const { S, can, exportCSV } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = q.toLowerCase();
  const list = S.payments.filter(p => !term || (p.id + p.orderId + p.customerName + p.reference).toLowerCase().includes(term));
  const total = S.payments.reduce((a, p) => a + p.amount, 0);
  const dueOrders = S.orders.filter(o => o.status !== 'Cancelled' && orderDue(S, o) > 0);
  const dueSum = r2(dueOrders.reduce((a, o) => a + orderDue(S, o), 0));
  const overdue = r2(dueOrders.filter(o => daysBetween(o.date, today()) > 30).reduce((a, o) => a + orderDue(S, o), 0));
  const ag = agingRows(S);

  return (
    <div className="stack">
      <div className="card pad row between">
        <div className="grow"><h2>Payments &amp; accounts ledger</h2><div className="sub">Receipts update order payment status and customer outstanding automatically</div></div>
        <div className="row">
          <button className="btn" onClick={() => exportCSV('payments')}><Icon name="down" /> CSV</button>
          {(can('payment.add') || can('*')) && <button className="btn primary" onClick={() => setOpen(true)}><Icon name="plus" /> Record payment</button>}
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi"><div className="l">Total receipts</div><div className="v">{inr(total)}</div><div className="d">{S.payments.length} entries</div></div>
        <div className="card kpi"><div className="l">Unpaid on invoices</div><div className="v" style={{ color: 'var(--warn)' }}>{inr(dueSum)}</div><div className="d">{dueOrders.length} orders with balance</div></div>
        <div className="card kpi"><div className="l">Overdue &gt; 30 days</div><div className="v down">{inr(overdue)}</div><div className="d">By order date</div></div>
      </div>

      <div className="card">
        <div className="pad"><h2>Receivables ageing</h2><div className="sub">Unpaid order balances by age of invoice. Opening balance is the amount brought forward from before this system.</div></div>
        <div className="tbl">
          <table>
            <thead><tr><th>Customer</th><th className="r">0–30 d</th><th className="r">31–60 d</th><th className="r">61–90 d</th><th className="r">90+ d</th><th className="r">Brought fwd</th><th className="r">Advance</th><th className="r">Net outstanding</th></tr></thead>
            <tbody>
              {ag.map(r => (
                <tr key={r.c.id}>
                  <td><b>{r.c.name}</b></td>
                  {r.b.map((v, i) => <td key={i} className="r num">{v ? inr(v) : '—'}</td>)}
                  <td className="r num">{r.open ? inr(r.open) : '—'}</td>
                  <td className="r num">{r.adv ? '−' + inr(r.adv) : '—'}</td>
                  <td className="r num"><b>{inr(r.net)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card pad">
        <input type="text" className="search" style={{ maxWidth: 420 }} placeholder="Search receipt, order, customer or reference" value={q} onChange={e => setQ(e.target.value)} aria-label="Search payments" />
      </div>

      <div className="card tbl">
        <table>
          <thead><tr><th>Receipt</th><th>Order &amp; customer</th><th>Mode</th><th>Reference</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id}>
                <td><b>{p.id}</b><span className="s">{fmtDate(p.date)}</span></td>
                <td><b>{p.orderId || 'On account'}</b><span className="s">{p.customerName}</span></td>
                <td><Pill kind="info">{p.mode}</Pill></td>
                <td className="mono">{p.reference}</td>
                <td className="r num"><b style={{ color: 'var(--good)' }}>{inr(p.amount)}</b></td>
              </tr>
            ))}
            {list.length === 0 && <Empty cols={5}>No payments match.</Empty>}
          </tbody>
        </table>
      </div>

      {open && <PaymentModal onClose={() => setOpen(false)} />}
    </div>
  );
}
