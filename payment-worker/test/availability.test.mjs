import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './db.mjs';
import {createOrder} from '../src/orders.mjs';
test('updated availability preserves restricted courses, manual seats and November Wednesdays',async()=>{
 const db=database(true);
 const open=date=>db.sqlite.prepare("SELECT s.*,c.course,c.series FROM slots s JOIN courses c ON c.id=s.course_id WHERE date=? AND status='OPEN' AND NOT EXISTS(SELECT 1 FROM closed_dates WHERE date=s.date)").all(date);
 for(const date of ['2026-10-07','2026-10-23','2026-11-11','2026-11-22','2026-12-28'])assert.equal(open(date).length,0,date);
 for(const [date,name] of [['2026-11-15','Vol. 1｜一日專業調香師'],['2026-11-16','Vol. 2｜調香師的和弦練習曲']]){
  const slots=open(date);assert.ok(slots.length);for(const s of slots){assert.equal(s.course,name);assert.equal(s.capacity,5);assert.equal(s.booked,0);}
 }
 const special=open('2026-10-06');assert.ok(special.length);for(const s of special){assert.equal(s.series,'心村限定｜Helori 香氣探索所');assert.equal(s.time,'13:00–15:00');}
 assert.ok(open('2026-11-04').some(s=>s.time==='16:00–18:00'));
 assert.ok(open('2026-10-28').every(s=>Number(s.time.split('–')[1].slice(0,2))<=14));
 const forbidden=db.sqlite.prepare("SELECT id FROM slots WHERE date='2026-11-15' AND status='CLOSED' LIMIT 1").get();
 await assert.rejects(createOrder(db,'a'.repeat(64),{slotIds:[forbidden.id],name:'測試',phone:'0912345678',email:'test@example.com',line:'test',note:''}),/SLOT_FULL|COURSE_UNAVAILABLE|BAD_REQUEST/);
});
