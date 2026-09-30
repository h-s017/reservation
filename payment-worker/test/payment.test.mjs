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
