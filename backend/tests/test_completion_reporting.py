import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from backend import qureo_solver, server, spx_solver


class CompletionReportingTests(unittest.TestCase):
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
