import hashlib
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from http.cookiejar import CookieJar
from unittest.mock import MagicMock, patch

os.environ["QUIZORA_TEST_MODE"] = "1"

from cryptography.fernet import Fernet

from backend import server
from backend.queue_store import PostgresQueue


class QueueStorageTests(unittest.TestCase):
    def setUp(self):
        history_dir = tempfile.TemporaryDirectory()
        self.addCleanup(history_dir.cleanup)
        patchers = (
            patch.object(
                server,
                "SOLVED_COUNT_PATH",
                os.path.join(history_dir.name, "solved_count.json"),
            ),
            patch.object(server, "_local_solved_count", 0),
            patch.object(server, "_local_solved_events", []),
            patch.object(server, "AUTH_REQUIRED", False),
        )
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    @contextmanager
    def _running_api(self):
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler())
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            yield "http://127.0.0.1:%d" % httpd.server_address[1]
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)

    def test_worker_preflight_allows_ngrok_browser_bypass_header(self):
        with self._running_api() as base:
            request = urllib.request.Request(
                base + "/api/start",
                method="OPTIONS",
                headers={
                    "Origin": "https://quizora.movb.workers.dev",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type, ngrok-skip-browser-warning",
                },
            )
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(
                    response.headers.get("Access-Control-Allow-Origin"),
                    "https://quizora.movb.workers.dev",
                )
                self.assertEqual(
                    response.headers.get("Access-Control-Allow-Credentials"),
                    "true",
                )
                allowed_headers = {
                    value.strip().lower()
                    for value in response.headers["Access-Control-Allow-Headers"].split(",")
                }
                self.assertIn("ngrok-skip-browser-warning", allowed_headers)

    def test_admin_panel_is_local_and_returns_queue_summary(self):
        with patch.object(server, "_queue_store", None), self._running_api() as base:
            with urllib.request.urlopen(base + "/admin") as response:
                page = response.read().decode("utf-8")
                self.assertEqual(response.status, 200)
                self.assertIn("إدارة الطابور", page)
                self.assertIn('id="solvedCard"', page)
                self.assertIn('id="solvedDialog"', page)
                self.assertIn('id="solvedEvents"', page)
                self.assertIn("[...events].reverse().forEach", page)

            with urllib.request.urlopen(base + "/api/admin/queue") as response:
                payload = json.loads(response.read().decode("utf-8"))
                self.assertEqual(response.status, 200)
                self.assertEqual(payload["queue_count"], 0)
                self.assertIn("solved_events", payload)
                self.assertEqual(payload["jobs"], [])

            request = urllib.request.Request(
                base + "/api/admin/queue",
                headers={"Host": "example.com"},
            )
            with self.assertRaises(urllib.error.HTTPError) as denied:
                urllib.request.urlopen(request)
            self.assertEqual(denied.exception.code, 403)
            denied.exception.close()

    def test_admin_browser_setting_is_saved_and_returned(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_path = os.path.join(temp_dir, "admin_settings.json")
            with (
                patch.object(server, "ADMIN_SETTINGS_PATH", settings_path),
                patch.object(server, "_browser_visible", False),
                patch.object(server, "_browser_settings_lock", threading.Lock()),
                self._running_api() as base,
            ):
                with urllib.request.urlopen(base + "/api/admin/settings") as response:
                    self.assertFalse(json.loads(response.read().decode("utf-8"))["browser_visible"])

                request = urllib.request.Request(
                    base + "/api/admin/settings",
                    data=b'{"browser_visible":true}',
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(request) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                self.assertTrue(payload["browser_visible"])
                with open(settings_path, encoding="utf-8") as settings_file:
                    self.assertTrue(json.load(settings_file)["browser_visible"])

                request = urllib.request.Request(
                    base + "/api/admin/settings",
                    data=b'{"browser_visible":"yes"}',
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as invalid:
                    urllib.request.urlopen(request)
                self.assertEqual(invalid.exception.code, 400)
                invalid.exception.close()

    def test_legacy_solved_history_resets_and_only_successes_store_durations(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            count_path = os.path.join(temp_dir, "solved_count.json")
            with open(count_path, "w", encoding="utf-8") as count_file:
                json.dump({
                    "solved_count": 29,
                    "solved_codes": ["123456789", "fake-code"],
                }, count_file)
            account = {
                "id": "completed-account",
                "code": "123456789",
                "mode": "spx",
                "detail": "الثقافة المالية",
                "_started_at": 100,
                "running": True,
                "finished": False,
                "success": False,
                "password": "must-not-be-saved",
                "lines": [],
            }
            with (
                patch.object(server, "SOLVED_COUNT_PATH", count_path),
                patch.object(server, "_local_solved_count", 0),
                patch.object(server, "_local_solved_events", []),
                patch.object(server, "_accounts", []),
                patch.object(server, "_queue_store", None),
                patch.object(server.time, "time", return_value=200),
            ):
                events, legacy_history = server._load_local_solved_history()
                self.assertEqual(events, [])
                self.assertTrue(legacy_history)
                server._save_local_solved_history([])

                server._finalize(account, True, "completed", "انتهى")
                payload = server._admin_queue_payload()
                self.assertEqual(payload["solved_count"], 1)
                self.assertEqual(len(payload["solved_events"]), 1)
                event = payload["solved_events"][0]
                self.assertEqual(event["code"], "123456789")
                self.assertEqual(event["mode"], "spx")
                self.assertEqual(event["detail"], "الثقافة المالية")
                self.assertEqual(event["duration_seconds"], 100)

                failed_account = dict(account, code="not-a-success")
                server._finalize(failed_account, False, "failed", "فشل")
                self.assertEqual(server._admin_queue_payload()["solved_count"], 1)

                with self._running_api() as base:
                    with urllib.request.urlopen(base + "/api/admin/queue") as response:
                        admin_payload = json.loads(response.read().decode("utf-8"))
                    self.assertEqual(len(admin_payload["solved_events"]), 1)
                    status_url = (
                        base
                        + "/api/status?client_id=123e4567-e89b-12d3-a456-426614174000"
                    )
                    with urllib.request.urlopen(status_url) as response:
                        status_payload = json.loads(response.read().decode("utf-8"))
                self.assertNotIn("solved_events", status_payload)
                with open(count_path, encoding="utf-8") as count_file:
                    saved_history = json.load(count_file)
                self.assertEqual(saved_history["history_version"], 1)
                self.assertEqual(saved_history["solved_count"], 1)
                self.assertEqual(saved_history["solved_events"][0]["duration_seconds"], 100)
                self.assertNotIn("password", saved_history)
                self.assertNotIn("must-not-be-saved", json.dumps(saved_history))

    def test_admin_payload_includes_all_solved_events_without_deduplication(self):
        events = [
            {
                "code": "123456789" if index % 2 == 0 else "987654321",
                "mode": "spx",
                "detail": "الثقافة المالية",
                "duration_seconds": index * 10,
                "solved_at": "2026-11-17T12:00:00Z",
            }
            for index in range(7)
        ]
        with (
            patch.object(server, "_local_solved_events", events),
            patch.object(server, "_local_solved_count", len(events)),
            patch.object(server, "_accounts", []),
            patch.object(server, "_queue_store", None),
        ):
            payload = server._admin_queue_payload()

        self.assertEqual(payload["solved_count"], 7)
        self.assertEqual(len(payload["solved_events"]), 7)
        self.assertEqual(payload["solved_events"][0]["code"], "123456789")
        self.assertEqual(payload["solved_events"][2]["code"], "123456789")


    def test_browser_setting_disables_turbo_to_show_the_solver_browser(self):
        account = {
            "id": "visible-account",
            "running": True,
            "finished": False,
            "lines": [],
            "_client_id": "123e4567-e89b-12d3-a456-426614174000",
            "_stop_event": threading.Event(),
        }
        received = {}

        def fake_solver(_account, _code, _password, _subject, turbo, **kwargs):
            received["turbo"] = turbo
            received["headless"] = kwargs["headless"]
            return True, "completed"

        server._stop.clear()
        with (
            patch.object(server, "_browser_visible", True),
            patch.object(server, "_acquire_worker_slot", return_value=True),
            patch.object(server, "_release_worker_slot"),
            patch.object(server, "_run_spx", side_effect=fake_solver),
            patch.object(server, "_finalize"),
        ):
            server._worker(
                account,
                "student",
                "password",
                "spx",
                {"subject": "7", "turbo": True},
            )

        self.assertFalse(received["turbo"])
        self.assertFalse(received["headless"])

    def test_disabling_browser_keeps_solver_headless(self):
        account = {
            "id": "hidden-account",
            "running": True,
            "finished": False,
            "lines": [],
            "_client_id": "123e4567-e89b-12d3-a456-426614174000",
            "_stop_event": threading.Event(),
        }
        received = {}

        def fake_solver(_account, _code, _password, _subject, turbo, **kwargs):
            received["turbo"] = turbo
            received["headless"] = kwargs["headless"]
            return True, "completed"

        server._stop.clear()
        with (
            patch.object(server, "_browser_visible", False),
            patch.object(server, "_acquire_worker_slot", return_value=True),
            patch.object(server, "_release_worker_slot"),
            patch.object(server, "_run_spx", side_effect=fake_solver),
            patch.object(server, "_finalize"),
        ):
            server._worker(
                account,
                "student",
                "password",
                "spx",
                {"subject": "7", "turbo": False},
            )

        self.assertFalse(received["turbo"])
        self.assertTrue(received["headless"])

    def test_progress_page_is_local_and_requires_a_valid_client_id(self):
        client_id = "123e4567-e89b-12d3-a456-426614174000"
        with self._running_api() as base:
            with self.assertRaises(urllib.error.HTTPError) as invalid:
                urllib.request.urlopen(base + "/progress?client_id=invalid")
            self.assertEqual(invalid.exception.code, 400)
            invalid.exception.close()

            with urllib.request.urlopen(
                base + "/progress?client_id=" + client_id
            ) as response:
                page = response.read().decode("utf-8")
                self.assertEqual(response.status, 200)
                self.assertIn("متابعة الحل", page)
                self.assertIn("/api/status?client_id=", page)
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.assertEqual(response.headers.get("Referrer-Policy"), "no-referrer")

            with urllib.request.urlopen(
                base + "/api/status?client_id=" + client_id
            ) as response:
                self.assertEqual(response.status, 200)
                payload = json.loads(response.read().decode("utf-8"))
                self.assertEqual(payload["accounts"], [])

            request = urllib.request.Request(
                base + "/progress?client_id=" + client_id,
                headers={"Host": "example.com"},
            )
            with self.assertRaises(urllib.error.HTTPError) as denied:
                urllib.request.urlopen(request)
            self.assertEqual(denied.exception.code, 403)
            denied.exception.close()

    def test_game_mode_does_not_open_a_progress_page(self):
        account = {
            "id": "game-account",
            "running": True,
            "finished": False,
            "lines": [],
            "_client_id": "123e4567-e89b-12d3-a456-426614174000",
            "_stop_event": threading.Event(),
        }
        server._stop.clear()

        with (
            patch.object(server, "_browser_visible", True),
            patch.object(server, "_acquire_worker_slot", return_value=True),
            patch.object(server, "_release_worker_slot"),
            patch.object(server, "_run_gfq", return_value=(True, "completed")),
            patch.object(server, "_finalize"),
            patch.object(server.webbrowser, "open") as open_browser,
        ):
            server._worker(account, "student", "password", "game", {})

        open_browser.assert_not_called()

    def test_admin_skip_runs_queued_account_without_stopping_current_account(self):
        first_started = threading.Event()
        second_started = threading.Event()
        release_first = threading.Event()
        release_second = threading.Event()
        headless_values = []

        def fake_solver(_acct, code, *_args, **kwargs):
            headless_values.append(kwargs["headless"])
            if code == "student-1":
                first_started.set()
                release_first.wait(timeout=3)
            else:
                second_started.set()
                release_second.wait(timeout=3)
            return True, "completed"

        with server._lock:
            server._accounts = []
        with server._concurrency_lock:
            server._active_workers = 0
        server._stop.clear()

        try:
            with (
                patch.object(server, "_run_spx", side_effect=fake_solver),
                patch.object(server, "_browser_visible", True),
            ):
                ok, _ = server._start(
                    [{"mode": "spx", "subject": "7"}],
                    [("student-1", "password-1"), ("student-2", "password-2")],
                )
                self.assertTrue(ok)
                self.assertTrue(first_started.wait(timeout=2))

                with server._lock:
                    queued = next(
                        account for account in server._accounts
                        if account["code"] == "student-2"
                    )
                with self._running_api() as base:
                    request = urllib.request.Request(
                        base + "/api/admin/start-now",
                        data=json.dumps({"id": queued["id"]}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(request) as response:
                        result = json.loads(response.read().decode("utf-8"))
                ok, message = result["ok"], result["message"]
                self.assertTrue(ok, message)
                self.assertTrue(second_started.wait(timeout=2))
                self.assertTrue(queued["running"])
                self.assertFalse(release_first.is_set())
                with server._lock:
                    first = next(
                        account for account in server._accounts
                        if account["code"] == "student-1"
                    )
                self.assertTrue(first["running"])
                self.assertEqual(headless_values, [False, False])
                with server._concurrency_lock:
                    self.assertEqual(server._active_workers, 2)

                release_first.set()
                release_second.set()
                deadline = time.time() + 3
                while server._running_count() and time.time() < deadline:
                    time.sleep(0.01)
                self.assertEqual(server._running_count(), 0)
        finally:
            release_first.set()
            release_second.set()
            deadline = time.time() + 3
            while server._running_count() and time.time() < deadline:
                time.sleep(0.01)
            with server._lock:
                server._accounts = []
            with server._concurrency_lock:
                server._active_workers = 0
                server._current_concurrency = 1

    def test_solver_concurrency_is_always_one(self):
        self.assertEqual(server._set_concurrency(12), 1)
        self.assertEqual(server._set_concurrency("invalid"), 1)

    def test_local_jobs_never_run_at_the_same_time(self):
        active = 0
        maximum_active = 0
        active_lock = threading.Lock()

        def fake_solver(*args, **kwargs):
            nonlocal active, maximum_active
            with active_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.03)
            with active_lock:
                active -= 1
            return True, "completed"

        with server._lock:
            server._accounts = []
        server._stop.clear()

        try:
            with patch.object(server, "_run_spx", side_effect=fake_solver):
                ok, _ = server._start(
                    [{"mode": "spx", "subject": "7"}],
                    [("student-1", "password-1"), ("student-2", "password-2")],
                )
                self.assertTrue(ok)
                deadline = time.time() + 3
                while server._running_count() and time.time() < deadline:
                    time.sleep(0.01)

            self.assertEqual(server._running_count(), 0)
            self.assertEqual(maximum_active, 1)
        finally:
            with server._lock:
                server._accounts = []

    def test_database_mode_delegates_enqueuing_without_local_workers(self):
        class FakeQueue:
            def enqueue(self, plan, accounts, maximum, client_id):
                self.request = (plan, accounts, maximum, client_id)
                return 2, 0, "operation-id"

        fake_queue = FakeQueue()
        with (
            patch.object(server, "_queue_store", fake_queue),
            patch.object(server.threading, "Thread") as thread,
        ):
            ok, message = server._start(
                [{"mode": "spx", "subject": "7", "detail": "SPX"}],
                [("student-1", "password-1")],
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            )

        self.assertTrue(ok)
        self.assertIn("طابور الانتظار", message)
        self.assertEqual(fake_queue.request[2], server.MAX_ACCOUNTS)
        self.assertEqual(fake_queue.request[3], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        thread.assert_not_called()

    def test_queue_position_and_total_decrease_when_an_earlier_job_finishes(self):
        client_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        accounts = [
            {"running": True, "finished": False, "phase": "في قائمة الانتظار...", "_client_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "_queue_order": 1},
            {"running": True, "finished": False, "phase": "في قائمة الانتظار...", "_client_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "_queue_order": 2},
            {"running": True, "finished": False, "phase": "في قائمة الانتظار...", "_client_id": client_id, "_queue_order": 3},
        ]

        before = server._local_queue_metrics(accounts, client_id)
        accounts[0]["running"] = False
        accounts[0]["finished"] = True
        after = server._local_queue_metrics(accounts, client_id)

        self.assertEqual(before["queue_total"], 3)
        self.assertEqual(before["queue_ahead"], 2)
        self.assertEqual(before["queue_position"], 3)
        self.assertEqual(after["queue_total"], 2)
        self.assertEqual(after["queue_ahead"], 1)
        self.assertEqual(after["queue_position"], 2)
        self.assertEqual(after["running_count"], 1)

    def test_public_status_and_stop_require_a_session_id(self):
        server._stop.clear()
        with patch.object(server, "_queue_store", None), self._running_api() as base:
            with self.assertRaises(urllib.error.HTTPError) as status_error:
                urllib.request.urlopen(base + "/api/status")
            self.assertEqual(status_error.exception.code, 400)
            status_error.exception.close()

            request = urllib.request.Request(
                base + "/api/stop",
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as stop_error:
                urllib.request.urlopen(request)
            self.assertEqual(stop_error.exception.code, 400)
            stop_error.exception.close()
            self.assertFalse(server._stop.is_set())

            request = urllib.request.Request(
                base + "/api/clear_finished",
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as clear_error:
                urllib.request.urlopen(request)
            self.assertEqual(clear_error.exception.code, 400)
            clear_error.exception.close()

            request = urllib.request.Request(
                base + "/api/start",
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as start_error:
                urllib.request.urlopen(request)
            self.assertEqual(start_error.exception.code, 400)
            start_error.exception.close()

    def test_public_status_only_returns_the_requested_session(self):
        first_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        accounts = []
        with (
            patch.object(server, "_accounts", accounts),
            patch.object(server, "_queue_store", None),
            self._running_api() as base,
        ):
            cookie_jar = CookieJar()
            client = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(cookie_jar)
            )
            with client.open(base + "/api/status?client_id=" + first_id) as response:
                token = next(
                    cookie.value for cookie in cookie_jar
                    if cookie.name == "quizora_owner"
                )
                owner_key = hashlib.sha256(
                    ("anonymous:" + token).encode("ascii")
                ).hexdigest()
                accounts.append({
                    "id": "first",
                    "code": "student-first",
                    "mode": "spx",
                    "detail": "test",
                    "running": False,
                    "finished": True,
                    "success": True,
                    "message": "",
                    "phase": "done",
                    "progress": {},
                    "lines": [],
                    "_client_id": first_id,
                    "_owner_key": owner_key,
                })
            with client.open(base + "/api/status?client_id=" + first_id) as response:
                payload = json.loads(response.read().decode("utf-8"))

        self.assertEqual([account["code"] for account in payload["accounts"]], ["student-first"])

    def test_public_start_rate_limit_is_per_client_ip(self):
        with (
            patch.object(server, "_start_requests", {}),
            patch.object(server, "_start_rate_lock", threading.Lock()),
        ):
            for _ in range(server.START_RATE_LIMIT):
                allowed, retry_after = server._allow_public_start("192.0.2.4")
                self.assertTrue(allowed)
                self.assertEqual(retry_after, 0)
            allowed, retry_after = server._allow_public_start("192.0.2.4")
            self.assertFalse(allowed)
            self.assertGreater(retry_after, 0)

    def test_public_api_disables_global_controls_and_game_results(self):
        with patch.object(server, "_queue_store", None), self._running_api() as base:
            with self.assertRaises(urllib.error.HTTPError) as results_error:
                urllib.request.urlopen(base + "/api/game_results")
            self.assertEqual(results_error.exception.code, 403)
            results_error.exception.close()

            request = urllib.request.Request(
                base + "/api/concurrency",
                data=b'{"concurrency":20}',
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as concurrency_error:
                urllib.request.urlopen(request)
            self.assertEqual(concurrency_error.exception.code, 403)
            concurrency_error.exception.close()

    def test_fernet_ciphertext_does_not_contain_the_original_secret(self):
        queue = PostgresQueue(
            "postgresql://unused",
            Fernet.generate_key().decode("ascii"),
        )
        secret = "sample-password-123"

        encrypted = queue._encrypt(secret)

        self.assertNotEqual(encrypted, secret)
        self.assertNotIn(secret, encrypted)
        self.assertEqual(queue._decrypt(encrypted), secret)

    def test_unpadded_fernet_key_remains_compatible_with_stored_ciphertext(self):
        padded_key = Fernet.generate_key()
        unpadded_key = padded_key.rstrip(b"=")
        padded_queue = PostgresQueue("postgresql://unused", padded_key.decode("ascii"))
        unpadded_queue = PostgresQueue("postgresql://unused", unpadded_key.decode("ascii"))

        encrypted = padded_queue._encrypt("existing-account-code")

        self.assertEqual(unpadded_queue._decrypt(encrypted), "existing-account-code")
        self.assertEqual(padded_queue._fingerprint_key, unpadded_queue._fingerprint_key)

    def test_successful_database_job_persists_only_encrypted_account_code(self):
        queue = PostgresQueue(
            "postgresql://unused",
            Fernet.generate_key().decode("ascii"),
        )
        job_id = "123e4567-e89b-12d3-a456-426614174000"
        encrypted_code = queue._encrypt("solved-code")
        connection = MagicMock()
        connection.__enter__.return_value = connection
        cursor = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchone.return_value = {
            "operation_id": uuid.UUID("123e4567-e89b-12d3-a456-426614174001"),
            "code_ciphertext": encrypted_code,
        }

        with patch.object(queue, "_connect", return_value=connection):
            queue.finish_job(
                job_id,
                True,
                False,
                "completed",
                "انتهى",
                duration_seconds=42,
                mode="spx",
                detail="الثقافة المالية",
            )

        inserts = [
            call for call in cursor.execute.call_args_list
            if "INSERT INTO quizora_solved_accounts" in call.args[0]
        ]
        self.assertEqual(len(inserts), 1)
        self.assertEqual(
            inserts[0].args[1],
            (uuid.UUID(job_id), encrypted_code, "spx", "الثقافة المالية", 42),
        )
        update = next(
            call for call in cursor.execute.call_args_list
            if "UPDATE quizora_jobs" in call.args[0]
        )
        self.assertIn("password_ciphertext = NULL", update.args[0])

    def test_database_solved_history_reset_runs_only_once(self):
        queue = PostgresQueue(
            "postgresql://unused",
            Fernet.generate_key().decode("ascii"),
        )

        def make_connection(history_version):
            connection = MagicMock()
            connection.__enter__.return_value = connection
            cursor = MagicMock()
            connection.cursor.return_value.__enter__.return_value = cursor
            cursor.fetchone.side_effect = [history_version, None]
            return connection, cursor

        first_connection, first_cursor = make_connection(None)
        with patch.object(queue, "_connect", return_value=first_connection):
            queue.initialize()
        first_statements = [call.args[0] for call in first_cursor.execute.call_args_list]
        self.assertIn("DELETE FROM quizora_solved_accounts", first_statements)
        self.assertTrue(any("INSERT INTO quizora_metadata" in sql for sql in first_statements))

        migrated_connection, migrated_cursor = make_connection({"value": 1})
        with patch.object(queue, "_connect", return_value=migrated_connection):
            queue.initialize()
        migrated_statements = [call.args[0] for call in migrated_cursor.execute.call_args_list]
        self.assertNotIn("DELETE FROM quizora_solved_accounts", migrated_statements)


if __name__ == "__main__":
    unittest.main()
