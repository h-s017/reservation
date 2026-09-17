const NOTIFY_EMAIL = "hanasscent@gmail.com";
const API_TOKEN = "請改成一串自訂亂碼例如hf-2026-x7k9q2"; // legacy only; do not use as a payment secret
const DRIVE_FOLDER = "報名繳費憑證";
const RETENTION_MONTHS = 12;
const TZ = "Asia/Taipei";
const BOOKING_START_AT = "2026-07-09T10:00:00+08:00";
const BOOKING_END_DATE = "2027-05-30";
const HOLD_MINUTES = 20;
const OPEN_WEEKDAYS = [0,1,2,3,4,5];
const CLOSED_WEEKDAYS = [6];
const CLOSED_DATES = ["2026-08-09","2026-08-10","2026-08-11","2026-09-03","2026-09-06","2026-09-13","2026-09-20","2027-02-05","2027-02-06","2027-02-07","2027-02-08","2027-02-09","2027-02-10","2027-02-11","2027-02-12","2027-02-13","2027-02-14"];
const BLOCKED_DATES = ["2026-09-06","2026-09-13","2026-09-20","2026-10-12","2026-10-13","2026-10-15","2026-10-16","2026-11-15","2026-11-22"];
const SPECIAL_DATE_TIMES = {"2026-07-17":["09:00–12:00"]};
const SPECIAL_OPEN_HOURS = {"2026-08-17":13,"2026-08-20":13,"2026-08-28":13};
const SEPTEMBER_WINDOWS = {"2026-09-01":[9,13],"2026-09-02":[14,20],"2026-09-07":[14,20],"2026-09-16":[14,20],"2026-09-21":[14,20]};

// Single source of truth for course identity, capacity and server-trusted pricing.
const COURSES = [
  {id:"contest-hineni",series:"亞洲香氛藝術大賽",en:"Aroma Idol",course:"此域 Hineni 嗅覺敘事空間｜合作調香教室",price:0,capacity:10,unit:"位",times:["10:00–12:00","13:00–15:00","15:30–17:30","18:00–20:00"],mode:"single",contest:true,startDate:"2026-08-01",endDate:"2026-08-23"},
  {id:"helori-10-single",series:"心村限定｜Helori 香氣探索所",en:"Find Your Helori",course:"單人調香探索課 10ML",price:990,regular:1150,capacity:10,unit:"位",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"single"},
  {id:"helori-10-pair",series:"心村限定｜Helori 香氣探索所",en:"Find Your Helori",course:"雙人調香探索課 10ML",price:1980,regular:2300,capacity:5,unit:"組",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"single"},
  {id:"helori-50-single",series:"心村限定｜Helori 香氣探索所",en:"Find Your Helori",course:"單人調香探索課 50ML",price:1800,regular:2350,capacity:10,unit:"位",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"single"},
  {id:"helori-50-pair",series:"心村限定｜Helori 香氣探索所",en:"Find Your Helori",course:"雙人調香探索課 50ML",price:3600,regular:4700,capacity:5,unit:"組",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"single"},
  {id:"overture-vol1",series:"氣味藝術序曲系列",en:"Overture to the Art of Scent",course:"Vol. 1｜一日專業調香師",price:4500,capacity:6,unit:"位",times:["10:00–16:00"],mode:"single"},
  {id:"overture-vol2",series:"氣味藝術序曲系列",en:"Overture to the Art of Scent",course:"Vol. 2｜調香師的和弦練習曲",price:6500,capacity:6,unit:"位",times:["10:00–16:00"],mode:"single"},
  {id:"overture-vol1-vol2",series:"氣味藝術序曲系列",en:"Overture to the Art of Scent",course:"Vol. 1 ＋ Vol. 2",price:10500,capacity:6,unit:"位",times:["10:00–16:00"],mode:"multiple",max:2,requiredSlots:2,slotNotice:"請選擇 2 個上課日期，每次 6 小時，共 12 小時。"},
  {id:"overture-vol0-basic",series:"氣味藝術序曲系列",en:"Overture to the Art of Scent",course:"Vol. 0｜氣味自修室",variant:"Basic Lab｜配方練習",price:800,capacity:6,unit:"位",times:["09:00–12:00","14:00–17:00"],mode:"single"},
  {id:"overture-vol0-mini",series:"氣味藝術序曲系列",en:"Overture to the Art of Scent",course:"Vol. 0｜氣味自修室",variant:"Mini Work｜10ml 基本瓶器",price:1150,capacity:6,unit:"位",times:["09:00–12:00","14:00–17:00"],mode:"single"},
  {id:"overture-vol0-full",series:"氣味藝術序曲系列",en:"Overture to the Art of Scent",course:"Vol. 0｜氣味自修室",variant:"Full Work｜50ml 基本瓶器",price:2080,capacity:6,unit:"位",times:["09:00–12:00","14:00–17:00"],mode:"single"},
  {id:"overture-vol0-candle",series:"氣味藝術序曲系列",en:"Overture to the Art of Scent",course:"Vol. 0｜氣味自修室",variant:"Candle Work｜蠟燭",price:1580,capacity:6,unit:"位",times:["09:00–12:00","14:00–17:00"],mode:"single"},
  {id:"kpia-perfumer",series:"韓國 KPIA 調香協會系列",en:"KPIA Certification",course:"KPIA大韓專業調香師課程",price:39000,capacity:4,unit:"位",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"multiple",max:12,requiredSlots:12,slotNotice:"每時段為2小時，請選擇12個時段，建議每日上限為3個時段(6小時)"},
  {id:"kpia-dual",series:"韓國 KPIA 調香協會系列",en:"KPIA Certification",course:"KPIA 專業調香師雙證書課（優惠加購無酒精香水證書）",price:44000,capacity:4,unit:"位",times:["09:00–11:00","11:00–13:00","14:00–16:00","16:00–18:00"],mode:"multiple",max:12,requiredSlots:12,slotNotice:"每時段為2小時，請選擇12個時段，建議每日上限為3個時段(6小時)"},
  {id:"kpia-alcohol-free",series:"韓國 KPIA 調香協會系列",en:"KPIA Certification",course:"KPIA無酒精香水課程",price:6500,capacity:4,unit:"位",times:["10:00–15:00"],mode:"single"}
];

