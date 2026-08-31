import express from "express";
import { newId, requireAuth } from "../lib/auth.js";
import { query, one } from "../lib/db.js";

const router=express.Router();
router.use(requireAuth);

router.get("/",async(req,res,next)=>{
  try{const r=await query("SELECT * FROM incomes WHERE user_id=$1 ORDER BY payday",[req.user.id]);res.json({incomes:r.rows})}
  catch(e){next(e)}
});

router.post("/",async(req,res,next)=>{
  try{
    const x=req.body||{};
    if(!x.name||x.amount==null||!x.payday)return res.status(400).json({error:"Name, amount and payday are required."});
    const row=await one(
      `INSERT INTO incomes(id,user_id,name,amount,payday,recurrence)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [newId(),req.user.id,x.name,Number(x.amount),x.payday,x.recurrence||"biweekly"]
    );
    res.json({income:row});
  }catch(e){next(e)}
});

router.delete("/:id",async(req,res,next)=>{
  try{await query("DELETE FROM incomes WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);res.json({ok:true})}
  catch(e){next(e)}
});

export default router;
