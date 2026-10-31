import React, { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { Pill, Icon, Modal, Field, Empty } from '../components/ui.jsx';
import PaymentModal from '../components/PaymentModal.jsx';
import { inr, r2, fmtDate, amountInWords, fyOf } from '../lib/utils.js';
import {
  STAGES, ORD_PILL, PAY_PILL, orderPaid, orderDue, payStatus, outstanding, stateCode, userName, nextStageAction, totalsOf
} from '../lib/domain.js';

/* ---------------- New order form ---------------- */
function OrderForm({ onClose }) {
  const { S } = useStore();
  if (!S.products.length || !S.customers.length) {
    return (
      <Modal title="New order (GST)" onClose={onClose}>
        <div className="note">{!S.customers.length ? 'Add a customer' : 'Add a product'} first. An order needs at least one customer and one product.</div>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }
  return <OrderFormInner onClose={onClose} />;
}

function OrderFormInner({ onClose }) {
  const { S, can, placeOrder } = useStore();
  const first = S.customers.find(c => !c.onHold) || S.customers[0];
  const [d, setD] = useState({ customerId: first.id, items: [{ pid: S.products[0].id, qty: 1 }], override: false, notes: '' });

  const t = totalsOf(d.items.map(i => { const p = S.products.find(x => x.id === i.pid) || S.products[0]; return { price: p.price, qty: i.qty, gst: p.gst }; }));
  const c = S.customers.find(x => x.id === d.customerId);
  const out = c ? outstanding(S, c) : 0;
  const exposure = r2(out + t.grandTotal);
  const exceeds = c && exposure > c.creditLimit;
  const setItem = (i, patch) => setD({ ...d, items: d.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });

  return (
    <Modal title="New order (GST)" onClose={onClose} wide>
      <form className="stack" noValidate onSubmit={async e => { e.preventDefault(); if (await placeOrder(d)) onClose(); }}>
        <div className="form">
          <Field label="Customer">
            <select value={d.customerId} onChange={e => setD({ ...d, customerId: e.target.value, override: false })}>
              {S.customers.map(x => <option key={x.id} value={x.id}>{x.name} ({x.market}){x.onHold ? ' — ON HOLD' : ''}</option>)}
            </select>
          </Field>
          {c && (
            <div className={'note ' + (c.onHold || exceeds ? 'bad' : '')} style={{ alignSelf: 'end' }}>
              <b>Credit:</b> outstanding {inr(out)} of {inr(c.creditLimit)} limit. With this order: {inr(exposure)}
              {c.onHold ? '. Account is on hold.' : exceeds ? '. Limit would be exceeded.' : '.'}
            </div>
          )}
        </div>

        <div>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Items</span>
            <button type="button" className="btn sm primary" onClick={() => setD({ ...d, items: [...d.items, { pid: S.products[0].id, qty: 1 }] })}><Icon name="plus" size={13} /> Add item</button>
          </div>
          <div className="lines">
            {d.items.map((it, i) => {
              const p = S.products.find(x => x.id === it.pid) || S.products[0];
              return (
                <div className="line" key={i}>
                  <select value={p.id} onChange={e => setItem(i, { pid: e.target.value })} aria-label="Product">
                    {S.products.map(x => <option key={x.id} value={x.id}>{x.name} — {inr(x.price)} ({x.stock} in stock)</option>)}
                  </select>
                  <input type="number" min="1" step="1" value={it.qty} aria-label="Quantity"
                    onChange={e => setItem(i, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                  <div className="t num">
                    {inr(p.price * it.qty)}
                    {it.qty > p.stock && <span style={{ display: 'block', fontSize: 11, color: 'var(--warn)', fontWeight: 600 }}>Only {p.stock} in stock</span>}
                  </div>
                  {d.items.length > 1
                    ? <button type="button" className="x" aria-label="Remove item" onClick={() => setD({ ...d, items: d.items.filter((_, k) => k !== i) })}>×</button>
                    : <span />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="sum">
          <div style={{ fontSize: 13 }}>
            <div>Taxable value: <b className="num">{inr(t.subtotal)}</b></div>
            <div>GST: <b className="num">{inr(t.taxTotal)}</b></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.06em' }}>Grand total</div>
            <div className="big num">{inr(t.grandTotal)}</div>
          </div>
        </div>

        {can('*') && exceeds && !(c && c.onHold) && (
          <label className="check">
            <input type="checkbox" checked={d.override} onChange={e => setD({ ...d, override: e.target.checked })} />
            Override credit limit for this order (recorded in the audit log)
          </label>
        )}
        <Field label="Notes (optional)"><textarea value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} /></Field>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn accent" type="submit">Submit for approval</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- GST invoice ---------------- */
function Invoice({ order: o, onClose }) {
  const { S } = useStore();
  const c = S.customers.find(x => x.id === o.customerId) || { name: o.customerName, market: o.market, gstin: '', phone: '' };
  const co = S.company;
  const intra = stateCode(S, c.gstin) === stateCode(S, co.gstin);
  const rows = o.items.map(i => { const base = r2(i.price * i.qty); const tax = r2((base * i.gst) / 100); return { ...i, base, tax, total: r2(base + tax) }; });
  const byRate = {};
  rows.forEach(r => { byRate[r.gst] = byRate[r.gst] || { base: 0, tax: 0 }; byRate[r.gst].base += r.base; byRate[r.gst].tax += r.tax; });
  const invNo = `BI/${fyOf(o.date)}/${o.id.replace('ORD-', '')}`;
  const paid = orderPaid(S, o), due = orderDue(S, o);

  return (
    <Modal title={`Tax invoice ${invNo}`} onClose={onClose} wide hideHeader>
      <div className="hd noprint"><h2>Tax invoice {invNo}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></div>
      <div className="inv">
        <div className="row between" style={{ alignItems: 'flex-start', borderBottom: '2px solid #1b365d', paddingBottom: 12, marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 19, color: '#1b365d' }}>{co.name.toUpperCase()}</h2>
            <div className="muted">{co.address}</div>
            <div className="muted">GSTIN: <b className="mono">{co.gstin}</b>{co.phone ? ' · ' + co.phone : ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ fontSize: 17, color: '#1b365d', letterSpacing: '.08em' }}>TAX INVOICE</h2>
            <div className="mono"><b>{invNo}</b></div>
            <div className="muted">Date: {fmtDate(o.date)}</div>
            <div className="muted">Order: {o.id} · {o.status}</div>
          </div>
        </div>

        <div className="invgrid" style={{ marginBottom: 14 }}>
          <div className="invbox">
            <b style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em' }}>Billed to</b>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 3 }}>{c.name}</div>
            <div className="muted">{c.market}</div>
            {c.phone && <div className="muted">{c.phone}</div>}
            <div>GSTIN: <b className="mono">{c.gstin || 'Unregistered'}</b></div>
          </div>
          <div className="invbox">
            <b style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em' }}>Supply details</b>
            <div style={{ marginTop: 3 }}>Place of supply: state code <b>{stateCode(S, c.gstin)}</b></div>
            <div>Tax type: <b>{intra ? 'CGST + SGST (intra-state)' : 'IGST (inter-state)'}</b></div>
            <div className="muted">Dispatch from: Khunmoh Phase II warehouse</div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>#</th><th>Item</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Taxable</th><th className="r">GST %</th><th className="r">GST</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td><td>{r.name}</td><td className="r num">{r.qty}</td><td className="r num">{inr(r.price)}</td>
                  <td className="r num">{inr(r.base)}</td><td className="r">{r.gst}%</td><td className="r num">{inr(r.tax)}</td><td className="r num"><b>{inr(r.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row between" style={{ alignItems: 'flex-start', marginTop: 14 }}>
          <div className="grow" style={{ minWidth: 240 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 300 }}>
                <thead><tr><th>GST rate</th><th className="r">Taxable</th>{intra ? <><th className="r">CGST</th><th className="r">SGST</th></> : <th className="r">IGST</th>}</tr></thead>
                <tbody>
                  {Object.entries(byRate).map(([rate, v]) => (
                    <tr key={rate}>
                      <td>{rate}%</td><td className="r num">{inr(v.base)}</td>
                      {intra
                        ? <><td className="r num">{inr(r2(v.tax / 2))}</td><td className="r num">{inr(r2(v.tax - r2(v.tax / 2)))}</td></>
                        : <td className="r num">{inr(r2(v.tax))}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ width: 260, maxWidth: '100%' }}>
            <div className="row between" style={{ padding: '4px 0' }}><span className="muted">Taxable value</span><b className="num">{inr(o.subtotal)}</b></div>
            <div className="row between" style={{ padding: '4px 0' }}><span className="muted">Total GST</span><b className="num">{inr(o.taxTotal)}</b></div>
            <div className="row between" style={{ padding: '8px 0', borderTop: '2px solid #1b365d', fontSize: 15, color: '#1b365d' }}><b>Grand total</b><b className="num">{inr(o.grandTotal)}</b></div>
            {paid > 0 && <>
              <div className="row between" style={{ padding: '3px 0' }}><span className="muted">Received</span><b className="num">{inr(paid)}</b></div>
              <div className="row between" style={{ padding: '3px 0' }}><span className="muted">Balance due</span><b className="num">{inr(due)}</b></div>
            </>}
          </div>
        </div>

        <div style={{ marginTop: 12 }}><b>Amount in words:</b> {amountInWords(o.grandTotal)}</div>
        <div className="row between" style={{ alignItems: 'flex-end', marginTop: 22, borderTop: '1px solid #dfe5ef', paddingTop: 12 }}>
          <div className="muted" style={{ maxWidth: 420 }}>
            <b style={{ color: '#0b2545' }}>Terms</b>
            <div style={{ whiteSpace: 'pre-line' }}>{co.terms}</div>
            {co.bank && <div style={{ marginTop: 6 }}><b style={{ color: '#0b2545' }}>Bank details</b><div style={{ whiteSpace: 'pre-line' }}>{co.bank}</div></div>}
            <div style={{ marginTop: 6 }}>This is a computer-generated invoice.</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ height: 46, borderBottom: '1px dashed #5d6b82', width: 180 }} />
            <b>Authorised signatory</b>
            <div className="muted">{co.name}</div>
          </div>
        </div>
      </div>
      <div className="foot noprint">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn accent" onClick={() => window.print()}><Icon name="print" /> Print invoice</button>
      </div>
    </Modal>
  );
}

/* ---------------- Orders tab ---------------- */
export default function Orders({ autoOpen, onAutoOpened }) {
  const { S, can, advanceOrder, cancelOrder, exportCSV } = useStore();
  const [filter, setFilter] = useState('All');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // {type:'new'|'invoice'|'pay', id}

  useEffect(() => { if (autoOpen) { setModal({ type: 'new' }); onAutoOpened(); } }, [autoOpen, onAutoOpened]);

  const term = q.toLowerCase();
  const list = S.orders.filter(o => (filter === 'All' || o.status === filter) && (!term || (o.id + o.customerName + o.market).toLowerCase().includes(term)));
  const canCreate = can('order.create') || can('*');
  const invoiceOrder = modal && modal.type === 'invoice' ? S.orders.find(o => o.id === modal.id) : null;

  return (
    <div className="stack">
      <div className="card pad row between">
        <div className="grow"><h2>Orders &amp; multi-stage dispatch</h2><div className="sub">Pending Review → Pack Approval → Dispatched → Delivered. Stock is deducted at dispatch.</div></div>
        <div className="row">
          <button className="btn" onClick={() => exportCSV('orders')}><Icon name="down" /> CSV</button>
          {canCreate && <button className="btn primary" onClick={() => setModal({ type: 'new' })}><Icon name="plus" /> New order</button>}
        </div>
      </div>

      <div className="card pad row between">
        <div className="seg" role="group" aria-label="Filter by status">
          {['All', ...STAGES, 'Cancelled'].map(f => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}>{f}</button>)}
        </div>
        <input type="text" className="search" placeholder="Search order, customer or market" value={q} onChange={e => setQ(e.target.value)} aria-label="Search orders" />
      </div>

      <div className="card tbl">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th className="r">Items</th><th className="r">Total</th><th>Stage</th><th>Payment</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map(o => {
              const idx = STAGES.indexOf(o.status);
              const action = nextStageAction(S, o);
              const ps = payStatus(S, o);
              return (
                <tr key={o.id}>
                  <td><b>{o.id}</b><span className="s">{fmtDate(o.date)} · {userName(S, o.salesperson)}</span></td>
                  <td><b>{o.customerName}</b><span className="s"><Icon name="pin" size={12} /> {o.market}</span></td>
                  <td className="r num">{o.items.reduce((a, i) => a + i.qty, 0)} units<span className="s">{o.items.length} line{o.items.length > 1 ? 's' : ''}</span></td>
                  <td className="r num"><b>{inr(o.grandTotal)}</b>{ps === 'Partial' && <span className="s">Due {inr(orderDue(S, o))}</span>}</td>
                  <td>
                    <Pill kind={ORD_PILL[o.status]}>{o.status}</Pill>
                    {o.creditOverride && <span className="s">Credit override</span>}
                    {idx >= 0 && <div className="track" aria-hidden="true">{STAGES.map((_, i) => <i key={i} className={i <= idx ? 'on' : ''} />)}</div>}
                  </td>
                  <td><Pill kind={PAY_PILL[ps]}>{ps}</Pill></td>
                  <td>
                    <div className="acts">
                      {action && <button className="btn sm primary" onClick={() => advanceOrder(o.id)}>{action}</button>}
                      {can('*') && ['Pending Review', 'Pack Approval'].includes(o.status) && <button className="btn sm danger" onClick={() => cancelOrder(o.id)}>Cancel</button>}
                      {o.status !== 'Cancelled' && orderDue(S, o) > 0 && (can('payment.add') || can('*')) && <button className="btn sm" onClick={() => setModal({ type: 'pay', id: o.id })}>Receive payment</button>}
                      <button className="btn sm" onClick={() => setModal({ type: 'invoice', id: o.id })}><Icon name="print" size={13} /> Invoice</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <Empty cols={7}>No orders match this filter.</Empty>}
          </tbody>
        </table>
      </div>

      {modal && modal.type === 'new' && <OrderForm onClose={() => setModal(null)} />}
      {invoiceOrder && <Invoice order={invoiceOrder} onClose={() => setModal(null)} />}
      {modal && modal.type === 'pay' && <PaymentModal orderId={modal.id} onClose={() => setModal(null)} />}
    </div>
  );
}
