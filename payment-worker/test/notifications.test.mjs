import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './db.mjs';
import {createOrder,startCheckout,notifyOrder,cancelOrder,adminAction} from '../src/orders.mjs';
import {notificationStatus,processNotifications} from '../src/notifications.mjs';
const notifyEnv=DB=>({DB,NOTIFICATIONS_ENABLED:'true',LINE_CHANNEL_ACCESS_TOKEN:'mock-private-token',LINE_NOTIFY_USER_ID:'UsyntheticOwner',RESEND_API_KEY:'re_mock',NOTIFY_EMAIL_TO:'owner@example.test',NOTIFY_EMAIL_FROM:'HANA <alerts@example.test>'});
const input={slotIds:['s'],name:'測試',phone:'0912345678',email:'student@example.test'};
const sentRecords=[];
const mockSend=async(url,request)=>{
 const body=JSON.parse(request.body);
 sentRecords.push({url,request,body});
 if(url.includes('line.me'))return new Response('{}',{status:200,headers:{'x-line-request-id':'example'}});
 if(url.includes('resend.com'))return Response.json({id:'test-email-1'});
 throw Error('Unexpected provider '+url);
};
const count=(db,kind)=>db.sqlite.prepare('SELECT count(*) AS n FROM notification_events WHERE kind=?').get(kind).n;
test('new registration queues both channels transactionally and sends without customer PII',async()=>{
 sentRecords.length=0;
 const DB=fixture(),e=notifyEnv(DB);
 const o=await createOrder(DB,'1'.repeat(64),input);
 assert.equal(count(DB,'BOOKING_NEW'),1);
 let rows=DB.sqlite.prepare('SELECT channel,status FROM notification_deliveries').all();
 assert.deepEqual(rows.map(x=>x.channel).sort(),['email','line']);
 assert.equal((await notificationStatus(DB,e)).enabled,true);
 const output=await processNotifications(e,{fetchFn:mockSend});
 assert.equal(output.sent,2);
 assert.equal(sentRecords.length,2);
 for(const item of sentRecords){
  const text=item.url.includes('line.me')?item.body.messages[0].text:item.body.text;
  assert.match(text,/待付款/);
  assert.equal(text.includes('student@example.test'),false);
  assert.equal(text.includes('0912345678'),false);
  assert.equal(text.includes('測試'),false);
 }
 assert.equal((await processNotifications(e,{fetchFn:mockSend})).sent,0);
 assert.equal(sentRecords.length,2);
 assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM notification_deliveries WHERE status='SENT'").get().n,2);
 assert.equal(o.status,'PENDING');
});
test('verified payment callback produces one paid notice even if gateway retries',async()=>{
 const DB=fixture(),o=await createOrder(DB,'2'.repeat(64),input);
 const a=await startCheckout(DB,'2'.repeat(64),o.id);
 const n={merchantOrderNo:a.attempt.id,amount:o.amount,status:'PAID',tradeNo:'mock-verified-trade'};
 await notifyOrder(DB,n);await notifyOrder(DB,n);
 assert.equal(count(DB,'PAYMENT_PAID'),1);
 assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM notification_deliveries WHERE event_key LIKE '%:paid'").get().n,2);
 assert.equal(DB.sqlite.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status,'PAID');
 const first=await processNotifications(notifyEnv(DB),{fetchFn:mockSend});
 assert.equal(first.sent,4);
});
test('cancellation, paid refund request and completed refund each generate distinct alerts',async()=>{
 const DB=fixture();
 const pending=await createOrder(DB,'3'.repeat(64),input);
 await cancelOrder(DB,'3'.repeat(64),pending.id);
 assert.equal(count(DB,'BOOKING_CANCELLED'),1);
 const paid=await createOrder(DB,'4'.repeat(64),input);
 const a=await startCheckout(DB,'4'.repeat(64),paid.id);
 await notifyOrder(DB,{merchantOrderNo:a.attempt.id,amount:paid.amount,status:'PAID',tradeNo:'mock-refund-verified'});
 await adminAction(DB,'/api/admin/refund-request',{id:paid.id,reason:'student requested'});
 await adminAction(DB,'/api/admin/refund-confirm',{id:paid.id,confirmed:true,reference:'test-refund',amount:paid.amount});
 assert.equal(count(DB,'REFUND_REQUESTED'),1);
 assert.equal(count(DB,'REFUND_COMPLETED'),1);
 assert.equal(DB.sqlite.prepare('SELECT status FROM orders WHERE id=?').get(paid.id).status,'PAID');
});
test('failed gateway attempt and sanitized repeated gateway errors generate anomaly notices',async()=>{
 const DB=fixture(),o=await createOrder(DB,'5'.repeat(64),input),a=await startCheckout(DB,'5'.repeat(64),o.id);
 await notifyOrder(DB,{merchantOrderNo:a.attempt.id,amount:o.amount,status:'FAILED'});
 assert.equal(count(DB,'PAYMENT_FAILED'),1);
 for(let i=0;i<2;i++)DB.sqlite.prepare("INSERT INTO admin_audit(action,target,created_at) VALUES('NOTIFY_REJECTED','VERIFY:INVALID_NOTIFICATION',unixepoch())").run();
 assert.equal(count(DB,'ANOMALY'),1);
});
test('one provider failure retries independently without duplicate successful email',async()=>{
 const DB=fixture();await createOrder(DB,'6'.repeat(64),input);
 const env=notifyEnv(DB),requests=[];
 const fetchFn=async(url,req)=>{
  requests.push({url,req});
  if(url.includes('line.me')&&requests.filter(x=>x.url.includes('line.me')).length===1)throw Error('network timeout');
  return url.includes('line.me')?new Response('{}',{status:200}):Response.json({id:'email'});
 };
 const base=1900000000;
 const first=await processNotifications(env,{fetchFn,nowSeconds:base});
 assert.equal(first.sent,1);assert.equal(first.retry,1);
 const second=await processNotifications(env,{fetchFn,nowSeconds:base+120});
 assert.equal(second.sent,1);
 assert.equal(requests.filter(x=>x.url.includes('resend.com')).length,1);
 const line=requests.filter(x=>x.url.includes('line.me'));
 assert.equal(line.length,2);
 assert.equal(line[0].req.headers['X-Line-Retry-Key'],line[1].req.headers['X-Line-Retry-Key']);
 assert.equal(line[0].req.body,line[1].req.body);
});
test('disabled or unconfigured delivery does not send or change order and can be enabled later',async()=>{
 const DB=fixture();const o=await createOrder(DB,'7'.repeat(64),input);
 const env={...notifyEnv(DB),NOTIFICATIONS_ENABLED:'false'};
 const result=await processNotifications(env,{fetchFn:()=>{throw Error('SHOULD_NOT_FETCH')}});
 assert.equal(result.enabled,false);
 assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM notification_deliveries WHERE status='PENDING'").get().n,2);
 assert.equal(DB.sqlite.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status,'PENDING');
});
