import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../src/index.mjs';
import {signPortalyCallback} from '../src/vendor/portaly-signature.mjs';
import {database} from './db.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.EVENT_PLAYWRIGHT||'playwright');
const root = fileURLToPath(new URL('../../hana-event/',import.meta.url));
const artifacts = resolve(process.env.EVENT_EVIDENCE||'test-results/hana-event');
const DB = database();
DB.sqlite.exec(await readFile(new URL('../migrations/0013_hana_event.sql',import.meta.url),'utf8'));
DB.sqlite.exec(execFileSync(process.execPath,[fileURLToPath(new URL('../../scripts/build-event-seed.mjs',import.meta.url))],{encoding:'utf8'}));
DB.sqlite.exec(`UPDATE event_catalogue SET published=1;
  UPDATE event_slots SET status='open',capacity=3,mixes='["A","C","AC"]' WHERE id='2026-12-18-10:00';`);
const secret = 'browser test fixture';
const adminToken = 'qa'.repeat(24);
const env = {DB,EVENT_MODE:'mock',PORTALY_CALLBACK_SECRET:secret,ADMIN_TOKEN:adminToken};
let connected = false;
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server = createServer(async (req,res)=>{
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await worker.fetch(new Request(env.EVENT_SITE_ORIGIN+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks)}),env);
      res.writeHead(response.status,Object.fromEntries(response.headers)).end(await response.text());
      return;
    }
    if (path==='/config.mjs'&&connected) {
      res.writeHead(200,{'Content-Type':'text/javascript'}).end('export const apiOrigin = location.origin;');
      return;
    }
    const isAdmin = ['/event-admin.html','/event-admin.js','/admin.css'].includes(path);
    const folder = isAdmin?resolve(root,'..'):resolve(root);
    const requested = resolve(folder,'.'+(path==='/'||path==='/heart-village'?'/heart-village.html':path));
    if (!requested.startsWith(folder+sep)) {res.writeHead(404).end();return;}
    const payload = await readFile(requested);
    res.writeHead(200,{'Content-Type':mime[extname(requested)]||'application/octet-stream'}).end(payload);
  } catch (e) {res.writeHead(e.code==='ENOENT'?404:500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = 'http://127.0.0.1:'+server.address().port;
env.EVENT_SITE_ORIGIN = base;
await mkdir(artifacts,{recursive:true});
const browser = await chromium.launch({
  headless:true, ...(process.env.EVENT_CHROMIUM?{executablePath:process.env.EVENT_CHROMIUM}:{})
});
async function mixed(page) {
  for(const ticket of ['A1','A2','C3']) await page.locator('#qty-'+ticket).fill('1');
  await page.getByText('預估合計 NT$6,100',{exact:true}).waitFor();
  assert.equal(await page.locator('#lines li').count(),3);
  await page.locator('#date').selectOption('2026-12-18');
  assert.deepEqual(await page.locator('#time option').evaluateAll(os=>os.map(o=>o.value)),['','2026-12-18-10:00']);
  await page.locator('#time').selectOption('2026-12-18-10:00');
}

try {
  for (const width of [320,390,820,1440]) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',ignoreHTTPSErrors:true});
    const page = await context.newPage(), errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/heart-village',{waitUntil:'networkidle'});
    await page.locator('h1').waitFor();
    assert.deepEqual(await page.locator('img').evaluateAll(imgs=>imgs.map(img=>img.complete&&img.naturalWidth>0)),[true,true,true]);
    assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily),/Cormorant Garamond.*Noto Serif TC/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('.mobile-reserve').isVisible(),width<721);
    await page.screenshot({path:resolve(artifacts,'heart-village-'+width+'.png')});
    await mixed(page);
    assert.equal(await page.locator('#submit').isDisabled(),true);
    await page.locator('#contact').waitFor({state:'hidden'});
    await page.locator('#booking').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('PASS template and mixed booking at '+width+'px');
    await context.close();
  }

  connected = true;
  const context = await browser.newContext({viewport:{width:390,height:900},ignoreHTTPSErrors:true});
  const page = await context.newPage();
  await page.goto(base+'/heart-village',{waitUntil:'networkidle'});
  await page.getByText('此為測試站',{exact:false}).waitFor();
  await mixed(page);
  await page.locator('#name').fill('瀏覽器測試');
  await page.locator('#email').fill('browser@example.test');
  await Promise.all([page.waitForURL('**/*checkout=return*'),page.locator('#submit').click()]);
  await page.getByText('付款處理中',{exact:false}).waitFor();
  const order = DB.sqlite.prepare('SELECT * FROM event_orders').get();
  const attempt = DB.sqlite.prepare('SELECT * FROM event_payment_attempts').get();
  assert.equal(order.amount,6100);
  assert.equal(order.status,'PROCESSING');
  const payload = {event:'creator_subscription.checkout.completed',mode:'mock',sessionId:attempt.session_id,planId:attempt.plan_id,
    merchantOrderNumber:order.id,status:'completed',paymentReference:'browser-fixture',amount:6100,currency:'TWD'};
  const timestamp = new Date().toISOString();
  const response = await fetch(base+'/api/event/webhook',{method:'POST',headers:{'content-type':'application/json',
    'x-portaly-event':payload.event,'x-portaly-timestamp':timestamp,
    'x-portaly-signature':signPortalyCallback({secret,timestamp,payload})},body:JSON.stringify(payload)});
  assert.equal(response.status,200);
  await page.locator('#check-order').click();
  await page.getByText('已付款',{exact:false}).waitFor();
  await page.screenshot({path:resolve(artifacts,'heart-village-mock-paid.png'),fullPage:true});
  await page.goto(base+'/event-admin.html');
  await page.locator('#token').fill(adminToken);
  await page.getByRole('button',{name:'登入'}).click();
  await page.locator('#orders').getByText('NT$6100',{exact:false}).waitFor();
  await context.close();
  await writeFile(resolve(artifacts,'result.txt'),'PASS 320/390/820/1440 widths, template images and fonts, NT$6,100, slot filtering, SQLite order, mock checkout return, signed webhook, admin view.\n');
  console.log('PASS browser → Reservation Worker → SQLite → mock checkout → signed webhook → admin');
} finally {
  await browser.close();
  server.close();
}
