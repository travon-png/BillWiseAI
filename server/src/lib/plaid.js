import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";

function envBase() {
  const env = String(process.env.PLAID_ENV || "sandbox").toLowerCase();
  if (env === "production") return PlaidEnvironments.production;
  return PlaidEnvironments.sandbox;
}

const configuration = new Configuration({
  basePath: envBase(),
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID || "",
      "PLAID-SECRET": process.env.PLAID_SECRET || "",
    },
  },
});

export const plaid = new PlaidApi(configuration);

export function plaidConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function bankSyncConfigured() {
  return plaidConfigured() && /^[a-f0-9]{64}$/i.test(process.env.BANK_TOKEN_ENCRYPTION_KEY || "");
}

export function countryCodes() {
  const raw = String(process.env.PLAID_COUNTRY_CODES || "US")
    .split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
  return raw.map(code => CountryCode[code] || code);
}

export { Products };
