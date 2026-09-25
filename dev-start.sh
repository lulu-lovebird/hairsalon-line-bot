#!/bin/bash
# ============================================================
# 理髮店 LINE Bot 本地測試啟動腳本
# 使用方法:
#   ./dev-start.sh              # 預設 Tailscale Funnel
#   ./dev-start.sh cloudflare   # Cloudflare Tunnel
#   ./dev-start.sh ngrok        # ngrok
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_TYPE="${1:-tailscale}"
PORT=3000

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

# ============================================================
# 穿透工具選擇
# ============================================================

if [ "$TUNNEL_TYPE" = "tailscale" ]; then
  # ── Tailscale Funnel ──────────────────────────────────────
  if ! command -v tailscale &> /dev/null; then
    echo "❌ tailscale 未安裝"
    exit 1
  fi

  echo ""
  echo "🔒 使用 Tailscale Funnel..."

  # 啟動 Funnel（背景執行，Next.js 結束時一併關閉）
  tailscale funnel $PORT &
  TUNNEL_PID=$!
  sleep 2

  # 自動取得 Funnel URL（從 tailscale funnel status 解析）
  FUNNEL_URL=$(tailscale funnel status 2>/dev/null | grep "https://" | head -1 | awk '{print $1}' | tr -d '|' || true)

  if [ -z "$FUNNEL_URL" ]; then
    # Fallback: 從 tailscale status 組合 URL
    TS_HOSTNAME=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Self']['DNSName'].rstrip('.'))" 2>/dev/null || hostname)
    FUNNEL_URL="https://${TS_HOSTNAME}"
  fi

  WEBHOOK_URL="${FUNNEL_URL}/api/webhook"
  LIFF_URL="${FUNNEL_URL}/liff/admin"

  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  🌐 Tailscale Funnel URL                             ║"
  echo "╠══════════════════════════════════════════════════════╣"
  echo "║  Webhook : $WEBHOOK_URL"
  echo "║  LIFF    : $LIFF_URL"
  echo "╠══════════════════════════════════════════════════════╣"
  echo "║  請到 LINE Developers Console 設定 Webhook URL       ║"
  echo "║  (URL 固定，不會每次重啟就改變 ✅)                    ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""

elif [ "$TUNNEL_TYPE" = "cloudflare" ]; then
  # ── Cloudflare Tunnel ────────────────────────────────────
  if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared 未安裝"
    echo "   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
    echo "   sudo dpkg -i cloudflared-linux-amd64.deb"
    exit 1
  fi

  echo ""
  echo "🌐 啟動 Cloudflare Tunnel..."
  cloudflared tunnel --url http://localhost:$PORT 2>&1 | grep -o 'https://[^"]*trycloudflare.com' &
  TUNNEL_PID=$!
  sleep 5
  echo ""
  echo "⚠️  注意：Cloudflare 臨時 URL 每次重啟會改變"
  echo "   請複製上方 URL 填入 LINE Developers Webhook 設定"

elif [ "$TUNNEL_TYPE" = "ngrok" ]; then
  # ── ngrok ────────────────────────────────────────────────
  if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok 未安裝"
    exit 1
  fi

  echo ""
  echo "🌐 啟動 ngrok..."
  ngrok http $PORT > /dev/null &
  TUNNEL_PID=$!
  sleep 3

  NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
    | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(next(u['public_url'] for u in t if u['proto']=='https'),end='')" 2>/dev/null \
    || echo "請查看 ngrok dashboard: http://localhost:4040")

  echo ""
  echo "🔗 ngrok URL: $NGROK_URL"
  echo "   Webhook: $NGROK_URL/api/webhook"
fi

# ============================================================
# 啟動 Next.js
# ============================================================
echo ""
echo "======================================"
echo "  🚀 啟動 Next.js (port $PORT)..."
echo "======================================"
cd "$PROJECT_DIR"
npm run dev

# 結束時清理穿透進程
if [ -n "$TUNNEL_PID" ]; then
  echo ""
  echo "🛑 關閉 Tunnel (PID: $TUNNEL_PID)..."
  kill $TUNNEL_PID 2>/dev/null || true
fi