const ORDER_HEADERS = ["訂單編號","建立時間","場次ID","場次","課程ID","課程","方案","數量","單位","單價","小計","活動折扣","折扣碼","折扣碼折抵","實付金額","姓名","電話","Email","LINE","備註","付款供應商","付款狀態","預約狀態","藍新交易序號","付款時間","保留到期"];
const COUPON_HEADERS = ["code","active","discountType","discountValue","minimumAmount","validFrom","validUntil","applicableCourseIds","usageLimit","usedCount","perCustomerLimit","stackable"];

function doGet(e){
  const action = String((e && e.parameter && e.parameter.action) || "");
  if(action === "catalog") return json({ok:true,courses:publicCatalog_()});
  if(action === "slots") return json({ok:true,slots:getOpenSlots()});
  if(action === "orderStatus") return json(getOrderStatus_(String(e.parameter.orderId || "")));
  return json({ok:true,service:"hana-booking",version:"checkout-v2"});
}

function doPost(e){
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try{
    let d;
    try{ d = JSON.parse(e.postData.contents); }catch(_){ return json({ok:false,error:"BAD_REQUEST"}); }
    if(d.website) return json({ok:true,orderId:"HS000000000"});
    const action = String(d.action || "");
    if(action === "quote") return json(quote_(d));
    if(action === "createOrder") return json(createOrder_(d));
    if(action === "contest") return json(createContestBooking_(d));
    return json(legacyBooking_(d));
  }catch(err){
    console.error(err);
    return json({ok:false,error:"SERVER_ERROR"});
  }finally{
    lock.releaseLock();
  }
}

function publicCatalog_(){
  const today = Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd");
  return COURSES.filter(c=>!c.endDate || c.endDate >= today).map(c=>({
    id:c.id,series:c.series,en:c.en||"",course:c.course,variant:c.variant||"",price:Number(c.price),regular:c.regular?Number(c.regular):null,
    capacity:Number(c.capacity),unit:c.unit||"位",mode:c.mode,max:c.max||null,requiredSlots:c.requiredSlots||null,slotNotice:c.slotNotice||"",contest:!!c.contest,startDate:c.startDate||null,endDate:c.endDate||null
  }));
}

