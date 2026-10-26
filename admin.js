let adminKey='',currentOrders=[],currentSlots=[],calendarData={dates:[],slots:[],courses:[]},selectedDate='',calendarMonth=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}).slice(0,7);
const el=id=>document.getElementById(id);
async function api(path,data={}){const r=await fetch('/api/admin/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+adminKey},body:JSON.stringify(data)});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'暫時無法處理');return j;}
async function run(fn){try{el('message').textContent='處理中…';await fn();el('message').textContent='已更新';}catch(e){el('message').textContent=e.message;}}
function cell(row,text){const td=document.createElement('td');td.textContent=text??'';row.appendChild(td);return td;}
function heading(names){el('head').replaceChildren();const r=document.createElement('tr');for(const name of names){const th=document.createElement('th');th.textContent=name;r.appendChild(th);}el('head').appendChild(r);el('rows').replaceChildren();}
async function orders(before,beforeId){
  const j=await api('orders',before?{before,beforeId}:{});currentOrders=j.orders;heading(['訂單／建立時間','課程／場次','聯絡資料','金額／付款','操作']);
  for(const o of j.orders){const row=document.createElement('tr');cell(row,o.id+'\n'+new Date(o.created_at*1000).toLocaleString('zh-TW'));cell(row,o.course+'\n'+o.variant+'\n'+(o.quantity||1)+' '+(o.booking_unit||'位')+'\n'+o.sessions);cell(row,[o.name,o.phone,o.email,o.line,o.note].join('\n'));cell(row,'NT$ '+o.amount+'\n'+o.status+'\n'+(o.trade_no||''));const actions=cell(row,'');refundActions(o,actions);
    if(['PENDING','FAILED'].includes(o.status)){const b=document.createElement('button');b.textContent='取消未付款訂單';b.onclick=()=>run(async()=>{if(!confirm('取消此未付款訂單並釋放名額？未決交易會被拒絕。'))return;await api('cancel',{id:o.id});await orders();});actions.appendChild(b);}el('rows').appendChild(row);}
  el('older').hidden=j.orders.length<200;el('older').onclick=()=>run(()=>orders(j.orders[j.orders.length-1].created_at,j.orders[j.orders.length-1].id));
}
function renderSlots(){heading(['課程','場次','已保留／容量','狀態／操作']);el('older').hidden=true;
  for(const s of currentSlots.filter(s=>!el('filter').value||s.date===el('filter').value)){
    const row=document.createElement('tr');cell(row,s.course+'\n'+s.variant);cell(row,s.date+'\n'+s.time);const cap=cell(row,s.booked+' / '),input=document.createElement('input');input.type='number';input.min=Math.max(1,s.booked);input.max=100;input.value=s.capacity;cap.appendChild(input);
    const actions=cell(row,s.status);for(const [text,status] of [['儲存容量',s.status==='關閉'?'CLOSED':'OPEN'],[s.status==='關閉'?'開放場次':'關閉場次',s.status==='關閉'?'OPEN':'CLOSED']]){const b=document.createElement('button');b.textContent=text;b.onclick=()=>run(async()=>{await api('slot',{id:s.id,status,capacity:Number(input.value)});await slots();});actions.appendChild(b);}el('rows').appendChild(row);
  }
}
async function slots(){currentSlots=(await api('slots',{from:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'})})).slots;renderSlots();}
function dayState(ds){
  const blocked=calendarData.dates.some(x=>x.date===ds),slots=calendarData.slots.filter(x=>x.date===ds);
  return {blocked,slots,available:slots.filter(x=>x.bookable),full:slots.filter(x=>!x.bookable)};
}
async function loadCalendar(){
  calendarData=await api('calendar',{month:calendarMonth});
  renderCalendar();renderDateDetails();
}
function renderCalendar(){
  const [year,month]=calendarMonth.split('-').map(Number),first=new Date(year,month-1,1),length=new Date(year,month,0).getDate();
  el('monthTitle').textContent=year+' 年 '+month+' 月';
  const grid=el('monthGrid');grid.replaceChildren();
  for(let i=0;i<first.getDay();i++){const blank=document.createElement('span');blank.className='cal-blank';grid.append(blank);}
  for(let d=1;d<=length;d++){
    const ds=calendarMonth+'-'+String(d).padStart(2,'0'),state=dayState(ds),b=document.createElement('button');
    b.type='button';b.className='cal-day'+(state.blocked?' blocked':state.available.length?' available':' unavailable')+(selectedDate===ds?' selected':'');
    b.textContent=d+'日';const note=document.createElement('small');
    note.textContent=state.blocked?'手動禁約':state.available.length?'可預約 '+state.available.length+' 場':state.slots.length?'無可預約場次':'未設定場次';
    b.append(note);b.onclick=()=>{selectedDate=ds;el('date').value=ds;renderCalendar();renderDateDetails();};grid.append(b);
  }
}
function renderDateDetails(){
  if(!selectedDate){el('dateDetails').hidden=true;return;}
  el('dateDetails').hidden=false;el('selectedDateTitle').textContent=selectedDate+'｜日期管理';
  const s=dayState(selectedDate);
  el('selectedDateState').textContent=s.blocked?'目前：手動禁約':s.available.length?'目前：可預約 '+s.available.length+' 場':s.slots.length?'目前：全部場次不可預約':'目前：尚無場次';
  const select=el('newCourse'),saved=select.value;select.replaceChildren();
  for(const c of calendarData.courses.filter(x=>x.enabled)){
    const option=document.createElement('option');option.value=c.id;option.textContent=[c.series,c.course,c.variant].filter(Boolean).join('｜');select.append(option);
  }
  if([...select.options].some(x=>x.value===saved))select.value=saved;
  const list=el('dateSlots');list.replaceChildren();
  for(const slot of s.slots){
    const line=document.createElement('div');line.className='cal-slot';
    const label=document.createElement('span');label.textContent=[slot.time,slot.course,slot.variant,slot.booked+'/'+slot.capacity,slot.bookable?'可預約':'不可預約'].filter(Boolean).join('｜');line.append(label);
    const toggle=document.createElement('button');toggle.type='button';toggle.textContent=slot.status==='OPEN'?'關閉場次':'開放場次';
    toggle.onclick=async()=>{if(!confirm('修改 '+slot.time+' 場次？'))return;await run(async()=>{await api('slot',{id:slot.id,status:slot.status==='OPEN'?'CLOSED':'OPEN',capacity:slot.capacity});await loadCalendar();});};
    line.append(toggle);list.append(line);
  }
}
el('calendarTab').onclick=()=>run(loadCalendar);
el('monthPrev').onclick=()=>{const [y,m]=calendarMonth.split('-').map(Number);calendarMonth=new Date(y,m-2,1).toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}).slice(0,7);run(loadCalendar);};
el('monthNext').onclick=()=>{const [y,m]=calendarMonth.split('-').map(Number);calendarMonth=new Date(y,m,1).toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}).slice(0,7);run(loadCalendar);};
el('newSlotForm').onsubmit=e=>{e.preventDefault();run(async()=>{
  if(!selectedDate)throw new Error('請先選擇日期');
  if(!confirm('新增 '+selectedDate+' '+el('newTime').value+' 的場次？'))return;
  await api('create-slot',{date:selectedDate,time:el('newTime').value,courseId:el('newCourse').value,capacity:Number(el('newCapacity').value)});
  await loadCalendar();
});};
el('date').onchange=()=>{selectedDate=el('date').value;calendarMonth=selectedDate.slice(0,7);run(loadCalendar);};
el('login').onsubmit=e=>{e.preventDefault();adminKey=el('key').value;run(async()=>{await orders();await loadCalendar();el('key').value='';el('login').hidden=true;el('panel').hidden=false;});};
el('logout').onclick=()=>{adminKey='';currentOrders=[];currentSlots=[];el('rows').replaceChildren();el('panel').hidden=true;el('login').hidden=false;};
el('orders').onclick=()=>run(()=>orders());el('slots').onclick=()=>run(slots);el('filter').onchange=()=>run(slots);
async function setDateClosed(closed){
  const date=el('date').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){el('message').textContent='請先選擇有效日期';return;}
  if(!confirm((closed?'關閉':'開放')+' '+date+' 整日預約？'+(closed?'已成立訂單不受影響。':'此操作只解除手動禁約，其他場次與行程限制仍生效。')))return;
  const buttons=[el('closeDate'),el('openDate')];buttons.forEach(b=>b.disabled=true);
  try{
    await api('date',{date,closed});
    await slots();await loadCalendar();
    el('message').textContent=date+(closed?' 已設定整日禁約。':' 已移除手動整日禁約；實際可預約時段仍依其他規則判定。');
  }catch(e){el('message').textContent=e.message;}
  finally{buttons.forEach(b=>b.disabled=false);}
}
el('dateForm').onsubmit=e=>{e.preventDefault();setDateClosed(true);};
el('openDate').onclick=()=>setDateClosed(false);
el('export').onclick=()=>{const keys=['id','course','variant','sessions','name','phone','email','line','note','amount','quantity','unit_price','booking_unit','status','trade_no','created_at','paid_at','cancellation_status','cancellation_reason','refund_reference','refund_requested_at','refunded_at'];const safe=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';const csv='\uFEFF'+[keys,...currentOrders.map(o=>keys.map(k=>o[k]))].map(r=>r.map(safe).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='course-orders.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};

function refundActions(o,actions){
  if(o.status!=='PAID')return;
  const state=o.cancellation_status||'NONE',label=document.createElement('p');
  label.textContent=state==='REFUNDED'?'已取消／店家已確認全額退款':state==='REFUND_PENDING'?'取消申請／待退款':'已付款';actions.appendChild(label);
  if(state==='REFUNDED')return;
  const b=document.createElement('button');b.textContent=state==='NONE'?'申請取消／退款':'確認已全額退款';
  b.onclick=()=>run(async()=>{
    if(state==='NONE'){
      const reason=prompt('請輸入取消原因。此操作只登記申請，不會退還款項或釋放名額。');if(!reason?.trim())return;
      await api('refund-request',{id:o.id,reason});
    }else{
      const reference=prompt('請先完成實際全額退款，再輸入退款交易編號或可核對的退款紀錄識別碼（勿填銀行帳號）。');if(!reference?.trim())return;
      const amount=prompt('請輸入實際已退還的全額金額：NT$ '+o.amount);if(amount===null)return;
      if(!confirm('確認訂單 '+o.id+' 已實際退還 NT$ '+o.amount+'？此操作將取消報名並釋放名額，不會替你匯款，且無法在此復原。'))return;
      await api('refund-confirm',{id:o.id,reference,amount:Number(amount),confirmed:true});
    }
    await orders();
  });actions.appendChild(b);
}
