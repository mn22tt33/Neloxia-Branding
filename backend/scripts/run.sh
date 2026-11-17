#!/data/data/com.termux/files/usr/bin/bash
set -eu

echo "============================================================"
echo "       🚀 تشغيل QUIZORA على Termux"
echo "============================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT=8700
CONFIG_FILE="$PROJECT_ROOT/frontend/config.js"
API_URL="$(sed -n 's/^[[:space:]]*var apiBaseUrl = "\(https:\/\/[^"]*\)";.*/\1/p' "$CONFIG_FILE" | head -n 1)"

if [ -z "$API_URL" ]; then
    echo "❌ تعذر قراءة عنوان ngrok من frontend/config.js." >&2
    exit 1
fi
if ! command -v proot-distro >/dev/null 2>&1; then
    echo "❌ PRoot-Distro غير مثبت. شغّل bash setup.sh أولًا." >&2
    exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
    echo "❌ curl غير مثبت. شغّل bash setup.sh أولًا." >&2
    exit 1
fi
if ! proot-distro login debian -- bash -lc 'command -v ngrok >/dev/null 2>&1'; then
    echo "❌ ngrok غير مثبت داخل Debian. شغّل bash setup.sh أولًا." >&2
    exit 1
fi

cd "$PROJECT_ROOT"
PORT="$PORT" python backend/server.py &
SERVER_PID=$!
TUNNEL_PID=""

cleanup() {
    if [ -n "$TUNNEL_PID" ]; then
        kill "$TUNNEL_PID" 2>/dev/null || true
        wait "$TUNNEL_PID" 2>/dev/null || true
    fi
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

server_ready=0
for _ in {1..30}; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        wait "$SERVER_PID"
        echo "❌ توقف الخادم قبل أن يصبح جاهزًا." >&2
        exit 1
    fi
    if curl --silent --show-error --fail --max-time 2 \
        "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
        server_ready=1
        break
    fi
    sleep 1
done
if [ "$server_ready" -ne 1 ]; then
    echo "❌ لم يستجب الخادم المحلي على المنفذ $PORT." >&2
    exit 1
fi

proot-distro login debian -- ngrok http "$PORT" --url "$API_URL" &
TUNNEL_PID=$!
tunnel_ready=0
for _ in {1..60}; do
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
        wait "$TUNNEL_PID"
        echo "❌ توقف ngrok. تأكد من إعداد رمز الحساب ومن أن العنوان متاح." >&2
        exit 1
    fi
    if curl --silent --show-error --fail --max-time 3 \
        --header "ngrok-skip-browser-warning: true" \
        "$API_URL/api/health" >/dev/null 2>&1; then
        tunnel_ready=1
        break
    fi
    sleep 1
done
if [ "$tunnel_ready" -ne 1 ]; then
    echo "❌ لم يصل ngrok إلى الخادم عبر $API_URL." >&2
    exit 1
fi

echo ""
echo "✅ الخادم والنفق يعملان."
echo "📱 الموقع العام: https://quizora.movb.workers.dev"
echo "🔗 عنوان الـAPI: $API_URL"
echo "🏠 الواجهة المحلية: http://localhost:$PORT"
echo "💡 للإيقاف اضغط Ctrl+C. لا تشغّل ngrok على الكمبيوتر والهاتف في الوقت نفسه."
wait "$TUNNEL_PID"

