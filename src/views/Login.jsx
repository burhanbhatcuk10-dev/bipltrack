import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { Field, formData } from '../components/ui.jsx';

export default function Login() {
  const { S, login } = useStore();
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = e => {
    const f = formData(e);
    setBusy(true);
    setError('');
    login(f.email, f.password).then(r => { if (!r.ok) { setError(r.error); setBusy(false); } });
  };

  return (
    <div className="login-page">
      <form className="login-card card" onSubmit={submit} autoComplete="on">
        <div className="brand login-brand">
          <div className="logo">BI</div>
          <div>
            <b>{S.company.name}</b>
            <small>Rehmat Spices · Diamond Saffron · Hidden Valley</small>
          </div>
        </div>
        <h1>Sign in</h1>
        <p className="sub">Use the email and password given to you by your admin.</p>
        <div className="stack" style={{ marginTop: 16, gap: 14 }}>
          <Field label="Email">
            <input type="email" name="email" required autoFocus autoComplete="username" inputMode="email" />
          </Field>
          <Field label="Password">
            <span className="pw">
              <input type={show ? 'text' : 'password'} name="password" required autoComplete="current-password" />
              <button type="button" className="btn sm" onClick={() => setShow(v => !v)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
            </span>
          </Field>
          {error && <div className="note bad" role="alert">{error}</div>}
          <button className="btn accent block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
        <p className="sub" style={{ marginTop: 16 }}>Forgot your password? Ask an admin to set a temporary one for you.</p>
      </form>
    </div>
  );
}
