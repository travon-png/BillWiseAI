import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import billRoutes from "./routes/bills.js";
import incomeRoutes from "./routes/incomes.js";
import dashboardRoutes from "./routes/dashboard.js";
import bankRoutes, { plaidWebhookHandler } from "./routes/bank.js";
import premiumRoutes from "./routes/premium.js";
import familyValueRoutes from "./routes/family-value.js";
import { billingRouter, mountStripeWebhook, mountPolarRoutes } from "./routes/billing.js";
import { startReminderWorker } from "./workers/reminders.js";
import { query } from "./lib/db.js";

const app=express();
const PORT=Number(process.env.PORT||5001);

app.set("trust proxy",1);
app.use(helmet({
  crossOriginResourcePolicy:{policy:"cross-origin"}
}));
app.use(cors({
  origin:(process.env.CLIENT_ORIGIN||"http://localhost:5173").split(",").map(x=>x.trim()),
  credentials:false
}));
app.use(morgan("dev"));
app.use(rateLimit({
  windowMs:60_000,
  limit:240,
  standardHeaders:"draft-8",
  legacyHeaders:false,
}));

// Stripe signature verification requires raw bytes before express.json().
mountStripeWebhook(app);

app.use(express.json({limit:"2mb"}));

app.post("/api/bank/plaid/webhook", plaidWebhookHandler);

app.get("/api/health",async(_req,res)=>{
  try{
    await query("SELECT 1 AS ok");
    res.json({
      ok:true,
      service:"BillWise AI",
      database:"postgresql",
      databaseConnected:true,
      reminders:true,
      billingProvider:process.env.BILLING_PROVIDER||"demo",
      bankProvider:"plaid-read-only"
    });
  }catch(error){
    console.error("Health database check failed:",error.message);
    res.status(503).json({
      ok:false,
      service:"BillWise AI",
      database:"postgresql",
      databaseConnected:false,
      error:"PostgreSQL connection failed."
    });
  }
});

app.use("/api/auth",authRoutes);
app.use("/api/bills",billRoutes);
app.use("/api/incomes",incomeRoutes);
app.use("/api",dashboardRoutes);
app.use("/api/bank",bankRoutes);
app.use("/api/premium",premiumRoutes);
app.use("/api/family",familyValueRoutes);
app.use("/api/billing",billingRouter);

mountPolarRoutes(app);

app.use((err,_req,res,_next)=>{
  console.error(err?.response?.data||err);
  const status=err?.status||err?.statusCode||500;
  res.status(status).json({error:status>=500?"Internal server error.":err.message});
});

app.listen(PORT,()=>{
  console.log(`BillWise AI API running on http://localhost:${PORT}`);
  startReminderWorker();
});
