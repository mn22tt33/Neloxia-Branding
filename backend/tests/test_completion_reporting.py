import io
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from backend import qureo_solver, server, spx_solver


class CompletionReportingTests(unittest.TestCase):
    def test_spx_run_does_not_create_a_progress_tab(self):
        captured = {}

        class FakeSolver:
            def __init__(self, **kwargs):
                captured.update(kwargs)

            def run(self, *_args, **_kwargs):
                return True, "completed"

        with (
            patch.object(server, "_load_spx", return_value=SimpleNamespace(Solver=FakeSolver)),
            patch.object(server, "_get_spx_bank", return_value={}),
        ):
            result = server._run_spx(
                {"_stop_event": threading.Event()},
                "student",
                "password",
                "7",
                headless=False,
            )

        self.assertTrue(result[0])
        self.assertNotIn("monitor_url", captured)

    def test_qureo_run_does_not_create_a_progress_tab(self):
        captured = {}

        class FakeSolver:
            def __init__(self, **kwargs):
                captured.update(kwargs)

            def run(self, *_args, **_kwargs):
                return True

        with (
            patch.object(server, "_install_qureo", return_value=SimpleNamespace(QureoSolver=FakeSolver)),
            patch.object(server, "_load_qureo_bank", return_value={}),
        ):
            result = server._run_qureo(
                {"_stop_event": threading.Event()},
                "student",
                "password",
                ["JavaScript"],
                headless=False,
            )

        self.assertTrue(result[0])
        self.assertNotIn("monitor_url", captured)

    def test_qureo_fast_login_logs_that_authentication_was_confirmed(self):
        response = SimpleNamespace(status=200)
        context = SimpleNamespace(
            request=SimpleNamespace(post=Mock(return_value=response)),
            storage_state=lambda: {
                "cookies": [{"name": "egy_student_id_token", "value": "token"}]
            },
        )
        solver = SimpleNamespace(
            turbo=True,
            context=context,
            _id_token=lambda: {"available_courses": []},
        )
        module = SimpleNamespace(TP_LOGIN="https://example.test/login")
        login = server._make_fast_login(module, Mock())
        output = io.StringIO()

        with patch("sys.stdout", output):
            login(solver, "student", "password")

        self.assertIn("جاري التحقق من تسجيل الدخول", output.getvalue())
        self.assertIn("تم تأكيد تسجيل الدخول", output.getvalue())
        self.assertTrue(solver._authenticated)

    def test_qureo_fast_login_stops_on_forbidden_response(self):
        response = SimpleNamespace(status=403)
        context = SimpleNamespace(
            request=SimpleNamespace(post=Mock(return_value=response)),
            storage_state=lambda: {"cookies": []},
        )
        solver = SimpleNamespace(turbo=True, context=context, _id_token=lambda: {})
        module = SimpleNamespace(
            TP_LOGIN="https://example.test/login",
            AccessDeniedError=qureo_solver.AccessDeniedError,
        )
        login = server._make_fast_login(module, Mock())

        with self.assertRaisesRegex(qureo_solver.AccessDeniedError, "HTTP 403"):
            login(solver, "student", "password")

    def test_qureo_run_does_not_fallback_after_access_denied(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.courses = ["Python"]
        solver.browser = None
        solver.context = None
        solver.start = Mock()
        solver.login = Mock(side_effect=qureo_solver.AccessDeniedError("HTTP 403"))
        solver._enter_browser_mode = Mock(return_value=True)

        with self.assertRaisesRegex(qureo_solver.AccessDeniedError, "HTTP 403"):
            solver.run("student", "password")

        solver._enter_browser_mode.assert_not_called()

    def test_qureo_course_selection_is_blocked_without_confirmed_login(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver._authenticated = False

        with self.assertRaisesRegex(RuntimeError, "لم يتم تأكيد تسجيل الدخول"):
            solver._enter_course_native("Python")

    def test_qureo_course_match_uses_course_name_metadata(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.lang = "ar"
        solver._id_token = lambda: {
            "available_courses": [
                {
                    "content_id": "python_ar",
                    "course_lang_code": "ar",
                    "course_name": "Python",
                }
            ]
        }

        self.assertEqual(solver._course_content_id("Python"), "python_ar")

    def test_qureo_native_course_selection_searches_iframe_and_localized_label(self):
        class Locator:
            def __init__(self):
                self.clicked = False

            def count(self):
                return 1

            def nth(self, _index):
                return self

            def is_visible(self):
                return True

            def click(self):
                self.clicked = True

        class Frame:
            def __init__(self):
                self.locator = Locator()
                self.labels = []

            def get_by_text(self, label, exact=False):
                self.labels.append((label, exact))
                return self.locator if label == "بايثون" else LocatorWithNoMatch()

        class LocatorWithNoMatch:
            def count(self):
                return 0

        class Page:
            def __init__(self):
                self.frames = [Frame()]
                self.url = "https://me-portal.qureo.education/"
                self.response_handler = None

            def goto(self, *_args, **_kwargs):
                pass

            def locator(self, selector):
                if selector == "#student_id":
                    return SimpleNamespace(is_visible=lambda: False)
                return SimpleNamespace(inner_text=lambda **_kwargs: "")

            def on(self, _event, handler):
                self.response_handler = handler

            def remove_listener(self, _event, _handler):
                self.response_handler = None

            def wait_for_url(self, *_args, **_kwargs):
                pass

        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.page = Page()
        solver._authenticated = True
        solver._browser_auth_cookie_confirmed = False
        solver._id_token = lambda: {}

        with patch.object(qureo_solver.time, "sleep"):
            solver._enter_course_native("Python")

        self.assertTrue(solver.page.frames[0].locator.clicked)
        self.assertIn(("بايثون", False), solver.page.frames[0].labels)

    def test_qureo_native_course_failure_reports_cloudfront_403_and_page_details(self):
        class NoMatchLocator:
            def count(self):
                return 0

        class Frame:
            def get_by_text(self, _label, exact=False):
                return NoMatchLocator()

        class Page:
            def __init__(self):
                self.frames = [Frame()]
                self.url = "https://me-portal.qureo.education/"
                self.response_handler = None

            def on(self, _event, handler):
                self.response_handler = handler

            def remove_listener(self, _event, _handler):
                self.response_handler = None

            def goto(self, *_args, **_kwargs):
                self.response_handler(SimpleNamespace(
                    status=403,
                    url=qureo_solver.BASE + "/api/study/courses",
                ))

            def locator(self, selector):
                if selector == "#student_id":
                    return SimpleNamespace(is_visible=lambda: False)
                return SimpleNamespace(
                    inner_text=lambda **_kwargs: "Access denied by CloudFront"
                )

            def title(self):
                return "403 ERROR"

        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.page = Page()
        solver._authenticated = True
        solver._browser_auth_cookie_confirmed = False
        solver._id_token = lambda: {}
        output = io.StringIO()

        with (
            patch.object(qureo_solver.time, "monotonic", side_effect=[0, 31]),
            patch.object(qureo_solver.time, "sleep"),
            patch("sys.stdout", output),
        ):
            with self.assertRaisesRegex(
                qureo_solver.AccessDeniedError, "HTTP 403"
            ):
                solver._enter_course_native("Python")

        self.assertIn("URL=https://me-portal.qureo.education/", output.getvalue())
        self.assertIn("العنوان=403 ERROR", output.getvalue())
        self.assertIn("Access denied by CloudFront", output.getvalue())

    def test_qureo_server_rejects_missing_completion_confirmation(self):
        class FakeSolver:
            def __init__(self, **kwargs):
                self.answers = None

            def run(self, *args, **kwargs):
                return None

        fake_module = SimpleNamespace(QureoSolver=FakeSolver)
        with (
            patch.object(server, "_install_qureo", return_value=fake_module),
            patch.object(server, "_load_qureo_bank", return_value={}),
        ):
            result = server._run_qureo(
                {"_stop_event": threading.Event()}, "local", "local", ["Python"]
            )

        self.assertFalse(result[0])

    def test_qureo_course_rejects_empty_curriculum(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.resolve_section_id = Mock(return_value=42)
        solver.api_get_json = Mock(return_value={"chapters": []})

        with self.assertRaisesRegex(RuntimeError, "لن أعتبر المسار مكتملًا"):
            solver.solve_course()

    def test_qureo_course_stops_on_first_incomplete_chapter(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.current_course = "Python"
        solver._bank_lock = threading.Lock()
        solver.resolve_section_id = Mock(return_value=42)
        solver.api_get_json = Mock(side_effect=[
            {
                "chapters": [
                    {"id": 1, "name": "الفصل الأول", "seq": 1, "question_count": 1},
                    {"id": 2, "name": "الفصل الثاني", "seq": 2, "question_count": 1},
                ]
            },
            [],
        ])
        solver._bank_covers = Mock(return_value=True)
        solver._solve_chapter = Mock(return_value=None)

        with patch.object(qureo_solver, "emit_progress"):
            with self.assertRaisesRegex(RuntimeError, "لم يكتمل الفصل"):
                solver.solve_course()

        solver._solve_chapter.assert_called_once()

    def test_qureo_does_not_skip_chapter_with_unfinished_lectures(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.current_course = "Python"
        solver._bank_lock = threading.Lock()
        solver.resolve_section_id = Mock(return_value=42)
        solver.api_get_json = Mock(side_effect=[
            {
                "chapters": [
                    {"id": 1, "name": "الفصل الأول", "seq": 1, "question_count": 1}
                ]
            },
            [{"chapter_id": 1, "best_correct_count": 1}],
        ])
        solver.complete_chapter_lectures = Mock(
            side_effect=RuntimeError("ما زالت هناك محاضرة غير مكتملة")
        )

        with patch.object(qureo_solver, "emit_progress"):
            with self.assertRaisesRegex(RuntimeError, "محاضرة غير مكتملة"):
                solver.solve_course()

    def test_qureo_test_is_not_complete_after_failed_attempts(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.api_get_json = Mock(return_value=[
            {"question": {"id": 101}, "choices": [{"id": 1}]}
        ])
        solver._stored_key = Mock(return_value={})
        solver._submit_attempt = Mock(return_value={"correct_count": 0})
        solver._extract_key = Mock(return_value={})
        solver._save_key = Mock()

        with patch.object(qureo_solver.time, "sleep"):
            result = solver.solve_test(42)

        self.assertFalse(result["ok"])
        self.assertEqual(result["correct"], 0)
        self.assertEqual(solver._submit_attempt.call_count, 3)

    def test_qureo_rejects_lectures_missing_from_confirmed_progress(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.api_get_json = Mock(side_effect=[
            [],
            {"lectures": [{"id": 11, "seq": 1, "title": "Lecture"}]},
            [],
        ])
        solver._req = Mock(return_value=SimpleNamespace(status=200))

        with self.assertRaisesRegex(RuntimeError, "محاضرة غير مكتملة"):
            solver.complete_chapter_lectures(42)

    def test_qureo_accepts_lectures_confirmed_by_platform_progress(self):
        solver = qureo_solver.QureoSolver.__new__(qureo_solver.QureoSolver)
        solver.api_get_json = Mock(side_effect=[
            [],
            {"lectures": [{"id": 11, "seq": 1, "title": "Lecture"}]},
            [{"lecture_id": 11, "completed_at": "2026-01-01"}],
        ])
        solver._req = Mock(return_value=SimpleNamespace(status=200))

        self.assertIsNone(solver.complete_chapter_lectures(42))

    def _spx_solver(self, item):
        solver = spx_solver.Solver(stop=lambda: False, turbo=True)
        solver._bank_load = lambda: None
        solver._launch = lambda: None
        solver._login_api = lambda *args: ({"success": True}, 200)
        solver._check_subject = lambda: True
        solver._headers = lambda: {}
        solver._bank_save = lambda: None
        solver.cleanup = lambda: None
        solver.context = SimpleNamespace(
            request=SimpleNamespace(get=lambda *args, **kwargs: object())
        )
        solver._ok = lambda response: (
            {"data": {"units": [{"id": 1, "items": [dict(item)]}]}},
            200,
        )
        solver._solve_chapter = Mock(return_value=False)
        return solver

    def test_spx_retries_failed_items_then_reports_incomplete(self):
        solver = self._spx_solver({
            "id": 11,
            "item_type": "chapter",
            "is_unlocked": True,
            "is_completed": False,
        })

        ok, message = solver.run("local", "local")

        self.assertFalse(ok)
        self.assertIn("0/1", message)
        self.assertEqual(solver._solve_chapter.call_count, spx_solver.MAX_ITEM_ATTEMPTS)

    def test_spx_retry_can_recover_and_then_confirm_completion(self):
        incomplete = {"data": {"units": [{"id": 1, "items": [{
            "id": 11,
            "item_type": "chapter",
            "is_unlocked": True,
            "is_completed": False,
        }]}]}}
        complete = {"data": {"units": [{"id": 1, "items": [{
            "id": 11,
            "item_type": "chapter",
            "is_unlocked": False,
            "is_completed": True,
        }]}]}}
        solver = self._spx_solver(incomplete["data"]["units"][0]["items"][0])
        responses = iter([incomplete, incomplete, complete])
        solver._ok = lambda response: (next(responses), 200)
        solver._solve_chapter = Mock(side_effect=[False, True])

        ok, message = solver.run("local", "local")

        self.assertTrue(ok)
        self.assertIn("اكتمل", message)
        self.assertEqual(solver._solve_chapter.call_count, 2)

    def test_spx_confirms_platform_completion_before_success(self):
        solver = self._spx_solver({
            "id": 11,
            "item_type": "chapter",
            "is_unlocked": False,
            "is_completed": True,
        })

        ok, message = solver.run("local", "local")

        self.assertTrue(ok)
        self.assertIn("اكتمل", message)
        solver._solve_chapter.assert_not_called()


if __name__ == "__main__":
    unittest.main()
