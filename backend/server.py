# -*- coding: utf-8 -*-
"""خادم موحّد لأداتَي الحل: الثقافة المالية (SPX) + Qureo.

- التشغيل من جذر المشروع: bash backend/scripts/run.sh (أو: python backend/server.py)
- يفتح صفحة محلية فيها اختيار ثقافة/كيريو، أكواد متعددة، تقدم وسجل مباشر.
من إعداد أحمد نادي.
"""
import json
import os
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(BACKEND_DIR, "data")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from queue_store import PostgresQueue, QueueCapacityError, QueueStoreError

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_ORIG_STDOUT = sys.stdout

PORT_BASE = int(os.environ.get("PORT", "8700"))
VERSION = 2
MAX_ACCOUNTS = 20
MAX_LOG_LINES = 800
STATUS_LOG_LINES = 120
DEFAULT_CONCURRENCY = 1
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
APP_ENCRYPTION_KEY = os.environ.get("APP_ENCRYPTION_KEY", "").strip()
if not DATABASE_URL and os.environ.get("QUIZORA_REQUIRE_DATABASE") == "1":
    raise RuntimeError("DATABASE_URL is required for this deployment.")
if DATABASE_URL and not APP_ENCRYPTION_KEY:
    raise RuntimeError(
        "APP_ENCRYPTION_KEY is required when DATABASE_URL enables PostgreSQL mode."
    )
_queue_store = (
    PostgresQueue(DATABASE_URL, APP_ENCRYPTION_KEY) if DATABASE_URL else None
)
_worker_shutdown = threading.Event()
QUREO_BANK_PATH = os.path.join(DATA_DIR, "qureo_answers.json")
GFQ_RESULTS_PATH = os.path.join(DATA_DIR, "spx_game_results.json")
PORTAL_LOGIN = "https://me-portal.qureo.education/oauth2/password-login"
PORTAL_USERINFO = "https://me-portal.qureo.education/oauth2/userinfo"
CORS_ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:8700,http://127.0.0.1:8700,https://quizora55.up.railway.app,https://quizora.movb.workers.dev",
    ).split(",")
    if origin.strip()
}
# Auto-add Railway public domain if available
_railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
if _railway_domain:
    CORS_ALLOWED_ORIGINS.add("https://" + _railway_domain.rstrip("/"))
if (
    os.environ.get("QUIZORA_REQUIRE_DATABASE") == "1"
    and not os.environ.get("CORS_ALLOWED_ORIGINS", "").strip()
):
    raise RuntimeError("CORS_ALLOWED_ORIGINS is required for this deployment.")

STATIC_ROUTES = {
    "/": ("frontend/index.html", "text/html; charset=utf-8"),
    "/index.html": ("frontend/index.html", "text/html; charset=utf-8"),
    "/manifest.json": ("frontend/manifest.json", "application/manifest+json; charset=utf-8"),
    "/sw.js": ("frontend/sw.js", "application/javascript; charset=utf-8"),
    "/config.js": ("frontend/config.js", "application/javascript; charset=utf-8"),
    "/three.min.js": ("frontend/assets/three.min.js", "application/javascript; charset=utf-8"),
    "/qureo_top.png": ("frontend/assets/qureo_top.png", "image/png"),
    "/spx_mascot.png": ("frontend/assets/spx_mascot.png", "image/png"),
    "/icon-192.png": ("frontend/assets/icon-192.png", "image/png"),
    "/icon-512.png": ("frontend/assets/icon-512.png", "image/png"),
    "/icon-maskable-512.png": ("frontend/assets/icon-maskable-512.png", "image/png"),
    "/apple-touch-icon.png": ("frontend/assets/apple-touch-icon.png", "image/png"),
    "/quizora-logo.png": ("frontend/assets/quizora-logo.png", "image/png"),
}
STATIC_ROUTES.update({
    "/assets/three.min.js": STATIC_ROUTES["/three.min.js"],
    "/assets/qureo_top.png": STATIC_ROUTES["/qureo_top.png"],
    "/assets/spx_mascot.png": STATIC_ROUTES["/spx_mascot.png"],
    "/assets/icon-192.png": STATIC_ROUTES["/icon-192.png"],
    "/assets/icon-512.png": STATIC_ROUTES["/icon-512.png"],
    "/assets/icon-maskable-512.png": STATIC_ROUTES["/icon-maskable-512.png"],
    "/assets/apple-touch-icon.png": STATIC_ROUTES["/apple-touch-icon.png"],
    "/assets/quizora-logo.png": STATIC_ROUTES["/quizora-logo.png"],
})

_lock = threading.Lock()
_stop = threading.Event()
_accounts = []
_local_queue_sequence = 0
_tls = threading.local()

_concurrency_lock = threading.Condition()
_current_concurrency = 1
_active_workers = 0


def _set_concurrency(_val):
    global _current_concurrency
    with _concurrency_lock:
        _current_concurrency = 1
        _concurrency_lock.notify_all()
    return _current_concurrency


