import express from "express";
import { requireAuth, requirePlan } from "../lib/auth.js";
import { query } from "../lib/db.js";
import { dashboardFrom } from "../lib/finance.js";

const router=express.Router();
router.use(requireAuth);

router.get("/dashboard",async(req,res,next)=>{
  try{
    const [b,i,a,n] = await Promise.all([
      query("SELECT * FROM bills WHERE user_id=$1 ORDER BY due_date",[req.user.id]),
      query("SELECT * FROM incomes WHERE user_id=$1 ORDER BY payday",[req.user.id]),
      query("SELECT * FROM bank_accounts WHERE user_id=$1 ORDER BY name",[req.user.id]),
      query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",[req.user.id]),
    ]);

    const today=new Date().toISOString().slice(0,10);
    const h=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
    const bills=b.rows;
    const upcoming=bills.filter(x=>!x.paid && String(x.due_date).slice(0,10)>=today && String(x.due_date).slice(0,10)<=h)
      .map(x=>({...x,daysUntilDue:Math.ceil((new Date(x.due_date)-new Date(today))/86400000)}));
    const overdue=bills.filter(x=>!x.paid && String(x.due_date).slice(0,10)<today);

    res.json({
      bills,incomes:i.rows,bankAccounts:a.rows,notifications:n.rows,
      upcoming,overdue,
      totals:dashboardFrom({bills,incomes:i.rows,bankAccounts:a.rows}),
    });
  }catch(e){next(e)}
});

router.post("/assistant", requirePlan("pro","family"), async(req,res,next)=>{
  try{
    const [b,i,a]=await Promise.all([
      query("SELECT * FROM bills WHERE user_id=$1",[req.user.id]),
      query("SELECT * FROM incomes WHERE user_id=$1",[req.user.id]),
      query("SELECT * FROM bank_accounts WHERE user_id=$1",[req.user.id])
    ]);
    const t=dashboardFrom({bills:b.rows,incomes:i.rows,bankAccounts:a.rows});
    const question=String(req.body?.question||"");
    const q=question.toLowerCase();
    let answer;

    if(q.includes("subscription")){
      answer=`Your subscriptions total about $${t.subscriptionMonthly.toFixed(2)} per month, or $${t.subscriptionYearly.toFixed(2)} per year.`;
    }else if(/afford|spend|buy/.test(q)){
      const m=question.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
      const spend=m?Number(m[1]):0;
      answer=spend
        ? `Based on the income and bills you entered, your estimated remainder is $${t.leftover.toFixed(2)}. Spending $${spend.toFixed(2)} would leave about $${(t.leftover-spend).toFixed(2)} before untracked daily expenses.`
        : `Your estimated remainder after entered bills is $${t.leftover.toFixed(2)}. Add a dollar amount to your question for a purchase estimate.`;
    }else if(/increase|went up|higher/.test(q)){
      answer=t.increases.length
        ? t.increases.map(x=>`${x.name} increased by $${x.increase.toFixed(2)} (${x.percent.toFixed(1)}%).`).join(" ")
        : "I do not see a recorded bill increase yet.";
    }else if(/balance|bank/.test(q)){
      answer=`Your connected-account current balances total about $${t.bankBalance.toFixed(2)}. This may include multiple account types and should not be treated as spendable cash without reviewing each account.`;
    }else{
      answer=`You have $${t.monthlyBills.toFixed(2)} in unpaid saved bills, $${t.monthlyIncome.toFixed(2)} in entered income, and an estimated $${t.leftover.toFixed(2)} remaining before untracked expenses.`;
    }

    res.json({answer,disclaimer:"Budgeting estimate from your saved data; not financial, tax, legal, credit, or investment advice."});
  }catch(e){next(e)}
});

router.get("/notifications",async(req,res,next)=>{
  try{const r=await query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[req.user.id]);res.json({notifications:r.rows})}
  catch(e){next(e)}
});
router.post("/notifications/:id/read",async(req,res,next)=>{
  try{await query("UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);res.json({ok:true})}
  catch(e){next(e)}
});

router.get("/export.csv",async(req,res,next)=>{
  try{
    const r=await query("SELECT * FROM bills WHERE user_id=$1 ORDER BY due_date",[req.user.id]);
    const rows=[["Name","Amount","Due Date","Category","Recurring","Subscription","Paid","Source"],...r.rows.map(x=>[
      x.name,x.amount,String(x.due_date).slice(0,10),x.category,x.recurring?"Yes":"No",
      x.is_subscription?"Yes":"No",x.paid?"Yes":"No",x.source
    ])];
    const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition",'attachment; filename="billwise-bills.csv"');
    res.send(rows.map(row=>row.map(esc).join(",")).join("\n"));
  }catch(e){next(e)}
});

export default router;
