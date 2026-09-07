"""Remote owned friendship composition F; reuses qualified source observations, no runtime/profile payment claim."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-owned-friendship-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
ORACLE_DATA = FULL / "qualified-oracle"
ORACLE_RUN = 34149970288
ORACLE_SHA = "7e8e98922524b209a168bb028c7784dd7c43294f"
ORACLE_BRANCH = "codex/m9e-friendship-effects-sidecar-focused-20260907"
ORACLE_ARTIFACT = 10029032038
ORACLE_ARCHIVE_BYTES = 1777599
ORACLE_FILES = {
    "export-one.json": [21428, "8182bb42b37ade8fd26bf9885b26c08d9a5c6b8ce028b6261fa369077d3e0e00"],
    "effects-one.json": [6397, "f56af6cd8fb70f707a80d3e7e6906681965be329cd8e0ac1021e9ccdcb9dbf5a"],
}
STARTED_AT = None
DEADLINE = None
run_bounded = None
BASE_SHA = "db3cf367e1750e719fda89d82d8046c51d8c1bc2"
BASE_TREE = "97384c8109164a35d9eb0be90c0a4346b175fa00"
TARGETS = [
[
  "er-progression",
  "m9e_owned_friendship",
  "rust/crates/er-progression/tests/m9e_owned_friendship.rs",
  [
    "actual_fifteen_friendship_observations_compose_with_owned_rewards",
    "owned_friendship_frontier_and_arithmetic_failures_preserve_pending",
    "owned_friendship_tokens_reject_foreign_and_wrong_phase_without_mutation",
    "owned_reward_admission_rejects_unsupported_context_and_keys",
    "owned_reward_duplicate_settlement_and_finish_emit_no_new_effects",
    "owned_reward_projection_keeps_unrelated_accounts_and_source_argument_identity"
  ]
],
  [
    "er-progression",
    "m9e_current_friendship",
    "rust/crates/er-progression/tests/m9e_current_friendship.rs",
    [
      "binary64_fusion_and_starter_cap_order_match_source_cases",
      "boosted_caps_and_max_friendship_preserve_full_candy_progress",
      "candy_saturation_zero_rate_egg_and_negative_requests_match_source",
      "invalid_resolution_and_late_arithmetic_leave_inputs_unchanged",
      "negative_and_zero_friendship_short_circuit_without_resolution",
      "shared_fusion_progress_and_candy_roots_update_in_source_order"
    ]
  ],
  [
    "er-progression",
    "m9e_current_experience",
    "rust/crates/er-progression/tests/m9e_current_experience.rs",
    [
      "capped_addition_preserves_multi_level_gains_discards_new_excess_and_keeps_old_experience",
      "invalid_and_overflowing_experience_inputs_leave_borrowed_source_state_unchanged",
      "neutral_defeat_values_preserve_form_trainer_and_distribution_floor_order",
      "neutral_distribution_retains_full_participant_denominator_and_recipient_eligibility",
      "normal_classic_caps_cover_every_wave_and_each_decade_boundary"
    ]
  ],
  [
    "er-progression",
    "m9e_content_v2",
    "rust/crates/er-progression/tests/m9e_content_v2.rs",
    [
      "experience_classes_are_closed_and_every_metadata_field_is_hashed",
      "historical_species_bytes_and_missing_experience_remain_explicit",
      "inconsistent_experience_cohorts_and_classifications_fail_validation",
      "signed_special_learnset_levels_are_preserved",
      "source_form_lookup_distinguishes_species_row_and_first_form",
      "unknown_move_reference_fails_closed"
    ]
  ]
]
BASE_SOURCES = {
  "rust/Cargo.lock": [
    "77819112d183e14ad28244caaaadfe94956ab6b7c105a5810f0c2296346e65e9",
    32051
  ],
  "rust/Cargo.toml": [
    "fdefad8953caa82922a4f3e86560d3543f9d1ef69edada7bc1dcc16ae3a5ade9",
    1615
  ],
  "rust/crates/er-canonical/Cargo.toml": [
    "e85c5c00c5ce0d090480c453ca66ef51b7904f454e438e9444c463917af7b771",
    272
  ],
  "rust/crates/er-content/Cargo.toml": [
    "740a59247975794bd8128280bc57ff5b3077908cf77cdee68a87fd7e04d0c1bf",
    370
  ],
  "rust/crates/er-progression/Cargo.toml": [
    "4b05b5c0420d4813131ea673f25672afba4d1e13ee1cb3eec2f8ccc8e27ea0b0",
    474
  ],
  "rust/crates/er-progression/src/content_v2.rs": [
    "39d14bb3d7b4760261a6c2053be68ee987b61f3e916389bfc1cb03a066b976c9",
    17159
  ],
  "rust/crates/er-progression/src/current_experience.rs": [
    "bdde28ba1326a834765223ad9558e2f067dc550fb891aebb90870be387d4192c",
    5955
  ],
  "rust/crates/er-progression/src/current_growth_pow.rs": [
    "3bb274b506f4861a18f51a1e358e73f0cec9c30d890886ed9d9c0e8d1a042152",
    5846
  ],
  "rust/crates/er-progression/src/lib.rs": [
    "fa1e0661abd328f63a1015ccf95600c5ea9b465d05ed7680097820d984a345d9",
    11553
  ],
  "rust/crates/er-progression/src/lifecycle.rs": [
    "a43326af15e20d2ed52687b615acd267b8a55b782d6599cb88023864625150bc",
    10432
  ],
  "rust/crates/er-progression/src/material.rs": [
    "dc96199a31c7ad33790f296e63d54de78df8496465b16ee454009d9283b3647e",
    5672
  ],
  "rust/crates/er-progression/src/oracle_surface.rs": [
    "d26d21d3957b15500f91e8f86dd3e0de44cedd40e406f24c72f4e895182ce9de",
    9427
  ],
  "rust/crates/er-progression/src/progression.rs": [
    "842400cd68f24a2f431c62c64813c3600735e86dd8acdeea42dc6ba10d7baacd",
    27646
  ],
  "rust/crates/er-progression/tests/m9e_content_v2.rs": [
    "955454d2fdd8f4203defa5c48d95b1bbe3674a07dc0ef6fb386acc350890d8a5",
    12020
  ],
  "rust/crates/er-progression/tests/m9e_current_experience.rs": [
    "0c5ff471df5861b54288a71dc68b4df929f3de2479f469a64d099a6855f2a93d",
    9340
  ],
  "rust/crates/er-state/Cargo.toml": [
    "ab600653565bead557af150815f5547c31b96d570264934dc60572d4b50509a6",
    400
  ],
  "rust/crates/er-types/Cargo.toml": [
    "9fba0a9a17a94f7f9981570ee382750e6d56d727ee7a234718a636e37d36de42",
    244
  ],
  "rust/crates/er-types/src/battle_ids.rs": [
    "d68220eea5225dc89e04646aa91b7b81906a956600fd5c11eceb4df36b1fb214",
    36561
  ],
  "rust/crates/er-types/src/run_ids.rs": [
    "cff68130f8e79d059f4b788051642dc6f77679c2a224ac03102b5455595574bc",
    6123
  ],
  "rust/rust-toolchain.toml": [
    "0241de2190a0c1959d4ad182dfa6943b7ab9bd577dc8ef9b0fe7502d191835ec",
    123
  ],
  "scripts/ci/m9e_current_cost.py": [
    "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75",
    38615
  ],
  "rust/crates/er-progression/tests/fixtures/m9e_growth_oracle.json": [
    "2d667e9aabe6ca83e852db87f62cd3d9e3b733faaf269e3df8cad86741501dbe",
    10123
  ],
  "rust/crates/er-progression/src/current_friendship.rs": [
    "9acb9530ced900f5b51174054e944d02b635675f155bc5187bca7e6ddb99bd03",
    12199
  ],
  "rust/crates/er-progression/tests/m9e_current_friendship.rs": [
    "939c1eb1d0dc970ef538bca013364f3d056dcfd03b6606d4285a84abe1d4f707",
    12073
  ],
  "rust/crates/er-progression/tests/m9e_growth_levels.rs": [
    "ce3c7980860ecd52a936d1085cb66a3a01e7d615c65fe9449187542c11b33d87",
    3112
  ]
}
RUST_SOURCES = [
    "rust/crates/er-progression/src/current_friendship.rs",
    "rust/crates/er-progression/src/current_friendship_owner.rs",
    "rust/crates/er-progression/src/lib.rs",
    "rust/crates/er-progression/tests/m9e_owned_friendship.rs",
]
CI_SOURCES = ["scripts/ci/m9e_owned_friendship_diagnostic.py", ".github/workflows/m9e-owned-friendship-focused.yml"]
CHANGED_SOURCES = sorted(RUST_SOURCES + CI_SOURCES)
FIXTURE_INPUTS = {"rust/crates/er-progression/tests/fixtures/m9e_growth_oracle.json": [10123, "f2badc6371a6fe9401eac3479dc9e944147bf606", "2d667e9aabe6ca83e852db87f62cd3d9e3b733faaf269e3df8cad86741501dbe"]}
SOURCES = sorted(set(BASE_SOURCES) | set(CHANGED_SOURCES))
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0",
           "CARGO_PROFILE_TEST_OPT_LEVEL": "0", "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true",
           "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true", "CARGO_PROFILE_TEST_DEBUG": "0",
           "CARGO_PROFILE_DEV_DEBUG": "0",
           "CARGO_ENCODED_RUSTFLAGS": "-Copt-level=0\x1f-Cdebug-assertions=yes\x1f-Coverflow-checks=yes"}
sequence = 0
logs = {}
failed_log = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, name, *, cwd=None, seconds=600, bound=16 << 20, cleanup_command=False):
    global sequence, failed_log
    if not 0 < seconds <= 600 or DEADLINE is None or run_bounded is None:
        raise RuntimeError("command exceeds fixed 600-second ceiling")
    sequence += 1
    output = FULL / f"{sequence:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=ROOT / "rust" if cwd is None else cwd,
                             environment=dict(os.environ), output=output, seconds=seconds,
                             byte_limit=bound, global_deadline=DEADLINE if cleanup_command else DEADLINE - 20)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    logs[name].update(argv=args, seconds_cap=seconds, byte_cap=bound, exit_code=0)
    return output


def fetch_qualified_oracle():
    """Remote authenticated reuse only; parent bounds this child to 120 seconds."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    def bounded(response, cap):
        require(response.status == 200 and response.headers.get("Content-Encoding", "identity") == "identity",
                "unexpected authenticated response encoding/status")
        length = response.headers.get("Content-Length")
        if length is not None:
            require(length.isdecimal() and 0 < int(length) <= cap, "remote response length bound")
        data = response.read(cap + 1)
        require(0 < len(data) <= cap and (length is None or len(data) == int(length)), "remote response exact bound")
        return data

    try:
        token = os.environ.get("GH_TOKEN")
        require(type(token) is str and len(token) > 0, "authenticated artifact read required")
        opener = urllib.request.build_opener(NoRedirect())
        base = "https://api.github.com/repos/Heraklines/elite-redux"
        headers = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                   "Accept-Encoding": "identity", "User-Agent": "m9e-owned-friendship-source-proof",
                   "X-GitHub-Api-Version": "2022-11-28"}

        def api(path, cap):
            with opener.open(urllib.request.Request(base + path, headers=headers), timeout=30) as response:
                raw = bounded(response, cap)
            return json.loads(raw), {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

        service, service_fact = api(f"/actions/runs/{ORACLE_RUN}", 65536)
        for field, expected in {"id": ORACLE_RUN, "run_attempt": 1, "head_sha": ORACLE_SHA,
                "head_branch": ORACLE_BRANCH, "status": "completed", "conclusion": "success", "event": "push",
                "path": ".github/workflows/m9e-friendship-oracle-focused.yml"}.items():
            require(type(service.get(field)) is type(expected) and service[field] == expected,
                    "qualified successful source service identity differs")
        require(service.get("repository", {}).get("full_name") == "Heraklines/elite-redux", "source service repository")
        artifact, artifact_fact = api(f"/actions/artifacts/{ORACLE_ARTIFACT}", 16384)
        for field, expected in {"id": ORACLE_ARTIFACT, "size_in_bytes": ORACLE_ARCHIVE_BYTES,
                "name": "m9e-friendship-oracle-diagnostics-" + ORACLE_SHA, "expired": False}.items():
            require(type(artifact.get(field)) is type(expected) and artifact[field] == expected, "qualified artifact differs")
        require(artifact.get("workflow_run", {}).get("id") == ORACLE_RUN
                and artifact["workflow_run"].get("head_sha") == ORACLE_SHA
                and artifact["workflow_run"].get("head_branch") == ORACLE_BRANCH, "artifact/source service correlation")
        request = urllib.request.Request(base + f"/actions/artifacts/{ORACLE_ARTIFACT}/zip", headers=headers)
        try:
            with opener.open(request, timeout=30):
                raise RuntimeError("artifact redirect required")
        except urllib.error.HTTPError as response:
            try:
                require(response.code == 302, "exact authenticated artifact redirect")
                location = response.headers.get("Location", "")
            finally:
                response.close()
        parsed = urllib.parse.urlsplit(location)
        require(parsed.scheme == "https" and parsed.hostname is not None
                and parsed.hostname.endswith(".blob.core.windows.net") and parsed.port in (None, 443)
                and parsed.username is None and parsed.password is None, "owned signed artifact host")
        with opener.open(urllib.request.Request(location, headers={"Accept-Encoding": "identity"}), timeout=30) as response:
            archive_bytes = bounded(response, ORACLE_ARCHIVE_BYTES)
        require(len(archive_bytes) == ORACLE_ARCHIVE_BYTES, "actual inspected artifact size")
        require(not ORACLE_DATA.exists(), "fresh qualified input directory")
        ORACLE_DATA.mkdir()
        files = {}
        # The ZIP remains in remote memory; only these two named small members
        # are read. Never extract the diagnostic/source tree or any executable.
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            entries = archive.infolist()
            require(len(entries) <= 256, "bounded artifact directory")
            for name, (length, expected_hash) in ORACLE_FILES.items():
                selected = [entry for entry in entries if entry.filename == "generated/" + name]
                require(len(selected) == 1, "unique qualified named source observation")
                entry = selected[0]
                require(not entry.is_dir() and entry.flag_bits & 1 == 0 and entry.compress_type == zipfile.ZIP_DEFLATED
                        and entry.file_size == length and 0 < entry.compress_size <= 32768
                        and (entry.external_attr >> 16) & 0o170000 in (0, 0o100000), "bounded regular named member")
                data = archive.read(entry)
                require(len(data) == length and hashlib.sha256(data).hexdigest() == expected_hash,
                        "unchanged actual source observation bytes")
                with (ORACLE_DATA / name).open("xb") as stream:
                    stream.write(data)
                files[name] = {"bytes": length, "sha256": expected_hash, "member": entry.filename}
        receipt = {"source_run": {key: service[key] for key in ("id", "run_attempt", "head_sha", "head_branch",
                    "status", "conclusion", "event", "path")}, "source_service_response": service_fact,
                   "artifact": {key: artifact[key] for key in ("id", "name", "size_in_bytes", "expired", "workflow_run")},
                   "artifact_service_response": artifact_fact, "files": files,
                   "scope": "reuse of qualified source observations; no new TypeScript execution"}
        encoded = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()
        require(len(encoded) <= 16384, "qualified source receipt bound")
        with (FULL / "qualified-oracle.json").open("xb") as stream:
            stream.write(encoded)
    except Exception:
        # Authenticated/signed URLs and credentials must never appear in logs.
        raise RuntimeError("qualified source observation retrieval or identity validation failed") from None


def cleanup_target():
    if TARGET.is_symlink() or TARGET.resolve().parent != REPORT.resolve():
        raise RuntimeError("owned target containment differs")
    if TARGET.exists():
        shutil.rmtree(TARGET)
    if TARGET.exists():
        raise RuntimeError("owned target cleanup incomplete")


def source_conservation(summary, phase):
    if not 0 <= time.time() - STARTED_AT <= 1800:
        raise RuntimeError("pre-checkout shared deadline absent or exhausted")
    tree = run(["git", "rev-parse", BASE_SHA + "^{tree}"], "base-tree-" + phase,
               cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    if tree != BASE_TREE:
        raise RuntimeError("exact unchanged base tree required")
    changes = run(["git", "diff", "--name-status", "--no-renames", BASE_SHA, "HEAD", "--"],
                  "base-delta-" + phase, cwd=ROOT, seconds=30, bound=16384).read_text().splitlines()
    expected = sorted(("M" if name in BASE_SOURCES else "A") + "\t" + name for name in CHANGED_SOURCES)
    if sorted(changes) != expected:
        raise RuntimeError("only exact four reviewed Rust and two additive CI paths may differ from db3cf")
    status = run(["git", "status", "--porcelain", "--untracked-files=no"], "clean-" + phase,
                 cwd=ROOT, seconds=30, bound=16384).read_text()
    if status:
        raise RuntimeError("tracked candidate bytes differ from committed source")
    for name in SOURCES:
        path = ROOT / name
        if (path.is_symlink() or not path.is_file() or path.resolve() != path
                or not 0 < path.stat().st_size <= 4 << 20):
            raise RuntimeError("named small source containment/size differs")
        if name in BASE_SOURCES and name not in RUST_SOURCES:
            expected_hash, expected_bytes = BASE_SOURCES[name]
            if path.stat().st_size != expected_bytes or digest(path) != expected_hash:
                raise RuntimeError("unchanged source differs from guarded cached db3cf bytes: " + name)
    summary["base_conservation"] = {"tree": BASE_TREE, "changed_paths": CHANGED_SOURCES,
                                    "unchanged_small_sources": len(set(BASE_SOURCES) - set(RUST_SOURCES)),
                                    "phase": phase}


def fixture_inputs(phase):
    result = {}
    for index, (name, (length, expected_blob, expected_sha)) in enumerate(FIXTURE_INPUTS.items(), 1):
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != length:
            raise RuntimeError("exact unchanged historical fixture size/containment differs")
        actual_sha = digest(path)
        if expected_sha is not None and actual_sha != expected_sha:
            raise RuntimeError("known growth fixture SHA256 differs")
        tree = run(["git", "ls-tree", "-l", "HEAD", "--", name], f"fixture-{phase}-tree-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text()
        if tree.split() != ["100644", "blob", expected_blob, str(length), name]:
            raise RuntimeError("actual candidate fixture tree differs from unchanged base")
        blob = run(["git", "hash-object", "--", name], f"fixture-{phase}-blob-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text().strip()
        if blob != expected_blob:
            raise RuntimeError("actual fixture bytes differ from unchanged committed blob")
        result[name] = {"bytes": length, "sha256": actual_sha, "git_blob": blob, "base_sha": BASE_SHA}
    return result


def qualified_inputs():
    result = {}
    for name, (length, expected_hash) in ORACLE_FILES.items():
        path = ORACLE_DATA / name
        if (path.is_symlink() or not path.is_file() or path.resolve() != path
                or path.stat().st_size != length or digest(path) != expected_hash):
            raise RuntimeError("qualified original observation changed")
        result[name] = {"bytes": length, "sha256": expected_hash}
    if {path.name for path in ORACLE_DATA.iterdir()} != set(ORACLE_FILES):
        raise RuntimeError("exact two qualified input files required")
    return result


def compile_consumers(summary):
    run(["cargo", "clippy", "--locked", "-p", "er-progression", "--all-targets", "--no-deps", "--", "-D", "warnings"],
        "all-progression-targets-clippy")
    build = run(["cargo", "test", "--locked", "-p", "er-progression", "--all-targets", "--no-run", "--message-format=json"],
                "all-progression-targets-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete package consumer compilation required")
    expected = {name: source for _, name, source, _ in TARGETS}
    expected.update(er_progression="rust/crates/er-progression/src/lib.rs",
                    m9e_growth_levels="rust/crates/er-progression/tests/m9e_growth_levels.rs")
    artifacts = {}
    for artifact in rows:
        if (artifact.get("reason") != "compiler-artifact"
                or artifact.get("manifest_path") != str(ROOT / "rust/crates/er-progression/Cargo.toml")
                or artifact.get("profile", {}).get("test") is not True):
            continue
        target = artifact.get("target", {})
        name = target.get("name")
        binary = Path(artifact.get("executable") or "")
        kind = ["lib"] if name == "er_progression" else ["test"]
        if (name not in expected or name in artifacts or target.get("kind") != kind
                or target.get("src_path") != str(ROOT / expected[name]) or artifact.get("features") != []
                or artifact["profile"].get("debug_assertions") is not True
                or artifact["profile"].get("opt_level") != "0" or artifact["profile"].get("debuginfo") != 0
                or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
                or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
                or not re.fullmatch(name + "-[0-9a-f]{16}", binary.name)
                or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
            raise RuntimeError("complete package consumer artifact identity/profile differs")
        artifacts[name] = {"source": expected[name], "source_sha256": summary["source_hashes"][expected[name]],
                           "kind": kind, "profile": artifact["profile"], "bytes": binary.stat().st_size,
                           "sha256": digest(binary), "executed_by_this_step": False}
    if set(artifacts) != set(expected):
        raise RuntimeError("missing complete package compilation target")
    summary["consumer_compilation"] = {"all_targets_clippy": True, "all_targets_no_run": True,
        "artifacts": artifacts, "compile_only_targets": ["er_progression", "m9e_growth_levels"]}


def execute_target(summary, crate, test_target, test_source, test_ids):
    label = crate + "-" + test_target
    run(["cargo", "clippy", "--locked", "-p", crate, "--test", test_target,
         "--no-deps", "--", "-D", "warnings"], label + "-clippy")
    build = run(["cargo", "test", "--locked", "-p", crate, "--test", test_target,
                 "--no-run", "--message-format=json"], label + "-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact"
               and row.get("target", {}).get("name") == test_target]
    if len(matches) != 1:
        raise RuntimeError("exact friendship or compatibility test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / f"rust/crates/{crate}/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / test_source)
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
            or artifact["profile"].get("opt_level") != "0" or artifact["profile"].get("debuginfo") != 0
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
            or not re.fullmatch(test_target + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual test source/profile/artifact binding differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], label + "-list", seconds=30, bound=16384)
    if listing.read_text() != "".join(name + ": test\n" for name in test_ids):
        raise RuntimeError("exact complete sorted target test IDs required")
    receipt = {"crate": crate, "target": test_target, "sha256": binary_hash, "bytes": binary.stat().st_size,
               "profile": artifact["profile"], "source_sha256": summary["source_hashes"][test_source],
               "ids": list(test_ids), "listing_bytes": listing.stat().st_size, "listing_sha256": digest(listing)}
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], label + "-execute",
                 cwd=ROOT / f"rust/crates/{crate}", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [(str(len(test_ids)), "0", "0", "0", "0")]:
        raise RuntimeError("all actual target tests must pass without ignored or filtered cases")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    receipt["tests"] = {"executed": len(test_ids), "passed": len(test_ids), "failed": 0, "skipped": 0}
    return receipt

def main(summary):
    global STARTED_AT, DEADLINE, run_bounded
    epoch = os.environ.get("M9E_FOCUS_STARTED_AT", "")
    if not re.fullmatch(r"[0-9]{10}", epoch):
        raise RuntimeError("exact pre-checkout workflow timestamp required")
    elapsed = time.time() - int(epoch)
    if not 0 <= elapsed < 1780:
        raise RuntimeError("invalid elapsed time or checkout/setup exhausted shared budget and cleanup reserve")
    STARTED_AT = int(epoch)
    DEADLINE = time.monotonic() + 1800 - elapsed
    summary["elapsed_before_producer_seconds"] = elapsed
    helper = ROOT / "scripts/ci/m9e_current_cost.py"
    helper_hash, helper_bytes = BASE_SOURCES["scripts/ci/m9e_current_cost.py"]
    if (helper.is_symlink() or not helper.is_file() or helper.resolve() != helper
            or helper.stat().st_size != helper_bytes or digest(helper) != helper_hash
            or "m9e_current_cost" in sys.modules):
        raise RuntimeError("pinned bounded-run helper differs or is preloaded")
    import m9e_current_cost
    if Path(m9e_current_cost.__file__).resolve() != helper:
        raise RuntimeError("bounded-run helper imported from wrong path")
    run_bounded = m9e_current_cost.run_bounded
    os.environ.update(PROFILE)
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    if os.environ.get("GITHUB_REF_NAME") != "codex/m9e-owned-friendship-focused-20260907":
        raise RuntimeError("exact focused branch identity required")
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("exact Git candidate identity required")
    if run(["git", "rev-parse", "HEAD"], "identity", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate identity differs")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    source_conservation(summary, "before")
    summary["source_hashes"] = {name: digest(ROOT / name) for name in SOURCES}
    summary["source_bytes"] = {name: (ROOT / name).stat().st_size for name in SOURCES}
    summary["limits"] = {"command_seconds": 600, "shared_seconds_including_checkout": 1800,
                         "cleanup_reserve_seconds": 20,
                         "compact_bytes": 32768, "formatter_patch_bytes": 262144,
                         "command_log_bytes": 16 << 20, "test_output_bytes": 16384,
                         "test_binary_bytes": 128 << 20, "qualified_legacy_bytes": 32768,
                         "qualified_sidecar_bytes": 12288, "qualified_source_receipt_bytes": 16384}
    summary["started_at"] = STARTED_AT
    summary["compiler_configuration"] = dict(PROFILE)
    summary["fixture_inputs"] = fixture_inputs("before")
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", *[str(ROOT / name) for name in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, *[str(ROOT / name) for name in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(formatted_hashes={name: digest(ROOT / name) for name in RUST_SOURCES},
                       format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch))
        raise RuntimeError("pinned formatting changes required; no friendship qualification")
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler, re.M)
    if len(versions) != 1:
        raise RuntimeError("pinned compiler identity differs")
    summary["toolchain"] = versions[0]
    run([sys.executable, str(ROOT / "scripts/ci/m9e_owned_friendship_diagnostic.py"), "--fetch-qualified-oracle"],
        "qualified-source-observations", cwd=ROOT, seconds=120, bound=16384)
    # The authenticated token is unnecessary for compilation or test binaries.
    os.environ.pop("GH_TOKEN", None)
    receipt_path = FULL / "qualified-oracle.json"
    if (receipt_path.is_symlink() or not receipt_path.is_file() or receipt_path.resolve() != receipt_path
            or not 0 < receipt_path.stat().st_size <= 16384):
        raise RuntimeError("bounded qualified source receipt required")
    summary["qualified_oracle"] = json.loads(receipt_path.read_bytes())
    summary["qualified_inputs"] = qualified_inputs()
    for name, expected in summary["qualified_inputs"].items():
        actual = summary["qualified_oracle"].get("files", {}).get(name, {})
        if actual.get("bytes") != expected["bytes"] or actual.get("sha256") != expected["sha256"]:
            raise RuntimeError("qualified source receipt/input conservation differs")
    os.environ["M9_FRIENDSHIP_COMPARISON_INPUT"] = str(ORACLE_DATA / "export-one.json")
    os.environ["M9_FRIENDSHIP_EFFECTS_INPUT"] = str(ORACLE_DATA / "effects-one.json")
    compile_consumers(summary)
    summary["test_artifacts"] = {}
    for crate, test_target, test_source, test_ids in TARGETS:
        summary["test_artifacts"][crate + ":" + test_target] = execute_target(
            summary, crate, test_target, test_source, test_ids)
        executed = summary["test_artifacts"][crate + ":" + test_target]
        compiled = summary["consumer_compilation"]["artifacts"][test_target]
        if any(executed[key] != compiled[key] for key in ("sha256", "bytes", "profile", "source_sha256")):
            raise RuntimeError("executed whole target differs from compiled consumer cohort")
    if any(digest(ROOT / name) != expected for name, expected in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during execution")
    if fixture_inputs("after") != summary["fixture_inputs"]:
        raise RuntimeError("unchanged historical fixture inputs changed during execution")
    if qualified_inputs() != summary["qualified_inputs"]:
        raise RuntimeError("qualified actual source observations changed during native execution")
    source_conservation(summary, "after")
    ids = sorted(name for _, _, _, test_ids in TARGETS for name in test_ids)
    summary["tests"] = {"executed": len(ids), "passed": len(ids), "failed": 0, "skipped": 0, "ids": ids}


if __name__ == "__main__":
    if sys.argv[1:] == ["--fetch-qualified-oracle"]:
        fetch_qualified_oracle()
        raise SystemExit(0)
    if sys.argv[1:] == ["--cleanup"]:
        cleanup_target()
        raise SystemExit(0)
    if sys.argv[1:]:
        raise RuntimeError("unknown focused producer arguments")
    if REPORT.is_symlink() or REPORT.exists() or REPORT.resolve().parent != Path(os.environ["RUNNER_TEMP"]).resolve():
        raise RuntimeError("fresh contained focused report directory required")
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"schema_version": 1, "status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE_SHA,
               "branch": os.environ["GITHUB_REF_NAME"],
               "qualification": "23 complete native tests: six owned composition cases against qualified actual source data, six unchanged friendship cases, five unchanged XP cases, six unchanged content cases; in-memory caller-resolved scope only, no profile/runtime payment"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            if run_bounded is not None and DEADLINE is not None:
                run([sys.executable, str(ROOT / "scripts/ci/m9e_owned_friendship_diagnostic.py"), "--cleanup"],
                    "cleanup", cwd=ROOT, seconds=20, bound=16384, cleanup_command=True)
            elif TARGET.exists() or TARGET.is_symlink():
                raise RuntimeError("uninitialized bounded cleanup cannot reclaim a target")
            summary["cleanup"] = {"owned_target_removed": not TARGET.exists(), "contained": True}
            if DEADLINE is None or time.monotonic() > DEADLINE:
                raise RuntimeError("final owned cleanup exceeded pre-checkout shared deadline")
            summary["post_cleanup_deadline_checked"] = True
        except Exception as error:
            summary["status"] = "failed"
            summary["cleanup_failure"] = str(error)[:2048]
    if summary["status"] != "passed":
        message = (summary.get("failure", summary.get("cleanup_failure", "focused run failed"))
                   + "\nBounded tail; complete logs remain remote.\n").encode()[:4096]
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                allowance = 24576 - len(message)
                stream.seek(max(0, failed_log.stat().st_size - allowance))
                tail = stream.read(allowance)
        (FULL / "failure.txt").write_bytes(message + tail)
    summary["logs"] = logs
    summary["elapsed_seconds_including_checkout"] = None if STARTED_AT is None else time.time() - STARTED_AT
    encoded = (json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(encoded) > 32768:
        raise RuntimeError("focused compact result exceeds32KiB")
    (COMPACT / "summary.json").write_bytes(encoded)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
