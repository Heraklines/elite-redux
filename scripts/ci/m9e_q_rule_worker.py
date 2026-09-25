"""Bind the changed-rule CLI witness to an isolated, exact-parent Worker build.

This runs only on a remote Q runner. The derived commit changes one declared
timer consequence and is never pushed or mixed into the candidate build.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from m9e_rulechange import RULE_ORIGINAL, RULE_REPLACEMENT, RULE_SOURCE


ROOT = Path(__file__).resolve().parents[2]


def command(args, cwd=ROOT, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, check=False)
    if result.returncode:
        tail = (result.stdout + result.stderr)[-4096:].decode(errors="replace")
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {tail}")
    return result.stdout.decode().strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    candidate = os.environ["CANDIDATE_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", candidate):
        raise RuntimeError("candidate SHA is invalid")
    if command(["git", "rev-parse", "HEAD"]) != candidate:
        raise RuntimeError("checkout differs from exact candidate")
    if command(["git", "status", "--porcelain", "--untracked-files=no"]):
        raise RuntimeError("candidate checkout is not clean")

    source = ROOT / RULE_SOURCE
    original = source.read_bytes()
    needle, replacement = RULE_ORIGINAL.encode(), RULE_REPLACEMENT.encode()
    if original.count(needle) != 1:
        raise RuntimeError("rule derivation requires exactly one declared consequence")
    derived = original.replace(needle, replacement, 1)
    clean = Path(os.environ["ER_M9E_WORKER_EXECUTABLE"]).resolve()
    clean_hash = os.environ["ER_M9E_WORKER_EXECUTABLE_SHA256"]
    if (not clean.is_file() or clean.is_symlink() or digest(clean) != clean_hash
            or os.environ["ER_M9E_WORKER_SOURCE_SHA"] != candidate):
        raise RuntimeError("clean Worker binding differs from candidate")

    runner = Path(os.environ["RUNNER_TEMP"]).resolve()
    work = runner / f"m9e-q-rule-{candidate[:12]}"
    work.mkdir()
    checkout, target, pool = work / "source", work / "target", work / "workers"
    registered = False
    try:
        command(["git", "worktree", "add", "--detach", "--no-checkout", str(checkout), candidate])
        registered = True
        command(["git", "sparse-checkout", "init", "--cone"], cwd=checkout)
        command(["git", "sparse-checkout", "set", "rust"], cwd=checkout)
        command(["git", "reset", "--hard", candidate], cwd=checkout)
        variant_source = checkout / RULE_SOURCE
        if variant_source.is_symlink() or variant_source.read_bytes() != original:
            raise RuntimeError("derived checkout has a different source preimage")
        variant_source.write_bytes(derived)
        command(["git", "add", "--", RULE_SOURCE], cwd=checkout)
        command([
            "git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
            "-c", "user.name=M9E remote evidence", "-c", "user.email=m9e-evidence@invalid",
            "commit", "--no-verify", "-m", "test-only: two held navigation consequences",
        ], cwd=checkout)
        derived_sha = command(["git", "rev-parse", "HEAD"], cwd=checkout)
        if (command(["git", "rev-parse", "HEAD^"], cwd=checkout) != candidate
                or command(["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], cwd=checkout) != RULE_SOURCE
                or digest(variant_source) != hashlib.sha256(derived).hexdigest()
                or command(["git", "status", "--porcelain", "--untracked-files=no"], cwd=checkout)):
            raise RuntimeError("derived commit is not an exact one-file child")

        build_env = os.environ.copy()
        build_env["CARGO_TARGET_DIR"] = str(target)
        with (work / "build.log").open("wb") as log:
            built = subprocess.run([
                "cargo", "build", "--manifest-path", str(checkout / "rust/Cargo.toml"),
                "--locked", "-p", "er-kernel-worker", "--bin", "er-kernel-worker",
            ], cwd=checkout / "rust", env=build_env, stdout=log, stderr=subprocess.STDOUT, check=False)
        if built.returncode:
            raise RuntimeError("derived Worker build failed: " + (work / "build.log").read_bytes()[-4096:].decode(errors="replace"))
        binary = target / "debug/er-kernel-worker"
        if not binary.is_file() or binary.is_symlink() or not binary.resolve().is_relative_to(target.resolve()):
            raise RuntimeError("derived Worker binary is outside the private target")
        variant_hash = digest(binary)
        if variant_hash == clean_hash:
            raise RuntimeError("rule variant did not change the Worker binary")

        pool.mkdir()
        base_copy, rule_copy = pool / "base-worker", pool / "rule-worker"
        shutil.copyfile(clean, base_copy)
        shutil.copyfile(binary, rule_copy)
        base_copy.chmod(0o755)
        rule_copy.chmod(0o755)
        if digest(base_copy) != clean_hash or digest(rule_copy) != variant_hash:
            raise RuntimeError("sibling Worker pool differs from built artifacts")
        bindings = {
            "ER_M9E_WORKER_EXECUTABLE": str(base_copy),
            "ER_M9E_RULE_WORKER_EXECUTABLE": str(rule_copy),
            "ER_M9E_RULE_WORKER_EXECUTABLE_SHA256": variant_hash,
            "ER_M9E_RULE_WORKER_SOURCE_SHA": derived_sha,
            "ER_M9E_RULE_WORKER_PARENT_SHA": candidate,
        }
        with Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as stream:
            for key, value in bindings.items():
                if "\n" in value:
                    raise RuntimeError("Worker binding contains a newline")
                stream.write(f"{key}={value}\n")
        manifest = {
            "candidate_sha": candidate,
            "derived_sha": derived_sha,
            "source": RULE_SOURCE,
            "original_sha256": hashlib.sha256(original).hexdigest(),
            "derived_sha256": hashlib.sha256(derived).hexdigest(),
            "clean_worker_sha256": clean_hash,
            "rule_worker_sha256": variant_hash,
        }
        (work / "manifest.json").write_text(json.dumps(manifest, sort_keys=True) + "\n")
        print(json.dumps(manifest, sort_keys=True))
    finally:
        if registered:
            command(["git", "worktree", "remove", "--force", str(checkout)])
    if digest(source) != hashlib.sha256(original).hexdigest() or command(["git", "status", "--porcelain", "--untracked-files=no"]):
        raise RuntimeError("rule preparation altered the exact candidate")


if __name__ == "__main__":
    main()