function quote_(d){
  const course = courseById_(str(d.courseId));
  if(!course || course.contest) return {ok:false,error:"COURSE_NOT_FOUND"};
  const quantity = positiveInt_(d.quantity);
  if(!quantity) return {ok:false,error:"INVALID_QUANTITY"};
  const ids = normalizeSlotIds(d);
  const selection = validateSelection_(course,ids,quantity);
  if(!selection.ok) return selection;
  const subtotal = Math.trunc(Number(course.price) * quantity);
  const automaticDiscount = automaticDiscount_(course,quantity,subtotal);
  const coupon = validateCoupon_(str(d.couponCode).toUpperCase(),course,subtotal,automaticDiscount,str(d.email).toLowerCase());
  if(!coupon.ok) return coupon;
  const couponDiscount = coupon.discount || 0;
  const finalAmount = Math.max(0,subtotal - automaticDiscount - couponDiscount);
  return {
    ok:true,courseId:course.id,courseName:course.course,variant:course.variant||"",unit:course.unit||"位",quantity:quantity,maxQuantity:selection.maxQuantity,
    unitPrice:Number(course.price),subtotal:subtotal,automaticDiscount:automaticDiscount,couponCode:coupon.code||"",couponDiscount:couponDiscount,finalAmount:finalAmount,
    slots:selection.selected.map(s=>({id:s.id,date:s.date,time:s.time,remaining:Number(s.capacity)-Number(s.booked)}))
  };
}

function createOrder_(d){
  const customer = validateCustomer_(d);
  if(!customer.ok) return customer;
  const q = quote_(Object.assign({},d,{email:customer.email}));
  if(!q.ok) return q;
  const now = new Date();
  const expiresAt = new Date(now.getTime()+HOLD_MINUTES*60*1000);
  const orderId = "HS"+Utilities.formatDate(now,TZ,"yyMMddHHmmss")+String(Math.floor(1000+Math.random()*9000));
  const merchantOrderNo = orderId;
  const slotsText = q.slots.map(s=>s.date+" "+s.time).join(" / ");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss,"訂單",ORDER_HEADERS);
  sheet.appendRow([
    orderId,Utilities.formatDate(now,TZ,"yyyy-MM-dd HH:mm:ss"),q.slots.map(s=>s.id).join(" | "),slotsText,q.courseId,q.courseName,q.variant||"",q.quantity,q.unit,q.unitPrice,q.subtotal,q.automaticDiscount,q.couponCode,q.couponDiscount,q.finalAmount,
    customer.name,"'"+customer.phone,customer.email,customer.line,customer.note,"NewebPay","pending","holding","","",Utilities.formatDate(expiresAt,TZ,"yyyy-MM-dd HH:mm:ss")
  ]);
  const props = PropertiesService.getScriptProperties();
  const paymentApiUrl = String(props.getProperty("PAYMENT_API_URL") || "");
  return {
    ok:true,orderId:orderId,merchantOrderNo:merchantOrderNo,paymentStatus:"pending",bookingStatus:"holding",expiresAt:expiresAt.toISOString(),quote:q,
    paymentReady:!!paymentApiUrl,paymentApiUrl:paymentApiUrl || null,
    message:paymentApiUrl?"ORDER_CREATED":"ORDER_CREATED_PAYMENT_API_NOT_CONFIGURED"
  };
}

