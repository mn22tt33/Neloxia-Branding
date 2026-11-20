# -*- coding: utf-8 -*-
"""خادم موحّد لأداتَي الحل: الثقافة المالية (SPX) + Qureo.

- التشغيل من جذر المشروع: bash backend/scripts/run.sh (أو: python backend/server.py)
- يفتح صفحة محلية فيها اختيار ثقافة/كيريو، أكواد متعددة، تقدم وسجل مباشر.
من إعداد أحمد نادي.
"""
import json
import hashlib
import ipaddress
import os
import re
import secrets
import sys
import threading
import time
import uuid
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit
from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(BACKEND_DIR, "data")

if os.environ.get("QUIZORA_TEST_MODE") != "1":
    load_dotenv(os.path.join(APP_DIR, ".env"))

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from queue_store import (
    PostgresQueue,
    QueueCapacityError,
    QueueStoreError,
    SubscriptionError,
)
from admin_page import ADMIN_PAGE
from account_auth import (
    AccountExistsError,
    AccountBlockedError,
    AccountManagementConflictError,
    AccountNotFoundError,
    AuthStoreError,
    PostgresAuthStore,
    SESSION_TTL_SECONDS,
    hash_password,
    verify_firebase_credential,
)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_ORIG_STDOUT = sys.stdout

PORT_BASE = int(os.environ.get("PORT", "8700"))
_server_port = PORT_BASE
VERSION = 2
MAX_ACCOUNTS = 20
MAX_LOG_LINES = 800
STATUS_LOG_LINES = 120
DEFAULT_CONCURRENCY = 1
START_RATE_LIMIT = 3
START_RATE_WINDOW_SECONDS = 60
MAX_JSON_BODY_BYTES = 256 * 1024
HEADLESS = os.environ.get("HEADLESS", "1") == "1"
ADMIN_SETTINGS_PATH = os.path.join(APP_DIR, ".local-run", "admin_settings.json")
SOLVED_COUNT_PATH = os.path.join(APP_DIR, ".local-run", "solved_count.json")
SOLVED_HISTORY_VERSION = 1
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
_auth_store = PostgresAuthStore(DATABASE_URL) if DATABASE_URL else None
FIREBASE_PROJECT_ID = (
    os.environ.get("FIREBASE_PROJECT_ID", "").strip() or "quizora-auth-105be"
)
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()
AUTH_REQUIRED = True
AUTH_DISABLED_MESSAGE = (
    "تسجيل الدخول غير مفعّل؛ يلزم ربط PostgreSQL وإعداد Firebase."
)
COOKIE_SECURE = os.environ.get(
    "QUIZORA_COOKIE_SECURE",
    "1"
    if os.environ.get("QUIZORA_REQUIRE_DATABASE") == "1"
    or os.environ.get("RAILWAY_ENVIRONMENT")
    or os.environ.get("FIREBASE_PROJECT_ID")
    else "0",
) == "1"
_worker_shutdown = threading.Event()

# ─── كاش حالة الموقع (فتح/قفل) في الذاكرة ───
_site_enabled_cache = None          # None = لم تُقرأ بعد
_site_enabled_lock = threading.Lock()


def _get_site_enabled_cached():
    """يرجع حالة الموقع من الكاش أو من قاعدة البيانات (أول مرة فقط)."""
    global _site_enabled_cache
    if _site_enabled_cache is not None:
        return _site_enabled_cache
    if not _queue_store:
        return True
    with _site_enabled_lock:
        if _site_enabled_cache is not None:
            return _site_enabled_cache
        try:
            _site_enabled_cache = _queue_store.get_site_enabled()
        except Exception:
            return True
        return _site_enabled_cache


def _set_site_enabled_cached(enabled):
    """يحدّث الكاش فوراً ثم يحفظ في قاعدة البيانات في الخلفية بدون تأخير."""
    global _site_enabled_cache
    with _site_enabled_lock:
        _site_enabled_cache = enabled
    if not _queue_store:
        return
    def _persist():
        try:
            _queue_store.set_site_enabled(enabled)
        except Exception as err:
            _ORIG_STDOUT.write("[site-status] تعذّر حفظ الحالة في قاعدة البيانات: %s\n" % err)
    threading.Thread(target=_persist, daemon=True).start()
QUREO_BANK_PATH = os.path.join(DATA_DIR, "qureo_answers.json")
PORTAL_LOGIN = "https://me-portal.qureo.education/oauth2/password-login"
PORTAL_USERINFO = "https://me-portal.qureo.education/oauth2/userinfo"
CORS_ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:8700,http://127.0.0.1:8700,https://quizora55.up.railway.app,https://quizora.movb.workers.dev,https://slouchy-grappling-stingily.ngrok-free.dev",
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
    "/account": ("frontend/account.html", "text/html; charset=utf-8"),
    "/account.html": ("frontend/account.html", "text/html; charset=utf-8"),
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
_start_rate_lock = threading.Lock()
_start_requests = {}
_browser_settings_lock = threading.Lock()
_solved_count_lock = threading.Lock()


def _load_browser_visible():
    try:
        with open(ADMIN_SETTINGS_PATH, encoding="utf-8") as settings_file:
            settings = json.load(settings_file)
    except FileNotFoundError:
        return not HEADLESS
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("تعذّرت قراءة إعدادات لوحة الإدارة المحلية.") from error
    if not isinstance(settings, dict) or not isinstance(settings.get("browser_visible"), bool):
        raise RuntimeError("إعداد ظهور المتصفح في لوحة الإدارة غير صالح.")
    return settings["browser_visible"]


_browser_visible = _load_browser_visible()


def _get_browser_visible():
    with _browser_settings_lock:
        return _browser_visible


def _load_local_solved_history():
    try:
        with open(SOLVED_COUNT_PATH, encoding="utf-8") as count_file:
            data = json.load(count_file)
    except FileNotFoundError:
        return [], False
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("تعذّرت قراءة سجل الحسابات التي تم حلها.") from error
    if not isinstance(data, dict):
        raise RuntimeError("سجل الحسابات التي تم حلها غير صالح.")
    version = data.get("history_version")
    if version is None:
        return [], True
    if type(version) is not int or version > SOLVED_HISTORY_VERSION:
        raise RuntimeError("إصدار سجل الحلول المحفوظ غير مدعوم.")
    if version < SOLVED_HISTORY_VERSION:
        return [], True

    events = data.get("solved_events")
    if not isinstance(events, list) or any(
        not isinstance(event, dict)
        or not isinstance(event.get("code"), str)
        or not event["code"].strip()
        or not isinstance(event.get("mode"), str)
        or not isinstance(event.get("detail"), str)
        or type(event.get("duration_seconds")) is not int
        or event["duration_seconds"] < 0
        or not isinstance(event.get("solved_at"), str)
        or not event["solved_at"]
        for event in events
    ):
        raise RuntimeError("سجل عمليات الحل المحفوظ غير صالح.")
    if (
        type(data.get("solved_count")) is not int
        or data["solved_count"] != len(events)
    ):
        raise RuntimeError("عدد عمليات الحل لا يطابق السجل المحفوظ.")
    events = [
        {
            "code": event["code"].strip(),
            "mode": event["mode"],
            "detail": event["detail"],
            "duration_seconds": event["duration_seconds"],
            "solved_at": event["solved_at"],
        }
        for event in events
    ]
    return events, False


