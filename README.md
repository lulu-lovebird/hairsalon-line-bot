# ✂️ 理髮店 LINE 預約系統

理髮店智慧預約系統，透過 LINE Bot 提供客人線上預約功能，並以 LINE LIFF Web App 作為店家後台管理介面。

## 技術棧

- **框架**：Next.js 16 (App Router) + TypeScript
- **LINE**：@line/bot-sdk (Messaging API) + @line/liff (LIFF)
- **資料庫**：Supabase (PostgreSQL)
- **UI**：Tailwind CSS v4
- **部署**：Vercel

## 功能

### 客人前台（LINE Bot）
- 📅 線上預約理髮（選設計師 / 時段 / 服務）
- 🗓️ 查詢我的預約
- ❌ 取消預約
- ⏰ 預約前 24 小時 & 1 小時自動提醒

### 店家後台（LINE LIFF）
- 👥 設計師管理（排班、請假）
- 🕐 預約時段管理（開放時段、假日設定）
- 📅 預約管理（日曆視圖、手動新增/修改）
- ✂️ 服務項目管理
- 👤 客人資料管理
- 📊 數據報表

## 快速開始

### 1. 安裝依賴
```bash
npm install
```

### 2. 設定環境變數
```bash
cp .env.example .env
# 填入 LINE、Supabase 相關設定
```

### 3. 建立資料庫
在 Supabase SQL Editor 執行 `supabase/schema.sql`

### 4. 本機開發
```bash
npm run dev
```

## 環境變數說明

| 變數名稱 | 說明 |
|---------|------|
| `ADMIN_LINE_IDS` | 管理員 LINE UID（逗號分隔）|
| `LINE_CHANNEL_ID` | LINE Channel ID |
| `LINE_CHANNEL_SECRET` | LINE Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Channel Access Token |
| `LIFF_ADMIN_ID` | 後台 LIFF App ID |
| `NEXT_PUBLIC_LIFF_ADMIN_ID` | 後台 LIFF App ID（前端用）|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL（前端用）|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key（前端用）|
| `NEXT_PUBLIC_APP_URL` | 應用程式公開 URL |
| `CRON_SECRET` | Cron Job 驗證密碼 |
| `SALON_NAME` | 店家名稱 |
| `SALON_ADDRESS` | 店家地址 |
| `SALON_PHONE` | 店家電話 |

## 開發進度

- [x] Phase 1：環境建置 & 資料庫 Schema
- [ ] Phase 2：LINE Bot 核心流程（預約/查詢/取消）
- [ ] Phase 3：提醒排程服務
- [ ] Phase 4：LIFF Admin 後台完整 UI
- [ ] Phase 5：整合測試 & 上線

## LINE 設定

### Webhook URL
```
https://your-app.vercel.app/api/webhook
```

### LIFF URL
```
https://your-app.vercel.app/liff/admin
```
