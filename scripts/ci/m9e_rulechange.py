"""Bounded remote derivation and proof for the current rulechange witness.

The C-owned ordinary test runs after complete discovery/lint. Its caller may
publish this provenance only after exact successful execution and context exit.
All source/build/pool files remain on the remote runner.
"""

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re

RULE_TARGET = "m9e_current_rulechange_reload"
RULE_TEST = "actual_worker_cli_rulechange_preserves_prefix_changes_future_and_rejects_divergent_candidate"
RULE_TEST_SOURCE = f"rust/crates/er-cli/tests/{RULE_TARGET}.rs"
RULE_NAME = "held-navigation-two-consequences-v1"
RULE_INPUTS = {"lock": "rust/Cargo.lock", "workspace": "rust/Cargo.toml",
               "manifest": "rust/crates/er-kernel-worker/Cargo.toml", "toolchain": "rust/rust-toolchain.toml"}


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def bounded_capture(f, args, cwd=None):
    name = "rule-meta-" + hashlib.sha256(encoded([args, str(cwd)])).hexdigest()[:12]
    path = f.run(args, name, f.ROOT if cwd is None else cwd)
    if path.stat().st_size > 16_384:
        raise RuntimeError("rule source metadata exceeds bound")
    return path.read_text().strip()


RULE_SOURCE = "rust/crates/er-kernel/src/game_kernel_v7.rs"
RULE_ORIGINAL = "        self.handle_button(repeat.button)\n"
RULE_REPLACEMENT = (
    "        let mut first = self.handle_button(repeat.button)?;\n"
    "        let second = self.handle_button(repeat.button)?;\n"
    "        first.effects.extend(second.effects);\n"
    "        first.internal_events.extend(second.internal_events);\n"
    "        Ok(first)\n"
)


def make_rule_policy(root, source_sha):
    original = root / RULE_SOURCE
    test = root / RULE_TEST_SOURCE
    if (not re.fullmatch(r"[0-9a-f]{40}", source_sha) or original.is_symlink() or test.is_symlink()
            or not original.is_file() or not test.is_file()):
        raise RuntimeError("rule target or candidate source is absent or unsafe")
    raw = original.read_bytes()
    if raw.count(RULE_ORIGINAL.encode()) != 1:
        raise RuntimeError("rule derivation requires exactly one original consequence")
    if any((root / path).is_symlink() or not (root / path).is_file() for path in RULE_INPUTS.values()):
        raise RuntimeError("rule Cargo input is absent or unsafe")
    return {"schema_version": 1, "rule": RULE_NAME, "source": RULE_SOURCE,
            "package": "er-cli", "target": RULE_TARGET, "test": RULE_TEST,
            "candidate_source_sha": source_sha, "test_sha256": hashlib.sha256(test.read_bytes()).hexdigest(),
            "original_sha256": hashlib.sha256(raw).hexdigest(),
            "derived_sha256": hashlib.sha256(raw.replace(RULE_ORIGINAL.encode(), RULE_REPLACEMENT.encode(), 1)).hexdigest(),
            "inputs": {key: hashlib.sha256((root / path).read_bytes()).hexdigest() for key, path in RULE_INPUTS.items()}}


