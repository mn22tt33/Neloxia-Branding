"""PostgreSQL-backed queue and task status storage."""

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid


WORKER_LOCK_ID = 731904221
SUBMISSION_LOCK_ID = 731904222
SOLVED_HISTORY_MIGRATION_LOCK_ID = 731904223
TERMINAL_STATUSES = ("succeeded", "failed", "cancelled")
ACTIVE_STATUSES = ("queued", "running")
SUBSCRIPTION_PLANS = {
    "basic": {"key": "basic", "name": "العادية", "price_egp": 25, "solves": 1},
    "premium": {"key": "premium", "name": "المميزة", "price_egp": 50, "solves": 3},
    "professional": {
        "key": "professional",
        "name": "الاحترافية",
        "price_egp": 120,
        "solves": 8,
    },
}


class QueueStoreError(RuntimeError):
    pass


class QueueCapacityError(QueueStoreError):
    pass


class SubscriptionError(QueueStoreError):
    def __init__(self, message, status_code=409):
        super().__init__(message)
        self.status_code = status_code


class PostgresQueue:
    def __init__(self, database_url, encryption_key):
        try:
            import psycopg
            from cryptography.fernet import Fernet, InvalidToken
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool
        except ImportError as error:
            raise RuntimeError(
                "PostgreSQL mode requires psycopg[binary] and cryptography."
            ) from error

        key = encryption_key.encode("ascii")
        if len(key) == 43:
            key += b"="
        try:
            self._fernet = Fernet(key)
            raw_key = base64.urlsafe_b64decode(key)
        except (ValueError, UnicodeEncodeError) as error:
            raise RuntimeError(
                "APP_ENCRYPTION_KEY must be a valid Fernet key."
            ) from error

        self._psycopg = psycopg
        self._dict_row = dict_row
        self._invalid_token = InvalidToken
        self._database_url = database_url.replace("postgres://", "postgresql://", 1)
        try:
            self._pool = ConnectionPool(
                conninfo=self._database_url,
                min_size=2,
                max_size=20,
                kwargs={
                    "connect_timeout": 10,
                    "row_factory": dict_row,
                },
                open=False,
            )
        except TypeError:
            self._pool = ConnectionPool(
                self._database_url,
                min_size=2,
                max_size=20,
                kwargs={
                    "connect_timeout": 10,
                    "row_factory": dict_row,
                },
                open=False,
            )
        self._fingerprint_key = hashlib.sha256(
            b"QUIZORA account fingerprint\x00" + raw_key
        ).digest()

    def _connect(self, **kwargs):
        if kwargs:
            return self._psycopg.connect(
                self._database_url,
                connect_timeout=10,
                row_factory=self._dict_row,
                **kwargs,
            )
        return self._pool.connection()

    def initialize(self):
        pool = getattr(self, "_pool", None)
        if pool is not None and "unused" not in self._database_url:
            pool.open(wait=True, timeout=10)
        statements = (
            """
            CREATE TABLE IF NOT EXISTS quizora_operations (
                id UUID PRIMARY KEY,
                client_id UUID,
                owner_key TEXT,
                owner_user_id UUID REFERENCES quizora_users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                status TEXT NOT NULL,
                total_jobs INTEGER NOT NULL DEFAULT 0
            )
            """,
            """
            ALTER TABLE quizora_operations
                ADD COLUMN IF NOT EXISTS client_id UUID
            """,
            """
            ALTER TABLE quizora_operations
                ADD COLUMN IF NOT EXISTS owner_key TEXT
            """,
            """
            ALTER TABLE quizora_operations
                ADD COLUMN IF NOT EXISTS owner_user_id UUID
                    REFERENCES quizora_users(id) ON DELETE SET NULL
            """,
            """
            ALTER TABLE quizora_operations
                ADD COLUMN IF NOT EXISTS owner_name_ciphertext TEXT
            """,
            """
            ALTER TABLE quizora_operations
                ADD COLUMN IF NOT EXISTS owner_email_ciphertext TEXT
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_jobs (
                id UUID PRIMARY KEY,
                queue_order BIGSERIAL NOT NULL,
                operation_id UUID NOT NULL REFERENCES quizora_operations(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                code_ciphertext TEXT NOT NULL,
                code_fingerprint TEXT NOT NULL,
                password_ciphertext TEXT,
                mode TEXT NOT NULL,
                detail TEXT NOT NULL,
                options JSONB NOT NULL DEFAULT '{}'::jsonb,
                status TEXT NOT NULL,
                phase TEXT NOT NULL,
                progress JSONB NOT NULL DEFAULT
                    '{"done":0,"total":0,"pct":0,"title":""}'::jsonb,
                success BOOLEAN,
                message TEXT NOT NULL DEFAULT '',
                cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
                archived BOOLEAN NOT NULL DEFAULT FALSE,
                worker_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                started_at TIMESTAMPTZ,
                finished_at TIMESTAMPTZ
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_solved_accounts (
                job_id UUID PRIMARY KEY,
                code_ciphertext TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT '',
                detail TEXT NOT NULL DEFAULT '',
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                user_name_ciphertext TEXT,
                user_email_ciphertext TEXT,
                solved_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            """
            ALTER TABLE quizora_solved_accounts
                ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT ''
            """,
            """
            ALTER TABLE quizora_solved_accounts
                ADD COLUMN IF NOT EXISTS detail TEXT NOT NULL DEFAULT ''
            """,
            """
            ALTER TABLE quizora_solved_accounts
                ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0
            """,
            """
            ALTER TABLE quizora_solved_accounts
                ADD COLUMN IF NOT EXISTS user_name_ciphertext TEXT
            """,
            """
            ALTER TABLE quizora_solved_accounts
                ADD COLUMN IF NOT EXISTS user_email_ciphertext TEXT
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_metadata (
                key TEXT PRIMARY KEY,
                value INTEGER NOT NULL
            )
            """,
            """
            ALTER TABLE quizora_jobs
                ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE
            """,
            """
            ALTER TABLE quizora_jobs
                ADD COLUMN IF NOT EXISTS queue_order BIGSERIAL
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_jobs_queue_sequence
                ON quizora_jobs (queue_order)
            """,
            """
            ALTER TABLE quizora_jobs
                ALTER COLUMN password_ciphertext DROP NOT NULL
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_job_logs (
                id BIGSERIAL PRIMARY KEY,
                job_id UUID NOT NULL REFERENCES quizora_jobs(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                level TEXT NOT NULL,
                message TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_subscription_codes (
                id UUID PRIMARY KEY,
                code_hash TEXT NOT NULL UNIQUE,
                plan_key TEXT NOT NULL
                    CHECK (plan_key IN ('basic', 'premium', 'professional')),
                created_by_user_id UUID REFERENCES quizora_users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                redeemed_by_user_id UUID REFERENCES quizora_users(id) ON DELETE SET NULL,
                redeemed_at TIMESTAMPTZ
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_user_subscriptions (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES quizora_users(id) ON DELETE CASCADE,
                code_id UUID NOT NULL UNIQUE
                    REFERENCES quizora_subscription_codes(id) ON DELETE RESTRICT,
                plan_key TEXT NOT NULL
                    CHECK (plan_key IN ('basic', 'premium', 'professional')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_subscription_uses (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES quizora_users(id) ON DELETE CASCADE,
                subscription_id UUID
                    REFERENCES quizora_user_subscriptions(id) ON DELETE CASCADE,
                code_fingerprint TEXT NOT NULL,
                operation_id UUID NOT NULL
                    REFERENCES quizora_operations(id) ON DELETE CASCADE,
                status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                consumed_at TIMESTAMPTZ,
                UNIQUE (user_id, code_fingerprint)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_subscription_trials (
                user_id UUID PRIMARY KEY
                    REFERENCES quizora_users(id) ON DELETE CASCADE,
                status TEXT NOT NULL
                    CHECK (status IN ('reserved', 'consumed', 'waived')),
                code_fingerprint TEXT,
                operation_id UUID REFERENCES quizora_operations(id) ON DELETE SET NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS quizora_subscription_backfills (
                user_id UUID PRIMARY KEY
                    REFERENCES quizora_users(id) ON DELETE CASCADE,
                completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_jobs_queue_order
                ON quizora_jobs (queue_order) WHERE status = 'queued'
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_jobs_operation
                ON quizora_jobs (operation_id, position)
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_operations_client
                ON quizora_operations (client_id)
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_operations_owner
                ON quizora_operations (owner_key)
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_jobs_account_fingerprint
                ON quizora_jobs (code_fingerprint, mode)
                WHERE status IN ('queued', 'running')
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_job_logs_recent
                ON quizora_job_logs (job_id, id DESC)
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_subscription_codes_recent
                ON quizora_subscription_codes (created_at DESC)
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_user_subscriptions_recent
                ON quizora_user_subscriptions (user_id, created_at DESC)
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_subscription_uses_operation
                ON quizora_subscription_uses (operation_id, code_fingerprint)
            """,
        )
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    for statement in statements:
                        cursor.execute(statement)
                    cursor.execute(
                        "SELECT pg_advisory_xact_lock(%s)",
                        (SOLVED_HISTORY_MIGRATION_LOCK_ID,),
                    )
                    cursor.execute(
                        "SELECT value FROM quizora_metadata WHERE key = %s",
                        ("solved_history_version",),
                    )
                    history_version = cursor.fetchone()
                    if history_version is None:
                        cursor.execute("DELETE FROM quizora_solved_accounts")
                        cursor.execute(
                            """
                            INSERT INTO quizora_metadata (key, value)
                            VALUES (%s, 1)
                            """,
                            ("solved_history_version",),
                        )
                    elif history_version["value"] > 1:
                        raise QueueStoreError(
                            "The solved-history schema is newer than this server."
                        )
                    cursor.execute(
                        """
                        SELECT code_ciphertext, password_ciphertext
                        FROM quizora_jobs
                        WHERE code_ciphertext IS NOT NULL
                           OR password_ciphertext IS NOT NULL
                        LIMIT 1
                        """
                    )
                    encrypted_values = cursor.fetchone()
                    if encrypted_values:
                        self._decrypt(encrypted_values["code_ciphertext"])
                        if encrypted_values["password_ciphertext"]:
                            self._decrypt(encrypted_values["password_ciphertext"])
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not initialize the PostgreSQL queue.") from error

    @staticmethod
    def subscription_plans():
        return [dict(plan) for plan in SUBSCRIPTION_PLANS.values()]

    def create_subscription_code(self, plan_key, admin_user_id):
        plan = SUBSCRIPTION_PLANS.get(plan_key)
        if not plan:
            raise SubscriptionError("اختر خطة اشتراك صحيحة.", 400)
        admin_uuid = self._as_uuid(admin_user_id)
        code = "QZ-" + "-".join(
            secrets.token_hex(4).upper() for _ in range(3)
        )
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO quizora_subscription_codes
                            (id, code_hash, plan_key, created_by_user_id)
                        VALUES (%s, %s, %s, %s)
                        RETURNING id, created_at
                        """,
                        (
                            uuid.uuid4(),
                            self._subscription_code_hash(code),
                            plan_key,
                            admin_uuid,
                        ),
                    )
                    row = cursor.fetchone()
            return {
                "code": code,
                "plan": dict(plan),
                "created_at": row["created_at"].isoformat(),
            }
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not create a subscription code.") from error

    def list_subscription_codes(self, limit=50):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT code.plan_key, code.created_at,
                               code.redeemed_at,
                               code.redeemed_by_user_id::text AS redeemed_by
                        FROM quizora_subscription_codes AS code
                        ORDER BY code.created_at DESC
                        LIMIT %s
                        """,
                        (max(1, min(int(limit), 100)),),
                    )
                    rows = cursor.fetchall()
            return [
                {
                    "plan_key": row["plan_key"],
                    "plan_name": SUBSCRIPTION_PLANS[row["plan_key"]]["name"],
                    "status": "redeemed" if row["redeemed_at"] else "available",
                    "created_at": row["created_at"].isoformat(),
                    "redeemed_at": (
                        row["redeemed_at"].isoformat() if row["redeemed_at"] else None
                    ),
                    "redeemed_by": row["redeemed_by"],
                }
                for row in rows
            ]
        except (self._psycopg.Error, ValueError, TypeError) as error:
            raise QueueStoreError("Could not read subscription codes.") from error

    def subscription_status(self, user_id, owner_key):
        try:
            user_uuid = self._as_uuid(user_id)
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    self._backfill_legacy_subscription_usage(
                        cursor, user_uuid, owner_key
                    )
                    return self._subscription_status_payload(cursor, user_uuid)
        except SubscriptionError:
            raise
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not read the user's subscription.") from error

    def redeem_subscription_code(self, user_id, owner_key, plan_key, code):
        plan = SUBSCRIPTION_PLANS.get(plan_key)
        if not plan:
            raise SubscriptionError("اختر خطة اشتراك صحيحة.", 400)
        user_uuid = self._as_uuid(user_id)
        code_hash = self._subscription_code_hash(code)
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT pg_advisory_xact_lock(%s)", (SUBMISSION_LOCK_ID,)
                    )
                    self._backfill_legacy_subscription_usage(
                        cursor, user_uuid, owner_key
                    )
                    cursor.execute(
                        """
                        SELECT id, plan_key, redeemed_at
                        FROM quizora_subscription_codes
                        WHERE code_hash = %s
                        FOR UPDATE
                        """,
                        (code_hash,),
                    )
                    code_row = cursor.fetchone()
                    if not code_row:
                        raise SubscriptionError("كود الاشتراك غير صحيح.", 400)
                    if code_row["redeemed_at"]:
                        raise SubscriptionError("تم استخدام كود الاشتراك من قبل.")
                    if code_row["plan_key"] != plan_key:
                        correct_plan = SUBSCRIPTION_PLANS[code_row["plan_key"]]["name"]
                        raise SubscriptionError(
                            "هذا الكود مخصص لخطة %s؛ اخترها ثم أدخل الكود." % correct_plan,
                            409,
                        )

                    current, _ = self._subscription_records(cursor, user_uuid)
                    if current:
                        raise SubscriptionError(
                            "لديك رصيد في خطتك الحالية. استخدمه قبل تفعيل كود جديد."
                        )
                    cursor.execute(
                        """
                        SELECT status FROM quizora_subscription_trials
                        WHERE user_id = %s
                        FOR UPDATE
                        """,
                        (user_uuid,),
                    )
                    trial = cursor.fetchone()
                    if trial and trial["status"] == "reserved":
                        raise SubscriptionError(
                            "انتظر حتى تنتهي تجربة الحل الحالية قبل تفعيل الاشتراك."
                        )

                    subscription_id = uuid.uuid4()
                    cursor.execute(
                        """
                        UPDATE quizora_subscription_codes
                        SET redeemed_by_user_id = %s, redeemed_at = now()
                        WHERE id = %s AND redeemed_at IS NULL
                        """,
                        (user_uuid, code_row["id"]),
                    )
                    cursor.execute(
                        """
                        INSERT INTO quizora_user_subscriptions
                            (id, user_id, code_id, plan_key)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (subscription_id, user_uuid, code_row["id"], plan_key),
                    )
                    if not trial:
                        cursor.execute(
                            """
                            INSERT INTO quizora_subscription_trials
                                (user_id, status)
                            VALUES (%s, 'waived')
                            ON CONFLICT (user_id) DO NOTHING
                            """,
                            (user_uuid,),
                        )
                    return self._subscription_status_payload(cursor, user_uuid)
        except SubscriptionError:
            raise
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not redeem the subscription code.") from error

    def _subscription_code_hash(self, code):
        normalized = re.sub(r"[\s-]", "", str(code or "")).upper()
        if not re.fullmatch(r"QZ[0-9A-F]{24}", normalized):
            raise SubscriptionError("تحقق من كتابة كود الاشتراك.", 400)
        return hmac.new(
            self._fingerprint_key,
            b"QUIZORA subscription code\x00" + normalized.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()

    def _backfill_legacy_subscription_usage(self, cursor, user_uuid, owner_key):
        cursor.execute(
            """
            INSERT INTO quizora_subscription_backfills (user_id)
            VALUES (%s)
            ON CONFLICT (user_id) DO NOTHING
            RETURNING user_id
            """,
            (user_uuid,),
        )
        if not cursor.fetchone():
            return
        cursor.execute(
            """
            SELECT DISTINCT ON (job.code_fingerprint)
                   job.code_fingerprint, job.operation_id
            FROM quizora_jobs AS job
            JOIN quizora_operations AS operation
              ON operation.id = job.operation_id
            WHERE operation.owner_key = %s
              AND job.status = 'succeeded' AND job.success = TRUE
            ORDER BY job.code_fingerprint, job.finished_at
            """,
            (owner_key,),
        )
        legacy_uses = cursor.fetchall()
        for use in legacy_uses:
            cursor.execute(
                """
                INSERT INTO quizora_subscription_uses
                    (id, user_id, subscription_id, code_fingerprint,
                     operation_id, status, consumed_at)
                VALUES (%s, %s, NULL, %s, %s, 'consumed', now())
                ON CONFLICT (user_id, code_fingerprint) DO NOTHING
                """,
                (
                    uuid.uuid4(),
                    user_uuid,
                    use["code_fingerprint"],
                    use["operation_id"],
                ),
            )
        if legacy_uses:
            cursor.execute(
                """
                INSERT INTO quizora_subscription_trials (user_id, status)
                VALUES (%s, 'consumed')
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_uuid,),
            )

    def _subscription_records(self, cursor, user_uuid):
        cursor.execute(
            """
            SELECT subscription.id::text AS id, subscription.plan_key,
                   subscription.created_at,
                   count(usage.id) FILTER (
                       WHERE usage.status = 'consumed'
                   ) AS consumed,
                   count(usage.id) FILTER (
                       WHERE usage.status = 'reserved'
                   ) AS reserved
            FROM quizora_user_subscriptions AS subscription
            LEFT JOIN quizora_subscription_uses AS usage
              ON usage.subscription_id = subscription.id
            WHERE subscription.user_id = %s
            GROUP BY subscription.id
            ORDER BY subscription.created_at DESC
            """,
            (user_uuid,),
        )
        rows = cursor.fetchall()
        active = None
        latest = None
        for row in rows:
            plan = SUBSCRIPTION_PLANS.get(row["plan_key"])
            if not plan:
                raise QueueStoreError("A stored subscription has an unknown plan.")
            consumed = int(row["consumed"] or 0)
            reserved = int(row["reserved"] or 0)
            remaining = max(0, plan["solves"] - consumed - reserved)
            record = {
                "id": row["id"],
                "plan_key": plan["key"],
                "plan_name": plan["name"],
                "price_egp": plan["price_egp"],
                "solves": plan["solves"],
                "used": consumed,
                "reserved": reserved,
                "remaining": remaining,
                "status": (
                    "processing" if remaining == 0 and reserved
                    else "active" if remaining
                    else "exhausted"
                ),
                "created_at": row["created_at"].isoformat(),
            }
            if latest is None:
                latest = record
            if active is None and (remaining or reserved):
                active = record
        return active, latest

    def _subscription_status_payload(self, cursor, user_uuid):
        active, latest = self._subscription_records(cursor, user_uuid)
        cursor.execute(
            """
            SELECT status FROM quizora_subscription_trials WHERE user_id = %s
            """,
            (user_uuid,),
        )
        trial_row = cursor.fetchone()
        if trial_row:
            trial_status = trial_row["status"]
        elif latest:
            trial_status = "waived"
        else:
            trial_status = "available"
        trial_available = trial_status == "available"
        available_solves = (
            active["remaining"] if active else (1 if trial_available else 0)
        )
        return {
            "plans": self.subscription_plans(),
            "trial": {
                "status": trial_status,
                "available": trial_available,
            },
            "subscription": active or latest,
            "available_solves": available_solves,
            "can_solve": available_solves > 0,
            "can_subscribe": active is None and trial_status != "reserved",
        }

    def _authorize_subscription_accounts(
        self, cursor, user_uuid, owner_key, code_fingerprints
    ):
        self._backfill_legacy_subscription_usage(cursor, user_uuid, owner_key)
        cursor.execute(
            """
            SELECT code_fingerprint, status
            FROM quizora_subscription_uses
            WHERE user_id = %s AND code_fingerprint = ANY(%s)
            """,
            (user_uuid, code_fingerprints),
        )
        existing = cursor.fetchall()
        if existing:
            if any(row["status"] == "reserved" for row in existing):
                raise SubscriptionError(
                    "يوجد طلب قيد التنفيذ لهذا الكود؛ انتظر حتى ينتهي."
                )
            raise SubscriptionError(
                "تم حل هذا الحساب من قبل؛ كل كود حساب يُستخدم مرة واحدة."
            )

        active, _ = self._subscription_records(cursor, user_uuid)
        if active:
            if len(code_fingerprints) > active["remaining"]:
                if active["reserved"]:
                    raise SubscriptionError(
                        "بعض رصيد الخطة قيد التنفيذ؛ انتظر حتى تنتهي العمليات الحالية."
                    )
                raise SubscriptionError(
                    "عدد الأكواد يتجاوز الرصيد المتبقي في خطتك؛ اختر أكوادًا أقل أو اشترك في خطة جديدة.",
                    402,
                )
            return active["id"], False

        cursor.execute(
            """
            SELECT status FROM quizora_subscription_trials WHERE user_id = %s
            """,
            (user_uuid,),
        )
        trial = cursor.fetchone()
        if trial and trial["status"] == "reserved":
            raise SubscriptionError("تجربة الحل قيد التنفيذ؛ انتظر حتى تنتهي.")
        if trial or self._subscription_records(cursor, user_uuid)[1]:
            raise SubscriptionError(
                "انتهت تجربتك المجانية. اختر خطة اشتراك لمتابعة الحل.",
                402,
            )
        if len(code_fingerprints) > 1:
            raise SubscriptionError(
                "التجربة المجانية مخصصة لكود واحد فقط؛ اختر خطة لإضافة أكواد أخرى.",
                402,
            )
        return None, True

    def _settle_subscription_use(
        self, cursor, owner_user_id, operation_id, code_fingerprint, success
    ):
        if not owner_user_id or not code_fingerprint:
            return
        if success:
            cursor.execute(
                """
                UPDATE quizora_subscription_uses
                SET status = 'consumed', consumed_at = now()
                WHERE user_id = %s AND operation_id = %s
                  AND code_fingerprint = %s AND status = 'reserved'
                RETURNING subscription_id
                """,
                (owner_user_id, operation_id, code_fingerprint),
            )
            use = cursor.fetchone()
            if use and use["subscription_id"] is None:
                cursor.execute(
                    """
                    UPDATE quizora_subscription_trials
                    SET status = 'consumed', updated_at = now()
                    WHERE user_id = %s AND operation_id = %s
                      AND status = 'reserved'
                    """,
                    (owner_user_id, operation_id),
                )
            return

        cursor.execute(
            """
            SELECT subscription_id FROM quizora_subscription_uses
            WHERE user_id = %s AND operation_id = %s
              AND code_fingerprint = %s AND status = 'reserved'
            FOR UPDATE
            """,
            (owner_user_id, operation_id, code_fingerprint),
        )
        use = cursor.fetchone()
        if not use:
            return
        cursor.execute(
            """
            SELECT 1 FROM quizora_jobs
            WHERE operation_id = %s AND code_fingerprint = %s
              AND status IN ('queued', 'running')
            LIMIT 1
            """,
            (operation_id, code_fingerprint),
        )
        if cursor.fetchone():
            return
        cursor.execute(
            """
            DELETE FROM quizora_subscription_uses
            WHERE user_id = %s AND operation_id = %s
              AND code_fingerprint = %s AND status = 'reserved'
            """,
            (owner_user_id, operation_id, code_fingerprint),
        )
        if use["subscription_id"] is None:
            cursor.execute(
                """
                DELETE FROM quizora_subscription_trials
                WHERE user_id = %s AND operation_id = %s
                  AND code_fingerprint = %s AND status = 'reserved'
                """,
                (owner_user_id, operation_id, code_fingerprint),
            )

    def health(self):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()
        except self._psycopg.Error as error:
            raise QueueStoreError("PostgreSQL is not reachable.") from error

    def get_site_enabled(self):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT value FROM quizora_metadata WHERE key = %s",
                        ("site_enabled",),
                    )
                    row = cursor.fetchone()
                    return True if row is None else bool(row["value"])
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not read the site availability setting.") from error

    def set_site_enabled(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Site availability must be a boolean.")
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO quizora_metadata (key, value)
                        VALUES (%s, %s)
                        ON CONFLICT (key)
                        DO UPDATE SET value = EXCLUDED.value
                        """,
                        ("site_enabled", int(enabled)),
                    )
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not save the site availability setting.") from error

    def try_acquire_worker_lock(self):
        try:
            connection = self._connect(autocommit=True)
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(%s)", (WORKER_LOCK_ID,))
                acquired = cursor.fetchone()["pg_try_advisory_lock"]
            if acquired:
                return connection
            connection.close()
            return None
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not acquire the PostgreSQL worker lock.") from error

    def worker_lock_is_held(self, connection):
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM pg_locks
                        WHERE locktype = 'advisory'
                          AND pid = pg_backend_pid()
                          AND granted
                          AND classid = 0
                          AND objid = %s
                          AND objsubid = 1
                    ) AS held
                    """,
                    (WORKER_LOCK_ID,),
                )
                return cursor.fetchone()["held"]
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not verify the PostgreSQL worker lock.") from error

    @staticmethod
    def release_worker_lock(connection):
        if connection is None:
            return
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_unlock(%s)", (WORKER_LOCK_ID,))
        finally:
            connection.close()

    def recover_interrupted_jobs(self):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE quizora_jobs AS job
                        SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,
                            success = FALSE,
                            phase = CASE WHEN cancel_requested THEN 'متوقّف' ELSE 'فشل' END,
                            message = CASE
                                WHEN cancel_requested THEN 'تم الإيقاف أثناء إعادة تشغيل الخادم.'
                                ELSE 'انقطع الخادم أثناء التنفيذ؛ أعد إرسال العملية.'
                            END,
                            password_ciphertext = NULL,
                            finished_at = now(),
                            worker_id = NULL
                        FROM quizora_operations AS operation
                        WHERE job.status = 'running'
                          AND operation.id = job.operation_id
                        RETURNING job.operation_id, job.code_fingerprint,
                                  operation.owner_user_id
                        """
                    )
                    recovered = cursor.fetchall()
                    self._refresh_operations(
                        cursor, {row["operation_id"] for row in recovered}
                    )
                    for row in recovered:
                        self._settle_subscription_use(
                            cursor,
                            row["owner_user_id"],
                            row["operation_id"],
                            row["code_fingerprint"],
                            False,
                        )
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not recover interrupted queue jobs.") from error

    def enqueue(
        self,
        plan,
        accounts,
        max_active,
        client_id=None,
        owner_key=None,
        owner_name=None,
        owner_email=None,
        owner_user_id=None,
    ):
        client_uuid = self._as_uuid(client_id) if client_id else uuid.uuid4()
        owner_user_uuid = self._as_uuid(owner_user_id) if owner_user_id else None
        if not owner_user_uuid:
            raise SubscriptionError(
                "تسجيل الدخول مطلوب للتحقق من رصيد الاشتراك.", 401
            )
        owner_name = str(owner_name or "").strip()[:120]
        owner_email = str(owner_email or "").strip()[:254]
        owner_name_ciphertext = self._encrypt(owner_name) if owner_name else None
        owner_email_ciphertext = self._encrypt(owner_email) if owner_email else None
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT pg_advisory_xact_lock(%s)", (SUBMISSION_LOCK_ID,)
                    )
                    if owner_key:
                        owner_filter = "owner_key = %s"
                        owner_params = (owner_key,)
                    else:
                        owner_filter = "client_id = %s"
                        owner_params = (client_uuid,)
                    cursor.execute(
                        f"""
                        UPDATE quizora_jobs
                        SET archived = TRUE
                        WHERE operation_id IN (
                            SELECT id FROM quizora_operations WHERE {owner_filter}
                        )
                          AND status IN ('succeeded', 'failed', 'cancelled')
                          AND archived = FALSE
                        """,
                        owner_params,
                    )
                    cursor.execute(
                        """
                        SELECT count(*) AS total
                        FROM quizora_jobs
                        WHERE status IN ('queued', 'running')
                        """
                    )
                    active_total = cursor.fetchone()["total"]
                    additions = []
                    skipped = 0
                    for code, password in accounts:
                        fingerprint = self._fingerprint(code)
                        for item in plan:
                            cursor.execute(
                                """
                                SELECT 1 FROM quizora_jobs
                                WHERE code_fingerprint = %s AND mode = %s
                                  AND status IN ('queued', 'running')
                                LIMIT 1
                                """,
                                (fingerprint, item["mode"]),
                            )
                            if cursor.fetchone():
                                skipped += 1
                                continue
                            additions.append(
                                (code, password, fingerprint, item.copy())
                            )

                    if not additions:
                        return 0, skipped, None
                    if active_total + len(additions) > max_active:
                        raise QueueCapacityError(
                            "عدد العمليات في الانتظار والتشغيل تجاوز الحد المسموح."
                        )
                    code_fingerprints = []
                    seen_fingerprints = set()
                    for _, _, fingerprint, _ in additions:
                        if fingerprint not in seen_fingerprints:
                            seen_fingerprints.add(fingerprint)
                            code_fingerprints.append(fingerprint)
                    subscription_id = None
                    is_trial = False
                    if owner_user_uuid:
                        subscription_id, is_trial = (
                            self._authorize_subscription_accounts(
                                cursor,
                                owner_user_uuid,
                                owner_key,
                                code_fingerprints,
                            )
                        )

                    operation_id = uuid.uuid4()
                    cursor.execute(
                        """
                        INSERT INTO quizora_operations
                            (id, client_id, owner_key, owner_user_id,
                             owner_name_ciphertext, owner_email_ciphertext,
                             status, total_jobs)
                        VALUES (%s, %s, %s, %s, %s, %s, 'queued', %s)
                        """,
                        (
                            operation_id,
                            client_uuid,
                            owner_key,
                            owner_user_uuid,
                            owner_name_ciphertext,
                            owner_email_ciphertext,
                            len(additions),
                        ),
                    )
                    inserted = 0
                    inserted_fingerprints = set()
                    for position, (code, password, fingerprint, item) in enumerate(
                        additions, start=1
                    ):
                        cursor.execute(
                            """
                            INSERT INTO quizora_jobs (
                                id, operation_id, position, code_ciphertext,
                                code_fingerprint, password_ciphertext, mode, detail,
                                options, status, phase
                            )
                            VALUES (
                                %s, %s, %s, %s, %s, %s, %s, %s,
                                %s::jsonb, 'queued', 'في قائمة الانتظار...'
                            )
                            ON CONFLICT DO NOTHING
                            """,
                            (
                                uuid.uuid4(),
                                operation_id,
                                position,
                                self._encrypt(code),
                                fingerprint,
                                self._encrypt(password),
                                item["mode"],
                                item.get("detail", ""),
                                json.dumps(item, ensure_ascii=False),
                            ),
                        )
                        if cursor.rowcount:
                            inserted += cursor.rowcount
                            inserted_fingerprints.add(fingerprint)

                    if inserted == 0:
                        cursor.execute(
                            "DELETE FROM quizora_operations WHERE id = %s",
                            (operation_id,),
                        )
                        return 0, skipped + len(additions), None
                    if owner_user_uuid:
                        for fingerprint in inserted_fingerprints:
                            cursor.execute(
                                """
                                INSERT INTO quizora_subscription_uses
                                    (id, user_id, subscription_id, code_fingerprint,
                                     operation_id, status)
                                VALUES (%s, %s, %s, %s, %s, 'reserved')
                                """,
                                (
                                    uuid.uuid4(),
                                    owner_user_uuid,
                                    subscription_id,
                                    fingerprint,
                                    operation_id,
                                ),
                            )
                            if is_trial:
                                cursor.execute(
                                    """
                                    INSERT INTO quizora_subscription_trials
                                        (user_id, status, code_fingerprint, operation_id)
                                    VALUES (%s, 'reserved', %s, %s)
                                    """,
                                    (owner_user_uuid, fingerprint, operation_id),
                                )
                    cursor.execute(
                        """
                        UPDATE quizora_operations
                        SET total_jobs = %s, status = 'queued'
                        WHERE id = %s
                        """,
                        (inserted, operation_id),
                    )
                    return inserted, skipped, operation_id
        except QueueCapacityError:
            raise
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not save the requested jobs to PostgreSQL.") from error

    def claim_next(self, worker_id):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id, operation_id, code_ciphertext, password_ciphertext,
                               mode, detail, options
                        FROM quizora_jobs
                        WHERE status = 'queued'
                        ORDER BY queue_order
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                        """
                    )
                    job = cursor.fetchone()
                    if not job:
                        return None
                    cursor.execute(
                        """
                        UPDATE quizora_jobs
                        SET status = 'running', worker_id = %s,
                            started_at = now(), phase = 'جاري التشغيل...',
                            cancel_requested = FALSE
                        WHERE id = %s AND status = 'queued'
                        """,
                        (worker_id, job["id"]),
                    )
                    if cursor.rowcount != 1:
                        return None
                    operation_id = job["operation_id"]
                    job["id"] = str(job["id"])
                    job["operation_id"] = str(job["operation_id"])
                    job["code"] = self._decrypt(job.pop("code_ciphertext"))
                    job["password"] = self._decrypt(job.pop("password_ciphertext"))
                    self._refresh_operations(cursor, {operation_id})
                    return job
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not claim the next PostgreSQL queue job.") from error

    def claim_job_for_admin(self, job_id):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE quizora_jobs
                        SET status = 'running', worker_id = %s,
                            started_at = now(), phase = 'جاري التشغيل...',
                            cancel_requested = FALSE
                        WHERE id = %s AND status = 'queued'
                        RETURNING id, operation_id, code_ciphertext,
                                  password_ciphertext, mode, detail, options
                        """,
                        ("admin-" + uuid.uuid4().hex, self._as_uuid(job_id)),
                    )
                    job = cursor.fetchone()
                    if not job:
                        return None
                    operation_id = job["operation_id"]
                    self._refresh_operations(cursor, {operation_id})
                    job["id"] = str(job["id"])
                    job["operation_id"] = str(operation_id)
                    job["code"] = self._decrypt(job.pop("code_ciphertext"))
                    password_ciphertext = job.pop("password_ciphertext")
                    if not password_ciphertext:
                        raise QueueStoreError("The queued job has no stored password.")
                    job["password"] = self._decrypt(password_ciphertext)
                    return job
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not start the selected queue job.") from error

    def is_cancel_requested(self, job_id):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT cancel_requested FROM quizora_jobs WHERE id = %s",
                        (self._as_uuid(job_id),),
                    )
                    row = cursor.fetchone()
                    return not row or row["cancel_requested"]
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not check the queue cancellation request.") from error

    def update_phase(self, job_id, phase):
        self._update_job(
            """
            UPDATE quizora_jobs SET phase = %s
            WHERE id = %s AND status = 'running'
            """,
            (str(phase)[:120], self._as_uuid(job_id)),
            "Could not update the queue job phase.",
        )

    def update_progress(self, job_id, progress):
        self._update_job(
            """
            UPDATE quizora_jobs SET progress = %s::jsonb
            WHERE id = %s AND status = 'running'
            """,
            (json.dumps(progress, ensure_ascii=False), self._as_uuid(job_id)),
            "Could not update the queue job progress.",
        )

    def append_log(self, job_id, message, level, max_lines):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO quizora_job_logs (job_id, level, message)
                        VALUES (%s, %s, %s)
                        """,
                        (self._as_uuid(job_id), str(level)[:20], str(message)[:500]),
                    )
                    cursor.execute(
                        """
                        DELETE FROM quizora_job_logs
                        WHERE job_id = %s
                          AND id NOT IN (
                              SELECT id FROM quizora_job_logs
                              WHERE job_id = %s ORDER BY id DESC LIMIT %s
                          )
                        """,
                        (self._as_uuid(job_id), self._as_uuid(job_id), max_lines),
                    )
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not persist a queue job log line.") from error

    def finish_job(
        self,
        job_id,
        success,
        cancelled,
        message,
        phase,
        duration_seconds=0,
        mode="",
        detail="",
    ):
        status = "succeeded" if success else ("cancelled" if cancelled else "failed")
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE quizora_jobs AS job
                        SET status = %s, success = %s, message = %s, phase = %s,
                            password_ciphertext = NULL, finished_at = now(),
                            worker_id = NULL
                        FROM quizora_operations AS operation
                        WHERE job.id = %s AND job.status = 'running'
                          AND operation.id = job.operation_id
                        RETURNING job.operation_id, job.code_ciphertext,
                                  job.code_fingerprint, operation.owner_user_id
                        """,
                        (
                            status,
                            bool(success),
                            str(message)[:500],
                            str(phase)[:120],
                            self._as_uuid(job_id),
                        ),
                    )
                    row = cursor.fetchone()
                    if row:
                        if success:
                            cursor.execute(
                                """
                                SELECT owner_name_ciphertext, owner_email_ciphertext
                                FROM quizora_operations
                                WHERE id = %s
                                """,
                                (row["operation_id"],),
                            )
                            owner = cursor.fetchone() or {}
                            cursor.execute(
                                """
                                INSERT INTO quizora_solved_accounts
                                    (job_id, code_ciphertext, mode, detail,
                                     duration_seconds, user_name_ciphertext,
                                     user_email_ciphertext)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (job_id) DO NOTHING
                                """,
                                (
                                    self._as_uuid(job_id),
                                    row["code_ciphertext"],
                                    str(mode)[:120],
                                    str(detail)[:500],
                                    max(0, int(duration_seconds)),
                                    owner.get("owner_name_ciphertext"),
                                    owner.get("owner_email_ciphertext"),
                                ),
                            )
                        self._settle_subscription_use(
                            cursor,
                            row.get("owner_user_id"),
                            row["operation_id"],
                            row.get("code_fingerprint"),
                            bool(success),
                        )
                        self._refresh_operations(cursor, {row["operation_id"]})
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not persist the queue job result.") from error

    def request_stop(self, code=None, client_id=None, owner_key=None):
        fingerprint = self._fingerprint(code) if code else None
        client_uuid = self._as_uuid(client_id) if client_id else None
        filters = []
        params = []
        if owner_key:
            filters.append(" AND operation.owner_key = %s")
            params.append(owner_key)
        elif client_uuid:
            filters.append(" AND operation.client_id = %s")
            params.append(client_uuid)
        if fingerprint:
            filters.append(" AND job.code_fingerprint = %s")
            params.append(fingerprint)
        filter_sql = "".join(filters)
        filter_params = tuple(params)
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        UPDATE quizora_jobs AS job
                        SET status = 'cancelled', success = FALSE,
                            phase = 'متوقّف',
                            message = 'تم الإيقاف قبل بدء التنفيذ.',
                            password_ciphertext = NULL,
                            finished_at = now()
                        FROM quizora_operations AS operation
                        WHERE job.operation_id = operation.id
                          AND job.status = 'queued' {filter_sql}
                        RETURNING job.operation_id, job.code_fingerprint,
                                  operation.owner_user_id
                        """,
                        filter_params,
                    )
                    queued_rows = cursor.fetchall()
                    operation_ids = {
                        row["operation_id"] for row in queued_rows
                    }
                    queued_count = len(queued_rows)
                    for row in queued_rows:
                        self._settle_subscription_use(
                            cursor,
                            row["owner_user_id"],
                            row["operation_id"],
                            row["code_fingerprint"],
                            False,
                        )
                    cursor.execute(
                        f"""
                        UPDATE quizora_jobs AS job
                        SET cancel_requested = TRUE, phase = 'جاري الإيقاف...'
                        FROM quizora_operations AS operation
                        WHERE job.operation_id = operation.id
                          AND job.status = 'running' {filter_sql}
                        RETURNING job.operation_id
                        """,
                        filter_params,
                    )
                    running_rows = cursor.fetchall()
                    operation_ids.update(row["operation_id"] for row in running_rows)
                    self._refresh_operations(cursor, operation_ids)
                    return queued_count, len(running_rows)
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not stop the requested queue jobs.") from error

    def clear_finished(self, client_id=None, owner_key=None):
        client_uuid = self._as_uuid(client_id) if client_id else None
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    if owner_key:
                        cursor.execute(
                            """
                            UPDATE quizora_jobs AS job
                            SET archived = TRUE
                            FROM quizora_operations AS operation
                            WHERE job.operation_id = operation.id
                              AND job.status IN ('succeeded', 'failed', 'cancelled')
                              AND job.archived = FALSE
                              AND operation.owner_key = %s
                            """,
                            (owner_key,),
                        )
                    elif client_uuid:
                        cursor.execute(
                            """
                            UPDATE quizora_jobs AS job
                            SET archived = TRUE
                            FROM quizora_operations AS operation
                            WHERE job.operation_id = operation.id
                              AND job.status IN ('succeeded', 'failed', 'cancelled')
                              AND job.archived = FALSE
                              AND operation.client_id = %s
                            """,
                            (client_uuid,),
                        )
                    else:
                        cursor.execute(
                            """
                            UPDATE quizora_jobs
                            SET archived = TRUE
                            WHERE status IN ('succeeded', 'failed', 'cancelled')
                              AND archived = FALSE
                            """
                        )
                    deleted = cursor.rowcount
                    return deleted
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not clear completed queue jobs.") from error

    def status_payload(self, log_limit, client_id=None, owner_key=None):
        client_uuid = self._as_uuid(client_id) if client_id else None
        if owner_key:
            owner_filter = " AND operation.owner_key = %s"
            owner_params = (owner_key,)
        else:
            owner_filter = " AND operation.client_id = %s" if client_uuid else ""
            owner_params = (client_uuid,) if client_uuid else ()
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        SELECT job.id, job.queue_order, job.code_ciphertext,
                               job.mode, job.detail, job.status, job.phase,
                               job.progress, job.success, job.message, job.created_at
                        FROM quizora_jobs AS job
                        JOIN quizora_operations AS operation
                          ON operation.id = job.operation_id
                        WHERE job.status IN ('queued', 'running'){owner_filter}
                        ORDER BY job.queue_order
                        """,
                        owner_params,
                    )
                    active = cursor.fetchall()
                    cursor.execute(
                        f"""
                        SELECT job.id, job.queue_order, job.code_ciphertext,
                               job.mode, job.detail, job.status, job.phase,
                               job.progress, job.success, job.message, job.created_at
                        FROM quizora_jobs AS job
                        JOIN quizora_operations AS operation
                          ON operation.id = job.operation_id
                        WHERE job.status IN ('succeeded', 'failed', 'cancelled')
                          AND job.archived = FALSE{owner_filter}
                        ORDER BY job.finished_at DESC, job.queue_order DESC
                        LIMIT 80
                        """,
                        owner_params,
                    )
                    completed = list(reversed(cursor.fetchall()))
                    jobs = active + completed

                    job_ids = [job["id"] for job in jobs]
                    logs = {}
                    if job_ids:
                        cursor.execute(
                            """
                            SELECT job_id, created_at, level, message
                            FROM (
                                SELECT job_id, created_at, level, message, id,
                                       row_number() OVER (
                                           PARTITION BY job_id ORDER BY id DESC
                                       ) AS line_number
                                FROM quizora_job_logs
                                WHERE job_id = ANY(%s)
                            ) recent
                            WHERE line_number <= %s
                            ORDER BY job_id, id
                            """,
                            (job_ids, log_limit),
                        )
                        for line in cursor.fetchall():
                            logs.setdefault(line["job_id"], []).append({
                                "t": line["created_at"].strftime("%H:%M:%S"),
                                "level": line["level"],
                                "msg": line["message"],
                            })

                    cursor.execute(
                        f"""
                        SELECT count(*) AS total,
                               count(*) FILTER (WHERE job.status = 'running') AS running
                        FROM quizora_jobs AS job
                        JOIN quizora_operations AS operation
                          ON operation.id = job.operation_id
                        WHERE job.status IN ('queued', 'running'){owner_filter}
                        """,
                        owner_params,
                    )
                    counts = cursor.fetchone()
                    client_running_count = sum(
                        1 for job in active if job["status"] == "running"
                    )
                    queue_ahead = None
                    queue_position = None
                    if client_running_count:
                        queue_state = "running"
                        queue_ahead = 0
                        queue_position = 1
                    elif active:
                        cursor.execute(
                            f"""
                            SELECT count(*) AS ahead
                            FROM quizora_jobs AS job
                            JOIN quizora_operations AS operation
                              ON operation.id = job.operation_id
                            WHERE job.status IN ('queued', 'running')
                              AND job.queue_order < %s{owner_filter}
                            """,
                            (active[0]["queue_order"],) + owner_params,
                        )
                        queue_ahead = cursor.fetchone()["ahead"]
                        queue_position = queue_ahead + 1
                        queue_state = "waiting"
                    elif completed:
                        queue_state = "finished"
                    else:
                        queue_state = "none"

            accounts = []
            for job in jobs:
                status = job["status"]
                accounts.append({
                    "id": str(job["id"]),
                    "code": self._decrypt(job["code_ciphertext"]),
                    "mode": job["mode"],
                    "detail": job.get("detail", ""),
                    "running": status in ACTIVE_STATUSES,
                    "finished": status in TERMINAL_STATUSES,
                    "success": bool(job["success"]),
                    "message": job["message"],
                    "phase": job["phase"],
                    "progress": job["progress"],
                    "lines": logs.get(job["id"], []),
                })
            return {
                "accounts": accounts,
                "running_count": len(active),
                "total_count": len(accounts),
                "concurrency": 3,
                "active_workers": counts["running"],
                "queue_total": counts["total"],
                "queue_ahead": queue_ahead,
                "queue_position": queue_position,
                "queue_state": queue_state,
                "version": 2,
            }
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not read the PostgreSQL queue status.") from error

    def admin_queue_payload(self):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id, code_ciphertext, mode, detail, status,
                               phase, queue_order, progress, created_at, started_at
                        FROM quizora_jobs
                        WHERE status IN ('queued', 'running')
                        ORDER BY queue_order
                        """
                    )
                    rows = cursor.fetchall()
                    cursor.execute(
                        """
                        SELECT job_id, code_ciphertext, mode, detail,
                               duration_seconds, user_name_ciphertext,
                               user_email_ciphertext, solved_at
                        FROM quizora_solved_accounts
                        ORDER BY solved_at DESC, job_id
                        """
                    )
                    solved_rows = cursor.fetchall()

            jobs = []
            solved_events = []
            for solved_row in solved_rows:
                solved_events.append({
                    "code": self._decrypt(solved_row["code_ciphertext"]),
                    "mode": solved_row["mode"],
                    "detail": solved_row["detail"],
                    "user_name": (
                        self._decrypt(solved_row["user_name_ciphertext"])
                        if solved_row["user_name_ciphertext"]
                        else ""
                    ),
                    "user_email": (
                        self._decrypt(solved_row["user_email_ciphertext"])
                        if solved_row["user_email_ciphertext"]
                        else ""
                    ),
                    "duration_seconds": solved_row["duration_seconds"],
                    "solved_at": solved_row["solved_at"].isoformat(),
                })
            current_time = time.time()
            active_codes = set()
            running_codes = set()
            for position, row in enumerate(rows, start=1):
                code = self._decrypt(row["code_ciphertext"])
                is_running = row["status"] == "running"
                active_codes.add(code)
                if is_running:
                    running_codes.add(code)
                jobs.append({
                    "id": str(row["id"]),
                    "code": code,
                    "mode": row["mode"],
                    "detail": row["detail"],
                    "phase": row["phase"],
                    "running": is_running,
                    "position": position,
                    "progress": row["progress"],
                    "elapsed_seconds": (
                        max(0, int(current_time - row["started_at"].timestamp()))
                        if row["started_at"] is not None
                        else None
                    ),
                    "queued_seconds": max(
                        0,
                        int(current_time - row["created_at"].timestamp()),
                    ),
                })
            return {
                "ok": True,
                "queue_count": len(active_codes),
                "running_count": len(running_codes),
                "active_job_count": len(rows),
                "solved_count": len(solved_rows),
                "solved_events": solved_events,
                "jobs": jobs,
            }
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not read the administration queue.") from error

    def _update_job(self, query, params, error_message):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(query, params)
        except self._psycopg.Error as error:
            raise QueueStoreError(error_message) from error

    def _refresh_operations(self, cursor, operation_ids):
        if not operation_ids:
            return
        cursor.execute(
            """
            UPDATE quizora_operations operation
            SET status = CASE
                WHEN EXISTS (
                    SELECT 1 FROM quizora_jobs job
                    WHERE job.operation_id = operation.id AND job.status = 'running'
                ) THEN 'running'
                WHEN EXISTS (
                    SELECT 1 FROM quizora_jobs job
                    WHERE job.operation_id = operation.id AND job.status = 'queued'
                ) THEN 'queued'
                WHEN EXISTS (
                    SELECT 1 FROM quizora_jobs job
                    WHERE job.operation_id = operation.id AND job.status = 'failed'
                ) THEN 'failed'
                WHEN EXISTS (
                    SELECT 1 FROM quizora_jobs job
                    WHERE job.operation_id = operation.id AND job.status = 'cancelled'
                ) THEN 'cancelled'
                ELSE 'completed'
            END,
            owner_name_ciphertext = CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM quizora_jobs job
                    WHERE job.operation_id = operation.id
                      AND job.status IN ('queued', 'running')
                ) THEN NULL
                ELSE operation.owner_name_ciphertext
            END,
            owner_email_ciphertext = CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM quizora_jobs job
                    WHERE job.operation_id = operation.id
                      AND job.status IN ('queued', 'running')
                ) THEN NULL
                ELSE operation.owner_email_ciphertext
            END
            WHERE operation.id = ANY(%s)
            """,
            (list(operation_ids),),
        )

    def _encrypt(self, value):
        return self._fernet.encrypt(str(value).encode("utf-8")).decode("ascii")

    def _decrypt(self, value):
        try:
            return self._fernet.decrypt(value.encode("ascii")).decode("utf-8")
        except (self._invalid_token, UnicodeEncodeError) as error:
            raise QueueStoreError("Stored queue credentials could not be decrypted.") from error

    def _fingerprint(self, code):
        return hmac.new(
            self._fingerprint_key,
            str(code).strip().encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    @staticmethod
    def _as_uuid(value):
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
