# hana-course-production 部署驗證｜2026-10-26 Asia/Taipei

## 實際部署

原失敗工作 [40261831105](https://github.com/h-s017/reservation/actions/runs/40261831105) 在 Wrangler 上傳前指出 CLOUDFLARE_ACCOUNT_ID 格式不合法。帳號擁有人回覆已處理後，確認原工作流程的 [40262872235](https://github.com/h-s017/reservation/actions/runs/40262872235) 已於 2026-10-26 11:12（Asia/Taipei）成功，無需再次部署。

- 正式來源：main，commit `002d55f53905329ff41ef39e26d986b7eb6826ff`。
- Worker：hana-course-production。
- Cloudflare version：`81ce3413-7a13-45a4-9510-6ad95697d000`。
- 管理後台：https://hana-course-production.hana-reservation-payment.workers.dev/admin 。
- Wrangler 上傳、trigger 更新及後台 HTTP 檢查全部 success。
- Logs 確認沿用 env.DB（hana-course-production）；正式設定檔的 D1 UUID 未修改。部署沒有執行 D1 migration、seed 或 SQL 更新。
- Account ID 由擁有人透過安全設定修正；Codex 未讀取或顯示 GitHub Secrets 的值。準備中的自動解析方案未提交、未套用，原正式部署設定保留。

## 實際唯讀檢查

- /admin、/admin.js、/admin.css：HTTP200。
- /admin 與 /admin.js 的SHA256分別與上述正式commit來源完全相同，HTML包含「開放整日預約」，JS已綁定openDate。
- 公開 /api/slots：HTTP200、ok=true、6348筆場次。
- 匿名 /api/admin/orders 與 /api/admin/date：帶正確Origin，HTTP401，在任何管理操作前拒絕。
- 本次沒有取得正式 ADMIN_TOKEN、讀取客戶聯絡資料、實際登入後台、開放日期、建立訂單、觸發付款／回呼、退款或修改資料。

## 離線與模擬測試

- 全部 payment-worker/test/*.test.mjs 通過，並核對現有課程價格。
- 新增 SQLite／D1相容回歸：已有PAID訂單與付款attempt時，整日關閉再開放後，orders、payment_attempts、slots的完整快照相同；closed_dates的指定手動限制移除。原已關閉場次仍不可預約。
- 新增admin模擬瀏覽器：390／1280px登入後按鈕可見、未填日期不送請求、取消確認不送請求、確認後只送closed=false、服務失敗後按鈕恢復、登出清除；零正式API操作。
- 既有customer模擬瀏覽器：390／1280px報名、付款失敗重試、ATM待轉帳／逾期、付款確認、退款申請／取消及訂單查詢均通過。無JS錯誤或水平溢出。
- 模擬金鑰與訂單均為合成fixture，不是正式API Token或客戶個資。

## 驗證邊界

按鈕資產已確實上線，登入後呈現及操作流程以相同來源的mock API測試驗證；未使用正式管理憑證代替本人登入，也沒有在正式日期按下開放。付款安全以既有測試及模擬供應商驗證，沒有執行真實扣款；不能將上述結果稱為真實金流端對端驗收或逐筆正式訂單對帳。

本PR只保留測試、公開唯讀驗證腳本與紀錄；不包含付款、預約或管理功能的正式程式變更，不需資料庫遷移。新增CI執行兩套mock瀏覽器測試並保存截圖artifact。原正式部署已成功，此PR不需為本次修正而合併或再次發布。
