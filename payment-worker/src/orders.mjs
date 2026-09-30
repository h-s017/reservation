const now=()=>Math.floor(Date.now()/1000);
const id=prefix=>prefix+crypto.randomUUID().replaceAll('-','').slice(0,28);
const fail=code=>{throw new Error(code);};
export const sql=(db,text,...args)=>db.prepare(text).bind(...args);
async function getOrder(db,where,...args){
  const row=await sql(db,'SELECT * FROM orders WHERE '+where,...args).first();
  if(!row)fail('NOT_FOUND');
  const slots=await sql(db,'SELECT s.id,s.date,s.time,s.starts_at FROM order_slots os JOIN slots s ON s.id=os.slot_id WHERE os.order_id=? ORDER BY s.starts_at',row.id).all();
  const attempt=await sql(db,'SELECT * FROM payment_attempts WHERE order_id=? ORDER BY ordinal DESC LIMIT 1',row.id).first();
  return {...row,slots:slots.results,attempt};
}
export const ownedOrder=(db,hash,orderId)=>getOrder(db,'access_hash=? AND (? IS NULL OR id=?)',hash,orderId||null,orderId||null);
export function publicOrder(o){
  const {id,status,course,variant,slots,amount,name,phone,email,line,created_at,paid_at}=o;
  const a=o.attempt;const transfer=a?.account_no?{bankCode:a.bank_code,account:a.account_no,deadline:a.deadline,expired:a.deadline<=now()}:null;
  return {id,status,course,variant,slots,amount,name,phone,email,line,created_at,paid_at,transfer};
}
export async function listSlots(db,from=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'})){
  const rows=await sql(db,`SELECT s.id,c.series,c.course,c.variant,s.date,s.time,c.price,s.capacity,s.booked,c.unit,
    CASE WHEN s.status='CLOSED' OR c.enabled=0 OR d.date IS NOT NULL THEN '關閉' ELSE '開放' END AS status
    FROM slots s JOIN courses c ON c.id=s.course_id LEFT JOIN closed_dates d ON d.date=s.date WHERE s.date>=? ORDER BY s.date,s.time`,from).all();
  return rows.results;
}
export async function createOrder(db,hash,d,contest=false){
  try{return await ownedOrder(db,hash);}catch(e){if(e.message!=='NOT_FOUND')throw e;}
  const fields={};for(const key of ['name','phone','email','line','note'])fields[key]=typeof d[key]==='string'?d[key].trim():'';
  if(d.website||!fields.name||fields.name.length>50||!/^[0-9+\-() ]{7,20}$/.test(fields.phone)||fields.line.length>50||fields.note.length>800||
    (!contest&&!fields.email)||(fields.email&&(fields.email.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))))fail('BAD_REQUEST');
  if(!Array.isArray(d.slotIds)||!d.slotIds.length||d.slotIds.length>12||new Set(d.slotIds).size!==d.slotIds.length||d.slotIds.some(s=>typeof s!=='string'||s.length>140))fail('BAD_REQUEST');
  const rows=await sql(db,`SELECT s.*,c.course,c.variant,c.price,c.contest,c.required_slots,c.max_slots,c.enabled
    FROM slots s JOIN courses c ON c.id=s.course_id WHERE s.id IN (${d.slotIds.map(()=>'?').join(',')})`,...d.slotIds).all();
  const s=rows.results[0];
  if(!s||rows.results.length!==d.slotIds.length||rows.results.some(x=>x.course_id!==s.course_id)||s.required_slots!==d.slotIds.length||d.slotIds.length>s.max_slots)fail('BAD_REQUEST');
  if(Boolean(s.contest)!==contest||!s.enabled||(!contest&&s.price<=0))fail('COURSE_UNAVAILABLE');
  const orderId=id('HF'),timestamp=now();
  try{
    await db.batch([
      sql(db,`INSERT INTO orders(id,access_hash,course_id,course,variant,amount,name,phone,email,line,note,status,created_at,hold_until)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,orderId,hash,s.course_id,s.course,s.variant,s.price,fields.name,fields.phone,fields.email,fields.line,fields.note,contest?'LINE_CONFIRMATION':'PENDING',timestamp,timestamp+1800),
      ...d.slotIds.map(slotId=>sql(db,'INSERT INTO order_slots(order_id,slot_id) VALUES(?,?)',orderId,slotId))
    ]);
  }catch(e){
    // A competing request using the same token may have committed first.
    try{return await ownedOrder(db,hash);}catch(_){}
    if(String(e).includes('SLOT_FULL'))fail('SLOT_FULL');throw e;
  }
  return ownedOrder(db,hash,orderId);
}
export async function startCheckout(db,hash,orderId){
  let order=await ownedOrder(db,hash,orderId);
  if(order.status==='PAID'||order.attempt?.status==='PENDING')return order;
  if(order.status==='LINE_CONFIRMATION')fail('BAD_REQUEST');
  try{
    await db.batch([
      sql(db,"UPDATE orders SET status='PENDING',hold_until=? WHERE id=? AND status IN ('CANCELLED','FAILED','PENDING')",now()+1800,order.id),
      sql(db,`INSERT INTO payment_attempts(id,order_id,ordinal,status,timestamp,deadline)
        SELECT ?,?,COALESCE(MAX(ordinal),0)+1,'PENDING',?,? FROM payment_attempts WHERE order_id=? HAVING COALESCE(MAX(ordinal),0)<20`,id('H'),order.id,now(),Math.min(...order.slots.map(s=>s.starts_at))>=now()+302400?now()+172800:0,order.id)
    ]);
  }catch(e){
    const latest=await ownedOrder(db,hash,order.id);
    if(latest.status==='PAID'||latest.attempt?.status==='PENDING')return latest;
    if(String(e).includes('SLOT_FULL'))fail('SLOT_FULL');
    if(String(e).includes('COURSE_UNAVAILABLE'))fail('COURSE_UNAVAILABLE');throw e;
  }
  order=await ownedOrder(db,hash,order.id);
  if(order.attempt?.status!=='PENDING')fail('PAYMENT_ATTEMPTS_EXHAUSTED');
  return order;
}
export async function cancelOrder(db,hash,orderId){
  const o=await ownedOrder(db,hash,orderId);
  if(o.status==='PAID'||o.attempt?.status==='PENDING'||o.status==='LINE_CONFIRMATION')fail('PAYMENT_PENDING');
  try{await sql(db,"UPDATE orders SET status='CANCELLED' WHERE id=? AND status IN ('PENDING','FAILED','CANCELLED')",o.id).run();}
  catch(e){if(String(e).includes('PAYMENT_PENDING'))fail('PAYMENT_PENDING');throw e;}
  const latest=await ownedOrder(db,hash,o.id);if(latest.status!=='CANCELLED')fail('PAYMENT_PENDING');return latest;
}
export async function notifyOrder(db,n){
  const a=await sql(db,'SELECT * FROM payment_attempts WHERE id=?',n.merchantOrderNo).first();
  if(!a)fail('NOT_FOUND');
  const o=await getOrder(db,'id=?',a.order_id);
  if(o.amount!==n.amount)fail('AMOUNT_MISMATCH');
  if(o.status==='PAID'){
    if(n.status==='PAID'&&o.trade_no!==n.tradeNo)fail('TRADE_CONFLICT');return;
  }
  if(n.status==='PAID'){
    if(!n.tradeNo||a.status!=='PENDING'||o.attempt.id!==a.id||o.status!=='PENDING')fail('PAYMENT_PENDING');
    // One statement atomically sets order, attempt and all permanent records.
    // The trigger refuses conflicting transitions and updates the attempt too.
    const result=await sql(db,"UPDATE payment_attempts SET status='PAID',trade_no=? WHERE id=? AND status='PENDING'",n.tradeNo,a.id).run();
    if(!result.meta.changes){const latest=await getOrder(db,'id=?',a.order_id);if(latest.status!=='PAID'||latest.trade_no!==n.tradeNo)fail('TRADE_CONFLICT');}
  }else if(n.status==='FAILED'){
    await sql(db,"UPDATE payment_attempts SET status='FAILED' WHERE id=? AND status='PENDING'",a.id).run();
  }else fail('BAD_REQUEST');
}
export async function expireDrafts(db){
  // Never expire an attempt with an unknown provider result.
  await sql(db,`UPDATE orders SET status='CANCELLED' WHERE status IN ('PENDING','FAILED') AND hold_until<?
    AND NOT EXISTS(SELECT 1 FROM payment_attempts WHERE order_id=orders.id AND status IN ('PENDING','PAID'))`,now()).run();
}
export async function adminAction(db,path,d){
  if(path==='/api/admin/orders'){
    const before=Number.isSafeInteger(d.before)?d.before:now()+1,beforeId=typeof d.beforeId==='string'?d.beforeId:'\uffff';
    const rows=await sql(db,`SELECT id,course,variant,name,phone,email,line,note,amount,status,trade_no,created_at,paid_at,
      (SELECT group_concat(s.date||' '||s.time,' / ') FROM order_slots os JOIN slots s ON s.id=os.slot_id WHERE os.order_id=o.id) AS sessions
      FROM orders o WHERE created_at<? OR (created_at=? AND id<?) ORDER BY created_at DESC,id DESC LIMIT 200`,before,before,beforeId).all();return {orders:rows.results};
  }
  if(path==='/api/admin/slots')return {slots:await listSlots(db,typeof d.from==='string'?d.from:'0000')};
  if(path==='/api/admin/slot'){
    if(typeof d.id!=='string'||!['OPEN','CLOSED'].includes(d.status)||!Number.isInteger(d.capacity)||d.capacity<1||d.capacity>100)fail('BAD_REQUEST');
    const result=await db.batch([
      sql(db,'UPDATE slots SET status=?,capacity=? WHERE id=? AND booked<=?',d.status,d.capacity,d.id,d.capacity),
      sql(db,'INSERT INTO admin_audit(action,target,created_at) VALUES(?,?,?)',JSON.stringify({status:d.status,capacity:d.capacity}),d.id,now())
    ]);if(!result[0].meta.changes)fail('CAPACITY_CONFLICT');return {};
  }
  if(path==='/api/admin/date'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||typeof d.closed!=='boolean')fail('BAD_REQUEST');
    await db.batch([d.closed?sql(db,'INSERT INTO closed_dates(date,reason) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET reason=excluded.reason',d.date,String(d.reason||'').slice(0,200)):sql(db,'DELETE FROM closed_dates WHERE date=?',d.date),
      sql(db,'INSERT INTO admin_audit(action,target,created_at) VALUES(?,?,?)',d.closed?'CLOSE_DATE':'REMOVE_DATE_OVERRIDE',d.date,now())]);return {};
  }
  if(path==='/api/admin/cancel'){
    const row=await sql(db,'SELECT access_hash FROM orders WHERE id=?',d.id).first();if(!row)fail('NOT_FOUND');
    return {order:publicOrder(await cancelOrder(db,row.access_hash,d.id))};
  }
  fail('NOT_FOUND');
}
