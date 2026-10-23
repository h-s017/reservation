# HANA Reservation Manager｜LINE + Email 通知部署與授權

## 系統原則
管理者只需進入 HANA WORKSPACE；客戶只需使用 reservation.hanascent.com。

通知事件由既有 Reservation Cloudflare Worker / D1 的訂單狀態變更寫入通知 outbox，不依賴客戶瀏覽器持續開啟。寄送由 Worker 執行，結果留在 D1，由 HANA WORKSPACE 已授權管理 API 查詢。

本文件僅是部署與授權說明；**程式已提交不代表通知正式上線**。

## 預設通知類型
- **新報名／待付款**：客戶建立訂單，明確標示未付款，不等於完成報名。
- **付款成功**：藍新已驗證的交易成功狀態，獨立通知一次；重複回傳不重複新增成功事件。
- **取消／退款申請／退款完成**：狀態變更後各自通知，系統不得依通知自行退款。
- **付款失敗／系統異常**：待管理者核對。重複異常需節流，避免洗版。

LINE 與 Email 只傳送必要摘要（課程、日期、訂單代碼與狀態），不直接推送學員電話、電子郵件、銀行資料或備註。詳細資料留在受保護的 HANA WORKSPACE。

## 正式啟用前，需取得的外部授權
1. **LINE 官方帳號**：確認使用現有 HANA LINE Official Account 的 Messaging API，並由帳號管理者在安全管理介面建立／授權 Channel Access Token。通知對象必須是管理者的 LINE User ID；不是學員的 LINE ID、不是 Rich Menu URL，也不是官方帳號的公開 ID。管理者須能接收該官方帳號的推播訊息。
2. **Email**：選定接收通知的 Email；設定 Resend Email API 帳戶、已驗證寄件網域及 API Key。Resend 是提議的技術供應者，尚未代表使用者開通或授權。需要時可另行更換為其他已驗證 Email 供應商。
3. **Cloudflare**：只在 Cloudflare Worker 的環境變數／Secrets 管理端設定以下值；不要貼到 GitHub、聊天紀錄、HTML 或前端 JS：
   - LINE_CHANNEL_ACCESS_TOKEN（Secret）
   - LINE_NOTIFY_USER_ID（私密接收者 ID／Secret）
   - RESEND_API_KEY（Secret）
   - NOTIFY_EMAIL_TO（私人收件信箱）
   - NOTIFY_EMAIL_FROM（已驗證的寄件身份）
4. **發送總開關**：`NOTIFICATIONS_ENABLED = "false"` 為安全預設。只有在 staging 通過實際通知測試並獲得使用者同意後，才可改成 `true`。單獨合併 GitHub PR 不表示可開啟正式發送。

## 測試／驗收
- D1 遷移、付款／退款測試與新增通知測試均通過，再評估部署到 staging。
- 建立未付款測試訂單：只顯示「待付款」，不可提前稱為「付款成功」。
- 驗證付款成功（用測試金流簽章而非假資料直接更改正式訂單），LINE 和 Email 各一封／則；重複 callback 不重複通知。
- 單一管道異常時，其餘管道可獨立送達；重試不重寄已成功管道。LINE 使用 X-Line-Retry-Key，Email 使用 Idempotency-Key。
- 核對取消／退款狀態；不因通知操作更動既有訂單付款或名額。
- 斷線或缺少 Secrets 時，記錄待發送或失敗，不將金鑰或客戶資料顯示到公開頁面。
- 從 HANA WORKSPACE 查詢通知狀態，確認只憑管理授權才能存取。
- 確認正式 D1 備份，才套用 migrations（含 `0012_notifications.sql`）與 Worker 更新；完成後再上線 HANA WORKSPACE 新頁面。

## 目前明確限制
- 本專案 GitHub 自動測試通過不代表 LINE 官方帳號、Resend、Cloudflare production 已串接。
- 需取得帳號授權、LINE 收件者 userId、Email 收件設定及 Cloudflare production 操作權限才能進行完整端到端測試；目前沒有直接操作 Cloudflare 正式環境的連線。
- 單一 HANA WORKSPACE 登入（SSO）仍待實作，目前使用既有管理 API Token；請避免將它儲存到瀏覽器永久儲存空間。
