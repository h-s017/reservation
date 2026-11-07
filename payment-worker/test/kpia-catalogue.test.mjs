import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDecipheriv} from 'node:crypto';
import {database} from './db.mjs';
import {createOrder,startCheckout,listSlots} from '../src/orders.mjs';
import {checkout} from '../src/newebpay.mjs';

const data={name:'測試',phone:'0912345678',email:'test@example.com',line:'',note:''};
function sessions(db,courseId,count){
  return db.sqlite.prepare(`SELECT s.id FROM slots s LEFT JOIN closed_dates d ON d.date=s.date
    WHERE s.course_id=? AND s.status='OPEN' AND d.date IS NULL AND s.starts_at>=unixepoch()+129600
    ORDER BY s.starts_at LIMIT ?`).all(courseId,count).map(s=>s.id);
}
test('KPIA renamed plan sends 44000 to NewebPay; legacy plan is blocked and alcohol-free stays available',async()=>{
  const db=database(true);
  const hidden=sessions(db,'course-12',12);
  await assert.rejects(createOrder(db,'a'.repeat(64),{...data,slotIds:hidden}),/COURSE_UNAVAILABLE/);
  const slots=await listSlots(db);
  assert.ok(slots.filter(s=>hidden.includes(s.id)).every(s=>s.status==='關閉'));
  const order=await createOrder(db,'b'.repeat(64),{...data,slotIds:sessions(db,'course-13',12),amount:39000});
  assert.equal(order.course,'KPIA大韓專業調香師課程');assert.equal(order.amount,44000);
  const env={NEWEBPAY_ENV:'test',NEWEBPAY_MERCHANT_ID:'TEST_ONLY',NEWEBPAY_HASH_KEY:'12345678901234567890123456789012',NEWEBPAY_HASH_IV:'1234567890123456',PUBLIC_ORIGIN:'https://test.example',SITE_ORIGIN:'https://test.example'};
  const payment=await checkout(await startCheckout(db,'b'.repeat(64),order.id),env);
  const decipher=createDecipheriv('aes-256-cbc',env.NEWEBPAY_HASH_KEY,env.NEWEBPAY_HASH_IV);
  const fields=new URLSearchParams(Buffer.concat([decipher.update(Buffer.from(payment.fields.TradeInfo,'hex')),decipher.final()]).toString());
  assert.equal(fields.get('Amt'),'44000');assert.equal(fields.get('ItemDesc'),'KPIA大韓專業調香師課程');
  const alcoholFree=await createOrder(db,'c'.repeat(64),{...data,slotIds:sessions(db,'course-14',1)});
  assert.equal(alcoholFree.amount,6500);assert.equal(alcoholFree.course,'KPIA無酒精香水課程');
});
test('KPIA update preserves existing order amounts, names, payment attempts and seat reservations',async()=>{
  const db=database(true);
  db.sqlite.exec("UPDATE courses SET enabled=1 WHERE id='course-12'; UPDATE courses SET course='KPIA 專業調香師雙證書課（優惠加購無酒精香水證書）' WHERE id='course-13';");
  for(const [i,courseId] of ['course-12','course-13'].entries()){
    const hash=String(i+1).repeat(64),order=await createOrder(db,hash,{...data,slotIds:sessions(db,courseId,12)});
    await startCheckout(db,hash,order.id);
  }
  const snapshot=()=>JSON.stringify(['orders','payment_attempts','order_slots','slots'].map(t=>db.sqlite.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()));
  const before=snapshot(),migration=readFileSync(new URL('../migrations/0009_kpia_catalogue.sql',import.meta.url),'utf8');
  db.sqlite.exec(migration);db.sqlite.exec(migration);
  assert.equal(snapshot(),before);
});
