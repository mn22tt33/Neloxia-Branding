#!/data/data/com.termux/files/usr/bin/bash
echo "============================================================"
echo "       📦 تثبيت متطلبات QUIZORA على Termux"
echo "============================================================"
pkg update -y
pkg install python unzip -y
echo ""
echo "✅ تم التثبيت بنجاح! يمكنك الآن تشغيل الأداة عبر:"
echo "bash backend/scripts/run.sh"
echo "============================================================"

