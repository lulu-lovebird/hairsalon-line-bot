# ✂️ 理髮店 LINE 預約系統 (純 Google Apps Script 方案)

本方案為專為理髮店老闆設計的**零伺服器、零資料庫負擔**極簡架構。  
顧客透過 LINE 官方帳號預約，所有預約資料**直接即時寫入老闆的 Google 試算表**，免安裝軟體、免維護資料庫，手機打開 Google 試算表 App 即可輕鬆管理！

---

## 🌟 架構亮點

1. **老闆體驗第一**：預約即時呈現於 Google 試算表，直接查看、改色標籤、新增顧客偏好備註。
2. **零伺服器費用**：不用 Vercel、不用 Supabase，完全運行於 Google 雲端與 LINE 官方伺服器（$0 元/月）。
3. **內建防搶位機制**：使用 Google Apps Script 的 `LockService` 腳本排隊鎖，防止同秒雙重預約。
4. **自動排程推播**：內建 Time-driven Trigger，預約前 24 小時（每晚 20:00 統一推播）與前 1 小時自動發送 LINE 提醒。

---

## 📋 5 分鐘快速設定步驟

### 第一步：建立 Google 試算表
1. 打開瀏覽器前往 [Google 雲端硬碟](https://drive.google.com/)，新增一份 **Google 試算表**。
2. 將試算表命名為：`理髮店預約管理系統`。
3. （不用手動建分頁，代碼首次執行時會自動初始化「預約紀錄」、「服務項目」、「設計師名單」、「營業時段」四個分頁）。

---

### 第二步：貼上 Apps Script 程式碼
1. 在試算表上方選單點選 **「擴充功能」 > 「Apps Script」**。
2. 刪除編輯器內原有的程式碼，將 `gas/Code.gs` 的**全部內容複製並貼上**。
3. 點選上方的 💾「儲存專案」（或按 `Ctrl+S` / `Cmd+S`）。

---

### 第三步：設定環境參數與時區 (重要！)
1. 在 Apps Script 左側邊欄點選 ⚙️ **「專案設定」**。
2. 找到 **「時區」**，確保設定為 **`(GMT+08:00) 台北時間 (Asia/Taipei)`**（非常重要，避免設計師排班星期計算偏差）。
3. 滑到最下方的 **「指令碼屬性」**，點選 **「新增指令碼屬性」** 並填入以下欄位：

| 屬性名稱 (Key) | 說明與範例值 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console 取得的 **Channel access token (long-lived)** |
| `LINE_CHANNEL_SECRET` | LINE Developers Console 取得的 **Channel secret** |
| `SALON_NAME` | 店名（例如：`Classic Barber 理髮廳`） |
| `SALON_ADDRESS` | 店址（例如：`台北市大安區忠孝東路四段 100 號`） |
| `ADMIN_EMAIL` | *(選填)* 接收預約/取消通知的信箱。多個可用逗號分隔（如 `boss@gmail.com,staff@gmail.com`）。未填寫時會自動寄給 Google 試算表擁有者。 |
| `ENABLE_PUSH_REMINDER` | *(選填)* 是否啟用 LINE 主動提醒推播（預設 `true`）。若設為 `false` 則關閉所有主動推播，省下 100% 推播額度。 |
| `ENABLE_1H_REMINDER` | *(選填)* 是否啟用「前 1 小時提醒」（預設 `true`）。**強烈推薦設為 `false`**：僅保留「前一晚 20:00 提醒」，每筆預約推播消耗從 2 則降為 1 則，每月免費預約容量直接翻倍至 200 筆！ |

*設定完成後點選「儲存指令碼屬性」。*

---

### 第四步：部署為 Web 應用程式 (Web App)
1. 在 Apps Script 右上方點選藍色的 **「部署」 > 「新增部署作業」**。
2. 點選左側齒輪 ⚙️「選取類型」，選擇 **「網路應用程式」**。
3. 設定如下：
   - **說明**：`v1.0`
   - **以這個身分執行**：`我 (您的 Google 帳號)`
   - **誰可以存取**：**`所有人 (Anyone)`** *(重要！LINE 伺服器才能將訊息傳送進來)*
4. 點選 **「部署」**。首次部署時 Google 會彈出權限授予視窗，依序點選「進階」>「前往專案（不安全）」並允許存取試算表。
5. 部署完成後，複製畫面上顯示的 **「網路應用程式網址 (Web App URL)」**。

---

### 第五步：設定 LINE Developers Console
1. 前往 [LINE Developers Console](https://developers.line.biz/)，點入您的 Messaging API Channel。
2. 進入 **Messaging API** 分頁：
   - **Webhook URL**：貼上剛才複製的 **Web App URL**。
   - 點選 **「Update」**，接著開啟 **「Use webhook」** 開關。
   - 點選 **「Verify」**，若顯示 `Success` 代表已成功接通！
3. 在同一頁面的 **LINE Official Account features** 中：
   - 點選「Edit」進入 LINE Official Account Manager。
   - 將 **自動回應訊息 (Auto-reply messages)** 設定為 **停用 (Disabled)**。
   - 將 **聊天 (Chat)** 可依需求開啟或保留純 Bot 模式。

---

### 第六步：設定自動提醒定時器 (可選，強烈推薦)
若希望系統能自動在**前一天晚上 8 點**與**時段前 1 小時**主動提醒客人：
1. 回到 Apps Script 頁面，點選左側時鐘圖示 ⏰ **「觸發條件 (Triggers)」**。
2. 點選右下角 **「+ 新增觸發條件」**：
   - **選擇要執行的功能**：`sendBookingReminders`
   - **選取活動來源**：`時間驅動 (Time-driven)`
   - **選取時間型觸發條件類型**：`分鐘計時器 (Minutes timer)`
   - **選取分鐘間隔**：`每 15 分鐘 (Every 15 minutes)`
3. 點選「儲存」即可完成自動排程設定。

---

## 📊 試算表日常維護指引

* **預約紀錄**：顧客完成預約後會自動新增一列。店員若手動更動狀態，可將「狀態」欄位直接修改為 `cancelled`、`arrived`（到店）或 `no_show`（爽約）。
* **服務項目**：直接在工作表中增減服務項目、調整時長（分鐘）或價格，將狀態設為「啟用」或「停用」。
* **設計師名單**：設定每位設計師的上班日（0代表週日、1代表週一，依此類推）。
* **營業時段**：設定理髮店每日營業起迄時間、每時段時長（預設 30 分鐘）與同一時段最大容納客人數。

---

## 🔄 未來若有修改程式碼（如何更新部署？）
若您日後修改了 `Code.gs` 的內容：
1. 點選右上角 **「部署」 > 「管理部署作業」**。
2. 點選右上角鉛筆圖示 ✏️（編輯）。
3. 在「版本」下拉選單選擇 **「新版本」**。
4. 點選右下角 **「部署」** 即可套用更新（**網址不會變**，不需要重新設定 LINE Console）。

---

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。  
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
