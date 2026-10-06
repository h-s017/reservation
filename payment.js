// Configure only the public Worker URL in C.PAYMENT_API. Credentials never live here.
let paymentSession = null, paymentOrder = null, paymentPoll = null;
const paymentStorageKey = 'hana-payment-v1';
function sessionForPayment() {
  if (!paymentSession) {
    paymentSession = {token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')};
    sessionStorage.setItem(paymentStorageKey,JSON.stringify(paymentSession));
  }
  return paymentSession;
}
async function paymentAPI(path,data={}) {
  if (C.PAYMENT_API && !/^https:\/\//.test(C.PAYMENT_API)) throw new Error('線上付款尚未開放，請聯繫官方 LINE。');
  const session=sessionForPayment();
  const r=await fetch(C.PAYMENT_API.replace(/\/$/,'')+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify(data)});
  const j=await r.json();
  if(!r.ok||!j.ok){const messages={SLOT_FULL:'此場次已額滿或已超過預約期限，請重新選擇。',PAYMENT_PENDING:'付款結果尚在確認中，請先更新付款狀態。',BAD_REQUEST:'請確認姓名、手機、Email 與場次資料。',NOT_FOUND:'找不到此訂單，請聯繫官方 LINE。',CONFIGURATION:'線上付款尚未開放，請聯繫官方 LINE。'};const error=new Error(messages[j.error]||'暫時無法確認訂單，請稍後重試。');error.code=j.error;throw error;}
  if(j.order){paymentOrder=j.order;paymentSession.id=j.order.id;sessionStorage.setItem(paymentStorageKey,JSON.stringify(paymentSession));}
  return j;
}
function renderRegistration() {
  $('registrationFields').hidden=false;$('contestFields').hidden=true;
  $('step4Title').textContent='填寫報名資料';$('toStep5').disabled=false;
  $('toStep5').textContent='確認訂單';$('toStep5').onclick=prepareOrder;
}
function orderDetails(order,contacts=false) {
  return '課程：'+esc(order.course)+(order.variant?'<br>方案：'+esc(order.variant):'')+
    order.slots.map(s=>'<br>日期：'+esc(s.date)+'<br>時間：'+esc(s.time)).join('')+
    '<br>金額：'+money(order.amount)+'<br>訂單編號：'+esc(order.id)+
    (contacts?'<br><br>姓名：'+esc(order.name)+'<br>手機：'+esc(order.phone)+'<br>Email：'+esc(order.email)+'<br>LINE：'+esc(order.line||'未填寫'):'');
}
async function prepareOrder() {
  if(!validateSlots())return;
  const payload={slotIds:S.slots.map(s=>s.id),name:$('fName').value.trim(),phone:$('fPhone').value.trim(),email:$('fEmail').value.trim(),line:$('fLine').value.trim(),note:$('fNote').value.trim(),website:$('fWebsite').value};
  if(!payload.name||!/^[0-9+\-() ]{7,20}$/.test(payload.phone)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)){showMsg('請填寫姓名、有效手機與 Email。');return;}
  $('toStep5').disabled=true;
  try {
    const {order}=await paymentAPI('/orders',payload);
    $('summary5').innerHTML=orderDetails(order,true);$('editOrder').onclick=editOrder;
    $('paymentMsg').classList.remove('show');show(5);
  } catch(e){showMsg(e.message);} finally{$('toStep5').disabled=false;}
}
async function editOrder() {
  $('editOrder').disabled=true;
  try {
    await paymentAPI('/orders/cancel',{id:paymentOrder.id});
    paymentSession=null;paymentOrder=null;sessionStorage.removeItem(paymentStorageKey);show(4);
  } catch(e){paymentMessage(e.message);} finally{$('editOrder').disabled=false;}
}
function paymentMessage(text) {const m=$('paymentMsg');m.textContent=text;m.classList.add('show');}
async function submitPayment() {
  $('submitBtn').disabled=true;$('retryPayment').disabled=true;
  try {
    const {payment,order}=await paymentAPI('/orders/checkout',{id:paymentSession.id});
    if(order.status==='PAID'||order.transfer){renderPaymentResult(order);return;}
    if(!payment||!['https://ccore.newebpay.com/MPG/mpg_gateway','https://core.newebpay.com/MPG/mpg_gateway'].includes(payment.action))throw new Error('無法開啟付款頁，請稍後重試。');
    // Provider fields are generated server-side and used only for this form POST.
    const form=document.createElement('form');form.method='POST';form.action=payment.action;
    for(const [key,value] of Object.entries(payment.fields)){const input=document.createElement('input');input.type='hidden';input.name=key;input.value=value;form.appendChild(input);}
    document.body.appendChild(form);form.submit();form.remove();
  } catch(e){paymentMessage(e.message);if($('stepDone').classList.contains('show'))$('doneBody').textContent=e.message;}
  finally{$('submitBtn').disabled=false;$('retryPayment').disabled=false;}
}
function renderPaymentResult(order) {
  clearTimeout(paymentPoll);
  const transfer=order.transfer;const paid=order.status==='PAID',failed=['FAILED','CANCELLED'].includes(order.status);
  $('doneTitle').textContent=paid?'報名完成':failed?'付款未完成':transfer?(transfer.expired?'繳費期限已過':'待轉帳付款'):'付款確認中';
  $('paymentCheck').hidden=!paid;$('paymentCheck').style.display=paid?'flex':'none';$('paymentCheck').textContent=paid?'✓':'';
  $('doneId').textContent=order.id;
  $('doneBody').innerHTML=(paid?'✓ 已完成付款<br>您的報名與場次已確認。':failed?'付款未完成，您可以沿用原訂單重新付款。':'尚未收到付款成功確認，請勿重複付款。若已扣款，請稍候更新付款狀態或聯繫官方 LINE。')+
    (transfer&&!paid&&!failed?'<br><br>轉帳銀行：'+esc(transfer.bankCode)+'<br>虛擬帳號：'+esc(transfer.account)+'<br>繳費期限：'+esc(new Date(transfer.deadline*1000).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))+'<br>請於期限內完成轉帳，入帳確認後才完成報名。逾期請勿轉帳。':'')+'<br><br>'+orderDetails(order)+'<br><br>如有課程相關問題，請透過官方 LINE 聯繫。';
  $('checkPayment').hidden=paid;$('checkPayment').onclick=refreshPayment;
  $('retryPayment').hidden=paid||Boolean(transfer&&!failed);$('retryPayment').textContent=failed?'重新付款':'繼續原訂單付款';$('retryPayment').onclick=submitPayment;
  if(['REFUND_PENDING','REFUNDED'].includes(order.cancellation_status)){
    const refunded=order.cancellation_status==='REFUNDED';
    $('doneTitle').textContent=refunded?'報名已取消':'取消申請處理中';
    $('paymentCheck').hidden=true;$('paymentCheck').style.display='none';
    $('doneBody').innerHTML=(refunded?'店家已確認全額退款，報名已取消。':'已提出取消申請，退款尚待店家確認。')+'<br><br>'+orderDetails(order)+'<br><br>如有問題，請聯繫官方 LINE。';
    $('retryPayment').hidden=true;$('checkPayment').hidden=refunded;
  }
  show('Done');
}
async function refreshPayment() {
  $('checkPayment').disabled=true;
  try{const {order}=await paymentAPI('/orders/status',{id:paymentSession.id});renderPaymentResult(order);}
  catch(e){$('doneBody').textContent=e.message;}
  finally{$('checkPayment').disabled=false;}
}
function finishContest(order) {
  $('checkPayment').hidden=true;$('retryPayment').hidden=true;$('paymentCheck').style.display='none';
  $('doneTitle').textContent='預約資料已送出';$('doneId').textContent=order.id;
  $('doneBody').textContent='HANA 已收到您的預約通知。請加入官方 LINE，傳送報名編號與預約資訊；收到教室回覆「預約完成」後，才算完成合作教室預約。';show('Done');
}
function savedPaymentSession(){
  try{const session=JSON.parse(sessionStorage.getItem(paymentStorageKey)||'null');return session&&/^[a-f0-9]{64}$/.test(session.token)?session:null;}catch(_){return null;}
}
function openOrderLookup(){
  clearTimeout(paymentPoll);paymentSession=savedPaymentSession();
  $('lookupMessage').textContent=paymentSession?'可使用此分頁保留的訂單紀錄查詢最新狀態。':'此分頁沒有可查詢的訂單紀錄。請回到原報名分頁，或聯繫官方 LINE 協助查詢。';
  $('lookupOrder').hidden=!paymentSession;$('lookupOrder').disabled=false;
  show('Orders');
}
$('myOrders').onclick=e=>{e.preventDefault();openOrderLookup();};
$('lookupBack').onclick=()=>{clearTimeout(paymentPoll);show(1);};
$('lookupOrder').onclick=async()=>{
  paymentSession=savedPaymentSession();if(!paymentSession){openOrderLookup();return;}
  $('lookupOrder').disabled=true;$('lookupMessage').textContent='正在查詢訂單…';
  try{const {order}=await paymentAPI('/orders/status',{id:paymentSession.id});if(order.status==='LINE_CONFIRMATION')finishContest(order);else renderPaymentResult(order);}
  catch(e){$('lookupMessage').textContent=e.message;}
  finally{$('lookupOrder').disabled=false;}
};
async function restorePayment() {
  if(new URLSearchParams(location.search).has('orders')){openOrderLookup();return;}
  try{paymentSession=JSON.parse(sessionStorage.getItem(paymentStorageKey)||'null');}catch(_){paymentSession=null;}
  if(!paymentSession){
    if(new URLSearchParams(location.search).has('payment')){$('doneTitle').textContent='確認付款狀態';$('paymentCheck').style.display='none';$('doneBody').textContent='此瀏覽器沒有原訂單資訊。請使用原報名分頁，或透過官方 LINE 提供訂單編號查詢；請勿重複付款。';show('Done');}
    return;
  }
  try {
    const {order}=await paymentAPI('/orders/status',{id:paymentSession.id});
    if(order.status==='LINE_CONFIRMATION'){finishContest(order);return;}
    renderPaymentResult(order);
    if(order.status==='PENDING') {
      // Resume the same provider attempt, never create another booking on return.
      $('retryPayment').hidden=Boolean(order.transfer);$('retryPayment').textContent='繼續原訂單付款';
      let checks=0;
      const poll=async()=>{await refreshPayment();if(paymentOrder.status==='PENDING'&&++checks<12)paymentPoll=setTimeout(poll,5000);};
      paymentPoll=setTimeout(poll,5000);
    }
  } catch(e){if(e.code==='NOT_FOUND'&&!paymentSession.id){paymentSession=null;sessionStorage.removeItem(paymentStorageKey);show(1);return;}$('doneTitle').textContent='確認付款狀態';$('paymentCheck').style.display='none';$('doneBody').textContent=e.message;$('checkPayment').hidden=false;$('checkPayment').onclick=refreshPayment;show('Done');}
}
