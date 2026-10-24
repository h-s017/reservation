import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './db.mjs';
import {classifyCalendarEvent,categorizeCalendarEvents} from '../src/calendar-rules.mjs';
import {syncCalendar,previewCalendar,calendarStatus} from '../src/google-calendar-sync.mjs';
import {listSlots} from '../src/orders.mjs';

const timed=(title,start='2099-12-01T09:00:00+08:00',end='2099-12-01T11:00:00+08:00')=>({
 id:'evt-'+title,summary:title,status:'confirmed',transparency:'opaque',
 start:{dateTime:start},end:{dateTime:end}
});
const allDay=(title)=>({id:'day-'+title,summary:title,status:'confirmed',transparency:'opaque',
 start:{date:'2099-12-01'},end:{date:'2099-12-02'}});
test('primary Calendar differentiates regular meetings from existing HANA course reminders',()=>{
 assert.deepEqual(classifyCalendarEvent(timed('合作會議')),{status:'BLOCK',reason:'CONFIRMED_BUSY'});
 assert.deepEqual(classifyCalendarEvent(allDay('氣味藝術序曲 Vol.1｜心村')),{status:'REVIEW',reason:'COURSE_REFERENCE'});
 assert.deepEqual(classifyCalendarEvent(allDay('氣味藝術序曲 Vol.2｜心村')),{status:'REVIEW',reason:'COURSE_REFERENCE'});
 assert.deepEqual(classifyCalendarEvent(allDay('義方國小葡萄園')),{status:'REVIEW',reason:'ALL_DAY_UNCERTAIN'});
 assert.deepEqual(classifyCalendarEvent(allDay('安息日｜Sabbath Rest')),{status:'BLOCK',reason:'ALL_DAY_UNAVAILABLE'});
 assert.deepEqual(classifyCalendarEvent({...timed('閱讀計畫'),transparency:'transparent'}),{status:'IGNORE',reason:'MARKED_FREE'});
 assert.deepEqual(classifyCalendarEvent({...timed('對方邀請'),attendees:[{self:true,responseStatus:'needsAction'}]}),{status:'REVIEW',reason:'UNCONFIRMED_INVITATION'});
 assert.deepEqual(classifyCalendarEvent({...timed('活動'),attendees:[{self:true,responseStatus:'declined'}]}),{status:'IGNORE',reason:'DECLINED'});
 assert.deepEqual(classifyCalendarEvent(timed('[不可預約] 工作')), {status:'BLOCK',reason:'EXPLICIT_BLOCK'});
 assert.deepEqual(classifyCalendarEvent(timed('[可預約] 活動')), {status:'IGNORE',reason:'EXPLICIT_KEEP_OPEN'});
});
test('primary calendar review mode protects course sessions but blocks overlapping real meetings',async()=>{
 const db=fixture(),slot=db.sqlite.prepare("SELECT starts_at FROM slots WHERE id='s'").get();
 // The test DB class starts at this UTC instant. Construct an overlapping
 // meeting in ISO timestamps with a different title from the class.
 const begins=new Date((slot.starts_at+300)*1000).toISOString();
 const ends=new Date((slot.starts_at+2400)*1000).toISOString();
 const googleEvents=[
  {...timed('客戶會議',begins,ends),id:'meeting-test'},
  {...allDay('氣味藝術序曲 Vol.1｜心村'),id:'teaching-test'},
  {...timed('免費活動'),id:'free-test',transparency:'transparent'}
 ];
 const env={DB:db,GCAL_SYNC_MODE:'primary_review',GCAL_SERVICE_ACCOUNT_JSON:'mock',
  GCAL_BUSY_CALENDAR_ID:'owner-calendar@example.test'};
 const options={nowMs:Date.parse('2099-11-01T00:00:00+08:00'),
  tokenFn:async()=> 'mock-token',
  fetchFn:async()=>Response.json({items:googleEvents})};
 const preview=await previewCalendar(env,options);
 assert.deepEqual(preview.counts,{blocked:1,review:1,ignored:1});
 assert.equal(preview.review.length,1);
 assert.match(preview.review[0].title,/氣味藝術序曲/);
 const answer=await syncCalendar(env,options);
 assert.equal(answer.status,'OK');assert.equal(answer.counts.review,1);
 assert.equal((await listSlots(db,'2099-12-01')).find(s=>s.id==='s').status,'關閉');
 assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM busy_intervals WHERE source='google'").get().n,1);
 assert.equal(db.sqlite.prepare("SELECT title FROM busy_intervals WHERE source='google'").get().title,'Google Calendar 忙碌');
 assert.equal((await calendarStatus(db,env)).status,'OK');
});
test('course-only primary calendar leaves the published class available for booking',async()=>{
 const db=fixture();
 const env={DB:db,GCAL_SYNC_MODE:'primary_review',GCAL_SERVICE_ACCOUNT_JSON:'mock',
  GCAL_BUSY_CALENDAR_ID:'owner-calendar@example.test'};
 const outcome=await syncCalendar(env,{nowMs:Date.parse('2099-11-01T00:00:00+08:00'),
  tokenFn:async()=> 'token',
  fetchFn:async()=>Response.json({items:[allDay('氣味藝術序曲 Vol.1｜心村')]})});
 assert.equal(outcome.status,'OK');
 assert.equal(outcome.counts.review,1);
 assert.equal((await listSlots(db,'2099-12-01')).find(s=>s.id==='s').status,'開放');
});
test('service account cannot silently read its own primary calendar instead of owner calendar',async()=>{
 const env={DB:fixture(),GCAL_SYNC_MODE:'primary_review',GCAL_SERVICE_ACCOUNT_JSON:'mock',GCAL_BUSY_CALENDAR_ID:'primary'};
 const result=await syncCalendar(env);
 assert.equal(result.error_code,'CALENDAR_USE_EXPLICIT_ID');
});
