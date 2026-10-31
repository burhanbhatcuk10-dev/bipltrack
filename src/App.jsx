import React, { useEffect, useState } from 'react';
import Login from './views/Login.jsx';
import { ChangePasswordModal, ForcePasswordChange } from './components/ChangePassword.jsx';
import { useStore } from './store.jsx';
import { ROLE_LABEL } from './lib/domain.js';
import Dashboard from './views/Dashboard.jsx';
import Orders from './views/Orders.jsx';
import Products from './views/Products.jsx';
import Crm from './views/Crm.jsx';
import Payments from './views/Payments.jsx';
import Admin from './views/Admin.jsx';

// Only a signed-in user ever reaches the application screens.
export default function App() {
  const { S, me, ready } = useStore();
  useEffect(() => { document.title = S.company.name + ' ERP'; }, [S.company.name]);
  if (!ready) return <div className="login-page"><div className="sub" role="status">Loading…</div></div>;
  if (!me) return <Login />;
  if (me.mustChange) return <ForcePasswordChange />;
  return <Shell key={me.id} />;
}

function Shell() {
  const { S, me, logout, online } = useStore();
  const [pwOpen, setPwOpen] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [autoOrder, setAutoOrder] = useState(false);

  const pending = S.orders.filter(o => o.status === 'Pending Review').length;
  const tabs = [['dashboard', 'Dashboard'], ['orders', 'Orders & Dispatch'], ['products', 'Inventory'], ['crm', 'Customers & Leads'], ['payments', 'Payments & Ledger']];
  if (me.role === 'admin') tabs.push(['admin', 'Admin & Audit']);
  const active = tabs.some(t => t[0] === tab) ? tab : 'dashboard';

  const go = t => { setTab(t); window.scrollTo(0, 0); };
  const newOrder = () => { setAutoOrder(true); go('orders'); };

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand">
            <div className="logo">BI</div>
            <div>
              <b>{S.company.name}</b>
              <small>Rehmat Spices · Diamond Saffron · Hidden Valley</small>
            </div>
          </div>
          <div className="who">
            <div className="me"><b>{me.name}</b><small>{me.title}</small></div>
            <span className="chip">{ROLE_LABEL[me.role]}</span>
            <button className="btn sm ghost" onClick={() => setPwOpen(true)}>Password</button>
            <button className="btn sm ghost" onClick={() => logout()}>Sign out</button>
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        <div className="wrap">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => go(id)} aria-current={active === id ? 'page' : undefined}>
              {label}{id === 'orders' && pending > 0 && <span className="badge">{pending}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main>
        <div className="wrap">
          {active === 'dashboard' && <Dashboard goTab={go} newOrder={newOrder} />}
          {active === 'orders' && <Orders autoOpen={autoOrder} onAutoOpened={() => setAutoOrder(false)} />}
          {active === 'products' && <Products />}
          {active === 'crm' && <Crm />}
          {active === 'payments' && <Payments />}
          {active === 'admin' && <Admin />}
        </div>
      </main>

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}

      <footer>
        <div className="wrap">
          {S.company.name} · {S.company.address} ·{' '}
          {online ? 'Data is saved on the company server' : <b style={{ color: 'var(--bad)' }}>Connection lost. Retrying… changes you make now may not be saved.</b>}
        </div>
      </footer>
    </>
  );
}
