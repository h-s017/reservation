import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {database} from './db.mjs';
import {createOrder,listSlots,startCheckout} from '../src/orders.mjs';
const series='心村限定｜Helori 香氣探索所';
const data={name:'測試學員',phone:'0912345678',email:'test@example.com',line:'',note:''};
const available=(db,courseId)=>db.sqlite.prepare(`SELECT s.id FROM slots s LEFT JOIN closed_dates d ON d.date=s.date
  WHERE s.course_id=? AND s.status='OPEN' AND d.date IS NULL
  AND s.starts_at>=unixepoch()+129600 ORDER BY s.starts_at LIMIT 1`).get(courseId)?.id;

test('Heart Village exposes only 30mL/1350 and 50mL/1800, with the normal headcount field',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const courses=vm.runInNewContext(html.match(/const C=([\s\S]*?);\s*let S=/)[0].replace(/;\s*let S=$/,'; C.COURSES'));
  const visible=JSON.parse(JSON.stringify(courses.filter(c=>c.series===series&&!c.hidden).map(c=>({name:c.course,price:c.price,unit:c.unit}))));
  assert.deepEqual(visible,[{name:'香氣探索｜30 mL',price:1350,unit:'位'},{name:'香氣探索｜50 mL',price:1800,unit:'位'}]);
  assert.match(html,/id="fQuantity"/);
  const payment=readFileSync(new URL('../../payment.js',import.meta.url),'utf8');
  assert.match(payment,/heartVillage\?'前往結帳':'確認訂單'/);
  assert.match(payment,/if\(S\.course\.series==='心村限定｜Helori 香氣探索所'\)await submitPayment\(\)/);
});
test('stale D1 catalogue cannot sell retired options and checkout uses server 1350/1800 unit prices',async()=>{
  const db=database(true);
  db.sqlite.exec(`UPDATE courses SET course='單人調香探索課 10ML',price=990 WHERE id='course-01';
    UPDATE courses SET course='單人調香探索課 50ML',price=1800 WHERE id='course-03';
    UPDATE courses SET enabled=1 WHERE id IN ('course-02','course-04');`);
  const slots=await listSlots(db);
  const heart=slots.filter(s=>s.series===series);
  assert.ok(heart.some(s=>s.course==='香氣探索｜30 mL'&&s.price===1350&&s.unit==='位'));
  assert.ok(heart.some(s=>s.course==='香氣探索｜50 mL'&&s.price===1800&&s.unit==='位'));
  assert.ok(heart.every(s=>!s.course.includes('10ML')&&!s.course.includes('雙人')&&!s.course.includes('單人')));
  const thirty=available(db,'course-01'),fifty=available(db,'course-03');
  assert.ok(thirty&&fifty);
  const o30=await createOrder(db,'a'.repeat(64),{...data,slotIds:[thirty],quantity:3,amount:1,unit_price:1});
  assert.equal(o30.course,'香氣探索｜30 mL');assert.equal(o30.unit_price,1350);assert.equal(o30.amount,4050);
  const checked=await startCheckout(db,'a'.repeat(64),o30.id);assert.equal(checked.amount,4050);
  const o50=await createOrder(db,'b'.repeat(64),{...data,slotIds:[fifty],quantity:2,amount:1});
  assert.equal(o50.course,'香氣探索｜50 mL');assert.equal(o50.unit_price,1800);assert.equal(o50.amount,3600);
  for(const oldId of ['course-02','course-04']){
    await assert.rejects(createOrder(db,oldId.repeat(16).slice(0,64),{...data,slotIds:[available(db,oldId)]}),/COURSE_UNAVAILABLE/);
  }
});
test('Heart Village SQL migration can be repeated without changing historical order or reserved seat',()=>{
  const db=database(true),slotId=available(db,'course-01');
  assert.ok(slotId);
  const timestamp=Math.floor(Date.now()/1000);
  db.sqlite.prepare(`INSERT INTO orders
    (id,access_hash,course_id,course,variant,amount,name,phone,email,line,note,status,created_at,hold_until,quantity,unit_price,booking_unit,paid_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'HF-OLD','h'.repeat(64),'course-01','單人調香探索課 10ML','',990,'歷史學員','0912345678','old@example.com','','','PAID',timestamp,timestamp+1800,1,990,'位',timestamp);
  db.sqlite.prepare("INSERT INTO order_slots(order_id,slot_id) VALUES(?,?)").run('HF-OLD',slotId);
  db.sqlite.exec("UPDATE courses SET course='單人調香探索課 10ML',price=990 WHERE id='course-01'");
  const snapshot=()=>JSON.stringify(['orders','order_slots','payment_attempts'].map(t=>db.sqlite.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()));
  const before=snapshot(),booked=db.sqlite.prepare('SELECT booked FROM slots WHERE id=?').get(slotId).booked;
  const migration=readFileSync(new URL('../migrations/0012_heart_village_30ml_50ml.sql',import.meta.url),'utf8');
  db.sqlite.exec(migration);db.sqlite.exec(migration);
  assert.equal(snapshot(),before);assert.equal(db.sqlite.prepare('SELECT booked FROM slots WHERE id=?').get(slotId).booked,booked);
  assert.deepEqual(db.sqlite.prepare("SELECT id,price,enabled FROM courses WHERE id IN ('course-01','course-02','course-03','course-04') ORDER BY id").all().map(({id,price,enabled})=>({id,price,enabled})),
    [{id:'course-01',price:1350,enabled:1},{id:'course-02',price:1980,enabled:0},{id:'course-03',price:1800,enabled:1},{id:'course-04',price:3600,enabled:0}]);
});
