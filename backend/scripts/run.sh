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
if ! command -v pkill >/dev/null 2>&1; then
    echo "❌ أدوات إدارة العمليات غير مثبتة. شغّل bash setup.sh أولًا." >&2
    exit 1
fi
if ! python -c 'import dotenv' >/dev/null 2>&1; then
    echo "❌ حزمة python-dotenv غير مثبتة. شغّل bash setup.sh أولًا." >&2
    exit 1
fi
if ! proot-distro login debian -- bash -lc 'command -v ngrok >/dev/null 2>&1'; then
    echo "❌ ngrok غير مثبت داخل Debian. شغّل bash setup.sh أولًا." >&2
    exit 1
fi

cd "$PROJECT_ROOT"
# Stop stale ngrok tunnel first. This also prevents ERR_NGROK_334 and
# ensures the new process owns the reserved endpoint.
proot-distro login debian -- bash -lc \
    "pkill -f '[n]grok http .*8700' 2>/dev/null || true" >/dev/null 2>&1 || true
pkill -f '[p]ython.*backend/server\.py' 2>/dev/null || true
sleep 2

PORT="$PORT" QUIZORA_BIND_HOST="0.0.0.0" TOOL_NO_BROWSER="1" python backend/server.py &
SERVER_PID=$!
TUNNEL_PID=""

cleanup() {
    if [ -n "$TUNNEL_PID" ]; then
        kill "$TUNNEL_PID" 2>/dev/null || true
        wait "$TUNNEL_PID" 2>/dev/null || true
    fi
    proot-distro login debian -- bash -lc \
        "pkill -f '[n]grok http .*8700' 2>/dev/null || true" >/dev/null 2>&1 || true
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

proot-distro login debian -- ngrok http "127.0.0.1:$PORT" --url "$API_URL" &
TUNNEL_PID=$!
tunnel_ready=0
for _ in {1..120}; do
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
if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "https://quizora.movb.workers.dev" >/dev/null 2>&1 || true
fi
wait "$TUNNEL_PID"