def _acquire_worker_slot(acct):
    global _active_workers
    stop_evt = acct.get("_stop_event")
    with _concurrency_lock:
        while _active_workers >= _current_concurrency:
            if _stop.is_set() or (stop_evt and stop_evt.is_set()):
                return False
            _concurrency_lock.wait(timeout=0.3)
        if _stop.is_set() or (stop_evt and stop_evt.is_set()):
            return False
        _active_workers += 1
        return True


def _release_worker_slot():
    global _active_workers
    with _concurrency_lock:
        _active_workers = max(0, _active_workers - 1)
        _concurrency_lock.notify_all()

_spx_bank = None
_spx_bank_lock = threading.Lock()

_qur_answers = None
_qur_answers_lock = threading.Lock()
_qur_installed = False

_spx_mod = None
_qur_mod = None
_gfq_mod = None
_import_lock = threading.RLock()


# --------------------------------------------------------------------- حسابات
def _new_acct(code, mode, detail):
    return {
        "id": f"{code}_{int(time.time()*1000)}",
        "code": code,
        "mode": mode,
        "detail": detail,
        "running": True,
        "finished": False,
        "success": False,
        "message": "",
        "phase": "في الانتظار...",
        "progress": {"done": 0, "total": 0, "pct": 0, "title": ""},
        "lines": [],
        "_stop_event": threading.Event(),
        "_thread": None,
    }


def _log(acct, msg, level="info"):
    line = {
        "t": time.strftime("%H:%M:%S"),
        "level": level,
        "msg": str(msg)[:500],
    }
    with _lock:
        lines = acct["lines"]
        lines.append(line)
        # حد أقصى للسجل لكل حساب — من غير كده السجل بيكبر بلا نهاية
        # والـ /api/status بينقل كل السطور كل 0.9 ثانية.
        if len(lines) > MAX_LOG_LINES:
            del lines[: len(lines) - MAX_LOG_LINES]
    job_id = acct.get("_queue_job_id")
    if job_id and _queue_store:
        _queue_store.append_log(job_id, line["msg"], level, MAX_LOG_LINES)


def _set_progress(acct, done, total, title):
    with _lock:
        done = int(done or 0)
        total = int(total or 0)
        acct["progress"] = {
            "done": done,
            "total": total,
            "pct": round(done / total * 100) if total else 0,
            "title": str(title or "")[:80],
        }
    _persist_progress(acct)


def _set_phase(acct, phase):
    with _lock:
        acct["phase"] = str(phase)
    job_id = acct.get("_queue_job_id")
    if job_id and _queue_store:
        _queue_store.update_phase(job_id, acct["phase"])


def _persist_progress(acct):
    job_id = acct.get("_queue_job_id")
    if job_id and _queue_store:
        _queue_store.update_progress(job_id, acct["progress"])


# ------------------------------------------------------- التقاط مخرجات Qureo
class _StdoutSink:
    """يحوّل print() القادمة من محرّك Qureo إلى سجل الحساب المسؤول (حسب الثريد)."""

    encoding = "utf-8"

    def __init__(self):
        self._buf = {}
        self._lock = threading.Lock()

    def reconfigure(self, **kwargs):
        pass

    def write(self, s):
        tid = threading.get_ident()
        with self._lock:
            buf = self._buf.get(tid, "") + s
            parts = buf.split("\n")
            self._buf[tid] = parts.pop()
            for line in parts:
                self._route(line.rstrip())

    def flush(self):
        tid = threading.get_ident()
        with self._lock:
            line = self._buf.get(tid, "")
            self._buf[tid] = ""
        if line.strip():
            self._route(line.rstrip())

    def _route(self, line):
        if not line:
            return
        acct = getattr(_tls, "acct", None)
        if acct is None:
            try:
                _ORIG_STDOUT.write(line + "\n")
            except Exception:
                pass
            return
        level = "info"
        if ("❌" in line) or ("خطأ" in line) or ("فشل" in line):
            level = "error"
        elif "⚠️" in line:
            level = "warning"
        elif ("✅" in line) or ("✨" in line) or ("تم " in line):
            level = "success"
        _log(acct, line, level)


# ------------------------------------------------------------------- التحميل
def _load_spx():
    global _spx_mod
    with _import_lock:
        if _spx_mod is None:
            import spx_solver
            _spx_mod = spx_solver
        return _spx_mod


def _load_qureo():
    global _qur_mod
    with _import_lock:
        if _qur_mod is None:
            import qureo_solver
            _qur_mod = qureo_solver
        return _qur_mod


def _load_gfq():
    global _gfq_mod
    with _import_lock:
        if _gfq_mod is None:
            import gfq_solver
            _gfq_mod = gfq_solver
        return _gfq_mod


def _get_spx_bank():
    global _spx_bank
    with _spx_bank_lock:
        if _spx_bank is None:
            mod = _load_spx()
            _spx_bank = mod.BankStore()
        return _spx_bank


