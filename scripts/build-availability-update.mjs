// Explicit, incremental migration from the original seed; never rewrites orders.
import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
const root=new URL('../',import.meta.url), read=p=>readFileSync(new URL(p,root),'utf8');
const ctx=vm.createContext({});vm.runInContext(read('index.html').match(/<script>([\s\S]*?)<\/script>/)[1],ctx);
const c=JSON.parse(vm.runInContext('JSON.stringify(C)',ctx)),rules=JSON.parse(read('payment-worker/catalogue-rules.json'));
const db=new DatabaseSync(':memory:');db.exec(read('payment-worker/migrations/0001_courses.sql'));db.exec(read('payment-worker/migrations/0002_catalogue.sql'));
const q=v=>typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const lines=['-- Preserve existing orders and prices; apply main branch October–December availability.'];
const blocked=new Set([...c.CLOSED_DATES,...rules.blockedDates]);
for(const date of blocked)lines.push(`INSERT INTO closed_dates(date,reason) VALUES(${q(date)},'既有禁約日期') ON CONFLICT(date) DO NOTHING;`);
lines.push("DELETE FROM closed_dates WHERE date='2026-11-15' AND reason='既有禁約日期';");
const desired=new Map();
for(const [i,course] of c.COURSES.entries())for(let d=new Date('2026-10-01T00:00:00Z');d<=new Date(c.END+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){
 const ds=d.toISOString().slice(0,10),dow=d.getUTCDay();
 if(blocked.has(ds)||c.CLOSED.includes(dow)||!c.W.includes(dow)||(course.startDate&&ds<course.startDate)||(course.endDate&&ds>course.endDate)||!vm.runInContext(`courseAllowedOnDate(${JSON.stringify(course)},${q(ds)})`,ctx))continue;
 const times=vm.runInContext(`timesFor(${JSON.stringify(course)},${q(ds)},${dow})`,ctx);
 times.forEach((time,j)=>{
  const id=vm.runInContext(`slotId(${JSON.stringify(course)},${q(ds)},${q(time)},${j})`,ctx);
  const reserved=rules.manualReserved.filter(r=>r.date===ds&&r.time===time&&(!r.series||r.series===course.series)&&(!r.course||r.course===course.course)).reduce((n,r)=>n+r.count,0);
  desired.set(id,{id,course_id:'course-'+String(i+1).padStart(2,'0'),date:ds,time,starts_at:Date.parse(ds+'T'+time.split('–')[0]+':00+08:00')/1000,capacity:course.cap-reserved,status:'OPEN'});
 });
}
const existing=new Map(db.prepare("SELECT * FROM slots WHERE date>='2026-10-01'").all().map(s=>[s.id,s]));
// Refuse to change a booked session's time; preserve every historical order link.
lines.push("CREATE TRIGGER availability_time_guard BEFORE UPDATE OF time ON slots WHEN OLD.time<>NEW.time AND EXISTS(SELECT 1 FROM order_slots WHERE slot_id=OLD.id) BEGIN SELECT RAISE(ABORT,'BOOKED_TIME_CONFLICT'); END;");
for(const [id,s] of existing)if(!desired.has(id)&&s.status!=='CLOSED')lines.push(`UPDATE slots SET status='CLOSED' WHERE id=${q(id)};`);
for(const [id,s] of desired){
 const old=existing.get(id),keys=['time','starts_at','capacity','status'];
 if(!old)lines.push(`INSERT INTO slots(${Object.keys(s).join(',')}) VALUES(${Object.values(s).map(q).join(',')});`);
 else {const changed=keys.filter(k=>old[k]!==s[k]);if(changed.length)lines.push(`UPDATE slots SET ${changed.map(k=>k+'='+q(s[k])).join(',')} WHERE id=${q(id)};`);}
}
lines.push('DROP TRIGGER availability_time_guard;');
writeFileSync(new URL('payment-worker/migrations/0005_availability.sql',root),lines.join('\n')+'\n');
console.log(`Generated ${lines.length} statements; course prices and orders untouched.`);
