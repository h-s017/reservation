import {eventSlug,plans,tickets,format,candidates,eligible} from './catalogue.mjs';
import {attendance} from './availability.mjs';
import {apiOrigin} from './config.mjs';

const id = key => document.getElementById(key);
const form = id('form'), date = id('date'), time = id('time'), submit = id('submit'), result = id('result');
const preview = {tickets,slots:candidates(attendance),mode:'preview'};
let catalogue = preview, lastOrder, pending = false, fingerprint, access;
const key = 'hana-event:'+eventSlug;
const duration = {A:'約 2.5–3 小時',B:'調香約 90 分鐘，另含換裝',C:'攝影約 20–30 分鐘，另含換裝'};
const states = {INTEREST:'待團隊確認',WAITING_PAYMENT:'待付款',PROCESSING:'付款處理中',PAID:'已付款',
  CONFIRMED:'已確認預約',CANCELLED:'已取消',FAILED:'付款未完成',REFUND_PENDING:'退款處理中',REFUNDED:'已退款'};
const messages = {SLOT_FULL:'該梯次名額已不足，請選擇其他梯次。',UNAVAILABLE:'梯次狀態已變更，請重新讀取活動頁。',
  UNCONFIGURED:'此環境尚未啟用結帳。',PRICE_CHANGED:'票價已更新，請重新整理並確認明細。',
  ORDER_CONFLICT:'這筆預約目前無法進行此操作。請重新查詢狀態。'};

