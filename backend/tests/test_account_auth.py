import json
import threading
import tempfile
import unittest
import urllib.error
import urllib.request
import os
from unittest.mock import MagicMock, patch

os.environ["QUIZORA_TEST_MODE"] = "1"

from backend import server
from backend.account_auth import (
    hash_password,
    verify_firebase_credential,
    verify_password,
)


class FirebaseAuthTests(unittest.TestCase):
    def test_server_binds_to_loopback_outside_railway(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(server._server_bind_host(), "127.0.0.1")

    def test_server_binds_to_all_interfaces_on_railway(self):
        with patch.dict(os.environ, {"RAILWAY_ENVIRONMENT": "production"}, clear=True):
            self.assertEqual(server._server_bind_host(), "0.0.0.0")

    def test_versioned_config_route_serves_static_file(self):
        with self._running_api() as base:
            with urllib.request.urlopen(base + "/config.js?v=1.3.0") as response:
                body = response.read()
                self.assertEqual(response.status, 200)
        self.assertIn(b"window.APP_CONFIG", body)

    def test_app_page_redirects_to_login_without_a_session(self):
        auth_store = MagicMock()
        auth_store.get_session_user.return_value = None

        class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            opener = urllib.request.build_opener(NoRedirectHandler)
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                opener.open(base + "/?source=test")
            self.assertEqual(rejected.exception.code, 302)
            self.assertEqual(
                rejected.exception.headers["Location"],
                "/account.html?next=%2F%3Fsource%3Dtest",
            )
            rejected.exception.close()

    def test_app_page_is_served_to_authenticated_user(self):
        auth_store = MagicMock()
        auth_store.get_session_user.return_value = {
            "id": "user-1",
            "full_name": "Test User",
            "email": "user@example.com",
            "role": "user",
        }
        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/index.html",
                headers={"Cookie": "quizora_session=" + ("s" * 43)},
            )
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(b"<title>QUIZORA</title>", response.read())

    def test_app_page_fails_closed_when_authentication_is_not_configured(self):
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", ""),
            patch.object(server, "ADMIN_EMAIL", ""),
            patch.object(server, "_auth_store", None),
            patch.object(server, "_queue_store", None),
            self._running_api() as base,
        ):
            with urllib.request.urlopen(base + "/") as response:
                self.assertEqual(response.status, 200)
                self.assertIn("/account.html?next=%2F", response.url)
                self.assertIn("تسجيل الدخول".encode("utf-8"), response.read())

    def test_api_only_deployment_does_not_redirect_to_missing_frontend(self):
        with tempfile.TemporaryDirectory() as app_dir:
            with (
                patch.object(server, "APP_DIR", app_dir),
                patch.object(server, "AUTH_REQUIRED", True),
                self._running_api() as base,
            ):
                with self.assertRaises(urllib.error.HTTPError) as missing:
                    urllib.request.urlopen(base + "/")
                self.assertEqual(missing.exception.code, 404)
                self.assertIn(
                    b"frontend is hosted separately",
                    missing.exception.read(),
                )
                missing.exception.close()

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

    def test_firebase_token_requires_google_provider_and_verified_email(self):
        claims = {
            "email_verified": True,
            "sub": "firebase-user-id",
            "email": "User@Example.com",
            "name": "Test User",
            "firebase": {"sign_in_provider": "google.com"},
        }
        with patch(
            "google.oauth2.id_token.verify_firebase_token",
            return_value=claims,
        ) as verify:
            identity = verify_firebase_credential("signed-token", "project-id")
        verify.assert_called_once_with(
            "signed-token",
            unittest.mock.ANY,
            audience="project-id",
        )
        self.assertEqual(identity["email"], "user@example.com")
        self.assertEqual(identity["firebase_uid"], "firebase-user-id")

        with patch(
            "google.oauth2.id_token.verify_firebase_token",
            return_value=dict(
                claims, firebase={"sign_in_provider": "password"}
            ),
        ):
            with self.assertRaisesRegex(ValueError, "باستخدام Google"):
                verify_firebase_credential("signed-token", "project-id")

        with patch(
            "google.oauth2.id_token.verify_firebase_token",
            return_value=dict(claims, email_verified=False),
        ):
            with self.assertRaisesRegex(ValueError, "موثّق"):
                verify_firebase_credential("signed-token", "project-id")

    def test_password_hash_is_salted_and_verified(self):
        first = hash_password("correct horse battery")
        second = hash_password("correct horse battery")
        self.assertNotEqual(first, second)
        self.assertTrue(verify_password("correct horse battery", first))
        self.assertFalse(verify_password("incorrect password", first))
        with self.assertRaisesRegex(ValueError, "بين 8 و128"):
            hash_password("short")

    def test_auth_status_disables_login_until_database_and_firebase_are_configured(self):
        with (
            patch.object(server, "AUTH_REQUIRED", False),
            patch.object(server, "FIREBASE_PROJECT_ID", ""),
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

    def test_firebase_login_requires_existing_account_and_uses_http_only_cookie(self):
        auth_store = MagicMock()
        auth_store.allow_login.return_value = True
        auth_store.find_firebase_user.return_value = {
            "id": "user-1",
            "full_name": "Test User",
            "email": "user@example.com",
            "role": "user",
        }
        auth_store.create_session.return_value = "s" * 43
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            patch(
                "backend.server.verify_firebase_credential",
                return_value={
                    "firebase_uid": "firebase-user-id",
                    "email": "user@example.com",
                    "full_name": "Test User",
                },
            ),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/firebase/login",
                data=json.dumps({
                    "id_token": "t" * 120,
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
        auth_store.find_firebase_user.assert_called_once()

    def test_firebase_login_does_not_create_an_unregistered_account(self):
        auth_store = MagicMock()
        auth_store.allow_login.return_value = True
        auth_store.find_firebase_user.return_value = None
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            patch(
                "backend.server.verify_firebase_credential",
                return_value={
                    "firebase_uid": "firebase-user-id",
                    "email": "new@example.com",
                    "full_name": "New User",
                },
            ),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/firebase/login",
                data=json.dumps({"id_token": "t" * 120}).encode("utf-8"),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Origin": "https://quizora.movb.workers.dev",
                },
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request)
            self.assertEqual(rejected.exception.code, 404)
            rejected.exception.close()
        auth_store.create_firebase_user.assert_not_called()

    def test_firebase_registration_saves_name_and_password_hash(self):
        auth_store = MagicMock()
        auth_store.allow_login.return_value = True
        auth_store.create_firebase_user.return_value = {
            "id": "user-1",
            "full_name": "New User",
            "email": "user@example.com",
            "role": "user",
        }
        auth_store.create_session.return_value = "s" * 43
        identity = {
            "firebase_uid": "firebase-user-id",
            "email": "user@example.com",
            "full_name": "Google Name",
        }
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            patch(
                "backend.server.verify_firebase_credential",
                return_value=identity,
            ),
            patch("backend.server.hash_password", return_value="stored-hash"),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/firebase/register",
                data=json.dumps({
                    "id_token": "t" * 120,
                    "full_name": "New User",
                    "password": "correct horse battery",
                    "password_confirmation": "correct horse battery",
                }).encode("utf-8"),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Origin": "https://quizora.movb.workers.dev",
                },
            )
            with urllib.request.urlopen(request) as response:
                payload = json.loads(response.read())
                self.assertEqual(response.status, 201)
                self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        auth_store.create_firebase_user.assert_called_once_with(
            identity, "New User", "stored-hash", "admin@example.com"
        )
        self.assertNotIn("password", json.dumps(payload))

    def test_firebase_registration_rejects_mismatched_password_confirmation(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/firebase/register",
                data=json.dumps({
                    "id_token": "t" * 120,
                    "full_name": "New User",
                    "password": "correct horse battery",
                    "password_confirmation": "different password",
                }).encode("utf-8"),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Origin": "https://quizora.movb.workers.dev",
                },
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request)
            self.assertEqual(rejected.exception.code, 400)
            rejected.exception.close()
        auth_store.create_firebase_user.assert_not_called()

    def test_password_login_uses_existing_session_cookie_flow(self):
        auth_store = MagicMock()
        auth_store.allow_password_login.return_value = True
        auth_store.authenticate_password.return_value = {
            "id": "user-1",
            "full_name": "Test User",
            "email": "user@example.com",
            "role": "user",
        }
        auth_store.create_session.return_value = "s" * 43
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/password/login",
                data=json.dumps({
                    "email": "User@Example.com",
                    "password": "correct horse battery",
                }).encode("utf-8"),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Origin": "https://quizora.movb.workers.dev",
                },
            )
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        auth_store.allow_password_login.assert_called_once_with(
            "user@example.com", unittest.mock.ANY
        )
        auth_store.authenticate_password.assert_called_once_with(
            "user@example.com", "correct horse battery"
        )

    def test_auth_status_is_enabled_only_when_firebase_is_configured(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
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
        self.assertTrue(status["required"])

    def test_login_rejects_unapproved_origin_before_creating_a_user(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "ADMIN_EMAIL", "admin@example.com"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/firebase/login",
                data=json.dumps({
                    "id_token": "t" * 120,
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
        auth_store.upsert_firebase_user.assert_not_called()

    def test_protected_queue_routes_require_firebase_session_when_auth_is_configured(self):
        auth_store = MagicMock()
        auth_store.get_session_user.return_value = None
        client_id = "123e4567-e89b-12d3-a456-426614174000"
        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
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
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
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
