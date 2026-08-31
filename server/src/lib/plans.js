export const PLANS = {
  free: {
    name: "Free",
    monthly: 0,
    activeBills: 10,
    emailReminders: false,
    forecastDays: 0,
    savingsGoals: false,
    smartInsights: false,
    bankConnections: false,
    assistant: false,
    reports: false,
    householdMembers: 1,
  },
  plus: {
    name: "Plus",
    monthly: 4.99,
    activeBills: Infinity,
    emailReminders: true,
    forecastDays: 30,
    savingsGoals: true,
    smartInsights: true,
    bankConnections: false,
    assistant: false,
    reports: false,
    householdMembers: 1,
  },
  pro: {
    name: "Pro",
    monthly: 9.99,
    activeBills: Infinity,
    emailReminders: true,
    forecastDays: 90,
    savingsGoals: true,
    smartInsights: true,
    bankConnections: true,
    assistant: true,
    reports: true,
    householdMembers: 1,
  },
  family: {
    name: "Family",
    monthly: 14.99,
    activeBills: Infinity,
    emailReminders: true,
    forecastDays: 90,
    savingsGoals: true,
    smartInsights: true,
    bankConnections: true,
    assistant: true,
    reports: true,
    householdMembers: 5,
  },
};

export function planForProduct(provider, productId) {
  if (!productId) return null;

  if (provider === "stripe") {
    const map = {
      [process.env.STRIPE_PRICE_PLUS || ""]: "plus",
      [process.env.STRIPE_PRICE_PRO || ""]: "pro",
      [process.env.STRIPE_PRICE_FAMILY || ""]: "family",
    };
    return map[productId] || null;
  }

  const map = {
    [process.env.POLAR_PRODUCT_PLUS || ""]: "plus",
    [process.env.POLAR_PRODUCT_PRO || ""]: "pro",
    [process.env.POLAR_PRODUCT_FAMILY || ""]: "family",
  };
  return map[productId] || null;
}

export function billingProduct(plan) {
  const provider = process.env.BILLING_PROVIDER || "demo";

  if (provider === "stripe") {
    return {
      provider,
      productId: {
        plus: process.env.STRIPE_PRICE_PLUS,
        pro: process.env.STRIPE_PRICE_PRO,
        family: process.env.STRIPE_PRICE_FAMILY,
      }[plan],
    };
  }

  if (provider === "polar") {
    return {
      provider,
      productId: {
        plus: process.env.POLAR_PRODUCT_PLUS,
        pro: process.env.POLAR_PRODUCT_PRO,
        family: process.env.POLAR_PRODUCT_FAMILY,
      }[plan],
    };
  }

  return { provider: "demo", productId: plan };
}
