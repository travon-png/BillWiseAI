import React,{useEffect,useMemo,useState}from"react";
import{
  LayoutDashboard,ReceiptText,Repeat2,WalletCards,Sparkles,CalendarDays,BadgeDollarSign,
  Settings,LogOut,Bell,Plus,Trash2,Pencil,Check,Send,TrendingUp,CalendarClock,CreditCard,
  Wallet,Download,Landmark,RefreshCw,Link2,ShieldCheck,Mail,ChevronRight,
  BarChart3,Target,Users,Plug,FileText,PiggyBank,Gauge,Lock,TriangleAlert
}from"lucide-react";
import{api,BASE,getUser,setSession,logout,getToken,SESSION_EXPIRED_EVENT}from"./api";
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n||0));
const dateOnly=v=>String(v||"").slice(0,10);

export default function App(){
  const[user,setUser]=useState(getUser());
  const[page,setPage]=useState("dashboard");
  const[data,setData]=useState(null);
  const[error,setError]=useState("");
  const[authReady,setAuthReady]=useState(false);

  async function refresh(){
    if(!getToken())return;
    try{
      setData(await api("/api/dashboard"));
      setError("");
    }catch(e){
      if(getToken())setError(e.message);
    }
  }

  useEffect(()=>{
    let alive=true;

    async function boot(){
      if(!getToken()){
        if(alive){
          logout();
          setUser(null);
          setData(null);
          setAuthReady(true);
        }
        return;
      }

      try{
        const r=await api("/api/auth/me");
        if(!alive)return;
        setSession(getToken(),r.user);
        setUser(r.user);
        setAuthReady(true);
      }catch{
        if(!alive)return;
        logout();
        setUser(null);
        setData(null);
        setAuthReady(true);
      }
    }

    boot();

    function onExpired(){
      if(!alive)return;
      logout();
      setUser(null);
      setData(null);
      setError("");
      setPage("dashboard");
      setAuthReady(true);
    }

    window.addEventListener(SESSION_EXPIRED_EVENT,onExpired);
    return()=>{
      alive=false;
      window.removeEventListener(SESSION_EXPIRED_EVENT,onExpired);
    };
  },[]);

  useEffect(()=>{
    if(authReady&&user?.id)refresh();
  },[authReady,user?.id,user?.plan]);

  useEffect(()=>{
    const qs=new URLSearchParams(location.search);
    if(qs.get("billing")==="success"&&getToken()){
      api("/api/auth/me")
        .then(r=>{setSession(getToken(),r.user);setUser(r.user)})
        .catch(()=>{});
      history.replaceState({}, "", location.pathname);
    }
  },[]);

  if(!authReady)return <div className="loading">Checking your BillWise session…</div>;
  if(!user)return <Auth onAuth={u=>{setUser(u);setAuthReady(true)}}/>;

  const pages={
    dashboard:<Dashboard data={data} setPage={setPage} user={user}/>,
    bills:<Bills data={data} refresh={refresh}/>,
    subscriptions:<Subscriptions data={data}/>,
    income:<Income data={data} refresh={refresh}/>,
    assistant:<Assistant user={user} setPage={setPage}/>,
    banks:<Banks user={user} refresh={refresh} setPage={setPage}/>,
    calendar:<Calendar data={data}/>,
    insights:<Insights user={user} setPage={setPage}/>,
    goals:<Goals user={user} setPage={setPage}/>,
    reports:<Reports user={user} setPage={setPage}/>,
    household:<Household user={user} setPage={setPage}/>,
    integrations:<Integrations user={user} setPage={setPage}/>,
    plans:<Plans user={user} onUser={setUser}/>,
    settings:<SettingsPage user={user} setUser={setUser}/>,
  };

  function signOut(){logout();setUser(null);setData(null);setError("");setPage("dashboard")}
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="logo">B</div><div><b>BillWise</b><span>AI</span></div></div>
      <nav>{[
        ["dashboard",LayoutDashboard,"Dashboard"],["bills",ReceiptText,"Bills"],["subscriptions",Repeat2,"Subscriptions"],
        ["income",WalletCards,"Income"],["assistant",Sparkles,"AI Assistant"],["banks",Landmark,"Bank Connections"],
        ["calendar",CalendarDays,"Calendar"],["insights",BarChart3,"Smart Insights"],["goals",Target,"Goals"],
        ["reports",FileText,"Reports"],["household",Users,"Household"],["integrations",Plug,"Services"],
        ["plans",BadgeDollarSign,"Plans"],["settings",Settings,"Settings"]
      ].map(([k,I,l])=><button key={k} className={page===k?"active":""} onClick={()=>setPage(k)}><I size={18}/><span>{l}</span></button>)}</nav>
      <div className="sidebottom"><div className="user"><div>{user.name?.[0]?.toUpperCase()}</div><span><b>{user.name}</b><small>{user.plan} plan</small></span></div><button onClick={signOut}><LogOut size={17}/> Sign out</button></div>
    </aside>
    <div className="main">
      <header className="top"><div><b>BillWise AI</b><small>Know what’s due. Know what’s safe to spend.</small></div><div className="topright"><span className="plan">{user.plan.toUpperCase()}</span><Bell size={19}/></div></header>
      {error&&<div className="globalError">{error}</div>}
      {pages[page]}
    </div>
  </div>
}

function Auth({onAuth}){
  const[mode,setMode]=useState("login"),[f,setF]=useState({name:"",email:"",password:""}),[err,setErr]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e){
    e.preventDefault();setBusy(true);setErr("");
    try{
      const r=await api(`/api/auth/${mode}`,{method:"POST",body:JSON.stringify(f)});
      setSession(r.token,r.user);onAuth(r.user)
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  return <div className="auth">
    <section className="authHero"><div className="brand large"><div className="logo">B</div><div><b>BillWise</b><span>AI</span></div></div><div className="heroText"><span className="eyebrow">SMART BILL & CASH-FLOW TRACKING</span><h1>Stop wondering where your money has to go.</h1><p>Track bills, subscriptions, paychecks, connected accounts and reminders in one private dashboard.</p><div className="checks"><span>✓ Real email reminders</span><span>✓ Subscription detection</span><span>✓ Read-only bank sync</span><span>✓ Smart cash-flow estimates</span></div></div></section>
    <section className="authForm"><form onSubmit={submit}><h2>{mode==="login"?"Welcome back":"Create your account"}</h2><p>{mode==="login"?"Sign in to your BillWise dashboard.":"Start with the Free plan."}</p>{mode==="register"&&<label>Name<input value={f.name} onChange={e=>setF({...f,name:e.target.value})} required/></label>}<label>Email<input type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})} required/></label><label>Password<input type="password" minLength={10} value={f.password} onChange={e=>setF({...f,password:e.target.value})} required/></label>{err&&<div className="error">{err}</div>}<button className="primary" disabled={busy}>{busy?"Please wait…":mode==="login"?"Sign in":"Create account"}</button><button type="button" className="textbtn" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"New here? Create an account":"Already have an account? Sign in"}</button></form></section>
  </div>
}

function Page({title,sub,action,children}){
  return <main className="page"><div className="pagehead"><div><span className="eyebrow">BILLWISE AI</span><h1>{title}</h1><p>{sub}</p></div>{action}</div>{children}</main>
}
function Stat({icon,label,value,detail}){return <div className="stat"><div className="statIcon">{icon}</div><div><span>{label}</span><b>{value}</b><small>{detail}</small></div></div>}
function Empty({text}){return <div className="empty">{text}</div>}

