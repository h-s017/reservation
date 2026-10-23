import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './db.mjs';
import {listSlots,createOrder,startCheckout} from '../src/orders.mjs';
import {busyAdmin} from '../src/availability.mjs';
const iso=n=>new Date(n*1000).toISOString();
test('busy interval blocks overlapping slots without mutating manual slot status',async()=>{
  const db=fixture(),slot=db.sqlite.prepare("SELECT * FROM slots WHERE id='s'").get();
  const b=await busyAdmin(db,'/api/admin/busy-upsert',{title:'Private event',start:iso(slot.starts_at+300),end:iso(slot.starts_at+3600)});
  let row=(await listSlots(db,'2099-01-01')).find(s=>s.id==='s');
  assert.equal(row.status,'關閉');
  assert.equal(db.sqlite.prepare("SELECT status FROM slots WHERE id='s'").get().status,'OPEN');
  await assert.rejects(createOrder(db,'a'.repeat(64),{slotIds:['s'],name:'測試',phone:'0912345678',email:'demo@example.com'}),/BUSY_CONFLICT/);
  await busyAdmin(db,'/api/admin/busy-delete',{id:b.id});
  row=(await listSlots(db,'2099-01-01')).find(s=>s.id==='s');
  assert.equal(row.status,'開放');
});
test('adjacent busy period does not block; manual closure survives removal',async()=>{
 const db=fixture(),slot=db.sqlite.prepare("SELECT * FROM slots WHERE id='s'").get();
 const b=await busyAdmin(db,'/api/admin/busy-upsert',{title:'Next appointment',start:iso(slot.starts_at+7200),end:iso(slot.starts_at+10800)});
 assert.equal((await listSlots(db,'2099-01-01')).find(s=>s.id==='s').status,'開放');
 db.sqlite.prepare("UPDATE slots SET status='CLOSED' WHERE id='s'").run();
 await busyAdmin(db,'/api/admin/busy-delete',{id:b.id});
 assert.equal((await listSlots(db,'2099-01-01')).find(s=>s.id==='s').status,'關閉');
});
test('existing order is not cancelled when an event collides; checkout is paused',async()=>{
 const db=fixture(),slot=db.sqlite.prepare("SELECT * FROM slots WHERE id='s'").get();
 const o=await createOrder(db,'b'.repeat(64),{slotIds:['s'],name:'測試',phone:'0912345678',email:'demo@example.com'});
 const r=await busyAdmin(db,'/api/admin/busy-upsert',{title:'Unexpected appointment',start:iso(slot.starts_at+1),end:iso(slot.starts_at+300)});
 assert.equal(r.conflicts.some(c=>c.order_id===o.id),true);
 assert.equal(db.sqlite.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status,'PENDING');
 assert.equal(db.sqlite.prepare('SELECT active FROM order_slots WHERE order_id=?').get(o.id).active,1);
 await assert.rejects(startCheckout(db,'b'.repeat(64),o.id),/BUSY_CONFLICT/);
});
test('input validation rejects invalid intervals and unauthorized ids',async()=>{
 const db=fixture();
 await assert.rejects(busyAdmin(db,'/api/admin/busy-upsert',{title:'Bad',start:'2026-10-30',end:'2026-10-31'}),/BAD_REQUEST/);
 await assert.rejects(busyAdmin(db,'/api/admin/busy-upsert',{title:'Bad',start:'2026-10-30T11:00:00+08:00',end:'2026-10-30T10:00:00+08:00'}),/BAD_REQUEST/);
 await assert.rejects(busyAdmin(db,'/api/admin/busy-delete',{id:'unknown'}),/BAD_REQUEST/);
});
