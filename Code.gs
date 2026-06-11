/* ═══════════════════════════════════════════════════════
   Hana's Scent Artist — 課程報名後端 v3 (Google Apps Script)
   搭配 index.html v3: 支援前端自動產生場次、KPIA 多日複選、單筆報名鎖定多個 slotIds

   工作表:
   1.「報名」: 報名編號|報名時間|場次ID|場次|課程|方案|姓名|電話|Email|LINE|繳費方式|後五碼|憑證連結|備註|狀態
   2.「場次」: 選用。可用來手動覆蓋/關閉/額外新增場次。欄位: 場次ID|系列|課程名稱|方案|日期|時間|價格|名額|狀態

   重點:
   - doGet 僅回傳場次資料,不回報名個資
   - doPost 支援 d.slotIds 陣列,會逐一檢查名額並鎖定
   - 多選課程會在同一筆報名列中寫入多個場次ID, getOpenSlots 會逐一計入已預約數
   - 若「場次」分頁有同 ID 且狀態=關閉,會覆蓋前端規則並關閉該場次
   ═══════════════════════════════════════════════════════ */

const NOTIFY_EMAIL = "你的Email@gmail.com";
const API_TOKEN = "請改成一串自訂亂碼例如hf-2026-x7k9q2";
const DRIVE_FOLDER = "報名繳費憑證";
const RETENTION_MONTHS = 12;
const TZ = "Asia/Taipei";

const BOOKING_START_AT = "2026-07-07T10:00:00+08:00";
const OPEN_WEEKDAYS = [1, 2, 3, 4, 5];       // 1=週一...5=週五
const CLOSED_WEEKDAYS = [6];                 // 固定不開放:週六
const DEFAULT_OPEN_WEEKS = 8;
const CLOSED_DATES = [
  // "2026-07-19",
];

const COURSE_CATALOG = [
  {
    series: "心村限定｜Helori香域探索所",
    seriesEn: "Find Your Helori",
    course: "10mL 香域探索",
    price: 990,
    regularPrice: 1150,
    capacity: 4,
    times: ["09:00–11:00", "11:00–13:00", "14:00–16:00", "16:00–18:00"],
    selectMode: "single",
    note: "開幕期間前30名優惠價 NT$990｜原價 NT$1,150"
  },
  {
    series: "心村限定｜Helori香域探索所",
    seriesEn: "Find Your Helori",
    course: "50mL 香域探索",
    price: 1800,
    regularPrice: 2350,
    capacity: 4,
    times: ["09:00–11:00", "11:00–13:00", "14:00–16:00", "16:00–18:00"],
    selectMode: "single",
    note: "開幕期間前30名優惠價 NT$1,800｜原價 NT$2,350"
  },
  {
    series: "H.FUGUE ATELIER 專業調香師課程",
    seriesEn: "Professional Perfumery",
    course: "01 氣味藝術序曲",
    price: 3500,
    regularPrice: 3650,
    capacity: 6,
    times: ["10:00–16:00"],
    selectMode: "single",
    note: "開幕期間 NT$3,500｜原價 NT$3,650"
  },
  {
    series: "韓國 KPIA 調香協會系列",
    seriesEn: "KPIA Certification",
    course: "KPIA 專業調香師雙證書課（含無酒精香水證書）",
    price: 44000,
    capacity: 4,
    times: ["09:00–11:00", "11:00–13:00", "14:00–16:00", "16:00–18:00"],
    selectMode: "multiple",
    maxSelections: 8,
    note: "最多可複選8個上課日/時段"
  },
  {
    series: "韓國 KPIA 調香協會系列",
    seriesEn: "KPIA Certification",
    course: "KPIA大韓專業調香師課程",
    price: 39000,
    capacity: 4,
    times: ["09:00–11:00", "11:00–13:00", "14:00–16:00", "16:00–18:00"],
    selectMode: "multiple",
    maxSelections: 8,
    note: "最多可複選8個上課日/時段"
  },
  {
    series: "韓國 KPIA 調香協會系列",
    seriesEn: "KPIA Certification",
    course: "KPIA無酒精香水課程",
    price: 6500,
    capacity: 4,
    times: ["10:00–15:00"],
    selectMode: "single",
    note: "限已完成或已報名 KPIA Basic 學員；需單獨叫教材"
  }
];

/* ── 查詢場次: GET ?action=slots ── */
function doGet(e) {
  if (e.parameter.action === "slots") return json({ slots: getOpenSlots() });
  return json({ ok: true, service: "hana-booking" });
}