def validate_rule_evidence(evidence, policy, identity, clean_worker):
    if (not isinstance(evidence, dict) or type(evidence.get("schema_version")) is not int
            or evidence["schema_version"] != 1 or evidence.get("status") != "passed"
            or type(policy.get("schema_version")) is not int or policy["schema_version"] != 1 or policy.get("rule") != RULE_NAME
            or policy.get("source") != RULE_SOURCE or policy.get("target") != RULE_TARGET
            or policy.get("package") != "er-cli" or policy.get("test") != RULE_TEST
            or policy.get("candidate_source_sha") != identity["product_sha"]
            or evidence.get("policy_sha256") != hashlib.sha256(encoded(policy)).hexdigest()
            or any(evidence.get(key) != policy[key] for key in (
                "source", "rule", "candidate_source_sha", "original_sha256", "derived_sha256", "inputs"))
            or evidence.get("test") != RULE_TEST or evidence.get("target") != RULE_TARGET
            or evidence.get("tests") != {"executed": 1, "passed": 1, "failed": 0, "skipped": 0}
            or any(type(value) is not int for value in evidence.get("tests", {}).values())
            or evidence.get("parent_sha") != identity["product_sha"]
            or evidence.get("toolchain") != identity["toolchain"]
            or evidence.get("candidate_preserved_sha256") != policy["original_sha256"]
            or evidence.get("pool_verified_after_test") is not True
            or any(not isinstance(policy.get(key), str) or not re.fullmatch(r"[0-9a-f]{64}", policy[key])
                   for key in ("original_sha256", "derived_sha256", "test_sha256"))
            or policy.get("original_sha256") == policy.get("derived_sha256")):
        raise RuntimeError("rule witness policy, result or preserved-source proof disagrees")
    expected_inputs = {"lock": identity["files"]["lock"], "workspace": identity["files"].get("rule_workspace"),
                       "manifest": identity["files"].get("rule_worker_manifest"), "toolchain": identity["files"].get("rule_toolchain")}
    if (policy.get("inputs") != expected_inputs or policy.get("test_sha256") != identity["files"].get("rule_test")
            or policy.get("original_sha256") != identity["files"].get("rule_source")
            or any(not re.fullmatch(r"[0-9a-f]{64}", value or "") for value in expected_inputs.values())):
        raise RuntimeError("rule source and Cargo inputs are not bound to the phase checkout")
    for key in ("derived_source_sha", "tree_sha", "parent_tree_sha", "original_blob", "derived_blob"):
        if not re.fullmatch(r"[0-9a-f]{40}", evidence.get(key, "")):
            raise RuntimeError("rule commit/tree/blob identity is malformed")
    if (evidence["derived_source_sha"] == identity["product_sha"]
            or evidence["tree_sha"] == evidence["parent_tree_sha"] or evidence["original_blob"] == evidence["derived_blob"]
            or evidence.get("changed_paths") != [RULE_SOURCE] or evidence.get("source_mode") != "100644"
            or type(evidence.get("patch_bytes")) is not int or not 0 < evidence["patch_bytes"] <= 16_384
            or not re.fullmatch(r"[0-9a-f]{64}", evidence.get("patch_sha256", ""))
            or policy.get("inputs", {}).get("lock") != identity["files"]["lock"]
            or not isinstance(evidence.get("cargo_version"), str) or not evidence["cargo_version"].startswith("cargo ")):
        raise RuntimeError("rule one-file derivation or Cargo inputs disagree")
    worker = evidence.get("worker", {})
    if (not clean_worker or worker.get("source_sha") != evidence["derived_source_sha"]
            or worker.get("target") != identity["target"] or worker.get("profile") != "test"
            or worker.get("manifest_path") != RULE_INPUTS["manifest"]
            or worker.get("cargo_profile") != clean_worker.get("cargo_profile")
            or worker.get("cargo_profile", {}).get("test") is not False
            or worker.get("package_identity") != str(clean_worker.get("cargo_package_id", "")).rsplit("#", 1)[-1]
            or not worker.get("package_identity") or type(worker.get("bytes")) is not int
            or not 0 < worker["bytes"] <= 128 * 1024 * 1024
            or not re.fullmatch(r"[0-9a-f]{64}", worker.get("sha256", ""))
            or worker.get("sha256") == clean_worker.get("sha256")
            or evidence.get("clean_worker_sha256") != clean_worker.get("sha256")
            or evidence.get("pool_files") != ["base-worker", "rule-worker"]):
        raise RuntimeError("rule worker artifact or narrow sibling pool disagrees")


