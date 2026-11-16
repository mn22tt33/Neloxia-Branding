import threading
import time
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet

from backend import server
from backend.queue_store import PostgresQueue


class QueueStorageTests(unittest.TestCase):
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
