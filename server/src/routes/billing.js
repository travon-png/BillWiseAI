import express from "express";
import Stripe from "stripe";
import { Checkout, CustomerPortal, Webhooks } from "@polar-sh/express";
import { requireAuth, signShort, verifyShort, newId } from "../lib/auth.js";
import { billingProduct, planForProduct } from "../lib/plans.js";
import { one, query } from "../lib/db.js";

export const billingRouter = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

function activeEntitlement(status) {
  return ["active", "trialing", "paid", "past_due"].includes(String(status || "").toLowerCase());
}

async function recordEvent(provider, eventId, eventType) {
  try {
    await query(
      `INSERT INTO webhook_events(id,provider,event_id,event_type)
       VALUES($1,$2,$3,$4)`,
      [newId(), provider, String(eventId), String(eventType)]
    );
    return true;
  } catch (e) {
    if (e?.code === "23505") return false;
    throw e;
  }
}

async function existingBilling(userId) {
  if (!userId) return null;
  return one("SELECT * FROM billing_customers WHERE user_id=$1", [userId]);
}

async function userIdFromProviderCustomer(provider, customerId) {
  if (!customerId) return null;
  const row = await one(
    `SELECT user_id FROM billing_customers
     WHERE provider=$1 AND customer_id=$2
     LIMIT 1`,
    [provider, customerId]
  );
  return row?.user_id || null;
}

async function provision({
  userId,
  provider,
  customerId,
  subscriptionId,
  status,
  plan,
  currentPeriodEnd = null,
  cancelAtPeriodEnd = false,
  providerProductId = null,
}) {
  if (!userId) return;

  const previous = await existingBilling(userId);
  const resolvedPlan = ["plus", "pro", "family"].includes(plan)
    ? plan
    : previous?.plan || "free";

  const entitled = activeEntitlement(status);
  const normalizedPlan = entitled ? resolvedPlan : "free";

  await query(
    "UPDATE users SET plan=$1,updated_at=now() WHERE id=$2",
    [normalizedPlan, userId]
  );

  await query(
    `INSERT INTO billing_customers(
      user_id,provider,customer_id,subscription_id,status,plan,current_period_end,
      cancel_at_period_end,provider_product_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(user_id) DO UPDATE SET
      provider=excluded.provider,
      customer_id=COALESCE(excluded.customer_id,billing_customers.customer_id),
      subscription_id=COALESCE(excluded.subscription_id,billing_customers.subscription_id),
      status=excluded.status,
      plan=excluded.plan,
      current_period_end=COALESCE(excluded.current_period_end,billing_customers.current_period_end),
      cancel_at_period_end=excluded.cancel_at_period_end,
      provider_product_id=COALESCE(excluded.provider_product_id,billing_customers.provider_product_id),
      updated_at=now()`,
    [
      userId, provider, customerId || null, subscriptionId || null,
      status || "unknown", normalizedPlan, currentPeriodEnd,
      Boolean(cancelAtPeriodEnd), providerProductId || null,
    ]
  );
}

export function mountStripeWebhook(app) {
  app.post(
    "/api/billing/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
          return res.status(503).send("Stripe not configured");
        }

        const event = stripe.webhooks.constructEvent(
          req.body,
          req.headers["stripe-signature"],
          process.env.STRIPE_WEBHOOK_SECRET
        );

        if (!(await recordEvent("stripe", event.id, event.type))) {
          return res.json({ received: true, duplicate: true });
        }

        const obj = event.data.object;

        if (event.type === "checkout.session.completed") {
          const userId = obj.client_reference_id || obj.metadata?.userId;
          const plan = obj.metadata?.plan || "free";
          await provision({
            userId,
            provider: "stripe",
            customerId: obj.customer,
            subscriptionId: obj.subscription,
            status: "active",
            plan,
          });
        }

        if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
          const sub = obj;
          let userId = sub.metadata?.userId;
          if (!userId) userId = await userIdFromProviderCustomer("stripe", sub.customer);

          const productId = sub.items?.data?.[0]?.price?.id || null;
          const plan = sub.metadata?.plan || planForProduct("stripe", productId) || "free";
          const status = event.type === "customer.subscription.deleted" ? "revoked" : sub.status;

          await provision({
            userId,
            provider: "stripe",
            customerId: sub.customer,
            subscriptionId: sub.id,
            status,
            plan,
            currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
            cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
            providerProductId: productId,
          });
        }

        res.json({ received: true });
      } catch (e) {
        console.error("Stripe webhook error", e);
        res.status(400).send(`Webhook Error: ${e.message}`);
      }
    }
  );
}

