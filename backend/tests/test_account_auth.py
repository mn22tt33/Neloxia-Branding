import json
import threading
import unittest
import urllib.error
import urllib.request
import os
from unittest.mock import MagicMock, patch

os.environ["QUIZORA_TEST_MODE"] = "1"

from backend import server
from backend.account_auth import verify_google_credential


class GoogleAuthTests(unittest.TestCase):
    @staticmethod
    def _open_json(opener, url, method="GET", payload=None, headers=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request_headers = dict(headers or {})
        if body:
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            url, data=body, method=method, headers=request_headers
        )
        with opener.open(request) as response:
            return response.status, response.headers, json.loads(response.read())

    def test_google_id_token_claims_require_verified_email_and_matching_nonce(self):
        claims = {
            "iss": "https://accounts.google.com",
            "email_verified": True,
            "sub": "google-user-id",
            "email": "User@Example.com",
            "name": "Test User",
            "nonce": "n" * 32,
        }
        with patch(
            "google.oauth2.id_token.verify_oauth2_token",
            return_value=claims,
        ) as verify:
            identity = verify_google_credential("signed-token", "client-id", "n" * 32)
        verify.assert_called_once()
        self.assertEqual(identity["email"], "user@example.com")
        self.assertEqual(identity["google_sub"], "google-user-id")

        with patch(
            "google.oauth2.id_token.verify_oauth2_token",
            return_value=dict(claims, nonce="x" * 32),
        ):
            with self.assertRaisesRegex(ValueError, "غير مطابقة"):
                verify_google_credential("signed-token", "client-id", "n" * 32)

        with patch(
            "google.oauth2.id_token.verify_oauth2_token",
            return_value=dict(claims, email_verified=False),
        ):
            with self.assertRaisesRegex(ValueError, "موثّق"):
                verify_google_credential("signed-token", "client-id", "n" * 32)

    def test_auth_status_disables_login_until_database_and_google_are_configured(self):
        with (
            patch.object(server, "AUTH_REQUIRED", False),
            patch.object(server, "GOOGLE_CLIENT_ID", ""),
            patch.object(server, "ADMIN_EMAIL", ""),
            patch.object(server, "_auth_store", None),
            patch.object(server, "_queue_store", None),
            self._running_api() as base,
        ):
            status, _, info = self._open_json(
                urllib.request.build_opener(), base + "/api/auth/status"
            )
        self.assertEqual(status, 200)
        self.assertFalse(info["enabled"])
        self.assertEqual(info["google_client_id"], "")

    def test_google_login_verifies_identity_and_uses_http_only_session_cookie(self):
        auth_store = MagicMock()
        auth_store.allow_login.return_value = True
        auth_store.upsert_google_user.return_value = {
            "id": "user-1",
            "full_name": "Test User",
            "email": "user@example.com",
            "role": "user",
        }
        auth_store.create_session.return_value = "s" * 43
        nonce = "n" * 32
        with (
            patch.object(server, "GOOGLE_CLIENT_ID", "client-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            patch(
                "backend.server.verify_google_credential",
                return_value={
                    "google_sub": "google-user-id",
                    "email": "user@example.com",
                    "full_name": "Test User",
                },
            ),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/google/login",
                data=json.dumps({
                    "credential": "t" * 120,
                    "nonce": nonce,
                }).encode("utf-8"),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Origin": "https://quizora.movb.workers.dev",
                },
            )
            with urllib.request.urlopen(request) as response:
                payload = json.loads(response.read())
                cookie = response.headers["Set-Cookie"]
                self.assertEqual(
                    response.headers["Access-Control-Allow-Credentials"], "true"
                )
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("SameSite=None", cookie)
        self.assertNotIn("s" * 43, json.dumps(payload))
        auth_store.upsert_google_user.assert_called_once()

    def test_auth_status_exposes_public_client_id_only_when_fully_enabled(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "GOOGLE_CLIENT_ID", "public-client-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            _, _, status = self._open_json(
                urllib.request.build_opener(), base + "/api/auth/status"
            )
        self.assertTrue(status["enabled"])
        self.assertEqual(status["google_client_id"], "public-client-id")
        self.assertTrue(status["required"])

    def test_login_rejects_unapproved_origin_before_creating_a_user(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "GOOGLE_CLIENT_ID", "client-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/google/login",
                data=json.dumps({
                    "credential": "t" * 120,
                    "nonce": "n" * 32,
                }).encode("utf-8"),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Origin": "https://attacker.example",
                },
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request)
            self.assertEqual(rejected.exception.code, 403)
            rejected.exception.close()
        auth_store.upsert_google_user.assert_not_called()

    def test_protected_queue_routes_require_google_session_when_auth_is_configured(self):
        auth_store = MagicMock()
        auth_store.get_session_user.return_value = None
        client_id = "123e4567-e89b-12d3-a456-426614174000"
        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "GOOGLE_CLIENT_ID", "client-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/status?client_id=" + client_id
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request)
            self.assertEqual(rejected.exception.code, 401)
            rejected.exception.close()

            request = urllib.request.Request(
                base + "/api/start",
                data=json.dumps({
                    "client_id": client_id,
                    "accounts": [{"code": "test", "password": "test"}],
                }).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request)
            self.assertEqual(rejected.exception.code, 401)
            rejected.exception.close()

    def test_admin_routes_require_local_admin_role_after_auth_is_enabled(self):
        auth_store = MagicMock()
        auth_store.get_session_user.return_value = {
            "id": "user-1",
            "full_name": "Test User",
            "email": "user@example.com",
            "role": "user",
        }
        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "GOOGLE_CLIENT_ID", "client-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            patch.object(server, "_admin_queue_payload", return_value={"ok": True}),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/admin/queue",
                headers={"Cookie": "quizora_session=" + ("s" * 43)},
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request)
            self.assertEqual(rejected.exception.code, 403)
            rejected.exception.close()

            auth_store.get_session_user.return_value["role"] = "admin"
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)

    @staticmethod
    def _running_api():
        from contextlib import contextmanager

        @contextmanager
        def running():
            httpd = server.ThreadingHTTPServer(
                ("127.0.0.1", 0), server.make_handler()
            )
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                yield "http://127.0.0.1:%d" % httpd.server_address[1]
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=2)

        return running()


if __name__ == "__main__":
    unittest.main()
