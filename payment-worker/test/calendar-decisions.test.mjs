import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './db.mjs';
import {previewCalendar,syncCalendar,calendarDecision} from '../src/google-calendar-sync.mjs';
import {listSlots} from '../src/orders.mjs';

const makeEvent=(title,start,end)=>({id:'owner-event',summary:title,status:'confirmed',transparency:'opaque',
 start:{dateTime:new Date(start*1000).toISOString()},end:{dateTime:new Date(end*1000).toISOString()}});
const setup=()=>{
 const db=fixture(),slot=db.sqlite.prepare("SELECT starts_at FROM slots WHERE id='s'").get();
 const env={DB:db,GCAL_SYNC_MODE:'primary_review',GCAL_SERVICE_ACCOUNT_JSON:'synthetic',GCAL_BUSY_CALENDAR_ID:'owner@example.test'};
 const options={nowMs:Date.parse('2099-11-15T00:00:00+08:00'),tokenFn:async()=> 'synthetic',
  fetchFn:async()=>Response.json({items:[makeEvent('氣味藝術序曲 Vol.1',slot.starts_at,slot.starts_at+3600)]})};
 return {db,env,options};
};
test('owner can explicitly block ambiguous class reference using private hashed identifier',async()=>{
 const {db,env,options}=setup();
 const initial=await previewCalendar(env,options);
 assert.equal(initial.counts.review,1);
 assert.equal(initial.counts.blocked,0);
 assert.match(initial.review[0].id,/^gcal-[0-9a-f]{64}$/);
 assert.equal(JSON.stringify(initial).includes('owner@example.test'),false);
 const saved=await calendarDecision(db,{id:initial.review[0].id,decision:'BLOCK'});
 assert.equal(saved.decision,'BLOCK');
 const preview=await previewCalendar(env,options);
 assert.equal(preview.counts.blocked,1);
 assert.equal(preview.counts.review,0);
 assert.equal(preview.blocked[0].reason,'OWNER_BLOCK');
 await syncCalendar(env,options);
 assert.equal((await listSlots(db,'2099-12-01')).find(s=>s.id==='s').status,'關閉');
 // No event title or guest details are written to the private D1 override table.
 const record=db.sqlite.prepare('SELECT * FROM calendar_event_decisions').get();
 assert.equal(JSON.stringify(record).includes('氣味藝術'),false);
});
test('owner ignore and reset safely restore original computed rule',async()=>{
 const {db,env,options}=setup();
 const id=(await previewCalendar(env,options)).review[0].id;
 await calendarDecision(db,{id,decision:'IGNORE'});
 let preview=await previewCalendar(env,options);
 assert.equal(preview.counts.ignored,1);
 assert.equal(preview.counts.review,0);
 await syncCalendar(env,options);
 assert.equal((await listSlots(db,'2099-12-01')).find(s=>s.id==='s').status,'開放');
 await calendarDecision(db,{id,decision:'RESET'});
 preview=await previewCalendar(env,options);
 assert.equal(preview.counts.review,1);
 assert.equal(preview.counts.ignored,0);
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM calendar_event_decisions').get().n,0);
});
test('untrusted overrides or malformed ids are rejected before D1 changes',async()=>{
 const {db}=setup();
 await assert.rejects(calendarDecision(db,{id:'owner-event',decision:'BLOCK'}),/BAD_REQUEST/);
 await assert.rejects(calendarDecision(db,{id:'gcal-'+'0'.repeat(64),decision:'DELETE_ALL'}),/BAD_REQUEST/);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM calendar_event_decisions').get().n,0);
});
