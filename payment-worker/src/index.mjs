import {checkout, sha256, verifyNotification} from './newebpay.mjs';

async function gas(env, action, data = {}) {
  if (!env.GAS_SHARED_SECRET || env.GAS_SHARED_SECRET.length < 32 || !/^https:\/\/script.google.com\/macros\/s\/[^/]+\/exec$/.test(env.GAS_URL || '')) throw new Error('CONFIGURATION');
  const response = await fetch(env.GAS_URL, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...data, action, secret: env.GAS_SHARED_SECRET}), redirect: 'follow', signal: AbortSignal.timeout(25000)});
  if (!response.ok) throw new Error('SERVICE_UNAVAILABLE');
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || 'SERVICE_UNAVAILABLE');
  return result;
}
function publicOrder(order) {
  const {id, status, course, variant, slots, amount, name, phone, email, line} = order;
  return {id, status, course, variant, slots, amount, name, phone, email, line};
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'};
    const reply = (data, status = 200) => Response.json(data, {status, headers});
    // The return body is deliberately ignored; this route cannot mutate an order.
    if (url.pathname === '/payment/return' && ['GET', 'POST'].includes(request.method))
      return new Response(null, {status: 303, headers: {...headers, Location: env.SITE_ORIGIN + '/?payment=return'}});
    if (url.pathname === '/payment/notify' && request.method === 'POST') {
      try {
        const raw = await request.text();
        if (raw.length > 40000) return reply({ok: false}, 413);
        const notification = await verifyNotification(new URLSearchParams(raw), env);
        await gas(env, 'notify', notification);
        return new Response('SUCCESS', {headers});
      } catch (_) {
        // Non-2xx prompts a provider retry, including when Sheets is unavailable.
        // Never log encrypted payloads, credentials, card fields, or raw errors.
        return reply({ok: false, error: 'NOTIFICATION_NOT_ACCEPTED'}, 503);
      }
    }
    if (request.headers.get('Origin') !== env.SITE_ORIGIN) return reply({ok: false}, 403);
    headers['Access-Control-Allow-Origin'] = env.SITE_ORIGIN;
    headers.Vary = 'Origin';
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...headers,
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization'}});
    if (request.method !== 'POST') return reply({ok: false}, 405);
    try {
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
      if (!/^[a-f0-9]{64}$/.test(token)) return reply({ok: false}, 401);
      const raw = await request.text();
      if (raw.length > 10000) return reply({ok: false}, 413);
      const d = JSON.parse(raw);
      const accessHash = await sha256(token);
      if (url.pathname === '/orders' || url.pathname === '/contest') {
        // Explicit allowlist: amount, payment status, trade number, etc. are never trusted.
        const {slotIds, name, phone, email, line, note, website} = d;
        const result = await gas(env, url.pathname === '/contest' ? 'contest' : 'create', {accessHash, slotIds, name, phone, email, line, note, website});
        return reply({ok: true, order: publicOrder(result.order)});
      }
      if (['/orders/status', '/orders/cancel', '/orders/checkout'].includes(url.pathname)) {
        const action = {'/orders/status': 'status', '/orders/cancel': 'cancel', '/orders/checkout': 'checkout'}[url.pathname];
        const result = await gas(env, action, {accessHash, id: d.id});
        const payment = action === 'checkout' && result.order.status === 'PENDING' ? await checkout(result.order, env) : undefined;
        return reply({ok: true, order: publicOrder(result.order), payment});
      }
      return reply({ok: false}, 404);
    } catch (err) {
      const allowed = ['BAD_REQUEST', 'SLOT_FULL', 'NOT_FOUND', 'PAYMENT_PENDING', 'COURSE_UNAVAILABLE', 'CONFIGURATION'];
      const error = allowed.includes(err.message) ? err.message : 'SERVICE_UNAVAILABLE';
      return reply({ok: false, error}, error === 'SERVICE_UNAVAILABLE' || error === 'CONFIGURATION' ? 503 : 409);
    }
  }
};
