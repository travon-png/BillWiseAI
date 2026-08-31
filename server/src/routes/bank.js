import express from "express";
import { requireAuth, requirePlan, newId } from "../lib/auth.js";
import { plaid, plaidConfigured, bankSyncConfigured, countryCodes, Products } from "../lib/plaid.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { one, query } from "../lib/db.js";
import { detectRecurringTransactions } from "../lib/finance.js";

const router = express.Router();
router.use(requireAuth);
router.use(requirePlan("pro", "family"));

function plaidErrorCode(error) {
  return error?.response?.data?.error_code || error?.error_code || "PLAID_ERROR";
}

function plaidErrorMessage(error) {
  return error?.response?.data?.display_message ||
    error?.response?.data?.error_message ||
    error?.message ||
    "Plaid request failed.";
}

async function upsertAccounts(item, accessToken) {
  const accounts = await plaid.accountsGet({ access_token: accessToken });

  for (const a of accounts.data.accounts) {
    await query(
      `INSERT INTO bank_accounts(
        id,user_id,bank_item_id,provider_account_id,name,official_name,mask,type,subtype,
        current_balance,available_balance,iso_currency_code
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(user_id,provider_account_id) DO UPDATE SET
        bank_item_id=excluded.bank_item_id,
        name=excluded.name,
        official_name=excluded.official_name,
        mask=excluded.mask,
        type=excluded.type,
        subtype=excluded.subtype,
        current_balance=excluded.current_balance,
        available_balance=excluded.available_balance,
        iso_currency_code=excluded.iso_currency_code,
        updated_at=now()`,
      [
        newId(), item.user_id, item.id, a.account_id, a.name, a.official_name || null,
        a.mask || null, a.type || null, a.subtype || null,
        a.balances.current ?? null, a.balances.available ?? null,
        a.balances.iso_currency_code || null,
      ]
    );
  }
}

async function syncTransactionsPageSet(item, accessToken) {
  const startingCursor = item.cursor || undefined;
  let cursor = startingCursor;
  let hasMore = true;
  let added = 0;
  let modified = 0;
  let removed = 0;

  while (hasMore) {
    const sync = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 250,
    });

    for (const t of [...sync.data.added, ...sync.data.modified]) {
      await query(
        `INSERT INTO bank_transactions(
          id,user_id,bank_item_id,provider_transaction_id,provider_account_id,merchant_name,
          name,amount,date,pending,category,raw
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
        ON CONFLICT(user_id,provider_transaction_id) DO UPDATE SET
          bank_item_id=excluded.bank_item_id,
          provider_account_id=excluded.provider_account_id,
          merchant_name=excluded.merchant_name,
          name=excluded.name,
          amount=excluded.amount,
          date=excluded.date,
          pending=excluded.pending,
          category=excluded.category,
          raw=excluded.raw,
          updated_at=now()`,
        [
          newId(), item.user_id, item.id, t.transaction_id, t.account_id,
          t.merchant_name || null, t.name, Number(t.amount), t.date,
          Boolean(t.pending), t.personal_finance_category?.primary || null,
          JSON.stringify(t),
        ]
      );
    }

    for (const x of sync.data.removed) {
      await query(
        `DELETE FROM bank_transactions
         WHERE user_id=$1 AND provider_transaction_id=$2`,
        [item.user_id, x.transaction_id]
      );
    }

    added += sync.data.added.length;
    modified += sync.data.modified.length;
    removed += sync.data.removed.length;
    cursor = sync.data.next_cursor;
    hasMore = sync.data.has_more;
  }

  return { cursor, added, modified, removed };
}

async function syncOneItem(item) {
  const accessToken = decryptSecret(item.encrypted_access_token);
  await upsertAccounts(item, accessToken);

  let result;
  let attempts = 0;

  while (attempts < 3) {
    attempts++;
    try {
      result = await syncTransactionsPageSet(item, accessToken);
      break;
    } catch (error) {
      if (plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempts < 3) {
        continue;
      }
      throw error;
    }
  }

  await query(
    `UPDATE bank_items SET
       cursor=$1,status='active',last_error_code=NULL,last_error_message=NULL,
       last_synced_at=now(),updated_at=now()
     WHERE id=$2`,
    [result.cursor, item.id]
  );

  return result;
}

router.get("/status", async (_req, res) => {
  res.json({
    configured: bankSyncConfigured(),
    env: process.env.PLAID_ENV || "sandbox",
    countryCodes: String(process.env.PLAID_COUNTRY_CODES || "US").split(",").map(x => x.trim()),
    readOnly: true,
  });
});

