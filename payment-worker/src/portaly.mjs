import {verifyPortalyCallback} from './vendor/portaly-signature.mjs';

const paths = {payment:'/api/creator-subscription',product:'/api/digital-products'};
const fail = code => { throw new Error(code); };
export function livePortalyConfigured(env) {
  return env.EVENT_MODE==='live' && env.PORTALY_LIVE_ENABLED==='true' &&
    /^pcs_live_/.test(env.PORTALY_API_KEY||'') && !!env.PORTALY_CALLBACK_SECRET &&
    env.PORTALY_PHYSICAL_EVENT_APPROVED==='true' && !!env.PORTALY_EVENT_PLAN_ID;
}
export function portaly(env, fetcher=fetch) {
  const host = new URL(env.PORTALY_API_HOST || 'https://portaly.ai');
  if (host.origin!=='https://portaly.ai' || host.username || host.password || host.pathname!=='/') fail('UNCONFIGURED');
  if (env.EVENT_MODE==='live' ? !livePortalyConfigured(env) : !/^pcs_test_/.test(env.PORTALY_API_KEY||'')) fail('UNCONFIGURED');
  async function api(path, body) {
    const response = await fetcher(host.origin+path,{
      method:body?'POST':'GET',redirect:'manual',
      signal:AbortSignal.timeout(12000),
      headers:{Authorization:'Bearer '+env.PORTALY_API_KEY,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if (!response.ok) fail('PORTALY_UNAVAILABLE');
    return (await response.json()).data;
  }
  async function plans() { return api(paths.payment+'/plans?status=active'); }
  async function session(product, data, amountField, amount) {
    if (!Number.isSafeInteger(amount)||amount<0 || (product==='payment' && amount===0)) fail('BAD_REQUEST');
    const result = await api(paths[product]+'/checkout-sessions',{...data,[amountField]:amount});
    const url = new URL(result.checkoutUrl);
    if (url.origin!==host.origin || url.username || url.password || !result.sessionId ||
      !Number.isFinite(Date.parse(result.expiresAt)) || result[amountField]!==amount) fail('PORTALY_RESPONSE_INVALID');
    return {sessionId:result.sessionId,checkoutUrl:url.href,expiresAt:Date.parse(result.expiresAt)};
  }
  return {
    plans,
    async eventPlan() {
      if (env.PORTALY_PHYSICAL_EVENT_APPROVED!=='true'||!env.PORTALY_EVENT_PLAN_ID) fail('UNCONFIGURED');
      const plan = (await plans()).find(p=>p.id===env.PORTALY_EVENT_PLAN_ID);
      if (!plan || plan.status!=='active'||plan.billingPeriod!=='one-time'||plan.pricingType!=='dynamic'||plan.currency!=='TWD') fail('UNCONFIGURED');
      return plan;
    },
    createPaymentSession:(order, amount)=>session('payment',order,'amount',amount),
    getPaymentSession:id=>api(paths.payment+'/checkout-sessions/'+encodeURIComponent(id)),
    listPaymentSessions:query=>api(paths.payment+'/checkout-sessions?'+new URLSearchParams(query)),
    getPaymentOrder:id=>api(paths.payment+'/orders/'+encodeURIComponent(id)),
    listPaymentOrders:query=>api(paths.payment+'/orders?'+new URLSearchParams(query)),
    listProducts:query=>api(paths.product+(query?'?'+new URLSearchParams(query):'')),
    getProduct:id=>api(paths.product+'/'+encodeURIComponent(id)),
    // Prices are fetched on the server. Repeated IDs represent multiple units in the same bundle.
    async createProductSession(ids,data) {
      if (!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(id=>typeof id!=='string'||!id)) fail('BAD_REQUEST');
      const rows = new Map(await Promise.all([...new Set(ids)].map(async id=>[id,await api(paths.product+'/'+encodeURIComponent(id))])));
      const amount = ids.reduce((total,id)=>{
        const p = rows.get(id);
        if (!p?.isActive||p.currency!=='TWD'||!Number.isSafeInteger(p.effectivePrice)||p.effectivePrice<0) fail('UNAVAILABLE');
        return total+p.effectivePrice;
      },0);
      const {callbackUrl,successRedirectUrl,cancelRedirectUrl,merchantOrderNumber,customerEmail,customerName,metadata} = data;
      return session('product',{items:ids.map(productId=>({productId})),currency:'TWD',
        callbackUrl,successRedirectUrl,cancelRedirectUrl,merchantOrderNumber,customerEmail,customerName,metadata},'totalAmount',amount);
    },
    listProductOrders:query=>api(paths.product+'/orders?'+new URLSearchParams(query))
  };
}

export function signedPortalyEvent(headers,payload,secret,time=Date.now()) {
  const event = headers.get('x-portaly-event');
  const timestamp = headers.get('x-portaly-timestamp') || '';
  const signature = headers.get('x-portaly-signature') || '';
  if (!secret||!event||!payload||event!==payload.event ||
    !/^\d{4}-\d\d-\d\dT/.test(timestamp)||!Number.isFinite(Date.parse(timestamp))||
    Math.abs(time-Date.parse(timestamp))>300000 || !/^[a-f0-9]{64}$/.test(signature) ||
    !verifyPortalyCallback({secret,payload,timestamp,signature})) fail('INVALID_SIGNATURE');
  return payload;
}
