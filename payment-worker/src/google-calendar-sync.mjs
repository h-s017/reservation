import {categorizeCalendarEvents,classifyCalendarEvent} from './calendar-rules.mjs';
// Google Calendar is a read-only source of busy intervals; no Google writes.
// Keys live in Cloudflare secrets and no calendar titles are exposed publicly.
const encoder=new TextEncoder();
const busyWindow=(ms,horizonUntil=null)=>{
 const date=new Date(ms+28800000).toISOString().slice(0,10);
 const from=Math.floor(Date.parse(date+'T00:00:00+08:00')/1000);
 // At least 120 days, but always cover the actual last published booking slot.
 // Leave two days of margin for all-day and time-buffer crossings.
 const until=Number.isFinite(horizonUntil)?horizonUntil+2*86400:from;
 const to=Math.max(from+120*86400,until);
 if(to-from>370*86400)throw Error('CALENDAR_HORIZON_TOO_LONG');
 return {from,to};
};
const b64url=(bytes)=>btoa(String.fromCharCode(...(typeof bytes==='string'?encoder.encode(bytes):new Uint8Array(bytes)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const dateTime=x=>{
 if(typeof x?.dateTime==='string'){
  if(!/(Z|[+-]\d{2}:\d{2})$/.test(x.dateTime))throw Error('CALENDAR_INVALID_TIMEZONE');
  const a=Date.parse(x.dateTime);if(!Number.isFinite(a))throw Error('CALENDAR_INVALID_TIME');return Math.floor(a/1000);
 }
 if(typeof x?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)){
  const a=Date.parse(x.date+'T00:00:00+08:00');if(!Number.isFinite(a))throw Error('CALENDAR_INVALID_DATE');return Math.floor(a/1000);
 }
 throw Error('CALENDAR_INVALID_TIME');
};
const safeMinutes=x=>{
 const n=x===undefined||x===''?0:Number(x);
 if(!Number.isInteger(n)||n<0||n>240)throw Error('CALENDAR_INVALID_BUFFER');
 return n;
};
export function normalizeEvents(items,{before=0,after=0}={}){
 if(!Array.isArray(items))throw Error('CALENDAR_INVALID_RESPONSE');
 return items.filter(e=>e?.status!=='cancelled'&&e?.transparency!=='transparent'&&e?.eventType!=='workingLocation').map(e=>{
  if(!e.id||typeof e.id!=='string'||e.id.length>1024)throw Error('CALENDAR_INVALID_ID');
  const start=dateTime(e.start)-before*60,end=dateTime(e.end)+after*60;
  if(end<=start||end-start>370*86400+8*3600)throw Error('CALENDAR_INVALID_RANGE');
  return {id:e.id,start,end};
 });
}
export const calendarConfigured=env=>Boolean(env.GCAL_SERVICE_ACCOUNT_JSON&&env.GCAL_BUSY_CALENDAR_ID);
export async function serviceAccountAccessToken(env,{fetchFn=fetch,nowMs=Date.now()}={}){
 if(!calendarConfigured(env))throw Error('CALENDAR_NOT_CONFIGURED');
 let sa;try{sa=JSON.parse(env.GCAL_SERVICE_ACCOUNT_JSON);}catch(_){throw Error('CALENDAR_INVALID_CREDENTIALS');}
 if(!sa.client_email?.endsWith('.gserviceaccount.com')||typeof sa.private_key!=='string')throw Error('CALENDAR_INVALID_CREDENTIALS');
 const str=sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
 let der;try{der=Uint8Array.from(atob(str),c=>c.charCodeAt(0));}catch(_){throw Error('CALENDAR_INVALID_CREDENTIALS');}
 const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const iat=Math.floor(nowMs/1000);
 const claim={iss:sa.client_email,scope:'https://www.googleapis.com/auth/calendar.events.readonly',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3500};
 const unsigned=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+b64url(JSON.stringify(claim));
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(unsigned));
 const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+b64url(signature)});
 const response=await fetchFn('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
 if(!response.ok)throw Error('CALENDAR_TOKEN_FAILED');
 const data=await response.json();
 if(typeof data.access_token!=='string'||!data.access_token)throw Error('CALENDAR_TOKEN_FAILED');
 return data.access_token;
}
export async function fetchCalendarEvents(env,{fetchFn=fetch,tokenFn=serviceAccountAccessToken,nowMs=Date.now(),horizonUntil=null}={}){
 const window=busyWindow(nowMs,horizonUntil),token=await tokenFn(env,{fetchFn,nowMs});
 const items=[];let pageToken='',pages=0;
 do{
  const q=new URLSearchParams({singleEvents:'true',showDeleted:'false',orderBy:'startTime',timeZone:'Asia/Taipei',
   timeMin:new Date(window.from*1000).toISOString(),timeMax:new Date(window.to*1000).toISOString(),
   maxResults:'250',fields:'nextPageToken,items(id,summary,status,transparency,eventType,start(date,dateTime),end(date,dateTime),attendees(self,responseStatus))'});
  if(pageToken)q.set('pageToken',pageToken);
  const url='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(env.GCAL_BUSY_CALENDAR_ID)+'/events?'+q;
  const response=await fetchFn(url,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Error('CALENDAR_EVENTS_FAILED');
  const data=await response.json();
  if(!data||typeof data!=='object'||(data.items!==undefined&&!Array.isArray(data.items)))throw Error('CALENDAR_INVALID_RESPONSE');
  // Google partial responses may omit an empty items[] field entirely.
  items.push(...(data.items||[]));if(items.length>1000)throw Error('CALENDAR_TOO_MANY_EVENTS');
  pageToken=typeof data.nextPageToken==='string'?data.nextPageToken:'';
  if(pageToken&&++pages>=10)throw Error('CALENDAR_PAGINATION_LIMIT');
 }while(pageToken);
 const categorized=env.GCAL_SYNC_MODE==='primary_review'
 ?categorizeCalendarEvents(items)
 :{blocked:items,review:[],ignored:[],counts:{blocked:items.length,review:0,ignored:0}};
 const buffers={before:safeMinutes(env.GCAL_BUFFER_BEFORE_MINUTES),after:safeMinutes(env.GCAL_BUFFER_AFTER_MINUTES)};
 return {window,events:normalizeEvents(categorized.blocked,buffers),
 review:categorized.review.map(x=>({title:String(x.event.summary||'（未命名行程）').slice(0,120),
   start:x.event.start,end:x.event.end,reason:x.reason})),
 counts:categorized.counts,rawItems:items};
}
const sql=(db,q,...args)=>db.prepare(q).bind(...args);
const hashedId=async(calendar,id)=>{
 const digest=await crypto.subtle.digest('SHA-256',encoder.encode(calendar+'\n'+id));
 return 'gcal-'+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
};
// Resolve individual owner choices AFTER a complete Google API response is fetched.
// Only this authenticated Worker uses raw items; private titles are never stored in D1.
async function resolveCalendarDecisions(db,calendar,snapshot,env){
 if(env.GCAL_SYNC_MODE!=='primary_review')return {...snapshot,blockedPreview:[]};
 const stored=(await sql(db,"SELECT event_id,decision FROM calendar_event_decisions").all()).results;
 const overrides=new Map(stored.map(r=>[r.event_id,r.decision]));
 const blocked=[],review=[],ignored=[],blockedPreview=[];
 for(const event of snapshot.rawItems){
  if(typeof event?.id!=='string')throw Error('CALENDAR_INVALID_ID');
  const id=await hashedId(calendar,event.id);
  const base=classifyCalendarEvent(event);
  const override=overrides.get(id);
  // Cancelled, Google "free", working-location and declined events never block.
  // A Google event cannot be forced busy after its owner has declined it.
  const protectedIgnore=['CANCELLED','MARKED_FREE','DECLINED'].includes(base.reason);
  const status=protectedIgnore?base.status:override||base.status;
  const reason=!protectedIgnore&&override?'OWNER_'+override:base.reason;
  const display={id,title:String(event.summary||'（未命名行程）').slice(0,120),
    start:event.start,end:event.end,reason,decision:override||null};
  if(status==='BLOCK'){blocked.push(event);blockedPreview.push(display);}
  else if(status==='REVIEW')review.push(display);
  else ignored.push(display);
 }
 const buffer={before:safeMinutes(env.GCAL_BUFFER_BEFORE_MINUTES),after:safeMinutes(env.GCAL_BUFFER_AFTER_MINUTES)};
 return {...snapshot,events:normalizeEvents(blocked,buffer),
   review,blockedPreview,ignoredPreview:ignored.filter(e=>e.decision==='IGNORE'),counts:{blocked:blocked.length,review:review.length,ignored:ignored.length}};
}
export async function calendarDecision(db,data){
 const eventId=typeof data?.id==='string'?data.id:'';
 const decision=data?.decision;
 if(!/^gcal-[0-9a-f]{64}$/.test(eventId)||!['BLOCK','IGNORE','RESET'].includes(decision))throw Error('BAD_REQUEST');
 const now=Math.floor(Date.now()/1000);
 const write=decision==='RESET'
  ?sql(db,"DELETE FROM calendar_event_decisions WHERE event_id=?",eventId)
  :sql(db,"INSERT INTO calendar_event_decisions(event_id,decision,updated_at) VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET decision=excluded.decision,updated_at=excluded.updated_at",eventId,decision,now);
 await db.batch([write,sql(db,"INSERT INTO admin_audit(action,target,created_at) VALUES('CALENDAR_DECISION',?,?)",decision+':'+eventId,now)]);
 return {id:eventId,decision};
}
export async function applyCalendarSnapshot(db,calendar,snapshot,{nowMs=Date.now(),syncId=crypto.randomUUID()}={}){
 if(!snapshot||!Number.isInteger(snapshot.window?.from)||!Number.isInteger(snapshot.window?.to)||!Array.isArray(snapshot.events)||snapshot.window.to<=snapshot.window.from)throw Error('CALENDAR_INVALID_RESPONSE');
 const stamp=Math.floor(nowMs/1000),seen=new Set(),queries=[];
 for(const e of snapshot.events){
  const id=await hashedId(calendar,e.id);
  if(seen.has(id))throw Error('CALENDAR_DUPLICATE_EVENT');
  seen.add(id);
  queries.push(sql(db,"INSERT INTO busy_intervals(id,source,title,starts_at,ends_at,active,updated_at,last_seen_sync) VALUES(?,'google','Google Calendar 忙碌',?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=1,updated_at=excluded.updated_at,last_seen_sync=excluded.last_seen_sync WHERE busy_intervals.source='google'",id,e.start,e.end,stamp,syncId));
 }
 queries.push(sql(db,"UPDATE busy_intervals SET active=0,updated_at=? WHERE source='google' AND active=1 AND ends_at>? AND starts_at<? AND (last_seen_sync IS NULL OR last_seen_sync<>?)",stamp,snapshot.window.from,snapshot.window.to,syncId));
 // The guard must run as the FIRST statement in this batch; a slower old API response
 // may not reactivate deleted intervals or overwrite a more recent successful snapshot.
 queries.unshift(sql(db,"INSERT INTO calendar_sync_state(id,status,last_attempt_at,last_success_at,event_count,error_code,fetch_started_ms) VALUES('google','OK',?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET status='OK',last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,event_count=excluded.event_count,error_code=NULL,fetch_started_ms=excluded.fetch_started_ms",stamp,stamp,snapshot.events.length,nowMs));
 queries.push(sql(db,"INSERT INTO admin_audit(action,target,created_at) VALUES('CALENDAR_SYNC','busy',?)",stamp));
 await db.batch(queries);
 return {status:'OK',last_success_at:stamp,event_count:snapshot.events.length};
}
// Authenticated, read-only preview: titles are returned ONLY to the manager UI.
// No preview event titles are persisted to D1 or exposed through public /api/slots.
export async function previewCalendar(env,{db=env.DB,fetchFn=fetch,tokenFn=serviceAccountAccessToken,nowMs=Date.now()}={}){
 if(!calendarConfigured(env))return {configured:false,mode:env.GCAL_SYNC_MODE||'dedicated',counts:null,review:[]};
 if(env.GCAL_SYNC_MODE==='primary_review'&&env.GCAL_BUSY_CALENDAR_ID==='primary')throw Error('CALENDAR_USE_EXPLICIT_ID');
 const latest=await sql(db,'SELECT MAX(starts_at) AS latest FROM slots WHERE starts_at>=?',Math.floor(nowMs/1000)).first();
 const raw=await fetchCalendarEvents(env,{fetchFn,tokenFn,nowMs,horizonUntil:latest?.latest??null});
 const snapshot=await resolveCalendarDecisions(db,env.GCAL_BUSY_CALENDAR_ID,raw,env);
 return {configured:true,mode:env.GCAL_SYNC_MODE||'dedicated',counts:snapshot.counts,review:snapshot.review.slice(0,100),
 blocked:snapshot.blockedPreview.slice(0,100),ignored:snapshot.ignoredPreview?.slice(0,100)||[],autoBlocked:snapshot.events.length};
}
export async function calendarConflicts(db){
 const query="SELECT DISTINCT o.id AS order_id,o.status,s.date,s.time FROM busy_intervals b JOIN slots s ON b.active=1 AND b.source='google' AND b.starts_at < s.starts_at+((CAST(substr(s.time,7,2) AS INTEGER)*60+CAST(substr(s.time,10,2) AS INTEGER)-CAST(substr(s.time,1,2) AS INTEGER)*60-CAST(substr(s.time,4,2) AS INTEGER))*60) AND b.ends_at>s.starts_at JOIN order_slots os ON os.slot_id=s.id AND os.active=1 JOIN orders o ON o.id=os.order_id WHERE o.status IN ('PAID','PENDING','FAILED','LINE_CONFIRMATION') ORDER BY s.date,s.time LIMIT 100";
 const rows=await sql(db,query).all();
 return {conflicts:rows.results};
}
export async function calendarStatus(db,env){
 const row=await sql(db,"SELECT status,last_attempt_at,last_success_at,event_count,error_code FROM calendar_sync_state WHERE id='google'").first();
 return {configured:calendarConfigured(env),status:row?.status||'NOT_STARTED',last_attempt_at:row?.last_attempt_at||null,last_success_at:row?.last_success_at||null,event_count:row?.event_count||0,error_code:row?.error_code||null};
}
export async function syncCalendar(env,{db=env.DB,fetchFn=fetch,tokenFn=serviceAccountAccessToken,nowMs=Date.now()}={}){
 if(!calendarConfigured(env))return {configured:false,status:'NOT_CONFIGURED'};
 if(env.GCAL_SYNC_MODE==='primary_review'&&env.GCAL_BUSY_CALENDAR_ID==='primary')return {configured:true,status:'ERROR',error_code:'CALENDAR_USE_EXPLICIT_ID'};
 try{
  // Source-of-truth booking horizon comes from D1, not from a fixed 120-day guess.
  const last=await sql(db,'SELECT MAX(starts_at) AS latest FROM slots WHERE starts_at>=?',Math.floor(nowMs/1000)).first();
  const raw=await fetchCalendarEvents(env,{fetchFn,tokenFn,nowMs,horizonUntil:last?.latest??null});
  const snapshot=await resolveCalendarDecisions(db,env.GCAL_BUSY_CALENDAR_ID,raw,env);
  return {configured:true,...await applyCalendarSnapshot(db,env.GCAL_BUSY_CALENDAR_ID,snapshot,{nowMs}),
   counts:snapshot.counts};
 }catch(error){
  if(String(error?.message||'').includes('CALENDAR_STALE_SNAPSHOT')){
   // A newer snapshot already committed. Do not mark its successful state as an error.
   return {configured:true,status:'SKIPPED',reason:'NEWER_SNAPSHOT_ALREADY_APPLIED'};
  }
  const allowed=new Set(['CALENDAR_INVALID_CREDENTIALS','CALENDAR_TOKEN_FAILED','CALENDAR_EVENTS_FAILED','CALENDAR_INVALID_RESPONSE','CALENDAR_TOO_MANY_EVENTS','CALENDAR_PAGINATION_LIMIT','CALENDAR_INVALID_TIMEZONE','CALENDAR_INVALID_TIME','CALENDAR_INVALID_DATE','CALENDAR_INVALID_ID','CALENDAR_INVALID_RANGE','CALENDAR_INVALID_BUFFER','CALENDAR_DUPLICATE_EVENT','CALENDAR_HORIZON_TOO_LONG']);
  const code=allowed.has(error.message)?error.message:'CALENDAR_SYNC_FAILED';
  try{
   const stored=await sql(db,"INSERT INTO calendar_sync_state(id,status,last_attempt_at,last_success_at,event_count,error_code,fetch_started_ms) VALUES('google','ERROR',?,NULL,0,?,?) ON CONFLICT(id) DO UPDATE SET status='ERROR',last_attempt_at=excluded.last_attempt_at,error_code=excluded.error_code,fetch_started_ms=excluded.fetch_started_ms WHERE calendar_sync_state.fetch_started_ms<excluded.fetch_started_ms",Math.floor(nowMs/1000),code,nowMs).run();
   if(stored.meta?.changes===0)return {configured:true,status:'SKIPPED',reason:'NEWER_SYNC_ALREADY_RECORDED'};
  }catch(_){}
  return {configured:true,status:'ERROR',error_code:code};
 }
}
