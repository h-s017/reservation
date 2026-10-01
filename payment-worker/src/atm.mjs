import {sha256,equal} from './newebpay.mjs';
import {sql} from './orders.mjs';
export async function saveAccount(db,n){
 const a=await sql(db,'SELECT a.*,o.amount,o.status AS order_status FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=?',n.merchantOrderNo).first();
 if(!a||a.amount!==n.amount)throw new Error('INVALID_NOTIFICATION');
 if(!a.deadline||a.deadline!==n.deadline)throw new Error('ACCOUNT_DEADLINE_MISMATCH');
 if(a.status!=='PENDING'||a.order_status!=='PENDING')return;
 if(a.account_no&&(a.account_no!==n.account||a.bank_code!==n.bankCode))throw new Error('INVALID_NOTIFICATION');
 await sql(db,"UPDATE payment_attempts SET payment_method='VACC',bank_code=?,account_no=? WHERE id=? AND status='PENDING'",n.bankCode,n.account,a.id).run();
}
export async function queryTrade(a,env,fetcher=fetch){
 const data=new URLSearchParams({Amt:String(a.amount),MerchantID:env.NEWEBPAY_MERCHANT_ID,MerchantOrderNo:a.id});
 const CheckValue=(await sha256('IV='+env.NEWEBPAY_HASH_IV+'&'+data+'&Key='+env.NEWEBPAY_HASH_KEY)).toUpperCase();
 const base=env.NEWEBPAY_ENV==='test'?'https://ccore.newebpay.com':'https://core.newebpay.com';
 const response=await fetcher(base+'/API/QueryTradeInfo',{method:'POST',body:new URLSearchParams({...Object.fromEntries(data),CheckValue,Version:'1.3',RespondType:'JSON',TimeStamp:String(Math.floor(Date.now()/1000))}),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!response.ok)throw new Error('QUERY_FAILED');const d=await response.json(),r=d.Result;
 if(d.Status!=='SUCCESS'||!r||r.MerchantID!==env.NEWEBPAY_MERCHANT_ID||r.MerchantOrderNo!==a.id||Number(r.Amt)!==a.amount||r.PaymentType!=='VACC'||!r.TradeNo)throw new Error('QUERY_FAILED');
 const fields=new URLSearchParams({Amt:String(r.Amt),MerchantID:r.MerchantID,MerchantOrderNo:r.MerchantOrderNo,TradeNo:r.TradeNo});
 const expected=(await sha256('HashIV='+env.NEWEBPAY_HASH_IV+'&'+fields+'&HashKey='+env.NEWEBPAY_HASH_KEY)).toUpperCase();
 if(!equal(expected,r.CheckCode))throw new Error('QUERY_FAILED');
 return String(r.TradeStatus);
}
export async function reconcileExpired(env,fetcher=fetch){
 const timestamp=Math.floor(Date.now()/1000);
 // Allow notifications already in flight to arrive before querying the expired account.
 const rows=await sql(env.DB,`SELECT a.id,a.order_id,a.deadline,o.amount FROM payment_attempts a JOIN orders o ON o.id=a.order_id
 WHERE a.status='PENDING' AND a.payment_method='VACC' AND a.deadline>0 AND a.deadline<? AND a.checked_at<? ORDER BY a.checked_at LIMIT 10`,timestamp-600,timestamp-600).all();
 for(const a of rows.results){
  await sql(env.DB,'UPDATE payment_attempts SET checked_at=? WHERE id=?',timestamp,a.id).run();
  try{
   const status=await queryTrade(a,env,fetcher);
   // Paid or unknown results retain the seat and await the authenticated NotifyURL.
   if(!['0','2','3'].includes(status))continue;
   await env.DB.batch([
    sql(env.DB,"UPDATE payment_attempts SET status='FAILED' WHERE id=? AND status='PENDING'",a.id),
    sql(env.DB,"UPDATE orders SET status='CANCELLED' WHERE id=? AND status='FAILED' AND NOT EXISTS(SELECT 1 FROM payment_attempts WHERE order_id=? AND status IN ('PENDING','PAID'))",a.order_id,a.order_id)
   ]);
  }catch(_){/* Retain seats on query/network/verification failure. Retry on next cron. */}
 }
}