@contextmanager
def current_rule_worker(f, summary, clean_worker):
    """Use the existing feedback module's bounded remote command primitives."""
    source_sha = summary["product_sha"]
    policy = summary["plan"].get("rule_worker")
    if policy != make_rule_policy(f.ROOT, source_sha):
        raise RuntimeError("rule source policy differs from exact selected candidate")
    if (not f.re.fullmatch(r"[0-9a-f]{40}", source_sha)
            or bounded_capture(f, ["git", "rev-parse", "HEAD"]) != source_sha
            or bounded_capture(f, ["git", "diff", "--name-only", "HEAD", "--"])):
        raise RuntimeError("rule variant requires exact clean candidate source")
    original_path = f.ROOT / RULE_SOURCE
    original = original_path.read_bytes()
    needle, replacement = RULE_ORIGINAL.encode(), RULE_REPLACEMENT.encode()
    if original.count(needle) != 1:
        raise RuntimeError("rule variant must replace exactly one timer consequence")
    derived_bytes = original.replace(needle, replacement, 1)
    original_hash = f.hashlib.sha256(original).hexdigest()
    derived_hash = f.hashlib.sha256(derived_bytes).hexdigest()
    clean_path = f.Path(clean_worker["path"])
    configured_root = f.Path(f.os.environ.get("CARGO_TARGET_DIR", f.RUST / "target"))
    clean_root = (configured_root if configured_root.is_absolute() else f.RUST / configured_root).resolve()
    if (clean_worker.get("source_sha") != source_sha or clean_worker.get("target") != summary["target"]
            or clean_worker.get("profile") != "test" or clean_worker.get("cargo_profile", {}).get("test") is not False
            or not clean_path.is_absolute() or clean_path.is_symlink() or not clean_path.is_file()
            or not clean_path.resolve().is_relative_to(clean_root) or not f.os.access(clean_path, f.os.X_OK)
            or clean_worker.get("manifest_path") != RULE_INPUTS["manifest"]
            or not isinstance(clean_worker.get("cargo_package_id"), str) or not clean_worker["cargo_package_id"]
            or clean_path.stat().st_size != clean_worker["bytes"] or f.digest(clean_path) != clean_worker["sha256"]):
        raise RuntimeError("rule variant has no verified clean worker binding")
    evidence = {"schema_version": 1, "status": "prepared", "source": RULE_SOURCE,
                "candidate_source_sha": source_sha, "original_sha256": original_hash,
                "derived_sha256": derived_hash, "rule": RULE_NAME, "inputs": policy["inputs"],
                "policy_sha256": hashlib.sha256(encoded(policy)).hexdigest(),
                "clean_worker_sha256": clean_worker["sha256"], "toolchain": summary["toolchain"]}
    # This directory is remote and unique. A private target directory cannot be
    # restored into or saved as the ordinary candidate's Cargo output cache.
    with f.tempfile.TemporaryDirectory(prefix="m9e-rule-worker-", dir=f.REPORT) as temporary:
        owned = f.Path(temporary).resolve()
        checkout, target, pool = owned / "source", owned / "target", owned / "workers"
        registered = False
        pool_binding = None
        try:
            env = f.os.environ.copy()
            env["GIT_LFS_SKIP_SMUDGE"] = "1"
            env["GIT_TERMINAL_PROMPT"] = "0"
            f.run(["git", "worktree", "add", "--detach", "--no-checkout", str(checkout), source_sha],
                  "rule-worktree-create", f.ROOT, env)
            registered = True
            f.run(["git", "sparse-checkout", "init", "--cone"], "rule-sparse-init", checkout, env)
            f.run(["git", "sparse-checkout", "set", "rust"], "rule-sparse-rust", checkout, env)
            f.run(["git", "-c", "core.hooksPath=/dev/null", "reset", "--hard", source_sha],
                  "rule-materialize-source", checkout, env)
            if (bounded_capture(f, ["git", "rev-parse", "HEAD"], checkout) != source_sha
                    or bounded_capture(f, ["git", "status", "--porcelain", "--untracked-files=no"], checkout)):
                raise RuntimeError("rule source checkout differs before declared derivation")
            derived_path = checkout / RULE_SOURCE
            if derived_path.is_symlink() or derived_path.read_bytes() != original:
                raise RuntimeError("rule source preimage differs from exact candidate")
            derived_path.write_bytes(derived_bytes)
            if bounded_capture(f, ["git", "diff", "--name-only", "HEAD", "--"], checkout) != RULE_SOURCE:
                raise RuntimeError("rule source derivation changed another path")
            f.run(["git", "add", "--", RULE_SOURCE], "rule-stage-source", checkout, env)
            f.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
                   "-c", "user.name=M9E remote evidence", "-c", "user.email=m9e-evidence@invalid",
                   "commit", "--no-verify", "-m", "test-only: two held navigation consequences"],
                  "rule-derive-commit", checkout, env)
            derived_sha = bounded_capture(f, ["git", "rev-parse", "HEAD"], checkout)
            parent = bounded_capture(f, ["git", "rev-parse", "HEAD^"], checkout)
            changed = bounded_capture(f, ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], checkout)
            if (not f.re.fullmatch(r"[0-9a-f]{40}", derived_sha) or derived_sha == source_sha
                    or parent != source_sha or changed != RULE_SOURCE
                    or bounded_capture(f, ["git", "rev-list", "--parents", "-n", "1", "HEAD"], checkout).split() != [derived_sha, source_sha]
                    or bounded_capture(f, ["git", "status", "--porcelain", "--untracked-files=no"], checkout)
                    or f.digest(derived_path) != derived_hash):
                raise RuntimeError("rule derived commit identity or one-file delta disagrees")
            patch_path = f.run(["git", "diff", "--binary", "HEAD^", "HEAD", "--", RULE_SOURCE],
                               "rule-source-patch", checkout, env)
            if not 0 < patch_path.stat().st_size <= 16_384:
                raise RuntimeError("rule derivation patch exceeds its bound")
            original_blob = bounded_capture(f, ["git", "rev-parse", f"HEAD^:{RULE_SOURCE}"], checkout)
            derived_blob = bounded_capture(f, ["git", "rev-parse", f"HEAD:{RULE_SOURCE}"], checkout)
            raw_delta = bounded_capture(f, ["git", "diff-tree", "--no-commit-id", "--raw", "--no-abbrev", "-r", "HEAD"], checkout)
            if raw_delta != f":100644 100644 {original_blob} {derived_blob} M\t{RULE_SOURCE}":
                raise RuntimeError("rule commit changes modes, blobs or another tree path")
            if any(f.digest(checkout / path) != policy["inputs"][key] for key, path in RULE_INPUTS.items()):
                raise RuntimeError("rule Cargo inputs differ from candidate")
            if bounded_capture(f, ["rustc", "--version"], checkout / "rust") != summary["toolchain"]:
                raise RuntimeError("rule compiler differs from clean candidate")
            host = next((line.split(": ", 1)[1] for line in bounded_capture(f, ["rustc", "-vV"], checkout / "rust").splitlines()
                         if line.startswith("host: ")), None)
            if host != summary["target"]:
                raise RuntimeError("rule compiler host differs from native target")
            evidence.update({"derived_source_sha": derived_sha, "parent_sha": parent,
                             "tree_sha": bounded_capture(f, ["git", "rev-parse", "HEAD^{tree}"], checkout),
                             "parent_tree_sha": bounded_capture(f, ["git", "rev-parse", f"{source_sha}^{{tree}}"], checkout),
                             "original_blob": original_blob, "derived_blob": derived_blob, "source_mode": "100644",
                             "changed_paths": [RULE_SOURCE],
                             "cargo_version": bounded_capture(f, ["cargo", "--version"], checkout / "rust"),
                             "patch_sha256": f.digest(patch_path), "patch_bytes": patch_path.stat().st_size})
            env["CARGO_TARGET_DIR"] = str(target)
            # Same pinned native test profile as the clean worker, no test binary
            # substituted for the actual worker executable.
            build = f.run(["cargo", "build", "--locked", "--offline", "--profile", "test", "--target", summary["target"],
                           "-p", "er-kernel-worker", "--bin", "er-kernel-worker", "--message-format=json"],
                          "rule-worker-build", checkout / "rust", env)
            if build.stat().st_size > 16 * 1024 * 1024:
                raise RuntimeError("rule Cargo artifact log exceeds bound")
            matches = {}
            manifest = (checkout / "rust/crates/er-kernel-worker/Cargo.toml").resolve()
            for line in build.read_text().splitlines():
                if not line.startswith("{"):
                    continue
                artifact = f.json.loads(line)
                if (artifact.get("reason") != "compiler-artifact"
                        or artifact.get("target", {}).get("name") != "er-kernel-worker"
                        or artifact.get("target", {}).get("kind") != ["bin"]
                        or artifact.get("profile", {}).get("test") is not False
                        or f.Path(artifact.get("manifest_path", "")).resolve() != manifest):
                    continue
                binary = f.Path(artifact.get("executable") or "")
                if (not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
                        or not binary.resolve().is_relative_to(target) or binary.name != "er-kernel-worker"
                        or not f.os.access(binary, f.os.X_OK)):
                    raise RuntimeError("rule worker artifact escapes its private build root")
                matches[binary.resolve()] = artifact
            if len(matches) != 1:
                raise RuntimeError("rule build requires exactly one non-test worker artifact")
            binary, artifact = next(iter(matches.items()))
            if (artifact["profile"] != clean_worker["cargo_profile"]
                    or str(artifact.get("package_id", "")).rsplit("#", 1)[-1] != clean_worker["cargo_package_id"].rsplit("#", 1)[-1]
                    or bounded_capture(f, ["git", "rev-parse", "HEAD"], checkout) != derived_sha
                    or bounded_capture(f, ["git", "status", "--porcelain", "--untracked-files=no"], checkout)
                    or f.digest(derived_path) != derived_hash):
                raise RuntimeError("rule build profile or source changed during compilation")
            size, binary_hash = binary.stat().st_size, f.digest(binary)
            if not 0 < size <= 128 * 1024 * 1024 or binary_hash == clean_worker["sha256"]:
                raise RuntimeError("rule worker is empty, oversized or unchanged")
            pool.mkdir()
            base_copy, rule_copy = pool / "base-worker", pool / "rule-worker"
            for source, destination, expected in ((clean_path, base_copy, clean_worker["sha256"]),
                                                  (binary, rule_copy, binary_hash)):
                f.shutil.copyfile(source, destination)
                destination.chmod(0o755)
                if destination.is_symlink() or destination.parent.resolve() != pool.resolve() or f.digest(destination) != expected:
                    raise RuntimeError("rule test artifact-pool copy differs")
            if sorted(path.name for path in pool.iterdir()) != ["base-worker", "rule-worker"]:
                raise RuntimeError("rule sibling pool has unexpected files")
            pool_binding = (base_copy, rule_copy, binary_hash)
            evidence["pool_files"] = ["base-worker", "rule-worker"]
            evidence["worker"] = {"sha256": binary_hash, "bytes": size, "source_sha": derived_sha,
                                  "target": summary["target"], "profile": "test", "cargo_profile": artifact["profile"],
                                  "package_identity": artifact["package_id"].rsplit("#", 1)[-1],
                                  "manifest_path": "rust/crates/er-kernel-worker/Cargo.toml"}
            test_env = f.os.environ.copy()
            test_env.update({"ER_M9E_WORKER_EXECUTABLE": str(base_copy),
                             "ER_M9E_WORKER_EXECUTABLE_SHA256": clean_worker["sha256"],
                             "ER_M9E_WORKER_SOURCE_SHA": source_sha,
                             "ER_M9E_WORKER_BUILD_TARGET": summary["target"],
                             "ER_M9E_WORKER_BUILD_PROFILE": "test",
                             "ER_M9E_RULE_WORKER_EXECUTABLE": str(rule_copy),
                             "ER_M9E_RULE_WORKER_EXECUTABLE_SHA256": binary_hash,
                             "ER_M9E_RULE_WORKER_SOURCE_SHA": derived_sha,
                             "ER_M9E_RULE_WORKER_PARENT_SHA": source_sha})
            yield test_env, evidence
        finally:
            cleanup_error = None
            try:
                if pool_binding is not None:
                    base_copy, rule_copy, binary_hash = pool_binding
                    if (base_copy.is_symlink() or rule_copy.is_symlink()
                            or sorted(path.name for path in pool.iterdir()) != ["base-worker", "rule-worker"]
                            or f.digest(base_copy) != clean_worker["sha256"] or f.digest(rule_copy) != binary_hash):
                        raise RuntimeError("rule witness modified the narrow sibling pool")
                    evidence["pool_verified_after_test"] = True
            except Exception as error:
                cleanup_error = error
            try:
                if registered:
                    if (checkout.parent.resolve() != owned or checkout.is_symlink()
                            or not checkout.resolve().is_relative_to(owned)):
                        raise RuntimeError("rule checkout cleanup escaped its owned directory")
                    f.run(["git", "worktree", "remove", "--force", str(checkout)], "rule-worktree-remove", f.ROOT)
            finally:
                if (f.digest(original_path) != original_hash or f.digest(clean_path) != clean_worker["sha256"]
                        or bounded_capture(f, ["git", "rev-parse", "HEAD"]) != source_sha
                        or bounded_capture(f, ["git", "diff", "--name-only", "HEAD", "--"])):
                    raise RuntimeError("rule build or witness changed the original candidate")
                evidence["candidate_preserved_sha256"] = original_hash
            if cleanup_error is not None:
                raise cleanup_error

