import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.mjs';
import {fixture} from './db.mjs';
const worker='https://hana-course-production.example.test';
const workspace='https://h-s017.github.io';
const site='https://reservation.hanascent.com';
const token='a'.repeat(48);
const env=()=>({DB:fixture(),HANA_WORKSPACE_ORIGIN:workspace,SITE_ORIGIN:site,ADMIN_TOKEN:token,NEWEBPAY_ENV:'test'});
function admin(path,body={},origin=workspace,auth=token){
 return new Request(worker+'/api/admin/'+path,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
}
test('unified WORKSPACE controls public appointment availability through real Worker routes',async()=>{
 const e=env(),s=e.DB.sqlite.prepare("SELECT starts_at FROM slots WHERE id='s'").get();
 const opts=new Request(worker+'/api/admin/slots',{method:'OPTIONS',headers:{Origin:workspace,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Authorization, Content-Type'}});
 const pre=await app.fetch(opts,e);
 assert.equal(pre.status,204);
 assert.equal(pre.headers.get('Access-Control-Allow-Origin'),workspace);
 const denied=await app.fetch(admin('busy-list',{},'https://untrusted.example.test'),e);
 assert.equal(denied.status,403);
 const badtoken=await app.fetch(admin('busy-list',{},workspace,'invalid-key'),e);
 assert.equal(badtoken.status,401);
 const saved=await app.fetch(admin('busy-upsert',{title:'Meeting',start:new Date((s.starts_at+120)*1000).toISOString(),end:new Date((s.starts_at+3600)*1000).toISOString()}),e);
 assert.equal(saved.status,200);
 const body=await saved.json();assert.ok(body.ok&&body.id.startsWith('busy-'));
 const publicResult=await app.fetch(new Request(worker+'/api/slots',{headers:{Origin:site}}),e);
 assert.equal(publicResult.status,200);
 const pub=await publicResult.json();
 assert.equal(pub.slots.find(s=>s.id==='s').status,'關閉');
 assert.equal(JSON.stringify(pub).includes('Meeting'),false);
 const calendar=await app.fetch(admin('calendar-status'),e);
 assert.equal((await calendar.json()).configured,false);
 const removed=await app.fetch(admin('busy-delete',{id:body.id}),e);
 assert.equal(removed.status,200);
 const after=await app.fetch(new Request(worker+'/api/slots',{headers:{Origin:site}}),e);
 assert.equal((await after.json()).slots.find(s=>s.id==='s').status,'開放');
});
