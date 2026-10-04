# 課程付款：Cloudflare Worker + D1

## 目前狀態
2026-09-30 已部署獨立測試站：https://hana-course-test.hana-reservation-payment.workers.dev
管理頁：同網址 /admin.html。尚未設定金流與管理 Secrets；不能視為已完成藍新實際交易驗收。
正式 reservation.hanascent.com 尚未切換。既有 Google Sheet 資料、Apps Script 部署不變。Code.gs 保留原版作歷史用途，新測試站不再呼叫它。

## Audit 與檔案變更
原站以 index.html 定義課程與日期；Code.gs 產生場次、讀取 Sheet 人工設定、寫入報名、儲存付款證明並寄信。原成功頁以提交成功判定完成，沒有金流驗證。

- index.html：保留視覺、14 筆課程售價、日期/時段選擇與特殊活動入口；改讀 D1 場次，加入確認訂單。
- payment.js：建立訂單、送往 MPG、查詢付款、原訂單重試與完成頁。
- admin.html / admin.css / admin.js：受管理密鑰保護的訂單查詢、目前頁 CSV 匯出、名額/場次開關、關閉日期及未付款訂單取消。
- payment-worker/src/index.mjs：API、NotifyURL、ReturnURL、管理驗證及靜態頁面。
- payment-worker/src/orders.mjs：D1 訂單、名額交易、付款狀態及冪等更新。
- payment-worker/src/newebpay.mjs：AES-CBC 加密、TradeSha 驗證與金流請求。
- payment-worker/migrations/：資料表、名額/付款交易保護，以及從既有課程規則產生的場次。
- payment-worker/catalogue-rules.json、scripts/build-d1-seed.mjs：保留原後端禁約日期與特殊課程規則，價格取自 index.html。Vol.2=6500、組合=10500，依使用者確認；沒有變更前端售價。
- scripts/build-worker-assets.mjs：只發布頁面與公開資產；不發布 Code.gs、金鑰或後端原始碼。
- scripts/check-course-prices.mjs、payment-worker/test/、.github/workflows/payment-tests.yml：價格、安全與流程檢查。
- .github/workflows/update-overture-series.yml：舊的一次性價格改寫作業改為只檢查，防止重新插入舊價/付款連結。
- payment-worker/wrangler.toml、package.json、pnpm-lock.yaml、.gitignore：測試部署與依賴，排除 Secrets/建置產物。

新站已移除轉帳帳號、後五碼、付款截圖、FileReader/base64 上傳、人工對帳提示與對應驗證/樣式。歷史 Code.gs 中的舊流程保留但不再由新站使用；沒有刪除舊資料。

## 新流程與保護
選系列 → 課程 → 日期/時段 → 聯絡資料 → 訂單確認 → 前往付款 → 藍新 → 驗證 NotifyURL → PAID 才顯示報名完成。
金額由 D1 課程價格取得，不接受使用者指定金額。訂單 ID 唯一；付款重試產生新的交易編號但沿用同一筆課程訂單。重複通知不重複報名/扣名額；驗證簽章、商店、交易編號及金額。ReturnURL 只負責導回頁面。
狀態包括 PENDING / PAID / FAILED / CANCELLED。特殊比賽使用 LINE_CONFIRMATION，不導入線上付款。
建單保留名額；未開始付款的草稿逾期可自動取消。已送金流但結果未明的交易不自動釋放，避免付款成功卻沒有名額。這類交易需先向藍新查明，不能直接當失敗取消。

## Cloudflare Secrets
進入 Workers & Pages → hana-course-test → Settings → Variables and Secrets，新增以下四個 Secret（不要設為公開文字變數）：
- NEWEBPAY_MERCHANT_ID：藍新測試商店 MerchantID
- NEWEBPAY_HASH_KEY：同一測試商店 HashKey
- NEWEBPAY_HASH_IV：同一測試商店 HashIV
- ADMIN_TOKEN：密碼管理器產生的至少 32 字元隨機密碼，僅供管理頁登入
不要貼到聊天、GitHub 或 index.html。三個金流值需屬於同一個測試商店。設定後儲存/部署。
NEWEBPAY_ENV 保持 test。SITE_ORIGIN 與 PUBLIC_ORIGIN 已指向測試 Worker 網址。
MerchantID 雖由 Secrets 載入，MPG 協定仍要求付款表單傳送它；HashKey/HashIV 絕不傳到前端。

## 藍新 URL
若後台要求設定回傳網址，填入：
- NotifyURL：https://hana-course-test.hana-reservation-payment.workers.dev/payment/notify
- ReturnURL：https://hana-course-test.hana-reservation-payment.workers.dev/payment/return
- ClientBackURL：https://hana-course-test.hana-reservation-payment.workers.dev/?payment=return
後端亦會隨每筆 MPG 請求帶入以上網址。測試 gateway 為 https://ccore.newebpay.com/MPG/mpg_gateway。