billingRouter.get("/config", requireAuth, async (req, res, next) => {
  try {
    const billing = await existingBilling(req.user.id);
    const provider = process.env.BILLING_PROVIDER || "demo";

    res.json({
      provider,
      plan: req.user.plan,
      prices: { free: 0, plus: 4.99, pro: 9.99, family: 14.99 },
      billing: billing
        ? {
            status: billing.status,
            plan: billing.plan,
            currentPeriodEnd: billing.current_period_end,
            cancelAtPeriodEnd: billing.cancel_at_period_end,
            hasCustomerPortal: ["stripe", "polar"].includes(billing.provider) && Boolean(billing.customer_id),
          }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

billingRouter.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    const plan = String(req.body?.plan || "").toLowerCase();
    if (!["plus", "pro", "family"].includes(plan)) {
      return res.status(400).json({ error: "Invalid paid plan." });
    }

    const { provider, productId } = billingProduct(plan);

    if (provider === "demo") {
      await provision({
        userId: req.user.id,
        provider: "demo",
        status: "active",
        plan,
      });
      return res.json({ demo: true, reload: true });
    }

    if (!productId) {
      return res.status(503).json({ error: `${provider} product ID for ${plan} is not configured.` });
    }

    if (provider === "stripe") {
      if (!stripe) return res.status(503).json({ error: "Stripe is not configured." });

      const billing = await existingBilling(req.user.id);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: billing?.provider === "stripe" && billing.customer_id ? billing.customer_id : undefined,
        customer_email: billing?.provider === "stripe" && billing.customer_id ? undefined : req.user.email,
        client_reference_id: req.user.id,
        line_items: [{ price: productId, quantity: 1 }],
        metadata: { userId: req.user.id, plan },
        subscription_data: { metadata: { userId: req.user.id, plan } },
        success_url: `${process.env.APP_URL}/?billing=success`,
        cancel_url: `${process.env.APP_URL}/?billing=cancel`,
        allow_promotion_codes: true,
      });
      return res.json({ url: session.url });
    }

    if (provider === "polar") {
      if (!process.env.POLAR_ACCESS_TOKEN) {
        return res.status(503).json({ error: "Polar is not configured on the server." });
      }

      const t = signShort(
        {
          kind: "polar-checkout",
          userId: req.user.id,
          email: req.user.email,
          name: req.user.name,
          plan,
          productId,
        },
        "10m"
      );
      return res.json({
        url: `${process.env.API_URL}/api/billing/polar/start?t=${encodeURIComponent(t)}`,
      });
    }

    res.status(400).json({ error: "Unsupported billing provider." });
  } catch (e) {
    next(e);
  }
});

billingRouter.post("/portal", requireAuth, async (req, res, next) => {
  try {
    const billing = await existingBilling(req.user.id);
    if (!billing?.customer_id) {
      return res.status(404).json({ error: "No live billing customer exists yet." });
    }

    if (billing.provider === "stripe") {
      if (!stripe) return res.status(503).json({ error: "Stripe is not configured." });
      const session = await stripe.billingPortal.sessions.create({
        customer: billing.customer_id,
        return_url: process.env.APP_URL,
      });
      return res.json({ url: session.url });
    }

    if (billing.provider === "polar") {
      if (!process.env.POLAR_ACCESS_TOKEN) {
        return res.status(503).json({ error: "Polar is not configured on the server." });
      }
      const t = signShort(
        { kind: "polar-portal", customerId: billing.customer_id },
        "10m"
      );
      return res.json({
        url: `${process.env.API_URL}/api/billing/polar/portal?t=${encodeURIComponent(t)}`,
      });
    }

    res.status(400).json({ error: "Demo billing has no external customer portal." });
  } catch (e) {
    next(e);
  }
});

