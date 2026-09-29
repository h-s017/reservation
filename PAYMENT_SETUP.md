# NewebPay 付款串接與驗收

本分支尚未部署，未設定任何真實金流憑證。`index.html` 的 `C.PAYMENT_API` 預設空白；未設定時會清楚提示付款尚未開放。請先完成測試環境驗收，再安排前後端同步切換。不要直接合併後就視為可收款。

## Audit 與變更

已閱讀原 repository 的 `index.html`、`Code.gs`、兩個 GitHub workflows、footer 同步腳本，並檢查資產清單。原站是 GitHub Pages 靜態頁；前端列出價格與日期，GAS 產生場次、套用「場次」工作表人工設定、計算已預約數、寫入「報名」工作表、存 Drive 圖片及寄信。原完成頁只根據 `doPost` 的 `ok` 判定，沒有金流驗證。

原本前後端唯二價格差異，已依使用者確認 **以原 index.html 為準** 同步後端：

| 課程 | 原網站／現在後端 | 舊 Code.gs |
| --- | ---: | ---: |
| Vol. 2｜調香師的和弦練習曲 | NT$6,500 | NT$4,800 |
| Vol. 1 ＋ Vol. 2 | NT$10,500 | NT$8,000 |

網站原有 14 筆課程／方案售價均未改動；早鳥與原價顯示保留。課程名稱、名額、場次 ID、禁約日期、36 小時限制、多堂課選取數量、字體與 header/footer 保留。後端補上既有前端的 36 小時檢查，避免直接呼叫 API 繞過。

| 檔案 | 修改 |
| --- | --- |
| `index.html` | 第 4 步資料、第 5 步確認；移除人工付款 UI、帳號、圖片欄位及舊付款樣式；引入 payment.js；保留原課程、日期與主要視覺 |
| `payment.js` | 建單、確認、MPG form POST、原訂單重試、狀態查詢及成功頁；同分頁 sessionStorage 保留隨機訂單存取 token |
| `Code.gs` | 保留場次產生／試算表讀取；加上經驗證的後端操作、鎖定／冪等更新、新欄位、通知信佇列；移除 Drive 付款證明功能 |
| `payment-worker/src/index.mjs` | 公開 API、限定來源 CORS、Worker→GAS 私密驗證、Notify／Return 分離 |
| `payment-worker/src/newebpay.mjs` | AES-256-CBC／PKCS#7、TradeSha、通知驗證、測試／正式 gateway |
| `payment-worker/wrangler.toml` | Worker 設定，預設 test，僅含公開 URL placeholders |
| `payment-worker/package.json`、lockfile | 部署與瀏覽器測試工具 |
| `payment-worker/test/` | 密碼學、付款狀態、金額、名額、特殊流程、前端整體流程測試 |
| `scripts/check-course-prices.mjs` | 比對網站與安全後端課程價格 |
| `.github/workflows/payment-tests.yml` | PR／main 自動安全測試 |
| `.github/workflows/update-overture-series.yml` | 已完成的一次性遷移改為只檢查價格，防止重新插入舊價與 Portaly 連結 |
| `.gitignore` | 排除本機 Secrets、依賴、Worker 暫存 |

已移除銀行轉帳／帳號／後五碼、付款截圖上傳、FileReader/base64、Drive 憑證儲存、舊 Portaly 課程付款連結、人工對帳提示／validation 與新訂單的舊狀態。歷史試算表資料與既存 Drive 檔案不會自動刪除。

大賽的 GAS 課程及 LINE 確認路徑保留，使用 `LINE_CONFIRMATION`，不會導向 MPG。原前端沒有啟用大賽項目，本次沒有重新開啟或變更外部 ACCUPASS／LINE 規則。大賽寫入也改經 Worker 授權，避免保留可公開偽造付款的寫入入口。

## 新流程與安全界線

