import React, { useState } from 'react';
import { Modal, Field, formData } from './ui.jsx';
import { useStore } from '../store.jsx';
import { inr, today } from '../lib/utils.js';
import { orderDue, outstanding } from '../lib/domain.js';

// Shared by the Orders tab ("Receive payment") and the Payments tab ("Record payment").
export default function PaymentModal({ orderId = '', onClose }) {
  const { S } = useStore();
  if (!S.customers.length) {
    return (
      <Modal title="Record payment" onClose={onClose}>
        <div className="note">Add a customer first. A payment must belong to a customer.</div>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }
  return <PaymentForm orderId={orderId} onClose={onClose} />;
}

function PaymentForm({ orderId, onClose }) {
  const { S, savePayment } = useStore();
  const startOrder = S.orders.find(o => o.id === orderId);
  const [d, setD] = useState({
    customerId: startOrder ? startOrder.customerId : S.customers[0].id,
    orderId: startOrder ? startOrder.id : '',
    amount: startOrder ? orderDue(S, startOrder) : ''
  });
  const c = S.customers.find(x => x.id === d.customerId);
  const dues = S.orders.filter(o => o.customerId === d.customerId && o.status !== 'Cancelled' && orderDue(S, o) > 0);
  const o = S.orders.find(x => x.id === d.orderId);

  return (
    <Modal title="Record payment" onClose={onClose}>
      <form className="stack" onSubmit={async e => { if (await savePayment(formData(e))) onClose(); }}>
        <div className="form">
          <Field label="Customer">
            <select name="customer" value={d.customerId} onChange={e => setD({ customerId: e.target.value, orderId: '', amount: '' })}>
              {S.customers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Apply to">
            <select name="order" value={d.orderId} onChange={e => {
              const ord = S.orders.find(x => x.id === e.target.value);
              setD({ ...d, orderId: e.target.value, amount: ord ? orderDue(S, ord) : '' });
            }}>
              <option value="">On account (no specific order)</option>
              {dues.map(x => <option key={x.id} value={x.id}>{x.id} · due {inr(orderDue(S, x))}</option>)}
            </select>
          </Field>
          <Field label="Mode">
            <select name="mode">{['UPI / GPay', 'Bank Transfer (NEFT)', 'Cheque', 'Cash'].map(m => <option key={m}>{m}</option>)}</select>
          </Field>
          <Field label="Amount received (₹)">
            <input type="number" name="amount" min="0.01" step="0.01" required value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} />
          </Field>
          <Field label="Date"><input type="date" name="date" required defaultValue={today()} max={today()} /></Field>
          <Field label="UTR / cheque no. / reference"><input type="text" name="reference" placeholder="e.g. UTR#9928120034" /></Field>
        </div>
        <div className="note">
          {c && <>{c.name} currently owes <b>{inr(outstanding(S, c))}</b>.</>}
          {o && <> {o.id} balance is {inr(orderDue(S, o))}.</>}
        </div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn accent" type="submit">Save payment</button>
        </div>
      </form>
    </Modal>
  );
}
