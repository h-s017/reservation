import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './db.mjs';
import {normalizeEvents,fetchCalendarEvents,applyCalendarSnapshot,syncCalendar,calendarStatus} from '../src/google-calendar-sync.mjs';
const dt=(date,time)=>date+'T'+time+':00+08:00';
test('recurring instances, all-day and free events normalize in Taiwan time',()=>{
 const events=normalizeEvents([
 {id:'a',start:{dateTime:dt('2099-12-01','09:00')},end:{dateTime:dt('2099-12-01','11:00')}},
 {id:'b',start:{date:'2099-12-02'},end:{date:'2099-12-03'}},
 {id:'c',transparency:'transparent',start:{date:'2099-12-02'},end:{date:'2099-12-03'}},
 {id:'d',status:'cancelled',start:{date:'2099-12-02'},end:{date:'2099-12-03'}},
 {id:'e',eventType:'workingLocation',start:{date:'2099-12-02'},end:{date:'2099-12-03'}}
 ]);
 assert.equal(events.length,2);
 assert.equal(events[0].end-events[0].start,7200);
 assert.equal(events[1].end-events[1].start,86400);
});
test('snapshot never overwrites manually closed sessions and can remove only own overlay',async()=>{
 const db=fixture(),slot=db.sqlite.prepare("SELECT * FROM slots WHERE id='s'").get();
 const snap={window:{from:slot.starts_at-3600,to:slot.starts_at+86400},events:[{id:'one',start:slot.starts_at,end:slot.starts_at+3000}]};
 await applyCalendarSnapshot(db,'calendar@example.com',snap,{nowMs:1000000});
 assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM busy_intervals WHERE active=1 AND source='google'").get().n,1);
 assert.equal((await calendarStatus(db,{GCAL_SERVICE_ACCOUNT_JSON:'test',GCAL_BUSY_CALENDAR_ID:'id'})).status,'OK');
 db.sqlite.prepare("UPDATE slots SET status='CLOSED' WHERE id='s'").run();
 await applyCalendarSnapshot(db,'calendar@example.com',{...snap,events:[]},{nowMs:2000000});
 assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM busy_intervals WHERE active=1 AND source='google'").get().n,0);
 assert.equal(db.sqlite.prepare("SELECT status FROM slots WHERE id='s'").get().status,'CLOSED');
});
test('failed Calendar API read cannot remove already active blocks',async()=>{
 const db=fixture(),slot=db.sqlite.prepare("SELECT * FROM slots WHERE id='s'").get();
 const snap={window:{from:slot.starts_at-3600,to:slot.starts_at+86400},events:[{id:'one',start:slot.starts_at,end:slot.starts_at+3000}]};
 await applyCalendarSnapshot(db,'calendar@example.com',snap,{nowMs:1000000});
 const env={GCAL_SERVICE_ACCOUNT_JSON:'dummy',GCAL_BUSY_CALENDAR_ID:'calendar@example.com'};
 const outcome=await syncCalendar(env,{db,nowMs:3000000,tokenFn:async()=>{throw Error('CALENDAR_TOKEN_FAILED')}});
 assert.equal(outcome.status,'ERROR');
 assert.equal((await calendarStatus(db,env)).last_success_at,1000);
 assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM busy_intervals WHERE active=1 AND source='google'").get().n,1);
});
test('Google Calendar API pagination expands event instances without exposing credentials',async()=>{
 const env={GCAL_SERVICE_ACCOUNT_JSON:'dummy',GCAL_BUSY_CALENDAR_ID:'bookable@example.com'};let count=0;
 const snap=await fetchCalendarEvents(env,{nowMs:4100000000000,tokenFn:async()=> 'private-test-token',fetchFn:async(url,opts)=>{
 assert.ok(String(url).includes('singleEvents=true'));
 assert.equal(opts.headers.Authorization,'Bearer private-test-token');
 count++;
 return {ok:true,json:async()=>count===1?{items:[{id:'first',start:{date:'2099-01-01'},end:{date:'2099-01-02'}}],nextPageToken:'next'}:{items:[{id:'second',start:{date:'2099-01-02'},end:{date:'2099-01-03'}}]}};
 }});
 assert.equal(count,2);assert.equal(snap.events.length,2);
});

test('empty read-only Calendar does not fail and releases stale Google overlays only',async()=>{
 const db=fixture(),slot=db.sqlite.prepare("SELECT * FROM slots WHERE id='s'").get();
 const nowMs=slot.starts_at*1000,env={GCAL_SERVICE_ACCOUNT_JSON:'dummy',GCAL_BUSY_CALENDAR_ID:'bookable@example.com'};
 await applyCalendarSnapshot(db,env.GCAL_BUSY_CALENDAR_ID,{window:{from:slot.starts_at-3600,to:slot.starts_at+86400},events:[{id:'old',start:slot.starts_at,end:slot.starts_at+3600}]},{nowMs:nowMs-10000});
 const outcome=await syncCalendar(env,{db,nowMs,tokenFn:async()=> 'token',fetchFn:async()=>({ok:true,json:async()=>({})})});
 assert.equal(outcome.status,'OK');
 assert.equal((await calendarStatus(db,env)).event_count,0);
 assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM busy_intervals WHERE active=1 AND source='google'").get().n,0);
});
