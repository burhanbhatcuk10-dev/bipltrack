import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { Pill, Icon, Modal, Field, Empty, formData } from '../components/ui.jsx';
import { inr, r2, fmtDate } from '../lib/utils.js';
import { outstanding, custOrders, LEAD_STAGES, userName } from '../lib/domain.js';

function CustomerForm({ customer, prefill, fromLead, onClose }) {
  const { can, saveCustomer } = useStore();
  const v = customer || prefill || { name: '', type: 'Retail', market: '', phone: '', gstin: '', creditLimit: 100000, opening: 0, notes: '' };
  const adm = can('*');
  return (
    <Modal title={customer ? `Edit ${customer.id}` : 'Add customer'} onClose={onClose}>
      <form className="stack" onSubmit={async e => { if (await saveCustomer(formData(e), customer && customer.id, fromLead)) onClose(); }}>
        <div className="form">
          <Field label="Business name" full><input type="text" name="name" required defaultValue={v.name} /></Field>
          <Field label="Type"><select name="type" defaultValue={v.type}>{['Retail', 'Wholesale'].map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Market / location"><input type="text" name="market" required defaultValue={v.market} /></Field>
          <Field label="Phone"><input type="tel" name="phone" required defaultValue={v.phone} /></Field>
          <Field label="GSTIN (blank if unregistered)"><input type="text" name="gstin" maxLength={15} defaultValue={v.gstin} style={{ textTransform: 'uppercase' }} placeholder="01AABCR1234F1Z5" /></Field>
          <Field label="Credit limit (₹)"><input type="number" name="creditLimit" min="0" step="1000" defaultValue={v.creditLimit} disabled={!adm} /></Field>
          {!customer && <Field label="Opening balance (₹)"><input type="number" name="opening" step="0.01" defaultValue={v.opening || 0} disabled={!adm} /></Field>}
          <Field label="Notes" full><textarea name="notes" defaultValue={v.notes || ''} /></Field>
        </div>
        {!adm && <div className="note">Credit limit and opening balance are set by an admin.</div>}
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn accent" type="submit">Save customer</button></div>
      </form>
    </Modal>
  );
}

function LeadForm({ lead, onClose }) {
  const { S, me, saveLead } = useStore();
  const v = lead || { businessName: '', contactPerson: '', phone: '', market: '', stage: 'Initial Contact', potential: 100000, assignedTo: me.id, notes: '' };
  return (
    <Modal title={lead ? 'Edit lead' : 'Add lead'} onClose={onClose}>
      <form className="stack" onSubmit={async e => { if (await saveLead(formData(e), lead && lead.id)) onClose(); }}>
        <div className="form">
          <Field label="Business name" full><input type="text" name="businessName" required defaultValue={v.businessName} /></Field>
          <Field label="Contact person"><input type="text" name="contactPerson" required defaultValue={v.contactPerson} /></Field>
          <Field label="Phone"><input type="tel" name="phone" required defaultValue={v.phone} /></Field>
          <Field label="Market"><input type="text" name="market" required defaultValue={v.market} /></Field>
          <Field label="Expected monthly potential (₹)"><input type="number" name="potential" min="0" step="1000" defaultValue={v.potential} /></Field>
          <Field label="Stage"><select name="stage" defaultValue={v.stage}>{LEAD_STAGES.map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Assigned to"><select name="assignedTo" defaultValue={v.assignedTo}>{S.users.filter(u => u.active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="Notes" full><textarea name="notes" defaultValue={v.notes || ''} /></Field>
        </div>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn accent" type="submit">Save lead</button></div>
      </form>
    </Modal>
  );
}

function Statement({ customer: c, onClose }) {
  const { S } = useStore();
  const ev = [];
  custOrders(S, c).forEach(o => ev.push({ d: o.date, t: 'Invoice', ref: o.id, dr: o.grandTotal, cr: 0 }));
  S.payments.filter(p => p.customerId === c.id).forEach(p => ev.push({ d: p.date, t: 'Receipt · ' + p.mode, ref: p.id + (p.orderId ? ' → ' + p.orderId : ' (on account)'), dr: 0, cr: p.amount }));
  ev.sort((a, b) => a.d.localeCompare(b.d));
  let bal = c.opening;
  return (
    <Modal title={`Statement · ${c.name}`} onClose={onClose} wide>
      <div className="tbl">
        <table style={{ minWidth: 560 }}>
          <thead><tr><th>Date</th><th>Particulars</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr></thead>
          <tbody>
            <tr><td>—</td><td>Opening balance</td><td /><td /><td className="r num">{inr(bal)}</td></tr>
            {ev.map((e, i) => {
              bal = r2(bal + e.dr - e.cr);
              return (
                <tr key={i}>
                  <td>{fmtDate(e.d)}</td><td>{e.t}<span className="s">{e.ref}</span></td>
                  <td className="r num">{e.dr ? inr(e.dr) : ''}</td><td className="r num">{e.cr ? inr(e.cr) : ''}</td><td className="r num">{inr(bal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sum" style={{ marginTop: 14 }}><span>Closing balance receivable</span><span className="big num">{inr(outstanding(S, c))}</span></div>
      <div className="foot"><button className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export default function Crm() {
  const { S, can, exportCSV, toggleHold, advanceLead, markLost } = useStore();
  const [tab, setTab] = useState('customers');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const isCust = tab === 'customers';
  const term = q.toLowerCase();

  const customers = S.customers.filter(c => !term || (c.name + c.market + c.gstin).toLowerCase().includes(term));
  const leads = S.leads.filter(l => !term || (l.businessName + l.market + l.contactPerson).toLowerCase().includes(term));
  const pipeline = S.leads.filter(l => !['Won', 'Lost'].includes(l.stage)).reduce((a, l) => a + Number(l.potential || 0), 0);
  const stagePill = { 'Initial Contact': 'mute', Qualified: 'info', Negotiation: 'warn', Won: 'good', Lost: 'bad' };
  const canLead = can('*') || can('lead.manage');
  const canCust = can('*') || can('customer.add');

  return (
    <div className="stack">
      <div className="card pad row between">
        <div className="grow"><h2>Customers &amp; sales leads</h2><div className="sub">Retail and wholesale accounts across Srinagar, Anantnag, Budgam and Pulwama</div></div>
        <div className="row">
          <div className="seg">
            <button onClick={() => { setTab('customers'); setQ(''); }} aria-pressed={isCust}>Accounts ({S.customers.length})</button>
            <button onClick={() => { setTab('leads'); setQ(''); }} aria-pressed={!isCust}>Leads ({S.leads.length})</button>
          </div>
          {isCust ? <>
            <button className="btn" onClick={() => exportCSV('customers')}><Icon name="down" /> CSV</button>
            {canCust && <button className="btn primary" onClick={() => setModal({ type: 'cust' })}><Icon name="plus" /> Add customer</button>}
          </> : canLead && <button className="btn primary" onClick={() => setModal({ type: 'lead' })}><Icon name="plus" /> Add lead</button>}
        </div>
      </div>

      <div className="card pad">
        <input type="text" className="search" style={{ maxWidth: 420 }} placeholder={isCust ? 'Search name, market or GSTIN' : 'Search business, contact or market'} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
      </div>

      {isCust ? (
        <div className="card tbl">
          <table>
            <thead><tr><th>Customer</th><th>Type &amp; market</th><th>GSTIN &amp; phone</th><th className="r">Outstanding</th><th>Credit status</th><th>Actions</th></tr></thead>
            <tbody>
              {customers.map(c => {
                const o = outstanding(S, c), pct = Math.round((o / c.creditLimit) * 100), over = o >= c.creditLimit;
                return (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><span className="s">{c.id}</span></td>
                    <td><Pill kind="info">{c.type}</Pill><span className="s"><Icon name="pin" size={12} /> {c.market}</span></td>
                    <td><span className="mono">{c.gstin || 'Unregistered'}</span><span className="s">{c.phone}</span></td>
                    <td className="r num"><b>{inr(o)}</b><span className="s">Limit {inr(c.creditLimit)} · {pct}%</span></td>
                    <td>{c.onHold ? <Pill kind="bad">On credit hold</Pill> : over ? <Pill kind="warn">Over limit</Pill> : pct >= 80 ? <Pill kind="warn">Near limit</Pill> : <Pill kind="good">Active</Pill>}</td>
                    <td>
                      <div className="acts">
                        <button className="btn sm" onClick={() => setModal({ type: 'stmt', id: c.id })}>Statement</button>
                        {canCust && <button className="btn sm" onClick={() => setModal({ type: 'cust', id: c.id })}>Edit</button>}
                        {can('*') && <button className={'btn sm ' + (c.onHold ? '' : 'danger')} onClick={() => toggleHold(c.id)}>{c.onHold ? 'Release hold' : 'Put on hold'}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {customers.length === 0 && <Empty cols={6}>No customers match.</Empty>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card tbl">
          <div className="pad note" style={{ borderRadius: 0 }}>Open pipeline potential: <b>{inr(pipeline)}</b> per month</div>
          <table>
            <thead><tr><th>Lead</th><th>Contact</th><th>Market</th><th>Stage</th><th className="r">Potential / mo</th><th>Owner</th><th>Actions</th></tr></thead>
            <tbody>
              {leads.map(l => {
                const i = LEAD_STAGES.indexOf(l.stage);
                const open = !['Won', 'Lost'].includes(l.stage);
                const converted = S.customers.some(c => c.fromLead === l.id);
                return (
                  <tr key={l.id}>
                    <td><b>{l.businessName}</b><span className="s">{l.id}</span></td>
                    <td>{l.contactPerson}<span className="s">{l.phone}</span></td>
                    <td>{l.market}</td>
                    <td><Pill kind={stagePill[l.stage]}>{l.stage}</Pill></td>
                    <td className="r num">{inr(l.potential)}</td>
                    <td>{userName(S, l.assignedTo)}</td>
                    <td>
                      <div className="acts">
                        {canLead && <>
                          {open && i < 3 && <button className="btn sm primary" onClick={() => advanceLead(l.id)}>{i === 2 ? 'Mark won' : 'Next stage'}</button>}
                          {l.stage === 'Won' && !converted && <button className="btn sm accent" onClick={() => setModal({ type: 'convert', id: l.id })}>Convert to customer</button>}
                          {converted && <Pill kind="good">Customer</Pill>}
                          {open && <button className="btn sm danger" onClick={() => markLost(l.id)}>Lost</button>}
                          <button className="btn sm" onClick={() => setModal({ type: 'lead', id: l.id })}>Edit</button>
                        </>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {leads.length === 0 && <Empty cols={7}>No leads match.</Empty>}
            </tbody>
          </table>
        </div>
      )}

      {modal && modal.type === 'cust' && <CustomerForm customer={modal.id ? S.customers.find(c => c.id === modal.id) : null} onClose={() => setModal(null)} />}
      {modal && modal.type === 'convert' && (() => {
        const l = S.leads.find(x => x.id === modal.id);
        return <CustomerForm fromLead={l.id} prefill={{ name: l.businessName, type: 'Retail', market: l.market, phone: l.phone, gstin: '', creditLimit: 100000, opening: 0, notes: 'Converted from lead ' + l.id }} onClose={() => setModal(null)} />;
      })()}
      {modal && modal.type === 'lead' && <LeadForm lead={modal.id ? S.leads.find(l => l.id === modal.id) : null} onClose={() => setModal(null)} />}
      {modal && modal.type === 'stmt' && <Statement customer={S.customers.find(c => c.id === modal.id)} onClose={() => setModal(null)} />}
    </div>
  );
}