function validateCustomer_(d){
  const name = str(d.name), phone = str(d.phone), email = str(d.email).toLowerCase(), line = str(d.line), note = str(d.note);
  if(!name || name.length>50) return {ok:false,error:"INVALID_NAME"};
  if(!/^[0-9+\-() ]{7,20}$/.test(phone)) return {ok:false,error:"INVALID_PHONE"};
  if(!email || email.length>100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return {ok:false,error:"INVALID_EMAIL"};
  if(line.length>50 || note.length>800) return {ok:false,error:"BAD_REQUEST"};
  return {ok:true,name:name,phone:phone,email:email,line:line,note:note};
}

function validateSelection_(course,ids,quantity){
  if(!ids.length || ids.length>12 || new Set(ids).size!==ids.length) return {ok:false,error:"INVALID_SLOTS"};
  if(course.mode==="single" && ids.length!==1) return {ok:false,error:"INVALID_SLOTS"};
  if(course.mode==="multiple" && ids.length>(course.max||8)) return {ok:false,error:"INVALID_SLOTS"};
  if(course.requiredSlots && ids.length!==course.requiredSlots) return {ok:false,error:"INVALID_SLOTS"};
  const map = {};
  getOpenSlots().forEach(s=>map[s.id]=s);
  const selected = [];
  let maxQuantity = 999;
  for(let i=0;i<ids.length;i++){
    const s = map[ids[i]];
    if(!s || s.courseId!==course.id) return {ok:false,error:"SLOT_NOT_AVAILABLE"};
    const remaining = Number(s.capacity)-Number(s.booked);
    if(remaining<=0 || quantity>remaining) return {ok:false,error:"SLOT_FULL",maxQuantity:Math.max(0,remaining)};
    maxQuantity = Math.min(maxQuantity,remaining);
    selected.push(s);
  }
  return {ok:true,selected:selected,maxQuantity:maxQuantity};
}

function automaticDiscount_(course,quantity,subtotal){
  // Reserved for future early-bird / alumni / quantity rules. Server remains authoritative.
  return 0;
}

function validateCoupon_(code,course,subtotal,automaticDiscount,email){
  if(!code) return {ok:true,code:"",discount:0};
  const coupon = readCoupons_().find(c=>c.code===code);
  if(!coupon || !coupon.active) return {ok:false,error:"COUPON_INVALID"};
  const today = Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd");
  if(coupon.validFrom && today<coupon.validFrom) return {ok:false,error:"COUPON_NOT_STARTED"};
  if(coupon.validUntil && today>coupon.validUntil) return {ok:false,error:"COUPON_EXPIRED"};
  if(subtotal<coupon.minimumAmount) return {ok:false,error:"COUPON_MINIMUM_NOT_MET",minimumAmount:coupon.minimumAmount};
  if(coupon.applicableCourseIds.length && coupon.applicableCourseIds.indexOf(course.id)===-1) return {ok:false,error:"COUPON_NOT_APPLICABLE"};
  if(coupon.usageLimit>0 && coupon.usedCount>=coupon.usageLimit) return {ok:false,error:"COUPON_LIMIT_REACHED"};
  if(coupon.perCustomerLimit>0 && email && couponUseCountForEmail_(code,email)>=coupon.perCustomerLimit) return {ok:false,error:"COUPON_CUSTOMER_LIMIT_REACHED"};
  if(!coupon.stackable && automaticDiscount>0) return {ok:false,error:"COUPON_NOT_STACKABLE"};
  let discount = 0;
  if(coupon.discountType==="percentage") discount = Math.floor(subtotal*Math.max(0,Math.min(100,coupon.discountValue))/100);
  if(coupon.discountType==="fixed") discount = Math.max(0,Math.trunc(coupon.discountValue));
  discount = Math.min(discount,Math.max(0,subtotal-automaticDiscount));
  return {ok:true,code:code,discount:discount};
}

function readCoupons_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("優惠碼");
  if(!sheet){ sheet=ss.insertSheet("優惠碼"); sheet.appendRow(COUPON_HEADERS); return []; }
  const values = sheet.getDataRange().getValues();
  if(values.length<=1) return [];
  const headers = values[0].map(v=>String(v||"").trim());
  const idx = {}; headers.forEach((h,i)=>idx[h]=i);
  return values.slice(1).map(r=>{
    const code = String(r[idx.code]||"").trim().toUpperCase();
    return {
      code:code,active:bool_(r[idx.active]),discountType:String(r[idx.discountType]||"").trim().toLowerCase(),discountValue:Number(r[idx.discountValue]||0),minimumAmount:Number(r[idx.minimumAmount]||0),
      validFrom:sheetDate_(r[idx.validFrom]),validUntil:sheetDate_(r[idx.validUntil]),applicableCourseIds:String(r[idx.applicableCourseIds]||"").split(/[|,，、]/).map(x=>x.trim()).filter(Boolean),
      usageLimit:Number(r[idx.usageLimit]||0),usedCount:Number(r[idx.usedCount]||0),perCustomerLimit:Number(r[idx.perCustomerLimit]||0),stackable:bool_(r[idx.stackable])
    };
  }).filter(c=>c.code);
}

function couponUseCountForEmail_(code,email){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("訂單");
  if(!sheet) return 0;
  const rows = sheet.getDataRange().getValues();
  if(rows.length<=1) return 0;
  return rows.slice(1).filter(r=>String(r[12]||"").toUpperCase()===code && String(r[17]||"").toLowerCase()===email && ["failed","expired","cancelled"].indexOf(String(r[21]||""))===-1).length;
}