function Dashboard({data,setPage,user}){
  const t=data?.totals||{},up=data?.upcoming||[],notes=data?.notifications||[];
  return <Page title="Your money, organized." sub="Bills, subscriptions, income, balances and reminders in one view." action={<button className="primary" onClick={()=>setPage("bills")}><Plus size={16}/> Add bill</button>}>
    <div className="stats">
      <Stat icon={<CalendarClock/>} label="Unpaid bills" value={money(t.monthlyBills)} detail={`${up.length} due in the next 14 days`}/>
      <Stat icon={<Wallet/>} label="Income entered" value={money(t.monthlyIncome)} detail="Based on income you added"/>
      <Stat icon={<CreditCard/>} label="Subscriptions" value={money(t.subscriptionMonthly)} detail={`${money(t.subscriptionYearly)} per year`}/>
      <Stat icon={<Landmark/>} label="Connected balances" value={money(t.bankBalance)} detail={`${data?.bankAccounts?.length||0} synced accounts`}/>
    </div>
    <div className="grid2">
      <section className="card"><Head title="Upcoming bills" text="Nearest due dates"/>{up.length?up.slice(0,7).map(b=><div className="listrow" key={b.id}><div className="round">{b.name?.[0]}</div><div><b>{b.name}</b><small>{b.category} · {b.daysUntilDue===0?"due today":`due in ${b.daysUntilDue} days`}</small></div><strong>{money(b.amount)}</strong></div>):<Empty text="Nothing is due in the next 14 days."/>}</section>
      <section className="card"><Head title="Notifications" text="Reminder history"/>{notes.length?notes.slice(0,7).map(n=><div className="notice" key={n.id}><Bell size={16}/><div><b>{n.title}</b><small>{n.message}</small></div></div>):<Empty text="No notifications yet."/>}</section>
      <section className="card"><Head title="Cash-flow snapshot" text="Calculated from what you entered"/><div className="cash"><div><span>Income</span><b>{money(t.monthlyIncome)}</b></div><div><span>Saved unpaid bills</span><b>- {money(t.monthlyBills)}</b></div><div className="total"><span>Estimated remainder</span><b>{money(t.leftover)}</b></div></div><p className="note">This estimate excludes groceries, transport, taxes, debt, emergencies and anything you have not entered.</p></section>
      <section className="card feature"><Sparkles size={28}/><h3>Ask BillWise</h3><p>Pro and Family users can ask questions using their saved financial data.</p><button className="secondary" onClick={()=>setPage("assistant")}>Open assistant</button></section>
    </div>
    <section className="premiumValue card">
      <div>
        <span className="eyebrow">PREMIUM CONTROL CENTER</span>
        <h3>{user.plan==="free"?"See problems before the due date.":"Your paid tools are ready."}</h3>
        <p>{user.plan==="free"
          ?"Plus adds a 30-day cash-flow forecast, email reminders, savings goals and smart bill insights."
          :"Forecast bills, track goals, review money reports and manage your connected services from one place."}</p>
      </div>
      <div className="premiumValueActions">
        <button className="secondary" onClick={()=>setPage("insights")}><BarChart3 size={15}/> Forecast</button>
        <button className="secondary" onClick={()=>setPage("goals")}><Target size={15}/> Goals</button>
        {user.plan==="free"&&<button className="primary" onClick={()=>setPage("plans")}>See paid plans</button>}
      </div>
    </section>
  </Page>
}
function Head({title,text}){return <div className="cardhead"><div><h3>{title}</h3><p>{text}</p></div></div>}