/* ── 送出報名: POST(JSON) ── */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    let d;
    try { d = JSON.parse(e.postData.contents); }
    catch (_) { return json({ ok: false, error: "BAD_REQUEST" }); }

    if (d.website) return json({ ok: true, bookingId: "HF-000000-000" });
    if (d.token !== API_TOKEN) return json({ ok: false, error: "BAD_REQUEST" });

    const v = validate(d);
    if (v) return json({ ok: false, error: v });

    const requestedIds = normalizeSlotIds(d);
    const allSlots = getOpenSlots();
    const slotMap = {};
    allSlots.forEach(s => slotMap[s.id] = s);

    const selectedSlots = [];
    for (let i = 0; i < requestedIds.length; i++) {
      const s = slotMap[requestedIds[i]];
      if (!s || s.booked >= s.capacity) return json({ ok: false, error: "SLOT_FULL" });
      selectedSlots.push(s);
    }

    if (!selectedSlots.length) return json({ ok: false, error: "BAD_REQUEST" });

    const firstSlot = selectedSlots[0];
    const meta = courseMeta(firstSlot.series, firstSlot.course);
    if (!meta) return json({ ok: false, error: "BAD_REQUEST" });

    if (meta.selectMode === "single" && selectedSlots.length !== 1) {
      return json({ ok: false, error: "BAD_REQUEST" });
    }
    if (meta.selectMode === "multiple" && selectedSlots.length > (meta.maxSelections || 8)) {
      return json({ ok: false, error: "BAD_REQUEST" });
    }
    if (!selectedSlots.every(s => s.series === firstSlot.series && s.course === firstSlot.course)) {
      return json({ ok: false, error: "BAD_REQUEST" });
    }

    let proofUrl = "";
    if (d.proofBase64) {
      const folder = getOrCreateFolder(DRIVE_FOLDER);
      const tag = requestedIds[0] + "_" + Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
      const blob = Utilities.newBlob(Utilities.base64Decode(d.proofBase64), "image/jpeg", tag + ".jpg");
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      proofUrl = file.getUrl();
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet_(ss, "報名", [
      "報名編號", "報名時間", "場次ID", "場次", "課程", "方案", "姓名", "電話", "Email", "LINE", "繳費方式", "後五碼", "憑證連結", "備註", "狀態"
    ]);

    const bookingId = "HF-" + Utilities.formatDate(new Date(), TZ, "yyMMdd") + "-" + String(sheet.getLastRow()).padStart(3, "0");
    const slotsText = selectedSlots.map(s => s.date + " " + s.time).join(" / ");
    const slotIdsText = requestedIds.join(" | ");
    const variantText = firstSlot.variant || "";
    const noteText = str(d.note) + (str(d.slotsText) ? "\n前端選擇場次:" + str(d.slotsText) : "");

    sheet.appendRow([
      bookingId,
      Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"),
      slotIdsText,
      slotsText,
      firstSlot.course,
      variantText,
      d.name,
      "'" + d.phone,
      d.email || "",
      d.line || "",
      d.method,
      d.last5 ? "'" + d.last5 : "",
      proofUrl,
      noteText,
      "待對帳"
    ]);

    const courseLabel = firstSlot.course + (variantText ? "(" + variantText + ")" : "");
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: "【新報名待對帳】" + courseLabel,
      htmlBody:
        "<p>有一筆新的課程報名,場次已鎖定,請進行對帳。</p>" +
        "<table cellpadding='4' style='font-size:14px'>" +
        "<tr><td>報名編號</td><td><b>" + escHtml(bookingId) + "</b></td></tr>" +
        "<tr><td>課程</td><td>" + escHtml(courseLabel) + "</td></tr>" +
        "<tr><td>場次</td><td>" + escHtml(slotsText) + "</td></tr>" +
        "<tr><td>姓名</td><td>" + escHtml(d.name) + "</td></tr>" +
        "<tr><td>電話</td><td>" + escHtml(maskPhone(d.phone)) + "</td></tr>" +
        "<tr><td>繳費方式</td><td>" + escHtml(d.method) + "</td></tr>" +
        "<tr><td>金額</td><td>NT$ " + Number(firstSlot.price).toLocaleString() + "</td></tr>" +
        "</table>" +
        "<p>完整聯絡資料、後五碼與繳費憑證請至試算表查看:<br>" +
        "<a href='" + ss.getUrl() + "'>開啟報名管理試算表</a></p>" +
        "<p>對帳完成後,請將該筆狀態改為「已確認」;若退費取消,改為「已取消」名額即自動釋出。</p>"
    });

    return json({ ok: true, bookingId });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "SERVER_ERROR" });
  } finally {
    lock.releaseLock();
  }
}