def _load_qureo_bank():
    global _qur_answers
    with _qur_answers_lock:
        if _qur_answers is None:
            try:
                with open(QUREO_BANK_PATH, encoding="utf-8") as f:
                    _qur_answers = json.load(f)
            except Exception:
                _qur_answers = {}
        return _qur_answers


def _qureo_progress(course, done, total, label):
    acct = getattr(_tls, "acct", None)
    if acct is None:
        return
    title = " ".join(x for x in (course, label) if x).strip()
    _set_progress(acct, done, total, title)


def _make_fast_login(mod, native):
    def _fast(self_, student_id=None, password=None):
        sid = student_id or getattr(mod, "STUDENT_ID", "") or ""
        pwd = password or getattr(mod, "PASSWORD", "") or ""
        if not (sid and pwd):
            return native(self_, sid, pwd)
        if getattr(self_, "turbo", False):
            # دخول سريع مباشر لمنصة me-tp (نفس بيانات بوابة المدرسة — من غير متصفح)
            login_err = getattr(mod, "LoginError", RuntimeError)
            try:
                r = self_.context.request.post(
                    mod.TP_LOGIN,
                    headers={"Content-Type": "application/json"},
                    data=json.dumps({"student_id": sid, "password": pwd}),
                )
            except Exception:
                r = None
            if r is not None and r.status in (200, 201, 204, 302):
                try:
                    cookies = (self_.context.storage_state() or {}).get("cookies") or []
                except Exception:
                    cookies = []
                if any(c.get("name") == "egy_student_id_token" for c in cookies):
                    return
                raise RuntimeError("تعذّر تأكيد جلسة المنصة السريعة — جرّب الوضع العادي.")
            if r is not None and r.status in (400, 401, 422):
                raise login_err("فشل تسجيل الدخول — تحقق من الكود وكلمة المرور.")
            raise RuntimeError("فشل تسجيل الدخول السريع — تحقق من الكود وكلمة المرور (أو جرّب الوضع العادي).")
        try:
            r = self_.context.request.post(
                PORTAL_LOGIN,
                headers={"Content-Type": "application/json"},
                data=json.dumps({"student_id": sid, "password": pwd}),
            )
            if r.status in (200, 201, 204):
                ru = self_.context.request.get(PORTAL_USERINFO)
                if ru.status in (200, 201, 204):
                    return
        except Exception:
            pass
        return native(self_, sid, pwd)

    return _fast