function getOrderStatus_(orderId){
  if(!orderId) return {ok:false,error:"ORDER_NOT_FOUND"};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("訂單");
  if(!sheet) return {ok:false,error:"ORDER_NOT_FOUND"};
  const rows = sheet.getDataRange().getValues();
  for(let i=1;i<rows.length;i++){
    const r=rows[i];
    if(String(r[0]||"")===orderId) return {ok:true,orderId:orderId,course:String(r[5]||""),variant:String(r[6]||""),quantity:Number(r[7]||1),unit:String(r[8]||"位"),finalAmount:Number(r[14]||0),paymentStatus:String(r[21]||""),bookingStatus:String(r[22]||""),tradeNo:String(r[23]||""),paidAt:String(r[24]||"")};
  }
  return {ok:false,error:"ORDER_NOT_FOUND"};
}

function createContestBooking_(d){
  const course = courseById_(str(d.courseId));
  if(!course || !course.contest) return {ok:false,error:"COURSE_NOT_FOUND"};
  d.token = API_TOKEN;
  d.method = "大賽LINE確認";
  d.proofBase64 = "";
  return legacyBooking_(d);
}

// Backward-compatible handler for the current live form while checkout-v2 is being tested.
function legacyBooking_(d){
  if(d.token!==API_TOKEN) return {ok:false,error:"BAD_REQUEST"};
  const v=validateLegacy_(d); if(v) return {ok:false,error:v};
  const ids=normalizeSlotIds(d); if(new Set(ids).size!==ids.length) return {ok:false,error:"BAD_REQUEST"};
  const slots=getOpenSlots(), map={}; slots.forEach(s=>map[s.id]=s);
  const selected=[];
  for(let i=0;i<ids.length;i++){ const s=map[ids[i]]; if(!s||s.booked>=s.capacity) return {ok:false,error:"SLOT_FULL"}; selected.push(s); }
  const first=selected[0], meta=courseMeta(first.series,first.course,first.variant);
  if(!meta) return {ok:false,error:"BAD_REQUEST"};
  if(meta.mode==="single"&&selected.length!==1) return {ok:false,error:"BAD_REQUEST"};
  if(meta.mode==="multiple"&&selected.length>(meta.max||8)) return {ok:false,error:"BAD_REQUEST"};
  if(meta.requiredSlots&&selected.length!==meta.requiredSlots) return {ok:false,error:"BAD_REQUEST"};
  let proofUrl="";
  if(d.proofBase64){ const folder=getOrCreateFolder(DRIVE_FOLDER); const tag=ids[0]+"_"+Utilities.formatDate(new Date(),TZ,"yyyyMMdd-HHmmss"); const blob=Utilities.newBlob(Utilities.base64Decode(d.proofBase64),"image/jpeg",tag+".jpg"); const file=folder.createFile(blob); file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE); proofUrl=file.getUrl(); }
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sheet=getOrCreateSheet_(ss,"報名",["報名編號","報名時間","場次ID","場次","課程","方案","姓名","電話","Email","LINE","繳費方式","後五碼","憑證連結","備註","狀態"]);
  const bookingId="HF-"+Utilities.formatDate(new Date(),TZ,"yyMMdd")+"-"+String(sheet.getLastRow()).padStart(3,"0");
  const slotsText=selected.map(s=>s.date+" "+s.time).join(" / ");
  sheet.appendRow([bookingId,Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd HH:mm"),ids.join(" | "),slotsText,first.course,first.variant||"",d.name,"'"+d.phone,d.email||"",d.line||"",d.method,d.last5?"'"+d.last5:"",proofUrl,d.note||"","待對帳"]);
  MailApp.sendEmail({to:NOTIFY_EMAIL,subject:"【新報名待對帳】"+first.course,htmlBody:"<p>有一筆新的課程報名，請至報名管理試算表查看。</p><p>報名編號：<b>"+escHtml(bookingId)+"</b><br>課程："+escHtml(first.course)+"<br>場次："+escHtml(slotsText)+"<br>金額：NT$ "+Number(meta.price).toLocaleString()+"</p><p><a href='"+ss.getUrl()+"'>開啟報名管理試算表</a></p>"});
  return {ok:true,bookingId:bookingId};
}

function validateLegacy_(d){
  d.slotId=str(d.slotId); d.name=str(d.name); d.phone=str(d.phone); d.email=str(d.email); d.line=str(d.line); d.method=str(d.method); d.last5=str(d.last5); d.note=str(d.note);
  const ids=normalizeSlotIds(d);
  if(!ids.length||ids.length>12) return "BAD_REQUEST";
  if(!d.name||d.name.length>50) return "BAD_REQUEST";
  if(!/^[0-9+\-() ]{7,20}$/.test(d.phone)) return "BAD_REQUEST";
  if(d.email&&(d.email.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))) return "BAD_REQUEST";
  if(["轉帳","刷卡","分期","大賽LINE確認"].indexOf(d.method)===-1) return "BAD_REQUEST";
  if(d.method==="轉帳"&&!/^\d{5}$/.test(d.last5)) return "BAD_REQUEST";
  if(d.method!=="大賽LINE確認"&&!d.proofBase64) return "BAD_REQUEST";
  if(d.proofBase64&&d.proofBase64.length>8000000) return "FILE_TOO_LARGE";
  return null;
}

