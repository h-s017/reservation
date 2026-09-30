import test from 'node:test';import assert from 'node:assert/strict';import {createOrder,startCheckout,cancelOrder,notifyOrder,ownedOrder,expireDrafts,adminAction} from '../src/orders.mjs';import worker from '../src/index.mjs';import {fixture,database} from './db.mjs';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const data={slotIds:['s'],name:'測試',phone:'0912345678',email:'test@example.com',line:'test',note:''};const hash='a'.repeat(64);
test('D1 catalogue preserves every website price and extra blocked dates',()=>{
  const db=database(true),html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const courses=vm.runInNewContext(html.match(/const C=([\s\S]*?);\s*let S=/)[0].replace(/;\s*let S=$/,'; C.COURSES'));
  for(const c of courses)assert.equal(db.sqlite.prepare('SELECT price FROM courses WHERE series=? AND course=? AND variant=?').get(c.series,c.course,c.variant||'').price,c.price);
  assert.ok(db.sqlite.prepare("SELECT date FROM closed_dates WHERE date='2026-11-15'").get());
});
test('same token creates one row and server price ignores user amount',async()=>{
  const db=fixture();const [a,b]=await Promise.all([createOrder(db,hash,{...data,amount:1}),createOrder(db,hash,data)]);assert.equal(a.id,b.id);assert.equal(a.amount,6500);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM orders').get().n,1);assert.equal(db.sqlite.prepare('SELECT booked FROM slots WHERE id=?').get('s').booked,1);
});
test('last seat cannot be oversold; multi-slot failure rolls back all seats and order',async()=>{
  const db=fixture(1);const outcomes=await Promise.allSettled([createOrder(db,hash,data),createOrder(db,'b'.repeat(64),data)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  db.sqlite.exec("UPDATE slots SET status='CLOSED' WHERE id='b'");await assert.rejects(createOrder(db,'c'.repeat(64),{...data,slotIds:['a','b']}),/SLOT_FULL/);assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='a'").get().booked,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM orders').get().n,1);
});
test('checkout concurrent clicks share one attempt; failure retry preserves order; notify idempotent',async()=>{
  const db=fixture();const order=await createOrder(db,hash,data);const [a,b]=await Promise.all([startCheckout(db,hash,order.id),startCheckout(db,hash,order.id)]);assert.equal(a.attempt.id,b.attempt.id);
  await assert.rejects(cancelOrder(db,hash,order.id),/PAYMENT_PENDING/);
  await assert.rejects(notifyOrder(db,{merchantOrderNo:a.attempt.id,amount:1,status:'PAID',tradeNo:'t'}),/AMOUNT/);
  await notifyOrder(db,{merchantOrderNo:a.attempt.id,amount:6500,status:'FAILED'});const retry=await startCheckout(db,hash,order.id);assert.equal(retry.id,order.id);assert.notEqual(retry.attempt.id,a.attempt.id);
  const n={merchantOrderNo:retry.attempt.id,amount:6500,status:'PAID',tradeNo:'trade1'};
  await Promise.all([notifyOrder(db,n),notifyOrder(db,n)]);const paid=await ownedOrder(db,hash,order.id);assert.equal(paid.status,'PAID');assert.ok(paid.paid_at);
  await notifyOrder(db,{...n,status:'FAILED'});assert.equal((await ownedOrder(db,hash)).status,'PAID');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM orders').get().n,1);
});
test('cancel and draft expiry release seats; unknown payment attempts never expire',async()=>{
  const db=fixture();const o=await createOrder(db,hash,data);await cancelOrder(db,hash,o.id);assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,0);
  const retry=await startCheckout(db,hash,o.id);assert.equal(retry.status,'PENDING');db.sqlite.exec('UPDATE orders SET hold_until=1');await expireDrafts(db);assert.equal((await ownedOrder(db,hash)).status,'PENDING');
  await createOrder(db,'b'.repeat(64),data);db.sqlite.exec('UPDATE orders SET hold_until=1');await expireDrafts(db);assert.equal((await ownedOrder(db,'b'.repeat(64))).status,'CANCELLED');assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,1);
});
test('server checks required sessions, lead time, closed dates, contest separation and identity',async()=>{
  const db=fixture();await assert.rejects(createOrder(db,hash,{...data,slotIds:['a']}),/BAD_REQUEST/);assert.equal((await createOrder(db,hash,{...data,slotIds:['a','b']})).amount,10500);
  await assert.rejects(ownedOrder(db,'z'.repeat(64)),/NOT_FOUND/);
  await assert.rejects(createOrder(db,'b'.repeat(64),{...data,slotIds:['contest']}),/COURSE_UNAVAILABLE/);
  const contest=await createOrder(db,'b'.repeat(64),{...data,slotIds:['contest'],email:''},true);assert.equal(contest.status,'LINE_CONFIRMATION');await assert.rejects(startCheckout(db,'b'.repeat(64),contest.id),/BAD_REQUEST/);
  db.sqlite.exec("UPDATE slots SET starts_at=unixepoch()+3600 WHERE id='s'");await assert.rejects(createOrder(db,'c'.repeat(64),data),/SLOT_FULL/);
});
test('admin auth protects data; ReturnURL does not change orders; no config means no attempt',async()=>{
  const DB=fixture(),env={DB,SITE_ORIGIN:'https://test.example',PUBLIC_ORIGIN:'https://test.example',ADMIN_TOKEN:'x'.repeat(64)};
  const req=(path,body,token='a'.repeat(64))=>new Request('https://test.example'+path,{method:'POST',headers:{Origin:'https://test.example',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  assert.equal((await worker.fetch(req('/api/admin/orders',{}),env)).status,401);assert.equal((await worker.fetch(req('/api/admin/orders',{},env.ADMIN_TOKEN),env)).status,200);
  const o=await createOrder(DB,hash,data);assert.equal((await worker.fetch(req('/payment/return',{status:'PAID'}),env)).status,303);assert.equal((await ownedOrder(DB,hash)).status,'PENDING');
  assert.equal((await worker.fetch(req('/orders/checkout',{id:o.id}),env)).status,503);assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM payment_attempts').get().n,0);
});
test('admin cannot reduce capacity below held seats; closing a date blocks new bookings',async()=>{
  const db=fixture();await createOrder(db,hash,data);await createOrder(db,'b'.repeat(64),data);await assert.rejects(adminAction(db,'/api/admin/slot',{id:'s',status:'OPEN',capacity:1}),/CAPACITY_CONFLICT/);
  await adminAction(db,'/api/admin/date',{date:'2099-12-01',closed:true});await assert.rejects(createOrder(db,'c'.repeat(64),{...data,slotIds:['a','b']}),/SLOT_FULL/);
});
