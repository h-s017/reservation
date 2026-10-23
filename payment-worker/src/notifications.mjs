// D1 outbox + owner-only LINE/Resend delivery. All provider credentials are Worker secrets.
const q=(db,s,...args)=>db.prepare(s).bind(...args);
const now=()=>Math.floor(Date.now()/1000);
const labels={BOOKING_NEW:'新報名（待付款）',PAYMENT_PAID:'付款成功',BOOKING_CANCELLED:'訂單取消',REFUND_REQUESTED:'退款申請',REFUND_COMPLETED:'退款完成',PAYMENT_FAILED:'付款失敗',ANOMALY:'預約系統異常'};
export const notificationConfigured=e=>({line:Boolean(e.LINE_CHANNEL_ACCESS_TOKEN&&e.LINE_NOTIFY_USER_ID),email:Boolean(e.RESEND_API_KEY&&e.NOTIFY_EMAIL_TO&&e.NOTIFY_EMAIL_FROM)});
async function digest(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function notificationStatus(db,env){
 const rows=(await q(db,'SELECT channel,status,count(*) AS total FROM notification_deliveries GROUP BY channel,status').all()).results;
 return {configured:notificationConfigured(env),counts:rows.map(x=>({channel:x.channel,status:x.status,total:x.total})),pending:rows.filter(x=>x.status!=='SENT').reduce((n,x)=>n+x.total,0)};
}
async function renderMessage(db,e){
 const title=labels[e.kind]||'預約事件';
 if(!e.order_id)return 'HANA Reservation Manager｜'+title+'\n診斷：'+e.detail+'\n請登入 HANA WORKSPACE 檢查。';
 const o=await q(db,'SELECT id,course,variant,amount,quantity FROM orders WHERE id=?',e.order_id).first();
 if(!o)return 'HANA Reservation Manager｜'+title+'\n訂單代號：'+e.order_id;
 const slots=(await q(db,'SELECT s.date,s.time FROM order_slots os JOIN slots s ON os.slot_id=s.id WHERE os.order_id=? ORDER BY s.starts_at',o.id).all()).results;
 const lines=['HANA Reservation Manager｜'+title];
 if(e.kind==='BOOKING_NEW')lines.push('目前為待付款，請勿視為報名完成。');
 lines.push('課程：'+o.course+(o.variant?'｜'+o.variant:''));
 if(slots.length)lines.push('場次：'+slots.map(s=>s.date+' '+s.time).join(' / '));
 lines.push('數量：'+o.quantity,'金額：NT$ '+o.amount,'訂單：'+o.id,'詳細資料請至 HANA WORKSPACE 查閱。');
 return lines.join('\n').slice(0,4500);
}
async function send(channel,env,payload,eventKey,fetchFn){
 const id=await digest(eventKey+':'+channel);
 if(channel==='line'){
  const hex=id.slice(0,32),retry=hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
  const r=await fetchFn('https://api.line.me/v2/bot/message/push',{
   method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'X-Line-Retry-Key':retry},
   body:JSON.stringify({to:env.LINE_NOTIFY_USER_ID,messages:[{type:'text',text:payload}]})
  });
  if(r.ok||(r.status===409&&r.headers?.get('x-line-accepted-request-id')))return {ok:true,id:r.headers?.get('x-line-request-id')||''};
  return {ok:false,code:r.status,permanent:r.status>=400&&r.status<500&&r.status!==429};
 }
 const r=await fetchFn('https://api.resend.com/emails',{
  method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.RESEND_API_KEY,'Idempotency-Key':'hana-'+id},
  body:JSON.stringify({from:env.NOTIFY_EMAIL_FROM,to:[env.NOTIFY_EMAIL_TO],subject:'HANA 預約通知｜'+payload.split('\n')[0].replace('HANA Reservation Manager｜',''),text:payload})
 });
 if(r.ok){const data=await r.json();return {ok:true,id:typeof data.id==='string'?data.id:''};}
 return {ok:false,code:r.status,permanent:r.status>=400&&r.status<500&&![408,409,429].includes(r.status)};
}
const backoff=n=>Math.min(3600,60*2**Math.min(5,n-1));
export async function processNotifications(env,{db=env.DB,fetchFn=fetch,limit=20,nowSeconds=now()}={}){
 const config=notificationConfigured(env),stats={sent:0,retry:0,failed:0,review:0,skipped:0};
 const jobs=(await q(db,"SELECT d.event_key,d.channel,d.attempts,d.first_attempt_at,d.message_text,e.kind,e.order_id,e.detail FROM notification_deliveries d JOIN notification_events e ON e.event_key=d.event_key WHERE ((d.status IN ('PENDING','RETRY') AND d.next_attempt_at<=?) OR (d.status='SENDING' AND d.lease_until<?)) ORDER BY e.created_at,d.event_key,d.channel LIMIT ?",nowSeconds,nowSeconds,Math.min(50,Math.max(1,limit))).all()).results;
 for(const job of jobs){
  if(!config[job.channel]){stats.skipped++;continue;}
  const first=job.first_attempt_at??nowSeconds;
  if(job.attempts>=6||(job.attempts>0&&nowSeconds-first>=23*3600)){
   await q(db,"UPDATE notification_deliveries SET status='REVIEW',last_error='DELIVERY_UNCONFIRMED',claim_id=NULL,lease_until=NULL WHERE event_key=? AND channel=? AND status<>'SENT'",job.event_key,job.channel).run();
   stats.review++;continue;
  }
  const payload=job.message_text||await renderMessage(db,job),claim=crypto.randomUUID();
  const taken=await q(db,"UPDATE notification_deliveries SET status='SENDING',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),claimed_at=?,lease_until=?,claim_id=?,message_text=COALESCE(message_text,?) WHERE event_key=? AND channel=? AND ((status IN ('PENDING','RETRY') AND next_attempt_at<=?) OR (status='SENDING' AND lease_until<?))",
   first,nowSeconds,nowSeconds+90,claim,payload,job.event_key,job.channel,nowSeconds,nowSeconds).run();
  if(!taken.meta.changes){stats.skipped++;continue;}
  let sent;try{sent=await send(job.channel,env,payload,job.event_key,fetchFn);}catch(_){sent={ok:false,code:0,permanent:false};}
  const status=sent.ok?'SENT':sent.permanent?'FAILED':'RETRY';
  const res=await q(db,"UPDATE notification_deliveries SET status=?,provider_id=?,sent_at=?,next_attempt_at=?,last_error=?,claim_id=NULL,lease_until=NULL WHERE event_key=? AND channel=? AND claim_id=?",
   status,sent.ok?sent.id:null,sent.ok?nowSeconds:null,sent.ok?0:nowSeconds+backoff(job.attempts+1),sent.ok?null:'PROVIDER_'+sent.code,job.event_key,job.channel,claim).run();
  if(res.meta.changes)stats[status==='SENT'?'sent':status==='FAILED'?'failed':'retry']++;
 }
 return stats;
}
