"""Strict current release measurement records; no timing thresholds or allocator claims.

The caller must obtain host/content bindings from the actual candidate build and
fixture. Parsing a record alone does not qualify an executable or game semantics.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import tempfile
import time
import tomllib

SOURCE = "rust/crates/er-repro/tests/m9e_current_cost_probe.rs"
TARGET = ("er-repro", "m9e_current_cost_probe")
TEST_ID = "current_native_phase_costs_preserve_semantics"
PREFIX = b"M9E_CURRENT_COST_PROBE "
LINE_LIMIT = 8192
BUNDLE = "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
CONTENT_MANIFEST = "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json"
U64_MAX = (1 << 64) - 1
PHASES = ["fork", "snapshot", "validate", "observe", "canonical_encode_snapshot",
          "canonical_digest_snapshot", "blake3_preencoded_snapshot", "apply_effectful_raw_input",
          "recorder_append"]
CONTENT_PHASES = ["content_decode", "content_prepare_and_arc"]
CHECKPOINTS = ["title", "mode", "starter", "active"]
IDENTITY_FIELDS = ["oracle_sha", "bundle_hash", "battle_hash", "run_hash", "progression_hash",
                   "world_hash", "scenario_hash", "ai_hash", "bootstrap_hash", "presentation_hash",
                   "semantic_catalog_hash"]
LIMITATIONS = (
    "Wall time includes optimizer barriers, scheduling, internal validation/allocation and internal destruction. "
    "Setup, verification and final input/output teardown excluded. Warm-process fixed-order samples; no allocator "
    "or live-memory claims. API costs overlap and are not additive components. Digest includes canonical encoding; "
    "preencoded BLAKE3 isolates hashing. Recorder append excludes event apply and recorder construction; measures "
    "one accepted event on an empty tail, not rotation or accumulated history. Not transport or whole-run latency."
)


def fail(message):
    raise RuntimeError("current cost evidence: " + message)


def exact_fields(value, fields, label):
    if type(value) is not dict or set(value) != set(fields):
        fail(label + " fields disagree")


def integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        fail(label + " is not a bounded integer")


def lower_hex(value, digits, label):
    if type(value) is not str or re.fullmatch("[0-9a-f]{" + str(digits) + "}", value) is None:
        fail(label + " is not a lower hexadecimal digest")


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("duplicate JSON field " + key)
        result[key] = value
    return result


def content_binding(identity):
    exact_fields(identity, IDENTITY_FIELDS, "content identity")
    for name in IDENTITY_FIELDS:
        value = identity[name]
        prefix = {"battle_hash": "blake3-v3:", "bundle_hash": "blake3-v1:"}.get(name, "")
        if type(value) is not str or not value.startswith(prefix):
            fail("content hash prefix " + name)
        lower_hex(value[len(prefix):], 40 if name == "oracle_sha" else 64, name)


def phase_records(rows, names):
    if type(rows) is not list or len(rows) != len(names):
        fail("phase inventory length")
    for row, name in zip(rows, names, strict=True):
        exact_fields(row, ["phase", "min_ns", "median_ns"], "phase")
        if row["phase"] != name:
            fail("phase identity or order")
        integer(row["min_ns"], 0, U64_MAX, "minimum duration")
        integer(row["median_ns"], row["min_ns"], U64_MAX, "median duration")


def validate_measurements(value, *, architecture, operating_system, bundle_bytes, content_identity):
    exact_fields(value, ["schema_version", "probe", "warmups_per_phase", "samples_per_phase",
                         "debug_assertions", "architecture", "os", "bundle_bytes", "content_identity",
                         "content_phases", "checkpoints", "limitations"], "record")
    for name, expected in (("schema_version", 1), ("warmups_per_phase", 1), ("samples_per_phase", 3)):
        integer(value[name], expected, expected, name)
    if (value["probe"] != TEST_ID or value["debug_assertions"] is not False
            or architecture not in ("x86_64", "aarch64") or operating_system != "linux"
            or value["architecture"] != architecture or value["os"] != operating_system
            or value["limitations"] != LIMITATIONS):
        fail("probe/profile/host/limitations identity")
    integer(bundle_bytes, 1, U64_MAX, "bound bundle bytes")
    integer(value["bundle_bytes"], bundle_bytes, bundle_bytes, "bundle bytes")
    content_binding(content_identity)
    content_binding(value["content_identity"])
    if value["content_identity"] != content_identity:
        fail("actual bundle identity mismatch")
    phase_records(value["content_phases"], CONTENT_PHASES)
    rows = value["checkpoints"]
    if type(rows) is not list or len(rows) != len(CHECKPOINTS):
        fail("checkpoint inventory length")
    fields = ["checkpoint", "snapshot_digest", "snapshot_canonical_bytes", "observation_json_bytes",
              "menu_options", "event", "event_effects", "recorder_capsule_bytes", "recorder_maximum_bytes",
              "recorder_maximum_events", "phases"]
    for row, name in zip(rows, CHECKPOINTS, strict=True):
        exact_fields(row, fields, "checkpoint")
        if row["checkpoint"] != name:
            fail("checkpoint identity or order")
        lower_hex(row["snapshot_digest"], 64, "snapshot")
        for key in ("snapshot_canonical_bytes", "observation_json_bytes", "menu_options", "event_effects"):
            integer(row[key], 1, U64_MAX, key)
        integer(row["recorder_maximum_bytes"], 16_777_216, 16_777_216, "recorder byte cap")
        integer(row["recorder_maximum_events"], 4096, 4096, "recorder event cap")
        integer(row["recorder_capsule_bytes"], 1, row["recorder_maximum_bytes"], "recorder capsule")
        event = row["event"]
        exact_fields(event, ["kind", "input"], "event")
        exact_fields(event["input"], ["kind", "data"], "raw input")
        data = event["input"]["data"]
        exact_fields(data, ["code", "printable", "browser_repeat", "focus"], "raw key")
        exact_fields(data["code"], ["kind"], "key code")
        if (event["kind"] != "RAW_INPUT" or event["input"]["kind"] != "KEY_DOWN"
                or data["code"]["kind"] != ("ARROW_DOWN" if name == "active" else "SPACE")
                or data["printable"] is not False or data["browser_repeat"] is not False or data["focus"] != "GAME"):
            fail("actual checkpoint raw input differs")
        phase_records(row["phases"], PHASES)
    return value


def parse_line(raw, **binding):
    if (type(raw) is not bytes or not len(PREFIX) < len(raw) < LINE_LIMIT
            or not raw.startswith(PREFIX) or not raw.endswith(b"\n") or raw.count(b"\n") != 1
            or b"\r" in raw):
        fail("record framing or byte bound")
    try:
        text = raw[len(PREFIX):-1].decode("utf-8", errors="strict")
        value = json.loads(text, object_pairs_hook=strict_object,
                           parse_constant=lambda token: fail("non-finite JSON " + token))
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise RuntimeError("current cost evidence: invalid complete JSON record") from error
    return validate_measurements(value, **binding)


def validate_record(proof, **binding):
    exact_fields(proof, ["line", "bytes", "sha256"], "wire record")
    if type(proof["line"]) is not str:
        fail("wire line type")
    try:
        raw = proof["line"].encode("utf-8", errors="strict")
    except UnicodeError as error:
        raise RuntimeError("current cost evidence: invalid wire Unicode") from error
    integer(proof["bytes"], len(raw), len(raw), "wire bytes")
    lower_hex(proof["sha256"], 64, "wire SHA256")
    if hashlib.sha256(raw).hexdigest() != proof["sha256"]:
        fail("wire record hash mismatch")
    return parse_line(raw, **binding)


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def discover_release(records, *, repository, target_directory):
    """Read only exact completed Cargo output; return the executable and its binding."""
    repository = Path(repository).resolve()
    target_directory = Path(target_directory)
    if (not target_directory.is_absolute() or target_directory.resolve() != target_directory
            or not target_directory.is_dir()):
        fail("release target directory is not the owned absolute directory")
    if type(records) is not list or not 1 <= len(records) <= 20_000 or any(type(row) is not dict for row in records):
        fail("Cargo build record inventory")
    finished = [row for row in records if row.get("reason") == "build-finished"]
    if len(finished) != 1 or finished[0].get("success") is not True:
        fail("Cargo did not finish successfully exactly once")
    matches = [row for row in records if row.get("reason") == "compiler-artifact"
               and type(row.get("target")) is dict and row["target"].get("name") == TARGET[1]]
    if len(matches) != 1:
        fail("release target is missing or ambiguous")
    artifact = matches[0]
    manifest = repository / "rust/crates/er-repro/Cargo.toml"
    source = repository / SOURCE
    with (repository / "rust/Cargo.toml").open("rb") as stream:
        version = tomllib.load(stream)["workspace"]["package"]["version"]
    package_ids = {"path+" + manifest.parent.as_uri() + "#" + suffix
                   for suffix in (version, "er-repro@" + version)}
    target = artifact["target"]
    profile = artifact.get("profile")
    exact_fields(profile, ["opt_level", "debuginfo", "debug_assertions", "overflow_checks", "test"], "Cargo profile")
    if (artifact.get("manifest_path") != str(manifest) or target.get("src_path") != str(source)
            or artifact.get("package_id") not in package_ids or artifact.get("features") != []
            or target.get("kind") != ["test"] or target.get("crate_types") != ["bin"]
            or profile["opt_level"] != "3" or profile["debug_assertions"] is not False
            or profile["test"] is not True or profile["overflow_checks"] is not False
            or type(profile["debuginfo"]) is not int or profile["debuginfo"] != 0):
        fail("Cargo source/package/features/profile identity differs")
    name = artifact.get("executable")
    if type(name) is not str:
        fail("Cargo executable path type")
    executable = Path(name)
    if (not executable.is_absolute() or executable.resolve() != executable or executable.is_symlink()
            or executable.parent != target_directory / "release/deps" or not executable.is_file()
            or re.fullmatch(TARGET[1] + "-[0-9a-f]{16}", executable.name) is None
            or not os.access(executable, os.X_OK)):
        fail("Cargo executable escaped native release/deps or is not executable")
    integer(executable.stat().st_size, 1, 128 << 20, "executable bytes")
    return executable, {"sha256": file_hash(executable), "bytes": executable.stat().st_size,
                        "relative_path": str(executable.relative_to(target_directory)),
                        "cargo_profile": dict(profile), "cargo_package_id": artifact["package_id"],
                        "manifest_sha256": file_hash(manifest), "source_sha256": file_hash(source)}


def check_executable(executable, binding):
    if (not executable.is_file() or executable.is_symlink() or executable.resolve() != executable
            or not os.access(executable, os.X_OK)
            or executable.stat().st_size != binding["bytes"] or file_hash(executable) != binding["sha256"]):
        fail("release executable changed after discovery")


def validate_listing(raw, discovered_ids):
    if type(raw) is not bytes or not 0 < len(raw) <= 16_384:
        fail("release listing byte bound")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeError as error:
        raise RuntimeError("current cost evidence: invalid release listing Unicode") from error
    if text != TEST_ID + ": test\n" or discovered_ids != [TEST_ID]:
        fail("release listing differs from the sole globally discovered test")


def read_json_file(path, limit):
    if not path.is_file() or path.is_symlink() or path.resolve() != path or path.stat().st_size > limit:
        fail("candidate content path or byte bound")
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if not 0 < len(raw) <= limit:
        fail("candidate content byte bound")
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=strict_object,
                           parse_constant=lambda token: fail("non-finite candidate JSON " + token))
    except (UnicodeError, ValueError, RecursionError) as error:
        raise RuntimeError("current cost evidence: invalid candidate content JSON") from error
    if type(value) is not dict:
        fail("candidate content root is not an object")
    return value, {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def read_content(repository):
    """Project actual V2 fields exactly as PreparedGameContentV2::prepare does.

    This binds the original bytes and named hashes outside measured intervals;
    the actual Rust preparation still owns canonical/domain validation.
    """
    repository = Path(repository).resolve()
    bundle, bundle_file = read_json_file(repository / BUNDLE, 32 << 20)
    manifest, manifest_file = read_json_file(repository / CONTENT_MANIFEST, 16 << 10)
    exact_fields(manifest, ["components", "content_hash", "counts", "oracle_sha", "schema_version",
                            "pending_bespoke_behaviors", "reachable_unsupported_behaviors",
                            "unresolved_cross_references", "v1_production_fallbacks"], "content manifest")
    integer(bundle.get("schema_version"), 2, 2, "bundle schema")
    integer(manifest["schema_version"], 2, 2, "manifest schema")
    components = ["ai", "battle", "bootstrap", "meta", "presentation", "progression", "run", "scenario", "world"]
    exact_fields(manifest["components"], components, "manifest components")
    lower_hex(manifest["components"]["meta"], 64, "meta content")
    exact_fields(manifest["counts"], ["ai_behaviors", "battle_species", "bootstrap_starters", "meta_behaviors",
                                      "presentation_mappings", "progression_species_forms", "run_programs",
                                      "scenarios", "world_biomes"], "manifest counts")
    for value in manifest["counts"].values():
        integer(value, 1, U64_MAX, "content count")
    for key in ("pending_bespoke_behaviors", "reachable_unsupported_behaviors",
                "unresolved_cross_references", "v1_production_fallbacks"):
        integer(manifest[key], 0, 0, key)
    identity = {"oracle_sha": bundle.get("oracle_sha"), "bundle_hash": bundle.get("content_hash")}
    for name in components:
        section = bundle.get("scenarios" if name == "scenario" else name)
        if type(section) is not dict or section.get("content_hash") != manifest["components"][name]:
            fail("actual content component differs from manifest: " + name)
        if name != "meta":
            identity[name + "_hash"] = section["content_hash"]
    identity["semantic_catalog_hash"] = bundle["battle"].get("semantic_catalog_hash")
    content_binding(identity)
    if identity["oracle_sha"] != manifest["oracle_sha"] or identity["bundle_hash"] != manifest["content_hash"]:
        fail("actual bundle and manifest identities differ")
    return {"bundle": bundle_file, "manifest": manifest_file, "identity": identity}


def run_bounded(command, *, cwd, environment, output, seconds, byte_limit, global_deadline=None):
    """Run one owned Linux process group with streamed output and one shared deadline.

    Cleanup time is reserved inside the requested ceiling. Failed or truncated
    logs cannot be returned as successful execution evidence. No shell is used.
    """
    started = time.monotonic()
    if (os.name != "posix" or type(command) is not list or not 1 <= len(command) <= 64
            or any(type(arg) is not str or not arg or "\0" in arg or len(arg) > 4096 for arg in command)
            or type(seconds) not in (int, float) or not 0 < seconds <= 900 or not math.isfinite(seconds)
            or type(byte_limit) is not int or not 0 < byte_limit <= 16 << 20):
        fail("bounded command arguments")
    if global_deadline is not None and (type(global_deadline) not in (int, float) or not math.isfinite(global_deadline)):
        fail("global command deadline type")
    deadline = min(started + seconds, global_deadline if global_deadline is not None else started + seconds)
    work_deadline = deadline - min(2.0, seconds / 4)
    if work_deadline <= started:
        fail("no execution/cleanup budget remains")
    output = Path(output)
    child = None
    written = 0
    selector = selectors.DefaultSelector()
    try:
        with output.open("xb") as sink:
            child = subprocess.Popen(command, cwd=cwd, env=environment, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, start_new_session=True, bufsize=0)
            selector.register(child.stdout, selectors.EVENT_READ)
            while selector.get_map() or child.poll() is None:
                remaining = work_deadline - time.monotonic()
                if remaining <= 0:
                    fail("command wall deadline expired")
                for key, _ in selector.select(min(0.1, remaining)):
                    chunk = os.read(key.fd, min(65536, byte_limit - written + 1))
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    admitted = chunk[:byte_limit - written]
                    sink.write(admitted)
                    written += len(admitted)
                    if len(admitted) != len(chunk):
                        fail("command output exceeded its byte bound")
            if child.returncode != 0:
                fail("command exited " + str(child.returncode))
    finally:
        try:
            if child is not None:
                cleanup_error = None
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                except OSError as error:
                    cleanup_error = error
                try:
                    child.wait(timeout=max(0, min(0.2, deadline - time.monotonic())))
                except subprocess.TimeoutExpired:
                    pass
                except OSError as error:
                    cleanup_error = error
                # Kill remaining descendants even if the immediate child has
                # already exited or ignored SIGTERM. Every group is owned here.
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except OSError as error:
                    cleanup_error = error
                try:
                    child.wait(timeout=max(0, deadline - time.monotonic()))
                except subprocess.TimeoutExpired as error:
                    raise RuntimeError("current cost evidence: process group cleanup exceeded deadline") from error
                if cleanup_error is not None:
                    raise RuntimeError("current cost evidence: process group cleanup failed") from cleanup_error
        finally:
            selector.close()
            if child is not None and child.stdout is not None:
                child.stdout.close()
    output_hash = file_hash(output)
    finished = time.monotonic()
    if finished > deadline:
        fail("command completed outside its total deadline")
    return {"path": output, "bytes": written, "sha256": output_hash, "elapsed_seconds": finished - started}


BUILD_SOURCE_PATHS = [SOURCE, "scripts/ci/m9e_current_cost.py", "scripts/ci/m9e_feedback.py",
                      "scripts/ci/m9e_phases.py", "scripts/ci/test_m9e_feedback.py", "scripts/ci/m9e-targets.json",
                      ".github/workflows/m9e-focused-feedback.yml", "rust/Cargo.lock", "rust/Cargo.toml",
                      "rust/rust-toolchain.toml", "rust/crates/er-repro/Cargo.toml", CONTENT_MANIFEST,
                      "rust/crates/er-game/src/m9e_content_v2.rs", "rust/crates/er-env/src/current.rs",
                      "rust/crates/er-repro/src/current.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs"]


def build_source_binding(repository, source_sha):
    """Hash actual selected source and all workspace Cargo manifests outside measurements."""
    repository = Path(repository).resolve()
    lower_hex(source_sha, 40, "build source commit")
    def checked(path):
        if (not path.is_file() or path.is_symlink() or path.resolve() != path
                or not 0 < path.stat().st_size <= 4 << 20):
            fail("build source is missing, redirected or oversized")
        return file_hash(path)
    sources = {name: checked(repository / name) for name in BUILD_SOURCE_PATHS}
    manifests = {str(path.relative_to(repository)): checked(path)
                 for path in sorted((repository / "rust/crates").glob("*/Cargo.toml"))}
    if not 1 <= len(manifests) <= 256 or "rust/crates/er-repro/Cargo.toml" not in manifests:
        fail("workspace Cargo manifest inventory")
    encoded = (json.dumps(manifests, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return {"source_sha": source_sha, "source_hashes": sources,
            "cargo_manifests": {"count": len(manifests), "sha256": hashlib.sha256(encoded).hexdigest()}}


def release_environment(repository, target_directory, inherited):
    """Allow the pinned native release build without hidden flags, profiles or wrappers.

    Environment values are never included in evidence except the fixed nonsecret
    Cargo/Rust settings returned separately. The owned target replaces any cache
    directory inherited from the ordinary test-profile build.
    """
    repository = Path(repository).resolve()
    target_directory = Path(target_directory)
    if (not target_directory.is_absolute() or target_directory.resolve() != target_directory
            or target_directory.is_symlink() or type(inherited) is not dict
            or any(type(key) is not str or type(value) is not str for key, value in inherited.items())):
        fail("release build environment or owned target type")
    forbidden = {"RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC", "RUSTDOC", "RUSTC_BOOTSTRAP", "RUSTC_WRAPPER",
                 "RUSTC_WORKSPACE_WRAPPER", "CARGO_WORKSPACE_WRAPPER", "CARGO_ENCODED_RUSTDOCFLAGS"}
    for key in inherited:
        if (key in forbidden or key.startswith(("CARGO_BUILD_", "CARGO_PROFILE_RELEASE_"))
                or (key.startswith("CARGO_TARGET_") and key != "CARGO_TARGET_DIR")):
            fail("unreviewed release compiler/profile/target override: " + key)
    settings = {"CARGO_INCREMENTAL": "0", "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_TEST_DEBUG": "0",
                "RUSTUP_TOOLCHAIN": "1.97.1"}
    if any(key in inherited and inherited[key] != value for key, value in settings.items()):
        fail("inherited compiler/profile settings differ")
    # Cargo walks ancestor directories and its home for config; record-less
    # external aliases/flags/linkers must not alter this exact artifact claim.
    directories = [repository / "rust", repository, *repository.parents]
    cargo_home = inherited.get("CARGO_HOME")
    if cargo_home:
        directories.append(Path(cargo_home).resolve().parent)
        config_paths = [Path(cargo_home).resolve() / name for name in ("config", "config.toml")]
    else:
        config_paths = [Path(inherited.get("HOME", str(Path.home()))) / ".cargo" / name
                        for name in ("config", "config.toml")]
    config_paths.extend(directory / ".cargo" / name for directory in directories for name in ("config", "config.toml"))
    if any(path.exists() or path.is_symlink() for path in config_paths):
        fail("release build has an unreviewed Cargo configuration file")
    environment = dict(inherited)
    environment.update(settings)
    environment["CARGO_TARGET_DIR"] = str(target_directory)
    return environment, {"settings": settings, "cargo_config_files": 0, "compiler_overrides": 0,
                         "target": "native-host", "features": "default", "profile": "release"}


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def execute_release(repository, temporary, diagnostics, *, identity, source_binding, discovered_ids, global_deadline):
    """Execute the sole globally discovered target once using a fresh release build.

    The caller owns ordinary inventory/count accounting. This returns only after
    exact one-test success, final executable/source/content verification and owned
    temporary target cleanup. No binary is transferred to another phase.
    """
    repository = Path(repository).resolve()
    temporary, diagnostics = Path(temporary).resolve(), Path(diagnostics).resolve()
    if (identity.get("profile") != "test" or identity.get("features") != "default"
            or identity.get("target") != "x86_64-unknown-linux-gnu"
            or discovered_ids != [TEST_ID] or type(global_deadline) not in (int, float)
            or not math.isfinite(global_deadline) or global_deadline <= time.monotonic()
            or build_source_binding(repository, identity["product_sha"]) != source_binding):
        fail("release execution candidate/global inventory binding")
    content = read_content(repository)
    logs = {}
    with tempfile.TemporaryDirectory(prefix="m9e-current-release-", dir=temporary) as owned:
        target = Path(owned).resolve() / "target"
        target.mkdir(exist_ok=False)
        environment, environment_binding = release_environment(repository, target, dict(os.environ))
        def run(command, name, seconds, limit, cwd):
            result = run_bounded(command, cwd=cwd, environment=environment,
                                 output=diagnostics / ("current-cost-" + name + ".log"),
                                 seconds=seconds, byte_limit=limit, global_deadline=global_deadline)
            logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
            return result["path"]
        build = run(["cargo", "test", "--locked", "--release", "-p", TARGET[0], "--test", TARGET[1],
                     "--no-run", "--message-format=json"], "build", 900, 16 << 20, repository / "rust")
        records = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
        executable, artifact = discover_release(records, repository=repository, target_directory=target)
        check_executable(executable, artifact)
        listing = run([str(executable), "--list", "--format", "terse"], "list", 30, 16384, repository / "rust")
        validate_listing(listing.read_bytes(), discovered_ids)
        check_executable(executable, artifact)
        output = run([str(executable), TEST_ID, "--exact", "--format", "terse", "--nocapture", "--test-threads=1"],
                     "execute", 600, 16384, repository / "rust/crates/er-repro")
        raw = output.read_bytes()
        if re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", raw) != [
                (b"1", b"0", b"0", b"0", b"0")]:
            fail("release target exact-one completion")
        lines = [line for line in raw.splitlines(keepends=True) if line.startswith(PREFIX)]
        if len(lines) != 1:
            fail("release target sole measurement record")
        parse_line(lines[0], architecture="x86_64", operating_system="linux",
                   bundle_bytes=content["bundle"]["bytes"], content_identity=content["identity"])
        check_executable(executable, artifact)
        if (read_content(repository) != content
                or build_source_binding(repository, identity["product_sha"]) != source_binding):
            fail("release execution source/content conservation")
        proof = {"schema_version": 1, "status": "passed", "execution_profile": "release",
                 "target": list(TARGET), "test_id": TEST_ID,
                 "phase_identity_sha256": hashlib.sha256(encoded(identity)).hexdigest(),
                 "source_binding_sha256": hashlib.sha256(encoded(source_binding)).hexdigest(),
                 "content": content, "artifact": artifact, "environment": environment_binding,
                 "record": {"line": lines[0].decode("utf-8"), "bytes": len(lines[0]),
                            "sha256": hashlib.sha256(lines[0]).hexdigest()},
                 "logs": logs, "tests": {"executed": 1, "passed": 1, "failed": 0, "skipped": 0}}
        if len(encoded(proof)) > 16384:
            fail("release execution proof exceeds 16 KiB")
    validate_execution(proof, repository=repository, identity=identity,
                       source_binding=source_binding, content=content)
    if time.monotonic() > global_deadline:
        fail("release evidence/cleanup completed after the native deadline")
    return output, proof

def validate_execution(proof, *, repository, identity, source_binding, content):
    """Revalidate transferred release metadata against this exact candidate.

    This does not reconstruct or execute a deleted binary. The producer owns its
    actual execution and conservation; hashed cross-phase evidence binds that
    execution to the same source, content, workflow run and native inventory.
    """
    repository = Path(repository).resolve()
    if (identity.get("profile") != "test" or identity.get("features") != "default"
            or identity.get("target") != "x86_64-unknown-linux-gnu"
            or identity.get("workflow_sha") != identity.get("product_sha")):
        fail("transferred phase profile or candidate identity")
    exact_fields(source_binding, ["source_sha", "source_hashes", "cargo_manifests"], "source binding")
    if build_source_binding(repository, identity["product_sha"]) != source_binding:
        fail("transferred build source binding differs from candidate")
    exact_fields(proof, ["schema_version", "status", "execution_profile", "target", "test_id",
                         "phase_identity_sha256", "source_binding_sha256", "content", "artifact",
                         "environment", "record", "logs", "tests"], "release proof")
    integer(proof["schema_version"], 1, 1, "release proof schema")
    if (len(encoded(proof)) > 16384 or proof["status"] != "passed" or proof["execution_profile"] != "release"
            or proof["target"] != list(TARGET) or proof["test_id"] != TEST_ID
            or proof["phase_identity_sha256"] != hashlib.sha256(encoded(identity)).hexdigest()
            or proof["source_binding_sha256"] != hashlib.sha256(encoded(source_binding)).hexdigest()):
        fail("transferred release identity or proof byte bound")
    exact_fields(content, ["bundle", "manifest", "identity"], "content binding")
    for name, limit in (("bundle", 32 << 20), ("manifest", 16 << 10)):
        exact_fields(content[name], ["bytes", "sha256"], name + " binding")
        integer(content[name]["bytes"], 1, limit, name + " bytes")
        lower_hex(content[name]["sha256"], 64, name + " digest")
    content_binding(content["identity"])
    if proof["content"] != content or read_content(repository) != content:
        fail("transferred content differs from candidate")
    artifact = proof["artifact"]
    exact_fields(artifact, ["sha256", "bytes", "relative_path", "cargo_profile", "cargo_package_id",
                            "manifest_sha256", "source_sha256"], "release artifact")
    lower_hex(artifact["sha256"], 64, "release executable digest")
    integer(artifact["bytes"], 1, 128 << 20, "release executable bytes")
    if (type(artifact["relative_path"]) is not str or re.fullmatch(
            "release/deps/" + TARGET[1] + "-[0-9a-f]{16}", artifact["relative_path"]) is None
            or artifact["manifest_sha256"] != source_binding["source_hashes"]["rust/crates/er-repro/Cargo.toml"]
            or artifact["source_sha256"] != source_binding["source_hashes"][SOURCE]):
        fail("transferred release artifact source or owned path")
    version = tomllib.loads((repository / "rust/Cargo.toml").read_text())["workspace"]["package"]["version"]
    package = (repository / "rust/crates/er-repro").as_uri()
    if artifact["cargo_package_id"] not in {"path+" + package + "#" + suffix
                                            for suffix in (version, "er-repro@" + version)}:
        fail("transferred release Cargo package")
    expected_profile = {"opt_level": "3", "debuginfo": 0, "debug_assertions": False,
                        "overflow_checks": False, "test": True}
    if encoded(artifact["cargo_profile"]) != encoded(expected_profile):
        fail("transferred release Cargo profile")
    expected_environment = {"settings": {"CARGO_INCREMENTAL": "0", "CARGO_PROFILE_DEV_DEBUG": "0",
        "CARGO_PROFILE_TEST_DEBUG": "0", "RUSTUP_TOOLCHAIN": "1.97.1"}, "cargo_config_files": 0,
        "compiler_overrides": 0, "target": "native-host", "features": "default", "profile": "release"}
    if encoded(proof["environment"]) != encoded(expected_environment):
        fail("transferred release build environment")
    if encoded(proof["tests"]) != encoded({"executed": 1, "passed": 1, "failed": 0, "skipped": 0}):
        fail("transferred release exact-one counts")
    record = proof["record"]
    exact_fields(record, ["line", "bytes", "sha256"], "release record")
    if type(record["line"]) is not str:
        fail("transferred release line type")
    raw = record["line"].encode("utf-8", errors="strict")
    integer(record["bytes"], 1, LINE_LIMIT - 1, "release record bytes")
    if record["bytes"] != len(raw) or record["sha256"] != hashlib.sha256(raw).hexdigest():
        fail("transferred release line digest or length")
    parse_line(raw, architecture="x86_64", operating_system="linux",
               bundle_bytes=content["bundle"]["bytes"], content_identity=content["identity"])
    exact_fields(proof["logs"], ["build", "list", "execute"], "release logs")
    for name, seconds, limit in (("build", 900, 16 << 20), ("list", 30, 16384), ("execute", 600, 16384)):
        log = proof["logs"][name]
        exact_fields(log, ["bytes", "sha256", "elapsed_seconds"], "release log")
        integer(log["bytes"], 1, limit, "release log bytes")
        lower_hex(log["sha256"], 64, "release log digest")
        if (type(log["elapsed_seconds"]) not in (int, float) or not math.isfinite(log["elapsed_seconds"])
                or not 0 <= log["elapsed_seconds"] <= seconds):
            fail("transferred release log execution bound")
    listing = (TEST_ID + ": test\n").encode()
    if (proof["logs"]["list"]["bytes"] != len(listing)
            or proof["logs"]["list"]["sha256"] != hashlib.sha256(listing).hexdigest()
            or proof["logs"]["execute"]["bytes"] <= len(raw)):
        fail("transferred release discovery or execution framing")

def select_scope(config, changes, repository):
    policy = config.get("current_cost_probe_focus")
    expected = {"paths": [SOURCE], "test_ids": [TEST_ID]}
    if policy is not None and policy != expected:
        fail("cost policy exact source and test identities")
    changed = SOURCE in changes
    focused = bool(policy) and changes == [SOURCE]
    if changed and not focused:
        fail("cost source change needs its isolated one-path mapping")
    if focused and not (Path(repository) / SOURCE).is_file():
        fail("required cost product is missing")
    return focused


def validate_lane(proof, repository, partition):
    """One selected cost target, one A execution, no B or out-of-scope claim."""
    plan, inventory = proof["plan"], proof["inventory"]
    required = plan.get("requires_current_cost_probe", False)
    if type(required) is not bool:
        fail("cost requirement must be boolean")
    rows = [row for row in inventory if (row["crate"], row["target"]) == TARGET]
    if rows and not required:
        fail("selected cost inventory lacks its mandatory release execution")
    if not required:
        if "current_cost_probe" in proof or plan.get("current_cost_source_binding") is not None:
            fail("cost evidence or binding outside selected scope")
        return
    if (len(rows) != 1 or rows[0]["ids"] != [TEST_ID] or rows[0]["historical_excluded_ids"]
            or plan.get("required_native_targets", {}).get(TARGET[0], []).count(TARGET[1]) != 1
            or plan.get("required_native_test_ids", {}).get(":".join(TARGET)) != [TEST_ID]
            or proof.get("required_native_target_counts", {}).get(":".join(TARGET)) != 1
            or list(TARGET) not in partition(inventory)["a"]
            or any(list(TARGET) in targets for lane, targets in partition(inventory).items() if lane != "a")):
        fail("cost global inventory, exact ID, count or A ownership")
    binding = plan.get("current_cost_source_binding")
    if build_source_binding(repository, proof["identity"]["product_sha"]) != binding:
        fail("cost selected source binding differs from candidate")
    if proof["lane"] in {"b", "c"}:
        if "current_cost_probe" in proof or list(TARGET) in proof["completed_targets"]:
            fail("non-A lane cannot claim release cost execution")
        return
    if (proof["lane"] != "a" or proof["completed_targets"].count(list(TARGET)) != 1
            or proof["assigned_targets"].count(list(TARGET)) != 1
            or "current_cost_probe" not in proof):
        fail("lane A lacks its exactly-once cost completion")
    validate_execution(proof["current_cost_probe"], repository=repository, identity=proof["identity"],
                       source_binding=binding, content=read_content(repository))


def compact(compact, full_hash, encoder):
    if "current_cost_probe" in compact and len(encoder(compact)) > 16000:
        compact["current_cost_probe"] = {"file": "phase-summary.json", "sha256": full_hash,
                                         "field": "current_cost_probe"}
