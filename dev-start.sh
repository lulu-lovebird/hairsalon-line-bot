#!/bin/bash
# ============================================================
# 理髮店 LINE Bot 本地測試啟動腳本
# 使用方法: chmod +x dev-start.sh && ./dev-start.sh
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_TYPE="${1:-cloudflare}"  # 預設用 cloudflare，可傳入 ngrok

echo "======================================"
echo "  理髮店 LINE Bot - 本地測試啟動"
echo "======================================"

# 確認 .env 存在
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "❌ .env 不存在，請先執行: cp .env.example .env 並填入設定"
  exit 1
fi

# 確認 node_modules
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "📦 安裝依賴..."
  cd "$PROJECT_DIR" && npm install
fi

# 取得可用的穿透工具
if [ "$TUNNEL_TYPE" = "cloudflare" ]; then
  if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared 未安裝，請先執行:"
    echo "   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
    echo "   sudo dpkg -i cloudflared-linux-amd64.deb"
    exit 1
  fi
  echo ""
  echo "🌐 啟動 Cloudflare Tunnel..."
  cloudflared tunnel --url http://localhost:3000 &
  TUNNEL_PID=$!
  echo "   Tunnel PID: $TUNNEL_PID"
  echo "   ⏳ 等待 URL 產生（約5秒）..."
  sleep 5
  echo ""
  echo "📋 請將上方的 https://xxxx.trycloudflare.com 填入："
  echo "   1. LINE Developers → Webhook URL: <URL>/api/webhook"
  echo "   2. .env 的 NEXT_PUBLIC_APP_URL=<URL>"
elif [ "$TUNNEL_TYPE" = "ngrok" ]; then
  if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok 未安裝"
    exit 1
  fi
  echo ""
  echo "🌐 啟動 ngrok..."
  ngrok http 3000 &
  TUNNEL_PID=$!
  sleep 3
  # 透過 ngrok API 取得 URL
  NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "import sys,json; print(json.load(sys.stdin)['tunnels'][0]['public_url'])" 2>/dev/null || echo "請查看 ngrok 輸出")
  echo ""
  echo "🔗 ngrok URL: $NGROK_URL"
  echo "   請填入 LINE Developers → Webhook URL: $NGROK_URL/api/webhook"
fi

echo ""
echo "======================================"
echo "  🚀 啟動 Next.js 開發伺服器..."
echo "======================================"
cd "$PROJECT_DIR"
npm run dev

# 清理
if [ -n "$TUNNEL_PID" ]; then
  kill $TUNNEL_PID 2>/dev/null
fi