def _gfq_results_bank():
    try:
        with open(GFQ_RESULTS_PATH, "r", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _install_qureo():
    """يجهّز محرّك Qureo مرة واحدة: بنك مشترك + قفل حفظ آمن + خطّافات + دخول سريع."""
    global _qur_installed
    with _import_lock:
        if _qur_installed:
            return _qur_mod
        mod = _load_qureo()
        mod.ANSWER_FILE = QUREO_BANK_PATH

        def _noop(self_):
            return None

        def _safe_save_key(self_, cid, key):
            if not key:
                return
            global _qur_answers
            with _qur_answers_lock:
                if _qur_answers is None:
                    _qur_answers = {}
                bank = _qur_answers
                # دمج أي إضافات خارجية اتحفظت في الملف (مثل تدريب/عملية أخرى)
                # قبل الكتابة — عشان لا نضيّع إجابات اتعلمتها جلسة تانية.
                try:
                    with open(QUREO_BANK_PATH, encoding="utf-8") as f:
                        disk = json.load(f)
                    if isinstance(disk, dict):
                        for _cid, _qs in disk.items():
                            if _cid not in bank:
                                bank[_cid] = _qs
                            elif isinstance(_qs, dict):
                                for _q, _kv in _qs.items():
                                    bank[_cid].setdefault(_q, _kv)
                except Exception:
                    pass
                merged = bank.get(str(cid), {})
                merged.update({str(q): [k, v] for q, (k, v) in key.items()})
                bank[str(cid)] = merged
                try:
                    tmp = QUREO_BANK_PATH + ".tmp"
                    with open(tmp, "w", encoding="utf-8") as f:
                        json.dump(bank, f, ensure_ascii=False, indent=1)
                    os.replace(tmp, QUREO_BANK_PATH)
                except Exception:
                    pass

        cls = mod.QureoSolver
        if hasattr(cls, "_save_key"):
            cls._save_key = _safe_save_key
        if hasattr(cls, "_store_key"):
            cls._store_key = _safe_save_key
        cls._save_answers = _noop
        cls.login = _make_fast_login(mod, cls.login)

        mod.PROGRESS = _qureo_progress
        def _qureo_stop_check():
            if _stop.is_set():
                return True
            acct = getattr(_tls, "acct", None)
            if acct:
                se = acct.get("_stop_event")
                if se and se.is_set():
                    return True
            return False
        mod.SHOULD_STOP = _qureo_stop_check
        _qur_installed = True
        return mod


# ------------------------------------------------------------------ التشغيل
def _run_spx(acct, code, password, subject, turbo=False):
    mod = _load_spx()
    bank = _get_spx_bank()
    stop_evt = acct.get("_stop_event")
    sol = mod.Solver(
        log=lambda m, lvl="info": _log(acct, m, lvl),
        stop=lambda: _stop.is_set() or (stop_evt and stop_evt.is_set()),
        shared=bank,
        subject_id=subject,
        turbo=turbo,
    )
    sol.on_progress = lambda d, t, title: _set_progress(acct, d, t, title)
    ok, msg = sol.run(code, password, subject=subject)
    return bool(ok), msg


def _run_qureo(acct, code, password, courses, turbo=False, lang=None):
    mod = _install_qureo()
    bank = _load_qureo_bank()
    _tls.acct = acct
    stop_evt = acct.get("_stop_event")
    try:
        solver = mod.QureoSolver(headless=True, courses=courses, turbo=turbo, lang=lang)
        solver.answers = bank
        completed = solver.run(code, password, courses, close_pause=0)
        if completed is not True:
            return False, "لم يؤكد محرك Qureo اكتمال المسارات المطلوبة."
        return True, "اكتمل حل المسارات: " + "، ".join(courses) + "."
    finally:
        _tls.acct = None


def _run_gfq(acct, code, password, start_new=True):
    mod = _load_gfq()
    stop_evt = acct.get("_stop_event")
    sol = mod.GFQSolver(
        log=lambda m, lvl="info": _log(acct, m, lvl),
        stop=lambda: _stop.is_set() or (stop_evt and stop_evt.is_set()),
        on_progress=lambda d, t, title: _set_progress(acct, d, t, title),
    )
    ok, msg = sol.run(code, password, start_new=start_new)
    return bool(ok), msg


def _finalize(acct, ok, msg, phase):
    job_id = acct.get("_queue_job_id")
    if job_id and _queue_store:
        stop_event = acct.get("_stop_event")
        cancelled = bool(not ok and ((stop_event and stop_event.is_set()) or _stop.is_set()))
        _queue_store.finish_job(job_id, ok, cancelled, msg, phase)
    with _lock:
        acct["running"] = False
        acct["finished"] = True
        acct["success"] = bool(ok)
        acct["message"] = msg
        acct["phase"] = phase


def _worker(acct, code, password, mode, opts):
    persisted_job = bool(acct.get("_queue_job_id"))
    if not persisted_job:
        _set_phase(acct, "في قائمة الانتظار...")
    got_slot = True if persisted_job else _acquire_worker_slot(acct)
    if not got_slot:
        _finalize(acct, False, "أُوقف قبل البدء.", "متوقّف")
        return
    try:
        # أي استثناء مهما كان نوعه (حتى SystemExit/أخطاء Playwright الداخلية)
        # لازم ينهي الحساب — وإلا يظل "جاري التشغيل" للأبد ويرفض أي "ابدأ" لاحقًا.
        try:
            stop_evt = acct.get("_stop_event")
            is_stopped = lambda: _stop.is_set() or (stop_evt and stop_evt.is_set())
            if is_stopped():
                _finalize(acct, False, "أُوقف قبل البدء.", "متوقّف")
                return
            _set_phase(acct, "جاري التشغيل...")
            try:
                turbo = bool(opts.get("turbo", True))
                if mode == "spx":
                    ok, msg = _run_spx(acct, code, password, opts.get("subject") or "7", turbo)
                elif mode == "game":
                    ok, msg = _run_gfq(acct, code, password, bool(opts.get("start_new", True)))
                elif mode == "qureo2":
                    lang = str(opts.get("lang") or "ar").lower()
                    ok, msg = _run_qureo(
                        acct, code, password, ["JavaScript"], turbo, lang=lang
                    )
                    if ok:
                        lang_name = "عربي" if lang == "ar" else "لغات"
                        msg = f"اكتمل حل JavaScript ({lang_name}) — أولى بكالوريا."
                else:
                    ok, msg = _run_qureo(
                        acct,
                        code,
                        password,
                        opts.get("courses") or ["Python", "JavaScript"],
                        turbo,
                        lang=opts.get("lang"),
                    )
            except Exception as e:
                m = str(e)
                if "إيقاف" in m:
                    ok, msg = False, "تم الإيقاف — حُفظ ما اكتمل."
                else:
                    ok, msg = False, "خطأ: " + m[:180]
            _finalize(acct, ok, msg, "انتهى" if ok else "توقّف/فشل")
        except BaseException as e:
            m = str(e) if str(e) else type(e).__name__
            try:
                _log(acct, "تعطّلت العملية فجأة: " + m[:200], "error")
            except Exception:
                pass
            _finalize(acct, False, "خطأ غير متوقع: " + m[:150], "فشل")
            raise
    finally:
        if not persisted_job:
            _release_worker_slot()


def _running_count():
    with _lock:
        return sum(1 for a in _accounts if a["running"])


def _prune_dead_accounts():
    """يبحث عن عمليات "عالقة": ظاهرة كشغّالة لكن خيطها انتهى فعليًا (مات فجأة/قُتل).

    من دونها كانت أي ضغطة "ابدأ" جديدة ترفض للأبد لأن counter العمليات يظل > 0.
    """
    pruned = 0
    with _lock:
        for a in _accounts:
            th = a.get("_thread")
            if a["running"] and (th is None or not th.is_alive()):
                a["running"] = False
                a["finished"] = True
                a["success"] = False
                a["message"] = "تعطّلت العملية فجأة — أعد المحاولة."
                a["phase"] = "فشل"
                pruned += 1
    return pruned


def _normalize_accounts(items):
    out = []
    seen = set()
    for it in items or []:
        if not isinstance(it, dict):
            continue
        code = str(it.get("code", "")).strip()
        pwd = str(it.get("password", "")).strip()
        if code and pwd and code not in seen:
            seen.add(code)
            out.append((code, pwd))
    return out


def _normalize_client_id(value):
    if value is None or value == "":
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (AttributeError, TypeError, ValueError):
        return None


def _local_queue_metrics(accounts, client_id):
    active = [account for account in accounts if account["running"]]
    client_accounts = [
        account for account in accounts
        if client_id is None or account.get("_client_id") == client_id
    ]
    client_active = [account for account in client_accounts if account["running"]]
    if any(account["phase"] == "جاري التشغيل..." for account in client_active):
        queue_state = "running"
        queue_ahead = 0
        queue_position = 1
    elif client_active:
        first_order = min(account.get("_queue_order", 0) for account in client_active)
        queue_ahead = sum(
            1 for account in active
            if account.get("_queue_order", 0) < first_order
        )
        queue_position = queue_ahead + 1
        queue_state = "waiting"
    elif any(account["finished"] for account in client_accounts):
        queue_state = "finished"
        queue_ahead = None
        queue_position = None
    else:
        queue_state = "none"
        queue_ahead = None
        queue_position = None
    return {
        "running_count": len(client_active),
        "queue_total": len(active),
        "queue_ahead": queue_ahead,
        "queue_position": queue_position,
        "queue_state": queue_state,
    }


def _detail_for(job):
    if job["mode"] == "spx":
        return "الثقافة المالية (عربي)" if str(job.get("subject")) == "7" else "Financial Literacy (لغات)"
    if job["mode"] == "game":
        return "لعبة الأسهم (Global Finance Quest)"
    if job["mode"] == "qureo2":
        lang = str(job.get("lang") or "ar").lower()
        return "Qureo JavaScript (عربي) — الخيار الثاني" if lang == "ar" else "Qureo JavaScript (لغات) — الخيار الثاني"
    return " + ".join(job.get("courses") or [])


def _start(plan, accounts, client_id=None):
    global _accounts, _local_queue_sequence
    client_id = _normalize_client_id(client_id) or str(uuid.uuid4())
    if _queue_store:
        added, _, _ = _queue_store.enqueue(
            plan, accounts, MAX_ACCOUNTS, client_id
        )
        if added == 0:
            return False, "هذه العمليات موجودة بالفعل في طابور الانتظار أو قيد التشغيل."
        return True, "تم تسجيل %d عملية في طابور الانتظار؛ التنفيذ متسلسل." % added

    pruned = _prune_dead_accounts()

    with _lock:
        _accounts[:] = [
            a for a in _accounts
            if a.get("_client_id") != client_id or a["running"]
        ]

    total_new = len(accounts) * len(plan)
    running = _running_count()
    if running + total_new > MAX_ACCOUNTS:
        return False, "الحد الأقصى للعمليات في الانتظار والتشغيل هو %d (شغال حالياً: %d)." % (MAX_ACCOUNTS, running)

    _stop.clear()
    added = 0
    for code, password in accounts:
        for job in plan:
            # التحقق إن كان نفس الكود لنفس المسار شغال بالفعل حالياً
            with _lock:
                already_active = any(
                    a["code"] == code and a["mode"] == job["mode"] and a["running"]
                    for a in _accounts
                )
            if already_active:
                continue

            acct = _new_acct(code, job["mode"], _detail_for(job))
            with _lock:
                _local_queue_sequence += 1
                acct["_client_id"] = client_id
                acct["_queue_order"] = _local_queue_sequence
                _accounts.append(acct)
            opts = {
                "subject": job.get("subject"),
                "courses": job.get("courses"),
                "start_new": job.get("start_new", True),
                "lang": job.get("lang"),
                "turbo": bool(job.get("turbo", False)),
            }
            th = threading.Thread(
                target=_worker, args=(acct, code, password, job["mode"], opts), daemon=True
            )
            acct["_thread"] = th
            th.start()
            added += 1

    if added == 0:
        return False, "هذا الحساب قيد التشغيل بالفعل حالياً في العمليات الجارية!"

    if running > 0:
        return True, "تمت إضافة %d عملية إلى طابور الانتظار؛ التنفيذ متسلسل." % added
    return True, "بدأت العملية على %d كود (%d عملية)." % (len(accounts), added)


def _run_persisted_job(job, worker_connection):
    acct = _new_acct(job["code"], job["mode"], job["detail"])
    acct["id"] = job["id"]
    acct["phase"] = "جاري التشغيل..."
    acct["_queue_job_id"] = job["id"]
    acct["_stop_event"] = threading.Event()
    options = job.get("options") or {}
    watch_stop = threading.Event()

    def monitor_cancellation():
        failures = 0
        while not watch_stop.wait(1):
            try:
                if not _queue_store.worker_lock_is_held(worker_connection):
                    acct["_stop_event"].set()
                    _ORIG_STDOUT.write("[queue] فُقد قفل العامل؛ أُرسل طلب إيقاف للمهمة.\n")
                    return
                if _queue_store.is_cancel_requested(job["id"]):
                    acct["_stop_event"].set()
                    return
                failures = 0
            except QueueStoreError as error:
                failures += 1
                if failures == 1:
                    _ORIG_STDOUT.write(
                        "[queue] تعذّر التحقق من طلب الإيقاف: %s\n" % error
                    )
                acct["_stop_event"].set()
                return

    _stop.clear()
    monitor = threading.Thread(target=monitor_cancellation, daemon=True)
    monitor.start()
    try:
        _worker(
            acct,
            job["code"],
            job["password"],
            job["mode"],
            options,
        )
    except BaseException as error:
        message = str(error) or type(error).__name__
        _ORIG_STDOUT.write("[queue] تعذّرت العملية %s: %s\n" % (job["id"], message))
        if acct["running"]:
            _finalize(acct, False, "خطأ غير متوقع: " + message[:150], "فشل")
    finally:
        watch_stop.set()
        monitor.join(timeout=2)


def _database_worker_loop():
    worker_id = uuid.uuid4().hex
    while not _worker_shutdown.is_set():
        connection = None
        try:
            connection = _queue_store.try_acquire_worker_lock()
            if connection is None:
                _worker_shutdown.wait(2)
                continue
            _queue_store.recover_interrupted_jobs()
            while not _worker_shutdown.is_set():
                if not _queue_store.worker_lock_is_held(connection):
                    break
                job = _queue_store.claim_next(worker_id)
                if job is None:
                    _worker_shutdown.wait(1)
                    continue
                _run_persisted_job(job, connection)
        except QueueStoreError as error:
            _ORIG_STDOUT.write("[queue] خطأ في عامل PostgreSQL: %s\n" % error)
            _worker_shutdown.wait(3)
        except Exception as error:
            _ORIG_STDOUT.write("[queue] خطأ غير متوقع في العامل: %s\n" % error)
            _worker_shutdown.wait(3)
        finally:
            if connection is not None:
                try:
                    _queue_store.release_worker_lock(connection)
                except Exception as error:
                    _ORIG_STDOUT.write("[queue] تعذّر تحرير قفل العامل: %s\n" % error)


# ------------------------------------------------------------------- الخادم
def make_handler():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _cors_headers(self):
            origin = (self.headers.get("Origin") or "").rstrip("/")
            if origin in CORS_ALLOWED_ORIGINS or origin == "null":
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Max-Age", "600")

        def _file(self, name, ctype):
            try:
                with open(os.path.join(APP_DIR, name), "rb") as f:
                    data = f.read()
            except Exception:
                return False
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            basename = os.path.basename(name)
            if basename == "sw.js":
                self.send_header("Cache-Control", "no-store")
                self.send_header("Service-Worker-Allowed", "/")
            elif basename in ("index.html", "manifest.json"):
                self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
            return True

        def _status_payload(self, client_id=None):
            if _queue_store:
                return _queue_store.status_payload(STATUS_LOG_LINES, client_id)
            with _lock:
                all_accounts = list(_accounts)
                accs_for_client = [
                    a for a in all_accounts
                    if client_id is None or a.get("_client_id") == client_id
                ]
                accs = []
                for a in accs_for_client:
                    accs.append({
                        "id": a.get("id") or a["code"],
                        "code": a["code"],
                        "mode": a["mode"],
                        "detail": a["detail"],
                        "running": a["running"],
                        "finished": a["finished"],
                        "success": a["success"],
                        "message": a["message"],
                        "phase": a["phase"],
                        "progress": dict(a["progress"]),
                        "lines": list(a["lines"]),
                    })
                queue_metrics = _local_queue_metrics(all_accounts, client_id)
            return {
                "accounts": accs,
                "running_count": queue_metrics["running_count"],
                "total_count": len(accs),
                "concurrency": _current_concurrency,
                "active_workers": _active_workers,
                "queue_total": queue_metrics["queue_total"],
                "queue_ahead": queue_metrics["queue_ahead"],
                "queue_position": queue_metrics["queue_position"],
                "queue_state": queue_metrics["queue_state"],
                "version": VERSION,
            }

        def do_GET(self):
            if self.path in STATIC_ROUTES:
                name, ctype = STATIC_ROUTES[self.path]
                if not self._file(name, ctype):
                    self._json(404, {"error": "resource not found"})
                return
            if self.path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if self.path == "/api/health":
                try:
                    if _queue_store:
                        _queue_store.health()
                    self._json(200, {
                        "ok": True,
                        "version": VERSION,
                        "database": "postgresql" if _queue_store else "local",
                    })
                except QueueStoreError:
                    self._json(503, {"ok": False, "error": "قاعدة البيانات غير متاحة."})
                return
            parsed_path = urlsplit(self.path)
            if parsed_path.path == "/api/status":
                query = parse_qs(parsed_path.query)
                raw_client_id = query.get("client_id", [None])[0]
                client_id = _normalize_client_id(raw_client_id)
                if raw_client_id and not client_id:
                    self._json(400, {"ok": False, "error": "معرّف الجلسة غير صالح."})
                    return
                try:
                    self._json(200, self._status_payload(client_id))
                except QueueStoreError:
                    self._json(503, {"ok": False, "error": "تعذّر قراءة طابور الانتظار."})
                return
            if self.path == "/api/game_results":
                self._json(200, {"ok": True, "data": _gfq_results_bank()})
                return
            self._json(404, {"error": "not found"})

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _read_json(self):
            length = int(self.headers.get("Content-Length", "0") or 0)
            return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

        def do_POST(self):
            if self.path == "/api/start":
                try:
                    data = self._read_json()
                except Exception:
                    self._json(400, {"ok": False, "message": "بيانات غير صحيحة — حدّث الصفحة (F5)."})
                    return
                mode = str(data.get("mode") or "")
                raw_client_id = data.get("client_id")
                client_id = _normalize_client_id(raw_client_id)
                if raw_client_id and not client_id:
                    self._json(400, {"ok": False, "message": "معرّف الجلسة غير صالح."})
                    return
                client_id = client_id or str(uuid.uuid4())
                accounts = _normalize_accounts(data.get("accounts"))
                if not accounts:
                    self._json(400, {"ok": False, "message": "اكتب كود وكلمة مرور لحساب واحد على الأقل."})
                    return
                turbo = bool(data.get("turbo", False))
                start_new = bool(data.get("start_new", True))
                plan = []
                if mode in ("spx", "both"):
                    plan.append({"mode": "spx", "subject": str(data.get("subject") or "7"), "turbo": turbo})
                if mode in ("qureo", "both"):
                    courses = [c for c in (data.get("courses") or []) if c in ("Python", "JavaScript")]
                    if not courses:
                        self._json(400, {"ok": False, "message": "اختر مسارًا واحدًا على الأقل (Python / JavaScript)."})
                        return
                    lang = str(data.get("lang") or "ar").lower()
                    if lang not in ("ar", "en"):
                        self._json(400, {"ok": False, "message": "اختر اللغة أولًا (عام / لغات)."})
                        return
                    plan.append({
                        "mode": "qureo",
                        "courses": courses,
                        "lang": lang,
                        "turbo": turbo,
                    })
                if mode == "game":
                    plan.append({"mode": "game", "start_new": start_new, "turbo": turbo})
                if mode == "qureo2":
                    lang = str(data.get("lang") or "ar").lower()
                    if lang not in ("ar", "en"):
                        self._json(400, {"ok": False, "message": "اختر اللغة أولًا (عربي / لغات) للخيار الثاني."})
                        return
                    plan.append({"mode": "qureo2", "courses": ["JavaScript"], "lang": lang, "turbo": turbo})
                if not plan:
                    self._json(400, {"ok": False, "message": "اختر نوع الحل أولًا (ثقافة / كيريو / الاتنين معًا / اللعبة / الخيار الثاني)."})
                    return
                if "concurrency" in data:
                    _set_concurrency(data["concurrency"])
                try:
                    ok, msg = _start(plan, accounts, client_id)
                    self._json(200 if ok else 409, {
                        "ok": ok,
                        "message": msg,
                        "client_id": client_id,
                    })
                except QueueCapacityError as e:
                    self._json(429, {"ok": False, "message": str(e)})
                except QueueStoreError:
                    self._json(503, {
                        "ok": False,
                        "message": "تعذّر تسجيل العملية في قاعدة البيانات.",
                    })
                return
            if self.path == "/api/concurrency":
                try:
                    data = self._read_json()
                    val = int(data.get("concurrency", 4))
                    new_val = _set_concurrency(val)
                    self._json(200, {"ok": True, "concurrency": new_val})
                except Exception as e:
                    self._json(400, {"ok": False, "error": str(e)})
                return
            if self.path == "/api/stop":
                try:
                    data = self._read_json()
                except Exception:
                    data = {}
                code_to_stop = data.get("code")
                raw_client_id = data.get("client_id")
                client_id = _normalize_client_id(raw_client_id)
                if raw_client_id and not client_id:
                    self._json(400, {"ok": False, "message": "معرّف الجلسة غير صالح."})
                    return
                if _queue_store:
                    try:
                        queued, running = _queue_store.request_stop(
                            str(code_to_stop).strip() if code_to_stop else None,
                            client_id,
                        )
                    except QueueStoreError:
                        self._json(503, {
                            "ok": False,
                            "message": "تعذّر تحديث حالة طابور الانتظار.",
                        })
                        return
                    if running:
                        _stop.set()
                    if not queued and not running:
                        message = "لا توجد عملية مطابقة قيد الانتظار أو التشغيل."
                    elif code_to_stop:
                        message = "تم طلب إيقاف الحساب: %s" % code_to_stop
                    else:
                        message = "تم طلب إيقاف العمليات وإلغاء ما لم يبدأ منها."
                    self._json(200, {
                        "ok": True,
                        "message": message,
                        "cancelled_queued": queued,
                        "stopping_running": running,
                    })
                    return
                if code_to_stop:
                    with _lock:
                        found = False
                        for a in _accounts:
                            if (
                                a["code"] == str(code_to_stop)
                                and a["running"]
                                and (client_id is None or a.get("_client_id") == client_id)
                            ):
                                if "_stop_event" in a:
                                    a["_stop_event"].set()
                                a["phase"] = "جاري الإيقاف..."
                                found = True
                    msg = "تم طلب إيقاف الحساب: %s" % code_to_stop if found else "الحساب غير قيد التشغيل."
                    self._json(200, {"ok": True, "message": msg})
                    return

                with _lock:
                    for a in _accounts:
                        if (
                            a["running"]
                            and (client_id is None or a.get("_client_id") == client_id)
                            and "_stop_event" in a
                        ):
                            a["_stop_event"].set()
                if client_id is None:
                    _stop.set()
                self._json(200, {"ok": True, "message": "جارٍ إيقاف جميع العمليات..."})
                return

            if self.path == "/api/clear_finished":
                try:
                    data = self._read_json()
                except Exception:
                    data = {}
                raw_client_id = data.get("client_id")
                client_id = _normalize_client_id(raw_client_id)
                if raw_client_id and not client_id:
                    self._json(400, {"ok": False, "message": "معرّف الجلسة غير صالح."})
                    return
                if _queue_store:
                    try:
                        deleted = _queue_store.clear_finished(client_id)
                        self._json(200, {
                            "ok": True,
                            "message": "تمت أرشفة %d عملية مكتملة." % deleted,
                        })
                    except QueueStoreError:
                        self._json(503, {
                            "ok": False,
                            "message": "تعذّر مسح العمليات المكتملة من قاعدة البيانات.",
                        })
                    return
                with _lock:
                    _accounts[:] = [
                        a for a in _accounts
                        if a["running"] or (
                            client_id is not None
                            and a.get("_client_id") != client_id
                        )
                    ]
                self._json(200, {"ok": True, "message": "تم مسح العمليات المكتملة."})
                return
            self._json(404, {"error": "not found"})

    return Handler


def main():
    sys.stdout = _StdoutSink()
    if _queue_store:
        try:
            _queue_store.initialize()
        except QueueStoreError as error:
            _ORIG_STDOUT.write("[app] تعذّر تجهيز قاعدة البيانات: %s\n" % error)
            raise
        threading.Thread(
            target=_database_worker_loop,
            name="quizora-postgres-worker",
            daemon=True,
        ).start()

    port = PORT_BASE
    server = None
    explicit_port = bool(os.environ.get("PORT"))
    attempts = 1 if explicit_port else 6
    for attempt in range(attempts):
        try:
            server = ThreadingHTTPServer(
                ("0.0.0.0", port if explicit_port else port + attempt),
                make_handler(),
            )
            if not explicit_port:
                port += attempt
            break
        except OSError:
            if explicit_port:
                break
            try:
                server = ThreadingHTTPServer(("127.0.0.1", port + attempt), make_handler())
                port += attempt
                break
            except OSError:
                continue
    if server is None:
        _ORIG_STDOUT.write("[app] لا منفذ حر متاح — أغلق النوافذ القديمة ثم أعد المحاولة.\n")
        return
    _ORIG_STDOUT.write("[app] الخادم يعمل الآن بنجاح!\n")
    _ORIG_STDOUT.write("[app] الرابط المحلي: http://localhost:%d\n" % port)
    _ORIG_STDOUT.write("[app] أو: http://127.0.0.1:%d\n" % port)
    if (
        not os.environ.get("TOOL_NO_BROWSER")
        and not os.environ.get("RAILWAY_ENVIRONMENT")
        and not explicit_port
    ):
        try:
            threading.Timer(1.2, lambda: webbrowser.open("http://127.0.0.1:%d/" % port)).start()
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _worker_shutdown.set()
        if _queue_store:
            _stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