function normalizeSlotIds(d){ if(Array.isArray(d.slotIds)) return d.slotIds.map(x=>str(x)).filter(Boolean); if(typeof d.slotIds==="string") return d.slotIds.split(/[|,，、\s]+/).map(x=>str(x)).filter(Boolean); return d.slotId?[str(d.slotId)]:[]; }

function getOpenSlots(){
  const today=Utilities.formatDate(new Date(),TZ,"yyyy-MM-dd"), generated=generateSlots_(), manual=readManualSlots_(), counts=getBookedCounts_(), map={};
  generated.forEach(s=>map[s.id]=s);
  manual.forEach(s=>{ if(s.status==="關閉") delete map[s.id]; else if(s.status==="開放") map[s.id]=Object.assign(map[s.id]||{},s); });
  return Object.keys(map).map(id=>{ const s=map[id]; s.booked=BLOCKED_DATES.includes(s.date)?Number(s.capacity):(counts[id]||0); return s; }).filter(s=>s.date>=today&&s.date<=BOOKING_END_DATE&&s.status!=="關閉"&&isSeptemberWindowOpen_(s.date,s.time));
}

function generateSlots_(){
  const slots=[], start=parseDate_(BOOKING_START_AT.slice(0,10)), today=new Date(); today.setHours(0,0,0,0); const anchor=start>today?start:today, end=parseDate_(BOOKING_END_DATE);
  for(let d=new Date(anchor);d<=end;d.setDate(d.getDate()+1)){
    const ds=Utilities.formatDate(d,TZ,"yyyy-MM-dd"), dow=Number(Utilities.formatDate(d,TZ,"u"))%7;
    if(!isDateOpen_(ds,dow)) continue;
    COURSES.forEach(c=>{ if((c.startDate&&ds<c.startDate)||(c.endDate&&ds>c.endDate)) return; getCourseTimesForDate_(c,ds,dow).forEach((time,i)=>slots.push({id:makeSlotId_(c,ds,time,i),courseId:c.id,series:c.series,course:c.course,variant:c.variant||"",date:ds,time:time,capacity:Number(c.capacity),unit:c.unit||"位",booked:0,status:"開放"})); });
  }
  return slots;
}

function getCourseTimesForDate_(c,ds,dow){ if(SPECIAL_DATE_TIMES[ds]) return SPECIAL_DATE_TIMES[ds]; return c.times.filter(time=>isTimeOpenForDate_(ds,dow,time)); }
function isTimeOpenForDate_(ds,dow,time){ if(ds.indexOf("2026-08-")===0){ const open=SPECIAL_OPEN_HOURS[ds]||10, close=(dow===3||dow===5)?19:20; return getStartHour_(time)>=open&&getEndHour_(time)<=close; } if(ds.indexOf("2026-09-")===0) return isSeptemberWindowOpen_(ds,time); if(dow===3&&getEndHour_(time)>14) return false; return true; }
function isSeptemberWindowOpen_(ds,time){ if(ds.indexOf("2026-09-")!==0) return true; const w=SEPTEMBER_WINDOWS[ds]; return !w||(getStartHour_(time)>=w[0]&&getEndHour_(time)<=w[1]); }
function getStartHour_(time){ const start=String(time).split("–")[0]||"", hm=start.split(":").map(Number); return (hm[0]||0)+((hm[1]||0)/60); }
function getEndHour_(time){ const parts=String(time).split("–"), end=parts[1]||parts[0]||"", hm=end.split(":").map(Number); return (hm[0]||0)+((hm[1]||0)/60); }