## 測試方式
1. 設定測試 Secrets，開測試站選一個可預約課程；維持原課程價格，不需要改成 1 元。
2. 填測試聯絡資料，確認課程、場次、金額；點前往付款，使用藍新測試環境提供的測試付款資料。
3. 成功後應显示報名完成、付款金額與訂單編號。管理頁確認同一訂單 PAID 且有 TradeNo/Paid At。
4. 測試失敗、返回、重新整理及重試；失敗顯示付款未完成，重試沿用訂單。只有返回不能變成 PAID。
5. 測試最後一個名額、關閉日期、多堂課、手機畫面與特殊 LINE 流程。
6. 本機：在 repository root 執行 node scripts/check-course-prices.mjs 與 node --test payment-worker/test/*.test.mjs；瀏覽器測試在 payment-worker 執行 node test/browser.cjs（需 Playwright Chromium）。

## 部署維護
在 payment-worker 執行 Wrangler d1 migrations apply hana-course-test --remote，再執行 Wrangler deploy。Wrangler 會建立靜態資產。測試資料庫與正式資料庫必須分開；不要把测试订单帶到正式環境。
目前已部署 Worker 與 D1，不需使用 Google Sheet。未來正式上線仍需建立正式 D1、設定正式 Secrets、切換 NEWEBPAY_ENV=production 與網域/URL。

## 正式上線 checklist / 影響
- 完成藍新成功/失敗/重複通知端到端驗收與金額核對。
- 確認管理登入、場次、禁約日期、容量及所有 14 筆價格。
- 建立獨立正式 D1 與備份/還原流程；確定沒有要匯入的未來舊訂單（使用者目前確認沒有）。
- 設定正式商店 Secrets、production gateway、正式 HTTPS origin 與藍新 URL。
- 同步安排 DNS/前端切換；不要只合併 GitHub Pages 就當作已完成，空白 PAYMENT_API 預設使用同站 Worker API。
- 確認付款失聯交易的查詢/人工處置流程，避免長期占位。
- 管理頁不提供退款或手動標記已付款；退款需在藍新處理並另行協調名額。
- 舊 GAS 郵件通知不會由 D1 自動寄出，目前以付款完成頁與管理頁查詢；若需要自動寄信，需另接郵件服務。
- 原 Google Sheet 人工場次覆寫不會自動同步到 D1；新場次改由管理頁維護。CSV 每次匯出目前頁最多 200 筆，可翻頁。
- 管理密鑰僅保存在目前頁面記憶體，遺失/外洩時在 Cloudflare 更新。
- 商品購物車、物流、庫存與發票未納入本次課程購買範圍。

## 2026-09-30：通知與行動支付測試更新
- Notify endpoint 同時處理 application/x-www-form-urlencoded 與 multipart/form-data，保留相同簽章、金額與訂單驗證。拒絕通知時僅在 admin_audit 記錄安全錯誤分類，不保存付款原文、金鑰或個資。
- MPG 已啟用 CREDIT、ANDROIDPAY（Google Pay）、SAMSUNGPAY、LINEPAY。實際顯示仍取決於藍新商店服務開通與裝置支援；Apple Pay 依商店幕前支付設定與相容裝置顯示。尚未對每個行動支付方式完成實際驗收。
- LINE Pay 需在藍新另行開通；測試商店目前未確認已開通。ATM、超商等延後付款暫不啟用，待確認繳費期限/保留名額規則。
- 官方 MPG 2.0 文件： https://cwww.newebpay.com/website/Page/download_file?name=Online+Payment-Foreground+Scenario+API+Specification_NDNF-1.0.8.pdf
- 自動測試增為 13 項，包含兩種通知格式、重複通知、行動支付與延後支付分離。付款確認中的既有測試訂單仍需由藍新重送通知驗收，不能手動標記 PAID。

## 信用卡實際測試驗收完成
2026-09-30 已以藍新測試商店原交易的 server-to-server NotifyURL 驗收成功：NT$1,980 訂單更新為 PAID、記錄 TradeNo/Paid At，使用者確認完成頁成功。再次由藍新重送通知後仍只有一筆已付款交易、一組場次保留，付款時間未被改寫。
原先 503 的主因是 Web Crypto AES-CBC 對 padding 的限制與藍新 PHP-compatible 回傳格式不同；改為先驗證 TradeSha，再以 raw CBC 解密並嚴格檢查 1–32 byte padding。新增有效/損壞 padding 及簽章竄改測試，總計 14 項通過。Worker 使用 nodejs_compat；Secrets 維持 Cloudflare 加密保存。
信用卡成功與重複通知已完成實際驗收；行動支付、信用卡失敗與正式上線尚待驗收。

## 2026-10-01：目前測試站付款設定
- ATM 已開啟。新交易期限為建立交易當日 23:59:59（Asia/Taipei），取代原 48 小時方案；重試不延長同筆交易期限。
- 不指定 BankType，顯示藍新商店可用銀行；只傳 ExpireDate，不傳僅部分銀行支援的 ExpireTime。回傳未包含 ExpireTime 時，以當日 23:59:59 驗證，期限必須與後端原交易相符。
- 繳費截止必須不晚於首堂課前 36 小時，不符合者僅提供即時付款。取號只記錄銀行、帳號與截止時間，不代表付款完成。
- CustomerURL： https://hana-course-test.hana-reservation-payment.workers.dev/payment/account （後端自動帶入）。NotifyURL 驗證成功才更新原訂單 PAID。
- 逾期至少 10 分鐘後，每 10 分鐘排程查詢藍新並驗證 CheckCode；確認未付款/失敗/取消才釋放名額。查詢異常或已付款但通知未到時保留名額，避免超賣。
- 沒有取號回傳的未知交易需人工核對。取消後極晚入帳需核對退款或重新安排，不會自動恢復已釋放名額。
- 三期需求已實作，總價不變、商店負擔費用。但測試商店實測 InstFlag=3 回覆 MPG02003，因此目前 NEWEBPAY_INSTALLMENTS=0，待商店開通再啟用 3。
- LINE Pay 目前關閉，待確認商店開通。MPG 2.3 請求 Apple Pay、Google Pay、Samsung Pay；實際可用依商店及裝置，未逐一驗收。
- 17 項自動測試通過。信用卡付款與重複通知先前實際驗收成功；ATM 幕前頁已實際確認台灣銀行、華南銀行與 2026-10-01 23:59:59 截止；取號、模擬入帳及逾期流程仍需端到端驗收。
- ATM 測試：建立新測試訂單，選 ATM，確認可選銀行及當日截止時間，取號返回後應顯示待轉帳。藍新測試後台模擬入帳並送出通知後才可顯示報名完成。請勿對測試帳號實際匯款。
- 既有測試訂單、正式網站與舊 Google Sheet 均未修改。正式上線仍須獨立資料庫、Secrets、商店服務確認與完整驗收。

## ATM 測試帳號修正與入帳驗收
2026-10-01 藍新測試後台確認 ATM 取號已成功，但回傳 TestAccount12345 被原純數字帳號檢查拒絕。只在 NEWEBPAY_ENV=test 允許此確切測試值，正式環境仍只接受數字帳號；18 項測試通過。原 NT$990 訂單 HF5c616bcf40424f03a37ff49cd14a 已由藍新模擬入帳 Notify 驗證更新 PAID，未另建訂單。新取號回到網站的完整畫面與實際逾期查詢仍待驗收。

## ATM 新取號端到端驗收完成
2026-10-01 新測試訂單 HFe2411c38925b44a3a5e7f7e2d479 已成功取得測試帳號並返回網站顯示「待轉帳付款」、銀行 004、TestAccount12345、當日 23:59:59。D1 確認 PENDING、VACC、僅一筆付款交易。此筆維持未付款供實際逾期查詢驗收，未手動變更狀態或截止時間。19 項後端測試與 390/1280px 瀏覽器測試通過，新增取號回傳重複通知、待轉帳及逾期畫面驗證。實際排程查詢藍新與釋放名額仍待截止後核對；目前不可宣稱逾期端到端驗收完成。

## 2026-10-05：ATM 逾期完整流程驗收
根因為 Cloudflare 遠端 fetch 不相容 redirect:error。改為 redirect:manual，仍拒絕非成功 HTTP 回應並驗證商店、金額、訂單、支付方式及 CheckCode。新增安全錯誤分類，不保存原始付款回應或金鑰。21 項自動測試通過。
使用 Wrangler 官方遠端排程測試入口執行相同 scheduled handler，藍新實際查詢確認未付款（TradeStatus=0）。00:01:37 原測試訂單 HFe2411c38925b44a3a5e7f7e2d479 更新 CANCELLED、attempt FAILED、order_slots.active=0、場次 booked=0；未手動改訂單或期限。測試 Worker 已部署修正，定期排程維持每 10 分鐘。
ATM 取號、入帳通知、逾期查詢及名額釋放已分別以測試商店實際驗收。此次逾期執行由官方排程測試入口觸發；部署後自然排程處理其他新逾期交易仍應觀察。三期與 LINE Pay 尚未啟用；正式網站未切換。
