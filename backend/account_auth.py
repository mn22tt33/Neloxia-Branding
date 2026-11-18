"""Google sign-in and PostgreSQL account sessions."""

import hashlib
import re
import secrets
import uuid


SESSION_TTL_SECONDS = 60 * 60 * 24 * 30


class AuthStoreError(RuntimeError):
    pass


def verify_google_credential(credential, client_id, nonce):
    """Verify Google's signed ID token and bind it to this login attempt."""
    from google.auth.exceptions import GoogleAuthError
    from google.auth.transport.requests import Request
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(
            credential,
            Request(),
            audience=client_id,
        )
    except (GoogleAuthError, ValueError) as error:
        raise ValueError("تعذّر التحقق من حساب Google؛ حاول تسجيل الدخول مجددًا.") from error

    issuer = claims.get("iss")
    if issuer not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("مصدر بيانات حساب Google غير صالح.")
    if claims.get("email_verified") is not True:
        raise ValueError("يجب استخدام حساب Google موثّق البريد الإلكتروني.")
    subject = claims.get("sub")
    email = claims.get("email")
    full_name = claims.get("name") or email
    token_nonce = claims.get("nonce")
    if (
        not isinstance(subject, str)
        or not subject
        or not isinstance(email, str)
        or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
        or not isinstance(full_name, str)
        or not full_name.strip()
        or not isinstance(token_nonce, str)
        or not secrets.compare_digest(token_nonce, nonce)
    ):
        raise ValueError("بيانات حساب Google غير مكتملة أو غير مطابقة لطلب الدخول.")
    return {
        "google_sub": subject,
        "email": email.strip().lower(),
        "full_name": full_name.strip()[:120],
    }


class PostgresAuthStore:
    def __init__(self, database_url):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as error:
            raise RuntimeError("Google account storage requires psycopg.") from error
        self._psycopg = psycopg
        self._dict_row = dict_row
        self._database_url = database_url.replace("postgres://", "postgresql://", 1)

    def _connect(self):
        return self._psycopg.connect(
            self._database_url,
            connect_timeout=10,
            row_factory=self._dict_row,
        )

    def initialize(self):
        statements = (
            """
            CREATE TABLE IF NOT EXISTS quizora_users (
                id UUID PRIMARY KEY,
                full_name TEXT NOT NULL,
                email TEXT,
                google_sub TEXT,
                phone_e164 TEXT,
                password_hash TEXT,
                phone_verified BOOLEAN NOT NULL DEFAULT TRUE,
                role TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            "ALTER TABLE quizora_users ADD COLUMN IF NOT EXISTS email TEXT",
            "ALTER TABLE quizora_users ADD COLUMN IF NOT EXISTS google_sub TEXT",
            "ALTER TABLE quizora_users ALTER COLUMN phone_e164 DROP NOT NULL",
            "ALTER TABLE quizora_users ALTER COLUMN password_hash DROP NOT NULL",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_users_google_sub
                ON quizora_users (google_sub) WHERE google_sub IS NOT NULL
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_users_email
                ON quizora_users (lower(email)) WHERE email IS NOT NULL
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_user_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES quizora_users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at TIMESTAMPTZ NOT NULL,
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
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

    def upsert_google_user(self, identity, admin_email=None):
        email = identity["email"].strip().lower()
        role = "admin" if admin_email and email == admin_email.strip().lower() else "user"
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO quizora_users
                            (id, full_name, email, google_sub, phone_verified, role)
                        VALUES (%s, %s, %s, %s, TRUE, %s)
                        ON CONFLICT (google_sub) DO UPDATE SET
                            full_name = EXCLUDED.full_name,
                            email = EXCLUDED.email,
                            phone_verified = TRUE,
                            role = CASE WHEN EXCLUDED.role = 'admin'
                                        THEN 'admin'
                                        ELSE quizora_users.role END,
                            updated_at = now()
                        RETURNING id, full_name, email, role
                        """,
                        (
                            uuid.uuid4(),
                            identity["full_name"][:120],
                            email,
                            identity["google_sub"],
                            role,
                        ),
                    )
                    return cursor.fetchone()
        except self._psycopg.errors.UniqueViolation as error:
            raise AuthStoreError(
                "هذا البريد مرتبط بحساب آخر؛ تواصل مع المسؤول."
            ) from error
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not save the Google account.") from error

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
                        VALUES (%s, %s, now() + (%s * interval '1 second'))
                        """,
                        (token_hash, user_id, SESSION_TTL_SECONDS),
                    )
            return token
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not create an account session.") from error

    def get_session_user(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return None
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT user.id, user.full_name, user.email, user.role
                        FROM quizora_user_sessions AS session
                        JOIN quizora_users AS user ON user.id = session.user_id
                        WHERE session.token_hash = %s AND session.expires_at > now()
                        """,
                        (token_hash,),
                    )
                    return cursor.fetchone()
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not read the account session.") from error

    def revoke_session(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
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
                        "DELETE FROM quizora_user_sessions WHERE expires_at <= now()"
                    )
                    cursor.execute(
                        """
                        DELETE FROM quizora_auth_rate_limits
                        WHERE window_started_at < now() - interval '2 days'
                        """
                    )
        except self._psycopg.Error as error:
            raise AuthStoreError("Could not prune expired account data.") from error
