# HANA EVENT｜心村裡的時空旅行

前端以素材資料夾的 `heart-village-site.zip` 為底稿，保留深色主題、主視覺及區塊。原 JPG 全數在 `hana-event/`，由附件與 ZIP 逐一核對 SHA-256。字型使用 HANASCENT.COM 的 Cormorant Garamond、Noto Serif TC、原本的 fallback stack、官方站使用的 WOFF2 與字重。與排程無關的站點不參與建置。

## 架構

- `hana-event/` 可獨立部署為靜態前端。`/heart-village` 為活動頁，首頁導向活動頁。`config.mjs` 的 `apiOrigin` 預設為空，預覽只顯示票價、梯次及明細。
- 活動訂單、付款嘗試、Webhook 去重及名額使用既有 HANA Reservation Worker 及同一 D1。舊課程、藍新交易、原場次與 Supabase 資料不需要搬遷。現有課程的資料表限制以單課程單價計費，本次以新增活動資料表容納混合票種。
- `/event-admin.html` 使用原 Reservation 管理密鑰，密鑰只在分頁記憶體中。後台可管理活動名稱、圖片網址、合作方、票價、梯次、團隊出席、允許組合、總名額及訂單狀態。
- `POST /api/focus/event-snapshot` 沿用 Reservation 的既有 `FOCUS_SYNC_TOKEN`。回傳活動與梯次彙總，無個資及交易明細。HANA FOCUS 本身不需調整。
- 現場模型採同一時間共同報到，管理員逐梯次勾選團隊並指定可搭配的組合，例如 A、C、AC。各梯次共用總名額，並以保守時窗擋住跨梯次重疊。13:00 候選需跨兩個出席區段；含完整體驗的梯次保留 180 分鐘，其他梯次保留最多 120 分鐘供換裝與體驗配置。團隊若要並行或分流，需先確認容量模型及現場動線。

## 測試環境

1. 在 Reservation **既有測試 D1** 套用活動遷移 0013、0014。由 `node scripts/build-event-seed.mjs` 產生 seed SQL，匯入同一測試 D1。seed 可重跑且不覆蓋後台調整。
2. 發布測試 Worker，為 `EVENT_SITE_ORIGIN` 與 `EVENT_PUBLIC_ORIGIN` 分別設定精確的 HTTPS 站點及 Worker origin，前端 `config.mjs` 則填入同一測試 Worker origin。未連接時前端可看預覽。
3. 測試金流模式用 `EVENT_MODE=test`。由符合資格的帳號持有人確認 Portaly 涵蓋活動收款，指定一次性、動態價、啟用的 TWD Plan，設定 `PORTALY_EVENT_PLAN_ID`、`PORTALY_PHYSICAL_EVENT_APPROVED`、`PORTALY_API_KEY`、`PORTALY_CALLBACK_SECRET`。僅接受 Test Key。Worker 對真實 Session、Webhook 和查詢只使用 Portaly 官方 HTTPS 來源。
4. 以測試管理員將活動設為已發布。出席表匯入的 40 梯次均為預約意向、可售名額為零。另行安排一個測試梯次的可支付組合與名額後，使用測試資料和付款頁顯示的測試卡驗收。測試完成再依實際安排設定營運資料。
5. 保留測試 Worker 的 Test 設定，以區隔測試交易及其 webhook。正式環境使用各自的資料庫及 Portaly 憑證。

測試命令

```sh
node --test payment-worker/test/*.test.mjs
node payment-worker/test/event-browser.mjs
node scripts/build-worker-assets.mjs
```

瀏覽器測試用 Node SQLite、Reservation Worker 的相同請求入口與合成簽章。可透過 `EVENT_PLAYWRIGHT`、`EVENT_CHROMIUM` 及 `EVENT_EVIDENCE` 指定本機瀏覽器與證據位置。實測 Portaly Test 仍需有效的活動 Plan 與測試 Worker。

## 正式收款開關

