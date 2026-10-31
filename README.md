# Banday Impex ERP

ERP/CRM for Banday Impex: orders and dispatch, inventory, customers and leads, payments and ledger, GST invoices, users and audit log.

Version 2 is a proper multi-user system: a **Node.js server** with a **PostgreSQL database**. Everybody signs in from their own device and sees the same live data.

```
Browser (React)  ──HTTPS──▶  Node server (server/)  ──▶  PostgreSQL
 screens only                 sign-in, roles, rules        all data, users, audit trail
```

## Deploy on Render

1. Put this folder in a GitHub repository.
2. Render dashboard → **New +** → **Blueprint** → choose the repository. `render.yaml` creates the web service and the database.
3. When asked, enter **ADMIN_EMAIL** (the first admin's email). Render generates **ADMIN_PASSWORD** for you.
4. After the first deploy, open the service → **Environment** and copy `ADMIN_PASSWORD`. Open the site, sign in, and choose your own password when asked.
5. Admin → Add user to create your salesmen and store keepers.

Manual setup instead of the blueprint: create a PostgreSQL database, then a **Web Service** with Build Command `npm install && npm run build`, Start Command `npm start`, Health Check Path `/api/health`, and environment variables `NODE_VERSION=20`, `NODE_ENV=production`, `DATABASE_URL` (the database's Internal Database URL), `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

Notes
- Free database plans can expire; use a paid database plan for real business data, and keep Render's automatic database backups on.
- The tables are created automatically on first start. Redeploys never touch your data.
- Changed your mind about the admin password, or locked out? In the service **Shell**: `npm run set-password -- you@example.com "NewPassw0rd"`.

## Run it on your computer

Needs Node.js 18+ and PostgreSQL (`docker compose up -d` starts one).

```bash
npm install
export DATABASE_URL=postgres://banday:banday@localhost:5432/banday_erp SEED_DEMO=true
npm run dev:api     # API at http://localhost:3000   (first start prints the admin password)
npm run dev         # screens at http://localhost:5173, forwards /api to the server
```

Production build locally: `npm run build && npm start`, then open http://localhost:3000.

## Settings (environment variables)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `PORT` | Port to listen on (Render sets it) |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Admin created on the very first start. If no password is given in production, a random one is printed once in the server log |
| `SEED_DEMO` | `true` loads sample products, customers and orders on the very first start |
| `APP_TIMEZONE` | Timezone for dates and the audit trail (default `Asia/Kolkata`) |
| `IDLE_MINUTES` | Sign out after this many idle minutes (default 60) |
| `DATABASE_SSL` | `true`/`false` to force or disable SSL to the database (auto for Render) |

## Roles

- **Admin**: everything, including users, passwords, company profile, credit limits and holds, backups.
- **Salesperson**: creates orders, customers, leads and payment receipts; marks orders delivered.
- **Store**: dispatches and delivers orders, adjusts stock.

The server checks the role on every action; hiding a button is never the only protection.

## Security

- Passwords are hashed with scrypt and a random salt. Minimum 8 characters, a letter and a number. New and reset passwords must be changed at first sign-in.
- Sessions are random tokens in an `HttpOnly`, `SameSite` (and `Secure` over HTTPS) cookie; only a hash is stored. They end on sign-out, after 60 idle minutes, after 24 hours, when the user is disabled, and when the password is changed or reset.
- 5 wrong passwords lock that email for 5 minutes. Sign-ins and failures appear in Admin → audit trail.
- Writes are serialised in database transactions, so two people can never overspend stock or credit at the same moment.
- Security headers (CSP, frame blocking, HSTS over HTTPS) and a same-origin check on every write.

## Backups and moving old data

- Admin → **Download backup** exports products, customers, leads, orders, payments, staff names and the company profile as JSON (no passwords).
- Admin → **Import backup** replaces that business data. It also accepts the backup file from the earlier browser-only version, which is how you bring old data over. Staff accounts and passwords on the server are kept; staff only in the file are added as disabled.
- For disaster recovery rely on the database provider's backups as well.

## Project layout

```
server/
  index.js       HTTP server, routes, static files, security headers
  actions.js     every business action (orders, stock, payments, users...) with permission checks
  auth.js        scrypt hashing, sessions, lock-out
  db.js          connection pool, schema (created automatically), write lock
  state.js       reads the database into what the screens need
  bootstrap.js   first-start admin / company / optional demo data
  cli.js         set-password recovery command
src/
  main.jsx, App.jsx, store.jsx   React app; store.jsx talks to the API and refreshes every 15 s
  views/, components/            screens
  lib/domain.js, utils.js, seed.js, password.js   rules shared by browser and server
render.yaml      Render blueprint        docker-compose.yml   local PostgreSQL
```

Before issuing invoices set the real GSTIN under Admin → Company profile.