function readManualSlots_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet(), sheet=ss.getSheetByName("場次"); if(!sheet) return [];
  const v=sheet.getDataRange().getValues(); if(v.length<=1) return [];
  return v.slice(1).map(r=>{ const meta=courseMeta(String(r[1]||""),String(r[2]||""),String(r[3]||"")); return {id:String(r[0]||""),courseId:meta?meta.id:"",series:String(r[1]||""),course:String(r[2]||""),variant:String(r[3]||""),date:r[4] instanceof Date?Utilities.formatDate(r[4],TZ,"yyyy-MM-dd"):String(r[4]||""),time:String(r[5]||""),capacity:Number(r[7]||0),unit:String(r[9]||"位"),status:String(r[8]||"")}; }).filter(s=>s.id);
}

function getBookedCounts_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet(), counts={};
  const legacy=ss.getSheetByName("報名");
  if(legacy){ const rows=legacy.getDataRange().getValues(); rows.slice(1).forEach(r=>{ const raw=String(r[2]||""), status=String(r[14]||""); if(!raw||status==="已取消") return; raw.split(/\s*\|\s*|[,，、]/).map(x=>x.trim()).filter(Boolean).forEach(id=>counts[id]=(counts[id]||0)+1); }); }
  const orders=ss.getSheetByName("訂單");
  if(orders){ const rows=orders.getDataRange().getValues(), now=Date.now(); rows.slice(1).forEach(r=>{ const raw=String(r[2]||""), qty=Math.max(1,Number(r[7]||1)), bookingStatus=String(r[22]||""), expires=parseSheetDateMs_(r[25]); const active=bookingStatus==="confirmed" || (bookingStatus==="holding" && expires>now); if(!raw||!active) return; raw.split(/\s*\|\s*|[,，、]/).map(x=>x.trim()).filter(Boolean).forEach(id=>counts[id]=(counts[id]||0)+qty); }); }
  return counts;
}

function courseById_(id){ return COURSES.find(c=>c.id===id)||null; }
function courseMeta(series,course,variant){ return COURSES.find(c=>c.series===series&&c.course===course&&String(c.variant||"")===String(variant||""))||null; }
function makeSlotId_(c,date,time,i){ return (slug_(c.series)+"-"+slug_(c.course)+"-"+slug_(c.variant||"")+"-"+date+"-"+String(i+1).padStart(2,"0")).slice(0,120); }
function slug_(s){ return String(s).replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g,"-").replace(/^-|-$/g,""); }
function isDateOpen_(ds,dow){ return CLOSED_DATES.indexOf(ds)===-1&&CLOSED_WEEKDAYS.indexOf(dow)===-1&&OPEN_WEEKDAYS.indexOf(dow)!==-1; }
function parseDate_(ds){ const p=String(ds).split("-").map(Number); return new Date(p[0],p[1]-1,p[2]); }
function getOrCreateFolder(name){ const it=DriveApp.getFoldersByName(name); return it.hasNext()?it.next():DriveApp.createFolder(name); }
function getOrCreateSheet_(ss,name,headers){ let sheet=ss.getSheetByName(name); if(!sheet){ sheet=ss.insertSheet(name); sheet.appendRow(headers); } return sheet; }
function positiveInt_(v){ const n=Number(v); return Number.isInteger(n)&&n>0?n:0; }
function bool_(v){ if(v===true) return true; const s=String(v||"").trim().toLowerCase(); return ["true","1","yes","y","是","啟用"].indexOf(s)!==-1; }
function sheetDate_(v){ if(v instanceof Date) return Utilities.formatDate(v,TZ,"yyyy-MM-dd"); return String(v||"").trim().slice(0,10); }
function parseSheetDateMs_(v){ if(v instanceof Date) return v.getTime(); const s=String(v||"").trim(); if(!s) return 0; const t=Date.parse(s.replace(" ","T")+(/Z|[+-]\d\d:?\d\d$/.test(s)?"":"+08:00")); return Number.isFinite(t)?t:0; }
function maskPhone(p){ p=String(p||""); return p.length<=6?p:p.slice(0,4)+"***"+p.slice(-3); }
function str(x){ return typeof x==="string"?x.trim():""; }
function escHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function json(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
