# ✂️ 理髮小幫手 (Hair Salon LINE Bot) v1.0.0

理髮小幫手是一套專為理髮廳、美髮沙龍打造的 **LINE 官方帳號智慧預約與排程管理系統**。  
支援兩種部署架構：
1. 🌟 **純 Google Apps Script 方案（強烈推薦）**：**零伺服器、零資料庫費用**，所有預約即時寫入老闆的 Google 試算表，手機打開試算表 App 即可輕鬆管店！
2. 🚀 **Next.js + Vercel + Supabase 方案**：具備完整 LIFF Web App 管理後台與 JWT 資安防護的全端架構。

---

## 🌟 核心功能一覽

### 📱 客人前台（LINE 官方帳號）
* 📅 **智慧線上預約**：點選「立即預約」跳出日期選擇器，依序引導選擇設計師、剪髮服務項目與可用時段，發送確認卡片。
* 🗓️ **查詢我的預約**：隨時在 LINE 查看未來已預約的時段與設計師。
* ❌ **線上取消預約**：列出有效預約一鍵取消，即時釋出名額。
* ⏰ **貼心雙重提醒**：預約前一晚 20:00 與預約前 1 小時主動發送 LINE 推播提醒客人到店。

### 💈 設計師與店長行動管理（LINE 聊天室）
* 🔑 **一鍵身分綁定**：設計師在 LINE 輸入「`綁定 HS-XXXXXXXX`」，即刻開通工作身分。
* 📋 **「今日行程」/「明日行程」**：設計師隨時在手機看自己今天的接單清單與預約時間。
* 💰 **「我的業績」**：設計師即時查詢自己當月完成人次與累計營業額。
* ✅ **「完成」一鍵結帳**：服務結束後點擊選單，即刻標記客人為「已結帳」。
* 👑 **店長專屬「日報」/「今日總覽」**：店長隨時在手機查全店當日營業總額與各設計師進度（走免費 Reply，不扣 200 則配額）。

### 📊 Google 試算表頂部「理髮店系統」管理選單
打開試算表，上方工具列自動整合專屬管理工具：
* 📈 **產生 / 重新整理營運報表**：自動建立動態 QUERY 看板，即時顯示今日營收、本月營業額與各設計師排行榜。
* 📧 **即時寄送今日打烊結算信**：隨時一鍵統整今日帳目，寄送美化 HTML 日報至店長信箱。
* 📑 **查詢指定月份結算摘要**：輸入月份（如 `2026-10`），即時計算該月營業額與各設計師明細。
* 🔑 **產生設計師 LINE 綁定碼**：為新進或未綁定的同仁產生安全 8 碼金鑰。
* ⏰ **預約提醒推播檢查 (預覽)**：Dry-run 預覽模式，先確認推播則數與額度才發送，防誤扣配額。
* 🔧 **檢查 / 升級資料庫欄位**：一鍵平滑升級表頭欄位（補齊定價、實收、結帳時間），不影響舊資料。

---

## 🚀 方案一：純 Google Apps Script 5 分鐘極簡部署（推薦首選）

不用申請主機、不用建資料庫、完全免費：

1. **建立 Google 試算表**：前往 [Google 雲端硬碟](https://drive.google.com/) 新增一份試算表，命名為 `理髮店預約系統`。
2. **複製貼上程式碼**：
   * 點選「擴充功能 > Apps Script」，刪除原本程式碼。
   * 將本專案 [`gas/Code.gs`](gas/Code.gs) 的內容**全部複製貼上**並儲存（`Ctrl+S`）。
3. **初始化分頁**：
   * 在 Apps Script 上方下拉選單選擇 `initSheets`，點選「▷ 執行」（首次需授權權限）。
   * 回到試算表，自動建立好「預約紀錄」、「服務項目」、「設計師名單」、「營業時段」4 個分頁！
4. **填入 LINE 設定**：
   * 在 Apps Script 左側「專案設定 > 指令碼屬性」填入：
     * `LINE_CHANNEL_ACCESS_TOKEN`：LINE Developers Console 的 Channel Access Token
     * `LINE_CHANNEL_SECRET`：LINE Channel Secret
     * `SALON_NAME`：理髮店名
     * `SALON_ADDRESS`：理髮店地址
     * `ADMIN_EMAIL`：店長 Email（未填寫時會自動寄給試算表擁有者）
     * `ENABLE_1H_REMINDER`：建議設為 `false`（僅保留前一晚提醒，每月免費預約容量直接翻倍至 200 筆！）
5. **部署為 Web 應用程式**：
   * 右上角「部署 > 新增部署作業」，選擇「網路應用程式」。
   * 誰可以存取：選 **「所有人 (Anyone)」**。
   * 部署後複製 **Web App URL**。
6. **設定 LINE Webhook**：
   * 回到 LINE Developers Console > Messaging API > Webhook URL，貼上 Web App 網址並開啟「Use webhook」。
   * 大功告成！客人即可在官方帳號進行預約。

> 詳細圖文手冊與日常營運指引請參閱：
> * 📗 [純 Google 試算表極簡方案指南 (gas/README.md)](gas/README.md)
> * 📘 [店長日常營運與設定手冊 (docs/OPERATION_GUIDE.md)](docs/OPERATION_GUIDE.md)

---

## 🛠️ 方案二：Next.js 16 + Vercel + Supabase 全端方案

適合需要獨立 Web 管理後台、高度自訂與高併發連線需求的店家：

### 技術棧
- **前端與 API**：Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **LINE SDK**：`@line/bot-sdk` (Messaging API) + `@line/liff` (LIFF v2)
- **資料庫**：Supabase (PostgreSQL with RLS)
- **安全性**：原生 Node.js HS256 JWT + `crypto.timingSafeEqual` 防時序攻擊鑑權

### 快速開始
```bash
# 1. 安裝依賴
npm install

# 2. 設定環境變數
cp .env.example .env

# 3. 建立資料庫
# 在 Supabase SQL Editor 執行 supabase/schema.sql

# 4. 本機開發
npm run dev
```

### 部署至 Vercel
將專案 Push 至 GitHub 後匯入 Vercel，於 Project Settings 填入 `.env.example` 中的環境變數即可一鍵上線。

---

## 🏷️ 版本歷程

### v1.0.0 (2026-10-04) - 正式發布版
- 🌟 **Google Apps Script 極簡無伺服器方案**：
  - 完整 LINE Messaging API Webhook 支援（純 GAS 運行，零主機維護成本）。
  - `LockService` 併發排隊鎖防搶位機制，徹底解決試算表雙重預約痛點。
  - 試算表頂部「✂️ 理髮店系統」自訂選單（動態營運報表、即時打烊信、月份結算、金鑰綁定、推播測試、一鍵平滑升級）。
  - 設計師與店長 LINE 聊天室專屬管理指令（今日行程、我的業績、完成結帳、日報）。
  - LINE 每月 200 則免費推播配額自動守門員（190 則自動保護性暫停 + 警報 Email）。
  - 預約成立與取消時自動發送精美 HTML 通知信給店長。
- 🚀 **Next.js 16 + Supabase 完整方案**：
  - Phase 1～5 完整交付（Stateless 預約狀態機、Cron 排程提醒、LIFF 管理後台、HS256 JWT 鑑權防禦）。
  - 19 個 Next.js 頁面與 API 路由建置全數通過。
- 📘 **完整日常營運手冊**：營業時間調整、每週公休、春節連假店休與設計師請假管理圖文指引。

---

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。  
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
