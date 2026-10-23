// Durable manager-only LINE + Email notification queue.
// No provider token, private customer contact or payload is stored in public assets.
const sql=(db,q,...args)=>db.prepare(q).bind(...args);
const channels=['line','email'];
export function notifyConfig(env){
 return {
  enabled:env.NOTIFICATIONS_ENABLED==='true',
  line:Boolean(env.LINE_CHANNEL_ACCESS_TOKEN&&env.LINE_NOTIFY_USER_ID),
  email:Boolean(env.RESEND_API_KEY&&env.NOTIFY_EMAIL_TO&&env.NOTIFY_EMAIL_FROM)
 };
}
const subjectFor={
 PAID:'付款成功｜新課程預約',
 LINE_INQUIRY:'新 LINE 報名洽詢｜待人工確認',
 PAYMENT_FAILED:'付款未成功｜請確認',
 REFUND_REQUESTED:'退款處理申請｜待核對',
 REFUNDED:'退款已確認｜訂單更新'
};
export function notificationMessage(job,order){
 const title=subjectFor[job.kind];
 if(!title)throw Error('NOTIFY_INVALID_KIND');
 // Deliberately omit student names, phone numbers, notes, bank accounts and email.
 const details=[
  'HANA Reservation Manager',
  title,
  '訂單：'+order.id,
  '課程：'+order.course+(order.variant?'｜'+order.variant:''),
  '場次：'+(order.sessions||'詳見後台'),
  '人數：'+order.quantity+' '+(order.booking_unit||'位'),
  '金額：NT$ '+order.amount.toLocaleString('en-US'),
  '請至 HANA WORKSPACE 查看詳情。'
 ];
 if(job.kind==='LINE_INQUIRY')details.push('注意：此單尚待 LINE 人工確認，不代表付款成功。');
 if(job.kind==='PAYMENT_FAILED')details.push('注意：請查核訂單，不要將此通知視為已完成退款或取消。');
 return {subject:'[HANA] '+title,text:details.join('\n')};
}
async function loadOrder(db,id){
 const row=await sql(db,"SELECT o.id,o.course,o.variant,o.amount,o.quantity,o.booking_unit,(SELECT group_concat(s.date||' '||s.time,' / ') FROM order_slots os JOIN slots s ON s.id=os.slot_id WHERE os.order_id=o.id) AS sessions FROM orders o WHERE o.id=?",id).first();
 if(!row)throw Error('NOTIFY_ORDER_MISSING');
 return row;
}
function failure(code,permanent=false){
 const e=new Error(code);e.permanent=permanent;return e;
}
async function deliver(job,message,env,fetchFn){
 if(job.channel==='line'){
  const response=await fetchFn('https://api.line.me/v2/bot/message/push',{
   method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'X-Line-Retry-Key':job.retry_key},
   body:JSON.stringify({to:env.LINE_NOTIFY_USER_ID,messages:[{type:'text',text:message.text}]})
  });
  // LINE accepts repeated X-Line-Retry-Key with an accepted-request id.
  if(response.status===409&&response.headers?.get('x-line-accepted-request-id'))return;
  if(!response.ok)throw failure('LINE_HTTP_'+response.status,response.status>=400&&response.status<500&&response.status!==429);
  return;
 }
 if(job.channel==='email'){
  const response=await fetchFn('https://api.resend.com/emails',{
   method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.RESEND_API_KEY,'Idempotency-Key':'hana-'+job.event_key+'-email'},
   body:JSON.stringify({from:env.NOTIFY_EMAIL_FROM,to:[env.NOTIFY_EMAIL_TO],subject:message.subject,text:message.text})
  });
  if(!response.ok)throw failure('EMAIL_HTTP_'+response.status,response.status>=400&&response.status<500&&![408,409,429].includes(response.status));
  return;
 }
 throw failure('NOTIFY_INVALID_CHANNEL',true);
}
export async function notificationStatus(db,env){
 const counts=(await sql(db,"SELECT channel,status,count(*) AS count FROM notification_outbox GROUP BY channel,status").all()).results;
 const recent=(await sql(db,"SELECT event_key,channel,order_id,kind,status,attempts,created_at,sent_at,error_code FROM notification_outbox ORDER BY created_at DESC,event_key DESC,channel ASC LIMIT 60").all()).results;
 return {settings:notifyConfig(env),counts,recent};
}
export async function dispatchNotifications(env,{db=env.DB,fetchFn=fetch,now=Math.floor(Date.now()/1000)}={}){
 const config=notifyConfig(env);
 if(!config.enabled)return {status:'DISABLED',sent:0,failed:0,skipped:0};
 const due=(await sql(db,"SELECT event_key,channel FROM notification_outbox WHERE attempts<8 AND ((status IN ('PENDING','RETRY') AND next_attempt_at<=?) OR (status='SENDING' AND lease_until<=?)) ORDER BY created_at,event_key,channel LIMIT 30",now,now).all()).results;
 let sent=0,failed=0,skipped=0;
 for(const key of due){
  if(!channels.includes(key.channel)||!config[key.channel]){skipped++;continue;}
  const leaseId=crypto.randomUUID(),retryKey=crypto.randomUUID();
  const claimed=await sql(db,"UPDATE notification_outbox SET status='SENDING',attempts=attempts+1,lease_until=?,lease_id=?,retry_key=COALESCE(retry_key,?) WHERE event_key=? AND channel=? AND attempts<8 AND ((status IN ('PENDING','RETRY') AND next_attempt_at<=?) OR (status='SENDING' AND lease_until<=?))",
   now+120,leaseId,retryKey,key.event_key,key.channel,now,now).run();
  if(claimed.meta.changes!==1)continue;
  const job=await sql(db,"SELECT * FROM notification_outbox WHERE event_key=? AND channel=? AND lease_id=?",key.event_key,key.channel,leaseId).first();
  if(!job)continue;
  try{
   const order=await loadOrder(db,job.order_id);
   await deliver(job,notificationMessage(job,order),env,fetchFn);
   await sql(db,"UPDATE notification_outbox SET status='SENT',sent_at=?,lease_until=0,lease_id=NULL,error_code=NULL WHERE event_key=? AND channel=? AND lease_id=?",now,job.event_key,job.channel,leaseId).run();
   sent++;
  }catch(error){
   const code=/^(LINE_HTTP_\d{3}|EMAIL_HTTP_\d{3}|NOTIFY_[A-Z_]+)$/.test(error?.message||'')?error.message:'NOTIFY_DELIVERY_ERROR';
   const final=Boolean(error.permanent)||job.attempts>=8;
   // Bounded retries stay inside the providers' 24h idempotency window.
   const delay=Math.min(1800,30*2**job.attempts);
   await sql(db,"UPDATE notification_outbox SET status=?,error_code=?,next_attempt_at=?,lease_until=0,lease_id=NULL WHERE event_key=? AND channel=? AND lease_id=?",
    final?'FAILED':'RETRY',code,now+delay,job.event_key,job.channel,leaseId).run();
   failed++;
  }
 }
 return {status:skipped?'PARTIAL_CONFIG':'OK',sent,failed,skipped};
}
