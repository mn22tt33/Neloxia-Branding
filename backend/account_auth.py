"""Firebase Google sign-in and PostgreSQL account sessions."""

import base64
import binascii
import hashlib
import hmac
import re
import secrets
import uuid
import threading
import time


SESSION_TTL_SECONDS = 60 * 60 * 24 * 365 * 10
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
PASSWORD_HASH_ITERATIONS = 600_000
_DUMMY_PASSWORD_HASH = (
    "pbkdf2_sha256$600000$AAAAAAAAAAAAAAAAAAAAAA=="
    "$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
)


class AuthStoreError(RuntimeError):
    pass


class AccountExistsError(AuthStoreError):
    pass


class AccountBlockedError(AuthStoreError):
    pass


class AccountNotFoundError(AuthStoreError):
    pass


class AccountManagementConflictError(AuthStoreError):
    pass


def hash_password(password):
    if (
        not isinstance(password, str)
        or not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH
    ):
        raise ValueError("يجب أن تكون كلمة المرور بين 8 و128 حرفًا.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS
    )
    return "pbkdf2_sha256$%d$%s$%s" % (
        PASSWORD_HASH_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password, encoded_hash):
    if not isinstance(password, str) or not isinstance(encoded_hash, str):
        return False
    try:
        algorithm, rounds, salt, expected = encoded_hash.split("$", 3)
        iterations = int(rounds)
        salt_bytes = base64.b64decode(salt, altchars=b"-_", validate=True)
        expected_bytes = base64.b64decode(expected, altchars=b"-_", validate=True)
    except (ValueError, binascii.Error):
        return False
    if (
        algorithm != "pbkdf2_sha256"
        or not 100_000 <= iterations <= 1_000_000
        or len(salt_bytes) != 16
        or len(expected_bytes) != 32
        or len(password) > PASSWORD_MAX_LENGTH
    ):
        return False
    actual = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt_bytes, iterations
    )
    return hmac.compare_digest(actual, expected_bytes)


def verify_firebase_credential(credential, project_id):
    """Verify a Firebase ID token issued after Google sign-in."""
    from google.auth.exceptions import GoogleAuthError
    from google.auth.transport.requests import Request
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_firebase_token(
            credential,
            Request(),
            audience=project_id,
        )
    except (GoogleAuthError, ValueError) as error:
        raise ValueError("تعذّر التحقق من حساب Google؛ حاول تسجيل الدخول مجددًا.") from error

    firebase_claims = claims.get("firebase")
    if (
        not isinstance(firebase_claims, dict)
        or firebase_claims.get("sign_in_provider") != "google.com"
    ):
        raise ValueError("يجب تسجيل الدخول باستخدام Google.")
    if claims.get("email_verified") is not True:
        raise ValueError("يجب استخدام حساب Google موثّق البريد الإلكتروني.")
    subject = claims.get("sub")
    email = claims.get("email")
    full_name = claims.get("name") or email
    if (
        not isinstance(subject, str)
        or not subject
        or not isinstance(email, str)
        or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
        or not isinstance(full_name, str)
        or not full_name.strip()
    ):
        raise ValueError("بيانات حساب Google غير مكتملة.")
    return {
        "firebase_uid": subject,
        "email": email.strip().lower(),
        "full_name": full_name.strip()[:120],
    }


