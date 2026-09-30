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

// Provider callbacks may use multipart/form-data (PHP cURL array POST).
import {fixture} from './db.mjs';
import {createOrder,startCheckout,ownedOrder} from '../src/orders.mjs';
test('notify accepts multipart and urlencoded signed callbacks without duplicate orders',async()=>{
 for(const multipart of [false,true]) {
  const DB=fixture(),hash='a'.repeat(64);
  const o=await createOrder(DB,hash,{slotIds:['s'],name:'Test',phone:'0912345678',email:'test@example.com',line:'test',note:''});
  const attempt=await startCheckout(DB,hash,o.id);
  const fields=signed({...result,MerchantOrderNo:attempt.attempt.id});
  const makeBody=()=>{if(!multipart)return new URLSearchParams(fields);const f=new FormData();for(const [k,v]of fields)f.set(k,v);return f;};
  for(let i=0;i<2;i++){
   const response=await worker.fetch(new Request('https://payment.example.com/payment/notify',{method:'POST',body:makeBody()}),{...env,DB});
   assert.equal(response.status,200);assert.equal(await response.text(),'SUCCESS');
  }
  assert.equal((await ownedOrder(DB,hash)).status,'PAID');
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM orders').get().n,1);
  assert.equal(DB.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,1);
 }
});
test('card wallets and LINE Pay are enabled while deferred payment remains disabled',async()=>{
 const p=await checkout({amount:6500,course:'課程',email:'test@example.com',attempt:{id:'H123',timestamp:1}},env);
 const decipher=createDecipheriv('aes-256-cbc',env.NEWEBPAY_HASH_KEY,env.NEWEBPAY_HASH_IV);
 const fields=new URLSearchParams(Buffer.concat([decipher.update(Buffer.from(p.fields.TradeInfo,'hex')),decipher.final()]).toString());
 for(const method of ['CREDIT','ANDROIDPAY','SAMSUNGPAY','LINEPAY'])assert.equal(fields.get(method),'1');
 for(const method of ['VACC','CVS','BARCODE'])assert.equal(fields.get(method),'0');
 assert.equal((await verifyNotification(signed({...result,PaymentType:'LINEPAY'}),env)).status,'PAID');
 await assert.rejects(verifyNotification(signed({...result,PaymentType:'CVS'}),env));
});
