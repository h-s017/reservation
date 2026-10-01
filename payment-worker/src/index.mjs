import {saveAccount,reconcileExpired} from './atm.mjs';
import {checkout,sha256,verifyNotification,verifyAccount,equal} from './newebpay.mjs';
import {createOrder,ownedOrder,startCheckout,cancelOrder,notifyOrder,listSlots,expireDrafts,adminAction,publicOrder} from './orders.mjs';
export default {
  async scheduled(event,env,ctx){ctx.waitUntil(Promise.all([expireDrafts(env.DB),reconcileExpired(env)]));},
  async fetch(request,env){
    const url=new URL(request.url),headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
    const reply=(data,status=200)=>Response.json(data,{status,headers});
    if(url.pathname==='/payment/return'&&['GET','POST'].includes(request.method)){
      // Diagnostic only: ReturnURL never changes payment state or authorizes a booking.
      if(request.method==='POST')try{const form=await request.formData();const code=String(form.get('Status')||'UNKNOWN');if(/^[A-Z0-9_]{1,40}$/.test(code))await env.DB.prepare('INSERT INTO admin_audit(action,target,created_at) VALUES(?,?,?)').bind('UNVERIFIED_RETURN_CODE',code,Math.floor(Date.now()/1000)).run();}catch(_){}
      return new Response(null,{status:303,headers:{...headers,Location:env.SITE_ORIGIN+'/?payment=return'}});
    }
    if(['/payment/notify','/payment/account'].includes(url.pathname)&&request.method==='POST'){
      let stage='PARSE';
      try{const raw=await request.text();if(raw.length>40000)return reply({ok:false},413);const type=request.headers.get('Content-Type')||'';const form=type.toLowerCase().startsWith('multipart/form-data')?await new Response(raw,{headers:{'Content-Type':type}}).formData():new URLSearchParams(raw);if(url.pathname==='/payment/account'){stage='ACCOUNT';await saveAccount(env.DB,await verifyAccount(form,env));return new Response(null,{status:303,headers:{...headers,Location:env.SITE_ORIGIN+'/?payment=return'}});}stage='VERIFY';const notification=await verifyNotification(form,env);stage='UPDATE';await notifyOrder(env.DB,notification);return new Response('SUCCESS',{headers});}
      catch(error){const code=['CONFIGURATION','INVALID_NOTIFICATION','NOT_FOUND','AMOUNT_MISMATCH','PAYMENT_PENDING','TRADE_CONFLICT'].includes(error.message)?error.message:'PROCESSING_ERROR';try{await env.DB.prepare('INSERT INTO admin_audit(action,target,created_at) VALUES(?,?,?)').bind('NOTIFY_REJECTED',stage+':'+code+':'+(['Error','TypeError','SyntaxError','OperationError'].includes(error.name)?error.name:'OTHER'),Math.floor(Date.now()/1000)).run();}catch(_){}return reply({ok:false,error:'NOTIFICATION_NOT_ACCEPTED'},503);}
    }
    if(url.pathname==='/api/slots'&&request.method==='GET'){
      if(request.headers.get('Origin')===env.SITE_ORIGIN)headers['Access-Control-Allow-Origin']=env.SITE_ORIGIN;
      try{return reply({ok:true,slots:await listSlots(env.DB)});}catch(_){return reply({ok:false,error:'SERVICE_UNAVAILABLE'},503);}
    }
    const api=url.pathname.startsWith('/api/')||url.pathname.startsWith('/orders')||url.pathname==='/contest';
    if(!api){
      if(!env.ASSETS)return reply({ok:false},404);
      const asset=await env.ASSETS.fetch(request),h=new Headers(asset.headers);
      for(const [k,v] of Object.entries(headers))h.set(k,v);h.set('X-Frame-Options','DENY');
      if(url.pathname.startsWith('/admin'))h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      return new Response(asset.body,{status:asset.status,headers:h});
    }
    const admin=url.pathname.startsWith('/api/admin/'),allowedOrigin=admin?url.origin:env.SITE_ORIGIN;
    if(request.headers.get('Origin')!==allowedOrigin)return reply({ok:false},403);
    headers['Access-Control-Allow-Origin']=allowedOrigin;headers.Vary='Origin';
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
    if(request.method!=='POST')return reply({ok:false},405);
    try{
      const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
      if(admin){
        if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32||!equal(token,env.ADMIN_TOKEN))return reply({ok:false,error:'UNAUTHORIZED'},401);
        const raw=await request.text();if(raw.length>10000)return reply({ok:false},413);
        return reply({ok:true,...await adminAction(env.DB,url.pathname,JSON.parse(raw))});
      }
      if(!/^[a-f0-9]{64}$/.test(token))return reply({ok:false},401);
      const raw=await request.text();if(raw.length>10000)return reply({ok:false},413);
      const d=JSON.parse(raw),hash=await sha256(token);let order,payment;
      if(url.pathname==='/orders'||url.pathname==='/contest'){
        const {slotIds,name,phone,email,line,note,website}=d;
        order=await createOrder(env.DB,hash,{slotIds,name,phone,email,line,note,website},url.pathname==='/contest');
      }else if(url.pathname==='/orders/status')order=await ownedOrder(env.DB,hash,d.id);
      else if(url.pathname==='/orders/cancel')order=await cancelOrder(env.DB,hash,d.id);
      else if(url.pathname==='/orders/checkout'){
        if(!env.NEWEBPAY_MERCHANT_ID||new TextEncoder().encode(env.NEWEBPAY_HASH_KEY||'').length!==32||new TextEncoder().encode(env.NEWEBPAY_HASH_IV||'').length!==16||!['test','production'].includes(env.NEWEBPAY_ENV)||!/^https:\/\//.test(env.PUBLIC_ORIGIN||''))throw new Error('CONFIGURATION');
        order=await startCheckout(env.DB,hash,d.id);if(order.status==='PENDING'&&!order.attempt.account_no)payment=await checkout(order,env);
      }else return reply({ok:false},404);
      return reply({ok:true,order:publicOrder(order),payment});
    }catch(err){
      const codes=['BAD_REQUEST','SLOT_FULL','NOT_FOUND','PAYMENT_PENDING','COURSE_UNAVAILABLE','CONFIGURATION','CAPACITY_CONFLICT','PAYMENT_ATTEMPTS_EXHAUSTED'];
      const error=codes.includes(err.message)?err.message:'SERVICE_UNAVAILABLE';return reply({ok:false,error},['SERVICE_UNAVAILABLE','CONFIGURATION'].includes(error)?503:409);
    }
  }
};
