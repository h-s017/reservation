const byId = id => document.getElementById(id);
const [auth,info,partners,prices,slots] = ['auth','info','partners','prices','slots'].map(byId);
const notice = byId('notice');
let token, catalogue, offset = 0;
const states = {INTEREST:'待團隊確認',WAITING_PAYMENT:'待付款',PROCESSING:'付款處理中',PAID:'已付款',
  CONFIRMED:'已確認預約',CANCELLED:'已取消',FAILED:'付款失敗',REFUND_PENDING:'退款處理中',REFUNDED:'已退款'};
async function api(action, details={}) {
  const response = await fetch('/api/event/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({event:'heart-village',action,...details})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function showError(error) {
  const messages = {UNAUTHORIZED:'管理密鑰無效。',UNCONFIGURED:'活動 API 尚未啟用。',TIME_CONFLICT:'該時段與其他開放或有占位的梯次重疊。',UNAVAILABLE:'請核對團隊出席、混搭組合及梯次狀態。',CAPACITY_CONFLICT:'名額不可少於目前已保留的人數。'};
  notice.textContent = messages[error.message]||'操作未完成（'+error.message+'）。';
}
function fill(form,values) {
  for (const [name,value] of Object.entries(values)) {
    const control = form.elements.namedItem(name);
    if (control.type==='checkbox') control.checked = value;
    else control.value = value;
  }
}
function fillPartner() {
  const p = catalogue.partners.find(row=>row.code===byId('partner').value);
  fill(partners,{name:p.name,description:p.description,logoUrl:p.logo_url});
}
function fillPrice() {
  const t = catalogue.tickets.find(row=>row.id===byId('ticket').value);
  fill(prices,{price:t.price});
}
function fillSlot() {
  const slot = catalogue.slots.find(row=>row.id===byId('slot').value);
  fill(slots,slot?{date:slot.date,time:slot.time,capacity:slot.capacity,mixes:slot.mixes.join(','),status:slot.status}:
    {date:'',time:'10:00',capacity:0,mixes:'',status:'interest'});
  for (const checkbox of slots.querySelectorAll('[name=team]')) checkbox.checked = Boolean(Number(checkbox.value)&(slot?.team_mask||0));
}
async function loadCatalogue() {
  catalogue = await api('catalogue');
  const e = catalogue.event;
  fill(info,{title:e.title,englishTitle:e.english_title,posterUrl:e.poster_url,published:Boolean(e.published)});
  const menu = (id,options) => {
    const previous = byId(id).value;
    byId(id).replaceChildren(...options);
    if (options.some(option=>option.value===previous)) byId(id).value = previous;
  };
  menu('partner',catalogue.partners.map(p=>new Option(p.name,p.code)));
  menu('ticket',catalogue.tickets.map(t=>new Option(t.plan+' '+t.type,t.id)));
  menu('slot',[new Option('新增梯次',''),...catalogue.slots.map(s=>new Option(s.date+' '+s.time+' · '+s.status+' · 已留 '+s.reserved,s.id))]);
  fillPartner();
  fillPrice();
  fillSlot();
}
async function loadOrders() {
  const {orders,hasMore} = await api('orders',{offset});
  const nodes = orders.map(o=>{
    const article = document.createElement('article'), heading = document.createElement('h3'), details = document.createElement('p'),
      items = document.createElement('p'), audit = document.createElement('p');
    heading.textContent = o.slot_id+' · '+(states[o.status]||o.status);
    details.textContent = [o.id,o.name,o.email,'NT$'+o.amount,o.payment_status,o.session_id,o.payment_reference].filter(Boolean).join(' · ');
    items.textContent = o.items.map(l=>l.plan+' '+l.label+' × '+l.quantity+'（NT$'+l.unit_price+'／位）').join('、');
    audit.textContent = o.history.map(h=>(states[h.action]||h.action)+' '+h.reason).join('；');
    article.append(heading,details,items,audit);
    if (o.refunded_at) {
      const refund = document.createElement('p');
      refund.textContent = '退款已確認 · '+new Date(o.refunded_at*1000).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
      article.append(refund);
    }
    const options = {INTEREST:['WAITING_PAYMENT','CANCELLED'],WAITING_PAYMENT:['CANCELLED'],FAILED:['CANCELLED'],
      PAID:['CONFIRMED','REFUND_PENDING'],CONFIRMED:['REFUND_PENDING']}[o.status]||[];
    if (options.length) {
      const form = document.createElement('form'), select = document.createElement('select');
      const reason = document.createElement('input'), button = document.createElement('button');
      select.setAttribute('aria-label','新狀態');
      select.replaceChildren(...options.map(v=>new Option(states[v],v)));
      reason.placeholder = '處理原因';
      reason.setAttribute('aria-label','處理原因');
      reason.maxLength = 240;
      button.textContent = '更新';
      form.append(select,reason,button);
      form.onsubmit = async event=>{
        event.preventDefault();
        button.disabled = true;
        try {
          await api('order',{id:o.id,status:select.value,reason:reason.value});
          await loadOrders();
          notice.textContent = '已更新預約。';
        } catch (error) {showError(error);}
        finally {button.disabled = false;}
      };
      article.append(form);
    }
    return article;
  });
  byId('orders').replaceChildren(...nodes);
  if (!nodes.length) byId('orders').textContent = '這一頁沒有預約。';
  byId('next').hidden = !hasMore;
}
auth.onsubmit = async e=>{
  e.preventDefault();
  token = byId('token').value;
  byId('token').value = '';
  try {
    await loadCatalogue();
    await loadOrders();
    auth.hidden = true;
    byId('dashboard').hidden = false;
    notice.textContent = '';
  } catch (error) {token=undefined;showError(error);}
};
byId('logout').onclick = ()=>location.reload();
byId('partner').onchange = fillPartner;
byId('ticket').onchange = fillPrice;
byId('slot').onchange = fillSlot;
byId('refresh').onclick = ()=>{offset=0;loadOrders().catch(showError);};
byId('next').onclick = ()=>{offset+=50;loadOrders().catch(showError);};
for (const [form,action] of [[info,'event'],[partners,'partner'],[prices,'price'],[slots,'slot']]) {
  form.onsubmit = async e=>{
    e.preventDefault();
    const fields = new FormData(form), data = Object.fromEntries(fields);
    if (form===info) data.published = fields.has('published');
    if (form===prices) data.price = Number(data.price);
    if (form===slots) {
      data.capacity = Number(data.capacity);
      data.teamMask = fields.getAll('team').reduce((mask,value)=>mask|Number(value),0);
      data.mixes = data.mixes.split(/[,，\s]+/).map(x=>x.toUpperCase()).filter(Boolean);
    }
    try {
      await api(action,data);
      await loadCatalogue();
      notice.textContent = '已儲存。';
    } catch (error) {showError(error);}
  };
}
