import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from unittest.mock import patch

from cryptography.fernet import Fernet

from backend import server
from backend.queue_store import PostgresQueue


class QueueStorageTests(unittest.TestCase):
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

            with urllib.request.urlopen(base + "/api/admin/queue") as response:
                payload = json.loads(response.read().decode("utf-8"))
                self.assertEqual(response.status, 200)
                self.assertEqual(payload["queue_count"], 0)
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
        second_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        accounts = [
            {
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
            },
            {
                "id": "second",
                "code": "student-second",
                "mode": "spx",
                "detail": "test",
                "running": False,
                "finished": True,
                "success": True,
                "message": "",
                "phase": "done",
                "progress": {},
                "lines": [],
                "_client_id": second_id,
            },
        ]
        with (
            patch.object(server, "_accounts", accounts),
            patch.object(server, "_queue_store", None),
            self._running_api() as base,
        ):
            with urllib.request.urlopen(
                base + "/api/status?client_id=" + first_id
            ) as response:
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


if __name__ == "__main__":
    unittest.main()