def _save_local_solved_history(events):
    os.makedirs(os.path.dirname(SOLVED_COUNT_PATH), exist_ok=True)
    temporary_path = SOLVED_COUNT_PATH + ".tmp"
    with open(temporary_path, "w", encoding="utf-8") as history_file:
        json.dump({
            "history_version": SOLVED_HISTORY_VERSION,
            "solved_count": len(events),
            "solved_events": events,
        }, history_file, ensure_ascii=False)
        history_file.flush()
        os.fsync(history_file.fileno())
    os.replace(temporary_path, SOLVED_COUNT_PATH)


_local_solved_events, _reset_legacy_solved_history = _load_local_solved_history()
_local_solved_count = len(_local_solved_events)
if _reset_legacy_solved_history:
    _save_local_solved_history([])


def _record_local_solved_event(acct, completed_at, duration_seconds):
    global _local_solved_count, _local_solved_events
    code = acct.get("code")
    if not isinstance(code, str) or not code.strip():
        raise ValueError("A solved account must have a code.")
    event = {
        "code": code.strip(),
        "mode": str(acct.get("mode") or ""),
        "detail": str(acct.get("detail") or ""),
        "duration_seconds": max(0, int(duration_seconds)),
        "solved_at": time.strftime(
            "%Y-%m-%dT%H:%M:%SZ",
            time.gmtime(completed_at),
        ),
    }
    with _solved_count_lock:
        events = list(_local_solved_events)
        events.append(event)
        _save_local_solved_history(events)
        _local_solved_events = events
        _local_solved_count = len(events)


def _set_browser_visible(visible):
    global _browser_visible
    if not isinstance(visible, bool):
        raise ValueError("browser_visible must be a boolean.")
    with _browser_settings_lock:
        os.makedirs(os.path.dirname(ADMIN_SETTINGS_PATH), exist_ok=True)
        temporary_path = ADMIN_SETTINGS_PATH + ".tmp"
        with open(temporary_path, "w", encoding="utf-8") as settings_file:
            json.dump({"browser_visible": visible}, settings_file)
        os.replace(temporary_path, ADMIN_SETTINGS_PATH)
        _browser_visible = visible

_concurrency_lock = threading.Condition()
_current_concurrency = 3
_active_workers = 0


def _set_concurrency(_val):
    global _current_concurrency
    try:
        requested = int(_val)
    except (TypeError, ValueError):
        requested = 3
    requested = max(1, min(requested, 6))
    with _concurrency_lock:
        _current_concurrency = requested
        _concurrency_lock.notify_all()
    return _current_concurrency


def _acquire_worker_slot(acct):
    global _active_workers
    stop_evt = acct.get("_stop_event")
    with _concurrency_lock:
        while _active_workers >= _current_concurrency:
            if _stop.is_set() or (stop_evt and stop_evt.is_set()):
                return False
            if acct.get("_force_start"):
                _active_workers += 1
                acct["_slot_acquired"] = True
                return True
            _concurrency_lock.wait(timeout=0.3)
        if _stop.is_set() or (stop_evt and stop_evt.is_set()):
            return False
        _active_workers += 1
        acct["_slot_acquired"] = True
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
        "id": str(uuid.uuid4()),
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
        "_created_at": time.time(),
        "_started_at": None,
        "_stop_event": threading.Event(),
        "_force_start": False,
        "_slot_acquired": False,
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
        print("🔐 جاري التحقق من تسجيل الدخول...", flush=True)
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
                if (
                    any(c.get("name") == "egy_student_id_token" for c in cookies)
                    and bool(self_._id_token())
                ):
                    self_._authenticated = True
                    print("✅ تم تأكيد تسجيل الدخول والجلسة.", flush=True)
                    return
                raise RuntimeError("تعذّر تأكيد جلسة المنصة السريعة — جرّب الوضع العادي.")
            if r is not None and r.status == 403:
                print("❌ رفضت منصة Qureo تسجيل الدخول برمز HTTP 403.", flush=True)
                denied_error = getattr(mod, "AccessDeniedError", RuntimeError)
                raise denied_error(
                    "منصة Qureo رفضت طلب تسجيل الدخول (HTTP 403). "
                    "اطلب من منصة Qureo أو مزود الخدمة مراجعة الوصول."
                )
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
                    self_._authenticated = True
                    print("✅ تم تأكيد تسجيل الدخول والجلسة.", flush=True)
                    return
        except Exception:
            pass
        return native(self_, sid, pwd)

    return _fast


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
def _run_spx(acct, code, password, subject, turbo=False, headless=None):
    mod = _load_spx()
    bank = _get_spx_bank()
    stop_evt = acct.get("_stop_event")
    sol = mod.Solver(
        log=lambda m, lvl="info": _log(acct, m, lvl),
        stop=lambda: _stop.is_set() or (stop_evt and stop_evt.is_set()),
        shared=bank,
        subject_id=subject,
        turbo=turbo,
        headless=HEADLESS if headless is None else bool(headless),
    )
    sol.on_progress = lambda d, t, title: _set_progress(acct, d, t, title)
    ok, msg = sol.run(code, password, subject=subject)
    return bool(ok), msg