function validate(d) {
  d.slotId = str(d.slotId);
  d.name = str(d.name);
  d.phone = str(d.phone);
  d.email = str(d.email);
  d.line = str(d.line);
  d.method = str(d.method);
  d.last5 = str(d.last5);
  d.note = str(d.note);

  const ids = normalizeSlotIds(d);
  if (!ids.length || ids.length > 8) return "BAD_REQUEST";
  if (ids.some(id => !id || id.length > 140)) return "BAD_REQUEST";
  if (!d.name || d.name.length > 50) return "BAD_REQUEST";
  if (!/^[0-9+\-() ]{7,20}$/.test(d.phone)) return "BAD_REQUEST";
  if (d.email && (d.email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))) return "BAD_REQUEST";
  if (d.line.length > 50 || d.note.length > 800) return "BAD_REQUEST";
  if (["轉帳", "刷卡", "分期"].indexOf(d.method) === -1) return "BAD_REQUEST";
  if (d.method === "轉帳" && !/^\d{5}$/.test(d.last5)) return "BAD_REQUEST";
  if (!d.proofBase64) return "BAD_REQUEST";
  if (d.proofBase64.length > 8000000) return "FILE_TOO_LARGE";
  return null;
}

function normalizeSlotIds(d) {
  if (Array.isArray(d.slotIds)) return d.slotIds.map(x => str(x)).filter(Boolean);
  if (typeof d.slotIds === "string") return d.slotIds.split(/[|,，、\s]+/).map(x => str(x)).filter(Boolean);
  return d.slotId ? [str(d.slotId)] : [];
}

/* ── 對外場次資料: 自動規則 + 試算表覆蓋 + 報名數 ── */
function getOpenSlots() {
  const today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
  const generated = generateFrontendSlots_();
  const manual = readManualSlots_();
  const bookedCounts = getBookedCounts_();

  const map = {};
  generated.forEach(s => map[s.id] = s);

  manual.forEach(s => {
    if (s.status === "關閉") {
      delete map[s.id];
      return;
    }
    if (s.status === "開放") map[s.id] = Object.assign(map[s.id] || {}, s);
  });

  return Object.keys(map).map(id => {
    const s = map[id];
    s.booked = bookedCounts[id] || 0;
    return s;
  }).filter(s => s.date >= today && s.status !== "關閉");
}

function generateFrontendSlots_() {
  const slots = [];
  const start = parseDate_(BOOKING_START_AT.slice(0, 10));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const anchor = start > today ? start : today;
  const end = new Date(anchor); end.setDate(end.getDate() + DEFAULT_OPEN_WEEKS * 7);

  for (let d = new Date(anchor); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = Utilities.formatDate(d, TZ, "yyyy-MM-dd");
    const dow = Number(Utilities.formatDate(d, TZ, "u")) % 7; // 日=0, 一=1...六=6
    if (!isDateOpen_(ds, dow)) continue;

    COURSE_CATALOG.forEach(c => {
      c.times.forEach((time, i) => {
        slots.push({
          id: makeSlotId_(c, ds, time, i),
          series: c.series,
          course: c.course,
          variant: "",
          date: ds,
          time: time,
          price: Number(c.price),
          capacity: Number(c.capacity),
          booked: 0,
          status: "開放"
        });
      });
    });
  }
  return slots;
}

function readManualSlots_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("場次");
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  return values.slice(1).map(r => ({
    id: String(r[0] || ""),
    series: String(r[1] || ""),
    course: String(r[2] || ""),
    variant: String(r[3] || ""),
    date: r[4] instanceof Date ? Utilities.formatDate(r[4], TZ, "yyyy-MM-dd") : String(r[4] || ""),
    time: String(r[5] || ""),
    price: Number(r[6] || 0),
    capacity: Number(r[7] || 0),
    status: String(r[8] || "")
  })).filter(s => s.id);
}

function getBookedCounts_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("報名");
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return {};

  const counts = {};
  rows.slice(1).forEach(r => {
    const rawSlotIds = String(r[2] || "");
    const status = String(r[14] || "");
    if (!rawSlotIds || status === "已取消") return;
    splitSlotIds_(rawSlotIds).forEach(id => counts[id] = (counts[id] || 0) + 1);
  });
  return counts;
}

function splitSlotIds_(raw) {
  return String(raw).split(/\s*\|\s*|[,，、]/).map(s => s.trim()).filter(Boolean);
}

function courseMeta(series, course) {
  return COURSE_CATALOG.find(c => c.series === series && c.course === course) || null;
}