export function mountPolarRoutes(app) {
  const server = String(process.env.POLAR_SERVER || "sandbox") === "production"
    ? "production"
    : "sandbox";

  if (process.env.POLAR_ACCESS_TOKEN) {
    const checkoutHandler = Checkout({
      accessToken: process.env.POLAR_ACCESS_TOKEN,
      successUrl: `${process.env.APP_URL}/?billing=success&checkout_id={CHECKOUT_ID}`,
      returnUrl: process.env.APP_URL,
      server,
      theme: "dark",
    });

    app.get("/api/billing/polar/start", (req, res, next) => {
      try {
        const c = verifyShort(String(req.query.t || ""));
        if (c.kind !== "polar-checkout") {
          return res.status(400).send("Invalid checkout token.");
        }

        req.query.products = c.productId;
        req.query.customerExternalId = c.userId;
        req.query.customerEmail = c.email;
        req.query.customerName = c.name;
        req.query.metadata = JSON.stringify({ userId: c.userId, plan: c.plan });
        checkoutHandler(req, res, next);
      } catch (e) {
        res.status(400).send("Checkout token expired or invalid.");
      }
    });

    const portalHandler = CustomerPortal({
      accessToken: process.env.POLAR_ACCESS_TOKEN,
      server,
      returnUrl: process.env.APP_URL,
      getCustomerId: req => {
        const c = verifyShort(String(req.query.t || ""));
        if (c.kind !== "polar-portal") throw new Error("Invalid portal token");
        return c.customerId;
      },
    });

    app.get("/api/billing/polar/portal", portalHandler);
  }

  if (process.env.POLAR_WEBHOOK_SECRET) {
    app.post(
      "/api/billing/polar/webhook",
      Webhooks({
        webhookSecret: process.env.POLAR_WEBHOOK_SECRET,
        onPayload: async payload => {
          const type = payload.type || "unknown";
          const data = payload.data || {};
          const eventId = `${type}:${data.id || "no-id"}:${payload.timestamp || data.modified_at || data.modifiedAt || "no-time"}`;

          if (!(await recordEvent("polar", eventId, type))) return;

          const customer = data.customer || {};
          const customerId = customer.id || data.customer_id || data.customerId || null;
          let userId =
            data.metadata?.userId ||
            data.metadata?.user_id ||
            customer.external_id ||
            customer.externalId ||
            data.customer_external_id ||
            data.customerExternalId ||
            null;

          if (!userId && customerId) {
            userId = await userIdFromProviderCustomer("polar", customerId);
          }

          const productId = data.product_id || data.productId || data.product?.id || null;
          const plan =
            data.metadata?.plan ||
            customer.metadata?.plan ||
            planForProduct("polar", productId) ||
            (userId ? (await existingBilling(userId))?.plan : null) ||
            "free";

          if (type.startsWith("subscription.")) {
            let status = String(data.status || "unknown").toLowerCase();
            if (type === "subscription.active") status = "active";
            if (type === "subscription.past_due") status = "past_due";
            if (type === "subscription.revoked") status = "revoked";
            // Polar's subscription.canceled event can still have active status when cancellation is scheduled.
            if (type === "subscription.canceled" && status === "unknown") status = "active";

            await provision({
              userId,
              provider: "polar",
              customerId,
              subscriptionId: data.id,
              status,
              plan,
              currentPeriodEnd: data.current_period_end || data.currentPeriodEnd || null,
              cancelAtPeriodEnd: Boolean(data.cancel_at_period_end ?? data.cancelAtPeriodEnd),
              providerProductId: productId,
            });
          }

          if (type === "order.paid") {
            const subscriptionId = data.subscription_id || data.subscriptionId || data.subscription?.id || null;
            if (userId && subscriptionId) {
              await provision({
                userId,
                provider: "polar",
                customerId,
                subscriptionId,
                status: "active",
                plan,
                providerProductId: productId,
              });
            }
          }

          if (type === "order.refunded") {
            // Refunds are recorded, but subscription entitlement is changed only by subscription lifecycle events.
            return;
          }
        },
      })
    );
  }
}