function Bills({data,refresh}){
  const empty={name:"",amount:"",dueDate:"",category:"Utilities",recurring:true,recurrence:"monthly",autopay:false,isSubscription:false,paid:false,notes:""};
  const[open,setOpen]=useState(false),[edit,setEdit]=useState(null),[f,setF]=useState(empty),[err,setErr]=useState("");
  function add(){setEdit(null);setF(empty);setErr("");setOpen(true)}
  function change(b){setEdit(b.id);setF({name:b.name,amount:b.amount,dueDate:dateOnly(b.due_date),category:b.category,recurring:b.recurring,recurrence:b.recurrence,autopay:b.autopay,isSubscription:b.is_subscription,paid:b.paid,notes:b.notes||""});setOpen(true)}
  async function save(e){e.preventDefault();setErr("");try{const path=edit?`/api/bills/${edit}`:"/api/bills";await api(path,{method:edit?"PUT":"POST",body:JSON.stringify({...f,amount:Number(f.amount)})});setOpen(false);await refresh()}catch(e){setErr(e.message)}}
  async function del(id){if(confirm("Delete this bill?")){await api(`/api/bills/${id}`,{method:"DELETE"});refresh()}}
  async function paid(b){await api(`/api/bills/${b.id}`,{method:"PUT",body:JSON.stringify({paid:!b.paid})});refresh()}
  return <Page title="Everything you owe, in one place." sub="Track recurring bills, subscriptions, due dates and payment status." action={<button className="primary" onClick={add}><Plus size={16}/> Add bill</button>}>
    <div className="card table"><div className="tr th"><span>Bill</span><span>Category</span><span>Due</span><span>Amount</span><span>Status</span><span></span></div>{data?.bills?.map(b=><div className={`tr ${b.paid?"faded":""}`} key={b.id}><div className="billname"><div className="round">{b.name?.[0]}</div><div><b>{b.name}</b><small>{b.recurring?b.recurrence:"one-time"}{b.is_subscription?" · subscription":""}{b.source!=="manual"?` · ${b.source}`:""}</small></div></div><span>{b.category}</span><span>{dateOnly(b.due_date)}</span><b>{money(b.amount)}</b><button className={`status ${b.paid?"paid":"due"}`} onClick={()=>paid(b)}>{b.paid?<><Check size={13}/> Paid</>:"Due"}</button><div className="actions"><button onClick={()=>change(b)}><Pencil size={15}/></button><button onClick={()=>del(b.id)}><Trash2 size={15}/></button></div></div>)}{!data?.bills?.length&&<Empty text="No bills yet. Add your first bill."/>}</div>
    {open&&<Modal title={edit?"Edit bill":"Add bill"} close={()=>setOpen(false)}><form className="formgrid" onSubmit={save}><label className="wide">Bill name<input value={f.name} onChange={e=>setF({...f,name:e.target.value})} required/></label><label>Amount<input type="number" step="0.01" value={f.amount} onChange={e=>setF({...f,amount:e.target.value})} required/></label><label>Due date<input type="date" value={f.dueDate} onChange={e=>setF({...f,dueDate:e.target.value})} required/></label><label>Category<select value={f.category} onChange={e=>setF({...f,category:e.target.value})}>{["Utilities","Housing","Internet","Phone","Insurance","Debt","Transport","Food","Entertainment","Software","Other"].map(x=><option key={x}>{x}</option>)}</select></label><label>Recurrence<select value={f.recurrence} onChange={e=>setF({...f,recurrence:e.target.value})}>{["weekly","biweekly","monthly","quarterly","yearly"].map(x=><option key={x}>{x}</option>)}</select></label><label className="check"><input type="checkbox" checked={f.recurring} onChange={e=>setF({...f,recurring:e.target.checked})}/> Recurring</label><label className="check"><input type="checkbox" checked={f.autopay} onChange={e=>setF({...f,autopay:e.target.checked})}/> Autopay</label><label className="check"><input type="checkbox" checked={f.isSubscription} onChange={e=>setF({...f,isSubscription:e.target.checked})}/> Subscription</label><label className="wide">Notes<textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></label>{err&&<div className="error wide">{err}</div>}<div className="modalbuttons wide"><button type="button" className="ghost" onClick={()=>setOpen(false)}>Cancel</button><button className="primary">Save bill</button></div></form></Modal>}
  </Page>
}
function Modal({title,close,children}){return <div className="backdrop" onMouseDown={close}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modalhead"><h3>{title}</h3><button onClick={close}>×</button></div>{children}</div></div>}

function Subscriptions({data}){
  const subs=(data?.bills||[]).filter(b=>b.is_subscription),m=subs.reduce((s,b)=>s+Number(b.amount),0),incs=(data?.totals?.increases||[]).filter(x=>subs.some(s=>s.id===x.id));
  return <Page title="See where recurring money goes." sub="Subscriptions are grouped automatically from bills and imported bank detections."><div className="stats three"><Stat icon={<Repeat2/>} label="Monthly" value={money(m)} detail={`${subs.length} subscriptions`}/><Stat icon={<CalendarDays/>} label="Yearly cost" value={money(m*12)} detail="Current rates × 12"/><Stat icon={<TrendingUp/>} label="Price increases" value={incs.length} detail="Detected from bill edits"/></div><div className="card subgrid">{subs.map(s=><div className="subcard" key={s.id}><div className="round">{s.name?.[0]}</div><div><b>{s.name}</b><small>{s.category} · {s.source}</small></div><strong>{money(s.amount)}</strong></div>)}{!subs.length&&<Empty text="No subscriptions yet."/>}</div></Page>
}

function Income({data,refresh}){
  const[open,setOpen]=useState(false),[f,setF]=useState({name:"Paycheck",amount:"",payday:"",recurrence:"biweekly"});
  async function save(e){e.preventDefault();await api("/api/incomes",{method:"POST",body:JSON.stringify({...f,amount:Number(f.amount)})});setOpen(false);refresh()}
  async function del(id){await api(`/api/incomes/${id}`,{method:"DELETE"});refresh()}
  return <Page title="Tell BillWise when money comes in." sub="Income helps estimate what remains after bills." action={<button className="primary" onClick={()=>setOpen(true)}><Plus size={16}/> Add income</button>}><div className="card">{data?.incomes?.map(x=><div className="incomerow" key={x.id}><div><b>{x.name}</b><small>{x.recurrence} · next {dateOnly(x.payday)}</small></div><strong>{money(x.amount)}</strong><button onClick={()=>del(x.id)}><Trash2 size={15}/></button></div>)}{!data?.incomes?.length&&<Empty text="No income sources added."/>}</div>{open&&<Modal title="Add income" close={()=>setOpen(false)}><form className="formgrid" onSubmit={save}><label className="wide">Name<input value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></label><label>Amount<input type="number" step="0.01" value={f.amount} onChange={e=>setF({...f,amount:e.target.value})}/></label><label>Next payday<input type="date" value={f.payday} onChange={e=>setF({...f,payday:e.target.value})}/></label><label className="wide">Recurrence<select value={f.recurrence} onChange={e=>setF({...f,recurrence:e.target.value})}><option>weekly</option><option>biweekly</option><option>monthly</option></select></label><div className="modalbuttons wide"><button type="button" className="ghost" onClick={()=>setOpen(false)}>Cancel</button><button className="primary">Save income</button></div></form></Modal>}</Page>
}

function Assistant({user,setPage}){
  const allowed=["pro","family"].includes(user.plan);
  const[q,setQ]=useState("");
  const[msgs,setMsgs]=useState([{r:"a",t:"Ask me about your bills, subscriptions, balances or what may remain after a purchase."}]);

  if(!allowed){
    return <Page title="Ask your money questions." sub="AI Assistant is available on Pro and Family.">
      <div className="card locked">
        <Sparkles size={34}/>
        <h3>Upgrade to unlock BillWise AI</h3>
        <p>Your Free account still includes bill tracking, subscriptions, income, calendar and in-app reminders.</p>
        <button className="primary" onClick={()=>setPage("plans")}>View Pro plans</button>
      </div>
    </Page>
  }

  async function send(text=q){
    if(!text.trim())return;
    setMsgs(m=>[...m,{r:"u",t:text}]);
    setQ("");
    try{
      const x=await api("/api/assistant",{method:"POST",body:JSON.stringify({question:text})});
      setMsgs(m=>[...m,{r:"a",t:x.answer,d:x.disclaimer}]);
    }catch(e){
      setMsgs(m=>[...m,{r:"a",t:e.message}]);
    }
  }

  return <Page title="Ask your money questions." sub="Answers use only the financial data saved in your account.">
    <div className="card chat">
      <div className="messages">{msgs.map((m,i)=><div className={`msg ${m.r}`} key={i}>{m.r==="a"&&<div className="aiMini">AI</div>}<div><p>{m.t}</p>{m.d&&<small>{m.d}</small>}</div></div>)}</div>
      <div className="chips">{["How much are my subscriptions?","Can I afford to spend $200?","Which bills went up?","What are my bank balances?"].map(c=><button key={c} onClick={()=>send(c)}>{c}</button>)}</div>
      <form className="chatbar" onSubmit={e=>{e.preventDefault();send()}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Ask BillWise…"/>
        <button className="primary"><Send size={16}/></button>
      </form>
    </div>
  </Page>
}

function Banks({user,refresh,setPage}){
  const[info,setInfo]=useState({items:[],accounts:[]}),[txs,setTxs]=useState([]),[candidates,setCandidates]=useState([]),[status,setStatus]=useState(null),[msg,setMsg]=useState(""),[busy,setBusy]=useState("");
  const allowed=["pro","family"].includes(user.plan);
  async function load(){
    if(!allowed)return;
    try{
      const[s,a,t,c]=await Promise.all([api("/api/bank/status"),api("/api/bank/accounts"),api("/api/bank/transactions?limit=50"),api("/api/bank/subscription-candidates")]);
      setStatus(s);setInfo(a);setTxs(t.transactions);setCandidates(c.candidates);setMsg("")
    }catch(e){setMsg(e.message)}
  }
  useEffect(()=>{load()},[user.plan]);
  async function openPlaid(updateItemId=null){
    try{
      setBusy(updateItemId||"connect");setMsg("");
      const r=await api(updateItemId?`/api/bank/items/${updateItemId}/update-link-token`:"/api/bank/link-token",{method:"POST"});
      if(!window.Plaid)throw new Error("The secure bank connection window did not load. Refresh the page and try again.");
      const handler=window.Plaid.create({
        token:r.linkToken,
        onSuccess:async(publicToken,metadata)=>{
          try{
            if(updateItemId){setMsg("Bank login repaired. Syncing your latest data…");await sync()}
            else{
              const result=await api("/api/bank/exchange",{method:"POST",body:JSON.stringify({publicToken,metadata})});
              setMsg(`Bank connected. ${result.sync?.added||0} transactions imported.`);await load();await refresh()
            }
          }catch(e){setMsg(e.message)}finally{setBusy("")}
        },
        onExit:(err)=>{if(err)setMsg(err.display_message||err.error_message||"Bank connection closed.");setBusy("")}
      });
      handler.open();
    }catch(e){setMsg(e.message);setBusy("")}
  }
  async function sync(){setBusy("sync");setMsg("Syncing your connected accounts…");try{const r=await api("/api/bank/sync",{method:"POST"});setMsg(r.failed?`${r.synced} connections synced; ${r.failed} need attention.`:`Synced. ${r.added} new and ${r.modified} updated transactions.`);await load();await refresh()}catch(e){setMsg(e.message)}finally{setBusy("")}}
  async function imp(c){try{await api("/api/bank/subscription-candidates/import",{method:"POST",body:JSON.stringify(c)});setMsg(`${c.merchant} added to subscriptions.`);await refresh();await load()}catch(e){setMsg(e.message)}}
  async function removeItem(item){if(!confirm(`Disconnect ${item.institution_name||"this bank"}? Synced data for this connection will be removed from BillWise.`))return;try{await api(`/api/bank/items/${item.id}`,{method:"DELETE"});setMsg("Bank connection removed.");await load();await refresh()}catch(e){setMsg(e.message)}}
  return <Page title="Connect accounts — read only." sub="Sync supported balances and transactions securely. BillWise cannot transfer or withdraw money." action={allowed&&status?.configured?<div className="rowgap"><button className="secondary" disabled={busy==="sync"||!info.items.length} onClick={sync}><RefreshCw size={16}/> {busy==="sync"?"Syncing…":"Sync"}</button><button className="primary" disabled={busy==="connect"} onClick={()=>openPlaid()}><Link2 size={16}/> Connect bank</button></div>:null}>
    {!allowed&&<div className="card locked"><Landmark size={34}/><h3>Bank connections require Pro or Family.</h3><p>Upgrade to connect supported financial institutions, sync balances and detect recurring charges.</p><button className="primary" onClick={()=>setPage("plans")}>View Pro plans</button></div>}
    {allowed&&<>
      {msg&&<div className="info">{msg}</div>}
      {status&&!status.configured&&<div className="card bankUnavailable"><Landmark size={32}/><div><h3>Bank sync is not available yet</h3><p>Your bills and household features still work normally. Once the Plaid connection is enabled for this environment, this page will open the secure bank-linking flow.</p></div><button className="secondary" onClick={()=>setPage("integrations")}>View services</button></div>}
      <div className="stats three"><Stat icon={<Landmark/>} label="Connections" value={info.items.length} detail="Read-only institution links"/><Stat icon={<Wallet/>} label="Accounts" value={info.accounts.length} detail="Checking, savings, credit and loans"/><Stat icon={<Repeat2/>} label="Recurring candidates" value={candidates.length} detail="Detected from transaction patterns"/></div>
      {info.items.length>0&&<section className="card"><Head title="Institution connections" text="Reconnect a bank when credentials expire, or remove it at any time"/>{info.items.map(item=><div className={`bankItemRow ${item.status!=="active"?"attention":""}`} key={item.id}><div><b>{item.institution_name||"Connected bank"}</b><small>{item.status==="active"?`Connected${item.last_synced_at?` · last synced ${new Date(item.last_synced_at).toLocaleString()}`:""}`:`Needs attention${item.last_error_message?` · ${item.last_error_message}`:""}`}</small></div><div className="rowgap">{item.status!=="active"&&status?.configured&&<button className="secondary" onClick={()=>openPlaid(item.id)}>Reconnect</button>}<button className="ghost" onClick={()=>removeItem(item)}>Disconnect</button></div></div>)}</section>}
      <section className="card"><Head title="Connected accounts" text="Current balances reported by the provider"/>{info.accounts.map(a=><div className="accountrow" key={a.id}><div><b>{a.name}</b><small>{a.institution_name||a.subtype||a.type} · •••• {a.mask||"----"}</small></div><strong>{money(a.current_balance)}</strong></div>)}{!info.accounts.length&&<Empty text="No synced accounts yet."/>}</section>
      <section className="card"><Head title="Possible subscriptions" text="Repeated merchants with stable amounts and monthly timing"/>{candidates.slice(0,10).map((c,i)=><div className="candidate" key={i}><div><b>{c.merchant}</b><small>{money(c.averageAmount)} · {(c.confidence*100).toFixed(0)}% pattern confidence · next around {c.nextExpectedDate}</small></div><button className="secondary" onClick={()=>imp(c)}>Track subscription</button></div>)}{!candidates.length&&<Empty text="No recurring patterns detected yet."/>}</section>
      <section className="card"><Head title="Recent synced transactions" text="Read-only transaction history"/>{txs.slice(0,25).map(t=>{const spend=Number(t.amount)>=0;return <div className="txrow" key={t.id}><div><b>{t.merchant_name||t.name}</b><small>{dateOnly(t.date)} · {t.category||"Uncategorized"}{t.pending?" · pending":""}</small></div><strong className={spend?"outflow":"inflow"}>{spend?"-":"+"}{money(Math.abs(Number(t.amount)))}</strong></div>})}{!txs.length&&<Empty text="No synced transactions yet."/>}</section>
    </>}
  </Page>
}

function Calendar({data}){
  const groups=useMemo(()=>{const m={};for(const b of data?.bills||[])(m[dateOnly(b.due_date)]??=[]).push(b);return Object.entries(m).sort(([a],[b])=>a.localeCompare(b))},[data]);
  return <Page title="Every due date in one timeline." sub="A chronological view of the bills saved to your account."><div className="card timeline">{groups.map(([d,bs])=><div className="day" key={d}><div className="date"><b>{new Date(d+"T12:00:00").toLocaleDateString("en-US",{day:"2-digit"})}</b><span>{new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short"})}</span></div><div>{bs.map(b=><div className="timelinebill" key={b.id}><span><b>{b.name}</b><small>{b.category}</small></span><strong>{money(b.amount)}</strong></div>)}</div></div>)}{!groups.length&&<Empty text="No bill dates yet."/>}</div></Page>
}


function UpgradeLock({icon,title,text,button="View plans",onUpgrade}){
  return <div className="card locked premiumLock">
    {icon}
    <h3>{title}</h3>
    <p>{text}</p>
    <button className="primary" onClick={onUpgrade}>{button}</button>
  </div>
}

function Insights({user,setPage}){
  const allowed=["plus","pro","family"].includes(user.plan);
  const[data,setData]=useState(null),[err,setErr]=useState("");
  useEffect(()=>{
    if(!allowed)return;
    const days=user.plan==="plus"?30:90;
    Promise.all([
      api(`/api/premium/forecast?days=${days}`),
      api("/api/premium/insights")
    ]).then(([f,i])=>setData({forecast:f.forecast,insights:i})).catch(e=>setErr(e.message));
  },[user.plan]);

  if(!allowed)return <Page title="Know what is coming before it hits." sub="Cash-flow forecasting and smart bill insights start on Plus.">
    <UpgradeLock icon={<Gauge size={36}/>} title="Unlock your money forecast" text="Plus projects recurring bills and income up to 30 days ahead, tracks bill increases, and highlights the recurring costs taking the biggest bite." onUpgrade={()=>setPage("plans")}/>
  </Page>;

  const f=data?.forecast||{},i=data?.insights||{};
  return <Page title={`${user.plan==="plus"?"30":"90"}-day money forecast.`} sub="A forward-looking estimate built from your recurring bills, income and connected balances.">
    {err&&<div className="warning">{err}</div>}
    <div className="stats">
      <Stat icon={<ReceiptText/>} label="Scheduled bills" value={money(f.totalBills)} detail={`Next ${f.days||0} days`}/>
      <Stat icon={<Wallet/>} label="Scheduled income" value={money(f.totalIncome)} detail="From income schedules"/>
      <Stat icon={<TrendingUp/>} label="Known net change" value={money(f.netChange)} detail="Income minus scheduled bills"/>
      <Stat icon={<Landmark/>} label="Known ending balance" value={f.knownEndingBalance==null?"Connect bank":money(f.knownEndingBalance)} detail="Only when bank balances are connected"/>
    </div>
    {f.shortfallDate&&<div className="dangerCallout"><TriangleAlert size={19}/><div><b>Known-balance shortfall detected</b><span>Based on currently synced data, the running known balance goes below $0 around {f.shortfallDate}. Review upcoming bills and missing income before relying on this estimate.</span></div></div>}
    <div className="grid2">
      <section className="card"><Head title="Forecast timeline" text="Bills and income in date order"/>{(f.events||[]).slice(0,16).map((e,idx)=><div className={`forecastRow ${e.type}`} key={`${e.date}-${idx}`}><span><b>{e.name}</b><small>{e.date} · {e.category}</small></span><strong>{e.type==="income"?"+ ":"- "}{money(e.amount)}</strong></div>)}{!f.events?.length&&<Empty text="Add recurring bills and income to build your forecast."/>}</section>
      <section className="card"><Head title="Smart bill watch" text="Changes and recurring costs worth reviewing"/><div className="insightNumber"><span>Subscriptions / year</span><b>{money(i.subscriptionYearly)}</b></div>{(i.increases||[]).slice(0,5).map(x=><div className="notice premiumNotice" key={x.id}><TrendingUp size={16}/><div><b>{x.name} increased</b><small>{money(x.previousAmount)} → {money(x.currentAmount)} · +{money(x.increase)}</small></div></div>)}{!(i.increases||[]).length&&<p className="muted">No recorded bill increases yet.</p>}<h4 className="miniTitle">Largest recurring subscriptions</h4>{(i.highCostSubscriptions||[]).slice(0,5).map(x=><div className="miniMoneyRow" key={x.id}><span>{x.name}</span><b>{money(x.annualAmount)}/yr</b></div>)}</section>
    </div>
    <p className="note forecastDisclaimer">{f.disclaimer}</p>
  </Page>
}

function Goals({user,setPage}){
  const allowed=["plus","pro","family"].includes(user.plan);
  const[goals,setGoals]=useState([]),[f,setF]=useState({name:"",targetAmount:"",currentAmount:"0",targetDate:"",category:"Emergency"}),[msg,setMsg]=useState("");
  async function load(){if(!allowed)return;try{const r=await api("/api/premium/goals");setGoals(r.goals)}catch(e){setMsg(e.message)}}
  useEffect(()=>{load()},[user.plan]);
  async function add(e){e.preventDefault();try{await api("/api/premium/goals",{method:"POST",body:JSON.stringify({...f,targetAmount:Number(f.targetAmount),currentAmount:Number(f.currentAmount)})});setF({name:"",targetAmount:"",currentAmount:"0",targetDate:"",category:"Emergency"});load()}catch(e){setMsg(e.message)}}
  async function contribute(g,amount){await api(`/api/premium/goals/${g.id}`,{method:"PUT",body:JSON.stringify({currentAmount:Number(g.current_amount)+amount})});load()}
  async function del(id){if(confirm("Delete this goal?")){await api(`/api/premium/goals/${id}`,{method:"DELETE"});load()}}

  if(!allowed)return <Page title="Turn leftover money into a plan." sub="Savings goals are available on Plus, Pro and Family."><UpgradeLock icon={<PiggyBank size={36}/>} title="Unlock savings goals" text="Create emergency, travel, tuition or custom goals and watch progress alongside your monthly bills." onUpgrade={()=>setPage("plans")}/></Page>;

  return <Page title="Goals that live next to your bills." sub="Track progress without pretending untracked money is guaranteed to be available.">
    {msg&&<div className="info">{msg}</div>}
    <div className="goalsLayout">
      <form className="card goalForm" onSubmit={add}><Head title="Create a goal" text="Set a target and add progress as you save"/><label>Goal name<input value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Emergency fund" required/></label><div className="form2"><label>Target amount<input type="number" min="1" step="0.01" value={f.targetAmount} onChange={e=>setF({...f,targetAmount:e.target.value})} required/></label><label>Saved so far<input type="number" min="0" step="0.01" value={f.currentAmount} onChange={e=>setF({...f,currentAmount:e.target.value})}/></label></div><div className="form2"><label>Target date<input type="date" value={f.targetDate} onChange={e=>setF({...f,targetDate:e.target.value})}/></label><label>Category<select value={f.category} onChange={e=>setF({...f,category:e.target.value})}>{["Emergency","Travel","Education","Home","Vehicle","Debt buffer","General"].map(x=><option key={x}>{x}</option>)}</select></label></div><button className="primary">Create goal</button></form>
      <section className="goalCards">{goals.map(g=>{const pct=Math.min(100,Number(g.current_amount)/Number(g.target_amount)*100);return <div className="card goalCard" key={g.id}><div className="goalTop"><div><span>{g.category}</span><h3>{g.name}</h3></div><button className="iconOnly" onClick={()=>del(g.id)}><Trash2 size={15}/></button></div><div className="goalMoney"><b>{money(g.current_amount)}</b><span>of {money(g.target_amount)}</span></div><div className="progress"><i style={{width:`${pct}%`}}/></div><div className="goalBottom"><small>{pct.toFixed(0)}% complete{g.target_date?` · target ${dateOnly(g.target_date)}`:""}</small><div><button onClick={()=>contribute(g,10)}>+$10</button><button onClick={()=>contribute(g,50)}>+$50</button></div></div></div>})}{!goals.length&&<Empty text="No goals yet. Create your first one."/>}</section>
    </div>
  </Page>
}

function Reports({user,setPage}){
  const allowed=["pro","family"].includes(user.plan);
  const[month,setMonth]=useState(new Date().toISOString().slice(0,7)),[report,setReport]=useState(null),[err,setErr]=useState("");
  async function load(){if(!allowed)return;try{const r=await api(`/api/premium/report?month=${month}`);setReport(r.report);setErr("")}catch(e){setErr(e.message)}}
  useEffect(()=>{load()},[user.plan,month]);

  if(!allowed)return <Page title="Monthly reports without spreadsheet work." sub="Reports are included with Pro and Family."><UpgradeLock icon={<FileText size={36}/>} title="Unlock monthly money reports" text="Pro turns connected transactions, saved bills and income into one month-by-month summary with categories and top merchants." onUpgrade={()=>setPage("plans")}/></Page>;

  const max=Math.max(1,...(report?.categorySpending||[]).map(x=>x.amount));
  return <Page title="Monthly money report." sub="Review what BillWise could see for the selected month." action={<input className="monthPicker" type="month" value={month} onChange={e=>setMonth(e.target.value)}/>}>
    {err&&<div className="warning">{err}</div>}
    <div className="stats">
      <Stat icon={<CreditCard/>} label="Connected spend" value={money(report?.connectedTransactionSpend)} detail={`${report?.transactionCount||0} posted transactions`}/>
      <Stat icon={<ReceiptText/>} label="Bills due" value={money(report?.knownBillsDue)} detail="Bills saved in BillWise"/>
      <Stat icon={<Wallet/>} label="Income dates" value={money(report?.enteredIncome)} detail="Income schedules in the month"/>
      <Stat icon={<Repeat2/>} label="Subscriptions due" value={money(report?.subscriptionsDue)} detail="Known subscription bills"/>
    </div>
    <div className="grid2">
      <section className="card"><Head title="Spending by category" text="Based on connected posted transactions"/>{(report?.categorySpending||[]).map(x=><div className="barRow" key={x.name}><div><span>{x.name}</span><b>{money(x.amount)}</b></div><div className="bar"><i style={{width:`${x.amount/max*100}%`}}/></div></div>)}{!report?.categorySpending?.length&&<Empty text="Connect a bank and sync transactions to populate category spending."/>}</section>
      <section className="card"><Head title="Top merchants" text="Largest connected spending totals"/>{(report?.topMerchants||[]).map((x,i)=><div className="rankRow" key={x.name}><i>{i+1}</i><span>{x.name}</span><b>{money(x.amount)}</b></div>)}{!report?.topMerchants?.length&&<Empty text="No connected transaction data for this month."/>}</section>
    </div>
    <p className="note">{report?.disclaimer}</p>
  </Page>
}

function Household({user,setPage}){
  const[data,setData]=useState(null),[loading,setLoading]=useState(true),[msg,setMsg]=useState(""),[tab,setTab]=useState("overview");
  const[houseName,setHouseName]=useState("My Household"),[invite,setInvite]=useState("");
  const[expense,setExpense]=useState({name:"",amount:"",dueDate:"",category:"Housing",assignedToEmail:"",splitMode:"equal",recurring:false,recurrence:"monthly",reminderScope:"assigned",isSubscription:false,notes:""});
  const[customSplits,setCustomSplits]=useState({});
  const[budget,setBudget]=useState({category:"Groceries",amount:""});
  const[goal,setGoal]=useState({name:"",targetAmount:"",targetDate:"",category:"Emergency"});
  const[familySettings,setFamilySettings]=useState({weeklyDigestEnabled:true,digestWeekday:0,digestHour:8,remindEveryoneDefault:false});
  const[ask,setAsk]=useState(""),[answer,setAnswer]=useState("");

  async function load(){
    setLoading(true);
    try{
      const r=await api("/api/family/overview");
      setData(r);
      if(r?.settings){
        setFamilySettings({
          weeklyDigestEnabled:r.settings.weekly_digest_enabled!==false,
          digestWeekday:Number(r.settings.digest_weekday??0),
          digestHour:Number(r.settings.digest_hour??8),
          remindEveryoneDefault:Boolean(r.settings.remind_everyone_default)
        });
        setExpense(prev=>prev.name||prev.amount?prev:{...prev,reminderScope:r.settings.remind_everyone_default?"everyone":"assigned"});
      }
      setMsg("");
    }catch(e){setMsg(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{load()},[user.id,user.plan]);

  async function createHouse(){try{await api("/api/family/household",{method:"POST",body:JSON.stringify({name:houseName})});await load()}catch(e){setMsg(e.message)}}
  async function acceptInvite(id){try{await api(`/api/family/${id}/accept`,{method:"POST"});await load()}catch(e){setMsg(e.message)}}
  async function inviteMember(e){e.preventDefault();try{const r=await api(`/api/family/${data.household.id}/invite`,{method:"POST",body:JSON.stringify({email:invite})});setInvite("");setMsg(r.emailSent?"Invite saved and emailed.":"Invite saved. The member can sign in with that email and accept it inside Household.");await load()}catch(e){setMsg(e.message)}}
  async function addExpense(e){e.preventDefault();try{
    const custom=Object.entries(customSplits).map(([email,amount])=>({email,amount:Number(amount||0)}));
    await api(`/api/family/${data.household.id}/expenses`,{method:"POST",body:JSON.stringify({...expense,amount:Number(expense.amount),customSplits:custom})});
    setExpense({name:"",amount:"",dueDate:"",category:"Housing",assignedToEmail:"",splitMode:"equal",recurring:false,recurrence:"monthly",reminderScope:"assigned",isSubscription:false,notes:""});
    setCustomSplits({});setMsg("Shared expense added.");await load();setTab("bills")
  }catch(e){setMsg(e.message)}}
  async function markExpensePaid(x){try{await api(`/api/family/${data.household.id}/expenses/${x.id}`,{method:"PUT",body:JSON.stringify({paid:true})});await load()}catch(e){setMsg(e.message)}}
  async function deleteExpense(x){if(!confirm(`Delete ${x.name}?`))return;try{await api(`/api/family/${data.household.id}/expenses/${x.id}`,{method:"DELETE"});await load()}catch(e){setMsg(e.message)}}
  async function toggleSplit(split){try{await api(`/api/family/${data.household.id}/splits/${split.id}/toggle`,{method:"POST"});await load()}catch(e){setMsg(e.message)}}
  async function saveBudget(e){e.preventDefault();try{await api(`/api/family/${data.household.id}/budgets`,{method:"POST",body:JSON.stringify({...budget,amount:Number(budget.amount),month:data.currentMonth})});setBudget({...budget,amount:""});await load()}catch(e){setMsg(e.message)}}
  async function deleteBudget(id){try{await api(`/api/family/${data.household.id}/budgets/${id}`,{method:"DELETE"});await load()}catch(e){setMsg(e.message)}}
  async function createGoal(e){e.preventDefault();try{await api(`/api/family/${data.household.id}/goals`,{method:"POST",body:JSON.stringify({...goal,targetAmount:Number(goal.targetAmount)})});setGoal({name:"",targetAmount:"",targetDate:"",category:"Emergency"});await load()}catch(e){setMsg(e.message)}}
  async function contribute(g,amount){try{await api(`/api/family/${data.household.id}/goals/${g.id}/contribute`,{method:"POST",body:JSON.stringify({amount})});await load()}catch(e){setMsg(e.message)}}
  async function deleteGoal(id){if(!confirm("Delete this shared goal?"))return;try{await api(`/api/family/${data.household.id}/goals/${id}`,{method:"DELETE"});await load()}catch(e){setMsg(e.message)}}
  async function askHousehold(e){e.preventDefault();if(!ask.trim())return;try{const r=await api(`/api/family/${data.household.id}/assistant`,{method:"POST",body:JSON.stringify({question:ask})});setAnswer(r.answer);setAsk("")}catch(e){setAnswer(e.message)}}
  async function sendDigest(){try{const r=await api(`/api/family/${data.household.id}/digest`,{method:"POST"});setMsg(`Household digest sent to ${r.sent} member${r.sent===1?"":"s"}.`)}catch(e){setMsg(e.message)}}
  async function saveFamilySettings(){try{const r=await api(`/api/family/${data.household.id}/settings`,{method:"PUT",body:JSON.stringify(familySettings)});setMsg("Household reminder settings saved.");if(r.settings)await load()}catch(e){setMsg(e.message)}}
  async function removeMember(m){if(!confirm(`Remove ${m.email} from the household?`))return;try{await api(`/api/family/${data.household.id}/members/${m.id}`,{method:"DELETE"});setMsg("Household member updated.");await load()}catch(e){setMsg(e.message)}}
  async function leaveHouse(){if(!confirm("Leave this household? Your private BillWise account will remain intact."))return;try{await api(`/api/family/${data.household.id}/leave`,{method:"POST"});setMsg("You left the household.");await load()}catch(e){setMsg(e.message)}}

  if(loading)return <Page title="Loading household…" sub="Checking your Family workspace." ><div className="card loadingCard">Loading shared household data…</div></Page>;

  const invites=data?.pendingInvites||[];
  if(!data?.entitled){
    return <Page title="One household. One subscription." sub="Family is a real shared workspace — invited members do not each need to buy the Family plan.">
      {msg&&<div className="info">{msg}</div>}
      {invites.map(i=><div className="inviteBanner" key={i.id}><div><b>{i.owner_name} invited you to {i.household_name}</b><span>Accept with this account. Your private personal bills and bank data stay outside the household.</span></div><button className="primary" onClick={()=>acceptInvite(i.household_id)}>Accept invite</button></div>)}
      {data?.canCreate?<section className="card familyLaunch"><Users size={42}/><span className="eyebrow">FAMILY OWNER</span><h2>Create your household workspace</h2><p>Your Family subscription covers the shared workspace for up to 5 people including you.</p><div className="inlineField"><input value={houseName} onChange={e=>setHouseName(e.target.value)} placeholder="Mackey Household"/><button className="primary" onClick={createHouse}>Create household</button></div></section>:!invites.length&&<UpgradeLock icon={<Users size={38}/>} title="Make bills a household system" text="Family includes a shared bill board, equal or assigned splits, category budgets, recurring household bills, shared goals, member reminders, weekly digest, activity history and a household-only assistant for up to 5 people." button="See Family plan" onUpgrade={()=>setPage("plans")}/>} 
    </Page>
  }

  const h=data.household,s=data.summary||{},members=data.members||[],expenses=data.expenses||[],splits=data.splits||[],budgets=data.budgets||[],goals=data.goals||[],activity=data.activity||[];
  const isOwner=data.viewer?.isOwner;
  const myEmail=String(data.viewer?.email||"").toLowerCase();
  const upcoming=expenses.filter(x=>!x.paid).slice(0,8);
  const myShares=splits.filter(x=>String(x.member_email).toLowerCase()===myEmail&&x.status==="unpaid");
  const activeMembers=members.filter(m=>m.status==="active");
  const customTotal=Object.values(customSplits).reduce((n,v)=>n+Number(v||0),0);

  return <Page title={`${h.name}`} sub={`Shared household workspace · ${members.filter(m=>m.status==="active").length}/${h.memberLimit} active people · your role: ${h.myRole}`} action={isOwner?<button className="secondary" onClick={sendDigest}><Mail size={15}/> Send 7-day digest</button>:null}>
    {msg&&<div className="info">{msg}</div>}
    {invites.map(i=><div className="inviteBanner" key={i.id}><div><b>Another household invitation: {i.household_name}</b><span>BillWise currently opens your primary household first.</span></div><button className="secondary" onClick={()=>acceptInvite(i.household_id)}>Accept</button></div>)}

    <div className="familyHero">
      <div><span className="eyebrow">FAMILY PLAN VALUE</span><h2>Everybody knows what is due and who owns it.</h2><p>Shared money is visible. Personal bills and private bank transactions stay personal.</p></div>
      <div className="familyHeroBadge"><ShieldCheck size={18}/><span><b>Private by default</b><small>No member can see another member's personal BillWise account data here.</small></span></div>
    </div>

    <div className="stats familyStats">
      <Stat icon={<ReceiptText/>} label="Unpaid shared" value={money(s.unpaidShared)} detail={`${expenses.filter(x=>!x.paid).length} open household items`}/>
      <Stat icon={<CalendarClock/>} label="Due next 7 days" value={money(s.dueNext7)} detail={`${s.dueNext7Count||0} shared items`}/>
      <Stat icon={<TrendingUp/>} label="Overdue" value={money(s.overdue)} detail={`${s.overdueCount||0} items need attention`}/>
      <Stat icon={<Repeat2/>} label="Recurring / month" value={money(s.recurringMonthly)} detail="Normalized household recurring cost"/>
    </div>
    <div className="familyPulse">
      <div><span>Your open shares</span><b>{money(s.myOpenShares)}</b><small>Only your assigned household responsibility</small></div>
      <div><span>Shared subscriptions</span><b>{money(s.subscriptionMonthly)}/mo</b><small>Items marked as household subscriptions</small></div>
      <div><span>Household before payday</span><b>{s.nextPayday?money(s.householdDueBeforeNextPayday):"Add income"}</b><small>{s.nextPayday?`Due by ${s.nextPayday} · your share ${money(s.dueBeforeNextPayday)}`:"Enter a future payday in Income"}</small></div>
      <div className={s.overBudgetCount?"alert":""}><span>Budget alerts</span><b>{s.overBudgetCount||0}</b><small>{s.overBudgetCount?"Categories over the household limit":"Shared categories are within plan"}</small></div>
    </div>

    <div className="familyTabs">{[["overview","Overview"],["bills","Shared bills"],["budget","Budget"],["goals","Goals"],["members","Members & activity"]].map(([id,label])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</div>

    {tab==="overview"&&<>
      <div className="grid2">
        <section className="card"><Head title="Who's responsible" text="Unpaid assigned shares — tracking only, not money transfers"/>{(s.responsibility||[]).map(x=><div className="responsibilityRow" key={x.email}><div className="round">{x.email[0]?.toUpperCase()}</div><span><b>{members.find(m=>String(m.email).toLowerCase()===x.email)?.name||x.email}</b><small>{x.email}</small></span><strong>{money(x.amount)}</strong></div>)}{!s.responsibility?.length&&<Empty text="Nobody has an unpaid assigned share."/>}{myShares.length>0&&<div className="myShareCallout"><b>Your open shares: {money(myShares.reduce((n,x)=>n+Number(x.amount),0))}</b><span>Mark each share paid from Shared bills when you have handled it.</span></div>}</section>
        <section className="card"><Head title="Next household items" text="Nearest open shared due dates"/>{upcoming.map(x=><div className="familyDueRow" key={x.id}><div><b>{x.name}</b><small>{dateOnly(x.due_date)||"No due date"} · {x.category}{x.recurring?` · ${x.recurrence}`:""}</small></div><strong>{money(x.amount)}</strong></div>)}{!upcoming.length&&<Empty text="No open shared expenses."/>}</section>
      </div>
      <div className="grid2">
        <section className="card householdAsk"><Head title="Ask the household" text="Answers use shared household data only"/><form onSubmit={askHousehold}><input value={ask} onChange={e=>setAsk(e.target.value)} placeholder="What is due this week? Who has the most unpaid shares?"/><button className="primary"><Sparkles size={15}/> Ask</button></form>{answer&&<div className="householdAnswer"><div className="aiMini">AI</div><p>{answer}</p></div>}<div className="chips"><button onClick={()=>setAsk("What is due this week?")}>Due this week</button><button onClick={()=>setAsk("Who has unpaid shares?")}>Who owes what</button><button onClick={()=>setAsk("How much are our shared subscriptions?")}>Subscriptions</button><button onClick={()=>setAsk("What do I owe before payday?")}>Before payday</button><button onClick={()=>setAsk("Are we over budget?")}>Budget check</button></div></section>
        <section className="card"><Head title={`${data.currentMonth} shared budget`} text="Planned household expenses against owner-set limits"/><div className="budgetHeadline"><span>Budgeted</span><b>{money(s.budgetTotal)}</b><span>Planned expenses</span><b>{money(s.plannedThisMonth)}</b></div>{budgets.slice(0,4).map(b=><BudgetBar key={b.id} b={b}/>)}{!budgets.length&&<Empty text={isOwner?"Set category budgets in the Budget tab.":"The household owner has not set category budgets yet."}/>}</section>
      </div>
    </>}

    {tab==="bills"&&<>
      <div className="familyBillsLayout">
        <form className="card sharedForm" onSubmit={addExpense}>
          <Head title="Add a household responsibility" text="Split equally, assign one person, or set exact custom shares"/>
          <label>Name<input value={expense.name} onChange={e=>setExpense({...expense,name:e.target.value})} placeholder="Electricity" required/></label>
          <div className="form2">
            <label>Amount<input type="number" min="0.01" step="0.01" value={expense.amount} onChange={e=>setExpense({...expense,amount:e.target.value})} required/></label>
            <label>Due date<input type="date" value={expense.dueDate} onChange={e=>setExpense({...expense,dueDate:e.target.value})}/></label>
          </div>
          <div className="form2">
            <label>Category<select value={expense.category} onChange={e=>setExpense({...expense,category:e.target.value})}>{["Housing","Utilities","Groceries","Internet","Transport","School","Insurance","Subscriptions","Other"].map(x=><option key={x}>{x}</option>)}</select></label>
            <label>Split method<select value={expense.splitMode} onChange={e=>setExpense({...expense,splitMode:e.target.value})}><option value="equal">Split equally</option><option value="assigned">Assign to one person</option><option value="custom">Custom amounts</option></select></label>
          </div>
          {expense.splitMode==="assigned"&&<label>Assign to<select value={expense.assignedToEmail} onChange={e=>setExpense({...expense,assignedToEmail:e.target.value})}><option value="">Me</option>{activeMembers.map(m=><option key={m.id} value={m.email}>{m.name||m.email}</option>)}</select></label>}
          {expense.splitMode==="custom"&&<div className="customSplitBox"><div className="customSplitHead"><span>Custom shares</span><b className={Math.abs(customTotal-Number(expense.amount||0))<0.005?"ok":"warn"}>{money(customTotal)} / {money(expense.amount)}</b></div>{activeMembers.map(m=><label className="customSplitRow" key={m.id}><span>{m.name||m.email}<small>{m.email}</small></span><input type="number" min="0" step="0.01" value={customSplits[m.email]??""} onChange={e=>setCustomSplits({...customSplits,[m.email]:e.target.value})} placeholder="0.00"/></label>)}<small className="note">Custom shares must add up to the exact bill total before BillWise saves it.</small></div>}
          <div className="form2">
            <label>Reminder audience<select value={expense.reminderScope} onChange={e=>setExpense({...expense,reminderScope:e.target.value})}><option value="assigned">Assigned people only</option><option value="everyone">Everyone in household</option></select></label>
            <label className="checkline"><input type="checkbox" checked={expense.isSubscription} onChange={e=>setExpense({...expense,isSubscription:e.target.checked})}/> Shared subscription</label>
          </div>
          <div className="recurringBox"><label className="switchLine"><input type="checkbox" checked={expense.recurring} onChange={e=>setExpense({...expense,recurring:e.target.checked})}/><span><b>Recurring household bill</b><small>When every share is marked paid, BillWise automatically creates the next occurrence.</small></span></label>{expense.recurring&&<select value={expense.recurrence} onChange={e=>setExpense({...expense,recurrence:e.target.value})}>{["weekly","biweekly","monthly","quarterly","yearly"].map(x=><option key={x}>{x}</option>)}</select>}</div>
          <label>Notes<textarea value={expense.notes} onChange={e=>setExpense({...expense,notes:e.target.value})} placeholder="Optional household note"/></label>
          <button className="primary"><Plus size={15}/> Add shared expense</button>
        </form>
        <section className="card familyBillList"><Head title="Household board" text="Every share shows who owns it and whether it is handled"/>{expenses.map(x=>{const xs=splits.filter(s=>s.expense_id===x.id);const canDelete=isOwner||x.created_by_user_id===data.viewer.id;return <div className={`familyBill ${x.paid?"done":""}`} key={x.id}><div className="familyBillTop"><span className={`status ${x.paid?"paid":dateOnly(x.due_date)<new Date().toISOString().slice(0,10)?"due":"upcoming"}`}>{x.paid?"Paid":dateOnly(x.due_date)||"Open"}</span><div className="familyBillName"><b>{x.name}</b><small>{x.category}{x.is_subscription?" · subscription":""}{x.recurring?` · repeats ${x.recurrence}`:""} · {x.reminder_scope==="everyone"?"remind everyone":"assigned reminders"}</small></div><strong>{money(x.amount)}</strong>{canDelete&&<button className="iconOnly" onClick={()=>deleteExpense(x)}><Trash2 size={14}/></button>}</div><div className="splitLine">{xs.map(sp=><button key={sp.id} className={`splitChip ${sp.status}`} disabled={!isOwner&&String(sp.member_email).toLowerCase()!==myEmail} onClick={()=>toggleSplit(sp)}><span>{members.find(m=>String(m.email).toLowerCase()===String(sp.member_email).toLowerCase())?.name||sp.member_email}</span><b>{money(sp.amount)}</b><small>{sp.status}</small></button>)}</div>{!x.paid&&(!xs.length||isOwner||x.created_by_user_id===data.viewer.id)&&<button className="tinyAction" onClick={()=>markExpensePaid(x)}><Check size={13}/> Mark whole item paid</button>}</div>})}{!expenses.length&&<Empty text="Add your first shared household expense."/>}</section>
      </div>
    </>}

    {tab==="budget"&&<div className="grid2">
      <section className="card"><Head title={`Category limits · ${data.currentMonth}`} text="The owner sets limits; everyone can see progress"/>{budgets.map(b=><div className="budgetItem" key={b.id}><BudgetBar b={b}/>{isOwner&&<button className="iconOnly" onClick={()=>deleteBudget(b.id)}><Trash2 size={13}/></button>}</div>)}{!budgets.length&&<Empty text="No category limits yet."/>}</section>
      {isOwner?<form className="card sharedForm" onSubmit={saveBudget}><Head title="Set a category budget" text="This compares the month's scheduled shared expenses with your limit"/><label>Category<select value={budget.category} onChange={e=>setBudget({...budget,category:e.target.value})}>{["Housing","Utilities","Groceries","Internet","Transport","School","Insurance","Subscriptions","Other"].map(x=><option key={x}>{x}</option>)}</select></label><label>Monthly limit<input type="number" min="0" step="0.01" value={budget.amount} onChange={e=>setBudget({...budget,amount:e.target.value})} required/></label><button className="primary">Save budget</button><p className="note">This is a planning limit based on shared expenses, not an automatic restriction on anyone's bank account.</p></form>:<section className="card"><ShieldCheck size={30}/><h3>Owner-controlled budgets</h3><p className="muted">Only the household owner can change shared budget limits, which keeps everyone from overwriting the family plan.</p></section>}
    </div>}

    {tab==="goals"&&<div className="goalsLayout">
      <form className="card goalForm" onSubmit={createGoal}><Head title="Create a shared goal" text="Emergency fund, trip, school, home or anything the household is building toward"/><label>Goal name<input value={goal.name} onChange={e=>setGoal({...goal,name:e.target.value})} placeholder="Family emergency fund" required/></label><label>Target amount<input type="number" min="1" step="0.01" value={goal.targetAmount} onChange={e=>setGoal({...goal,targetAmount:e.target.value})} required/></label><div className="form2"><label>Target date<input type="date" value={goal.targetDate} onChange={e=>setGoal({...goal,targetDate:e.target.value})}/></label><label>Category<select value={goal.category} onChange={e=>setGoal({...goal,category:e.target.value})}>{["Emergency","Travel","School","Home","Vehicle","Celebration","Family"].map(x=><option key={x}>{x}</option>)}</select></label></div><button className="primary">Create shared goal</button></form>
      <section className="goalCards">{goals.map(g=>{const pct=Math.min(100,Number(g.current_amount)/Number(g.target_amount)*100);return <div className="card goalCard familyGoal" key={g.id}><div className="goalTop"><div><span>{g.category}</span><h3>{g.name}</h3></div>{isOwner&&<button className="iconOnly" onClick={()=>deleteGoal(g.id)}><Trash2 size={14}/></button>}</div><div className="goalMoney"><b>{money(g.current_amount)}</b><span>of {money(g.target_amount)}</span></div><div className="progress"><i style={{width:`${pct}%`}}/></div><div className="goalBottom"><small>{pct.toFixed(0)}% complete{g.target_date?` · ${dateOnly(g.target_date)}`:""}</small><div><button onClick={()=>contribute(g,10)}>+$10</button><button onClick={()=>contribute(g,50)}>+$50</button></div></div><div className="goalContribs">{(g.contributions||[]).slice(0,3).map(c=><small key={c.id}>{c.contributor_name||c.member_email} +{money(c.amount)}</small>)}</div></div>})}{!goals.length&&<Empty text="Create a shared goal and let household members record contributions."/>}</section>
    </div>}

    {tab==="members"&&<>
      <div className="grid2">
        <section className="card"><Head title="People in this household" text="One Family subscription covers this shared workspace"/>{members.map(m=><div className="memberRow memberManaged" key={m.id}><div className="round">{(m.name||m.email)?.[0]?.toUpperCase()}</div><span><b>{m.name||m.email}</b><small>{m.email} · {m.role} · {m.status}{m.plan?` · personal ${m.plan} plan`:""}</small></span>{isOwner&&m.role!=="owner"&&<button className="ghost" onClick={()=>removeMember(m)}>{m.status==="pending"?"Cancel invite":"Remove"}</button>}</div>)}{isOwner&&<form className="inlineField householdInvite" onSubmit={inviteMember}><input type="email" value={invite} onChange={e=>setInvite(e.target.value)} placeholder="Invite by email" required/><button className="secondary">Invite member</button></form>}<p className="note">Invited members can use this household workspace while the owner's Family subscription is active. Their private personal bills and bank data stay outside the household.</p>{!isOwner&&<button className="ghost dangerGhost" onClick={leaveHouse}>Leave household</button>}</section>
        <section className="card"><Head title="Household activity" text="See who changed, paid, contributed or invited"/>{activity.map(a=><div className="activityRow" key={a.id}><div className="activityDot"/><div><b>{a.message}</b><small>{new Date(a.created_at).toLocaleString()}</small></div></div>)}{!activity.length&&<Empty text="Household activity will appear here."/>}</section>
      </div>
      {isOwner&&<section className="card householdAutomation"><Head title="Automatic household reminders" text="Set the weekly digest once; BillWise handles it every week"/><div className="automationGrid"><label className="switchLine"><input type="checkbox" checked={familySettings.weeklyDigestEnabled} onChange={e=>setFamilySettings({...familySettings,weeklyDigestEnabled:e.target.checked})}/><span><b>Automatic 7-day digest</b><small>Email each active member their upcoming shared responsibilities once a week.</small></span></label><label>Digest day<select value={familySettings.digestWeekday} onChange={e=>setFamilySettings({...familySettings,digestWeekday:Number(e.target.value)})}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((x,i)=><option key={x} value={i}>{x}</option>)}</select></label><label>Digest hour<select value={familySettings.digestHour} onChange={e=>setFamilySettings({...familySettings,digestHour:Number(e.target.value)})}>{Array.from({length:24},(_,i)=><option key={i} value={i}>{new Date(2020,1,1,i).toLocaleTimeString([], {hour:"numeric"})}</option>)}</select></label><label className="switchLine"><input type="checkbox" checked={familySettings.remindEveryoneDefault} onChange={e=>setFamilySettings({...familySettings,remindEveryoneDefault:e.target.checked})}/><span><b>Prefer whole-household reminders</b><small>Use this as the owner's default reminder style for shared responsibilities.</small></span></label></div><div className="rowgap"><button className="primary" onClick={saveFamilySettings}>Save automation</button><button className="secondary" onClick={sendDigest}><Mail size={15}/> Send digest now</button></div></section>}
    </>}
  </Page>
}

function BudgetBar({b}){
  const pct=Math.max(0,Math.min(100,b.percent||0));
  const trend=Number(b.trendAmount||0);
  return <div className={`familyBudgetBar ${b.over?"over":""}`}><div><span>{b.category}</span><b>{money(b.scheduled)} / {money(b.amount)}</b></div><div className="bar"><i style={{width:`${pct}%`}}/></div><small>{b.over?`${money(Math.abs(b.remaining))} over planned limit`:`${money(b.remaining)} remaining`} · {trend===0?"same planned amount as last month":`${trend>0?"+":"-"}${money(Math.abs(trend))} vs last month`}</small></div>
}

function Integrations({user,setPage}){
  const[status,setStatus]=useState(null),[msg,setMsg]=useState(""),[loading,setLoading]=useState(false);
  async function loadStatus(){setLoading(true);try{setStatus(await api("/api/premium/integrations/status"));setMsg("")}catch(e){setMsg("Service status could not be refreshed. Your saved BillWise data is unaffected.")}finally{setLoading(false)}}
  useEffect(()=>{loadStatus()},[user.plan]);
  async function testEmail(){try{await api("/api/premium/integrations/test-email",{method:"POST"});setMsg("Test reminder email sent. Check your inbox.")}catch(e){setMsg(e.message)}}
  const billing=status?.billing;
  const paymentReady=billing?.productionReady||billing?.demo;
  const cards=[
    ["Secure cloud data",status?.postgres?.configured,"Accounts, bills, goals and household records are stored in PostgreSQL"],
    ["Email reminders",status?.email?.configured,status?.email?.configured?(status?.email?.enabledForUser?"Reminder delivery is connected and enabled":"Email service is connected; reminders are off in your preferences"):"Email delivery is temporarily unavailable"],
    [billing?.provider==="polar"?"Polar billing":"Plan billing",paymentReady,billing?.demo?"Test billing mode is active":billing?.productionReady?`${String(billing.provider).toUpperCase()} is connected · ${billing.status}`:"Live checkout is not available yet"],
    ["Read-only bank sync",status?.bank?.configured,status?.bank?.configured?`${status.bank.connections||0} connection${status.bank.connections===1?"":"s"} · ${status.bank.env} · read only`:"Bank linking is not available in this environment yet"]
  ];
  return <Page title="Services & connections." sub="The things BillWise uses to keep your account synced, reminded and billed." action={<button className="secondary" onClick={loadStatus} disabled={loading}><RefreshCw size={15}/> {loading?"Checking…":"Refresh status"}</button>}>
    {msg&&<div className="info">{msg}</div>}
    <div className="integrationGrid">{cards.map(([name,ok,detail])=><div className={`card integrationCard ${ok?"ready":"needs"}`} key={name}><div className="integrationStatus">{ok?<Check size={18}/>:<Plug size={18}/>}</div><div><span>{ok?"READY":"NOT AVAILABLE"}</span><h3>{name}</h3><p>{detail}</p></div></div>)}</div>
    <section className="card connectionActions"><Head title="Your controls" text="Manage the services attached to your BillWise account"/><div className="connectionButtons"><button className="secondary" disabled={!status?.email?.configured||user.plan==="free"} onClick={testEmail}><Mail size={15}/> Send test reminder</button><button className="secondary" onClick={()=>setPage("banks")}><Landmark size={15}/> Bank connections</button><button className="secondary" onClick={()=>setPage("plans")}><BadgeDollarSign size={15}/> Billing & plans</button></div><p className="note">Bank access is read-only: BillWise can read supported balances and transactions after permission, but it does not initiate transfers or move money.</p></section>
  </Page>
}

function Plans({user,onUser}){
  const[config,setConfig]=useState(null),[busy,setBusy]=useState("");
  useEffect(()=>{api("/api/billing/config").then(setConfig).catch(()=>{})},[user.plan]);
  const plans=[
    ["free","Free","$0","Start organized",["10 active bills","Manual subscription tracking","In-app due-date reminders","Bill calendar","Basic dashboard"]],
    ["plus","Plus","$4.99/mo","Stay ahead",["Unlimited bills","Real email reminders","30-day cash-flow forecast","Savings goals","Bill increase watch","Smart recurring-cost insights"]],
    ["pro","Pro","$9.99/mo","Automate the work",["Everything in Plus","BillWise AI assistant","Read-only Plaid bank sync","Recurring charge detection","90-day forecast","Monthly money reports","Connection diagnostics"]],
    ["family","Family","$14.99/mo","Run the household",["Everything in Pro","One subscription covers up to 5 people","Equal, assigned or exact custom bill splits","Recurring shared bills roll forward automatically","Due-today and overdue household reminders","Automatic weekly 7-day household digest","Shared budgets with over-limit warnings","Shared savings goals & contribution history","Household AI for dues, shares, budgets and payday planning","Full activity history for accountability","Private personal bills and bank data stay separate"]]
  ];
  async function checkout(plan){
    if(plan==="free")return;
    setBusy(plan);
    try{
      const r=await api("/api/billing/checkout",{method:"POST",body:JSON.stringify({plan})});
      if(r.url)location.href=r.url;
      if(r.demo){
        const me=await api("/api/auth/me");setSession(getToken(),me.user);onUser(me.user);
      }
    }catch(e){alert(e.message)}finally{setBusy("")}
  }
  async function portal(){
    try{const r=await api("/api/billing/portal",{method:"POST"});location.href=r.url}catch(e){alert(e.message)}
  }
  return <Page title="Pay for less stress, not just more storage." sub={`${config?.provider==="polar"?"Polar":"BillWise"} billing · Free stays useful; paid plans unlock automation and forward-looking tools.`} action={config?.billing?.hasCustomerPortal?<button className="secondary" onClick={portal}>Manage billing</button>:null}>
    {config?.billing&&<div className="billingStatus card"><div><span>Current subscription</span><b>{String(config.billing.plan||user.plan).toUpperCase()} · {config.billing.status}</b></div>{config.billing.currentPeriodEnd&&<div><span>Current period</span><b>through {dateOnly(config.billing.currentPeriodEnd)}</b></div>}{config.billing.cancelAtPeriodEnd&&<div className="warningInline">Cancels at the end of the current paid period</div>}</div>}
    <div className="plans">{plans.map(([id,name,price,tagline,fs])=><div className={`pricecard ${id==="pro"?"popular":""}`} key={id}>{id==="pro"&&<i>MOST POPULAR</i>}<span className="planTagline">{tagline}</span><h3>{name}</h3><strong className="priceBig">{price}</strong><ul>{fs.map(f=><li key={f}>✓ {f}</li>)}</ul><button disabled={id==="free"||busy===id} className={user.plan===id?"ghost":"primary"} onClick={()=>checkout(id)}>{user.plan===id?"Current plan":id==="free"?"Included":busy===id?"Opening checkout…":"Choose "+name}</button></div>)}</div>
    <div className="pricingPromise card"><ShieldCheck size={23}/><div><h3>No fake guarantees</h3><p>Forecasts and assistant answers are estimates from the data the user enters or connects. BillWise does not promise that an amount is safe to spend and does not move money from connected bank accounts.</p></div></div>
  </Page>
}

function SettingsPage({user,setUser}){
  const[days,setDays]=useState((user.reminderDays||[7,3,1,0]).join(",")),[emails,setEmails]=useState(user.emailReminders!==false),[msg,setMsg]=useState("");
  async function save(){
    try{
      const vals=days.split(",").map(x=>Number(x.trim())).filter(Number.isFinite);
      const r=await api("/api/auth/preferences",{method:"PUT",body:JSON.stringify({reminderDays:vals,emailReminders:emails})});
      setSession(r.token,r.user);setUser(r.user);setMsg("Reminder preferences saved.")
    }catch(e){setMsg(e.message)}
  }
  async function exp(){
    const r=await fetch(BASE+"/api/export.csv",{headers:{Authorization:`Bearer ${getToken()}`}}),blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="billwise-bills.csv";a.click();URL.revokeObjectURL(url)
  }
  return <Page title="Account, reminders & data." sub="Control notification timing and export your records."><div className="settingsgrid"><section className="card settings"><h3>Account</h3><div><span>Name</span><b>{user.name}</b></div><div><span>Email</span><b>{user.email}</b></div><div><span>Plan</span><b>{user.plan}</b></div></section><section className="card settings"><h3><Mail size={17}/> Reminder preferences</h3><label>Days before due date<input value={days} onChange={e=>setDays(e.target.value)} placeholder="7,3,1,0"/></label><label className="checkline"><input type="checkbox" checked={emails} onChange={e=>setEmails(e.target.checked)}/> Send email reminders when plan supports it</label><button className="primary" onClick={save}>Save reminders</button>{msg&&<p className="muted">{msg}</p>}</section><section className="card settings"><h3><Download size={17}/> Your data</h3><p>Export bill records as CSV.</p><button className="secondary" onClick={exp}>Export CSV</button></section><section className="card settings"><h3><ShieldCheck size={17}/> Bank privacy</h3><p>Bank access tokens are encrypted at rest. Bank integration is read-only and does not initiate payments or transfers.</p></section></div></Page>
}
