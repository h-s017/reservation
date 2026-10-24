import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture} from './db.mjs';
import {createOrder} from '../src/orders.mjs';
const origin='https://h-s017.github.io',workerUrl='https://worker.example.test';
const apiToken='n'.repeat(40);
const request=(path,originValue=origin,bearer=apiToken)=>new Request(workerUrl+path,{
 method:'POST',headers:{Origin:originValue,Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:'{}'
});
test('notification admin API is private and safely disabled without provider authorization',async()=>{
 const DB=fixture();await createOrder(DB,'b'.repeat(64),{slotIds:['s'],name:'Synthetic',phone:'0912345678',email:'synthetic@example.test'});
 const env={DB,ADMIN_TOKEN:apiToken,HANA_WORKSPACE_ORIGIN:origin,SITE_ORIGIN:'https://reservation.hanascent.com',NOTIFICATIONS_ENABLED:'false'};
 for(const path of ['/api/admin/notifications','/api/admin/notifications-dispatch']){
  assert.equal((await worker.fetch(request(path,'https://untrusted.example.test'),env)).status,403);
  assert.equal((await worker.fetch(request(path,origin,'wrong'),env)).status,401);
 }
 const status=await worker.fetch(request('/api/admin/notifications'),env);
 assert.equal(status.status,200);
 const data=await status.json();
 assert.equal(data.ok,true);assert.equal(data.enabled,false);
 assert.equal(data.configured.line,false);assert.equal(data.configured.email,false);
 assert.equal(data.pending,2);
 assert.equal(JSON.stringify(data).includes('synthetic@example.test'),false);
 const send=await worker.fetch(request('/api/admin/notifications-dispatch'),env);
 assert.equal(send.status,200);
 assert.equal((await send.json()).sent,0);
 assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM notification_deliveries WHERE status=\'PENDING\'').get().n,2);
});