router.post("/link-token", async (req, res, next) => {
  try {
    if (!bankSyncConfigured()) {
      return res.status(503).json({ error: "Bank connections are not available in this environment yet." });
    }

    const request = {
      user: { client_user_id: req.user.id },
      client_name: "BillWise AI",
      products: [Products.Transactions],
      country_codes: countryCodes(),
      language: "en",
      transactions: { days_requested: 180 },
    };

    if (process.env.PLAID_REDIRECT_URI) request.redirect_uri = process.env.PLAID_REDIRECT_URI;
    if (process.env.PLAID_WEBHOOK_URL) request.webhook = process.env.PLAID_WEBHOOK_URL;

    const r = await plaid.linkTokenCreate(request);
    res.json({ linkToken: r.data.link_token, expiration: r.data.expiration });
  } catch (e) {
    res.status(502).json({ error: plaidErrorMessage(e) });
  }
});

router.post("/items/:id/update-link-token", async (req, res, next) => {
  try {
    if (!bankSyncConfigured()) {
      return res.status(503).json({ error: "Bank connections are not available in this environment yet." });
    }

    const item = await one(
      "SELECT * FROM bank_items WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!item) return res.status(404).json({ error: "Bank connection not found." });

    const request = {
      user: { client_user_id: req.user.id },
      client_name: "BillWise AI",
      access_token: decryptSecret(item.encrypted_access_token),
      country_codes: countryCodes(),
      language: "en",
    };
    if (process.env.PLAID_REDIRECT_URI) request.redirect_uri = process.env.PLAID_REDIRECT_URI;

    const r = await plaid.linkTokenCreate(request);
    res.json({ linkToken: r.data.link_token, expiration: r.data.expiration });
  } catch (e) {
    res.status(502).json({ error: plaidErrorMessage(e) });
  }
});

router.post("/exchange", async (req, res, next) => {
  try {
    const publicToken = req.body?.publicToken;
    if (!publicToken) return res.status(400).json({ error: "publicToken is required." });

    if (!process.env.BANK_TOKEN_ENCRYPTION_KEY) {
      return res.status(503).json({ error: "Bank-token encryption is not configured on the server." });
    }

    const r = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    const itemId = r.data.item_id;
    const accessToken = r.data.access_token;
    const meta = req.body?.metadata || {};

    let item = await one(
      `INSERT INTO bank_items(
        id,user_id,item_id,institution_id,institution_name,encrypted_access_token,status
      ) VALUES($1,$2,$3,$4,$5,$6,'active')
      ON CONFLICT(user_id,item_id) DO UPDATE SET
        institution_id=excluded.institution_id,
        institution_name=excluded.institution_name,
        encrypted_access_token=excluded.encrypted_access_token,
        status='active',last_error_code=NULL,last_error_message=NULL,updated_at=now()
      RETURNING *`,
      [
        newId(), req.user.id, itemId,
        meta.institution?.institution_id || null,
        meta.institution?.name || "Connected bank",
        encryptSecret(accessToken),
      ]
    );

    let sync = { added: 0, modified: 0, removed: 0 };
    try {
      sync = await syncOneItem(item);
    } catch (e) {
      await query(
        `UPDATE bank_items SET status='error',last_error_code=$1,last_error_message=$2,updated_at=now()
         WHERE id=$3`,
        [plaidErrorCode(e), plaidErrorMessage(e), item.id]
      );
    }

    res.json({ ok: true, itemId, sync });
  } catch (e) {
    res.status(502).json({ error: plaidErrorMessage(e) });
  }
});

router.post("/sync", async (req, res, next) => {
  try {
    if (!bankSyncConfigured()) {
      return res.status(503).json({ error: "Bank connections are not available in this environment yet." });
    }

    const items = (await query(
      "SELECT * FROM bank_items WHERE user_id=$1 AND status IN ('active','error','needs_update')",
      [req.user.id]
    )).rows;

    let added = 0, modified = 0, removed = 0, synced = 0, failed = 0;

    for (const item of items) {
      try {
        const result = await syncOneItem(item);
        added += result.added;
        modified += result.modified;
        removed += result.removed;
        synced++;
      } catch (e) {
        failed++;
        await query(
          `UPDATE bank_items SET status=$1,last_error_code=$2,last_error_message=$3,updated_at=now()
           WHERE id=$4`,
          [
            plaidErrorCode(e) === "ITEM_LOGIN_REQUIRED" ? "needs_update" : "error",
            plaidErrorCode(e), plaidErrorMessage(e), item.id,
          ]
        );
      }
    }

    res.json({ ok: failed === 0, items: items.length, synced, failed, added, modified, removed });
  } catch (e) {
    next(e);
  }
});

router.get("/accounts", async (req, res, next) => {
  try {
    const [items, accounts] = await Promise.all([
      query(
        `SELECT id,item_id,institution_id,institution_name,status,last_error_code,
                last_error_message,last_synced_at,created_at
         FROM bank_items WHERE user_id=$1 ORDER BY created_at DESC`,
        [req.user.id]
      ),
      query(
        `SELECT a.*,i.institution_name,i.status item_status
         FROM bank_accounts a
         JOIN bank_items i ON i.id=a.bank_item_id
         WHERE a.user_id=$1 ORDER BY a.name`,
        [req.user.id]
      ),
    ]);
    res.json({ items: items.rows, accounts: accounts.rows });
  } catch (e) {
    next(e);
  }
});

router.get("/transactions", async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const r = await query(
      `SELECT * FROM bank_transactions
       WHERE user_id=$1 ORDER BY date DESC,created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ transactions: r.rows });
  } catch (e) {
    next(e);
  }
});

router.get("/subscription-candidates", async (req, res, next) => {
  try {
    const r = await query(
      `SELECT * FROM bank_transactions
       WHERE user_id=$1 AND date >= current_date - interval '12 months'
       ORDER BY date`,
      [req.user.id]
    );
    res.json({ candidates: detectRecurringTransactions(r.rows) });
  } catch (e) {
    next(e);
  }
});

router.post("/subscription-candidates/import", async (req, res, next) => {
  try {
    const c = req.body || {};
    if (!c.merchant || c.averageAmount == null || !c.nextExpectedDate) {
      return res.status(400).json({ error: "Candidate details are incomplete." });
    }

    const existing = await one(
      `SELECT id FROM bills
       WHERE user_id=$1 AND is_subscription=true AND lower(name)=lower($2)
       LIMIT 1`,
      [req.user.id, c.merchant]
    );
    if (existing) return res.status(409).json({ error: "That subscription is already in BillWise." });

    const row = await one(
      `INSERT INTO bills(
        id,user_id,name,amount,due_date,category,recurring,recurrence,is_subscription,source,source_transaction_id
      ) VALUES($1,$2,$3,$4,$5,$6,true,'monthly',true,'bank-detected',$7)
      RETURNING *`,
      [newId(), req.user.id, c.merchant, Number(c.averageAmount), c.nextExpectedDate, c.category || "Subscription", c.sourceTransactionId || null]
    );
    res.json({ bill: row });
  } catch (e) {
    next(e);
  }
});

router.delete("/items/:id", async (req, res, next) => {
  try {
    const item = await one(
      "SELECT * FROM bank_items WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!item) return res.status(404).json({ error: "Bank connection not found." });

    try {
      if (plaidConfigured()) {
        await plaid.itemRemove({ access_token: decryptSecret(item.encrypted_access_token) });
      }
    } catch (e) {
      console.warn("Plaid itemRemove failed; removing local record anyway:", plaidErrorMessage(e));
    }

    await query("DELETE FROM bank_items WHERE id=$1 AND user_id=$2", [item.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export async function plaidWebhookHandler(req, res) {
  try {
    const configuredSecret = process.env.PLAID_WEBHOOK_SHARED_SECRET || "";
    if (configuredSecret && String(req.query.key || "") !== configuredSecret) {
      return res.status(401).json({ error: "Invalid webhook key." });
    }

    const body = req.body || {};
    const itemId = body.item_id;
    if (!itemId) return res.json({ received: true });

    const item = await one("SELECT * FROM bank_items WHERE item_id=$1 LIMIT 1", [itemId]);
    if (!item) return res.json({ received: true, unknownItem: true });

    if (body.webhook_type === "ITEM" && body.webhook_code === "ERROR") {
      const code = body.error?.error_code || "ITEM_ERROR";
      await query(
        `UPDATE bank_items SET status=$1,last_error_code=$2,last_error_message=$3,updated_at=now()
         WHERE id=$4`,
        [code === "ITEM_LOGIN_REQUIRED" ? "needs_update" : "error", code, body.error?.display_message || body.error?.error_message || "Bank connection requires attention.", item.id]
      );
    }

    if (body.webhook_type === "ITEM" && body.webhook_code === "LOGIN_REPAIRED") {
      await query(
        `UPDATE bank_items SET status='active',last_error_code=NULL,last_error_message=NULL,updated_at=now()
         WHERE id=$1`,
        [item.id]
      );
    }

    if (body.webhook_type === "TRANSACTIONS" && body.webhook_code === "SYNC_UPDATES_AVAILABLE") {
      try {
        await syncOneItem(item);
      } catch (e) {
        await query(
          `UPDATE bank_items SET status=$1,last_error_code=$2,last_error_message=$3,updated_at=now()
           WHERE id=$4`,
          [plaidErrorCode(e) === "ITEM_LOGIN_REQUIRED" ? "needs_update" : "error", plaidErrorCode(e), plaidErrorMessage(e), item.id]
        );
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error("Plaid webhook error", e);
    res.status(500).json({ error: "Webhook processing failed." });
  }
}

export default router;
