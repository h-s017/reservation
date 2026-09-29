import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createCipheriv,createDecipheriv,createHash,randomUUID} from 'node:crypto';
import {encrypt,signature,verifyNotification,checkout} from '../src/newebpay.mjs';
import worker from '../src/index.mjs';

// Synthetic fixtures only, never merchant credentials.
const env={NEWEBPAY_MERCHANT_ID:'TEST_ONLY',NEWEBPAY_HASH_KEY:'12345678901234567890123456789012',NEWEBPAY_HASH_IV:'1234567890123456',NEWEBPAY_ENV:'test',PUBLIC_ORIGIN:'https://payment.example.com',SITE_ORIGIN:'https://reservation.hanascent.com',GAS_URL:'https://script.google.com/macros/s/test/exec',GAS_SHARED_SECRET:'synthetic-shared-secret-for-tests-only'};
function signed(result,status='SUCCESS'){
  const cipher=createCipheriv('aes-256-cbc',env.NEWEBPAY_HASH_KEY,env.NEWEBPAY_HASH_IV);
  const info=Buffer.concat([cipher.update(JSON.stringify({Status:status,Result:result})),cipher.final()]).toString('hex');
  const sha=createHash('sha256').update(`HashKey=${env.NEWEBPAY_HASH_KEY}&${info}&HashIV=${env.NEWEBPAY_HASH_IV}`).digest('hex').toUpperCase();
  return new URLSearchParams({MerchantID:env.NEWEBPAY_MERCHANT_ID,TradeInfo:info,TradeSha:sha});
}
const result={MerchantID:'TEST_ONLY',MerchantOrderNo:'H123',Amt:6500,TradeNo:'T123',PaymentType:'CREDIT'};
test('AES and SHA match independent Node implementation / official CBC construction',async()=>{
  const parameters={Amt:'6500',ItemDesc:'調香課程'};
  const info=await encrypt(parameters,env), decipher=createDecipheriv('aes-256-cbc',env.NEWEBPAY_HASH_KEY,env.NEWEBPAY_HASH_IV);
  assert.equal(Buffer.concat([decipher.update(Buffer.from(info,'hex')),decipher.final()]).toString(),new URLSearchParams(parameters).toString());
  assert.equal(await signature(info,env),createHash('sha256').update(`HashKey=${env.NEWEBPAY_HASH_KEY}&${info}&HashIV=${env.NEWEBPAY_HASH_IV}`).digest('hex').toUpperCase());
});
test('signed notify accepts successful CREDIT only and rejects tampering / wrong merchant',async()=>{
  assert.equal((await verifyNotification(signed(result),env)).status,'PAID');
  const altered=signed(result);altered.set('TradeSha','0'.repeat(64));await assert.rejects(verifyNotification(altered,env));
  await assert.rejects(verifyNotification(signed({...result,MerchantID:'OTHER'}),env));
  await assert.rejects(verifyNotification(signed({...result,PaymentType:'VACC'}),env));
  await assert.rejects(verifyNotification(signed({...result,Amt:-1}),env));
  assert.equal((await verifyNotification(signed(result,'CREDIT_FAILED'),env)).status,'FAILED');
});
test('checkout is test by default and keeps secrets out of gateway fields',async()=>{
  const p=await checkout({amount:6500,course:'課程',email:'test@example.com',attempt:{id:'H123',timestamp:1}},env);
  assert.equal(p.action,'https://ccore.newebpay.com/MPG/mpg_gateway');
  assert.ok(!JSON.stringify(p).includes(env.NEWEBPAY_HASH_KEY));
  await assert.rejects(checkout({attempt:{}},{...env,NEWEBPAY_ENV:'typo'}));
});
function gasHarness(now='2026-09-29T02:00:00Z'){
  const sheets=new Map();
  function sheet(){return {rows:[],appendRow(r){this.rows.push([...r]);},getDataRange(){return{getValues:()=>this.rows.map(r=>[...r])};},getRange(row,col,height=1,width=1){return{getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>this.rows[row+i-1]?.[col+j-1]??'')),setValues:values=>{values.forEach((r,i)=>r.forEach((v,j)=>{this.rows[row+i-1]??=[];this.rows[row+i-1][col+j-1]=v;}));},setValue:v=>{this.rows[row-1]??=[];this.rows[row-1][col-1]=v;}};}};}
  const ss={getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=sheet();s.getMaxColumns=()=>26;s.insertColumnsAfter=()=>{};sheets.set(n,s);return s;}};
  let locked=false;
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return new Date(now).getTime();}}
  const context=vm.createContext({Date:FixedDate,Utilities:{getUuid:randomUUID,formatDate:(d,tz,f)=>f==='u'?String(d.getDay()||7):`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`},PropertiesService:{getScriptProperties:()=>({getProperty:()=>env.GAS_SHARED_SECRET})},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true;},hasLock:()=>locked,releaseLock(){locked=false;}})},SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush(){}},ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({setMimeType:()=>JSON.parse(value)})},MailApp:{sendEmail(){}}});
  vm.runInContext(readFileSync(new URL('../../Code.gs',import.meta.url),'utf8'),context);
  const call=(action,data={})=>context.doPost({postData:{contents:JSON.stringify({action,secret:env.GAS_SHARED_SECRET,...data})}});
  const slots=context.getOpenSlots();
  const slot=slots.find(s=>s.course==='Vol. 2｜調香師的和弦練習曲'&&s.date==='2026-12-01');assert.ok(slot);
  const data={accessHash:'a'.repeat(64),slotIds:[slot.id],name:'Test',phone:'0912345678',email:'test@example.com',line:'test'};
  return {call,data,context,ss};
}
test('GAS uses approved price and one row for create retry, notify replay and payment retry',()=>{
  const {call,data,ss}=gasHarness();
  const created=call('create',{...data,amount:1});assert.equal(created.ok,true);assert.equal(created.order.amount,6500);assert.equal(created.order.status,'PENDING');
  assert.equal(call('create',data).order.id,created.order.id);assert.equal(ss.getSheetByName('報名').rows.length,2);
  const pending=call('checkout',{accessHash:data.accessHash,id:created.order.id}).order;
  assert.ok(pending.attempt.id.length<=30);
  assert.equal(call('checkout',{accessHash:data.accessHash}).order.attempt.id,pending.attempt.id);
  assert.equal(call('cancel',{accessHash:data.accessHash}).error,'PAYMENT_PENDING');
  assert.equal(call('notify',{merchantOrderNo:pending.attempt.id,amount:1,tradeNo:'T1',status:'PAID'}).ok,false);
  call('notify',{merchantOrderNo:pending.attempt.id,amount:6500,status:'FAILED'});
  const retry=call('checkout',{accessHash:data.accessHash}).order;assert.equal(retry.id,created.order.id);assert.notEqual(retry.attempt.id,pending.attempt.id);
  const notification={merchantOrderNo:retry.attempt.id,amount:6500,tradeNo:'T1',status:'PAID'};
  assert.equal(call('notify',notification).order.status,'PAID');
  const paidAt=ss.getSheetByName('報名').rows[1][22];
  assert.equal(call('notify',notification).order.status,'PAID');assert.equal(ss.getSheetByName('報名').rows.length,2);assert.equal(ss.getSheetByName('報名').rows[1][22],paidAt);
  assert.equal(call('notify',{...notification,status:'FAILED'}).order.status,'PAID');
  assert.equal(call('status',{accessHash:'b'.repeat(64),id:created.order.id}).ok,false);
});
test('server enforces capacity, blocked dates, slot count, special-flow separation and authentication',()=>{
  const {call,data,context}=gasHarness();
  assert.equal(call('create',{...data,secret:'public-token'}).ok,false);
  assert.equal(call('contest',data).ok,false);
  assert.equal(call('create',{...data,email:''}).ok,false);
  assert.equal(call('create',{...data,slotIds:[data.slotIds[0],data.slotIds[0]]}).ok,false);
  const blocked=context.getOpenSlots().find(s=>s.date==='2026-11-15');assert.ok(blocked);assert.equal(call('create',{...data,slotIds:[blocked.id]}).error,'SLOT_FULL');
  const combo=context.getOpenSlots().find(s=>s.course==='Vol. 1 ＋ Vol. 2');assert.equal(call('create',{...data,slotIds:[combo.id]}).ok,false);
  for(let i=0;i<6;i++)assert.equal(call('create',{...data,accessHash:String(i).repeat(64)}).ok,true);
  assert.equal(call('create',data).error,'SLOT_FULL');
});
test('cancellation releases seats; retry reuses order and rechecks capacity; historical rows remain counted',()=>{
  const {call,data,context,ss}=gasHarness();
  const created=call('create',data).order;
  assert.equal(context.getBookedCounts_()[data.slotIds[0]],1);
  assert.equal(call('cancel',{accessHash:data.accessHash}).order.status,'CANCELLED');
  assert.equal(context.getBookedCounts_()[data.slotIds[0]],undefined);
  assert.equal(call('checkout',{accessHash:data.accessHash}).order.id,created.id);
  ss.getSheetByName('報名').appendRow(['legacy','',data.slotIds[0],'','','','','','','','','','','','legacy-status']);
  assert.equal(context.getBookedCounts_()[data.slotIds[0]],2);
});
test('contest remains a non-payment LINE reservation and cannot use checkout',()=>{
  const {call,data,context}=gasHarness('2026-08-01T02:00:00Z');
  const slot=context.getOpenSlots().find(s=>s.series==='亞洲香氛藝術大賽'&&s.date==='2026-08-04');assert.ok(slot);
  const d={...data,slotIds:[slot.id],email:''};
  assert.equal(call('create',d).ok,false);
  const reservation=call('contest',d);assert.equal(reservation.ok,true);assert.equal(reservation.order.status,'LINE_CONFIRMATION');assert.equal(reservation.order.amount,0);
  assert.equal(call('checkout',{accessHash:d.accessHash}).ok,false);
});
test('multi-session package keeps a single approved price and rejects fewer than 36 hours',()=>{
  const {call,data,context}=gasHarness();
  const slots=context.getOpenSlots().filter(s=>s.course==='Vol. 1 ＋ Vol. 2'&&s.date>='2026-12-01');
  const order=call('create',{...data,slotIds:slots.slice(0,2).map(s=>s.id)});
  assert.equal(order.ok,true);assert.equal(order.order.amount,10500);assert.equal(order.order.slots.length,2);
  const imminent=context.getOpenSlots().find(s=>s.date==='2026-09-29');assert.ok(imminent);
  assert.equal(call('create',{...data,accessHash:'b'.repeat(64),slotIds:[imminent.id]}).ok,false);
});
test('Worker ignores ReturnURL payment claims; failed persistence does not ACK notify',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({ok:false,error:'SERVER_ERROR'});};
  try{
    const returned=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/payment/return',{method:'POST',body:'Status=SUCCESS'}),env);
    assert.equal(returned.status,303);assert.equal(calls,0);
    const rejected=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/payment/notify',{method:'POST',body:signed(result)}),env);
    assert.equal(rejected.status,503);assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});
test('Worker strips arbitrary amount/status fields before GAS and denies wrong origins',async()=>{
  const original=globalThis.fetch;let data;
  globalThis.fetch=async(url,options)=>{data=JSON.parse(options.body);return Response.json({ok:true,order:{id:'HF1',amount:6500,status:'PENDING'}});};
  try{
    const request=origin=>new Request(env.PUBLIC_ORIGIN+'/orders',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({slotIds:['s'],amount:1,status:'PAID',secret:'evil'})});
    assert.equal((await worker.fetch(request('https://evil.example'),env)).status,403);
    assert.equal((await worker.fetch(request(env.SITE_ORIGIN),env)).status,200);
    assert.equal(data.amount,undefined);assert.equal(data.status,undefined);assert.equal(data.secret,env.GAS_SHARED_SECRET);
  }finally{globalThis.fetch=original;}
});
