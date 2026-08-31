# BillWise AI launch integration checklist

## PostgreSQL
1. Provision PostgreSQL.
2. Set `DATABASE_URL`.
3. Run `npm run db:migrate`.

## Reminders
1. Configure SMTP credentials.
2. Keep the reminder worker enabled.
3. Verify email delivery and sender-domain authentication in production.
4. The reminder worker uses a unique delivery key, so retrying a run does not intentionally resend the same bill/date/channel reminder.

## Stripe
1. Create monthly recurring prices for Plus, Pro and Family.
2. Put the three price IDs in the environment.
3. Add `/api/billing/stripe/webhook` as the webhook endpoint.
4. Set `STRIPE_WEBHOOK_SECRET`.
5. Subscribe to at least:
   - checkout.session.completed
   - customer.subscription.created
   - customer.subscription.updated
   - customer.subscription.deleted
6. Configure Stripe Customer Portal.

## Polar
1. Create Plus, Pro and Family monthly subscription products.
2. Put product IDs in environment variables.
3. Add `/api/billing/polar/webhook`.
4. Set `POLAR_WEBHOOK_SECRET`.
5. Start in sandbox.

## Plaid
1. Create a Plaid app.
2. Add client ID + secret.
3. Use sandbox while developing.
4. Set a 32-byte encryption key for bank access tokens.
5. Set country codes to markets you actually support.
6. Verify each target bank/institution is available before advertising bank connectivity.
7. This project only retrieves account/transaction data; it does not initiate transfers.

## Production hardening still recommended
- email verification
- password reset
- optional MFA/passkeys
- refresh-token or secure-cookie auth
- audit log
- privacy/data deletion workflow
- account deletion
- device/session management
- production database backups
- error monitoring
- analytics/consent controls
- legal review for privacy, billing and financial-data language
