import {equal,sha256} from './newebpay.mjs';
import {sql} from './orders.mjs';
import {eventSlug,plans,eligible} from '../../hana-event/catalogue.mjs';
import {portaly,signedPortalyEvent} from './portaly.mjs';

const fail = code => { throw new Error(code); };
const now = () => Math.floor(Date.now()/1000);
const validSlug = s => typeof s==='string' && /^[a-z0-9-]{1,50}$/.test(s);
const resStatuses = "('PROCESSING','PAID','CONFIRMED','REFUND_PENDING')";
const liveHold = "(o.status IN "+resStatuses+" OR (o.status='WAITING_PAYMENT' AND o.hold_until>unixepoch()))";
const events = {
  'creator_subscription.checkout.completed':'PAID',
  'creator_subscription.checkout.failed':'FAILED',
  'creator_subscription.payment.refunded':'REFUNDED',
  'creator_subscription.payment.refund_failed':'REVIEW'
};

function slotView(row) {
  return {...row,possible:JSON.parse(row.possible),available:JSON.parse(row.available),mixes:JSON.parse(row.mixes),
    remaining:Math.max(0,row.capacity-(row.reserved||0))};
}
async function eventRecord(db,slug) {
  if (!validSlug(slug)) fail('BAD_REQUEST');
  const event = await sql(db,'SELECT * FROM event_catalogue WHERE slug=?',slug).first();
  if (!event) fail('NOT_FOUND');
  return event;
}
export async function eventCatalogue(db,slug,admin=false) {
  const event = await eventRecord(db,slug);
  if (!event.published&&!admin) fail('NOT_FOUND');
  const [tickets,slots,partners] = await Promise.all([
    sql(db,'SELECT id,plan,type,price FROM event_tickets WHERE event_slug=? ORDER BY id',slug).all(),
    sql(db,`SELECT s.*, (SELECT COALESCE(SUM(quantity),0) FROM event_orders o
      WHERE o.event_slug=s.event_slug AND o.slot_id=s.id AND ${liveHold}) AS reserved
      FROM event_slots s WHERE event_slug=? AND (?=1 OR (status<>'closed' AND starts_at>unixepoch())) ORDER BY date,time`,slug,+admin).all(),
    sql(db,'SELECT code,name,description,logo_url FROM event_partners WHERE event_slug=? ORDER BY code',slug).all()
  ]);
  return {event,tickets:tickets.results,slots:slots.results.map(slotView),partners:partners.results};
}
export async function eventFocusSnapshot(db,slug) {
  const {event,slots} = await eventCatalogue(db,slug,true);
  return {event:{slug:event.slug,title:event.title,published:Boolean(event.published)},slots:slots.map(s=>({
    id:s.id,date:s.date,time:s.time,startsAt:s.starts_at,endsAt:s.ends_at,status:s.status,
    capacity:s.capacity,reserved:s.reserved,available:s.available,mixes:s.mixes
  }))};
}
async function orderSummary(db,row) {
  if (!row) fail('NOT_FOUND');
  const lines = await sql(db,'SELECT ticket_id,plan,label,quantity,unit_price FROM event_order_items WHERE order_id=? ORDER BY ticket_id',row.id).all();
  const {id,event_slug,slot_id,amount,quantity,status,hold_until} = row;
  return {id,event:event_slug,slot:slot_id,amount,quantity,status,holdUntil:hold_until,lines:lines.results};
}
function inputLines(lines) {
  if (!Array.isArray(lines)||!lines.length||lines.length>9) fail('BAD_REQUEST');
  const unique = new Set();
  for (const line of lines) {
    if (!line||!validSlug(String(line.id).toLowerCase())||typeof line.id!=='string'||unique.has(line.id)||
      !Number.isInteger(line.quantity)||line.quantity<1||line.quantity>20) fail('BAD_REQUEST');
    unique.add(line.id);
  }
  const quantity = lines.reduce((n,line)=>n+line.quantity,0);
  if (quantity>20) fail('BAD_REQUEST');
  return quantity;
}
const clean = (value,max) => typeof value==='string'&&value.trim().length<=max?value.trim():'';
async function owned(db,hash,id,slug) {
  const order = await sql(db,'SELECT * FROM event_orders WHERE access_hash=? AND id=? AND event_slug=?',hash,id||'',slug).first();
  if (!order) fail('NOT_FOUND');
  return order;
}
export async function createEventOrder(db,slug,hash,d) {
  const quantity = inputLines(d.lines);
  const name = clean(d.name,50), email = clean(d.email,100);
  if (!name||!/^\S+@[^\s@]+\.\S+$/.test(email)||typeof d.slot!=='string'||d.slot.length>64||d.website) fail('BAD_REQUEST');
  const existing = () => sql(db,'SELECT * FROM event_orders WHERE access_hash=?',hash).first();
  async function repeat(previous) {
    const summary = await orderSummary(db,previous);
    const original = new Map(summary.lines.map(l=>[l.ticket_id,l.quantity]));
    if (previous.event_slug!==slug||previous.slot_id!==d.slot||previous.name!==name||previous.email!==email||
      original.size!==d.lines.length||!d.lines.every(l=>original.get(l.id)===l.quantity)) fail('ORDER_CONFLICT');
    return summary;
  }
  const row = await existing();
  if (row) return repeat(row);
  const {tickets,slots} = await eventCatalogue(db,slug);
  const slot = slots.find(s=>s.id===d.slot);
  const selected = d.lines.map(({id,quantity})=>{
    const ticket = tickets.find(t=>t.id===id);
    if (!ticket) fail('BAD_REQUEST');
    return {...ticket,quantity};
  });
  if (!slot||!eligible(slot,selected.map(l=>l.plan))) fail('UNAVAILABLE');
  const mix = [...new Set(selected.map(l=>l.plan))].sort().join('');
  const amount = selected.reduce((total,l)=>total+l.price*l.quantity,0);
  if (d.quotedAmount!==undefined && d.quotedAmount!==amount) fail('PRICE_CHANGED');
  const id = 'HE'+crypto.randomUUID().replaceAll('-','');
  const status = slot.status==='interest'?'INTEREST':'WAITING_PAYMENT';
  try {
    await db.batch([
      sql(db,`INSERT INTO event_orders(id,event_slug,slot_id,access_hash,name,email,mix,quantity,amount,status,hold_until)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,id,slug,slot.id,hash,name,email,mix,quantity,amount,status,status==='INTEREST'?0:now()+1800),
      ...selected.map(l=>sql(db,`INSERT INTO event_order_items(order_id,ticket_id,plan,label,quantity,unit_price)
        VALUES(?,?,?,?,?,?)`,id,l.id,l.plan,l.type,l.quantity,l.price))
    ]);
  } catch (error) {
    const previous = await existing();
    if (previous) return repeat(previous);
    for (const code of ['SLOT_FULL','UNAVAILABLE','PRICE_CHANGED']) if (String(error).includes(code)) fail(code);
    throw error;
  }
  return orderSummary(db,await owned(db,hash,id,slug));
}

async function startEventCheckout(env,order) {
  const db = env.DB;
  if (!['WAITING_PAYMENT','PROCESSING'].includes(order.status)) fail('ORDER_CONFLICT');
  const attempt = () => sql(db,'SELECT * FROM event_payment_attempts WHERE order_id=?',order.id).first();
  const redirect = a => a?.status==='READY'&&a.expires_at>now()?{checkoutUrl:a.checkout_url}:{};
  const existing = await attempt();
  if (existing) return redirect(existing);
  if (order.hold_until<=now()) fail('ORDER_CONFLICT');

  const mock = env.EVENT_MODE==='mock';
  const mode = mock?'mock':'test';
  const gateway = mock?null:portaly(env);
  if (!env.PORTALY_CALLBACK_SECRET || (!mock&&(!httpsOrigin(env.EVENT_PUBLIC_ORIGIN)||!httpsOrigin(env.EVENT_SITE_ORIGIN)))) fail('UNCONFIGURED');
  const plan = mock?{id:'mock-event-plan'}:await gateway.eventPlan();
  const [, claim] = await db.batch([
    sql(db,`UPDATE event_orders SET status='PROCESSING' WHERE id=? AND status='WAITING_PAYMENT'
      AND hold_until>unixepoch() AND EXISTS (SELECT 1 FROM event_slots s
      JOIN event_catalogue e ON e.slug=s.event_slug WHERE s.event_slug=event_orders.event_slug
      AND s.id=event_orders.slot_id AND s.status='open' AND s.starts_at>unixepoch() AND e.published=1)`,order.id),
    sql(db,`INSERT INTO event_payment_attempts(order_id,mode,plan_id,status) SELECT id,?,?,'CREATING'
      FROM event_orders WHERE id=? AND status='PROCESSING' ON CONFLICT(order_id) DO NOTHING`,mode,plan.id,order.id)
  ]);
  if (!claim.meta.changes) {
    const current = await attempt();
    if (!current) fail('UNAVAILABLE');
    return redirect(current);
  }
  const returnUrl = env.EVENT_SITE_ORIGIN+'/'+order.event_slug+'?checkout=return#booking';
  // A network error after dispatch is ambiguous. Keep the claim and inventory until reconciled.
  const session = mock ? {
    sessionId:'sim_'+order.id,expiresAt:Date.now()+1800000,checkoutUrl:returnUrl
  } : await gateway.createPaymentSession({
    planId:plan.id,callbackUrl:env.EVENT_PUBLIC_ORIGIN+'/api/event/webhook',
    successRedirectUrl:returnUrl,cancelRedirectUrl:returnUrl,merchantOrderNumber:order.id,
    customerEmail:order.email,customerName:order.name,metadata:{tracking:JSON.stringify({event:order.event_slug,order:order.id})}
  },order.amount);
  await sql(db,`UPDATE event_payment_attempts SET status='READY',session_id=?,expires_at=?,checkout_url=?,updated_at=unixepoch()
    WHERE order_id=? AND status='CREATING'`,session.sessionId,Math.floor(session.expiresAt/1000),session.checkoutUrl,order.id).run();
  return redirect(await attempt());
}

function httpsOrigin(value) {
  try { const u = new URL(value); return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password; }
  catch { return false; }
}

async function applyEvent(db,attempt,payload) {
  const status = events[payload.event];
  const refund = payload.event.startsWith('creator_subscription.payment.refund');
  const providerId = refund?payload.orderId:payload.sessionId;
  if (!providerId||payload.amount!==attempt.amount||payload.currency!=='TWD'||payload.mode!==attempt.mode||
    payload.planId!==attempt.plan_id ||
    (!refund&&payload.sessionId!==attempt.session_id) ||
    (refund&&payload.subscriptionId!==attempt.session_id) ||
    (payload.merchantOrderNumber&&payload.merchantOrderNumber!==attempt.order_id) ||
    (refund&&payload.orderMerchantOrderNumber&&payload.orderMerchantOrderNumber!==attempt.order_id)) fail('PAYMENT_MISMATCH');
  if (status==='PAID' && (payload.status!=='completed'||!payload.paymentReference)) fail('PAYMENT_MISMATCH');
  if (status==='REFUNDED' && payload.refundedAmount!==attempt.amount) fail('PAYMENT_MISMATCH');
  const next = status==='PAID'?'PAID':status==='FAILED'?'FAILED':status==='REFUNDED'?'REFUNDED':'REFUND_PENDING';
  const from = status==='PAID'?"('PROCESSING')":status==='FAILED'?"('PROCESSING')":"('PAID','CONFIRMED','REFUND_PENDING')";
  const gate = "EXISTS(SELECT 1 FROM event_orders WHERE id=? AND status IN "+from+")";
  // Log, store the payment outcome, and update the order in a single D1 batch.
  await db.batch([
    sql(db,`INSERT INTO event_webhook_events(mode,event,provider_id,order_id) VALUES(?,?,?,?)
      ON CONFLICT(mode,event,provider_id) DO NOTHING`,attempt.mode,payload.event,providerId,attempt.order_id),
    sql(db,`UPDATE event_payment_attempts SET status=?,payment_reference=COALESCE(?,payment_reference),
      provider_order_id=COALESCE(?,provider_order_id),updated_at=unixepoch() WHERE order_id=? AND ${gate}`,
      status,payload.paymentReference||null,refund?providerId:null,attempt.order_id,attempt.order_id),
    sql(db,`UPDATE event_orders SET status=?,paid_at=CASE WHEN ?='PAID' THEN COALESCE(paid_at,unixepoch()) ELSE paid_at END,
      refunded_at=CASE WHEN ?='REFUNDED' THEN COALESCE(refunded_at,unixepoch()) ELSE refunded_at END
      WHERE id=? AND status IN ${from}`,next,next,next,attempt.order_id),
    ...((status==='PAID')?[sql(db,`UPDATE event_payment_attempts SET status='REVIEW',payment_reference=?,updated_at=unixepoch()
      WHERE order_id=? AND status IN ('EXPIRED','FAILED') AND EXISTS(SELECT 1 FROM event_orders WHERE id=? AND status IN ('CANCELLED','FAILED'))`,
      payload.paymentReference,attempt.order_id,attempt.order_id)]:[])
  ]);
}

async function handleWebhook(env,request,d) {
  const payload = signedPortalyEvent(request.headers,d,env.PORTALY_CALLBACK_SECRET);
  if (!Object.hasOwn(events,payload.event)) return {};
  const expected = env.EVENT_MODE==='mock'?'mock':'test';
  if (payload.mode!==expected) fail('PAYMENT_MISMATCH');
  const session = payload.sessionId||payload.subscriptionId;
  if (!session||typeof session!=='string') fail('PAYMENT_MISMATCH');
  const attempt = await sql(env.DB,`SELECT a.*,o.amount FROM event_payment_attempts a
    JOIN event_orders o ON o.id=a.order_id WHERE a.session_id=?`,session).first();
  if (!attempt) fail('PAYMENT_PENDING');
  await applyEvent(env.DB,attempt,payload);
  return {};
}

export async function reconcileEventOrders(env) {
  if (!['mock','test'].includes(env.EVENT_MODE)) return;
  const db = env.DB;
  await sql(db,`UPDATE event_orders SET status='CANCELLED' WHERE status='WAITING_PAYMENT' AND hold_until<=unixepoch()`).run();
  const rows = (await sql(db,`SELECT a.*,o.amount FROM event_payment_attempts a JOIN event_orders o ON o.id=a.order_id
    WHERE a.status='READY' AND a.expires_at<=unixepoch() AND a.mode=? ORDER BY a.updated_at LIMIT 20`,env.EVENT_MODE).all()).results;
  for (const a of rows) {
    try {
      const session = a.mode==='mock'?{status:'expired',amount:a.amount,merchantOrderNumber:a.order_id}:await portaly(env).getPaymentSession(a.session_id);
      if (session.merchantOrderNumber!==a.order_id||session.amount!==a.amount) continue;
      if (['expired','failed'].includes(session.status)) {
        const status = session.status==='expired'?'EXPIRED':'FAILED';
        await db.batch([
          sql(db,`UPDATE event_payment_attempts SET status=?,updated_at=unixepoch() WHERE order_id=? AND status='READY'`,status,a.order_id),
          sql(db,`UPDATE event_orders SET status=? WHERE id=? AND status='PROCESSING'
            AND EXISTS (SELECT 1 FROM event_payment_attempts WHERE order_id=? AND status=?)`,
            status==='EXPIRED'?'CANCELLED':'FAILED',a.order_id,a.order_id,status)
        ]);
      } else if (session.status==='completed' && session.plan?.id===a.plan_id && session.plan?.currency==='TWD') {
        await db.batch([
          sql(db,"UPDATE event_payment_attempts SET status='PAID',updated_at=unixepoch() WHERE order_id=? AND status='READY'",a.order_id),
          sql(db,`INSERT INTO event_order_actions(order_id,action,reference)
            SELECT ?,'RECONCILED_PAID',? WHERE changes()=1`,a.order_id,a.session_id),
          sql(db,`UPDATE event_orders SET status='PAID',paid_at=COALESCE(paid_at,unixepoch()) WHERE id=?
            AND status='PROCESSING' AND EXISTS(SELECT 1 FROM event_payment_attempts a WHERE a.order_id=? AND a.status='PAID')`,a.order_id,a.order_id)
        ]);
      } else {
        // A provider-initiated or completed checkout requires reconciliation before releasing inventory.
        await sql(db,"UPDATE event_payment_attempts SET updated_at=unixepoch() WHERE order_id=? AND status='READY'",a.order_id).run();
      }
    } catch {
      await sql(db,"UPDATE event_payment_attempts SET updated_at=unixepoch() WHERE order_id=? AND status='READY'",a.order_id).run();
    }
  }
}

const allowedTimes = {'10:00':180,'13:00':120,'14:00':180,'16:00':120};
function slotDefinition(date,time,teamMask) {
  if (typeof date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(date)||!Object.hasOwn(allowedTimes,time)||
    !Number.isInteger(teamMask)||teamMask<0||teamMask>7) fail('BAD_REQUEST');
  const day = new Date(date+'T12:00:00Z');
  if (!Number.isFinite(+day)||day.toISOString().slice(0,10)!==date||[1,6].includes(day.getUTCDay())) fail('BAD_REQUEST');
  const starts = Date.parse(date+'T'+time+':00+08:00')/1000;
  const possible = Object.keys(plans).filter(p=>plans[p].times.includes(time));
  return {id:date+'-'+time,starts,ends:starts+allowedTimes[time]*60,possible,available:possible.filter(p=>(teamMask&plans[p].teams)===plans[p].teams)};
}
function imageUrl(value) {
  if (!value) return '';
  if (typeof value!=='string'||value.length>600||(!/^\/(?:assets\/)?[\w.-]+$/.test(value)&&!/^https:\/\//.test(value))) fail('BAD_REQUEST');
  return value;
}
async function eventAdmin(db,d) {
  const event = await eventRecord(db,d.event);
  const slug = event.slug;
  if (d.action==='catalogue') return eventCatalogue(db,slug,true);
  if (d.action==='event') {
    const title = clean(d.title,100), english = clean(d.englishTitle,120);
    if (!title||!english||typeof d.published!=='boolean') fail('BAD_REQUEST');
    await sql(db,'UPDATE event_catalogue SET title=?,english_title=?,poster_url=?,published=? WHERE slug=?',title,english,imageUrl(d.posterUrl),+d.published,slug).run();
  } else if (d.action==='partner') {
    const name = clean(d.name,100), description = clean(d.description,300);
    if (!validSlug(d.code)||!name) fail('BAD_REQUEST');
    await sql(db,`INSERT INTO event_partners(event_slug,code,name,description,logo_url) VALUES(?,?,?,?,?)
      ON CONFLICT(event_slug,code) DO UPDATE SET name=excluded.name,description=excluded.description,logo_url=excluded.logo_url`,
      slug,d.code,name,description,imageUrl(d.logoUrl)).run();
  } else if (d.action==='price') {
    if (typeof d.id!=='string'||!Number.isSafeInteger(d.price)||d.price<=0||d.price>1000000) fail('BAD_REQUEST');
    if (!(await sql(db,'UPDATE event_tickets SET price=? WHERE event_slug=? AND id=?',d.price,slug,d.id).run()).meta.changes) fail('NOT_FOUND');
  } else if (d.action==='slot') {
    const slot = slotDefinition(d.date,d.time,d.teamMask);
    if (d.date<event.starts_on||d.date>event.ends_on||!['interest','open','closed'].includes(d.status)||
      !Number.isInteger(d.capacity)||d.capacity<0||d.capacity>100||!Array.isArray(d.mixes)||d.mixes.length>7) fail('BAD_REQUEST');
    const mixes = [...new Set(d.mixes)];
    if (mixes.some(m=>typeof m!=='string'||!/^(A?B?C?)$/.test(m)||!m||![...m].every(p=>slot.available.includes(p)))
      || (d.status==='open'&&(!d.capacity||!mixes.length||slot.starts<=now()))) fail('UNAVAILABLE');
    try {
      await db.batch([
        sql(db,`INSERT INTO event_slots(event_slug,id,date,time,starts_at,ends_at,team_mask,possible,available)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(event_slug,id) DO NOTHING`,slug,slot.id,d.date,d.time,slot.starts,slot.ends,d.teamMask,JSON.stringify(slot.possible),JSON.stringify(slot.available)),
        sql(db,`UPDATE event_slots SET team_mask=?,possible=?,available=?,mixes=?,capacity=?,status=?,ends_at=? WHERE event_slug=? AND id=?`,
          d.teamMask,JSON.stringify(slot.possible),JSON.stringify(slot.available),JSON.stringify(mixes),d.capacity,d.status,slot.ends,slug,slot.id)
      ]);
    } catch (e) {
      for (const code of ['CAPACITY_CONFLICT','TIME_CONFLICT']) if (String(e).includes(code)) fail(code);
      throw e;
    }
  } else if (d.action==='orders') {
    const cursor = Math.max(0,Number.isInteger(d.offset)?d.offset:0);
    const rows = (await sql(db,`SELECT o.id,o.slot_id,o.name,o.email,o.mix,o.quantity,o.amount,o.status,o.created_at,
      o.paid_at,o.refunded_at,a.status AS payment_status,a.session_id,a.payment_reference,
      (SELECT json_group_array(json_object('ticket',i.ticket_id,'plan',i.plan,'label',i.label,'quantity',i.quantity,'unit_price',i.unit_price))
       FROM event_order_items i WHERE i.order_id=o.id) AS items,
      (SELECT json_group_array(json_object('action',h.action,'reason',h.reason,'reference',h.reference,'at',h.created_at))
       FROM event_order_actions h WHERE h.order_id=o.id) AS history
      FROM event_orders o LEFT JOIN event_payment_attempts a ON a.order_id=o.id WHERE o.event_slug=?
      ORDER BY o.created_at DESC,o.id LIMIT 51 OFFSET ?`,slug,cursor).all()).results;
    return {orders:rows.slice(0,50).map(o=>({...o,items:JSON.parse(o.items),history:JSON.parse(o.history)})),hasMore:rows.length>50};
  } else if (d.action==='order') {
    const from = {WAITING_PAYMENT:['INTEREST'],CONFIRMED:['PAID'],CANCELLED:['WAITING_PAYMENT','INTEREST','FAILED'],REFUND_PENDING:['PAID','CONFIRMED']};
    if (!Object.hasOwn(from,d.status)||typeof d.id!=='string'||d.id.length>50) fail('BAD_REQUEST');
    const reason = clean(d.reason,240);
    if (d.status!=='CONFIRMED'&&!reason) fail('BAD_REQUEST');
    try {
      const [updated] = await db.batch([
        sql(db,`UPDATE event_orders SET status=?,hold_until=CASE WHEN ?='WAITING_PAYMENT' THEN unixepoch()+1800 ELSE hold_until END
          WHERE id=? AND event_slug=? AND status IN (${from[d.status].map(()=>'?').join(',')})`,d.status,d.status,d.id,slug,...from[d.status]),
        sql(db,'INSERT INTO event_order_actions(order_id,action,reason) SELECT ?,?,? WHERE changes()=1',d.id,d.status,reason)
      ]);
      if (!updated.meta.changes) fail('ORDER_CONFLICT');
    } catch (error) {
      for (const code of ['UNAVAILABLE','SLOT_FULL','PRICE_CHANGED']) if (String(error).includes(code)) fail(code);
      throw error;
    }
  } else fail('BAD_REQUEST');
  return {};
}

export async function eventRequest(request,env) {
  const url = new URL(request.url), operation = url.pathname.split('/').at(-1);
  const admin = operation==='admin', webhook = operation==='webhook';
  const headers = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  const reply = (data,status=200) => Response.json(data,{status,headers});
  if (!['mock','test'].includes(env.EVENT_MODE)) return reply({error:'UNCONFIGURED'},503);
  if (!webhook) {
    const origin = admin?url.origin:env.EVENT_SITE_ORIGIN;
    if (!origin||request.headers.get('Origin')!==origin) return reply({error:'UNAUTHORIZED'},403);
    Object.assign(headers,{'Access-Control-Allow-Origin':origin,Vary:'Origin'});
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,
      'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
  }
  if (request.method!=='POST') return reply({error:'METHOD_NOT_ALLOWED'},405);
  const token = (request.headers.get('Authorization')||'').replace(/^Bearer /,'');
  if (admin) {
    if (!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32||!equal(token,env.ADMIN_TOKEN)) return reply({error:'UNAUTHORIZED'},401);
  }
  try {
    const raw = await request.text();
    if (raw.length>16000) return reply({error:'BAD_REQUEST'},413);
    const d = JSON.parse(raw);
    if (!d||typeof d!=='object'||Array.isArray(d)) fail('BAD_REQUEST');
    if (webhook) return reply({ok:true,...await handleWebhook(env,request,d)});
    if (admin) return reply({ok:true,...await eventAdmin(env.DB,d)});
    const slug = d.event || eventSlug;
    if (operation==='catalogue') return reply({...await eventCatalogue(env.DB,slug),mode:env.EVENT_MODE});
    if (!/^[a-f0-9]{64}$/.test(token)) return reply({error:'UNAUTHORIZED'},401);
    const hash = await sha256(token);
    if (operation==='orders') return reply({order:await createEventOrder(env.DB,slug,hash,d)});
    if (!['status','checkout','cancel'].includes(operation)) return reply({error:'NOT_FOUND'},404);
    const order = await owned(env.DB,hash,d.id,slug);
    if (operation==='checkout') return reply(await startEventCheckout(env,order));
    if (operation==='cancel') {
      const [cancelled] = await env.DB.batch([
        sql(env.DB,"UPDATE event_orders SET status='CANCELLED' WHERE id=? AND status IN ('INTEREST','WAITING_PAYMENT','FAILED')",order.id),
        sql(env.DB,"INSERT INTO event_order_actions(order_id,action,reason) SELECT ?,'CANCELLED','customer' WHERE changes()=1",order.id)
      ]);
      if (!cancelled.meta.changes&&order.status!=='CANCELLED') fail('ORDER_CONFLICT');
    }
    return reply({order:await orderSummary(env.DB,await owned(env.DB,hash,d.id,slug))});
  } catch (error) {
    const codes = {BAD_REQUEST:400,NOT_FOUND:404,INVALID_SIGNATURE:401,PAYMENT_PENDING:503,
      PAYMENT_MISMATCH:409,ORDER_CONFLICT:409,PRICE_CHANGED:409,SLOT_FULL:409,UNAVAILABLE:409,
      UNCONFIGURED:503,PORTALY_UNAVAILABLE:503,PORTALY_RESPONSE_INVALID:503,CAPACITY_CONFLICT:409,TIME_CONFLICT:409};
    const code = error instanceof SyntaxError?'BAD_REQUEST':Object.hasOwn(codes,error.message)?error.message:'SERVICE_UNAVAILABLE';
    return reply({error:code},codes[code]||503);
  }
}
