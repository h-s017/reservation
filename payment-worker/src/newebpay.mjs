import {createDecipheriv} from 'node:crypto';
const encoder = new TextEncoder();
export const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export async function sha256(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function keyAndIV(env) {
  const key = encoder.encode(env.NEWEBPAY_HASH_KEY || ''), iv = encoder.encode(env.NEWEBPAY_HASH_IV || '');
  if (key.length !== 32 || iv.length !== 16 || !env.NEWEBPAY_MERCHANT_ID) throw new Error('CONFIGURATION');
  return {key, iv};
}
export async function signature(info, env) {
  return (await sha256(`HashKey=${env.NEWEBPAY_HASH_KEY}&${info}&HashIV=${env.NEWEBPAY_HASH_IV}`)).toUpperCase();
}
export async function encrypt(parameters, env) {
  const {key, iv} = keyAndIV(env);
  const aes = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  // Web Crypto applies PKCS#7; do not add a second padding layer.
  return hex(await crypto.subtle.encrypt({name: 'AES-CBC', iv}, aes, encoder.encode(new URLSearchParams(parameters).toString())));
}
async function decodeNotification(form, env) {
  const {key, iv} = keyAndIV(env);
  const info = form.get('TradeInfo'), sha = form.get('TradeSha');
  if (form.get('MerchantID') !== env.NEWEBPAY_MERCHANT_ID || !/^[a-fA-F0-9]{32,32768}$/.test(info || '') || info.length % 32 ||
      !equal(await signature(info, env), sha)) throw new Error('INVALID_NOTIFICATION');
  // NewebPay's PHP-compatible response padding can span 32 bytes. Web Crypto
  // enforces AES's 16-byte PKCS#7 limit, so decrypt raw only AFTER SHA verification.
  const decipher=createDecipheriv('aes-256-cbc',key,iv);decipher.setAutoPadding(false);
  const bytes=Uint8Array.from(info.match(/../g),x=>parseInt(x,16));
  const plain=Buffer.concat([decipher.update(bytes),decipher.final()]);
  const pad=plain[plain.length-1];
  if(pad<1||pad>32||pad>plain.length||!plain.subarray(-pad).every(x=>x===pad))throw new Error('INVALID_NOTIFICATION');
  const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain.subarray(0,-pad)));
  const r = decoded.Result;
  if (!r || r.MerchantID !== env.NEWEBPAY_MERCHANT_ID || !/^[A-Za-z0-9_]{1,30}$/.test(r.MerchantOrderNo || '') ||
      !/^\d+$/.test(String(r.Amt)) || !Number.isSafeInteger(Number(r.Amt)) || Number(r.Amt) <= 0 || typeof decoded.Status !== 'string') throw new Error('INVALID_NOTIFICATION');
  return decoded;
}
export async function verifyNotification(form,env){
  const decoded=await decodeNotification(form,env),r=decoded.Result;
  // Account issuance is not payment. VACC paid notifications must contain PayTime.
  if(decoded.Status==='SUCCESS'&&(!['CREDIT','LINEPAY','VACC'].includes(r.PaymentType)||!r.TradeNo||!(/^[A-Za-z0-9_-]{1,50}$/).test(r.TradeNo)||(r.PaymentType==='VACC'&&!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.PayTime||''))))throw new Error('INVALID_NOTIFICATION');
  return {merchantOrderNo:r.MerchantOrderNo,amount:Number(r.Amt),tradeNo:r.TradeNo||'',status:decoded.Status==='SUCCESS'?'PAID':'FAILED'};
}
export async function verifyAccount(form,env){
  const d=await decodeNotification(form,env),r=d.Result;
  if(d.Status!=='SUCCESS'||r.PaymentType!=='VACC'||r.BankCode!=='809'||!/^\d{10,30}$/.test(r.CodeNo||''))throw new Error('INVALID_NOTIFICATION');
  const time=String(r.ExpireTime||'').replaceAll(':','');
  const deadline=Date.parse(r.ExpireDate+'T'+time.slice(0,2)+':'+time.slice(2,4)+':'+time.slice(4,6)+'+08:00')/1000;
  if(!Number.isSafeInteger(deadline))throw new Error('INVALID_NOTIFICATION');
  return {merchantOrderNo:r.MerchantOrderNo,amount:Number(r.Amt),tradeNo:r.TradeNo,bankCode:r.BankCode,account:r.CodeNo,deadline};
}
export async function checkout(order, env) {
  if (!['test', 'production'].includes(env.NEWEBPAY_ENV)) throw new Error('CONFIGURATION');
  const a=order.attempt,atm=Number.isSafeInteger(a.deadline)&&a.deadline>Math.floor(Date.now()/1000);
  const expiry=atm?new Date((a.deadline+28800)*1000).toISOString():'';
  const info = await encrypt({
    MerchantID: env.NEWEBPAY_MERCHANT_ID, RespondType: 'JSON', TimeStamp: String(Math.floor(Date.now()/1000)), Version: '2.3',
    MerchantOrderNo: order.attempt.id, Amt: String(order.amount), ItemDesc: order.course.slice(0, 40), Email: order.email,
    LoginType: '0', CREDIT: '1', InstFlag: '3', WEBATM: '0', VACC: atm?'1':'0', CVS: '0', BARCODE: '0', APPLEPAY:'1', ANDROIDPAY: '1', SAMSUNGPAY: '1', LINEPAY: '1',
    ...(atm?{BankType:'KGI',ExpireDate:expiry.slice(0,10).replaceAll('-',''),ExpireTime:expiry.slice(11,19).replaceAll(':',''),CustomerURL:env.PUBLIC_ORIGIN+'/payment/account'}:{}),
    NotifyURL: env.PUBLIC_ORIGIN + '/payment/notify', ReturnURL: env.PUBLIC_ORIGIN + '/payment/return',
    ClientBackURL: env.SITE_ORIGIN + '/?payment=return'
  }, env);
  return {action: env.NEWEBPAY_ENV === 'test' ? 'https://ccore.newebpay.com/MPG/mpg_gateway' : 'https://core.newebpay.com/MPG/mpg_gateway',
    fields: {MerchantID: env.NEWEBPAY_MERCHANT_ID, TradeInfo: info, TradeSha: await signature(info, env), Version: '2.3', EncryptType: '0'}};
}
