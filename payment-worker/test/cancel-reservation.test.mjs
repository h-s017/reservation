import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './db.mjs';
import {createOrder,startCheckout,notifyOrder,adminAction,ownedOrder,publicOrder} from '../src/orders.mjs';
const data={slotIds:['s'],name:'測試',phone:'0912345678',email:'test@example.com'};
const cancel=(db,id)=>adminAction(db,'/api/admin/cancel-reservation',{id,confirmed:true,reason:'使用者要求取消預約'});
test('cancel releases all reserved seats once, preserves unresolved payment, and blocks retry',async()=>{
 const db=fixture(5),hash='a'.repeat(64),order=await createOrder(db,hash,{...data,quantity:2,slotIds:['a','b']});
 const before=await startCheckout(db,hash,order.id);
 await cancel(db,order.id);await cancel(db,order.id);
 const after=await ownedOrder(db,hash,order.id);
 assert.equal(after.status,'PENDING');assert.deepEqual(after.attempt,before.attempt);
 assert.equal(publicOrder(after).status,'CANCELLED');assert.equal(publicOrder(after).payment_status,'PENDING');
 const listed=(await adminAction(db,'/api/admin/orders',{})).orders.find(o=>o.id===order.id);assert.equal(listed.status,'CANCELLED');assert.equal(listed.payment_status,'PENDING');
 assert.equal(db.sqlite.prepare('SELECT SUM(booked) n FROM slots').get().n,0);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='CANCEL_RESERVATION'").get().n,1);
 await assert.rejects(startCheckout(db,hash,order.id),/ORDER_STATE_CONFLICT/);
 assert.throws(()=>db.sqlite.prepare('UPDATE order_slots SET active=1 WHERE order_id=?').run(order.id),/COURSE_UNAVAILABLE/);
});
test('paid booking cancels without claiming a refund or changing provider history',async()=>{
 const db=fixture(),hash='a'.repeat(64),order=await createOrder(db,hash,data),a=await startCheckout(db,hash,order.id);
 await notifyOrder(db,{merchantOrderNo:a.attempt.id,amount:6500,status:'PAID',tradeNo:'paid-before-cancel'});
 const before=await ownedOrder(db,hash,order.id);
 await cancel(db,order.id);const after=await ownedOrder(db,hash,order.id);
 assert.equal(after.status,'PAID');assert.equal(after.amount,before.amount);assert.equal(after.paid_at,before.paid_at);assert.deepEqual(after.attempt,before.attempt);
 assert.equal(after.cancellation_status,'REFUND_PENDING');assert.equal(after.refunded_at,null);
 assert.equal(publicOrder(after).status,'CANCELLED');assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,0);
});
test('late genuine payment is recorded for refund review without reopening a cancelled reservation',async()=>{
 const db=fixture(),hash='a'.repeat(64),order=await createOrder(db,hash,data),a=await startCheckout(db,hash,order.id);
 await cancel(db,order.id);
 const n={merchantOrderNo:a.attempt.id,amount:6500,status:'PAID',tradeNo:'late-paid-after-cancel'};
 await notifyOrder(db,n);await notifyOrder(db,n);
 const after=await ownedOrder(db,hash,order.id);
 assert.equal(after.status,'PAID');assert.equal(after.cancellation_status,'REFUND_PENDING');assert.equal(after.refunded_at,null);
 assert.equal(publicOrder(after).status,'CANCELLED');assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,0);
});
