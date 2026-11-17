#!/data/data/com.termux/files/usr/bin/bash
set -eu

echo "============================================================"
echo "       📦 تثبيت متطلبات QUIZORA على Termux"
echo "============================================================"
pkg update -y
pkg install python unzip curl tar -y

if ! command -v ngrok >/dev/null 2>&1; then
    case "$(uname -m)" in
        aarch64|arm64) ngrok_arch="arm64" ;;
        x86_64|amd64) ngrok_arch="amd64" ;;
        *)
            echo "❌ لا توجد حزمة ngrok مناسبة لمعمارية الهاتف: $(uname -m)" >&2
            exit 1
            ;;
    esac

    download_dir="$(mktemp -d)"
    trap 'rm -rf "$download_dir"' EXIT
    curl --fail --silent --show-error --location --retry 3 \
        "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${ngrok_arch}.tgz" \
        --output "$download_dir/ngrok.tgz"
    tar -xzf "$download_dir/ngrok.tgz" -C "$download_dir"
    if ! "$download_dir/ngrok" version; then
        echo "❌ تعذر تشغيل ngrok على هذا الهاتف." >&2
        exit 1
    fi
    cp "$download_dir/ngrok" "$PREFIX/bin/ngrok"
    chmod 755 "$PREFIX/bin/ngrok"
    rm -rf "$download_dir"
    trap - EXIT
fi

echo ""
echo "✅ تم التثبيت بنجاح."
echo "⚠️ أضف رمز حساب ngrok مرة واحدة على الهاتف:"
echo "ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN"
echo "ثم شغّل الأداة من مجلد المشروع بالأمر: bash run.sh"
echo "============================================================"