選系列 → 選課 → 日期／時段 → 姓名／手機／Email／LINE／備註 → 後端建立 PENDING 並回傳金額 → 確認課程、每一堂日期／時間、金額 → 前往 NewebPay → Notify 驗證 → 同筆訂單 PAID → 報名完成。

- Worker 只接受 slotIds 與聯絡資料，不採用前端 amount、status 或 TradeNo。GAS 以原課程 catalogue 取價；多時段方案收整門課價格一次，非每堂乘算。人工「場次」工作表的 price 不會覆蓋課程價格。
- GAS 的 ScriptLock 保護建單、名額檢查及狀態更新。客戶隨機 token 的 SHA-256 作為建單冪等鍵；重送與網路中斷重試返回原訂單。
- 每筆報名只有一列；每次有效付款嘗試有唯一、29 字元英數 MerchantOrderNo。只有經驗證的失敗，才可以在原列建立新的付款嘗試，避免不確定結果下雙重扣款。
- PENDING 再次點付款會送出同一個 MerchantOrderNo／TimeStamp，絕不另建付款嘗試。藍新若判定訂單過期或重複且未提供可驗證結果，必須查明原交易，不能直接換單號再扣款。
- Notify 驗證 TradeSha，再 AES 解密，核對內外 MerchantID、付款種類、訂單／嘗試 ID、金額與 TradeNo。PAID 不會被後續失敗訊息降級；重送成功通知不重複寫入、不重複佔位。
- ReturnURL 忽略所有「成功」參數，只 303 導回網站；網站查詢後端 PAID 才顯示「報名完成」。付款回來但 Notify 尚未到達會顯示確認中。
- CANCELLED 用於尚未送出金流或已驗證失敗的訂單取消；有未決交易時拒絕取消。修改確認中的資料會先取消尚未付款的訂單，再建新草稿；**付款失敗重試仍使用原訂單**。
- 舊報名、PENDING、FAILED、PAID 與 LINE_CONFIRMATION 仍佔原場次名額；CANCELLED／歷史「已取消」不佔名額。為避免晚到的付款通知造成超賣，不自動釋放有未決交易的名額。需營運人員定期處理遺棄訂單；不可只憑瀏覽器返回／等待逾時就取消已送出交易。此版沒有自動交易查詢或退款 API。
- 訂單存取 token 不出現在 URL／金流欄位，只在 Authorization header 傳送；GAS 只保存 hash。關閉原分頁或清除儲存後需提供訂單編號由 LINE 協助查詢。
- HashKey／HashIV 從不送瀏覽器或寫 log。MerchantID 是 MPG 協定必要的 form 欄位，付款時必然可由瀏覽器看到，但不硬編碼在前端、repository 或公開設定。

## 1. 準備 Apps Script 與試算表

1. **先複製正式試算表作測試**，備份原 Code.gs 與部署版本；禁止把測試付款寫入正式表。
2. 將新 Code.gs 更新到綁定測試表的 Apps Script。專案與試算表時區均設 `Asia/Taipei`。
3. 專案設定 → 指令碼屬性新增 `GAS_SHARED_SECRET`：使用至少 32 字元隨機值，與 Worker 同名 Secret 相同。不要使用原前端公開 TOKEN。
4. 部署 Web App，執行身分為擁有者、可由任何人存取；使用新 `/exec` URL。寫入仍須 secret；公開 GET 僅供場次讀取。
5. 首次經 Worker 呼叫會在「報名」表第 P–AA 欄追加欄位；如該區已有自訂欄位，程式會停止而非覆寫，請先確認備份與欄位布局。
6. 欄位包含 Order ID、日期、時間、金額、Payment Status、NewebPay TradeNo、Created At、Paid At、Access Hash、Payment Attempts、系列、Notification State。原 A–O 欄及歷史內容保留；姓名、電話、Email、LINE、課程仍在原欄。
7. 安裝每 5 分鐘觸發 `sendBookingNotifications` 的時間觸發器並授權寄信。僅 PAID／大賽 LINE 待確認會寄管理通知；付款寫入不依賴信件成功。`CHECK_DELIVERY` 或停在 `SENDING` 的列要人工檢查送達，確認未送才清空該欄重試，避免重複寄信。
8. 收款確認只認新欄 `Payment Status = PAID`；歷史報名保持原狀，不自動視為藍新已付款。

