# Upgrade your existing BillWiseAI folder

This package is the **same BillWiseAI project**, updated in place. It is not a separate app.

## What was changed inside your existing structure

### Existing files replaced
- `server/package.json`
- `server/.env.example`
- `server/src/server.js`
- `client/package.json`
- `client/.env.example`
- `client/index.html`
- `client/src/App.jsx`
- `client/src/api.js`
- `client/src/main.jsx`
- `client/src/styles.css`

### New files/folders added
- `docker-compose.yml`
- `SETUP_CHECKLIST.md`
- `server/sql/001_init.sql`
- `server/src/migrate.js`
- `server/src/import-json.js`
- `server/src/run-reminders.js`
- `server/src/lib/*`
- `server/src/routes/*`
- `server/src/workers/*`

### Legacy file left in place
- `server/src/store.js`

It is no longer used by the app after PostgreSQL is enabled, but it is kept so the old folder is not destructively stripped.

## Preserve your existing local data

If your old app already created `server/data.json`, **do not delete it**.

After PostgreSQL is running and migrations are complete:

```bash
cd server
npm run db:import-json
```

That copies the old users, bills and income records into PostgreSQL while preserving password hashes.
Users will need to sign in once again because old JWTs refer to the old JSON user IDs.

## First run after update

From the BillWiseAI root:

```bash
docker compose up -d postgres mailpit
```

Backend:

```bash
cd server
npm install
cp -n .env.example .env
npm run db:migrate
npm run db:import-json
npm run dev
```

Frontend, in another Terminal:

```bash
cd client
npm install
cp -n .env.example .env
npm run dev
```

Open:

- App: `http://localhost:5173`
- Test reminder inbox: `http://localhost:8025`

## New features now inside the same app

- PostgreSQL
- email + in-app reminders
- Stripe subscriptions
- Polar subscriptions
- verified billing webhooks
- customer billing portal
- read-only Plaid bank connections
- balances and transaction sync
- recurring subscription detection
- encrypted bank access tokens
- plan feature gates
- rate limiting and security headers
