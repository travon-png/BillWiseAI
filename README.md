# BillWise AI

A functional full-stack bill tracker with subscriptions, income, reminders, cash-flow insights, AI-style Q&A, plan tiers, CSV export, and per-user accounts.

## Run it

### Terminal 1 — backend
```bash
cd ~/Downloads/BillWiseAI/server
npm install
cp .env.example .env
npm run dev
```

### Terminal 2 — frontend
```bash
cd ~/Downloads/BillWiseAI/client
npm install
cp .env.example .env
npm run dev
```

Open: http://localhost:5173

Backend: http://localhost:5001

## Plans built into the app
- Free — up to 10 active bills
- Plus — unlimited bills
- Pro — AI assistant, insights, CSV export concepts
- Family — family tier UI ready for later household sharing

The Settings screen includes a demo plan switcher so you can test the subscription experience before connecting a real payment processor.

## Production upgrade path
For a real launch, move storage from the included JSON database to PostgreSQL, add email verification/password reset, HTTPS secure cookies, real notifications, and a real billing provider such as Polar/Stripe/Paddle.

The assistant gives budgeting estimates from data entered by the user. It is not financial, tax, legal, or investment advice.
