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
import re
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


BASE = "a" * 40
CANDIDATE = "b" * 40
PREVIOUS_PUSH = "c" * 40
HARNESS = Path(__file__).with_name("m9e_feedback.py")


def browser_worker_fixture(phases):
    binding = {"source_sha": CANDIDATE, "source_hashes": {path: "b" * 64 for path in phases.WORKER_SOURCE_PATHS},
               "pnpm_lock_sha256": "c" * 64}
    cohort = {"er_web.js": {"bytes": 4, "sha256": "d" * 64},
              "er_web_bg.wasm": {"bytes": 8, "sha256": "e" * 64},
              "game-content-bundle-v2.json": {"bytes": 2, "sha256": "f" * 64}}
    manifest = {"schema_version": 1, "browser_worker_protocol_version": 2, "source_sha": CANDIDATE,
                "entry": "current-worker-entry.js", "worker": "current-rust-kernel-worker-abc123.js",
                "assets": {"current-worker-entry.js": {"bytes": 5, "sha256": phases.sha(b"entry"), "role": "entry"},
                           "current-rust-kernel-worker-abc123.js": {"bytes": 6, "sha256": phases.sha(b"worker"), "role": "worker"}},
                "source_hashes": binding["source_hashes"], "builder_sha256": "b" * 64,
                "pnpm_lock_sha256": "c" * 64, "vite_version": "8.0.10",
                "cohort": {"glue_sha256": "d" * 64, "wasm_sha256": "e" * 64, "content_sha256": "f" * 64}}
    assets = {"manifest": manifest, "manifest_sha256": phases.sha(phases.encoded(manifest))}
    common = {"schema_version": 1, "source_sha": CANDIDATE, "manifest_sha256": assets["manifest_sha256"],
              "entry_sha256": manifest["assets"][manifest["entry"]]["sha256"],
              "worker_sha256": manifest["assets"][manifest["worker"]]["sha256"], "worker_path": manifest["worker"],
              **manifest["cohort"], "browser_worker_protocol_version": 2}
    positive = {**common, "observed_worker_count": 1, "initial_control": "TITLE", "final_control": "BATTLE_COMMAND",
                "presentation_count": 3, "settled_presentation_count": 3, "ui_change_count": 4,
                "held_cursor": ["battle/command/party", "battle/command/party", "battle/command/fight"],
                "released_cursor": "battle/command/fight", "final_snapshot_digest": "1" * 64,
                "accepted_sequence": 12, "disposed": True, "rejected_event_code": "HOST_REJECTED",
                "rejection_preserved_snapshot": True, "authority_material_count": 1}
    negative = {**common, "observed_worker_count": 2,
                "wrong_abi": {"code": "INVALID_ABI", "acceptance": "REJECTED", "request_id": 1, "sequence": 0, "accepted_sequence": None},
                "invalid_request_id": {"code": "WORKER_FAILURE", "acceptance": "UNKNOWN", "request_id": None, "sequence": None, "accepted_sequence": None},
                "pending_before_termination": 2, "settled_after_termination": 2, "rejected_after_termination": 2,
                "closed": True, "pending_after": 0, "queued_bytes_after": 0, "accepted_sequence": None,
                "post_termination_rejected": True}
    tests = {"expected": 2, "passed": 2, "failed": 0, "skipped": 0, "selected_test_ids": list(phases.WORKER_TEST_IDS),
             "positive": positive, "negative": negative}
    return binding, assets, tests, cohort


def browser_worker_report(tests):
    specs = []
    for index, key in enumerate(("positive", "negative")):
        specs.append({"title": tests["selected_test_ids"][index], "file": "m9e-v7-worker.spec.ts",
                      "tests": [{"projectName": "chromium", "expectedStatus": "passed", "status": "expected",
                                 "results": [{"status": "passed", "retry": 0, "attachments": [{
                                     "name": "m9e-current-worker-" + key, "contentType": "application/json",
                                     "body": base64.b64encode(json.dumps(tests[key]).encode()).decode()}]}]}]})
    return {"suites": [{"specs": specs}], "errors": []}


def browser_rtc_fixture(phases):
    binding, assets, _, cohort = browser_worker_fixture(phases)
    binding["source_hashes"] = {path: "b" * 64 for path in phases.RTC_SOURCE_PATHS}
    manifest = assets["manifest"]
    manifest.update({"entry": "current-rtc-entry.js", "worker": "current-rtc-kernel-worker-abc123.js",
                     "source_hashes": binding["source_hashes"],
                     "assets": {"current-rtc-entry.js": {"bytes": 5, "sha256": phases.sha(b"entry"), "role": "entry"},
                                "current-rtc-kernel-worker-abc123.js": {"bytes": 6, "sha256": phases.sha(b"worker"), "role": "worker"}}})
    assets["manifest_sha256"] = phases.sha(phases.encoded(manifest))
    cohort.update({"coop-authority-snapshot.json": {"bytes": 10, "sha256": "1" * 64},
                   "coop-replica-snapshot.json": {"bytes": 10, "sha256": "2" * 64}})
    common = {"source_sha": CANDIDATE, "manifest_sha256": assets["manifest_sha256"],
              "worker_sha256": manifest["assets"][manifest["worker"]]["sha256"], "worker_path": manifest["worker"],
              **manifest["cohort"], "browser_worker_protocol": 2, "generation": 1, "observed_workers": 2,
              "authority_fixture_sha256": "1" * 64, "replica_fixture_sha256": "2" * 64}
    positive = {**common, "initial_turn": 0, "final_turn": 1, "proposal_sha256": "3" * 64, "proposal_bytes": 600,
                "material_sha256": "4" * 64, "material_bytes": 60_000, "proposal_operation_id": "fixture/operation",
                "material_revision": 3, "material_after_digest": "blake3-v1:" + "5" * 64, "presentation_count": 2,
                "settled_presentation_count": 2, "duplicate_proposal_effects": 0, "duplicate_material_effects": 0,
                "private_duplicate_snapshot_equal": True, "left_sent": 4, "right_sent": 2,
                "left_kernel_delivered": 2, "right_kernel_delivered": 4, "maximum_frame_bytes": 60_000,
                "negotiated_frame_bound": 65_536, "disconnected_events": [1, 1], "disposed": [True, True]}
    negative = {**common, "mismatch": {"workers": 2, "rejected_readiness": 2, "rejected_queued_sends": 16,
                "invalid_admissions": 3, "connected_events": [0, 0], "kernel_delivered": [0, 0], "snapshot_equal": True},
                "stalled_callback_aborted": True, "queued_snapshot_rejected": True, "disposal_acknowledged": False,
                "committed_delivery_failure_sequence": 9, "pending_after": 0, "queued_bytes_after": 0, "worker_closed": True}
    tests = {"expected": 2, "passed": 2, "failed": 0, "skipped": 0, "selected_test_ids": list(phases.RTC_TEST_IDS),
             "positive": positive, "negative": negative}
    return binding, assets, tests, cohort


def browser_rtc_report(tests):
    report = browser_worker_report(tests)
    for spec in report["suites"][0]["specs"]:
        spec["file"] = "m9e-v7-worker-rtc.spec.ts"
        for attachment in spec["tests"][0]["results"][0]["attachments"]:
            attachment["name"] = attachment["name"].replace("current-worker-", "current-rtc-")
    return report


def current_storage_fixture(phases, binding=None):
    binding = binding or {"source_sha": CANDIDATE, "source_hashes": {name: "d" * 64 for name in phases.STORAGE_SOURCE_PATHS},
                          "pnpm_lock_sha256": "c" * 64}
    values = {
        "reconciled": {"transaction_committed": True, "completion_deliberately_dropped": True, "original_request": 1,
                       "operation": hashlib.sha256(b'[1,"logical-save","fixture-v2","stable-session",1,"WRITE","slot-a",1]\x00' + bytes([0, 1, 255])).hexdigest(),
                       "before_phase": "UNCERTAIN", "after_phase": "ACKNOWLEDGED",
                       "actual_generation": 1, "payload_sha256": hashlib.sha256(bytes([0, 1, 255])).hexdigest(),
                       "writes": 1, "callbacks": 1, "reopened_exact_bytes": True, "slots_utf8_ordered": True},
        "conflict": {"original_phase": "UNCERTAIN", "conflict_phase": "FAILED", "conflict_code": "CONFLICT",
                     "competing_generation": 2, "competing_receipt": "c" * 64, "competing_exact_bytes_preserved": True,
                     "original_writes": 1, "callbacks": 0},
        "abort-bound": {"actual_abort_settled": True, "owner_abort_phase": "FAILED", "owner_write_outcome": "ABORTED",
                        "aborted_record_absent": True, "original_request_retry_accepted": True, "slots": 64,
                        "overflow_rejected_without_record": True, "existing_slot_replacement_allowed": True, "namespace_isolation": True},
    }
    tests = {"expected": 3, "passed": 3, "failed": 0, "skipped": 0, "selected_test_ids": list(phases.STORAGE_BROWSER_IDS)}
    specs = []
    for title, key in zip(phases.STORAGE_BROWSER_IDS, phases.STORAGE_EVIDENCE_KEYS):
        tests[key] = {"schema_version": 1, "capability": "INDEXEDDB_ADAPTER_ONLY", "source_sha": binding["source_sha"],
                      "source_hashes": dict(binding["source_hashes"]), "evidence": values[key]}
        specs.append({"title": title, "file": "m9e-current-storage.spec.ts", "tests": [{"projectName": "chromium",
            "expectedStatus": "passed", "status": "expected", "results": [{"status": "passed", "retry": 0, "attachments": [{
                "name": "m9e-current-storage-" + key, "contentType": "application/json",
                "body": base64.b64encode(json.dumps(tests[key]).encode()).decode()}]}]}]})
    node = {"expected": 5, "passed": 5, "failed": 0, "skipped": 0, "selected_test_ids": list(phases.STORAGE_NODE_IDS)}
    node_report = {"success": True, "numTotalTests": 5, "numPassedTests": 5, "numFailedTests": 0, "numPendingTests": 0,
                   "testResults": [{"name": phases.STORAGE_SOURCE_PATHS[2], "assertionResults": [
                       {"fullName": name, "status": "passed", "failureMessages": []} for name in phases.STORAGE_NODE_IDS]}]}
    return binding, tests, {"suites": [{"specs": specs}], "errors": []}, node, node_report

def rule_fixture(root):
    import m9e_rulechange as rule
    for key, path in rule.RULE_INPUTS.items():
        source = root / path
        source.parent.mkdir(parents=True, exist_ok=True)
        if not source.exists():
            source.write_text("synthetic " + key + "\n")
    source = root / rule.RULE_SOURCE
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("fn timer() {\n" + rule.RULE_ORIGINAL + "}\n")
    test = root / rule.RULE_TEST_SOURCE
    test.parent.mkdir(parents=True, exist_ok=True)
    test.write_text("// exact synthetic rule witness\n")
    policy = rule.make_rule_policy(root, CANDIDATE)
    worker = root / "rust/target/er-kernel-worker"
    worker.parent.mkdir(parents=True, exist_ok=True)
    worker.write_bytes(b"clean candidate worker")
    worker.chmod(0o755)
    clean = {"path": str(worker), "bytes": worker.stat().st_size,
             "sha256": hashlib.sha256(worker.read_bytes()).hexdigest(), "source_sha": CANDIDATE,
             "target": "x86_64-unknown-linux-gnu", "profile": "test",
             "cargo_profile": {"test": False}, "cargo_package_id": "path+file:///clean#er-kernel-worker@0.1.0",
             "manifest_path": rule.RULE_INPUTS["manifest"]}
    identity = {"product_sha": CANDIDATE, "target": clean["target"], "toolchain": "rustc pinned",
                "files": {"lock": policy["inputs"]["lock"], "rule_workspace": policy["inputs"]["workspace"],
                          "rule_worker_manifest": policy["inputs"]["manifest"], "rule_toolchain": policy["inputs"]["toolchain"],
                          "rule_source": policy["original_sha256"], "rule_test": policy["test_sha256"]}}
    evidence = {"schema_version": 1, "status": "passed", "policy_sha256": hashlib.sha256(rule.encoded(policy)).hexdigest(),
                **{key: policy[key] for key in ("source", "rule", "candidate_source_sha", "original_sha256", "derived_sha256", "inputs")},
                "test": rule.RULE_TEST, "target": rule.RULE_TARGET,
                "tests": {"executed": 1, "passed": 1, "failed": 0, "skipped": 0},
                "derived_source_sha": "e" * 40, "parent_sha": CANDIDATE, "tree_sha": "3" * 40,
                "parent_tree_sha": "4" * 40, "original_blob": "1" * 40, "derived_blob": "2" * 40,
                "changed_paths": [rule.RULE_SOURCE], "source_mode": "100644", "patch_bytes": 700,
                "patch_sha256": "9" * 64, "toolchain": identity["toolchain"], "cargo_version": "cargo 1.97.1",
                "candidate_preserved_sha256": policy["original_sha256"], "pool_verified_after_test": True,
                "clean_worker_sha256": clean["sha256"], "pool_files": ["base-worker", "rule-worker"],
                "worker": {"source_sha": "e" * 40, "target": clean["target"], "profile": "test",
                           "cargo_profile": clean["cargo_profile"], "package_identity": "er-kernel-worker@0.1.0",
                           "manifest_path": clean["manifest_path"], "sha256": "8" * 64, "bytes": 200}}
    return rule, policy, clean, identity, evidence


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
        diagnostic_patch = patch.object(self.feedback.subprocess, "Popen", side_effect=self.diagnostic_process)
        capture_patch.start()
        process_patch.start()
        diagnostic_patch.start()
        self.addCleanup(capture_patch.stop)
        self.addCleanup(process_patch.stop)
        self.addCleanup(diagnostic_patch.stop)

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
            packages = [args[index + 1] for index, value in enumerate(args) if value == "-p"]
            self.events.extend("clippy:" + package for package in packages)
            code = next((self.clippy_codes.get(package, self.clippy_code) for package in packages
                         if self.clippy_codes.get(package, self.clippy_code)), 0)
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

    def diagnostic_process(self, args, **kwargs):
        result = self.process(args, **kwargs)
        return SimpleNamespace(pid=987654, wait=lambda timeout: result.returncode)

    def test_failed_clippy_diagnostics_preserve_original_gate_failure_and_all_selected_provenance(self):
        self.configure_ai_damage_query_scope()
        self.changed = self.config["ai_damage_query_focus"]["paths"]
        self.ai_damage_query_binaries()
        self.clippy_codes["er-game"] = 1
        with patch.object(self.feedback, "browser_checks") as browser, patch.object(self.feedback, "wasm_checks") as wasm:
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(summary["status"], "failed")
        self.assertIn("selected-packages-clippy exited 1", summary["first_failure"])
        self.assertEqual(summary["tests"]["executed"], 0)
        self.assertEqual(summary["tests"]["passed"], 0)
        self.assertEqual(self.executed, [])
        browser.assert_not_called()
        wasm.assert_not_called()
        index_path = self.compact / "clippy-diagnostics.json"
        index = json.loads(index_path.read_bytes())
        selection = json.loads((self.full / "plan.json").read_text())
        self.assertEqual([row[0] for row in index["packages"]], selection["packages"])
        self.assertEqual(index["source_sha"], CANDIDATE)
        self.assertEqual(index["stop_reason"], "complete")
        self.assertEqual(index["command_suffix"], ["--keep-going", "--all-targets", "--no-deps", "--", "-D", "warnings"])
        commands = [args for args in self.commands if args[:2] == ["cargo", "clippy"]]
        self.assertEqual(commands[0], ["cargo", "clippy", "--locked",
            *[part for name in selection["packages"] for part in ("-p", name)],
            "--all-targets", "--no-deps", "--", "-D", "warnings"])
        self.assertEqual(commands[1:], [[*index["command_prefix"], name, *index["command_suffix"]]
                                      for name in selection["packages"]])
        for name, outcome, returncode, window, elapsed, size, manifest_hash in index["packages"]:
            self.assertEqual(outcome, "exit-nonzero" if name == "er-game" else "exit-zero")
            self.assertEqual(returncode, 1 if name == "er-game" else 0)
            self.assertTrue(0 < window <= 60000)
            self.assertEqual(manifest_hash, self.feedback.digest(self.rust / "crates" / name / "Cargo.toml"))
            self.assertEqual(size, (self.full / "clippy-diagnostics" / (name + ".log")).stat().st_size)
        self.assertEqual(index_path.read_bytes(), (self.full / "clippy-diagnostics/index.json").read_bytes())
        self.assertEqual(summary["clippy_failure_diagnostics"]["sha256"], self.feedback.digest(index_path))
        self.assertLessEqual(sum(path.stat().st_size for path in self.compact.iterdir() if path.is_file()), 65536)

    def diagnostic_fixture(self, packages):
        for package in packages:
            self.package(package)
        self.compact.mkdir(exist_ok=True)
        (self.full / "selected-packages-clippy.log").write_text("error: original gate failed\n")
        return {"packages": packages}, {"product_sha": CANDIDATE, "status": "failed"}

    def test_failed_clippy_diagnostics_timeout_kills_group_and_reserves_total_cleanup_budget(self):
        selection, summary = self.diagnostic_fixture(["er-a", "er-b", "er-c"])
        now, waits = [0.0], []
        def wait(timeout):
            waits.append(timeout)
            now[0] += timeout
            if len(waits) == 1:
                raise subprocess.TimeoutExpired("cargo", timeout)
            return -9
        process = SimpleNamespace(pid=54321, wait=wait)
        with patch.object(self.feedback.time, "monotonic", side_effect=lambda: now[0]), \
                patch.object(self.feedback, "CLIPPY_DIAGNOSTIC_TOTAL_SECONDS", 12), \
                patch.object(self.feedback, "CLIPPY_DIAGNOSTIC_PACKAGE_SECONDS", 10), \
                patch.object(self.feedback, "CLIPPY_DIAGNOSTIC_CLEANUP_SECONDS", 2), \
                patch.object(self.feedback.subprocess, "Popen", return_value=process) as spawn, \
                patch.object(self.feedback.os, "killpg", create=True) as kill:
            self.feedback.collect_clippy_failure_diagnostics(selection, summary)
        self.assertEqual(waits, [8, 2])
        kill.assert_called_once_with(54321, self.feedback.signal.SIGKILL)
        self.assertTrue(spawn.call_args.kwargs["start_new_session"])
        self.assertEqual(spawn.call_args.kwargs["cwd"], self.rust)
        spawn.assert_called_once()
        index = json.loads((self.compact / "clippy-diagnostics.json").read_text())
        self.assertEqual([row[1] for row in index["packages"]], ["timeout", "not-attempted", "not-attempted"])
        self.assertEqual(index["packages"][0][2:5], [-9, 10000, 10000])
        self.assertEqual(index["stop_reason"], "total-budget")
        self.assertLessEqual(index["elapsed_ms"], 12000)
        self.assertEqual(summary["status"], "failed")

    def test_failed_clippy_diagnostics_record_spawn_error_then_attempt_remaining_packages(self):
        selection, summary = self.diagnostic_fixture(["er-a", "er-b", "er-c"])
        outcomes = [OSError("synthetic spawn failure"), SimpleNamespace(pid=2, wait=lambda timeout: 7),
                    SimpleNamespace(pid=3, wait=lambda timeout: 0)]
        with patch.object(self.feedback.subprocess, "Popen", side_effect=outcomes) as spawn:
            self.feedback.collect_clippy_failure_diagnostics(selection, summary)
        index = json.loads((self.compact / "clippy-diagnostics.json").read_text())
        self.assertEqual([row[1] for row in index["packages"]], ["process-error", "exit-nonzero", "exit-zero"])
        self.assertEqual([row[2] for row in index["packages"]], [None, 7, 0])
        self.assertEqual(spawn.call_count, 3)
        self.assertIn("synthetic spawn failure", (self.full / "clippy-diagnostics/er-a.log").read_text())
        self.assertEqual(summary["clippy_failure_diagnostics"]["attempted"], 3)

    def test_failed_clippy_diagnostics_cleanup_failure_stops_new_work_with_partial_inventory(self):
        selection, summary = self.diagnostic_fixture(["er-a", "er-b"])
        def wait(timeout):
            raise subprocess.TimeoutExpired("cargo", timeout)
        with patch.object(self.feedback.subprocess, "Popen", return_value=SimpleNamespace(pid=12345, wait=wait)) as spawn, \
                patch.object(self.feedback.os, "killpg", create=True):
            self.feedback.collect_clippy_failure_diagnostics(selection, summary)
        index = json.loads((self.compact / "clippy-diagnostics.json").read_text())
        self.assertEqual(index["stop_reason"], "cleanup-error")
        self.assertEqual([row[1] for row in index["packages"]], ["cleanup-error", "not-attempted"])
        spawn.assert_called_once()

    def test_failed_clippy_diagnostic_collection_error_cannot_replace_failure_or_execute_tests(self):
        self.configure_ai_damage_query_scope()
        self.changed = self.config["ai_damage_query_focus"]["paths"]
        self.ai_damage_query_binaries()
        self.clippy_codes["er-game"] = 1
        with patch.object(self.feedback, "collect_clippy_failure_diagnostics", side_effect=OSError("index unavailable")):
            code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("selected-packages-clippy exited 1", summary["first_failure"])
        self.assertIn("index unavailable", summary["clippy_diagnostic_collection_error"])
        self.assertEqual(self.executed, [])
        self.assertEqual(summary["tests"]["passed"], 0)

    def test_failed_clippy_diagnostic_inventory_and_index_are_bounded_without_heuristic_skips(self):
        names = ["er-" + str(index).zfill(2) + "-" + "a" * 42 for index in range(64)]
        selection, summary = self.diagnostic_fixture(names)
        self.feedback.collect_clippy_failure_diagnostics(selection, summary)
        raw = (self.compact / "clippy-diagnostics.json").read_bytes()
        self.assertLessEqual(len(raw), 16000)
        self.assertEqual([row[0] for row in json.loads(raw)["packages"]], names)
        self.assertEqual(summary["clippy_failure_diagnostics"]["attempted"], 64)
        for packages in (["er-a", "er-a"], ["../other"], ["er-a"] * 65, []):
            with patch.object(self.feedback.subprocess, "Popen") as spawn, self.assertRaises(RuntimeError):
                self.feedback.collect_clippy_failure_diagnostics({"packages": packages}, summary)
            spawn.assert_not_called()

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

    def configure_browser_cache_scope(self):
        self.configure_browser_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["browser_cache_focus"] = policy["browser_cache_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for package in policy["browser_cache_focus"]["execute"]:
            self.package(package)
        self.package("er-reverse", '[dependencies]\ner-web = { path = "../er-web" }\n')

    def test_browser_cache_scope_requires_five_transactions_and_all_current_witnesses(self):
        self.configure_browser_cache_scope()
        self.changed = ["rust/crates/er-web/src/host_v2.rs", "docs/plans/rust-kernel/m9e-browser-cache-next.md"]
        selection = self.feedback.plan()
        self.assertTrue(selection["browser_cache_focus"])
        self.assertFalse(selection["timer_focus"])
        self.assertIsNone(selection["timer_mutant"])
        self.assertIsNone(selection["replica_mutant"])
        for flag in ("requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable",
                     "requires_cli_clippy", "requires_agent_protocol_clippy"):
            self.assertTrue(selection[flag], flag)
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        for package in ("er-batch", "er-env", "er-cli", "er-agent-protocol", "er-repro", "er-web", "er-kernel-worker"):
            self.assertEqual(selection["execution_scope"][package], ["*"])
        exact = selection["required_native_test_ids"]
        for identity, count in (("er-web:er_web", 5), ("er-web:m9e_host_v2", 14),
                                ("er-batch:m9e_current_batch", 6), ("er-cli:m9e_current_batch", 2),
                                ("er-agent-protocol:er_agent_protocol", 5), ("er-repro:m9e_current_repro", 9),
                                ("er-cli:m9e_current_repro", 2), ("er-cli:m9e_current_reload", 2),
                                ("er-wasm:m9e_parity", 2)):
            self.assertEqual(len(exact[identity]), count)
            crate, target = identity.split(":")
            self.assertIn(target, selection["required_native_targets"][crate])
        prefix = "host_v2::transaction_tests::"
        self.assertEqual(set(exact["er-web:er_web"]), {prefix + name for name in (
            "late_response_limit_rejection_preserves_state_cache_and_retry",
            "read_only_response_limit_failure_preserves_capture",
            "sequence_exhaustion_preflight_preserves_current_session_and_cached_response",
            "retained_response_byte_boundary_evicts_by_acceptance_and_preserves_retry",
            "single_response_cache_boundary_rejects_before_commit_and_disposal_clears_payloads")})

    def test_browser_cache_rejects_mixed_paths_without_expanding_readiness(self):
        self.configure_browser_cache_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["timer_focus"] = policy["timer_focus"]
        self.package("er-kernel")
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-web/tests/m9e_host_v2.rs", "rust/crates/er-web/src/contracts_v2.rs",
                      "rust/crates/er-web/Cargo.toml", "rust/crates/er-cli/src/current_agent.rs", "rust/Cargo.lock",
                      "test/browser/rust-browser/m9e-v7-corrective.spec.ts", "unknown.json"):
            with self.subTest(extra=extra):
                self.changed = ["rust/crates/er-web/src/host_v2.rs", extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
                rejected = json.loads((self.full / "plan.json").read_text())
                self.assertFalse(rejected["browser_cache_focus"])
        self.changed = ["docs/plans/rust-kernel/m9e-browser-cache-next.md", "scripts/ci/m9e_feedback.py"]
        readiness = self.feedback.plan()
        self.assertFalse(readiness["browser_cache_focus"])
        self.assertEqual(readiness["packages"], self.config["readiness_packages"])
        self.assertIsNone(readiness["execution_scope"])
        for flag in ("requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable"):
            self.assertFalse(readiness[flag])

    def test_browser_cache_missing_transaction_or_consumer_cannot_qualify(self):
        self.configure_browser_cache_scope()
        self.changed = ["rust/crates/er-web/src/host_v2.rs"]
        selection = self.feedback.plan()
        required = selection["required_native_test_ids"]
        inventory = [(identity.split(":")[0], identity.split(":")[1], ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, inventory)
        for identity in required:
            for omit_target in (True, False):
                with self.subTest(identity=identity, omit_target=omit_target):
                    reduced = [(crate, target, ids[:-1] if f"{crate}:{target}" == identity else ids)
                               for crate, target, ids in inventory if not omit_target or f"{crate}:{target}" != identity]
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(required, reduced)
        targets = selection["required_native_targets"]
        rows = [(crate, target, ["witness"]) for crate, names in targets.items() for target in names]
        self.feedback.required_native_target_counts(targets, rows)
        for index in range(len(rows)):
            with self.assertRaisesRegex(RuntimeError, "required native witness"):
                self.feedback.required_native_target_counts(targets, rows[:index] + rows[index + 1:])

    def test_browser_cache_orchestration_keeps_full_discovery_early_lint_and_bindings(self):
        self.configure_browser_cache_scope()
        self.changed = ["rust/crates/er-web/src/host_v2.rs"]
        policy = self.config["browser_cache_focus"]
        self.binary_ids = {}
        for crate, names in policy["execute"].items():
            if names == ["*"]:
                names = policy["required_targets"].get(crate, [crate.replace("-", "_")])
            for target in names:
                binary = target if target not in self.binary_ids else crate + "--" + target
                self.binary_ids[binary] = policy["exact_test_ids"].get(f"{crate}:{target}", ["behavior"])
                self.binary_crates[binary] = crate
                self.binary_targets[binary] = target
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(summary["required_native_target_counts"]["er-web:er_web"], 5)
        self.assertEqual(summary["required_native_target_counts"]["er-web:m9e_host_v2"], 14)
        self.assertEqual([(self.binary_crates[name], self.binary_targets[name]) for name in self.executed[:3]],
                         [("er-web", "er_web"), ("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_reload")])
        first_execution = self.events.index("execute:er_web")
        self.assertLess(max(index for index, event in enumerate(self.events) if event.startswith("list:")), self.events.index("clippy"))
        for index, event in enumerate(self.events):
            if event.startswith("clippy:"):
                self.assertLess(index, first_execution)
        for lint in ("cli-clippy", "agent-protocol-clippy", "er-batch-clippy", "er-env-clippy", "er-repro-clippy",
                     "worker-clippy", "endpoint-clippy", "browser-clippy"):
            self.assertIn(lint, summary["timing_ms"])
        for name, _, env in self.binary_envs:
            if (self.binary_crates[name], self.binary_targets.get(name, name)) in self.feedback.WORKER_BOUND_TARGETS:
                self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
            else:
                self.assertIsNone(env)
        self.assertEqual(summary["cli_executable"]["source_sha"], CANDIDATE)
        wasm.assert_called_once()
        browser.assert_called_once()
        self.binary_ids["er_web"] = self.binary_ids["er_web"][:-1]
        self.executed.clear()
        self.events.clear()
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("required native test identities", summary["first_failure"])
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)

    def configure_current_validation_scope(self):
        self.configure_browser_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["current_validation_focus"] = policy["current_validation_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for package in policy["current_validation_focus"]["execute"]:
            self.package(package)
        self.package("er-reverse", '[dependencies]\ner-cli = { path = "../er-cli" }\n')

    def test_current_validation_scope_requires_two_validators_and_all_current_witnesses(self):
        self.configure_current_validation_scope()
        self.changed = self.config["current_validation_focus"]["paths"] + ["docs/plans/rust-kernel/m9e-current-validation-next.md"]
        selection = self.feedback.plan()
        self.assertTrue(selection["current_validation_focus"])
        self.assertFalse(selection["timer_focus"])
        self.assertIsNone(selection["timer_mutant"])
        self.assertIsNone(selection["replica_mutant"])
        for flag in ("requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable",
                     "requires_cli_clippy", "requires_agent_protocol_clippy"):
            self.assertTrue(selection[flag], flag)
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        for package in ("er-batch", "er-env", "er-cli", "er-agent-protocol", "er-repro", "er-web", "er-kernel-worker"):
            self.assertEqual(selection["execution_scope"][package], ["*"])
        exact = selection["required_native_test_ids"]
        for identity, count in (("er-web:er_web", 5), ("er-cli:m9e_current_validation", 2), ("er-web:m9e_host_v2", 14),
                                ("er-batch:m9e_current_batch", 6), ("er-cli:m9e_current_batch", 2),
                                ("er-agent-protocol:er_agent_protocol", 5), ("er-repro:m9e_current_repro", 9),
                                ("er-cli:m9e_current_repro", 2), ("er-cli:m9e_current_reload", 2),
                                ("er-wasm:m9e_parity", 2)):
            self.assertEqual(len(exact[identity]), count)
            crate, target = identity.split(":")
            self.assertIn(target, selection["required_native_targets"][crate])
        prefix = "host_v2::transaction_tests::"
        self.assertEqual(set(exact["er-web:er_web"]), {prefix + name for name in (
            "late_response_limit_rejection_preserves_state_cache_and_retry",
            "read_only_response_limit_failure_preserves_capture",
            "sequence_exhaustion_preflight_preserves_current_session_and_cached_response",
            "retained_response_byte_boundary_evicts_by_acceptance_and_preserves_retry",
            "single_response_cache_boundary_rejects_before_commit_and_disposal_clears_payloads")})
        self.assertEqual(set(exact["er-cli:m9e_current_validation"]), {
            "ordinary_validate_save_accepts_v2_and_rejects_legacy_or_wrong_content",
            "ordinary_capsule_validation_replays_current_and_rejects_tampered_or_legacy_input"})

    def test_current_validation_rejects_mixed_paths_without_expanding_readiness(self):
        self.configure_current_validation_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["timer_focus"] = policy["timer_focus"]
        self.package("er-kernel")
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-web/tests/m9e_host_v2.rs", "rust/crates/er-web/src/contracts_v2.rs",
                      "rust/crates/er-web/Cargo.toml", "rust/crates/er-cli/src/current_agent.rs", "rust/Cargo.lock",
                      "test/browser/rust-browser/m9e-v7-corrective.spec.ts", "unknown.json"):
            with self.subTest(extra=extra):
                self.changed = ["rust/crates/er-cli/tests/m9e_current_validation.rs", extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
                rejected = json.loads((self.full / "plan.json").read_text())
                self.assertFalse(rejected["current_validation_focus"])
        # main.rs is shared by prior cuts; the unique validator witness activates
        # this cumulative scope without changing ordinary utility planning.
        self.changed = ["rust/crates/er-cli/src/main.rs", "rust/crates/er-cli/src/current_commands.rs"]
        ordinary = self.feedback.plan()
        self.assertFalse(ordinary["current_validation_focus"])
        self.assertEqual(ordinary["execution_scope"], self.config["current_session_focus"]["execute"])
        self.assertFalse(ordinary["requires_browser"])
        self.changed = ["docs/plans/rust-kernel/m9e-current-validation-next.md", "scripts/ci/m9e_feedback.py"]
        readiness = self.feedback.plan()
        self.assertFalse(readiness["current_validation_focus"])
        self.assertEqual(readiness["packages"], self.config["readiness_packages"])
        self.assertIsNone(readiness["execution_scope"])
        for flag in ("requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable"):
            self.assertFalse(readiness[flag])

    def test_current_validation_missing_validator_or_consumer_cannot_qualify(self):
        self.configure_current_validation_scope()
        self.changed = ["rust/crates/er-cli/tests/m9e_current_validation.rs"]
        selection = self.feedback.plan()
        required = selection["required_native_test_ids"]
        inventory = [(identity.split(":")[0], identity.split(":")[1], ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, inventory)
        for identity in required:
            for omit_target in (True, False):
                with self.subTest(identity=identity, omit_target=omit_target):
                    reduced = [(crate, target, ids[:-1] if f"{crate}:{target}" == identity else ids)
                               for crate, target, ids in inventory if not omit_target or f"{crate}:{target}" != identity]
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(required, reduced)
        targets = selection["required_native_targets"]
        rows = [(crate, target, ["witness"]) for crate, names in targets.items() for target in names]
        self.feedback.required_native_target_counts(targets, rows)
        for index in range(len(rows)):
            with self.assertRaisesRegex(RuntimeError, "required native witness"):
                self.feedback.required_native_target_counts(targets, rows[:index] + rows[index + 1:])

    def test_current_validation_orchestration_keeps_full_discovery_early_lint_and_bindings(self):
        self.configure_current_validation_scope()
        self.changed = ["rust/crates/er-cli/tests/m9e_current_validation.rs"]
        policy = self.config["current_validation_focus"]
        self.binary_ids = {}
        for crate, names in policy["execute"].items():
            if names == ["*"]:
                names = policy["required_targets"].get(crate, [crate.replace("-", "_")])
            for target in names:
                binary = target if target not in self.binary_ids else crate + "--" + target
                self.binary_ids[binary] = policy["exact_test_ids"].get(f"{crate}:{target}", ["behavior"])
                self.binary_crates[binary] = crate
                self.binary_targets[binary] = target
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(summary["required_native_target_counts"]["er-web:er_web"], 5)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_validation"], 2)
        self.assertEqual(len(summary["required_native_target_counts"]), 17)
        self.assertEqual(summary["required_native_target_counts"]["er-web:m9e_host_v2"], 14)
        self.assertEqual([(self.binary_crates[name], self.binary_targets[name]) for name in self.executed[:2]],
                         [("er-cli", "m9e_current_validation"), ("er-cli", "m9e_current_reload")])
        first_execution = self.events.index("execute:m9e_current_validation")
        self.assertLess(max(index for index, event in enumerate(self.events) if event.startswith("list:")), self.events.index("clippy"))
        for index, event in enumerate(self.events):
            if event.startswith("clippy:"):
                self.assertLess(index, first_execution)
        for lint in ("cli-clippy", "agent-protocol-clippy", "er-batch-clippy", "er-env-clippy", "er-repro-clippy",
                     "worker-clippy", "endpoint-clippy", "browser-clippy"):
            self.assertIn(lint, summary["timing_ms"])
        for name, _, env in self.binary_envs:
            if (self.binary_crates[name], self.binary_targets.get(name, name)) in self.feedback.WORKER_BOUND_TARGETS:
                self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
            else:
                self.assertIsNone(env)
        self.assertEqual(summary["cli_executable"]["source_sha"], CANDIDATE)
        self.assertNotIn(("er-cli", "m9e_current_validation"), self.feedback.WORKER_BOUND_TARGETS)
        wasm.assert_called_once()
        browser.assert_called_once()
        self.binary_ids["m9e_current_validation"] = self.binary_ids["m9e_current_validation"][:-1]
        self.executed.clear()
        self.events.clear()
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("required native test identities", summary["first_failure"])
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)

    def configure_native_capture_scope(self):
        self.configure_browser_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["native_capture_focus"] = policy["native_capture_focus"]
        for scope in ("current_repro_focus", "current_batch_focus", "cli_reload_focus", "timer_focus",
                      "browser_cache_focus", "current_validation_focus", "material_retention_focus"):
            self.config[scope] = policy[scope]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-game")
        for package in policy["native_capture_focus"]["execute"]:
            self.package(package)
        self.package("er-reverse", '[dependencies]\ner-repro = { path = "../er-repro" }\ner-agent-protocol = { path = "../er-agent-protocol" }\n')

    def test_native_capture_scope_requires_four_captures_and_all_current_witnesses(self):
        self.configure_native_capture_scope()
        policy = self.config["native_capture_focus"]
        expected_paths = {
            "rust/crates/er-cli/src/current_agent.rs", "rust/crates/er-cli/src/main.rs",
            "rust/crates/er-cli/src/current_commands.rs", "rust/crates/er-cli/src/current_native_capture.rs",
            "rust/crates/er-repro/src/current.rs", "rust/crates/er-agent-protocol/src/lib.rs",
            "rust/crates/er-cli/tests/m9e_current_native_capture.rs"}
        self.assertEqual(set(policy["paths"]), expected_paths)
        self.assertEqual(len(policy["paths"]), 7)
        self.assertEqual(set(policy["trigger_paths"]), {
            "rust/crates/er-cli/src/current_native_capture.rs",
            "rust/crates/er-cli/tests/m9e_current_native_capture.rs"})
        self.changed = self.config["native_capture_focus"]["paths"] + ["docs/plans/rust-kernel/m9e-native-capture-next.md"]
        selection = self.feedback.plan()
        self.assertTrue(selection["native_capture_focus"])
        self.assertFalse(selection["timer_focus"])
        self.assertIsNone(selection["timer_mutant"])
        self.assertIsNone(selection["replica_mutant"])
        for flag in ("requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable",
                     "requires_cli_clippy", "requires_agent_protocol_clippy"):
            self.assertTrue(selection[flag], flag)
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        for package in ("er-batch", "er-env", "er-cli", "er-agent-protocol", "er-repro", "er-web", "er-kernel-worker"):
            self.assertEqual(selection["execution_scope"][package], ["*"])
        exact = selection["required_native_test_ids"]
        for identity, count in (("er-web:er_web", 5), ("er-cli:m9e_current_native_capture", 4), ("er-cli:m9e_current_validation", 2), ("er-web:m9e_host_v2", 14),
                                ("er-batch:m9e_current_batch", 6), ("er-cli:m9e_current_batch", 2),
                                ("er-agent-protocol:er_agent_protocol", 5), ("er-repro:m9e_current_repro", 9),
                                ("er-cli:m9e_current_repro", 2), ("er-cli:m9e_current_reload", 2),
                                ("er-wasm:m9e_parity", 2)):
            self.assertEqual(len(exact[identity]), count)
            crate, target = identity.split(":")
            self.assertIn(target, selection["required_native_targets"][crate])
        prefix = "host_v2::transaction_tests::"
        self.assertEqual(set(exact["er-web:er_web"]), {prefix + name for name in (
            "late_response_limit_rejection_preserves_state_cache_and_retry",
            "read_only_response_limit_failure_preserves_capture",
            "sequence_exhaustion_preflight_preserves_current_session_and_cached_response",
            "retained_response_byte_boundary_evicts_by_acceptance_and_preserves_retry",
            "single_response_cache_boundary_rejects_before_commit_and_disposal_clears_payloads")})
        self.assertEqual(set(exact["er-cli:m9e_current_native_capture"]), {
            "actual_native_capture_replays_natural_events_rejections_and_imported_history",
            "actual_native_capture_rotation_fork_restore_and_byte_gaps_are_explicit",
            "actual_native_capture_late_response_and_rejected_ingress_preserve_gameplay",
            "actual_native_capture_browser_import_declares_native_suffix_at_original_frontier"})
        protocol = {
            "response_context_tests::inline_success_boundary_counts_escaping_nulls_and_newline",
            "response_context_tests::contextual_server_rejects_before_mutation_and_accepts_corrected_retry",
            "response_context_tests::default_context_preserves_historical_artifact_dispatch",
            "ingress_diagnostic_tests::default_ingress_hook_preserves_legacy_responses_and_immutable_oversized_api",
            "ingress_diagnostic_tests::rejected_ingress_hook_distinguishes_addressable_and_discarded_requests"}
        self.assertEqual(set(exact["er-agent-protocol:er_agent_protocol"]), protocol)
        for scope in ("current_batch_focus", "timer_focus", "browser_cache_focus", "current_validation_focus"):
            self.assertEqual(set(self.config[scope]["exact_test_ids"]["er-agent-protocol:er_agent_protocol"]), protocol)
        for scope in ("current_repro_focus", "current_batch_focus", "current_validation_focus", "browser_cache_focus"):
            self.assertFalse(selection[scope])
        for trigger in self.config["native_capture_focus"]["trigger_paths"]:
            self.changed = [trigger]
            trigger_only = self.feedback.plan()
            self.assertTrue(trigger_only["native_capture_focus"])
            self.assertEqual(trigger_only["required_native_test_ids"], exact)
            self.changed = [trigger, "rust/crates/er-cli/src/current_commands.rs"]
            replay_fix = self.feedback.plan()
            self.assertTrue(replay_fix["native_capture_focus"])
            self.assertEqual(replay_fix["required_native_test_ids"], exact)

    def test_native_capture_rejects_mixed_paths_without_expanding_readiness(self):
        self.configure_native_capture_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["timer_focus"] = policy["timer_focus"]
        self.package("er-kernel")
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-web/tests/m9e_host_v2.rs", "rust/crates/er-web/src/contracts_v2.rs",
                      "rust/crates/er-web/Cargo.toml", "rust/crates/er-cli/Cargo.toml", "rust/crates/er-cli/src/current_commands_extra.rs", "rust/Cargo.lock",
                      "rust/crates/er-repro/src/lib.rs", "rust/crates/er-agent-protocol/tests/unmapped.rs",
                      "rust/crates/er-game/src/m9e_material_v6.rs", "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs",
                      "rust/crates/er-cli/tests/m9e_current_validation.rs", "rust/crates/er-batch/src/current.rs",
                      "test/browser/rust-browser/m9e-v7-corrective.spec.ts", "unknown.json"):
            with self.subTest(extra=extra):
                self.changed = ["rust/crates/er-cli/tests/m9e_current_native_capture.rs", extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
                rejected = json.loads((self.full / "plan.json").read_text())
                self.assertFalse(rejected["native_capture_focus"])
        # main.rs is shared by prior cuts; the unique capture helper or witness activates
        # this cumulative scope without changing ordinary utility planning.
        self.changed = ["rust/crates/er-cli/src/main.rs", "rust/crates/er-cli/src/current_commands.rs"]
        ordinary = self.feedback.plan()
        self.assertFalse(ordinary["native_capture_focus"])
        self.assertEqual(ordinary["execution_scope"], self.config["current_session_focus"]["execute"])
        self.assertFalse(ordinary["requires_browser"])
        self.changed = ["docs/plans/rust-kernel/m9e-native-capture-next.md", "scripts/ci/m9e_feedback.py"]
        readiness = self.feedback.plan()
        self.assertFalse(readiness["native_capture_focus"])
        self.assertEqual(readiness["packages"], self.config["readiness_packages"])
        self.assertIsNone(readiness["execution_scope"])
        for flag in ("requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable"):
            self.assertFalse(readiness[flag])

    def test_native_capture_missing_capture_or_consumer_cannot_qualify(self):
        self.configure_native_capture_scope()
        self.changed = ["rust/crates/er-cli/tests/m9e_current_native_capture.rs",
                        "rust/crates/er-cli/src/current_commands.rs"]
        selection = self.feedback.plan()
        required = selection["required_native_test_ids"]
        inventory = [(identity.split(":")[0], identity.split(":")[1], ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, inventory)
        for identity in required:
            for omit_target in (True, False):
                with self.subTest(identity=identity, omit_target=omit_target):
                    reduced = [(crate, target, ids[:-1] if f"{crate}:{target}" == identity else ids)
                               for crate, target, ids in inventory if not omit_target or f"{crate}:{target}" != identity]
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(required, reduced)
        for identity in ("er-cli:m9e_current_native_capture", "er-agent-protocol:er_agent_protocol"):
            for missing_id in required[identity]:
                with self.subTest(identity=identity, missing_id=missing_id):
                    reduced = [(crate, target, [value for value in ids if value != missing_id]
                                if f"{crate}:{target}" == identity else ids) for crate, target, ids in inventory]
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(required, reduced)
        targets = selection["required_native_targets"]
        rows = [(crate, target, ["witness"]) for crate, names in targets.items() for target in names]
        self.feedback.required_native_target_counts(targets, rows)
        for index in range(len(rows)):
            with self.assertRaisesRegex(RuntimeError, "required native witness"):
                self.feedback.required_native_target_counts(targets, rows[:index] + rows[index + 1:])

    def test_native_capture_orchestration_keeps_full_discovery_early_lint_and_bindings(self):
        self.configure_native_capture_scope()
        self.changed = self.config["native_capture_focus"]["paths"]
        policy = self.config["native_capture_focus"]
        self.assertIn("rust/crates/er-cli/src/current_commands.rs", self.changed)
        self.binary_ids = {}
        for crate, names in policy["execute"].items():
            if names == ["*"]:
                names = policy["required_targets"].get(crate, [crate.replace("-", "_")])
            for target in names:
                binary = target if target not in self.binary_ids else crate + "--" + target
                self.binary_ids[binary] = policy["exact_test_ids"].get(f"{crate}:{target}", ["behavior"])
                self.binary_crates[binary] = crate
                self.binary_targets[binary] = target
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(summary["required_native_target_counts"]["er-web:er_web"], 5)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_native_capture"], 4)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_validation"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-agent-protocol:er_agent_protocol"], 5)
        self.assertEqual(len(summary["required_native_target_counts"]), 18)
        self.assertEqual(summary["required_native_target_counts"]["er-web:m9e_host_v2"], 14)
        self.assertEqual([(self.binary_crates[name], self.binary_targets[name]) for name in self.executed[:2]],
                         [("er-cli", "m9e_current_native_capture"), ("er-cli", "m9e_current_reload")])
        first_execution = self.events.index("execute:m9e_current_native_capture")
        self.assertLess(max(index for index, event in enumerate(self.events) if event.startswith("list:")), self.events.index("clippy"))
        for index, event in enumerate(self.events):
            if event.startswith("clippy:"):
                self.assertLess(index, first_execution)
        for lint in ("cli-clippy", "agent-protocol-clippy", "er-batch-clippy", "er-env-clippy", "er-repro-clippy",
                     "worker-clippy", "endpoint-clippy", "browser-clippy"):
            self.assertIn(lint, summary["timing_ms"])
        for name, _, env in self.binary_envs:
            if (self.binary_crates[name], self.binary_targets.get(name, name)) in self.feedback.WORKER_BOUND_TARGETS:
                self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
            else:
                self.assertIsNone(env)
        self.assertEqual(summary["cli_executable"]["source_sha"], CANDIDATE)
        self.assertNotIn(("er-cli", "m9e_current_native_capture"), self.feedback.WORKER_BOUND_TARGETS)
        wasm.assert_called_once()
        browser.assert_called_once()
        self.binary_ids["m9e_current_native_capture"] = self.binary_ids["m9e_current_native_capture"][:-1]
        self.executed.clear()
        self.events.clear()
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("required native test identities", summary["first_failure"])
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)

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
                           "er-agent-protocol:er_agent_protocol": 5,
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

    def configure_browser_worker_scope(self):
        self.configure_timer_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["current_browser_worker_focus"]
        self.config["current_browser_worker_focus"] = policy
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for path in policy["paths"]:
            source = self.root / path
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("source fixture: " + path)
        (self.root / "pnpm-lock.yaml").write_text("frozen synthetic browser lock\n")
        self.changed = list(policy["paths"])

    def test_browser_worker_scope_preserves_causal_inventory_and_source_binding(self):
        self.configure_browser_worker_scope()
        import m9e_phases as phases
        expected_paths = ["src/rust-browser/contracts/browser-contracts-v2.ts", "src/rust-browser/worker/rust-wasm-loader.ts",
                          "src/rust-browser/worker/current-rust-kernel-worker.ts", "src/rust-browser/host/current-rust-browser-host.ts",
                          "src/rust-browser/routes/rust-current-worker-entry.ts", "test/browser/rust-browser/m9e-v7-worker.spec.ts",
                          "test/node/rust-browser/engineering/current-worker-codec.test.ts",
                          "scripts/build-kernel-m9e-v7-web.mjs"]
        self.assertEqual(self.config["current_browser_worker_focus"]["paths"], expected_paths)
        for changed in (expected_paths, expected_paths[2:3], expected_paths[-1:]):
            with self.subTest(changed=changed):
                self.changed = changed
                selection = self.feedback.plan()
                for flag in ("requires_browser_worker", "timer_focus", "requires_browser", "requires_wasm",
                             "requires_cli_executable", "requires_worker_executable", "requires_cli_clippy", "requires_agent_protocol_clippy"):
                    self.assertTrue(selection[flag], flag)
                self.assertEqual(selection["required_native_test_ids"], self.config["timer_focus"]["exact_test_ids"])
                self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 22)
                self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_timers_v7"]), 11)
                self.assertIn("er-reverse", selection["packages"])
                self.assertNotIn("er-reverse", selection["execution_scope"])
                self.assertEqual(selection["execution_scope"], self.config["timer_focus"]["execute"])
                self.assertEqual(selection["browser_worker_binding"], phases.browser_worker_source_binding(self.root, CANDIDATE))
                self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
                self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
                self.assertIsNone(selection["ledger_mutant"])

        # The capability remains required after its introduction, even with no
        # Worker file in a later cumulative current-kernel delta.
        self.changed = ["rust/crates/er-kernel/src/game_kernel_v7.rs"]
        future = self.feedback.plan()
        self.assertTrue(future["requires_browser"])
        self.assertTrue(future["requires_browser_worker"])
        self.assertEqual(future["browser_worker_binding"], phases.browser_worker_source_binding(self.root, CANDIDATE))
        self.assertEqual(future["required_native_test_ids"], self.config["timer_focus"]["exact_test_ids"])
        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        with patch.object(phases, "browser_worker_source_binding", side_effect=AssertionError("readiness must not bind Worker sources")):
            readiness = self.feedback.plan()
        self.assertEqual(readiness["packages"], ["er-canonical"])
        self.assertFalse(readiness["requires_browser"])
        self.assertFalse(readiness["requires_browser_worker"])
        self.assertIsNone(readiness["browser_worker_binding"])

    def test_browser_worker_scope_rejects_mixed_unknown_dependencies_and_policy_drift(self):
        self.configure_browser_worker_scope()
        entry = "src/rust-browser/routes/rust-current-worker-entry.ts"
        for extra in ("src/rust-browser/routes/rust-current-worker-entry-extra.ts", "src/rust-browser/worker/rust-kernel-worker.ts",
                      "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/Cargo.lock", "pnpm-lock.yaml", "package.json",
                      "test/browser/rust-browser/other.spec.ts", "scripts/build-other.mjs"):
            with self.subTest(extra=extra):
                self.changed = [entry, extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
        self.config["current_browser_worker_focus"]["paths"].append("unmapped.json")
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        with self.assertRaisesRegex(RuntimeError, "policy identities"):
            self.feedback.plan()
        self.assertEqual(self.executed, [])

    def test_browser_worker_report_requires_two_real_single_attempt_witnesses(self):
        import m9e_phases as phases
        binding, assets, tests, _ = browser_worker_fixture(phases)
        report = browser_worker_report(tests)
        self.assertEqual(self.feedback.browser_worker_result_evidence(report, assets, binding), tests)
        bad_reports = []
        missing = copy.deepcopy(report)
        missing["suites"][0]["specs"].pop()
        bad_reports.append(missing)
        for field, value in (("title", "renamed Worker witness"), ("file", "m9e-v7-corrective.spec.ts")):
            changed = copy.deepcopy(report)
            changed["suites"][0]["specs"][0][field] = value
            bad_reports.append(changed)
        for field, value in (("projectName", "firefox"), ("status", "flaky"), ("expectedStatus", "skipped")):
            changed = copy.deepcopy(report)
            changed["suites"][0]["specs"][0]["tests"][0][field] = value
            bad_reports.append(changed)
        for field, value in (("retry", 1), ("retry", False), ("status", "skipped")):
            changed = copy.deepcopy(report)
            changed["suites"][0]["specs"][0]["tests"][0]["results"][0][field] = value
            bad_reports.append(changed)
        duplicate = copy.deepcopy(report)
        duplicate["suites"][0]["specs"].append(copy.deepcopy(duplicate["suites"][0]["specs"][0]))
        bad_reports.append(duplicate)
        for report in bad_reports:
            with self.subTest(report=report), self.assertRaises(RuntimeError):
                self.feedback.browser_worker_result_evidence(report, assets, binding)

    def test_browser_worker_attachments_are_bounded_bound_and_causal(self):
        import m9e_phases as phases
        binding, assets, tests, _ = browser_worker_fixture(phases)
        for key, field, value in (("positive", "manifest_sha256", "0" * 64), ("positive", "observed_worker_count", 0),
                                  ("positive", "held_cursor", ["battle/command/party"] * 3),
                                  ("positive", "settled_presentation_count", 2), ("positive", "accepted_sequence", True),
                                  ("positive", "rejection_preserved_snapshot", False),
                                  ("positive", "authority_material_count", 0), ("positive", "authority_material_count", True),
                                  ("positive", "authority_material_count", 65),
                                  ("negative", "settled_after_termination", 1), ("negative", "pending_after", 1),
                                  ("negative", "accepted_sequence", 1), ("negative", "post_termination_rejected", False)):
            bad = copy.deepcopy(tests)
            bad[key][field] = value
            with self.subTest(key=key, field=field), self.assertRaises(RuntimeError):
                self.feedback.browser_worker_result_evidence(browser_worker_report(bad), assets, binding)
        for mutation in ("missing", "duplicate", "misplaced", "oversized", "outside"):
            report = browser_worker_report(tests)
            attachments = report["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"]
            if mutation == "missing":
                attachments.clear()
            elif mutation == "duplicate":
                attachments.append(copy.deepcopy(attachments[0]))
            elif mutation == "misplaced":
                attachments[0]["name"] = "m9e-current-worker-negative"
            elif mutation == "oversized":
                attachments[0]["body"] = base64.b64encode(b" " * 4097).decode()
            else:
                outside = self.root / "outside.json"
                outside.write_text(json.dumps(tests["positive"]))
                attachments[0].pop("body")
                attachments[0]["path"] = str(outside)
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                self.feedback.browser_worker_result_evidence(report, assets, binding)

    def test_browser_worker_build_rehashes_exact_sources_assets_and_installed_version(self):
        self.configure_browser_worker_scope()
        import m9e_phases as phases
        selection = self.feedback.plan()
        _, assets, _, cohort = browser_worker_fixture(phases)
        manifest = assets["manifest"]
        binding = selection["browser_worker_binding"]
        manifest.update({"source_hashes": binding["source_hashes"], "pnpm_lock_sha256": binding["pnpm_lock_sha256"],
                         "builder_sha256": binding["source_hashes"][phases.WORKER_SOURCE_PATHS[-1]]})
        output = self.root / "web-output"
        output.mkdir()
        (output / manifest["entry"]).write_bytes(b"entry")
        (output / manifest["worker"]).write_bytes(b"worker")
        (output / "m9e-v7-worker-assets.json").write_bytes(phases.encoded(manifest))
        package = self.root / "node_modules/vite/package.json"
        package.parent.mkdir(parents=True)
        package.write_text('{"version":"8.0.10"}')
        summary = {"product_sha": CANDIDATE, "plan": selection, "browser_assets": {"assets": cohort}}
        self.feedback.verify_browser_worker_build(output, summary)
        self.assertEqual(summary["browser_worker_assets"]["manifest"], manifest)
        (output / manifest["worker"]).write_bytes(b"tamper")
        with self.assertRaisesRegex(RuntimeError, "asset hash"):
            self.feedback.verify_browser_worker_build(output, summary)
        (output / manifest["worker"]).write_bytes(b"worker")
        (output / "current-extra.js").write_bytes(b"unlisted")
        with self.assertRaisesRegex(RuntimeError, "unlisted"):
            self.feedback.verify_browser_worker_build(output, summary)
        (output / "current-extra.js").unlink()
        (self.root / phases.WORKER_SOURCE_PATHS[0]).write_text("wrong source")
        with self.assertRaisesRegex(RuntimeError, "checked-out source"):
            self.feedback.verify_browser_worker_build(output, summary)

    def test_browser_worker_codec_requires_all_three_exact_numeric_boundary_witnesses(self):
        import m9e_phases as phases
        report = {"success": True, "numTotalTests": 3, "numPassedTests": 3, "testResults": [{
            "name": "test/node/rust-browser/engineering/current-worker-codec.test.ts",
            "assertionResults": [{"fullName": name, "status": "passed"} for name in phases.WORKER_CODEC_IDS]}]}
        evidence = self.feedback.browser_worker_codec_evidence(report)
        phases.validate_browser_worker_codec(evidence)
        self.assertEqual(evidence["selected_test_ids"], ["current V2 canonical payload preserves signed state values",
                         "current V2 canonical payload rejects ambiguous numeric values",
                         "current V2 envelope keeps correlation IDs nonnegative"])
        for mutation in ("missing", "duplicate", "renamed", "skipped", "wrong_file", "false_success"):
            bad = copy.deepcopy(report)
            suite = bad["testResults"][0]
            if mutation == "missing":
                suite["assertionResults"].pop()
            elif mutation == "duplicate":
                suite["assertionResults"][0] = copy.deepcopy(suite["assertionResults"][1])
            elif mutation == "renamed":
                suite["assertionResults"][0]["fullName"] = "unrelated unit"
            elif mutation == "skipped":
                suite["assertionResults"][0]["status"] = "pending"
            elif mutation == "wrong_file":
                suite["name"] = "test/node/rust-browser/engineering/browser-effects-v2.test.ts"
            else:
                bad["success"] = False
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                self.feedback.browser_worker_codec_evidence(bad)

    def test_browser_worker_orchestration_adds_bundle_and_reports_without_replacing_old_bridge(self):
        self.configure_browser_worker_scope()
        import m9e_phases as phases
        summary = {"product_sha": CANDIDATE, "target": "x86_64-unknown-linux-gnu", "profile": "test",
                   "plan": self.feedback.plan()}
        summary["cli_executable"] = self.feedback.discover_cli_executable([self.cli_executable_artifact()], summary)
        _, bridge, _ = self.bridge_report()
        bridge["executable_sha256"] = summary["cli_executable"]["sha256"]
        old_report = self.bridge_report(bridge)[0]
        _, typed_report = self.browser_reports()
        binding, worker_assets, worker_tests, _ = browser_worker_fixture(phases)
        output = self.root / "runner/m9e-v7-web"
        output.mkdir(parents=True)
        old_assets = {}
        for name in ("er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json",
                     "coop-authority-snapshot.json", "coop-replica-snapshot.json"):
            path = output / name
            path.write_bytes(b"existing browser cohort")
            old_assets[name] = {"bytes": path.stat().st_size, "sha256": self.feedback.digest(path)}
        (output / "m9e-v7-web-assets.json").write_text(json.dumps({"source_sha": CANDIDATE,
            "assets": old_assets, "browser_worker_protocol_version": 2}))
        (self.rust / "rust-toolchain.toml").write_text('[toolchain]\nchannel = "1.97.1"\n')
        codec_report = {"success": True, "numTotalTests": 3, "numPassedTests": 3, "testResults": [{
            "name": "test/node/rust-browser/engineering/current-worker-codec.test.ts",
            "assertionResults": [{"fullName": name, "status": "passed"} for name in phases.WORKER_CODEC_IDS]}]}
        calls = []
        def run_browser(args, name, cwd=None, env=None):
            calls.append((name, list(args), dict(env) if env else None))
            reports = {"browser-journey": ("browser-results.json", old_report),
                       "browser-effects": ("browser-effect-results.json", typed_report),
                       "browser-worker-codec": ("browser-worker-codec-results.json", codec_report),
                       "browser-worker-journey": ("browser-worker-results.json", browser_worker_report(worker_tests))}
            if name in reports:
                filename, value = reports[name]
                (self.full / filename).write_text(json.dumps(value))
            return self.full / (name + ".log")
        def verified_build(directory, value):
            self.assertEqual(directory, output)
            value["browser_worker_assets"] = worker_assets
        # Asset/source admission has a separate filesystem/hash fault test above;
        # isolate only that step here to observe all existing and added commands.
        summary["plan"]["browser_worker_binding"] = binding
        with patch.dict(os.environ, {"RUNNER_TEMP": str(self.root / "runner")}), \
                patch.object(self.feedback, "run", side_effect=run_browser), \
                patch.object(self.feedback, "verify_browser_worker_build", side_effect=verified_build):
            self.feedback.browser_checks(summary)
        self.assertEqual(summary["browser_current_repro_bridge"], bridge)
        self.assertEqual(summary["browser_tests"]["chromium"]["passed"], 2)
        self.assertEqual(summary["browser_tests"]["typed_effects"]["passed"], 1)
        self.assertEqual(summary["browser_worker_tests"], worker_tests)
        self.assertEqual(summary["browser_worker_codec"]["passed"], 3)
        self.assertEqual([name for name, _, _ in calls], ["browser-dependencies", "browser-build", "browser-chromium-install",
                         "browser-journey", "browser-effects", "browser-worker-codec", "browser-worker-journey"])
        build_env = next(env for name, _, env in calls if name == "browser-build")
        self.assertEqual(build_env["M9E_BUILD_CURRENT_WORKER"], "1")
        for name, args, env in calls:
            if name in ("browser-journey", "browser-worker-journey"):
                self.assertIn("--workers=1", args)
                self.assertEqual(env["ER_M9E_CLI_SHA256"], bridge["executable_sha256"])
                self.assertIn("browser-worker-results" if name == "browser-worker-journey" else "browser-results",
                              env["PLAYWRIGHT_JSON_OUTPUT_FILE"])

    def configure_ai_damage_query_scope(self):
        self.configure_timer_scope()
        actual = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        for name in ("ai_damage_query_focus", "material_retention_focus", "current_batch_focus",
                     "native_capture_focus", "current_validation_focus", "browser_cache_focus", "current_repro_focus"):
            self.config[name] = actual[name]
        for crate in set(actual["ai_damage_query_focus"]["execute"]) | set(actual["ai_damage_query_focus"]["lint_repair_execute"]):
            self.package(crate)
        self.package("er-game", '[dependencies]\ner-battle = { path = "../er-battle" }\n')
        self.package("er-kernel", '[dependencies]\ner-game = { path = "../er-game" }\n')
        self.package("er-reverse", '[build-dependencies]\nquery = { package = "er-battle", path = "../er-battle" }\n')
        self.package("er-target-reverse", '[target.\'cfg(unix)\'.dev-dependencies]\nai = { package = "er-ai", path = "../er-ai" }\n')
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))

    def ai_damage_query_binaries(self, selection=None):
        policy = self.config["ai_damage_query_focus"]
        self.binary_ids = {}
        execution = selection["execution_scope"] if selection else policy["execute"]
        required = selection["required_native_targets"] if selection else policy["required_targets"]
        exact = selection["required_native_test_ids"] if selection else policy["exact_test_ids"]
        for crate, targets in execution.items():
            if targets == ["*"]:
                targets = required.get(crate, [crate.replace("-", "_")])
            for target in targets:
                binary = target if target not in self.binary_ids else crate + "--" + target
                self.binary_ids[binary] = exact.get(f"{crate}:{target}", ["behavior"])
                self.binary_crates[binary], self.binary_targets[binary] = crate, target
        # A real all-target discovery may include empty unit harnesses; run
        # those too, while retaining reverse consumers as compilation evidence.
        if selection is None:
            self.binary_ids["er_battle"] = []
        self.binary_crates["er_battle"] = "er-battle"
        self.binary_targets["er_battle"] = "er_battle"
        self.binary_ids["er_game"] = []
        self.binary_ids["reverse_compiled_only"] = ["reverse_build_witness"]
        self.binary_crates["reverse_compiled_only"] = "er-reverse"
        self.binary_targets["reverse_compiled_only"] = "reverse_compiled_only"
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))

    def test_ai_damage_query_scope_inherits_causal_inventory_and_adds_exact_source_witnesses(self):
        self.configure_ai_damage_query_scope()
        policy, causal = self.config["ai_damage_query_focus"], self.config["timer_focus"]
        paths = ["rust/crates/er-battle/src/m7_resolver.rs", "rust/crates/er-game/tests/m9e_damage_query.rs"]
        self.assertEqual(set(policy["paths"]), set(paths))
        self.assertEqual(set(policy["trigger_paths"]), set(paths))
        for changed in (paths, paths[:1], paths[1:]):
            with self.subTest(changed=changed):
                self.changed = changed
                selection = self.feedback.plan()
                for flag in ("ai_damage_query_focus", "timer_focus", "requires_wasm", "requires_browser",
                             "requires_cli_executable", "requires_worker_executable", "requires_cli_clippy",
                             "requires_agent_protocol_clippy"):
                    self.assertTrue(selection[flag], flag)
                self.assertFalse(selection["material_retention_focus"])
                self.assertIsNone(selection["ledger_mutant"])
                self.assertEqual(selection["timer_mutant"], causal["mutant"])
                self.assertEqual(selection["replica_mutant"], causal["replica_mutant"])
                self.assertEqual(selection["wasm_test"], "m9e_parity")
                self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 50)
                for field, configured in (("execution_scope", "execute"), ("required_native_targets", "required_targets"),
                                          ("required_native_test_ids", "exact_test_ids")):
                    for key, value in causal[configured].items():
                        self.assertEqual(selection[field][key], value, (field, key))
                self.assertEqual(set(selection["required_native_test_ids"]["er-game:m9e_damage_query"]), {
                    "current_damage_query_distinguishes_equal_power_by_physical_and_special_bulk",
                    "current_damage_queries_preserve_full_turn_and_rng_audit_after_reordering",
                    "current_damage_query_honors_pp_up_and_override_bounds_without_mutation",
                    "current_damage_query_zero_and_inactive_inputs_leave_state_unchanged"})
                self.assertEqual(set(selection["required_native_targets"]["er-battle"]), {
                    "m3_ability_pipeline", "m3_accuracy_critical", "m3_action_order", "m3_command_legality", "m3_damage",
                    "m3_faint_replacement", "m3_mechanics_properties", "m3_move_pipeline", "m3_oracle_differential",
                    "m3_presentation", "m3_status_stage", "m3_switch", "m3_turn_outcome", "m3_type_effectiveness",
                    "m5_executor", "m5_mechanic_sources", "m5_properties"})
                self.assertEqual(set(selection["required_native_targets"]["er-game"]), {
                    "m3_command_menus", "m3_internal_event_boundary", "m3_local_battle", "m3_party_menus", "m3_runtime",
                    "m9e_content_v2", "m9e_material_v6", "m9e_new_run_v6", "m9e_runtime_v6", "m9e_damage_query"})
                self.assertEqual(selection["required_native_targets"]["er-ai"], ["er_ai"])
                for crate in ("er-battle", "er-ai"):
                    self.assertEqual(selection["execution_scope"][crate], ["*"])
                self.assertIn("er_game", selection["execution_scope"]["er-game"])
                self.assertNotIn("m9e_material_retention", selection["execution_scope"]["er-game"])
                for reverse in ("er-reverse", "er-target-reverse"):
                    self.assertIn(reverse, selection["packages"])
                    self.assertNotIn(reverse, selection["execution_scope"])
                self.assertNotIn("m9e_current_rulechange_reload", selection["required_native_targets"]["er-cli"])
                self.assertIn(("er-cli", "m9e_current_rulechange_reload"), self.feedback.WORKER_BOUND_TARGETS)
                self.assertIsNone(selection["rule_worker"])

    def test_ai_damage_query_mixed_and_dependency_paths_fail_closed_without_changing_old_scopes(self):
        self.configure_ai_damage_query_scope()
        query = "rust/crates/er-battle/src/m7_resolver.rs"
        for extra in ("rust/crates/er-battle/src/m7_other.rs", "rust/crates/er-game/tests/m9e_damage_query_extra.rs",
                      "rust/crates/er-game/src/m9e_runtime_v6.rs", "rust/crates/er-game/src/m9e_material_v6.rs",
                      "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-ai/src/full_surface.rs",
                      "rust/crates/er-repro/src/current.rs", "rust/crates/er-batch/src/current.rs",
                      "rust/crates/er-web/src/host_v2.rs", "test/browser/rust-browser/m9e-v7-corrective.spec.ts",
                      "rust/crates/er-cli/tests/m9e_current_rulechange_reload.rs", "rust/Cargo.lock",
                      "rust/crates/er-battle/Cargo.toml", "rust/crates/er-game/Cargo.toml", "unknown.json"):
            with self.subTest(extra=extra):
                self.changed = [query, extra]
                with self.assertRaisesRegex(RuntimeError, "additional mapping"):
                    self.feedback.plan()
                rejected = json.loads((self.full / "plan.json").read_text())
                self.assertFalse(rejected["ai_damage_query_focus"])
                self.assertTrue(rejected["packages"])
        for scope, path in (("timer_focus", "rust/crates/er-kernel/src/game_kernel_v7.rs"),
                            ("material_retention_focus", "rust/crates/er-game/src/m9e_material_v6.rs")):
            self.changed = [path]
            old = self.feedback.plan()
            self.assertTrue(old[scope])
            self.assertFalse(old["ai_damage_query_focus"])
            self.assertEqual(old["execution_scope"], self.config[scope]["execute"])
            self.assertEqual(old["required_native_test_ids"], self.config[scope]["exact_test_ids"])
        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        self.assertEqual(self.feedback.plan()["packages"], ["er-canonical"])

    def ai_lint_repair_expected_scope(self):
        additions = {
            "er-battle": ["er_battle"],
            "er-content-compiler": ["er_content_compiler", "er-content-compiler", "m9e_bundle", "m9e_full_content", "m9e_progression"],
            "er-devplane": ["er_devplane"], "er-progression": ["er_progression"], "er-run": ["er_run"],
            "er-save": ["er_save"], "er-scenario": ["er_scenario"],
            "er-sim": ["er_sim", "m4_pair_snapshot_v3", "m4_raw_key_local"],
            "er-state": ["er_state", "m4_foundation_properties"],
            "er-testkit": ["m6_foundation", "m6_native_wasm", "m71_foundation", "m7_system_proof", "m6_solo_campaigns", "m6_field_parity", "m6_coop_campaigns", "m6_performance", "m6_ability_parity", "m6_item_parity", "m6_move_parity", "m6_species_form_parity", "m6_properties"],
            "er-wasm": ["er_wasm"], "er-world": ["er_world"],
        }
        empty = {"er-content-compiler", "er_devplane", "er_wasm", "er_world"}
        mandatory = {crate: [target for target in targets if target not in empty]
                     for crate, targets in additions.items() if any(target not in empty for target in targets)}
        policy = self.config["ai_damage_query_focus"]
        self.assertEqual(policy["lint_repair_execute"], additions)
        self.assertEqual(policy["lint_repair_required_targets"], mandatory)
        execution, required = copy.deepcopy(policy["execute"]), copy.deepcopy(policy["required_targets"])
        for destination, source in ((execution, additions), (required, mandatory)):
            for crate, targets in source.items():
                current = destination.setdefault(crate, [])
                if "*" not in current:
                    current.extend(target for target in targets if target not in current)
        return execution, required

    def test_ai_damage_query_lint_targets_and_contract_pair_fail_closed(self):
        self.configure_ai_damage_query_scope()
        policy = self.config["ai_damage_query_focus"]
        query, owner, document = policy["paths"][0], "rust/crates/er-devplane/src/lib.rs", "rust/contracts/m71-api.md"
        self.changed = [query, owner, document]
        execution, required = self.ai_lint_repair_expected_scope()
        selection = self.feedback.plan()
        self.assertEqual(selection["execution_scope"], execution)
        self.assertEqual(selection["required_native_targets"], required)
        for changed in ([query, document], [owner, document], [document],
                        [query, owner, "rust/contracts/m71-api-other.md"]):
            self.changed = changed
            with self.assertRaisesRegex(RuntimeError, "additional mapping"):
                self.feedback.plan()
        self.changed = [query, owner, document]
        for field in ("lint_repair_execute", "lint_repair_required_targets", "lint_repair_doc_paths", "lint_repair_exact_test_ids"):
            original = copy.deepcopy(policy[field])
            for bad in ({}, {"er-testkit": ["*"]}, {"er-testkit": ["m7_system_proof_extra"]}):
                policy[field] = bad
                (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
                with self.assertRaisesRegex(RuntimeError, "lint repair target/doc policy identities disagree"):
                    self.feedback.plan()
            policy[field] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.assertNotIn("rust/contracts/", self.config["documentation_prefixes"])

    def test_ai_damage_query_lint_companion_inventory_is_mandatory_and_assigned_to_a(self):
        self.configure_ai_damage_query_scope()
        policy = self.config["ai_damage_query_focus"]
        self.changed = policy["paths"] + policy["lint_repair_paths"]
        selection = self.feedback.plan()
        execution, required = self.ai_lint_repair_expected_scope()
        self.assertEqual(selection["execution_scope"], execution)
        self.assertEqual(selection["required_native_targets"], required)
        self.assertEqual(sum(map(len, policy["required_targets"].values())), 50)
        self.assertEqual(sum(map(len, required.values())), 77)
        exact = selection["required_native_test_ids"]
        enumerated = [(crate, target, exact.get(f"{crate}:{target}", ["behavior"]))
                      for crate, targets in required.items() for target in targets]
        self.assertEqual(len(self.feedback.required_native_target_counts(required, enumerated)), 77)
        for index, (crate, target, ids) in enumerate(enumerated):
            if target not in policy["lint_repair_required_targets"].get(crate, []):
                continue
            for replacement in ([], [(crate, target, [])], [(crate, target + "_renamed", ids)],
                                [("wrong-crate", target, ids)], [(crate, target, ids)] * 2):
                with self.subTest(crate=crate, target=target, replacement=replacement):
                    with self.assertRaisesRegex(RuntimeError, "required native witness"):
                        self.feedback.required_native_target_counts(required, enumerated[:index] + replacement + enumerated[index + 1:])
        spec = importlib.util.spec_from_file_location("m9e_lint_partition_under_test", HARNESS.with_name("m9e_phases.py"))
        phases = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(phases)
        inventory = [{"crate": crate, "target": target, "ids": ids, "historical_excluded_ids": []}
                     for crate, target, ids in enumerated]
        assignments = phases.partition(inventory)
        for crate, targets in policy["lint_repair_required_targets"].items():
            for target in targets:
                self.assertIn([crate, target], assignments["a"])
                self.assertNotIn([crate, target], assignments["b"])
        self.assertEqual(sum(len(targets) for targets in assignments.values()), 77)

    def test_ai_damage_query_lint_companions_execute_with_full_clippy_and_platform(self):
        self.configure_ai_damage_query_scope()
        policy = self.config["ai_damage_query_focus"]
        self.changed = policy["paths"] + policy["lint_repair_paths"]
        selection = self.feedback.plan()
        self.ai_damage_query_binaries(selection)
        for target in ("er-content-compiler", "er_devplane", "er_wasm", "er_world"):
            self.binary_ids[target] = []
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                patch.object(self.feedback, "timer_behavioral_mutant") as timer, \
                patch.object(self.feedback, "replica_behavioral_mutant") as replica:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        if (self.full / "full-summary.json").is_file():
            summary = json.loads((self.full / "full-summary.json").read_text())
        self.assertEqual(len(summary["required_native_target_counts"]), 77)
        for crate, targets in policy["lint_repair_execute"].items():
            for target in targets:
                self.assertTrue(any(self.binary_crates[binary] == crate and self.binary_targets[binary] == target
                                    for binary in self.executed), (crate, target))
        self.assertNotIn("reverse_compiled_only", self.executed)
        self.assertEqual(self.executed[0], "m9e_damage_query")
        for command in [command for command in self.commands if command[:2] in (["cargo", "test"], ["cargo", "clippy"])]:
            self.assertEqual([command[index + 1] for index, part in enumerate(command) if part == "-p"], selection["packages"])
        lint = [command for command in self.commands if command[:2] == ["cargo", "clippy"]]
        self.assertEqual(len(lint), 1)
        self.assertEqual(lint[0][-5:], ["--all-targets", "--no-deps", "--", "-D", "warnings"])
        self.assertLess(self.events.index("clippy"), self.events.index("execute:m9e_damage_query"))
        wasm.assert_called_once()
        browser.assert_called_once()
        timer.assert_called_once()
        replica.assert_called_once()
        count = sum(len(self.binary_ids[binary]) for binary in self.executed)
        self.assertEqual(summary["tests"], {"selected": count, "executed": count, "passed": count, "failed": 0, "skipped": 0})

    def test_ai_damage_query_lint_repairs_keep_full_execution_and_reverse_lint_scope(self):
        self.configure_browser_worker_scope()
        self.configure_ai_damage_query_scope()
        policy = self.config["ai_damage_query_focus"]
        expected = ["rust/crates/er-state/src/" + path for path in (
            "bespoke_v2/forms.rs", "bespoke_v2/scheduled_effects.rs", "bespoke_v2/substitute.rs",
            "bespoke_v2/suppression_immunity.rs", "m7_state.rs", "migration.rs", "run_v2.rs", "world_v2.rs",
            "bespoke_v2/guard.rs", "bespoke_v2/item_lifecycle.rs", "bespoke_v2/special_damage.rs", "mechanic_state_v2.rs")]
        expected += [
            "rust/crates/er-ai/src/content_v2.rs",
            "rust/crates/er-ai/src/trainer_party.rs",
            "rust/crates/er-battle/src/m6/ability_executor.rs",
            "rust/crates/er-battle/src/m6/bespoke/forms.rs",
            "rust/crates/er-battle/src/m6/bespoke/guard.rs",
            "rust/crates/er-battle/src/m6/bespoke/move_copy.rs",
            "rust/crates/er-battle/src/m6/bespoke/scheduled_effects.rs",
            "rust/crates/er-battle/src/m6/bespoke/special_damage.rs",
            "rust/crates/er-battle/src/m6/bespoke/substitute.rs",
            "rust/crates/er-battle/src/m6/bespoke/suppression_immunity.rs",
            "rust/crates/er-battle/src/m6/move_executor.rs",
            "rust/crates/er-battle/src/mechanics_mutation.rs",
            "rust/crates/er-content-compiler/src/m6/moves.rs",
            "rust/crates/er-content-compiler/src/m9e_bundle.rs",
            "rust/crates/er-content-compiler/src/m9e_full_content.rs",
            "rust/crates/er-content-compiler/src/m9e_progression.rs",
            "rust/crates/er-content-compiler/src/main.rs",
            "rust/crates/er-devplane/src/lib.rs",
            "rust/crates/er-progression/src/oracle_surface.rs",
            "rust/crates/er-progression/src/progression.rs",
            "rust/crates/er-run/src/biome.rs",
            "rust/crates/er-run/src/capture.rs",
            "rust/crates/er-run/src/money.rs",
            "rust/crates/er-run/src/reward.rs",
            "rust/crates/er-run/src/rng_audit.rs",
            "rust/crates/er-save/src/oracle_replay.rs",
            "rust/crates/er-scenario/src/full_surface.rs",
            "rust/crates/er-sim/src/snapshot_v3.rs",
            "rust/crates/er-sim/tests/m4_raw_key_local.rs",
            "rust/crates/er-state/tests/m4_foundation_properties.rs",
            "rust/crates/er-testkit/tests/m6_foundation.rs",
            "rust/crates/er-wasm/src/m6_parity.rs",
            "rust/crates/er-world/src/runtime.rs",
            "rust/crates/er-sim/benches/m4_runtime_benchmark.rs",
            "rust/crates/er-testkit/tests/m6_solo_campaigns.rs",
            "rust/crates/er-testkit/tests/m6_field_parity.rs",
            "rust/crates/er-testkit/tests/m6_coop_campaigns.rs",
            "rust/crates/er-testkit/tests/m6_native_wasm.rs",
            "rust/crates/er-testkit/tests/support/m6_benchmark.rs",
            "rust/crates/er-testkit/tests/m6_performance.rs",
            "rust/crates/er-testkit/tests/m6_ability_parity.rs",
            "rust/crates/er-testkit/tests/m6_item_parity.rs",
            "rust/crates/er-testkit/tests/m6_move_parity.rs",
            "rust/crates/er-testkit/tests/m6_species_form_parity.rs",
            "rust/crates/er-testkit/tests/m6_properties.rs",
            "rust/crates/er-agent-protocol/src/lib.rs",
            "rust/crates/er-agent-protocol/src/ingress_diagnostic_tests.rs",
        ]
        self.assertEqual(policy["lint_repair_paths"], expected)
        self.assertEqual(self.feedback.AI_DAMAGE_QUERY_LINT_REPAIR_PATHS, expected)
        self.package("er-lint-consumer", '[dependencies]\ner-state = { path = "../er-state" }\n')
        expected_execution, expected_required = self.ai_lint_repair_expected_scope()
        before = copy.deepcopy(self.config)
        for repairs in (expected, *[[path] for path in expected]):
            self.changed = policy["paths"] + repairs
            selection = self.feedback.plan()
            self.assertTrue(selection["ai_damage_query_focus"])
            self.assertTrue(selection["ai_damage_query_lint_repair_focus"])
            self.assertEqual(selection["execution_scope"], expected_execution)
            self.assertEqual(selection["required_native_targets"], expected_required)
            self.assertEqual(selection["required_native_test_ids"], policy["exact_test_ids"] | policy["lint_repair_exact_test_ids"])
            self.assertIn("er-lint-consumer", selection["packages"])
            for flag in ("timer_focus", "requires_browser", "requires_browser_worker", "requires_wasm",
                         "requires_cli_executable", "requires_worker_executable"):
                self.assertTrue(selection[flag], flag)
            self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
            self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(self.config, before)
        for extra in ("rust/crates/er-state/src/bespoke_v2/other.rs", "rust/crates/er-state/Cargo.toml", "rust/Cargo.lock"):
            self.changed = policy["paths"] + expected + [extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                self.feedback.plan()

    def test_ai_damage_query_lint_repair_policy_cannot_widen_or_omit_named_sources(self):
        self.configure_ai_damage_query_scope()
        policy = self.config["ai_damage_query_focus"]
        original = list(policy["lint_repair_paths"])
        self.changed = policy["paths"] + original
        for bad in ([], original[:-1], original + ["rust/crates/er-state/src/other.rs"], list(reversed(original))):
            policy["lint_repair_paths"] = bad
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaisesRegex(RuntimeError, "lint repair policy identities disagree"):
                self.feedback.plan()
        policy["lint_repair_paths"] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = original
        # These repairs do not independently activate the damage-query exception.
        try:
            selection = self.feedback.plan()
        except RuntimeError as error:
            self.assertIn("planning requires additional mapping", str(error))
        else:
            self.assertFalse(selection["ai_damage_query_focus"])

    def test_ai_damage_query_all_required_targets_and_exact_ids_fail_on_omission_or_renaming(self):
        self.configure_ai_damage_query_scope()
        self.changed = self.config["ai_damage_query_focus"]["paths"]
        selection = self.feedback.plan()
        exact = selection["required_native_test_ids"]
        enumerated = [(crate, target, exact.get(f"{crate}:{target}", ["behavior"]))
                      for crate, targets in selection["required_native_targets"].items() for target in targets]
        self.assertEqual(len(self.feedback.required_native_target_counts(selection["required_native_targets"], enumerated)), 50)
        self.feedback.require_native_test_ids(exact, enumerated)
        for index, (crate, target, ids) in enumerate(enumerated):
            for replacement in ([], [(crate, target, [])], [("wrong-crate", target, ids)],
                                [(crate, target + "_renamed", ids)], [(crate, target, ids)] * 2):
                with self.subTest(target=(crate, target), replacement=replacement):
                    bad = enumerated[:index] + replacement + enumerated[index + 1:]
                    with self.assertRaisesRegex(RuntimeError, "required native witness"):
                        self.feedback.required_native_target_counts(selection["required_native_targets"], bad)
        for identity, ids in exact.items():
            index = next(index for index, (crate, target, _) in enumerate(enumerated) if f"{crate}:{target}" == identity)
            crate, target, _ = enumerated[index]
            for position in range(len(ids)):
                for action in ("omit", "rename", "duplicate"):
                    with self.subTest(identity=identity, position=position, action=action):
                        changed = list(ids)
                        if action == "omit":
                            changed.pop(position)
                        elif action == "rename":
                            changed[position] += "_renamed"
                        else:
                            changed.append(ids[position])
                        bad = enumerated[:index] + [(crate, target, changed)] + enumerated[index + 1:]
                        with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                            self.feedback.require_native_test_ids(exact, bad)

    def test_ai_damage_query_full_compile_single_early_lint_and_platform_controls(self):
        self.configure_ai_damage_query_scope()
        self.changed = self.config["ai_damage_query_focus"]["paths"]
        self.ai_damage_query_binaries()
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                patch.object(self.feedback, "timer_behavioral_mutant") as timer, \
                patch.object(self.feedback, "replica_behavioral_mutant") as replica, \
                patch.object(self.feedback, "ledger_behavioral_mutant") as ledger:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        if (self.full / "full-summary.json").is_file():
            summary = json.loads((self.full / "full-summary.json").read_text())
        selection = json.loads((self.full / "plan.json").read_text())
        self.assertEqual(len(summary["required_native_target_counts"]), 50)
        self.assertEqual(summary["required_native_target_counts"]["er-game:m9e_damage_query"], 4)
        self.assertEqual(self.executed[0], "m9e_damage_query")
        self.assertNotIn("reverse_compiled_only", self.executed)
        self.assertIn("er_battle", self.executed)
        self.assertIn("er_game", self.executed)
        build = next(command for command in self.commands if command[:2] == ["cargo", "test"])
        lint = [command for command in self.commands if command[:2] == ["cargo", "clippy"]]
        self.assertEqual(len(lint), 1)
        for command in (build, lint[0]):
            self.assertEqual([command[index + 1] for index, part in enumerate(command) if part == "-p"], selection["packages"])
            self.assertIn("--locked", command)
        self.assertIn("--no-run", build)
        self.assertIn("--tests", build)
        self.assertEqual(lint[0][-5:], ["--all-targets", "--no-deps", "--", "-D", "warnings"])
        self.assertLess(max(index for index, event in enumerate(self.events) if event.startswith("list:")), self.events.index("clippy"))
        self.assertLess(self.events.index("clippy"), self.events.index("execute:m9e_damage_query"))
        count = sum(len(self.binary_ids[name]) for name in self.executed)
        self.assertEqual(summary["tests"], {"selected": count, "executed": count, "passed": count, "failed": 0, "skipped": 0})
        self.assertEqual(summary["cli_executable"]["source_sha"], CANDIDATE)
        self.assertEqual(summary["worker_executable"]["source_sha"], CANDIDATE)
        self.assertEqual(summary["native_timer_parity_digest"], "d" * 64)
        wasm.assert_called_once()
        browser.assert_called_once()
        timer.assert_called_once()
        replica.assert_called_once()
        ledger.assert_not_called()

    def test_ai_damage_query_lint_and_identity_failures_stop_before_any_native_execution(self):
        self.configure_ai_damage_query_scope()
        self.changed = self.config["ai_damage_query_focus"]["paths"]
        self.ai_damage_query_binaries()
        self.clippy_codes["er-game"] = 1
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        if (self.full / "full-summary.json").is_file():
            summary = json.loads((self.full / "full-summary.json").read_text())
        self.assertIn("selected-packages-clippy", summary["first_failure"])
        self.assertGreater(summary["tests"]["selected"], 0)
        self.assertEqual(summary["tests"]["executed"], 0)
        self.assertTrue(summary["selected_inventory_validated"])
        self.assertEqual(len(summary["required_native_target_counts"]), 50)
        self.assertEqual(self.executed, [])
        self.assertLess(max(index for index, event in enumerate(self.events) if event.startswith("list:")), self.events.index("clippy"))
        self.clippy_codes.clear()
        self.events.clear()
        self.binary_ids["m9e_damage_query"] = self.binary_ids["m9e_damage_query"][:-1]
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("required native test identities", summary["first_failure"])
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)

    def test_ai_damage_query_priority_is_crate_bound_with_stable_causal_remainder(self):
        items = [(index, f"bin{index}", name, ["case"], Path(crate), set(), None)
                 for index, (crate, name) in enumerate([
                     ("er-other", "m9e_damage_query"), ("er-cli", "m9e_current_reload"),
                     ("er-kernel", "m9e_coop_v7"), ("er-game", "m9e_damage_query"),
                     ("er-kernel", "m9e_game_kernel_v7"), ("er-other", "last")])]
        old = self.feedback.native_execution_order({"timer_focus": True}, items)
        ordered = self.feedback.native_execution_order({"timer_focus": True, "ai_damage_query_focus": True}, items)
        self.assertEqual(ordered[0], items[3])
        self.assertEqual(ordered[1:], [item for item in old if item != items[3]])
        self.assertEqual({item[0] for item in ordered}, {item[0] for item in items})
        self.assertEqual(self.feedback.native_execution_order({}, items), items)

    def test_current_owner_executes_first_without_changing_inventory_or_prior_order(self):
        items = [(index, f"bin{index}", name, [f"case{index}"], Path(crate), set(), None)
                 for index, (crate, name) in enumerate([
                     ("er-other", "m9e_current_proposal_v7"), ("er-cli", "m9e_current_reload"),
                     ("er-kernel", "m9e_coop_v7"), ("er-game", "m9e_damage_query"),
                     ("er-kernel", "m9e_current_proposal_v7"), ("er-kernel", "m9e_game_kernel_v7"),
                     ("er-other", "last")])]
        original = list(items)
        for damage in (False, True):
            selection = {"timer_focus": True, "ai_damage_query_focus": damage}
            prior = self.feedback.native_execution_order(selection, items)
            ordered = self.feedback.native_execution_order(
                {**selection, "requires_current_proposal": True}, items)
            self.assertEqual(ordered, [items[4], *[item for item in prior if item != items[4]]])
            self.assertEqual(sorted(ordered, key=lambda item: item[0]), items)
            self.assertEqual(self.feedback.native_execution_order(
                {**selection, "requires_current_proposal": False}, items), prior)
            self.assertEqual(items, original)
        self.assertEqual(self.feedback.native_execution_order({}, items), items)

    def configure_ai_snapshot_validation_scope(self):
        self.configure_browser_rtc_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["ai_snapshot_validation_focus"]
        self.config["ai_snapshot_validation_focus"] = policy
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-ai")
        self.package("er-ai-reverse", '[dependencies]\ner-ai = { path = "../er-ai" }\n')
        self.changed = list(policy["paths"])

    def test_ai_snapshot_validation_requires_full_causal_and_ai_inventory_with_rtc(self):
        self.configure_ai_snapshot_validation_scope()
        before = copy.deepcopy(self.config)
        selection = self.feedback.plan()
        for flag in ("ai_snapshot_validation_focus", "timer_focus", "requires_wasm", "requires_browser",
                     "requires_browser_worker", "requires_browser_rtc", "requires_cli_executable",
                     "requires_worker_executable", "requires_cli_clippy", "requires_agent_protocol_clippy"):
            self.assertTrue(selection[flag], flag)
        self.assertFalse(selection["ai_damage_query_focus"])
        self.assertFalse(selection["current_browser_rtc_focus"])
        causal = self.config["timer_focus"]
        self.assertEqual(selection["execution_scope"], {**causal["execute"], "er-ai": ["*"]})
        self.assertEqual(selection["required_native_targets"], {**causal["required_targets"], "er-ai": ["er_ai"]})
        self.assertEqual(selection["required_native_test_ids"], {
            **causal["exact_test_ids"], "er-ai:er_ai": self.config["ai_snapshot_validation_focus"]["exact_test_ids"]})
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 23)
        self.assertEqual(len(selection["required_native_test_ids"]["er-ai:er_ai"]), 14)
        self.assertIn("er-ai-reverse", selection["packages"])
        self.assertIn("er-reverse", selection["packages"])
        self.assertEqual(selection["timer_mutant"], causal["mutant"])
        self.assertEqual(selection["replica_mutant"], causal["replica_mutant"])
        self.assertEqual(self.config, before)

    def test_ai_snapshot_validation_rejects_unpaired_and_mixed_product_changes(self):
        self.configure_ai_snapshot_validation_scope()
        paths = list(self.changed)
        for extra in (None, "rust/Cargo.lock", "rust/crates/er-ai/src/content_v2.rs",
                      "rust/crates/er-ai/src/authority_v2_extra.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs",
                      "rust/crates/er-repro/src/current.rs", "src/rust-browser/routes/rust-current-rtc-entry.ts"):
            with self.subTest(extra=extra):
                self.changed = paths[:1] if extra is None else [*paths, extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
        # Existing snapshot-only ownership keeps the established timer scope.
        self.changed = paths[1:]
        selection = self.feedback.plan()
        self.assertFalse(selection["ai_snapshot_validation_focus"])
        self.assertEqual(selection["required_native_targets"], self.config["timer_focus"]["required_targets"])
        self.changed = ["docs/plans/rust-kernel/m9e-note.md"]
        self.assertFalse(self.feedback.plan()["ai_snapshot_validation_focus"])

    def test_ai_snapshot_validation_policy_cannot_expand_paths_or_drop_ids(self):
        self.configure_ai_snapshot_validation_scope()
        original = copy.deepcopy(self.config["ai_snapshot_validation_focus"])
        for mutation in ("path", "missing_id", "duplicate_id", "extra_field", "missing_paths", "missing_policy"):
            with self.subTest(mutation=mutation):
                policy = copy.deepcopy(original)
                if mutation == "path":
                    policy["paths"].append("rust/crates/er-ai/src/lib.rs")
                elif mutation == "missing_id":
                    policy["exact_test_ids"].pop()
                elif mutation == "duplicate_id":
                    policy["exact_test_ids"][0] = policy["exact_test_ids"][1]
                elif mutation == "extra_field":
                    policy["execute"] = {}
                elif mutation == "missing_paths":
                    del policy["paths"]
                else:
                    policy = {}
                self.config["ai_snapshot_validation_focus"] = policy
                (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
                with self.assertRaisesRegex(RuntimeError, "policy identities|additional mapping"):
                    self.feedback.plan()

    def test_ai_snapshot_validation_rejects_missing_or_changed_ai_and_causal_witnesses(self):
        self.configure_ai_snapshot_validation_scope()
        selection = self.feedback.plan()
        exact = selection["required_native_test_ids"]
        rows = [(*identity.split(":"), ids) for identity, ids in exact.items()]
        self.feedback.require_native_test_ids(exact, rows)
        for identity in ("er-ai:er_ai", "er-kernel:m9e_snapshot_v7", "er-kernel:m9e_game_kernel_v7",
                         "er-cli:m9e_current_reload", "er-repro:m9e_current_repro", "er-wasm:m9e_parity"):
            index = next(index for index, row in enumerate(rows) if f"{row[0]}:{row[1]}" == identity)
            crate, target, ids = rows[index]
            for replacement in ([], [(crate, target, [])], [(crate, target, ids[:-1])],
                                [(crate, target, ids + [ids[0]])], [(crate, target + "_renamed", ids)]):
                with self.subTest(identity=identity, replacement=replacement):
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(exact, rows[:index] + replacement + rows[index + 1:])

    def test_ai_snapshot_validation_execution_keeps_reverse_clippy_and_both_mutants(self):
        self.configure_ai_snapshot_validation_scope()
        selection = self.feedback.plan()
        self.binary_ids = {}
        for crate, names in selection["execution_scope"].items():
            if names == ["*"]:
                names = selection["required_native_targets"].get(crate, [crate.replace("-", "_")])
            for name in names:
                binary = name if name not in self.binary_ids else crate + "--" + name
                self.binary_ids[binary] = selection["required_native_test_ids"].get(f"{crate}:{name}", ["behavior"])
                self.binary_crates[binary], self.binary_targets[binary] = crate, name
        self.binary_ids["reverse_compiled_only"] = ["reverse"]
        self.binary_crates["reverse_compiled_only"] = "er-ai-reverse"
        self.binary_targets["reverse_compiled_only"] = "reverse_compiled_only"
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                patch.object(self.feedback, "timer_behavioral_mutant") as timer, \
                patch.object(self.feedback, "replica_behavioral_mutant") as replica:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        if (self.full / "full-summary.json").is_file():
            summary = json.loads((self.full / "full-summary.json").read_text())
        self.assertEqual(len(summary["required_native_target_counts"]), 23)
        self.assertEqual(summary["required_native_target_counts"]["er-ai:er_ai"], 14)
        self.assertIn("er_ai", self.executed)
        self.assertNotIn("reverse_compiled_only", self.executed)
        for command in [command for command in self.commands if command[:2] in (["cargo", "test"], ["cargo", "clippy"])]:
            self.assertEqual([command[index + 1] for index, part in enumerate(command) if part == "-p"], selection["packages"])
        self.assertLess(self.events.index("clippy"), self.events.index("execute:" + self.executed[0]))
        count = sum(len(self.binary_ids[name]) for name in self.executed)
        self.assertEqual(summary["tests"], {"selected": count, "executed": count, "passed": count, "failed": 0, "skipped": 0})
        self.assertEqual(summary["worker_executable"]["source_sha"], CANDIDATE)
        self.assertEqual(summary["cli_executable"]["source_sha"], CANDIDATE)
        wasm.assert_called_once()
        browser.assert_called_once()
        timer.assert_called_once()
        replica.assert_called_once()

    def configure_browser_rtc_scope(self):
        self.configure_browser_worker_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["current_browser_rtc_focus"]
        self.config["current_browser_rtc_focus"] = policy
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for path in policy["paths"]:
            source = self.root / path
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("RTC source fixture: " + path)
        self.changed = list(policy["paths"])

    def test_rtc_scope_preserves_native_controls_worker_platform_and_future_browser_ownership(self):
        self.configure_browser_rtc_scope()
        import m9e_phases as phases
        for changed in (phases.RTC_PATHS, phases.RTC_PATHS[:1], phases.RTC_PATHS[-1:],
                        [*phases.RTC_PATHS, phases.WORKER_SOURCE_PATHS[-1]]):
            self.changed = changed
            selection = self.feedback.plan()
            for flag in ("current_browser_rtc_focus", "requires_browser_rtc", "requires_browser_worker", "timer_focus",
                         "requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable",
                         "requires_cli_clippy", "requires_agent_protocol_clippy"):
                self.assertTrue(selection[flag], flag)
            self.assertEqual(selection["execution_scope"], self.config["timer_focus"]["execute"])
            self.assertEqual(selection["required_native_test_ids"], self.config["timer_focus"]["exact_test_ids"])
            self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 22)
            self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_timers_v7"]), 11)
            self.assertEqual(selection["browser_rtc_binding"], phases.browser_rtc_source_binding(self.root, CANDIDATE))
            self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
            self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
            self.assertIsNone(selection["ledger_mutant"])
            self.assertIn("er-reverse", selection["packages"])
        self.changed = ["rust/crates/er-kernel/src/game_kernel_v7.rs"]
        self.assertTrue(self.feedback.plan()["requires_browser_rtc"])
        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        with patch.object(phases, "browser_rtc_source_binding", side_effect=AssertionError("no RTC readiness binding")):
            readiness = self.feedback.plan()
        self.assertEqual(readiness["packages"], ["er-canonical"])
        self.assertFalse(readiness["requires_browser_rtc"])
        self.assertIsNone(readiness["browser_rtc_binding"])

    def test_rtc_scope_rejects_mixed_paths_locks_missing_dependency_and_policy_drift(self):
        self.configure_browser_rtc_scope()
        import m9e_phases as phases
        for extra in ("rust/Cargo.lock", "pnpm-lock.yaml", "package.json", "rust/crates/er-kernel/src/game_kernel_v7.rs",
                      phases.WORKER_SOURCE_PATHS[0], "src/rust-browser/adapters/transport-adapter.ts", "test/browser/rust-browser/rtc-other.spec.ts"):
            self.changed = [phases.RTC_PATHS[0], extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                self.feedback.plan()
        self.changed = list(phases.RTC_PATHS)
        missing = self.root / phases.WORKER_SOURCE_PATHS[2]
        saved = missing.read_bytes()
        missing.unlink()
        with self.assertRaises(FileNotFoundError):
            self.feedback.plan()
        missing.write_bytes(saved)
        self.config["current_browser_rtc_focus"]["paths"].append("unmapped.json")
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        with self.assertRaisesRegex(RuntimeError, "RTC policy identities"):
            self.feedback.plan()

    def test_rtc_report_requires_exact_real_attempts_bounded_attachments_and_causal_fields(self):
        import m9e_phases as phases
        binding, assets, tests, cohort = browser_rtc_fixture(phases)
        parse = lambda report: self.feedback.browser_worker_result_evidence(report, assets, binding, rtc=True, cohort_assets=cohort)
        self.assertEqual(parse(browser_rtc_report(tests)), tests)
        for mutation in ("skipped", "retry", "file", "title", "attachment", "oversized", "wrong_source", "frame_bound",
                         "no_turn", "false_delivered", "zero_presentations", "false_dispose", "false_mismatch", "bool_counter",
                         "unprefixed_state_digest", "malformed_state_digest"):
            bad = copy.deepcopy(tests)
            if mutation == "wrong_source": bad["positive"]["source_sha"] = "0" * 40
            if mutation == "frame_bound": bad["positive"]["material_bytes"] = 65_537
            if mutation == "no_turn": bad["positive"]["final_turn"] = 0
            if mutation == "false_delivered": bad["positive"]["right_kernel_delivered"] = 0
            if mutation == "zero_presentations": bad["positive"]["presentation_count"] = 0
            if mutation == "false_dispose": bad["negative"]["disposal_acknowledged"] = True
            if mutation == "false_mismatch": bad["negative"]["mismatch"]["connected_events"] = [1, 0]
            if mutation == "bool_counter": bad["positive"]["disconnected_events"] = [True, 1]
            if mutation == "unprefixed_state_digest": bad["positive"]["material_after_digest"] = "5" * 64
            if mutation == "malformed_state_digest": bad["positive"]["material_after_digest"] = "blake3-v1:" + "g" * 64
            report = browser_rtc_report(bad)
            spec = report["suites"][0]["specs"][0]
            result = spec["tests"][0]["results"][0]
            if mutation == "skipped": result["status"] = "skipped"
            if mutation == "retry": result["retry"] = 1
            if mutation == "file": spec["file"] = "m9e-v7-worker.spec.ts"
            if mutation == "title": spec["title"] = "mock RTC bytes"
            if mutation == "attachment": result["attachments"].append(copy.deepcopy(result["attachments"][0]))
            if mutation == "oversized": result["attachments"][0]["body"] = base64.b64encode(b" " * 4097).decode()
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                parse(report)

    def test_rtc_build_verifies_distinct_namespaces_installed_vite_and_all_dependency_hashes(self):
        self.configure_browser_rtc_scope()
        import m9e_phases as phases
        selection = self.feedback.plan()
        _, assets, _, cohort = browser_rtc_fixture(phases)
        binding = selection["browser_rtc_binding"]
        manifest = assets["manifest"]
        manifest.update({"source_hashes": binding["source_hashes"], "builder_sha256": binding["source_hashes"][phases.WORKER_SOURCE_PATHS[-1]],
                         "pnpm_lock_sha256": binding["pnpm_lock_sha256"]})
        output = self.root / "rtc-build"
        output.mkdir()
        for name in manifest["assets"]:
            (output / name).write_bytes(b"entry" if name == manifest["entry"] else b"worker")
        (output / "m9e-v7-rtc-assets.json").write_bytes(phases.encoded(manifest))
        vite = self.root / "node_modules/vite/package.json"
        vite.parent.mkdir(parents=True, exist_ok=True)
        vite.write_text(json.dumps({"version": manifest["vite_version"]}))
        summary = {"product_sha": CANDIDATE, "plan": selection, "browser_assets": {"assets": cohort}}
        self.feedback.verify_browser_worker_build(output, summary, rtc=True)
        self.assertEqual(summary["browser_rtc_assets"]["manifest"], manifest)
        vite.write_text(json.dumps({"version": "8.0.11"}))
        with self.assertRaisesRegex(RuntimeError, "Vite version"):
            self.feedback.verify_browser_worker_build(output, summary, rtc=True)
        vite.write_text(json.dumps({"version": manifest["vite_version"]}))
        (output / manifest["worker"]).write_bytes(b"broken")
        with self.assertRaisesRegex(RuntimeError, "asset hash or size"):
            self.feedback.verify_browser_worker_build(output, summary, rtc=True)
        (output / manifest["worker"]).write_bytes(b"worker")
        (output / "current-rtc-unlisted.js").write_bytes(b"extra")
        with self.assertRaisesRegex(RuntimeError, "unlisted"):
            self.feedback.verify_browser_worker_build(output, summary, rtc=True)
        (output / "current-rtc-unlisted.js").unlink()
        (self.root / phases.RTC_PATHS[0]).write_text("source changed after native plan")
        with self.assertRaisesRegex(RuntimeError, "source differs"):
            self.feedback.verify_browser_worker_build(output, summary, rtc=True)

    def test_rtc_orchestration_preserves_worker_codec_bridge_and_adds_separate_report(self):
        self.configure_browser_rtc_scope()
        import m9e_phases as phases
        summary = {"product_sha": CANDIDATE, "target": "x86_64-unknown-linux-gnu", "profile": "test", "plan": self.feedback.plan()}
        summary["cli_executable"] = self.feedback.discover_cli_executable([self.cli_executable_artifact()], summary)
        _, bridge, _ = self.bridge_report()
        bridge["executable_sha256"] = summary["cli_executable"]["sha256"]
        old_report = self.bridge_report(bridge)[0]
        _, typed_report = self.browser_reports()
        worker_binding, worker_assets, worker_tests, _ = browser_worker_fixture(phases)
        rtc_binding, rtc_assets, rtc_tests, _ = browser_rtc_fixture(phases)
        output = self.root / "runner/m9e-v7-web"
        output.mkdir(parents=True)
        old_assets = {}
        for name in ("er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json", "coop-authority-snapshot.json", "coop-replica-snapshot.json"):
            path = output / name
            path.write_bytes(b"existing browser cohort")
            old_assets[name] = {"bytes": path.stat().st_size, "sha256": self.feedback.digest(path)}
        for key in ("positive", "negative"):
            rtc_tests[key]["authority_fixture_sha256"] = old_assets["coop-authority-snapshot.json"]["sha256"]
            rtc_tests[key]["replica_fixture_sha256"] = old_assets["coop-replica-snapshot.json"]["sha256"]
        (output / "m9e-v7-web-assets.json").write_text(json.dumps({"source_sha": CANDIDATE, "assets": old_assets, "browser_worker_protocol_version": 2}))
        (self.rust / "rust-toolchain.toml").write_text('[toolchain]\nchannel = "1.97.1"\n')
        codec_report = {"success": True, "numTotalTests": 3, "numPassedTests": 3, "testResults": [{
            "name": "test/node/rust-browser/engineering/current-worker-codec.test.ts",
            "assertionResults": [{"fullName": name, "status": "passed"} for name in phases.WORKER_CODEC_IDS]}]}
        calls = []
        def run_browser(args, name, cwd=None, env=None):
            calls.append((name, list(args), dict(env) if env else None))
            reports = {"browser-journey": ("browser-results.json", old_report),
                       "browser-effects": ("browser-effect-results.json", typed_report),
                       "browser-worker-codec": ("browser-worker-codec-results.json", codec_report),
                       "browser-worker-journey": ("browser-worker-results.json", browser_worker_report(worker_tests)),
                       "browser-rtc-journey": ("browser-rtc-results.json", browser_rtc_report(rtc_tests))}
            if name in reports:
                filename, value = reports[name]
                (self.full / filename).write_text(json.dumps(value))
            return self.full / (name + ".log")
        build_order = []
        def verified_build(directory, value, *, rtc=False):
            self.assertEqual(directory, output)
            build_order.append(rtc)
            value["browser_rtc_assets" if rtc else "browser_worker_assets"] = rtc_assets if rtc else worker_assets
        summary["plan"].update({"browser_worker_binding": worker_binding, "browser_rtc_binding": rtc_binding})
        with patch.dict(os.environ, {"RUNNER_TEMP": str(self.root / "runner")}), \
                patch.object(self.feedback, "run", side_effect=run_browser), \
                patch.object(self.feedback, "verify_browser_worker_build", side_effect=verified_build):
            self.feedback.browser_checks(summary)
        self.assertEqual(build_order, [True, False])
        self.assertEqual(summary["browser_current_repro_bridge"], bridge)
        self.assertEqual(summary["browser_tests"]["chromium"]["passed"], 2)
        self.assertEqual(summary["browser_tests"]["typed_effects"]["passed"], 1)
        self.assertEqual(summary["browser_worker_tests"], worker_tests)
        self.assertEqual(summary["browser_worker_codec"]["passed"], 3)
        self.assertEqual(summary["browser_rtc_tests"], rtc_tests)
        self.assertEqual([name for name, _, _ in calls], ["browser-dependencies", "browser-build", "browser-chromium-install",
                         "browser-journey", "browser-effects", "browser-worker-codec", "browser-worker-journey", "browser-rtc-journey"])
        build_env = next(env for name, _, env in calls if name == "browser-build")
        self.assertEqual(build_env["M9E_BUILD_CURRENT_WORKER"], "1")
        self.assertEqual(build_env["M9E_BUILD_CURRENT_RTC"], "1")
        for name, args, env in calls:
            if name.endswith("journey"):
                self.assertIn("--workers=1", args)
                self.assertEqual(env["ER_M9E_CLI_SHA256"], bridge["executable_sha256"])
        self.assertTrue(calls[-1][2]["PLAYWRIGHT_JSON_OUTPUT_FILE"].endswith("browser-rtc-results.json"))

    def configure_material_retention_scope(self):
        self.configure_timer_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["material_retention_focus"]
        self.config["material_retention_focus"] = policy
        complete = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        for scope in ("browser_cache_focus", "current_validation_focus", "native_capture_focus"):
            self.config[scope] = complete[scope]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-game")
        self.package("er-reverse", '[dependencies]\ner-game = { path = "../er-game" }\n')

    def test_material_retention_requires_full_game_cone_and_exact_new_witnesses(self):
        self.configure_material_retention_scope()
        self.changed = self.config["material_retention_focus"]["paths"]
        selection = self.feedback.plan()
        self.assertTrue(selection["material_retention_focus"])
        self.assertTrue(selection["timer_focus"])
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        for flag in ("requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable",
                     "requires_cli_clippy", "requires_agent_protocol_clippy"):
            self.assertTrue(selection[flag], flag)
        self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertIsNone(selection["worker_lock_guard"])
        self.assertIn("er-reverse", selection["packages"])
        self.assertNotIn("er-reverse", selection["execution_scope"])
        self.assertEqual(selection["execution_scope"]["er-game"], ["*"])
        for crate, targets in self.config["timer_focus"]["execute"].items():
            self.assertEqual(selection["execution_scope"][crate], targets)
        for identity, ids in self.config["timer_focus"]["exact_test_ids"].items():
            self.assertEqual(selection["required_native_test_ids"][identity], ids)
        self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_timers_v7"]), 11)
        self.assertIn("transport_resume_preserves_unrelated_pause_reasons_and_clock_classes",
                      selection["required_native_test_ids"]["er-kernel:m9e_timers_v7"])
        self.assertIn("staged_transport_generation_remains_paused_and_rejections_are_atomic",
                      selection["required_native_test_ids"]["er-kernel:m9e_timers_v7"])
        self.assertEqual(set(selection["required_native_targets"]["er-game"]), {
            "m3_command_menus", "m3_internal_event_boundary", "m3_local_battle", "m3_party_menus", "m3_runtime",
            "m9e_content_v2", "m9e_material_v6", "m9e_new_run_v6", "m9e_runtime_v6", "m9e_material_retention"})
        self.assertEqual(set(selection["required_native_test_ids"]["er-game:m9e_material_retention"]), {
            "bounded_material_suffix_crosses_three_full_4096_windows_through_dispatch_and_apply",
            "small_suffix_retained_conflicts_late_invalid_and_stale_material_preserve_full_frontier",
            "retention_policy_restore_and_revision_exhaustion_reject_without_retirement"})
        self.assertEqual(set(selection["required_native_test_ids"]["er-kernel:m9e_material_retention_v7"]), {
            "v7_material_rollover_restores_pending_effects_and_continues_exact_snapshots",
            "v7_restore_rejects_historical_gapped_evidence_and_continues_a_valid_suffix"})

        for identity, ids in self.config["current_validation_focus"]["exact_test_ids"].items():
            self.assertEqual(selection["required_native_test_ids"][identity], ids)
        prefix = "host_v2::transaction_tests::"
        self.assertEqual(set(selection["required_native_test_ids"]["er-web:er_web"]), {prefix + name for name in (
            "late_response_limit_rejection_preserves_state_cache_and_retry",
            "read_only_response_limit_failure_preserves_capture",
            "sequence_exhaustion_preflight_preserves_current_session_and_cached_response",
            "retained_response_byte_boundary_evicts_by_acceptance_and_preserves_retry",
            "single_response_cache_boundary_rejects_before_commit_and_disposal_clears_payloads")})
        self.assertEqual(set(selection["required_native_test_ids"]["er-cli:m9e_current_validation"]), {
            "ordinary_validate_save_accepts_v2_and_rejects_legacy_or_wrong_content",
            "ordinary_capsule_validation_replays_current_and_rejects_tampered_or_legacy_input"})

        self.assertEqual(selection["required_native_test_ids"]["er-cli:m9e_current_native_capture"],
                         self.config["native_capture_focus"]["exact_test_ids"]["er-cli:m9e_current_native_capture"])
        self.assertEqual(len(selection["required_native_test_ids"]["er-cli:m9e_current_native_capture"]), 4)
        self.assertEqual(set(selection["required_native_test_ids"]["er-agent-protocol:er_agent_protocol"]), {
            "response_context_tests::inline_success_boundary_counts_escaping_nulls_and_newline",
            "response_context_tests::contextual_server_rejects_before_mutation_and_accepts_corrected_retry",
            "response_context_tests::default_context_preserves_historical_artifact_dispatch",
            "ingress_diagnostic_tests::default_ingress_hook_preserves_legacy_responses_and_immutable_oversized_api",
            "ingress_diagnostic_tests::rejected_ingress_hook_distinguishes_addressable_and_discarded_requests"})

        lint_paths = {
            "rust/crates/er-game/src/m6/coop_campaign.rs",
            "rust/crates/er-game/src/m6/runtime_v4.rs",
            "rust/crates/er-game/src/m6/solo_campaign.rs",
            "rust/crates/er-game/src/m7_internal_event.rs",
            "rust/crates/er-game/src/m7_material.rs",
            "rust/crates/er-game/src/m7_run_executor.rs",
            "rust/crates/er-game/src/m7_runtime.rs",
            "rust/crates/er-game/src/m9e_internal_event_v2.rs",
            "rust/crates/er-kernel/src/game_kernel_v6.rs",
            "rust/crates/er-kernel/src/snapshot_v3.rs",
            "rust/crates/er-kernel/src/snapshot_v7.rs",
            "rust/crates/er-kernel/tests/m9e_domain_journeys_v7.rs",
            "rust/crates/er-kernel/tests/m9e_coop_v7.rs"}
        original_paths = {
            "rust/crates/er-game/src/m9e_material_v6.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs",
            "rust/crates/er-game/tests/m9e_material_retention.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs",
            "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs"}
        policy = self.config["material_retention_focus"]
        self.assertEqual(set(policy["paths"]), original_paths | lint_paths)
        self.assertEqual(len(policy["paths"]), 18)
        self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_domain_journeys_v7"]), 12)
        self.assertIn("m9e_domain_journeys_v7", selection["required_native_targets"]["er-kernel"])
        self.assertEqual(set(policy["trigger_paths"]), original_paths - {"rust/crates/er-kernel/src/game_kernel_v7.rs"})
        for lint_path in lint_paths:
            with self.subTest(lint_path=lint_path):
                self.changed = ["rust/crates/er-game/src/m9e_material_v6.rs", lint_path]
                repair = self.feedback.plan()
                self.assertTrue(repair["material_retention_focus"])
                for key in ("execution_scope", "required_native_test_ids", "required_native_targets", "timer_mutant", "replica_mutant"):
                    self.assertEqual(repair[key], selection[key])

    def test_material_retention_rejects_mixed_changes_and_preserves_readiness(self):
        self.configure_material_retention_scope()
        paths = self.config["material_retention_focus"]["paths"]
        for extra in ("rust/crates/er-game/src/lib.rs", "rust/crates/er-game/Cargo.toml", "rust/Cargo.lock",
                      "rust/crates/er-kernel/src/snapshot_v7_extra.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-web/src/host_v2.rs", "rust/crates/er-cli/src/current_commands.rs",
                      "test/browser/rust-browser/m9e-v7-corrective.spec.ts", "unmapped.json",
                      "rust/crates/er-game/src/m6/unmapped.rs", "rust/crates/er-game/src/m7_internal_event_extra.rs",
                      "rust/crates/er-game/src/m9e_internal_event.rs",
                      "rust/crates/er-kernel/src/game_kernel_v6_extra.rs", "rust/crates/er-kernel/src/snapshot_v3_extra.rs",
                      "rust/crates/er-kernel/tests/m9e_domain_journeys_v7_extra.rs",
                      "rust/crates/er-kernel/tests/m9e_coop_v7_extra.rs",
                      "rust/crates/er-cli/src/current_native_capture.rs", "rust/crates/er-cli/tests/m9e_current_native_capture.rs"):
            with self.subTest(extra=extra):
                self.changed = paths + [extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
        self.changed = ["rust/crates/er-kernel/src/game_kernel_v7.rs"]
        ordinary = self.feedback.plan()
        self.assertFalse(ordinary["material_retention_focus"])
        self.assertTrue(ordinary["timer_focus"])
        self.assertEqual(ordinary["execution_scope"], self.config["timer_focus"]["execute"])
        self.changed = ["docs/plans/rust-kernel/m9e-retention-next.md", "scripts/ci/m9e_feedback.py"]
        readiness = self.feedback.plan()
        self.assertFalse(readiness["material_retention_focus"])
        self.assertEqual(readiness["packages"], self.config["readiness_packages"])
        self.assertIsNone(readiness["execution_scope"])
        for flag in ("requires_browser", "requires_wasm", "requires_cli_executable", "requires_worker_executable"):
            self.assertFalse(readiness[flag])

    def test_material_retention_missing_retention_witness_or_consumer_cannot_qualify(self):
        self.configure_material_retention_scope()
        self.changed = ["rust/crates/er-game/tests/m9e_material_retention.rs"]
        selection = self.feedback.plan()
        required = selection["required_native_test_ids"]
        inventory = [(identity.split(":")[0], identity.split(":")[1], ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, inventory)
        for identity in required:
            for omit_target in (True, False):
                with self.subTest(identity=identity, omit_target=omit_target):
                    reduced = [(crate, target, ids[:-1] if f"{crate}:{target}" == identity else ids)
                               for crate, target, ids in inventory if not omit_target or f"{crate}:{target}" != identity]
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(required, reduced)
        targets = selection["required_native_targets"]
        rows = [(crate, target, ["witness"]) for crate, names in targets.items() for target in names]
        self.feedback.required_native_target_counts(targets, rows)
        for index in range(len(rows)):
            with self.assertRaisesRegex(RuntimeError, "required native witness"):
                self.feedback.required_native_target_counts(targets, rows[:index] + rows[index + 1:])

    def test_material_retention_execution_keeps_full_inventory_lint_mutants_and_platforms(self):
        self.configure_material_retention_scope()
        self.changed = self.config["material_retention_focus"]["paths"]
        policy = self.config["material_retention_focus"]
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
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, patch.object(self.feedback, "timer_behavioral_mutant") as mutant, patch.object(self.feedback, "replica_behavioral_mutant") as replica, patch.object(self.feedback, "ledger_behavioral_mutant") as ledger:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        wasm.assert_called_once()
        browser.assert_called_once()
        mutant.assert_called_once()
        replica.assert_called_once()
        ledger.assert_called_once()
        self.assertEqual(summary["native_timer_parity_digest"], "d" * 64)
        parity_execution = next(command for command in self.commands if Path(command[0]).name == "m9e_parity" and "--list" not in command)
        self.assertIn("--nocapture", parity_execution)
        self.assertEqual(len(summary["required_native_target_counts"]), 34)
        self.assertEqual(summary["required_native_target_counts"]["er-kernel:m9e_timers_v7"], 11)
        self.assertEqual(summary["required_native_target_counts"]["er-repro:m9e_current_repro"], 9)
        self.assertEqual(summary["required_native_target_counts"]["er-game:m9e_material_retention"], 3)
        self.assertEqual(summary["required_native_target_counts"]["er-kernel:m9e_material_retention_v7"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-web:er_web"], 5)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_validation"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_native_capture"], 4)
        for lint in ("er-game-clippy", "er-kernel-clippy", "er-batch-clippy", "er-repro-clippy", "er-env-clippy",
                     "cli-clippy", "agent-protocol-clippy", "worker-clippy", "endpoint-clippy", "browser-clippy"):
            self.assertIn(lint, summary["timing_ms"])
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_repro"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-batch:m9e_current_batch"], 6)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_batch"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-agent-protocol:er_agent_protocol"], 5)
        first = [("er-kernel", target) for target in (
            "m9e_game_kernel_v7", "m9e_coop_v7", "m9e_snapshot_v7", "m9e_timers_v7", "m9e_domain_journeys_v7")]
        first[:0] = [("er-game", "m9e_material_retention"), ("er-kernel", "m9e_material_retention_v7")]
        first.extend([("er-wasm", "m9e_parity"), ("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_reload")])
        self.assertEqual([(self.binary_crates[name], self.binary_targets.get(name, name)) for name in self.executed[:10]], first)
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

        self.binary_ids["m9e_material_retention"] = self.binary_ids["m9e_material_retention"][:-1]
        self.executed.clear()
        self.events.clear()
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertIn("required native test identities", summary["first_failure"])
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)

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
            "m9e_timers_v7", "m9e_domain_journeys_v7", "m9e_coop_v7", "m9e_game_kernel_v7", "m9e_snapshot_v7",
            "m9e_material_retention_v7"})
        self.assertEqual(sum(len(names) for names in selection["required_native_targets"].values()), 22)
        self.assertEqual(set(selection["required_native_test_ids"]["er-kernel:m9e_timers_v7"]), {
            "held_navigation_repeats_at_250ms_with_real_cursor_effects",
            "snapshot_resume_and_time_chunking_preserve_ordered_consequences",
            "release_blur_text_focus_and_duplicate_sources_cancel_or_suppress_repeats",
            "menu_transition_retires_repeat_and_stale_snapshot_ownership_is_rejected",
            "pause_reasons_preserve_remaining_delay_until_last_reason_is_removed",
            "unequal_and_tied_deadlines_dispatch_in_chronological_timer_order",
            "exhausted_allocator_and_consequence_budget_fail_atomically",
            "invalid_directional_keyboard_and_gamepad_presses_preserve_full_snapshot",
            "unsupported_later_timer_rolls_back_earlier_real_navigation",
            "transport_resume_preserves_unrelated_pause_reasons_and_clock_classes",
            "staged_transport_generation_remains_paused_and_rejections_are_atomic"})
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertIsNone(selection["ledger_mutant"])
        causal_paths = ["rust/crates/er-kernel/src/game_kernel_v7.rs",
                        "rust/crates/er-kernel/tests/m9e_timers_v7.rs",
                        "rust/crates/er-kernel/tests/m9e_coop_v7.rs"]
        for changed in (causal_paths, causal_paths[:2], [causal_paths[0], causal_paths[2]]):
            with self.subTest(changed=changed):
                self.changed = changed
                combined = self.feedback.plan()
                for key in ("required_native_targets", "required_native_test_ids", "execution_scope",
                            "timer_mutant", "replica_mutant"):
                    self.assertEqual(combined[key], selection[key])
                self.assertFalse(combined["material_retention_focus"])
                self.assertIsNone(combined["ledger_mutant"])
                self.assertTrue(combined["requires_cli_executable"])

    def test_timer_scope_rejects_unmapped_mixed_product_and_lock_changes(self):
        self.configure_timer_scope()
        core = "rust/crates/er-kernel/src/game_kernel_v7.rs"
        for extra in ("rust/crates/er-state/src/lib.rs", "rust/crates/er-protocol/src/lib.rs",
                      "rust/crates/er-kernel/src/snapshot.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-web/src/lib.rs", "test/browser/rust-browser/other.spec.ts",
                      "rust/crates/er-kernel/tests/m9e_timers_v7_extra.rs",
                      "rust/crates/er-kernel/tests/m9e_coop_v7_extra.rs",
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
                                        ("er-kernel:m9e_timers_v7", 11), ("er-kernel:m9e_material_retention_v7", 2),
                                        ("er-cli:m9e_current_native_capture", 4), ("er-cli:m9e_current_validation", 2),
                                        ("er-web:er_web", 5), ("er-web:m9e_host_v2", 14),
                                        ("er-agent-protocol:er_agent_protocol", 5)):
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
                         "er-kernel:m9e_timers_v7", "er-kernel:m9e_material_retention_v7",
                         "er-cli:m9e_current_native_capture", "er-cli:m9e_current_validation",
                         "er-web:er_web", "er-web:m9e_host_v2",
                         "er-agent-protocol:er_agent_protocol"):
            for omit_target in (False, True):
                with self.subTest(identity=identity, omit_target=omit_target):
                    missing = [(crate, target, ids if f"{crate}:{target}" != identity else ids[:-1])
                               for crate, target, ids in inventory
                               if not omit_target or f"{crate}:{target}" != identity]
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(required, missing)
        timer_identity = "er-kernel:m9e_timers_v7"
        for witness in required[timer_identity]:
            for mutation in ("omit", "rename", "duplicate", "wrong-crate"):
                with self.subTest(witness=witness, mutation=mutation):
                    changed = []
                    for crate, target, ids in inventory:
                        actual_ids = list(ids)
                        if f"{crate}:{target}" == timer_identity:
                            if mutation == "omit":
                                actual_ids.remove(witness)
                            elif mutation == "rename":
                                actual_ids[actual_ids.index(witness)] = witness + "_renamed"
                            elif mutation == "duplicate":
                                actual_ids.append(witness)
                            else:
                                crate = "er-other"
                        changed.append((crate, target, actual_ids))
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(required, changed)

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
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, patch.object(self.feedback, "timer_behavioral_mutant") as mutant, patch.object(self.feedback, "replica_behavioral_mutant") as replica, patch.object(self.feedback, "ledger_behavioral_mutant") as ledger:
            code, summary = self.invoke()
        self.assertEqual(code, 0)
        wasm.assert_called_once()
        browser.assert_called_once()
        mutant.assert_called_once()
        replica.assert_called_once()
        ledger.assert_not_called()
        self.assertEqual(summary["native_timer_parity_digest"], "d" * 64)
        parity_execution = next(command for command in self.commands if Path(command[0]).name == "m9e_parity" and "--list" not in command)
        self.assertIn("--nocapture", parity_execution)
        self.assertEqual(len(summary["required_native_target_counts"]), 22)
        for identity, count in (("er-kernel:m9e_timers_v7", 11), ("er-kernel:m9e_material_retention_v7", 2),
                                ("er-cli:m9e_current_native_capture", 4), ("er-cli:m9e_current_validation", 2),
                                ("er-web:er_web", 5), ("er-web:m9e_host_v2", 14)):
            self.assertEqual(summary["required_native_target_counts"][identity], count)
        self.assertEqual(summary["required_native_target_counts"]["er-repro:m9e_current_repro"], 9)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_repro"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-batch:m9e_current_batch"], 6)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_batch"], 2)
        self.assertEqual(summary["required_native_target_counts"]["er-agent-protocol:er_agent_protocol"], 5)
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
                      ("er-other", "m9e_host_v2"), ("er-web", "m9e_host_v2"),
                      ("er-other", "er_web"), ("er-web", "er_web"),
                      ("er-other", "m9e_current_validation"), ("er-cli", "m9e_current_validation")]
        enumerated = [(index, f"binary-{index}", target, [f"test-{index}"], self.rust / "crates" / crate, set(), None)
                      for index, (crate, target) in enumerate(identities)]
        original = list(enumerated)
        ordered = self.feedback.native_execution_order({"timer_focus": True}, enumerated)
        self.assertEqual([(item[4].name, item[2]) for item in ordered], [
            ("er-kernel", "m9e_game_kernel_v7"), ("er-kernel", "m9e_coop_v7"),
            ("er-kernel", "m9e_snapshot_v7"), ("er-kernel", "m9e_timers_v7"),
            ("er-kernel", "m9e_domain_journeys_v7"), ("er-wasm", "m9e_parity"),
            ("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_reload"), ("er-other", "m9e_game_kernel_v7"),
            ("er-other", "m9e_parity"), ("er-other", "m9e_current_reload"), ("er-other", "m9e_host_v2"),
            ("er-other", "er_web"), ("er-web", "er_web"),
                      ("er-other", "m9e_current_validation"), ("er-cli", "m9e_current_validation")])
        self.assertEqual(sorted(item[0] for item in ordered), list(range(len(enumerated))))
        self.assertEqual(enumerated, original)
        for scope in ("cli_reload_focus", "menu_validation_focus", "current_batch_focus"):
            with self.subTest(scope=scope):
                other = self.feedback.native_execution_order({scope: True}, enumerated)
                self.assertEqual(other, [enumerated[1], *enumerated[:1], *enumerated[2:]])
        cache = self.feedback.native_execution_order({"browser_cache_focus": True}, enumerated)
        self.assertEqual(cache, [enumerated[13], enumerated[11], enumerated[1], *enumerated[:1],
                                 *enumerated[2:11], enumerated[12], *enumerated[14:]])
        self.assertEqual(sorted(item[0] for item in cache), list(range(len(enumerated))))
        self.assertEqual(enumerated, original)
        validation = self.feedback.native_execution_order({"current_validation_focus": True}, enumerated)
        self.assertEqual(validation, [enumerated[15], enumerated[1], *enumerated[:1], *enumerated[2:15]])
        self.assertEqual(sorted(item[0] for item in validation), list(range(len(enumerated))))
        self.assertEqual(enumerated, original)
        capture_items = [
            (100, "decoy-capture", "m9e_current_native_capture", ["decoy"], self.rust / "crates/er-other", set(), None),
            *enumerated,
            (101, "capture", "m9e_current_native_capture", ["capture"], self.rust / "crates/er-cli", set(), None)]
        capture_original = list(capture_items)
        capture = self.feedback.native_execution_order({"native_capture_focus": True}, capture_items)
        self.assertEqual(capture, [capture_items[-1], enumerated[1], capture_items[0],
                                   *enumerated[:1], *enumerated[2:]])
        self.assertEqual(capture_items, capture_original)
        self.assertEqual(sorted(item[0] for item in capture), sorted(item[0] for item in capture_items))
        retention_items = [
            (200, "wrong-material", "m9e_material_retention", ["decoy"], self.rust / "crates/er-other", set(), None),
            (201, "wrong-kernel", "m9e_material_retention_v7", ["decoy"], self.rust / "crates/er-game", set(), None),
            *enumerated,
            (202, "material", "m9e_material_retention", ["material"], self.rust / "crates/er-game", set(), None),
            (203, "kernel", "m9e_material_retention_v7", ["kernel"], self.rust / "crates/er-kernel", set(), None)]
        retention_original = list(retention_items)
        retention = self.feedback.native_execution_order({"timer_focus": True, "material_retention_focus": True}, retention_items)
        self.assertEqual(retention, [retention_items[-2], retention_items[-1], *ordered[:8],
                                     retention_items[0], retention_items[1], *ordered[8:]])
        self.assertEqual(retention_items, retention_original)
        self.assertEqual(sorted(item[0] for item in retention), sorted(item[0] for item in retention_items))
        self.assertEqual(self.feedback.native_execution_order({}, enumerated), enumerated)

    def test_ledger_mutant_policy_is_retention_only_and_keeps_both_prior_mutants(self):
        self.configure_material_retention_scope()
        self.changed = self.config["material_retention_focus"]["paths"]
        selection = self.feedback.plan()
        policy = selection["ledger_mutant"]
        self.assertEqual(policy, self.config["material_retention_focus"]["ledger_mutant"])
        self.assertEqual((policy["package"], policy["target"], policy["source"]),
                         ("er-game", "m9e_material_retention", "rust/crates/er-game/src/m9e_material_v6.rs"))
        self.assertEqual(policy["original"], "        ledger.records.remove(0);")
        self.assertEqual(policy["replacement"], "        return Err(GameMaterialV6Error::Ledger);")
        self.assertEqual(policy["test"], "small_suffix_retained_conflicts_late_invalid_and_stale_material_preserve_full_frontier")
        self.assertIn(policy["test"], selection["required_native_test_ids"]["er-game:m9e_material_retention"])
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.changed = ["rust/crates/er-kernel/src/game_kernel_v7.rs"]
        ordinary = self.feedback.plan()
        self.assertTrue(ordinary["timer_focus"])
        self.assertIsNone(ordinary["ledger_mutant"])
        self.changed = ["docs/plans/rust-kernel/m9e-retention-next.md"]
        self.assertIsNone(self.feedback.plan()["ledger_mutant"])

    def invoke_synthetic_timer_mutant(self, mode, mutant="timer", expected_failure_phase=None):
        key = f"{mutant}_mutant"
        label = f"{mutant}-mutant"
        policies = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        policy = (policies["material_retention_focus"]["ledger_mutant"] if mutant == "ledger" else
                  policies["timer_focus"]["mutant" if mutant == "timer" else "replica_mutant"])
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
                    "manifest_path": str(self.rust / "crates" / ("er-other" if mode == "wrong_manifest" else policy["package"]) / "Cargo.toml")}
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
            self.assertEqual(kwargs["timeout"], 120)
            if mode == "timeout":
                raise subprocess.TimeoutExpired(args, 120)
            if mode == "green":
                stdout.write(self.result_line(passed=1))
                return subprocess.CompletedProcess(args, 0)
            assertion = ('assertion `left == right` failed\n  left: []\n right: ["battle/command/fight"]\n'
                         if mutant == "timer" else 'assertion `left == right` failed: ' + policy["assertion_message"] + '\n left: Ok(())\n right: Err(Invalid)\n')
            if mutant == "ledger":
                assertion = ('assertion `left == right` failed: ' + policy["assertion_message"] +
                             '\n left: Some(Material("material V6 applied-material ledger is full or invalid"))\n right: None\n')
                if mode == "wrong_result":
                    assertion = assertion.replace('Some(Material("material V6 applied-material ledger is full or invalid"))', 'Some(Invalid)')
            if mode == "wrong_assertion":
                assertion = "assertion `left == right` failed: unrelated\n"
            panic_name = "another_test" if mode == "wrong_panic" else witness
            stdout.write(f"test {witness} ... FAILED\nthread '{panic_name}' (123) panicked at test.rs:147:5:\n" + assertion + self.result_line(failed=2 if mode == "wrong_counts" else 1))
            return subprocess.CompletedProcess(args, -9 if mode == "crash" else 101)

        try:
            with patch.object(self.feedback, "capture", side_effect=tracked_diff), patch.object(self.feedback, "run", side_effect=mutant_run), patch.object(self.feedback.subprocess, "run", side_effect=mutant_process):
                callback = {"timer": self.feedback.timer_behavioral_mutant,
                            "replica": self.feedback.replica_behavioral_mutant,
                            "ledger": self.feedback.ledger_behavioral_mutant}[mutant]
                callback({key: policy}, summary, [f'{policy["target"]}::{witness}'])
        finally:
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(summary[key]["restored_sha256"], hashlib.sha256(original).hexdigest())
            self.assertEqual(list((self.root / "report").glob(f"m9e-{label}-*")), [])
            if expected_failure_phase is not None:
                self.assertEqual(summary[key]["failure_phase"], expected_failure_phase)
                self.assertEqual(summary[key]["status"], "failed")
        return summary

    def test_ledger_mutant_detects_only_typed_capacity_failure_and_restores_source(self):
        summary = self.invoke_synthetic_timer_mutant("detected", mutant="ledger")
        evidence = summary["ledger_mutant"]
        self.assertEqual(evidence["status"], "detected")
        self.assertEqual(evidence["exit_code"], 101)
        self.assertEqual(evidence["tests"], {"executed": 1, "passed": 0, "failed": 1, "skipped": 0})
        self.assertEqual(evidence["original_sha256"], evidence["restored_sha256"])
        self.assertNotEqual(evidence["original_sha256"], evidence["mutant_sha256"])
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["material_retention_focus"]["ledger_mutant"]
        witness = f'{policy["target"]}::{policy["test"]}'
        for passed in ([], [witness, witness], ["unrelated::" + policy["test"]]):
            with self.assertRaisesRegex(RuntimeError, "passing ordinary behavioral witness"):
                self.feedback.ledger_behavioral_mutant({"ledger_mutant": policy}, {}, passed)
        source = self.root / policy["source"]
        for text in ("unrelated source", policy["original"] * 2):
            source.write_text(text)
            with patch.object(self.feedback, "capture", return_value=""), self.assertRaisesRegex(RuntimeError, "occur exactly once"):
                self.feedback.ledger_behavioral_mutant({"ledger_mutant": policy}, {}, [witness])
            self.assertEqual(source.read_text(), text)

    def test_ledger_mutant_rejects_infrastructure_and_wrong_assertions(self):
        for mode, reason, phase in (
                ("build", "build exited", "build"), ("unknown", "exactly its named", "enumeration"),
                ("timeout", "timed out", "execution"), ("green", "did not fail", "behavioral_assertion"),
                ("crash", "did not fail", "behavioral_assertion"), ("wrong_assertion", "did not fail", "behavioral_assertion"),
                ("wrong_result", "did not fail", "behavioral_assertion"), ("wrong_panic", "did not fail", "behavioral_assertion"),
                ("wrong_counts", "did not fail", "behavioral_assertion"),
                ("wrong_manifest", "exactly one matching", "artifact_validation"),
                ("outside_artifact", "not inside its isolated target tree", "artifact_validation"),
                ("ambiguous_artifact", "exactly one matching", "artifact_validation")):
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, reason):
                self.invoke_synthetic_timer_mutant(mode, mutant="ledger", expected_failure_phase=phase)

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

    def configure_current_storage_scope(self):
        self.configure_browser_worker_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["current_storage_focus"]
        self.config["current_storage_focus"] = policy
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for name in policy["paths"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("current storage source fixture: " + name)
        self.changed = list(policy["paths"])

    def test_current_storage_scope_preserves_causal_worker_and_future_browser_requirements(self):
        self.configure_current_storage_scope()
        import m9e_phases as phases
        paths = ["src/rust-browser/adapters/current-storage-backend.ts", "src/rust-browser/adapters/current-storage-owner.ts",
                 "test/node/rust-browser/engineering/current-storage-owner.test.ts", "test/browser/rust-browser/m9e-current-storage.spec.ts"]
        self.assertEqual(self.config["current_storage_focus"]["paths"], paths)
        for changed in [paths, *[[name] for name in paths], ["rust/crates/er-kernel/src/game_kernel_v7.rs"]]:
            with self.subTest(changed=changed):
                self.changed = changed
                selection = self.feedback.plan()
                for flag in ("requires_current_storage", "requires_browser_worker", "timer_focus", "requires_wasm", "requires_browser",
                             "requires_cli_executable", "requires_worker_executable", "requires_cli_clippy", "requires_agent_protocol_clippy"):
                    self.assertTrue(selection[flag], flag)
                self.assertEqual(selection["execution_scope"], self.config["timer_focus"]["execute"])
                self.assertEqual(selection["required_native_targets"], self.config["timer_focus"]["required_targets"])
                self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 22)
                self.assertEqual(selection["required_native_test_ids"], self.config["timer_focus"]["exact_test_ids"])
                self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
                self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
                self.assertIsNone(selection["ledger_mutant"])
                self.assertIn("er-reverse", selection["packages"])
                self.assertNotIn("er-reverse", selection["execution_scope"])
                self.assertEqual(selection["current_storage_binding"], phases.storage_source_binding(self.root, CANDIDATE))
                self.assertEqual(selection["browser_worker_binding"], phases.browser_worker_source_binding(self.root, CANDIDATE))
        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        with patch.object(phases, "storage_source_binding", side_effect=AssertionError("readiness must not bind adapter")):
            readiness = self.feedback.plan()
        self.assertEqual(readiness["packages"], ["er-canonical"])
        self.assertFalse(readiness["requires_current_storage"])
        self.assertFalse(readiness["requires_browser_worker"])
        self.assertIsNone(readiness["current_storage_binding"])

    def test_current_storage_scope_rejects_mixed_paths_policy_drift_and_missing_sources(self):
        self.configure_current_storage_scope()
        entry = self.changed[0]
        for extra in ("src/rust-browser/adapters/current-storage-other.ts", "src/rust-browser/routes/rust-current-worker-entry.ts",
                      "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-web/src/host_v2.rs",
                      "rust/Cargo.lock", "rust/crates/er-web/Cargo.toml", "pnpm-lock.yaml", "package.json",
                      "test/browser/rust-browser/other.spec.ts", "unknown.json"):
            with self.subTest(extra=extra):
                self.changed = [entry, extra]
                with self.assertRaisesRegex(RuntimeError, "additional mapping"):
                    self.feedback.plan()
        self.changed = [entry]
        for field in ("paths", "node_ids", "browser_ids"):
            original = list(self.config["current_storage_focus"][field])
            self.config["current_storage_focus"][field][0] += "_renamed"
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaisesRegex(RuntimeError, "storage policy identities"):
                self.feedback.plan()
            self.config["current_storage_focus"][field] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        source = self.root / self.config["current_storage_focus"]["paths"][1]
        source.unlink()
        with self.assertRaisesRegex(RuntimeError, "storage source binding path"):
            self.feedback.plan()
        # Each rejected plan checks its comparison object before path/policy
        # validation. No fetch, formatter, build, lint or test may run.
        self.assertEqual(self.commands, [["git", "cat-file", "-e", BASE]] * 14)
        self.assertEqual(self.events, [])
        self.assertEqual(self.executed, [])

    def test_current_storage_node_requires_all_five_exact_nonpending_source_identities(self):
        import m9e_phases as phases
        _, _, _, evidence, report = current_storage_fixture(phases)
        self.assertEqual(self.feedback.storage_node_evidence(report), evidence)
        self.assertEqual(len(phases.STORAGE_NODE_IDS), 5)
        for index in range(5):
            for action in ("missing", "rename", "duplicate", "failed", "pending"):
                with self.subTest(index=index, action=action):
                    bad = copy.deepcopy(report)
                    ids = bad["testResults"][0]["assertionResults"]
                    if action == "missing": ids.pop(index)
                    elif action == "rename": ids[index]["fullName"] += "_renamed"
                    elif action == "duplicate": ids.append(copy.deepcopy(ids[index]))
                    else: ids[index]["status"] = action
                    with self.assertRaisesRegex(RuntimeError, "storage Node"):
                        self.feedback.storage_node_evidence(bad)
        for field, value in (("success", False), ("numTotalTests", True), ("numFailedTests", 1), ("numPendingTests", 1)):
            bad = copy.deepcopy(report)
            bad[field] = value
            with self.assertRaisesRegex(RuntimeError, "storage Node"):
                self.feedback.storage_node_evidence(bad)
        bad = copy.deepcopy(report)
        bad["testResults"][0]["name"] = "test/node/wrong/current-storage-owner.test.ts"
        with self.assertRaisesRegex(RuntimeError, "storage Node"):
            self.feedback.storage_node_evidence(bad)

    def test_current_storage_browser_requires_three_single_attempt_bound_attachments(self):
        import m9e_phases as phases
        binding, expected, report, _, _ = current_storage_fixture(phases)
        self.assertEqual(self.feedback.storage_browser_evidence(report, binding), expected)
        for index in range(3):
            for action in ("missing", "rename", "duplicate", "wrong_file", "failed", "retry", "wrong_project", "attachment"):
                with self.subTest(index=index, action=action):
                    bad = copy.deepcopy(report)
                    specs = bad["suites"][0]["specs"]
                    spec = specs[index]
                    test = spec["tests"][0]
                    if action == "missing": specs.pop(index)
                    elif action == "rename": spec["title"] += "_renamed"
                    elif action == "duplicate": specs.append(copy.deepcopy(spec))
                    elif action == "wrong_file": spec["file"] = "m9e-v7-worker.spec.ts"
                    elif action == "failed": test["results"][0]["status"] = "failed"
                    elif action == "retry": test["results"][0]["retry"] = 1
                    elif action == "wrong_project": test["projectName"] = "firefox"
                    else: test["results"][0]["attachments"] = []
                    with self.assertRaisesRegex(RuntimeError, "storage"):
                        self.feedback.storage_browser_evidence(bad, binding)
        for action in ("oversized", "outside", "invalid_base64", "both", "misplaced"):
            bad = copy.deepcopy(report)
            attachment = bad["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"][0]
            if action == "oversized": attachment["body"] = base64.b64encode(b"x" * 4097).decode()
            elif action == "invalid_base64": attachment["body"] = "!!!!"
            elif action == "both": attachment["path"] = "unused"
            elif action == "misplaced": attachment["name"] = "m9e-current-storage-conflict"
            else:
                path = self.root / "outside.json"
                path.write_text(json.dumps(expected["reconciled"]))
                attachment.pop("body")
                attachment["path"] = str(path)
            with self.subTest(action=action), self.assertRaises((RuntimeError, ValueError)):
                self.feedback.storage_browser_evidence(bad, binding)
        inside = self.root / "test-results/rust-browser/storage.json"
        inside.parent.mkdir(parents=True)
        inside.write_text(json.dumps(expected["reconciled"]))
        attachment = report["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"][0]
        attachment.pop("body")
        attachment["path"] = str(inside)
        self.assertEqual(self.feedback.storage_browser_evidence(report, binding), expected)

    def test_current_storage_causal_proofs_reject_changed_receipts_scope_and_every_expected_fact(self):
        import m9e_phases as phases
        binding, expected, _, _, _ = current_storage_fixture(phases)
        phases.validate_storage_binding(binding, CANDIDATE)
        phases.validate_storage_browser(expected, binding)
        for key in phases.STORAGE_EVIDENCE_KEYS:
            for name, value in expected[key]["evidence"].items():
                bad = copy.deepcopy(expected)
                bad[key]["evidence"][name] = not value if type(value) is bool else value + 1 if type(value) is int else "wrong"
                with self.subTest(key=key, field=name), self.assertRaisesRegex(RuntimeError, "storage causal"):
                    phases.validate_storage_browser(bad, binding)
            for name in ("capability", "source_sha", "source_hashes", "schema_version"):
                bad = copy.deepcopy(expected)
                bad[key][name] = {"wrong": "a" * 64} if name == "source_hashes" else True if name == "schema_version" else "wrong"
                with self.subTest(key=key, field=name), self.assertRaisesRegex(RuntimeError, "storage attachment"):
                    phases.validate_storage_browser(bad, binding)
        bad = copy.deepcopy(expected)
        bad["reconciled"]["evidence"]["writes"] = True
        with self.assertRaisesRegex(RuntimeError, "storage causal"):
            phases.validate_storage_browser(bad, binding)
        bad = copy.deepcopy(binding)
        bad["source_hashes"].pop(phases.STORAGE_SOURCE_PATHS[0])
        with self.assertRaisesRegex(RuntimeError, "storage source identities"):
            phases.validate_storage_binding(bad, CANDIDATE)
        bad = copy.deepcopy(expected)
        bad["reconciled"]["worker_count"] = 1
        with self.assertRaisesRegex(RuntimeError, "storage attachment"):
            phases.validate_storage_browser(bad, binding)

    def test_current_storage_commands_are_separate_source_bound_and_do_not_replace_existing_platform(self):
        self.configure_current_storage_scope()
        import m9e_phases as phases
        summary = {"product_sha": CANDIDATE, "plan": self.feedback.plan()}
        binding, expected, report, node, node_report = current_storage_fixture(phases, summary["plan"]["current_storage_binding"])
        calls = []
        def run_storage(args, name, cwd=None, env=None):
            calls.append((list(args), name, cwd, dict(env) if env else None))
            filename, data = ("current-storage-node-results.json", node_report) if name == "current-storage-node" else ("current-storage-browser-results.json", report)
            (self.full / filename).write_text(json.dumps(data))
            return self.full / (name + ".log")
        environment = {"PLAYWRIGHT_JSON_OUTPUT_FILE": "old-report", "ER_M9E_CLI_SHA256": "f" * 64}
        with patch.object(self.feedback, "run", side_effect=run_storage):
            self.feedback.current_storage_checks(summary, environment)
        self.assertEqual(environment["PLAYWRIGHT_JSON_OUTPUT_FILE"], "old-report")
        self.assertEqual(summary["current_storage_node"], node)
        self.assertEqual(summary["current_storage_browser"], expected)
        self.assertEqual([item[1] for item in calls], ["current-storage-node", "current-storage-browser"])
        self.assertEqual(calls[0][0][:4], ["pnpm", "exec", "vitest", "run"])
        self.assertIn(phases.STORAGE_SOURCE_PATHS[2], calls[0][0])
        self.assertEqual(calls[1][0][:4], ["pnpm", "exec", "playwright", "test"])
        for flag in ("--workers=1", "--project=chromium", "--reporter=line,json", phases.STORAGE_SOURCE_PATHS[3]):
            self.assertIn(flag, calls[1][0])
        self.assertEqual(calls[1][3]["ER_M9E_CLI_SHA256"], "f" * 64)
        source = self.root / phases.STORAGE_SOURCE_PATHS[0]
        source.write_text("tampered after native binding")
        with patch.object(self.feedback, "run", side_effect=AssertionError("changed source must not execute")), \
                self.assertRaisesRegex(RuntimeError, "storage checked-out source"):
            self.feedback.current_storage_checks(summary, environment)
        source.write_text("current storage source fixture: " + phases.STORAGE_SOURCE_PATHS[0])
        def mutate_after_run(args, name, cwd=None, env=None):
            result = run_storage(args, name, cwd, env)
            if name == "current-storage-browser": source.write_text("changed during test")
            return result
        with patch.object(self.feedback, "run", side_effect=mutate_after_run), \
                self.assertRaisesRegex(RuntimeError, "storage witnesses changed"):
            self.feedback.current_storage_checks(summary, environment)

    def test_current_storage_full_browser_orchestration_preserves_worker_codec_and_actual_cli_bridge(self):
        self.configure_current_storage_scope()
        import m9e_phases as phases
        summary = {"product_sha": CANDIDATE, "target": "x86_64-unknown-linux-gnu", "profile": "test",
                   "plan": self.feedback.plan()}
        summary["cli_executable"] = self.feedback.discover_cli_executable([self.cli_executable_artifact()], summary)
        _, bridge, _ = self.bridge_report()
        bridge["executable_sha256"] = summary["cli_executable"]["sha256"]
        old_report = self.bridge_report(bridge)[0]
        _, typed_report = self.browser_reports()
        binding, worker_assets, worker_tests, _ = browser_worker_fixture(phases)
        output = self.root / "runner/m9e-v7-web"
        output.mkdir(parents=True)
        old_assets = {}
        for name in ("er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json",
                     "coop-authority-snapshot.json", "coop-replica-snapshot.json"):
            path = output / name
            path.write_bytes(b"existing browser cohort")
            old_assets[name] = {"bytes": path.stat().st_size, "sha256": self.feedback.digest(path)}
        (output / "m9e-v7-web-assets.json").write_text(json.dumps({"source_sha": CANDIDATE,
            "assets": old_assets, "browser_worker_protocol_version": 2}))
        (self.rust / "rust-toolchain.toml").write_text('[toolchain]\nchannel = "1.97.1"\n')
        codec_report = {"success": True, "numTotalTests": 3, "numPassedTests": 3, "testResults": [{
            "name": "test/node/rust-browser/engineering/current-worker-codec.test.ts",
            "assertionResults": [{"fullName": name, "status": "passed"} for name in phases.WORKER_CODEC_IDS]}]}
        _, storage_tests, storage_report, storage_node, storage_node_report = current_storage_fixture(
            phases, summary["plan"]["current_storage_binding"])
        calls = []
        def run_browser(args, name, cwd=None, env=None):
            calls.append((name, list(args), dict(env) if env else None))
            reports = {"browser-journey": ("browser-results.json", old_report),
                       "browser-effects": ("browser-effect-results.json", typed_report),
                       "browser-worker-codec": ("browser-worker-codec-results.json", codec_report),
                       "browser-worker-journey": ("browser-worker-results.json", browser_worker_report(worker_tests)),
                       "current-storage-node": ("current-storage-node-results.json", storage_node_report),
                       "current-storage-browser": ("current-storage-browser-results.json", storage_report)}
            if name in reports:
                filename, value = reports[name]
                (self.full / filename).write_text(json.dumps(value))
            return self.full / (name + ".log")
        def verified_build(directory, value):
            self.assertEqual(directory, output)
            value["browser_worker_assets"] = worker_assets
        # Asset/source admission has a separate filesystem/hash fault test above;
        # isolate only that step here to observe all existing and added commands.
        summary["plan"]["browser_worker_binding"] = binding
        with patch.dict(os.environ, {"RUNNER_TEMP": str(self.root / "runner")}), \
                patch.object(self.feedback, "run", side_effect=run_browser), \
                patch.object(self.feedback, "verify_browser_worker_build", side_effect=verified_build):
            self.feedback.browser_checks(summary)
        self.assertEqual(summary["browser_current_repro_bridge"], bridge)
        self.assertEqual(summary["browser_tests"]["chromium"]["passed"], 2)
        self.assertEqual(summary["browser_tests"]["typed_effects"]["passed"], 1)
        self.assertEqual(summary["browser_worker_tests"], worker_tests)
        self.assertEqual(summary["browser_worker_codec"]["passed"], 3)
        self.assertEqual([name for name, _, _ in calls], ["browser-dependencies", "browser-build", "browser-chromium-install",
                         "browser-journey", "browser-effects", "browser-worker-codec", "browser-worker-journey", "current-storage-node", "current-storage-browser"])
        self.assertEqual(summary["current_storage_node"], storage_node)
        self.assertEqual(summary["current_storage_browser"], storage_tests)
        storage_env = next(env for name, _, env in calls if name == "current-storage-browser")
        self.assertIn("current-storage-browser-results", storage_env["PLAYWRIGHT_JSON_OUTPUT_FILE"])
        self.assertEqual(storage_env["ER_M9E_CLI_SHA256"], bridge["executable_sha256"])
        build_env = next(env for name, _, env in calls if name == "browser-build")
        self.assertEqual(build_env["M9E_BUILD_CURRENT_WORKER"], "1")
        for name, args, env in calls:
            if name in ("browser-journey", "browser-worker-journey"):
                self.assertIn("--workers=1", args)
                self.assertEqual(env["ER_M9E_CLI_SHA256"], bridge["executable_sha256"])
                self.assertIn("browser-worker-results" if name == "browser-worker-journey" else "browser-results",
                              env["PLAYWRIGHT_JSON_OUTPUT_FILE"])

    def configure_read_rebind_scope(self):
        self.configure_owner_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["current_read_rebind_focus"]
        self.config["current_read_rebind_focus"] = policy
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = list(policy["paths"])

    def test_read_rebind_scope_keeps_original_kernel_ids_owner_and_all_platforms(self):
        self.configure_read_rebind_scope()
        before = copy.deepcopy(self.config)
        selection = self.feedback.plan()
        for flag in ("current_read_rebind_focus", "requires_read_rebind", "requires_current_proposal", "timer_focus",
                     "requires_browser_rtc", "requires_browser_worker", "requires_browser", "requires_wasm",
                     "requires_cli_executable", "requires_worker_executable"):
            self.assertTrue(selection[flag], flag)
        target = "er-kernel:m9e_game_kernel_v7"
        inherited = self.config["timer_focus"]["exact_test_ids"][target]
        self.assertEqual(selection["required_native_test_ids"][target], inherited + self.feedback.READ_REBIND_IDS)
        self.assertEqual(len(inherited), 7)
        self.assertEqual(len(selection["required_native_test_ids"][target]), 12)
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 23)
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(self.config, before)
        for identity, ids in self.config["timer_focus"]["exact_test_ids"].items():
            if identity != target:
                self.assertEqual(selection["required_native_test_ids"][identity], ids)

    def test_read_rebind_installed_witnesses_survive_later_scopes_without_duplication(self):
        self.configure_read_rebind_scope()
        target = "er-kernel:m9e_game_kernel_v7"
        for paths in (["rust/crates/er-kernel/tests/m9e_timers_v7.rs"],
                      self.config["current_proposal_focus"]["paths"]):
            with self.subTest(paths=paths):
                self.changed = list(paths)
                selection = self.feedback.plan()
                self.assertFalse(selection["current_read_rebind_focus"])
                self.assertTrue(selection["requires_read_rebind"])
                self.assertEqual(len(selection["required_native_test_ids"][target]), 12)
                for name in self.feedback.READ_REBIND_IDS:
                    self.assertEqual(selection["required_native_test_ids"][target].count(name), 1)
        self.configure_ai_snapshot_validation_scope()
        selection = self.feedback.plan()
        self.assertTrue(selection["ai_snapshot_validation_focus"])
        self.assertTrue(selection["requires_read_rebind"])
        self.assertEqual(selection["required_native_test_ids"]["er-ai:er_ai"], self.feedback.AI_SNAPSHOT_VALIDATION_IDS)
        self.assertEqual(len(selection["required_native_test_ids"][target]), 12)
        self.changed = ["docs/plans/rust-kernel/m9e-note.md"]
        self.assertFalse(self.feedback.plan()["requires_read_rebind"])

    def test_read_rebind_policy_and_mixed_product_changes_fail_closed(self):
        self.configure_read_rebind_scope()
        original = copy.deepcopy(self.config["current_read_rebind_focus"])
        for mutation in ("path", "id", "extra", "type"):
            with self.subTest(mutation=mutation):
                policy = copy.deepcopy(original)
                if mutation == "path":
                    policy["paths"].append("rust/crates/er-kernel/src/snapshot.rs")
                elif mutation == "id":
                    policy["exact_test_ids"].pop()
                elif mutation == "extra":
                    policy["skip"] = True
                else:
                    policy = True
                self.config["current_read_rebind_focus"] = policy
                (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
                with self.assertRaisesRegex(RuntimeError, "READ rebind policy"):
                    self.feedback.plan()
        self.config["current_read_rebind_focus"] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for extra in ("rust/Cargo.lock", "rust/crates/er-ai/src/authority_v2.rs", "rust/crates/er-kernel/src/snapshot.rs",
                      "src/rust-browser/routes/rust-current-rtc-entry.ts"):
            with self.subTest(extra=extra):
                self.changed = [*original["paths"], extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()

    def test_read_rebind_rejects_omitted_renamed_or_duplicate_added_kernel_witness(self):
        self.configure_read_rebind_scope()
        selection = self.feedback.plan()
        exact = selection["required_native_test_ids"]
        rows = [(*identity.split(":"), ids) for identity, ids in exact.items()]
        self.feedback.require_native_test_ids(exact, rows)
        index = next(index for index, row in enumerate(rows) if row[:2] == ("er-kernel", "m9e_game_kernel_v7"))
        crate, target, ids = rows[index]
        for name in self.feedback.READ_REBIND_IDS:
            for replacement in ([item for item in ids if item != name],
                                [item if item != name else item + "_renamed" for item in ids], [*ids, name]):
                with self.subTest(name=name, replacement=replacement):
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(exact, rows[:index] + [(crate, target, replacement)] + rows[index + 1:])

    def test_read_rebind_execution_requires_all_twelve_kernel_witnesses_before_lint(self):
        self.configure_read_rebind_scope()
        selection = self.feedback.plan()
        self.binary_ids = {}
        for crate, names in selection["execution_scope"].items():
            if "*" in names:
                names = selection["required_native_targets"].get(crate, [crate.replace("-", "_")])
            for name in names:
                binary = name if name not in self.binary_ids else crate + "--" + name
                self.binary_ids[binary] = list(selection["required_native_test_ids"].get(f"{crate}:{name}", ["behavior"]))
                self.binary_crates[binary], self.binary_targets[binary] = crate, name
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                patch.object(self.feedback, "timer_behavioral_mutant") as timer, \
                patch.object(self.feedback, "replica_behavioral_mutant") as replica:
            code, summary = self.invoke()
        self.assertEqual(code, 0, summary)
        if (self.full / "full-summary.json").is_file():
            summary = json.loads((self.full / "full-summary.json").read_text())
        self.assertEqual(summary["required_native_target_counts"]["er-kernel:m9e_game_kernel_v7"], 12)
        self.assertEqual(summary["required_native_target_counts"]["er-web:m9e_host_v2"], 14)
        self.assertEqual(len(summary["required_native_target_counts"]), 23)
        lint = [command for command in self.commands if command[:2] == ["cargo", "clippy"]]
        self.assertEqual(len(lint), 1)
        self.assertEqual([lint[0][index + 1] for index, part in enumerate(lint[0]) if part == "-p"], selection["packages"])
        self.assertLess(self.events.index("clippy"), self.events.index("execute:" + self.executed[0]))
        for control in (wasm, browser, timer, replica):
            control.assert_called_once()
        self.binary_ids["m9e_game_kernel_v7"].pop()
        self.executed.clear()
        self.events.clear()
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)
        self.assertIn("required native test identities", summary["first_failure"])

    def configure_ai_max_pp_scope(self):
        self.configure_owner_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["current_ai_max_pp_focus"]
        self.config["current_ai_max_pp_focus"] = policy
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = list(policy["paths"])

    def test_ai_max_pp_combined_retirement_title_read_storage_owner_keeps_all_fourteen_kernel_ids(self):
        title = self.configure_title_retirement_scope()
        actual = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["current_ai_max_pp_focus"] = actual["current_ai_max_pp_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        target = "er-kernel:m9e_game_kernel_v7"
        expected = (self.config["timer_focus"]["exact_test_ids"][target]
                    + self.feedback.READ_REBIND_IDS + self.feedback.AI_MAX_PP_IDS)
        self.assertEqual(len(expected), 14)
        before = copy.deepcopy(self.config)
        for paths in (self.feedback.AI_MAX_PP_PATHS, self.feedback.TITLE_STORAGE_PATHS, title.PRODUCT_PATHS,
                      self.config["current_worker_storage_focus"]["paths"],
                      self.config["current_proposal_focus"]["paths"]):
            with self.subTest(paths=paths):
                self.changed = list(paths)
                selection = self.feedback.plan()
                self.assertEqual(selection["required_native_test_ids"][target], expected)
                for flag in ("requires_ai_max_pp", "requires_read_rebind", "requires_title_storage", "requires_title_retirement",
                             "requires_current_proposal", "requires_worker_storage", "requires_current_storage",
                             "requires_browser_worker", "requires_browser_rtc", "requires_cli_executable",
                             "requires_worker_executable", "requires_browser", "requires_wasm"):
                    self.assertTrue(selection[flag], flag)
                self.assertEqual(selection["title_storage_binding"], title.source_binding(self.root, CANDIDATE))
                for identity, names in self.feedback.TITLE_STORAGE_IDS.items():
                    self.assertEqual(selection["required_native_test_ids"][identity], names)
                self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
                self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(self.config, before)
        self.assertEqual(self.executed, [])

    def test_ai_max_pp_scope_keeps_original_kernel_ids_owner_and_all_platforms(self):
        self.configure_ai_max_pp_scope()
        before = copy.deepcopy(self.config)
        selection = self.feedback.plan()
        for flag in ("current_ai_max_pp_focus", "requires_ai_max_pp", "requires_current_proposal", "timer_focus",
                     "requires_browser_rtc", "requires_browser_worker", "requires_browser", "requires_wasm",
                     "requires_cli_executable", "requires_worker_executable"):
            self.assertTrue(selection[flag], flag)
        target = "er-kernel:m9e_game_kernel_v7"
        inherited = self.config["timer_focus"]["exact_test_ids"][target]
        self.assertEqual(selection["required_native_test_ids"][target], inherited + self.feedback.AI_MAX_PP_IDS)
        self.assertEqual(len(inherited), 7)
        self.assertEqual(len(selection["required_native_test_ids"][target]), 9)
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 23)
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(self.config, before)
        for identity, ids in self.config["timer_focus"]["exact_test_ids"].items():
            if identity != target:
                self.assertEqual(selection["required_native_test_ids"][identity], ids)

    def test_ai_max_pp_installed_witnesses_survive_later_scopes_without_duplication(self):
        self.configure_ai_max_pp_scope()
        target = "er-kernel:m9e_game_kernel_v7"
        for paths in (["rust/crates/er-kernel/tests/m9e_timers_v7.rs"],
                      self.config["current_proposal_focus"]["paths"]):
            with self.subTest(paths=paths):
                self.changed = list(paths)
                selection = self.feedback.plan()
                self.assertFalse(selection["current_ai_max_pp_focus"])
                self.assertTrue(selection["requires_ai_max_pp"])
                self.assertEqual(len(selection["required_native_test_ids"][target]), 9)
                for name in self.feedback.AI_MAX_PP_IDS:
                    self.assertEqual(selection["required_native_test_ids"][target].count(name), 1)
        self.configure_ai_snapshot_validation_scope()
        selection = self.feedback.plan()
        self.assertTrue(selection["ai_snapshot_validation_focus"])
        self.assertTrue(selection["requires_ai_max_pp"])
        self.assertEqual(selection["required_native_test_ids"]["er-ai:er_ai"], self.feedback.AI_SNAPSHOT_VALIDATION_IDS)
        self.assertEqual(len(selection["required_native_test_ids"][target]), 9)
        self.changed = ["docs/plans/rust-kernel/m9e-note.md"]
        self.assertFalse(self.feedback.plan()["requires_ai_max_pp"])

    def test_ai_max_pp_policy_and_mixed_product_changes_fail_closed(self):
        self.configure_ai_max_pp_scope()
        original = copy.deepcopy(self.config["current_ai_max_pp_focus"])
        for mutation in ("path", "id", "extra", "type"):
            with self.subTest(mutation=mutation):
                policy = copy.deepcopy(original)
                if mutation == "path":
                    policy["paths"].append("rust/crates/er-kernel/src/snapshot.rs")
                elif mutation == "id":
                    policy["exact_test_ids"].pop()
                elif mutation == "extra":
                    policy["skip"] = True
                else:
                    policy = True
                self.config["current_ai_max_pp_focus"] = policy
                (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
                with self.assertRaisesRegex(RuntimeError, "AI max-PP policy"):
                    self.feedback.plan()
        self.config["current_ai_max_pp_focus"] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for extra in ("rust/Cargo.lock", "rust/crates/er-ai/src/authority_v2.rs", "rust/crates/er-kernel/src/snapshot.rs",
                      "src/rust-browser/routes/rust-current-rtc-entry.ts"):
            with self.subTest(extra=extra):
                self.changed = [*original["paths"], extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()

    def test_ai_max_pp_rejects_omitted_renamed_or_duplicate_added_kernel_witness(self):
        self.configure_ai_max_pp_scope()
        selection = self.feedback.plan()
        exact = selection["required_native_test_ids"]
        rows = [(*identity.split(":"), ids) for identity, ids in exact.items()]
        self.feedback.require_native_test_ids(exact, rows)
        index = next(index for index, row in enumerate(rows) if row[:2] == ("er-kernel", "m9e_game_kernel_v7"))
        crate, target, ids = rows[index]
        for name in self.feedback.AI_MAX_PP_IDS:
            for replacement in ([item for item in ids if item != name],
                                [item if item != name else item + "_renamed" for item in ids], [*ids, name]):
                with self.subTest(name=name, replacement=replacement):
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(exact, rows[:index] + [(crate, target, replacement)] + rows[index + 1:])

    def test_ai_max_pp_execution_requires_all_nine_kernel_witnesses_before_lint(self):
        self.configure_ai_max_pp_scope()
        selection = self.feedback.plan()
        self.binary_ids = {}
        for crate, names in selection["execution_scope"].items():
            if "*" in names:
                names = selection["required_native_targets"].get(crate, [crate.replace("-", "_")])
            for name in names:
                binary = name if name not in self.binary_ids else crate + "--" + name
                self.binary_ids[binary] = list(selection["required_native_test_ids"].get(f"{crate}:{name}", ["behavior"]))
                self.binary_crates[binary], self.binary_targets[binary] = crate, name
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                patch.object(self.feedback, "timer_behavioral_mutant") as timer, \
                patch.object(self.feedback, "replica_behavioral_mutant") as replica:
            code, summary = self.invoke()
        self.assertEqual(code, 0, summary)
        if (self.full / "full-summary.json").is_file():
            summary = json.loads((self.full / "full-summary.json").read_text())
        self.assertEqual(summary["required_native_target_counts"]["er-kernel:m9e_game_kernel_v7"], 9)
        self.assertEqual(summary["required_native_target_counts"]["er-web:m9e_host_v2"], 14)
        self.assertEqual(len(summary["required_native_target_counts"]), 23)
        lint = [command for command in self.commands if command[:2] == ["cargo", "clippy"]]
        self.assertEqual(len(lint), 1)
        self.assertEqual([lint[0][index + 1] for index, part in enumerate(lint[0]) if part == "-p"], selection["packages"])
        self.assertLess(self.events.index("clippy"), self.events.index("execute:" + self.executed[0]))
        for control in (wasm, browser, timer, replica):
            control.assert_called_once()
        self.binary_ids["m9e_game_kernel_v7"].pop()
        self.executed.clear()
        self.events.clear()
        code, summary = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(self.executed, [])
        self.assertNotIn("clippy", self.events)
        self.assertIn("required native test identities", summary["first_failure"])

    def configure_owner_scope(self):
        self.configure_browser_rtc_scope()
        import m9e_current_proposal as owner
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        for key in ("current_proposal_focus", "native_capture_focus"):
            self.config[key] = policy[key]
        for package in policy["native_capture_focus"]["execute"]:
            self.package(package)
        for path in owner.OWNER_PATHS:
            source = self.root / path
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("owner source fixture: " + path)
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = list(owner.OWNER_PATHS)
        return owner

    def owner_receipt_fixture(self):
        import m9e_current_proposal as owner
        import m9e_phases as phases
        rtc_binding, assets, tests, cohort = browser_rtc_fixture(phases)
        binding = {"source_sha": CANDIDATE, "source_hashes": {path: "d" * 64 for path in owner.OWNER_PATHS}}
        frame = {"sessionId": "fixture-session", "runId": "opaque-run", "sessionEpoch": 1, "seatMapId": "pair",
                 "membershipRevision": 1, "senderSeatId": 1, "authoritySeatId": 1, "connectionGeneration": 1}
        expected = {"authority_context": frame, "replica_context": {**frame, "senderSeatId": 2},
                    "content_identity": {"fixture": "content"}, "game_run_id": 42, "initial_turn": 0}
        action = {"kind": "BATTLE", "action": {"kind": "SELECT_MOVE", "actor": 2, "move_slot": 0}}
        command = {"schema_version": 1, "context": {"operation_id": "fixture/operation", "authority_seat": 1,
                   "authority_revision": 3, "menu_instance": 7}, "action": action}
        proposal = owner.canonical({"schema_version": 2, "connection_generation": 1, "sender_seat": 2, "proposal": command})
        state = {"schema_version": 6, "content_identity": expected["content_identity"], "identities": {}, "profile": {},
                 "active_run": {"run_id": 42, "battle": {"turn": 1}}}
        transition = {"schema_version": 6, "domain": "BATTLE_TURN", "operation_id": "fixture/operation", "authority_seat": 1,
                      "authority_revision": 3, "content_identity": expected["content_identity"], "accepted_action": action,
                      "before_digest": "blake3-v1:" + "a" * 64, "after_digest": "blake3-v1:" + "b" * 64,
                      "after_state": state, "mutations": [], "rng_audit": [], "next_control": {},
                      "presentation": [{"event_id": 1}, {"event_id": 2}], "platform_effects": []}
        inner = owner.canonical({"kind": "BATTLE_TURN", "value": transition})
        wire = {"kind": "CURRENT_PROPOSAL_MATERIAL_RECEIPT", "schema_version": 1, "authority_context": frame,
                "proposal_hex": proposal.hex(), "proposal_digest": "sha256-json-bytes-v1:" + owner.sha(owner.canonical(list(proposal))),
                "material_hex": inner.hex(), "material_digest": "sha256-json-bytes-v1:" + owner.sha(owner.canonical(list(inner))),
                "material_fingerprint": "blake3-v1:" + "c" * 64}
        raw = owner.canonical(wire)
        positive = tests["positive"]
        positive.update({"proposal_sha256": owner.sha(proposal), "proposal_bytes": len(proposal), "material_sha256": owner.sha(raw),
                         "material_bytes": len(raw), "material_after_digest": transition["after_digest"],
                         "receipt_kind": wire["kind"], "receipt_schema_version": 1, "inner_material_sha256": owner.sha(inner),
                         "inner_material_bytes": len(inner), "receipt_proposal_digest": wire["proposal_digest"],
                         "receipt_material_digest": wire["material_digest"], "receipt_material_fingerprint": wire["material_fingerprint"],
                         "exact_owner_retired": True, "owner_before_kind": "PENDING", "owner_after_kind": None,
                         "owner_publication_replay_sequence": 9, "owner_snapshot_sha256": "e" * 64})
        calls = []
        def primitive(data):
            # This mock proves preimage selection only, never BLAKE3 correctness.
            calls.append(data)
            values = {owner.canonical(list(inner)): "c" * 64, owner.canonical(state): "b" * 64}
            self.assertIn(data, values)
            return values[data]
        provider = {"wheel": dict(owner.WHEEL), "platform": "cp312-linux-x86_64", "vectors": list(owner.VECTORS),
                    "verified_import": True, "download_limit": 512 << 10, "install_timeout": 60, "total_timeout": 120}
        context = {"expected": expected, "primitive": primitive, "provider": provider, "binding": binding, "helper_hash": "f" * 64}
        return owner, raw, tests, context, calls, rtc_binding, assets, cohort

    def test_owner_exact_scope_and_required_native_ids(self):
        owner = self.configure_owner_scope()
        selection = self.feedback.plan()
        self.assertTrue(selection["current_proposal_focus"])
        self.assertEqual(selection["required_native_test_ids"][owner.TARGET], owner.NATIVE_IDS)
        required = owner.merge_targets(self.config["timer_focus"]["required_targets"], self.config["native_capture_focus"]["required_targets"],
                                       {"er-kernel": ["m9e_current_proposal_v7"]})
        self.assertEqual(selection["required_native_targets"], required)
        self.assertEqual(sum(map(len, required.values())), 25)
        self.assertIn("*", selection["execution_scope"]["er-kernel"])
        self.assertIn("er-reverse", selection["packages"])
        for flag in ("requires_current_proposal", "requires_browser_rtc", "requires_browser_worker", "requires_browser",
                     "requires_wasm", "requires_cli_executable", "requires_worker_executable", "timer_focus"):
            self.assertTrue(selection[flag], flag)
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertNotIn(("er-kernel", "m9e_current_proposal_v7"), self.feedback.WORKER_BOUND_TARGETS)

    def test_owner_in_page_receipt_companion_is_bound_and_cannot_expand_or_disappear(self):
        owner = self.configure_owner_scope()
        companion = "test/browser/rust-browser/m9e-v7-corrective.spec.ts"
        self.assertIn(companion, owner.OWNER_PATHS)
        self.changed = [owner.OWNER_TRIGGERS[0], companion]
        selection = self.feedback.plan()
        self.assertTrue(selection["requires_current_proposal"])
        self.assertIn(companion, selection["owner_source_binding"]["source_hashes"])
        self.assertEqual(len(selection["owner_source_binding"]["source_hashes"]), 9)
        self.changed.append("test/browser/rust-browser/m9e-v7-corrective-other.spec.ts")
        with self.assertRaisesRegex(RuntimeError, "exclusive mixed"):
            self.feedback.plan()
        self.changed = [owner.OWNER_TRIGGERS[0], companion]
        self.config["current_proposal_focus"]["paths"].remove(companion)
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        with self.assertRaisesRegex(RuntimeError, "policy identities"):
            self.feedback.plan()

    def test_owner_installed_preserves_paired_ai_snapshot_scope_and_exact_obligations(self):
        owner = self.configure_owner_scope()
        self.configure_ai_snapshot_validation_scope()
        selection = self.feedback.plan()
        self.assertTrue(selection["ai_snapshot_validation_focus"])
        self.assertTrue(selection["requires_current_proposal"])
        self.assertFalse(selection["current_proposal_focus"])
        self.assertTrue(selection["requires_browser_rtc"])
        self.assertEqual(selection["required_native_test_ids"][owner.TARGET], owner.NATIVE_IDS)
        self.assertEqual(selection["required_native_test_ids"]["er-ai:er_ai"], self.feedback.AI_SNAPSHOT_VALIDATION_IDS)
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 24)
        for identity, ids in self.config["timer_focus"]["exact_test_ids"].items():
            self.assertEqual(selection["required_native_test_ids"][identity], ids)
        self.changed.append(owner.OWNER_TRIGGERS[0])
        with self.assertRaisesRegex(RuntimeError, "exclusive mixed"):
            self.feedback.plan()

    def test_owner_kernel_lint_failure_precedes_execution_and_success_keeps_full_cone(self):
        self.configure_owner_scope()
        selection = self.feedback.plan()
        self.binary_ids = {}
        for crate, names in selection["execution_scope"].items():
            if "*" in names:
                names = selection["required_native_targets"].get(crate, [crate.replace("-", "_")])
            for name in names:
                binary = name if name not in self.binary_ids else crate + "--" + name
                self.binary_ids[binary] = selection["required_native_test_ids"].get(f"{crate}:{name}", ["behavior"])
                self.binary_crates[binary], self.binary_targets[binary] = crate, name
        self.binary_ids["reverse_compiled_only"] = ["reverse"]
        self.binary_crates["reverse_compiled_only"] = "er-reverse"
        self.binary_targets["reverse_compiled_only"] = "reverse_compiled_only"
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        for lint_failure in (True, False):
            with self.subTest(lint_failure=lint_failure):
                self.clippy_codes = {"er-kernel": 1} if lint_failure else {}
                self.executed.clear()
                self.events.clear()
                self.commands.clear()
                with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                        patch.object(self.feedback, "timer_behavioral_mutant") as timer, \
                        patch.object(self.feedback, "replica_behavioral_mutant") as replica, \
                        patch.object(self.feedback, "collect_clippy_failure_diagnostics") as diagnostics:
                    code, summary = self.invoke()
                if (self.full / "full-summary.json").is_file():
                    summary = json.loads((self.full / "full-summary.json").read_text())
                self.assertEqual(code, 1 if lint_failure else 0)
                self.assertEqual(len(summary["required_native_target_counts"]), 25)
                lint = [command for command in self.commands if command[:2] == ["cargo", "clippy"]]
                self.assertEqual(len(lint), 1)
                self.assertEqual([lint[0][index + 1] for index, part in enumerate(lint[0]) if part == "-p"], selection["packages"])
                self.assertEqual(lint[0][-5:], ["--all-targets", "--no-deps", "--", "-D", "warnings"])
                if lint_failure:
                    self.assertIn("selected-packages-clippy", summary["first_failure"])
                    self.assertEqual(self.executed, [])
                    self.assertEqual(summary["tests"]["executed"], 0)
                    diagnostics.assert_called_once()
                    for control in (wasm, browser, timer, replica):
                        control.assert_not_called()
                else:
                    self.assertIn("m9e_current_proposal_v7", self.executed)
                    self.assertNotIn("reverse_compiled_only", self.executed)
                    self.assertLess(self.events.index("clippy"), self.events.index("execute:" + self.executed[0]))
                    count = sum(len(self.binary_ids[name]) for name in self.executed)
                    self.assertEqual(summary["tests"], {"selected": count, "executed": count, "passed": count, "failed": 0, "skipped": 0})
                    diagnostics.assert_not_called()
                    for control in (wasm, browser, timer, replica):
                        control.assert_called_once()

    def test_owner_exclusive_mixed_scope_rejects_before_overlap(self):
        owner = self.configure_owner_scope()
        for extra in ("rust/crates/er-ai/src/lib.rs", "src/rust-browser/worker/current-rust-kernel-worker.ts"):
            self.changed = [owner.OWNER_TRIGGERS[0], extra]
            with self.assertRaisesRegex(RuntimeError, "exclusive mixed"):
                self.feedback.plan()
        self.assertEqual(self.executed, [])
        self.assertFalse(any("build" in command for command in self.commands))

    def test_owner_shared_existing_scope_retains_checks(self):
        owner = self.configure_owner_scope()
        self.changed = ["rust/crates/er-kernel/tests/m9e_timers_v7.rs"]
        before = self.feedback.plan()
        # The existing timer scope requires its explicit causal trigger;
        # an isolated co-op test path is intentionally not a new product scope.
        self.changed = ["rust/crates/er-kernel/tests/m9e_timers_v7.rs",
                        "rust/crates/er-kernel/tests/m9e_coop_v7.rs"]
        after = self.feedback.plan()
        self.assertFalse(after["current_proposal_focus"])
        self.assertTrue(after["requires_current_proposal"])
        for key in ("timer_mutant", "replica_mutant", "timer_focus", "requires_agent_protocol_clippy", "requires_cli_clippy"):
            self.assertEqual(after[key], before[key], key)
        for crate, targets in self.config["timer_focus"]["required_targets"].items():
            self.assertTrue(set(targets) <= set(after["required_native_targets"][crate]))
        self.assertEqual(after["required_native_test_ids"][owner.TARGET], owner.NATIVE_IDS)

    def test_owner_actual_selected_target_requires_rtc_without_diff(self):
        owner = self.configure_owner_scope()
        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        self.config["readiness_packages"] = ["er-kernel"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        selection = self.feedback.plan()
        inventory = [{"crate": "er-kernel", "target": "m9e_current_proposal_v7", "ids": owner.NATIVE_IDS}]
        owner.validate_obligations(selection, inventory, CANDIDATE)
        for mutation in ({"requires_current_proposal": False}, {"requires_browser_rtc": False}, {"required_native_test_ids": {}}):
            with self.assertRaises(RuntimeError):
                owner.validate_obligations({**selection, **mutation}, inventory, CANDIDATE)
        with self.assertRaises(RuntimeError):
            owner.validate_obligations(selection, [], CANDIDATE)

    def test_owner_receipt_attachment_exact_cardinality_and_bounds(self):
        owner, raw, tests, context, _, binding, assets, cohort = self.owner_receipt_fixture()
        report = browser_rtc_report(tests)
        attachments = report["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"]
        receipt = {"name": owner.RECEIPT_NAME, "contentType": "application/octet-stream", "body": base64.b64encode(raw).decode()}
        attachments.append(receipt)
        evidence = self.feedback.browser_worker_result_evidence(report, assets, binding, rtc=True, cohort_assets=cohort, owner_context=context)
        self.assertIn("receipt_oracle", evidence)
        for bad in (attachments[:1], attachments + [receipt], [attachments[0], {**receipt, "path": "escape"}],
                    [attachments[0], {**receipt, "contentType": "application/json"}],
                    [attachments[0], {**receipt, "body": "A" * (4 * ((owner.RECEIPT_LIMIT + 2) // 3) + 1)}]):
            with self.assertRaises(RuntimeError):
                owner.receipt_attachment(bad, self.root, True)
        with self.assertRaises(RuntimeError):
            owner.receipt_attachment(attachments, self.root, False)
        with self.assertRaises(RuntimeError):
            self.feedback.browser_worker_result_evidence(report, assets, binding, rtc=True, cohort_assets=cohort)

    def test_owner_receipt_canonical_hex_and_identity_mutations(self):
        owner, raw, tests, context, _, _, _, _ = self.owner_receipt_fixture()
        wire = json.loads(raw)
        mutations = [{**wire, "unknown": 1}, {**wire, "schema_version": True}, {**wire, "proposal_hex": wire["proposal_hex"].upper()},
                     {**wire, "material_hex": "0"}, {**wire, "proposal_digest": "sha256-json-bytes-v1:" + "0" * 64},
                     {**wire, "authority_context": {**wire["authority_context"], "runId": "wrong"}},
                     {**wire, "authority_context": {**wire["authority_context"], "sessionEpoch": True}}]
        for mutated in mutations:
            with self.assertRaises((RuntimeError, AssertionError)):
                owner.receipt_oracle(owner.canonical(mutated), tests["positive"], **context)
        for data in (raw + b"\n", b'{"x":1,"x":2}', b'{"x":9007199254740992}', b'{"x":1.0}', b'{"x":NaN}'):
            with self.assertRaises(RuntimeError):
                owner.parse(data, owner.RECEIPT_LIMIT)
        for key, value in (("game_run_id", 41), ("content_identity", {"fixture": "other"})):
            changed = {**context, "expected": {**context["expected"], key: value}}
            with self.assertRaises(RuntimeError):
                owner.receipt_oracle(raw, tests["positive"], **changed)

    def test_owner_receipt_oracle_uses_exact_independent_preimages(self):
        owner, raw, tests, context, calls, _, _, _ = self.owner_receipt_fixture()
        evidence = owner.receipt_oracle(raw, tests["positive"], **context)
        wire = json.loads(raw)
        inner = bytes.fromhex(wire["material_hex"])
        state = json.loads(inner)["value"]["after_state"]
        self.assertEqual(calls, [owner.canonical(list(inner)), owner.canonical(state)])
        self.assertNotIn(inner, calls)
        self.assertEqual(evidence["observed"]["material_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(evidence["observed"]["inner_material_sha256"], hashlib.sha256(inner).hexdigest())
        self.assertLessEqual(len(owner.canonical(evidence)), 4096)
        with self.assertRaises(RuntimeError):
            owner.receipt_oracle(raw, tests["positive"], **{**context, "primitive": lambda _: "0" * 64})

    def test_owner_remote_wheel_download_and_install_fail_closed(self):
        import m9e_current_proposal as owner
        import zipfile
        package = b"# verified synthetic provider for installer failure tests only\n"
        name = "blake3/__init__.py"
        record = name + ",sha256=" + base64.urlsafe_b64encode(hashlib.sha256(package).digest()).rstrip(b"=").decode() + "," + str(len(package)) + "\nblake3-1.0.8.dist-info/RECORD,,\n"
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr(name, package)
            archive.writestr("blake3-1.0.8.dist-info/RECORD", record)
        data = payload.getvalue()
        wheel = {**owner.WHEEL, "bytes": len(data), "sha256": owner.sha(data)}
        class Response(io.BytesIO):
            status = 200
            def geturl(self):
                return wheel["url"]
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "GITHUB_RUN_ID": "42"}), \
                patch.object(owner.sys, "version_info", (3, 12)), patch.object(owner.platform, "system", return_value="Linux"), \
                patch.object(owner.platform, "machine", return_value="x86_64"), \
                patch.object(owner.urllib.request, "build_opener") as opener, patch.object(owner.subprocess, "run") as install:
            opener.return_value.open.return_value = Response(data)
            with self.assertRaisesRegex(RuntimeError, "wheel byte/hash pin"):
                owner.prepare_provider(True, self.root, self.full)
            install.assert_not_called()
            with patch.object(owner, "WHEEL", wheel):
                opener.return_value.open.return_value = Response(data)
                install.return_value = SimpleNamespace(returncode=1)
                with self.assertRaisesRegex(RuntimeError, "install failed"):
                    owner.prepare_provider(True, self.root, self.full)
                args, kwargs = install.call_args
                self.assertIn("--no-index", args[0])
                self.assertIn("--isolated", args[0])
                self.assertIn("--no-deps", args[0])
                self.assertGreater(kwargs["timeout"], 0)
                self.assertLessEqual(kwargs["timeout"], 60)
                opener.return_value.open.return_value = Response(data)
                install.side_effect = subprocess.TimeoutExpired("pip", 60)
                with self.assertRaises(subprocess.TimeoutExpired):
                    owner.prepare_provider(True, self.root, self.full)
            with patch.dict(owner.sys.modules, {"blake3": SimpleNamespace()}):
                with self.assertRaisesRegex(RuntimeError, "preloaded"):
                    owner.prepare_provider(True, self.root, self.full)

        self.assertEqual(list(self.root.glob("m9e-owner-blake3-*")), [])
        with patch.object(owner.signal, "getsignal", return_value="previous"), \
                patch.object(owner.signal, "getitimer", return_value=(0, 0)), \
                patch.object(owner.signal, "signal") as handler, patch.object(owner.signal, "setitimer") as timer:
            with self.assertRaisesRegex(TimeoutError, "wall deadline"):
                with owner.deadline(30):
                    callback = handler.call_args.args[1]
                    callback(None, None)
            self.assertEqual(timer.call_args_list[0].args, (owner.signal.ITIMER_REAL, 30))
            self.assertEqual(timer.call_args_list[-1].args, (owner.signal.ITIMER_REAL, 0))
            self.assertEqual(handler.call_args_list[-1].args, (owner.signal.SIGALRM, "previous"))

    def test_owner_verified_wheel_empty_marker_keeps_exact_byte_checks(self):
        import m9e_current_proposal as owner
        import zipfile
        members = {"blake3/__init__.py": b"# synthetic installer fixture\n", "blake3/py.typed": b""}
        record = "".join(name + ",sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
                         + "," + str(len(data)) + "\n" for name, data in members.items())
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            for name, data in members.items():
                archive.writestr(name, data)
            archive.writestr("blake3-1.0.8.dist-info/RECORD", record + "blake3-1.0.8.dist-info/RECORD,,\n")
        raw = payload.getvalue()
        wheel = {**owner.WHEEL, "bytes": len(raw), "sha256": owner.sha(raw)}
        class Response(io.BytesIO):
            status = 200
            def geturl(self):
                return wheel["url"]
        for mutation in (None, "empty-module", "nonempty-marker"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory(dir=self.root) as temporary:
                work = Path(temporary)
                def install(args, **kwargs):
                    target = Path(args[args.index("--target") + 1])
                    for name, data in members.items():
                        path = target / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(b"" if mutation == "empty-module" and name.endswith(".py") else
                                         b"changed" if mutation == "nonempty-marker" and name.endswith("py.typed") else data)
                    return SimpleNamespace(returncode=0)
                with patch.object(owner, "WHEEL", wheel), patch.object(owner.urllib.request, "build_opener") as opener, \
                        patch.object(owner.subprocess, "run", side_effect=install), \
                        patch.object(owner.importlib, "import_module", side_effect=RuntimeError("verified files reached import")) as imported:
                    opener.return_value.open.return_value = Response(raw)
                    expected = "verified files reached import" if mutation is None else (
                        "regular file byte bound" if mutation == "empty-module" else "installed provider differs")
                    with self.assertRaisesRegex(RuntimeError, expected):
                        owner.install_provider(work, self.full)
                    self.assertEqual(imported.call_count, 1 if mutation is None else 0)
                marker = work / "site/blake3/py.typed"
                marker.write_bytes(b"")
                with self.assertRaisesRegex(RuntimeError, "regular file byte bound"):
                    owner.bounded_file(marker, work, 16 << 20)

    def test_owner_dependency_is_platform_required_only(self):
        import m9e_current_proposal as owner
        with patch.object(owner.urllib.request, "build_opener") as network, patch.object(owner.subprocess, "run") as install:
            self.assertIsNone(owner.prepare_provider(False, self.root, self.full))
            with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}):
                with self.assertRaisesRegex(RuntimeError, "remote runner"):
                    owner.prepare_provider(True, self.root, self.full)
            network.assert_not_called()
            install.assert_not_called()
        source = HARNESS.read_text()
        self.assertEqual(source.count("prepare_provider(True,"), 1)
        browser = source[source.index("def browser_checks("):source.index("def timer_behavioral_mutant(")]
        self.assertIn('if summary["plan"].get("requires_current_proposal"):', browser)
        self.assertNotIn("prepare_provider(", HARNESS.with_name("m9e_phases.py").read_text())

    def test_owner_pending_snapshot_is_explicit_producer_evidence(self):
        owner, raw, tests, context, _, _, _, _ = self.owner_receipt_fixture()
        projection = owner.receipt_oracle(raw, tests["positive"], **context)
        self.assertFalse(projection["independent_full_snapshot"])
        self.assertEqual(projection["pending_snapshot_evidence"], "source-bound-browser-producer")
        self.assertEqual(projection["runtime_ledger_evidence"], "source-bound-browser-producer")
        for key, value in (("independent_full_snapshot", True), ("pending_snapshot_evidence", "independent"),
                           ("runtime_ledger_evidence", "independent")):
            with self.assertRaises(RuntimeError):
                owner.validate_projection({**projection, key: value}, tests["positive"], context["binding"], context["helper_hash"])
        for key, value in (("owner_before_kind", None), ("owner_after_kind", "PENDING"), ("exact_owner_retired", False),
                           ("owner_publication_replay_sequence", True), ("owner_snapshot_sha256", "")):
            with self.assertRaises(RuntimeError):
                owner.validate_owner_fields({**tests["positive"], key: value})

    def test_owner_platform_source_and_asset_revalidation(self):
        owner = self.configure_owner_scope()
        before = owner.source_binding(self.root, CANDIDATE)
        path = self.root / owner.OWNER_PATHS[0]
        path.write_text("changed after native source capture")
        self.assertNotEqual(owner.source_binding(self.root, CANDIDATE), before)
        path.unlink()
        with self.assertRaises((RuntimeError, FileNotFoundError)):
            owner.source_binding(self.root, CANDIDATE)
        owner, _, _, context, _, _, _, _ = self.owner_receipt_fixture()
        expected = context["expected"]
        initial = {"schema_version": 6, "content_identity": expected["content_identity"], "active_run": {"run_id": 42, "battle": {"turn": 0}}}
        assets = {}
        for name, role, frame, peer in (("coop-authority-snapshot.json", "AUTHORITY", expected["authority_context"], 2),
                                        ("coop-replica-snapshot.json", "REPLICA", expected["replica_context"], 1)):
            raw = owner.canonical({"protocol": {"role": role, "frame_context": {"context": frame}, "connections": [{"peer_seat": peer}]},
                                   "lifecycle": {"kind": "ACTIVE", "value": initial}})
            (self.root / name).write_bytes(raw)
            assets[name] = {"bytes": len(raw), "sha256": owner.sha(raw)}
        self.assertEqual(owner.fixture_identity(self.root, assets), expected)
        (self.root / "coop-replica-snapshot.json").write_bytes(b"{}")
        with self.assertRaisesRegex(RuntimeError, "fixture asset"):
            owner.fixture_identity(self.root, assets)
        outside = self.root.parent / "outside-owner-fixture"
        with self.assertRaises((RuntimeError, FileNotFoundError)):
            owner.bounded_file(outside, self.root, 4096)

    def test_owner_aggregate_requires_all_causal_obligations(self):
        owner, raw, tests, context, _, binding, assets, cohort = self.owner_receipt_fixture()
        import m9e_phases as phases
        tests["receipt_oracle"] = owner.receipt_oracle(raw, tests["positive"], **context)
        phases.validate_browser_rtc_tests(tests, assets, binding, cohort, owner_binding=context["binding"], owner_helper_hash=context["helper_hash"])
        for key in ("negative", "receipt_oracle"):
            bad = copy.deepcopy(tests)
            bad.pop(key)
            with self.assertRaises(RuntimeError):
                phases.validate_browser_rtc_tests(bad, assets, binding, cohort, owner_binding=context["binding"], owner_helper_hash=context["helper_hash"])
        for section, key, value in (("negative", "worker_closed", False), ("positive", "left_kernel_delivered", 1)):
            bad = copy.deepcopy(tests)
            bad[section][key] = value
            with self.assertRaises(RuntimeError):
                phases.validate_browser_rtc_tests(bad, assets, binding, cohort, owner_binding=context["binding"], owner_helper_hash=context["helper_hash"])
        bad = copy.deepcopy(tests)
        bad["receipt_oracle"]["provider"]["wheel"]["sha256"] = "0" * 64
        with self.assertRaises(RuntimeError):
            owner.legacy_rtc_view(bad, context["binding"], context["helper_hash"])
        with self.assertRaises(RuntimeError):
            owner.legacy_rtc_view(tests, context["binding"], "0" * 64)
    def configure_title_retirement_scope(self):
        import m9e_title_storage as title
        self.configure_title_storage_core_scope()
        self.config["current_title_retirement_focus"] = title.policy()
        for name in title.SOURCE_PATHS:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("retirement source: " + name)
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = list(title.PRODUCT_PATHS)
        return title

    def test_title_retirement_plan_keeps_all_native_and_prior_platform_requirements(self):
        title = self.configure_title_retirement_scope()
        selection = self.feedback.plan()
        for flag in ("current_title_retirement_focus", "requires_title_retirement", "requires_title_storage",
                     "requires_current_proposal", "requires_read_rebind", "requires_worker_storage", "requires_current_storage",
                     "requires_browser_worker", "requires_browser_rtc", "requires_wasm", "requires_browser", "requires_cli_executable",
                     "requires_worker_executable", "timer_focus"):
            self.assertTrue(selection[flag], flag)
        self.assertFalse(selection["boundary_paths"])
        self.assertFalse(selection["unknown_paths"])
        self.assertEqual(selection["title_storage_binding"], title.source_binding(self.root, CANDIDATE))
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 55)
        for identity, ids in self.feedback.TITLE_STORAGE_IDS.items():
            self.assertEqual(selection["required_native_test_ids"][identity], ids)
        self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_game_kernel_v7"]), 12)
        self.assertEqual(len(selection["required_native_test_ids"]["er-web:m9e_host_v2"]), 14)
        self.assertIsNotNone(selection["timer_mutant"])
        self.assertIsNotNone(selection["replica_mutant"])

    def test_title_retirement_plan_rejects_removed_policy_and_incomplete_installed_product(self):
        title = self.configure_title_retirement_scope()
        original = copy.deepcopy(self.config)
        for replacement in ({}, {**title.policy(), "node_ids": title.NODE_IDS[:5]}, {**title.policy(), "paths": title.PRODUCT_PATHS[:-1]}):
            self.config["current_title_retirement_focus"] = replacement
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaisesRegex(RuntimeError, "Title retirement"):
                self.feedback.plan()
        self.config = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        missing = self.root / title.PRODUCT_PATHS[3]
        missing.unlink()
        with self.assertRaisesRegex(RuntimeError, "bounded regular"):
            self.feedback.plan()

    def test_title_retirement_installed_plan_persists_after_owner_change_and_does_not_hide_unknown_paths(self):
        title = self.configure_title_retirement_scope()
        self.changed = [title.PRODUCT_PATHS[0]]
        selection = self.feedback.plan()
        self.assertTrue(selection["current_title_retirement_focus"])
        self.assertTrue(selection["requires_title_retirement"])
        self.changed = ["rust/crates/er-kernel/src/snapshot_v7.rs"]
        selection = self.feedback.plan()
        self.assertFalse(selection["current_title_retirement_focus"])
        self.assertTrue(selection["requires_title_retirement"])
        self.changed = [*title.PRODUCT_PATHS, "src/unmapped-title-path.ts"]
        with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping") as failure:
            self.feedback.plan()
        selection = json.loads(str(failure.exception).split(": ", 1)[1])
        self.assertFalse(selection["current_title_retirement_focus"])
        self.assertIn("src/unmapped-title-path.ts", selection["unknown_paths"])
        self.assertTrue(selection["requires_title_retirement"])
    def configure_title_storage_core_scope(self):
        self.configure_composition_after_read_and_owner()
        actual = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["current_title_storage_focus"] = actual["current_title_storage_focus"]
        self.package("er-testkit")
        self.package("er-title-reverse", '[dependencies]\nkit = { package = "er-testkit", path = "../er-testkit" }\n')
        for name in self.feedback.TITLE_STORAGE_PATHS:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("current Title source fixture: " + name)
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = list(self.feedback.TITLE_STORAGE_PATHS)

    def test_title_storage_core_requires_all_new_ingress_and_historical_bootstrap_witnesses(self):
        self.configure_title_storage_core_scope()
        before = copy.deepcopy(self.config)
        selection = self.feedback.plan()
        self.assertEqual(len(self.feedback.TITLE_STORAGE_PATHS), 15)
        self.assertEqual(len(self.feedback.TITLE_STORAGE_TRIGGERS), 4)
        for flag in ("current_title_storage_focus", "requires_title_storage", "requires_current_proposal", "requires_read_rebind",
                     "requires_worker_storage", "requires_current_storage", "requires_browser_worker", "requires_browser_rtc",
                     "requires_wasm", "requires_browser", "requires_cli_executable", "requires_worker_executable", "timer_focus"):
            self.assertTrue(selection[flag], flag)
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 55)
        for identity, ids in self.feedback.TITLE_STORAGE_IDS.items():
            self.assertEqual(selection["required_native_test_ids"][identity], ids)
            self.assertIn(identity.split(":")[1], selection["required_native_targets"][identity.split(":")[0]])
        self.assertEqual([len(ids) for ids in self.feedback.TITLE_STORAGE_IDS.values()], [6, 2, 2, 8])
        self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_game_kernel_v7"]), 12)
        self.assertEqual(len(selection["required_native_test_ids"]["er-web:m9e_host_v2"]), 14)
        self.assertIn("quiescent_v6_snapshot_migrates_without_gameplay_side_effects", selection["required_native_test_ids"]["er-kernel:m9e_snapshot_v7"])
        self.assertIn("game_save_v2_restores_every_control_kind", selection["required_native_test_ids"]["er-kernel:m9e_domain_journeys_v7"])
        self.assertIn("er-title-reverse", selection["packages"])
        self.assertNotIn("er-title-reverse", selection["execution_scope"])
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(self.config, before)

    def test_title_lint_companions_keep_all_packages_targets_and_serialization_witnesses(self):
        self.configure_title_storage_core_scope()
        for crate in self.feedback.TITLE_STORAGE_LINT_TARGETS:
            self.package(crate)
        self.package("er-lint-reverse", '[dependencies]\ncontracts = { package = "er-dev-types", path = "../er-dev-types" }\n')
        self.changed += self.feedback.TITLE_STORAGE_LINT_PATHS
        selection = self.feedback.plan()
        self.assertTrue(selection["current_title_storage_focus"])
        self.assertEqual(len(self.feedback.TITLE_STORAGE_LINT_PATHS), 7)
        self.assertIn("er-lint-reverse", selection["packages"])
        self.assertNotIn("er-lint-reverse", selection["execution_scope"])
        for crate, targets in self.feedback.TITLE_STORAGE_LINT_TARGETS.items():
            self.assertEqual(selection["execution_scope"][crate], ["*"])
            self.assertEqual(selection["required_native_targets"][crate], targets)
        for identity, names in {**self.feedback.TITLE_STORAGE_IDS, **self.feedback.TITLE_STORAGE_LINT_IDS}.items():
            self.assertEqual(selection["required_native_test_ids"][identity], names)
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 64)
        for flag in ("requires_title_storage", "requires_current_proposal", "requires_read_rebind",
                     "requires_worker_storage", "requires_current_storage", "requires_browser_worker", "requires_browser_rtc",
                     "requires_wasm", "requires_browser", "requires_cli_executable", "requires_worker_executable"):
            self.assertTrue(selection[flag], flag)
        self.assertEqual(self.executed, [])

    def test_title_lint_mapping_rejects_policy_drift_and_unmapped_neighbors(self):
        self.configure_title_storage_core_scope()
        original = copy.deepcopy(self.config["current_title_storage_focus"])
        for key in ("lint_paths", "lint_targets", "lint_ids"):
            self.config["current_title_storage_focus"] = copy.deepcopy(original)
            self.config["current_title_storage_focus"].pop(key)
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaisesRegex(RuntimeError, "policy identities"):
                self.feedback.plan()
        self.config["current_title_storage_focus"] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for neighbor in ("rust/crates/er-content/src/other.rs", "rust/crates/er-dev-types/src/digest.rs",
                         "rust/crates/er-mechanics/src/lib.rs", "rust/crates/er-dev-types/Cargo.toml"):
            self.changed = [*self.feedback.TITLE_STORAGE_PATHS, *self.feedback.TITLE_STORAGE_LINT_PATHS, neighbor]
            with self.assertRaisesRegex(RuntimeError, "additional mapping"):
                self.feedback.plan()
        exact = self.feedback.TITLE_STORAGE_LINT_IDS
        rows = [(*identity.split(":"), names) for identity, names in exact.items()]
        self.feedback.require_native_test_ids(exact, rows)
        for index, (crate, target, names) in enumerate(rows):
            for name in names:
                for replacement in ([item for item in names if item != name],
                                    [item if item != name else item + "_renamed" for item in names], [*names, name]):
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(exact, rows[:index] + [(crate, target, replacement)] + rows[index + 1:])
        self.assertEqual(self.executed, [])

    def test_title_storage_core_policy_missing_mapping_and_mixed_changes_fail_closed(self):
        self.configure_title_storage_core_scope()
        original = copy.deepcopy(self.config["current_title_storage_focus"])
        for mutation in ("paths", "trigger_paths", "exact_test_ids", "extra", "type", "absent"):
            with self.subTest(mutation=mutation):
                policy = copy.deepcopy(original)
                if mutation in ("paths", "trigger_paths"):
                    policy[mutation].pop()
                elif mutation == "exact_test_ids":
                    policy[mutation]["er-kernel:m9e_title_storage"].pop()
                elif mutation == "extra":
                    policy["skip"] = True
                elif mutation == "type":
                    policy = True
                else:
                    policy = {}
                self.config["current_title_storage_focus"] = policy
                (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
                with self.assertRaisesRegex(RuntimeError, "policy identities|additional mapping"):
                    self.feedback.plan()
        self.config["current_title_storage_focus"] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        for extra in ("rust/Cargo.lock", "rust/crates/er-game/src/current_bootstrap_other.rs",
                      "rust/crates/er-ai/src/authority_v2.rs", "src/rust-browser/routes/rust-current-storage-entry.ts",
                      "src/rust-browser/routes/rust-current-rtc-entry.ts", "package.json"):
            self.changed = [*self.feedback.TITLE_STORAGE_PATHS, extra]
            with self.assertRaisesRegex(RuntimeError, "additional mapping|mixed source scope"):
                self.feedback.plan()
        for trigger in self.feedback.TITLE_STORAGE_TRIGGERS:
            self.changed = [trigger]
            self.assertTrue(self.feedback.plan()["current_title_storage_focus"])
        self.assertEqual(self.executed, [])

    def test_title_storage_core_exact_test_inventory_rejects_every_omission_rename_and_duplicate(self):
        self.configure_title_storage_core_scope()
        selection = self.feedback.plan()
        exact = selection["required_native_test_ids"]
        rows = [(*identity.split(":"), ids) for identity, ids in exact.items()]
        self.feedback.require_native_test_ids(exact, rows)
        for identity, names in self.feedback.TITLE_STORAGE_IDS.items():
            index = next(index for index, row in enumerate(rows) if ":".join(row[:2]) == identity)
            crate, target, ids = rows[index]
            for name in names:
                for replacement in ([item for item in ids if item != name],
                                    [item if item != name else item + "_renamed" for item in ids], [*ids, name]):
                    with self.subTest(identity=identity, name=name, replacement=replacement):
                        with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                            self.feedback.require_native_test_ids(exact, rows[:index] + [(crate, target, replacement)] + rows[index + 1:])

    def test_title_storage_core_remains_required_for_later_snapshot_owner_read_and_composition(self):
        self.configure_title_storage_core_scope()
        self.configure_ai_snapshot_validation_scope()
        snapshots = list(self.config["ai_snapshot_validation_focus"]["paths"])
        for paths, count in ((snapshots, 28), (self.config["current_proposal_focus"]["paths"], 29),
                             (self.config["current_read_rebind_focus"]["paths"], 27),
                             (self.config["current_worker_storage_focus"]["paths"], 55)):
            self.changed = list(paths)
            selection = self.feedback.plan()
            self.assertTrue(selection["requires_title_storage"])
            self.assertFalse(selection["current_title_storage_focus"])
            self.assertEqual(sum(map(len, selection["required_native_targets"].values())), count)
            for target, ids in self.feedback.TITLE_STORAGE_IDS.items():
                self.assertEqual(selection["required_native_test_ids"][target], ids)
            self.assertTrue(selection["requires_current_proposal"])
            self.assertTrue(selection["requires_read_rebind"])
            self.assertTrue(selection["requires_worker_storage"])
        self.changed = ["docs/plans/rust-kernel/m9e-readiness.md"]
        selection = self.feedback.plan()
        self.assertFalse(selection["requires_title_storage"])
        self.assertEqual(selection["packages"], ["er-canonical"])

    def test_title_storage_core_full_clippy_and_execution_preserve_required_counts_and_controls(self):
        self.configure_title_storage_core_scope()
        selection = self.feedback.plan()
        self.binary_ids = {}
        for crate, targets in selection["execution_scope"].items():
            if "*" in targets:
                targets = selection["required_native_targets"].get(crate, [crate.replace("-", "_")])
            for target in targets:
                binary = target if target not in self.binary_ids else crate + "--" + target
                self.binary_ids[binary] = selection["required_native_test_ids"].get(f"{crate}:{target}", ["behavior"])
                self.binary_crates[binary], self.binary_targets[binary] = crate, target
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        for fail in (True, False):
            self.clippy_codes["er-testkit"] = 1 if fail else 0
            self.executed.clear()
            self.events.clear()
            self.commands.clear()
            with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                    patch.object(self.feedback, "timer_behavioral_mutant") as timer, patch.object(self.feedback, "replica_behavioral_mutant") as replica, \
                    patch.object(self.feedback, "collect_clippy_failure_diagnostics") as diagnostics:
                code, summary = self.invoke()
            if (self.full / "full-summary.json").is_file():
                summary = json.loads((self.full / "full-summary.json").read_text())
            self.assertEqual(code, 1 if fail else 0)
            lint = [args for args in self.commands if args[:2] == ["cargo", "clippy"]]
            self.assertEqual(len(lint), 1)
            self.assertEqual([lint[0][index + 1] for index, word in enumerate(lint[0]) if word == "-p"], selection["packages"])
            if fail:
                self.assertEqual(self.executed, [])
                diagnostics.assert_called_once()
                for check in (wasm, browser, timer, replica):
                    check.assert_not_called()
            else:
                self.assertEqual(len(summary["required_native_target_counts"]), 55)
                for target, ids in self.feedback.TITLE_STORAGE_IDS.items():
                    self.assertEqual(summary["required_native_target_counts"][target], len(ids))
                self.assertEqual([(self.binary_crates[name], self.binary_targets[name]) for name in self.executed[:4]],
                                 [(crate, target) for crate, targets in self.feedback.TITLE_STORAGE_TARGETS.items() for target in targets])
                diagnostics.assert_not_called()
                for check in (wasm, browser, timer, replica):
                    check.assert_called_once()

    def configure_composition_after_read_and_owner(self):
        self.configure_worker_storage_composition_scope()
        self.configure_read_rebind_scope()
        import m9e_worker_storage as composition
        self.changed = list(composition.PRODUCT_PATHS)

    def test_worker_storage_composition_keeps_installed_owner_and_read_requirements(self):
        self.configure_composition_after_read_and_owner()
        import m9e_current_proposal as owner
        import m9e_worker_storage as composition
        import m9e_phases as phases
        before = copy.deepcopy(self.config)
        selection = self.feedback.plan()
        self.assertTrue(selection["current_worker_storage_focus"])
        self.assertFalse(selection["ai_damage_query_focus"])
        self.assertFalse(selection["current_proposal_focus"])
        self.assertFalse(selection["current_read_rebind_focus"])
        for flag in ("requires_current_proposal", "requires_read_rebind", "requires_worker_storage",
                     "requires_current_storage", "requires_browser_rtc", "requires_browser_worker",
                     "requires_cli_executable", "requires_worker_executable", "requires_wasm", "requires_browser"):
            self.assertTrue(selection[flag], flag)
        self.assertEqual(selection["required_native_test_ids"][owner.TARGET], owner.NATIVE_IDS)
        kernel = "er-kernel:m9e_game_kernel_v7"
        inherited = self.config["ai_damage_query_focus"]
        for target, ids in inherited["exact_test_ids"].items():
            self.assertEqual(selection["required_native_test_ids"][target],
                             ids + self.feedback.READ_REBIND_IDS if target == kernel else ids)
        self.assertEqual(len(selection["required_native_test_ids"][kernel]), 12)
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 51)
        self.assertEqual(selection["worker_storage_binding"], composition.source_binding(self.root, CANDIDATE))
        self.assertEqual(selection["owner_source_binding"], owner.source_binding(self.root, CANDIDATE))
        self.assertEqual(phases.IDENTITY_FILES["worker_storage"], "scripts/ci/m9e_worker_storage.py")
        self.assertEqual(phases.IDENTITY_FILES["owner_helper"], owner.HELPER_PATH)
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(self.config, before)
        exact = selection["required_native_test_ids"]
        rows = [(*target.split(":"), ids) for target, ids in exact.items()]
        self.feedback.require_native_test_ids(exact, rows)
        for target, names in ((owner.TARGET, owner.NATIVE_IDS), (kernel, self.feedback.READ_REBIND_IDS)):
            for name in names:
                with self.subTest(target=target, name=name):
                    missing = [(crate, test, [item for item in ids if item != name] if f"{crate}:{test}" == target else ids)
                               for crate, test, ids in rows]
                    with self.assertRaisesRegex(RuntimeError, "required native test identities"):
                        self.feedback.require_native_test_ids(exact, missing)

    def test_worker_storage_composition_accepts_exact_adapter_prerequisites_without_dropping_obligations(self):
        self.configure_composition_after_read_and_owner()
        import m9e_worker_storage as composition
        import m9e_current_proposal as owner
        import m9e_phases as phases
        baseline = self.feedback.plan()
        together = [*composition.PRODUCT_PATHS, *phases.STORAGE_SOURCE_PATHS]
        for changed in (together, *[[*composition.PRODUCT_PATHS, path] for path in phases.STORAGE_SOURCE_PATHS]):
            with self.subTest(changed=changed):
                self.changed = changed
                selection = self.feedback.plan()
                self.assertTrue(selection["current_worker_storage_focus"])
                for key in ("required_native_targets", "required_native_test_ids", "execution_scope", "packages"):
                    self.assertEqual(selection[key], baseline[key], key)
                for flag in ("requires_current_proposal", "requires_read_rebind", "requires_worker_storage",
                             "requires_current_storage", "requires_browser_rtc", "requires_browser_worker",
                             "requires_cli_executable", "requires_worker_executable", "requires_wasm", "requires_browser"):
                    self.assertTrue(selection[flag], flag)
                self.assertEqual(selection["current_storage_binding"], phases.storage_source_binding(self.root, CANDIDATE))
                self.assertEqual(selection["worker_storage_binding"], composition.source_binding(self.root, CANDIDATE))
                self.assertEqual(selection["owner_source_binding"], owner.source_binding(self.root, CANDIDATE))
        for unknown in ("src/rust-browser/adapters/current-storage-migration.ts", "rust/Cargo.lock",
                        "rust/crates/er-kernel/src/game_kernel_v7.rs"):
            self.changed = [*together, unknown]
            with self.assertRaises(RuntimeError):
                self.feedback.plan()
        self.changed = together
        for name in phases.STORAGE_SOURCE_PATHS:
            source = self.root / name
            saved = source.read_bytes()
            try:
                source.unlink()
                with self.assertRaises(RuntimeError):
                    self.feedback.plan()
            finally:
                source.write_bytes(saved)

    def test_worker_storage_composition_survives_later_owner_and_snapshot_scopes(self):
        self.configure_composition_after_read_and_owner()
        for paths in (self.config["current_proposal_focus"]["paths"], self.config["current_read_rebind_focus"]["paths"]):
            self.changed = list(paths)
            selection = self.feedback.plan()
            self.assertTrue(selection["requires_worker_storage"])
            self.assertTrue(selection["requires_current_proposal"])
            self.assertTrue(selection["requires_read_rebind"])
            self.assertFalse(selection["current_worker_storage_focus"])
            self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_game_kernel_v7"]), 12)
        self.configure_ai_snapshot_validation_scope()
        selection = self.feedback.plan()
        self.assertTrue(selection["ai_snapshot_validation_focus"])
        self.assertTrue(selection["requires_worker_storage"])
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 24)
        self.assertEqual(selection["required_native_test_ids"]["er-ai:er_ai"], self.feedback.AI_SNAPSHOT_VALIDATION_IDS)
        import m9e_worker_storage as composition
        for additional in (self.config["current_proposal_focus"]["paths"],
                           self.config["current_read_rebind_focus"]["paths"],
                           self.config["ai_snapshot_validation_focus"]["paths"]):
            self.changed = list(composition.PRODUCT_PATHS) + list(additional)
            with self.assertRaisesRegex(RuntimeError, "additional mapping|current owner: exclusive mixed source scope"):
                self.feedback.plan()
        self.changed = ["docs/plans/rust-kernel/m9e-readiness.md"]
        selection = self.feedback.plan()
        for flag in ("requires_worker_storage", "requires_current_proposal", "requires_read_rebind"):
            self.assertFalse(selection[flag], flag)

    def test_worker_storage_composition_runs_full_selected_clippy_before_combined_witnesses(self):
        self.configure_composition_after_read_and_owner()
        selection = self.feedback.plan()
        self.binary_ids = {}
        for crate, targets in selection["execution_scope"].items():
            if "*" in targets:
                targets = selection["required_native_targets"].get(crate, [crate.replace("-", "_")])
            for target in targets:
                binary = target if target not in self.binary_ids else crate + "--" + target
                self.binary_ids[binary] = selection["required_native_test_ids"].get(f"{crate}:{target}", ["behavior"])
                self.binary_crates[binary] = crate
                self.binary_targets[binary] = target
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))
        for fail in (True, False):
            with self.subTest(fail=fail):
                self.clippy_codes["er-kernel"] = 1 if fail else 0
                self.commands.clear()
                self.executed.clear()
                self.events.clear()
                with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                        patch.object(self.feedback, "timer_behavioral_mutant") as timer, patch.object(self.feedback, "replica_behavioral_mutant") as replica, \
                        patch.object(self.feedback, "collect_clippy_failure_diagnostics") as diagnostics:
                    code, summary = self.invoke()
                if (self.full / "full-summary.json").is_file():
                    summary = json.loads((self.full / "full-summary.json").read_text())
                self.assertEqual(code, 1 if fail else 0)
                command = next(args for args in self.commands if args[:2] == ["cargo", "clippy"])
                self.assertEqual(command, ["cargo", "clippy", "--locked",
                    *[part for crate in selection["packages"] for part in ("-p", crate)],
                    "--all-targets", "--no-deps", "--", "-D", "warnings"])
                if fail:
                    diagnostics.assert_called_once()
                    self.assertEqual(self.executed, [])
                    wasm.assert_not_called()
                    browser.assert_not_called()
                    timer.assert_not_called()
                    replica.assert_not_called()
                else:
                    diagnostics.assert_not_called()
                    self.assertEqual(summary["required_native_target_counts"]["er-kernel:m9e_game_kernel_v7"], 12)
                    self.assertEqual(summary["required_native_target_counts"]["er-kernel:m9e_current_proposal_v7"], 2)
                    self.assertEqual(len(summary["required_native_target_counts"]), 51)
                    self.assertLess(self.events.index("clippy"), min(index for index, event in enumerate(self.events) if event.startswith("execute:")))
                    wasm.assert_called_once()
                    browser.assert_called_once()
                    timer.assert_called_once()
                    replica.assert_called_once()

    def configure_worker_storage_composition_scope(self):
        self.configure_ai_damage_query_scope()
        self.configure_browser_rtc_scope()
        self.configure_current_storage_scope()
        import m9e_worker_storage as composition
        actual = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["current_worker_storage_focus"] = actual["current_worker_storage_focus"]
        for name in [*composition.SOURCE_PATHS, "rust/crates/er-game/tests/m9e_damage_query.rs"]:
            source = self.root / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("composition mock source: " + name)
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = list(composition.PRODUCT_PATHS)

    def test_worker_storage_scope_preserves_ai_causal_reverse_and_future_platform(self):
        self.configure_worker_storage_composition_scope()
        import m9e_worker_storage as composition
        for changed in [composition.PRODUCT_PATHS, *[[path] for path in composition.PRODUCT_PATHS]]:
            self.changed = changed
            selection = self.feedback.plan()
            self.assertTrue(selection["current_worker_storage_focus"])
            self.assertFalse(selection["ai_damage_query_focus"])
            self.assertEqual(selection["required_native_targets"], self.config["ai_damage_query_focus"]["required_targets"])
            self.assertEqual(selection["required_native_test_ids"], self.config["ai_damage_query_focus"]["exact_test_ids"])
            self.assertEqual(selection["execution_scope"], self.config["ai_damage_query_focus"]["execute"])
            self.assertIn("er-web", selection["packages"])
            self.assertIn("er-target-reverse", selection["packages"])
            self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
            self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
            for key in ("requires_worker_storage", "requires_browser_worker", "requires_browser_rtc", "requires_current_storage",
                        "requires_wasm", "requires_browser", "requires_cli_executable", "requires_worker_executable"):
                self.assertTrue(selection[key], key)
        self.changed = ["rust/crates/er-kernel/src/game_kernel_v7.rs"]
        self.assertTrue(self.feedback.plan()["requires_worker_storage"])
        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        with patch.object(composition, "source_binding", side_effect=AssertionError("readiness cannot read new sources")):
            self.assertFalse(self.feedback.plan()["requires_worker_storage"])

    def test_worker_storage_scope_rejects_mixing_missing_product_and_policy_drift(self):
        self.configure_worker_storage_composition_scope()
        import m9e_worker_storage as composition
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/Cargo.lock", "pnpm-lock.yaml",
                      "src/rust-browser/adapters/current-storage-migration.ts", "scripts/build-kernel-m9e-v7-web.mjs", "unknown.json"):
            self.changed = [composition.PRODUCT_PATHS[0], extra]
            with self.assertRaisesRegex(RuntimeError, "additional mapping"):
                self.feedback.plan()
        self.changed = list(composition.PRODUCT_PATHS)
        source = self.root / "rust/crates/er-game/tests/m9e_damage_query.rs"
        source.unlink()
        with self.assertRaisesRegex(RuntimeError, "previously qualified AI"):
            self.feedback.plan()
        source.write_text("restored mock prerequisite")
        for key in ("paths", "test_ids"):
            original = self.config["current_worker_storage_focus"][key][:]
            self.config["current_worker_storage_focus"][key][0] += "_renamed"
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaisesRegex(RuntimeError, "composition policy"):
                self.feedback.plan()
            self.config["current_worker_storage_focus"][key] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        (self.root / composition.PRODUCT_PATHS[1]).unlink()
        with self.assertRaisesRegex(RuntimeError, "bounded regular"):
            self.feedback.plan()


    def configure_control_query_scope(self):
        self.configure_browser_worker_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        for scope in ("current_control_query_focus", "native_capture_focus", "current_repro_focus",
                      "current_batch_focus", "browser_cache_focus", "current_validation_focus"):
            self.config[scope] = policy[scope]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-query-consumer", '[dependencies]\ner-cli = { path = "../er-cli" }\n')
        self.changed = list(self.config["current_control_query_focus"]["paths"])

    def test_control_query_scope_keeps_causal_inventory_and_every_platform_requirement(self):
        self.configure_control_query_scope()
        import m9e_phases as phases
        policy = self.config["current_control_query_focus"]
        self.assertEqual(policy["paths"], ["rust/crates/er-cli/src/current_agent.rs",
                                          "rust/crates/er-cli/tests/m9e_current_control_query.rs"])
        self.assertEqual(policy["test_ids"], phases.CONTROL_QUERY_TEST_IDS)
        original = copy.deepcopy(self.config)
        for changed in (policy["paths"], policy["paths"][:1], policy["paths"][1:]):
            self.changed = list(changed) + ["docs/plans/rust-kernel/m9e-control-query.md"]
            selection = self.feedback.plan()
            for flag in ("current_control_query_focus", "requires_current_control_query", "timer_focus",
                         "requires_browser_worker", "requires_browser", "requires_wasm", "requires_worker_executable",
                         "requires_cli_executable", "requires_cli_clippy", "requires_agent_protocol_clippy"):
                self.assertTrue(selection[flag], flag)
            self.assertEqual(selection["execution_scope"], self.config["timer_focus"]["execute"])
            self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 23)
            for identity, ids in self.config["timer_focus"]["exact_test_ids"].items():
                self.assertEqual(selection["required_native_test_ids"][identity], ids)
            self.assertEqual(selection["required_native_test_ids"]["er-cli:m9e_current_control_query"], policy["test_ids"])
            self.assertEqual(selection["required_native_targets"]["er-cli"].count("m9e_current_control_query"), 1)
            self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
            self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
            self.assertIsNone(selection["ledger_mutant"])
            self.assertIsNone(selection["worker_lock_guard"])
            self.assertIn("er-query-consumer", selection["packages"])
            self.assertNotIn("er-query-consumer", selection["execution_scope"])
            self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertEqual(self.config, original)
        self.assertEqual(phases.LANE_B_TARGETS, {("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_repro"),
                                                ("er-cli", "m9e_current_reload"), phases.STATE_QUERY_WORKER_TARGET})
        self.assertEqual(len(phases.WORKER_TEST_IDS), 2)
        self.assertEqual(len(phases.WORKER_CODEC_IDS), 3)

    def test_control_query_mixed_paths_reject_and_existing_dispatcher_overlap_keeps_its_scope(self):
        self.configure_control_query_scope()
        witness = "rust/crates/er-cli/tests/m9e_current_control_query.rs"
        for extra in ("rust/crates/er-cli/src/current_commands.rs", "rust/crates/er-cli/src/current_native_capture.rs",
                      "rust/crates/er-cli/tests/m9e_current_native_capture.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-repro/src/current.rs",
                      "rust/crates/er-batch/src/current.rs", "rust/crates/er-cli/Cargo.toml", "rust/Cargo.lock",
                      "src/rust-browser/worker/current-rust-kernel-worker.ts", "unknown.json"):
            with self.subTest(extra=extra):
                self.changed = [witness, extra]
                with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                    self.feedback.plan()
                self.assertFalse(json.loads((self.full / "plan.json").read_text())["current_control_query_focus"])
        path = self.root / witness
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("actual target exists in later source")
        for scope, trigger in (("native_capture_focus", "rust/crates/er-cli/src/current_native_capture.rs"),
                               ("current_repro_focus", "rust/crates/er-repro/src/current.rs"),
                               ("current_batch_focus", "rust/crates/er-batch/src/current.rs")):
            self.changed = ["rust/crates/er-cli/src/current_agent.rs", trigger]
            selection = self.feedback.plan()
            self.assertFalse(selection["current_control_query_focus"])
            self.assertTrue(selection[scope], scope)
            self.assertEqual(selection["execution_scope"], self.config[scope]["execute"])
            self.assertTrue(selection["requires_current_control_query"])
            self.assertTrue(selection["requires_worker_executable"])

    def test_control_query_binding_follows_selected_target_and_preserves_readiness(self):
        self.configure_control_query_scope()
        import m9e_phases as phases
        source = self.root / phases.CONTROL_QUERY_PATHS[1]
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("later target exists")
        for changed in (["rust/crates/er-kernel/src/game_kernel_v7.rs"],
                        ["rust/crates/er-cli/src/current_commands.rs"],
                        ["rust/crates/er-cli/tests/another_current_target.rs"]):
            self.changed = changed
            selection = self.feedback.plan()
            self.assertFalse(selection["current_control_query_focus"])
            self.assertTrue(selection["requires_current_control_query"])
            self.assertTrue(selection["requires_worker_executable"])
            self.assertEqual(selection["required_native_test_ids"]["er-cli:m9e_current_control_query"], phases.CONTROL_QUERY_TEST_IDS)
        self.changed = ["docs/plans/rust-kernel/m9e-control-query.md", "scripts/ci/m9e_feedback.py"]
        selection = self.feedback.plan()
        self.assertEqual(selection["packages"], self.config["readiness_packages"])
        for flag in ("requires_current_control_query", "current_control_query_focus", "requires_worker_executable",
                     "requires_cli_executable", "requires_browser_worker", "requires_browser", "requires_wasm"):
            self.assertFalse(selection[flag], flag)
        self.changed = ["rust/crates/er-cli/src/current_commands.rs"]
        self.config["current_session_focus"]["execute"]["er-cli"] = ["m9e_current_entry"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.assertFalse(self.feedback.plan()["requires_current_control_query"])
        source.unlink()
        self.config["current_session_focus"]["execute"]["er-cli"] = ["m9e_current_control_query"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.assertTrue(self.feedback.plan()["requires_current_control_query"])

    def test_control_query_policy_and_exact_inventory_cannot_silently_weaken(self):
        self.configure_control_query_scope()
        import m9e_phases as phases
        original = copy.deepcopy(self.config["current_control_query_focus"])
        for field, value in (("paths", original["paths"] + ["rust/crates/er-cli/src/main.rs"]),
                             ("test_ids", original["test_ids"][:1]), ("test_ids", ["renamed", "wrong"])):
            self.config["current_control_query_focus"] = {**original, field: value}
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaisesRegex(RuntimeError, "control query policy identities"):
                self.feedback.plan()
        self.config["current_control_query_focus"] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        selection = self.feedback.plan()
        required = selection["required_native_test_ids"]
        rows = [(identity.split(":")[0], identity.split(":")[1], ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, rows)
        for identity in required:
            for mode in ("absent", "empty", "renamed", "duplicate"):
                modified = [(crate, target, ([] if mode == "empty" else ["renamed"] if mode == "renamed"
                                             else ids + ids[:1]) if f"{crate}:{target}" == identity else ids)
                            for crate, target, ids in rows if mode != "absent" or f"{crate}:{target}" != identity]
                with self.subTest(identity=identity, mode=mode), self.assertRaisesRegex(RuntimeError, "required native test identities"):
                    self.feedback.require_native_test_ids(required, modified)
        source = self.root / phases.CONTROL_QUERY_PATHS[1]
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("target exists")
        self.config.pop("current_control_query_focus")
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = ["rust/crates/er-cli/src/current_commands.rs"]
        with self.assertRaisesRegex(RuntimeError, "requires its exact policy"):
            self.feedback.plan()

    def control_query_mock_inventory(self, selection):
        self.binary_ids = {}
        for crate, names in selection["execution_scope"].items():
            if "*" in names:
                names = selection["required_native_targets"].get(crate, [crate.replace("-", "_")])
            for target in names:
                binary = target if target not in self.binary_ids else crate + "--" + target
                self.binary_ids[binary] = selection["required_native_test_ids"].get(f"{crate}:{target}", ["behavior"])
                self.binary_crates[binary] = crate
                self.binary_targets[binary] = target
        self.extra_artifacts = [self.worker_executable_artifact(), self.cli_executable_artifact()]
        self.results["m9e_parity"] = (0, "M9E_TIMER_PARITY_DIGEST=" + "d" * 64 + "\n" + self.result_line(passed=2))

    def test_control_query_orchestration_discovers_and_lints_before_bound_process_execution(self):
        self.configure_control_query_scope()
        selection = self.feedback.plan()
        self.control_query_mock_inventory(selection)
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                patch.object(self.feedback, "timer_behavioral_mutant") as timer, \
                patch.object(self.feedback, "replica_behavioral_mutant") as replica:
            code, summary = self.invoke()
        self.assertEqual(code, 0, summary.get("first_failure"))
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_control_query"], 2)
        self.assertEqual(len(summary["required_native_target_counts"]), 23)
        self.assertEqual(self.executed[0], "m9e_current_control_query")
        self.assertLess(max(index for index, event in enumerate(self.events) if event.startswith("list:")), self.events.index("clippy"))
        first = self.events.index("execute:m9e_current_control_query")
        for index, event in enumerate(self.events):
            if event.startswith("clippy:"):
                self.assertLess(index, first)
        for lint in ("cli-clippy", "agent-protocol-clippy", "er-env-clippy", "er-repro-clippy",
                     "worker-clippy", "endpoint-clippy", "browser-clippy"):
            self.assertIn(lint, summary["timing_ms"])
        query_environments = [(phase, env) for name, phase, env in self.binary_envs if name == "m9e_current_control_query"]
        self.assertEqual([phase for phase, _ in query_environments], ["list", "execute"])
        for _, env in query_environments:
            self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
            self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], summary["worker_executable"]["sha256"])
            self.assertEqual(env["ER_M9E_WORKER_BUILD_PROFILE"], "test")
        self.assertIn("m9e_current_control_query::worker_control_queries_bind_current_control_and_preserve_rejections",
                      timer.call_args.args[2])
        timer.assert_called_once()
        replica.assert_called_once()
        wasm.assert_called_once()
        browser.assert_called_once()
        self.assertIsNone(self.feedback.native_target_env("er-other", "m9e_current_control_query", None))
        with self.assertRaisesRegex(RuntimeError, "no bound worker"):
            self.feedback.native_target_env("er-cli", "m9e_current_control_query", None)

    def test_control_query_orchestration_rejects_missing_worker_witness_and_early_lint_failure(self):
        self.configure_control_query_scope()
        selection = self.feedback.plan()
        self.control_query_mock_inventory(selection)
        original_ids = list(self.binary_ids["m9e_current_control_query"])
        original_artifacts = list(self.extra_artifacts)
        for failure in ("worker", "witness", "lint"):
            self.executed.clear()
            self.events.clear()
            self.binary_envs.clear()
            self.extra_artifacts = original_artifacts[1:] if failure == "worker" else original_artifacts
            self.binary_ids["m9e_current_control_query"] = original_ids[:1] if failure == "witness" else original_ids
            self.clippy_codes = {"er-cli": 1} if failure == "lint" else {}
            code, summary = self.invoke()
            self.assertEqual(code, 1)
            self.assertEqual(self.executed, [])
            self.assertIn({"worker": "real worker executable", "witness": "required native test identities",
                           "lint": "cli-clippy exited 1"}[failure], summary["first_failure"])
            if failure == "worker":
                self.assertEqual(self.binary_envs, [])
            if failure == "witness":
                self.assertNotIn("clippy", self.events)

    def test_control_query_priority_and_inventory_guard_are_crate_bound(self):
        self.configure_control_query_scope()
        import m9e_phases as phases
        selection = self.feedback.plan()
        identities = [("er-other", "m9e_current_control_query"), ("er-kernel", "m9e_coop_v7"),
                      ("er-cli", "m9e_current_control_query"), ("er-kernel", "m9e_timers_v7")]
        rows = [(index, f"binary-{index}", target, ["synthetic"], self.rust / "crates" / crate, set(), None)
                for index, (crate, target) in enumerate(identities)]
        prior = self.feedback.native_execution_order({"timer_focus": True}, rows)
        ordered = self.feedback.native_execution_order(selection, rows)
        self.assertEqual(ordered, [rows[2], *[row for row in prior if row != rows[2]]])
        inventory = [{"crate": "er-cli", "target": "m9e_current_control_query",
                      "ids": list(phases.CONTROL_QUERY_TEST_IDS), "historical_excluded_ids": []}]
        phases.validate_control_query_inventory(selection, inventory)
        self.assertEqual(phases.partition(inventory), {"a": [["er-cli", "m9e_current_control_query"]], "b": [], "c": []})
        for mode in ("missing_flag", "false_flag", "integer_flag", "missing_binding", "wrong_crate", "excluded", "duplicate", "missing_target"):
            bad_plan, bad_inventory = copy.deepcopy(selection), copy.deepcopy(inventory)
            if mode == "missing_flag":
                bad_plan.pop("requires_current_control_query")
            elif mode == "false_flag":
                bad_plan["requires_current_control_query"] = False
            elif mode == "integer_flag":
                bad_plan["requires_current_control_query"] = 1
            elif mode == "missing_binding":
                bad_plan["requires_worker_executable"] = False
            elif mode == "wrong_crate":
                bad_inventory[0]["crate"] = "er-other"
            elif mode == "excluded":
                bad_inventory[0]["historical_excluded_ids"] = ["forbidden_skip"]
            elif mode == "duplicate":
                bad_inventory.append(copy.deepcopy(bad_inventory[0]))
            else:
                bad_inventory = []
            with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                phases.validate_control_query_inventory(bad_plan, bad_inventory)


    def configure_state_query_scope(self):
        self.configure_control_query_scope()
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        self.config["current_state_query_focus"] = policy["current_state_query_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.package("er-state-query-consumer", '[dependencies]\ner-lab = { path = "../er-lab" }\n')
        self.changed = list(policy["current_state_query_focus"]["paths"])

    def test_combined_queries_keep_title_read_storage_owner_and_exact_four_query_ids(self):
        self.configure_state_query_scope()
        title = self.configure_title_retirement_scope()
        self.config["current_ai_max_pp_focus"] = json.loads(HARNESS.with_name("m9e-targets.json").read_text())["current_ai_max_pp_focus"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        import m9e_phases as phases
        paths = sorted(set([*phases.CONTROL_QUERY_PATHS, *phases.STATE_QUERY_PATHS]))
        self.assertEqual(len(paths), 6)
        for name in (phases.CONTROL_QUERY_PATHS[1], *phases.STATE_QUERY_PATHS[2:]):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("installed query witness")
        before = copy.deepcopy(self.config)
        self.changed = paths
        selection = self.feedback.plan()
        for flag in ("current_state_query_focus", "current_control_query_focus", "requires_current_state_query",
                     "requires_ai_max_pp", "requires_current_control_query", "requires_title_storage", "requires_read_rebind", "requires_title_retirement",
                     "requires_current_proposal", "requires_worker_storage", "requires_current_storage",
                     "requires_browser_worker", "requires_browser_rtc", "requires_browser", "requires_wasm",
                     "requires_cli_executable", "requires_worker_executable"):
            self.assertTrue(selection[flag], flag)
        for target, names in ((phases.CONTROL_QUERY_TARGET, phases.CONTROL_QUERY_TEST_IDS),
                              *phases.STATE_QUERY_IDENTITIES.items()):
            self.assertEqual(selection["required_native_test_ids"][":".join(target)], names)
        self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_game_kernel_v7"]), 14)
        for target, ids in (*phases.STATE_QUERY_IDENTITIES.items(), (phases.CONTROL_QUERY_TARGET, phases.CONTROL_QUERY_TEST_IDS)):
            self.assertEqual(selection["required_native_test_ids"][":".join(target)], ids)
        self.assertEqual(self.config, previous)
        self.assertEqual(self.executed, [])
        self.assertEqual(selection["title_storage_binding"], title.source_binding(self.root, CANDIDATE))
        for identity, names in self.feedback.TITLE_STORAGE_IDS.items():
            self.assertEqual(selection["required_native_test_ids"][identity], names)
        self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
        self.assertEqual(self.config, before)
        self.assertEqual(self.executed, [])

    def test_combined_queries_reject_neighbors_and_missing_prerequisite_policies(self):
        self.configure_state_query_scope()
        import m9e_phases as phases
        paths = sorted(set([*phases.CONTROL_QUERY_PATHS, *phases.STATE_QUERY_PATHS]))
        for extra in ("rust/crates/er-cli/src/current_other.rs", "rust/crates/er-lab/src/other.rs",
                      "rust/Cargo.lock", "rust/crates/er-kernel/src/game_kernel_v7.rs",
                      "src/rust-browser/routes/rust-current-storage-entry.ts"):
            self.changed = [*paths, extra]
            with self.assertRaisesRegex(RuntimeError, "additional mapping"):
                self.feedback.plan()
        self.changed = paths
        original = copy.deepcopy(self.config)
        for key in ("current_control_query_focus", "current_state_query_focus"):
            self.config = copy.deepcopy(original)
            self.config.pop(key)
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaisesRegex(RuntimeError, "policy|additional mapping"):
                self.feedback.plan()
        self.assertEqual(self.executed, [])

    def test_state_query_scope_preserves_prerequisite_causal_inventory_and_platforms(self):
        self.configure_state_query_scope()
        import m9e_phases as phases
        policy = self.config["current_state_query_focus"]
        self.assertEqual(policy["paths"], phases.STATE_QUERY_PATHS)
        self.assertEqual(policy["test_ids"], phases.STATE_QUERY_TEST_IDS)
        original = copy.deepcopy(self.config)
        for changed in (policy["paths"], *[[path] for path in policy["paths"]]):
            self.changed = changed + ["docs/plans/rust-kernel/m9e-state-query.md"]
            selection = self.feedback.plan()
            for flag in ("current_state_query_focus", "requires_current_state_query", "requires_current_control_query",
                         "timer_focus", "requires_browser_worker", "requires_browser", "requires_wasm",
                         "requires_worker_executable", "requires_cli_executable", "requires_cli_clippy",
                         "requires_agent_protocol_clippy"):
                self.assertTrue(selection[flag], flag)
            self.assertEqual(selection["execution_scope"], self.config["timer_focus"]["execute"])
            self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 25)
            for identity, ids in self.config["timer_focus"]["exact_test_ids"].items():
                self.assertEqual(selection["required_native_test_ids"][identity], ids)
            for target, ids in (*phases.STATE_QUERY_IDENTITIES.items(),
                                (phases.CONTROL_QUERY_TARGET, phases.CONTROL_QUERY_TEST_IDS)):
                self.assertEqual(selection["required_native_test_ids"][":".join(target)], ids)
                self.assertEqual(selection["required_native_targets"][target[0]].count(target[1]), 1)
            self.assertEqual(selection["timer_mutant"], self.config["timer_focus"]["mutant"])
            self.assertEqual(selection["replica_mutant"], self.config["timer_focus"]["replica_mutant"])
            self.assertIsNone(selection["ledger_mutant"])
            self.assertIsNone(selection["worker_lock_guard"])
            if "rust/crates/er-lab/src/query.rs" in changed:
                self.assertIn("er-state-query-consumer", selection["packages"])
            self.assertNotIn("er-state-query-consumer", selection["execution_scope"])
            self.assertEqual(selection["wasm_test"], "m9e_parity")
        self.assertEqual(self.config, original)
        self.assertEqual(phases.LANE_B_TARGETS, {("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_repro"),
                                                ("er-cli", "m9e_current_reload"), phases.STATE_QUERY_WORKER_TARGET})
        self.assertEqual(len(phases.WORKER_TEST_IDS), 2)
        self.assertEqual(len(phases.WORKER_CODEC_IDS), 3)

    def test_state_query_mixed_paths_reject_and_overlap_keeps_existing_scope(self):
        self.configure_state_query_scope()
        import m9e_phases as phases
        witness = phases.STATE_QUERY_PATHS[2]
        for extra in (phases.CONTROL_QUERY_PATHS[1], "rust/crates/er-cli/src/current_commands.rs",
                      "rust/crates/er-cli/src/current_native_capture.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-repro/src/current.rs",
                      "rust/crates/er-batch/src/current.rs", "rust/crates/er-cli/Cargo.toml", "rust/Cargo.lock",
                      "src/rust-browser/worker/current-rust-kernel-worker.ts", "unknown.json"):
            self.changed = [witness, extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                self.feedback.plan()
        source = self.root / witness
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("later actual state target")
        for scope, trigger in (("native_capture_focus", "rust/crates/er-cli/src/current_native_capture.rs"),
                               ("current_repro_focus", "rust/crates/er-repro/src/current.rs"),
                               ("current_batch_focus", "rust/crates/er-batch/src/current.rs"),
                               ("current_control_query_focus", phases.CONTROL_QUERY_PATHS[1])):
            self.changed = [phases.STATE_QUERY_PATHS[0], trigger]
            selection = self.feedback.plan()
            self.assertFalse(selection["current_state_query_focus"])
            self.assertTrue(selection[scope], scope)
            expected_scope = self.config["timer_focus" if scope == "current_control_query_focus" else scope]["execute"]
            self.assertEqual(selection["execution_scope"], expected_scope)
            self.assertTrue(selection["requires_current_state_query"])
            self.assertTrue(selection["requires_current_control_query"])
            self.assertTrue(selection["requires_worker_executable"])
    def test_state_query_binding_follows_selected_target_and_preserves_readiness(self):
        self.configure_state_query_scope()
        import m9e_phases as phases
        source = self.root / phases.STATE_QUERY_PATHS[2]
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("later target exists")
        for changed in (["rust/crates/er-kernel/src/game_kernel_v7.rs"],
                        ["rust/crates/er-cli/src/current_commands.rs"],
                        ["rust/crates/er-cli/tests/another_current_target.rs"]):
            self.changed = changed
            selection = self.feedback.plan()
            self.assertFalse(selection["current_state_query_focus"])
            self.assertTrue(selection["requires_current_state_query"])
            self.assertTrue(selection["requires_worker_executable"])
            self.assertEqual(selection["required_native_test_ids"]["er-cli:m9e_current_state_query"], phases.STATE_QUERY_TEST_IDS[:1])
            self.assertEqual(selection["required_native_test_ids"]["er-cli:m9e_current_state_query_worker"], phases.STATE_QUERY_TEST_IDS[1:])
        self.changed = ["docs/plans/rust-kernel/m9e-control-query.md", "scripts/ci/m9e_feedback.py"]
        selection = self.feedback.plan()
        self.assertEqual(selection["packages"], self.config["readiness_packages"])
        for flag in ("requires_current_state_query", "current_state_query_focus", "requires_worker_executable",
                     "requires_cli_executable", "requires_browser_worker", "requires_browser", "requires_wasm"):
            self.assertFalse(selection[flag], flag)
        self.changed = ["rust/crates/er-cli/src/current_commands.rs"]
        self.config["current_session_focus"]["execute"]["er-cli"] = ["m9e_current_entry"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.assertFalse(self.feedback.plan()["requires_current_state_query"])
        source.unlink()
        self.config["current_session_focus"]["execute"]["er-cli"] = ["m9e_current_state_query"]
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.assertTrue(self.feedback.plan()["requires_current_state_query"])

    def test_state_query_policy_and_exact_inventory_cannot_silently_weaken(self):
        self.configure_state_query_scope()
        import m9e_phases as phases
        original = copy.deepcopy(self.config["current_state_query_focus"])
        for field, value in (("paths", original["paths"] + ["rust/crates/er-cli/src/main.rs"]),
                             ("test_ids", original["test_ids"][:1]), ("test_ids", ["renamed", "wrong"])):
            self.config["current_state_query_focus"] = {**original, field: value}
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaisesRegex(RuntimeError, "state query policy identities"):
                self.feedback.plan()
        self.config["current_state_query_focus"] = original
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        selection = self.feedback.plan()
        required = selection["required_native_test_ids"]
        rows = [(identity.split(":")[0], identity.split(":")[1], ids) for identity, ids in required.items()]
        self.feedback.require_native_test_ids(required, rows)
        for identity in required:
            for mode in ("absent", "empty", "renamed", "duplicate"):
                modified = [(crate, target, ([] if mode == "empty" else ["renamed"] if mode == "renamed"
                                             else ids + ids[:1]) if f"{crate}:{target}" == identity else ids)
                            for crate, target, ids in rows if mode != "absent" or f"{crate}:{target}" != identity]
                with self.subTest(identity=identity, mode=mode), self.assertRaisesRegex(RuntimeError, "required native test identities"):
                    self.feedback.require_native_test_ids(required, modified)
        source = self.root / phases.STATE_QUERY_PATHS[2]
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("target exists")
        self.config.pop("current_state_query_focus")
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = ["rust/crates/er-cli/src/current_commands.rs"]
        with self.assertRaisesRegex(RuntimeError, "requires its exact policy"):
            self.feedback.plan()

    def test_state_query_orchestration_discovers_and_lints_before_bound_process_execution(self):
        self.configure_state_query_scope()
        selection = self.feedback.plan()
        self.control_query_mock_inventory(selection)
        with patch.object(self.feedback, "wasm_checks") as wasm, patch.object(self.feedback, "browser_checks") as browser, \
                patch.object(self.feedback, "timer_behavioral_mutant") as timer, \
                patch.object(self.feedback, "replica_behavioral_mutant") as replica:
            code, summary = self.invoke()
        self.assertEqual(code, 0, summary.get("first_failure"))
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_state_query"], 1)
        self.assertEqual(summary["required_native_target_counts"]["er-cli:m9e_current_state_query_worker"], 1)
        self.assertEqual(len(summary["required_native_target_counts"]), 25)
        self.assertEqual(self.executed[0], "m9e_current_state_query")
        query_command = next(args for args in self.commands
                             if Path(args[0]).name == "m9e_current_state_query" and "--list" not in args)
        self.assertEqual(query_command[1:], ["--format", "terse", "--nocapture"])
        self.assertLess(max(index for index, event in enumerate(self.events) if event.startswith("list:")), self.events.index("clippy"))
        first = self.events.index("execute:m9e_current_state_query")
        for index, event in enumerate(self.events):
            if event.startswith("clippy:"):
                self.assertLess(index, first)
        for lint in ("cli-clippy", "agent-protocol-clippy", "er-env-clippy", "er-repro-clippy",
                     "worker-clippy", "endpoint-clippy", "browser-clippy"):
            self.assertIn(lint, summary["timing_ms"])
        query_environments = [(phase, env) for name, phase, env in self.binary_envs if name == "m9e_current_state_query"]
        self.assertEqual([phase for phase, _ in query_environments], ["list", "execute"])
        for _, env in query_environments:
            self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
            self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], summary["worker_executable"]["sha256"])
            self.assertEqual(env["ER_M9E_WORKER_BUILD_PROFILE"], "test")
        self.assertIn("m9e_current_state_query_worker::worker_state_queries_bind_exact_current_snapshots_and_preserve_rejections",
                      timer.call_args.args[2])
        timer.assert_called_once()
        replica.assert_called_once()
        wasm.assert_called_once()
        browser.assert_called_once()
        self.assertIsNone(self.feedback.native_target_env("er-other", "m9e_current_state_query", None))
        with self.assertRaisesRegex(RuntimeError, "no bound worker"):
            self.feedback.native_target_env("er-cli", "m9e_current_state_query", None)

    def test_state_query_orchestration_rejects_missing_worker_witness_and_early_lint_failure(self):
        self.configure_state_query_scope()
        selection = self.feedback.plan()
        self.control_query_mock_inventory(selection)
        original_ids = list(self.binary_ids["m9e_current_state_query"])
        original_artifacts = list(self.extra_artifacts)
        for failure in ("worker", "witness", "lint"):
            self.executed.clear()
            self.events.clear()
            self.binary_envs.clear()
            self.extra_artifacts = original_artifacts[1:] if failure == "worker" else original_artifacts
            self.binary_ids["m9e_current_state_query"] = ["renamed"] if failure == "witness" else original_ids
            self.clippy_codes = {"er-cli": 1} if failure == "lint" else {}
            code, summary = self.invoke()
            self.assertEqual(code, 1)
            self.assertEqual(self.executed, [])
            self.assertIn({"worker": "real worker executable", "witness": "required native test identities",
                           "lint": "cli-clippy exited 1"}[failure], summary["first_failure"])
            if failure == "worker":
                self.assertEqual(self.binary_envs, [])
            if failure == "witness":
                self.assertNotIn("clippy", self.events)

    def test_state_query_priority_and_inventory_enforce_control_prerequisite(self):
        self.configure_state_query_scope()
        import m9e_phases as phases
        selection = self.feedback.plan()
        identities = [("er-other", "m9e_current_state_query"), ("er-kernel", "m9e_coop_v7"),
                      phases.CONTROL_QUERY_TARGET, phases.STATE_QUERY_TARGET, ("er-kernel", "m9e_timers_v7"),
                      phases.STATE_QUERY_WORKER_TARGET]
        rows = [(index, f"binary-{index}", target, ["synthetic"], self.rust / "crates" / crate, set(), None)
                for index, (crate, target) in enumerate(identities)]
        prior_plan = {**selection, "current_state_query_focus": False}
        prior = self.feedback.native_execution_order(prior_plan, rows)
        self.assertEqual(self.feedback.native_execution_order(selection, rows),
                         [rows[3], rows[5], *[row for row in prior if row not in (rows[3], rows[5])]])
        inventory = [{"crate": target[0], "target": target[1], "ids": list(ids), "historical_excluded_ids": []}
                     for target, ids in ((phases.CONTROL_QUERY_TARGET, phases.CONTROL_QUERY_TEST_IDS),
                                         *phases.STATE_QUERY_IDENTITIES.items())]
        phases.validate_state_query_inventory(selection, inventory)
        self.assertIn(list(phases.STATE_QUERY_TARGET), phases.partition(inventory)["a"])
        self.assertIn(list(phases.STATE_QUERY_WORKER_TARGET), phases.partition(inventory)["b"])
        for mode in ("missing_flag", "false_flag", "integer_flag", "missing_binding", "wrong_crate", "excluded",
                     "duplicate", "missing_target", "prerequisite_flag", "prerequisite_target", "prerequisite_ids",
                     "state_ids", "plan_ids", "plan_target"):
            bad_plan, bad_inventory = copy.deepcopy(selection), copy.deepcopy(inventory)
            if mode == "missing_flag":
                bad_plan.pop("requires_current_state_query")
            elif mode in ("false_flag", "integer_flag"):
                bad_plan["requires_current_state_query"] = False if mode == "false_flag" else 1
            elif mode == "missing_binding":
                bad_plan["requires_worker_executable"] = False
            elif mode == "wrong_crate":
                bad_inventory[1]["crate"] = "er-other"
            elif mode == "excluded":
                bad_inventory[1]["historical_excluded_ids"] = ["forbidden_skip"]
            elif mode == "duplicate":
                bad_inventory.append(copy.deepcopy(bad_inventory[1]))
            elif mode == "missing_target":
                bad_inventory.pop()
            elif mode == "prerequisite_flag":
                bad_plan["requires_current_control_query"] = False
            elif mode == "prerequisite_target":
                bad_inventory.pop(0)
            elif mode == "prerequisite_ids":
                bad_inventory[0]["ids"] = ["renamed"]
            elif mode == "state_ids":
                bad_inventory[1]["ids"] *= 2
            elif mode == "plan_ids":
                bad_plan["required_native_test_ids"][":".join(phases.STATE_QUERY_TARGET)] = ["renamed"]
            else:
                bad_plan["required_native_targets"]["er-cli"].remove(phases.STATE_QUERY_TARGET[1])
            with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                phases.validate_state_query_inventory(bad_plan, bad_inventory)

    def test_split_state_query_worker_uses_bound_process_and_preserves_full_inventory(self):
        self.configure_state_query_scope()
        import m9e_phases as phases
        selection = self.feedback.plan()
        self.control_query_mock_inventory(selection)
        with patch.object(self.feedback, "wasm_checks"), patch.object(self.feedback, "browser_checks"), \
                patch.object(self.feedback, "timer_behavioral_mutant"), patch.object(self.feedback, "replica_behavioral_mutant"):
            code, summary = self.invoke()
        self.assertEqual(code, 0, summary.get("first_failure"))
        self.assertEqual(self.executed[:2], [target[1] for target in phases.STATE_QUERY_IDENTITIES])
        for target, ids in phases.STATE_QUERY_IDENTITIES.items():
            self.assertEqual(self.binary_ids[target[1]], ids)
            command = next(args for args in self.commands if Path(args[0]).name == target[1] and "--list" not in args)
            self.assertEqual(command[1:], ["--format", "terse", "--nocapture"])
            environments = [(phase, env) for name, phase, env in self.binary_envs if name == target[1]]
            self.assertEqual([phase for phase, _ in environments], ["list", "execute"])
            for _, env in environments:
                self.assertEqual(env["ER_M9E_WORKER_SOURCE_SHA"], CANDIDATE)
                self.assertEqual(env["ER_M9E_WORKER_EXECUTABLE_SHA256"], summary["worker_executable"]["sha256"])
                self.assertEqual(env["ER_M9E_WORKER_BUILD_PROFILE"], "test")
            with self.assertRaisesRegex(RuntimeError, "no bound worker"):
                self.feedback.native_target_env(*target, None)

    def test_split_state_query_rejects_swapped_or_collapsed_process_witnesses(self):
        self.configure_state_query_scope()
        import m9e_phases as phases
        selection = self.feedback.plan()
        inventory = [{"crate": target[0], "target": target[1], "ids": list(ids), "historical_excluded_ids": []}
                     for target, ids in ((phases.CONTROL_QUERY_TARGET, phases.CONTROL_QUERY_TEST_IDS),
                                         *phases.STATE_QUERY_IDENTITIES.items())]
        phases.validate_state_query_inventory(selection, inventory)
        for mode in ("swap", "collapse", "worker_plan", "worker_duplicate", "wrong_lane"):
            bad_plan, rows = copy.deepcopy(selection), copy.deepcopy(inventory)
            if mode == "swap":
                rows[1]["ids"], rows[2]["ids"] = rows[2]["ids"], rows[1]["ids"]
            elif mode == "collapse":
                rows[1]["ids"] += rows.pop()["ids"]
            elif mode == "worker_plan":
                bad_plan["required_native_test_ids"].pop(":".join(phases.STATE_QUERY_WORKER_TARGET))
            elif mode == "worker_duplicate":
                rows[2]["ids"] *= 2
            if mode == "wrong_lane":
                assignment = phases.partition(rows)
                assignment["b"].remove(list(phases.STATE_QUERY_WORKER_TARGET))
                assignment["a"].append(list(phases.STATE_QUERY_WORKER_TARGET))
                with patch.object(phases, "partition", return_value=assignment), self.assertRaises(RuntimeError):
                    phases.validate_state_query_inventory(bad_plan, rows)
            else:
                with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                    phases.validate_state_query_inventory(bad_plan, rows)

    def configure_cost_scope(self):
        self.configure_state_query_scope()
        self.configure_title_retirement_scope()
        import m9e_current_cost as cost
        import m9e_phases as phases
        policy = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        for key in ("current_ai_max_pp_focus", "current_cost_probe_focus"):
            self.config[key] = policy[key]
        for name in (cost.SOURCE, phases.CONTROL_QUERY_PATHS[1], *phases.STATE_QUERY_PATHS[2:]):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("installed exact witness\n")
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
        self.changed = [cost.SOURCE]
        binding = {"source_sha": CANDIDATE, "source_hashes": {cost.SOURCE: "f" * 64},
                   "cargo_manifests": {"count": 35, "sha256": "e" * 64}}
        mocked = patch.object(cost, "build_source_binding", return_value=binding)
        mocked.start()
        self.addCleanup(mocked.stop)
        return cost, phases, binding

    def test_cost_scope_adds_one_release_witness_and_preserves_installed_current_obligations(self):
        cost, phases, binding = self.configure_cost_scope()
        previous = copy.deepcopy(self.config)
        selection = self.feedback.plan()
        for key in ("current_cost_probe_focus", "requires_current_cost_probe", "timer_focus", "requires_current_state_query",
                    "requires_current_control_query", "requires_ai_max_pp", "requires_title_storage", "requires_title_retirement",
                    "requires_read_rebind", "requires_current_proposal", "requires_worker_storage", "requires_current_storage",
                    "requires_browser_rtc", "requires_browser_worker", "requires_wasm", "requires_browser",
                    "requires_cli_executable", "requires_worker_executable"):
            self.assertTrue(selection[key], key)
        self.assertEqual(selection["current_cost_source_binding"], binding)
        self.assertEqual(selection["required_native_targets"][cost.TARGET[0]].count(cost.TARGET[1]), 1)
        self.assertEqual(selection["required_native_test_ids"][":".join(cost.TARGET)], [cost.TEST_ID])
        self.assertEqual(selection["timer_mutant"], previous["timer_focus"]["mutant"])
        self.assertEqual(selection["replica_mutant"], previous["timer_focus"]["replica_mutant"])
        self.assertEqual(len(selection["required_native_test_ids"]["er-kernel:m9e_game_kernel_v7"]), 14)

    def test_exact_cost_and_rule_pair_preserves_both_owners_and_every_existing_obligation(self):
        cost, phases, binding = self.configure_cost_scope()
        cost_only = self.feedback.plan()
        rule, policy, _, _, _ = rule_fixture(self.root)
        for changed in ([cost.SOURCE, rule.RULE_TEST_SOURCE], [rule.RULE_TEST_SOURCE, cost.SOURCE]):
            self.changed = changed
            selection = self.feedback.plan()
            self.assertTrue(selection["current_cost_probe_focus"])
            self.assertTrue(selection["requires_current_cost_probe"])
            self.assertEqual(selection["current_cost_source_binding"], binding)
            self.assertEqual(selection["rule_worker"], policy)
            self.assertEqual(selection["required_native_test_ids"],
                             {**cost_only["required_native_test_ids"], "er-cli:" + rule.RULE_TARGET: [rule.RULE_TEST]})
            for key, value in cost_only.items():
                if key.startswith("requires_") or key in ("timer_mutant", "replica_mutant", "ledger_mutant"):
                    self.assertEqual(selection[key], value, key)
            for crate, targets in cost_only["required_native_targets"].items():
                expected = targets + ([rule.RULE_TARGET] if crate == "er-cli" else [])
                self.assertEqual(selection["required_native_targets"][crate], expected)
            assignment = phases.partition([{"crate": crate, "target": target, "ids": [test], "historical_excluded_ids": []}
                                          for crate, target, test in ((*cost.TARGET, cost.TEST_ID), ("er-cli", rule.RULE_TARGET, rule.RULE_TEST))])
            self.assertEqual(assignment, {"a": [list(cost.TARGET)], "b": [], "c": [["er-cli", rule.RULE_TARGET]]})
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/Cargo.lock", "rust/crates/er-cli/Cargo.toml", "unmapped.json"):
            self.changed = [cost.SOURCE, rule.RULE_TEST_SOURCE, extra]
            with self.subTest(extra=extra), self.assertRaises(RuntimeError):
                self.feedback.plan()

    def test_cost_scope_rejects_mixed_products_missing_source_and_mutated_policy(self):
        cost, _, _ = self.configure_cost_scope()
        for path in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/Cargo.lock",
                     "rust/crates/er-repro/tests/neighbor.rs", "rust/crates/er-cli/src/current_agent.rs",
                     "src/rust-browser/routes/rust-current-storage-entry.ts"):
            self.changed = [cost.SOURCE, path]
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                self.feedback.plan()
        self.changed = [cost.SOURCE]
        original = copy.deepcopy(self.config)
        for policy in (None, {"paths": [cost.SOURCE], "test_ids": []},
                       {"paths": [cost.SOURCE, "neighbor"], "test_ids": [cost.TEST_ID]}):
            self.config = copy.deepcopy(original)
            self.config["current_cost_probe_focus"] = policy
            (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(self.config))
            with self.assertRaises(RuntimeError):
                self.feedback.plan()
        (self.root / "scripts/ci/m9e-targets.json").write_text(json.dumps(original))
        (self.root / cost.SOURCE).unlink()
        with self.assertRaises(RuntimeError):
            self.feedback.plan()

    def test_cost_installed_requirement_follows_selected_target_without_expanding_readiness(self):
        cost, phases, _ = self.configure_cost_scope()
        self.changed = phases.CONTROL_QUERY_PATHS
        selection = self.feedback.plan()
        self.assertFalse(selection["current_cost_probe_focus"])
        self.assertTrue(selection["requires_current_cost_probe"])
        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        selection = self.feedback.plan()
        self.assertFalse(selection["requires_current_cost_probe"])
        self.assertIsNone(selection["current_cost_source_binding"])
        self.assertNotIn(cost.TARGET[1], selection["required_native_targets"].get(cost.TARGET[0], []))

    def test_cost_native_orchestration_overrides_only_A_once_after_discovery_and_lint(self):
        cost, phases, binding = self.configure_cost_scope()
        import sys
        selection = self.feedback.plan()
        self.control_query_mock_inventory(selection)
        captured = {}
        def release(repository, temporary, diagnostics, **kwargs):
            self.assertEqual(self.executed, [], "release target must execute first")
            self.assertEqual(kwargs["source_binding"], binding)
            self.assertEqual(kwargs["discovered_ids"], [cost.TEST_ID])
            self.assertIn("clippy", self.events)
            output = diagnostics / "current-cost-execute.log"
            output.write_text(self.result_line(passed=1))
            return output, {"fixture": "release evidence, validator tested independently"}
        def export(feedback, summary):
            captured.update(copy.deepcopy(summary))
        with patch.dict(os.environ, {"M9E_PHASE": "native", "M9E_NATIVE_LANE": "a"}), \
                patch.dict(sys.modules, {self.feedback.__name__: self.feedback}), \
                patch.object(phases, "identity", return_value={"product_sha": CANDIDATE}), \
                patch.object(phases, "export_native", side_effect=export), \
                patch.object(cost, "execute_release", side_effect=release) as execute, \
                patch.object(self.feedback, "timer_behavioral_mutant"), patch.object(self.feedback, "replica_behavioral_mutant"):
            code, summary = self.invoke()
        self.assertEqual(code, 0, summary.get("first_failure"))
        execute.assert_called_once()
        self.assertNotIn(cost.TARGET[1], self.executed, "ordinary debug cost binary must never execute")
        self.assertEqual(captured["completed_targets"].count(list(cost.TARGET)), 1)
        self.assertEqual(captured["tests"]["executed"], sum(len(row["ids"]) for row in captured["native_inventory"]
                                                         if [row["crate"], row["target"]] in captured["assigned_targets"]))
        self.assertEqual(captured["tests"]["failed"], 0)
        self.assertIn("current_cost_probe", captured)

    def test_cost_native_B_never_builds_or_executes_release_override(self):
        cost, phases, _ = self.configure_cost_scope()
        import sys
        selection = self.feedback.plan()
        self.control_query_mock_inventory(selection)
        captured = {}
        with patch.dict(os.environ, {"M9E_PHASE": "native", "M9E_NATIVE_LANE": "b"}), \
                patch.dict(sys.modules, {self.feedback.__name__: self.feedback}), \
                patch.object(phases, "identity", return_value={"product_sha": CANDIDATE}), \
                patch.object(phases, "export_native", side_effect=lambda _, value: captured.update(copy.deepcopy(value))), \
                patch.object(cost, "execute_release") as execute:
            code, summary = self.invoke()
        self.assertEqual(code, 0, summary.get("first_failure"))
        execute.assert_not_called()
        self.assertNotIn("current_cost_probe", captured)
        self.assertNotIn(list(cost.TARGET), captured["completed_targets"])
        self.assertNotIn(cost.TARGET[1], self.executed)

    def test_rule_target_requirement_survives_later_cli_and_kernel_cuts_but_not_readiness(self):
        self.configure_timer_scope()
        rule, policy, _, _, _ = rule_fixture(self.root)
        for changed in ([rule.RULE_TEST_SOURCE], ["rust/crates/er-kernel/src/game_kernel_v7.rs"]):
            with self.subTest(changed=changed):
                self.changed = changed
                selection = self.feedback.plan()
                self.assertEqual(selection["rule_worker"], policy)
                self.assertTrue(selection["requires_worker_executable"])
                self.assertTrue(selection["requires_browser"])
                self.assertTrue(selection["requires_wasm"])
                self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 23)
                self.assertEqual(selection["required_native_test_ids"]["er-cli:" + rule.RULE_TARGET], [rule.RULE_TEST])
                for key, ids in self.config["timer_focus"]["exact_test_ids"].items():
                    self.assertEqual(selection["required_native_test_ids"][key], ids)
        self.changed = ["rust/crates/er-cli/src/ordinary.rs"]
        ordinary = self.feedback.plan()
        self.assertEqual(ordinary["rule_worker"], policy)
        self.assertIn(rule.RULE_TARGET, ordinary["required_native_targets"]["er-cli"])
        self.changed = ["docs/plans/rust-kernel/m9e-progress.md"]
        with patch.object(rule, "make_rule_policy", side_effect=AssertionError("readiness must not derive workers")):
            readiness = self.feedback.plan()
        self.assertIsNone(readiness["rule_worker"])
        self.assertEqual(readiness["packages"], ["er-canonical"])



    def test_rule_scope_and_exact_target_reject_mixed_missing_renamed_or_extra_evidence(self):
        self.configure_timer_scope()
        rule, _, _, _, _ = rule_fixture(self.root)
        for extra in ("rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/Cargo.lock",
                      "rust/crates/er-cli/Cargo.toml", "src/other.ts", "unmapped.json"):
            self.changed = [rule.RULE_TEST_SOURCE, extra]
            with self.assertRaisesRegex(RuntimeError, "planning requires additional mapping"):
                self.feedback.plan()
        self.changed = [rule.RULE_TEST_SOURCE]
        selection = self.feedback.plan()
        required = {"er-cli:" + rule.RULE_TARGET: [rule.RULE_TEST]}
        for ids in ([], ["renamed"], [rule.RULE_TEST, "extra"], [rule.RULE_TEST, rule.RULE_TEST]):
            with self.assertRaises(RuntimeError):
                self.feedback.require_native_test_ids(required, [("er-cli", rule.RULE_TARGET, ids)])
        (self.root / rule.RULE_TEST_SOURCE).unlink()
        with self.assertRaisesRegex(RuntimeError, "absent"):
            self.feedback.plan()
        self.assertEqual(sum(map(len, selection["required_native_targets"].values())), 23)



    def test_rule_publication_follows_lint_exact_one_execution_and_context_verification(self):
        import time
        import m9e_current_cost as cost
        import m9e_phases as phases
        self.configure_timer_scope()
        rule, _, _, _, _ = rule_fixture(self.root)
        self.changed = [rule.RULE_TEST_SOURCE]
        selection = self.feedback.plan()
        selection.update({"packages": ["er-cli", "er-kernel-worker"], "execution_scope": {"er-cli": [rule.RULE_TARGET]},
                          "required_native_targets": {"er-cli": [rule.RULE_TARGET]},
                          "required_native_test_ids": {"er-cli:" + rule.RULE_TARGET: [rule.RULE_TEST]},
                          "requires_cli_executable": False, "requires_wasm": False, "requires_browser": False,
                          "timer_mutant": None, "replica_mutant": None, "ledger_mutant": None})
        self.binary_ids = {"rule_binary": [rule.RULE_TEST]}
        self.binary_crates = {"rule_binary": "er-cli"}
        self.binary_targets = {"rule_binary": rule.RULE_TARGET}
        self.extra_artifacts = [self.worker_executable_artifact()]
        finished = []
        cleanup_failure = False
        @contextlib.contextmanager
        def prepared(_feedback, _summary, _worker):
            self.assertIn("clippy:er-cli", self.events)
            self.assertIn("list:rule_binary", self.events)
            yield {"BOUND_VARIANT": "yes"}, {"status": "prepared"}
            if cleanup_failure:
                raise RuntimeError("rule cleanup verification failed")
            finished.append(True)
        def bounded(command, **kwargs):
            self.assertEqual(command[1:], [rule.RULE_TEST, "--exact", "--format", "terse", "--nocapture", "--test-threads=1"])
            self.assertEqual(kwargs["seconds"], 600)
            self.assertEqual(kwargs["byte_limit"], 16384)
            self.assertEqual(kwargs["environment"], {"BOUND_VARIANT": "yes"})
            self.assertGreater(kwargs["global_deadline"], time.monotonic())
            with kwargs["output"].open("w") as output:
                result = self.process(command, cwd=kwargs["cwd"], stdout=output, env=kwargs["environment"])
            if result.returncode:
                raise RuntimeError("rule witness failed")
            return {"path": kwargs["output"], "elapsed_seconds": 0.1}
        for code, result in ((0, self.result_line(1)), (1, self.result_line(0, 1)),
                             (0, self.result_line(1) + self.result_line(1)), (0, self.result_line(0))):
            with self.subTest(code=code, result=result):
                self.results = {"rule_binary": (code, result)}
                with patch.object(self.feedback, "plan", return_value=selection), patch.object(rule, "current_rule_worker", prepared), \
                        patch.dict(sys.modules, {self.feedback.__name__: self.feedback}), \
                        patch.dict(os.environ, {"M9E_PHASE": "native", "M9E_NATIVE_LANE": "c"}), \
                        patch.object(phases, "identity", return_value={"product_sha": CANDIDATE}), \
                        patch.object(phases, "export_native"), patch.object(cost, "run_bounded", side_effect=bounded) as execute:
                    status, summary = self.invoke()
                execute.assert_called_once()
                if code == 0 and result == self.result_line(1):
                    self.assertEqual(status, 0)
                    self.assertTrue(finished)
                    self.assertEqual(summary["rule_worker"]["tests"], {"executed": 1, "passed": 1, "failed": 0, "skipped": 0})
                    self.assertEqual(self.binary_envs[-1][2], {"BOUND_VARIANT": "yes"})
                else:
                    self.assertNotEqual(status, 0)
                    self.assertNotIn("rule_worker", summary)
        cleanup_failure = True
        self.results = {"rule_binary": (0, self.result_line(1))}
        with patch.object(self.feedback, "plan", return_value=selection), patch.object(rule, "current_rule_worker", prepared), \
                patch.dict(sys.modules, {self.feedback.__name__: self.feedback}), \
                patch.dict(os.environ, {"M9E_PHASE": "native", "M9E_NATIVE_LANE": "c"}), \
                patch.object(phases, "identity", return_value={"product_sha": CANDIDATE}), \
                patch.object(phases, "export_native"), patch.object(cost, "run_bounded", side_effect=bounded):
            status, summary = self.invoke()
        self.assertNotEqual(status, 0)
        self.assertIn("cleanup verification", summary["first_failure"])
        self.assertNotIn("rule_worker", summary)
        selection["rule_worker"] = None
        with patch.object(self.feedback, "plan", return_value=selection):
            status, summary = self.invoke()
        self.assertNotEqual(status, 0)
        self.assertIn("derived-worker requirement", summary["first_failure"])



class RuleDerivationTests(unittest.TestCase):
    def test_rule_adapter_shares_budget_preserves_each_log_and_propagates_failure(self):
        import time
        import m9e_current_cost as cost
        self.feedback.FULL = self.report
        self.feedback.TIMINGS = {}
        deadline = time.monotonic() + 1000
        adapter = self.rule.bounded_rule_feedback(self.feedback, deadline)
        calls = []
        def run(command, **kwargs):
            calls.append((command, kwargs))
            kwargs["output"].write_text("retained metadata")
            return {"path": kwargs["output"], "elapsed_seconds": 0.25}
        with patch.object(cost, "run_bounded", side_effect=run):
            first = adapter.run(["git", "rev-parse", "HEAD"], "rule-meta-same", self.root)
            second = adapter.run(["git", "rev-parse", "HEAD"], "rule-meta-same", self.root)
            adapter.run(["cargo", "build"], "rule-worker-build", env={"ONLY": "explicit"})
        self.assertNotEqual(first, second)
        self.assertEqual(first.read_text(), "retained metadata")
        self.assertEqual(second.read_text(), "retained metadata")
        self.assertEqual([(item[1]["seconds"], item[1]["byte_limit"]) for item in calls],
                         [(60, 16384), (60, 16384), (900, 16 << 20)])
        self.assertTrue(all(item[1]["global_deadline"] == deadline for item in calls))
        self.assertEqual(calls[-1][1]["environment"], {"ONLY": "explicit"})
        self.assertEqual(calls[-1][1]["cwd"], self.feedback.RUST)
        self.assertEqual(list(self.feedback.TIMINGS.values()), [250, 250, 250])
        with patch.object(cost, "run_bounded", side_effect=RuntimeError("deadline exhausted")), self.assertRaisesRegex(RuntimeError, "deadline exhausted"):
            adapter.run(["git", "status"], "rule-meta-failure", self.root)
        self.assertEqual(len(self.feedback.TIMINGS), 3)

    def test_rule_adapter_rejects_invalid_budget_names_and_command_overflow_before_spawn(self):
        import time
        import m9e_current_cost as cost
        for deadline in (True, None, "100", float("inf"), float("nan"), time.monotonic() - 1):
            with self.subTest(deadline=deadline), self.assertRaises(RuntimeError):
                self.rule.bounded_rule_feedback(self.feedback, deadline)
        adapter = self.rule.bounded_rule_feedback(self.feedback, time.monotonic() + 1000)
        with patch.object(cost, "run_bounded") as spawn:
            for name in (None, "../outside", "rule-" + "a" * 65, "rule-UPPER"):
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    adapter.run(["git", "status"], name)
            adapter.counter = 64
            with self.assertRaisesRegex(RuntimeError, "count"):
                adapter.run(["git", "status"], "rule-meta-overflow")
            spawn.assert_not_called()

    def test_rule_compaction_retains_exact_full_proof_pointer_without_changing_small_evidence(self):
        small = {"rule_worker": copy.deepcopy(self.evidence)}
        original = copy.deepcopy(small)
        self.rule.compact(small, "a" * 64, self.rule.encoded)
        self.assertEqual(small, original)
        large = {"rule_worker": copy.deepcopy(self.evidence), "other": "x" * 14000}
        self.assertGreater(len(self.rule.encoded(large)), 16000)
        self.rule.compact(large, "b" * 64, self.rule.encoded)
        self.assertEqual(large["rule_worker"], {"file": "phase-summary.json", "sha256": "b" * 64, "field": "rule_worker"})
        self.assertLessEqual(len(self.rule.encoded(large)), 16000)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="m9e-rule-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.rule, self.policy, self.clean, self.identity, self.evidence = rule_fixture(self.root)
        self.report = self.root / "report"
        self.report.mkdir()
        self.calls, self.committed, self.defect = [], False, None
        self.checkout = None
        self.feedback = SimpleNamespace(ROOT=self.root, RUST=self.root / "rust", REPORT=self.report,
                                        re=re, json=json, hashlib=hashlib, Path=Path, os=os,
                                        tempfile=tempfile, shutil=shutil, run=self.command,
                                        digest=lambda path: hashlib.sha256(path.read_bytes()).hexdigest())
        self.summary = {"product_sha": CANDIDATE, "target": self.clean["target"], "profile": "test",
                        "toolchain": self.identity["toolchain"], "plan": {"rule_worker": self.policy}}
        # Native runner cache variables must not redirect these synthetic files.
        self.environment = patch.dict(os.environ, {"CARGO_TARGET_DIR": str(self.root / "rust/target")})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def metadata(self, feedback, args, cwd=None):
        self.assertIs(feedback, self.feedback)
        cwd = self.root if cwd is None else cwd
        if args == ["git", "rev-parse", "HEAD"]:
            return CANDIDATE if cwd == self.root or not self.committed else "e" * 40
        if args == ["git", "diff", "--name-only", "HEAD", "--"]:
            return "" if cwd == self.root or self.committed else self.rule.RULE_SOURCE
        if args[:3] == ["git", "status", "--porcelain"]:
            return ""
        if args == ["git", "rev-parse", "HEAD^"]:
            return "d" * 40 if self.defect == "parent" else CANDIDATE
        if args[:3] == ["git", "rev-list", "--parents"]:
            return " ".join(["e" * 40, CANDIDATE] + (["f" * 40] if self.defect == "merge" else []))
        if args[:3] == ["git", "diff-tree", "--no-commit-id"]:
            if "--name-only" in args:
                return self.rule.RULE_SOURCE + ("\nother.rs" if self.defect == "extra-source" else "")
            mode = "100755" if self.defect == "mode" else "100644"
            return f":100644 {mode} {'1' * 40} {'2' * 40} M\t{self.rule.RULE_SOURCE}"
        if args[:2] == ["git", "rev-parse"]:
            value = args[2]
            if value.startswith("HEAD^:"):
                return "1" * 40
            if value.startswith("HEAD:"):
                return "2" * 40
            if value == "HEAD^{tree}":
                return "3" * 40
            if value == CANDIDATE + "^{tree}":
                return "4" * 40
        if args == ["rustc", "--version"]:
            return "rustc other" if self.defect == "compiler" else self.identity["toolchain"]
        if args == ["rustc", "-vV"]:
            return "host: " + self.identity["target"]
        if args == ["cargo", "--version"]:
            return "cargo 1.97.1"
        raise AssertionError((args, cwd))

    def command(self, args, name, cwd, env=None):
        self.calls.append((args, name, cwd, env))
        log = self.report / (name + ".log")
        log.write_text("ok\n")
        if name == "rule-worktree-create":
            self.checkout = Path(args[-2])
            self.checkout.mkdir()
            for path in (*self.rule.RULE_INPUTS.values(), self.rule.RULE_SOURCE, self.rule.RULE_TEST_SOURCE):
                destination = self.checkout / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(self.root / path, destination)
        elif name == "rule-derive-commit":
            self.committed = True
            if self.defect == "cargo-input":
                (self.checkout / "rust/Cargo.lock").write_text("changed lock")
        elif name == "rule-source-patch":
            log.write_text("declared one-file patch\n" * (1000 if self.defect == "patch-bound" else 1))
        elif name == "rule-worker-build":
            self.assertIn("--locked", args)
            self.assertIn("--offline", args)
            self.assertEqual(args[args.index("--profile") + 1], "test")
            self.assertEqual(args[args.index("--target") + 1], self.clean["target"])
            self.assertEqual(cwd, self.checkout / "rust")
            build_root = Path(env["CARGO_TARGET_DIR"])
            self.assertNotEqual(build_root, self.root / "rust/target")
            binary = build_root / "debug/er-kernel-worker"
            if self.defect == "outside":
                binary = self.root / "outside/er-kernel-worker"
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_bytes(b"clean candidate worker" if self.defect == "same-binary" else b"derived worker")
            binary.chmod(0o755)
            artifact = {"reason": "compiler-artifact", "target": {"name": "er-kernel-worker", "kind": ["bin"]},
                        "profile": {"test": False}, "manifest_path": str(self.checkout / self.rule.RULE_INPUTS["manifest"]),
                        "package_id": "path+file:///derived#er-kernel-worker@0.1.0", "executable": str(binary)}
            if self.defect == "profile":
                artifact["profile"]["test"] = True
            elif self.defect == "manifest":
                artifact["manifest_path"] = str(self.root / self.rule.RULE_INPUTS["manifest"])
            elif self.defect == "package":
                artifact["package_id"] = "path+file:///derived#other@0.1.0"
            artifacts = [artifact]
            if self.defect == "ambiguous":
                second = build_root / "other/er-kernel-worker"
                second.parent.mkdir()
                second.write_bytes(binary.read_bytes())
                second.chmod(0o755)
                artifacts.append({**artifact, "executable": str(second)})
            log.write_text("\n".join(json.dumps(item) for item in artifacts) + "\n")
            if self.defect == "build":
                raise RuntimeError("synthetic build failed")
        return log

    def test_rule_policy_and_proof_bind_exact_derivation_and_success(self):
        self.rule.validate_rule_evidence(self.evidence, self.policy, self.identity, self.clean)
        for key, value in (("schema_version", True), ("status", "prepared"), ("parent_sha", "d" * 40),
                           ("changed_paths", [self.rule.RULE_SOURCE, "other.rs"]), ("source_mode", "100755"),
                           ("derived_source_sha", CANDIDATE), ("tree_sha", "4" * 40), ("derived_blob", "1" * 40),
                           ("test", "renamed"), ("target", "wrong"), ("patch_bytes", 16_385),
                           ("patch_sha256", "bad"), ("candidate_preserved_sha256", "0" * 64),
                           ("pool_verified_after_test", False), ("pool_files", ["base-worker", "rule-worker", "extra"]),
                           ("tests", {"executed": 1, "passed": 0, "failed": 1, "skipped": 0})):
            with self.subTest(key=key):
                bad = {**self.evidence, key: value}
                with self.assertRaises(RuntimeError):
                    self.rule.validate_rule_evidence(bad, self.policy, self.identity, self.clean)
        for key, value in (("bytes", 0), ("bytes", 128 * 1024 * 1024 + 1), ("sha256", self.clean["sha256"]),
                           ("source_sha", CANDIDATE), ("cargo_profile", {"test": True}), ("package_identity", "other"),
                           ("manifest_path", "../Cargo.toml")):
            with self.subTest(worker=key):
                bad = copy.deepcopy(self.evidence)
                bad["worker"][key] = value
                with self.assertRaises(RuntimeError):
                    self.rule.validate_rule_evidence(bad, self.policy, self.identity, self.clean)
        bad_identity = copy.deepcopy(self.identity)
        bad_identity["files"]["rule_test"] = "0" * 64
        with self.assertRaises(RuntimeError):
            self.rule.validate_rule_evidence(self.evidence, self.policy, bad_identity, self.clean)
        source = self.root / self.rule.RULE_SOURCE
        source.write_text(self.rule.RULE_ORIGINAL * 2)
        with self.assertRaisesRegex(RuntimeError, "exactly one"):
            self.rule.make_rule_policy(self.root, CANDIDATE)

    def test_rule_context_derives_once_and_cleans_before_publish(self):
        with patch.object(self.rule, "bounded_capture", side_effect=self.metadata):
            with self.rule.current_rule_worker(self.feedback, self.summary, self.clean) as (env, evidence):
                base, variant = Path(env["ER_M9E_WORKER_EXECUTABLE"]), Path(env["ER_M9E_RULE_WORKER_EXECUTABLE"])
                self.assertEqual(base.parent, variant.parent)
                self.assertEqual(sorted(path.name for path in base.parent.iterdir()), ["base-worker", "rule-worker"])
                self.assertEqual(env["ER_M9E_RULE_WORKER_PARENT_SHA"], CANDIDATE)
                self.assertEqual(env["ER_M9E_RULE_WORKER_SOURCE_SHA"], "e" * 40)
                self.assertEqual(evidence["status"], "prepared")
                self.assertNotIn("candidate_preserved_sha256", evidence)
            self.assertFalse(base.exists())
            self.assertTrue(evidence["pool_verified_after_test"])
            self.assertEqual(evidence["candidate_preserved_sha256"], self.policy["original_sha256"])
            self.assertEqual(evidence["status"], "prepared")
        names = [call[1] for call in self.calls]
        self.assertLess(names.index("rule-materialize-source"), names.index("rule-derive-commit"))
        self.assertLess(names.index("rule-derive-commit"), names.index("rule-worker-build"))
        self.assertEqual(names[-1], "rule-worktree-remove")
        evidence.update(status="passed", test=self.rule.RULE_TEST, target=self.rule.RULE_TARGET,
                        tests={"executed": 1, "passed": 1, "failed": 0, "skipped": 0})
        self.rule.validate_rule_evidence(evidence, self.policy, self.identity, self.clean)

    def test_rule_derivation_artifact_and_build_failures_never_yield_or_escape_cleanup(self):
        for defect in ("parent", "merge", "extra-source", "mode", "cargo-input", "compiler", "patch-bound",
                       "manifest", "profile", "package", "outside", "ambiguous", "same-binary", "build"):
            with self.subTest(defect=defect):
                self.defect, self.committed, self.calls = defect, False, []
                with patch.object(self.rule, "bounded_capture", side_effect=self.metadata), self.assertRaises(RuntimeError):
                    with self.rule.current_rule_worker(self.feedback, self.summary, self.clean):
                        self.fail("invalid derived source/artifact reached ordinary test")
                self.assertEqual(self.calls[-1][1], "rule-worktree-remove")
                self.assertEqual(self.feedback.digest(self.root / self.rule.RULE_SOURCE), self.policy["original_sha256"])
                self.assertEqual(self.feedback.digest(Path(self.clean["path"])), self.clean["sha256"])

    def test_rule_test_failure_or_pool_tamper_still_cleans_and_metadata_is_bounded(self):
        for tamper in (False, True):
            with self.subTest(tamper=tamper):
                self.committed, self.calls = False, []
                with patch.object(self.rule, "bounded_capture", side_effect=self.metadata), self.assertRaises(RuntimeError):
                    with self.rule.current_rule_worker(self.feedback, self.summary, self.clean) as (env, evidence):
                        if tamper:
                            Path(env["ER_M9E_RULE_WORKER_EXECUTABLE"]).write_bytes(b"tampered")
                        else:
                            raise RuntimeError("ordinary witness failed")
                self.assertEqual(self.calls[-1][1], "rule-worktree-remove")
                self.assertEqual(evidence["status"], "prepared")
                self.assertEqual(evidence["candidate_preserved_sha256"], self.policy["original_sha256"])
        log = self.report / "metadata.log"
        log.write_bytes(b"x" * 16_385)
        with patch.object(self.feedback, "run", return_value=log), self.assertRaisesRegex(RuntimeError, "metadata exceeds"):
            self.rule.bounded_capture(self.feedback, ["git", "rev-parse", "HEAD"])

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

    def test_control_query_aggregate_requires_both_lanes_exact_inventory_and_real_worker_binding(self):
        identity = ":".join(self.phases.CONTROL_QUERY_TARGET)
        binding, assets, tests, cohort = browser_worker_fixture(self.phases)
        for proof in (self.native, self.other):
            proof["plan"].update({"requires_current_control_query": True, "requires_worker_executable": True,
                                  "requires_browser_worker": True, "browser_worker_binding": binding,
                                  "required_native_test_ids": {identity: list(self.phases.CONTROL_QUERY_TEST_IDS)}})
            proof["plan"]["required_native_targets"]["er-cli"] = ["m9e_current_control_query"]
            proof["required_native_target_counts"][identity] = 2
            proof["inventory"].append({"crate": "er-cli", "target": "m9e_current_control_query",
                                       "ids": sorted(self.phases.CONTROL_QUERY_TEST_IDS), "historical_excluded_ids": []})
            proof["inventory"].sort(key=lambda item: (item["crate"], item["target"]))
            proof["assigned_targets"] = self.phases.partition(proof["inventory"])[proof["lane"]]
            proof["completed_targets"] = list(proof["assigned_targets"])
            proof["tests"]["selected"] += 2
            if proof["lane"] == "a":
                proof["tests"]["executed"] += 2
                proof["tests"]["passed"] += 2
            proof["worker"] = {"source_sha": CANDIDATE, "target": self.identity["target"], "profile": "test",
                               "manifest_path": "rust/crates/er-kernel-worker/Cargo.toml", "cargo_profile": {"test": False},
                               "bytes": 10, "sha256": "c" * 64}
            proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
            proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
            self.phases.validate_native(proof, self.identity)
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", self.other)
        self.platform.update({"native_manifest_sha256": self.native_hash, "plan_sha256": self.native["plan_sha256"],
                              "browser_worker_assets": assets, "browser_worker_tests": tests,
                              "browser_worker_codec": {"expected": 3, "passed": 3, "failed": 0, "skipped": 0,
                                                       "selected_test_ids": list(self.phases.WORKER_CODEC_IDS)}})
        self.platform["browser_assets"]["assets"] = cohort
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            aggregate = self.phases.aggregate(None)
        self.assertEqual(aggregate["qualification"], "passed")
        self.assertEqual(aggregate["tests"]["selected"], 15)
        self.assertEqual(aggregate["tests"]["passed"], 15)
        self.assertEqual(aggregate["browser_worker_tests"]["passed"], 2)
        self.assertEqual(aggregate["browser_worker_codec"]["passed"], 3)
        self.assertEqual(aggregate["browser_tests"]["chromium"]["passed"], 2)
        self.assertEqual(aggregate["browser_current_repro_bridge"], self.platform["browser_current_repro_bridge"])
        for lane in ("a", "b"):
            original = self.native if lane == "a" else self.other
            for mode in ("missing", "renamed", "worker", "flag", "assigned_to_b"):
                proof = copy.deepcopy(original)
                if mode == "missing":
                    proof["inventory"] = [item for item in proof["inventory"] if item["target"] != "m9e_current_control_query"]
                elif mode == "renamed":
                    next(item for item in proof["inventory"] if item["target"] == "m9e_current_control_query")["ids"][0] = "renamed"
                elif mode == "worker":
                    proof["worker"] = None
                elif mode == "flag":
                    proof["plan"]["requires_current_control_query"] = False
                else:
                    proof["assigned_targets"] = [["er-cli", "m9e_current_control_query"]] if lane == "b" else []
                proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
                proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
                if mode in ("missing", "renamed"):
                    proof["assigned_targets"] = self.phases.partition(proof["inventory"])[lane]
                    proof["completed_targets"] = list(proof["assigned_targets"])
                with self.subTest(lane=lane, mode=mode), self.assertRaises(RuntimeError):
                    self.phases.validate_native(proof, self.identity)
        bad = copy.deepcopy(self.other)
        bad["plan"]["requires_current_control_query"] = False
        bad["plan_sha256"] = self.phases.sha(self.phases.encoded(bad["plan"]))
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", bad)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            with self.assertRaises(RuntimeError):
                self.phases.aggregate(None)

    def test_state_query_aggregate_requires_both_lanes_exact_inventory_and_real_worker_binding(self):
        binding, assets, tests, cohort = browser_worker_fixture(self.phases)
        for proof in (self.native, self.other):
            proof["plan"].update({"requires_current_state_query": True, "requires_worker_executable": True,
                                  "requires_browser_worker": True, "browser_worker_binding": binding,
                                  "required_native_test_ids": {":".join(target): list(ids)
                                                               for target, ids in self.phases.STATE_QUERY_IDENTITIES.items()}})
            proof["plan"]["required_native_targets"]["er-cli"] = [target[1] for target in self.phases.STATE_QUERY_IDENTITIES]
            for target, ids in self.phases.STATE_QUERY_IDENTITIES.items():
                proof["required_native_target_counts"][":".join(target)] = 1
                proof["inventory"].append({"crate": target[0], "target": target[1],
                                           "ids": list(ids), "historical_excluded_ids": []})
            control_identity = ":".join(self.phases.CONTROL_QUERY_TARGET)
            proof["plan"]["requires_current_control_query"] = True
            proof["plan"]["required_native_test_ids"][control_identity] = list(self.phases.CONTROL_QUERY_TEST_IDS)
            proof["plan"]["required_native_targets"]["er-cli"].append("m9e_current_control_query")
            proof["required_native_target_counts"][control_identity] = 2
            proof["inventory"].append({"crate": "er-cli", "target": "m9e_current_control_query",
                                       "ids": sorted(self.phases.CONTROL_QUERY_TEST_IDS), "historical_excluded_ids": []})
            proof["inventory"].sort(key=lambda item: (item["crate"], item["target"]))
            proof["assigned_targets"] = self.phases.partition(proof["inventory"])[proof["lane"]]
            proof["completed_targets"] = list(proof["assigned_targets"])
            proof["tests"]["selected"] += 4
            addition = 3 if proof["lane"] == "a" else 1
            proof["tests"]["executed"] += addition
            proof["tests"]["passed"] += addition
            proof["worker"] = {"source_sha": CANDIDATE, "target": self.identity["target"], "profile": "test",
                               "manifest_path": "rust/crates/er-kernel-worker/Cargo.toml", "cargo_profile": {"test": False},
                               "bytes": 10, "sha256": "c" * 64}
            proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
            proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
            self.phases.validate_native(proof, self.identity)
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", self.other)
        self.platform.update({"native_manifest_sha256": self.native_hash, "plan_sha256": self.native["plan_sha256"],
                              "browser_worker_assets": assets, "browser_worker_tests": tests,
                              "browser_worker_codec": {"expected": 3, "passed": 3, "failed": 0, "skipped": 0,
                                                       "selected_test_ids": list(self.phases.WORKER_CODEC_IDS)}})
        self.platform["browser_assets"]["assets"] = cohort
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            aggregate = self.phases.aggregate(None)
        self.assertEqual(aggregate["qualification"], "passed")
        self.assertEqual(aggregate["tests"]["selected"], 17)
        self.assertEqual(aggregate["tests"]["passed"], 17)
        self.assertEqual(aggregate["browser_worker_tests"]["passed"], 2)
        self.assertEqual(aggregate["browser_worker_codec"]["passed"], 3)
        self.assertEqual(aggregate["browser_tests"]["chromium"]["passed"], 2)
        self.assertEqual(aggregate["browser_current_repro_bridge"], self.platform["browser_current_repro_bridge"])
        for lane in ("a", "b"):
            original = self.native if lane == "a" else self.other
            for mode in ("missing", "renamed", "worker", "flag", "assigned_to_b", "worker_missing", "worker_renamed"):
                proof = copy.deepcopy(original)
                if mode == "missing":
                    proof["inventory"] = [item for item in proof["inventory"] if item["target"] != "m9e_current_state_query"]
                elif mode == "renamed":
                    next(item for item in proof["inventory"] if item["target"] == "m9e_current_state_query")["ids"][0] = "renamed"
                elif mode == "worker":
                    proof["worker"] = None
                elif mode == "flag":
                    proof["plan"]["requires_current_state_query"] = False
                elif mode == "worker_missing":
                    proof["inventory"] = [item for item in proof["inventory"] if item["target"] != "m9e_current_state_query_worker"]
                elif mode == "worker_renamed":
                    next(item for item in proof["inventory"] if item["target"] == "m9e_current_state_query_worker")["ids"][0] = "renamed"
                else:
                    proof["assigned_targets"] = [["er-cli", "m9e_current_state_query"]] if lane == "b" else []
                proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
                proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
                if mode in ("missing", "renamed"):
                    proof["assigned_targets"] = self.phases.partition(proof["inventory"])[lane]
                    proof["completed_targets"] = list(proof["assigned_targets"])
                with self.subTest(lane=lane, mode=mode), self.assertRaises(RuntimeError):
                    self.phases.validate_native(proof, self.identity)
        bad = copy.deepcopy(self.other)
        bad["plan"]["requires_current_state_query"] = False
        bad["plan_sha256"] = self.phases.sha(self.phases.encoded(bad["plan"]))
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", bad)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            with self.assertRaises(RuntimeError):
                self.phases.aggregate(None)

    def test_rule_variant_is_required_by_actual_inventory_and_aggregate_only_accepts_c_owned_success(self):
        rule, policy, clean, rule_identity, evidence = rule_fixture(self.root)
        self.identity["files"].update(rule_identity["files"])
        key = "er-cli:" + rule.RULE_TARGET
        self.native["plan"].update(rule_worker=policy, requires_worker_executable=True)
        self.native["plan"]["required_native_targets"]["er-cli"] = [rule.RULE_TARGET]
        self.native["plan"]["required_native_test_ids"] = {key: [rule.RULE_TEST]}
        self.native["inventory"].append({"crate": "er-cli", "target": rule.RULE_TARGET,
                                         "ids": [rule.RULE_TEST], "historical_excluded_ids": []})
        self.native["required_native_target_counts"][key] = 1
        self.native["plan_sha256"] = self.phases.sha(self.phases.encoded(self.native["plan"]))
        self.native["inventory_sha256"] = self.phases.sha(self.phases.encoded(self.native["inventory"]))
        self.native["assigned_targets"] = self.phases.partition(self.native["inventory"])["a"]
        self.native["completed_targets"] = self.native["assigned_targets"]
        self.native["tests"].update(selected=14, executed=11, passed=11)
        self.native["worker"] = {name: value for name, value in clean.items() if name != "path"}
        self.other = copy.deepcopy(self.native)
        self.other["lane"] = "b"
        self.other["assigned_targets"] = self.phases.partition(self.native["inventory"])["b"]
        self.other["completed_targets"] = self.other["assigned_targets"]
        self.other["tests"].update(executed=2, passed=2)
        self.other["native_timer_parity_digest"] = None
        with self.phase_environment(rule_evidence=evidence):
            third = self.phases.read_bounded(self.root / "proof/native-c.json", self.third_hash)
        self.assertIn(["er-cli", rule.RULE_TARGET], third["assigned_targets"])
        self.assertNotIn(["er-cli", rule.RULE_TARGET], self.native["assigned_targets"])
        self.assertNotIn(["er-cli", rule.RULE_TARGET], self.other["assigned_targets"])
        self.phases.validate_native(self.native, self.identity)
        self.phases.validate_native(self.other, self.identity)
        self.phases.validate_native(third, self.identity)
        for defect in ("missing", "wrong-test", "failed", "unselected-policy", "missing-required", "wrong-parent", "unrestored"):
            with self.subTest(defect=defect):
                bad = copy.deepcopy(third)
                if defect == "missing":
                    bad.pop("rule_worker")
                elif defect == "wrong-test":
                    bad["rule_worker"]["test"] = "renamed"
                elif defect == "failed":
                    bad["rule_worker"]["tests"].update(passed=0, failed=1)
                elif defect == "unselected-policy":
                    bad["plan"]["rule_worker"] = None
                elif defect == "missing-required":
                    bad["plan"]["required_native_targets"].pop("er-cli")
                    bad["required_native_target_counts"].pop(key)
                elif defect == "wrong-parent":
                    bad["rule_worker"]["parent_sha"] = "d" * 40
                else:
                    bad["rule_worker"]["candidate_preserved_sha256"] = "0" * 64
                bad["plan_sha256"] = self.phases.sha(self.phases.encoded(bad["plan"]))
                with self.assertRaises(RuntimeError):
                    self.phases.validate_native(bad, self.identity)
        for owner in (self.native, self.other):
            bad = copy.deepcopy(owner)
            bad["rule_worker"] = evidence
            with self.assertRaisesRegex(RuntimeError, "C-owned"):
                self.phases.validate_native(bad, self.identity)
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", self.other)
        self.platform["native_manifest_sha256"] = self.native_hash
        self.platform["plan_sha256"] = self.native["plan_sha256"]
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(rule_evidence=evidence), patch.object(self.phases, "identity", return_value=self.identity):
            result = self.phases.aggregate(None)
        self.assertEqual(result["qualification"], "passed")
        self.assertEqual(result["tests"]["executed"], 14)
        self.assertEqual(result["rule_worker"], evidence)
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.platform["native_manifest_sha256"] = self.native_hash
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity), self.assertRaises(RuntimeError):
            self.phases.aggregate(None)
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

    def test_browser_worker_manifest_rejects_rehashed_path_source_role_and_bound_tampering(self):
        binding, assets, _, cohort = browser_worker_fixture(self.phases)
        self.phases.validate_browser_worker_assets(assets, binding, cohort)
        for mutation in ("path", "source", "missing_source", "builder", "cohort", "role", "too_many", "too_large", "boolean_bytes", "wrong_hash"):
            bad = copy.deepcopy(assets)
            manifest = bad["manifest"]
            if mutation == "path":
                manifest["assets"]["../escape.js"] = manifest["assets"].pop(manifest["worker"])
                manifest["worker"] = "../escape.js"
            elif mutation == "source":
                manifest["source_sha"] = "0" * 40
            elif mutation == "missing_source":
                manifest["source_hashes"].pop(self.phases.WORKER_SOURCE_PATHS[0])
            elif mutation == "builder":
                manifest["builder_sha256"] = "0" * 64
            elif mutation == "cohort":
                manifest["cohort"]["wasm_sha256"] = "0" * 64
            elif mutation == "role":
                manifest["assets"][manifest["worker"]]["role"] = "chunk"
            elif mutation == "too_many":
                for index in range(7):
                    manifest["assets"][f"chunk-{index}.js"] = {"bytes": 1, "sha256": "a" * 64, "role": "chunk"}
            elif mutation == "too_large":
                manifest["assets"][manifest["worker"]]["bytes"] = 4_194_304
            elif mutation == "boolean_bytes":
                manifest["assets"][manifest["worker"]]["bytes"] = True
            bad["manifest_sha256"] = self.phases.sha(self.phases.encoded(manifest)) if mutation != "wrong_hash" else "0" * 64
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                self.phases.validate_browser_worker_assets(bad, binding, cohort)

    def test_worker_required_aggregate_preserves_old_witnesses_and_rejects_missing_or_false_evidence(self):
        binding, assets, tests, cohort = browser_worker_fixture(self.phases)
        # Frozen old plans and their old two-witness platform proof still validate.
        self.phases.validate_platform(self.platform, self.native, self.native_hash)
        self.native["plan"].update({"requires_browser_worker": True, "browser_worker_binding": binding})
        self.native["plan_sha256"] = self.phases.sha(self.phases.encoded(self.native["plan"]))
        self.other["plan"] = copy.deepcopy(self.native["plan"])
        self.other["plan_sha256"] = self.native["plan_sha256"]
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", self.other)
        self.platform.update({"native_manifest_sha256": self.native_hash, "plan_sha256": self.native["plan_sha256"],
                              "browser_worker_assets": assets, "browser_worker_tests": tests,
                              "browser_worker_codec": {"expected": 3, "passed": 3, "failed": 0, "skipped": 0,
                                                       "selected_test_ids": list(self.phases.WORKER_CODEC_IDS)}})
        self.platform["browser_assets"]["assets"] = cohort
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            aggregate = self.phases.aggregate(None)
        self.assertEqual(aggregate["qualification"], "passed")
        self.assertEqual(aggregate["browser_worker_tests"], tests)
        self.assertEqual(aggregate["browser_worker_assets"], assets)
        self.assertEqual(aggregate["browser_worker_codec"]["passed"], 3)
        self.assertEqual(aggregate["browser_tests"]["chromium"]["passed"], 2)
        self.assertEqual(aggregate["browser_tests"]["typed_effects"]["passed"], 1)
        self.assertEqual(aggregate["browser_current_repro_bridge"], self.platform["browser_current_repro_bridge"])
        for key in ("browser_worker_tests", "browser_worker_assets", "browser_worker_codec", "browser_tests", "browser_current_repro_bridge"):
            bad = copy.deepcopy(self.platform)
            del bad[key]
            self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", bad)
            with self.subTest(key=key), self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
                with self.assertRaises(RuntimeError):
                    self.phases.aggregate(None)
        for field, value in (("observed_worker_count", 0), ("presentation_count", 0), ("disposed", False)):
            bad = copy.deepcopy(self.platform)
            bad["browser_worker_tests"]["positive"][field] = value
            self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", bad)
            with self.subTest(field=field), self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
                with self.assertRaises(RuntimeError):
                    self.phases.aggregate(None)

    def test_rtc_aggregate_requires_both_native_lanes_all_old_proofs_and_bound_real_rtc(self):
        worker_binding, worker_assets, worker_tests, _ = browser_worker_fixture(self.phases)
        binding, assets, tests, cohort = browser_rtc_fixture(self.phases)
        self.phases.validate_platform(self.platform, self.native, self.native_hash)
        self.native["plan"].update({"requires_browser_worker": True, "browser_worker_binding": worker_binding,
                                    "requires_browser_rtc": True, "browser_rtc_binding": binding})
        self.native["plan_sha256"] = self.phases.sha(self.phases.encoded(self.native["plan"]))
        self.other["plan"] = copy.deepcopy(self.native["plan"])
        self.other["plan_sha256"] = self.native["plan_sha256"]
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", self.other)
        self.platform.update({"native_manifest_sha256": self.native_hash, "plan_sha256": self.native["plan_sha256"],
            "browser_worker_assets": worker_assets, "browser_worker_tests": worker_tests,
            "browser_worker_codec": {"expected": 3, "passed": 3, "failed": 0, "skipped": 0, "selected_test_ids": list(self.phases.WORKER_CODEC_IDS)},
            "browser_rtc_assets": assets, "browser_rtc_tests": tests})
        self.platform["browser_assets"]["assets"] = cohort
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            aggregate = self.phases.aggregate(None)
            self.assertEqual(aggregate["qualification"], "passed")
            self.assertEqual(aggregate["browser_rtc_tests"], tests)
            self.assertEqual(aggregate["browser_worker_tests"], worker_tests)
            with patch.dict(os.environ, {"M9E_NATIVE_B_RESULT": "cancelled"}), self.assertRaises(RuntimeError):
                self.phases.aggregate(None)
        for key in ("browser_rtc_assets", "browser_rtc_tests", "browser_worker_assets", "browser_worker_tests", "browser_worker_codec",
                    "wasm_tests", "browser_tests", "browser_current_repro_bridge"):
            bad = copy.deepcopy(self.platform)
            del bad[key]
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.phases.validate_platform(bad, self.native, self.native_hash)
        for mutation in ("source", "role", "overlap", "checkpoint", "fake_delivery"):
            bad = copy.deepcopy(self.platform)
            manifest = bad["browser_rtc_assets"]["manifest"]
            if mutation == "source": manifest["source_hashes"][self.phases.RTC_PATHS[0]] = "0" * 64
            if mutation == "role": manifest["assets"][manifest["worker"]]["role"] = "chunk"
            if mutation == "overlap": manifest["assets"][worker_assets["manifest"]["entry"]] = {"bytes": 1, "sha256": "0" * 64, "role": "chunk"}
            if mutation == "checkpoint": bad["browser_rtc_tests"]["positive"]["authority_fixture_sha256"] = "0" * 64
            if mutation == "fake_delivery": bad["browser_rtc_tests"]["positive"]["right_kernel_delivered"] = 0
            bad["browser_rtc_assets"]["manifest_sha256"] = self.phases.sha(self.phases.encoded(manifest))
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                self.phases.validate_platform(bad, self.native, self.native_hash)
        native = copy.deepcopy(self.native)
        native["plan"]["requires_browser_rtc"] = False
        with self.assertRaisesRegex(RuntimeError, "unrequested RTC"):
            self.phases.validate_platform(self.platform, native, self.native_hash)

    def test_rtc_compact_summary_references_full_proof_without_raising_existing_bounds(self):
        _, assets, tests, _ = browser_rtc_fixture(self.phases)
        compact = {"existing": "x" * 14_500, "browser_rtc_assets": assets, "browser_rtc_tests": tests}
        original = copy.deepcopy(compact)
        self.phases.compact_rtc_evidence(compact, "a" * 64)
        self.assertLessEqual(len(self.phases.encoded(compact)), 16000)
        self.assertEqual(compact["existing"], original["existing"])
        self.assertEqual(compact["browser_rtc_assets"], {"file": "phase-summary.json", "sha256": "a" * 64})
        self.assertLessEqual(len(self.phases.encoded(original)), self.phases.MANIFEST_LIMIT)
        small = {"browser_rtc_tests": tests}
        self.phases.compact_rtc_evidence(small, "b" * 64)
        self.assertEqual(small["browser_rtc_tests"], tests)

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
        for key in ("timer_mutant", "replica_mutant"):
            with self.subTest(lane="b", mutant=key):
                proof = copy.deepcopy(self.other)
                proof[key] = {"status": "detected"}
                with self.assertRaisesRegex(RuntimeError, "non-A lane cannot claim lane A mutant"):
                    self.phases.validate_native(proof, self.identity)

    def test_ai_damage_query_proof_keeps_full_required_ids_both_mutants_and_platform_bridge(self):
        config = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        policy = config["ai_damage_query_focus"]
        proof = copy.deepcopy(self.native)
        proof["plan"].update({"ai_damage_query_focus": True, "timer_focus": True, "material_retention_focus": False,
                               "required_native_targets": policy["required_targets"],
                               "required_native_test_ids": policy["exact_test_ids"], "ledger_mutant": None})
        proof["inventory"] = [{"crate": crate, "target": target,
                               "ids": policy["exact_test_ids"].get(f"{crate}:{target}", ["behavior"]),
                               "historical_excluded_ids": []}
                              for crate, targets in policy["required_targets"].items() for target in targets]
        proof["required_native_target_counts"] = {f'{item["crate"]}:{item["target"]}': len(item["ids"])
                                                    for item in proof["inventory"]}
        policies = {"timer_mutant": config["timer_focus"]["mutant"],
                    "replica_mutant": config["timer_focus"]["replica_mutant"]}
        for key, selected in policies.items():
            proof["plan"][key] = selected
            proof[key] = {"status": "detected", "source": selected["source"], "test": selected["test"],
                          "target": selected["target"], "original_sha256": "a" * 64, "restored_sha256": "a" * 64,
                          "tests": {"executed": 1, "passed": 0, "failed": 1, "skipped": 0}}
        assignment = self.phases.partition(proof["inventory"])
        proof["assigned_targets"] = assignment["a"]
        proof["completed_targets"] = assignment["a"]
        selected = sum(len(item["ids"]) for item in proof["inventory"])
        passed = sum(len(item["ids"]) for item in proof["inventory"] if [item["crate"], item["target"]] in assignment["a"])
        proof["tests"].update({"selected": selected, "executed": passed, "passed": passed})
        proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
        proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
        self.phases.validate_native(proof, self.identity)
        self.assertIn(["er-game", "m9e_damage_query"], assignment["a"])
        self.assertIn(["er-ai", "er_ai"], assignment["a"])
        self.assertEqual({tuple(pair) for pair in assignment["b"]}, {
            ("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_repro"),
            ("er-cli", "m9e_current_reload")})
        self.assertIn(["er-cli", "m9e_current_batch"], assignment["c"])
        for key in policies:
            for damage in ("missing", "restoration", "wrong_test"):
                with self.subTest(key=key, damage=damage):
                    bad = copy.deepcopy(proof)
                    if damage == "missing":
                        bad.pop(key)
                    elif damage == "restoration":
                        bad[key]["restored_sha256"] = "b" * 64
                    else:
                        bad[key]["test"] = "different_behavior"
                    with self.assertRaisesRegex(RuntimeError, "mutant"):
                        self.phases.validate_native(bad, self.identity)
        bad = copy.deepcopy(proof)
        bad["ledger_mutant"] = {"status": "detected"}
        with self.assertRaisesRegex(RuntimeError, "outside the retention scope"):
            self.phases.validate_native(bad, self.identity)
        bad = copy.deepcopy(proof)
        query = next(item for item in bad["inventory"] if (item["crate"], item["target"]) == ("er-game", "m9e_damage_query"))
        query["ids"] = list(query["ids"])
        query["ids"][0] += "_renamed"
        bad["inventory_sha256"] = self.phases.sha(self.phases.encoded(bad["inventory"]))
        with self.assertRaisesRegex(RuntimeError, "exact test identities"):
            self.phases.validate_native(bad, self.identity)
        other = copy.deepcopy(proof)
        other["lane"] = "b"
        other["assigned_targets"] = assignment["b"]
        other["completed_targets"] = assignment["b"]
        other_count = sum(len(row["ids"]) for row in other["inventory"] if [row["crate"], row["target"]] in assignment["b"] )
        other["tests"].update({"executed": other_count, "passed": other_count})
        other["native_timer_parity_digest"] = None
        for key in policies:
            other.pop(key)
        self.phases.validate_native(other, self.identity)
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", proof)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", other)
        self.platform.update({"native_manifest_sha256": self.native_hash, "plan_sha256": proof["plan_sha256"]})
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(native=proof), patch.object(self.phases, "identity", return_value=self.identity):
            aggregate = self.phases.aggregate(None)
        self.assertEqual(aggregate["tests"]["passed"], selected)
        self.assertEqual(aggregate["browser_current_repro_bridge"], self.platform["browser_current_repro_bridge"])
        for key in policies:
            self.assertEqual(aggregate[key], proof[key])
        self.platform["browser_current_repro_bridge"]["time_omission_rejected"] = False
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(native=proof), patch.object(self.phases, "identity", return_value=self.identity), \
                self.assertRaisesRegex(RuntimeError, "bridge"):
            self.phases.aggregate(None)

    def test_retention_ledger_mutant_requires_owned_restored_evidence_through_aggregate(self):
        config = json.loads(HARNESS.with_name("m9e-targets.json").read_text())
        policies = {"timer_mutant": config["timer_focus"]["mutant"],
                    "replica_mutant": config["timer_focus"]["replica_mutant"],
                    "ledger_mutant": config["material_retention_focus"]["ledger_mutant"]}
        proof = copy.deepcopy(self.native)
        proof["plan"]["material_retention_focus"] = True
        proof["plan"]["required_native_test_ids"] = {}
        for key, policy in policies.items():
            proof["plan"][key] = policy
            proof["inventory"].append({"crate": policy["package"], "target": policy["target"],
                                       "ids": [policy["test"]], "historical_excluded_ids": []})
            proof["plan"]["required_native_targets"].setdefault(policy["package"], []).append(policy["target"])
            identity = f'{policy["package"]}:{policy["target"]}'
            proof["plan"]["required_native_test_ids"][identity] = [policy["test"]]
            proof["required_native_target_counts"][identity] = 1
            proof[key] = {"status": "detected", "source": policy["source"], "test": policy["test"],
                          "target": policy["target"], "original_sha256": "a" * 64, "restored_sha256": "a" * 64,
                          "tests": {"executed": 1, "passed": 0, "failed": 1, "skipped": 0}}
        proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
        proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
        proof["assigned_targets"] = self.phases.partition(proof["inventory"])["a"]
        proof["completed_targets"] = proof["assigned_targets"]
        proof["tests"].update({"selected": 16, "executed": 14, "passed": 14})
        self.phases.validate_native(proof, self.identity)
        for label in ("missing", "restoration", "counts", "source", "test", "target", "policy", "scope"):
            with self.subTest(label=label):
                bad = copy.deepcopy(proof)
                if label == "missing":
                    bad.pop("ledger_mutant")
                elif label == "restoration":
                    bad["ledger_mutant"]["restored_sha256"] = "b" * 64
                elif label == "counts":
                    bad["ledger_mutant"]["tests"]["failed"] = 0
                elif label in {"source", "test", "target"}:
                    bad["ledger_mutant"][label] = "different"
                elif label == "policy":
                    bad["plan"].pop("ledger_mutant")
                elif label == "scope":
                    bad["plan"]["material_retention_focus"] = False
                bad["plan_sha256"] = self.phases.sha(self.phases.encoded(bad["plan"]))
                with self.assertRaisesRegex(RuntimeError, "mutant"):
                    self.phases.validate_native(bad, self.identity)
        other = copy.deepcopy(proof)
        other["lane"] = "b"
        other["assigned_targets"] = self.phases.partition(other["inventory"])["b"]
        other["completed_targets"] = other["assigned_targets"]
        other["tests"].update({"executed": 2, "passed": 2})
        other["native_timer_parity_digest"] = None
        for key in policies:
            other.pop(key)
        self.phases.validate_native(other, self.identity)
        other["ledger_mutant"] = proof["ledger_mutant"]
        with self.assertRaisesRegex(RuntimeError, "non-A lane"):
            self.phases.validate_native(other, self.identity)
        other.pop("ledger_mutant")
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", proof)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", other)
        self.platform["native_manifest_sha256"] = self.native_hash
        self.platform["plan_sha256"] = proof["plan_sha256"]
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(native=proof), patch.object(self.phases, "identity", return_value=self.identity):
            result = self.phases.aggregate(None)
        for key in policies:
            self.assertEqual(result[key], proof[key])
        self.assertEqual(result["tests"], {"selected": 16, "executed": 16, "passed": 16, "failed": 0, "skipped": 0})
        missing = copy.deepcopy(proof)
        missing.pop("ledger_mutant")
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", missing)
        with self.phase_environment(native=proof), patch.object(self.phases, "identity", return_value=self.identity), \
                self.assertRaisesRegex(RuntimeError, "mutant"):
            self.phases.aggregate(None)

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

    def native_with_repeated_required_ids(self):
        proof = copy.deepcopy(self.native)
        ids = [f"case_{index:04d}_" + "full_current_state_and_effect_ownership_" * 2 for index in range(600)]
        proof["inventory"][1]["ids"] = ids
        proof["plan"]["required_native_test_ids"] = {"er-repro:m9e_current_repro": list(reversed(ids))}
        proof["required_native_target_counts"]["er-repro:m9e_current_repro"] = len(ids)
        proof["tests"].update({"selected": len(ids) + 4, "executed": len(ids) + 2, "passed": len(ids) + 2})
        proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
        proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
        return proof

    def test_native_manifest_indices_preserve_complete_proof_and_required_order(self):
        proof = self.native_with_repeated_required_ids()
        before = copy.deepcopy(proof)
        self.phases.validate_native(proof, self.identity)
        self.assertGreater(len(self.phases.encoded(proof)), self.phases.MANIFEST_LIMIT)
        path = self.root / "indexed.json"
        digest = self.phases.write_bounded(path, proof)
        self.assertLessEqual(path.stat().st_size, self.phases.MANIFEST_LIMIT)
        self.assertEqual(digest, self.phases.file_hash(path))
        wire = json.loads(path.read_bytes())
        self.assertEqual(wire["encoding"], "native-inventory-indices-v1")
        self.assertEqual(wire["proof"]["inventory"], proof["inventory"])
        self.assertEqual(wire["proof"]["assigned_targets"], [1, 2])
        self.assertEqual(wire["proof"]["completed_targets"], [1, 2])
        self.assertEqual(wire["proof"]["plan"]["required_native_test_ids"]["er-repro:m9e_current_repro"],
                         list(reversed(range(600))))
        restored = self.phases.read_bounded(path, digest)
        self.assertEqual(restored, before)
        self.assertEqual(proof, before)
        self.phases.validate_native(restored, self.identity)
        # Reconstructing the wire representation does not waive count validation.
        restored["tests"]["executed"] -= 1
        with self.assertRaisesRegex(RuntimeError, "counts"):
            self.phases.validate_native(restored, self.identity)

    def test_native_manifest_indices_reject_tampering_and_missing_evidence(self):
        packed = self.phases.pack_native_ids(self.native_with_repeated_required_ids())
        target = "er-repro:m9e_current_repro"
        for label in ("bool", "negative", "outside", "duplicate", "missing_index", "unknown_target",
                      "missing_target", "reordered", "inventory", "version", "unknown_field", "missing_proof",
                      "assigned_bool", "assigned_outside", "completed_duplicate", "missing_completed"):
            with self.subTest(label=label):
                wire = copy.deepcopy(packed)
                required = wire["proof"]["plan"]["required_native_test_ids"]
                if label in {"bool", "negative", "outside", "duplicate"}:
                    required[target][0] = {"bool": True, "negative": -1, "outside": 600, "duplicate": 598}[label]
                elif label == "missing_index":
                    required[target].pop()
                elif label == "unknown_target":
                    required["er-repro:unknown"] = required.pop(target)
                elif label == "missing_target":
                    required.pop(target)
                elif label == "reordered":
                    required[target].reverse()
                elif label == "inventory":
                    wire["proof"]["inventory"][1]["ids"][0] += "_tampered"
                elif label == "version":
                    wire["encoding"] = "native-inventory-indices-v2"
                elif label == "unknown_field":
                    wire["extra"] = True
                elif label == "missing_proof":
                    wire.pop("proof")
                elif label == "assigned_bool":
                    wire["proof"]["assigned_targets"][0] = True
                elif label == "assigned_outside":
                    wire["proof"]["assigned_targets"][0] = 3
                elif label == "completed_duplicate":
                    wire["proof"]["completed_targets"][0] = 2
                elif label == "missing_completed":
                    wire["proof"].pop("completed_targets")
                path = self.root / "tampered.json"
                data = self.phases.encoded(wire)
                self.assertLessEqual(len(data), self.phases.MANIFEST_LIMIT)
                path.write_bytes(data)
                # Supply the actual wire hash: rejection must inspect references
                # and semantic hashes rather than merely detect a stale file hash.
                with self.assertRaisesRegex(RuntimeError, "native"):
                    self.phases.read_bounded(path, self.phases.sha(data))

    def test_native_manifest_index_encoding_keeps_wire_and_expansion_bounded(self):
        proof = self.native_with_repeated_required_ids()
        proof["padding"] = ""
        proof["padding"] = "x" * (self.phases.NATIVE_PROOF_LIMIT + 1 - len(self.phases.encoded(proof)))
        with self.assertRaisesRegex(RuntimeError, "64 KiB"):
            self.phases.write_bounded(self.root / "oversize-indexed.json", proof)
        with self.assertRaisesRegex(RuntimeError, "bounded expansion"):
            self.phases.unpack_native_ids(self.phases.pack_native_ids(proof))
        packed = self.phases.pack_native_ids(self.native_with_repeated_required_ids())
        packed["proof"]["plan"]["required_native_test_ids"]["er-repro:m9e_current_repro"] = [0] * 100_000
        with self.assertRaisesRegex(RuntimeError, "permutation"):
            self.phases.unpack_native_ids(packed)

    def native_requiring_inventory_compression(self):
        proof = copy.deepcopy(self.native)
        ids = [f"case_{index:04d}_" + "current_damage_and_effect_preservation_" * 2 for index in range(900)]
        proof["inventory"].append({"crate": "er-battle", "target": "m7_query_cases", "ids": ids,
                                   "historical_excluded_ids": ["explicit_legacy_case"]})
        proof["plan"]["historical_dispositions"] = [
            {"crate": "er-battle", "target": "m7_query_cases", "test": "explicit_legacy_case"}]
        proof["plan"]["required_native_targets"]["er-battle"] = ["m7_query_cases"]
        proof["plan"]["required_native_test_ids"] = {
            "er-repro:m9e_current_repro": list(reversed(proof["inventory"][1]["ids"]))}
        proof["required_native_target_counts"]["er-battle:m7_query_cases"] = len(ids)
        proof["tests"].update({"selected": 13 + len(ids), "executed": 11 + len(ids), "passed": 11 + len(ids)})
        proof["assigned_targets"] = self.phases.partition(proof["inventory"])["a"]
        proof["completed_targets"] = list(reversed(proof["assigned_targets"]))
        proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
        proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
        return proof

    def replace_compressed_id_bytes(self, wire, raw):
        wire["inventory_ids"] = {"decoded_bytes": len(raw),
                                 "data": base64.b64encode(self.phases.zlib.compress(raw, level=9)).decode("ascii")}

    def test_compressed_native_proof_keeps_complete_evidence_above_old_expansion_limit(self):
        proof = self.native_requiring_inventory_compression()
        proof["plan"]["required_native_test_ids"]["er-battle:m7_query_cases"] = list(
            reversed(proof["inventory"][-1]["ids"]))
        proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
        for lane in ("a", "b"):
            with self.subTest(lane=lane):
                candidate = copy.deepcopy(proof)
                candidate["lane"] = lane
                candidate["assigned_targets"] = self.phases.partition(candidate["inventory"])[lane]
                candidate["completed_targets"] = list(reversed(candidate["assigned_targets"]))
                if lane == "b":
                    candidate["tests"].update({"executed": 2, "passed": 2})
                    candidate["native_timer_parity_digest"] = None
                self.phases.validate_native(candidate, self.identity)
                self.assertGreater(len(self.phases.encoded(candidate)), 2 * self.phases.MANIFEST_LIMIT)
                self.assertLess(len(self.phases.encoded(candidate)), self.phases.NATIVE_PROOF_LIMIT)
                candidate["padding"] = ""
                candidate["padding"] = "x" * (self.phases.NATIVE_PROOF_LIMIT - len(self.phases.encoded(candidate)))
                self.assertEqual(len(self.phases.encoded(candidate)), self.phases.NATIVE_PROOF_LIMIT)
                before = copy.deepcopy(candidate)
                path = self.root / f"exact-expanded-{lane}.json"
                digest = self.phases.write_bounded(path, candidate)
                self.assertLessEqual(path.stat().st_size, self.phases.MANIFEST_LIMIT)
                wire = json.loads(path.read_bytes())
                self.assertEqual(wire["encoding"], self.phases.NATIVE_COMPRESSED_ID_ENCODING)
                self.assertLessEqual(wire["inventory_ids"]["decoded_bytes"], 2 * self.phases.MANIFEST_LIMIT)
                restored = self.phases.read_bounded(path, digest)
                self.assertEqual(restored, before)
                self.assertEqual(candidate, before)
                self.phases.validate_native(restored, self.identity)
                wire["proof"]["padding"] += "x"
                data = self.phases.encoded(wire)
                self.assertLessEqual(len(data), self.phases.MANIFEST_LIMIT)
                path.write_bytes(data)
                with self.assertRaisesRegex(RuntimeError, "bounded expansion"):
                    self.phases.read_bounded(path, self.phases.sha(data))
                candidate["padding"] += "x"
                with self.assertRaisesRegex(RuntimeError, "64 KiB"):
                    self.phases.write_bounded(self.root / f"over-expanded-{lane}.json", candidate)

    def test_compressed_native_ids_roundtrip_both_lanes_without_changing_semantics(self):
        proof = self.native_requiring_inventory_compression()
        self.assertGreater(len(self.phases.encoded(self.phases.pack_native_ids(proof))), self.phases.MANIFEST_LIMIT)
        self.assertLessEqual(len(self.phases.encoded(proof)), 2 * self.phases.MANIFEST_LIMIT)
        for lane in ("a", "b"):
            with self.subTest(lane=lane):
                candidate = copy.deepcopy(proof)
                candidate["lane"] = lane
                candidate["assigned_targets"] = self.phases.partition(candidate["inventory"])[lane]
                candidate["completed_targets"] = list(reversed(candidate["assigned_targets"]))
                if lane == "b":
                    candidate["tests"].update({"executed": 2, "passed": 2})
                    candidate["native_timer_parity_digest"] = None
                before = copy.deepcopy(candidate)
                self.phases.validate_native(candidate, self.identity)
                path = self.root / "proof" / f"native-{lane}.json"
                digest = self.phases.write_bounded(path, candidate)
                if lane == "a":
                    self.native_hash = digest
                else:
                    self.other_hash = digest
                wire = json.loads(path.read_bytes())
                self.assertEqual(wire["encoding"], "native-inventory-zlib-indices-v2")
                self.assertLessEqual(path.stat().st_size, self.phases.MANIFEST_LIMIT)
                self.assertEqual(wire["proof"]["inventory"],
                                 [{"crate": item["crate"], "target": item["target"]} for item in before["inventory"]])
                self.assertEqual(wire["proof"]["plan"]["required_native_test_ids"]["er-repro:m9e_current_repro"],
                                 list(reversed(range(9))))
                restored = self.phases.read_bounded(path, digest)
                self.assertEqual(restored, before)
                self.assertEqual(candidate, before)
                self.phases.validate_native(restored, self.identity)
                restored["tests"]["passed"] -= 1
                with self.assertRaisesRegex(RuntimeError, "counts"):
                    self.phases.validate_native(restored, self.identity)
        self.assertEqual(self.phases.pack_native_inventory(self.native), self.native)
        inline_path = self.root / "inline-unchanged.json"
        self.phases.write_bounded(inline_path, self.native)
        self.assertEqual(inline_path.read_bytes(), self.phases.encoded(self.native))
        legacy = self.native_with_repeated_required_ids()
        self.assertEqual(self.phases.pack_native_inventory(legacy), self.phases.pack_native_ids(legacy))
        legacy_path = self.root / "indexed-unchanged.json"
        self.phases.write_bounded(legacy_path, legacy)
        self.assertEqual(legacy_path.read_bytes(), self.phases.encoded(self.phases.pack_native_ids(legacy)))
        self.platform.update({"native_manifest_sha256": self.native_hash, "plan_sha256": proof["plan_sha256"]})
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(native=proof), patch.object(self.phases, "identity", return_value=self.identity):
            result = self.phases.aggregate(None)
        self.assertEqual(result["tests"], {"selected": 913, "executed": 913, "passed": 913, "failed": 0, "skipped": 0})
        self.assertEqual(result["browser_current_repro_bridge"], self.platform["browser_current_repro_bridge"])
        self.assertEqual(result["inventory_sha256"], proof["inventory_sha256"])
        candidate["completed_targets"] = []
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", candidate)
        with self.phase_environment(native=proof), patch.object(self.phases, "identity", return_value=self.identity), \
                self.assertRaisesRegex(RuntimeError, "completed targets"):
            self.phases.aggregate(None)

    def test_compressed_native_ids_reject_malformed_wrapper_and_base64(self):
        packed = self.phases.pack_native_inventory(self.native_requiring_inventory_compression())
        for label in ("version", "extra", "missing_payload", "payload_type", "payload_extra", "bool_size", "float_size",
                      "zero_size", "negative_size", "over_size", "data_type", "empty_data", "bad_base64",
                      "base64_whitespace", "extra_padding", "over_base64", "target_extra", "target_missing",
                      "target_duplicate", "target_type"):
            with self.subTest(label=label):
                wire = copy.deepcopy(packed)
                payload = wire["inventory_ids"]
                if label == "version":
                    wire["encoding"] = "native-inventory-zlib-indices-v3"
                elif label == "extra":
                    wire["extra"] = True
                elif label == "missing_payload":
                    wire.pop("inventory_ids")
                elif label == "payload_type":
                    wire["inventory_ids"] = []
                elif label == "payload_extra":
                    payload["extra"] = True
                elif label in {"bool_size", "float_size", "zero_size", "negative_size", "over_size"}:
                    payload["decoded_bytes"] = {"bool_size": True, "zero_size": 0, "negative_size": -1,
                                                "float_size": float(payload["decoded_bytes"]),
                                                "over_size": 2 * self.phases.MANIFEST_LIMIT + 1}[label]
                elif label == "data_type":
                    payload["data"] = []
                elif label == "empty_data":
                    payload["data"] = ""
                elif label == "bad_base64":
                    payload["data"] = "%not-base64%"
                elif label == "base64_whitespace":
                    payload["data"] += "\n"
                elif label == "extra_padding":
                    payload["data"] += "="
                elif label == "over_base64":
                    payload["data"] = "A" * (self.phases.MANIFEST_LIMIT + 1)
                elif label == "target_extra":
                    wire["proof"]["inventory"][0]["ids"] = []
                elif label == "target_missing":
                    wire["proof"]["inventory"][0].pop("target")
                elif label == "target_duplicate":
                    wire["proof"]["inventory"][1] = copy.deepcopy(wire["proof"]["inventory"][0])
                elif label == "target_type":
                    wire["proof"]["inventory"][0]["crate"] = True
                with self.assertRaisesRegex(RuntimeError, "native"):
                    self.phases.unpack_native_ids(wire)

    def test_compressed_native_ids_reject_truncated_trailing_and_oversized_streams_before_json(self):
        packed = self.phases.pack_native_inventory(self.native_requiring_inventory_compression())
        compressed = base64.b64decode(packed["inventory_ids"]["data"])
        for label, stream in (("truncated", compressed[:-1]), ("trailing", compressed + b"junk"),
                              ("concatenated", compressed + compressed), ("not_zlib", b"not a zlib stream")):
            with self.subTest(label=label):
                wire = copy.deepcopy(packed)
                wire["inventory_ids"]["data"] = base64.b64encode(stream).decode("ascii")
                with patch.object(self.phases.json, "loads") as parse, self.assertRaisesRegex(RuntimeError, "payload"):
                    self.phases.unpack_native_ids(wire)
                parse.assert_not_called()
        wire = copy.deepcopy(packed)
        self.replace_compressed_id_bytes(wire, b"x" * (2 * self.phases.MANIFEST_LIMIT + 1))
        wire["inventory_ids"]["decoded_bytes"] = 2 * self.phases.MANIFEST_LIMIT
        with patch.object(self.phases.json, "loads") as parse, self.assertRaisesRegex(RuntimeError, "bound"):
            self.phases.unpack_native_ids(wire)
        parse.assert_not_called()
        for difference in (-1, 1):
            wire = copy.deepcopy(packed)
            wire["inventory_ids"]["decoded_bytes"] += difference
            with self.assertRaisesRegex(RuntimeError, "payload"):
                self.phases.unpack_native_ids(wire)

    def test_compressed_native_ids_reject_semantic_tampering_with_correct_wire_hash(self):
        proof = self.native_requiring_inventory_compression()
        packed = self.phases.pack_native_inventory(proof)
        original = [[item["ids"], item["historical_excluded_ids"]] for item in proof["inventory"]]
        for label in ("missing_target", "extra_target", "row_type", "list_type", "id_type", "empty_id",
                      "json_text", "json_utf8", "outer_type", "nested_id",
                      "duplicate_id", "excluded_collision", "reordered_ids", "changed_id", "required_bool"):
            with self.subTest(label=label):
                wire, lists = copy.deepcopy(packed), copy.deepcopy(original)
                if label == "missing_target":
                    lists.pop()
                elif label == "extra_target":
                    lists.append([[], []])
                elif label == "row_type":
                    lists[0] = {}
                elif label == "list_type":
                    lists[0][0] = "not a list"
                elif label == "id_type":
                    lists[0][0][0] = True
                elif label == "nested_id":
                    lists[0][0][0] = [["not an ID"]]
                elif label == "empty_id":
                    lists[0][0][0] = ""
                elif label == "duplicate_id":
                    lists[3][0][1] = lists[3][0][0]
                elif label == "excluded_collision":
                    lists[3][1] = [lists[3][0][0]]
                elif label == "reordered_ids":
                    lists[3][0].reverse()
                elif label == "changed_id":
                    lists[3][0][0] += "_changed"
                elif label == "required_bool":
                    wire["proof"]["plan"]["required_native_test_ids"]["er-repro:m9e_current_repro"][0] = True
                raw = {"json_text": b"not JSON", "json_utf8": b"\xff", "outer_type": b"{}"}.get(
                    label, self.phases.encoded(lists))
                self.replace_compressed_id_bytes(wire, raw)
                path = self.root / "tampered-compressed.json"
                data = self.phases.encoded(wire)
                self.assertLessEqual(len(data), self.phases.MANIFEST_LIMIT)
                path.write_bytes(data)
                with self.assertRaisesRegex(RuntimeError, "native"):
                    self.phases.read_bounded(path, self.phases.sha(data))

    def test_compressed_native_ids_keep_exact_output_wire_and_expanded_bounds(self):
        proof = self.native_requiring_inventory_compression()
        wire = self.phases.pack_native_inventory(proof)
        raw = self.phases.encoded([[item["ids"], item["historical_excluded_ids"]] for item in proof["inventory"]])
        # Valid JSON whitespace reaches the exact output ceiling without
        # inventing IDs or changing the restored semantic proof.
        raw += b" " * (2 * self.phases.MANIFEST_LIMIT - len(raw))
        self.replace_compressed_id_bytes(wire, raw)
        self.assertEqual(self.phases.unpack_native_ids(wire), proof)
        wire["inventory_ids"]["decoded_bytes"] += 1
        with self.assertRaisesRegex(RuntimeError, "bounds"):
            self.phases.unpack_native_ids(wire)
        expanded = copy.deepcopy(proof)
        expanded["plan"]["required_native_test_ids"]["er-battle:m7_query_cases"] = list(
            expanded["inventory"][-1]["ids"])
        expanded["plan_sha256"] = self.phases.sha(self.phases.encoded(expanded["plan"]))
        expanded["padding"] = ""
        expanded["padding"] = "x" * (self.phases.NATIVE_PROOF_LIMIT - len(self.phases.encoded(expanded)))
        wire = self.phases.pack_native_inventory(expanded)
        wire["proof"]["padding"] += "x"
        self.assertLessEqual(len(self.phases.encoded(wire)), self.phases.MANIFEST_LIMIT)
        with self.assertRaisesRegex(RuntimeError, "bounded expansion"):
            self.phases.unpack_native_ids(wire)
        proof["padding"] = "x" * self.phases.MANIFEST_LIMIT
        with self.assertRaisesRegex(RuntimeError, "64 KiB"):
            self.phases.write_bounded(self.root / "compressed-still-oversized.json", proof)

    def phase_environment(self, native=None, rule_evidence=None):
        third = copy.deepcopy(self.native if native is None else native)
        third["lane"] = "c"
        third["assigned_targets"] = self.phases.partition(third["inventory"])["c"]
        third["completed_targets"] = list(third["assigned_targets"])
        count = sum(len(row["ids"]) for row in third["inventory"] if [row["crate"], row["target"]] in third["assigned_targets"])
        third["tests"].update(executed=count, passed=count, failed=0, skipped=0)
        third["native_timer_parity_digest"] = None
        for key in ("timer_mutant", "replica_mutant", "ledger_mutant", "current_cost_probe"):
            third.pop(key, None)
        if rule_evidence is not None:
            third["rule_worker"] = copy.deepcopy(rule_evidence)
        self.third_hash = self.phases.write_bounded(self.root / "proof/native-c.json", third)
        return patch.dict(os.environ, {"M9E_PHASE_DIR": str(self.root), "M9E_NATIVE_A_RESULT": "success",
                                      "M9E_NATIVE_B_RESULT": "success", "M9E_NATIVE_B_MANIFEST_SHA256": self.other_hash,
                                      "M9E_NATIVE_C_RESULT": "success", "M9E_NATIVE_C_MANIFEST_SHA256": self.third_hash,
                                      "M9E_PLATFORM_RESULT": "success", "M9E_NATIVE_MANIFEST_SHA256": self.native_hash,
                                      "M9E_PLATFORM_MANIFEST_SHA256": self.platform_hash})

    def install_third_lane_fixture(self):
        for proof in (self.native, self.other):
            for index, (crate, target) in enumerate(sorted(self.phases.LANE_C_TARGETS - {("er-cli", "m9e_current_rulechange_reload")})):
                ids = ["complete_c_witness_" + str(index)]
                proof["inventory"].append({"crate": crate, "target": target, "ids": ids, "historical_excluded_ids": []})
                proof["plan"]["required_native_targets"].setdefault(crate, []).append(target)
                proof["plan"].setdefault("required_native_test_ids", {})[crate + ":" + target] = ids
                proof["required_native_target_counts"][crate + ":" + target] = 1
            proof["inventory_sha256"] = self.phases.sha(self.phases.encoded(proof["inventory"]))
            proof["plan_sha256"] = self.phases.sha(self.phases.encoded(proof["plan"]))
            proof["tests"]["selected"] += 3
            proof["assigned_targets"] = self.phases.partition(proof["inventory"])[proof["lane"]]
            proof["completed_targets"] = list(proof["assigned_targets"])
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", self.other)
        self.platform["native_manifest_sha256"] = self.native_hash
        self.platform["plan_sha256"] = self.native["plan_sha256"]
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)

    def test_third_lane_moves_whole_targets_and_preserves_exact_disjoint_global_union(self):
        self.install_third_lane_fixture()
        inventory = self.native["inventory"]
        assignment = self.phases.partition(inventory)
        self.assertEqual(set(map(tuple, assignment["c"])), self.phases.LANE_C_TARGETS - {("er-cli", "m9e_current_rulechange_reload")})
        self.assertFalse(self.phases.LANE_B_TARGETS & self.phases.LANE_C_TARGETS)
        flat = [tuple(pair) for targets in assignment.values() for pair in targets]
        self.assertEqual(len(flat), len(set(flat)))
        self.assertEqual(set(flat), {(row["crate"], row["target"]) for row in inventory})
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            result = self.phases.aggregate(None)
        self.assertEqual(result["tests"], {"selected": 16, "executed": 16, "passed": 16, "failed": 0, "skipped": 0})
        self.assertEqual(result["native_c_manifest_sha256"], self.third_hash)
        self.assertEqual(set(result["worker_executables"]), {"a", "b", "c"})

    def test_third_lane_is_mandatory_even_for_an_empty_assigned_partition(self):
        for state in ("", "failure", "skipped", "cancelled"):
            with self.phase_environment(), patch.dict(os.environ, {"M9E_NATIVE_C_RESULT": state}), self.assertRaisesRegex(RuntimeError, "absent"):
                self.phases.aggregate(None)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            (self.root / "proof/native-c.json").unlink()
            with self.assertRaisesRegex(RuntimeError, "manifest"):
                self.phases.aggregate(None)

    def test_third_lane_rejects_rehashed_omission_overlap_wrong_run_and_non_A_claims(self):
        self.install_third_lane_fixture()
        for mode in ("omitted", "overlap", "wrong_run", "wrong_lane", "mutant", "cost", "inventory", "plan"):
            with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
                bad = self.phases.read_bounded(self.root / "proof/native-c.json", self.third_hash)
                if mode == "omitted":
                    bad["completed_targets"].pop()
                elif mode == "overlap":
                    bad["assigned_targets"].append(self.native["assigned_targets"][0])
                    bad["completed_targets"].append(self.native["assigned_targets"][0])
                elif mode == "wrong_run":
                    bad["identity"]["run_attempt"] = "2"
                elif mode == "wrong_lane":
                    bad["lane"] = "a"
                elif mode == "mutant":
                    bad["timer_mutant"] = {"status": "detected"}
                elif mode == "cost":
                    bad["current_cost_probe"] = {"status": "passed"}
                elif mode == "inventory":
                    bad["inventory"][0]["ids"].append("unrelated")
                    bad["inventory_sha256"] = self.phases.sha(self.phases.encoded(bad["inventory"]))
                else:
                    bad["plan"]["different_plan"] = True
                    bad["plan_sha256"] = self.phases.sha(self.phases.encoded(bad["plan"]))
                digest = self.phases.write_bounded(self.root / "proof/native-c.json", bad)
                with self.subTest(mode=mode), patch.dict(os.environ, {"M9E_NATIVE_C_MANIFEST_SHA256": digest}), self.assertRaises(RuntimeError):
                    self.phases.aggregate(None)

    def test_third_lane_partition_keeps_unrelated_same_name_targets_and_zero_test_harnesses(self):
        inventory = [{"crate": crate, "target": target, "ids": [], "historical_excluded_ids": []}
                     for crate, target in sorted(self.phases.LANE_C_TARGETS)]
        inventory.append({"crate": "er-other", "target": "m9e_current_batch", "ids": [], "historical_excluded_ids": []})
        assignment = self.phases.partition(inventory)
        self.assertEqual(len(assignment["c"]), 4)
        self.assertEqual(assignment["a"], [["er-other", "m9e_current_batch"]])
        self.assertEqual(assignment["b"], [])
        enumerated = [(index, "fixture", row["target"], row["ids"], Path(row["crate"]), [], None)
                      for index, row in enumerate(inventory)]
        actual, owned = self.phases.inventory_and_assignment(enumerated, "c")
        self.assertEqual(owned, self.phases.partition(actual)["c"])
        self.assertEqual(len(actual), 5)
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
            {"crate": "er-cli", "target": "m9e_current_reload", "ids": ["reload"], "historical_excluded_ids": []},
            {"crate": "er-other", "target": "m9e_current_reload", "ids": ["unrelated"], "historical_excluded_ids": []},
            {"crate": "er-kernel", "target": "m9e_timers_v7", "ids": ["timer"], "historical_excluded_ids": []},
            {"crate": "er-kernel", "target": "m9e_coop_v7", "ids": ["replica"], "historical_excluded_ids": []},
            {"crate": "er-other", "target": "m9e_host_v2", "ids": [], "historical_excluded_ids": []},
        ])
        assignment = self.phases.partition(inventory)
        self.assertIn(["er-web", "m9e_host_v2"], assignment["b"])
        self.assertIn(["er-cli", "m9e_current_batch"], assignment["c"])
        self.assertNotIn(["er-cli", "m9e_current_batch"], assignment["b"])
        self.assertIn(["er-cli", "m9e_current_reload"], assignment["b"])
        self.assertNotIn(["er-cli", "m9e_current_reload"], assignment["a"])
        self.assertIn(["er-other", "m9e_current_reload"], assignment["a"])
        self.assertIn(["er-kernel", "m9e_timers_v7"], assignment["a"])
        self.assertIn(["er-kernel", "m9e_coop_v7"], assignment["a"])
        self.assertIn(["er-other", "m9e_host_v2"], assignment["a"])
        self.assertEqual(len(assignment["b"]), 3)
        self.assertEqual(sum(len(targets) for targets in assignment.values()), len(inventory))
        self.assertFalse(set(map(tuple, assignment["a"])) & set(map(tuple, assignment["b"])))
        self.assertEqual(sorted(assignment["a"] + assignment["b"] + assignment["c"]),
                         sorted([[item["crate"], item["target"]] for item in inventory]))
        inventory.append(copy.deepcopy(inventory[0]))
        with self.assertRaisesRegex(RuntimeError, "duplicated"):
            self.phases.partition(inventory)

    def test_native_partition_rejects_omission_overlap_and_unexecuted_target(self):
        complete = copy.deepcopy(self.other)
        complete["inventory"].append({"crate": "er-cli", "target": "m9e_current_reload",
                                      "ids": ["reload"], "historical_excluded_ids": []})
        complete["inventory_sha256"] = self.phases.sha(self.phases.encoded(complete["inventory"]))
        complete["assigned_targets"] = self.phases.partition(complete["inventory"])["b"]
        complete["completed_targets"] = copy.deepcopy(complete["assigned_targets"])
        complete["tests"].update({"selected": 14, "executed": 3, "passed": 3})
        self.phases.validate_native(complete, self.identity)
        for key in ("assigned_targets", "completed_targets"):
            with self.subTest(key=key, target="er-cli:m9e_current_reload"):
                proof = copy.deepcopy(complete)
                proof[key].remove(["er-cli", "m9e_current_reload"])
                with self.assertRaises(RuntimeError):
                    self.phases.validate_native(proof, self.identity)
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

    def test_current_storage_aggregate_requires_adapter_worker_and_prior_platform_without_scope_inflation(self):
        worker_binding, assets, worker_tests, cohort = browser_worker_fixture(self.phases)
        binding, storage, _, node, _ = current_storage_fixture(self.phases)
        # Old platform proofs cannot acquire an unrequested adapter capability.
        bad = copy.deepcopy(self.platform)
        bad["current_storage_node"] = node
        with self.assertRaisesRegex(RuntimeError, "unrequested current storage"):
            self.phases.validate_platform(bad, self.native, self.native_hash)
        self.native["plan"].update({"requires_browser_worker": True, "browser_worker_binding": worker_binding,
                                    "requires_current_storage": True, "current_storage_binding": binding})
        self.native["plan_sha256"] = self.phases.sha(self.phases.encoded(self.native["plan"]))
        self.other["plan"] = copy.deepcopy(self.native["plan"])
        self.other["plan_sha256"] = self.native["plan_sha256"]
        self.native_hash = self.phases.write_bounded(self.root / "proof/native-a.json", self.native)
        self.other_hash = self.phases.write_bounded(self.root / "proof/native-b.json", self.other)
        self.platform.update({"native_manifest_sha256": self.native_hash, "plan_sha256": self.native["plan_sha256"],
                              "browser_worker_assets": assets, "browser_worker_tests": worker_tests,
                              "browser_worker_codec": {"expected": 3, "passed": 3, "failed": 0, "skipped": 0,
                                                       "selected_test_ids": list(self.phases.WORKER_CODEC_IDS)},
                              "current_storage_node": node, "current_storage_browser": storage})
        self.platform["browser_assets"]["assets"] = cohort
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", self.platform)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity):
            aggregate = self.phases.aggregate(None)
        self.assertEqual(aggregate["qualification"], "passed")
        self.assertEqual(aggregate["current_storage_browser"], storage)
        self.assertEqual(aggregate["current_storage_node"], node)
        self.assertEqual(aggregate["browser_worker_tests"], worker_tests)
        self.assertEqual(aggregate["browser_worker_codec"]["passed"], 3)
        self.assertEqual(aggregate["browser_tests"]["chromium"]["passed"], 2)
        self.assertEqual(aggregate["browser_tests"]["typed_effects"]["passed"], 1)
        self.assertEqual(aggregate["browser_current_repro_bridge"], self.platform["browser_current_repro_bridge"])
        for key in ("current_storage_node", "current_storage_browser", "browser_worker_assets", "browser_worker_tests",
                    "browser_worker_codec", "wasm_tests", "browser_tests", "browser_current_repro_bridge"):
            bad = copy.deepcopy(self.platform)
            del bad[key]
            self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", bad)
            with self.subTest(missing=key), self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity), \
                    self.assertRaises(RuntimeError):
                self.phases.aggregate(None)
        bad = copy.deepcopy(self.platform)
        bad["current_storage_browser"]["reconciled"]["capability"] = "WORKER_SAVE_GAMEPLAY"
        self.platform_hash = self.phases.write_bounded(self.root / "platform/platform.json", bad)
        with self.phase_environment(), patch.object(self.phases, "identity", return_value=self.identity), \
                self.assertRaisesRegex(RuntimeError, "storage attachment"):
            self.phases.aggregate(None)
        for field, value in (("requires_browser_worker", False), ("requires_cli_executable", False)):
            altered = copy.deepcopy(self.native)
            altered["plan"][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.phases.validate_platform(self.platform, altered, self.native_hash)
        altered = copy.deepcopy(self.native)
        altered["plan"]["current_storage_binding"]["pnpm_lock_sha256"] = "d" * 64
        with self.assertRaisesRegex(RuntimeError, "lock cohorts"):
            self.phases.validate_platform(self.platform, altered, self.native_hash)

    def test_current_storage_compact_references_preserve_full_and_existing_evidence(self):
        _, storage, _, node, _ = current_storage_fixture(self.phases)
        full = {"current_storage_browser": storage, "current_storage_node": node,
                "browser_worker_tests": {"existing": "x" * 13000}, "qualification": "passed"}
        original = copy.deepcopy(full)
        full_hash = self.phases.sha(self.phases.encoded(full))
        compact = copy.deepcopy(full)
        self.assertGreater(len(self.phases.encoded(compact)), 16000)
        self.phases.compact_storage_evidence(compact, full_hash)
        self.assertLessEqual(len(self.phases.encoded(compact)), 16000)
        self.assertEqual(compact["current_storage_browser"], {"file": "phase-summary.json", "sha256": full_hash})
        self.assertEqual(compact["current_storage_node"], node)
        self.assertEqual(compact["browser_worker_tests"], full["browser_worker_tests"])
        self.assertEqual(full, original)
        small = {"current_storage_browser": storage, "current_storage_node": node}
        unchanged = copy.deepcopy(small)
        self.phases.compact_storage_evidence(small, full_hash)
        self.assertEqual(small, unchanged)
        # Existing detail alone can still exceed the cap; storage never trims it.
        oversize = {**copy.deepcopy(full), "browser_worker_tests": {"existing": "x" * 16000}}
        self.phases.compact_storage_evidence(oversize, full_hash)
        self.assertGreater(len(self.phases.encoded(oversize)), 16000)
        self.assertEqual(oversize["current_storage_node"], {"file": "phase-summary.json", "sha256": full_hash})
        self.assertEqual(oversize["browser_worker_tests"]["existing"], "x" * 16000)

class WorkerStorageEvidenceTests(unittest.TestCase):
    def setUp(self):
        import m9e_worker_storage as composition
        import m9e_phases as phases
        self.composition, self.phases = composition, phases
        temporary = tempfile.TemporaryDirectory(prefix="m9e-composition-evidence-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / "output"
        self.full = self.root / "report/full"
        self.output.mkdir()
        self.full.mkdir(parents=True)
        for name in [*composition.SOURCE_PATHS, "pnpm-lock.yaml"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("bound source " + name)
        self.binding = composition.source_binding(self.root, CANDIDATE)
        self.cohort = {name: {"bytes": 1, "sha256": fill * 64} for name, fill in
                       (("er_web.js", "d"), ("er_web_bg.wasm", "e"), ("game-content-bundle-v2.json", "f"))}
        state = {"identities": {"next_platform_request_id": 2, "unrelated": 19}, "profile": {"sentinel": 11},
                 "active_run": {"gameplay": [1, 2, 3], "control": {"kind": "SAVE", "revision": 3,
                    "menu": {"instance_id": 5, "selected_option_id": "save/write", "options": ["save/write"]},
                    "action_context": {"menu_instance": 5, "authority_revision": 3, "operation_id": "semantic-save"}}}}
        before = {"lifecycle": {"kind": "ACTIVE", "value": state}, "pending_platform": [],
                  "pending_presentations": [], "storage_frontiers": [], "replay_sequence": 1,
                  "material_ledger": {"schema_version": 1, "next_authority_revision": 3, "records": []},
                  "next_menu_instance_id": 6, "scheduler": {"timers": [], "sentinel": 17},
                  "input_router": {"pressed": [], "suppressed_printable_keys": [], "held_buttons": [], "locks": [], "repeats": []},
                  "unrelated_owner": {"value": 23}}
        saved_state = copy.deepcopy(state)
        saved_state["identities"]["next_platform_request_id"] += 1
        save = {"schema_version": 2, "generation": 1, "content_identity": {"mock": "current"}, "state": saved_state}
        def case(kind, initial, generation):
            pending = copy.deepcopy(initial)
            request = initial["lifecycle"]["value"]["identities"]["next_platform_request_id"]
            presentation = initial["material_ledger"]["next_authority_revision"]
            pending["lifecycle"]["value"]["identities"]["next_platform_request_id"] += 1
            pending["material_ledger"]["next_authority_revision"] += 1
            pending.update({"pending_platform": [{"request_id": request}], "pending_presentations": [{"event_id": presentation}],
                            "replay_sequence": initial["replay_sequence"] + 1})
            callback = copy.deepcopy(pending)
            callback.update({"pending_platform": [], "storage_frontiers": [{"slot": "controlled-slot", "generation": generation}],
                             "replay_sequence": pending["replay_sequence"] + 1})
            if kind == "READ":
                rebound = copy.deepcopy(saved_state)
                rebound["active_run"]["control"]["revision"] = 4
                rebound["active_run"]["control"]["menu"]["instance_id"] = 6
                rebound["active_run"]["control"]["action_context"].update({"menu_instance": 6, "authority_revision": 4})
                callback["lifecycle"]["value"] = rebound
                callback["next_menu_instance_id"] = 7
                callback["material_ledger"] = {"schema_version": 1, "next_authority_revision": 4, "records": []}
            settled = copy.deepcopy(callback)
            settled.update({"pending_presentations": [], "replay_sequence": callback["replay_sequence"] + 1})
            continued = copy.deepcopy(settled)
            continued["replay_sequence"] += 1
            written_state = copy.deepcopy(initial["lifecycle"]["value"])
            written_state["identities"]["next_platform_request_id"] += 1
            payload = list(composition.js_bytes({**save, "generation": generation, "state": written_state}))
            return {"before": copy.deepcopy(initial), "pending": pending, "callback": callback, "settled": settled,
                    "continued": continued, "presentation": {"event_id": presentation},
                    "request": {"kind": kind, "request_id": request, "slot": "controlled-slot",
                                "generation": generation if kind == "WRITE" else None, "bytes": payload if kind == "WRITE" else []}}
        load = case("READ", before, 1)
        self.fixture = {"schema_version": 2, "capability": composition.CAPABILITY, "fixture_kind": composition.FIXTURE_KIND,
                        "content_identity": save["content_identity"], "natural_reached": copy.deepcopy(before),
                        "write": case("WRITE", before, 1), "load": load, "rewrite": case("WRITE", load["continued"], 2)}
        fixture_raw = composition.js_bytes(self.fixture)
        (self.output / "m9e-v7-storage-fixtures.json").write_bytes(fixture_raw)
        assets = {}
        for name, role in (("current-storage-entry.js", "entry"), ("current-storage-kernel-worker-abc.js", "worker")):
            raw = (name + " fixture").encode()
            (self.output / name).write_bytes(raw)
            assets[name] = {"bytes": len(raw), "sha256": composition.sha(raw), "role": role}
        self.manifest = {"schema_version": 2, "capability": composition.CAPABILITY, "fixture_kind": composition.FIXTURE_KIND,
                         **self.binding, "entry": "current-storage-entry.js", "worker": "current-storage-kernel-worker-abc.js",
                         "assets": assets, "fixture": {"path": "m9e-v7-storage-fixtures.json", "bytes": len(fixture_raw), "sha256": composition.sha(fixture_raw)},
                         "cohort": {"glue_sha256": "d" * 64, "wasm_sha256": "e" * 64, "content_sha256": "f" * 64}, "vite_version": "8.0.0"}
        raw = composition.js_bytes(self.manifest) + b"\n"
        (self.output / "m9e-v7-storage-assets.json").write_bytes(raw)
        installed = self.root / "node_modules/vite/package.json"
        installed.parent.mkdir(parents=True)
        installed.write_text('{"version":"8.0.0"}')
        self.assets = {"manifest_sha256": composition.sha(raw), "manifest": self.manifest,
                       "fixture_oracle": composition.fixture_oracle(self.fixture, "f" * 64)}
        self.tests = {"expected": 2, "passed": 2, "failed": 0, "skipped": 0, "selected_test_ids": composition.TEST_IDS}
        self.report = {"suites": [{"specs": []}], "errors": []}
        for index, key in enumerate(composition.KEYS):
            oracle = self.assets["fixture_oracle"]
            measured = {**{name: value for name, value in oracle.items() if name != "receipts"},
                        "lost_completion": bool(index), "writes": 2-index, "write_callbacks": 1, "load_callbacks": 1-index,
                        "generation": 1, "receipt": oracle["receipts"][key], "presentation_preserved_until_completion": True,
                        "rejected_callbacks_preserved_snapshot": True, "material_count": 2 if index else 3, "disposed": True, "queue_empty": True,
                        "pending_dispose_unconfirmed": bool(index), "cancellation": None if not index else
                        {"accepted_sequence": 1, "calls_after_cancel": 0, "dispose_acknowledged": False}}
            if index:
                measured["load_snapshot_sha256"] = None
                measured["rewrite"] = None
            attachment = {"schema_version": 2, "capability": composition.CAPABILITY, "fixture_kind": composition.FIXTURE_KIND,
                          "source_sha": CANDIDATE, "manifest_sha256": self.assets["manifest_sha256"],
                          "fixture_sha256": self.manifest["fixture"]["sha256"], "worker_sha256": assets[self.manifest["worker"]]["sha256"],
                          "observed_worker_count": 2+index, "cohort": self.manifest["cohort"], "evidence": measured}
            self.tests[key] = attachment
            self.report["suites"][0]["specs"].append({"title": composition.TEST_IDS[index], "file": composition.PRODUCT_PATHS[3], "ok": True,
                "tests": [{"projectName": "chromium", "expectedStatus": "passed", "status": "expected", "results": [{"status": "passed", "retry": 0,
                    "attachments": [{"name": "m9e-current-worker-storage-" + key, "contentType": "application/json",
                                     "body": base64.b64encode(composition.js_bytes(attachment)).decode()}]}]}]})

    def test_worker_storage_fixture_oracle_uses_exact_bytes_and_callback_state(self):
        c = self.composition
        c.validate_tests(self.tests, self.assets, self.binding, self.cohort)
        self.assertNotEqual(self.assets["fixture_oracle"]["receipts"]["save-load"], self.assets["fixture_oracle"]["receipts"]["uncertain"])
        for name in ("write", "load"):
            for field in ("pending_platform", "pending_presentations", "storage_frontiers", "replay_sequence"):
                bad = copy.deepcopy(self.fixture)
                bad[name]["callback"][field] = [] if field != "replay_sequence" else 999
                if bad == self.fixture:
                    continue
                with self.subTest(name=name, field=field), self.assertRaises(RuntimeError):
                    c.fixture_oracle(bad, "f" * 64)
        bad = copy.deepcopy(self.fixture)
        bad["write"]["request"]["bytes"][0] = True
        with self.assertRaises(RuntimeError):
            c.fixture_oracle(bad, "f" * 64)
        self.assertEqual(c.js_bytes({"10": 1, "2": 2, "\ue000": 3, "\U00010000": 4}),
                         '{"2":2,"10":1,"\U00010000":4,"\ue000":3}'.encode())

    def test_worker_storage_read_normalization_preserves_every_saved_semantic_and_unrelated_owner(self):
        c = self.composition
        c.fixture_oracle(self.fixture, "f" * 64)
        changes = [(["lifecycle", "value", "profile", "sentinel"], 99),
                   (["lifecycle", "value", "identities", "unrelated"], 99),
                   (["lifecycle", "value", "identities", "next_platform_request_id"], 99),
                   (["lifecycle", "value", "active_run", "control", "action_context", "operation_id"], "invented-operation"),
                   (["lifecycle", "value", "active_run", "control", "menu", "selected_option_id"], "other-action"),
                   (["lifecycle", "value", "active_run", "control", "action_context", "authority_revision"], 3),
                   (["lifecycle", "value", "active_run", "control", "menu", "instance_id"], 5),
                   (["unrelated_owner", "value"], 99), (["scheduler", "sentinel"], 99),
                   (["next_menu_instance_id"], 99), (["material_ledger", "next_authority_revision"], 99)]
        for path, value in changes:
            bad = copy.deepcopy(self.fixture)
            for snapshot in ("callback", "settled", "continued"):
                target = bad["load"][snapshot]
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = value
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, "READ oracle"):
                c.fixture_oracle(bad, "f" * 64)
        save = json.loads(bytes(self.fixture["write"]["request"]["bytes"]))
        for field in ("next_menu_instance_id", "revision"):
            pending, saved = copy.deepcopy(self.fixture["load"]["pending"]), copy.deepcopy(save)
            if field == "revision":
                saved["state"]["active_run"]["control"]["revision"] = (1 << 53) - 1
            else:
                pending[field] = (1 << 53) - 1
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "overflows"):
                c.normalized_read(pending, saved)

    def test_worker_storage_rewrite_requires_actual_generation_bytes_receipt_and_all_snapshots(self):
        c = self.composition
        for kind in ("generation", "gameplay", "operation", "platform"):
            bad = copy.deepcopy(self.fixture)
            save = json.loads(bytes(bad["rewrite"]["request"]["bytes"]))
            if kind == "generation": save["generation"] = 1
            elif kind == "gameplay": save["state"]["profile"]["sentinel"] += 1
            elif kind == "operation": save["state"]["active_run"]["control"]["action_context"]["operation_id"] = "other"
            else: save["state"]["identities"]["next_platform_request_id"] += 1
            bad["rewrite"]["request"]["bytes"] = list(c.js_bytes(save))
            with self.subTest(kind=kind), self.assertRaisesRegex(RuntimeError, "Write bytes"):
                c.fixture_oracle(bad, "f" * 64)
        for field, value in self.tests["save-load"]["evidence"]["rewrite"].items():
            bad = copy.deepcopy(self.tests)
            bad["save-load"]["evidence"]["rewrite"][field] = True if isinstance(value, int) else "0" * 64
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                c.validate_tests(bad, self.assets, self.binding, self.cohort)
        bad = copy.deepcopy(self.tests)
        bad["uncertain"]["evidence"]["rewrite"] = copy.deepcopy(self.tests["save-load"]["evidence"]["rewrite"])
        with self.assertRaises(RuntimeError):
            c.validate_tests(bad, self.assets, self.binding, self.cohort)
        self.assertEqual(len(c.SOURCE_PATHS), 13)
        self.assertIn("rust/crates/er-kernel/src/game_kernel_v7.rs", c.SOURCE_PATHS)

    def test_worker_storage_assets_reject_source_roles_hashes_and_oversize(self):
        c = self.composition
        for field, value in (("source_sha", BASE), ("entry", "current-worker-entry.js"), ("vite_version", "latest"),
                             ("fixture_kind", "NATURAL_SAVE"), ("cohort", {}), ("source_hashes", {})):
            bad = copy.deepcopy(self.assets)
            bad["manifest"][field] = value
            bad["manifest_sha256"] = c.sha(c.js_bytes(bad["manifest"]) + b"\n")
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                c.validate_assets(bad, self.binding, self.cohort)
        for size in (True, 0, (4 << 20) + 1):
            bad = copy.deepcopy(self.assets)
            bad["manifest"]["assets"][bad["manifest"]["entry"]]["bytes"] = size
            bad["manifest_sha256"] = c.sha(c.js_bytes(bad["manifest"]) + b"\n")
            with self.assertRaises(RuntimeError):
                c.validate_assets(bad, self.binding, self.cohort)

    def test_worker_storage_every_causal_field_and_cancellation_fact_are_required(self):
        c = self.composition
        for key in c.KEYS:
            for field, original in self.tests[key]["evidence"].items():
                bad = copy.deepcopy(self.tests)
                bad[key]["evidence"][field] = not original if isinstance(original, bool) else None if original is not None else "unexpected"
                with self.subTest(key=key, field=field), self.assertRaises(RuntimeError):
                    c.validate_tests(bad, self.assets, self.binding, self.cohort)
        for field, value in (("accepted_sequence", True), ("calls_after_cancel", True), ("dispose_acknowledged", True)):
            bad = copy.deepcopy(self.tests)
            bad["uncertain"]["evidence"]["cancellation"][field] = value
            with self.assertRaises(RuntimeError):
                c.validate_tests(bad, self.assets, self.binding, self.cohort)

    def test_worker_storage_report_rejects_wrong_source_retry_duplicate_and_unowned_path(self):
        c = self.composition
        self.assertEqual(c.test_evidence(self.report, self.assets, self.binding, self.cohort, self.root), self.tests)
        for kind in ("file", "retry", "duplicate", "path", "both", "oversize"):
            bad = copy.deepcopy(self.report)
            spec = bad["suites"][0]["specs"][0]
            run = spec["tests"][0]["results"][0]
            item = run["attachments"][0]
            if kind == "file": spec["file"] = "other.spec.ts"
            elif kind == "retry": run["retry"] = 1
            elif kind == "duplicate": run["attachments"].append(copy.deepcopy(item))
            elif kind == "both": item["path"] = "unused.json"
            elif kind == "oversize": item["body"] = "a" * 5500
            else:
                outside = self.root / "outside.json"
                outside.write_text("{}")
                del item["body"]
                item["path"] = str(outside)
            with self.subTest(kind=kind), self.assertRaises(RuntimeError):
                c.test_evidence(bad, self.assets, self.binding, self.cohort, self.root)

    def test_worker_storage_build_rehashes_real_owned_files_and_installed_vite(self):
        c = self.composition
        summary = {"product_sha": CANDIDATE, "plan": {"worker_storage_binding": self.binding}, "browser_assets": {"assets": self.cohort}}
        c.build_evidence(self.output, summary, self.root, self.full)
        self.assertEqual(summary["worker_storage_assets"], self.assets)
        extra = self.output / "current-storage-unlisted.js"
        extra.write_text("unlisted")
        with self.assertRaisesRegex(RuntimeError, "unlisted"):
            c.build_evidence(self.output, summary, self.root, self.full)
        extra.unlink()
        source = self.root / c.SOURCE_PATHS[0]
        source.write_text("changed source")
        with self.assertRaisesRegex(RuntimeError, "source changed"):
            c.build_evidence(self.output, summary, self.root, self.full)

    def test_worker_storage_commands_retain_env_and_detect_post_test_asset_changes(self):
        c = self.composition
        summary = {"product_sha": CANDIDATE, "plan": {"worker_storage_binding": self.binding},
                   "browser_assets": {"assets": self.cohort}, "worker_storage_assets": self.assets}
        env = {"RUSTUP_TOOLCHAIN": "pinned-channel", "M9E_V7_WEB_DIR": str(self.output)}
        calls = []
        def run(args, name, cwd, run_env):
            calls.append((args, name, cwd, run_env))
            (self.full / "worker-storage-results.json").write_text(json.dumps(self.report))
        c.checks(self.root, self.full, run, summary, env)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][3]["RUSTUP_TOOLCHAIN"], "pinned-channel")
        self.assertIn(c.PRODUCT_PATHS[3], calls[0][0])
        self.assertEqual(summary["worker_storage_tests"], self.tests)
        def corrupt(args, name, cwd, run_env):
            run(args, name, cwd, run_env)
            (self.output / self.manifest["worker"]).write_text("changed emitted Worker")
        with self.assertRaisesRegex(RuntimeError, "emitted bytes"):
            c.checks(self.root, self.full, corrupt, summary, env)

    def test_worker_storage_aggregate_requires_all_prior_capabilities_and_binding(self):
        c = self.composition
        plan = {name: True for name in ("requires_worker_storage", "requires_browser", "requires_browser_worker", "requires_browser_rtc",
                                       "requires_current_storage", "requires_wasm", "requires_cli_executable")}
        plan["worker_storage_binding"] = self.binding
        for key in ("browser_worker_binding", "browser_rtc_binding", "current_storage_binding"):
            plan[key] = {"pnpm_lock_sha256": self.binding["pnpm_lock_sha256"], "source_hashes": {}}
        native = {"plan": plan, "identity": {"product_sha": CANDIDATE}}
        proof = {"worker_storage_assets": self.assets, "worker_storage_tests": self.tests, "browser_assets": {"assets": self.cohort},
                 "browser_worker_assets": {"manifest": {"assets": {"current-worker-entry.js": {}}}},
                 "browser_rtc_assets": {"manifest": {"assets": {"current-rtc-entry.js": {}}}}}
        c.validate_platform(proof, native)
        for key in tuple(plan):
            if key.startswith("requires_"):
                bad = copy.deepcopy(native)
                bad["plan"][key] = False
                with self.subTest(key=key), self.assertRaises(RuntimeError):
                    c.validate_platform(proof, bad)
        bad = copy.deepcopy(proof)
        bad["browser_rtc_assets"]["manifest"]["assets"][self.manifest["entry"]] = {}
        with self.assertRaisesRegex(RuntimeError, "overlaps"):
            c.validate_platform(bad, native)
        self.assertIn("worker_storage", self.phases.IDENTITY_FILES)

    def test_worker_storage_compact_preserves_old_and_full_proof_with_only_new_refs(self):
        c = self.composition
        full = {"worker_storage_assets": self.assets, "worker_storage_tests": self.tests, "prior": "x" * 12500}
        original = copy.deepcopy(full)
        compact = copy.deepcopy(full)
        encoded = self.phases.encoded
        self.assertLess(len(encoded(full)), 65536)
        self.assertGreater(len(encoded(compact)), 16000)
        full_hash = c.sha(encoded(full))
        c.compact(compact, full_hash, encoded)
        self.assertLessEqual(len(encoded(compact)), 16000)
        self.assertEqual(compact["prior"], full["prior"])
        self.assertEqual(full, original)
        small = {"worker_storage_tests": self.tests}
        unchanged = copy.deepcopy(small)
        c.compact(small, full_hash, encoded)
        self.assertEqual(small, unchanged)
        oversized_old = {"prior": "x" * 16000, "worker_storage_tests": self.tests}
        c.compact(oversized_old, full_hash, encoded)
        self.assertGreater(len(encoded(oversized_old)), 16000)




    def title_retirement_assets_fixture(self):
        import m9e_title_storage as title
        binding = {"source_sha": CANDIDATE, "source_hashes": {name: "a" * 64 for name in title.SOURCE_PATHS},
                   "pnpm_lock_sha256": "b" * 64}
        cohort = {name: {"sha256": value * 64} for name, value in
                  (("er_web.js", "c"), ("er_web_bg.wasm", "d"), ("game-content-bundle-v2.json", "e"))}
        assets = {"current-title-storage-entry.js": {"bytes": 5, "sha256": title.sha(b"entry"), "role": "entry"},
                  "current-title-storage-kernel-worker-fixture.js": {"bytes": 6, "sha256": title.sha(b"worker"), "role": "worker"}}
        manifest = {"schema_version": 1, "capability": title.CAPABILITY, "fixture_kind": title.FIXTURE_KIND,
                    **binding, "entry": "current-title-storage-entry.js", "worker": "current-title-storage-kernel-worker-fixture.js",
                    "assets": assets, "fixture": {"path": "m9e-v7-title-storage-fixtures.json", "bytes": 2,
                                                  "sha256": title.sha(b"{}")},
                    "cohort": {"glue_sha256": "c" * 64, "wasm_sha256": "d" * 64, "content_sha256": "e" * 64},
                    "rustup_toolchain": "1.97.1", "vite_version": "8.0.10"}
        evidence = {"manifest": manifest, "manifest_sha256": title.sha(title.js_bytes(manifest) + b"\n")}
        return title, binding, cohort, evidence

    def test_title_retirement_policy_has_exact_six_products_and_copied_identities(self):
        import m9e_title_storage as title
        original = title.policy()
        title.validate_policy(original)
        self.assertEqual(len(original["paths"]), 6)
        self.assertEqual(len(title.SOURCE_PATHS), 21)
        self.assertEqual(len(original["trigger_paths"]), 3)
        self.assertEqual(len(original["node_ids"]), 11)
        self.assertEqual(len(original["test_ids"]), 1)
        for key in original:
            for mutation in (original[key][:-1], original[key] + [original[key][0]], ["renamed"]):
                with self.subTest(key=key, mutation=mutation):
                    bad = copy.deepcopy(original)
                    bad[key] = mutation
                    with self.assertRaisesRegex(RuntimeError, "policy identities"):
                        title.validate_policy(bad)
        changed = title.policy()
        changed["paths"].clear()
        self.assertEqual(title.policy(), original)
        with self.assertRaisesRegex(RuntimeError, "policy identities"):
            title.validate_policy({**original, "unknown": True})

    @patch("subprocess.run", side_effect=AssertionError("asset/source checks must not execute subprocesses"))
    def test_title_retirement_source_binding_requires_every_current_source_and_lock(self, subprocess_run):
        import m9e_title_storage as title
        for name in [*title.SOURCE_PATHS, "pnpm-lock.yaml"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Title source: " + name)
        binding = title.source_binding(self.root, CANDIDATE)
        title.validate_binding(binding, CANDIDATE)
        for name in title.SOURCE_PATHS:
            with self.subTest(name=name):
                bad = copy.deepcopy(binding)
                del bad["source_hashes"][name]
                with self.assertRaisesRegex(RuntimeError, "source binding"):
                    title.validate_binding(bad, CANDIDATE)
        for field, value in (("source_sha", BASE), ("pnpm_lock_sha256", "invalid")):
            with self.assertRaisesRegex(RuntimeError, "source binding"):
                title.validate_binding({**binding, field: value}, CANDIDATE)
        path = self.root / title.PRODUCT_PATHS[0]
        path.write_text("changed actual owner source")
        self.assertNotEqual(title.source_binding(self.root, CANDIDATE), binding)
        path.unlink()
        with self.assertRaisesRegex(RuntimeError, "bounded regular"):
            title.source_binding(self.root, CANDIDATE)
        subprocess_run.assert_not_called()

    def test_title_retirement_owner_inventory_rejects_old_five_and_every_missing_identity(self):
        import m9e_title_storage as title
        good = {"expected": 11, "passed": 11, "failed": 0, "skipped": 0, "selected_test_ids": list(title.NODE_IDS)}
        title.validate_node(good)
        for index in range(11):
            for ids in (title.NODE_IDS[:index] + title.NODE_IDS[index + 1:],
                        title.NODE_IDS[:index] + ["renamed"] + title.NODE_IDS[index + 1:],
                        title.NODE_IDS + [title.NODE_IDS[index]]):
                with self.subTest(index=index, ids=ids):
                    with self.assertRaisesRegex(RuntimeError, "eleven owner tests"):
                        title.validate_node({**good, "selected_test_ids": ids})
        for field, value in (("expected", 5), ("passed", 5), ("failed", 1), ("skipped", 1), ("failed", False)):
            with self.assertRaisesRegex(RuntimeError, "eleven owner tests"):
                title.validate_node({**good, field: value})
        with self.assertRaisesRegex(RuntimeError, "eleven owner tests"):
            title.validate_node({**good, "expected": 5, "passed": 5, "selected_test_ids": title.NODE_IDS[:5]})

    def test_title_retirement_manifest_binds_toolchain_source_cohort_and_declared_capability(self):
        title, binding, cohort, good = self.title_retirement_assets_fixture()
        title.validate_assets(good, binding, cohort, "1.97.1")
        for field, value in (("schema_version", True), ("schema_version", 2), ("capability", "INDEXEDDB_ADAPTER_ONLY"),
                             ("fixture_kind", "CONTROLLED_SAVE_CHECKPOINT"), ("source_sha", BASE),
                             ("pnpm_lock_sha256", "f" * 64), ("rustup_toolchain", "1.97.0"), ("vite_version", "latest")):
            with self.subTest(field=field, value=value):
                bad = copy.deepcopy(good)
                bad["manifest"][field] = value
                bad["manifest_sha256"] = title.sha(title.js_bytes(bad["manifest"]) + b"\n")
                with self.assertRaisesRegex(RuntimeError, "manifest source/cohort/hash"):
                    title.validate_assets(bad, binding, cohort, "1.97.1")
        with self.assertRaisesRegex(RuntimeError, "manifest source/cohort/hash"):
            title.validate_assets({**good, "manifest_sha256": "f" * 64}, binding, cohort, "1.97.1")
        bad = copy.deepcopy(good)
        bad["manifest"]["cohort"]["content_sha256"] = "f" * 64
        bad["manifest_sha256"] = title.sha(title.js_bytes(bad["manifest"]) + b"\n")
        with self.assertRaisesRegex(RuntimeError, "manifest source/cohort/hash"):
            title.validate_assets(bad, binding, cohort, "1.97.1")

    def test_title_retirement_assets_reject_escape_role_counts_and_existing_byte_bound_overflow(self):
        title, binding, cohort, good = self.title_retirement_assets_fixture()
        for mode in ("entry", "worker", "role", "file_bound", "aggregate", "fixture_bound", "fixture_path", "count"):
            with self.subTest(mode=mode):
                bad = copy.deepcopy(good)
                manifest = bad["manifest"]
                if mode == "entry": manifest["entry"] = "../entry.js"
                if mode == "worker": manifest["worker"] = "current-storage-kernel-worker-old.js"
                if mode == "role": manifest["assets"][manifest["worker"]]["role"] = "entry"
                if mode == "file_bound": manifest["assets"][manifest["entry"]]["bytes"] = (4 << 20) + 1
                if mode == "aggregate": manifest["assets"][manifest["entry"]]["bytes"] = 4 << 20
                if mode == "fixture_bound": manifest["fixture"]["bytes"] = (32 << 20) + 1
                if mode == "fixture_path": manifest["fixture"]["path"] = "../fixture.json"
                if mode == "count":
                    for index in range(7):
                        manifest["assets"][f"current-title-storage-extra-{index}.js"] = {"bytes": 1, "sha256": "f" * 64, "role": "chunk"}
                bad["manifest_sha256"] = title.sha(title.js_bytes(manifest) + b"\n")
                with self.assertRaisesRegex(RuntimeError, "Title retirement"):
                    title.validate_assets(bad, binding, cohort, "1.97.1")

    @patch("subprocess.run", side_effect=AssertionError("asset/source checks must not execute subprocesses"))
    def test_title_retirement_actual_asset_files_reject_tamper_and_unlisted_output(self, subprocess_run):
        title, binding, cohort, good = self.title_retirement_assets_fixture()
        output = self.root / "title-assets"
        output.mkdir()
        manifest = good["manifest"]
        (output / "m9e-v7-title-storage-assets.json").write_bytes(title.js_bytes(manifest) + b"\n")
        (output / "m9e-v7-title-storage-fixtures.json").write_bytes(b"{}")
        (output / manifest["entry"]).write_bytes(b"entry")
        (output / manifest["worker"]).write_bytes(b"worker")
        evidence, raw = title.bind_asset_files(output, binding, cohort, "1.97.1")
        self.assertEqual(evidence, good)
        self.assertEqual(raw, b"{}")  # Asset bytes only; no gameplay proof is inferred.
        (output / manifest["entry"]).write_bytes(b"wrong")
        with self.assertRaisesRegex(RuntimeError, "emitted asset bytes"):
            title.bind_asset_files(output, binding, cohort, "1.97.1")
        (output / manifest["entry"]).write_bytes(b"entry")
        extra = output / "current-title-storage-unlisted.js"
        extra.write_bytes(b"extra")
        with self.assertRaisesRegex(RuntimeError, "unlisted or missing"):
            title.bind_asset_files(output, binding, cohort, "1.97.1")
        extra.unlink()
        (output / "m9e-v7-title-storage-fixtures.json").write_bytes(b"[]")
        with self.assertRaisesRegex(RuntimeError, "fixture bytes"):
            title.bind_asset_files(output, binding, cohort, "1.97.1")
        subprocess_run.assert_not_called()


    def title_normalization_fixture(self):
        control = {"kind": "TITLE", "revision": 1, "owner_seat": 1,
                   "action_context": {"authority_revision": 1, "menu_instance": 1, "operation_id": "bootstrap/title/1"},
                   "menu": {"instance_id": 1, "control_id": "bootstrap/title/1", "selected_option_id": "bootstrap/title/new-game",
                            "options": [{"option_id": "bootstrap/title/existing-saves"}, {"option_id": "bootstrap/title/new-game"}]}}
        initial = {"lifecycle": {"kind": "BOOTSTRAP", "value": {"stage": "TITLE", "control": control,
                    "pressed_keys": [], "menu_instance_high_water": 1, "seed": "owned seed", "catalog": {"save_slots": ["new-destination"]},
                    "current_storage": {"owner_seat": 1, "pending": None, "next_platform_request_id": 1, "slots": [], "missing_slot": None}}},
                   "replay_sequence": 0, "next_menu_instance_id": 2, "pending_platform": [], "pending_presentations": [],
                   "storage_frontiers": [], "material_ledger": {"schema_version": 1, "next_authority_revision": 1, "records": []},
                   "unrelated_core_evidence": {"sentinel": [1, 2, 3]}}
        pending = copy.deepcopy(initial)
        owner = pending["lifecycle"]["value"]
        owner["stage"] = "EXISTING_SAVE_LOADING"
        owner["control"].update({"kind": "SAVE", "revision": 40})
        owner["menu_instance_high_water"] = 20
        owner["current_storage"].update({"next_platform_request_id": 26, "slots": ["controlled-slot"],
            "pending": {"request_id": 25, "kind": {"kind": "READ", "value": {"slot": "controlled-slot"}}}})
        pending.update({"replay_sequence": 99, "next_menu_instance_id": 21, "pending_platform": [{"request_id": 25}]})
        saved = {"schema_version": 2, "generation": 1, "state": {
            "identities": {"next_platform_request_id": 5, "other_id": 91},
            "active_run": {"party": ["opaque saved party"], "control": {"kind": "SAVE", "revision": 7,
                "menu": {"instance_id": 3, "selected_option_id": "saved/write", "options": ["saved option"]},
                "action_context": {"authority_revision": 7, "menu_instance": 3, "operation_id": "saved operation"}}},
            "opaque_saved_rng": [17, 29]}}
        return initial, pending, saved

    def test_title_read_normalization_conserves_every_other_saved_and_live_field(self):
        import m9e_title_storage as title
        _, pending, saved = self.title_normalization_fixture()
        before = copy.deepcopy((pending, saved))
        expected = copy.deepcopy(pending)
        state = copy.deepcopy(saved["state"])
        state["identities"]["next_platform_request_id"] = 26
        control = state["active_run"]["control"]
        control["revision"] = 41
        control["menu"]["instance_id"] = 21
        control["action_context"].update({"authority_revision": 41, "menu_instance": 21})
        expected.update({"lifecycle": {"kind": "ACTIVE", "value": state}, "replay_sequence": 100,
                         "next_menu_instance_id": 22, "pending_platform": [],
                         "storage_frontiers": [{"slot": "controlled-slot", "generation": 1}],
                         "material_ledger": {"schema_version": 1, "next_authority_revision": 41, "records": []}})
        self.assertEqual(title.normalized_title_read(pending, saved), expected)
        self.assertEqual((pending, saved), before)
        saved["state"]["active_run"]["control"]["revision"] = 80
        saved["state"]["active_run"]["control"]["menu"]["instance_id"] = 90
        saved["state"]["identities"]["next_platform_request_id"] = 100
        loaded = title.normalized_title_read(pending, saved)
        self.assertEqual(loaded["lifecycle"]["value"]["active_run"]["control"]["revision"], 81)
        self.assertEqual(loaded["next_menu_instance_id"], 92)
        self.assertEqual(loaded["lifecycle"]["value"]["identities"]["next_platform_request_id"], 100)

    def test_title_cancel_normalization_accounts_for_both_physical_replay_steps(self):
        import m9e_title_storage as title
        initial, pending, _ = self.title_normalization_fixture()
        before = copy.deepcopy((initial, pending))
        expected = copy.deepcopy(pending)
        owner = copy.deepcopy(initial["lifecycle"]["value"])
        owner["current_storage"]["next_platform_request_id"] = 26
        owner["menu_instance_high_water"] = 21
        owner["control"]["revision"] = 41
        owner["control"]["menu"].update({"instance_id": 21, "control_id": "bootstrap/title/41"})
        owner["control"]["action_context"].update({"authority_revision": 41, "menu_instance": 21, "operation_id": "bootstrap/title/41"})
        expected.update({"lifecycle": {"kind": "BOOTSTRAP", "value": owner}, "replay_sequence": 101,
                         "next_menu_instance_id": 22, "pending_platform": []})
        result = title.normalized_title_cancel(pending, initial)
        self.assertEqual(result, expected)
        self.assertEqual((initial, pending), before)
        self.assertEqual(result["replay_sequence"] - pending["replay_sequence"], 2)
        self.assertEqual(result["lifecycle"]["value"]["current_storage"]["pending"], None)
        self.assertEqual(result["unrelated_core_evidence"], pending["unrelated_core_evidence"])

    def test_title_normalization_rejects_overflow_wrong_owner_and_unreleased_input(self):
        import m9e_title_storage as title
        initial, pending, saved = self.title_normalization_fixture()
        for target in ("revision", "menu", "replay"):
            with self.subTest(target=target):
                bad = copy.deepcopy(pending)
                if target == "revision": bad["lifecycle"]["value"]["control"]["revision"] = (1 << 53) - 1
                if target == "menu":
                    bad["next_menu_instance_id"] = (1 << 53) - 1
                    bad["lifecycle"]["value"]["menu_instance_high_water"] = (1 << 53) - 1
                if target == "replay": bad["replay_sequence"] = (1 << 53) - 1
                with self.assertRaisesRegex(RuntimeError, "allocator overflows"):
                    title.normalized_title_read(bad, saved)
                with self.assertRaisesRegex(RuntimeError, "allocator overflows"):
                    title.normalized_title_cancel(bad, initial)
        bad = copy.deepcopy(pending)
        bad["pending_platform"][0]["request_id"] = 24
        with self.assertRaisesRegex(RuntimeError, "exact live owner"):
            title.normalized_title_read(bad, saved)
        with self.assertRaisesRegex(RuntimeError, "released owner/template"):
            title.normalized_title_cancel(bad, initial)
        bad = copy.deepcopy(pending)
        bad["lifecycle"]["value"]["pressed_keys"] = [{"kind": "ESCAPE"}]
        with self.assertRaisesRegex(RuntimeError, "released owner/template"):
            title.normalized_title_cancel(bad, initial)


    def test_title_reference_matches_actual_opt_in_menu_reallocation(self):
        import m9e_title_storage as title
        # Exact small control from Rust51f/run34044688649. Enabling storage
        # rebuilds the initial menu at instance2 while keeping revision1.
        produced = json.loads(r'''{"action_context":{"authority_revision":1,"authority_seat":1,"menu_instance":2,"operation_id":"bootstrap/title/1"},"actionable":true,"kind":"TITLE","menu":{"cancel":{"kind":"DISABLED"},"control_id":"bootstrap/title/1","instance_id":2,"navigation":[{"direction":"UP","from":"bootstrap/title/existing-saves","to":"bootstrap/title/new-game"},{"direction":"DOWN","from":"bootstrap/title/new-game","to":"bootstrap/title/existing-saves"}],"options":[{"action":{"action":{"kind":"OPEN_EXISTING_SAVES"},"kind":"BOOTSTRAP"},"enabled":true,"layout":{"column":0,"option_id":"bootstrap/title/existing-saves","page":0,"row":1},"option_id":"bootstrap/title/existing-saves","visible":true},{"action":{"action":{"kind":"OPEN_NEW_GAME"},"kind":"BOOTSTRAP"},"enabled":true,"layout":{"column":0,"option_id":"bootstrap/title/new-game","page":0,"row":0},"option_id":"bootstrap/title/new-game","visible":true}],"owner_seat":1,"selected_option_id":"bootstrap/title/new-game"},"owner_seat":1,"revision":1,"schema_version":2}''')
        self.assertEqual(title.bootstrap_control("TITLE", 1, 1, 2), produced)
        self.assertNotEqual(title.bootstrap_control("TITLE", 1, 1, 1), produced)
        self.assertEqual(produced["menu"]["selected_option_id"], "bootstrap/title/new-game")
        self.assertEqual([row["layout"]["row"] for row in produced["menu"]["options"]], [1, 0])

    def test_title_reference_menus_pin_order_actions_and_allocator(self):
        import m9e_title_storage as title
        initial = title.bootstrap_control("TITLE", 1, 1, 1)
        self.assertEqual(initial["schema_version"], 2)
        self.assertEqual(initial["menu"]["selected_option_id"], "bootstrap/title/new-game")
        self.assertEqual([option["action"] for option in initial["menu"]["options"]], [
            {"kind": "BOOTSTRAP", "action": {"kind": "OPEN_EXISTING_SAVES"}},
            {"kind": "BOOTSTRAP", "action": {"kind": "OPEN_NEW_GAME"}}])
        self.assertEqual(initial["menu"]["navigation"], [
            {"from": "bootstrap/title/existing-saves", "direction": "UP", "to": "bootstrap/title/new-game"},
            {"from": "bootstrap/title/new-game", "direction": "DOWN", "to": "bootstrap/title/existing-saves"}])
        self.assertEqual([option["option_id"] for option in initial["menu"]["options"]],
                         ["bootstrap/title/existing-saves", "bootstrap/title/new-game"])
        self.assertEqual([option["layout"]["row"] for option in initial["menu"]["options"]], [1, 0])
        selected = title.bootstrap_control("EXISTING_SAVE_SELECT", 1, 8, 9)
        self.assertEqual(selected["action_context"], {"authority_seat": 1, "authority_revision": 8, "menu_instance": 9,
                                                    "operation_id": "bootstrap/existingsaveselect/8"})
        self.assertEqual(selected["menu"]["options"][0]["action"],
                         {"kind": "BOOTSTRAP", "action": {"kind": "SELECT_EXISTING_SAVE", "value": "controlled-slot"}})
        for stage in ("EXISTING_SAVE_LISTING", "EXISTING_SAVE_LOADING"):
            control = title.bootstrap_control(stage, 1, 10, 11)
            self.assertEqual([row["option_id"] for row in control["menu"]["options"]], ["bootstrap/existing/cancel"])
            self.assertEqual(control["menu"]["cancel"], {"kind": "BACK", "action": {"kind": "BOOTSTRAP", "action": {"kind": "CANCEL"}}})
        for args in (("ACTIVE", 1, 1, 1), ("TITLE", True, 1, 1), ("TITLE", 1, 0, 1), ("TITLE", 1, 1, 1 << 53)):
            with self.assertRaisesRegex(RuntimeError, "Title reference control"):
                title.bootstrap_control(*args)

    def test_title_request_references_keep_exact_effects_and_unrelated_core_fields(self):
        import m9e_title_storage as title
        initial, _, _ = self.title_normalization_fixture()
        initial["lifecycle"]["value"]["control"] = title.bootstrap_control("TITLE", 1, 1, 1)
        initial["lifecycle"]["value"]["control"]["menu"]["selected_option_id"] = "bootstrap/title/existing-saves"
        before = copy.deepcopy(initial)
        listed = title.title_request_reference(initial, "LIST")
        self.assertEqual(listed["pending_platform"], [{"request_id": 1, "effect": {"kind": "STORAGE_LIST", "request": 1}}])
        self.assertEqual(listed["replay_sequence"], 2)
        self.assertEqual(listed["next_menu_instance_id"], 3)
        owned = listed["lifecycle"]["value"]["current_storage"]["pending"]
        self.assertEqual(owned, {"request_id": 1, "kind": {"kind": "LIST"}, "source_menu": 1,
                                 "source_revision": 1, "waiting_menu": 2, "waiting_revision": 2})
        self.assertEqual(listed["unrelated_core_evidence"], initial["unrelated_core_evidence"])
        self.assertEqual(initial, before)
        selected = title.title_slots_reference(listed)
        self.assertEqual(selected["pending_platform"], [])
        self.assertEqual(selected["replay_sequence"], 3)
        self.assertEqual(selected["lifecycle"]["value"]["current_storage"]["slots"], ["controlled-slot"])
        loaded = title.title_request_reference(selected, "READ")
        self.assertEqual(loaded["replay_sequence"], 5)
        self.assertEqual(loaded["pending_platform"], [{"request_id": 2, "effect": {"kind": "STORAGE_READ", "request": 2, "slot": "controlled-slot"}}])
        self.assertEqual(loaded["lifecycle"]["value"]["current_storage"]["next_platform_request_id"], 3)
        for value in (listed, loaded):
            with self.assertRaisesRegex(RuntimeError, "released control"):
                title.title_request_reference(value, "READ")
        bad = copy.deepcopy(initial)
        bad["lifecycle"]["value"]["current_storage"]["next_platform_request_id"] = (1 << 53) - 1
        with self.assertRaisesRegex(RuntimeError, "allocator overflows"):
            title.title_request_reference(bad, "LIST")

    def test_title_write_reference_rejects_checksum_payload_and_causal_owner_drift(self):
        import m9e_title_storage as title
        from m9e_current_proposal import canonical
        identity = {"fixture": "independent synthetic save metadata"}
        state = {"content_identity": identity, "identities": {"next_platform_request_id": 1}, "active_run": {"control": {"kind": "SAVE"}}, "kept": [4, 9]}
        before = {"lifecycle": {"kind": "ACTIVE", "value": copy.deepcopy(state)}, "pending_platform": [],
                  "pending_presentations": [], "replay_sequence": 10, "scheduler": {"timers": []},
                  "material_ledger": {"schema_version": 1, "next_authority_revision": 3, "records": []}}
        saved_state = copy.deepcopy(state)
        saved_state["identities"]["next_platform_request_id"] = 2
        saved = {"schema_version": 2, "content_identity": identity, "generation": 1, "state": saved_state}
        saved["checksum"] = "sha256-v1:" + title.sha(canonical(saved))
        payload = canonical(saved)
        presentation = {"event_id": 3, "semantic": {"kind": "CUE", "value": "SAVE"}, "blocking": "NON_BLOCKING", "skip": "ALLOWED"}
        pending = copy.deepcopy(before)
        pending.update({"pending_platform": [{"request_id": 1, "effect": {"kind": "STORAGE_WRITE", "request": 1,
            "slot": "controlled-slot", "generation": 1, "bytes": list(payload)}}], "pending_presentations": [presentation], "replay_sequence": 11})
        callback = copy.deepcopy(pending)
        callback.update({"pending_platform": [], "storage_frontiers": [{"slot": "controlled-slot", "generation": 1}], "replay_sequence": 12})
        settled = copy.deepcopy(callback)
        settled.update({"pending_presentations": [], "replay_sequence": 13})
        continued = copy.deepcopy(settled)
        continued["replay_sequence"] = 14
        case = {"before": before, "pending": pending, "callback": callback, "settled": settled, "continued": continued,
                "presentation": presentation, "request": {"kind": "WRITE", "request_id": 1, "slot": "controlled-slot", "generation": 1, "bytes": list(payload)}}
        self.assertEqual(title.write_case_reference(case, 1, identity), (payload, saved))
        for key, value in (("kind", "STORAGE_READ"), ("request", 2), ("slot", "other-slot"), ("generation", 2), ("bytes", [0])):
            bad = copy.deepcopy(case)
            bad["pending"]["pending_platform"][0]["effect"][key] = value
            with self.assertRaisesRegex(RuntimeError, "effect ownership"):
                title.write_case_reference(bad, 1, identity)
        for field in ("callback", "settled", "continued"):
            bad = copy.deepcopy(case)
            bad[field]["replay_sequence"] += 1
            with self.assertRaisesRegex(RuntimeError, "Title"):
                title.write_case_reference(bad, 1, identity)
        bad = copy.deepcopy(case)
        wrong = copy.deepcopy(saved)
        wrong["checksum"] = "sha256-v1:" + "0" * 64
        bad["request"]["bytes"] = list(canonical(wrong))
        with self.assertRaisesRegex(RuntimeError, "checksum differs"):
            title.write_case_reference(bad, 1, identity)
        bad = copy.deepcopy(case)
        bad["request"]["bytes"] += [32]
        with self.assertRaisesRegex(RuntimeError, "noncanonical JSON"):
            title.write_case_reference(bad, 1, identity)
        bad = copy.deepcopy(case)
        bad["before"]["lifecycle"]["value"]["kept"].append(10)
        with self.assertRaisesRegex(RuntimeError, "changed saved gameplay"):
            title.write_case_reference(bad, 1, identity)


    def title_browser_proof_fixture(self):
        import base64
        title, binding, cohort, assets = self.title_retirement_assets_fixture()
        oracle = {"cancelled_requests": [*range(1, 22), 23, 25], "queued_not_started_request_id": 2,
                  "highest_retired_id": 25, "rewrite_request_id": 28, "rewrite_generation": 2,
                  "rewrite_payload_bytes": 1234, "presentation_id": 75,
                  **{key: "a" * 64 for key in ("cancelled_snapshot_digest", "producer_receipt", "producer_payload_sha256",
                      "load_snapshot_sha256", "rewrite_receipt", "rewrite_payload_sha256", "rewrite_callback_sha256", "rewrite_continued_sha256")}}
        measured = {key: value for key, value in oracle.items() if key != "cancelled_requests"}
        measured.update({"cancelled": 23, "list_cancels": 21, "read_cancels": 2, "queued_not_started_cancels": 1,
            "list_emissions": 24, "native_transaction_cancels": 21, "native_gets": 210,
            "native_get_limit_per_transaction": 20000, "native_deadline_ms": 8000,
            "all_native_completions_after_cancel": True, "callback_queued_before_retirement": True,
            "lists": 23, "reads": 3, "writes": 2, "reader_callbacks": 5, "presentation_settlements": 1,
            "stale_callbacks_conserve_snapshot": True, "stale_rendered_cancel_not_sent": True,
            "disposed": True, "queue_empty": True,
            "correlated_sequences": [[request, 10 + index * 12, 11 + index * 12] for index, request in enumerate(oracle["cancelled_requests"])]})
        manifest = assets["manifest"]
        item = {"schema_version": 1, "capability": title.CAPABILITY, "fixture_kind": title.FIXTURE_KIND,
                "source_sha": CANDIDATE, "manifest_sha256": assets["manifest_sha256"], "fixture_sha256": manifest["fixture"]["sha256"],
                "worker_sha256": manifest["assets"][manifest["worker"]]["sha256"], "observed_worker_count": 2,
                "cohort": manifest["cohort"], "evidence": measured}
        tests = {"expected": 1, "passed": 1, "failed": 0, "skipped": 0, "selected_test_ids": list(title.TEST_IDS), "retirement": item}
        attachment = {"name": title.ATTACHMENT, "contentType": "application/json", "body": base64.b64encode(title.js_bytes(item)).decode()}
        report = {"errors": [], "suites": [{"suites": [{"specs": [{"title": title.TEST_IDS[0], "file": title.PRODUCT_PATHS[5],
            "ok": True, "tests": [{"projectName": "chromium", "expectedStatus": "passed", "status": "expected",
            "results": [{"status": "passed", "retry": 0, "errors": [], "attachments": [attachment]}]}]}]}]}]}
        return title, binding, cohort, assets, oracle, tests, report

    def test_title_browser_proof_accepts_exact_inline_and_contained_file_evidence(self):
        title, binding, cohort, assets, oracle, tests, report = self.title_browser_proof_fixture()
        title.validate_tests(tests, assets, oracle, binding, cohort, "1.97.1")
        self.assertEqual(title.test_evidence(report, assets, oracle, binding, cohort, "1.97.1", self.root), tests)
        attachment = report["suites"][0]["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"][0]
        target = self.root / "test-results/rust-browser/title.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(title.js_bytes(tests["retirement"]))
        del attachment["body"]
        attachment["path"] = "test-results/rust-browser/title.json"
        self.assertEqual(title.test_evidence(report, assets, oracle, binding, cohort, "1.97.1", self.root), tests)
        attachment["path"] = str(self.root / "outside.json")
        (self.root / "outside.json").write_bytes(title.js_bytes(tests["retirement"]))
        with self.assertRaisesRegex(RuntimeError, "bounded regular"):
            title.test_evidence(report, assets, oracle, binding, cohort, "1.97.1", self.root)

    def test_title_browser_proof_rejects_every_missing_or_changed_causal_fact(self):
        title, binding, cohort, assets, oracle, tests, _ = self.title_browser_proof_fixture()
        for key, value in tests["retirement"]["evidence"].items():
            if key in ("native_gets", "correlated_sequences"):
                continue
            with self.subTest(key=key):
                bad = copy.deepcopy(tests)
                bad["retirement"]["evidence"][key] = (not value) if isinstance(value, bool) else value + 1 if isinstance(value, int) else "b" * 64
                with self.assertRaisesRegex(RuntimeError, "measured facts"):
                    title.validate_tests(bad, assets, oracle, binding, cohort, "1.97.1")
                del bad["retirement"]["evidence"][key]
                with self.assertRaisesRegex(RuntimeError, "measured facts"):
                    title.validate_tests(bad, assets, oracle, binding, cohort, "1.97.1")
        for key in ("queue_empty", "disposed", "all_native_completions_after_cancel"):
            bad = copy.deepcopy(tests)
            bad["retirement"]["evidence"][key] = 1
            with self.assertRaisesRegex(RuntimeError, "measured facts"):
                title.validate_tests(bad, assets, oracle, binding, cohort, "1.97.1")
        for gets in (True, 20, 420001):
            bad = copy.deepcopy(tests)
            bad["retirement"]["evidence"]["native_gets"] = gets
            with self.assertRaisesRegex(RuntimeError, "measured facts"):
                title.validate_tests(bad, assets, oracle, binding, cohort, "1.97.1")

    def test_title_browser_proof_rejects_reordered_reused_and_uncorrelated_cancel_sequences(self):
        title, binding, cohort, assets, oracle, tests, _ = self.title_browser_proof_fixture()
        sequence = tests["retirement"]["evidence"]["correlated_sequences"]
        for replacement in (sequence[:-1], list(reversed(sequence)), [sequence[0]] * 23,
                            [[True, *sequence[0][1:]], *sequence[1:]],
                            [[sequence[0][0], sequence[0][1], sequence[0][2] + 1], *sequence[1:]]):
            bad = copy.deepcopy(tests)
            bad["retirement"]["evidence"]["correlated_sequences"] = replacement
            with self.assertRaisesRegex(RuntimeError, "sequence inventory|correlation"):
                title.validate_tests(bad, assets, oracle, binding, cohort, "1.97.1")
        for key, value in (("cancelled_requests", list(range(1, 24))), ("highest_retired_id", 24),
                           ("rewrite_request_id", 27), ("rewrite_generation", True), ("producer_receipt", "invalid")):
            with self.assertRaisesRegex(RuntimeError, "reduced fixture oracle"):
                title.validate_tests(tests, assets, {**oracle, key: value}, binding, cohort, "1.97.1")

    def test_title_browser_report_rejects_wrong_source_retry_project_and_attempt_inventory(self):
        title, binding, cohort, assets, oracle, _, report = self.title_browser_proof_fixture()
        for target, key, value in (("spec", "title", "adapter-only"), ("spec", "file", "wrong.spec.ts"), ("spec", "ok", False),
                ("test", "projectName", "firefox"), ("test", "expectedStatus", "failed"), ("test", "status", "flaky"),
                ("run", "retry", 1), ("run", "retry", False), ("run", "status", "skipped"), ("run", "errors", ["failure"])):
            with self.subTest(target=target, key=key):
                bad = copy.deepcopy(report)
                spec = bad["suites"][0]["suites"][0]["specs"][0]
                item = spec if target == "spec" else spec["tests"][0] if target == "test" else spec["tests"][0]["results"][0]
                item[key] = value
                with self.assertRaisesRegex(RuntimeError, "Title retirement Chromium"):
                    title.test_evidence(bad, assets, oracle, binding, cohort, "1.97.1", self.root)
        for target in ("specs", "tests", "results"):
            bad = copy.deepcopy(report)
            suite = bad["suites"][0]["suites"][0]
            owner = suite if target == "specs" else suite["specs"][0] if target == "tests" else suite["specs"][0]["tests"][0]
            owner[target] *= 2
            with self.assertRaisesRegex(RuntimeError, "Title retirement Chromium"):
                title.test_evidence(bad, assets, oracle, binding, cohort, "1.97.1", self.root)

    def test_title_browser_attachment_rejects_duplicate_fields_sources_and_oversized_encodings(self):
        import base64
        title, binding, cohort, assets, oracle, tests, report = self.title_browser_proof_fixture()
        for key, value in (("observed_worker_count", 1), ("schema_version", True), ("source_sha", BASE),
                           ("fixture_kind", "CONTROLLED_ONLY"), ("worker_sha256", "f" * 64)):
            bad = copy.deepcopy(tests)
            bad["retirement"][key] = value
            with self.assertRaisesRegex(RuntimeError, "attachment source/topology"):
                title.validate_tests(bad, assets, oracle, binding, cohort, "1.97.1")
        for mutation in ("duplicate", "body_and_file", "neither", "name", "mime", "oversize", "bad_base64", "duplicate_json"):
            with self.subTest(mutation=mutation):
                bad = copy.deepcopy(report)
                attachments = bad["suites"][0]["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"]
                item = attachments[0]
                if mutation == "duplicate": attachments.append(copy.deepcopy(item))
                if mutation == "body_and_file": item["path"] = "test-results/rust-browser/title.json"
                if mutation == "neither": del item["body"]
                if mutation == "name": item["name"] += "-renamed"
                if mutation == "mime": item["contentType"] = "text/plain"
                if mutation == "oversize": item["body"] = "A" * 5468
                if mutation == "bad_base64": item["body"] = "!invalid!"
                if mutation == "duplicate_json": item["body"] = base64.b64encode(b'{"schema_version":1,"schema_version":1}').decode()
                with self.assertRaisesRegex(RuntimeError, "Title retirement"):
                    title.test_evidence(bad, assets, oracle, binding, cohort, "1.97.1", self.root)

    def test_title_node_parser_requires_eleven_exact_passes_and_preserves_legacy_five(self):
        import m9e_title_storage as title
        report = {"success": True, "numTotalTests": 11, "numPassedTests": 11, "numFailedTests": 0, "numPendingTests": 0,
                  "testResults": [{"name": title.PRODUCT_PATHS[2], "assertionResults": [
                      {"fullName": name, "status": "passed", "failureMessages": []} for name in title.NODE_IDS]}]}
        evidence = title.node_evidence(report)
        self.phases.validate_storage_node(evidence, title_retirement=True)
        with self.assertRaisesRegex(RuntimeError, "current storage Node"):
            self.phases.validate_storage_node(evidence)
        old = {"expected": 5, "passed": 5, "failed": 0, "skipped": 0, "selected_test_ids": title.NODE_IDS[:5]}
        self.phases.validate_storage_node(old)
        with self.assertRaisesRegex(RuntimeError, "eleven owner tests"):
            self.phases.validate_storage_node(old, title_retirement=True)
        for field, value in (("numTotalTests", 5), ("numPassedTests", True), ("numPendingTests", 1), ("success", False)):
            with self.assertRaisesRegex(RuntimeError, "Node source identities"):
                title.node_evidence({**report, field: value})
        for mutation in ("duplicate", "skip", "name", "file"):
            bad = copy.deepcopy(report)
            rows = bad["testResults"][0]["assertionResults"]
            if mutation == "duplicate": rows[-1] = copy.deepcopy(rows[0])
            if mutation == "skip": rows[-1]["status"] = "pending"
            if mutation == "name": rows[-1]["fullName"] += " renamed"
            if mutation == "file": bad["testResults"][0]["name"] = "wrong.test.ts"
            with self.assertRaisesRegex(RuntimeError, "Node source identities"):
                title.node_evidence(bad)

    def title_platform_proof_fixture(self):
        title, binding, cohort, assets, oracle, tests, _ = self.title_browser_proof_fixture()
        flags = ("requires_title_retirement", "requires_title_storage", "requires_read_rebind", "requires_current_proposal",
                 "requires_browser", "requires_browser_worker", "requires_browser_rtc", "requires_current_storage",
                 "requires_worker_storage", "requires_wasm", "requires_cli_executable")
        plan = {flag: True for flag in flags}
        plan["title_storage_binding"] = binding
        for key in ("browser_worker_binding", "browser_rtc_binding", "current_storage_binding", "worker_storage_binding"):
            plan[key] = copy.deepcopy(binding)
        native = {"plan": plan, "identity": {"product_sha": CANDIDATE, "files": {"title_storage": "f" * 64},
                                            "toolchain": "rustc 1.97.1 (fixture)"}}
        proof = {"title_storage_assets": assets, "title_storage_oracle": oracle, "title_storage_tests": tests,
                 "browser_assets": {"assets": cohort}, "current_storage_node": {"expected": 11, "passed": 11,
                     "failed": 0, "skipped": 0, "selected_test_ids": list(title.NODE_IDS)}}
        for index, key in enumerate(("browser_worker_assets", "browser_rtc_assets", "worker_storage_assets")):
            proof[key] = {"manifest": {"assets": {f"prior-bundle-{index}.js": {}}}}
        return title, native, proof

    def test_title_platform_validator_binds_prerequisites_sources_toolchain_and_owner_inventory(self):
        title, native, proof = self.title_platform_proof_fixture()
        title.validate_platform(proof, native)
        for flag, value in native["plan"].items():
            if value is not True:
                continue
            bad = copy.deepcopy(native)
            bad["plan"][flag] = False
            with self.assertRaisesRegex(RuntimeError, "Title retirement"):
                title.validate_platform(proof, bad)
        for key in ("browser_worker_binding", "browser_rtc_binding", "current_storage_binding", "worker_storage_binding"):
            bad = copy.deepcopy(native)
            bad["plan"][key]["source_hashes"][title.SOURCE_PATHS[0]] = "b" * 64
            with self.assertRaisesRegex(RuntimeError, "dependency source binding"):
                title.validate_platform(proof, bad)
        bad = copy.deepcopy(native)
        del bad["identity"]["files"]["title_storage"]
        with self.assertRaisesRegex(RuntimeError, "proof validator"):
            title.validate_platform(proof, bad)
        bad = copy.deepcopy(native)
        bad["identity"]["toolchain"] = "rustc 1.96.0 (other)"
        with self.assertRaisesRegex(RuntimeError, "manifest source/cohort/hash"):
            title.validate_platform(proof, bad)
        bad = copy.deepcopy(proof)
        bad["current_storage_node"]["selected_test_ids"] = title.NODE_IDS[:5]
        with self.assertRaisesRegex(RuntimeError, "eleven owner tests"):
            title.validate_platform(bad, native)
        bad = copy.deepcopy(proof)
        bad["browser_rtc_assets"]["manifest"]["assets"]["current-title-storage-entry.js"] = {}
        with self.assertRaisesRegex(RuntimeError, "namespace overlaps"):
            title.validate_platform(bad, native)

    def test_title_compaction_keeps_full_evidence_address_without_trimming_prior_proof(self):
        title, _, proof = self.title_platform_proof_fixture()
        small = copy.deepcopy(proof)
        title.compact(small, "e" * 64, self.phases.encoded)
        self.assertEqual(small, proof)
        large = {**copy.deepcopy(proof), "prior": "x" * 16000}
        title.compact(large, "e" * 64, self.phases.encoded)
        for key in title.PROOF_KEYS:
            self.assertEqual(large[key], {"file": "phase-summary.json", "sha256": "e" * 64})
        self.assertEqual(large["prior"], "x" * 16000)
        self.assertGreater(len(self.phases.encoded(large)), 16000)
        self.assertIsInstance(proof["title_storage_tests"]["retirement"]["evidence"], dict)

    @patch("subprocess.run", side_effect=AssertionError("source metadata build checks cannot run a subprocess"))
    def test_title_build_evidence_uses_actual_asset_binding_and_fixture_oracle(self, subprocess_run):
        title, binding, cohort, assets = self.title_retirement_assets_fixture()
        for name in [*title.SOURCE_PATHS, "pnpm-lock.yaml"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Title integration source: " + name)
        binding = title.source_binding(self.root, CANDIDATE)
        manifest = assets["manifest"]
        manifest.update(binding)
        self.output.joinpath("current-title-storage-entry.js").write_bytes(b"entry")
        self.output.joinpath(manifest["worker"]).write_bytes(b"worker")
        self.output.joinpath(manifest["fixture"]["path"]).write_bytes(b"{}")
        self.output.joinpath("m9e-v7-title-storage-assets.json").write_bytes(title.js_bytes(manifest) + b"\n")
        vite = self.root / "node_modules/vite/package.json"
        vite.parent.mkdir(parents=True, exist_ok=True)
        vite.write_text('{"version":"8.0.10"}')
        _, _, _, _, oracle, _, _ = self.title_browser_proof_fixture()
        summary = {"product_sha": CANDIDATE, "plan": {"title_storage_binding": binding}, "browser_assets": {"assets": cohort}}
        with patch.object(title, "fixture_oracle", return_value=oracle) as fixture_check:
            title.build_evidence(self.output, summary, self.root, self.full, "1.97.1")
            fixture_check.assert_called_once_with({}, "e" * 64)
        self.assertEqual(summary["title_storage_oracle"], oracle)
        self.assertEqual(summary["title_storage_assets"]["manifest"], manifest)
        self.assertTrue((self.full / "m9e-v7-title-storage-assets.json").is_file())
        self.output.joinpath(manifest["fixture"]["path"]).write_bytes(b"[]")
        with patch.object(title, "fixture_oracle", side_effect=AssertionError("must fail before semantic interpretation")):
            with self.assertRaisesRegex(RuntimeError, "fixture bytes differ"):
                title.build_evidence(self.output, summary, self.root, self.full, "1.97.1")
        subprocess_run.assert_not_called()

    def test_title_browser_checks_revalidate_cohort_after_exact_remote_command(self):
        title, binding, cohort, assets, oracle, tests, report = self.title_browser_proof_fixture()
        summary = {"product_sha": CANDIDATE, "plan": {"title_storage_binding": binding}, "browser_assets": {"assets": cohort},
                   "title_storage_assets": assets, "title_storage_oracle": oracle}
        env = {"M9E_V7_WEB_DIR": str(self.output), "preserved": "runner-owned"}
        commands = []
        def remote(command, label, root, run_env):
            commands.append((command, label, root, run_env))
            self.assertEqual(command, ["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
                                      "--project=chromium", title.PRODUCT_PATHS[5], "--workers=1", "--reporter=line,json"])
            self.assertEqual(label, "title-storage-journey")
            self.assertEqual(root, self.root)
            self.assertEqual(run_env["preserved"], "runner-owned")
            self.assertEqual(run_env["M9E_V7_WEB_DIR"], str(self.output))
            self.assertEqual(run_env["PLAYWRIGHT_JSON_OUTPUT_FILE"], str(self.full / "title-storage-results.json"))
            Path(run_env["PLAYWRIGHT_JSON_OUTPUT_FILE"]).write_text(json.dumps(report))
        with patch.object(title, "source_binding", return_value=binding) as source, patch.object(title, "build_evidence") as rebuilt:
            title.checks(self.root, self.full, remote, summary, env, "1.97.1")
            self.assertEqual(source.call_count, 2)
            rebuilt.assert_called_once()
            self.assertEqual(rebuilt.call_args.args[0], self.output)
            self.assertEqual(rebuilt.call_args.args[-1], "1.97.1")
        self.assertEqual(summary["title_storage_tests"], tests)
        self.assertEqual(len(commands), 1)
        self.assertNotIn("PLAYWRIGHT_JSON_OUTPUT_FILE", env)
        def drift(output, repeated, root, full, toolchain):
            repeated["title_storage_assets"] = {**repeated["title_storage_assets"], "manifest_sha256": "0" * 64}
        with patch.object(title, "source_binding", return_value=binding), patch.object(title, "build_evidence", side_effect=drift):
            with self.assertRaisesRegex(RuntimeError, "changed emitted cohort/fixture"):
                title.checks(self.root, self.full, remote, summary, env, "1.97.1")
        with patch.object(title, "source_binding", side_effect=[binding, {**binding, "pnpm_lock_sha256": "0" * 64}]), patch.object(title, "build_evidence") as rebuilt:
            with self.assertRaisesRegex(RuntimeError, "changed source/lock"):
                title.checks(self.root, self.full, remote, summary, env, "1.97.1")
            rebuilt.assert_not_called()

class CurrentCostRecordTests(unittest.TestCase):
    # Exact bounded record produced by release6e2bb145/run34043250096. This is
    # parser evidence only; mutations never substitute for the real Rust probe.
    PRODUCED = r'''{"architecture":"x86_64","bundle_bytes":15810979,"checkpoints":[{"checkpoint":"title","event":{"input":{"data":{"browser_repeat":false,"code":{"kind":"SPACE"},"focus":"GAME","printable":false},"kind":"KEY_DOWN"},"kind":"RAW_INPUT"},"event_effects":1,"menu_options":1,"observation_json_bytes":1567,"phases":[{"median_ns":1593,"min_ns":1543,"phase":"fork"},{"median_ns":2424,"min_ns":2394,"phase":"snapshot"},{"median_ns":2555,"min_ns":2444,"phase":"validate"},{"median_ns":461,"min_ns":430,"phase":"observe"},{"median_ns":629464,"min_ns":613204,"phase":"canonical_encode_snapshot"},{"median_ns":640375,"min_ns":629364,"phase":"canonical_digest_snapshot"},{"median_ns":17563,"min_ns":17512,"phase":"blake3_preencoded_snapshot"},{"median_ns":37420,"min_ns":37129,"phase":"apply_effectful_raw_input"},{"median_ns":2136496,"min_ns":2124153,"phase":"recorder_append"}],"recorder_capsule_bytes":77605,"recorder_maximum_bytes":16777216,"recorder_maximum_events":4096,"snapshot_canonical_bytes":68327,"snapshot_digest":"9e7b9834bb4b1ea0e9d078b1d3e2ddb1352aba2de831aae9b7da7adf83b61996"},{"checkpoint":"mode","event":{"input":{"data":{"browser_repeat":false,"code":{"kind":"SPACE"},"focus":"GAME","printable":false},"kind":"KEY_DOWN"},"kind":"RAW_INPUT"},"event_effects":1,"menu_options":9,"observation_json_bytes":4379,"phases":[{"median_ns":4178,"min_ns":4117,"phase":"fork"},{"median_ns":9518,"min_ns":9447,"phase":"snapshot"},{"median_ns":10129,"min_ns":10108,"phase":"validate"},{"median_ns":1793,"min_ns":1763,"phase":"observe"},{"median_ns":648540,"min_ns":647548,"phase":"canonical_encode_snapshot"},{"median_ns":681191,"min_ns":680079,"phase":"canonical_digest_snapshot"},{"median_ns":18644,"min_ns":18595,"phase":"blake3_preencoded_snapshot"},{"median_ns":4101171,"min_ns":4038494,"phase":"apply_effectful_raw_input"},{"median_ns":10380876,"min_ns":10321375,"phase":"recorder_append"}],"recorder_capsule_bytes":738869,"recorder_maximum_bytes":16777216,"recorder_maximum_events":4096,"snapshot_canonical_bytes":71145,"snapshot_digest":"c9e4373e6ff335ae0485ee2a6d9f823f6e24219a38f1770ba04fd7974eee9bb0"},{"checkpoint":"starter","event":{"input":{"data":{"browser_repeat":false,"code":{"kind":"SPACE"},"focus":"GAME","printable":false},"kind":"KEY_DOWN"},"kind":"RAW_INPUT"},"event_effects":1,"menu_options":707,"observation_json_bytes":333602,"phases":[{"median_ns":98714,"min_ns":98363,"phase":"fork"},{"median_ns":981792,"min_ns":938079,"phase":"snapshot"},{"median_ns":1054968,"min_ns":1053105,"phase":"validate"},{"median_ns":96961,"min_ns":96170,"phase":"observe"},{"median_ns":3761558,"min_ns":3741881,"phase":"canonical_encode_snapshot"},{"median_ns":3877534,"min_ns":3814936,"phase":"canonical_digest_snapshot"},{"median_ns":95258,"min_ns":95158,"phase":"blake3_preencoded_snapshot"},{"median_ns":4272500,"min_ns":4255138,"phase":"apply_effectful_raw_input"},{"median_ns":16411907,"min_ns":16250916,"phase":"recorder_append"}],"recorder_capsule_bytes":1067916,"recorder_maximum_bytes":16777216,"recorder_maximum_events":4096,"snapshot_canonical_bytes":400368,"snapshot_digest":"9dd00a7668a85f1311a873259c2b919e3bb9936dd93a2029d9a8eb196b2a0f56"},{"checkpoint":"active","event":{"input":{"data":{"browser_repeat":false,"code":{"kind":"ARROW_DOWN"},"focus":"GAME","printable":false},"kind":"KEY_DOWN"},"kind":"RAW_INPUT"},"event_effects":1,"menu_options":2,"observation_json_bytes":2050,"phases":[{"median_ns":3186,"min_ns":3076,"phase":"fork"},{"median_ns":113512,"min_ns":111398,"phase":"snapshot"},{"median_ns":121517,"min_ns":121396,"phase":"validate"},{"median_ns":92323,"min_ns":88545,"phase":"observe"},{"median_ns":90378,"min_ns":89917,"phase":"canonical_encode_snapshot"},{"median_ns":91381,"min_ns":91170,"phase":"canonical_digest_snapshot"},{"median_ns":2525,"min_ns":2525,"phase":"blake3_preencoded_snapshot"},{"median_ns":273330,"min_ns":268771,"phase":"apply_effectful_raw_input"},{"median_ns":1547377,"min_ns":1532760,"phase":"recorder_append"}],"recorder_capsule_bytes":12969,"recorder_maximum_bytes":16777216,"recorder_maximum_events":4096,"snapshot_canonical_bytes":8416,"snapshot_digest":"884799cb819b8a0a502a484715b136e214003b7d59aec6cd7a978770be3199ef"}],"content_identity":{"ai_hash":"3229a33fcf2f88c4272efb9e21f376f579357d79a9d77451892394dd3ebfbaf9","battle_hash":"blake3-v3:b53078e1088c3c3f645fa1d209fb6bb72ef17bd9411d6bddc2c08c447d794201","bootstrap_hash":"e61066de38fac8e31586ccab8e25d3dd39d36244cb02f655840a6133473db47a","bundle_hash":"blake3-v1:9de581e0d922874eaf17b8a9c355e4d154b051b34935fad60d5779c70de68429","oracle_sha":"399d5d368f0b5642ebf8f45bd8a5e73350fa4de7","presentation_hash":"6b06dd16f77709e8bb5863f58a2b460b686069fa353981bbc62ed54f2c54ecc0","progression_hash":"751643168aa2c2405d700c13b6438b10dec901d969de2c6b1048663b421b2695","run_hash":"879bcaacfe07349ed23edb2298fb55c19c55ae9422b57167655677f68bf22428","scenario_hash":"e45bfe0c126dd4b1c3f69ce153def8aa99efe0f1e835ddcbcafa98b689a68fb8","semantic_catalog_hash":"a878c7487924a10f8508787ec560829efd72c5c5f101f022ad93c5358ec1ced0","world_hash":"c87d890c9f1658e0526b49d35ae003165ade1f5a0156227a6722b77841786a64"},"content_phases":[{"median_ns":52567776,"min_ns":50231488,"phase":"content_decode"},{"median_ns":206343510,"min_ns":205525914,"phase":"content_prepare_and_arc"}],"debug_assertions":false,"limitations":"Wall time includes optimizer barriers, scheduling, internal validation/allocation and internal destruction. Setup, verification and final input/output teardown excluded. Warm-process fixed-order samples; no allocator or live-memory claims. API costs overlap and are not additive components. Digest includes canonical encoding; preencoded BLAKE3 isolates hashing. Recorder append excludes event apply and recorder construction; measures one accepted event on an empty tail, not rotation or accumulated history. Not transport or whole-run latency.","os":"linux","probe":"current_native_phase_costs_preserve_semantics","samples_per_phase":3,"schema_version":1,"warmups_per_phase":1}'''

    def setUp(self):
        import m9e_current_cost as cost
        self.cost = cost
        self.value = json.loads(self.PRODUCED)
        self.binding = {"architecture": "x86_64", "operating_system": "linux",
                        "bundle_bytes": 15_810_979, "content_identity": copy.deepcopy(self.value["content_identity"])}

    def raw(self, value=None):
        value = self.value if value is None else value
        return self.cost.PREFIX + json.dumps(value, sort_keys=True, separators=(",", ":")).encode() + b"\n"

    def rejected(self, value):
        with self.assertRaises(RuntimeError):
            self.cost.parse_line(self.raw(value), **self.binding)

    def test_actual_release_cost_record_reconstructs_bound_bytes_and_hash(self):
        raw = self.raw()
        self.assertEqual(len(raw), 6009)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), "5c8eb3c10b702ec14d68a2428279834041e10d8d957d4035033f3accbc0749d8")
        parsed = self.cost.parse_line(raw, **self.binding)
        self.assertEqual(parsed, self.value)
        self.assertEqual(parsed["checkpoints"][2]["menu_options"], 707)
        proof = {"line": raw.decode(), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        self.assertEqual(self.cost.validate_record(proof, **self.binding), self.value)

    def test_cost_record_rejects_incomplete_repeated_and_oversized_framing(self):
        raw = self.raw()
        for malformed in (raw[:-1], raw + raw, b"progress " + raw, raw + b"\n", raw.replace(b"\n", b"\r\n"),
                          raw + b"trailing", b"M9E_CURRENT_COST_PROBE\n", raw.decode(), None,
                          self.cost.PREFIX + b" " * (8192 - len(self.cost.PREFIX) - 1) + b"\n"):
            with self.subTest(kind=type(malformed).__name__), self.assertRaises(RuntimeError):
                self.cost.parse_line(malformed, **self.binding)

    def test_cost_record_rejects_duplicate_json_keys_nonfinite_values_and_trailing_json(self):
        raw = self.raw()
        for malformed in (raw.replace(b'"schema_version":1', b'"schema_version":1,"schema_version":1'),
                          raw.replace(b'"min_ns":1543', b'"min_ns":1543,"min_ns":1543'),
                          raw.replace(b'"schema_version":1', b'"schema_version":NaN'),
                          raw.replace(b'"schema_version":1', b'"schema_version":Infinity'),
                          raw.replace(b'"schema_version":1', b'"schema_version":-Infinity'),
                          raw[:-1] + b" {}\n", self.cost.PREFIX + b"\xff\n",
                          self.cost.PREFIX + b"[]\n", self.cost.PREFIX + b"{" + b"\n"):
            self.assertNotEqual(malformed, raw)
            with self.assertRaises(RuntimeError):
                self.cost.parse_line(malformed, **self.binding)

    def test_cost_record_rejects_missing_unknown_and_wrong_typed_object_fields(self):
        paths = [(), ("content_identity",), ("content_phases", 0), ("checkpoints", 0),
                 ("checkpoints", 0, "phases", 0), ("checkpoints", 0, "event"),
                 ("checkpoints", 0, "event", "input"), ("checkpoints", 0, "event", "input", "data"),
                 ("checkpoints", 0, "event", "input", "data", "code")]
        for path in paths:
            original = self.value
            for key in path:
                original = original[key]
            for mode in ("missing", "unknown"):
                bad = copy.deepcopy(self.value)
                row = bad
                for key in path:
                    row = row[key]
                if mode == "missing":
                    row.pop(next(iter(original)))
                else:
                    row["unrecognized"] = False
                with self.subTest(path=path, mode=mode):
                    self.rejected(bad)
        bad = copy.deepcopy(self.value)
        bad["checkpoints"][0]["event"]["input"]["data"] = []
        self.rejected(bad)

    def test_cost_record_rejects_boolean_counters_and_wrong_host_or_profile(self):
        for key in ("schema_version", "warmups_per_phase", "samples_per_phase", "bundle_bytes"):
            for replacement in (True, False, None, "1", 1.0, -1, self.cost.U64_MAX + 1):
                bad = copy.deepcopy(self.value)
                bad[key] = replacement
                with self.subTest(key=key, replacement=replacement):
                    self.rejected(bad)
        for key, replacement in (("probe", "renamed"), ("architecture", "aarch64"), ("os", "windows"),
                                 ("debug_assertions", True), ("debug_assertions", 0), ("limitations", "fast enough")):
            bad = copy.deepcopy(self.value)
            bad[key] = replacement
            self.rejected(bad)

    def test_cost_record_binds_all_actual_content_fields_and_typed_digest_prefixes(self):
        for key in self.cost.IDENTITY_FIELDS:
            for replacement in ("0" * 64, "bad", True):
                bad = copy.deepcopy(self.value)
                bad["content_identity"][key] = replacement
                self.rejected(bad)
            binding = copy.deepcopy(self.binding)
            binding["content_identity"][key] = "0" * (40 if key == "oracle_sha" else 64)
            with self.assertRaises(RuntimeError):
                self.cost.parse_line(self.raw(), **binding)
        for key, replacement in (("bundle_bytes", 1), ("bundle_bytes", True), ("architecture", "mips"),
                                 ("operating_system", "darwin")):
            binding = {**self.binding, key: replacement}
            with self.assertRaises(RuntimeError):
                self.cost.parse_line(self.raw(), **binding)

    def test_cost_record_requires_every_phase_once_in_the_recorded_order(self):
        for path in [("content_phases",), *[("checkpoints", i, "phases") for i in range(4)]]:
            for mode in ("missing", "duplicate", "reorder", "renamed"):
                bad = copy.deepcopy(self.value)
                rows = bad
                for key in path:
                    rows = rows[key]
                if mode == "missing":
                    rows.pop()
                elif mode == "duplicate":
                    rows[-1] = copy.deepcopy(rows[0])
                elif mode == "reorder":
                    rows.reverse()
                else:
                    rows[0]["phase"] = "external_approximation"
                self.rejected(bad)

    def test_cost_record_accepts_zero_resolution_but_rejects_invalid_duration_order_and_types(self):
        bad = copy.deepcopy(self.value)
        for row in [*bad["content_phases"], *[phase for cp in bad["checkpoints"] for phase in cp["phases"]]]:
            row["min_ns"] = row["median_ns"] = 0
        self.assertEqual(self.cost.parse_line(self.raw(bad), **self.binding), bad)
        for minimum, median in ((True, 1), (0, False), (1.0, 2), (2, 1), (-1, 0), (0, self.cost.U64_MAX + 1)):
            bad = copy.deepcopy(self.value)
            bad["checkpoints"][0]["phases"][0].update(min_ns=minimum, median_ns=median)
            self.rejected(bad)

    def test_cost_record_requires_four_actual_checkpoint_identities_and_snapshot_digests(self):
        for mode in ("missing", "duplicate", "reorder", "extra", "digest", "kind"):
            bad = copy.deepcopy(self.value)
            rows = bad["checkpoints"]
            if mode == "missing":
                rows.pop()
            elif mode == "duplicate":
                rows[-1] = copy.deepcopy(rows[0])
            elif mode == "reorder":
                rows.reverse()
            elif mode == "extra":
                rows.append(copy.deepcopy(rows[0]))
            elif mode == "digest":
                rows[0]["snapshot_digest"] = "A" * 64
            else:
                rows[0]["checkpoint"] = "controlled_fixture"
            self.rejected(bad)

    def test_cost_record_rejects_changed_raw_event_or_coerced_boolean_controls(self):
        for index in range(4):
            for key, value in (("printable", True), ("printable", 0), ("browser_repeat", True),
                               ("browser_repeat", 0), ("focus", "TEXT"), ("code", {"kind": "ESCAPE"})):
                bad = copy.deepcopy(self.value)
                bad["checkpoints"][index]["event"]["input"]["data"][key] = value
                self.rejected(bad)
            for path, replacement in ((["kind"], "TIMER"), (["input", "kind"], "KEY_UP")):
                bad = copy.deepcopy(self.value)
                event = bad["checkpoints"][index]["event"]
                for part in path[:-1]:
                    event = event[part]
                event[path[-1]] = replacement
                self.rejected(bad)

    def test_cost_record_keeps_existing_recorder_caps_and_positive_measured_sizes(self):
        for key in ("snapshot_canonical_bytes", "observation_json_bytes", "menu_options", "event_effects",
                    "recorder_capsule_bytes", "recorder_maximum_bytes", "recorder_maximum_events"):
            for value in (True, 0, -1, 1.0, self.cost.U64_MAX + 1):
                bad = copy.deepcopy(self.value)
                bad["checkpoints"][0][key] = value
                self.rejected(bad)
        for key, value in (("recorder_capsule_bytes", 16_777_217), ("recorder_maximum_bytes", 33_554_432),
                           ("recorder_maximum_events", 8192)):
            bad = copy.deepcopy(self.value)
            bad["checkpoints"][0][key] = value
            self.rejected(bad)

    def test_cost_wire_record_rejects_tampering_missing_fields_and_invalid_unicode(self):
        raw = self.raw()
        proof = {"line": raw.decode(), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        for key in proof:
            bad = dict(proof)
            bad.pop(key)
            with self.assertRaises(RuntimeError):
                self.cost.validate_record(bad, **self.binding)
        for key, value in (("line", proof["line"] + " "), ("line", "\ud800"), ("line", raw),
                           ("bytes", True), ("bytes", len(raw) - 1), ("sha256", "0" * 64), ("extra", "ignored")):
            with self.assertRaises(RuntimeError):
                self.cost.validate_record({**proof, key: value}, **self.binding)

class CurrentCostArtifactTests(unittest.TestCase):
    def setUp(self):
        import m9e_current_cost as cost
        self.cost = cost
        temporary = tempfile.TemporaryDirectory(prefix="m9e-release-artifact-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.repository = self.root / "candidate"
        self.manifest = self.repository / "rust/crates/er-repro/Cargo.toml"
        self.manifest.parent.mkdir(parents=True)
        self.manifest.write_text('[package]\nname="er-repro"\nversion.workspace=true\n')
        (self.repository / "rust/Cargo.toml").write_text('[workspace.package]\nversion="0.1.0"\n')
        self.source = self.repository / cost.SOURCE
        self.source.parent.mkdir(parents=True)
        self.source.write_text("// exact test source\n")
        self.directory = self.root / "owned-release"
        self.binary = self.directory / "release/deps/m9e_current_cost_probe-0123456789abcdef"
        self.binary.parent.mkdir(parents=True)
        self.binary.write_bytes(b"candidate executable fixture, never executed")
        self.binary.chmod(0o700)
        self.artifact = {"reason": "compiler-artifact", "manifest_path": str(self.manifest), "features": [],
                         "package_id": "path+" + self.manifest.parent.as_uri() + "#0.1.0",
                         "target": {"name": cost.TARGET[1], "kind": ["test"], "crate_types": ["bin"], "src_path": str(self.source)},
                         "profile": {"opt_level": "3", "debug_assertions": False, "debuginfo": 0,
                                     "overflow_checks": False, "test": True}, "executable": str(self.binary)}
        self.finished = {"reason": "build-finished", "success": True}
        self.records = [self.artifact, self.finished]

    def discover(self, records=None, directory=None):
        return self.cost.discover_release(self.records if records is None else records,
                                         repository=self.repository,
                                         target_directory=self.directory if directory is None else directory)

    def test_cost_release_discovery_binds_exact_source_profile_and_executable_bytes(self):
        executable, binding = self.discover()
        self.assertEqual(executable, self.binary)
        self.assertEqual(binding["sha256"], hashlib.sha256(self.binary.read_bytes()).hexdigest())
        self.assertEqual(binding["bytes"], self.binary.stat().st_size)
        self.assertEqual(binding["manifest_sha256"], hashlib.sha256(self.manifest.read_bytes()).hexdigest())
        self.assertEqual(binding["source_sha256"], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual(binding["relative_path"], "release/deps/" + self.binary.name)
        self.cost.check_executable(executable, binding)
        self.artifact["profile"]["opt_level"] = "0"
        self.assertEqual(binding["cargo_profile"]["opt_level"], "3")

    def test_cost_release_discovery_rejects_missing_ambiguous_or_unfinished_builds(self):
        for records in ([], [self.artifact], [self.finished], [self.artifact, self.artifact, self.finished],
                        [self.artifact, self.finished, self.finished], [self.artifact, {**self.finished, "success": False}],
                        [self.artifact, {**self.finished, "success": 1}], [None], self.artifact):
            with self.assertRaises(RuntimeError):
                self.discover(records)

    def test_cost_release_discovery_rejects_wrong_package_target_source_features_and_profile(self):
        mutations = [(["manifest_path"], str(self.source)), (["package_id"], "registry+unrelated#er-repro@0.1.0"),
                     (["features"], ["alternate"]), (["target", "kind"], ["bench"]),
                     (["target", "name"], "neighbor"), (["target", "crate_types"], ["lib"]),
                     (["target", "src_path"], str(self.manifest)), (["profile", "opt_level"], "0"),
                     (["profile", "debug_assertions"], True), (["profile", "debug_assertions"], 0),
                     (["profile", "overflow_checks"], True), (["profile", "debuginfo"], False),
                     (["profile", "test"], False), (["profile", "test"], 1), (["profile", "unknown"], False)]
        for path, value in mutations:
            bad = copy.deepcopy(self.records)
            row = bad[0]
            for key in path[:-1]:
                row = row[key]
            row[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                self.discover(bad)

    def test_cost_release_discovery_confines_executable_to_owned_native_release_tree(self):
        escaped = self.root / self.binary.name
        escaped.write_bytes(self.binary.read_bytes())
        escaped.chmod(0o700)
        linked = self.binary.parent / "m9e_current_cost_probe-fedcba9876543210"
        linked.symlink_to(escaped)
        wrong_name = self.binary.parent / "not-the-cost-target"
        wrong_name.write_bytes(self.binary.read_bytes())
        wrong_name.chmod(0o700)
        for path in (str(escaped), str(linked), str(wrong_name), "relative/release/deps/test", None,
                     str(self.directory / "debug/deps" / self.binary.name)):
            with self.assertRaises(RuntimeError):
                self.discover([{**self.artifact, "executable": path}, self.finished])
        alias = self.root / "alias"
        alias.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            self.discover(directory=alias)
        self.binary.chmod(0o600)
        with self.assertRaises(RuntimeError):
            self.discover()

    def test_cost_release_executable_conservation_rejects_bytes_permissions_and_symlink_changes(self):
        executable, binding = self.discover()
        original = self.binary.read_bytes()
        self.binary.write_bytes(b"X" * len(original))
        with self.assertRaises(RuntimeError):
            self.cost.check_executable(executable, binding)
        self.binary.write_bytes(original)
        self.binary.chmod(0o600)
        with self.assertRaises(RuntimeError):
            self.cost.check_executable(executable, binding)
        self.binary.chmod(0o700)
        self.cost.check_executable(executable, binding)
        self.binary.unlink()
        with self.assertRaises(RuntimeError):
            self.cost.check_executable(executable, binding)

    def test_cost_release_listing_matches_the_actual_sole_global_test_identity(self):
        raw = (self.cost.TEST_ID + ": test\n").encode()
        self.assertEqual(len(raw), 52)
        self.cost.validate_listing(raw, [self.cost.TEST_ID])
        for listing, identities in ((raw, []), (raw, [self.cost.TEST_ID] * 2), (raw, ["renamed"]),
                                    (raw + raw, [self.cost.TEST_ID]), (raw[:-1], [self.cost.TEST_ID]),
                                    (b"", [self.cost.TEST_ID]), (raw.replace(b": test", b": benchmark"), [self.cost.TEST_ID]),
                                    (raw + b"ignored: test\n", [self.cost.TEST_ID]), (b"\xff", [self.cost.TEST_ID]),
                                    (b"x" * 16385, [self.cost.TEST_ID])):
            with self.assertRaises(RuntimeError):
                self.cost.validate_listing(listing, identities)

class CurrentCostContentBindingTests(unittest.TestCase):
    MANIFEST = r'''{"components":{"ai":"3229a33fcf2f88c4272efb9e21f376f579357d79a9d77451892394dd3ebfbaf9","battle":"blake3-v3:b53078e1088c3c3f645fa1d209fb6bb72ef17bd9411d6bddc2c08c447d794201","bootstrap":"e61066de38fac8e31586ccab8e25d3dd39d36244cb02f655840a6133473db47a","meta":"4b6fdf238af42d40441175d2436c03e5dcec40117863a9e5600ba8127009be64","presentation":"6b06dd16f77709e8bb5863f58a2b460b686069fa353981bbc62ed54f2c54ecc0","progression":"751643168aa2c2405d700c13b6438b10dec901d969de2c6b1048663b421b2695","run":"879bcaacfe07349ed23edb2298fb55c19c55ae9422b57167655677f68bf22428","scenario":"e45bfe0c126dd4b1c3f69ce153def8aa99efe0f1e835ddcbcafa98b689a68fb8","world":"c87d890c9f1658e0526b49d35ae003165ade1f5a0156227a6722b77841786a64"},"content_hash":"blake3-v1:9de581e0d922874eaf17b8a9c355e4d154b051b34935fad60d5779c70de68429","counts":{"ai_behaviors":2586,"battle_species":1962,"bootstrap_starters":706,"meta_behaviors":6870,"presentation_mappings":55,"progression_species_forms":3384,"run_programs":3,"scenarios":91,"world_biomes":35},"oracle_sha":"399d5d368f0b5642ebf8f45bd8a5e73350fa4de7","pending_bespoke_behaviors":0,"reachable_unsupported_behaviors":0,"schema_version":2,"unresolved_cross_references":0,"v1_production_fallbacks":0}'''

    def setUp(self):
        import m9e_current_cost as cost
        self.cost = cost
        temporary = tempfile.TemporaryDirectory(prefix="m9e-cost-content-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.manifest = json.loads(self.MANIFEST)
        self.identity = json.loads(CurrentCostRecordTests.PRODUCED)["content_identity"]
        # Minimal source-shape fixture for binding checks, not prepared game content.
        self.bundle = {"schema_version": 2, "oracle_sha": self.identity["oracle_sha"],
                       "content_hash": self.identity["bundle_hash"]}
        for name, digest in self.manifest["components"].items():
            self.bundle["scenarios" if name == "scenario" else name] = {"content_hash": digest}
        self.bundle["battle"]["semantic_catalog_hash"] = self.identity["semantic_catalog_hash"]
        self.bundle_path = self.root / cost.BUNDLE
        self.manifest_path = self.root / cost.CONTENT_MANIFEST
        self.bundle_path.parent.mkdir(parents=True)
        self.write()

    def write(self):
        self.bundle_path.write_text(json.dumps(self.bundle, sort_keys=True))
        self.manifest_path.write_text(json.dumps(self.manifest, sort_keys=True))

    def test_cost_content_binding_projects_actual_v2_component_names_and_original_bytes(self):
        binding = self.cost.read_content(self.root)
        self.assertEqual(binding["identity"], self.identity)
        for name, path in (("bundle", self.bundle_path), ("manifest", self.manifest_path)):
            self.assertEqual(binding[name]["bytes"], path.stat().st_size)
            self.assertEqual(binding[name]["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(self.manifest["counts"]["bootstrap_starters"], 706)
        before = binding["bundle"]["sha256"]
        self.bundle_path.write_bytes(self.bundle_path.read_bytes() + b"\n")
        changed = self.cost.read_content(self.root)
        self.assertEqual(changed["identity"], binding["identity"])
        self.assertNotEqual(changed["bundle"]["sha256"], before)

    def test_cost_content_binding_rejects_each_source_component_and_manifest_identity_drift(self):
        initial_bundle, initial_manifest = copy.deepcopy(self.bundle), copy.deepcopy(self.manifest)
        for name in self.manifest["components"]:
            self.bundle = copy.deepcopy(initial_bundle)
            self.bundle["scenarios" if name == "scenario" else name]["content_hash"] = "0" * 64
            self.write()
            with self.subTest(component=name), self.assertRaises(RuntimeError):
                self.cost.read_content(self.root)
        for key, replacement in (("oracle_sha", "0" * 40), ("content_hash", "blake3-v1:" + "0" * 64),
                                 ("schema_version", True), ("unresolved_cross_references", 1),
                                 ("pending_bespoke_behaviors", False), ("v1_production_fallbacks", 1), ("extra", "ignored")):
            self.bundle, self.manifest = copy.deepcopy(initial_bundle), copy.deepcopy(initial_manifest)
            self.manifest[key] = replacement
            self.write()
            with self.assertRaises(RuntimeError):
                self.cost.read_content(self.root)
        self.bundle, self.manifest = copy.deepcopy(initial_bundle), copy.deepcopy(initial_manifest)
        self.manifest["counts"]["bootstrap_starters"] = True
        self.write()
        with self.assertRaises(RuntimeError):
            self.cost.read_content(self.root)
        self.bundle, self.manifest = copy.deepcopy(initial_bundle), copy.deepcopy(initial_manifest)
        self.bundle["meta"]["content_hash"] = self.manifest["components"]["meta"] = "bad"
        self.write()
        with self.assertRaises(RuntimeError):
            self.cost.read_content(self.root)

    def test_cost_content_reader_rejects_duplicate_invalid_oversized_or_redirected_files(self):
        original = self.manifest_path.read_bytes()
        for raw in (b"", b"\xff", b"[]", b"{}" + b" " * 16383,
                    original.replace(b'"schema_version": 2', b'"schema_version": 2, "schema_version": 2')):
            self.assertNotEqual(raw, original)
            self.manifest_path.write_bytes(raw)
            with self.assertRaises(RuntimeError):
                self.cost.read_content(self.root)
        self.manifest_path.write_bytes(original)
        relocated = self.root / "elsewhere.json"
        relocated.write_bytes(original)
        self.manifest_path.unlink()
        self.manifest_path.symlink_to(relocated)
        with self.assertRaises(RuntimeError):
            self.cost.read_content(self.root)

class CurrentCostBoundedProcessTests(unittest.TestCase):
    # These tiny Python processes run only on the remote Linux harness runner;
    # they prove actual pipe/deadline/process-group behavior, not game execution.
    def setUp(self):
        import m9e_current_cost as cost
        import sys
        self.cost = cost
        self.python = sys.executable
        temporary = tempfile.TemporaryDirectory(prefix="m9e-cost-process-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / "output.log"
        self.children = []
        self.real_popen = subprocess.Popen

    def spawn(self, *args, **kwargs):
        self.assertIs(kwargs.get("start_new_session"), True)
        self.assertNotIn("shell", kwargs)
        child = self.real_popen(*args, **kwargs)
        self.children.append(child)
        return child

    def tearDown(self):
        import signal
        # Failsafe for regressions in the helper itself; no owned test group
        # may survive a failed assertion in this process integration fixture.
        for child in self.children:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait(timeout=1)

    def run_code(self, code, **overrides):
        options = {"cwd": self.root, "environment": dict(os.environ), "output": self.output,
                   "seconds": 3, "byte_limit": 1024, **overrides}
        with patch.object(self.cost.subprocess, "Popen", side_effect=self.spawn):
            return self.cost.run_bounded([self.python, "-c", code], **options)

    def test_cost_runner_streams_combined_output_from_a_real_owned_session(self):
        result = self.run_code("import os; os.write(1, str(os.getsid(0) == os.getpid()).encode()); os.write(2, b' stderr')")
        self.assertEqual(self.output.read_bytes(), b"True stderr")
        self.assertEqual(result["bytes"], 11)
        self.assertEqual(result["sha256"], hashlib.sha256(b"True stderr").hexdigest())
        self.assertEqual(result["path"], self.output)
        self.assertLess(result["elapsed_seconds"], 3)
        self.assertEqual(self.children[0].poll(), 0)
        self.assertTrue(self.children[0].stdout.closed)

    def test_cost_runner_nonzero_completion_cannot_supply_success_evidence(self):
        with self.assertRaisesRegex(RuntimeError, "command exited 7"):
            self.run_code("import os; os.write(1, b'expected failure'); raise SystemExit(7)")
        self.assertEqual(self.output.read_bytes(), b"expected failure")
        self.assertEqual(self.children[0].poll(), 7)
        self.assertTrue(self.children[0].stdout.closed)

    def test_cost_runner_stops_streaming_at_the_exact_output_bound(self):
        with self.assertRaisesRegex(RuntimeError, "output exceeded"):
            self.run_code("import os,time; os.write(1, b'x' * 1048576); time.sleep(10)", byte_limit=128)
        self.assertEqual(self.output.read_bytes(), b"x" * 128)
        self.assertIsNotNone(self.children[0].poll())
        self.assertTrue(self.children[0].stdout.closed)

    def test_cost_runner_deadline_kills_term_ignoring_parent_and_descendant(self):
        import signal
        import time
        code = ("import signal,subprocess,sys,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); "
                "child=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(10)']); "
                "print(child.pid,flush=True); time.sleep(10)")
        original = os.killpg
        signals = []
        def tracked(pid, sig):
            signals.append((pid, sig))
            return original(pid, sig)
        with patch.object(self.cost.os, "killpg", side_effect=tracked), self.assertRaisesRegex(RuntimeError, "wall deadline"):
            self.run_code(code, seconds=2)
        child = self.children[0]
        self.assertEqual(child.poll(), -signal.SIGKILL)
        self.assertIn((child.pid, signal.SIGTERM), signals)
        self.assertIn((child.pid, signal.SIGKILL), signals)
        descendant = int(self.output.read_text().strip())
        status = Path(f"/proc/{descendant}/stat")
        running = True
        for _ in range(20):
            try:
                running = status.read_text().split(") ", 1)[1].split()[0] != "Z"
            except FileNotFoundError:
                running = False
            if not running:
                break
            time.sleep(0.01)
        self.assertFalse(running, "owned descendant survived the group deadline")

    def test_cost_runner_rejects_expired_budget_and_invalid_caps_before_spawn(self):
        import time
        for overrides in ({"seconds": True}, {"seconds": 901}, {"seconds": float("nan")},
                          {"byte_limit": True}, {"byte_limit": 0}, {"byte_limit": (16 << 20) + 1},
                          {"global_deadline": time.monotonic() - 1}, {"global_deadline": float("inf")}):
            with self.assertRaises(RuntimeError):
                self.run_code("pass", **overrides)
            self.assertFalse(self.output.exists())
            self.assertEqual(self.children, [])

    def test_cost_runner_never_overwrites_an_existing_diagnostic(self):
        self.output.write_bytes(b"retain prior diagnostic")
        with self.assertRaises(FileExistsError):
            self.run_code("pass")
        self.assertEqual(self.output.read_bytes(), b"retain prior diagnostic")
        self.assertEqual(self.children, [])

    def test_cost_runner_attempts_kill_and_reap_after_term_cleanup_failure(self):
        import signal
        original = os.killpg
        signals = []
        def failed_term(pid, sig):
            signals.append((pid, sig))
            if sig == signal.SIGTERM:
                raise PermissionError("simulated termination failure")
            return original(pid, sig)
        with patch.object(self.cost.os, "killpg", side_effect=failed_term), self.assertRaisesRegex(RuntimeError, "cleanup failed"):
            self.run_code("pass")
        child = self.children[0]
        self.assertIn((child.pid, signal.SIGKILL), signals)
        self.assertIsNotNone(child.poll())
        self.assertTrue(child.stdout.closed)

class CurrentCostBuildIdentityTests(unittest.TestCase):
    def setUp(self):
        import m9e_current_cost as cost
        self.cost = cost
        temporary = tempfile.TemporaryDirectory(prefix="m9e-cost-build-identity-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.repository = self.root / "candidate"
        self.target = self.root / "owned-release"
        self.inherited = {"HOME": str(self.root / "home"), "CARGO_HOME": str(self.root / "cargo-home"),
                          "PATH": "/synthetic/bin", "DUMMY_SECRET": "unreported-value",
                          "CARGO_TARGET_DIR": str(self.root / "ordinary-cache")}
        for name in cost.BUILD_SOURCE_PATHS:
            path = self.repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("source fixture " + name + "\n")
        dependency = self.repository / "rust/crates/er-extra/Cargo.toml"
        dependency.parent.mkdir(parents=True)
        dependency.write_text('[package]\nname="er-extra"\n')

    def test_cost_build_binding_tracks_exact_sources_and_every_workspace_manifest(self):
        first = self.cost.build_source_binding(self.repository, CANDIDATE)
        self.assertEqual(first["source_sha"], CANDIDATE)
        self.assertEqual(set(first["source_hashes"]), set(self.cost.BUILD_SOURCE_PATHS))
        self.assertEqual(first["cargo_manifests"]["count"], 2)
        dependency = self.repository / "rust/crates/er-extra/Cargo.toml"
        dependency.write_text('[package]\nname="er-extra"\nversion="0.2.0"\n')
        second = self.cost.build_source_binding(self.repository, CANDIDATE)
        self.assertEqual(first["source_hashes"], second["source_hashes"])
        self.assertNotEqual(first["cargo_manifests"]["sha256"], second["cargo_manifests"]["sha256"])
        new = self.repository / "rust/crates/er-another/Cargo.toml"
        new.parent.mkdir()
        new.write_text('[package]\nname="er-another"\n')
        third = self.cost.build_source_binding(self.repository, CANDIDATE)
        self.assertEqual(third["cargo_manifests"]["count"], 3)
        self.assertNotEqual(third["cargo_manifests"]["sha256"], second["cargo_manifests"]["sha256"])

    def test_cost_build_binding_detects_missing_empty_oversized_and_redirected_source(self):
        source = self.repository / self.cost.SOURCE
        original = source.read_bytes()
        for bad in (None, b"", b"x" * ((4 << 20) + 1), "symlink"):
            source.unlink()
            if bad == "symlink":
                other = self.root / "unowned.rs"
                other.write_bytes(original)
                source.symlink_to(other)
            elif bad is not None:
                source.write_bytes(bad)
            with self.assertRaises(RuntimeError):
                self.cost.build_source_binding(self.repository, CANDIDATE)
            if source.exists() or source.is_symlink():
                source.unlink()
            source.write_bytes(original)
        for sha in ("", "z" * 40, CANDIDATE.upper(), True):
            with self.assertRaises(RuntimeError):
                self.cost.build_source_binding(self.repository, sha)

    def test_cost_release_environment_preserves_credentials_without_reporting_and_owns_target(self):
        original = copy.deepcopy(self.inherited)
        environment, facts = self.cost.release_environment(self.repository, self.target, self.inherited)
        self.assertEqual(self.inherited, original)
        self.assertEqual(environment["DUMMY_SECRET"], "unreported-value")
        self.assertNotIn("unreported-value", json.dumps(facts))
        self.assertNotIn("DUMMY_SECRET", json.dumps(facts))
        self.assertEqual(environment["CARGO_TARGET_DIR"], str(self.target))
        self.assertEqual(environment["RUSTUP_TOOLCHAIN"], "1.97.1")
        self.assertEqual(environment["CARGO_INCREMENTAL"], "0")
        self.assertEqual(facts["profile"], "release")
        self.assertEqual(facts["target"], "native-host")
        self.assertFalse(self.target.exists(), "configuration helper must not create or overwrite a target")

    def test_cost_release_environment_rejects_flags_wrappers_cross_target_and_profile_overrides(self):
        keys = ["RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC", "RUSTDOC", "RUSTC_BOOTSTRAP", "RUSTC_WRAPPER",
                "RUSTC_WORKSPACE_WRAPPER", "CARGO_WORKSPACE_WRAPPER", "CARGO_ENCODED_RUSTDOCFLAGS",
                "CARGO_BUILD_TARGET", "CARGO_BUILD_RUSTFLAGS", "CARGO_PROFILE_RELEASE_OPT_LEVEL",
                "CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS", "CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_OPT_LEVEL",
                "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER", "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS"]
        for key in keys:
            for value in ("", "unreviewed"):
                with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                    self.cost.release_environment(self.repository, self.target, {**self.inherited, key: value})
        for key, value in (("CARGO_INCREMENTAL", "1"), ("CARGO_PROFILE_DEV_DEBUG", "2"),
                           ("CARGO_PROFILE_TEST_DEBUG", "1"), ("RUSTUP_TOOLCHAIN", "nightly")):
            with self.assertRaises(RuntimeError):
                self.cost.release_environment(self.repository, self.target, {**self.inherited, key: value})

    def test_cost_release_environment_rejects_candidate_ancestor_and_cargo_home_configuration(self):
        for path in (self.repository / "rust/.cargo/config.toml", self.repository / ".cargo/config",
                     self.root / ".cargo/config.toml", self.root / "cargo-home/config.toml"):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('[build]\nrustflags=["--cfg", "different"]\n')
            with self.assertRaises(RuntimeError):
                self.cost.release_environment(self.repository, self.target, self.inherited)
            path.unlink()
        missing = self.root / "cargo-home/config"
        missing.symlink_to(self.root / "absent-config")
        with self.assertRaises(RuntimeError):
            self.cost.release_environment(self.repository, self.target, self.inherited)

    def test_cost_release_environment_rejects_invalid_or_redirected_target_without_side_effects(self):
        self.target.symlink_to(self.repository, target_is_directory=True)
        for target, environment in ((self.target, self.inherited), (Path("relative"), self.inherited),
                                    (self.root / "new", {"PATH": False}), (self.root / "new", None)):
            with self.assertRaises(RuntimeError):
                self.cost.release_environment(self.repository, target, environment)
        self.assertFalse((self.root / "new").exists())


class CurrentCostReleaseExecutionTests(unittest.TestCase):
    def setUp(self):
        import m9e_current_cost as cost
        import time
        self.cost = cost
        temporary = tempfile.TemporaryDirectory(prefix="m9e-release-execution-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.repository = self.root / "candidate"
        for name in cost.BUILD_SOURCE_PATHS:
            path = self.repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("bound fixture " + name + "\n")
        (self.repository / "rust/Cargo.toml").write_text('[workspace.package]\nversion="0.1.0"\n')
        self.binding = cost.build_source_binding(self.repository, CANDIDATE)
        self.identity = {"product_sha": CANDIDATE, "workflow_sha": CANDIDATE, "run_id": "42", "run_attempt": "1",
                         "profile": "test", "features": "default", "target": "x86_64-unknown-linux-gnu"}
        self.record = json.loads(CurrentCostRecordTests.PRODUCED)
        self.line = cost.PREFIX + json.dumps(self.record, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        self.content = {"bundle": {"bytes": self.record["bundle_bytes"], "sha256": "1" * 64},
                        "manifest": {"bytes": 1219, "sha256": "2" * 64},
                        "identity": self.record["content_identity"]}
        self.environment = {"HOME": str(self.root / "home"), "CARGO_HOME": str(self.root / "cargo-home")}
        self.deadline = time.monotonic() + 30
        self.calls, self.targets = [], []
        self.defect = None
        self.serial = 0

    def command(self, command, *, cwd, environment, output, seconds, byte_limit, global_deadline):
        self.calls.append((command, str(cwd), dict(environment), seconds, byte_limit, global_deadline))
        if command[0] == "cargo":
            target = Path(environment["CARGO_TARGET_DIR"])
            self.assertTrue(target.is_dir())
            self.assertEqual(list(target.iterdir()), [])
            self.targets.append(target)
            binary = target / "release/deps/m9e_current_cost_probe-0123456789abcdef"
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"source-bound fake executable; not run")
            binary.chmod(0o700)
            manifest = self.repository / "rust/crates/er-repro/Cargo.toml"
            artifact = {"reason": "compiler-artifact", "manifest_path": str(manifest), "features": [],
                        "package_id": "path+" + manifest.parent.as_uri() + "#0.1.0",
                        "target": {"name": self.cost.TARGET[1], "kind": ["test"], "crate_types": ["bin"],
                                   "src_path": str(self.repository / self.cost.SOURCE)},
                        "profile": {"opt_level": "3", "debug_assertions": False, "debuginfo": 0,
                                    "overflow_checks": False, "test": True}, "executable": str(binary)}
            raw = (json.dumps(artifact) + '\n' + json.dumps({"reason": "build-finished", "success": True}) + '\n').encode()
        elif "--list" in command:
            raw = (self.cost.TEST_ID + ": test\n").encode()
            if self.defect == "binary":
                Path(command[0]).write_bytes(b"changed after listing")
        else:
            self.assertIn("--exact", command)
            if self.defect == "exit":
                raise RuntimeError("simulated actual nonzero execution")
            suffix = b"test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n"
            raw = b"running 1 test\n" + self.line + suffix
            if self.defect == "duplicate-result":
                raw += suffix
            elif self.defect == "duplicate-record":
                raw += self.line
            elif self.defect == "zero-tests":
                raw = raw.replace(b"1 passed", b"0 passed")
            elif self.defect == "source":
                (self.repository / self.cost.SOURCE).write_text("changed after execution\n")
        output.write_bytes(raw)
        return {"path": output, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "elapsed_seconds": 0.01}

    def execute(self, **overrides):
        self.serial += 1
        diagnostics = self.root / ("diagnostics-" + str(self.serial))
        diagnostics.mkdir()
        kwargs = {"identity": self.identity, "source_binding": self.binding,
                  "discovered_ids": [self.cost.TEST_ID], "global_deadline": self.deadline, **overrides}
        with patch.object(self.cost, "run_bounded", side_effect=self.command), \
                patch.object(self.cost, "read_content", return_value=self.content), \
                patch.dict(os.environ, self.environment, clear=True):
            return self.cost.execute_release(self.repository, self.root, diagnostics, **kwargs)

    def test_cost_release_executes_one_owned_release_artifact_in_global_inventory_once(self):
        output, proof = self.execute()
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[0][0], ["cargo", "test", "--locked", "--release", "-p", "er-repro", "--test",
                                          self.cost.TARGET[1], "--no-run", "--message-format=json"])
        self.assertEqual(self.calls[1][0][1:], ["--list", "--format", "terse"])
        self.assertEqual(self.calls[2][0][1:], [self.cost.TEST_ID, "--exact", "--format", "terse", "--nocapture", "--test-threads=1"])
        self.assertEqual([(call[3], call[4]) for call in self.calls], [(900, 16 << 20), (30, 16384), (600, 16384)])
        self.assertTrue(all(call[5] == self.deadline for call in self.calls))
        self.assertTrue(all(call[2]["CARGO_TARGET_DIR"] == str(self.targets[0]) for call in self.calls))
        self.assertTrue(output.is_file())
        self.assertFalse(self.targets[0].parent.exists())
        self.assertEqual(proof["execution_profile"], "release")
        self.assertEqual(proof["record"]["line"].encode(), self.line)
        self.assertEqual(proof["tests"], {"executed": 1, "passed": 1, "failed": 0, "skipped": 0})
        self.assertEqual(proof["phase_identity_sha256"], hashlib.sha256(self.cost.encoded(self.identity)).hexdigest())
        self.assertEqual(proof["source_binding_sha256"], hashlib.sha256(self.cost.encoded(self.binding)).hexdigest())
        self.assertLessEqual(len(self.cost.encoded(proof)), 16384)

    def test_cost_release_refuses_unbound_inventory_profile_host_and_deadline_before_build(self):
        for overrides in ({"discovered_ids": []}, {"discovered_ids": [self.cost.TEST_ID] * 2},
                          {"identity": {**self.identity, "profile": "release"}},
                          {"identity": {**self.identity, "features": "extra"}},
                          {"identity": {**self.identity, "target": "wasm32-unknown-unknown"}},
                          {"source_binding": {}}, {"global_deadline": 0}, {"global_deadline": True}):
            with self.assertRaises(RuntimeError):
                self.execute(**overrides)
            self.assertEqual(self.calls, [])
            self.assertEqual(self.targets, [])

    def test_cost_release_rejects_binary_and_source_changes_and_always_removes_owned_build(self):
        for defect in ("binary", "source"):
            self.defect = defect
            with self.assertRaises(RuntimeError):
                self.execute()
            self.assertTrue(all(not target.parent.exists() for target in self.targets))
        self.assertEqual(len(self.calls), 5, "changed listed binary must never execute")

    def test_cost_release_rejects_nonzero_duplicate_results_records_and_zero_execution(self):
        for defect in ("exit", "duplicate-result", "duplicate-record", "zero-tests"):
            self.defect = defect
            with self.assertRaises(RuntimeError):
                self.execute()
            self.assertFalse(self.targets[-1].parent.exists())

    def validate(self, proof, **overrides):
        kwargs = {"repository": self.repository, "identity": self.identity,
                  "source_binding": self.binding, "content": self.content, **overrides}
        with patch.object(self.cost, "read_content", return_value=self.content):
            return self.cost.validate_execution(proof, **kwargs)

    def test_cost_transferred_proof_roundtrips_after_owned_binary_cleanup(self):
        _, proof = self.execute()
        restored = json.loads(self.cost.encoded(proof))
        self.validate(restored)
        self.assertFalse(self.targets[0].exists())
        self.assertEqual(len(self.calls), 3)
        for name in ("artifact", "record", "logs"):
            self.assertEqual(restored[name], proof[name])

    def test_cost_transferred_proof_rejects_other_run_candidate_scope_and_counts(self):
        _, proof = self.execute()
        mutations = [("schema_version", True), ("status", "pending"), ("execution_profile", "test"),
                     ("target", ["er-cli", self.cost.TARGET[1]]), ("test_id", "unrelated"),
                     ("phase_identity_sha256", "0" * 64), ("source_binding_sha256", "0" * 64),
                     ("tests", {"executed": True, "passed": 1, "failed": 0, "skipped": 0}),
                     ("tests", {"executed": 2, "passed": 2, "failed": 0, "skipped": 0})]
        for key, value in mutations:
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                self.validate({**proof, key: value})
        for key in ("run_id", "run_attempt", "product_sha", "workflow_sha", "profile", "features", "target"):
            with self.subTest(identity=key), self.assertRaises(RuntimeError):
                self.validate(proof, identity={**self.identity, key: "different"})
        with self.assertRaises(RuntimeError):
            self.validate({**proof, "unreviewed": "x" * 17000})
        for key in proof:
            with self.subTest(missing=key), self.assertRaises(RuntimeError):
                self.validate({name: value for name, value in proof.items() if name != key})

    def test_cost_transferred_proof_rejects_debug_or_unbound_artifact_and_environment(self):
        _, proof = self.execute()
        changes = [("bytes", True), ("bytes", (128 << 20) + 1), ("sha256", "bad"),
                   ("relative_path", "../release/deps/escape"), ("cargo_package_id", "registry+unrelated"),
                   ("manifest_sha256", "0" * 64), ("source_sha256", "0" * 64)]
        for key, value in changes:
            with self.subTest(artifact=key), self.assertRaises(RuntimeError):
                self.validate({**proof, "artifact": {**proof["artifact"], key: value}})
        for key, value in (("opt_level", "0"), ("debug_assertions", True), ("overflow_checks", True),
                           ("debuginfo", False), ("test", 1), ("extra", False)):
            artifact = copy.deepcopy(proof["artifact"])
            artifact["cargo_profile"][key] = value
            with self.subTest(profile=key), self.assertRaises(RuntimeError):
                self.validate({**proof, "artifact": artifact})
        for key, value in (("cargo_config_files", False), ("compiler_overrides", 1),
                           ("features", "other"), ("profile", "test"), ("secret", "must not transfer")):
            with self.subTest(environment=key), self.assertRaises(RuntimeError):
                self.validate({**proof, "environment": {**proof["environment"], key: value}})

    def test_cost_transferred_proof_rejects_rehashed_invalid_record_and_bad_log_bounds(self):
        _, proof = self.execute()
        for key, value in (("line", self.line.decode()[:-1]), ("line", self.line.decode() * 2),
                           ("bytes", True), ("bytes", len(self.line) + 1), ("sha256", "0" * 64)):
            with self.subTest(record=key), self.assertRaises(RuntimeError):
                self.validate({**proof, "record": {**proof["record"], key: value}})
        bad = copy.deepcopy(self.record)
        bad["debug_assertions"] = True
        raw = self.cost.PREFIX + json.dumps(bad).encode() + b"\n"
        with self.assertRaises(RuntimeError):
            self.validate({**proof, "record": {"line": raw.decode(), "bytes": len(raw),
                                               "sha256": hashlib.sha256(raw).hexdigest()}})
        for name in ("build", "list", "execute"):
            for key, value in (("bytes", 0), ("bytes", (16 << 20) + 1), ("sha256", "bad"),
                               ("elapsed_seconds", True), ("elapsed_seconds", float("nan")),
                               ("elapsed_seconds", 901), ("unexpected", 1)):
                logs = copy.deepcopy(proof["logs"])
                logs[name][key] = value
                with self.subTest(log=name, field=key), self.assertRaises(RuntimeError):
                    self.validate({**proof, "logs": logs})
        logs = copy.deepcopy(proof["logs"])
        logs["list"]["sha256"] = "0" * 64
        with self.assertRaises(RuntimeError):
            self.validate({**proof, "logs": logs})

    def test_cost_transferred_proof_rejects_candidate_content_and_manifest_drift(self):
        _, proof = self.execute()
        for key in ("bundle", "manifest", "identity"):
            changed = copy.deepcopy(self.content)
            if key == "identity":
                changed[key]["oracle_sha"] = "0" * 40
            else:
                changed[key]["sha256"] = "0" * 64
            with self.subTest(content=key), self.assertRaises(RuntimeError):
                self.validate(proof, content=changed)
        manifest = self.repository / "rust/crates/er-repro/Cargo.toml"
        manifest.write_text("changed Cargo manifest\n")
        with self.assertRaises(RuntimeError):
            self.validate(proof)
    def lane_proofs(self):
        import m9e_phases as phases
        self.identity["files"] = {"content": "f" * 64}
        _, release = self.execute()
        inventory = [{"crate": self.cost.TARGET[0], "target": self.cost.TARGET[1],
                      "ids": [self.cost.TEST_ID], "historical_excluded_ids": []}]
        plan = {"requires_wasm": False, "requires_browser": False, "requires_cli_executable": False,
                "requires_current_cost_probe": True, "current_cost_source_binding": self.binding,
                "required_native_targets": {self.cost.TARGET[0]: [self.cost.TARGET[1]]},
                "required_native_test_ids": {":".join(self.cost.TARGET): [self.cost.TEST_ID]}}
        first = {"version": 1, "phase": "native", "status": "passed", "qualification": "pending",
                 "identity": self.identity, "plan": plan, "plan_sha256": phases.sha(phases.encoded(plan)),
                 "inventory": inventory, "inventory_sha256": phases.sha(phases.encoded(inventory)),
                 "lane": "a", "assigned_targets": [list(self.cost.TARGET)], "completed_targets": [list(self.cost.TARGET)],
                 "tests": {"selected": 1, "executed": 1, "passed": 1, "failed": 0, "skipped": 0},
                 "selected_inventory_validated": True, "selected_test_ids_sha256": "c" * 64,
                 "required_native_target_counts": {":".join(self.cost.TARGET): 1},
                 "native_timer_parity_digest": None, "cli": None, "worker": None, "current_cost_probe": release}
        second = copy.deepcopy(first)
        second.update(lane="b", assigned_targets=[], completed_targets=[])
        second["tests"].update(executed=0, passed=0)
        second.pop("current_cost_probe")
        return phases, first, second

    def validate_native_cost(self, phases, proof):
        proof["plan_sha256"] = phases.sha(phases.encoded(proof["plan"]))
        with patch.object(phases, "ROOT", self.repository), patch.object(self.cost, "read_content", return_value=self.content):
            phases.validate_native(proof, self.identity)

    def test_cost_native_proofs_roundtrip_exact_A_execution_and_B_global_inventory(self):
        phases, first, second = self.lane_proofs()
        for lane, proof in (("a", first), ("b", second)):
            path = self.root / ("native-" + lane + ".json")
            digest = phases.write_bounded(path, proof)
            restored = phases.read_bounded(path, digest)
            self.validate_native_cost(phases, restored)
            self.assertEqual(restored, proof)
        self.assertEqual(first["tests"]["executed"] + second["tests"]["executed"], 1)
        self.assertFalse(self.targets[0].exists())

    def test_cost_native_proof_rejects_missing_A_extra_B_and_unrequested_release_evidence(self):
        phases, first, second = self.lane_proofs()
        mutations = []
        bad = copy.deepcopy(first)
        bad.pop("current_cost_probe")
        mutations.append(bad)
        bad = copy.deepcopy(second)
        bad["current_cost_probe"] = first["current_cost_probe"]
        mutations.append(bad)
        bad = copy.deepcopy(first)
        bad["plan"]["requires_current_cost_probe"] = False
        mutations.append(bad)
        bad = copy.deepcopy(first)
        bad["plan"]["requires_current_cost_probe"] = 1
        mutations.append(bad)
        for proof in mutations:
            with self.assertRaises(RuntimeError):
                self.validate_native_cost(phases, proof)

    def test_cost_native_proof_rejects_discovery_count_map_and_completion_changes(self):
        phases, first, _ = self.lane_proofs()
        for mode in ("ids", "excluded", "map", "required", "count", "completion", "assigned", "source"):
            bad = copy.deepcopy(first)
            if mode == "ids":
                bad["inventory"][0]["ids"] = ["replacement"]
            elif mode == "excluded":
                bad["inventory"][0]["historical_excluded_ids"] = [self.cost.TEST_ID]
            elif mode == "map":
                bad["plan"]["required_native_test_ids"] = {}
            elif mode == "required":
                bad["plan"]["required_native_targets"][self.cost.TARGET[0]] *= 2
            elif mode == "count":
                bad["required_native_target_counts"][":".join(self.cost.TARGET)] = True
            elif mode == "completion":
                bad["completed_targets"] *= 2
            elif mode == "assigned":
                bad["assigned_targets"] = []
            else:
                bad["plan"]["current_cost_source_binding"]["cargo_manifests"]["sha256"] = "0" * 64
            bad["inventory_sha256"] = phases.sha(phases.encoded(bad["inventory"]))
            with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                self.validate_native_cost(phases, bad)

    def test_cost_native_proof_cannot_hide_debug_profile_behind_valid_outer_hashes(self):
        phases, first, _ = self.lane_proofs()
        bad = copy.deepcopy(first)
        bad["current_cost_probe"]["artifact"]["cargo_profile"]["opt_level"] = "0"
        path = self.root / "rehash.json"
        digest = phases.write_bounded(path, bad)
        restored = phases.read_bounded(path, digest)
        with self.assertRaises(RuntimeError):
            self.validate_native_cost(phases, restored)

    def test_cost_aggregate_preserves_validated_release_record_without_reexecution(self):
        phases, first, second = self.lane_proofs()
        first_hash = phases.write_bounded(self.root / "proof/native-a.json", first)
        second_hash = phases.write_bounded(self.root / "proof/native-b.json", second)
        third = copy.deepcopy(second)
        third["lane"] = "c"
        third_hash = phases.write_bounded(self.root / "proof/native-c.json", third)
        platform = {"version": 1, "phase": "platform", "status": "passed", "qualification": "pending",
                    "identity": self.identity, "native_manifest_sha256": first_hash, "plan_sha256": first["plan_sha256"]}
        platform_hash = phases.write_bounded(self.root / "platform/platform.json", platform)
        environment = {"M9E_PHASE_DIR": str(self.root), "M9E_NATIVE_MANIFEST_SHA256": first_hash,
                       "M9E_NATIVE_B_MANIFEST_SHA256": second_hash, "M9E_PLATFORM_MANIFEST_SHA256": platform_hash,
                       "M9E_NATIVE_C_RESULT": "success", "M9E_NATIVE_C_MANIFEST_SHA256": third_hash,
                       "M9E_NATIVE_A_RESULT": "success", "M9E_NATIVE_B_RESULT": "success", "M9E_PLATFORM_RESULT": "success"}
        with patch.dict(os.environ, environment), patch.object(phases, "identity", return_value=self.identity), \
                patch.object(phases, "ROOT", self.repository), patch.object(self.cost, "read_content", return_value=self.content), \
                patch.object(self.cost, "execute_release") as execute:
            aggregate = phases.aggregate(SimpleNamespace())
        execute.assert_not_called()
        self.assertEqual(aggregate["qualification"], "passed")
        self.assertEqual(aggregate["current_cost_probe"], first["current_cost_probe"])
        self.assertEqual(aggregate["tests"]["executed"], 1)
        self.assertEqual(aggregate["native_manifest_sha256"], first_hash)

    def test_cost_compact_pointer_preserves_other_fields_and_exact_full_summary_hash(self):
        phases, first, _ = self.lane_proofs()
        compact = {"status": "passed", "tests": first["tests"], "current_cost_probe": first["current_cost_probe"]}
        unchanged = copy.deepcopy(compact)
        self.cost.compact(compact, "d" * 64, phases.encoded)
        self.assertEqual(compact, unchanged)
        compact["other_required_evidence"] = "x" * 9000
        self.assertGreater(len(phases.encoded(compact)), 16000)
        preserved = {key: value for key, value in compact.items() if key != "current_cost_probe"}
        self.cost.compact(compact, "d" * 64, phases.encoded)
        self.assertEqual(compact["current_cost_probe"], {"file": "phase-summary.json", "sha256": "d" * 64,
                                                       "field": "current_cost_probe"})
        self.assertEqual({key: value for key, value in compact.items() if key != "current_cost_probe"}, preserved)
        self.assertLessEqual(len(phases.encoded(compact)), 16000)

    def test_cost_proof_transport_retains_existing_raw_and_expanded_byte_limits(self):
        phases, first, _ = self.lane_proofs()
        self.assertEqual(phases.MANIFEST_LIMIT, 65536)
        self.assertEqual(phases.NATIVE_PROOF_LIMIT, 196608)
        first["unbounded_extra"] = "x" * 65536
        with self.assertRaises(RuntimeError):
            phases.write_bounded(self.root / "oversized.json", first)
if __name__ == "__main__":
    unittest.main()