## 2. 部署 Cloudflare Worker

需要部署 Worker；不需要 D1／KV，Google Sheet 是此最小改動版本的訂單來源。

於 `payment-worker` 安裝 Node.js 22+ 與 pnpm，再執行：

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler secret put NEWEBPAY_MERCHANT_ID
pnpm exec wrangler secret put NEWEBPAY_HASH_KEY
pnpm exec wrangler secret put NEWEBPAY_HASH_IV
pnpm exec wrangler secret put GAS_URL
pnpm exec wrangler secret put GAS_SHARED_SECRET
```

以上命令會提示輸入值；請在本機／Cloudflare Dashboard 輸入，勿放在 commit 或聊天訊息。第一次部署若需先建立 Worker，可先部署保留空設定的版本，它無法收款，再填入 Secrets。

| Secret | 值 |
| --- | --- |
| NEWEBPAY_MERCHANT_ID | 藍新測試商店 MerchantID |
| NEWEBPAY_HASH_KEY | 該測試商店 HashKey（32 bytes） |
| NEWEBPAY_HASH_IV | 該測試商店 HashIV（16 bytes） |
| GAS_URL | 測試 Apps Script 的 HTTPS `/exec` URL |
| GAS_SHARED_SECRET | 與該 Apps Script Script Properties 一致的隨機私密值 |

`wrangler.toml` 的公開設定：

- `NEWEBPAY_ENV = "test"`：目前只啟用信用卡一次付清；ATM、超商、條碼及其他付款種類不在這次驗收範圍。
- `PUBLIC_ORIGIN`：Worker 的真實 HTTPS origin，無結尾斜線。
- `SITE_ORIGIN`：測試前端 HTTPS origin；正式時才用 `https://reservation.hanascent.com`。

```sh
pnpm exec wrangler deploy
```

前端設定 `C.PAYMENT_API` 為 Worker HTTPS origin，`C.GAS` 為相同環境的 GAS URL。先在獨立 HTTPS 測試站使用，不要把正式網站接到測試商店。建議在 Cloudflare 對 `/orders` 建單路徑設流量限制；NotifyURL 不可套用互動式驗證／登入牆。

## 3. 藍新 URL

假設 Worker origin 為 `https://YOUR-PAYMENT-WORKER.workers.dev`：

| 用途 | URL |
| --- | --- |
| NotifyURL，server-to-server POST | `https://YOUR-PAYMENT-WORKER.workers.dev/payment/notify` |
| ReturnURL，付款後導回 | `https://YOUR-PAYMENT-WORKER.workers.dev/payment/return` |
| ClientBackURL | `https://reservation.hanascent.com/?payment=return`（測試時替換成測試網站） |

程式會在 TradeInfo 帶入以上 URL。若商店後台有回傳 URL／網域白名單設定，填入對應地址。Notify 與 Return 是 Worker URL，**不能填 GitHub Pages 頁面或 GAS URL**。測試 gateway 為 `https://ccore.newebpay.com/MPG/mpg_gateway`；正式為 `https://core.newebpay.com/MPG/mpg_gateway`。

## 4. 如何測試

不需要任何真實憑證的自動測試（repository 根目錄）：

```sh
node scripts/check-course-prices.mjs
node --test payment-worker/test/*.test.mjs
cd payment-worker
pnpm exec playwright install chromium
pnpm run test:browser
```

瀏覽器測試使用本地靜態站與模擬 API／付款頁，不連正式 GAS，也不實際刷卡。可設 `BROWSER_CHANNEL=msedge` 使用已安裝 Edge，`SCREENSHOT_DIR` 儲存預覽。

部署測試環境後，使用藍新測試商店提供的測試卡／驗證流程，逐項驗收：

