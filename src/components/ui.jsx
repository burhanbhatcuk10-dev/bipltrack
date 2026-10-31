import React, { useEffect } from 'react';

const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  print: <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />,
  down: <path d="M12 3v12M6 11l6 6 6-6M4 21h16" />,
  pin: <><path d="M12 22s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>
};

export function Icon({ name, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export const Pill = ({ kind, children }) => <span className={`pill p-${kind}`}>{children}</span>;

export function Field({ label, full, children }) {
  return <label className={'f' + (full ? ' full' : '')}>{label}{children}</label>;
}

export const Btn = ({ kind = '', sm, icon, children, ...p }) => (
  <button className={`btn ${kind} ${sm ? 'sm' : ''}`} {...p}>{icon && <Icon name={icon} size={sm ? 13 : 15} />}{children}</button>
);

export const Empty = ({ cols, children }) => <tr><td colSpan={cols} className="empty">{children}</td></tr>;

export function Modal({ title, onClose, wide, children, hideHeader }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'sheet' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        {!hideHeader && (
          <div className="hd"><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></div>
        )}
        {children}
      </div>
    </div>
  );
}

// Reads a submitted <form> into a plain object.
export const formData = e => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget).entries()); };
