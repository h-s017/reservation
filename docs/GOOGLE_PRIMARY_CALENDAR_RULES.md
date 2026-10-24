# HANA WORKSPACE｜使用原本 Google Calendar 的預約衝突規則

**決策：使用者已選 A，沿用原本的 Google Calendar，不再要求新增第二個日曆。**
日常仍可只在 HANA WORKSPACE 輸入新行程；另外已存在於原本 Google Calendar 的忙碌事件，可在完成授權後透過既有 Reservation Worker 唯讀同步。
尚未完成實際 Google Cloud / Cloudflare 授權與正式環境部署；本文件不代表 live sync。

## 規則優先順序（僅針對 Google Calendar 來源）
1. **忽略／繼續開放**：取消的活動、Google 標示「有空」(transparency=transparent)、工作地點（workingLocation）、本人已拒絕的邀請；可選擇明確標題 [可預約] 或 [HANA:OPEN]。
2. **明確封鎖**：標題 [不可預約]、[HANA:BLOCK]、停止預約等字樣，優先於模糊的課程名稱。但 Google 已標示「有空」或本人已拒絕的邀請仍不應據此封鎖（如要確定禁約，請在 HANA WORKSPACE 輸入）。
3. **需本人確認**：狀態 tentative、本人回覆 needsAction/tentative 的邀請；有「氣味藝術序曲／KPIA／調香課程」的活動紀錄（可能只是對公開團體課的提醒）；一般沒有明確是否忙碌的全天活動。這些先進待確認清單，不能直接自動關閉課程。
4. **自動封鎖**：其餘已確認、且 Google 標示忙碌的計時事件（會議、私人行程、演出、外出等）；標明「安息日／休假／休息日／旅行／請假」的全天事件。
5. 已有學員預約撞期時，只顯示待人工處理，不可擅自取消、退款或釋出座位。日曆事件取消或移除後僅撤銷屬於該事件的 Google 禁約；HANA WORKSPACE 人工禁約、其他 Google 事件以及獨立手動關閉的場次保持有效。

## 範例（使用原本 Calendar 的真實排程型態，僅表示規則，不透露私人事件內容）
| Google 行程類別 | 判斷 | 影響 |
| --- | --- | --- |
| 已確認，14:00–16:00 的一般工作會議 | 自動封鎖 | 暫停重疊的公開招生場次 |
| 已確認但全天的「氣味藝術序曲 Vol.1」 | 待確認 | 不會把原本正在招生的課程直接關閉 |
| 未標清楚實際時數的一般全天活動 | 待確認 | 由管理者確認是否整天不能上課 |
| Google 顯示「有空」的活動或已拒絕邀請 | 忽略 | 不更動預約 |
| 全天的安息日或休假 | 封鎖全天 | 禁止新增衝突預約；不影響既有已付款訂單 |

## HANA WORKSPACE 操作
- 在 Reservation Manager 的 **「預覽自動判斷」** 查看「會封鎖／待你確認／不影響」的數量與待確認事件；預覽 API 經 ADMIN_TOKEN 驗證，且不修改 D1。
- 需要強制封鎖的全天行程，直接在 HANA WORKSPACE 新增完整日期/時間的忙碌時段；不需要去 Google 再填一次。
- 人工建立的禁約立即成為同一 Worker 的行程覆蓋層（前提是 Worker 已部署）。
- 每 10 分鐘執行一次 Google 同步，只在完成授權與正式部署之後才會生效。同步成功時間與逾時／失敗狀態均顯示在後台。

## 授權與保密
- 已連接 ChatGPT 的 Google Calendar 可以協助檢查，但 **ChatGPT 的連線授權不會自動傳遞到 Cloudflare Worker**。
- 目前程式採 Google Cloud service account 的唯讀 Calendar API；若要使用既有私人行事曆，必須由行事曆擁有者授權該 service account 查看事件詳情，並將**該使用者行事曆的實際 calendar ID** 經 Cloudflare Worker Secret `GCAL_BUSY_CALENDAR_ID` 設定。**不能使用 `primary`，否則會指向 service account 的日曆**。
- Worker vars：`GCAL_SYNC_MODE = "primary_review"`；本模式必須配合明確 Calendar ID。憑證 `GCAL_SERVICE_ACCOUNT_JSON` 只能設在 Cloudflare Secrets，絕對不放 GitHub 或前端。
- 先做 staging 確認讀取權限、日曆來源、公開課未誤關閉及已付款訂單保護，才能請使用者另外批准正式部署。若 Google 的私人日曆無法分享 service account，需改用使用者授權的 OAuth 整合，不可繞過授權或把個人密碼直接貼入 GitHub。

## 目前限制
- 這是可測試的**規則式分類器**，不是能完美推斷所有活動性質的 LLM。若活動標題不清楚或沒有實際起訖時間，應留待確認而非擅自判斷。
- 在系統未部署、金鑰未設定以前，網站不會自動因 Google Calendar 行程變更。
- 預覽結果可在授權後台暫時顯示活動名稱供管理者核對，但事件標題不儲存在公開 GitHub 或 D1 的 Google 禁約表；D1 只儲存泛稱「Google Calendar 忙碌」及時間與雜湊事件 ID。