class PostgresAuthStore:
    def __init__(self, database_url):
        try:
            import psycopg
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool
        except ImportError as error:
            raise RuntimeError("Google account storage requires psycopg.") from error
        self._psycopg = psycopg
        self._dict_row = dict_row
        self._database_url = database_url.replace("postgres://", "postgresql://", 1)
        self._session_cache = {}
        self._session_cache_lock = threading.Lock()
        try:
            self._pool = ConnectionPool(
                conninfo=self._database_url,
                min_size=1,
                max_size=12,
                kwargs={
                    "connect_timeout": 10,
                    "row_factory": dict_row,
                },
                open=False,
            )
        except TypeError:
            self._pool = ConnectionPool(
                self._database_url,
                min_size=1,
                max_size=12,
                kwargs={
                    "connect_timeout": 10,
                    "row_factory": dict_row,
                },
                open=False,
            )

    def _connect(self):
        return self._pool.connection()

    def initialize(self):
        pool = getattr(self, "_pool", None)
        if pool is not None and "unused" not in self._database_url:
            pool.open(wait=True, timeout=10)
        statements = (
            """
            CREATE TABLE IF NOT EXISTS quizora_users (
                id UUID PRIMARY KEY,
                full_name TEXT NOT NULL,
                email TEXT,
                google_sub TEXT,
                firebase_uid TEXT,
                phone_e164 TEXT,
                password_hash TEXT,
                phone_verified BOOLEAN NOT NULL DEFAULT TRUE,
                role TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
                is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            "ALTER TABLE quizora_users ADD COLUMN IF NOT EXISTS email TEXT",
            "ALTER TABLE quizora_users ADD COLUMN IF NOT EXISTS google_sub TEXT",
            "ALTER TABLE quizora_users ADD COLUMN IF NOT EXISTS firebase_uid TEXT",
            "ALTER TABLE quizora_users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE quizora_users ALTER COLUMN phone_e164 DROP NOT NULL",
            "ALTER TABLE quizora_users ALTER COLUMN password_hash DROP NOT NULL",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_users_google_sub
                ON quizora_users (google_sub) WHERE google_sub IS NOT NULL
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_users_firebase_uid
                ON quizora_users (firebase_uid) WHERE firebase_uid IS NOT NULL
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_users_email
                ON quizora_users (lower(email)) WHERE email IS NOT NULL
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_admins (
                user_id UUID PRIMARY KEY
                    REFERENCES quizora_users(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_admins_email
                ON quizora_admins (lower(email))
            """,
            """
            INSERT INTO quizora_admins (user_id, email, password_hash)
            SELECT id, email, password_hash
            FROM quizora_users
            WHERE role = 'admin' AND email IS NOT NULL
                AND password_hash IS NOT NULL
            ON CONFLICT (user_id) DO UPDATE SET
                email = EXCLUDED.email,
                password_hash = EXCLUDED.password_hash,
                updated_at = now()
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_user_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES quizora_users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at TIMESTAMPTZ,
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            "ALTER TABLE quizora_user_sessions ALTER COLUMN expires_at DROP NOT NULL",
            """
            UPDATE quizora_user_sessions SET expires_at = NULL
            WHERE expires_at > now()
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_user_sessions_expiry
                ON quizora_user_sessions (expires_at)
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_auth_rate_limits (
                key_hash TEXT PRIMARY KEY,
                window_started_at TIMESTAMPTZ NOT NULL,
                attempts INTEGER NOT NULL
            )
            """,
        )
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    for statement in statements:
                        cursor.execute(statement)
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not initialize PostgreSQL account storage.") from error

    @staticmethod
    def _rate_key(scope, subject):
        return hashlib.sha256(
            ("%s\x00%s" % (scope, subject)).encode("utf-8")
        ).hexdigest()

    @classmethod
    def _consume_rate_limit(cls, cursor, scope, subject, limit, window_seconds):
        cursor.execute(
            """
            INSERT INTO quizora_auth_rate_limits
                (key_hash, window_started_at, attempts)
            VALUES (%s, now(), 1)
            ON CONFLICT (key_hash) DO UPDATE SET
                window_started_at = CASE
                    WHEN quizora_auth_rate_limits.window_started_at
                         <= now() - (%s * interval '1 second')
                    THEN now()
                    ELSE quizora_auth_rate_limits.window_started_at
                END,
                attempts = CASE
                    WHEN quizora_auth_rate_limits.window_started_at
                         <= now() - (%s * interval '1 second')
                    THEN 1
                    ELSE quizora_auth_rate_limits.attempts + 1
                END
            RETURNING attempts
            """,
            (cls._rate_key(scope, subject), window_seconds, window_seconds),
        )
        return cursor.fetchone()["attempts"] <= limit

    def find_firebase_user(self, identity):
        email = identity["email"].strip().lower()
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id, is_blocked FROM quizora_users
                        WHERE firebase_uid = %s
                        LIMIT 1
                        FOR UPDATE
                        """,
                        (identity["firebase_uid"],),
                    )
                    existing = cursor.fetchone()
                    if not existing:
                        cursor.execute(
                            """
                            SELECT id, is_blocked FROM quizora_users
                            WHERE lower(email) = %s AND google_sub IS NOT NULL
                            LIMIT 1
                            FOR UPDATE
                            """,
                            (email,),
                        )
                        existing = cursor.fetchone()

                    if not existing:
                        return None
                    if existing["is_blocked"]:
                        raise AccountBlockedError("تم حظر هذا الحساب؛ تواصل مع الإدارة.")
                    cursor.execute(
                        """
                        UPDATE quizora_users
                        SET email = %s,
                            firebase_uid = %s,
                            updated_at = now()
                        WHERE id = %s
                        RETURNING id, full_name, email, role
                        """,
                        (email, identity["firebase_uid"], existing["id"]),
                    )
                    return cursor.fetchone()
        except self._psycopg.errors.UniqueViolation as error:
            raise AuthStoreError(
                "هذا البريد مرتبط بحساب آخر؛ تواصل مع المسؤول."
            ) from error
        except AccountBlockedError:
            raise
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not read the Firebase account.") from error

    def create_firebase_user(self, identity, full_name, password_hash):
        email = identity["email"].strip().lower()
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id FROM quizora_users
                        WHERE firebase_uid = %s OR lower(email) = %s
                        LIMIT 1
                        FOR UPDATE
                        """,
                        (identity["firebase_uid"], email),
                    )
                    if cursor.fetchone():
                        raise AccountExistsError(
                            "هذا الحساب مسجل بالفعل؛ سجّل الدخول بدلًا من إنشاء حساب جديد."
                        )
                    cursor.execute(
                        """
                        INSERT INTO quizora_users
                            (id, full_name, email, firebase_uid, password_hash,
                             phone_verified, role)
                        VALUES (%s, %s, %s, %s, %s, TRUE, 'user')
                        RETURNING id, full_name, email, role
                        """,
                        (
                            uuid.uuid4(),
                            full_name.strip()[:120],
                            email,
                            identity["firebase_uid"],
                            password_hash,
                        ),
                    )
                    return cursor.fetchone()
        except AccountExistsError:
            raise
        except self._psycopg.errors.UniqueViolation as error:
            raise AccountExistsError(
                "هذا الحساب مسجل بالفعل؛ سجّل الدخول بدلًا من إنشاء حساب جديد."
            ) from error
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not create the Firebase account.") from error

    def provision_admin(self, email, full_name, password_hash):
        normalized_email = str(email or "").strip().lower()
        normalized_name = str(full_name or "").strip()[:120]
        if (
            not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized_email)
            or not normalized_name
            or not isinstance(password_hash, str)
            or not password_hash.startswith("pbkdf2_sha256$")
        ):
            raise ValueError("بيانات حساب المدير غير صالحة.")
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id FROM quizora_users
                        WHERE lower(email) = %s
                        LIMIT 1
                        FOR UPDATE
                        """,
                        (normalized_email,),
                    )
                    existing = cursor.fetchone()
                    if existing:
                        user_id = existing["id"]
                        cursor.execute(
                            """
                            UPDATE quizora_users
                            SET full_name = %s, password_hash = NULL, role = 'admin',
                                is_blocked = FALSE, updated_at = now()
                            WHERE id = %s
                            """,
                            (normalized_name, user_id),
                        )
                    else:
                        user_id = uuid.uuid4()
                        cursor.execute(
                            """
                            INSERT INTO quizora_users
                                (id, full_name, email, password_hash, role)
                            VALUES (%s, %s, %s, NULL, 'admin')
                            """,
                            (user_id, normalized_name, normalized_email),
                        )
                    cursor.execute(
                        """
                        INSERT INTO quizora_admins (user_id, email, password_hash)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (user_id) DO UPDATE SET
                            email = EXCLUDED.email,
                            password_hash = EXCLUDED.password_hash,
                            updated_at = now()
                        """,
                        (user_id, normalized_email, password_hash),
                    )
                    cursor.execute(
                        "DELETE FROM quizora_user_sessions WHERE user_id = %s",
                        (user_id,),
                    )
                    return str(user_id)
        except self._psycopg.errors.UniqueViolation as error:
            raise AuthStoreError(
                "هذا البريد مرتبط بحساب آخر؛ تعذّر إعداد حساب المدير."
            ) from error
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not provision the administrator account.") from error

    def allow_password_login(self, email, ip_address):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    email_allowed = self._consume_rate_limit(
                        cursor, "password-email", email, 8, 900
                    )
                    ip_allowed = self._consume_rate_limit(
                        cursor, "password-ip", ip_address, 30, 900
                    )
                    return email_allowed and ip_allowed
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not rate-limit password login.") from error

    def authenticate_password(self, email, password):
        normalized_email = email.strip().lower()
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT u.id, u.full_name, u.email, u.role,
                               COALESCE(a.password_hash, u.password_hash)
                                   AS password_hash,
                               u.is_blocked
                        FROM quizora_users AS u
                        LEFT JOIN quizora_admins AS a
                            ON a.user_id = u.id AND u.role = 'admin'
                        WHERE lower(u.email) = %s
                            AND COALESCE(a.password_hash, u.password_hash)
                                IS NOT NULL
                        LIMIT 1
                        """,
                        (normalized_email,),
                    )
                    user = cursor.fetchone()
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not read the password account.") from error

        encoded_hash = user["password_hash"] if user else _DUMMY_PASSWORD_HASH
        if not verify_password(password, encoded_hash) or not user:
            return None
        if user["is_blocked"]:
            raise AccountBlockedError("تم حظر هذا الحساب؛ تواصل مع الإدارة.")
        return {
            "id": user["id"],
            "full_name": user["full_name"],
            "email": user["email"],
            "role": user["role"],
        }

    def list_users(self, search="", status="all", limit=50, offset=0):
        limit = min(max(int(limit), 1), 100)
        offset = max(int(offset), 0)
        clauses = []
        params = []
        if search:
            clauses.append(
                "(full_name ILIKE %s OR COALESCE(email, '') ILIKE %s)"
            )
            pattern = "%" + search + "%"
            params.extend((pattern, pattern))
        if status == "active":
            clauses.append("is_blocked = FALSE")
        elif status == "blocked":
            clauses.append("is_blocked = TRUE")
        where_sql = " WHERE " + " AND ".join(clauses) if clauses else ""
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT COUNT(*) AS total FROM quizora_users" + where_sql,
                        tuple(params),
                    )
                    filtered_total = cursor.fetchone()["total"]
                    cursor.execute(
                        """
                        SELECT COUNT(*) AS total,
                               COUNT(*) FILTER (WHERE is_blocked = FALSE) AS active,
                               COUNT(*) FILTER (WHERE is_blocked = TRUE) AS blocked
                        FROM quizora_users
                        """
                    )
                    counts = cursor.fetchone()
                    cursor.execute(
                        """
                        SELECT id::text AS id, full_name, email, role, is_blocked,
                               created_at::text AS created_at
                        FROM quizora_users
                        """
                        + where_sql
                        + " ORDER BY created_at DESC, id LIMIT %s OFFSET %s",
                        tuple(params) + (limit, offset),
                    )
                    users = cursor.fetchall()
            return {
                "users": users,
                "total": filtered_total,
                "total_users": counts["total"],
                "active_users": counts["active"],
                "blocked_users": counts["blocked"],
                "limit": limit,
                "offset": offset,
            }
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not list account users.") from error

    def _managed_user(self, cursor, user_id, actor_id):
        cursor.execute(
            "SELECT id, role FROM quizora_users WHERE id = %s FOR UPDATE",
            (user_id,),
        )
        user = cursor.fetchone()
        if not user:
            raise AccountNotFoundError("المستخدم غير موجود.")
        if str(user["id"]) == str(actor_id) or user["role"] == "admin":
            raise AccountManagementConflictError(
                "لا يمكن حذف حساب مدير أو تعديل حالته."
            )
        return user

    def set_user_blocked(self, user_id, blocked, actor_id):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    user = self._managed_user(cursor, user_id, actor_id)
                    cursor.execute(
                        """
                        UPDATE quizora_users
                        SET is_blocked = %s, updated_at = now()
                        WHERE id = %s
                        RETURNING id::text AS id, full_name, email, role,
                                  is_blocked, created_at::text AS created_at
                        """,
                        (blocked, user["id"]),
                    )
                    updated = cursor.fetchone()
                    if blocked:
                        cursor.execute(
                            "DELETE FROM quizora_user_sessions WHERE user_id = %s",
                            (user["id"],),
                        )
                    return updated
        except (AccountNotFoundError, AccountManagementConflictError):
            raise
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not update the account status.") from error

    def delete_user(self, user_id, actor_id):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    user = self._managed_user(cursor, user_id, actor_id)
                    cursor.execute(
                        "DELETE FROM quizora_users WHERE id = %s",
                        (user["id"],),
                    )
            return True
        except (AccountNotFoundError, AccountManagementConflictError):
            raise
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not delete the account.") from error

    def allow_login(self, subject, ip_address):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    subject_allowed = self._consume_rate_limit(
                        cursor, "google-subject", subject, 30, 900
                    )
                    ip_allowed = self._consume_rate_limit(
                        cursor, "google-ip", ip_address, 60, 900
                    )
                    return subject_allowed and ip_allowed
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not rate-limit account login.") from error

    def create_session(self, user_id):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO quizora_user_sessions
                            (token_hash, user_id, expires_at)
                        VALUES (%s, %s, NULL)
                        """,
                        (token_hash, user_id),
                    )
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not create an account session.") from error
        return token

    def get_session_user(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return None
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        now = time.monotonic()
        cache_lock = getattr(self, "_session_cache_lock", None)
        cache = getattr(self, "_session_cache", None)
        if cache_lock is not None:
            with cache_lock:
                cached = cache.get(token_hash)
                if cached:
                    expires_at, user = cached
                    if expires_at > now:
                        return user
                    cache.pop(token_hash, None)
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT account.id, account.full_name, account.email, account.role
                        FROM quizora_user_sessions AS session
                        JOIN quizora_users AS account ON account.id = session.user_id
                        WHERE session.token_hash = %s
                          AND (session.expires_at IS NULL OR session.expires_at > now())
                          AND account.is_blocked = FALSE
                        """,
                        (token_hash,),
                    )
                    user = cursor.fetchone()
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not read the account session.") from error
        if cache_lock is not None:
            with cache_lock:
                cache[token_hash] = (now + 300, user)
        return user

    def revoke_session(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        with self._session_cache_lock:
            self._session_cache.pop(token_hash, None)
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "DELETE FROM quizora_user_sessions WHERE token_hash = %s",
                        (token_hash,),
                    )
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not end the account session.") from error

    def cleanup_expired(self):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        DELETE FROM quizora_user_sessions
                        WHERE expires_at IS NOT NULL AND expires_at <= now()
                        """
                    )
                    cursor.execute(
                        """
                        DELETE FROM quizora_auth_rate_limits
                        WHERE window_started_at < now() - interval '2 days'
                        """
                    )
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not prune expired account data.") from error
