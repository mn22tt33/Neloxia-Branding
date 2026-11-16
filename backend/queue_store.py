"""PostgreSQL-backed queue and task status storage."""

import base64
import hashlib
import hmac
import json
import uuid


WORKER_LOCK_ID = 731904221
SUBMISSION_LOCK_ID = 731904222
TERMINAL_STATUSES = ("succeeded", "failed", "cancelled")
ACTIVE_STATUSES = ("queued", "running")


class QueueStoreError(RuntimeError):
    pass


class QueueCapacityError(QueueStoreError):
    pass


class PostgresQueue:
    def __init__(self, database_url, encryption_key):
        try:
            import psycopg
            from cryptography.fernet import Fernet, InvalidToken
            from psycopg.rows import dict_row
        except ImportError as error:
            raise RuntimeError(
                "PostgreSQL mode requires psycopg[binary] and cryptography."
            ) from error

        key = encryption_key.encode("ascii")
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
        self._fingerprint_key = hashlib.sha256(
            b"QUIZORA account fingerprint\x00" + raw_key
        ).digest()

    def _connect(self, **kwargs):
        return self._psycopg.connect(
            self._database_url,
            connect_timeout=10,
            row_factory=self._dict_row,
            **kwargs,
        )

    def initialize(self):
        statements = (
            """
            CREATE TABLE IF NOT EXISTS quizora_operations (
                id UUID PRIMARY KEY,
                client_id UUID,
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
            CREATE UNIQUE INDEX IF NOT EXISTS quizora_jobs_account_fingerprint
                ON quizora_jobs (code_fingerprint, mode)
                WHERE status IN ('queued', 'running')
            """,
            """
            CREATE INDEX IF NOT EXISTS quizora_job_logs_recent
                ON quizora_job_logs (job_id, id DESC)
            """,
        )
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    for statement in statements:
                        cursor.execute(statement)
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

    def health(self):
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()
        except self._psycopg.Error as error:
            raise QueueStoreError("PostgreSQL is not reachable.") from error

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
                        UPDATE quizora_jobs
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
                        WHERE status = 'running'
                        RETURNING operation_id
                        """
                    )
                    self._refresh_operations(
                        cursor, {row["operation_id"] for row in cursor.fetchall()}
                    )
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not recover interrupted queue jobs.") from error

    def enqueue(self, plan, accounts, max_active, client_id=None):
        client_uuid = self._as_uuid(client_id) if client_id else uuid.uuid4()
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT pg_advisory_xact_lock(%s)", (SUBMISSION_LOCK_ID,)
                    )
                    cursor.execute(
                        """
                        UPDATE quizora_jobs
                        SET archived = TRUE
                        WHERE operation_id IN (
                            SELECT id FROM quizora_operations WHERE client_id = %s
                        )
                          AND status IN ('succeeded', 'failed', 'cancelled')
                          AND archived = FALSE
                        """,
                        (client_uuid,),
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

                    operation_id = uuid.uuid4()
                    cursor.execute(
                        """
                        INSERT INTO quizora_operations (id, client_id, status, total_jobs)
                        VALUES (%s, %s, 'queued', %s)
                        """,
                        (operation_id, client_uuid, len(additions)),
                    )
                    inserted = 0
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
                        inserted += cursor.rowcount

                    if inserted == 0:
                        cursor.execute(
                            "DELETE FROM quizora_operations WHERE id = %s",
                            (operation_id,),
                        )
                        return 0, skipped + len(additions), None
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

    def finish_job(self, job_id, success, cancelled, message, phase):
        status = "succeeded" if success else ("cancelled" if cancelled else "failed")
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE quizora_jobs
                        SET status = %s, success = %s, message = %s, phase = %s,
                            password_ciphertext = NULL, finished_at = now(),
                            worker_id = NULL
                        WHERE id = %s AND status = 'running'
                        RETURNING operation_id
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
                        self._refresh_operations(cursor, {row["operation_id"]})
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not persist the queue job result.") from error

    def request_stop(self, code=None, client_id=None):
        fingerprint = self._fingerprint(code) if code else None
        client_uuid = self._as_uuid(client_id) if client_id else None
        filters = []
        params = []
        if client_uuid:
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
                        RETURNING job.operation_id
                        """,
                        filter_params,
                    )
                    rows = cursor.fetchall()
                    operation_ids = {row["operation_id"] for row in rows}
                    queued_count = len(rows)
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

    def clear_finished(self, client_id=None):
        client_uuid = self._as_uuid(client_id) if client_id else None
        try:
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    if client_uuid:
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

    def status_payload(self, log_limit, client_id=None):
        client_uuid = self._as_uuid(client_id) if client_id else None
        owner_filter = (
            " AND operation.client_id = %s" if client_uuid else ""
        )
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
                        """
                        SELECT count(*) AS total,
                               count(*) FILTER (WHERE status = 'running') AS running
                        FROM quizora_jobs
                        WHERE status IN ('queued', 'running')
                        """
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
                            """
                            SELECT count(*) AS ahead
                            FROM quizora_jobs
                            WHERE status IN ('queued', 'running')
                              AND queue_order < %s
                            """,
                            (active[0]["queue_order"],),
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
                "concurrency": 1,
                "active_workers": counts["running"],
                "queue_total": counts["total"],
                "queue_ahead": queue_ahead,
                "queue_position": queue_position,
                "queue_state": queue_state,
                "version": 2,
            }
        except self._psycopg.Error as error:
            raise QueueStoreError("Could not read the PostgreSQL queue status.") from error

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
