import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import MagicMock, patch

os.environ["QUIZORA_TEST_MODE"] = "1"

from backend import server
from backend.account_auth import (
    SESSION_TTL_SECONDS,
    hash_password,
    verify_firebase_credential,
    verify_password,
)


class _QueueStoreStub:
    def get_site_enabled(self):
        return True

    def get_public_unlimited(self):
        return False


class FirebaseAuthTests(unittest.TestCase):
    def test_server_binds_to_loopback_outside_railway(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(server._server_bind_host(), "127.0.0.1")

    def test_server_binds_to_all_interfaces_on_railway(self):
        with patch.dict(os.environ, {"RAILWAY_ENVIRONMENT": "production"}, clear=True):
            self.assertEqual(server._server_bind_host(), "0.0.0.0")

    def test_server_binds_to_configured_host_in_termux(self):
        with patch.dict(os.environ, {"QUIZORA_BIND_HOST": "0.0.0.0"}, clear=True):
            self.assertEqual(server._server_bind_host(), "0.0.0.0")

    def test_versioned_config_route_serves_static_file(self):
        with self._running_api() as base:
            with urllib.request.urlopen(base + "/config.js?v=1.1.3") as response:
                body = response.read()
                self.assertEqual(response.status, 200)
        self.assertIn(b"window.APP_CONFIG", body)

    def test_account_page_shows_the_current_version(self):
        with self._running_api() as base:
            with urllib.request.urlopen(base + "/account.html") as response:
                page = response.read().decode("utf-8")

        self.assertIn('class="version-badge"', page)
        self.assertIn("v1.2.4", page)
        self.assertIn('id="continueToSite"', page)
        self.assertIn('<main id="accountMain" hidden>', page)
        self.assertIn('id="serverOfflineNotice"', page)
        self.assertIn('class="server-offline-overlay" id="serverOfflineNotice"', page)
        self.assertNotIn('id="logout"', page)

    def test_app_does_not_persist_account_credentials_in_browser_state(self):
        import pathlib

        page = pathlib.Path(
            server.APP_DIR
        ).joinpath("frontend", "index.html").read_text(encoding="utf-8")

        self.assertIn('autocomplete="off"', page)
        self.assertIn('autocomplete="new-password"', page)
        self.assertNotIn("accounts: state.accounts.map", page)
        self.assertNotIn("password: account.password", page)

    def test_account_page_treats_missing_session_as_login_not_offline(self):
        import pathlib

        page = pathlib.Path(
            server.APP_DIR
        ).joinpath("frontend", "account.html").read_text(encoding="utf-8")

        self.assertIn("if (error.status !== 401) throw error;", page)
        self.assertIn("if (result && result.user)", page)
        self.assertIn("showLogin();", page)

    def test_account_page_stores_and_sends_bearer_session_fallback(self):
        import pathlib

        account_page = pathlib.Path(
            server.APP_DIR
        ).joinpath("frontend", "account.html").read_text(encoding="utf-8")
        main_page = pathlib.Path(
            server.APP_DIR
        ).joinpath("frontend", "index.html").read_text(encoding="utf-8")

        self.assertIn("quizora_session_token", account_page)
        self.assertIn("Authorization", account_page)
        self.assertIn("Bearer", account_page)
        self.assertIn("quizora_session_token", main_page)
        self.assertIn("Authorization", main_page)

    def test_app_page_redirects_to_login_without_a_session(self):
        auth_store = MagicMock()
        auth_store.get_session_user.return_value = None

        class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
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
                page = response.read()
                self.assertIn(b"<title>QUIZORA</title>", page)
                self.assertIn(b'id="profileButton"', page)
                self.assertIn(b'id="profileDialog"', page)
                self.assertIn(
                    "Max-Age=%d" % SESSION_TTL_SECONDS,
                    response.headers["Set-Cookie"],
                )

    def test_app_page_fails_closed_when_authentication_is_not_configured(self):
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", ""),
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

    def test_admin_provisioning_stores_only_password_hash_in_database(self):
        store = object.__new__(server.PostgresAuthStore)
        password = "temporary-test-password"
        encoded_hash = hash_password(password)
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        connection = MagicMock()
        connection.cursor.return_value = cursor_context
        connection_context = MagicMock()
        connection_context.__enter__.return_value = connection
        store._connect = MagicMock(return_value=connection_context)

        provisioned_id = store.provision_admin(
            "admin@example.test",
            "Site Admin",
            encoded_hash,
        )

        insert = next(
            call for call in cursor.execute.call_args_list
            if "INSERT INTO quizora_users" in call.args[0]
        )
        self.assertIn("'admin'", insert.args[0])
        self.assertEqual(insert.args[1][-1], encoded_hash)
        self.assertNotIn(password, insert.args[0])
        self.assertNotIn(password, insert.args[1])
        self.assertTrue(verify_password(password, insert.args[1][-1]))
        self.assertNotEqual(provisioned_id, password)

    def test_password_login_rejects_blocked_account(self):
        auth_store = MagicMock()
        auth_store.allow_password_login.return_value = True
        auth_store.authenticate_password.side_effect = server.AccountBlockedError(
            "تم حظر هذا الحساب."
        )
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/password/login",
                data=json.dumps({
                    "email": "blocked@example.com",
                    "password": "correct-password",
                }).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request)
            self.assertEqual(rejected.exception.code, 403)
            rejected.exception.close()
        auth_store.create_session.assert_not_called()

    def test_blocking_account_clears_its_persistent_sessions(self):
        store = object.__new__(server.PostgresAuthStore)
        user_id = "123e4567-e89b-12d3-a456-426614174000"
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"id": user_id, "role": "user"},
            {
                "id": user_id,
                "full_name": "Quizora User",
                "email": "user@example.com",
                "role": "user",
                "is_blocked": True,
                "created_at": "2026-11-18 00:00:00+00",
            },
        ]
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        connection = MagicMock()
        connection.cursor.return_value = cursor_context
        connection_context = MagicMock()
        connection_context.__enter__.return_value = connection
        store._connect = MagicMock(return_value=connection_context)

        updated = store.set_user_blocked(user_id, True, "admin-id")

        self.assertTrue(updated["is_blocked"])
        self.assertIn(
            "DELETE FROM quizora_user_sessions",
            cursor.execute.call_args_list[2].args[0],
        )
        self.assertEqual(
            cursor.execute.call_args_list[2].args[1],
            (user_id,),
        )

    def test_blocked_account_cannot_use_an_existing_session(self):
        store = object.__new__(server.PostgresAuthStore)
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        connection = MagicMock()
        connection.cursor.return_value = cursor_context
        connection_context = MagicMock()
        connection_context.__enter__.return_value = connection
        store._connect = MagicMock(return_value=connection_context)

        self.assertIsNone(store.get_session_user("s" * 43))
        self.assertIn(
            "account.is_blocked = FALSE",
            cursor.execute.call_args.args[0],
        )

    def test_auth_status_disables_login_until_database_and_firebase_are_configured(self):
        with (
            patch.object(server, "AUTH_REQUIRED", False),
            patch.object(server, "FIREBASE_PROJECT_ID", ""),
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
        self.assertIn("Max-Age=%d" % SESSION_TTL_SECONDS, cookie)
        self.assertIn("session_token", payload)
        self.assertEqual(payload["session_token"], "s" * 43)
        auth_store.find_firebase_user.assert_called_once()

    def test_created_sessions_have_no_database_expiration(self):
        store = object.__new__(server.PostgresAuthStore)
        cursor = MagicMock()
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        connection = MagicMock()
        connection.cursor.return_value = cursor_context
        connection_context = MagicMock()
        connection_context.__enter__.return_value = connection
        store._connect = MagicMock(return_value=connection_context)

        token = store.create_session("user-1")

        query, parameters = cursor.execute.call_args.args
        self.assertIn("VALUES (%s, %s, NULL)", query)
        self.assertEqual(parameters[1], "user-1")
        self.assertEqual(len(token), 43)

    def test_session_schema_migration_preserves_existing_sessions(self):
        store = object.__new__(server.PostgresAuthStore)
        cursor = MagicMock()
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        connection = MagicMock()
        connection.cursor.return_value = cursor_context
        connection_context = MagicMock()
        connection_context.__enter__.return_value = connection
        store._connect = MagicMock(return_value=connection_context)

        store.initialize()

        statements = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertIn(
            "ALTER TABLE quizora_user_sessions ALTER COLUMN expires_at DROP NOT NULL",
            statements,
        )
        self.assertTrue(any(
            "UPDATE quizora_user_sessions SET expires_at = NULL" in statement
            and "WHERE expires_at > now()" in statement
            for statement in statements
        ))

    def test_logout_endpoint_revokes_session_and_clears_cookie(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "_queue_store", _QueueStoreStub()),
            patch.object(server, "_auth_store", auth_store),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/logout",
                data=b"{}",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Cookie": "quizora_session=session-1",
                },
            )
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("Max-Age=0", response.headers["Set-Cookie"])
            auth_store.revoke_session.assert_called_once_with("session-1")

    def test_logout_endpoint_revokes_bearer_session(self):
        auth_store = MagicMock()
        token = "s" * 43
        with (
            patch.object(server, "_queue_store", _QueueStoreStub()),
            patch.object(server, "_auth_store", auth_store),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/logout",
                data=b"{}",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token,
                },
            )
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
            auth_store.revoke_session.assert_called_once_with(token)

    def test_blocked_firebase_account_cannot_start_a_session(self):
        auth_store = MagicMock()
        auth_store.allow_login.return_value = True
        auth_store.find_firebase_user.side_effect = server.AccountBlockedError(
            "تم حظر هذا الحساب."
        )
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            patch(
                "backend.server.verify_firebase_credential",
                return_value={
                    "firebase_uid": "blocked-user",
                    "email": "blocked@example.com",
                    "full_name": "Blocked User",
                },
            ),
            self._running_api() as base,
        ):
            request = urllib.request.Request(
                base + "/api/auth/firebase/login",
                data=json.dumps({"id_token": "t" * 120}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request)
            self.assertEqual(rejected.exception.code, 403)
            self.assertIn("تم حظر هذا الحساب", rejected.exception.read().decode("utf-8"))
            rejected.exception.close()
        auth_store.create_session.assert_not_called()

    def test_admin_can_list_block_and_delete_users(self):
        admin = {
            "id": "admin-id",
            "full_name": "Site Admin",
            "email": "admin@example.com",
            "role": "admin",
        }
        auth_store = MagicMock()
        auth_store.get_session_user.return_value = admin
        auth_store.list_users.return_value = {
            "users": [{
                "id": "user-id",
                "full_name": "Quizora User",
                "email": "user@example.com",
                "role": "user",
                "is_blocked": False,
                "created_at": "2026-11-18 00:00:00+00",
            }],
            "total": 1,
            "total_users": 1,
            "active_users": 1,
            "blocked_users": 0,
            "limit": 50,
            "offset": 0,
        }
        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            headers = {"Cookie": "quizora_session=" + ("s" * 43)}
            request = urllib.request.Request(
                base + "/api/admin/users?q=Quizora&status=active",
                headers=headers,
            )
            with urllib.request.urlopen(request) as response:
                payload = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(payload["users"][0]["email"], "user@example.com")
            auth_store.list_users.assert_called_once_with(
                search="Quizora",
                status="active",
                limit=50,
                offset=0,
            )

            for action, expected in (
                ("block", "تم حظر المستخدم وإنهاء جلساته."),
                ("unblock", "تم فك حظر المستخدم؛ عليه تسجيل الدخول مجددًا."),
                ("delete", "تم حذف المستخدم وإنهاء جلساته."),
            ):
                status, _, result = self._open_json(
                    urllib.request.build_opener(),
                    base + "/api/admin/users",
                    method="POST",
                    payload={"id": "123e4567-e89b-12d3-a456-426614174000", "action": action},
                    headers={
                        **headers,
                        "Content-Type": "application/json",
                    },
                )
                self.assertEqual(status, 200)
                self.assertEqual(result["message"], expected)

        auth_store.set_user_blocked.assert_any_call(
            "123e4567-e89b-12d3-a456-426614174000", True, "admin-id"
        )
        auth_store.set_user_blocked.assert_any_call(
            "123e4567-e89b-12d3-a456-426614174000", False, "admin-id"
        )
        auth_store.delete_user.assert_called_once_with(
            "123e4567-e89b-12d3-a456-426614174000", "admin-id"
        )

    def test_admin_user_management_rejects_admin_and_missing_targets(self):
        auth_store = MagicMock()
        auth_store.get_session_user.return_value = {
            "id": "admin-id",
            "role": "admin",
        }
        auth_store.set_user_blocked.side_effect = server.AccountManagementConflictError(
            "لا يمكن حذف حساب مدير أو تعديل حالته."
        )
        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
            patch.object(server, "_auth_store", auth_store),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            for method, status_code, error_type in (
                ("block", 409, server.AccountManagementConflictError),
                ("delete", 404, server.AccountNotFoundError),
            ):
                if method == "block":
                    auth_store.set_user_blocked.side_effect = error_type("مرفوض")
                else:
                    auth_store.delete_user.side_effect = error_type("المستخدم غير موجود.")
                request = urllib.request.Request(
                    base + "/api/admin/users",
                    data=json.dumps({
                        "id": "123e4567-e89b-12d3-a456-426614174000",
                        "action": method,
                    }).encode("utf-8"),
                    method="POST",
                    headers={
                        "Cookie": "quizora_session=" + ("s" * 43),
                        "Content-Type": "application/json",
                    },
                )
                with self.assertRaises(urllib.error.HTTPError) as rejected:
                    urllib.request.urlopen(request)
                self.assertEqual(rejected.exception.code, status_code)
                rejected.exception.close()

    def test_firebase_login_does_not_create_an_unregistered_account(self):
        auth_store = MagicMock()
        auth_store.allow_login.return_value = True
        auth_store.find_firebase_user.return_value = None
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
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
            identity, "New User", "stored-hash"
        )
        self.assertNotIn("password", json.dumps(payload))

    def test_firebase_registration_rejects_mismatched_password_confirmation(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
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

    def test_auth_status_allows_regular_accounts_without_admin_configuration(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
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

    def test_auth_status_stays_disabled_without_firebase_project_id(self):
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", ""),
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", MagicMock()),
            patch.object(server, "_queue_store", object()),
            self._running_api() as base,
        ):
            _, _, status = self._open_json(
                urllib.request.build_opener(), base + "/api/auth/status"
            )
        self.assertFalse(status["enabled"])

    def test_login_rejects_unapproved_origin_before_creating_a_user(self):
        auth_store = MagicMock()
        with (
            patch.object(server, "FIREBASE_PROJECT_ID", "project-id"),
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

    def test_admin_routes_require_admin_role_after_auth_is_enabled(self):
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

    def test_local_admin_routes_work_without_account_auth_configuration(self):
        with (
            patch.object(server, "AUTH_REQUIRED", True),
            patch.object(server, "_auth_store", None),
            patch.object(server, "_queue_store", _QueueStoreStub()),
            self._running_api() as base,
        ):
            with urllib.request.urlopen(base + "/api/admin/settings") as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(json.loads(response.read())["ok"])

    @staticmethod
    def _running_api():
        from contextlib import contextmanager

        @contextmanager
        def running():
            original_queue_store = server._queue_store
            if (
                original_queue_store is not None
                and not callable(getattr(original_queue_store, "get_site_enabled", None))
            ):
                server._queue_store = _QueueStoreStub()
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
                server._queue_store = original_queue_store

        return running()


if __name__ == "__main__":
    unittest.main()
