# Changelog

## 2.0.0
- Server and database: Node.js API with PostgreSQL replaces browser storage. Many users, many devices, one live set of data.
- Every action is validated and permission-checked on the server inside a database transaction (no overselling stock, no credit-limit races, safe numbering).
- Sign-in with scrypt-hashed passwords and HttpOnly cookie sessions; lock-out, idle timeout, sessions end when a user is disabled or their password changes.
- Screens refresh automatically when anyone else changes data; connection-lost notice.
- Render blueprint, local Docker database, set-password recovery command.
- Backup download/import (accepts backups from version 1.x). "Reset to demo data" removed.
- Orders merge repeated lines for the same product; payments must belong to the order's customer.

## 1.1.0
- Sign-in for Admin, Salesperson and Store (browser-only).
## 1.0.0
- First release.