- 單堂、Vol. 0 每一方案、Vol.1+2 兩堂、KPIA 12 時段：金額與原網站一致，總價不乘堂數。
- 付款前只有 PENDING；關掉付款頁或自行開 ReturnURL 不會完成報名。
- 測試成功：Notify 到達後原列 PAID、TradeNo／Paid At 寫入、成功頁顯示全部場次。
- 測試失敗：FAILED、「付款未完成」及「重新付款」；重試仍是同一 Order ID／同一列。
- 延遲 Notify、重送 Notify、Return 先到、Return 後到、關閉瀏覽器後 Notify 到：不得重複報名。
- 竄改 Amt／TradeInfo／TradeSha／MerchantID／訂單 ID：拒絕寫入。
- 停用測試 GAS 後送 Notify：Worker 回非 2xx；恢復後重送，僅更新一次。
- 兩人搶最後名額、多次點擊確認／付款：只保留有效訂單，最後名額不超收。
- 大賽測試使用另份測試資料調整可報名期間，確認走 LINE 而非 NewebPay；不要改正式大賽日期。
- 確認手機、桌面、官方 LINE／官網／IG／footer 連結與手動關閉場次。

本機 mock 測試不能取代真實 Cloudflare→Apps Script、藍新測試商店的完整交易驗收。尚未取得憑證時，不宣稱實際收款成功。

## 5. 正式上線 checklist

- [ ] 備份正式表及 GAS 部署；確認新增 P–AA 欄無衝突，時區正確。
- [ ] 測試環境完整成功／失敗／重試／延遲通知驗收通過。
- [ ] 正式 Worker 與測試 Worker 分開；設定正式三項藍新 Secrets，GAS 指向正式表。
- [ ] 明確把正式 Worker `NEWEBPAY_ENV` 改為 `production`，核對 SITE_ORIGIN／PUBLIC_ORIGIN。
- [ ] 正式 Notify／Return URL 可公開接收 POST，沒有 Cloudflare challenge；確認藍新商店信用卡服務已開通。
- [ ] 前端 PAYMENT_API／GAS 指向同一正式環境；前後端部署安排同步，舊公開寫入 token 停用。
- [ ] 設定通知信觸發器、Sheet 權限與 API 建單流量限制，建立未決訂單處理程序。
- [ ] 經商店允許執行正式小額／實際課程交易驗收；**不可改課程售價來測試**。退款須走藍新商店既有管理流程。
- [ ] 確認完成頁只認 PAID，沒有人工付款提示，沒有憑證／敏感資訊進入 logs。
- [ ] 驗收後再合併／上線；本次沒有執行這些正式操作。

## 原功能可能影響與限制

- 前後端需一併部署；只上傳 index.html 但沒設定 Worker 會無法付款。只部署新 GAS，舊前端 TOKEN 寫入會被拒絕。
- 舊表原欄位仍保留，但依賴「狀態」文字的人工篩選／外部公式要改認 PAID；舊已取消的排除邏輯保留。
- 不再支援原 Portaly／人工分期付款入口；這次 MPG 僅啟用信用卡一次付清。若要加入分期或其他支付方式，需另行商店開通與測試。
- 仍使用原名額模型（依場次 ID 計數），沒有重構成不同課程共享教室名額。
- 未決／遺棄訂單可能持續佔位，不能自動以逾時當作失敗。此版未加入排程查單／自動釋放／自助退款。未知或矛盾通知回非 2xx，需要核對藍新交易與 Sheet；不要手動改 PAID 來繞過驗證。
- Gmail 寄信額度、Apps Script 執行／鎖定額度及 Sheet 大量資料效能仍適用；小型既有架構保留，未宣稱可支援大型流量。

參考：[藍新官方 API 文件](https://www.newebpay.com/website/Page/content/download_api)、[Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)、[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。串接採 MPG v2.0 AES-CBC／TradeSha；請以商店帳戶可下載的最新規格與測試商店實際回傳完成最終驗收。
