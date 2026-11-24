import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {database} from './db.mjs';
import worker from '../src/index.mjs';
import {reconcileEventOrders} from '../src/event-orders.mjs';
import {portaly} from '../src/portaly.mjs';
import {signPortalyCallback} from '../src/vendor/portaly-signature.mjs';
import {attendance} from '../../hana-event/availability.mjs';
import {candidates} from '../../hana-event/catalogue.mjs';

const event = 'heart-village', site = 'https://events.example.test', api = 'https://api.example.test';
const eventTime = '2099-12-06', slot = eventTime+'-10:00';
const adminToken = 'x'.repeat(48), fakeSecret = 'test secret, never installed';
const cart = [{id:'A1',quantity:1},{id:'A2',quantity:1},{id:'C3',quantity:1}];
const booking = (options={}) => ({slot,name:'測試參與者',email:'qa@example.test',lines:cart,...options});
function setup() {
  const DB = database();
  DB.sqlite.exec(readFileSync(new URL('../migrations/0013_hana_event.sql',import.meta.url),'utf8'));
  DB.sqlite.exec(execFileSync(process.execPath,[fileURLToPath(new URL('../../scripts/build-event-seed.mjs',import.meta.url))],{encoding:'utf8'}));
  DB.sqlite.exec("UPDATE event_catalogue SET starts_on='2099-12-01',ends_on='2099-12-31',published=1");
  const env = {DB,EVENT_MODE:'mock',EVENT_SITE_ORIGIN:site,ADMIN_TOKEN:adminToken,PORTALY_CALLBACK_SECRET:fakeSecret};
  function request(action,body,token,extra={}) {
    return worker.fetch(new Request(api+'/api/event/'+action,{method:'POST',headers:{origin:action==='admin'?api:site,
      'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify({event,...body})}),env);
  }
  const admin = (action,body={}) => request('admin',{action,...body},adminToken);
  const manageSlot = (props={}) => admin('slot',{date:eventTime,time:'10:00',teamMask:7,capacity:3,mixes:['A','B','C','AC'],status:'open',...props});
  function webhook(order,kind='completed',overrides={},sentAt=Date.now(),signedWith=fakeSecret) {
    const payment = DB.sqlite.prepare('SELECT * FROM event_payment_attempts WHERE order_id=?').get(order.id);
    const eventName = 'creator_subscription.checkout.'+kind;
    const body = {event:eventName,mode:'mock',sessionId:payment.session_id,planId:payment.plan_id,
      paymentReference:'ref-'+order.id,status:kind,amount:order.amount,currency:'TWD',merchantOrderNumber:order.id,...overrides};
    const timestamp = new Date(sentAt).toISOString();
    return worker.fetch(new Request(api+'/api/event/webhook',{method:'POST',headers:{'content-type':'application/json',
      'x-portaly-event':body.event,'x-portaly-timestamp':timestamp,
      'x-portaly-signature':signPortalyCallback({secret:signedWith,timestamp,payload:body})},body:JSON.stringify(body)}),env);
  }
  return {env,DB,request,admin,manageSlot,webhook};
}
const token = char => char.repeat(64);
const parse = async r=>[r.status,await r.json()];

test('schedule import honors weekdays, qipao, and all partner blocks; unconfirmed slots never go on sale',()=>{
  assert.equal(attendance.length,124);
  const slots = candidates(attendance);
  assert.equal(slots.length,40);
  assert.equal(new Set(slots.map(s=>s.date)).size,10);
  assert.ok(slots.every(s=>s.status==='interest'&&s.capacity===0&&(s.teamMask&1)));
  assert.ok(slots.every(s=>![1,6].includes(new Date(s.date+'T00:00:00Z').getUTCDay())));
  assert.deepEqual(slots.find(s=>s.id==='2026-12-18-10:00').available,['A','B','C']);
  assert.equal(slots.some(s=>s.id==='2026-12-05-10:00'),false);
});

test('mixed tickets produce 6100, reject forged quote, enforce mix, and reserve atomically with idempotency',async()=>{
  const {request,manageSlot,DB} = setup();
  assert.equal((await manageSlot()).status,200);
  assert.equal((await parse(await request('orders',booking({quotedAmount:1}),token('1'))))[1].error,'PRICE_CHANGED');
  assert.equal((await parse(await request('orders',booking({lines:[{id:'A1',quantity:1},{id:'B1',quantity:1}]}),token('2'))))[1].error,'UNAVAILABLE');
  const results = await Promise.all([request('orders',booking({amount:1}),token('a')),request('orders',booking(),token('b'))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner = results.findIndex(r=>r.status===200);
  const access = token(winner===0?'a':'b');
  const {order} = await results[winner].json();
  assert.equal(order.amount,6100);
  assert.equal(order.status,'WAITING_PAYMENT');
  assert.deepEqual(order.lines.map(l=>l.unit_price),[2700,2400,1000]);
  const [retry,changed] = await Promise.all([request('orders',booking(),access),request('orders',booking({name:'Other'}),access)]);
  assert.equal((await retry.json()).order.id,order.id);
  assert.equal((await changed.json()).error,'ORDER_CONFLICT');
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM event_order_items').get().n,3);
  assert.equal((await request('status',{id:order.id},token('3'))).status,404);
  assert.equal((await request('cancel',{id:order.id},access)).status,200);
  assert.equal((await request('orders',booking(),token('c'))).status,200);
});

test('interest never occupies a slot; held promotion requires admin and all teams; overlapping cohorts fail',async()=>{
  const {request,manageSlot,admin} = setup();
  assert.equal((await manageSlot({status:'interest',teamMask:1,mixes:[],capacity:0})).status,200);
  const access = token('a');
  const {order} = await (await request('orders',booking(),access)).json();
  assert.equal(order.status,'INTEREST');
  assert.equal((await request('checkout',{id:order.id},access)).status,409);
  assert.equal((await request('admin',{action:'orders'},access)).status,401);
  assert.equal((await manageSlot({teamMask:3})).status,409);
  assert.equal((await admin('order',{id:order.id,status:'WAITING_PAYMENT',reason:'團隊確認'})).status,409);
  assert.equal((await manageSlot()).status,200);
  assert.equal((await manageSlot({time:'13:00',mixes:['B']})).status,200);
  assert.equal((await parse(await manageSlot({time:'14:00',mixes:['A']})))[1].error,'TIME_CONFLICT');
  assert.equal((await admin('order',{id:order.id,status:'WAITING_PAYMENT',reason:'團隊確認'})).status,200);
  assert.equal((await request('orders',booking(),token('c'))).status,409);
});

test('signed checkout verifies money and mode, ignores browser returns, handles duplicates, confirms and refunds',async()=>{
  const {request,manageSlot,admin,webhook,DB} = setup();
  await manageSlot();
  const access = token('a');
  const {order} = await (await request('orders',booking(),access)).json();
  const paths = await Promise.all([request('checkout',{id:order.id},access),request('checkout',{id:order.id},access)]);
  assert.ok(paths.every(r=>r.status===200));
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM event_payment_attempts').get().n,1);
  assert.equal((await (await request('status',{id:order.id,paid:true},access)).json()).order.status,'PROCESSING');
  assert.equal((await webhook(order,'completed',{amount:1})).status,409);
  assert.equal((await webhook(order,'completed',{mode:'live'})).status,409);
  assert.equal((await webhook(order,'completed',{},Date.now()-301000)).status,401);
  assert.equal((await webhook(order,'completed',{},Date.now(),'forged')).status,401);
  assert.equal((await webhook(order)).status,200);
  assert.equal((await webhook(order)).status,200);
  assert.equal((await admin('order',{id:order.id,status:'CONFIRMED'})).status,200);
  assert.equal((await admin('order',{id:order.id,status:'REFUND_PENDING',reason:'營運測試'})).status,200);
  const session = 'sim_'+order.id;
  const refund = {event:'creator_subscription.payment.refunded',sessionId:undefined,
    subscriptionId:session,orderId:'mock-refund',refundedAmount:6100,orderMerchantOrderNumber:order.id};
  assert.equal((await webhook(order,'completed',refund)).status,200);
  assert.equal((await webhook(order,'completed',refund)).status,200);
  assert.equal((await webhook(order)).status,200);
  assert.equal((await (await request('status',{id:order.id},access)).json()).order.status,'REFUNDED');
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM event_webhook_events').get().n,2);
  assert.equal((await request('orders',booking(),token('c'))).status,200);
});

test('failure releases reserved capacity, provider expiry reconciles, and late payment goes to review',async()=>{
  const {request,manageSlot,webhook,env,DB} = setup();
  await manageSlot();
  const access = token('a'), nextAccess = token('b');
  const {order} = await (await request('orders',booking(),access)).json();
  await request('checkout',{id:order.id},access);
  assert.equal((await request('cancel',{id:order.id},access)).status,409);
  assert.equal((await webhook(order,'failed',{merchantOrderNumber:undefined})).status,200);
  const {order:next} = await (await request('orders',booking(),nextAccess)).json();
  await request('checkout',{id:next.id},nextAccess);
  DB.sqlite.prepare('UPDATE event_payment_attempts SET expires_at=0 WHERE order_id=?').run(next.id);
  await reconcileEventOrders(env);
  assert.equal((await (await request('status',{id:next.id},nextAccess)).json()).order.status,'CANCELLED');
  assert.equal((await webhook(next)).status,200);
  assert.equal(DB.sqlite.prepare('SELECT status FROM event_payment_attempts WHERE order_id=?').get(next.id).status,'REVIEW');
  assert.equal((await request('orders',booking(),token('c'))).status,200);
});

test('Portaly adapter sends only server-recalculated one-time or product bundle totals and rejects live keys',async()=>{
  const calls = [];
  const response = (data)=>Response.json({data});
  const gateway = portaly({PORTALY_API_KEY:'pcs_test_fixture',PORTALY_PHYSICAL_EVENT_APPROVED:'true',PORTALY_EVENT_PLAN_ID:'dynamic-fixture'},async (url,options)=>{
    const body = options.body?JSON.parse(options.body):null;
    calls.push({url,body});
    if (url.includes('/plans?')) return response([{id:'dynamic-fixture',status:'active',billingPeriod:'one-time',pricingType:'dynamic',currency:'TWD'}]);
    if (url.endsWith('checkout-sessions')) return response({checkoutUrl:'https://portaly.ai/checkout/fixture',sessionId:'fixture',
      expiresAt:'2099-12-01T00:00:00.000Z',...(body.items?{totalAmount:body.totalAmount}:{amount:body.amount})});
    return response({isActive:true,currency:'TWD',effectivePrice:550});
  });
  assert.equal((await gateway.eventPlan()).id,'dynamic-fixture');
  await gateway.createPaymentSession({planId:'dynamic-fixture',amount:1},6100);
  assert.equal(calls[1].body.amount,6100);
  await gateway.createProductSession(['prod-1','prod-1','prod-2'],{totalAmount:1});
  assert.deepEqual(calls.at(-1).body,{totalAmount:1650,currency:'TWD',items:[{productId:'prod-1'},{productId:'prod-1'},{productId:'prod-2'}]});
  assert.throws(()=>portaly({PORTALY_API_KEY:'pcs_live_fixture'}),/UNCONFIGURED/);
});
