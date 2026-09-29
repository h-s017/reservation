const NOTIFY_EMAIL = "hanasscent@gmail.com";
const TZ = "Asia/Taipei";
const BOOKING_START_AT = "2026-07-09T10:00:00+08:00";
const BOOKING_END_DATE = "2027-05-30";
const OPEN_WEEKDAYS = [0,1,2,3,4,5];
const CLOSED_WEEKDAYS = [6];
const CLOSED_DATES = ["2026-08-09","2026-08-10","2026-08-11","2026-09-03","2026-09-06","2026-09-13","2026-09-20","2026-10-07","2026-10-08","2026-10-11","2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-19","2026-10-20","2026-10-21","2026-10-23","2027-02-05","2027-02-06","2027-02-07","2027-02-08","2027-02-09","2027-02-10","2027-02-11","2027-02-12","2027-02-13","2027-02-14"];
const BLOCKED_DATES = ["2026-09-06","2026-09-13","2026-09-20","2026-10-07","2026-10-08","2026-10-11","2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-19","2026-10-20","2026-10-21","2026-10-23","2026-11-15","2026-11-22"];
const SPECIAL_DATE_TIMES = {"2026-07-17":["09:00–12:00"]};
const SPECIAL_OPEN_HOURS = {"2026-08-17":13,"2026-08-20":13,"2026-08-28":13};
const SEPTEMBER_WINDOWS = {"2026-09-01":[9,13],"2026-09-02":[14,20],"2026-09-07":[14,20],"2026-09-16":[14,20],"2026-09-21":[14,20]};
const COURSES = [
  {series:"亞洲香氛藝術大賽",course:"此域 Hineni 嗅覺敘事空間｜合作調香教室",price:0,capacity:10,unit:"位",times:["10:00–12:00","13:00–15:00","15:30–17:30","18:00–20:00"],mode:"single",contest:true,startDate:"2026-08-01",endDate:"2026-08-23"},
  {series:"心村限定｜Helori 香氣探索所",course:"單人調香探索課 10ML",price:990,capacity:10,unit:"位",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"single"},
  {series:"心村限定｜Helori 香氣探索所",course:"雙人調香探索課 10ML",price:1980,capacity:5,unit:"組",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"single"},
  {series:"心村限定｜Helori 香氣探索所",course:"單人調香探索課 50ML",price:1800,capacity:10,unit:"位",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"single"},
  {series:"心村限定｜Helori 香氣探索所",course:"雙人調香探索課 50ML",price:3600,capacity:5,unit:"組",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"single"},
  {series:"氣味藝術序曲系列",course:"Vol. 1｜一日專業調香師",price:4500,capacity:6,unit:"位",times:["10:00–16:00"],mode:"single"},
  {series:"氣味藝術序曲系列",course:"Vol. 2｜調香師的和弦練習曲",price:6500,capacity:6,unit:"位",times:["10:00–16:00"],mode:"single"},
  {series:"氣味藝術序曲系列",course:"Vol. 1 ＋ Vol. 2",price:10500,capacity:6,unit:"位",times:["10:00–16:00"],mode:"multiple",max:2,requiredSlots:2},
  {series:"氣味藝術序曲系列",course:"Vol. 0｜氣味自修室",variant:"Basic Lab｜配方練習",price:800,capacity:6,unit:"位",times:["09:00–12:00","14:00–17:00"],mode:"single"},
  {series:"氣味藝術序曲系列",course:"Vol. 0｜氣味自修室",variant:"Mini Work｜10ml 基本瓶器",price:1150,capacity:6,unit:"位",times:["09:00–12:00","14:00–17:00"],mode:"single"},
  {series:"氣味藝術序曲系列",course:"Vol. 0｜氣味自修室",variant:"Full Work｜50ml 基本瓶器",price:2080,capacity:6,unit:"位",times:["09:00–12:00","14:00–17:00"],mode:"single"},
  {series:"氣味藝術序曲系列",course:"Vol. 0｜氣味自修室",variant:"Candle Work｜蠟燭",price:1580,capacity:6,unit:"位",times:["09:00–12:00","14:00–17:00"],mode:"single"},
  {series:"韓國 KPIA 調香協會系列",course:"KPIA大韓專業調香師課程",price:39000,capacity:4,unit:"位",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"multiple",max:12,requiredSlots:12},
  {series:"韓國 KPIA 調香協會系列",course:"KPIA 專業調香師雙證書課（優惠加購無酒精香水證書）",price:44000,capacity:4,unit:"位",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"multiple",max:12,requiredSlots:12},
  {series:"韓國 KPIA 調香協會系列",course:"KPIA無酒精香水課程",price:6500,capacity:4,unit:"位",times:["10:00–15:00"],mode:"single"}
];
function doGet(e){if(e.parameter.action==="slots")return json({slots:getOpenSlots()});return json({ok:true,service:"hana-booking"});}
// Payment calls are accepted only from the Worker. Set GAS_SHARED_SECRET in
// Script Properties, matching the Worker secret; no public token can write.
const PAYMENT_HEADERS = ['Order ID','日期','時間','金額','Payment Status','NewebPay TradeNo','Created At','Paid At','Access Hash','Payment Attempts','系列','Notification State'];
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('GAS_SHARED_SECRET');
    if (!secret || secret.length < 32 || d.secret !== secret) return json({ok:false,error:'BAD_REQUEST'});
    lock.waitLock(25000);
    const sheet = paymentSheet_();
    if (d.action === 'notify') return json({ok:true,order:notifyPayment_(sheet,d)});
    if (!/^[a-f0-9]{64}$/.test(d.accessHash || '')) throw new Error('BAD_REQUEST');
    const rows = sheet.getDataRange().getValues();
    const index = rows.findIndex((r,i) => i > 0 && r[23] === d.accessHash && (!d.id || r[15] === d.id));
    if (d.action === 'create' || d.action === 'contest') {
      if (index > 0) return json({ok:true,order:orderFromRow_(rows[index])});
      return json({ok:true,order:createOrder_(sheet,d,d.action === 'contest')});
    }
    if (index < 1) throw new Error('NOT_FOUND');
    const row = rows[index], order = orderFromRow_(row);
    if (d.action === 'status') return json({ok:true,order:order});
    if (order.status === 'LINE_CONFIRMATION') throw new Error('BAD_REQUEST');
    const attempts = JSON.parse(row[24] || '[]');
    if (d.action === 'cancel') {
      if (order.status === 'PAID' || attempts.some(a => a.status === 'PENDING')) throw new Error('PAYMENT_PENDING');
      row[14] = row[19] = 'CANCELLED';
    } else if (d.action === 'checkout') {
      if (order.status === 'PAID') return json({ok:true,order:order});
      if (!attempts.length || attempts[attempts.length - 1].status === 'FAILED') {
        // Reacquire the original slots when retrying a cancelled order. The row
        // and booking ID stay unchanged; only the provider attempt ID changes.
        validateSelection_({slotIds:normalizeSlotIds({slotIds:row[2]})}, false, order.status === 'CANCELLED' ? '' : order.id);
        if (attempts.length >= 20) throw new Error('BAD_REQUEST');
        attempts.push({id:'H'+Utilities.getUuid().replace(/-/g,'').slice(0,28),status:'PENDING',timestamp:Math.floor(Date.now()/1000)});
      }
      row[14] = row[19] = 'PENDING';
      row[24] = JSON.stringify(attempts);
    } else throw new Error('BAD_REQUEST');
    sheet.getRange(index+1,1,1,row.length).setValues([row]);
    SpreadsheetApp.flush();
    return json({ok:true,order:orderFromRow_(row)});
  } catch (err) {
    const safe = ['BAD_REQUEST','SLOT_FULL','NOT_FOUND','PAYMENT_PENDING','COURSE_UNAVAILABLE'];
    return json({ok:false,error:safe.indexOf(err.message)>=0 ? err.message : 'SERVER_ERROR'});
  } finally { if (lock.hasLock()) lock.releaseLock(); }
}
function paymentSheet_() {
  const sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(),'報名',
    ['報名編號','報名時間','場次ID','場次','課程','方案','姓名','電話','Email','LINE','付款平台','舊資料保留1','舊資料保留2','備註','狀態']);
  const requiredColumns = 15 + PAYMENT_HEADERS.length;
  if (sheet.getMaxColumns() < requiredColumns) sheet.insertColumnsAfter(sheet.getMaxColumns(),requiredColumns-sheet.getMaxColumns());
  // Keep existing columns and historical rows in place. Only append new fields.
  const headers = sheet.getRange(1,16,1,PAYMENT_HEADERS.length).getValues()[0];
  if (headers.some((v,i) => v && v !== PAYMENT_HEADERS[i])) throw new Error('SCHEMA_CONFLICT');
  sheet.getRange(1,16,1,PAYMENT_HEADERS.length).setValues([PAYMENT_HEADERS]);
  return sheet;
}
function validate(d, contest) {
  ['name','phone','email','line','note'].forEach(k => d[k] = str(d[k]));
  if (d.website || !d.name || d.name.length > 50 || !/^[0-9+\-() ]{7,20}$/.test(d.phone)) throw new Error('BAD_REQUEST');
  if ((!contest && !d.email) || (d.email && (d.email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)))) throw new Error('BAD_REQUEST');
  if (d.line.length > 50 || d.note.length > 800) throw new Error('BAD_REQUEST');
}
function validateSelection_(d, contest, excludeId) {
  const ids = normalizeSlotIds(d);
  if (!ids.length || ids.length > 12 || new Set(ids).size !== ids.length || ids.some(id => id.length > 140)) throw new Error('BAD_REQUEST');
  const available = getOpenSlots(), counts = excludeId ? getBookedCounts_(excludeId) : null;
  const selected = ids.map(id => available.find(s => s.id === id));
  if (selected.some(s => !s || BLOCKED_DATES.includes(s.date) || (counts ? counts[s.id] || 0 : s.booked) >= s.capacity)) throw new Error('SLOT_FULL');
  const first = selected[0], meta = courseMeta(first.series,first.course,first.variant);
  if (!meta || !!meta.contest !== contest) throw new Error('COURSE_UNAVAILABLE');
  if (!selected.every(s => s.series === first.series && s.course === first.course && String(s.variant||'') === String(first.variant||''))) throw new Error('BAD_REQUEST');
  if ((meta.mode === 'single' && selected.length !== 1) || (meta.mode === 'multiple' && selected.length > (meta.max||8)) || (meta.requiredSlots && selected.length !== meta.requiredSlots)) throw new Error('BAD_REQUEST');
  // Mirror the existing browser rule on the server; no new booking date policy.
  if (selected.some(s => new Date(s.date+'T'+s.time.split('–')[0]+':00+08:00').getTime() < Date.now()+36*60*60*1000)) throw new Error('SLOT_FULL');
  // Use the approved course catalogue, never a client amount or a manual slot's price.
  if (!contest && (!Number.isSafeInteger(meta.price) || meta.price <= 0)) throw new Error('BAD_REQUEST');
  return {ids,selected,meta};
}
function sheetText_(s) { const v = String(s || ''); return /^[=+\-@]/.test(v) ? "'"+v : v; }
function createOrder_(sheet,d,contest) {
  validate(d,contest);
  const {ids,selected,meta} = validateSelection_(d,contest);
  const id = 'HF'+Utilities.getUuid().replace(/-/g,'').slice(0,28), now = new Date().toISOString();
  const status = contest ? 'LINE_CONFIRMATION' : 'PENDING';
  const row = [id,now,ids.join(' | '),selected.map(s=>s.date+' '+s.time).join(' / '),meta.course,meta.variant||'',
    sheetText_(d.name),"'"+d.phone,sheetText_(d.email),sheetText_(d.line),contest?'官方LINE':'NewebPay','','',sheetText_(d.note),status,
    id,selected.map(s=>s.date).join(' / '),selected.map(s=>s.time).join(' / '),meta.price,status,'',now,'',d.accessHash,'[]',meta.series,''];
  sheet.appendRow(row);
  SpreadsheetApp.flush();
  return orderFromRow_(row);
}
function orderFromRow_(r) {
  const dates = String(r[16]).split(' / '), times = String(r[17]).split(' / '), attempts = JSON.parse(r[24]||'[]');
  return {id:r[15],status:r[19],course:r[4],variant:r[5],slots:dates.map((date,i)=>({date,time:times[i]})),
    amount:Number(r[18]),name:r[6],phone:String(r[7]).replace(/^'/,''),email:r[8],line:r[9],attempt:attempts[attempts.length-1]};
}
function notifyPayment_(sheet,d) {
  if (['PAID','FAILED'].indexOf(d.status) < 0 || !Number.isSafeInteger(d.amount)) throw new Error('BAD_REQUEST');
  const rows = sheet.getDataRange().getValues();
  const index = rows.findIndex((r,i) => i > 0 && r[24] && JSON.parse(r[24]).some(a => a.id === d.merchantOrderNo));
  if (index < 1) throw new Error('NOT_FOUND');
  const row = rows[index], attempts = JSON.parse(row[24]), attempt = attempts.find(a=>a.id===d.merchantOrderNo);
  if (Number(row[18]) !== d.amount) throw new Error('BAD_REQUEST');
  if (d.status === 'PAID') {
    if (!d.tradeNo) throw new Error('BAD_REQUEST');
    if (rows.some((r,i)=>i!==index && r[20]===d.tradeNo)) throw new Error('BAD_REQUEST');
    if (row[19] === 'PAID') {
      if (row[20] !== d.tradeNo) throw new Error('BAD_REQUEST');
      return orderFromRow_(row);
    }
    // Never turn a released/retried failed attempt into an unverified booking.
    // Unexpected contradictory callbacks require reconciliation and remain non-2xx.
    if (attempt.status !== 'PENDING' || attempt !== attempts[attempts.length-1] || row[19] !== 'PENDING') throw new Error('PAYMENT_PENDING');
    attempt.status = 'PAID';
    row[14] = row[19] = 'PAID'; row[20] = d.tradeNo; row[22] = new Date().toISOString();
  } else {
    if (row[19] === 'PAID' || attempt.status === 'PAID') return orderFromRow_(row);
    attempt.status = 'FAILED';
    if (attempt === attempts[attempts.length-1] && row[19] !== 'CANCELLED') row[14] = row[19] = 'FAILED';
  }
  row[24] = JSON.stringify(attempts);
  sheet.getRange(index+1,1,1,row.length).setValues([row]);
  SpreadsheetApp.flush();
  return orderFromRow_(row);
}
// Install a time-driven trigger (every 5 minutes). Payment persistence never
// depends on email availability. Mark before sending for at-most-once delivery.
function sendBookingNotifications() {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const sheet = paymentSheet_(), rows = sheet.getDataRange().getValues();
    rows.slice(1).forEach((r,i) => {
      if (!['PAID','LINE_CONFIRMATION'].includes(r[19]) || r[26]) return;
      sheet.getRange(i+2,27).setValue('SENDING'); SpreadsheetApp.flush();
      try {
        MailApp.sendEmail({to:NOTIFY_EMAIL,subject:(r[19]==='PAID'?'【課程已付款】':'【合作教室預約】')+r[4],
          body:'訂單：'+r[15]+'\n課程：'+r[4]+'\n場次：'+r[3]+'\n狀態：'+r[19]+'\n金額：NT$ '+r[18]+'\n請至報名試算表查看聯絡資料。'});
        sheet.getRange(i+2,27).setValue('SENT');
      } catch (_) { sheet.getRange(i+2,27).setValue('CHECK_DELIVERY'); }
    });
  } finally { lock.releaseLock(); }
}

function normalizeSlotIds(d){if(Array.isArray(d.slotIds))return d.slotIds.map(x=>str(x)).filter(Boolean);if(typeof d.slotIds==="string")return d.slotIds.split(/[|,，、\s]+/).map(x=>str(x)).filter(Boolean);return d.slotId?[str(d.slotId)]:[]}
function getOpenSlots(){const today=Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd");const generated=generateSlots_();const manual=readManualSlots_();const counts=getBookedCounts_();const map={};generated.forEach(s=>map[s.id]=s);manual.forEach(s=>{if(s.status==="關閉")delete map[s.id];else if(s.status==="開放")map[s.id]=Object.assign(map[s.id]||{},s)});return Object.keys(map).map(id=>{const s=map[id];s.booked=BLOCKED_DATES.includes(s.date)?Number(s.capacity):(counts[id]||0);return s}).filter(s=>s.date>=today&&s.date<=BOOKING_END_DATE&&s.status!=="關閉"&&isSeptemberWindowOpen_(s.date,s.time))}
function generateSlots_(){const slots=[];const start=parseDate_(BOOKING_START_AT.slice(0,10));const today=new Date();today.setHours(0,0,0,0);const anchor=start>today?start:today;const end=parseDate_(BOOKING_END_DATE);for(let d=new Date(anchor);d<=end;d.setDate(d.getDate()+1)){const ds=Utilities.formatDate(d,TZ,"yyyy-MM-dd");const dow=Number(Utilities.formatDate(d,TZ,"u"))%7;if(!isDateOpen_(ds,dow))continue;COURSES.forEach(c=>{if((c.startDate&&ds<c.startDate)||(c.endDate&&ds>c.endDate))return;getCourseTimesForDate_(c,ds,dow).forEach((time,i)=>{slots.push({id:makeSlotId_(c,ds,time,i),series:c.series,course:c.course,variant:c.variant||"",date:ds,time:time,price:Number(c.price),capacity:Number(c.capacity),unit:c.unit||"位",booked:0,status:"開放"})})})}return slots}
function getCourseTimesForDate_(c,ds,dow){if(SPECIAL_DATE_TIMES[ds])return SPECIAL_DATE_TIMES[ds];return c.times.filter(time=>isTimeOpenForDate_(ds,dow,time))}
function isTimeOpenForDate_(ds,dow,time){if(ds.indexOf("2026-08-")===0){const open=SPECIAL_OPEN_HOURS[ds]||10;const close=(dow===3||dow===5)?19:20;return getStartHour_(time)>=open&&getEndHour_(time)<=close}if(ds.indexOf("2026-09-")===0)return isSeptemberWindowOpen_(ds,time);if(dow===3&&getEndHour_(time)>14)return false;return true}
function isSeptemberWindowOpen_(ds,time){if(ds.indexOf("2026-09-")!==0)return true;const w=SEPTEMBER_WINDOWS[ds];return !w||(getStartHour_(time)>=w[0]&&getEndHour_(time)<=w[1])}
function getStartHour_(time){const start=String(time).split("–")[0]||"";const hm=start.split(":").map(Number);return (hm[0]||0)+((hm[1]||0)/60)}
function getEndHour_(time){const parts=String(time).split("–");const end=parts[1]||parts[0]||"";const hm=end.split(":").map(Number);return (hm[0]||0)+((hm[1]||0)/60)}
function readManualSlots_(){const ss=SpreadsheetApp.getActiveSpreadsheet();const sheet=ss.getSheetByName("場次");if(!sheet)return[];const v=sheet.getDataRange().getValues();if(v.length<=1)return[];return v.slice(1).map(r=>({id:String(r[0]||""),series:String(r[1]||""),course:String(r[2]||""),variant:String(r[3]||""),date:r[4] instanceof Date?Utilities.formatDate(r[4],TZ,"yyyy-MM-dd"):String(r[4]||""),time:String(r[5]||""),price:Number(r[6]||0),capacity:Number(r[7]||0),unit:String(r[9]||"位"),status:String(r[8]||"")})).filter(s=>s.id)}
function getBookedCounts_(excludeId){const ss=SpreadsheetApp.getActiveSpreadsheet();const sheet=ss.getSheetByName("報名");if(!sheet)return{};const rows=sheet.getDataRange().getValues();if(rows.length<=1)return{};const c={};rows.slice(1).forEach(r=>{const raw=String(r[2]||""),status=String(r[19]||r[14]||"");if(!raw||status==="已取消"||status==="CANCELLED"||(excludeId&&r[15]===excludeId))return;raw.split(/\s*\|\s*|[,，、]/).map(x=>x.trim()).filter(Boolean).forEach(id=>c[id]=(c[id]||0)+1)});return c}
function courseMeta(series,course,variant){return COURSES.find(c=>c.series===series&&c.course===course&&String(c.variant||"")===String(variant||""))||null}
function makeSlotId_(c,date,time,i){return (slug_(c.series)+"-"+slug_(c.course)+"-"+slug_(c.variant||"")+"-"+date+"-"+String(i+1).padStart(2,"0")).slice(0,120)}
function slug_(s){return String(s).replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g,"-").replace(/^-|-$/g,"")}
function isDateOpen_(ds,dow){return CLOSED_DATES.indexOf(ds)===-1&&CLOSED_WEEKDAYS.indexOf(dow)===-1&&OPEN_WEEKDAYS.indexOf(dow)!==-1}
function parseDate_(ds){const p=String(ds).split("-").map(Number);return new Date(p[0],p[1]-1,p[2])}
function getOrCreateSheet_(ss,name,headers){let sheet=ss.getSheetByName(name);if(!sheet){sheet=ss.insertSheet(name);sheet.appendRow(headers)}return sheet}
function maskPhone(p){p=String(p||"");return p.length<=6?p:p.slice(0,4)+"***"+p.slice(-3)}
function str(x){return typeof x==="string"?x.trim():""}
function escHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function json(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
