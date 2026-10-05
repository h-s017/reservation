const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/PAYMENT_API:'[^']*'/,"PAYMENT_API:'https://payment.example.com'");
const vm=require('vm');const fixedTime=Date.parse('2026-09-29T02:00:00Z');class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[fixedTime]));}static now(){return fixedTime;}}const ctx=vm.createContext({Date:FixtureDate});vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);const slotFixture=JSON.parse(vm.runInContext('JSON.stringify(generateSlots())',ctx));
const server=http.createServer((req,res)=>{
  const file=req.url.split('?')[0];
  if(file==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(file==='/payment.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'payment.js')));return;}
  if(/^\/assets\/[a-z-]+\.svg$/.test(file)){res.setHeader('Content-Type','image/svg+xml');res.end(fs.readFileSync(path.join(root,file)));return;}
  res.writeHead(404);res.end();
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  try {
    for(const width of [390,1280]){
      const context=await browser.newContext({viewport:{width,height:900}});
      const page=await context.newPage(),errors=[];let status='PENDING',creates=0,checkoutCalls=0;
      page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install({time:new Date('2026-09-29T02:00:00Z')});
      await page.route('https://script.google.com/**',r=>r.fulfill({json:{slots:[]}}));
      const order={id:'HF1234567890123456789012345678',status,course:'單人調香探索課 10ML',variant:'',slots:[{date:'2026-10-01',time:'09:00–11:00'}],amount:990,name:'測試報名',phone:'0912345678',email:'test@example.com',line:'test-line'};
      await page.route('https://payment.example.com/**',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.pathname==='/api/slots'){await route.fulfill({headers:{'Access-Control-Allow-Origin':base},json:{slots:slotFixture}});return;}
        if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'authorization,content-type'}});return;}
        if(url.pathname==='/orders')creates++;
        if(url.pathname==='/orders/checkout')checkoutCalls++;
        const payment=url.pathname==='/orders/checkout'?{action:'https://ccore.newebpay.com/MPG/mpg_gateway',fields:{MerchantID:'TEST_ONLY',TradeInfo:'synthetic',TradeSha:'synthetic',Version:'2.0'}}:undefined;
        await route.fulfill({headers:{'Access-Control-Allow-Origin':base},json:{ok:true,order:{...order,status},payment}});
      });
      await page.route('https://ccore.newebpay.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Mock NewebPay</h1>'}));
      await page.goto(base);
      await page.getByRole('button',{name:/心村限定/}).click();
      await page.getByRole('button',{name:/單人調香探索課 10ML/}).click();
      await page.locator('#nextM').click();
      await page.locator('[data-date="2026-10-01"]').click();
      await page.locator('[data-slot]').first().click();
      await page.locator('#toStep4').click();
      await page.locator('#fName').fill(order.name);await page.locator('#fPhone').fill(order.phone);await page.locator('#fEmail').fill(order.email);await page.locator('#fLine').fill(order.line);
      await page.locator('#toStep5').click();await page.locator('#step5.show').waitFor();
      assert.match(await page.locator('#summary5').innerText(),/NT\$ 990/);
      assert.equal(await page.getByText('報名完成',{exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`confirmation-${width}.png`),fullPage:true});}
      await page.locator('#submitBtn').click();await page.getByRole('heading',{name:'Mock NewebPay'}).waitFor();
      await page.goto(base+'/?payment=return');await page.getByRole('heading',{name:'付款確認中'}).waitFor();
      assert.equal(await page.locator('#paymentCheck').isVisible(),false);assert.equal(creates,1);
      status='FAILED';await page.locator('#checkPayment').click();await page.getByRole('heading',{name:'付款未完成'}).waitFor();
      await page.getByRole('button',{name:'重新付款',exact:true}).click();await page.getByRole('heading',{name:'Mock NewebPay'}).waitFor();assert.equal(creates,1);assert.equal(checkoutCalls,2);
      status='PENDING';order.transfer={bankCode:'004',account:'TestAccount12345',deadline:Date.parse('2026-09-29T23:59:59+08:00')/1000,expired:false};
      await page.goto(base+'/?payment=return');await page.getByRole('heading',{name:'待轉帳付款',exact:true}).waitFor();
      assert.match(await page.locator('#doneBody').innerText(),/TestAccount12345/);
      assert.equal(await page.getByRole('button',{name:'重新付款',exact:true}).isVisible(),false);
      assert.equal(await page.locator('#paymentCheck').isVisible(),false);
      order.transfer.expired=true;await page.locator('#checkPayment').click();await page.getByRole('heading',{name:'繳費期限已過',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'重新付款',exact:true}).isVisible(),false);
      assert.equal(creates,1);assert.equal(checkoutCalls,2);
      status='PAID';await page.goto(base+'/?payment=return');await page.getByRole('heading',{name:'報名完成',exact:true}).waitFor();
      assert.equal(await page.locator('#paymentCheck').isVisible(),true);assert.match(await page.locator('#doneBody').innerText(),/您的報名與場次已確認/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
      if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`paid-${width}.png`),fullPage:true});
      console.log(`PASS ${width}px: registration, confirmation, gateway, pending, failed, retry, ATM issued/expired, paid; no JS errors or horizontal overflow`);
      await context.close();
    }
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