def _run_qureo(acct, code, password, courses, turbo=False, lang=None, headless=None):
    mod = _install_qureo()
    bank = _load_qureo_bank()
    _tls.acct = acct
    stop_evt = acct.get("_stop_event")
    try:
        solver = mod.QureoSolver(
            headless=HEADLESS if headless is None else bool(headless),
            courses=courses,
            turbo=turbo,
            lang=lang,
        )
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
    if not ok and msg:
        with _lock:
            last_message = acct["lines"][-1]["msg"] if acct["lines"] else ""
        if str(msg) != last_message:
            _log(acct, msg, "error")
    completed_at = time.time()
    started_at = acct.get("_started_at")
    duration_seconds = (
        max(0, int(completed_at - started_at))
        if isinstance(started_at, (int, float))
        else 0
    )
    job_id = acct.get("_queue_job_id")
    if job_id and _queue_store:
        stop_event = acct.get("_stop_event")
        cancelled = bool(not ok and ((stop_event and stop_event.is_set()) or _stop.is_set()))
        _queue_store.finish_job(
            job_id,
            ok,
            cancelled,
            msg,
            phase,
            duration_seconds=duration_seconds,
            mode=str(acct.get("mode") or ""),
            detail=str(acct.get("detail") or ""),
        )
    elif ok:
        try:
            _record_local_solved_event(acct, completed_at, duration_seconds)
        except (OSError, ValueError) as error:
            _log(
                acct,
                "تم الحل لكن تعذّر حفظ سجل الحسابات: %s" % str(error)[:120],
                "error",
            )
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
            with _lock:
                acct["_started_at"] = time.time()
            _set_phase(acct, "جاري التشغيل...")
            browser_visible = _get_browser_visible()
            headless = not browser_visible
            try:
                turbo = bool(opts.get("turbo", True)) and not browser_visible
                if mode == "spx":
                    ok, msg = _run_spx(
                        acct,
                        code,
                        password,
                        opts.get("subject") or "7",
                        turbo,
                        headless=headless,
                    )
                elif mode == "game":
                    ok, msg = _run_gfq(acct, code, password, bool(opts.get("start_new", True)))
                elif mode == "qureo2":
                    lang = str(opts.get("lang") or "ar").lower()
                    ok, msg = _run_qureo(
                        acct,
                        code,
                        password,
                        ["JavaScript"],
                        turbo,
                        lang=lang,
                        headless=headless,
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
                        headless=headless,
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


def _allow_public_start(client_ip):
    now = time.monotonic()
    cutoff = now - START_RATE_WINDOW_SECONDS
    with _start_rate_lock:
        recent = [
            timestamp
            for timestamp in _start_requests.get(client_ip, [])
            if timestamp > cutoff
        ]
        if len(recent) >= START_RATE_LIMIT:
            _start_requests[client_ip] = recent
            retry_after = max(1, int(recent[0] + START_RATE_WINDOW_SECONDS - now))
            return False, retry_after
        recent.append(now)
        _start_requests[client_ip] = recent
        for address, timestamps in list(_start_requests.items()):
            if not any(timestamp > cutoff for timestamp in timestamps):
                del _start_requests[address]
        return True, 0


def _local_queue_metrics(accounts, client_id, owner_key=None):
    active = [account for account in accounts if account["running"]]
    owner_active = (
        [
            account for account in active
            if account.get("_owner_key") == owner_key
        ]
        if owner_key
        else active
    )
    client_accounts = [
        account for account in accounts
        if (
            account.get("_owner_key") == owner_key
            if owner_key
            else client_id is None or account.get("_client_id") == client_id
        )
    ]
    client_active = [account for account in client_accounts if account["running"]]
    if any(account["phase"] == "جاري التشغيل..." for account in client_active):
        queue_state = "running"
        queue_ahead = 0
        queue_position = 1
    elif client_active:
        first_order = min(account.get("_queue_order", 0) for account in client_active)
        queue_ahead = sum(
            1 for account in owner_active
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
        "queue_total": len(owner_active) if owner_key else len(active),
        "queue_ahead": queue_ahead,
        "queue_position": queue_position,
        "queue_state": queue_state,
    }


def _admin_queue_payload():
    if _queue_store:
        return _queue_store.admin_queue_payload()

    with _lock:
        active = sorted(
            (account for account in _accounts if account["running"]),
            key=lambda account: account.get("_queue_order", 0),
        )
    with _solved_count_lock:
        solved_count = _local_solved_count
        solved_events = [dict(event) for event in _local_solved_events]

    current_time = time.time()
    active_codes = set()
    running_codes = set()
    jobs = []
    for position, account in enumerate(active, start=1):
        running = account.get("_slot_acquired", False)
        active_codes.add(account["code"])
        if running:
            running_codes.add(account["code"])
        jobs.append({
            "id": account["id"],
            "code": account["code"],
            "mode": account["mode"],
            "detail": account["detail"],
            "phase": account["phase"],
            "running": running,
            "position": position,
            "progress": dict(account["progress"]),
            "elapsed_seconds": (
                max(0, int(current_time - account["_started_at"]))
                if account.get("_started_at") is not None
                else None
            ),
            "queued_seconds": max(
                0, int(current_time - account.get("_created_at", current_time))
            ),
        })
    return {
        "ok": True,
        "queue_count": len(active_codes),
        "running_count": len(running_codes),
        "active_job_count": len(active),
        "solved_count": solved_count,
        "solved_events": solved_events,
        "jobs": jobs,
    }


def _admin_start_now(job_id):
    if _queue_store:
        job = _queue_store.claim_job_for_admin(job_id)
        if job is None:
            return False, "المهمة لم تعد في الانتظار؛ حدّث القائمة."
        worker = threading.Thread(
            target=_run_persisted_job,
            args=(job, None),
            name="quizora-admin-" + job["id"],
            daemon=True,
        )
        try:
            worker.start()
        except Exception as error:
            _queue_store.finish_job(
                job["id"], False, False,
                "تعذّر إنشاء عامل البدء الفوري: " + str(error)[:200],
                "فشل",
            )
            raise
        return True, "بدأ الحل فورًا؛ العمليات الحالية مستمرة."

    with _concurrency_lock:
        with _lock:
            account = next(
                (
                    item for item in _accounts
                    if item["id"] == job_id and item["running"]
                ),
                None,
            )
            if account is None:
                return False, "المهمة لم تعد في الانتظار؛ حدّث القائمة."
            if account.get("_slot_acquired"):
                return False, "بدأ الحل بالفعل."
            account["_force_start"] = True
        _concurrency_lock.notify_all()
    return True, "بدأ الحل فورًا؛ العمليات الحالية مستمرة."


def _detail_for(job):
    if job["mode"] == "spx":
        return "الثقافة المالية (عربي)" if str(job.get("subject")) == "7" else "Financial Literacy (لغات)"
    if job["mode"] == "game":
        return "لعبة الأسهم (Global Finance Quest)"
    if job["mode"] == "qureo2":
        lang = str(job.get("lang") or "ar").lower()
        return "Qureo JavaScript (عربي) — الخيار الثاني" if lang == "ar" else "Qureo JavaScript (لغات) — الخيار الثاني"
    return " + ".join(job.get("courses") or [])


def _start(
    plan,
    accounts,
    client_id=None,
    owner_key=None,
    owner_name=None,
    owner_email=None,
    owner_user_id=None,
):
    global _accounts, _local_queue_sequence
    client_id = _normalize_client_id(client_id) or str(uuid.uuid4())
    if _queue_store:
        added, _, _ = _queue_store.enqueue(
            plan,
            accounts,
            MAX_ACCOUNTS,
            client_id,
            owner_key,
            owner_name,
            owner_email,
            owner_user_id=owner_user_id,
        )
        if added == 0:
            return False, "هذه العمليات موجودة بالفعل في طابور الانتظار أو قيد التشغيل."
        return True, "تم تسجيل %d عملية في طابور الانتظار؛ التنفيذ متسلسل." % added

    pruned = _prune_dead_accounts()

    with _lock:
        _accounts[:] = [
            a for a in _accounts
            if (
                a.get("_owner_key") != owner_key
                or a.get("_client_id") != client_id
                or a["running"]
            )
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
                acct["_owner_key"] = owner_key
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
                if (
                    worker_connection is not None
                    and not _queue_store.worker_lock_is_held(worker_connection)
                ):
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
            cookie = getattr(self, "_pending_cookie", None)
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(body)

        def _cors_headers(self):
            origin = (self.headers.get("Origin") or "").rstrip("/")
            if origin in CORS_ALLOWED_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header(
                    "Access-Control-Allow-Headers",
                    "Content-Type, ngrok-skip-browser-warning",
                )
                self.send_header("Access-Control-Allow-Credentials", "true")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")

        def _cookie(self, name):
            try:
                cookies = SimpleCookie(self.headers.get("Cookie", ""))
                morsel = cookies.get(name)
                return morsel.value if morsel else None
            except Exception:
                return None

        def _set_cookie(self, name, value, max_age):
            secure = COOKIE_SECURE or (
                (self.headers.get("Origin") or "").lower().startswith("https://")
            )
            same_site = "None" if secure else "Lax"
            cookie = (
                "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=%s"
                % (name, value, max_age, same_site)
            )
            if secure:
                cookie += "; Secure"
            self._pending_cookie = cookie

        def _owner_key(self, user=None):
            if self._auth_enabled():
                if user is None:
                    return None
                return hashlib.sha256(
                    ("account:" + str(user["id"])).encode("utf-8")
                ).hexdigest()
            token = self._cookie("quizora_owner")
            if not token or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
                token = secrets.token_urlsafe(32)
                self._set_cookie("quizora_owner", token, 60 * 60 * 24 * 180)
            return hashlib.sha256(
                ("anonymous:" + token).encode("ascii")
            ).hexdigest()

        def _auth_mutation_allowed(self):
            origin = self.headers.get("Origin")
            if origin:
                return origin.rstrip("/") in CORS_ALLOWED_ORIGINS
            return self.headers.get("Sec-Fetch-Site", "").lower() != "cross-site"

        @staticmethod
        def _public_user(user):
            return {
                "id": str(user["id"]),
                "full_name": user["full_name"],
                "email": user["email"],
                "role": user["role"],
            }

        @staticmethod
        def _auth_enabled():
            return bool(
                FIREBASE_PROJECT_ID
                and _auth_store
                and _queue_store
            )

        def _auth_session(self):
            session = self._cookie("quizora_session")
            if not _auth_store or not session:
                return None
            user = _auth_store.get_session_user(session)
            if user:
                self._set_cookie("quizora_session", session, SESSION_TTL_SECONDS)
            return user

        def _require_api_user(self):
            if not AUTH_REQUIRED:
                return True, None
            if not self._auth_enabled():
                self._json(503, {
                    "ok": False,
                    "message": AUTH_DISABLED_MESSAGE,
                })
                return False, None
            try:
                user = self._auth_session()
            except AuthStoreError:
                self._json(503, {
                    "ok": False,
                    "message": "تعذّر التحقق من جلسة المستخدم.",
                })
                return False, None
            if not user:
                self._json(401, {
                    "ok": False,
                    "message": "سجّل الدخول بحساب Google للمتابعة.",
                })
                return False, None
            return True, user

        def _require_subscription_user(self):
            if not self._auth_enabled() or not _queue_store:
                self._json(503, {
                    "ok": False,
                    "message": "الاشتراكات تتطلب تسجيل الدخول وقاعدة بيانات مفعّلة.",
                })
                return False, None
            try:
                user = self._auth_session()
            except AuthStoreError:
                self._json(503, {
                    "ok": False,
                    "message": "تعذّر التحقق من جلسة المستخدم.",
                })
                return False, None
            if not user:
                self._json(401, {
                    "ok": False,
                    "message": "سجّل الدخول أولًا لإدارة اشتراكك.",
                })
                return False, None
            return True, user

        def _redirect_to_account(self, return_to):
            location = "/account.html?next=" + quote(return_to or "/", safe="")
            self.send_response(302)
            self.send_header("Location", location)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _require_page_user(self, return_to):
            if not self._auth_enabled():
                self._redirect_to_account(return_to)
                return False
            try:
                user = self._auth_session()
            except AuthStoreError:
                self._json(503, {"ok": False, "message": "تعذّر التحقق من جلسة المستخدم."})
                return False
            if not user:
                self._redirect_to_account(return_to)
                return False
            return True

        def _firebase_login(self):
            if not self._auth_mutation_allowed():
                self._json(403, {"ok": False, "message": "مصدر الطلب غير مسموح."})
                return
            if not self._auth_enabled():
                self._json(503, {"ok": False, "message": AUTH_DISABLED_MESSAGE})
                return
            try:
                data = self._read_json()
                if not isinstance(data, dict):
                    raise ValueError("invalid body")
                credential = data.get("id_token")
                if (
                    not isinstance(credential, str)
                    or not 100 <= len(credential) <= 16384
                ):
                    raise ValueError("تعذّر قراءة استجابة Google؛ حاول مجددًا.")
                identity = verify_firebase_credential(
                    credential, FIREBASE_PROJECT_ID
                )
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._json(400, {
                    "ok": False,
                    "message": str(error) or "تعذّر التحقق من حساب Google.",
                })
                return
            try:
                if not _auth_store.allow_login(
                    identity["firebase_uid"], self._client_ip()
                ):
                    self._json(429, {
                        "ok": False,
                        "message": "محاولات تسجيل الدخول كثيرة؛ حاول لاحقًا.",
                    })
                    return
                user = _auth_store.find_firebase_user(identity, ADMIN_EMAIL)
                if not user:
                    self._json(404, {
                        "ok": False,
                        "message": "لا يوجد حساب لهذا البريد. أنشئ حسابًا أولًا.",
                    })
                    return
                token = _auth_store.create_session(user["id"])
            except AccountBlockedError as error:
                self._json(403, {"ok": False, "message": str(error)})
                return
            except AuthStoreError as error:
                self._json(503, {
                    "ok": False,
                    "message": str(error) or "تعذّر تسجيل الدخول بحساب Google.",
                })
                return
            self._set_cookie("quizora_session", token, SESSION_TTL_SECONDS)
            self._json(200, {
                "ok": True,
                "user": self._public_user(user),
            })

        def _firebase_register(self):
            if not self._auth_mutation_allowed():
                self._json(403, {"ok": False, "message": "مصدر الطلب غير مسموح."})
                return
            if not self._auth_enabled():
                self._json(503, {"ok": False, "message": AUTH_DISABLED_MESSAGE})
                return
            try:
                data = self._read_json()
                if not isinstance(data, dict):
                    raise ValueError("invalid body")
                credential = data.get("id_token")
                full_name = data.get("full_name")
                password = data.get("password")
                confirmation = data.get("password_confirmation")
                if (
                    not isinstance(credential, str)
                    or not 100 <= len(credential) <= 16384
                    or not isinstance(full_name, str)
                    or not full_name.strip()
                    or len(full_name.strip()) > 120
                    or not isinstance(password, str)
                    or password != confirmation
                ):
                    raise ValueError("بيانات إنشاء الحساب غير مكتملة أو غير متطابقة.")
                identity = verify_firebase_credential(
                    credential, FIREBASE_PROJECT_ID
                )
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._json(400, {
                    "ok": False,
                    "message": str(error) or "تعذّر إنشاء الحساب.",
                })
                return
            try:
                if not _auth_store.allow_login(
                    identity["firebase_uid"], self._client_ip()
                ):
                    self._json(429, {
                        "ok": False,
                        "message": "محاولات إنشاء الحساب كثيرة؛ حاول لاحقًا.",
                    })
                    return
                password_hash = hash_password(password)
                user = _auth_store.create_firebase_user(
                    identity,
                    full_name.strip(),
                    password_hash,
                    ADMIN_EMAIL,
                )
                token = _auth_store.create_session(user["id"])
            except ValueError as error:
                self._json(400, {"ok": False, "message": str(error)})
                return
            except AccountExistsError as error:
                self._json(409, {"ok": False, "message": str(error)})
                return
            except AuthStoreError as error:
                self._json(503, {
                    "ok": False,
                    "message": str(error) or "تعذّر إنشاء الحساب.",
                })
                return
            self._set_cookie("quizora_session", token, SESSION_TTL_SECONDS)
            self._json(201, {
                "ok": True,
                "user": self._public_user(user),
            })

        def _password_login(self):
            if not self._auth_mutation_allowed():
                self._json(403, {"ok": False, "message": "مصدر الطلب غير مسموح."})
                return
            if not self._auth_enabled():
                self._json(503, {"ok": False, "message": AUTH_DISABLED_MESSAGE})
                return
            try:
                data = self._read_json()
                if not isinstance(data, dict):
                    raise ValueError("invalid body")
                email = data.get("email")
                password = data.get("password")
                if (
                    not isinstance(email, str)
                    or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
                    or len(email) > 254
                    or not isinstance(password, str)
                    or len(password) > 128
                ):
                    raise ValueError("أدخل بريدًا إلكترونيًا وكلمة مرور صالحين.")
                email = email.strip().lower()
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._json(400, {
                    "ok": False,
                    "message": str(error) or "بيانات الدخول غير صالحة.",
                })
                return
            try:
                if not _auth_store.allow_password_login(email, self._client_ip()):
                    self._json(429, {
                        "ok": False,
                        "message": "محاولات تسجيل الدخول كثيرة؛ حاول لاحقًا.",
                    })
                    return
                user = _auth_store.authenticate_password(email, password)
                if not user:
                    self._json(401, {
                        "ok": False,
                        "message": (
                            "بيانات الدخول غير صحيحة. إذا أنشأت حسابك باستخدام "
                            "Google، سجّل الدخول بزر Google."
                        ),
                    })
                    return
                token = _auth_store.create_session(user["id"])
            except AccountBlockedError as error:
                self._json(403, {"ok": False, "message": str(error)})
                return
            except AuthStoreError as error:
                self._json(503, {
                    "ok": False,
                    "message": str(error) or "تعذّر تسجيل الدخول.",
                })
                return
            self._set_cookie("quizora_session", token, SESSION_TTL_SECONDS)
            self._json(200, {
                "ok": True,
                "user": self._public_user(user),
            })

        def _file(self, name, ctype, status=200):
            try:
                with open(os.path.join(APP_DIR, name), "rb") as f:
                    data = f.read()
            except Exception:
                return False
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            basename = os.path.basename(name)
            if status != 200:
                self.send_header("Cache-Control", "no-store")
                self.send_header("Retry-After", "300")
            elif basename == "sw.js":
                self.send_header("Cache-Control", "no-store")
                self.send_header("Service-Worker-Allowed", "/")
            elif basename == "progress.html":
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("X-Content-Type-Options", "nosniff")
            elif basename in ("index.html", "manifest.json", "config.js"):
                self.send_header("Cache-Control", "no-cache")
            cookie = getattr(self, "_pending_cookie", None)
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(data)
            return True

        def _client_ip(self):
            remote_ip = self.client_address[0]
            forwarded = (self.headers.get("CF-Connecting-IP") or "").strip()
            if remote_ip in ("127.0.0.1", "::1") and forwarded:
                try:
                    return str(ipaddress.ip_address(forwarded))
                except ValueError:
                    pass
            return remote_ip

        def _local_request_allowed(self):
            try:
                if not ipaddress.ip_address(self.client_address[0]).is_loopback:
                    return False
                if (
                    self.headers.get("CF-Connecting-IP")
                    or self.headers.get("X-Forwarded-For")
                ):
                    return False
                host_header = self.headers.get("Host", "")
                host = urlsplit("//" + host_header).hostname
                if host != "localhost":
                    if not host or not ipaddress.ip_address(host).is_loopback:
                        return False
                origin = self.headers.get("Origin")
                if origin:
                    origin_url = urlsplit(origin)
                    if (
                        origin_url.scheme != "http"
                        or origin_url.netloc.lower() != host_header.lower()
                    ):
                        return False
                return True
            except ValueError:
                return False

        def _admin_request_allowed(self):
            if not self._local_request_allowed():
                return False
            # لوحة الأدمن المحلية لا تحتاج إلى كوكي نطاق خارجي:
            # الاتصال يقتصر على 127.0.0.1 ولا يقبل رؤوس proxy أو forwarding.
            if not _auth_store or not AUTH_REQUIRED:
                return True
            try:
                user = self._auth_session()
            except AuthStoreError:
                return False
            return bool(user and user.get("role") == "admin")

        def _maintenance_gate(self):
            if self._local_request_allowed():
                return False
            path = urlsplit(self.path).path
            if path == "/api/health":
                return False
            if not _queue_store:
                return False
            try:
                enabled = _get_site_enabled_cached()
            except QueueStoreError as error:
                _ORIG_STDOUT.write(
                    "[site] تعذّر التحقق من حالة الإتاحة: %s\n" % error
                )
                enabled = False
            if enabled:
                return False

            if path.startswith("/api/"):
                self._json(503, {
                    "ok": False,
                    "maintenance": True,
                    "message": "الموقع متوقف مؤقتًا للصيانة. حاول مرة أخرى لاحقًا.",
                })
            elif not self._file(
                "frontend/maintenance.html",
                "text/html; charset=utf-8",
                status=503,
            ):
                self._json(503, {
                    "ok": False,
                    "maintenance": True,
                    "message": "الموقع متوقف مؤقتًا للصيانة. حاول مرة أخرى لاحقًا.",
                })
            return True

        def _admin_users_payload(self, query_string):
            if not _auth_store or not self._auth_enabled():
                self._json(503, {
                    "ok": False,
                    "error": "إدارة المستخدمين تتطلب قاعدة بيانات ومصادقة مفعّلتين.",
                })
                return
            query = parse_qs(query_string, keep_blank_values=True)
            search = query.get("q", [""])[0].strip()
            status = query.get("status", ["all"])[0]
            try:
                limit = int(query.get("limit", ["50"])[0])
                offset = int(query.get("offset", ["0"])[0])
            except ValueError:
                self._json(400, {"ok": False, "error": "خيارات عرض المستخدمين غير صالحة."})
                return
            if (
                len(search) > 120
                or status not in ("all", "active", "blocked")
                or not 1 <= limit <= 100
                or not 0 <= offset <= 2_147_483_647
            ):
                self._json(400, {"ok": False, "error": "خيارات البحث أو التصفية غير صالحة."})
                return
            try:
                payload = _auth_store.list_users(
                    search=search,
                    status=status,
                    limit=limit,
                    offset=offset,
                )
            except AuthStoreError:
                self._json(503, {"ok": False, "error": "تعذّر تحميل قائمة المستخدمين."})
                return
            self._json(200, {"ok": True, **payload})

        def _admin_user_action(self):
            if self.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
                self._json(403, {
                    "ok": False,
                    "message": "مصدر الطلب غير مسموح.",
                })
                return
            if not _auth_store or not self._auth_enabled():
                self._json(503, {
                    "ok": False,
                    "message": "إدارة المستخدمين تتطلب قاعدة بيانات ومصادقة مفعّلتين.",
                })
                return
            try:
                data = self._read_json()
                if not isinstance(data, dict):
                    raise ValueError
                user_id = str(uuid.UUID(str(data.get("id") or "")))
                action = data.get("action")
                if action not in ("block", "unblock", "delete"):
                    raise ValueError
            except (ValueError, TypeError, json.JSONDecodeError):
                self._json(400, {"ok": False, "message": "بيانات إجراء المستخدم غير صالحة."})
                return
            try:
                admin = self._auth_session()
                if not admin or admin.get("role") != "admin":
                    self._json(403, {
                        "ok": False,
                        "message": "تتطلب إدارة المستخدمين جلسة مدير صالحة.",
                    })
                    return
                if action == "delete":
                    _auth_store.delete_user(user_id, admin["id"])
                    message = "تم حذف المستخدم وإنهاء جلساته."
                else:
                    _auth_store.set_user_blocked(
                        user_id,
                        action == "block",
                        admin["id"],
                    )
                    message = (
                        "تم حظر المستخدم وإنهاء جلساته."
                        if action == "block"
                        else "تم فك حظر المستخدم؛ عليه تسجيل الدخول مجددًا."
                    )
            except AccountNotFoundError as error:
                self._json(404, {"ok": False, "message": str(error)})
                return
            except AccountManagementConflictError as error:
                self._json(409, {"ok": False, "message": str(error)})
                return
            except AuthStoreError:
                self._json(503, {"ok": False, "message": "تعذّر تحديث حساب المستخدم."})
                return
            self._json(200, {"ok": True, "message": message})

        def _admin_subscription_codes(self, query_string):
            if not self._auth_enabled() or not _queue_store:
                self._json(503, {
                    "ok": False,
                    "error": "إدارة أكواد الاشتراك تتطلب قاعدة بيانات ومصادقة مفعّلتين.",
                })
                return
            try:
                admin = self._auth_session()
                if not admin or admin.get("role") != "admin":
                    self._json(403, {
                        "ok": False,
                        "error": "تتطلب إدارة الأكواد جلسة مدير صالحة.",
                    })
                    return
                query = parse_qs(query_string, keep_blank_values=True)
                try:
                    limit = int(query.get("limit", ["50"])[0])
                except ValueError:
                    self._json(400, {"ok": False, "error": "عدد الأكواد المطلوب غير صالح."})
                    return
                if not 1 <= limit <= 100:
                    self._json(400, {"ok": False, "error": "عدد الأكواد المطلوب غير صالح."})
                    return
                codes = _queue_store.list_subscription_codes(limit)
            except AuthStoreError:
                self._json(503, {"ok": False, "error": "تعذّر التحقق من المدير."})
                return
            except QueueStoreError:
                self._json(503, {"ok": False, "error": "تعذّر تحميل أكواد الاشتراك."})
                return
            self._json(200, {"ok": True, "codes": codes})

        def _admin_create_subscription_code(self):
            if not self._auth_enabled() or not _queue_store:
                self._json(503, {
                    "ok": False,
                    "message": "إنشاء أكواد الاشتراك يتطلب قاعدة بيانات ومصادقة مفعّلتين.",
                })
                return
            try:
                data = self._read_json()
                if not isinstance(data, dict):
                    raise ValueError
                plan_key = data.get("plan_key")
                if not isinstance(plan_key, str):
                    raise ValueError
                admin = self._auth_session()
                if not admin or admin.get("role") != "admin":
                    self._json(403, {
                        "ok": False,
                        "message": "تتطلب إدارة الأكواد جلسة مدير صالحة.",
                    })
                    return
                created = _queue_store.create_subscription_code(
                    plan_key, admin["id"]
                )
            except (ValueError, TypeError, json.JSONDecodeError):
                self._json(400, {"ok": False, "message": "بيانات إنشاء الكود غير صالحة."})
                return
            except AuthStoreError:
                self._json(503, {"ok": False, "message": "تعذّر التحقق من المدير."})
                return
            except SubscriptionError as error:
                self._json(error.status_code, {"ok": False, "message": str(error)})
                return
            except QueueStoreError:
                self._json(503, {"ok": False, "message": "تعذّر إنشاء كود الاشتراك."})
                return
            self._json(201, {"ok": True, **created})

        def _status_payload(self, client_id=None, owner_key=None):
            if _queue_store:
                return _queue_store.status_payload(
                    STATUS_LOG_LINES, client_id, owner_key
                )
            with _lock:
                all_accounts = list(_accounts)
                accs_for_client = [
                    a for a in all_accounts
                    if (
                        a.get("_owner_key") == owner_key
                        if owner_key
                        else client_id is None or a.get("_client_id") == client_id
                    )
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
                queue_metrics = _local_queue_metrics(
                    all_accounts, client_id, owner_key
                )
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
            parsed_path = urlsplit(self.path)
            if (
                parsed_path.path == "/api/admin"
                or parsed_path.path.startswith("/api/admin/")
            ) and not self._admin_request_allowed():
                self._json(403, {
                    "ok": False,
                    "error": "تتطلب الإدارة صلاحية المدير والاتصال المحلي.",
                })
                return
            if parsed_path.path == "/admin":
                if not self._local_request_allowed():
                    self._json(403, {
                        "ok": False,
                        "error": "تتطلب الإدارة الاتصال المحلي.",
                    })
                    return
                body = ADMIN_PAGE.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(body)
                return
            if self._maintenance_gate():
                return
            protected_page = {
                "/": "frontend/index.html",
                "/index.html": "frontend/index.html",
                "/progress": "frontend/progress.html",
            }.get(parsed_path.path)
            if AUTH_REQUIRED and protected_page:
                if not os.path.isfile(os.path.join(APP_DIR, protected_page)):
                    self._json(404, {"error": "frontend is hosted separately"})
                    return
                return_to = parsed_path.path
                if parsed_path.query:
                    return_to += "?" + parsed_path.query
                if not self._require_page_user(return_to):
                    return
            if parsed_path.path == "/progress":
                if not self._local_request_allowed():
                    self._json(403, {"ok": False, "error": "صفحة المتابعة متاحة من الجهاز المحلي فقط."})
                    return
                query = parse_qs(parsed_path.query)
                if not _normalize_client_id(query.get("client_id", [None])[0]):
                    self._json(400, {"ok": False, "error": "معرّف جلسة المتابعة غير صالح."})
                    return
                if not self._file("frontend/progress.html", "text/html; charset=utf-8"):
                    self._json(404, {"error": "resource not found"})
                return
            if parsed_path.path == "/admin":
                body = ADMIN_PAGE.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(body)
                return
            if parsed_path.path == "/api/admin/queue":
                try:
                    self._json(200, _admin_queue_payload())
                except QueueStoreError:
                    self._json(503, {"ok": False, "error": "تعذّر قراءة طابور الانتظار."})
                return
            if parsed_path.path == "/api/admin/users":
                self._admin_users_payload(parsed_path.query)
                return
            if parsed_path.path == "/api/admin/subscription-codes":
                self._admin_subscription_codes(parsed_path.query)
                return
            if parsed_path.path == "/api/admin/settings":
                self._json(200, {
                    "ok": True,
                    "browser_visible": _get_browser_visible(),
                })
                return
            if parsed_path.path == "/api/admin/site-status":
                if not _queue_store:
                    self._json(503, {
                        "ok": False,
                        "message": "التحكم في إتاحة الموقع يتطلب قاعدة بيانات PostgreSQL.",
                    })
                    return
                try:
                    self._json(200, {
                        "ok": True,
                        "enabled": _get_site_enabled_cached(),
                    })
                except QueueStoreError:
                    self._json(503, {
                        "ok": False,
                        "message": "تعذّر قراءة حالة الموقع من قاعدة البيانات.",
                    })
                return
            if parsed_path.path in STATIC_ROUTES:
                name, ctype = STATIC_ROUTES[parsed_path.path]
                if not self._file(name, ctype):
                    self._json(404, {"error": "resource not found"})
                return
            if parsed_path.path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if self.path == "/api/health":
                try:
                    if _queue_store:
                        _queue_store.health()
                    site_on = _get_site_enabled_cached() if _queue_store else True
                    is_local = self._local_request_allowed()
                    self._json(200, {
                        "ok": True,
                        "version": VERSION,
                        "database": "postgresql" if _queue_store else "local",
                        "maintenance": (not site_on) and (not is_local),
                    })
                except QueueStoreError:
                    self._json(503, {"ok": False, "error": "قاعدة البيانات غير متاحة."})
                return
            if parsed_path.path == "/api/status":
                authenticated, user = self._require_api_user()
                if not authenticated:
                    return
                query = parse_qs(parsed_path.query)
                raw_client_id = query.get("client_id", [None])[0]
                client_id = _normalize_client_id(raw_client_id)
                if not client_id:
                    self._json(400, {"ok": False, "error": "معرّف الجلسة مطلوب أو غير صالح."})
                    return
                try:
                    self._json(
                        200,
                        self._status_payload(client_id, self._owner_key(user)),
                    )
                except QueueStoreError:
                    self._json(503, {"ok": False, "error": "تعذّر قراءة طابور الانتظار."})
                return
            if parsed_path.path == "/api/subscription":
                authenticated, user = self._require_subscription_user()
                if not authenticated:
                    return
                try:
                    status = _queue_store.subscription_status(
                        user["id"], self._owner_key(user)
                    )
                except SubscriptionError as error:
                    self._json(error.status_code, {
                        "ok": False,
                        "message": str(error),
                    })
                    return
                except QueueStoreError:
                    self._json(503, {
                        "ok": False,
                        "message": "تعذّر تحميل حالة الاشتراك.",
                    })
                    return
                self._json(200, {"ok": True, **status})
                return
            if parsed_path.path == "/api/auth/status":
                enabled = self._auth_enabled()
                self._json(200, {
                    "ok": True,
                    "enabled": enabled,
                    "required": AUTH_REQUIRED,
                    "message": (
                        "" if enabled
                        else AUTH_DISABLED_MESSAGE if AUTH_REQUIRED
                        else "تسجيل الدخول متاح عند إعداد Firebase Authentication."
                    ),
                })
                return
            if parsed_path.path == "/api/auth/me":
                if not self._auth_enabled():
                    self._json(503, {
                        "ok": False,
                        "enabled": False,
                        "message": AUTH_DISABLED_MESSAGE,
                    })
                    return
                try:
                    user = self._auth_session()
                except AuthStoreError:
                    self._json(503, {"ok": False, "message": "تعذّر قراءة الجلسة."})
                    return
                self._json(
                    200,
                    {"ok": True, "user": self._public_user(user) if user else None},
                )
                return
            if self.path == "/api/game_results":
                self._json(403, {"ok": False, "error": "هذه البيانات غير متاحة عبر الخدمة العامة."})
                return
            self._json(404, {"error": "not found"})

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _read_json(self):
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length < 0 or length > MAX_JSON_BODY_BYTES:
                self.close_connection = True
                raise ValueError("حجم الطلب أكبر من الحد المسموح.")
            return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

        def do_POST(self):
            route = urlsplit(self.path).path
            if (
                route == "/api/admin"
                or route.startswith("/api/admin/")
            ) and not self._admin_request_allowed():
                self._json(403, {
                    "ok": False,
                    "message": "تتطلب الإدارة صلاحية المدير والاتصال المحلي.",
                })
                return
            if self._maintenance_gate():
                return
            if route == "/api/auth/register":
                self._json(404, {
                    "ok": False,
                    "message": "اختر Google أولًا لإنشاء حساب.",
                })
                return
            if route == "/api/auth/firebase/register":
                self._firebase_register()
                return
            if route == "/api/auth/firebase/login":
                self._firebase_login()
                return
            if route == "/api/auth/password/login":
                self._password_login()
                return
            if route == "/api/admin/users":
                self._admin_user_action()
                return
            if route == "/api/admin/subscription-codes":
                self._admin_create_subscription_code()
                return
            if route == "/api/subscription/redeem":
                if not self._auth_mutation_allowed():
                    self._json(403, {"ok": False, "message": "مصدر الطلب غير مسموح."})
                    return
                authenticated, user = self._require_subscription_user()
                if not authenticated:
                    return
                try:
                    data = self._read_json()
                    if not isinstance(data, dict):
                        raise ValueError
                    plan_key = data.get("plan_key")
                    code = data.get("code")
                    if (
                        not isinstance(plan_key, str)
                        or not isinstance(code, str)
                        or not 1 <= len(code.strip()) <= 64
                    ):
                        raise ValueError
                except (ValueError, TypeError, json.JSONDecodeError):
                    self._json(400, {
                        "ok": False,
                        "message": "اختر الخطة واكتب كود الاشتراك بشكل صحيح.",
                    })
                    return
                try:
                    status = _queue_store.redeem_subscription_code(
                        user["id"],
                        self._owner_key(user),
                        plan_key,
                        code,
                    )
                except SubscriptionError as error:
                    self._json(error.status_code, {
                        "ok": False,
                        "message": str(error),
                    })
                    return
                except QueueStoreError:
                    self._json(503, {
                        "ok": False,
                        "message": "تعذّر تفعيل كود الاشتراك.",
                    })
                    return
                self._json(200, {
                    "ok": True,
                    "message": "تم تفعيل الخطة بنجاح.",
                    **status,
                })
                return
            if route == "/api/auth/logout":
                if not self._auth_mutation_allowed():
                    self._json(403, {"ok": False, "message": "مصدر الطلب غير مسموح."})
                    return
                token = self._cookie("quizora_session")
                if token and _auth_store:
                    try:
                        _auth_store.revoke_session(token)
                    except AuthStoreError:
                        self._json(503, {"ok": False, "message": "تعذّر إنهاء الجلسة."})
                        return
                self._set_cookie("quizora_session", "", 0)
                self._json(200, {"ok": True, "message": "تم تسجيل الخروج."})
                return
            if urlsplit(self.path).path == "/api/admin/settings":
                try:
                    data = self._read_json()
                except (ValueError, json.JSONDecodeError):
                    self._json(400, {"ok": False, "message": "إعدادات غير صالحة."})
                    return
                if (
                    not isinstance(data, dict)
                    or type(data.get("browser_visible")) is not bool
                ):
                    self._json(400, {"ok": False, "message": "اختر حالة ظهور متصفح صحيحة."})
                    return
                try:
                    _set_browser_visible(data["browser_visible"])
                    self._json(200, {
                        "ok": True,
                        "browser_visible": _get_browser_visible(),
                        "message": (
                            "سيظهر المتصفح مع العمليات الجديدة."
                            if data["browser_visible"]
                            else "سيعمل المتصفح في الخلفية مع العمليات الجديدة."
                        ),
                    })
                except OSError:
                    self._json(500, {"ok": False, "message": "تعذّر حفظ إعداد المتصفح محليًا."})
                return
            if route == "/api/admin/site-status":
                try:
                    data = self._read_json()
                except (ValueError, json.JSONDecodeError):
                    self._json(400, {"ok": False, "message": "حالة الموقع غير صالحة."})
                    return
                if not isinstance(data, dict) or type(data.get("enabled")) is not bool:
                    self._json(400, {"ok": False, "message": "اختر حالة تشغيل صحيحة للموقع."})
                    return
                if not _queue_store:
                    self._json(503, {
                        "ok": False,
                        "message": "التحكم في إتاحة الموقع يتطلب قاعدة بيانات PostgreSQL.",
                    })
                    return
                try:
                    _set_site_enabled_cached(data["enabled"])
                    self._json(200, {
                        "ok": True,
                        "enabled": data["enabled"],
                        "message": (
                            "تم تشغيل الموقع للزوار."
                            if data["enabled"]
                            else "تم إيقاف الموقع؛ ستظهر صفحة الصيانة للزوار."
                        ),
                    })
                except QueueStoreError:
                    self._json(503, {
                        "ok": False,
                        "message": "تعذّر حفظ حالة الموقع في قاعدة البيانات.",
                    })
                return
            if urlsplit(self.path).path == "/api/admin/start-now":
                try:
                    data = self._read_json()
                    job_id = str(uuid.UUID(str(data.get("id") or "")))
                except (ValueError, TypeError, json.JSONDecodeError):
                    self._json(400, {"ok": False, "message": "معرّف العملية غير صالح."})
                    return
                try:
                    ok, message = _admin_start_now(job_id)
                    self._json(200 if ok else 409, {"ok": ok, "message": message})
                except QueueStoreError:
                    self._json(503, {"ok": False, "message": "تعذّر بدء العملية من الطابور."})
                except Exception:
                    self._json(500, {"ok": False, "message": "تعذّر إنشاء عملية الحل."})
                return
            if self.path == "/api/start":
                authenticated, user = self._require_api_user()
                if not authenticated:
                    return
                if _queue_store and self._auth_enabled() and not user:
                    self._json(401, {
                        "ok": False,
                        "message": "سجّل الدخول بحسابك قبل بدء الحل.",
                    })
                    return
                try:
                    data = self._read_json()
                except Exception:
                    self._json(400, {"ok": False, "message": "بيانات غير صحيحة — حدّث الصفحة (F5)."})
                    return
                mode = str(data.get("mode") or "")
                raw_client_id = data.get("client_id")
                client_id = _normalize_client_id(raw_client_id)
                if not client_id:
                    self._json(400, {"ok": False, "message": "معرّف الجلسة مطلوب أو غير صالح."})
                    return
                allowed, retry_after = _allow_public_start(self._client_ip())
                if not allowed:
                    self._json(429, {
                        "ok": False,
                        "message": "تم تجاوز عدد مرات البدء المسموح؛ حاول بعد %d ثانية." % retry_after,
                    })
                    return
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
                for item in plan:
                    if "detail" not in item:
                        item["detail"] = _detail_for(item)
                if "concurrency" in data:
                    _set_concurrency(data["concurrency"])
                try:
                    ok, msg = _start(
                        plan,
                        accounts,
                        client_id,
                        self._owner_key(user),
                        user.get("full_name") if user else None,
                        user.get("email") if user else None,
                        user.get("id") if user else None,
                    )
                    self._json(200 if ok else 409, {
                        "ok": ok,
                        "message": msg,
                        "client_id": client_id,
                    })
                except SubscriptionError as error:
                    self._json(error.status_code, {
                        "ok": False,
                        "message": str(error),
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
                self._json(403, {
                    "ok": False,
                    "error": "إعداد التزامن غير متاح عبر الواجهة العامة.",
                })
                return
            if self.path == "/api/stop":
                authenticated, user = self._require_api_user()
                if not authenticated:
                    return
                try:
                    data = self._read_json()
                except Exception:
                    data = {}
                code_to_stop = data.get("code")
                raw_client_id = data.get("client_id")
                client_id = _normalize_client_id(raw_client_id)
                if not client_id:
                    self._json(400, {"ok": False, "message": "معرّف الجلسة مطلوب أو غير صالح."})
                    return
                owner_key = self._owner_key(user)
                if _queue_store:
                    try:
                        queued, running = _queue_store.request_stop(
                            str(code_to_stop).strip() if code_to_stop else None,
                            client_id,
                            owner_key,
                        )
                    except QueueStoreError:
                        self._json(503, {
                            "ok": False,
                            "message": "تعذّر تحديث حالة طابور الانتظار.",
                        })
                        return
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
                                and a.get("_client_id") == client_id
                                and a.get("_owner_key") == owner_key
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
                            and a.get("_client_id") == client_id
                            and a.get("_owner_key") == owner_key
                            and "_stop_event" in a
                        ):
                            a["_stop_event"].set()
                self._json(200, {"ok": True, "message": "جارٍ إيقاف جميع العمليات..."})
                return

            if self.path == "/api/clear_finished":
                authenticated, user = self._require_api_user()
                if not authenticated:
                    return
                try:
                    data = self._read_json()
                except Exception:
                    data = {}
                raw_client_id = data.get("client_id")
                client_id = _normalize_client_id(raw_client_id)
                if not client_id:
                    self._json(400, {"ok": False, "message": "معرّف الجلسة مطلوب أو غير صالح."})
                    return
                owner_key = self._owner_key(user)
                if _queue_store:
                    try:
                        deleted = _queue_store.clear_finished(client_id, owner_key)
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
                            a.get("_client_id") != client_id
                            or a.get("_owner_key") != owner_key
                        )
                    ]
                self._json(200, {"ok": True, "message": "تم مسح العمليات المكتملة."})
                return
            self._json(404, {"error": "not found"})

    return Handler


def _server_bind_host():
    configured_host = os.environ.get("QUIZORA_BIND_HOST", "").strip()
    if configured_host:
        return configured_host
    return "0.0.0.0" if os.environ.get("RAILWAY_ENVIRONMENT") else "127.0.0.1"


def main():
    global _server_port
    sys.stdout = _StdoutSink()
    if _queue_store:
        try:
            _auth_store.initialize()
            _queue_store.initialize()
            _auth_store.cleanup_expired()
            _get_site_enabled_cached()
        except QueueStoreError as error:
            _ORIG_STDOUT.write("[app] تعذّر تجهيز قاعدة البيانات: %s\n" % error)
            raise
        except AuthStoreError as error:
            _ORIG_STDOUT.write("[app] تعذّر تجهيز حسابات المستخدمين: %s\n" % error)
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
    bind_host = _server_bind_host()
    for attempt in range(attempts):
        try:
            server = ThreadingHTTPServer(
                (bind_host, port if explicit_port else port + attempt),
                make_handler(),
            )
            if not explicit_port:
                port += attempt
            break
        except OSError:
            continue
    if server is None:
        _ORIG_STDOUT.write("[app] لا منفذ حر متاح — أغلق النوافذ القديمة ثم أعد المحاولة.\n")
        return
    _server_port = int(server.server_address[1])
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