for (const [plan,p] of Object.entries(plans)) {
  const article = document.createElement('article'), group = document.createElement('div');
  article.className = 'tile';
  article.innerHTML = '<span class="num"></span><h3></h3><p></p><div class="price"></div><div class="rates-list"></div><p><button type="button">選擇此方案</button></p>';
  article.querySelector('.num').textContent = 'PLAN '+plan;
  article.querySelector('h3').textContent = p.name;
  const planInfo = article.querySelector('p'), detail = document.createElement('small');
  detail.textContent = duration[plan];
  planInfo.append(p.includes,document.createElement('br'),detail);
  article.querySelector('.price').id = 'from-'+plan;
  article.querySelector('button').addEventListener('click',()=>{
    const input = id('qty-'+plan+'1');
    if (!input.valueAsNumber) input.value = 1;
    update();
    location.hash = 'booking';
    input.focus({preventScroll:true});
  });
  id('cards').append(article);
  const h = document.createElement('h3');
  h.textContent = plan+'｜'+p.name;
  group.append(h);
  for (const ticket of tickets.filter(t=>t.plan===plan)) {
    const row = document.createElement('div');
    row.className = 'rates';
    row.innerHTML = '<span></span><strong></strong>';
    row.firstChild.textContent = ticket.type;
    row.lastChild.id = 'display-'+ticket.id;
    article.querySelector('.rates-list').append(row);

    const label = document.createElement('label'), title = document.createElement('span'), price = document.createElement('small'), qty = document.createElement('input');
    title.textContent = ticket.type;
    price.id = 'price-'+ticket.id;
    Object.assign(qty,{id:'qty-'+ticket.id,type:'number',min:0,max:20,value:0,required:true,inputMode:'numeric'});
    qty.setAttribute('aria-label',plan+' '+p.name+' '+ticket.type+'人數');
    qty.setAttribute('aria-describedby',price.id);
    label.append(title,price,qty);
    group.append(label);
  }
  id('quantities').append(group);
}
function lines() {
  return catalogue.tickets.map(t=>({...t,quantity:id('qty-'+t.id).valueAsNumber}))
    .filter(t=>Number.isInteger(t.quantity)&&t.quantity>0&&t.quantity<=20);
}
function selectOptions(control,placeholder,options) {
  const selected = control.value;
  control.replaceChildren(new Option(placeholder,''),...options);
  if (options.some(option=>option.value===selected)) control.value = selected;
  control.disabled = !options.length;
}
function update() {
  const selected = lines(), count = selected.reduce((n,l)=>n+l.quantity,0), price = selected.reduce((n,l)=>n+l.quantity*l.price,0);
  catalogue.tickets.forEach(t=>{
    id('price-'+t.id).textContent = format(t.price);
    id('display-'+t.id).textContent = format(t.price);
  });
  for (const plan of Object.keys(plans)) id('from-'+plan).textContent = format(Math.min(...catalogue.tickets.filter(t=>t.plan===plan).map(t=>t.price)))+' 起';
  id('lines').replaceChildren(...selected.map(l=>{
    const li = document.createElement('li');
    li.textContent = l.plan+' '+plans[l.plan].name+' · '+l.type+' × '+l.quantity+' · '+format(l.price*l.quantity);
    return li;
  }));
  id('total').textContent = '預估合計 '+format(price);
  const slots = count<=20 ? catalogue.slots.filter(s=>eligible(s,selected.map(t=>t.plan))&&(s.status==='interest'||s.remaining>=count)) : [];
  selectOptions(date,'請選擇日期',[...new Set(slots.map(s=>s.date))].map(d=>new Option(d,d)));
  selectOptions(time,'請選擇時段',slots.filter(s=>s.date===date.value).map(s=>new Option(s.time+' · '+(s.status==='open'?'可預約':'預約意向'),s.id)));
  const slot = slots.find(s=>s.id===time.value);
  const connected = catalogue.mode!=='preview';
  id('contact').hidden = !connected||!slot;
  id('name').required = connected&&!!slot;
  id('email').required = connected&&!!slot;
  const hasTeam = slot&&selected.every(t=>slot.available.includes(t.plan));
  id('slot-note').textContent = count>20?'每筆訂單最多 20 位。':count&&!slots.length?'目前沒有相容梯次，請調整方案或人數。':
    slot?.status==='interest'?(hasTeam?'團隊與現場接待量仍待確認。此梯次僅接受預約意向。':'所選方案涉及的合作團隊仍待確認。此梯次僅接受預約意向。'):'';
  submit.disabled = !slot||!connected||pending;
  submit.textContent = !connected?'預覽不開放送出':slot?.status==='open'?'確認訂單並前往測試結帳':'送出預約意向';
}
function message(str) {
  result.textContent = str;
  result.focus();
}
async function api(action,data,token) {
  const response = await fetch(apiOrigin+'/api/event/'+action,{
    method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    body:JSON.stringify({event:eventSlug,...data})
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error);
  return json;
}
function show(order) {
  id('order-actions').hidden = false;
  id('pay-order').hidden = !['WAITING_PAYMENT','PROCESSING'].includes(order.status);
  id('cancel-order').hidden = !['WAITING_PAYMENT','INTEREST','FAILED'].includes(order.status);
  message('訂單 '+order.id+' · '+(states[order.status]||'待核對')+'\n金額 '+format(order.amount));
}
async function orderAction(action) {
  if (!lastOrder||pending) return;
  pending = true;
  update();
  try {
    const data = await api(action,{id:lastOrder.id},lastOrder.token);
    if (data.checkoutUrl) {
      location.assign(data.checkoutUrl);
      return;
    }
    if (data.order) show(data.order);
    else message('付款工作階段正在處理。請稍後重新查詢，訂單 '+lastOrder.id+'。');
  } catch (e) {message(messages[e.message]||'暫時無法讀取訂單。');}
  finally {pending=false;update();}
}
id('check-order').onclick = ()=>orderAction('status');
id('pay-order').onclick = ()=>orderAction('checkout');
id('cancel-order').onclick = ()=>{if (confirm('確定取消這筆預約？')) orderAction('cancel');};
form.addEventListener('input',e=>{
  if (e.target.id.startsWith('qty-')||e.target===date||e.target===time) update();
});
form.addEventListener('submit',async e=>{
  e.preventDefault();
  if (pending||submit.disabled) return;
  const selected = lines();
  const data = {slot:time.value,name:id('name').value,email:id('email').value,
    lines:selected.map(({id,quantity})=>({id,quantity})),quotedAmount:selected.reduce((n,l)=>n+l.price*l.quantity,0)};
  const selection = JSON.stringify(data);
  if (selection!==fingerprint) {
    fingerprint = selection;
    access = Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  pending = true;
  update();
  let checkout = false;
  try {
    const {order} = await api('orders',data,access);
    lastOrder = {id:order.id,token:access};
    sessionStorage.setItem(key,JSON.stringify(lastOrder));
    show(order);
    checkout = ['WAITING_PAYMENT','PROCESSING'].includes(order.status);
  } catch (e) {message(messages[e.message]||'暫時無法送出，請稍後再試。');}
  finally {pending=false;update();}
  if (checkout) await orderAction('checkout');
});
async function load() {
  id('booking-note').textContent = '此頁為活動預覽。梯次僅供查詢。週一、週六不排活動，開放梯次依執行團隊公告。';
  if (apiOrigin) {
    try {
      catalogue = await api('catalogue',{});
      id('booking-note').textContent = '此為測試站，請使用測試資料。待團隊確認的梯次只收預約意向，測試結帳不會扣款。';
      lastOrder = JSON.parse(sessionStorage.getItem(key)||'null');
      const poster = document.querySelector('.hero img');
      if (catalogue.event.poster_url) poster.src = catalogue.event.poster_url;
      document.title = catalogue.event.title+'｜旗袍・調香・攝影';
      const heading = document.querySelector('.hero h1');
      if (heading.textContent!==catalogue.event.title) heading.textContent = catalogue.event.title;
      const english = document.querySelector('.hero h3+p');
      if (english.innerText.replace(/\s+/g,' ').toLowerCase()!==catalogue.event.english_title.toLowerCase()) {
        english.textContent = catalogue.event.english_title.toUpperCase();
      }
      catalogue.partners.forEach(p=>{
        const article = document.querySelector('[data-partner="'+CSS.escape(p.code)+'"]');
        if (!article) return;
        article.querySelector('h3').textContent = p.name;
        article.querySelector('p').textContent = p.description;
        const mark = article.querySelector('img');
        if (mark && p.logo_url) mark.src = p.logo_url;
      });
      if (lastOrder) await orderAction('status');
    } catch {id('booking-note').textContent = '預約服務暫時無法連線。目前顯示梯次預覽。';}
  }
  update();
}
update();
load();