class BoundedRuleFeedback:
    """Narrow adapter: all derivation commands share the native job deadline.

    Source and pool ownership stay with current_rule_worker. Commands use the
    same independently exercised streamed process-group runner as release cost.
    Metadata has a tighter 60-second/16-KiB limit; the private build retains its
    900-second limit with a 16-MiB log ceiling. Unique paths retain every command.
    """
    def __init__(self, feedback, deadline):
        import math
        import time
        if type(deadline) not in (int, float) or not math.isfinite(deadline) or deadline <= time.monotonic():
            raise RuntimeError("rule derivation has no finite shared native budget")
        self.feedback = feedback
        self.deadline = deadline
        self.counter = 0

    def __getattr__(self, name):
        return getattr(self.feedback, name)

    def run(self, command, name, cwd=None, env=None):
        import os
        from m9e_current_cost import run_bounded
        if type(name) is not str or re.fullmatch(r"rule-[a-z0-9-]{1,64}", name) is None:
            raise RuntimeError("rule command diagnostic name is not bounded")
        self.counter += 1
        if self.counter > 64:
            raise RuntimeError("rule derivation command count exceeds bound")
        build = name == "rule-worker-build"
        result = run_bounded(command, cwd=self.feedback.RUST if cwd is None else cwd,
                             environment=dict(os.environ) if env is None else dict(env),
                             output=self.feedback.FULL / f"{self.counter:03d}-{name}.log",
                             seconds=900 if build else 60, byte_limit=16 << 20 if build else 16384,
                             global_deadline=self.deadline)
        self.feedback.TIMINGS[f"{self.counter:03d}-{name}"] = round(result["elapsed_seconds"] * 1000)
        return result["path"]


def bounded_rule_feedback(feedback, deadline):
    return BoundedRuleFeedback(feedback, deadline)


def compact(compact, full_hash, encoder):
    if "rule_worker" in compact and len(encoder(compact)) > 16000:
        compact["rule_worker"] = {"file": "phase-summary.json", "sha256": full_hash, "field": "rule_worker"}
