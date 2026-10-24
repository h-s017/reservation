// Only stores private busy events in D1; never sends their titles to public /api/slots.
const now=()=>Math.floor(Date.now()/1000);
const sql=(db,text,...args)=>db.prepare(text).bind(...args);
export const slotDurationSql=(alias='s')=>
  `((CAST(substr(${alias}.time,7,2) AS INTEGER)*60+CAST(substr(${alias}.time,10,2) AS INTEGER)-CAST(substr(${alias}.time,1,2) AS INTEGER)*60-CAST(substr(${alias}.time,4,2) AS INTEGER))*60)`;
export const busyExistsSql=(alias='s')=>
  `EXISTS(SELECT 1 FROM busy_intervals bi WHERE bi.active=1 AND bi.starts_at < ${alias}.starts_at+${slotDurationSql(alias)} AND bi.ends_at>${alias}.starts_at)`;
const overlaps='bi.starts_at < s.starts_at+'+slotDurationSql('s')+' AND bi.ends_at>s.starts_at';
function instant(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))throw Error('BAD_REQUEST');
  const time=Date.parse(value);
  if(!Number.isFinite(time))throw Error('BAD_REQUEST');
  return Math.floor(time/1000);
}
async function conflicts(db,id){
  const rows=await sql(db,`SELECT DISTINCT o.id AS order_id,o.status,s.date,s.time
   FROM orders o JOIN order_slots os ON os.order_id=o.id AND os.active=1
   JOIN slots s ON s.id=os.slot_id
   JOIN busy_intervals bi ON bi.id=?
   WHERE o.status IN ('PAID','PENDING','FAILED','LINE_CONFIRMATION')
     AND ${overlaps}
   ORDER BY s.date,s.time LIMIT 100`,id).all();
  return rows.results;
}
export async function busyAdmin(db,path,data){
  if(path==='/api/admin/busy-list'){
    const from=typeof data.from==='string'&&/^\d{4}-\d\d-\d\d$/.test(data.from)?data.from:new Date().toISOString().slice(0,10);
    const rows=await sql(db,'SELECT id,source,title,starts_at,ends_at,updated_at FROM busy_intervals WHERE active=1 AND ends_at>=? ORDER BY starts_at LIMIT 200',Math.floor(Date.parse(from+'T00:00:00+08:00')/1000)).all();
    return {events:rows.results};
  }
  if(path==='/api/admin/busy-upsert'){
    const title=typeof data.title==='string'?data.title.trim():'';
    const start=instant(data.start),end=instant(data.end);
    if(!title||title.length>120||end<=start||end-start>14*86400)throw Error('BAD_REQUEST');
    let id=typeof data.id==='string'?data.id:'';
    if(id&&!/^busy-[a-f0-9-]{36}$/.test(id))throw Error('BAD_REQUEST');
    if(id){
      const found=await sql(db,'SELECT id FROM busy_intervals WHERE id=? AND source=?',id,'workspace').first();
      if(!found)throw Error('NOT_FOUND');
    }else id='busy-'+crypto.randomUUID();
    await db.batch([
      sql(db,`INSERT INTO busy_intervals(id,source,title,starts_at,ends_at,active,updated_at)
      VALUES(?,'workspace',?,?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=1,updated_at=excluded.updated_at`,id,title,start,end,now()),
      sql(db,'INSERT INTO admin_audit(action,target,created_at) VALUES(?,?,?)','BUSY_UPSERT',id,now())
    ]);
    return {id,conflicts:await conflicts(db,id)};
  }
  if(path==='/api/admin/busy-delete'){
    if(typeof data.id!=='string'||!/^busy-[a-f0-9-]{36}$/.test(data.id))throw Error('BAD_REQUEST');
    const result=await db.batch([
      sql(db,"UPDATE busy_intervals SET active=0,updated_at=? WHERE id=? AND source='workspace' AND active=1",now(),data.id),
      sql(db,'INSERT INTO admin_audit(action,target,created_at) VALUES(?,?,?)','BUSY_DELETE',data.id,now())
    ]);
    if(!result[0].meta.changes)throw Error('NOT_FOUND');
    return {id:data.id};
  }
  throw Error('NOT_FOUND');
}
