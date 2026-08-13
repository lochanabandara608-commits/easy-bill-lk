# Easy Bill LK Online V2

Real server-side shared POS starter.

## Demo logins
- Administrator: admin / admin123
- Manager: manager / manager123
- Cashier: cashier / cashier123

## Includes
- Shared SQLite database
- Secure bcrypt passwords
- Session login
- Role permissions
- POS sales and automatic stock deduction
- Items / inventory
- Purchasing
- Reports
- Expiry management
- Multi-user accounts
- Audit log
- Responsive web UI

## Run
Node.js 20+
npm install
set SESSION_SECRET to a strong secret
npm start
Open http://localhost:3000

For production, use HTTPS and persistent storage. SQLite is intended for a small single-server deployment; use PostgreSQL/MySQL for larger multi-server deployments.
