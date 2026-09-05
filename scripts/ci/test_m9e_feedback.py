"""Remote-only regression tests for the feedback gate and evidence contract.

Run with the runner's standard-library unittest. Every Git/Cargo/test process is
mocked; fixture repositories and reports live in disposable temporary folders.
"""

import base64
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
from types import SimpleNamespace
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
            # The native workflow runs these mocks before the real phase. Keep
            # historical harness tests independent of the invoking phase env.
            "M9E_PHASE": "combined",
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
        self.baseline_cli_manifest = None
        self.baseline_repro_manifest = None
        self.baseline_batch_manifest = None
        self.capture_calls = []
        self.commands = []
        self.events = []
        self.executed = []
        self.binary_workdirs = []
        self.binary_envs = []
        self.binary_crates = {}
        self.binary_targets = {}
        self.extra_artifacts = []
        self.format_code = 0
        self.clippy_code = 0
        self.clippy_codes = {}
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
        if args == ["git", "show", f"{BASE}:rust/crates/er-cli/Cargo.toml"] and self.baseline_cli_manifest is not None:
            return self.baseline_cli_manifest
        if args == ["git", "show", f"{BASE}:rust/crates/er-repro/Cargo.toml"] and self.baseline_repro_manifest is not None:
            return self.baseline_repro_manifest
        if args == ["git", "show", f"{BASE}:rust/crates/er-batch/Cargo.toml"] and self.baseline_batch_manifest is not None:
            return self.baseline_batch_manifest
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
            package = args[args.index("-p") + 1]
            self.events.append("clippy:" + package)
            code = self.clippy_codes.get(package, self.clippy_code)
            if code:
                stdout.write("error: synthetic worker lint failure\n")
            return subprocess.CompletedProcess(args, code)
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
                        "target": {"name": self.binary_targets.get(name, name)},
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

    def test_docs_and_infrastructure_readiness_do_not_expand_reverse_consumers(self):
        self.configure_browser_scope()
        self.package("er-env", '[dependencies]\ner-canonical = { path = "../er-canonical" }\n')
        self.package("er-kernel-worker", '[dependencies]\ner-env = { path = "../er-env" }\n')
        self.package("er-lab", '[dependencies]\ner-kernel-worker = { path = "../er-kernel-worker" }\n')
        reload = self.rust / "crates/er-cli/tests/m9e_current_reload.rs"
        reload.parent.mkdir(parents=True)
        reload.write_text("// synthetic current process witness presence\n")
        bridge = self.root / "test/browser/rust-browser/m9e-current-repro-bridge.ts"
        bridge.parent.mkdir(parents=True)
        bridge.write_text("// synthetic current browser bridge presence\n")
        for path in ("docs/plans/rust-kernel/m9e-progress.md", "scripts/ci/m9e_feedback.py"):
            self.changed = [path]
            with self.subTest(path=path):
                selection = self.feedback.plan()
                self.assertEqual(selection["packages"], ["er-canonical"])
                self.assertIsNone(selection["execution_scope"])
                for flag in ("requires_wasm", "requires_browser", "requires_worker_executable", "requires_cli_executable"):
                    self.assertFalse(selection[flag], flag)

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

    def test_format_failure_returns_without_starting_product_tests(self):
        self.format_code = 1
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["status"], "failed")
        self.assertIn("format exited 1", summary["format_failure"])
        self.assertEqual(summary["first_failure"], summary["format_failure"])
        self.assertEqual(summary["tests"]["passed"], 0)
        self.assertEqual(self.executed, [])
        self.assertNotIn("build", self.events)
        self.assertNotIn("format-patch", self.events)
        self.assertNotIn("restore", self.events)
        self.assertFalse((self.compact / "format.patch").exists())

    def test_format_patch_is_scoped_and_restored_before_early_return(self):
        self.format_code = 1
        source = "rust/crates/er-native/src/lib.rs"
        self.changed = [source, "docs/plans/rust-kernel/m9e-progress.md"]
        patch_bytes = b"diff --git a/rust/crates/er-native/src/lib.rs b/rust/crates/er-native/src/lib.rs\n"
        with patch.object(self.feedback.subprocess, "check_output", return_value=patch_bytes) as diff:
            code, summary = self.invoke()
        diff.assert_called_once_with(["git", "diff", "--unified=1", "--", source], cwd=self.root)
        self.assertEqual(code, 1)
        self.assertEqual(summary["tests"]["passed"], 0)
        self.assertEqual(self.executed, [])
        self.assertNotIn("build", self.events)
        self.assertLess(self.events.index("format-patch"), self.events.index("restore"))
        self.assertEqual((self.compact / "format.patch").read_bytes(), patch_bytes)
        self.assertEqual((self.full / "format.patch").read_bytes(), patch_bytes)
        self.assertEqual(summary["format_patch_bytes"], len(patch_bytes))
        self.assertEqual(summary["format_patch_omitted_bytes"], 0)
        self.assertLessEqual(sum(path.stat().st_size for path in self.compact.iterdir()), 64 * 1024)

    def test_oversized_format_patch_reports_omitted_bytes_without_raising_cap(self):
        self.format_code = 1
        self.changed = ["rust/crates/er-native/src/lib.rs"]
        patch_bytes = b"x" * 32769
        with patch.object(self.feedback.subprocess, "check_output", return_value=patch_bytes):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertFalse((self.compact / "format.patch").exists())
        self.assertEqual(summary["format_patch_bytes"], 32769)
        self.assertEqual(summary["format_patch_omitted_bytes"], 32769)
        self.assertEqual((self.full / "format.patch").read_bytes(), patch_bytes)
        self.assertLessEqual(sum(path.stat().st_size for path in self.compact.iterdir()), 64 * 1024)

    def test_compact_format_patch_keeps_whole_files_and_reports_omitted_paths(self):
        def file_diff(name, size):
            return f"diff --git a/{name} b/{name}\n".encode() + b"x" * size + b"\n"
        first = file_diff("first.rs", 20000)
        oversized = file_diff("large.rs", 40000)
        last = file_diff("last.rs", 10000)
        compact, metadata = self.feedback.compact_format_patch(first + oversized + last)
        self.assertEqual(compact, first + last)
        self.assertLessEqual(len(compact), 32768)
        self.assertEqual(metadata["included_paths"], ["first.rs", "last.rs"])
        self.assertEqual(metadata["omitted_paths"], ["large.rs"])
        self.assertEqual(metadata["omitted_bytes"], len(oversized))
        self.format_code = 1
        self.changed = ["rust/crates/er-native/src/lib.rs"]
        with patch.object(self.feedback.subprocess, "check_output", return_value=first + oversized + last):
            _, summary = self.invoke()
        self.assertEqual((self.compact / "format.patch").read_bytes(), first + last)
        self.assertEqual(summary["format_patch_omitted_bytes"], len(oversized))
        self.assertEqual(summary["format_patch_omitted_paths"], ["large.rs"])

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

    def test_current_cli_utility_paths_keep_focused_parity_and_require_clippy(self):
        self.configure_browser_scope()
        self.changed = ["rust/crates/er-cli/src/main.rs", "rust/crates/er-cli/src/current_commands.rs",
                        "rust/crates/er-cli/tests/m9e_current_entry.rs"]
        selection = self.feedback.plan()
        self.assertEqual(selection["execution_scope"], self.config["current_session_focus"]["execute"])
        self.assertTrue(selection["requires_cli_clippy"])
        self.assertTrue(selection["requires_wasm"])
        self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertFalse(selection["requires_browser"])
        for changed in (["rust/crates/er-cli/src/current_agent.rs"], ["rust/crates/er-cli/tests/m9e_current_entry.rs"]):
            self.changed = changed
            self.assertTrue(self.feedback.plan()["requires_cli_clippy"])
        for changed in (["docs/plans/rust-kernel/m9e-progress.md"], ["rust/crates/er-env/src/current.rs"]):
            self.changed = changed
            self.assertFalse(self.feedback.plan()["requires_cli_clippy"])

    def test_current_cli_clippy_executes_and_its_failure_fails_feedback(self):
        self.configure_browser_scope()
        self.changed = ["rust/crates/er-cli/src/current_commands.rs"]
        self.binary_ids = {"env_suite": ["session"], "cli_suite": ["commands"], "m9e_parity": [
            "native_replays_v7_raw_inputs_eventwise", "native_replays_v7_held_timers_eventwise"]}
        self.binary_crates = {"env_suite": "er-env", "cli_suite": "er-cli", "m9e_parity": "er-wasm"}
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        for clippy_code in (0, 1):
            with self.subTest(clippy_code=clippy_code):
                self.clippy_code = clippy_code
                self.events.clear()
                self.executed.clear()
                with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
                    code, summary = self.invoke()
                self.assertEqual(code, clippy_code)
                self.assertIn("cli-clippy", summary["timing_ms"])
                self.assertIn(["cargo", "clippy", "--locked", "-p", "er-cli", "--all-targets", "--no-deps", "--", "-D", "warnings"], self.commands)
                self.assertEqual(summary["tests"]["selected"], 4)
                for target in self.binary_ids:
                    self.assertLess(self.events.index("list:" + target), self.events.index("clippy"))
                browser.assert_not_called()
                if clippy_code:
                    self.assertEqual(summary["tests"]["executed"], 0)
                    self.assertEqual(self.executed, [])
                    self.assertIn("cli-clippy exited 1", summary["first_failure"])
                    wasm.assert_not_called()
                else:
                    self.assertEqual(summary["tests"]["passed"], 4)
                    self.assertEqual(set(self.executed), set(self.binary_ids))
                    self.assertLess(self.events.index("clippy"), self.events.index("execute:" + self.executed[0]))
                    wasm.assert_called_once()

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

    def test_worker_clippy_runs_after_discovery_before_tests_and_fails_early(self):
        selection = self.feedback.plan()
        selection["worker_session_focus"] = True
        for clippy_code in (0, 1):
            with self.subTest(clippy_code=clippy_code):
                self.clippy_code = clippy_code
                self.events.clear()
                self.executed.clear()
                with patch.object(self.feedback, "plan", return_value=selection), patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
                    code, summary = self.invoke()
                self.assertEqual(code, clippy_code)
                self.assertEqual(summary["tests"]["selected"], 2)
                for target in self.binary_ids:
                    self.assertLess(self.events.index("list:" + target), self.events.index("clippy"))
                self.assertIn("worker-clippy", summary["timing_ms"])
                self.assertIn(["cargo", "clippy", "--locked", "-p", "er-kernel-worker", "--all-targets", "--no-deps", "--", "-D", "warnings"], self.commands)
                wasm.assert_not_called()
                browser.assert_not_called()
                if clippy_code:
                    self.assertEqual(summary["tests"]["executed"], 0)
                    self.assertEqual(self.executed, [])
                    self.assertIn("worker-clippy exited 1", summary["first_failure"])
                else:
                    self.assertEqual(summary["tests"]["passed"], 2)
                    self.assertEqual(self.executed, ["a_suite", "b_suite"])
                    self.assertLess(self.events.index("clippy"), self.events.index("execute:a_suite"))

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

    @staticmethod
    def wasm_timer_output():
        return ("test wasm_replays_v7_raw_inputs_eventwise ... ok\n"
                "test wasm_replays_v7_held_timers_eventwise ... ok\n"
                "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n"
                "test result: ok. 2 passed; 0 failed; 0 ignored; 0 filtered out\n")

    def test_wasm_timer_parity_requires_two_exact_witnesses_and_equal_digest(self):
        text = self.wasm_timer_output()
        evidence = self.feedback.wasm_parity_evidence(text, "d" * 64)
        self.assertEqual(evidence["expected"], 2)
        self.assertEqual(evidence["timer_parity_digest"], "d" * 64)
        cases = [text.replace("2 passed", "1 passed"), text.replace("2 passed", "0 passed"),
                 text.replace("0 ignored", "1 ignored"), text.replace("0 failed", "1 failed"),
                 text.replace("wasm_replays_v7_held_timers_eventwise", "wasm_replays_v7_raw_inputs_eventwise"),
                 text.replace("test wasm_replays_v7_held_timers_eventwise ... ok\n", ""),
                 text + "test result: ok. 2 passed; 0 failed; 0 ignored;\n"]
        for invalid in cases:
            with self.subTest(invalid=invalid), self.assertRaisesRegex(RuntimeError, "identities/counts"):
                self.feedback.wasm_parity_evidence(invalid, "d" * 64)
        for native in (None, "e" * 64):
            with self.subTest(native=native), self.assertRaisesRegex(RuntimeError, "digests disagree"):
                self.feedback.wasm_parity_evidence(text, native)

    def test_timer_parity_markers_reject_missing_duplicate_and_malformed_values(self):
        marker = "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n"
        self.assertEqual(self.feedback.timer_parity_digest(marker, "native"), "d" * 64)
        for invalid in ("", marker * 2, marker.replace("d", "g"), marker.rstrip() + "extra\n"):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(RuntimeError, "digest missing, malformed or duplicated"):
                self.feedback.timer_parity_digest(invalid, "native")

    def test_wasm_gate_requests_visible_timer_digest_without_native_rerun(self):
        summary = {"native_timer_parity_digest": "d" * 64}
        def wasm_run(args, name, cwd=None, env=None):
            path = self.full / (name + ".log")
            path.write_text(self.wasm_timer_output() if name == "wasm-eventwise" else "")
            return path
        with patch.dict(os.environ, {"RUNNER_TEMP": str(self.root)}), patch.object(self.feedback.shutil, "which", return_value="wasm-bindgen"), patch.object(self.feedback, "capture", return_value="wasm-bindgen 0.2.127"), patch.object(self.feedback, "run", side_effect=wasm_run) as run:
            self.feedback.wasm_checks({"wasm_test": "m9e_parity"}, summary)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.args[0][-2:], ["--", "--nocapture"])
        self.assertEqual(summary["wasm_tests"]["passed"], 2)

    def configure_supervisor_scope(self):
        self.configure_endpoint_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["supervisor_focus"] = policy["supervisor_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-lab", '[dependencies]\ner-kernel-worker = { path = "../er-kernel-worker" }\n')
        self.package("er-reverse", '[dependencies]\ner-lab = { path = "../er-lab" }\n')

    @staticmethod
    def cli_reload_lock_fixture(dependencies):
        return ('version = 4\n\n[[package]]\nname = "er-cli"\nversion = "0.1.0"\n'
                + "dependencies = " + json.dumps(dependencies) + '\n'
                + '\n[[package]]\nname = "er-env"\nversion = "0.1.0"\n'
                + '\n[[package]]\nname = "er-kernel-worker"\nversion = "0.1.0"\n')

    def configure_cli_reload_scope(self):
        self.configure_supervisor_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["cli_reload_focus"] = policy["cli_reload_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-agent-protocol")
        self.package("er-cli", '[dependencies]\ner-agent-protocol = { path = "../er-agent-protocol" }\n'
                     'er-kernel-worker = { path = "../er-kernel-worker" }\n')
        self.package("er-reverse", '[dependencies]\ner-cli = { path = "../er-cli" }\n')
        self.baseline_cli_manifest = (self.rust / "crates/er-cli/Cargo.toml").read_text().replace(
            'er-kernel-worker = { path = "../er-kernel-worker" }\n', '')
        self.baseline_lock = self.cli_reload_lock_fixture(["er-env"])
        (self.rust / "Cargo.lock").write_text(self.cli_reload_lock_fixture(["er-env", "er-kernel-worker"]))

    def test_cli_reload_scope_requires_exact_process_witnesses_and_wasm_without_browser(self):
        self.configure_cli_reload_scope()
        self.changed = self.config["cli_reload_focus"]["paths"]
        selection = self.feedback.plan()
        self.assertTrue(selection["cli_reload_focus"])
        self.assertTrue(selection["requires_worker_executable"])
        self.assertTrue(selection["requires_wasm"])
        self.assertFalse(selection["requires_browser"])
        self.assertTrue(selection["requires_agent_protocol_clippy"])
        self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertEqual(selection["execution_scope"]["er-wasm"], ["m9e_parity"])
        self.assertEqual(selection["execution_scope"]["er-agent-protocol"], ["*"])
        self.assertEqual(selection["required_native_targets"]["er-cli"], ["m9e_current_reload", "m9e_current_entry"])
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        self.assertIsNone(selection["worker_lock_guard"])
        self.assertEqual(selection["cli_reload_dependency_guard"], {
            "status": "verified", "owner": "er-cli", "added_workspace_dependencies": ["er-kernel-worker"],
            "baseline_sha": BASE})

    def test_cli_reload_guard_rejects_every_other_lock_or_manifest_change(self):
        self.configure_cli_reload_scope()
        before = self.baseline_lock
        after = (self.rust / "Cargo.lock").read_text()
        manifest = (self.rust / "crates/er-cli/Cargo.toml").read_text()
        invalid_locks = {
            "unchanged": before,
            "removed": self.cli_reload_lock_fixture(["er-kernel-worker"]),
            "extra": self.cli_reload_lock_fixture(["er-env", "er-kernel-worker", "serde"]),
            "duplicate": self.cli_reload_lock_fixture(["er-env", "er-kernel-worker", "er-kernel-worker"]),
            "versioned_dependency": self.cli_reload_lock_fixture(["er-env", "er-kernel-worker 0.1.0"]),
            "top_metadata": after.replace("version = 4", "version = 3"),
            "owner_metadata": after.replace('name = "er-cli"\n', 'name = "er-cli"\nchecksum = "changed"\n'),
            "other_record": after.replace('name = "er-env"\n', 'name = "er-env"\nchecksum = "changed"\n'),
            "version": after.replace('name = "er-env"\nversion = "0.1.0"', 'name = "er-env"\nversion = "0.2.0"'),
            "source": after.replace('name = "er-kernel-worker"\n', 'name = "er-kernel-worker"\nsource = "registry+invalid"\n'),
            "inventory": after + '\n[[package]]\nname = "new"\nversion = "0.1.0"\n',
            "duplicate_record": after + '\n[[package]]\nname = "er-env"\nversion = "0.1.0"\n',
        }
        for defect, lock in invalid_locks.items():
            with self.subTest(defect=defect), self.assertRaisesRegex(RuntimeError, "CLI lock guard"):
                self.feedback.verify_cli_reload_dependencies(before, lock, self.baseline_cli_manifest, manifest)
        invalid_manifests = [manifest.replace('../er-kernel-worker', '../wrong'),
                            manifest.replace('version = "0.1.0"', 'version = "0.2.0"'),
                            manifest + '\n[features]\nextra = []\n',
                            manifest.replace('{ path = "../er-kernel-worker" }', '{ path = "../er-kernel-worker", optional = true }')]
        for changed in invalid_manifests:
            with self.subTest(manifest=changed), self.assertRaisesRegex(RuntimeError, "CLI dependency guard"):
                self.feedback.verify_cli_reload_dependencies(before, after, self.baseline_cli_manifest, changed)
        with self.assertRaisesRegex(RuntimeError, "already present"):
            self.feedback.verify_cli_reload_dependencies(before, after, manifest, manifest)
        external = 'name = "er-kernel-worker"\nsource = "registry+invalid"\n'
        with self.assertRaisesRegex(RuntimeError, "unambiguous existing workspace"):
            self.feedback.verify_cli_reload_dependencies(
                before.replace('name = "er-kernel-worker"\n', external),
                after.replace('name = "er-kernel-worker"\n', external), self.baseline_cli_manifest, manifest)
        ambiguous = '\n[[package]]\nname = "er-kernel-worker"\nversion = "0.2.0"\n'
        with self.assertRaisesRegex(RuntimeError, "unambiguous existing workspace"):
            self.feedback.verify_cli_reload_dependencies(before + ambiguous, after + ambiguous,
                                                         self.baseline_cli_manifest, manifest)

    def test_cli_reload_scope_rejects_unpaired_guards_and_preserves_broader_boundaries(self):
        self.configure_cli_reload_scope()
        source = "rust/crates/er-cli/src/current_worker_agent.rs"
        for extra in ("rust/Cargo.lock", "rust/crates/er-cli/Cargo.toml"):
            self.changed = [source, extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "must be paired"):
                self.feedback.plan()
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-web/src/host_v2.rs", "unknown.json"):
            self.changed = [source, extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                self.feedback.plan()
        self.changed = [source, "rust/crates/er-env/src/current.rs"]
        selection = self.feedback.plan()
        self.assertFalse(selection["cli_reload_focus"])
        self.assertIsNone(selection["execution_scope"])
        self.assertTrue(selection["requires_wasm"])
        self.assertTrue(selection["requires_browser"])

    def test_cli_reload_missing_ambiguous_empty_or_wrong_crate_witness_fails(self):
        self.configure_cli_reload_scope()
        self.changed = ["rust/crates/er-cli/src/current_worker_agent.rs"]
        required = self.feedback.plan()["required_native_targets"]
        valid = [(crate, target, ["real_test"]) for crate, names in required.items() for target in names]
        self.assertEqual(self.feedback.required_native_target_counts(required, valid)["er-cli:m9e_current_reload"], 1)
        without = [row for row in valid if row[:2] != ("er-cli", "m9e_current_reload")]
        for rows in (without, without + [("er-cli", "m9e_current_reload", [])],
                     without + [("er-lab", "m9e_current_reload", ["wrong_crate"])],
                     valid + [("er-cli", "m9e_current_reload", ["duplicate"]) ]):
            with self.assertRaisesRegex(RuntimeError, "er-cli:m9e_current_reload"):
                self.feedback.required_native_target_counts(required, rows)

    def test_cli_reload_bound_artifact_reaches_listing_execution_and_protocol_clippy(self):
        self.configure_cli_reload_scope()
        self.changed = ["rust/crates/er-cli/src/current_worker_agent.rs"]
        selection = self.feedback.plan()
        # This orchestration fixture isolates CLI binding. The full required
        # target inventory and exact two parity tests have separate witnesses.
        selection["execution_scope"] = {"er-cli": ["a_suite", "m9e_current_reload"]}
        selection["required_native_targets"] = {"er-cli": ["m9e_current_reload"]}
        self.binary_ids = {"a_suite": ["ordinary_cli"], "m9e_current_reload": ["actual_cli_reload"]}
        self.binary_crates = {"a_suite": "er-cli", "m9e_current_reload": "er-cli"}
        self.extra_artifacts = [self.worker_executable_artifact()]
        self.assertIsNone(self.feedback.native_target_env("er-lab", "m9e_current_reload", None))
        self.assertIsNone(self.feedback.native_target_env("er-cli", "current_kernel_endpoint_v2", None))
        with self.assertRaisesRegex(RuntimeError, "no bound worker executable"):
            self.feedback.native_target_env("er-cli", "m9e_current_reload", None)
        with patch.object(self.feedback, "plan", return_value=selection), patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual([(name, phase) for name, phase, _ in self.binary_envs],
                         [("a_suite", "list"), ("m9e_current_reload", "list"),
                          ("m9e_current_reload", "execute"), ("a_suite", "execute")])
        self.assertEqual(self.executed, ["m9e_current_reload", "a_suite"])
        self.assertLess(self.events.index("list:m9e_current_reload"), self.events.index("execute:m9e_current_reload"))
        binding = summary["worker_executable"]
        for name, _, env in self.binary_envs:
            if name == "a_suite":
                self.assertIsNone(env)
                continue
            self.assertEqual({key: env[key] for key in env if key.startswith("ER_M9E_WORKER_")}, {
                "ER_M9E_WORKER_EXECUTABLE": binding["path"], "ER_M9E_WORKER_EXECUTABLE_SHA256": binding["sha256"],
                "ER_M9E_WORKER_SOURCE_SHA": CANDIDATE, "ER_M9E_WORKER_BUILD_TARGET": summary["target"],
                "ER_M9E_WORKER_BUILD_PROFILE": summary["profile"]})
        self.assertIn("agent-protocol-clippy", summary["timing_ms"])
        wasm.assert_called_once()
        browser.assert_not_called()
        self.extra_artifacts = []
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("exactly one real worker executable", summary["first_failure"])

    @staticmethod
    def repro_lock_fixture(repro_dependencies, cli_dependencies):
        owners = {"er-repro": repro_dependencies, "er-cli": cli_dependencies}
        return "version = 4\n" + "".join(
            f'\n[[package]]\nname = "{name}"\nversion = "0.1.0"\n'
            + ("dependencies = " + json.dumps(owners[name]) + "\n" if name in owners else "")
            for name in ("er-repro", "er-cli", "er-env", "er-game", "er-kernel", "er-web"))

    def configure_repro_scope(self):
        self.configure_browser_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["current_repro_focus"] = policy["current_repro_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-game")
        self.package("er-lab")
        self.package("er-kernel-worker")
        self.package("er-repro", '[dependencies]\ner-env = { path = "../er-env" }\n'
                     'er-game = { path = "../er-game" }\ner-kernel = { path = "../er-kernel" }\n')
        self.package("er-cli", '[dependencies]\ner-repro = { path = "../er-repro" }\n'
                     '[dev-dependencies]\ner-web = { path = "../er-web" }\n')
        self.package("er-reverse", '[target.\'cfg(unix)\'.build-dependencies]\n'
                     'alias = { package = "er-cli", path = "../er-cli" }\n')
        self.baseline_cli_manifest = (self.rust / "crates/er-cli/Cargo.toml").read_text().replace(
            '[dev-dependencies]\ner-web = { path = "../er-web" }\n', '')
        self.baseline_repro_manifest = (self.rust / "crates/er-repro/Cargo.toml").read_text().split('[dependencies]')[0]
        self.baseline_lock = self.repro_lock_fixture([], ["er-repro"])
        (self.rust / "Cargo.lock").write_text(self.repro_lock_fixture(["er-env", "er-game", "er-kernel"], ["er-repro", "er-web"]))

    def test_current_repro_scope_requires_all_adapters_exact_ids_and_guarded_dependencies(self):
        self.configure_repro_scope()
        self.changed = self.config["current_repro_focus"]["paths"]
        selection = self.feedback.plan()
        self.assertTrue(selection["current_repro_focus"])
        self.assertTrue(selection["requires_browser"])
        self.assertTrue(selection["requires_wasm"])
        self.assertTrue(selection["requires_cli_executable"])
        self.assertTrue(selection["requires_worker_executable"])
        self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertEqual(selection["boundary_paths"], [])
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        self.assertEqual(selection["required_native_targets"]["er-cli"], ["m9e_current_repro", "m9e_current_entry", "m9e_current_reload"])
        self.assertEqual(len(selection["required_native_test_ids"]["er-repro:m9e_current_repro"]), 9)
        self.assertEqual(len(selection["required_native_test_ids"]["er-cli:m9e_current_repro"]), 2)
        self.assertEqual(selection["current_repro_dependency_guard"], {
            "status": "verified", "baseline_sha": BASE, "added_workspace_dependencies": {
                "er-repro": ["er-env", "er-game", "er-kernel"], "er-cli": ["er-web"]}})
        self.assertIsNone(selection["timer_mutant"])
        self.assertIsNone(selection["replica_mutant"])

    def test_current_repro_guard_rejects_lock_and_manifest_drift(self):
        self.configure_repro_scope()
        before = {"er-cli": self.baseline_cli_manifest, "er-repro": self.baseline_repro_manifest}
        after = {owner: (self.rust / f"crates/{owner}/Cargo.toml").read_text() for owner in before}
        lock = (self.rust / "Cargo.lock").read_text()
        verify = self.feedback.verify_current_repro_dependencies
        for changed in (self.baseline_lock, self.repro_lock_fixture(["er-env", "er-game"], ["er-repro", "er-web"]),
                        self.repro_lock_fixture(["er-env", "er-game", "er-kernel"], ["er-web"]),
                        lock.replace('"er-web"]', '"er-web", "er-web"]'),
                        lock.replace('"er-game",', '"er-game 0.1.0",'),
                        lock.replace('version = 4', 'version = 3'),
                        lock.replace('name = "er-cli"\n', 'name = "er-cli"\nchecksum = "drift"\n'),
                        lock.replace('name = "er-game"\n', 'name = "er-game"\nchecksum = "drift"\n'),
                        lock + '\n[[package]]\nname = "er-env"\nversion = "0.1.0"\n',
                        lock + '\n[[package]]\nname = "unrelated"\nversion = "0.1.0"\n'):
            with self.subTest(lock=changed), self.assertRaisesRegex(RuntimeError, "repro lock guard"):
                verify(self.baseline_lock, changed, before, after)
        for owner in after:
            for changed in (after[owner].replace('path = "../er-', 'path = "../wrong-er-'),
                            after[owner] + '\n[features]\nextra = []\n',
                            after[owner].replace('version = "0.1.0"', 'version = "0.2.0"'),
                            after[owner].replace(' }', ', optional = true }')):
                with self.subTest(owner=owner), self.assertRaisesRegex(RuntimeError, "repro dependency guard"):
                    verify(self.baseline_lock, lock, before, {**after, owner: changed})
        with self.assertRaisesRegex(RuntimeError, "both owner manifests"):
            verify(self.baseline_lock, lock, {"er-repro": before["er-repro"]}, after)
        for suffix in ('source = "registry+invalid"\n',):
            with self.assertRaisesRegex(RuntimeError, "unambiguous existing workspace"):
                verify(self.baseline_lock.replace('name = "er-web"\n', 'name = "er-web"\n' + suffix),
                       lock.replace('name = "er-web"\n', 'name = "er-web"\n' + suffix), before, after)
        ambiguous = '\n[[package]]\nname = "er-game"\nversion = "0.2.0"\n'
        with self.assertRaisesRegex(RuntimeError, "unambiguous existing workspace"):
            verify(self.baseline_lock + ambiguous, lock + ambiguous, before, after)

    def test_current_repro_scope_rejects_unpaired_or_unmapped_changes(self):
        self.configure_repro_scope()
        trigger = "rust/crates/er-repro/src/current.rs"
        for extra in ("rust/Cargo.lock", "rust/crates/er-cli/Cargo.toml", "rust/crates/er-repro/Cargo.toml"):
            self.changed = [trigger, extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "must be paired"):
                self.feedback.plan()
        allowed = self.config["current_repro_focus"]["paths"]
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-repro/build.rs",
                      "rust/crates/er-web/Cargo.toml", "src/rust-browser/other.ts", "unmapped.json"):
            self.changed = allowed + [extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                self.feedback.plan()
        self.changed = ["test/browser/rust-browser/m9e-current-repro-bridge.ts"]
        self.assertIn("er-reverse", self.feedback.plan()["packages"])

    def test_current_repro_exact_ids_reject_missing_duplicate_empty_and_wrong_crate(self):
        self.configure_repro_scope()
        required = self.config["current_repro_focus"]["exact_test_ids"]
        valid = [(*identity.split(":"), ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, valid)
        for rows in (valid[:1], valid + [valid[0]], [(valid[0][0], valid[0][1], []), valid[1]],
                     [("er-other", valid[0][1], valid[0][2]), valid[1]],
                     [(valid[0][0], valid[0][1], valid[0][2][:-1] + ["unexpected"]), valid[1]],
                     [(valid[0][0], valid[0][1], valid[0][2] + [valid[0][2][0]]), valid[1]]):
            with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                self.feedback.require_native_test_ids(required, rows)

    @staticmethod
    def batch_lock_fixture(batch_dependencies, cli_dependencies):
        owners = {"er-batch": batch_dependencies, "er-cli": cli_dependencies}
        return "version = 4\n" + "".join(
            f'\n[[package]]\nname = "{name}"\nversion = "0.1.0"\n'
            + ("dependencies = " + json.dumps(owners[name]) + "\n" if name in owners else "")
            for name in ("er-batch", "er-cli", "er-env", "er-game", "er-kernel", "er-state", "er-types")) + (
                '\n[[package]]\nname = "serde_json"\nversion = "1.0.0"\n'
                'source = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "fixed"\n')

    def configure_batch_scope(self):
        self.configure_browser_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["current_batch_focus"] = policy["current_batch_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for package in ("er-game", "er-state", "er-types", "er-lab", "er-kernel-worker", "er-repro", "er-agent-protocol"):
            self.package(package)
        self.package("er-batch", '[dependencies]\ner-types = { path = "../er-types" }\n')
        self.baseline_batch_manifest = (self.rust / "crates/er-batch/Cargo.toml").read_text()
        with (self.rust / "crates/er-batch/Cargo.toml").open("a") as output:
            output.write('er-env = { path = "../er-env" }\ner-game = { path = "../er-game" }\n'
                         'er-kernel = { path = "../er-kernel" }\nserde_json.workspace = true\n'
                         '[dev-dependencies]\ner-state = { path = "../er-state" }\n')
        self.package("er-cli", '[dependencies]\ner-env = { path = "../er-env" }\n')
        self.baseline_cli_manifest = (self.rust / "crates/er-cli/Cargo.toml").read_text()
        with (self.rust / "crates/er-cli/Cargo.toml").open("a") as output:
            output.write('er-batch = { path = "../er-batch" }\n')
        self.package("er-reverse", '[target.\'cfg(unix)\'.build-dependencies]\n'
                     'alias = { package = "er-cli", path = "../er-cli" }\n')
        self.baseline_lock = self.batch_lock_fixture(["er-types"], ["er-env"])
        (self.rust / "Cargo.lock").write_text(self.batch_lock_fixture(
            ["er-types", "er-env", "er-game", "er-kernel", "er-state", "serde_json"], ["er-env", "er-batch"]))

    def test_current_batch_scope_requires_exact_native_and_shipping_witnesses(self):
        self.configure_batch_scope()
        self.changed = self.config["current_batch_focus"]["paths"]
        selection = self.feedback.plan()
        for flag in ("current_batch_focus", "requires_wasm", "requires_browser", "requires_cli_executable",
                     "requires_worker_executable", "requires_cli_clippy", "requires_agent_protocol_clippy"):
            self.assertTrue(selection[flag], flag)
        self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertEqual(selection["boundary_paths"], [])
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        for crate in ("er-batch", "er-env", "er-cli", "er-agent-protocol", "er-repro", "er-web", "er-kernel-worker"):
            self.assertEqual(selection["execution_scope"][crate], ["*"])
        self.assertEqual(selection["required_native_targets"]["er-cli"],
                         ["m9e_current_batch", "m9e_current_repro", "m9e_current_entry", "m9e_current_reload"])
        expected_counts = {"er-batch:m9e_current_batch": 6, "er-cli:m9e_current_batch": 2,
                           "er-agent-protocol:er_agent_protocol": 3,
                           "er-repro:m9e_current_repro": 9, "er-cli:m9e_current_repro": 2,
                           "er-cli:m9e_current_reload": 2, "er-cli:m9e_current_entry": 7,
                           "er-kernel-worker:current_process_v2": 5, "er-lab:current_kernel_supervisor_v2": 9,
                           "er-wasm:m9e_parity": 2}
        self.assertEqual({key: len(ids) for key, ids in selection["required_native_test_ids"].items()}, expected_counts)
        self.assertEqual(selection["current_batch_dependency_guard"], {
            "status": "verified", "baseline_sha": BASE, "added_dependencies": {
                "er-batch": ["er-env", "er-game", "er-kernel", "er-state", "serde_json"], "er-cli": ["er-batch"]}})
        self.assertIsNone(selection["timer_mutant"])
        self.assertIsNone(selection["replica_mutant"])

    def test_current_batch_guard_rejects_manifest_resolution_and_registry_drift(self):
        self.configure_batch_scope()
        before = {"er-batch": self.baseline_batch_manifest, "er-cli": self.baseline_cli_manifest}
        after = {owner: (self.rust / f"crates/{owner}/Cargo.toml").read_text() for owner in before}
        lock = (self.rust / "Cargo.lock").read_text()
        verify = self.feedback.verify_current_batch_dependencies
        self.assertEqual(verify(self.baseline_lock, lock, before, after)["status"], "verified")
        for changed in (self.baseline_lock, lock.replace(', "serde_json"', ''),
                        lock.replace('"er-state"', '"er-state 0.1.0"', 1),
                        lock.replace('"er-env", "er-batch"', '"er-batch"'),
                        lock.replace('"er-env", "er-batch"', '"er-env", "er-batch", "er-batch"'),
                        lock.replace('version = 4', 'version = 3'),
                        lock.replace('checksum = "fixed"', 'checksum = "changed"'),
                        lock.replace('name = "er-cli"\n', 'name = "er-cli"\nchecksum = "changed"\n'),
                        lock.replace('name = "er-types"\n', 'name = "er-types"\nchecksum = "changed"\n'),
                        lock + '\n[[package]]\nname = "er-env"\nversion = "0.1.0"\n',
                        lock + '\n[[package]]\nname = "unrelated"\nversion = "0.1.0"\n'):
            with self.subTest(lock=changed), self.assertRaisesRegex(RuntimeError, "batch lock guard"):
                verify(self.baseline_lock, changed, before, after)
        for owner in after:
            for changed in (after[owner].replace('path = "../er-', 'path = "../wrong-er-'),
                            after[owner] + '\n[features]\nextra = []\n',
                            after[owner].replace('version = "0.1.0"', 'version = "0.2.0"'),
                            after[owner].replace(' }', ', optional = true }')):
                with self.subTest(owner=owner), self.assertRaisesRegex(RuntimeError, "batch dependency guard"):
                    verify(self.baseline_lock, lock, before, {**after, owner: changed})
        for changed in (after["er-batch"].replace('serde_json.workspace = true', 'serde_json = "1"'),
                        after["er-batch"].replace('[dev-dependencies]', '[build-dependencies]')):
            with self.assertRaisesRegex(RuntimeError, "batch dependency guard"):
                verify(self.baseline_lock, lock, before, {**after, "er-batch": changed})
        with self.assertRaisesRegex(RuntimeError, "both owner manifests"):
            verify(self.baseline_lock, lock, {"er-batch": before["er-batch"]}, after)
        registry = 'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
        with self.assertRaisesRegex(RuntimeError, "dependency source"):
            verify(self.baseline_lock.replace(registry, ''), lock.replace(registry, ''), before, after)
        for name in ("er-env", "serde_json"):
            ambiguous = f'\n[[package]]\nname = "{name}"\nversion = "9.0.0"\n'
            with self.assertRaisesRegex(RuntimeError, "unambiguous existing"):
                verify(self.baseline_lock + ambiguous, lock + ambiguous, before, after)

    def test_current_batch_scope_rejects_unpaired_manifest_and_mixed_product_changes(self):
        self.configure_batch_scope()
        trigger = "rust/crates/er-batch/src/current.rs"
        for extra in ("rust/Cargo.lock", "rust/crates/er-batch/Cargo.toml", "rust/crates/er-cli/Cargo.toml"):
            self.changed = [trigger, extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "must be paired"):
                self.feedback.plan()
        guard_paths = ["rust/Cargo.lock", "rust/crates/er-batch/Cargo.toml", "rust/crates/er-cli/Cargo.toml"]
        for missing in guard_paths:
            self.changed = [trigger] + [path for path in guard_paths if path != missing]
            with self.subTest(missing=missing), self.assertRaisesRegex(RuntimeError, "must be paired"):
                self.feedback.plan()
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-batch/build.rs",
                      "rust/crates/er-cli/src/current_worker_agent.rs", "rust/crates/er-repro/src/current.rs",
                      "rust/crates/er-web/Cargo.toml", "src/rust-browser/other.ts", "unmapped.json"):
            self.changed = [trigger, extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                self.feedback.plan()
        self.changed = ["rust/crates/er-batch/src/lib.rs"]
        with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
            self.feedback.plan()
        for trigger in self.config["current_batch_focus"]["trigger_paths"]:
            self.changed = [trigger]
            self.assertTrue(self.feedback.plan()["current_batch_focus"])

    def test_current_batch_required_ids_distinguish_core_and_cli_same_target_name(self):
        self.configure_batch_scope()
        required = self.config["current_batch_focus"]["exact_test_ids"]
        valid = [(*identity.split(":"), ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, valid)
        for index in range(len(valid)):
            for replacement in ([], valid[index][2][:-1], valid[index][2] + [valid[index][2][0]]):
                rows = list(valid)
                rows[index] = (*rows[index][:2], replacement)
                with self.subTest(index=index), self.assertRaisesRegex(RuntimeError, "required native test identities"):
                    self.feedback.require_native_test_ids(required, rows)
        for rows in (valid[1:], valid + [valid[0]], [("er-cli", *valid[0][1:]), *valid[1:]]):
            with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                self.feedback.require_native_test_ids(required, rows)
        targets = self.config["current_batch_focus"]["required_targets"]
        enumerated = [(crate, name, ["witness"]) for crate, names in targets.items() for name in names]
        self.feedback.required_native_target_counts(targets, enumerated)
        for index in range(len(enumerated)):
            with self.assertRaisesRegex(RuntimeError, "required native witness"):
                self.feedback.required_native_target_counts(targets, enumerated[:index] + enumerated[index + 1:])

    def test_current_batch_orchestration_keeps_reload_first_and_distinct_bindings(self):
        self.configure_batch_scope()
        self.changed = ["rust/crates/er-batch/src/current.rs"]
        selection = self.feedback.plan()
        targets = ["m9e_current_batch", "m9e_current_reload"]
        selection["execution_scope"] = {"er-cli": targets}
        selection["required_native_targets"] = {"er-cli": targets}
        selection["required_native_test_ids"] = {"er-cli:" + target:
            selection["required_native_test_ids"]["er-cli:" + target] for target in targets}
        self.binary_ids = {target: selection["required_native_test_ids"]["er-cli:" + target] for target in targets}
        self.binary_crates = {target: "er-cli" for target in targets}
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        with patch.object(self.feedback, "plan", return_value=selection), patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(self.executed, ["m9e_current_reload", "m9e_current_batch"])
        self.assertLess(max(self.events.index("list:" + target) for target in targets),
                        self.events.index("clippy"))
        for index, event in enumerate(self.events):
            if event.startswith("clippy:"):
                self.assertLess(index, self.events.index("execute:m9e_current_reload"))
        for name, _, env in self.binary_envs:
            if name == "m9e_current_batch":
                self.assertIsNone(env)
            else:
                self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
                self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], summary["worker_executable"]["sha256"])
        self.assertEqual(summary["cli_executable"]["source_sha"], CANDIDATE)
        for lint in ("cli-clippy", "agent-protocol-clippy", "er-batch-clippy", "er-env-clippy", "worker-clippy", "endpoint-clippy", "browser-clippy"):
            self.assertIn(lint, summary["timing_ms"])
        wasm.assert_called_once()
        browser.assert_called_once()
        self.events.clear()
        self.executed.clear()
        self.clippy_codes = {"er-batch": 1}
        with patch.object(self.feedback, "plan", return_value=selection), patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["tests"]["selected"], 4)
        self.assertEqual(summary["tests"]["executed"], 0)
        self.assertEqual(summary["required_native_target_counts"], {
            "er-cli:m9e_current_batch": 2, "er-cli:m9e_current_reload": 2})
        self.assertEqual(self.executed, [])
        self.assertIn("er-batch-clippy exited 1", summary["first_failure"])
        for target in targets:
            self.assertLess(self.events.index("list:" + target), self.events.index("clippy"))
        wasm.assert_not_called()
        browser.assert_not_called()
        # Inventory failure is detected before any test executes, including the
        # prioritized reload. Core and CLI batch IDs cannot substitute each other.
        self.clippy_codes = {}
        self.events.clear()
        self.executed.clear()
        self.binary_ids["m9e_current_batch"] = ["wrong_core_or_cli_witness"]
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)
        self.assertIn("required native test identities", summary["first_failure"])

    def test_current_batch_missing_candidate_artifacts_fail_before_listing(self):
        self.configure_batch_scope()
        self.changed = ["rust/crates/er-batch/src/current.rs"]
        selection = self.feedback.plan()
        selection["execution_scope"] = {"er-cli": ["m9e_current_reload"]}
        selection["required_native_targets"] = {"er-cli": ["m9e_current_reload"]}
        selection["required_native_test_ids"] = {"er-cli:m9e_current_reload":
            selection["required_native_test_ids"]["er-cli:m9e_current_reload"]}
        self.binary_ids = {"m9e_current_reload": selection["required_native_test_ids"]["er-cli:m9e_current_reload"]}
        self.binary_crates = {"m9e_current_reload": "er-cli"}
        for artifacts, message in (([], "real worker executable"),
                                   ([self.worker_executable_artifact()], "real CLI executable")):
            self.extra_artifacts = artifacts
            self.binary_envs.clear()
            with patch.object(self.feedback, "plan", return_value=selection):
                code, summary = self.invoke()
            self.assertEqual(code, 1)
            self.assertIn(message, summary["first_failure"])
            self.assertEqual(self.binary_envs, [])

    def test_current_batch_mapping_does_not_expand_infrastructure_readiness(self):
        self.configure_batch_scope()
        self.changed = ["scripts/ci/m9e_feedback.py", "docs/plans/rust-kernel/m9e-batch-next.md"]
        selection = self.feedback.plan()
        self.assertEqual(selection["packages"], ["er-canonical"])
        self.assertIsNone(selection["execution_scope"])
        for flag in ("current_batch_focus", "requires_browser", "requires_wasm", "requires_worker_executable",
                     "requires_cli_executable", "requires_cli_clippy", "requires_agent_protocol_clippy"):
            self.assertFalse(selection[flag], flag)

    def configure_menu_scope(self):
        self.configure_cli_reload_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["menu_validation_focus"] = policy["menu_validation_focus"]
        self.config["shared_packages"] = policy["shared_packages"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-types")
        for package in ("er-kernel", "er-state", "er-protocol", "er-env"):
            self.package(package, '[dependencies]\ner-types = { path = "../er-types" }\n')
        self.package("er-extra-reverse", '[target.\'cfg(unix)\'.build-dependencies]\n'
                     'alias = { package = "er-env", path = "../er-env" }\n')

    def test_menu_scope_compiles_full_reverse_cone_and_requires_all_platform_witnesses(self):
        self.configure_menu_scope()
        self.changed = self.config["menu_validation_focus"]["paths"] + self.config["cli_reload_focus"]["paths"]
        selection = self.feedback.plan()
        self.assertTrue(selection["menu_validation_focus"])
        self.assertFalse(selection["cli_reload_focus"])
        self.assertFalse(selection["timer_focus"])
        self.assertEqual(selection["base_sha"], BASE)
        self.assertEqual(selection["boundary_paths"], [])
        self.assertEqual(selection["unknown_paths"], [])
        self.assertTrue(selection["requires_worker_executable"])
        self.assertTrue(selection["requires_cli_clippy"])
        self.assertTrue(selection["requires_agent_protocol_clippy"])
        self.assertTrue(selection["requires_wasm"])
        self.assertTrue(selection["requires_browser"])
        self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertEqual(selection["cli_reload_dependency_guard"]["added_workspace_dependencies"], ["er-kernel-worker"])
        self.assertIsNone(selection["worker_lock_guard"])
        self.assertIsNone(selection["timer_mutant"])
        self.assertIn("er-extra-reverse", selection["packages"])
        self.assertNotIn("er-extra-reverse", selection["execution_scope"])
        for package in ("er-types", "er-kernel", "er-state", "er-protocol", "er-agent-protocol", "er-env", "er-cli", "er-web", "er-kernel-worker"):
            self.assertEqual(selection["execution_scope"][package], ["*"])
        self.assertEqual(selection["execution_scope"]["er-wasm"], ["m9e_parity"])
        self.assertEqual({identity: len(ids) for identity, ids in selection["required_native_test_ids"].items()}, {
            "er-types:m9e_menu_validation": 5, "er-cli:m9e_current_reload": 2, "er-cli:m9e_current_entry": 7,
            "er-kernel-worker:current_process_v2": 5, "er-lab:current_kernel_supervisor_v2": 9, "er-wasm:m9e_parity": 2})
        for trigger in self.config["menu_validation_focus"]["trigger_paths"]:
            self.changed = [trigger]
            self.assertTrue(self.feedback.plan()["menu_validation_focus"])

    def test_menu_scope_preserves_exact_paired_cli_dependency_guard(self):
        self.configure_menu_scope()
        trigger = "rust/crates/er-types/src/m7_menu.rs"
        for extra in ("rust/Cargo.lock", "rust/crates/er-cli/Cargo.toml"):
            self.changed = [trigger, extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "must be paired"):
                self.feedback.plan()
        self.changed = [trigger, "rust/Cargo.lock", "rust/crates/er-cli/Cargo.toml"]
        self.assertEqual(self.feedback.plan()["cli_reload_dependency_guard"]["status"], "verified")
        lock = self.rust / "Cargo.lock"
        original = lock.read_text()
        for invalid in (self.baseline_lock, original.replace('"er-kernel-worker"]', '"er-kernel-worker", "serde"]'),
                        original.replace('name = "er-env"\n', 'name = "er-env"\nchecksum = "changed"\n')):
            lock.write_text(invalid)
            with self.assertRaisesRegex(RuntimeError, "CLI lock guard"):
                self.feedback.plan()
        lock.write_text(original)
        manifest = self.rust / "crates/er-cli/Cargo.toml"
        manifest.write_text(manifest.read_text().replace('../er-kernel-worker', '../wrong-worker'))
        with self.assertRaisesRegex(RuntimeError, "CLI dependency guard"):
            self.feedback.plan()

    def test_menu_scope_rejects_b2_kernel_capsule_and_unmapped_product_changes(self):
        self.configure_menu_scope()
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-kernel/tests/m9e_coop_v7.rs",
                      "rust/crates/er-types/src/other.rs", "rust/crates/er-types/Cargo.toml",
                      "rust/crates/er-repro/src/current.rs", "src/rust-browser/routes/browser-effects-v2.ts",
                      "test/browser/rust-browser/m9e-v7-corrective.spec.ts", "unmapped.json"):
            self.changed = ["rust/crates/er-types/src/m7_menu.rs", extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                self.feedback.plan()
        for path in ("docs/plans/rust-kernel/m9e-progress.md", "scripts/ci/m9e_feedback.py"):
            self.changed = [path]
            selection = self.feedback.plan()
            self.assertFalse(selection["menu_validation_focus"])
            self.assertEqual(selection["packages"], ["er-canonical"])
            self.assertFalse(selection["requires_worker_executable"])

    def test_menu_exact_witnesses_reject_removed_renamed_duplicate_and_wrong_crate_tests(self):
        self.configure_menu_scope()
        self.changed = ["rust/crates/er-types/src/m7_menu.rs"]
        selection = self.feedback.plan()
        required = selection["required_native_test_ids"]
        valid = [(*identity.split(":"), ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, valid)
        for index, row in enumerate(valid):
            for changed in (None, (row[0], row[1], []), ("wrong-crate", row[1], row[2]),
                            (row[0], row[1], row[2][:-1] + ["wrong-test"]),
                            (row[0], row[1], row[2] + [row[2][0]])):
                rows = valid[:index] + valid[index + 1:]
                if changed is not None:
                    rows.append(changed)
                with self.subTest(identity=row[:2], defect=changed), self.assertRaisesRegex(RuntimeError, "required native test identities"):
                    self.feedback.require_native_test_ids(required, rows)
        targets = selection["required_native_targets"]
        enumerated = [(crate, target, ["actual-test"]) for crate, names in targets.items() for target in names]
        self.feedback.required_native_target_counts(targets, enumerated)
        for index, row in enumerate(enumerated):
            with self.subTest(target=row[:2]), self.assertRaisesRegex(RuntimeError, "required native witness"):
                self.feedback.required_native_target_counts(targets, enumerated[:index] + enumerated[index + 1:])

    def test_menu_orchestration_discovers_all_before_reload_first_and_keeps_platforms(self):
        self.configure_menu_scope()
        self.changed = ["rust/crates/er-types/src/m7_menu.rs"]
        selection = self.feedback.plan()
        # Isolate ordering and bindings; exact complete inventory is asserted
        # independently above and remains unchanged in the real selection.
        selection["execution_scope"] = {"er-cli": ["a_suite", "m9e_current_reload"], "er-types": ["m9e_menu_validation"]}
        selection["required_native_targets"] = {"er-cli": ["m9e_current_reload"], "er-types": ["m9e_menu_validation"]}
        selection["required_native_test_ids"] = {key: ids for key, ids in selection["required_native_test_ids"].items()
                                                  if key in ("er-cli:m9e_current_reload", "er-types:m9e_menu_validation")}
        self.binary_ids = {"a_suite": ["ordinary-cli"],
                           "m9e_current_reload": selection["required_native_test_ids"]["er-cli:m9e_current_reload"],
                           "m9e_menu_validation": selection["required_native_test_ids"]["er-types:m9e_menu_validation"]}
        self.binary_crates = {"a_suite": "er-cli", "m9e_current_reload": "er-cli", "m9e_menu_validation": "er-types"}
        self.extra_artifacts = [self.worker_executable_artifact()]
        with patch.object(self.feedback, "plan", return_value=selection), patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(self.executed, ["m9e_current_reload", "a_suite", "m9e_menu_validation"])
        self.assertEqual(summary["tests"]["passed"], 8)
        for target in self.binary_ids:
            self.assertLess(self.events.index("list:" + target), self.events.index("clippy"))
        for index, event in enumerate(self.events):
            if event.startswith("clippy:"):
                self.assertLess(index, self.events.index("execute:m9e_current_reload"))
        for target, _, env in self.binary_envs:
            if target == "m9e_current_reload":
                self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
                self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], summary["worker_executable"]["sha256"])
            else:
                self.assertIsNone(env)
        for lint in ("types-clippy", "cli-clippy", "agent-protocol-clippy", "worker-clippy", "endpoint-clippy", "browser-clippy"):
            self.assertIn(lint, summary["timing_ms"])
        wasm.assert_called_once()
        browser.assert_called_once()
        self.binary_ids["m9e_menu_validation"] = self.binary_ids["m9e_menu_validation"][:-1]
        self.executed.clear()
        self.events.clear()
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)
        self.assertIn("required native test identities", summary["first_failure"])

    def test_menu_lint_failure_preserves_complete_validated_inventory_without_execution(self):
        self.configure_menu_scope()
        self.changed = ["rust/crates/er-types/src/m7_menu.rs"]
        selection = self.feedback.plan()
        selection["execution_scope"] = {"er-cli": ["m9e_current_reload"], "er-types": ["m9e_menu_validation"]}
        selection["required_native_targets"] = {"er-cli": ["m9e_current_reload"], "er-types": ["m9e_menu_validation"]}
        selection["required_native_test_ids"] = {key: ids for key, ids in selection["required_native_test_ids"].items()
                                                  if key in ("er-cli:m9e_current_reload", "er-types:m9e_menu_validation")}
        self.binary_ids = {identity.split(":")[1]: ids for identity, ids in selection["required_native_test_ids"].items()}
        self.binary_crates = {"m9e_current_reload": "er-cli", "m9e_menu_validation": "er-types"}
        self.extra_artifacts = [self.worker_executable_artifact()]
        required_ids = self.feedback.require_native_test_ids
        required_targets = self.feedback.required_native_target_counts
        def validate_ids(required, enumerated):
            required_ids(required, enumerated)
            self.events.append("required-ids-validated")
        def validate_targets(required, enumerated):
            result = required_targets(required, enumerated)
            self.events.append("required-targets-validated")
            return result
        for package, label in (("er-types", "types-clippy"), ("er-web", "browser-clippy")):
            with self.subTest(package=package):
                self.events.clear()
                self.executed.clear()
                self.clippy_codes = {package: 1}
                with patch.object(self.feedback, "plan", return_value=selection), patch.object(
                    self.feedback, "require_native_test_ids", side_effect=validate_ids
                ), patch.object(self.feedback, "required_native_target_counts", side_effect=validate_targets), patch.object(
                    self.feedback, "wasm_checks"
                ) as wasm, patch.object(self.feedback, "browser_checks") as browser:
                    code, summary = self.invoke()
                self.assertEqual(code, 1)
                self.assertEqual(summary["tests"], {"selected": 7, "executed": 0, "passed": 0, "failed": 0, "skipped": 0})
                self.assertEqual(summary["expected_test_count"], 7)
                self.assertEqual(summary["required_native_target_counts"], {
                    "er-cli:m9e_current_reload": 2, "er-types:m9e_menu_validation": 5})
                expected = sorted(f"{target}::{test_id}" for target, ids in self.binary_ids.items() for test_id in ids)
                self.assertEqual(sorted(json.loads((self.full / "selected-tests.json").read_text())), expected)
                self.assertEqual(summary["worker_executable"]["source_sha"], CANDIDATE)
                for event in ("list:m9e_current_reload", "list:m9e_menu_validation",
                              "required-targets-validated", "required-ids-validated"):
                    self.assertLess(self.events.index(event), self.events.index("clippy"))
                self.assertIn(label + " exited 1", summary["first_failure"])
                self.assertEqual(self.executed, [])
                wasm.assert_not_called()
                browser.assert_not_called()
                self.assert_evidence_hashes(summary)

    def test_invalid_historical_disposition_rejects_before_native_lint(self):
        selection = self.feedback.plan()
        selection["requires_cli_clippy"] = True
        selection["historical_dispositions"] = [{"crate": "er-canonical", "target": "a_suite", "test": "missing"}]
        self.clippy_code = 1
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["tests"]["selected"], 2)
        self.assertEqual(summary["tests"]["executed"], 0)
        self.assertIn("historical disposition must identify exactly one", summary["first_failure"])
        self.assertIn("list:a_suite", self.events)
        self.assertIn("list:b_suite", self.events)
        self.assertNotIn("clippy", self.events)
        self.assertEqual(self.executed, [])

    def test_broad_cli_scope_binds_present_reload_target_without_relaxing_narrow_requirements(self):
        self.configure_browser_scope()
        self.changed = ["rust/crates/er-cli/src/current_commands.rs"]
        self.assertFalse(self.feedback.plan()["requires_worker_executable"])
        target = self.rust / "crates/er-cli/tests/m9e_current_reload.rs"
        target.parent.mkdir()
        target.write_text("// synthetic target presence; never compiled\n")
        self.assertTrue(self.feedback.plan()["requires_worker_executable"])

    def test_agent_protocol_clippy_failure_cannot_produce_green_feedback(self):
        selection = self.feedback.plan()
        selection["requires_agent_protocol_clippy"] = True
        self.clippy_code = 1
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["tests"]["selected"], 2)
        self.assertEqual(summary["tests"]["executed"], 0)
        self.assertEqual(self.executed, [])
        self.assertLess(self.events.index("list:b_suite"), self.events.index("clippy"))
        self.assertIn("agent-protocol-clippy exited 1", summary["first_failure"])
        self.assertIn(["cargo", "clippy", "--locked", "-p", "er-agent-protocol", "--all-targets",
                       "--no-deps", "--", "-D", "warnings"], self.commands)

    def test_supervisor_scope_requires_real_process_targets_without_browser(self):
        self.configure_supervisor_scope()
        self.changed = self.config["supervisor_focus"]["paths"]
        selection = self.feedback.plan()
        self.assertTrue(selection["supervisor_focus"])
        self.assertTrue(selection["requires_worker_executable"])
        self.assertFalse(selection["requires_browser"])
        self.assertFalse(selection["requires_wasm"])
        self.assertIsNone(selection["worker_lock_guard"])
        self.assertIsNone(selection["timer_mutant"])
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        self.assertEqual(selection["execution_scope"]["er-kernel-worker"], ["*"])
        self.assertEqual(selection["execution_scope"]["er-cli"], ["*"])
        self.assertEqual(selection["execution_scope"]["er-lab"], [
            "current_kernel_endpoint_v2", "current_kernel_endpoint_faults_v2", "current_kernel_supervisor_v2",
            "kernel_reload_acceptance", "kernel_reload_artifact"])
        self.assertEqual(selection["required_native_targets"], {
            "er-lab": ["current_kernel_endpoint_v2", "current_kernel_supervisor_v2"],
            "er-kernel-worker": ["current_process_v2"]})
        for path in ("rust/crates/er-kernel-worker/src/runtime_v2.rs", "rust/crates/er-kernel-worker/src/main.rs",
                     "rust/crates/er-kernel-worker/tests/current_process_v2.rs"):
            self.assertIn(path, self.config["supervisor_focus"]["paths"])

    def test_supervisor_budget_union_stays_native_and_requires_worker_process_witness(self):
        self.configure_supervisor_scope()
        self.changed = ["rust/crates/er-lab/src/kernel_reload/supervisor_v2.rs",
                        "rust/crates/er-kernel-worker/src/runtime_v2.rs",
                        "rust/crates/er-kernel-worker/src/main.rs",
                        "rust/crates/er-kernel-worker/tests/current_process_v2.rs"]
        selection = self.feedback.plan()
        self.assertTrue(selection["supervisor_focus"])
        self.assertTrue(selection["requires_worker_executable"])
        self.assertFalse(selection["requires_browser"])
        self.assertFalse(selection["requires_wasm"])
        self.assertEqual(selection["required_native_targets"]["er-kernel-worker"], ["current_process_v2"])
        required = selection["required_native_targets"]
        lab_only = [("er-lab", target, ["real_process"]) for target in required["er-lab"]]
        with self.assertRaisesRegex(RuntimeError, "er-kernel-worker:current_process_v2"):
            self.feedback.required_native_target_counts(required, lab_only)
        counts = self.feedback.required_native_target_counts(required, lab_only + [
            ("er-kernel-worker", "current_process_v2", ["real_worker_budget"])])
        self.assertEqual(counts["er-kernel-worker:current_process_v2"], 1)

    def test_supervisor_mixed_paths_preserve_shared_and_browser_gates(self):
        self.configure_supervisor_scope()
        supervisor = "rust/crates/er-lab/src/kernel_reload/supervisor_v2.rs"
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-web/src/host_v2.rs",
                      "rust/Cargo.lock", "unknown.json"):
            with self.subTest(extra=extra):
                self.changed = [supervisor, extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
        self.changed = [supervisor, "rust/crates/er-env/src/current.rs"]
        selection = self.feedback.plan()
        self.assertFalse(selection["supervisor_focus"])
        self.assertIsNone(selection["execution_scope"])
        self.assertTrue(selection["requires_browser"])
        self.assertTrue(selection["requires_wasm"])
        self.assertTrue(selection["requires_worker_executable"])

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
        for package in ("er-batch", "er-kernel", "er-state", "er-protocol", "er-env", "er-cli", "er-web", "er-kernel-worker"):
            self.assertIn(package, selection["packages"])
            self.assertEqual(selection["execution_scope"][package], ["*"])
        self.assertEqual(set(selection["required_native_targets"]["er-kernel"]), {
            "m9e_timers_v7", "m9e_domain_journeys_v7", "m9e_coop_v7", "m9e_game_kernel_v7", "m9e_snapshot_v7"})
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])

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

    def test_private_control_paths_require_core_capsules_exact_journeys_and_both_platform_mutants(self):
        self.configure_timer_scope()
        private_paths = ["rust/crates/er-kernel/src/game_kernel_v7.rs",
                         "rust/crates/er-kernel/src/snapshot_v7.rs",
                         "rust/crates/er-kernel/tests/m9e_coop_v7.rs",
                         "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
                         "rust/crates/er-kernel/tests/m9e_domain_journeys_v7.rs",
                         "rust/crates/er-wasm/tests/m9e_parity.rs"]
        for changed in (private_paths, private_paths[:1], private_paths[1:2]):
            with self.subTest(changed=changed):
                self.changed = changed + ["docs/plans/rust-kernel/m9e-retention-next.md"]
                selection = self.feedback.plan()
                self.assertTrue(selection["timer_focus"])
                self.assertFalse(selection["current_repro_focus"])
                for requirement in ("requires_wasm", "requires_browser", "requires_cli_executable",
                                    "requires_worker_executable", "requires_cli_clippy", "requires_agent_protocol_clippy"):
                    self.assertTrue(selection[requirement], requirement)
                self.assertEqual(selection["wasm_test"], "m9e_parity")
                for package in ("er-kernel", "er-state", "er-protocol", "er-agent-protocol",
                                "er-env", "er-batch", "er-repro", "er-cli", "er-web", "er-kernel-worker"):
                    self.assertEqual(selection["execution_scope"][package], ["*"])
                self.assertIn("current_kernel_supervisor_v2", selection["execution_scope"]["er-lab"])
                exact = selection["required_native_test_ids"]
                for identity, count in (("er-kernel:m9e_coop_v7", 4), ("er-kernel:m9e_snapshot_v7", 4),
                                        ("er-kernel:m9e_domain_journeys_v7", 12),
                                        ("er-repro:m9e_current_repro", 9), ("er-cli:m9e_current_repro", 2),
                                        ("er-batch:m9e_current_batch", 6), ("er-cli:m9e_current_batch", 2),
                                        ("er-agent-protocol:er_agent_protocol", 3)):
                    self.assertEqual(len(exact[identity]), count)
                    package, target = identity.split(":")
                    self.assertIn(target, selection["required_native_targets"][package])
                self.assertIn("private_party_reopens_restore_exact_root_and_apply_canonical_material",
                              exact["er-kernel:m9e_coop_v7"])
                self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
                self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
                self.assertEqual(selection["base_sha"], BASE)

    def test_private_control_missing_capsule_or_private_witness_cannot_qualify(self):
        self.configure_timer_scope()
        self.changed = ["rust/crates/er-kernel/src/snapshot_v7.rs"]
        required = self.feedback.plan()["required_native_test_ids"]
        inventory = [(identity.split(":")[0], identity.split(":")[1], ids)
                     for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, inventory)
        for identity in ("er-kernel:m9e_coop_v7", "er-kernel:m9e_snapshot_v7",
                         "er-kernel:m9e_domain_journeys_v7", "er-repro:m9e_current_repro",
                         "er-cli:m9e_current_repro", "er-batch:m9e_current_batch", "er-cli:m9e_current_batch",
                         "er-agent-protocol:er_agent_protocol"):
            for omit_target in (False, True):
                with self.subTest(identity=identity, omit_target=omit_target):
                    missing = [(crate, target, ids if f"{crate}:{target}" != identity else ids[:-1])
                               for crate, target, ids in inventory
                               if not omit_target or f"{crate}:{target}" != identity]
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(required, missing)

    def test_private_control_unmapped_kernel_or_later_capsule_product_change_fails_closed(self):
        self.configure_timer_scope()
        for extra in ("rust/crates/er-kernel/src/new_owner.rs", "rust/crates/er-kernel/src/snapshot.rs",
                      "rust/crates/er-repro/src/current.rs", "rust/Cargo.lock"):
            with self.subTest(extra=extra):
                self.changed = ["rust/crates/er-kernel/src/snapshot_v7.rs", extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
                rejected = json.loads((self.full / "plan.json").read_text())
                self.assertFalse(rejected["timer_focus"])
                self.assertIsNone(rejected["execution_scope"])
                self.assertIn("er-reverse", rejected["packages"])
                self.assertEqual(self.executed, [])

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
                binary = name if name not in self.binary_ids else package + "--" + name
                self.binary_ids[binary] = policy["exact_test_ids"].get(f"{package}:{name}", ["behavior"])
                self.binary_crates[binary] = package
                self.binary_targets[binary] = name
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.binary_ids["m9e_parity"] = ["native_replays_v7_raw_inputs_eventwise", "native_replays_v7_held_timers_eventwise"]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, patch.object(self.feedback, "timer_behavioral_mutant") as mutant, patch.object(self.feedback, "replica_behavioral_mutant") as replica:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        wasm.assert_called_once()
        browser.assert_called_once()
        mutant.assert_called_once()
        replica.assert_called_once()
        self.assertEqual(summary["native_timer_parity_digest"], "d" * 64)
        parity_execution = next(command for command in self.commands if Path(command[0]).name == "m9e_parity" and "--list" not in command)
        self.assertIn("--nocapture", parity_execution)
        self.assertEqual(len(summary["required_native_target_counts"]), 18)
        self.assertEqual(summary["required_native_target_counts"]["er-repro:m9e_current_repro"], 9)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_repro"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-batch:m9e_current_batch"], 6)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_batch"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-agent-protocol:er_agent_protocol"], 3)
        first = [("er-kernel", target) for target in (
            "m9e_game_kernel_v7", "m9e_coop_v7", "m9e_snapshot_v7", "m9e_timers_v7", "m9e_domain_journeys_v7")]
        first.extend([("er-wasm", "m9e_parity"), ("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_reload")])
        self.assertEqual([(self.binary_crates[name], self.binary_targets.get(name, name)) for name in self.executed[:8]], first)
        self.assertLess(max(index for index, event in enumerate(self.events) if event.startswith("list:")), self.events.index("clippy"))
        first_execution = self.events.index("execute:" + self.executed[0])
        for index, event in enumerate(self.events):
            if event.startswith("clippy:"):
                self.assertLess(index, first_execution)
        expected_count = sum(len(ids) for ids in self.binary_ids.values())
        self.assertEqual(summary["tests"], {"selected": expected_count, "executed": expected_count,
                                           "passed": expected_count, "failed": 0, "skipped": 0})
        self.assertIn("current_kernel_endpoint_v2", self.executed)
        self.assertIn("current_kernel_endpoint_faults_v2", self.executed)
        for name, phase, env in self.binary_envs:
            with self.subTest(name=name, phase=phase):
                if (self.binary_crates[name], self.binary_targets.get(name, name)) in self.feedback.WORKER_BOUND_TARGETS:
                    self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], summary["worker_executable"]["sha256"])
                else:
                    self.assertIsNone(env)

    def test_native_execution_priority_is_crate_bound_and_timer_scope_only(self):
        identities = [("er-other", "m9e_game_kernel_v7"), ("er-cli", "m9e_current_reload"),
                      ("er-kernel", "m9e_domain_journeys_v7"), ("er-other", "m9e_parity"),
                      ("er-wasm", "m9e_parity"), ("er-kernel", "m9e_timers_v7"),
                      ("er-kernel", "m9e_snapshot_v7"), ("er-kernel", "m9e_coop_v7"),
                      ("er-kernel", "m9e_game_kernel_v7"), ("er-other", "m9e_current_reload"),
                      ("er-other", "m9e_host_v2"), ("er-web", "m9e_host_v2")]
        enumerated = [(index, f"binary-{index}", target, [f"test-{index}"], self.rust / "crates" / crate, set(), None)
                      for index, (crate, target) in enumerate(identities)]
        original = list(enumerated)
        ordered = self.feedback.native_execution_order({"timer_focus": True}, enumerated)
        self.assertEqual([(item[4].name, item[2]) for item in ordered], [
            ("er-kernel", "m9e_game_kernel_v7"), ("er-kernel", "m9e_coop_v7"),
            ("er-kernel", "m9e_snapshot_v7"), ("er-kernel", "m9e_timers_v7"),
            ("er-kernel", "m9e_domain_journeys_v7"), ("er-wasm", "m9e_parity"),
            ("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_reload"), ("er-other", "m9e_game_kernel_v7"),
            ("er-other", "m9e_parity"), ("er-other", "m9e_current_reload"), ("er-other", "m9e_host_v2")])
        self.assertEqual(sorted(item[0] for item in ordered), list(range(len(enumerated))))
        self.assertEqual(enumerated, original)
        for scope in ("cli_reload_focus", "menu_validation_focus", "current_batch_focus"):
            with self.subTest(scope=scope):
                other = self.feedback.native_execution_order({scope: True}, enumerated)
                self.assertEqual(other, [enumerated[1], *enumerated[:1], *enumerated[2:]])
        self.assertEqual(self.feedback.native_execution_order({}, enumerated), enumerated)

    def invoke_synthetic_timer_mutant(self, mode, mutant="timer", expected_failure_phase=None):
        key = f"{mutant}_mutant"
        label = f"{mutant}-mutant"
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["timer_focus"][
            "mutant" if mutant == "timer" else "replica_mutant"]
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
            if name == f"{label}-build":
                self.assertIn("--locked", args)
                self.assertIn("--no-run", args)
                if mode == "build":
                    path.write_text("error: synthetic compiler rejection\n")
                    raise RuntimeError(f"{label}-build exited 101")
                binary = (self.root if mode == "outside_artifact" else Path(env["CARGO_TARGET_DIR"])) / "synthetic-mutant-test"
                binary.write_bytes(b"synthetic artifact, never executed")
                artifact = {"reason": "compiler-artifact", "profile": {"test": True},
                    "target": {"name": policy["target"], "kind": ["test"]}, "executable": str(binary),
                    "manifest_path": str(self.rust / "crates" / ("er-other" if mode == "wrong_manifest" else "er-kernel") / "Cargo.toml")}
                path.write_text(json.dumps(artifact) + "\n")
                if mode == "ambiguous_artifact":
                    other = Path(env["CARGO_TARGET_DIR"]) / "other-mutant-test"
                    other.write_bytes(b"second synthetic artifact")
                    artifact["executable"] = str(other)
                    path.write_text(path.read_text() + json.dumps(artifact) + "\n")
            elif name == f"{label}-list":
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
                         if mutant == "timer" else 'assertion `left == right` failed: ' + policy["assertion_message"] + '\n left: Ok(())\n right: Err(Invalid)\n')
            if mode == "wrong_assertion":
                assertion = "assertion `left == right` failed: unrelated\n"
            panic_name = "another_test" if mode == "wrong_panic" else witness
            stdout.write(f"test {witness} ... FAILED\nthread '{panic_name}' (123) panicked at test.rs:147:5:\n" + assertion + self.result_line(failed=2 if mode == "wrong_counts" else 1))
            return subprocess.CompletedProcess(args, -9 if mode == "crash" else 101)

        try:
            with patch.object(self.feedback, "capture", side_effect=tracked_diff), patch.object(self.feedback, "run", side_effect=mutant_run), patch.object(self.feedback.subprocess, "run", side_effect=mutant_process):
                callback = self.feedback.timer_behavioral_mutant if mutant == "timer" else self.feedback.replica_behavioral_mutant
                callback({key: policy}, summary, [f'{policy["target"]}::{witness}'])
        finally:
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(summary[key]["restored_sha256"], hashlib.sha256(original).hexdigest())
            self.assertEqual(list((self.root / "report").glob(f"m9e-{label}-*")), [])
            if expected_failure_phase is not None:
                self.assertEqual(summary[key]["failure_phase"], expected_failure_phase)
                self.assertEqual(summary[key]["status"], "failed")
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

    def test_replica_mutant_detects_only_the_ownership_assertion_and_restores_source(self):
        summary = self.invoke_synthetic_timer_mutant("detected", mutant="replica")
        evidence = summary["replica_mutant"]
        self.assertEqual(evidence["status"], "detected")
        self.assertEqual(evidence["exit_code"], 101)
        self.assertNotEqual(evidence["original_sha256"], evidence["mutant_sha256"])
        self.assertEqual(evidence["restored_sha256"], evidence["original_sha256"])
        self.assertEqual(evidence["tests"], {"executed": 1, "passed": 0, "failed": 1, "skipped": 0})
        self.assertNotIn("timer_mutant", summary)

    def test_replica_mutant_classifies_infrastructure_and_wrong_behavior_failures(self):
        cases = [("green", "presentation-ownership assertion", "behavioral_assertion"),
                 ("build", "build exited", "build"), ("timeout", "timed out", "execution"),
                 ("unknown", "enumerate exactly", "enumeration"),
                 ("wrong_assertion", "presentation-ownership assertion", "behavioral_assertion"),
                 ("wrong_panic", "presentation-ownership assertion", "behavioral_assertion"),
                 ("wrong_counts", "presentation-ownership assertion", "behavioral_assertion"),
                 ("crash", "presentation-ownership assertion", "behavioral_assertion"),
                 ("outside_artifact", "isolated target tree", "artifact_validation"),
                 ("wrong_manifest", "exactly one matching", "artifact_validation"),
                 ("ambiguous_artifact", "exactly one matching", "artifact_validation")]
        for mode, reason, phase in cases:
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, reason):
                self.invoke_synthetic_timer_mutant(mode, mutant="replica", expected_failure_phase=phase)

    def test_replica_mutant_requires_passing_witness_clean_source_and_unique_replica_needle(self):
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["timer_focus"]["replica_mutant"]
        witness = f'{policy["target"]}::{policy["test"]}'
        for passed in ([], [witness, witness], ["another_target::" + policy["test"]]):
            with self.assertRaisesRegex(RuntimeError, "passing ordinary behavioral witness"):
                self.feedback.replica_behavioral_mutant({"replica_mutant": policy}, {}, passed)
        source = self.root / policy["source"]
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text(policy["original"])
        with patch.object(self.feedback, "capture", return_value=policy["source"]), self.assertRaisesRegex(RuntimeError, "clean exact candidate"):
            self.feedback.replica_behavioral_mutant({"replica_mutant": policy}, {}, [witness])
        for text in ("unrelated source", policy["original"] * 2):
            source.write_text(text)
            with patch.object(self.feedback, "capture", return_value=""), self.assertRaisesRegex(RuntimeError, "occur exactly once"):
                self.feedback.replica_behavioral_mutant({"replica_mutant": policy}, {}, [witness])
            self.assertEqual(source.read_text(), text)
        # The authority conversion has deeper indentation and must not match
        # the replica needle, even though both call the same enum constructor.
        both = policy["original"] + '\n                        .map(GameKernelEffectV7::Presentation)'
        self.assertEqual(both.count(policy["original"]), 1)
        self.assertIn('\n                        .map(GameKernelEffectV7::Presentation)',
                      both.replace(policy["original"], policy["replacement"], 1))

    def test_replica_mutant_is_not_run_when_the_timer_mutant_fails(self):
        selection = self.feedback.plan()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["timer_focus"]
        selection["timer_mutant"] = policy["mutant"]
        selection["replica_mutant"] = policy["replica_mutant"]
        with patch.object(self.feedback, "plan", return_value=selection), patch.object(
            self.feedback, "timer_behavioral_mutant", side_effect=RuntimeError("timer behavioral failure")
        ) as timer, patch.object(self.feedback, "replica_behavioral_mutant") as replica:
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["tests"]["passed"], 2)
        self.assertIn("timer behavioral failure", summary["first_failure"])
        timer.assert_called_once()
        replica.assert_not_called()

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

    def cli_executable_artifact(self, directory="debug"):
        path = self.rust / "target" / directory / ("er-cli.exe" if os.name == "nt" else "er-cli")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"#!/bin/sh\n# synthetic CLI artifact; never executed\n")
        path.chmod(0o755)
        return {"reason": "compiler-artifact", "package_id": "synthetic-cli-package",
                "target": {"name": "er-cli", "kind": ["bin"]}, "profile": {"test": False},
                "executable": str(path), "manifest_path": str(self.rust / "crates/er-cli/Cargo.toml")}

    def test_cli_executable_binding_rejects_test_wrong_manifest_escape_and_ambiguity(self):
        summary = {"product_sha": CANDIDATE, "target": "x86_64-unknown-linux-gnu", "profile": "test"}
        valid = self.cli_executable_artifact()
        invalid = [[], [valid, self.cli_executable_artifact("other")]]
        for key, value in (("profile", {"test": True}), ("profile", {}),
                           ("target", {"name": "er-cli", "kind": ["lib"]}),
                           ("target", {"name": "er-other", "kind": ["bin"]}),
                           ("manifest_path", str(self.rust / "crates/er-repro/Cargo.toml")),
                           ("executable", str(self.rust / "target/missing/er-cli")),
                           ("executable", "target/debug/er-cli")):
            invalid.append([{**valid, key: value}])
        outside = self.root / ("er-cli.exe" if os.name == "nt" else "er-cli")
        outside.write_bytes(b"outside target root")
        outside.chmod(0o755)
        invalid.append([{**valid, "executable": str(outside)}])
        for artifacts in invalid:
            with self.subTest(artifacts=artifacts), self.assertRaises(RuntimeError):
                self.feedback.discover_cli_executable(artifacts, summary)
        binding = self.feedback.discover_cli_executable([valid], summary)
        self.assertEqual(binding["root"], str((self.rust / "target").resolve()))
        self.assertEqual(binding["source_sha"], CANDIDATE)
        self.assertEqual(self.feedback.browser_cli_env(binding, CANDIDATE), {
            "ER_M9E_CLI_EXECUTABLE": binding["path"], "ER_M9E_CLI_ROOT": binding["root"],
            "ER_M9E_CLI_SHA256": binding["sha256"], "ER_M9E_CLI_SOURCE_SHA": CANDIDATE})
        for wrong in (None, {**binding, "source_sha": BASE}, {**binding, "sha256": "0" * 64},
                      {**binding, "root": str(self.root / "wrong-root")}):
            with self.assertRaises(RuntimeError):
                self.feedback.browser_cli_env(wrong, CANDIDATE)
        Path(binding["path"]).write_bytes(b"replaced after discovery")
        with self.assertRaisesRegex(RuntimeError, "artifact changed"):
            self.feedback.browser_cli_env(binding, CANDIDATE)

    def test_current_repro_actual_cli_target_receives_worker_binding_and_runs_clippy(self):
        self.configure_repro_scope()
        self.changed = ["rust/crates/er-repro/src/current.rs"]
        selection = self.feedback.plan()
        selection["execution_scope"] = {"er-cli": ["m9e_current_repro"]}
        selection["required_native_targets"] = {"er-cli": ["m9e_current_repro"]}
        selection["required_native_test_ids"] = {"er-cli:m9e_current_repro":
            selection["required_native_test_ids"]["er-cli:m9e_current_repro"]}
        self.binary_ids = {"m9e_current_repro": selection["required_native_test_ids"]["er-cli:m9e_current_repro"]}
        self.binary_crates = {"m9e_current_repro": "er-cli"}
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        with patch.object(self.feedback, "plan", return_value=selection), patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(summary["tests"]["passed"], 2)
        self.assertEqual(summary["cli_executable"]["source_sha"], CANDIDATE)
        self.assertEqual([(name, phase) for name, phase, _ in self.binary_envs],
                         [("m9e_current_repro", "list"), ("m9e_current_repro", "execute")])
        for _, _, env in self.binary_envs:
            self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
            self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], summary["worker_executable"]["sha256"])
        self.assertIsNone(self.feedback.native_target_env("er-repro", "m9e_current_repro", None))
        self.assertIn("cli-clippy", summary["timing_ms"])
        self.assertIn("er-repro-clippy", summary["timing_ms"])
        self.assertIn("er-env-clippy", summary["timing_ms"])
        wasm.assert_called_once()
        browser.assert_called_once()
        self.extra_artifacts = self.extra_artifacts[:1]
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("exactly one real CLI executable", summary["first_failure"])

    def test_later_browser_scope_requires_present_bridge_but_historical_scope_does_not(self):
        self.configure_browser_scope()
        self.changed = ["rust/crates/er-web/src/host_v2.rs"]
        self.assertFalse(self.feedback.plan()["requires_cli_executable"])
        helper = self.root / "test/browser/rust-browser/m9e-current-repro-bridge.ts"
        helper.parent.mkdir(parents=True)
        helper.write_text("// synthetic source presence\n")
        selection = self.feedback.plan()
        self.assertTrue(selection["requires_cli_executable"])
        self.assertIn("er-cli", selection["packages"])

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

    def test_bound_worker_environment_reaches_only_actual_current_process_targets(self):
        self.package("er-lab")
        self.assertIsNone(self.feedback.native_target_env("er-other", "current_kernel_supervisor_v2", None))
        with self.assertRaisesRegex(RuntimeError, "no bound worker executable"):
            self.feedback.native_target_env("er-lab", "current_kernel_supervisor_v2", None)
        self.binary_ids = {"a_suite": ["unrelated"], "current_kernel_endpoint_v2": ["real_process"],
                           "current_kernel_endpoint_faults_v2": ["synthetic_fault_peer"],
                           "current_kernel_supervisor_v2": ["real_supervisor_process"]}
        self.binary_crates["current_kernel_endpoint_v2"] = "er-lab"
        self.binary_crates["current_kernel_endpoint_faults_v2"] = "er-lab"
        self.binary_crates["current_kernel_supervisor_v2"] = "er-lab"
        self.extra_artifacts = [self.worker_executable_artifact()]
        selection = self.feedback.plan()
        selection["packages"] = ["er-native", "er-lab", "er-kernel-worker"]
        selection["requires_worker_executable"] = True
        with patch.object(self.feedback, "plan", return_value=selection):
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        binding = summary["worker_executable"]
        self.assertEqual(self.executed, ["a_suite", "current_kernel_endpoint_faults_v2", "current_kernel_endpoint_v2", "current_kernel_supervisor_v2"])
        for name, phase, env in self.binary_envs:
            with self.subTest(name=name, phase=phase):
                if name not in ("current_kernel_endpoint_v2", "current_kernel_supervisor_v2"):
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
        self.changed = ["rust/crates/er-env/src/current.rs", "rust/crates/er-cli/src/m72.rs"]
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

    def bridge_report(self, evidence=None):
        playwright, _ = self.browser_reports()
        if evidence is None:
            evidence = {"source_sha": CANDIDATE, "executable_sha256": "d" * 64,
                        "positive_replay": True, "time_omission_rejected": True,
                        "base_position": 8, "final_position": 12, "processed_attempts": 4,
                        "snapshot_digest": "blake3-v1:" + "e" * 64, "negative_divergence_position": 10}
        result = playwright["suites"][0]["suites"][0]["specs"][0]["tests"][0]["results"][0]
        result["attachments"] = [{"name": "m9e-current-repro-cli-bridge", "contentType": "application/json",
                                  "body": base64.b64encode(json.dumps(evidence).encode()).decode()}]
        return playwright, evidence, result["attachments"]

    def test_browser_bridge_evidence_requires_exact_candidate_bounded_causal_result(self):
        binding = {"source_sha": CANDIDATE, "sha256": "d" * 64}
        report, evidence, attachments = self.bridge_report()
        self.assertEqual(self.feedback.browser_bridge_evidence(report, binding), evidence)
        for key, value in (("source_sha", BASE), ("executable_sha256", "f" * 64), ("positive_replay", False),
                           ("time_omission_rejected", False), ("processed_attempts", 0), ("processed_attempts", 5),
                           ("base_position", True), ("final_position", 1 << 53),
                           ("negative_divergence_position", 8), ("negative_divergence_position", 12),
                           ("snapshot_digest", "wrong")):
            report, _, _ = self.bridge_report({**evidence, key: value})
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.feedback.browser_bridge_evidence(report, binding)
        for malformed in ({key: value for key, value in evidence.items() if key != "positive_replay"},
                          {**evidence, "extra": "unreviewed"}):
            with self.assertRaises(RuntimeError):
                self.feedback.browser_bridge_evidence(self.bridge_report(malformed)[0], binding)
        for defect in ("missing", "duplicate", "wrong_type", "oversize", "misplaced", "invalid_base64"):
            report, _, attachments = self.bridge_report()
            if defect == "missing":
                attachments.clear()
            elif defect == "duplicate":
                attachments.append(copy.deepcopy(attachments[0]))
            elif defect == "wrong_type":
                attachments[0]["contentType"] = "text/plain"
            elif defect == "oversize":
                attachments[0]["body"] = "x" * 5501
            elif defect == "misplaced":
                report["suites"][0]["suites"][0]["specs"][0]["title"] = "other test"
            else:
                attachments[0]["body"] = "%%%"
            with self.subTest(defect=defect), self.assertRaises((RuntimeError, ValueError)):
                self.feedback.browser_bridge_evidence(report, binding)
        report, _, attachments = self.bridge_report()
        path = self.root / "test-results/rust-browser/attachment.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(evidence))
        attachments[0].pop("body")
        attachments[0]["path"] = str(path)
        self.assertEqual(self.feedback.browser_bridge_evidence(report, binding), evidence)
        for wrong in (self.root / "outside.json", path.parent / "missing.json"):
            attachments[0]["path"] = str(wrong)
            with self.assertRaisesRegex(RuntimeError, "attachment path or size"):
                self.feedback.browser_bridge_evidence(report, binding)
        attachments[0]["path"] = str(path)
        path.write_bytes(b"x" * 4097)
        with self.assertRaisesRegex(RuntimeError, "attachment path or size"):
            self.feedback.browser_bridge_evidence(report, binding)

    def test_browser_orchestration_requires_cli_binding_and_candidate_attachment(self):
        summary = {"product_sha": CANDIDATE, "target": "x86_64-unknown-linux-gnu", "profile": "test",
                   "plan": {"requires_cli_executable": True}}
        summary["cli_executable"] = self.feedback.discover_cli_executable([self.cli_executable_artifact()], summary)
        reports, evidence, _ = self.bridge_report()
        evidence["executable_sha256"] = summary["cli_executable"]["sha256"]
        reports = self.bridge_report(evidence)[0]
        _, vitest = self.browser_reports()
        output = self.root / "runner/m9e-v7-web"
        output.mkdir(parents=True)
        assets = {}
        for name in ("er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json",
                     "coop-authority-snapshot.json", "coop-replica-snapshot.json"):
            path = output / name
            path.write_bytes(b"synthetic remote browser build asset")
            assets[name] = {"bytes": path.stat().st_size, "sha256": self.feedback.digest(path)}
        (output / "m9e-v7-web-assets.json").write_text(json.dumps({
            "source_sha": CANDIDATE, "assets": assets, "browser_worker_protocol_version": 2}))
        (self.rust / "rust-toolchain.toml").write_text('[toolchain]\nchannel = "1.97.1"\n')
        calls = []
        def browser_run(args, name, cwd=None, env=None):
            calls.append((name, env))
            if name == "browser-journey":
                (self.full / "browser-results.json").write_text(json.dumps(reports))
            if name == "browser-effects":
                (self.full / "browser-effect-results.json").write_text(json.dumps(vitest))
            return self.full / (name + ".log")
        with patch.dict(os.environ, {"RUNNER_TEMP": str(self.root / "runner")}), patch.object(self.feedback, "run", side_effect=browser_run):
            self.feedback.browser_checks(summary)
            self.assertEqual(summary["browser_current_repro_bridge"], evidence)
            env = next(env for name, env in calls if name == "browser-journey")
            self.assertEqual(env["ER_M9E_CLI_EXECUTABLE"], summary["cli_executable"]["path"])
            self.assertEqual(env["ER_M9E_CLI_SHA256"], evidence["executable_sha256"])
            self.assertEqual(env["ER_M9E_CLI_SOURCE_SHA"], CANDIDATE)
            reports, _ = self.browser_reports()
            with self.assertRaisesRegex(RuntimeError, "bridge attachment"):
                self.feedback.browser_checks(summary)
            summary.pop("cli_executable")
            with self.assertRaisesRegex(RuntimeError, "candidate-bound CLI"):
                self.feedback.browser_checks(summary)

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

    def test_interrupted_native_target_has_validated_inventory_and_completed_prefix_checkpoint(self):
        selection = self.feedback.plan()
        selection["required_native_targets"] = {"er-native": ["a_suite", "b_suite"]}
        selection["required_native_test_ids"] = {
            "er-native:a_suite": ["first"], "er-native:b_suite": ["second"]}
        checkpoints = []

        def interrupt_second(args, **kwargs):
            if Path(args[0]).name == "b_suite" and "--list" not in args:
                encoded = (self.compact / "summary.json").read_bytes()
                progress = json.loads(encoded)
                checkpoints.append(progress)
                self.assertLessEqual(len(encoded), 16000)
                self.assertEqual(progress["status"], "in_progress")
                self.assertEqual(progress["completion"], "unfinished")
                self.assertEqual(progress["active_phase"], "native")
                self.assertEqual(progress["active_target"], "er-native:b_suite")
                self.assertTrue(progress["selected_inventory_validated"])
                self.assertEqual(progress["tests"], {
                    "selected": 2, "executed": 1, "passed": 1, "failed": 0, "skipped": 0})
                self.assertEqual(progress["product_sha"], CANDIDATE)
                self.assertEqual(progress["workflow_sha"], CANDIDATE)
                self.assertEqual(progress["harness_sha"], hashlib.sha256(HARNESS.read_bytes()).hexdigest())
                selected = self.full / progress["selected_test_ids"]["file"]
                self.assertEqual(json.loads(selected.read_text()), ["a_suite::first", "b_suite::second"])
                self.assertEqual(progress["selected_test_ids"]["sha256"], hashlib.sha256(selected.read_bytes()).hexdigest())
                self.assertEqual([path.name for path in self.compact.iterdir()], ["summary.json"])
                self.assertEqual(self.executed, ["a_suite"])
                raise subprocess.TimeoutExpired(args, 600)
            return self.process(args, **kwargs)

        with patch.object(self.feedback, "plan", return_value=selection), \
                patch.object(self.feedback.subprocess, "run", side_effect=interrupt_second):
            code, summary = self.invoke()
        self.assertEqual(len(checkpoints), 1)
        self.assertEqual(code, 1)
        self.assertEqual(summary["status"], "failed")
        self.assertIn("b_suite exceeded 600 seconds", summary["first_failure"])
        self.assertEqual(summary["tests"], checkpoints[0]["tests"])
        self.assertNotIn("active_phase", summary)
        self.assertNotIn("completion", summary)
        self.assertLessEqual(sum(path.stat().st_size for path in self.compact.iterdir()), 65536)

    def test_build_lint_and_native_checkpoints_are_replaced_by_final_success(self):
        selection = self.feedback.plan()
        selection["requires_cli_clippy"] = True
        seen = []

        def observe_process(args, **kwargs):
            if args[:2] in (["cargo", "test"], ["cargo", "clippy"]) or (
                    Path(args[0]).name in self.binary_ids and "--list" not in args):
                progress = json.loads((self.compact / "summary.json").read_bytes())
                seen.append((progress["active_phase"], progress["active_target"],
                             progress["tests"], progress["selected_inventory_validated"]))
                self.assertEqual(progress["status"], "in_progress")
                self.assertEqual(progress["completion"], "unfinished")
            return self.process(args, **kwargs)

        with patch.object(self.feedback, "plan", return_value=selection), \
                patch.object(self.feedback.subprocess, "run", side_effect=observe_process):
            code, summary = self.invoke()
        self.assertEqual([(phase, target, counts["selected"], counts["executed"], validated)
                          for phase, target, counts, validated in seen], [
            ("build", None, 0, 0, False), ("lint", "er-cli", 2, 0, True),
            ("native", "er-native:a_suite", 2, 0, True),
            ("native", "er-native:b_suite", 2, 1, True)])
        self.assertEqual(code, 0)
        self.assertEqual(summary["status"], "passed")
        self.assertEqual(summary["tests"]["executed"], 2)
        self.assertNotIn("active_phase", summary)
        self.assertNotIn("completion", summary)
        self.assertLessEqual((self.compact / "summary.json").stat().st_size, 16000)

    def test_interrupted_checkpoint_write_preserves_previous_atomic_compact_summary(self):
        _, summary = self.invoke()
        self.feedback.write_progress(summary, "wasm", "m9e_parity")
        previous = (self.compact / "summary.json").read_bytes()
        write_bytes = Path.write_bytes

        def partial_write(path, data):
            self.assertEqual(path, self.full / "in-progress-summary.tmp")
            write_bytes(path, data[:13])
            raise OSError("synthetic interruption during temporary write")

        with patch.object(Path, "write_bytes", partial_write):
            with self.assertRaisesRegex(OSError, "synthetic interruption"):
                self.feedback.write_progress(summary, "browser")
        self.assertEqual((self.compact / "summary.json").read_bytes(), previous)
        self.assertEqual(json.loads(previous)["active_phase"], "wasm")
        self.assertEqual([path.name for path in self.compact.iterdir()], ["summary.json"])
        self.assertLessEqual(len(previous), 16000)

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


    def test_native_ambient_phase_cannot_escape_into_mocked_preflight(self):
        ambient = {"M9E_PHASE": "native", "M9E_NATIVE_LANE": "b", "M9E_PHASE_DIR": "/real-transfer",
                   "M9E_NATIVE_MANIFEST_SHA256": "a" * 64, "M9E_PLATFORM_RESULT": "success", "GITHUB_OUTPUT": "/real-output"}
        with patch.dict(os.environ, ambient):
            child = self.feedback.preflight_environment()
            for key in ambient:
                self.assertNotIn(key, child)
                self.assertEqual(os.environ[key], ambient[key])
            self.assertEqual(child["M9E_REPORT_DIR"], os.environ["M9E_REPORT_DIR"])
            self.assertEqual(child["GITHUB_SHA"], CANDIDATE)


class PhaseTransferTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="m9e-phase-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        spec = importlib.util.spec_from_file_location("m9e_phase_under_test", HARNESS.with_name("m9e_phases.py"))
        self.phases = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.phases)
        self.identity = {"product_sha": CANDIDATE, "workflow_sha": CANDIDATE, "run_id": "42", "run_attempt": "1",
                         "files": {key: "a" * 64 for key in self.phases.IDENTITY_FILES},
                         "toolchain": "rustc pinned", "target": "x86_64-unknown-linux-gnu",
                         "profile": "test", "features": "default"}
        self.binary = b"exact candidate executable"
        self.native = {"version": 1, "phase": "native", "status": "passed", "qualification": "pending",
                       "identity": self.identity,
                       "plan": {"requires_wasm": True, "requires_browser": True, "requires_cli_executable": True,
                                "required_native_targets": {"er-repro": ["m9e_current_repro"]}},
                       "tests": {"selected": 13, "executed": 11, "passed": 11, "failed": 0, "skipped": 0},
                       "selected_inventory_validated": True, "selected_test_ids_sha256": "e" * 64,
                       "required_native_target_counts": {"er-repro:m9e_current_repro": 9},
                       "native_timer_parity_digest": "d" * 64,
                       "cli": {"file": "er-cli", "bytes": len(self.binary), "sha256": self.phases.sha(self.binary),
                               "source_sha": CANDIDATE, "target": self.identity["target"], "profile": "test",
                               "cargo_package_id": "path+file:///candidate/rust/crates/er-cli#0.1.0",
                               "cargo_profile": {"test": False}, "manifest_path": "rust/crates/er-cli/Cargo.toml"}}
        self.native["plan_sha256"] = self.phases.sha(self.phases.encoded(self.native["plan"]))
        self.native["inventory"] = [
            {"crate": "er-cli", "target": "m9e_current_repro", "ids": ["cli_one", "cli_two"], "historical_excluded_ids": []},
            {"crate": "er-repro", "target": "m9e_current_repro", "ids": [f"core_{index}" for index in range(9)], "historical_excluded_ids": []},
            {"crate": "er-wasm", "target": "m9e_parity", "ids": ["native_raw", "native_timer"], "historical_excluded_ids": []},
        ]
        self.native["inventory_sha256"] = self.phases.sha(self.phases.encoded(self.native["inventory"]))
        self.native["lane"] = "a"
        self.native["assigned_targets"] = self.phases.partition(self.native["inventory"])["a"]
        self.native["completed_targets"] = self.native["assigned_targets"]
        self.other = copy.deepcopy(self.native)
        self.other["lane"] = "b"
        self.other["assigned_targets"] = self.phases.partition(self.native["inventory"])["b"]
        self.other["completed_targets"] = self.other["assigned_targets"]
        self.other["tests"].update({"executed": 2, "passed": 2})
        self.other["native_timer_parity_digest"] = None
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", self.other)
        self.platform = {"version": 1, "phase": "platform", "status": "passed", "qualification": "pending",
                         "identity": self.identity, "native_manifest_sha256": self.native_hash,
                         "plan_sha256": self.native["plan_sha256"],
                         "wasm_tests": {"expected": 2, "passed": 2, "failed": 0, "skipped": 0,
                                        "selected_test_ids": sorted(self.phases.WASM_IDS),
                                        "timer_parity_digest": "d" * 64, "native_timer_parity_digest": "d" * 64},
                         "browser_tests": {"chromium": {"expected": 2, "passed": 2, "failed": 0, "skipped": 0,
                                                        "selected_test_ids": sorted(self.phases.BROWSER_IDS)},
                                           "typed_effects": {"expected": 1, "passed": 1, "failed": 0, "skipped": 0}},
                         "browser_assets": {"manifest_sha256": "f" * 64},
                         "browser_current_repro_bridge": {"positive_replay": True, "time_omission_rejected": True,
                                                          "source_sha": CANDIDATE,
                                                          "executable_sha256": self.native["cli"]["sha256"],
                                                          "base_position": 9, "final_position": 12, "processed_attempts": 3,
                                                          "negative_divergence_position": 10, "snapshot_digest": "blake3-v1:" + "a" * 64}}
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)

    def test_phase_identity_rejects_source_build_and_run_mismatches(self):
        for key in ("product_sha", "workflow_sha", "run_id", "run_attempt", "profile", "target", "toolchain"):
            with self.subTest(key=key):
                proof = copy.deepcopy(self.native)
                proof["identity"][key] = "different"
                with self.assertRaisesRegex(RuntimeError, "identity"):
                    self.phases.validate_native(proof, self.identity)
        proof = copy.deepcopy(self.native)
        proof["identity"]["files"]["lock"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "identity"):
            self.phases.validate_native(proof, self.identity)
        proof = copy.deepcopy(self.platform)
        proof["plan_sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "identity"):
            self.phases.validate_platform(proof, self.native, self.native_hash)

    def test_platform_requires_exact_parity_and_every_browser_witness(self):
        for key in ("wasm_tests", "browser_tests", "browser_assets", "browser_current_repro_bridge"):
            with self.subTest(omitted=key):
                proof = copy.deepcopy(self.platform)
                del proof[key]
                with self.assertRaises(RuntimeError):
                    self.phases.validate_platform(proof, self.native, self.native_hash)
        for key, value in (("timer_parity_digest", "0" * 64), ("selected_test_ids", ["wrong", "also_wrong"]),
                           ("passed", 1), ("skipped", 1)):
            with self.subTest(wasm=key):
                proof = copy.deepcopy(self.platform)
                proof["wasm_tests"][key] = value
                with self.assertRaisesRegex(RuntimeError, "Wasm"):
                    self.phases.validate_platform(proof, self.native, self.native_hash)
        proof = copy.deepcopy(self.platform)
        proof["browser_current_repro_bridge"]["executable_sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "bridge"):
            self.phases.validate_platform(proof, self.native, self.native_hash)

    def test_native_requires_full_inventory_and_selected_mutant_restoration(self):
        proof = copy.deepcopy(self.native)
        proof["tests"]["passed"] -= 1
        with self.assertRaisesRegex(RuntimeError, "inventory"):
            self.phases.validate_native(proof, self.identity)
        proof = copy.deepcopy(self.native)
        proof["plan"]["timer_mutant"] = {"test": "core_0", "package": "er-repro", "target": "m9e_current_repro",
                                           "source": "rust/crates/er-repro/src/current.rs"}
        proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
        with self.assertRaisesRegex(RuntimeError, "mutant"):
            self.phases.validate_native(proof, self.identity)
        proof["timer_mutant"] = {"status": "detected", "original_sha256": "a" * 64, "restored_sha256": "b" * 64,
                                 "source": "rust/crates/er-repro/src/current.rs", "test": "core_0", "target": "m9e_current_repro",
                                 "tests": {"executed": 1, "passed": 0, "failed": 1, "skipped": 0}}
        with self.assertRaisesRegex(RuntimeError, "mutant"):
            self.phases.validate_native(proof, self.identity)
        proof["timer_mutant"]["restored_sha256"] = "a" * 64
        self.phases.validate_native(proof, self.identity)
        proof["timer_mutant"]["test"] = "different_behavior"
        with self.assertRaisesRegex(RuntimeError, "mutant"):
            self.phases.validate_native(proof, self.identity)

    def test_transfer_rejects_manifest_path_size_hash_and_extra_files(self):
        for key, value in (("file", "../er-cli"), ("bytes", self.phases.CLI_LIMIT + 1),
                           ("cargo_profile", {"test": True}), ("source_sha", BASE)):
            with self.subTest(metadata=key):
                proof = copy.deepcopy(self.native)
                proof["cli"][key] = value
                with self.assertRaisesRegex(RuntimeError, "metadata"):
                    self.phases.validate_native(proof, self.identity)
        directory = self.root / "cli"
        directory.mkdir()
        path = directory / "er-cli"
        path.write_bytes(b"x" * len(self.binary))
        with self.assertRaisesRegex(RuntimeError, "hash"):
            self.phases.transfer_cli(self.native, directory)
        path.write_bytes(self.binary)
        (directory / "unexpected").write_bytes(b"not permitted")
        with self.assertRaisesRegex(RuntimeError, "inventory"):
            self.phases.transfer_cli(self.native, directory)
        (directory / "unexpected").unlink()
        result = self.phases.transfer_cli(self.native, directory)
        self.assertEqual(result["sha256"], self.native["cli"]["sha256"])
        self.assertEqual(Path(result["path"]), path.resolve())

    def test_manifest_hash_and_byte_cap_are_enforced(self):
        path = self.root / "proof/native-a.json"
        with self.assertRaisesRegex(RuntimeError, "digest"):
            self.phases.read_bounded(path, "0" * 64)
        with self.assertRaisesRegex(RuntimeError, "64 KiB"):
            self.phases.write_bounded(self.root / "large.json", {"payload": "x" * self.phases.MANIFEST_LIMIT})
        path.write_bytes(b"x" * (self.phases.MANIFEST_LIMIT + 1))
        with self.assertRaisesRegex(RuntimeError, "size"):
            self.phases.read_bounded(path, self.native_hash)

    def phase_environment(self):
        return patch.dict(os.environ, {"M9E_PHASE_DIR": str(self.root), "M9E_NATIVE_A_RESULT": "success",
                                      "M9E_NATIVE_B_RESULT": "success", "M9E_NATIVE_B_MANIFEST_SHA256": self.other_hash,
                                      "M9E_PLATFORM_RESULT": "success", "M9E_NATIVE_MANIFEST_SHA256": self.native_hash,
                                      "M9E_PLATFORM_MANIFEST_SHA256": self.platform_hash})

    def test_aggregate_rejects_missing_cancelled_or_partial_phase(self):
        for status in ("", "failure", "skipped", "cancelled"):
            with self.subTest(status=status), self.phase_environment(), patch.dict(os.environ, {"M9E_PLATFORM_RESULT": status}):
                with self.assertRaisesRegex(RuntimeError, "absent"):
                    self.phases.aggregate(None)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            (self.root / "platform/platform.json").unlink()
            with self.assertRaisesRegex(RuntimeError, "manifest"):
                self.phases.aggregate(None)

    def test_aggregate_accepts_only_complete_same_run_proofs(self):
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            result = self.phases.aggregate(None)
        self.assertEqual(result["qualification"], "passed")
        self.assertEqual(result["tests"], {"selected": 13, "executed": 13, "passed": 13, "failed": 0, "skipped": 0})
        self.assertEqual(result["native_manifest_sha256"], self.native_hash)
        self.assertEqual(result["platform_manifest_sha256"], self.platform_hash)

    def test_platform_runs_existing_checks_with_only_verified_cli_binding(self):
        directory = self.root / "cli"
        directory.mkdir()
        (directory / "er-cli").write_bytes(self.binary)
        compact = self.root / "report/compact"
        compact.mkdir(parents=True)
        calls = []

        def wasm_checks(plan, summary):
            calls.append("wasm")
            self.assertEqual(plan, self.native["plan"])
            self.assertEqual(summary["native_timer_parity_digest"], "d" * 64)
            summary["wasm_tests"] = self.platform["wasm_tests"]

        def browser_checks(summary):
            calls.append("browser")
            binding = summary["cli_executable"]
            self.assertEqual(self.phases.file_hash(Path(binding["path"])), self.native["cli"]["sha256"])
            self.assertEqual(Path(binding["root"]), directory.resolve())
            self.assertNotIn("worker_executable", summary)
            for key in ("browser_tests", "browser_assets", "browser_current_repro_bridge"):
                summary[key] = self.platform[key]

        feedback = SimpleNamespace(COMPACT=compact, TIMINGS={}, wasm_checks=wasm_checks, browser_checks=browser_checks)
        with self.phase_environment(), patch.dict(os.environ, {"GITHUB_OUTPUT": str(self.root / "output")}), \
                patch.object(self.phases, "identity", return_value=self.identity):
            result = self.phases.platform(feedback)
        self.assertEqual(calls, ["wasm", "browser"])
        self.assertEqual(result["qualification"], "pending")
        self.assertEqual(result["status"], "passed")

    def test_native_partition_is_crate_qualified_and_retains_zero_test_targets(self):
        inventory = copy.deepcopy(self.native["inventory"])
        inventory.extend([
            {"crate": "er-web", "target": "m9e_host_v2", "ids": ["host"], "historical_excluded_ids": []},
            {"crate": "er-cli", "target": "m9e_current_batch", "ids": ["batch"], "historical_excluded_ids": []},
            {"crate": "er-other", "target": "m9e_host_v2", "ids": [], "historical_excluded_ids": []},
        ])
        assignment = self.phases.partition(inventory)
        self.assertIn(["er-web", "m9e_host_v2"], assignment["b"])
        self.assertIn(["er-cli", "m9e_current_batch"], assignment["b"])
        self.assertIn(["er-other", "m9e_host_v2"], assignment["a"])
        self.assertEqual(len(assignment["a"]) + len(assignment["b"]), len(inventory))
        inventory.append(copy.deepcopy(inventory[0]))
        with self.assertRaisesRegex(RuntimeError, "duplicated"):
            self.phases.partition(inventory)

    def test_native_partition_rejects_omission_overlap_and_unexecuted_target(self):
        for key in ("assigned_targets", "completed_targets"):
            for mode in ("omit", "duplicate", "wrong_lane"):
                with self.subTest(key=key, mode=mode):
                    proof = copy.deepcopy(self.other)
                    if mode == "omit":
                        proof[key] = []
                    elif mode == "duplicate":
                        proof[key] = proof[key] * 2
                    else:
                        proof[key] = self.native["assigned_targets"]
                    with self.assertRaises(RuntimeError):
                        self.phases.validate_native(proof, self.identity)

    def test_aggregate_rejects_independently_valid_different_global_inventory(self):
        proof = copy.deepcopy(self.other)
        proof["inventory"][0]["ids"] = ["different_cli_one", "different_cli_two"]
        proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
        proof_hash = self.phases.write_bounded(self.root / "proof/native-b.json", proof)
        with self.phase_environment(), patch.dict(os.environ, {"M9E_NATIVE_B_MANIFEST_SHA256": proof_hash}), \
                patch.object(self.phases, "identity", return_value=self.identity):
            with self.assertRaisesRegex(RuntimeError, "different global"):
                self.phases.aggregate(None)

    def test_native_empty_b_is_explicit_readiness_evidence(self):
        proof = copy.deepcopy(self.other)
        proof["plan"] = {"requires_wasm": False, "requires_browser": False, "requires_cli_executable": False}
        proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
        proof["inventory"] = [{"crate": "er-canonical", "target": "er_canonical", "ids": ["canonical"], "historical_excluded_ids": []}]
        proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
        proof["assigned_targets"] = []
        proof["completed_targets"] = []
        proof["required_native_target_counts"] = {}
        proof["tests"] = {"selected": 1, "executed": 0, "passed": 0, "failed": 0, "skipped": 0}
        proof["cli"] = None
        self.phases.validate_native(proof, self.identity)

    def test_platform_bridge_requires_full_causal_payload(self):
        for field, value in (("processed_attempts", 0), ("final_position", 13), ("negative_divergence_position", 12),
                             ("base_position", True), ("snapshot_digest", "invalid")):
            with self.subTest(field=field):
                proof = copy.deepcopy(self.platform)
                proof["browser_current_repro_bridge"][field] = value
                with self.assertRaisesRegex(RuntimeError, "bridge"):
                    self.phases.validate_platform(proof, self.native, self.native_hash)
        proof = copy.deepcopy(self.platform)
        del proof["browser_current_repro_bridge"]["snapshot_digest"]
        with self.assertRaisesRegex(RuntimeError, "bridge"):
            self.phases.validate_platform(proof, self.native, self.native_hash)


if __name__ == "__main__":
    unittest.main()
