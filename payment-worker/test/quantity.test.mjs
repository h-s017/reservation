import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './db.mjs';
import {createOrder,cancelOrder,startCheckout,notifyOrder,adminAction,expireDrafts} from '../src/orders.mjs';
const data={slotIds:['s'],name:'代表',phone:'0912345678',email:'test@example.com',line:'test'};
test('quantity rejects malformed values, trusts server unit price and preserves idempotency',async()=>{
 const db=fixture(10);
 for(const quantity of [0,-1,1.5,'2',null,101])await assert.rejects(createOrder(db,'a'.repeat(64),{...data,quantity}),/BAD_REQUEST/);
 const o=await createOrder(db,'a'.repeat(64),{...data,quantity:3,amount:1,unit_price:1});assert.equal(o.amount,19500);assert.equal(o.unit_price,6500);assert.equal(o.quantity,3);
 const same=await createOrder(db,'a'.repeat(64),{...data,quantity:5});assert.equal(same.id,o.id);assert.equal(same.quantity,3);
 assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,3);
 await assert.rejects(createOrder(db,'c'.repeat(64),{...data,slotIds:['contest'],quantity:2},true),/BAD_REQUEST/);
});
test('competing group bookings cannot oversell and incomplete multi-session reservations roll back',async()=>{
 const db=fixture(3),results=await Promise.allSettled(['a','b'].map(k=>createOrder(db,k.repeat(64),{...data,quantity:2})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 db.sqlite.exec("UPDATE slots SET capacity=1 WHERE id='b'");
 await assert.rejects(createOrder(db,'c'.repeat(64),{...data,slotIds:['a','b'],quantity:2}),/SLOT_FULL/);
 assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='a'").get().booked,0);
});
test('double courses count groups, cancellation and expiry release full quantity',async()=>{
 const db=fixture(5);db.sqlite.exec("UPDATE courses SET unit='組',price=1980 WHERE id='c'");
 const o=await createOrder(db,'a'.repeat(64),{...data,quantity:2});assert.equal(o.amount,3960);assert.equal(o.booking_unit,'組');
 await cancelOrder(db,'a'.repeat(64),o.id);assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,0);
 const retry=await startCheckout(db,'a'.repeat(64),o.id);assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,2);
 await notifyOrder(db,{merchantOrderNo:retry.attempt.id,amount:3960,status:'PAID',tradeNo:'group-paid'});
 await adminAction(db,'/api/admin/refund-request',{id:o.id,reason:'取消'});
 const confirm={id:o.id,amount:3960,reference:'record',confirmed:true};await adminAction(db,'/api/admin/refund-confirm',confirm);await adminAction(db,'/api/admin/refund-confirm',confirm);
 assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,0);
 await createOrder(db,'b'.repeat(64),{...data,slotIds:['a','b'],quantity:3});db.sqlite.exec("UPDATE orders SET hold_until=1 WHERE status='PENDING'");await expireDrafts(db);
 assert.equal(db.sqlite.prepare("SELECT sum(booked) n FROM slots").get().n,0);
});
