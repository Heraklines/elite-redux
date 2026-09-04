"""Remote-only regression tests for the feedback gate and evidence contract.

Run with the runner's standard-library unittest. Every Git/Cargo/test process is
mocked; fixture repositories and reports live in disposable temporary folders.
"""

import contextlib
import copy
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
        self.baseline_lock = None
        self.capture_calls = []
        self.commands = []
        self.events = []
        self.executed = []
        self.binary_workdirs = []
        self.binary_envs = []
        self.binary_crates = {}
        self.extra_artifacts = []
        self.format_code = 0
        self.clippy_code = 0
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
        if args == ["git", "show", f"{BASE}:rust/Cargo.lock"] and self.baseline_lock is not None:
            return self.baseline_lock
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
        if args[:2] == ["cargo", "clippy"]:
            self.events.append("clippy")
            if self.clippy_code:
                stdout.write("error: synthetic worker lint failure\n")
            return subprocess.CompletedProcess(args, self.clippy_code)
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
                        "manifest_path": str(self.rust / "crates" / self.binary_crates.get(name, "er-native") / "Cargo.toml"),
                        "target": {"name": name},
                    }) + "\n")
                for artifact in self.extra_artifacts:
                    stdout.write(json.dumps(artifact) + "\n")
            return subprocess.CompletedProcess(args, self.build_code)
        name = Path(args[0]).name
        if name not in self.binary_ids:
            raise AssertionError(f"Unexpected process: {args}")
        self.binary_workdirs.append((name, Path(cwd)))
        self.binary_envs.append((name, "list" if "--list" in args else "execute", kwargs.get("env")))
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

    def test_native_timeout_emits_bounded_failure_and_preserves_selected_count(self):
        def timeout_first_binary(args, **kwargs):
            if Path(args[0]).name == "a_suite" and "--list" not in args:
                self.assertEqual(kwargs["timeout"], 600)
                kwargs["stdout"].write("running 1 test\nfirst ... still running\n")
                raise subprocess.TimeoutExpired(args, 600)
            return self.process(args, **kwargs)
        with patch.object(self.feedback.subprocess, "run", side_effect=timeout_first_binary):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["expected_test_count"], 2)
        self.assertEqual(summary["tests"]["executed"], 0)
        self.assertIn("a_suite exceeded 600 seconds", summary["first_failure"])
        self.assertIn("still running", (self.compact / "failure.txt").read_text())

    def test_no_test_binaries_is_failure(self):
        self.binary_ids = {}
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["first_failure"], "build emitted no test binaries")

    def test_focused_session_scope_requires_every_changed_rust_path(self):
        allowed = "rust/crates/er-native/src/current.rs"
        self.config["current_session_focus"] = {"paths": [allowed], "execute": {"er-native": ["*"], "er-wasm": ["m9e_parity"]}}
        self.config["current_session_wasm_test"] = "m9e_parity"
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = [allowed]
        focused = self.feedback.plan()
        self.assertEqual(focused["execution_scope"], self.config["current_session_focus"]["execute"])
        self.assertTrue(focused["requires_wasm"])
        self.assertEqual(focused["wasm_test"], "m9e_parity")
        self.assertIn("er-wasm", focused["packages"])
        for extra in ["rust/crates/er-native/src/lib.rs", "rust/crates/er-native/Cargo.toml", "rust/crates/er-native/build.rs"]:
            with self.subTest(extra=extra):
                self.changed = [allowed, extra]
                self.assertIsNone(self.feedback.plan()["execution_scope"])
        for extra in ["rust/fixtures/generated.json", "src/adapter.ts", "rust/crates/er-kernel/src/lib.rs"]:
            with self.subTest(extra=extra):
                self.changed = [allowed, extra]
                with self.assertRaisesRegex(RuntimeError, "additional mapping"):
                    self.feedback.plan()

    def test_focus_reports_built_but_unexecuted_targets(self):
        self.config["current_session_focus"] = {"paths": ["rust/crates/er-native/src/current.rs"], "execute": {"er-native": ["a_suite"]}}
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = ["rust/crates/er-native/src/current.rs"]
        with patch.object(self.feedback, "wasm_checks"):
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(self.executed, ["a_suite"])
        self.assertEqual(summary["build_only_targets"], ["er-native:b_suite"])
        self.assertEqual(summary["tests"]["selected"], 1)
        self.assertEqual(summary["tests"]["passed"], 1)

    def configure_browser_scope(self):
        # Read the committed target policy, while keeping Git and manifests synthetic.
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        for key in ("current_session_packages", "current_session_wasm_test", "current_session_focus", "browser_session_focus", "boundary_prefixes"):
            self.config[key] = policy[key]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-env")
        self.package("er-cli", '[dependencies]\ner-env = { path = "../er-env" }\n')
        self.package("er-web", '[dependencies]\ner-env = { path = "../er-env" }\n')

    def configure_worker_scope(self):
        self.configure_browser_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["worker_session_focus"] = policy["worker_session_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-kernel-worker", '[dependencies]\ner-env = { path = "../er-env" }\n')
        self.package("er-lab", '[dependencies]\ner-kernel-worker = { path = "../er-kernel-worker" }\n')
        self.package("er-cli", '[dependencies]\ner-lab = { path = "../er-lab" }\n')

    @staticmethod
    def worker_lock_fixture(dependencies):
        text = 'version = 4\n'
        for name in ("er-canonical", "er-env", "er-kernel-worker", "er-protocol", "er-state"):
            text += f'\n[[package]]\nname = "{name}"\nversion = "0.1.0"\n'
            if name == "er-kernel-worker":
                text += "dependencies = " + json.dumps(dependencies) + "\n"
        return text

    def test_worker_focus_compiles_reverse_cone_without_browser_or_wasm(self):
        self.configure_worker_scope()
        self.changed = list(self.config["worker_session_focus"]["paths"])
        selection = self.feedback.plan()
        self.assertTrue(selection["worker_session_focus"])
        self.assertFalse(selection["requires_browser"])
        self.assertFalse(selection["requires_wasm"])
        self.assertEqual(selection["packages"], ["er-cli", "er-kernel-worker", "er-lab"])
        self.assertEqual(selection["execution_scope"], {
            "er-kernel-worker": ["*"], "er-cli": ["*"],
            "er-lab": ["kernel_reload_acceptance", "kernel_reload_artifact"],
        })

    def test_worker_lock_guard_allows_only_three_existing_workspace_additions(self):
        self.configure_worker_scope()
        self.changed = ["rust/crates/er-kernel-worker/src/runtime_v2.rs", "rust/Cargo.lock"]
        self.baseline_lock = self.worker_lock_fixture(["er-env"])
        (self.rust / "Cargo.lock").write_text(self.worker_lock_fixture(
            ["er-canonical", "er-env", "er-protocol", "er-state"]))
        selection = self.feedback.plan()
        self.assertEqual(selection["unknown_paths"], [])
        self.assertEqual(selection["worker_lock_guard"], {
            "status": "verified", "baseline_sha": BASE,
            "added_workspace_dependencies": ["er-canonical", "er-protocol", "er-state"],
        })
        self.assertIn(["git", "show", f"{BASE}:rust/Cargo.lock"], self.capture_calls)
        self.assertFalse(selection["requires_wasm"])

    def test_worker_clippy_runs_after_tests_and_its_failure_cannot_turn_green(self):
        selection = self.feedback.plan()
        selection["worker_session_focus"] = True
        for clippy_code in (0, 1):
            with self.subTest(clippy_code=clippy_code):
                self.clippy_code = clippy_code
                self.events.clear()
                with patch.object(self.feedback, "plan", return_value=selection), patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
                    code, summary = self.invoke()
                self.assertEqual(code, clippy_code)
                self.assertEqual(summary["tests"]["passed"], 2)
                self.assertLess(self.events.index("execute:b_suite"), self.events.index("clippy"))
                self.assertIn("worker-clippy", summary["timing_ms"])
                self.assertIn(["cargo", "clippy", "--locked", "-p", "er-kernel-worker", "--all-targets", "--no-deps", "--", "-D", "warnings"], self.commands)
                wasm.assert_not_called()
                browser.assert_not_called()
                if clippy_code:
                    self.assertIn("worker-clippy exited 1", summary["first_failure"])

    def test_worker_lock_guard_rejects_other_semantic_lock_changes(self):
        before = self.worker_lock_fixture(["er-env"])
        added = ["er-canonical", "er-env", "er-protocol", "er-state"]
        valid = self.worker_lock_fixture(added)
        invalid = {
            "missing_addition": self.worker_lock_fixture(added[:-1]),
            "extra_dependency": self.worker_lock_fixture(added + ["serde"]),
            "removed_dependency": self.worker_lock_fixture([name for name in added if name != "er-env"]),
            "duplicate_dependency": self.worker_lock_fixture(added + ["er-state"]),
            "changed_metadata": valid.replace("version = 4", "version = 3"),
            "other_package_record": valid.replace('name = "er-env"\n', 'name = "er-env"\nchecksum = "changed"\n'),
            "package_version": valid.replace('name = "er-state"\nversion = "0.1.0"', 'name = "er-state"\nversion = "0.2.0"'),
            "new_package": valid + '\n[[package]]\nname = "new"\nversion = "0.1.0"\n',
            "unchanged_dependencies": before,
        }
        for defect, after in invalid.items():
            with self.subTest(defect=defect):
                with self.assertRaisesRegex(RuntimeError, "worker lock guard"):
                    self.feedback.verify_worker_lock_change(before, after)
        external = 'name = "er-protocol"\nsource = "registry+https://example.invalid/index"\n'
        with self.assertRaisesRegex(RuntimeError, "existing unambiguous workspace"):
            self.feedback.verify_worker_lock_change(
                before.replace('name = "er-protocol"\n', external),
                valid.replace('name = "er-protocol"\n', external))

    def test_worker_focus_does_not_exempt_mixed_or_unmapped_inputs(self):
        self.configure_worker_scope()
        worker = "rust/crates/er-kernel-worker/src/runtime_v2.rs"
        for extra in ("rust/crates/er-kernel-worker/src/other.rs", "rust/crates/er-cli/src/main.rs"):
            with self.subTest(extra=extra):
                self.changed = [worker, extra]
                selection = self.feedback.plan()
                self.assertFalse(selection["worker_session_focus"])
                self.assertIsNone(selection["execution_scope"])
        self.changed = [worker, "rust/crates/er-env/src/current.rs"]
        selection = self.feedback.plan()
        self.assertFalse(selection["worker_session_focus"])
        self.assertIsNone(selection["execution_scope"])
        self.assertTrue(selection["requires_browser"])
        self.assertTrue(selection["requires_wasm"])
        for extra in ("rust/crates/er-web/src/host_v2.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/fixtures/generated.json", "unmapped-input.json"):
            with self.subTest(extra=extra):
                self.changed = [worker, extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
        self.changed = [worker, "rust/Cargo.lock", "rust/crates/er-env/src/current.rs"]
        with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
            self.feedback.plan()

    def configure_endpoint_scope(self):
        self.configure_worker_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["endpoint_session_focus"] = policy["endpoint_session_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))

    def test_endpoint_scope_includes_worker_and_guarded_cumulative_lock(self):
        self.configure_endpoint_scope()
        self.changed = self.config["endpoint_session_focus"]["paths"] + [
            "rust/crates/er-kernel-worker/src/runtime_v2.rs", "rust/Cargo.lock"]
        self.baseline_lock = self.worker_lock_fixture(["er-env"])
        (self.rust / "Cargo.lock").write_text(self.worker_lock_fixture(
            ["er-canonical", "er-env", "er-protocol", "er-state"]))
        selection = self.feedback.plan()
        self.assertTrue(selection["endpoint_session_focus"])
        self.assertTrue(selection["requires_worker_executable"])
        self.assertFalse(selection["requires_browser"])
        self.assertFalse(selection["requires_wasm"])
        self.assertEqual(selection["worker_lock_guard"]["status"], "verified")
        self.assertEqual(selection["execution_scope"]["er-lab"], [
            "current_kernel_endpoint_v2", "current_kernel_endpoint_faults_v2", "kernel_reload_acceptance", "kernel_reload_artifact"])
        self.assertEqual(selection["execution_scope"]["er-kernel-worker"], ["*"])
        self.assertEqual(selection["execution_scope"]["er-cli"], ["*"])

    def test_endpoint_mixed_source_preserves_broader_platform_requirements(self):
        self.configure_endpoint_scope()
        endpoint = "rust/crates/er-lab/src/kernel_reload/endpoint_v2.rs"
        self.changed = [endpoint, "rust/crates/er-env/src/current.rs"]
        selection = self.feedback.plan()
        self.assertIsNone(selection["execution_scope"])
        self.assertTrue(selection["requires_worker_executable"])
        self.assertTrue(selection["requires_browser"])
        self.assertTrue(selection["requires_wasm"])
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-web/src/host_v2.rs", "unmapped-input.json", "rust/Cargo.lock"):
            with self.subTest(extra=extra):
                self.changed = [endpoint, "rust/crates/er-env/src/current.rs", extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()

    def configure_timer_scope(self):
        self.configure_endpoint_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["timer_focus"] = policy["timer_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for package in self.config["timer_focus"]["execute"]:
            self.package(package)
        self.package("er-reverse", '[dependencies]\ner-kernel = { path = "../er-kernel" }\n')

    def test_timer_scope_requires_shared_regressions_and_all_platforms(self):
        self.configure_timer_scope()
        self.changed = self.config["timer_focus"]["paths"] + ["docs/plans/rust-kernel/m9e-progress.md"]
        selection = self.feedback.plan()
        self.assertTrue(selection["timer_focus"])
        self.assertTrue(selection["requires_browser"])
        self.assertTrue(selection["requires_wasm"])
        self.assertTrue(selection["requires_worker_executable"])
        self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertIsNone(selection["worker_lock_guard"])
        self.assertEqual(selection["boundary_paths"], [])
        self.assertEqual(selection["unknown_paths"], [])
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        for package in ("er-kernel", "er-state", "er-protocol", "er-env", "er-cli", "er-web", "er-kernel-worker"):
            self.assertIn(package, selection["packages"])
            self.assertEqual(selection["execution_scope"][package], ["*"])
        self.assertEqual(set(selection["required_native_targets"]["er-kernel"]), {
            "m9e_timers_v7", "m9e_domain_journeys_v7", "m9e_coop_v7", "m9e_game_kernel_v7", "m9e_snapshot_v7"})

    def test_timer_scope_rejects_unmapped_mixed_product_and_lock_changes(self):
        self.configure_timer_scope()
        core = "rust/crates/er-kernel/src/game_kernel_v7.rs"
        for extra in ("rust/crates/er-state/src/lib.rs", "rust/crates/er-protocol/src/lib.rs",
                      "rust/crates/er-kernel/src/snapshot.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-web/src/lib.rs", "test/browser/rust-browser/other.spec.ts",
                      "rust/Cargo.lock", "unmapped.json"):
            with self.subTest(extra=extra):
                self.changed = [core, extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()

    def test_timer_named_witnesses_are_nonempty_unique_and_package_bound(self):
        required = {"er-kernel": ["m9e_timers_v7", "m9e_snapshot_v7"]}
        valid = [("er-kernel", name, ["behavior"]) for name in required["er-kernel"]]
        self.assertEqual(self.feedback.required_native_target_counts(required, valid), {
            "er-kernel:m9e_timers_v7": 1, "er-kernel:m9e_snapshot_v7": 1})
        for invalid in (valid[:1], valid + valid[:1],
                        [("er-other", name, ids) for _, name, ids in valid],
                        [(crate, name, []) for crate, name, _ in valid]):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(RuntimeError, "required native witness"):
                    self.feedback.required_native_target_counts(required, invalid)
        selection = self.feedback.plan()
        selection["required_native_targets"] = required
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("required native witness", summary["first_failure"])
        self.assertEqual(self.executed, [])
        self.assertIn("list:a_suite", self.events)
        self.assertIn("list:b_suite", self.events)

    def test_timer_execution_keeps_worker_binding_and_both_platform_checks(self):
        self.configure_timer_scope()
        self.changed = self.config["timer_focus"]["paths"]
        policy = self.config["timer_focus"]
        self.binary_ids = {}
        for package, names in policy["execute"].items():
            if names == ["*"]:
                names = policy["required_targets"].get(package, [package.replace("-", "_")])
            for name in names:
                self.binary_ids[name] = ["behavior"]
                self.binary_crates[name] = package
        self.extra_artifacts = [self.worker_executable_artifact()]
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, patch.object(self.feedback, "timer_behavioral_mutant") as mutant:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        wasm.assert_called_once()
        browser.assert_called_once()
        mutant.assert_called_once()
        self.assertEqual(len(summary["required_native_target_counts"]), 5)
        self.assertIn("current_kernel_endpoint_v2", self.executed)
        self.assertIn("current_kernel_endpoint_faults_v2", self.executed)
        for name, phase, env in self.binary_envs:
            with self.subTest(name=name, phase=phase):
                if name == "current_kernel_endpoint_v2":
                    self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], summary["worker_executable"]["sha256"])
                else:
                    self.assertIsNone(env)

    def invoke_synthetic_timer_mutant(self, mode):
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["timer_focus"]["mutant"]
        source = self.root / policy["source"]
        source.parent.mkdir(parents=True, exist_ok=True)
        original = ("fn synthetic() {\n" + policy["original"] + "\n}\n").encode()
        source.write_bytes(original)
        summary = {}
        witness = policy["test"]

        def tracked_diff(args, cwd=None):
            self.assertEqual(args, ["git", "diff", "--name-only", "HEAD", "--"])
            return "" if source.read_bytes() == original else policy["source"]

        def mutant_run(args, name, cwd=None, env=None):
            path = self.full / (name + ".log")
            self.assertNotEqual(env["CARGO_TARGET_DIR"], str(self.rust / "target"))
            self.assertEqual(source.read_bytes(), original.replace(policy["original"].encode(), policy["replacement"].encode()))
            if name == "timer-mutant-build":
                self.assertIn("--locked", args)
                self.assertIn("--no-run", args)
                if mode == "build":
                    path.write_text("error: synthetic compiler rejection\n")
                    raise RuntimeError("timer-mutant-build exited 101")
                binary = Path(env["CARGO_TARGET_DIR"]) / "synthetic-timer-test"
                binary.write_bytes(b"synthetic artifact, never executed")
                path.write_text(json.dumps({"reason": "compiler-artifact", "profile": {"test": True},
                    "target": {"name": policy["target"], "kind": ["test"]}, "executable": str(binary),
                    "manifest_path": str(self.rust / "crates/er-kernel/Cargo.toml")}) + "\n")
            elif name == "timer-mutant-list":
                self.assertIn("--exact", args)
                path.write_text(("wrong_test" if mode == "unknown" else witness) + ": test\n")
            else:
                raise AssertionError(name)
            return path

        def mutant_process(args, cwd=None, stdout=None, **kwargs):
            self.assertEqual(args[1:], [witness, "--exact", "--format", "pretty"])
            if mode == "timeout":
                raise subprocess.TimeoutExpired(args, 120)
            if mode == "green":
                stdout.write(self.result_line(passed=1))
                return subprocess.CompletedProcess(args, 0)
            assertion = ('assertion `left == right` failed\n  left: []\n right: ["battle/command/fight"]\n'
                         if mode != "wrong_assertion" else "assertion failed: unrelated\n")
            stdout.write(f"test {witness} ... FAILED\nthread '{witness}' (123) panicked at test.rs:147:5:\n" + assertion + self.result_line(failed=1))
            return subprocess.CompletedProcess(args, 101)

        try:
            with patch.object(self.feedback, "capture", side_effect=tracked_diff), patch.object(self.feedback, "run", side_effect=mutant_run), patch.object(self.feedback.subprocess, "run", side_effect=mutant_process):
                self.feedback.timer_behavioral_mutant({"timer_mutant": policy}, summary, [f'{policy["target"]}::{witness}'])
        finally:
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(summary["timer_mutant"]["restored_sha256"], hashlib.sha256(original).hexdigest())
            self.assertEqual(list((self.root / "report").glob("m9e-timer-mutant-*")), [])
        return summary

    def test_timer_mutant_detects_the_behavioral_failure_and_restores_source(self):
        summary = self.invoke_synthetic_timer_mutant("detected")
        evidence = summary["timer_mutant"]
        self.assertEqual(evidence["status"], "detected")
        self.assertEqual(evidence["exit_code"], 101)
        self.assertNotEqual(evidence["original_sha256"], evidence["mutant_sha256"])
        self.assertEqual(evidence["tests"], {"executed": 1, "passed": 0, "failed": 1, "skipped": 0})

    def test_timer_mutant_rejects_green_build_timeout_and_unrecognized_failures(self):
        for mode, reason in (("green", "exact cursor-effect assertion"), ("build", "build exited"),
                             ("timeout", "timed out"), ("unknown", "enumerate exactly"),
                             ("wrong_assertion", "exact cursor-effect assertion")):
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, reason):
                self.invoke_synthetic_timer_mutant(mode)

    def test_timer_mutant_requires_a_passing_positive_before_source_mutation(self):
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["timer_focus"]["mutant"]
        with self.assertRaisesRegex(RuntimeError, "passing ordinary behavioral witness"):
            self.feedback.timer_behavioral_mutant({"timer_mutant": policy}, {}, [])
        source = self.root / policy["source"]
        source.parent.mkdir(parents=True, exist_ok=True)
        duplicated = (policy["original"] + "\n") * 2
        source.write_text(duplicated)
        with patch.object(self.feedback, "capture", return_value=""), self.assertRaisesRegex(RuntimeError, "occur exactly once"):
            self.feedback.timer_behavioral_mutant({"timer_mutant": policy}, {}, [f'{policy["target"]}::{policy["test"]}'])
        self.assertEqual(source.read_text(), duplicated)
        self.configure_timer_scope()
        self.changed = self.config["timer_focus"]["paths"]
        self.build_code = 1
        with patch.object(self.feedback, "timer_behavioral_mutant") as mutant:
            code, _ = self.invoke()
        self.assertEqual(code, 1)
        mutant.assert_not_called()

    def worker_executable_artifact(self, filename="candidate-worker"):
        self.package("er-kernel-worker")
        executable = self.root / "built" / filename
        executable.parent.mkdir(exist_ok=True)
        executable.write_bytes(b"#!/bin/sh\n# synthetic artifact; never executed by these tests\n")
        executable.chmod(0o755)
        return {"reason": "compiler-artifact", "package_id": "synthetic-worker-package",
                "target": {"name": "er-kernel-worker", "kind": ["bin"]},
                "profile": {"test": False}, "executable": str(executable),
                "manifest_path": str(self.rust / "crates/er-kernel-worker/Cargo.toml")}

    def test_worker_executable_binding_rejects_wrong_artifacts_and_ambiguity(self):
        summary = {"product_sha": CANDIDATE, "target": "x86_64-unknown-linux-gnu", "profile": "test"}
        valid = self.worker_executable_artifact()
        invalid = []
        for key, value in (("target", {"name": "another-worker", "kind": ["bin"]}),
                           ("target", {"name": "er-kernel-worker", "kind": ["lib"]}),
                           ("profile", {"test": True}), ("profile", {}),
                           ("manifest_path", str(self.rust / "crates/er-native/Cargo.toml")),
                           ("executable", str(self.root / "missing-worker"))):
            wrong = copy.deepcopy(valid)
            wrong[key] = value
            invalid.append([wrong])
        invalid.extend([[], [valid, self.worker_executable_artifact("other-worker")]])
        for index, artifacts in enumerate(invalid):
            with self.subTest(case=index):
                with self.assertRaises(RuntimeError):
                    self.feedback.discover_worker_executable(artifacts, summary)
        binding = self.feedback.discover_worker_executable([valid], summary)
        self.assertEqual(binding["path"], str(Path(valid["executable"]).resolve()))
        self.assertEqual(binding["sha256"], hashlib.sha256(Path(valid["executable"]).read_bytes()).hexdigest())
        self.assertEqual(binding["source_sha"], CANDIDATE)

    def test_bound_worker_environment_reaches_only_current_endpoint_execution(self):
        self.package("er-lab")
        self.binary_ids = {"a_suite": ["unrelated"], "current_kernel_endpoint_v2": ["real_process"],
                           "current_kernel_endpoint_faults_v2": ["synthetic_fault_peer"]}
        self.binary_crates["current_kernel_endpoint_v2"] = "er-lab"
        self.binary_crates["current_kernel_endpoint_faults_v2"] = "er-lab"
        self.extra_artifacts = [self.worker_executable_artifact()]
        selection = self.feedback.plan()
        selection["packages"] = ["er-native", "er-lab", "er-kernel-worker"]
        selection["requires_worker_executable"] = True
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        binding = summary["worker_executable"]
        self.assertEqual(self.executed, ["a_suite", "current_kernel_endpoint_faults_v2", "current_kernel_endpoint_v2"])
        for name, phase, env in self.binary_envs:
            with self.subTest(name=name, phase=phase):
                if name != "current_kernel_endpoint_v2":
                    self.assertIsNone(env)
                else:
                    self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE"], binding["path"])
                    self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], binding["sha256"])
                    self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
                    self.assertEqual(env["ER_M9E_WORKER_BUILD_TARGET"], summary["target"])
                    self.assertEqual(env["ER_M9E_WORKER_BUILD_PROFILE"], summary["profile"])
        self.assertIn("worker-clippy", summary["timing_ms"])
        self.assertIn("endpoint-clippy", summary["timing_ms"])
        self.assertNotIn("wasm_tests", summary)
        self.assertNotIn("browser_tests", summary)

    def test_cumulative_current_and_browser_paths_require_all_platform_witnesses(self):
        self.configure_browser_scope()
        current_paths = self.config["current_session_focus"]["paths"]
        browser_paths = self.config["browser_session_focus"]["paths"]
        for changed in (browser_paths, current_paths + browser_paths, ["rust/crates/er-env/src/current.rs"]):
            with self.subTest(changed=changed):
                self.changed = list(changed)
                selection = self.feedback.plan()
                self.assertEqual(selection["base_sha"], BASE)
                self.assertTrue(selection["requires_browser"])
                self.assertTrue(selection["requires_wasm"])
                self.assertEqual(selection["wasm_test"], "m9e_parity")
                self.assertEqual(selection["boundary_paths"], [])
                for package in ("er-env", "er-cli", "er-web"):
                    self.assertIn(package, selection["packages"])
                    self.assertEqual(selection["execution_scope"][package], ["*"])
                self.assertEqual(selection["execution_scope"]["er-wasm"], ["m9e_parity"])

    def test_environment_plus_ordinary_cli_change_keeps_browser_on_broad_scope(self):
        self.configure_browser_scope()
        self.changed = ["rust/crates/er-env/src/current.rs", "rust/crates/er-cli/src/main.rs"]
        selection = self.feedback.plan()
        self.assertIsNone(selection["execution_scope"])
        self.assertTrue(selection["requires_browser"])
        self.assertTrue(selection["requires_wasm"])
        self.assertIn("er-web", selection["packages"])

    def test_browser_scope_rejects_unmapped_browser_shared_and_unknown_changes(self):
        self.configure_browser_scope()
        allowed = ["rust/crates/er-env/src/current.rs", "rust/crates/er-web/src/host_v2.rs"]
        for extra in (
            "rust/crates/er-web/src/other_host.rs",
            "rust/crates/er-web/Cargo.toml",
            "rust/crates/er-web/build.rs",
            "rust/crates/er-kernel/src/game_kernel_v7.rs",
            "rust/crates/er-native/src/lib.rs",
            "rust/fixtures/generated.json",
            "src/rust-browser/worker/rust-kernel-worker.ts",
            "test/browser/rust-browser/new.spec.ts",
            "unmapped-input.json",
        ):
            with self.subTest(extra=extra):
                self.changed = allowed + [extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()

    @staticmethod
    def browser_reports():
        titles = (
            "natural V7 browser startup reaches the real battle command",
            "two V7 browser hosts wait for both humans and converge one turn",
        )
        specs = [{"title": title, "tests": [{
            "projectName": "chromium", "expectedStatus": "passed", "status": "expected",
            "results": [{"status": "passed", "retry": 0}],
        }]} for title in titles]
        playwright = {"suites": [{"suites": [{"specs": specs}]}], "errors": [],
                      "stats": {"expected": 2, "unexpected": 0, "flaky": 0, "skipped": 0}}
        vitest = {"success": True, "numTotalTests": 1, "numPassedTests": 1,
                  "numFailedTests": 0, "numPendingTests": 0, "numTodoTests": 0,
                  "testResults": [{"assertionResults": [{"status": "passed", "fullName":
                      "BrowserEffectRouterV2 routes every typed effect once and fences stale or disposed batches"}]}]}
        return playwright, vitest

    def test_browser_report_accepts_exact_two_chromium_and_one_effect_test(self):
        playwright, vitest = self.browser_reports()
        counts = self.feedback.browser_result_counts(playwright, vitest)
        self.assertEqual(counts["chromium"]["passed"], 2)
        self.assertEqual(counts["typed_effects"]["passed"], 1)
        self.assertEqual(len(counts["chromium"]["selected_test_ids"]), 2)
        self.assertIn("not production Worker/WebRTC", counts["scope"])

    def test_browser_report_rejects_zero_missing_duplicate_or_unknown_chromium(self):
        for defect in ("zero", "missing", "duplicate", "wrong_title", "missing_execution", "duplicate_execution", "global_error"):
            with self.subTest(defect=defect):
                playwright, vitest = self.browser_reports()
                specs = playwright["suites"][0]["suites"][0]["specs"]
                if defect == "zero":
                    playwright["suites"] = []
                elif defect == "missing":
                    specs.pop()
                elif defect == "duplicate":
                    specs[1] = copy.deepcopy(specs[0])
                elif defect == "wrong_title":
                    specs[0]["title"] = "another browser test"
                elif defect == "missing_execution":
                    specs[0]["tests"] = []
                elif defect == "duplicate_execution":
                    specs[0]["tests"].append(copy.deepcopy(specs[0]["tests"][0]))
                else:
                    playwright["errors"] = [{"message": "fixture server teardown failed"}]
                with self.assertRaises(RuntimeError):
                    self.feedback.browser_result_counts(playwright, vitest)

    def test_browser_report_rejects_failed_skipped_flaky_and_retried_results(self):
        for defect in ("failed", "skipped", "flaky", "retry_history", "nonzero_retry", "wrong_project", "expected_failure"):
            with self.subTest(defect=defect):
                playwright, vitest = self.browser_reports()
                test = playwright["suites"][0]["suites"][0]["specs"][0]["tests"][0]
                if defect in ("failed", "skipped"):
                    test["results"][0]["status"] = defect
                elif defect == "flaky":
                    test["status"] = "flaky"
                elif defect == "retry_history":
                    test["results"] = [{"status": "failed", "retry": 0}, {"status": "passed", "retry": 1}]
                elif defect == "nonzero_retry":
                    test["results"][0]["retry"] = 1
                elif defect == "wrong_project":
                    test["projectName"] = "firefox"
                else:
                    test["expectedStatus"] = "failed"
                with self.assertRaises(RuntimeError):
                    self.feedback.browser_result_counts(playwright, vitest)

    def test_browser_report_rejects_missing_wrong_or_nonpassing_effect_identity(self):
        for defect in ("zero", "missing", "duplicate", "wrong_identity", "failed", "pending", "failed_run", "wrong_total"):
            with self.subTest(defect=defect):
                playwright, vitest = self.browser_reports()
                assertions = vitest["testResults"][0]["assertionResults"]
                if defect == "zero":
                    vitest["numTotalTests"] = 0
                    vitest["numPassedTests"] = 0
                elif defect == "missing":
                    vitest["testResults"] = []
                elif defect == "duplicate":
                    assertions.append(copy.deepcopy(assertions[0]))
                elif defect == "wrong_identity":
                    assertions[0]["fullName"] = "another passing effect test"
                elif defect in ("failed", "pending"):
                    assertions[0]["status"] = defect
                elif defect == "failed_run":
                    vitest["success"] = False
                else:
                    vitest["numTotalTests"] = 2
                with self.assertRaises(RuntimeError):
                    self.feedback.browser_result_counts(playwright, vitest)

    def test_historical_disposition_is_bound_to_one_crate_target_and_test(self):
        self.changed = ["rust/crates/er-native/src/lib.rs"]
        disposition = {"crate": "er-native", "target": "a_suite", "test": "historical", "reason": "frozen historical scope"}
        self.config["historical_dispositions"] = [disposition]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.binary_ids["a_suite"] = ["historical", "current"]
        self.results["a_suite"] = (0, self.result_line(passed=1).replace("0 filtered out", "1 filtered out"))
        code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(summary["historical_dispositions"], [disposition])
        self.assertEqual(summary["tests"]["selected"], 2)
        self.assertEqual(summary["tests"]["passed"], 2)
        self.assertEqual(summary["tests"]["skipped"], 0)
        skips = [args for args in self.commands if "--skip" in args]
        self.assertEqual(len(skips), 1)
        self.assertEqual(skips[0][-2:], ["--skip", "historical"])

    def test_missing_exact_historical_disposition_fails_before_execution(self):
        self.changed = ["rust/crates/er-native/src/lib.rs"]
        self.config["historical_dispositions"] = [{"crate": "er-native", "target": "a_suite", "test": "missing", "reason": "frozen historical scope"}]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("exactly one enumerated test", summary["first_failure"])
        self.assertEqual(self.executed, [])

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
