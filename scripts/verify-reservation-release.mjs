// Read public assets and slots only. Anonymous admin POST is rejected before any business action.
import assert from 'node:assert/strict';
const origin='https://hana-course-production.hana-reservation-payment.workers.dev';
for(const [asset,marker] of [['/admin','開放整日預約'],['/admin.js',"el('openDate').onclick"],['/admin.css','']]){
 const r=await fetch(origin+asset+'?release='+encodeURIComponent(process.env.GITHUB_SHA||'manual'),{headers:{'Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(r.status,200,asset);assert.ok((await r.text()).includes(marker),asset);console.log('PASS: '+asset+' serves the expected admin release.');
}
const slotsResponse=await fetch(origin+'/api/slots',{headers:{'User-Agent':'HANA-Deployment-Readonly/1.0'},signal:AbortSignal.timeout(20000)});assert.equal(slotsResponse.status,200);const slots=await slotsResponse.json();assert.equal(slots.ok,true);assert.ok(Array.isArray(slots.slots));console.log('PASS: public reservation inventory remains readable ('+slots.slots.length+' slots).');
for(const route of ['/api/admin/orders','/api/admin/date']){const r=await fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});assert.equal(r.status,401,route);console.log('PASS: '+route+' rejects anonymous access.');}
console.log('No live login, order creation, payment, callback, date opening or database write was performed by these checks.');
