import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './db.mjs';import {focusSyncAction,syncSlot} from '../src/focus-sync.mjs';import worker from '../src/index.mjs';
const review_id='10000000-0000-4000-8000-000000000001';
test('enrolled slots cannot be moved or closed without a reviewed command; no orders or payments are modified',async()=>{
 const db=fixture();db.sqlite.exec("UPDATE slots SET booked=1 WHERE id='s'");const expected=await syncSlot(db,'s');
 await assert.rejects(focusSyncAction(db,{action:'apply',id:'s',expected,patch:{date:'2099-12-02'}}),/ENROLLED_REVIEW_REQUIRED/);
 assert.equal((await syncSlot(db,'s')).date,'2099-12-01');
 const r=await focusSyncAction(db,{action:'apply',id:'s',expected,patch:{date:'2099-12-02'},approved:true,review_id});assert.equal(r.slot.date,'2099-12-02');assert.equal(r.slot.booked,1);assert.equal(r.orders_changed,false);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM orders').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM payment_attempts').get().n,0);
});
test('new enrolment after the warning invalidates the prior snapshot and approval',async()=>{
 const db=fixture(),expected=await syncSlot(db,'s');db.sqlite.exec("UPDATE slots SET booked=1 WHERE id='s'");
 await assert.rejects(focusSyncAction(db,{action:'apply',id:'s',expected,patch:{status:'CLOSED'},approved:true,review_id}),/SYNC_SOURCE_CHANGED/);assert.equal((await syncSlot(db,'s')).status,'OPEN');
});
test('unbooked slot sync is atomic, validates ranges, respects closed dates, and does not double-apply stale commands',async()=>{
 const db=fixture(),expected=await syncSlot(db,'s');
 await assert.rejects(focusSyncAction(db,{action:'apply',id:'s',expected,patch:{time:'10:00–09:00'}}),/BAD_REQUEST/);
 db.sqlite.exec("INSERT INTO closed_dates VALUES('2099-12-02','fixture')");
 await assert.rejects(focusSyncAction(db,{action:'apply',id:'s',expected,patch:{date:'2099-12-02'}}),/SYNC_DATE_BLOCKED/);
 await focusSyncAction(db,{action:'apply',id:'s',expected,patch:{time:'10:00–12:00'}});
 await assert.rejects(focusSyncAction(db,{action:'apply',id:'s',expected,patch:{status:'CLOSED'}}),/SYNC_SOURCE_CHANGED/);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM admin_audit').get().n,1);
});
test('booking created between SELECT and UPDATE is caught by the database predicate',async()=>{
 const db=fixture(),expected=await syncSlot(db,'s'),batch=db.batch;db.batch=async stmts=>{db.sqlite.exec("UPDATE slots SET booked=1 WHERE id='s'");return batch(stmts);};
 await assert.rejects(focusSyncAction(db,{action:'apply',id:'s',expected,patch:{status:'CLOSED'}}),/SYNC_SOURCE_CHANGED/);
 assert.equal((await syncSlot(db,'s')).status,'OPEN');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM admin_audit').get().n,0);
});
test('a calendar move cannot create a duplicate course session at the destination',async()=>{
 const db=fixture(),expected=await syncSlot(db,'s');db.sqlite.exec("INSERT INTO slots(id,course_id,date,time,starts_at,capacity) VALUES('duplicate','c','2099-12-02','09:00–11:00',4100000000,2)");
 await assert.rejects(focusSyncAction(db,{action:'apply',id:'s',expected,patch:{date:'2099-12-02'}}),/SYNC_SOURCE_CHANGED/);assert.equal((await syncSlot(db,'s')).date,'2099-12-01');
});
test('dedicated endpoint is disabled without its own secret; ADMIN_TOKEN does not authorize it',async()=>{
 const req=()=>new Request('https://fixture.invalid/api/focus/calendar-sync',{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(32)},body:'{"action":"snapshot","month":"2099-12"}'});
 assert.equal((await worker.fetch(req(),{ADMIN_TOKEN:'x'.repeat(32)})).status,401);
 const result=await worker.fetch(req(),{FOCUS_SYNC_TOKEN:'x'.repeat(32),DB:fixture()});assert.equal(result.status,200);const d=await result.json();assert.equal(d.slots.length,4);assert.equal(d.orders,undefined);
});
