#!/data/data/com.termux/files/usr/bin/bash
set -eu

echo "============================================================"
echo "       📦 تثبيت متطلبات QUIZORA على Termux"
echo "============================================================"
pkg update -y
pkg install python unzip curl proot-distro -y

if ! proot-distro login debian -- /bin/true >/dev/null 2>&1; then
    proot-distro install debian
fi

case "$(uname -m)" in
    aarch64|arm64) ngrok_arch="arm64" ;;
    x86_64|amd64) ngrok_arch="amd64" ;;
    *)
        echo "❌ لا توجد حزمة ngrok مناسبة لمعمارية الهاتف: $(uname -m)" >&2
        exit 1
        ;;
esac

proot-distro login debian -- bash -lc \
    'apt-get update && apt-get install -y ca-certificates curl tar'
if ! proot-distro login debian -- bash -lc \
    'command -v ngrok >/dev/null 2>&1'; then
    proot-distro login debian -- bash -lc \
        "curl --fail --silent --show-error --location --retry 3 https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${ngrok_arch}.tgz --output /tmp/ngrok.tgz && tar -xzf /tmp/ngrok.tgz -C /usr/local/bin && chmod 755 /usr/local/bin/ngrok && rm -f /tmp/ngrok.tgz"
fi
proot-distro login debian -- ngrok version

echo ""
echo "✅ تم التثبيت بنجاح."
echo "⚠️ أضف رمز حساب ngrok مرة واحدة على الهاتف:"
echo "proot-distro login debian -- ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN"
echo "ثم شغّل الأداة من مجلد المشروع بالأمر: bash run.sh"
echo "============================================================"

