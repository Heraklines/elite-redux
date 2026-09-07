"""Remote Linux F: two real pinned exports, legacy conservation and XP-only regeneration."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import urllib.request

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-xp-content-export-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
OUTPUT = FULL / "generated"
ORACLE = REPORT / "oracle"
STORE = ROOT / ".m9e-xp-oracle-source"
TARGET = REPORT / "target"
PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
BASE = "86ddc67dbb657ee67cf319226eb8e36dc538b306"
ASSET_COMMIT = "d5f67989d02b7082ca32e7eaddf3b9421916ff12"
ASSET_PATH = "battle-anims/tackle.json"
ASSET_REPOSITORY = "https://github.com/Heraklines/er-assets.git"
ASSET_URL = f"https://api.github.com/repos/Heraklines/er-assets/contents/{ASSET_PATH}?ref={ASSET_COMMIT}"
HELPER = "test/kernel-fixtures/m9/export-progression-content.ts"
INJECTED = "test/kernel-fixtures/m9-export-progression-content.test.ts"
TITLE = "export complete pinned progression definitions"
VERIFIER = "scripts/ci/m9e_xp_content_export_verify.mjs"
PRODUCER = "scripts/ci/m9e_xp_content_export_diagnostic.py"
WORKFLOW = ".github/workflows/m9e-xp-content-export-focused.yml"
ENGINEERING = "rust/fixtures/m9/engineering/"
FIXTURE_BLOBS = {
    "complete-progression-definitions-v1.json": "34c5fbad7ae887bdb550f2e619e61d363743c1ee",
    "progression-content-pack-v2.json": "9563affbe667ea9082f0e8005a17b57368328e66",
    "progression-behavior-bindings-v2.json": "3569c741aadecd964f3a364e410880e3b0450b46",
    "progression-oracle-report-v2.json": "50eb6080b8da77720e7630a65845ed3a1f3731a0",
    "battle-content-pack-v3.json": "4109009a6cd94d68b0093124b8395c976f172a6b",
    "run-content-pack-v3.json": "702705935836d18e7dc911509b365f4f6e2579aa",
    "world-content-pack-v2.json": "ac4226f362a7e7927c7073284cfc8fb1425c19c5",
    "scenario-content-pack-v2.json": "b09c0de01981eaf03dbfe6688e01d56e3c128a12",
    "ai-policy-pack-v2.json": "a805ead057a4fcdd7c5992f9501790300b07f928",
    "bootstrap-content-pack-v1.json": "8d51fd5b6c2e567f097a6b7768caf1394db1d6c8",
    "presentation-content-pack-v1.json": "95c288bab76977dab1ab94aff944afb54242b311",
    "game-content-bundle-v2.json": "6b435b78bc4d62c7f492142752c91610b914a071",
    "game-content-bundle-v2-manifest.json": "3e539d67aa3e1d0b5bcb5cd0407cc06e47ba84b3",
}
FIXTURES = {ENGINEERING + name: blob for name, blob in FIXTURE_BLOBS.items()}
FIXTURES.update({
    "rust/fixtures/m7/run-behavior-unit-manifest-v1.json": "1d20ac696703088844a3c3ce8ba7b207bf06ba56",
    "rust/fixtures/m7/m7-behavior-implementation-v2.json": "d3243c543df62ac0acaa4635291773e886d93a79",
})
CANDIDATE_EXACT = [HELPER, VERIFIER, PRODUCER, WORKFLOW, "scripts/ci/m9e_current_cost.py",
                   "scripts/export-kernel-m9-progression.mjs", "scripts/check-kernel-m9-bundle-determinism.mjs"]
COMPACT_SOURCE_PATHS = [*CANDIDATE_EXACT, "rust/crates/er-content-compiler/src/m9e_progression.rs",
                        "rust/crates/er-content-compiler/tests/m9e_progression.rs",
                        "rust/crates/er-progression/src/content_v2.rs", "rust/crates/er-progression/tests/m9e_content_v2.rs",
                        "rust/crates/er-content-compiler/src/lib.rs", "rust/crates/er-content-compiler/src/m9e_bundle.rs",
                        "rust/crates/er-content-compiler/src/bin/m9e-progression.rs",
                        "rust/crates/er-content-compiler/src/bin/m9e-bundle.rs",
                        "rust/crates/er-content-compiler/Cargo.toml", "rust/crates/er-progression/Cargo.toml",
                        "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml"]
ORACLE_CONFIG = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".nvmrc", ".gitmodules",
                 "vitest.config.ts", "vite.config.ts", "tsconfig.json"]
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0", "CARGO_PROFILE_DEV_OPT_LEVEL": "0",
           "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_DEV_DEBUG_ASSERTIONS": "true",
           "CARGO_PROFILE_DEV_OVERFLOW_CHECKS": "true",
           "CARGO_ENCODED_RUSTFLAGS": "-Copt-level=0\x1f-Cdebug-assertions=yes\x1f-Coverflow-checks=yes"}
DEADLINE = time.monotonic() + 1800
WORK_DEADLINE = DEADLINE - 30
sequence = 0
logs = {}
failed_log = None
active_step = "initialization"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def file_fact(path, bound=32 << 20):
    require(path.is_file() and not path.is_symlink() and path.resolve() == path,
            "missing or redirected input/output: " + str(path))
    size = path.stat().st_size
    require(0 < size <= bound, "input/output size bound: " + str(path))
    sha256 = hashlib.sha256()
    git_blob = hashlib.sha1(f"blob {size}\0".encode())
    with path.open("rb") as stream:
        while chunk := stream.read(65536):
            sha256.update(chunk)
            git_blob.update(chunk)
    return {"bytes": size, "sha256": sha256.hexdigest(), "git_blob": git_blob.hexdigest()}


def write_json(path, value, bound):
    data = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(data) <= bound, "JSON evidence exceeds bound: " + str(path))
    with path.open("xb") as stream:
        stream.write(data)


def run(args, name, *, cwd=ROOT, seconds=900, bound=16 << 20, extra=None, cleanup_command=False):
    global sequence, failed_log, active_step
    sequence += 1
    active_step = name
    output = FULL / f"{sequence:03d}-{name}.log"
    environment = dict(os.environ)
    environment.update(extra or {})
    try:
        receipt = run_bounded(args, cwd=cwd, environment=environment, output=output,
                              seconds=seconds, byte_limit=bound,
                              global_deadline=DEADLINE if cleanup_command else WORK_DEADLINE)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: receipt[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    return output


def git_text(repository, args, name):
    return run(["git", *args], name, cwd=repository, seconds=30, bound=16384).read_text().strip()


def inventory(repository, revision, name, candidate=False):
    tree = run(["git", "ls-tree", "-r", "-l", "-z", revision], name + "-tree", cwd=repository,
               seconds=30, bound=4 << 20).read_bytes()
    records = {}
    for line in tree.split(b"\0"):
        if not line:
            continue
        metadata, encoded_path = line.split(b"\t", 1)
        mode, kind, oid, size = metadata.decode().split()
        path = encoded_path.decode()
        if not candidate and path == "assets":
            require(mode == "160000" and kind == "commit" and oid == ASSET_COMMIT,
                    "pinned assets gitlink differs")
            records[path] = {"mode": mode, "git_commit": oid}
            continue
        selected = (path in CANDIDATE_EXACT or path in FIXTURES
                    or path.startswith("rust/") and path.endswith((".rs", ".toml", ".lock"))) if candidate else (
                        path in ORACLE_CONFIG or path.startswith(("src/", "test/", "plugins/", "locales/", "patches/")))
        if not selected:
            continue
        require(mode in ("100644", "100755") and kind == "blob", "source tree mode: " + path)
        fact = file_fact(repository / path)
        require(fact["bytes"] == int(size) and fact["git_blob"] == oid, "source bytes differ from Git: " + path)
        require(path not in records, "duplicate inventory path")
        records[path] = {**fact, "mode": mode}
    required = [*CANDIDATE_EXACT, *FIXTURES] if candidate else [*ORACLE_CONFIG, "assets",
        "test/setup/vitest.setup.ts", "test/setup/font-face.setup.ts", "test/setup/matchers.setup.ts",
        "test/setup/test-file-initialization.ts", "test/framework/game-manager.ts", "test/framework/game-wrapper.ts",
        "test/mocks/mock-loader.ts", "test/mocks/mock-fetch.ts", "src/data/pokemon-species.ts", "src/field/pokemon.ts"]
    require(all(path in records for path in required), "required source inventory missing")
    if candidate:
        for path, oid in FIXTURES.items():
            require(records[path]["git_blob"] == oid, "baseline fixture changed before regeneration: " + path)
    else:
        require(any(path.startswith("locales/en/") for path in records), "missing pinned locales/en input")
    require(1 <= len(records) <= 20000, "source inventory count bound")
    return records


def inventory_receipt(records, label):
    path = FULL / f"{label}-inventory.json"
    write_json(path, records, 8 << 20)
    return {"count": len(records), **file_fact(path, 8 << 20)}


def fetch_tackle():
    # One immutable single-file JSON request, including base64 and Git blob provenance.
    # The parent run_bounded process group enforces 60 seconds including all socket reads.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise RuntimeError("pinned tackle input redirect rejected")
    request = urllib.request.Request(ASSET_URL, headers={"Accept": "application/vnd.github+json",
                                                       "User-Agent": "m9e-xp-content-export"})
    opener = urllib.request.build_opener(NoRedirect)
    with opener.open(request, timeout=10) as response:
        require(response.status == 200 and response.geturl() == ASSET_URL, "pinned tackle HTTP identity")
        raw = response.read((256 << 10) + 1)
    require(0 < len(raw) <= 256 << 10, "pinned tackle response exceeds 256 KiB")
    row = json.loads(raw)
    require(row.get("path") == ASSET_PATH and row.get("name") == "tackle.json" and row.get("type") == "file"
            and row.get("encoding") == "base64" and re.fullmatch(r"[0-9a-f]{40}", row.get("sha", "")),
            "pinned tackle API schema/identity")
    content = base64.b64decode("".join(row["content"].split()), validate=True)
    require(type(row.get("size")) is int and row["size"] == len(content) and 0 < len(content) <= 256 << 10,
            "pinned tackle declared/actual size")
    require(hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest() == row["sha"],
            "pinned tackle Git blob integrity")
    require(isinstance(json.loads(content), (dict, list)), "pinned tackle JSON invalid")
    destination = ORACLE / "assets" / ASSET_PATH
    require(not destination.exists() and destination.resolve().is_relative_to(ORACLE.resolve()), "tackle owned path")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("xb") as stream:
        stream.write(content)
    write_json(FULL / "tackle-input.json", {"repository": ASSET_REPOSITORY, "commit": ASSET_COMMIT,
               "path": ASSET_PATH, "url": ASSET_URL, "response_bytes": len(raw),
               "response_sha256": hashlib.sha256(raw).hexdigest(), **file_fact(destination, 256 << 10)}, 8192)


def validate_vitest(path):
    fact = file_fact(path, 1 << 20)
    report = json.loads(path.read_bytes())
    for key, value in {"numTotalTests": 1, "numPassedTests": 1, "numFailedTests": 0,
                       "numPendingTests": 0, "numTodoTests": 0}.items():
        require(type(report.get(key)) is int and report[key] == value, "exact fresh Vitest count: " + key)
    require(report.get("success") is True, "fresh Vitest success missing")
    require(report.get("numRuntimeErrorTestSuites", 0) == 0 and not report.get("testExecError"), "Vitest runtime error")
    rows = report.get("testResults")
    require(type(rows) is list and len(rows) == 1 and rows[0].get("name") == str(ORACLE / INJECTED)
            and rows[0].get("status") == "passed" and not rows[0].get("message"), "exact fresh Vitest file required")
    assertions = rows[0].get("assertionResults")
    require(type(assertions) is list and len(assertions) == 1, "exact single fresh assertion required")
    test = assertions[0]
    require(test.get("title") == TITLE and test.get("fullName") == TITLE and test.get("ancestorTitles") == []
            and test.get("status") == "passed" and test.get("failureMessages") == []
            and test.get("retryCount", 0) == 0, "exact pinned producer ID passed once required")
    return {**fact, "test_id": TITLE, "source": INJECTED, "passed": 1, "failed": 0, "skipped": 0}


def build_compilers(summary):
    output = run(["cargo", "build", "--locked", "-p", "er-content-compiler", "--bin", "m9e-progression",
                  "--bin", "m9e-bundle", "--message-format=json"], "build-compilers", cwd=ROOT / "rust")
    records = [json.loads(line) for line in output.read_text().splitlines() if line.startswith("{")]
    require([row.get("success") for row in records if row.get("reason") == "build-finished"] == [True],
            "complete successful compiler artifact stream required")
    binaries = {}
    summary["executables"] = {}
    for name in ("m9e-progression", "m9e-bundle"):
        matches = [row for row in records if row.get("reason") == "compiler-artifact"
                   and row.get("target", {}).get("name") == name]
        require(len(matches) == 1, "exact compiler artifact count: " + name)
        row = matches[0]
        source = f"rust/crates/er-content-compiler/src/bin/{name}.rs"
        binary = Path(row.get("executable") or "")
        require(row.get("manifest_path") == str(ROOT / "rust/crates/er-content-compiler/Cargo.toml")
                and row.get("features") == [] and row["target"].get("kind") == ["bin"]
                and row["target"].get("src_path") == str(ROOT / source)
                and row.get("profile", {}).get("test") is False
                and row["profile"].get("debug_assertions") is True and row["profile"].get("opt_level") == "0"
                and binary == TARGET / "debug" / name and os.access(binary, os.X_OK), "compiler source/profile binding")
        binaries[name] = binary
        summary["executables"][name] = {**file_fact(binary, 128 << 20), "source": source,
                                        "source_sha256": file_fact(ROOT / source)["sha256"], "profile": row["profile"]}
    return binaries


def compile_outputs(binaries):
    def fixture(name):
        return str(ROOT / ENGINEERING / name)
    for prefix, definitions in (("old", ROOT / ENGINEERING / "complete-progression-definitions-v1.json"),
                                ("new", OUTPUT / "export-one.json")):
        run([str(binaries["m9e-progression"]), str(definitions), fixture("battle-content-pack-v3.json"),
             *[str(OUTPUT / f"{prefix}-{kind}.json") for kind in ("pack", "bindings", "report")]],
            prefix + "-progression-compile", seconds=120)
        for kind in ("pack", "bindings", "report"):
            file_fact(OUTPUT / f"{prefix}-{kind}.json")
        if prefix == "old":
            for kind, checked in (("pack", "progression-content-pack-v2.json"),
                                  ("bindings", "progression-behavior-bindings-v2.json"),
                                  ("report", "progression-oracle-report-v2.json")):
                require((OUTPUT / f"old-{kind}.json").read_bytes() == (ROOT / ENGINEERING / checked).read_bytes(),
                        "legacy compiler byte conservation failed before new generation: " + kind)
    components = [fixture("battle-content-pack-v3.json"), fixture("run-content-pack-v3.json"),
                  str(OUTPUT / "new-pack.json"), fixture("world-content-pack-v2.json"),
                  fixture("scenario-content-pack-v2.json"), fixture("ai-policy-pack-v2.json"),
                  fixture("bootstrap-content-pack-v1.json"), fixture("presentation-content-pack-v1.json"),
                  str(ROOT / "rust/fixtures/m7/run-behavior-unit-manifest-v1.json"),
                  str(ROOT / "rust/fixtures/m7/m7-behavior-implementation-v2.json")]
    run([str(binaries["m9e-bundle"]), *components, str(OUTPUT / "new-bundle.json"),
         str(OUTPUT / "new-bundle-manifest.json")], "new-bundle-compile", seconds=120)


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    require(re.fullmatch(r"[0-9a-f]{40}", sha) is not None, "candidate SHA format")
    require(git_text(ROOT, ["rev-parse", "HEAD"], "candidate-head") == sha, "candidate checkout identity")
    require(git_text(STORE, ["rev-parse", "HEAD"], "oracle-store-head") == PIN, "pinned source store identity")
    os.environ.update(PROFILE)
    os.environ.update({"CARGO_TARGET_DIR": str(TARGET), "GIT_NO_LAZY_FETCH": "1", "GIT_LFS_SKIP_SMUDGE": "1",
                       "GIT_TERMINAL_PROMPT": "0", "NODE_OPTIONS": "--max-old-space-size=4096"})
    for name in ("RUSTFLAGS", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "RUSTC_BOOTSTRAP", "NODE_PATH"):
        require(name not in os.environ, "unreviewed ambient execution override: " + name)
    versions = {}
    for name, command, expected in (("node", ["node", "--version"], "v24.9.0"),
                                     ("pnpm", ["pnpm", "--version"], "10.33.2")):
        versions[name] = run(command, name + "-version", seconds=30, bound=16384).read_text().strip()
        require(versions[name] == expected, "pinned " + name + " version")
    versions["rustc"] = run(["rustc", "--version"], "rust-version", seconds=30, bound=16384).read_text().strip()
    require(re.fullmatch(r"rustc 1\.97\.1 \([^\n]+\)", versions["rustc"]) is not None, "pinned Rust version")
    summary.update(versions=versions, compiler_configuration=PROFILE,
                   candidate_tree=git_text(ROOT, ["rev-parse", "HEAD^{tree}"], "candidate-tree"))
    original = inventory(ROOT, sha, "candidate", candidate=True)
    summary["candidate_inputs"] = inventory_receipt(original, "candidate")
    summary["source_hashes"] = {name: original[name]["sha256"] for name in COMPACT_SOURCE_PATHS}
    summary["source_bindings"] = {name: {key: original[name][key] for key in ("bytes", "git_blob")}
                                  for name in COMPACT_SOURCE_PATHS}
    summary["fixtures"] = {path: original[path] for path in FIXTURES}
    require(not ORACLE.exists(), "fresh isolated oracle path required")
    run(["git", "-c", "submodule.recurse=false", "worktree", "add", "--detach", str(ORACLE), PIN],
        "oracle-worktree", cwd=STORE, seconds=60)
    require(git_text(ORACLE, ["rev-parse", "HEAD"], "oracle-head") == PIN, "oracle worktree identity")
    pinned = inventory(ORACLE, PIN, "oracle")
    summary["oracle_inputs"] = inventory_receipt(pinned, "oracle")
    require(git_text(ORACLE, ["config", "--file", ".gitmodules", "--get", "submodule.assets.url"],
                     "assets-repository") == ASSET_REPOSITORY, "pinned assets section repository differs")
    require((ORACLE / "locales/en").is_dir(), "missing pinned input: locales/en")
    summary["required_tackle_input"] = {"repository": ASSET_REPOSITORY, "commit": ASSET_COMMIT,
                                         "path": ASSET_PATH, "url": ASSET_URL, "response_cap_bytes": 256 << 10}
    run([sys.executable, str(ROOT / PRODUCER), "--fetch-tackle"], "pinned-tackle-input", seconds=60, bound=262144)
    summary["tackle_input"] = json.loads((FULL / "tackle-input.json").read_bytes())
    require(not (ORACLE / INJECTED).exists(), "injected exporter must not replace pinned source")
    (ORACLE / INJECTED).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / HELPER, ORACLE / INJECTED)
    injected = file_fact(ORACLE / INJECTED)
    require(injected == file_fact(ROOT / HELPER), "copied actual exporter differs")
    summary["injected_exporter"] = {"candidate_path": HELPER, "oracle_path": INJECTED, **injected}
    run(["pnpm", "install", "--frozen-lockfile"], "pinned-dependencies", cwd=ORACLE)
    require(inventory(ORACLE, PIN, "oracle-after-install") == pinned, "pinned source changed during install")
    summary["fresh_process_exports"] = []
    for ordinal in ("one", "two"):
        destination = OUTPUT / f"export-{ordinal}.json"
        report = FULL / f"vitest-{ordinal}.json"
        require(not destination.exists() and not report.exists(), "fresh export destinations required")
        require(file_fact(ORACLE / INJECTED) == injected, "actual exporter changed")
        run(["pnpm", "exec", "vitest", "run", INJECTED, "--pool=forks", "--isolate", "--no-file-parallelism",
             "--reporter=json", "--outputFile=" + str(report)], "fresh-export-" + ordinal,
            cwd=ORACLE, seconds=600, extra={"M9_PROGRESSION_CONTENT_OUTPUT": str(destination)})
        summary["fresh_process_exports"].append({"ordinal": ordinal, "report": validate_vitest(report),
                                                 "export": file_fact(destination), "helper_sha256": injected["sha256"]})
        require(inventory(ORACLE, PIN, "oracle-after-" + ordinal) == pinned, "pinned source changed during export")
    require(file_fact(OUTPUT / "export-one.json") == file_fact(OUTPUT / "export-two.json"), "fresh export bytes differ")
    run(["node", str(ROOT / VERIFIER), str(ROOT), str(OUTPUT), "exports"], "verify-exports", seconds=60, bound=262144)
    summary["export_validation"] = json.loads((OUTPUT / "exports-validation.json").read_bytes())
    binaries = build_compilers(summary)
    compile_outputs(binaries)
    run(["node", str(ROOT / VERIFIER), str(ROOT), str(OUTPUT), "compiled"], "verify-compiled", seconds=60, bound=262144)
    summary["compiled_validation"] = json.loads((OUTPUT / "compiled-validation.json").read_bytes())
    require(inventory(ROOT, sha, "candidate-final", candidate=True) == original, "candidate sources/fixtures mutated")
    require(file_fact(ORACLE / INJECTED) == injected, "export helper changed after execution")
    require(file_fact(ORACLE / "assets" / ASSET_PATH, 256 << 10)["sha256"] == summary["tackle_input"]["sha256"],
            "pinned tackle input changed")
    for name, binary in binaries.items():
        require(file_fact(binary, 128 << 20)["sha256"] == summary["executables"][name]["sha256"], "executed compiler changed")
    summary["generated"] = {path.name: file_fact(path) for path in sorted(OUTPUT.iterdir())}
    require(sum(row["bytes"] for row in summary["generated"].values()) <= 64 << 20, "generated aggregate exceeds 64 MiB")
    require(time.monotonic() < WORK_DEADLINE, "shared work budget exhausted before reserved cleanup")


def cleanup():
    # Neither sources, dependencies, nor executables enter diagnostic artifacts.
    for path in (TARGET, ORACLE):
        require(not path.is_symlink() and path.resolve().parent == REPORT.resolve(), "owned cleanup containment")
        if path.exists():
            shutil.rmtree(path)


def bound_partial_outputs():
    # Failed producers can leave incomplete files. Do not upload oversized partial payloads.
    allowed = {"export-one.json", "export-two.json", "exports-validation.json", "compiled-validation.json",
               "old-pack.json", "old-bindings.json", "old-report.json", "new-pack.json", "new-bindings.json",
               "new-report.json", "new-bundle.json", "new-bundle-manifest.json"}
    total = 0
    removed = []
    for path in sorted(OUTPUT.iterdir()):
        require(path.parent == OUTPUT and path.is_file() and not path.is_symlink(), "unexpected generated output type")
        size = path.stat().st_size
        if path.name not in allowed or size > 32 << 20 or total + size > 64 << 20:
            removed.append({"name": path.name[:128], "bytes": size})
            path.unlink()
        else:
            total += size
    return removed


def entry():
    require(not REPORT.exists() and REPORT.resolve().parent == Path(os.environ["RUNNER_TEMP"]).resolve(),
            "fresh contained report directory required")
    OUTPUT.mkdir(parents=True)
    COMPACT.mkdir()
    summary = {"schema_version": 1, "source_sha": os.environ.get("GITHUB_SHA"),
               "run_id": os.environ.get("GITHUB_RUN_ID"), "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
               "baseline": BASE, "oracle_sha": PIN,
               "scope": "foundational XP metadata regeneration; no runtime/full modifier qualification", "status": "failed"}
    error = None
    try:
        require(all(re.fullmatch(r"[1-9][0-9]{0,19}", summary[key] or "") for key in ("run_id", "run_attempt")),
                "exact positive GitHub run identity required")
        main(summary)
        summary["status"] = "passed"
    except Exception as caught:
        error = caught
        summary["failure"] = {"step": active_step, "error": str(caught)[:4096]}
    finally:
        try:
            removed = bound_partial_outputs()
            if removed:
                summary["removed_unbounded_partial_outputs"] = removed
                error = error or RuntimeError("generated output limits exceeded; oversized partial files removed")
                summary["status"] = "failed"
            run([sys.executable, str(ROOT / PRODUCER), "--cleanup"], "cleanup", seconds=30,
                bound=262144, cleanup_command=True)
            require(not ORACLE.exists() and not TARGET.exists(), "owned source/target cleanup incomplete")
            require(time.monotonic() < DEADLINE, "shared 1800 second deadline exceeded after cleanup")
            summary["cleanup"] = {"removed": True, "oracle_removed": True, "target_removed": True,
                                  "completed_within_1800_seconds": True}
        except Exception as caught:
            error = error or caught
            summary["status"] = "failed"
            summary["cleanup_error"] = str(caught)[:4096]
        summary["commands"] = logs
        if error is not None:
            text = (json.dumps(summary.get("failure", {"error": str(error)})) + "\n").encode()
            if failed_log is not None and failed_log.is_file():
                with failed_log.open("rb") as stream:
                    stream.seek(max(0, failed_log.stat().st_size - (240 << 10)))
                    text += stream.read(240 << 10)
            require(len(text) <= 256 << 10, "named failure bound")
            (FULL / "failure.txt").write_bytes(text)
            summary["named_failure"] = file_fact(FULL / "failure.txt", 256 << 10)
        write_json(COMPACT / "summary.json", summary, 64 << 10)
    if error is not None:
        raise SystemExit(1)


if __name__ == "__main__":
    if sys.argv[1:] == ["--fetch-tackle"]:
        fetch_tackle()
    elif sys.argv[1:] == ["--cleanup"]:
        cleanup()
    else:
        require(len(sys.argv) == 1, "unexpected producer arguments")
        entry()
