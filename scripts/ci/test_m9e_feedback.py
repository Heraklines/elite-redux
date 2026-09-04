"""Remote-only regression tests for the feedback gate and evidence contract.

Run with the runner's standard-library unittest. Every Git/Cargo/test process is
mocked; fixture repositories and reports live in disposable temporary folders.
"""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


BASE = "a" * 40
CANDIDATE = "b" * 40
PREVIOUS_PUSH = "c" * 40
HARNESS = Path(__file__).with_name("m9e_feedback.py")


class FeedbackTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="m9e-feedback-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.rust = self.root / "rust"
        self.full = self.root / "report/full"
        self.compact = self.root / "report/compact"
        self.full.mkdir(parents=True)
        self.rust.mkdir()
        environment = patch.dict(os.environ, {
            "M9E_REPORT_DIR": str(self.root / "report"),
            "M9E_BASE_SHA": PREVIOUS_PUSH,
            "GITHUB_SHA": CANDIDATE,
            "GITHUB_WORKFLOW_SHA": CANDIDATE,
        })
        environment.start()
        self.addCleanup(environment.stop)
        spec = importlib.util.spec_from_file_location("m9e_feedback_under_test", HARNESS)
        self.feedback = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.feedback)
        for name, value in {
            "ROOT": self.root, "RUST": self.rust, "FULL": self.full,
            "COMPACT": self.compact, "REPORT": self.root / "report", "TIMINGS": {},
        }.items():
            setattr(self.feedback, name, value)

        self.config = {
            "baseline": BASE,
            "readiness_packages": ["er-canonical"],
            "infrastructure_paths": ["scripts/ci/m9e_feedback.py"],
            "documentation_prefixes": ["docs/plans/rust-kernel/m9e-"],
            "shared_packages": ["er-kernel"],
            "shared_witness_packages": ["er-kernel", "er-web", "er-wasm"],
            "boundary_prefixes": ["src/", "rust/crates/er-web/"],
        }
        config_path = self.root / "scripts/ci/m9e-targets.json"
        config_path.parent.mkdir(parents=True)
        config_path.write_text(json.dumps(self.config))
        (self.rust / "Cargo.lock").write_text("# synthetic lockfile\n")
        manifest = self.rust / "fixtures/m9/engineering/game-content-bundle-v2-manifest.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text('{"fixture": true}\n')
        for name in ("er-canonical", "er-native", "er-cli", "er-kernel", "er-web", "er-wasm"):
            self.package(name)

        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        self.head = CANDIDATE
        self.capture_calls = []
        self.commands = []
        self.events = []
        self.executed = []
        self.binary_workdirs = []
        self.format_code = 0
        self.build_code = 0
        self.build_diagnostic = "error: synthetic compiler failure\n"
        self.extra_failure_logs = 0
        self.binary_ids = {"a_suite": ["first"], "b_suite": ["second"]}
        self.results = {}
        capture_patch = patch.object(self.feedback, "capture", side_effect=self.capture)
        process_patch = patch.object(self.feedback.subprocess, "run", side_effect=self.process)
        capture_patch.start()
        process_patch.start()
        self.addCleanup(capture_patch.stop)
        self.addCleanup(process_patch.stop)

    def package(self, name, dependencies=""):
        manifest = self.rust / f"crates/{name}/Cargo.toml"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(f'[package]\nname = "{name}"\nversion = "0.1.0"\n' + dependencies)

    def capture(self, args, cwd=None):
        self.capture_calls.append(list(args))
        if args[:2] == ["git", "diff"]:
            return "\n".join(self.changed)
        if args == ["git", "rev-parse", "HEAD"]:
            return self.head
        if args == ["rustc", "--version"]:
            return "rustc 1.97.1 (synthetic)"
        if args == ["rustc", "-vV"]:
            return "rustc 1.97.1\nhost: x86_64-unknown-linux-gnu"
        raise AssertionError(f"Unexpected capture: {args}")

    def process(self, args, cwd=None, stdout=None, stderr=None, **kwargs):
        args = list(args)
        self.commands.append(args)
        if args[:3] == ["git", "cat-file", "-e"]:
            return subprocess.CompletedProcess(args, 0)
        if args == ["git", "restore", "--worktree", "--", "rust"]:
            self.events.append("restore")
            return subprocess.CompletedProcess(args, 0)
        if args[:2] == ["cargo", "fmt"]:
            if "--check" in args:
                self.events.append("format")
                if self.format_code:
                    stdout.write("Diff in synthetic source: formatting required\n")
                return subprocess.CompletedProcess(args, self.format_code)
            self.events.append("format-patch")
            return subprocess.CompletedProcess(args, 0)
        if args[:2] == ["cargo", "test"]:
            self.events.append("build")
            if self.build_code:
                stdout.write(self.build_diagnostic)
                for index in range(self.extra_failure_logs):
                    (self.full / f"extra-{index:03}.log").write_text("error: " + "x" * 20000)
            else:
                for name in self.binary_ids:
                    stdout.write(json.dumps({
                        "reason": "compiler-artifact", "profile": {"test": True},
                        "executable": str(self.rust / "target" / name),
                        "manifest_path": str(self.rust / "crates" / "er-native" / "Cargo.toml"),
                        "target": {"name": name},
                    }) + "\n")
            return subprocess.CompletedProcess(args, self.build_code)
        name = Path(args[0]).name
        if name not in self.binary_ids:
            raise AssertionError(f"Unexpected process: {args}")
        self.binary_workdirs.append((name, Path(cwd)))
        if "--list" in args:
            self.events.append("list:" + name)
            stdout.write("".join(f"{test_id}: test\n" for test_id in self.binary_ids[name]))
            return subprocess.CompletedProcess(args, 0)
        self.events.append("execute:" + name)
        self.executed.append(name)
        code, output = self.results.get(name, (0, self.result_line(len(self.binary_ids[name]))))
        stdout.write(output)
        return subprocess.CompletedProcess(args, code)

    @staticmethod
    def result_line(passed=0, failed=0, skipped=0):
        status = "FAILED" if failed else "ok"
        return f"test result: {status}. {passed} passed; {failed} failed; {skipped} ignored; 0 measured; 0 filtered out\n"

    def invoke(self):
        with contextlib.redirect_stdout(io.StringIO()):
            code = self.feedback.main()
        return code, json.loads((self.compact / "summary.json").read_text())

    def assert_evidence_hashes(self, summary):
        for item in summary["evidence"]:
            path = self.full / item["file"]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), item["sha256"])
            if "bytes" in item:
                self.assertEqual(path.stat().st_size, item["bytes"])

    def test_cumulative_baseline_preserves_source_after_docs_followup(self):
        self.package("er-cli", '[dependencies]\ner-native = { path = "../er-native" }\n')
        self.changed = ["rust/crates/er-native/src/lib.rs", self.changed[0]]
        selection = self.feedback.plan()
        self.assertEqual(selection["base_sha"], BASE)
        self.assertEqual(selection["packages"], ["er-cli", "er-native"])
        self.assertIn(["git", "diff", "--name-only", BASE, "HEAD"], self.capture_calls)
        self.assertFalse(any(PREVIOUS_PUSH in args for args in self.capture_calls))

    def test_build_and_target_dependency_aliases_widen_source_cone(self):
        self.package("er-cli", '[build-dependencies]\naliased = { package = "er-native", path = "../er-native" }\n')
        self.package("er-canonical", '[target.\'cfg(unix)\'.dev-dependencies]\ner-cli = { path = "../er-cli" }\n')
        self.changed = ["rust/crates/er-native/build.rs"]
        self.assertEqual(self.feedback.plan()["packages"], ["er-canonical", "er-cli", "er-native"])

    def test_unknown_shared_and_browser_inputs_fail_closed(self):
        for changed in ("unmapped-input.json", "rust/fixtures/new-generated.json", "rust/crates/er-kernel/src/lib.rs", "src/adapter.ts"):
            with self.subTest(changed=changed):
                self.changed = [changed]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
                selection = json.loads((self.full / "plan.json").read_text())
                self.assertIn(changed, selection["changed_paths"])
                self.assertTrue(selection["packages"])

    def test_docs_only_readiness_remains_small(self):
        self.assertEqual(self.feedback.plan()["packages"], ["er-canonical"])

    def test_current_environment_selects_reverse_consumers_and_wasm_witness(self):
        self.config["current_session_packages"] = ["er-env"]
        self.config["current_session_wasm_test"] = "m9e_parity"
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-env")
        self.package("er-native", '[dependencies]\ner-env = { path = "../er-env" }\n')
        self.package("er-cli", '[dependencies]\ner-native = { path = "../er-native" }\n')
        self.changed = ["rust/crates/er-env/src/current.rs"]
        selection = self.feedback.plan()
        self.assertEqual(selection["packages"], ["er-cli", "er-env", "er-native", "er-wasm"])
        self.assertTrue(selection["requires_wasm"])
        self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertEqual(selection["boundary_paths"], [])

    def test_format_failure_without_changed_rust_still_runs_original_tests(self):
        self.format_code = 1
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["status"], "failed")
        self.assertIn("format exited 1", summary["format_failure"])
        self.assertEqual(summary["first_failure"], summary["format_failure"])
        self.assertEqual(summary["tests"]["passed"], 2)
        self.assertEqual(self.executed, ["a_suite", "b_suite"])
        self.assertNotIn("format-patch", self.events)
        self.assertNotIn("restore", self.events)
        self.assertFalse((self.compact / "format.patch").exists())

    def test_format_patch_is_scoped_and_restore_precedes_compilation(self):
        self.format_code = 1
        source = "rust/crates/er-native/src/lib.rs"
        self.changed = [source, "docs/plans/rust-kernel/m9e-progress.md"]
        patch_bytes = b"diff --git a/rust/crates/er-native/src/lib.rs b/rust/crates/er-native/src/lib.rs\n"
        with patch.object(self.feedback.subprocess, "check_output", return_value=patch_bytes) as diff:
            code, summary = self.invoke()
        diff.assert_called_once_with(["git", "diff", "--", source], cwd=self.root)
        self.assertEqual(code, 1)
        self.assertEqual(summary["tests"]["passed"], 2)
        self.assertEqual(self.executed, ["a_suite", "b_suite"])
        self.assertLess(self.events.index("format-patch"), self.events.index("restore"))
        self.assertLess(self.events.index("restore"), self.events.index("build"))
        self.assertEqual((self.compact / "format.patch").read_bytes(), patch_bytes)
        self.assertEqual((self.full / "format.patch").read_bytes(), patch_bytes)
        self.assertLessEqual(sum(path.stat().st_size for path in self.compact.iterdir()), 64 * 1024)

    def test_compiler_failure_cannot_become_green_after_report_generation(self):
        self.build_code = 101
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["status"], "failed")
        self.assertIn("build exited 101", summary["first_failure"])
        self.assertEqual(summary["tests"]["executed"], 0)
        self.assertEqual(self.executed, [])
        self.assertIn("synthetic compiler failure", (self.compact / "failure.txt").read_text())
        self.assert_evidence_hashes(summary)

    def test_all_test_ids_are_selected_before_first_binary_fails(self):
        self.results["a_suite"] = (101, self.result_line(failed=1))
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["expected_test_count"], 2)
        self.assertEqual(summary["tests"], {"selected": 2, "executed": 1, "passed": 0, "failed": 1, "skipped": 0})
        self.assertEqual(json.loads((self.full / "selected-tests.json").read_text()), ["a_suite::first", "b_suite::second"])
        self.assertLess(self.events.index("list:b_suite"), self.events.index("execute:a_suite"))
        self.assertEqual(self.executed, ["a_suite"])

    def test_bad_exit_counts_missing_results_and_skips_each_fail(self):
        cases = {
            "nonzero_exit_with_passing_counts": (9, self.result_line(passed=1)),
            "failed_count_with_zero_exit": (0, self.result_line(failed=1)),
            "ignored_test": (0, self.result_line(skipped=1)),
            "too_few_results": (0, self.result_line()),
            "too_many_results": (0, self.result_line(passed=2)),
            "missing_result_line": (0, "process ended without a libtest result\n"),
        }
        for name, result in cases.items():
            with self.subTest(failure=name):
                self.results["a_suite"] = result
                code, summary = self.invoke()
                self.assertEqual(code, 1)
                self.assertEqual(summary["status"], "failed")
                self.assertEqual(summary["expected_test_count"], 2)

    def test_zero_total_is_failure_even_when_empty_harness_succeeds(self):
        self.binary_ids = {"a_suite": []}
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["first_failure"], "zero tests executed")
        self.assertEqual(self.executed, ["a_suite"])

    def test_no_test_binaries_is_failure(self):
        self.binary_ids = {}
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["first_failure"], "build emitted no test binaries")

    def test_single_long_log_marks_omitted_bytes(self):
        self.build_code = 1
        self.build_diagnostic = "error: " + "x" * 24000
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertTrue(summary["diagnostics_truncated"])
        self.assertIn("TRUNCATED", (self.compact / "failure.txt").read_text())
        self.assertEqual((self.full / "build.log").read_text(), self.build_diagnostic)

    def test_oversized_evidence_keeps_compact_under_64_kib(self):
        self.build_code = 1
        self.extra_failure_logs = 120
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertTrue(summary["diagnostics_truncated"])
        self.assertLessEqual(sum(path.stat().st_size for path in self.compact.iterdir()), 64 * 1024)
        self.assertIn("TRUNCATED", (self.compact / "failure.txt").read_text())
        self.assertTrue((self.full / "full-summary.json").is_file())
        self.assert_evidence_hashes(summary)
        complete = json.loads((self.full / "full-summary.json").read_text())
        self.assert_evidence_hashes(complete)
        self.assertEqual(len(list(self.full.glob("extra-*.log"))), 120)

    def test_candidate_mismatch_stops_before_any_cargo_process(self):
        self.head = PREVIOUS_PUSH
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["first_failure"], "candidate identity mismatch")
        self.assertEqual(self.commands, [])

    def test_every_binary_executes_and_evidence_binds_current_candidate(self):
        # The fake Cargo artifact is identical whether fresh or cache-restored.
        code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(self.executed, ["a_suite", "b_suite"])
        self.assertEqual(self.binary_workdirs, [
            (name, self.rust / "crates/er-native")
            for name in ("a_suite", "b_suite", "a_suite", "b_suite")
        ])
        self.assertEqual(summary["tests"], {"selected": 2, "executed": 2, "passed": 2, "failed": 0, "skipped": 0})
        self.assertEqual(summary["product_sha"], CANDIDATE)
        self.assertEqual(summary["workflow_sha"], CANDIDATE)
        self.assertEqual(summary["harness_sha"], hashlib.sha256(HARNESS.read_bytes()).hexdigest())
        self.assert_evidence_hashes(summary)
        selected = summary["selected_test_ids"]
        self.assertEqual(selected["sha256"], hashlib.sha256((self.full / selected["file"]).read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
