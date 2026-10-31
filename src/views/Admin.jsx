import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { Pill, Icon, Modal, Field, Empty, formData } from '../components/ui.jsx';
import { ROLE_LABEL } from '../lib/domain.js';

function UserForm({ onClose }) {
  const { saveUser } = useStore();
  const [show, setShow] = useState(false);
  return (
    <Modal title="Add user" onClose={onClose}>
      <form className="stack" onSubmit={async e => { if (await saveUser(formData(e))) onClose(); }}>
        <div className="form">
          <Field label="Full name"><input type="text" name="name" required /></Field>
          <Field label="Job title"><input type="text" name="title" required placeholder="e.g. Field Agent" /></Field>
          <Field label="Email"><input type="email" name="email" required /></Field>
          <Field label="Role">
            <select name="role"><option value="sales">Salesperson</option><option value="warehouse">Store (warehouse)</option><option value="admin">Admin (full access)</option></select>
          </Field>
          <Field label="Temporary password">
            <input type={show ? 'text' : 'password'} name="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <label className="check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show password</label>
        </div>
        <div className="note">The user must replace this temporary password when they first sign in. At least 8 characters with a letter and a number.</div>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn accent" type="submit">Create user</button></div>
      </form>
    </Modal>
  );
}

function ResetForm({ user, onClose }) {
  const { resetPassword } = useStore();
  const [show, setShow] = useState(false);
  return (
    <Modal title={`Reset password: ${user.name}`} onClose={onClose}>
      <form className="stack" onSubmit={async e => { if (await resetPassword(user.id, formData(e).password)) onClose(); }}>
        <Field label="Temporary password"><input type={show ? 'text' : 'password'} name="password" required minLength={8} autoComplete="new-password" /></Field>
        <label className="check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show password</label>
        <div className="note">Share it with {user.name} privately. They must choose their own password when they next sign in.</div>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn accent" type="submit">Set temporary password</button></div>
      </form>
    </Modal>
  );
}

export default function Admin() {
  const { S, me, toggleUser, saveCompany, backup, restore } = useStore();
  const [q, setQ] = useState('');
  const [addUser, setAddUser] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const term = q.toLowerCase();
  const logs = S.logs.filter(l => !term || (l.user + l.action).toLowerCase().includes(term)).slice(0, 200);
  const co = S.company;

  return (
    <div className="stack">
      <div className="card pad row between">
        <div className="grow"><h2>Admin: users, company profile &amp; audit trail</h2><div className="sub">Role permissions: Admin has full access. Salesperson creates orders, customers, leads and receipts. Store (warehouse) dispatches, delivers and adjusts stock.</div></div>
        <button className="btn primary" onClick={() => setAddUser(true)}><Icon name="plus" /> Add user</button>
      </div>

      <div className="card tbl">
        <table>
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {S.users.map(u => (
              <tr key={u.id}>
                <td><b>{u.name}</b><span className="s">{u.id} · {u.title}</span></td>
                <td className="mono">{u.email}</td>
                <td><Pill kind="info">{ROLE_LABEL[u.role]}</Pill></td>
                <td>{u.active ? <Pill kind="good">Active</Pill> : <Pill kind="mute">Disabled</Pill>}{u.mustChange && <span className="s">Must set new password</span>}</td>
                <td><div className="acts"><button className="btn sm" onClick={() => toggleUser(u.id)} disabled={u.id === me.id} title={u.id === me.id ? 'You cannot disable your own account' : undefined}>{u.active ? 'Disable' : 'Enable'}</button><button className="btn sm" onClick={() => setResetFor(u)}>Reset password</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card pad">
        <h2>Company profile (printed on invoices)</h2>
        <div className="note warn" style={{ marginTop: 10 }}>Enter the real GSTIN before issuing invoices. The value pre-filled here is a placeholder.</div>
        <form className="stack" style={{ marginTop: 14 }} onSubmit={e => saveCompany(formData(e))}>
          <div className="form">
            <Field label="Legal name"><input type="text" name="name" required defaultValue={co.name} /></Field>
            <Field label="GSTIN"><input type="text" name="gstin" maxLength={15} required style={{ textTransform: 'uppercase' }} defaultValue={co.gstin} /></Field>
            <Field label="Address" full><input type="text" name="address" required defaultValue={co.address} /></Field>
            <Field label="Phone"><input type="tel" name="phone" defaultValue={co.phone} /></Field>
            <Field label="Email"><input type="email" name="email" defaultValue={co.email} /></Field>
            <Field label="Bank details (shown on invoice)"><textarea name="bank" placeholder="Account name, A/C no., IFSC, branch" defaultValue={co.bank} /></Field>
            <Field label="Invoice terms"><textarea name="terms" defaultValue={co.terms} /></Field>
          </div>
          <div className="foot" style={{ marginTop: 0 }}><button className="btn accent" type="submit">Save company profile</button></div>
        </form>
      </div>

      <div className="card pad">
        <h2>Data: backup &amp; import</h2>
        <div className="sub">Your data is stored in the company database on the server. Download a backup for your own records or before a big change. Importing a backup (including one from the earlier browser-only version) replaces products, customers, leads, orders and payments; staff accounts and passwords are kept.</div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={backup}><Icon name="down" /> Download backup (JSON)</button>
          <label className="btn" style={{ cursor: 'pointer' }}>Import backup
            <input type="file" accept="application/json" hidden onChange={e => { restore(e.target.files[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="pad row between">
          <div><h2>Security audit trail</h2><div className="sub">Latest 200 matching entries</div></div>
          <input type="text" className="search" placeholder="Filter by user or action" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter audit log" />
        </div>
        <div className="tbl">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Action</th></tr></thead>
            <tbody>
              {logs.map(l => <tr key={l.id}><td className="num" style={{ whiteSpace: 'nowrap' }}>{l.ts}<span className="s">{l.id}</span></td><td>{l.user}</td><td>{l.action}</td></tr>)}
              {logs.length === 0 && <Empty cols={3}>No log entries.</Empty>}
            </tbody>
          </table>
        </div>
      </div>

      {addUser && <UserForm onClose={() => setAddUser(false)} />}
      {resetFor && <ResetForm user={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  );
}
