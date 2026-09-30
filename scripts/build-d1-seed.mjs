// Run explicitly when the catalogue/date rules change; never during a request.
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ctx=vm.createContext({});
vm.runInContext(script,ctx);
const config=JSON.parse(vm.runInContext('JSON.stringify(C)',ctx));
const rules=JSON.parse(readFileSync(new URL('../payment-worker/catalogue-rules.json',import.meta.url),'utf8'));
const courses=[...config.COURSES,...rules.extraCourses];
const q=v=>typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const lines=['-- Generated from index.html and preserved backend date rules. No customer data.'];
const blocked=new Set([...config.CLOSED_DATES,...rules.blockedDates]);
for(const date of blocked)lines.push(`INSERT INTO closed_dates(date,reason) VALUES(${q(date)},'既有禁約日期') ON CONFLICT(date) DO NOTHING;`);
for(const [i,c] of courses.entries()){
  const id='course-'+String(i+1).padStart(2,'0');
  lines.push(`INSERT INTO courses(id,series,course,variant,price,capacity,unit,mode,required_slots,max_slots,contest) VALUES(${[id,c.series,c.course,c.variant||'',c.price,c.cap,c.unit||'位',c.mode,c.requiredSlots||1,c.max||1,c.contest?1:0].map(q).join(',')}) ON CONFLICT(id) DO NOTHING;`);
  const start=c.startDate||rules.startDate, end=c.endDate||config.END;
  for(let day=new Date(start+'T00:00:00Z');day<=new Date(end+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1)){
    const ds=day.toISOString().slice(0,10),dow=day.getUTCDay();
    if(config.CLOSED.includes(dow)||!config.W.includes(dow)||config.CLOSED_DATES.includes(ds))continue;
    const times=vm.runInContext(`timesFor(${JSON.stringify(c)},${JSON.stringify(ds)},${dow})`,ctx);
    times.forEach((time,j)=>{
      const slotId=vm.runInContext(`slotId(${JSON.stringify(c)},${JSON.stringify(ds)},${JSON.stringify(time)},${j})`,ctx);
      const starts=Math.floor(new Date(ds+'T'+time.split('–')[0]+':00+08:00').getTime()/1000);
      lines.push(`INSERT INTO slots(id,course_id,date,time,starts_at,capacity,status) VALUES(${[slotId,id,ds,time,starts,c.cap,blocked.has(ds)?'CLOSED':'OPEN'].map(q).join(',')}) ON CONFLICT(id) DO NOTHING;`);
    });
  }
}
writeFileSync(new URL('../payment-worker/migrations/0002_catalogue.sql',import.meta.url),lines.join('\n')+'\n');
console.log('Generated catalogue and slots; existing rows are never overwritten.');
