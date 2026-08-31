function num(v) { return Number(v || 0); }

export function dashboardFrom({ bills, incomes, bankAccounts = [] }) {
  const unpaid = bills.filter(b => !b.paid);
  const subs = bills.filter(b => b.is_subscription);
  const monthlyBills = unpaid.reduce((s,b)=>s+num(b.amount),0);
  const monthlyIncome = incomes.reduce((s,i)=>s+num(i.amount),0);
  const subscriptionMonthly = subs.reduce((s,b)=>s+num(b.amount),0);
  const bankBalance = bankAccounts.reduce((s,a)=>s+num(a.current_balance),0);

  const increases = bills
    .filter(b => b.previous_amount != null && num(b.amount) > num(b.previous_amount))
    .map(b => ({
      id: b.id,
      name: b.name,
      increase: num(b.amount) - num(b.previous_amount),
      percent: num(b.previous_amount) > 0
        ? ((num(b.amount)-num(b.previous_amount))/num(b.previous_amount))*100
        : 0,
    }));

  return {
    monthlyBills,
    monthlyIncome,
    leftover: monthlyIncome - monthlyBills,
    subscriptionMonthly,
    subscriptionYearly: subscriptionMonthly * 12,
    bankBalance,
    increases,
  };
}

export function detectRecurringTransactions(rows) {
  const groups = new Map();
  for (const t of rows) {
    if (t.pending) continue;
    const merchant = (t.merchant_name || t.name || "").trim().toLowerCase();
    if (!merchant || Number(t.amount) <= 0) continue;
    const arr = groups.get(merchant) || [];
    arr.push(t);
    groups.set(merchant, arr);
  }

  const candidates = [];
  for (const [key, items] of groups) {
    items.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    if (items.length < 2) continue;

    const amounts = items.map(x=>Number(x.amount));
    const avg = amounts.reduce((a,b)=>a+b,0)/amounts.length;
    const maxDeviation = Math.max(...amounts.map(a=>Math.abs(a-avg)/Math.max(avg,0.01)));

    const intervals = [];
    for (let i=1;i<items.length;i++) {
      intervals.push(
        Math.round((new Date(items[i].date)-new Date(items[i-1].date))/86400000)
      );
    }
    const monthlyHits = intervals.filter(d=>d>=24&&d<=38).length;
    if (monthlyHits < 1 || maxDeviation > 0.20) continue;

    const latest = items[items.length-1];
    const next = new Date(latest.date);
    next.setDate(next.getDate()+30);

    candidates.push({
      merchant: latest.merchant_name || latest.name,
      averageAmount: Number(avg.toFixed(2)),
      occurrences: items.length,
      confidence: Math.min(0.98, 0.65 + monthlyHits*0.08 + Math.max(0,0.2-maxDeviation)),
      nextExpectedDate: next.toISOString().slice(0,10),
      category: latest.category || "Subscription",
      sourceTransactionId: latest.provider_transaction_id,
    });
  }

  return candidates.sort((a,b)=>b.confidence-a.confidence);
}
