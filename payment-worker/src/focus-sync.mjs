// Dedicated server-to-server route. Never expose payment/order records or accept an admin route.
import {sql} from './orders.mjs';
const fail=code=>{throw Error(code);};
const fields=['date','time','status','capacity','booked','enabled','blocked'];
export async function syncSlot(db,id){
 return sql(db,`SELECT s.id,s.date,s.time,s.status,s.capacity,s.booked,c.enabled,c.course,c.variant,
 CASE WHEN d.date IS NULL THEN 0 ELSE 1 END AS blocked
 FROM slots s JOIN courses c ON c.id=s.course_id LEFT JOIN closed_dates d ON d.date=s.date WHERE s.id=?`,id).first();
}
export async function focusSyncAction(db,body){
 if(body.action==='snapshot'){
  if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(body.month||''))fail('BAD_REQUEST');
  const from=body.month+'-01',until=new Date(Date.UTC(+body.month.slice(0,4),+body.month.slice(5,7),1)).toISOString().slice(0,10);
  const rows=await sql(db,`SELECT s.id,s.date,s.time,s.status,s.capacity,s.booked,c.enabled,c.course,c.variant,
   CASE WHEN d.date IS NULL THEN 0 ELSE 1 END AS blocked
   FROM slots s JOIN courses c ON c.id=s.course_id LEFT JOIN closed_dates d ON d.date=s.date
   WHERE s.date>=? AND s.date<? ORDER BY s.id LIMIT 5001`,from,until).all();
  if(rows.results.length>5000)fail('SYNC_INCOMPLETE');
  return {slots:rows.results};
 }
 if(body.action==='get'&&typeof body.id==='string'&&body.id.length<=140)return {slot:await syncSlot(db,body.id)};
 if(body.action!=='apply'||typeof body.id!=='string'||body.id.length>140||!body.expected||!body.patch||Object.keys(body.patch).some(k=>!['date','time','status'].includes(k)))fail('BAD_REQUEST');
 const old=await syncSlot(db,body.id);if(!old)fail('SYNC_SOURCE_CHANGED');
 if(fields.some(k=>old[k]!==body.expected[k]))fail('SYNC_SOURCE_CHANGED');
 if(old.booked>0&&(body.approved!==true||!/^[0-9a-f-]{36}$/i.test(body.review_id||'')))fail('ENROLLED_REVIEW_REQUIRED');
 const next={...old,...body.patch},time=/^([01]\d|2[0-3]):([0-5]\d)[–-]([01]\d|2[0-3]):([0-5]\d)$/.exec(next.time||'');
 if(!/^20\d\d-\d\d-\d\d$/.test(next.date||'')||!time||!['OPEN','CLOSED'].includes(next.status))fail('BAD_REQUEST');
 const start=Date.parse(next.date+'T'+time[1]+':'+time[2]+':00+08:00'),end=Date.parse(next.date+'T'+time[3]+':'+time[4]+':00+08:00');
 if(!Number.isFinite(start)||end<=start||new Date(start+28800000).toISOString().slice(0,10)!==next.date)fail('BAD_REQUEST');
 // Calendar cancellation closes intake; it never cancels, refunds or deletes an enrolled order.
 if((next.date!==old.date||next.time!==old.time)&&start<Date.now()+129600000)fail('SYNC_TOO_SOON');
 if(next.status==='OPEN'&&(!old.enabled||old.blocked||await sql(db,'SELECT date FROM closed_dates WHERE date=?',next.date).first()))fail('SYNC_DATE_BLOCKED');
 const result=await db.batch([
  sql(db,`UPDATE slots SET date=?,time=?,starts_at=?,status=? WHERE id=? AND date=? AND time=? AND status=? AND capacity=? AND booked=?
   AND EXISTS(SELECT 1 FROM courses c WHERE c.id=slots.course_id AND c.enabled=?)
   AND (CASE WHEN EXISTS(SELECT 1 FROM closed_dates d WHERE d.date=slots.date) THEN 1 ELSE 0 END)=?
   AND (?='CLOSED' OR NOT EXISTS(SELECT 1 FROM closed_dates d WHERE d.date=?))
   AND NOT EXISTS(SELECT 1 FROM slots other WHERE other.id<>slots.id AND other.course_id=slots.course_id AND other.date=? AND other.time=?)`,next.date,next.time,Math.floor(start/1000),next.status,old.id,old.date,old.time,old.status,old.capacity,old.booked,old.enabled,old.blocked,next.status,next.date,next.date,next.time),
  sql(db,`INSERT INTO admin_audit(action,target,created_at) SELECT ?,?,unixepoch() WHERE changes()=1`,body.approved?'FOCUS_CALENDAR_REVIEWED':'FOCUS_CALENDAR_SYNC',old.id)
 ]);
 if(result[0].meta.changes!==1)fail('SYNC_SOURCE_CHANGED');
 return {slot:await syncSlot(db,old.id),orders_changed:false};
}
