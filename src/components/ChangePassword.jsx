import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { Modal, Field, formData } from './ui.jsx';
import { MIN_PASSWORD } from '../lib/password.js';

function PasswordFields({ forced }) {
  const [show, setShow] = useState(false);
  const type = show ? 'text' : 'password';
  return (
    <>
      {!forced && <Field label="Current password"><input type={type} name="current" required autoComplete="current-password" /></Field>}
      <Field label="New password"><input type={type} name="next" required minLength={MIN_PASSWORD} autoComplete="new-password" /></Field>
      <Field label="Confirm new password"><input type={type} name="confirm" required minLength={MIN_PASSWORD} autoComplete="new-password" /></Field>
      <label className="check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show passwords</label>
      <div className="sub">At least {MIN_PASSWORD} characters with a letter and a number, no spaces.</div>
    </>
  );
}

// Voluntary change, opened from the header.
export function ChangePasswordModal({ onClose }) {
  const { changePassword } = useStore();
  return (
    <Modal title="Change password" onClose={onClose}>
      <form className="stack" onSubmit={async e => { if (await changePassword(formData(e))) onClose(); }}>
        <div className="stack" style={{ gap: 14 }}><PasswordFields /></div>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn accent" type="submit">Update password</button></div>
      </form>
    </Modal>
  );
}

// Full-screen step shown after signing in with a temporary password.
export function ForcePasswordChange() {
  const { me, S, changePassword, logout } = useStore();
  return (
    <div className="login-page">
      <form className="login-card card" onSubmit={e => { changePassword(formData(e), true); }}>
        <div className="brand login-brand"><div className="logo">BI</div><div><b>{S.company.name}</b><small>Welcome, {me.name}</small></div></div>
        <h1>Choose a new password</h1>
        <p className="sub">You signed in with a temporary password. Set your own to continue.</p>
        <div className="stack" style={{ marginTop: 16, gap: 14 }}>
          <PasswordFields forced />
          <button className="btn accent block" type="submit">Save and continue</button>
          <button className="btn block" type="button" onClick={() => logout()}>Sign out</button>
        </div>
      </form>
    </div>
  );
}
