# QUIZORA

المشروع مرتب إلى `backend/` و`frontend/` و`docs/`. ملفات البيانات والسكربتات والاختبارات الخاصة بالخلفية موجودة داخل `backend/`.

- تشغيل الهاتف: نفّذ `bash setup.sh` مرة واحدة لتثبيت Python و`python-dotenv` وPRoot وngrok، أضف رمز حسابك محليًا إلى إعداد ngrok داخل Debian، ثم شغّل `bash run.sh` لبدء الخادم والنفق معًا. لاستخدام زري تشغيل وإيقاف على الشاشة الرئيسية، ثبّت Termux:Widget ثم نفّذ `bash install_android_widget.sh`.
- على Windows: جهّز ngrok المجاني مرة واحدة، وبعدها انقر `START_QUIZORA.bat` للتشغيل، و`STOP_QUIZORA.bat` للإيقاف. رابط الموقع الثابت هو `https://quizora.movb.workers.dev`.
- لفتح لوحة الإدارة المحلية، انقر `OPEN_ADMIN.bat`؛ سيبدأ الخادم المحلي عند الحاجة ويفتح صفحة الطابور.
- شرح وظيفة الملفات والتشغيل: [docs/README.md](docs/README.md).
- خطوات نشر `backend/` و`frontend/` على استضافتين منفصلتين موضحة في الدليل.
- دليل Termux المختصر: [docs/اقرأني_طريقة_التشغيل.txt](docs/اقرأني_طريقة_التشغيل.txt).