function makeSlotId_(c, date, time, i) {
  return (slug_(c.series) + "-" + slug_(c.course) + "-" + date + "-" + String(i + 1).padStart(2, "0")).slice(0, 120);
}

function slug_(s) {
  return String(s).replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "");
}

function isDateOpen_(ds, dow) {
  if (CLOSED_DATES.indexOf(ds) !== -1) return false;
  if (CLOSED_WEEKDAYS.indexOf(dow) !== -1) return false;
  return OPEN_WEEKDAYS.indexOf(dow) !== -1;
}

function parseDate_(ds) {
  const p = String(ds).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

/* ── 已結案個資去識別化 ── */
function purgeOldBookings() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("報名");
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  let purged = 0;

  for (let i = 1; i < rows.length; i++) {
    const status = String(rows[i][14]);
    const created = new Date(String(rows[i][1]).replace(" ", "T"));
    const alreadyPurged = String(rows[i][7]) === "(已去識別)";
    if (alreadyPurged || (status !== "已確認" && status !== "已取消") || !(created < cutoff)) continue;

    const proofUrl = String(rows[i][12]);
    const m = proofUrl.match(/\/d\/([^/]+)/);
    if (m) { try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (_) {} }
    sheet.getRange(i + 1, 8).setValue("(已去識別)");
    sheet.getRange(i + 1, 9).setValue("(已去識別)");
    sheet.getRange(i + 1, 10).setValue("(已去識別)");
    sheet.getRange(i + 1, 12).setValue("");
    sheet.getRange(i + 1, 13).setValue("(憑證已刪除)");
    purged++;
  }

  if (purged > 0) {
    MailApp.sendEmail(NOTIFY_EMAIL, "【個資清理完成】共 " + purged + " 筆",
      "已將 " + purged + " 筆逾 " + RETENTION_MONTHS + " 個月的已結案報名去識別化,並刪除對應繳費憑證。");
  }
}

/* ── 舊版週期規則保留: 若仍想用試算表批次產生場次可用 ── */
function generateSlots() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ruleSheet = ss.getSheetByName("週期規則");
  if (!ruleSheet) throw new Error("找不到「週期規則」工作表,請先建立。");
  const slotSheet = getOrCreateSheet_(ss, "場次", ["場次ID", "系列", "課程名稱", "方案", "日期", "時間", "價格", "名額", "狀態"]);
  const existing = {};
  slotSheet.getDataRange().getValues().slice(1).forEach(r => existing[String(r[0])] = true);

  const weekdayMap = { "日": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6 };
  let added = 0;

  ruleSheet.getDataRange().getValues().slice(1).forEach(r => {
    const code = String(r[0]).trim(), series = String(r[1]), course = String(r[2]);
    const variant = String(r[3] || ""), daysRaw = String(r[4]), timesRaw = String(r[5]);
    const price = Number(r[6]), capacity = Number(r[7]);
    const weeks = Number(r[8]) > 0 ? Number(r[8]) : 8;
    const status = String(r[9]);
    if (!code || status !== "啟用") return;

    const wanted = daysRaw.split(/[,、，\s]+/).filter(Boolean)
      .map(d => weekdayMap[d.replace(/週|星期/g, "")])
      .filter(d => d !== undefined);
    const timeSlots = timesRaw.split(/[,、，]+/).map(s => s.trim()).filter(Boolean);
    if (!wanted.length || !timeSlots.length) return;

    for (let offset = 1; offset <= weeks * 7; offset++) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const dow = Number(Utilities.formatDate(date, TZ, "u")) % 7;
      if (wanted.indexOf(dow) === -1) continue;
      const dateStr = Utilities.formatDate(date, TZ, "yyyy-MM-dd");
      timeSlots.forEach((time, idx) => {
        const id = code + "-" + Utilities.formatDate(date, TZ, "yyyyMMdd") + "-" + (idx + 1);
        if (existing[id]) return;
        slotSheet.appendRow([id, series, course, variant, dateStr, time, price, capacity, "開放"]);
        existing[id] = true;
        added++;
      });
    }
  });

  try { SpreadsheetApp.getUi().alert("已產生 " + added + " 個新場次。"); } catch (_) {}
  console.log("generateSlots: 新增 " + added + " 筆");
}

function getOrCreateFolder(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function getOrCreateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function maskPhone(p) {
  p = String(p || "");
  if (p.length <= 6) return p;
  return p.slice(0, 4) + "***" + p.slice(-3);
}

function str(x) {
  return typeof x === "string" ? x.trim() : "";
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
