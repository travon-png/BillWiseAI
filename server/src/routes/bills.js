import express from "express";
import { newId, requireAuth } from "../lib/auth.js";
import { one, query } from "../lib/db.js";
import { PLANS } from "../lib/plans.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req,res,next)=>{
  try {
    const r = await query(
      `SELECT * FROM bills WHERE user_id=$1 ORDER BY paid ASC,due_date ASC,created_at DESC`,
      [req.user.id]
    );
    res.json({bills:r.rows});
  } catch(e){next(e)}
});

router.post("/", async (req,res,next)=>{
  try {
    const active = await one(
      `SELECT count(*)::int count FROM bills WHERE user_id=$1 AND paid=false`,
      [req.user.id]
    );
    const limit = PLANS[req.user.plan].activeBills;
    if (Number.isFinite(limit) && active.count >= limit)
      return res.status(403).json({error:`${PLANS[req.user.plan].name} supports up to ${limit} active bills.`});

    const b=req.body||{};
    if(!b.name || b.amount==null || !b.dueDate)
      return res.status(400).json({error:"Name, amount and due date are required."});

    const row = await one(
      `INSERT INTO bills(
        id,user_id,name,amount,due_date,category,recurring,recurrence,autopay,
        is_subscription,paid,notes,source,source_transaction_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        newId(),req.user.id,String(b.name).trim(),Number(b.amount),b.dueDate,
        b.category||"Other",b.recurring!==false,b.recurrence||"monthly",
        Boolean(b.autopay),Boolean(b.isSubscription),Boolean(b.paid),b.notes||"",
        b.source||"manual",b.sourceTransactionId||null
      ]
    );
    res.json({bill:row});
  } catch(e){next(e)}
});

router.put("/:id", async (req,res,next)=>{
  try {
    const old = await one("SELECT * FROM bills WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    if(!old) return res.status(404).json({error:"Bill not found."});
    const p=req.body||{};
    const amount = p.amount == null ? Number(old.amount) : Number(p.amount);
    const previous = p.amount != null && Number(old.amount)!==amount ? Number(old.amount) : old.previous_amount;

    const row = await one(
      `UPDATE bills SET
        name=$1,amount=$2,previous_amount=$3,due_date=$4,category=$5,recurring=$6,
        recurrence=$7,autopay=$8,is_subscription=$9,paid=$10,notes=$11,updated_at=now()
       WHERE id=$12 AND user_id=$13 RETURNING *`,
      [
        p.name??old.name,amount,previous,p.dueDate??old.due_date,p.category??old.category,
        p.recurring??old.recurring,p.recurrence??old.recurrence,p.autopay??old.autopay,
        p.isSubscription??old.is_subscription,p.paid??old.paid,p.notes??old.notes,
        req.params.id,req.user.id
      ]
    );
    res.json({bill:row});
  } catch(e){next(e)}
});

router.delete("/:id", async (req,res,next)=>{
  try {
    const r=await query("DELETE FROM bills WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);
    res.json({ok:r.rowCount>0});
  } catch(e){next(e)}
});

export default router;