1. 由帳號持有人完成 Portaly 審核，確認以此活動方案收取實體活動費用，並在正式 Worker 的 Secrets 內配置 Live Key 和該 Key 對應的 Callback Secret。
2. 在正式 Reservation Worker 的 D1 套用 0013、0014 與活動 seed。0014 保留既有付款嘗試資料與唯一交易參照，並允許記錄 `live` 模式。先以測試環境驗證。
3. 設定 `EVENT_MODE=live`、`PORTALY_LIVE_ENABLED=true`、`PORTALY_PHYSICAL_EVENT_APPROVED=true`、`PORTALY_EVENT_PLAN_ID`、`EVENT_SITE_ORIGIN=https://event.hanascent.com` 與正式 Worker 的 `EVENT_PUBLIC_ORIGIN`。同一環境拒絕 Test Key。
4. HTTPS、正式結帳條款與可售場次確認後，由管理員開放確認過的日期、方案與名額。再將 GitHub Pages 的活動前端指向該正式 Worker。

## 金流狀態

- 已驗證的伺服器票價寫入訂單明細快照。客戶送出的明細金額只做變價確認，並由伺服器重算。D1 交易與 trigger 驗證票價、場次、重複請求和名額。
- 預約意向可由管理員轉成待付款，須通過團隊、組合、價格與名額核對。使用者可在原瀏覽器分頁查詢、結帳或取消未開始付款的訂單。申請意向的後續聯繫目前由營運團隊接手。
- 已送出金流但結果未明時保留名額。待付款草稿到期釋出；已建立付款工作階段的訂單須查驗 Portaly 結果後才釋出。建立 Session 時若通訊失敗且結果不明，後台保留 CREATING 供核對，避免盲目重試。逾期後的遲到付款登記 REVIEW，供人工核對。
- 付款狀態取決於簽章回呼或 Portaly 伺服器端查詢。已付款預約由營運確認。退款頁可登記處理中，實際退款由商家持有人操作，成功回呼更新紀錄及名額。
- Affiliate 已安裝，商家推廣維持關閉。活動的動態價方案與 Portaly 產品推廣的固定價資格不同。

## 官方規格對照

| 功能 | 核對結果 |
|---|---|
| 商品列表／組合 | `GET /api/digital-products`、`GET /api/digital-products/{productId}`、`POST /api/digital-products/checkout-sessions`，1–20 個項目，重複 ID 表數量，商品按伺服器取得的 `effectivePrice` 計算。共用模組提供方法。 |
| 活動動態價 | `GET /api/creator-subscription/plans?status=active` 讀取 `pricingType=dynamic`、`billingPeriod=one-time` 與 TWD；`POST /api/creator-subscription/checkout-sessions` 傳送由 D1 核定的 `amount`。 |
| 結帳欄位 | 官方欄位是 `planId`、`merchantOrderNumber`、`callbackUrl`、`successRedirectUrl`、`cancelRedirectUrl`、`metadata`。客戶電郵仍由 hosted checkout 驗證。 |
| Webhook | `x-portaly-event`、`x-portaly-timestamp`、`x-portaly-signature`。官方 Node HMAC-SHA256 v1 adapter 使用穩定排序 JSON，校驗 ±5 分鐘，再核對模式、工作階段、方案、金額與幣別。 |
| 交易查詢 | 具 Session 查詢、Session 清單與 Order 查詢。已放棄的結帳通常沒有 Webhook，付款處理中仍需保留名額。 |
| 取消與退款 | Hosted checkout 逾時或失敗可返回。訂閱 cancel API 是停止續扣。退款發起需 Live full-scope，整合金鑰和測試退款 API 有權限限制。活動藉已驗證的退款回呼同步。 |
| 實體活動 | 官方文件確認一次性動態價能力。此活動涉及實體服飾、調香及攝影的收款適用性，需 Portaly／商家持有人確認。 |

來源：[Portaly 官方技能](https://github.com/portaly-ai/portaly-skills)、[Portaly Payment 教學](https://portaly.cc/blog/portaly-payment-tutorial)、[官方金流審核清單](https://portaly.cc/blog/blog-portaly-payment-verification-checklist)。

## 待營運確認

可付款日期與團隊時段、每梯接待量與可混搭組合、取消／改期／退款規則、兒童票年齡、照片交付時間、首次開放精修加購與否，以及三方金流費用分攤。正式網站使用 GitHub Pages，並須驗證 HTTPS、預約 Worker 的跨站設定與正式金流。
