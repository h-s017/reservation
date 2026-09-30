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
