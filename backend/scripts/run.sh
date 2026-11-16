#!/data/data/com.termux/files/usr/bin/bash
echo "============================================================"
echo "       🚀 خادم QUIZORA يعمل الآن على Termux"
echo "============================================================"
echo ""
echo "📱 افتح متصفحك (Chrome) على الرابط التالي للحل:"
echo "👉 http://localhost:8700"
echo ""
echo "💡 لإيقاف السيرفر: اضغط Ctrl + C"
echo "============================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR" || exit 1
python server.py

