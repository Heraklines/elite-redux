"""Remote-only actual two-bundle CurrentDispatcher artifact compatibility F."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-generated-content-compat"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
SECONDARY = ROOT / ".m9e-new-content"
BASE = "9fbb9fa2a624f8341974ce27e18260a21063751f"
BASE_TREE = "e025db5e75c65ee152821a36e31c9eb5eeb6960c"
GENERATED = "24beac2761fec35131380ba4b64fc5bd2cf4129d"
GENERATED_TREE = "1df6c9f6525f5ee8072ec5fa42b2a6de0e145bb9"
BUNDLE = "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
TEST_TARGET = "m9e_generated_content_compat"
TEST_ID = "actual_old_and_regenerated_bundles_preserve_own_artifacts_and_reject_each_other_transactionally"
RUST_SOURCES = ["rust/crates/er-cli/tests/m9e_generated_content_compat.rs",
                "rust/crates/er-cli/tests/support/m9e_generated_content_compat.rs"]
OWNED = [*RUST_SOURCES, "scripts/ci/m9e_generated_content_compat_diagnostic.py",
         ".github/workflows/m9e-generated-content-compat-focused.yml"]
HELPER = "scripts/ci/m9e_current_cost.py"
HELPER_SHA = "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75"
CONTENT = {
    "old": {"commit": BASE, "git_blob": "6b435b78bc4d62c7f492142752c91610b914a071",
            "bytes": 15810979, "sha256": "640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4",
            "bundle_hash": "blake3-v1:9de581e0d922874eaf17b8a9c355e4d154b051b34935fad60d5779c70de68429"},
    "new": {"commit": GENERATED, "git_blob": "778d0bd4f31fac16c2823ad1ad0c6a8761fede68",
            "bytes": 16325821, "sha256": "9afce9fd3bc6e05e2159f19e8578ff64fc342b8a5974bec5f15648b0799d74d2",
            "bundle_hash": "blake3-v1:dc4ab1ede5c52152e40f1dc5579d93841898126903b3047bf66b60efd7646493"},
}
# Filled from cached exact base source, never from a local generated fixture body.
BASE_SOURCES = json.loads(r'''{
  "rust/crates/er-cli/src/current_agent.rs": {
    "bytes": 34869,
    "sha256": "e82741335197df51758ae662e7e47616830b4aa1c193028595c854f828855cb5",
    "git_blob": "c9d9cb4c7f3442b79051ffc5d473873426f0cd74"
  },
  "rust/crates/er-cli/src/current_native_capture.rs": {
    "bytes": 6644,
    "sha256": "39097bd1d6a53316a47463325f9e8b8c9bf9b0c74b2454a5ff08864cdf2292e2",
    "git_blob": "fde40276c2e8acb1e7987ef73b27d25f295425db"
  },
  "rust/crates/er-cli/tests/m9e_current_native_capture.rs": {
    "bytes": 40785,
    "sha256": "d120fdb7c691afe15966c3939275d4c7c676a4a50de3ee4e66dda530fcb41978",
    "git_blob": "ad2abace3f5385d012dbad8e567af7173b74bac4"
  },
  "rust/crates/er-cli/tests/m9e_current_title_storage.rs": {
    "bytes": 11371,
    "sha256": "2eebf42e0822ec04cbabfa1e919670fd6e3a06bdb56deb1b9bfe0f756baa9c2d",
    "git_blob": "310460177ef2cff4b5e480e70009f66e98d047dc"
  },
  "rust/crates/er-env/src/current.rs": {
    "bytes": 11002,
    "sha256": "e87cbc27c981772a2bed248a50f3010d6e18212cd2248868b436efa695eb7157",
    "git_blob": "f266f270e09f77335a8861b883ec25545a5fee7a"
  },
  "rust/crates/er-kernel/src/game_kernel_v7.rs": {
    "bytes": 153862,
    "sha256": "f3251fb4de9c24af5482d607af3acb8abfc9cd3249abfc12f4433555dcdca7b5",
    "git_blob": "9062117b742b808f90b9d50489416f69bbcb6899"
  },
  "rust/crates/er-kernel/src/snapshot_v7.rs": {
    "bytes": 22224,
    "sha256": "e247dbf85f7d473f9d02d54b08f0b86d5630aa37bfd39e5645ef7b3366449e7a",
    "git_blob": "111828dd17d8f6f01f4e84f7e31dc88cff0fdf6a"
  },
  "rust/crates/er-game/src/m9e_material_v6.rs": {
    "bytes": 23149,
    "sha256": "0506f2c4d093036aef38ebcac5a0c5c05818e8c78202bccfe7a921afa853b467",
    "git_blob": "e3070c4020f65f0453bdb21f663ffbafe1d1496f"
  },
  "rust/crates/er-game/src/m9e_runtime_v6.rs": {
    "bytes": 110747,
    "sha256": "51792a4093785dd24be3981867af1b3adbbe6c3d736d9c6dc2dedafce24d9fbc",
    "git_blob": "aa29a748ae0339fcdbdc3dddac1093833f60af90"
  },
  "rust/crates/er-repro/src/current.rs": {
    "bytes": 32339,
    "sha256": "7d8858250ec492c612a9ab5272c48208ba08de7ed39bb332526dd3cf252b63b8",
    "git_blob": "0e65276810fc7aa70ed829a1f83c889edd0d1c7d"
  },
  "rust/crates/er-save/src/m9e_save_v2.rs": {
    "bytes": 8769,
    "sha256": "dc73d9e8c3cdf7abef5177e4d69cc44f8fadf627e89a1ca596ba9d57803176fc",
    "git_blob": "3b383fce0483af4937991ecca2c4930912888ce0"
  },
  "rust/crates/er-types/src/input.rs": {
    "bytes": 12113,
    "sha256": "b1d2b866775d4c24995d70076c0af5b29d80ceaeb68174e86695aa357d459fae",
    "git_blob": "42526ba51055a73a398eed7d3ecb988ad80618e8"
  },
  "rust/crates/er-state/src/m7_state.rs": {
    "bytes": 33079,
    "sha256": "e70ee657a8c0d7ce9a4086502713aa8950cfa6d4f05038dd30e3cdd4a98973a3",
    "git_blob": "3c8588845b05bb8ed0300b3ad510010cfffe553c"
  },
  "rust/crates/er-battle/src/m7_resolver.rs": {
    "bytes": 39213,
    "sha256": "24b14f90108a242ad6cf74dd5e54c2118ef9f1e9e812f501192fd488ef93b346",
    "git_blob": "994c1f8fb95b7664ecb36d2676336cd5197fd1ff"
  },
  "rust/crates/er-cli/Cargo.toml": {
    "bytes": 800,
    "sha256": "99a8a3e5ed468a3d8c234ef24347df0cf75c267f1635dd1e94475751b38888bc",
    "git_blob": "e8e7f3463837b33adda2093e661fb1974e13e8da"
  },
  "rust/crates/er-cli/src/current_commands.rs": {
    "bytes": 9748,
    "sha256": "b55422878ef013515e76ee54f5434d17ff8bf86edf4f493f5f509c4e4767c5d7",
    "git_blob": "1c9b0e06dd13a2b82ff6a544243c2c2760b4c2b2"
  },
  "rust/crates/er-cli/src/main.rs": {
    "bytes": 18744,
    "sha256": "b2aea1a208d77f40159dbb191e71f45f67dafc63ac314b95730baf6e515d415c",
    "git_blob": "19e64739049adc7954e2c1d28ca22c961f75d817"
  },
  "scripts/ci/m9e_current_cost.py": {
    "bytes": 38615,
    "sha256": "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75",
    "git_blob": "d927584098acd3d90c4b44a082f791f2ae9fb6bc"
  },
  "rust/Cargo.toml": {
    "bytes": 1615,
    "sha256": "fdefad8953caa82922a4f3e86560d3543f9d1ef69edada7bc1dcc16ae3a5ade9",
    "git_blob": "20ef8325c203f9c0aee25d2195326a7a1ae4b204"
  },
  "rust/Cargo.lock": {
    "bytes": 32051,
    "sha256": "77819112d183e14ad28244caaaadfe94956ab6b7c105a5810f0c2296346e65e9",
    "git_blob": "7171e9c1194d3a4f56c7f14a8b496a5a2490f1cd"
  },
  "rust/rust-toolchain.toml": {
    "bytes": 123,
    "sha256": "0241de2190a0c1959d4ad182dfa6943b7ab9bd577dc8ef9b0fe7502d191835ec",
    "git_blob": "1f2833c1b283c80c229edc7591fd65f12b18c2b4"
  },
  "rust/crates/er-env/Cargo.toml": {
    "bytes": 444,
    "sha256": "19d78de60a3d7a25fa3e81d181cf4d67424fc30e6426f975e846264a0aeda4c9",
    "git_blob": "9801120a432b58f76017a77162729a885b504ea2"
  },
  "rust/crates/er-kernel/Cargo.toml": {
    "bytes": 706,
    "sha256": "2b244502f54359df2852f5f05051a149154629a131f7b862c33a72c12f5aaabd",
    "git_blob": "486e742eb6872943d484add226e0c2250411af51"
  },
  "rust/crates/er-game/Cargo.toml": {
    "bytes": 691,
    "sha256": "b70213bb098d0723abe81d944583620938f607237800354f66f401b058e99fb4",
    "git_blob": "5517944bd4496893b525ec752119414b03811a61"
  },
  "rust/crates/er-repro/Cargo.toml": {
    "bytes": 632,
    "sha256": "8381b2451236e0ffbaa465b23cc74f5160d8c669b82c6b4354cc7d7e2b0c3824",
    "git_blob": "8d4042a84271232a19b69eab4bd9640a59f9c901"
  },
  "rust/crates/er-save/Cargo.toml": {
    "bytes": 381,
    "sha256": "ab96feeb7b63dbe2165c57191f6dd90ffe80855b03f5efb8420434e5aacd0228",
    "git_blob": "5cb8f5df57c11fc64a08a3d75fc320f6b26beee1"
  },
  "rust/crates/er-progression/src/content_v2.rs": {
    "bytes": 17159,
    "sha256": "39d14bb3d7b4760261a6c2053be68ee987b61f3e916389bfc1cb03a066b976c9",
    "git_blob": "bbb2f3f2d487ca583aa8ca57d0bb38291e160924"
  },
  "rust/crates/er-progression/src/current_experience.rs": {
    "bytes": 5955,
    "sha256": "bdde28ba1326a834765223ad9558e2f067dc550fb891aebb90870be387d4192c",
    "git_blob": "f9be041d6bbf29db4fc7ffb75097e6f3a5fbe958"
  },
  "rust/crates/er-progression/src/progression.rs": {
    "bytes": 27646,
    "sha256": "842400cd68f24a2f431c62c64813c3600735e86dd8acdeea42dc6ba10d7baacd",
    "git_blob": "9270d182679d0d77a6840f6f762d07f18da7225f"
  },
  "rust/crates/er-progression/src/current_growth_pow.rs": {
    "bytes": 5846,
    "sha256": "3bb274b506f4861a18f51a1e358e73f0cec9c30d890886ed9d9c0e8d1a042152",
    "git_blob": "227c9cfa5e2330dfd0fb6e70000f209b7fc4bf19"
  },
  "rust/crates/er-cli/src/current_batch_agent.rs": {
    "bytes": 13855,
    "sha256": "cef00b2ae1f4c77fe18eb998d8f4870f1e43e0d341d86dacea47f4af7b6ba1ac",
    "git_blob": "ea497e6f6de1a1882a08d20f91565d8ae4fd8ef4"
  },
  "rust/crates/er-batch/src/current.rs": {
    "bytes": 15466,
    "sha256": "4da1902a513dd2d5f78f159266a4e067152a5b6ec0bf3f02a7de7b97a3d46491",
    "git_blob": "7ebb3ad584322bd8e0249bc3bcae0da262e5d4cc"
  },
  "rust/crates/er-batch/Cargo.toml": {
    "bytes": 526,
    "sha256": "b30c4189c81fc515421a2fa4c5050a3f5161cfad0fad3206a9d104ce9b725ab8",
    "git_blob": "33928c7d99cc9ab37800e6acc500625f45526c58"
  },
  "rust/crates/er-lab/src/navigation.rs": {
    "bytes": 4488,
    "sha256": "2856784f27409644913eb345c39cf1a6974940917a36afa28f2d9aa7c8d31e14",
    "git_blob": "4fbc177f57f7a873d9324a6f425eb063e94bdb01"
  },
  "rust/crates/er-game/src/m72_bootstrap.rs": {
    "bytes": 30759,
    "sha256": "54369e34edc90a194f425e677a21e3ba7ce64dff46a4af9b688e4821a511dccc",
    "git_blob": "f4529edb7902e6d46eda38eaa0609b9f100352b9"
  }
}''')
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0", "CARGO_TERM_COLOR": "never",
           "CARGO_PROFILE_TEST_OPT_LEVEL": "0", "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true",
           "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true", "CARGO_PROFILE_TEST_DEBUG": "0",
           "CARGO_PROFILE_DEV_DEBUG": "0",
           "CARGO_ENCODED_RUSTFLAGS": "-Copt-level=0\x1f-Cdebug-assertions=yes\x1f-Coverflow-checks=yes"}
os.environ.update(PROFILE)
os.environ["CARGO_TARGET_DIR"] = str(TARGET)
LOGS = {}
FAILED_LOG = None
DEADLINE = None
run_bounded = None


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def git_blob(path):
    value = hashlib.sha1(b"blob " + str(path.stat().st_size).encode() + b"\0")
    with path.open("rb") as stream:
        while block := stream.read(65536):
            value.update(block)
    return value.hexdigest()


def regular(path, owner, maximum):
    require(path.is_absolute() and not path.is_symlink() and path.is_file()
            and path.resolve() == path and path.is_relative_to(owner.resolve())
            and 0 < path.stat().st_size <= maximum, "owned regular file/size differs: " + str(path))


def run(args, name, *, cwd=None, seconds=600, bound=16 << 20):
    global FAILED_LOG
    require(name not in LOGS, "duplicate command name")
    path = FULL / f"{len(LOGS) + 1:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=ROOT / "rust" if cwd is None else cwd,
                             environment=dict(os.environ), output=path, seconds=seconds,
                             byte_limit=bound, global_deadline=DEADLINE - 20)
    except Exception:
        FAILED_LOG = path
        LOGS[name] = {"status": "failed", "path": path.name,
                      "bytes": path.stat().st_size if path.is_file() else 0,
                      "sha256": digest(path) if path.is_file() else None}
        raise
    LOGS[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    LOGS[name].update(status="passed", path=path.name)
    return path


def metadata(args, name, cwd=ROOT):
    return run(["git", *args], name, cwd=cwd, seconds=30, bound=4 << 20).read_bytes()


def parse_tree(raw):
    leaves = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        header, path = record.split(b"\t", 1)
        mode, kind, oid = header.decode("ascii").split(" ")
        name = path.decode("utf-8")
        require(name not in leaves and not name.startswith("/") and ".." not in name.split("/")
                and mode in ("100644", "100755", "120000", "160000")
                and kind == ("commit" if mode == "160000" else "blob")
                and re.fullmatch("[0-9a-f]{40}", oid), "Git source inventory entry differs")
        leaves[name] = (mode, oid)
    require(bool(leaves), "empty Git inventory")
    return leaves


def tree_oid(leaves):
    directories = {"": {}}
    for path, entry in leaves.items():
        parts = path.split("/")
        parent = ""
        for part in parts[:-1]:
            child = parent + "/" + part if parent else part
            directories.setdefault(parent, {})[part] = ("40000", child)
            directories.setdefault(child, {})
            parent = child
        require(parts[-1] not in directories[parent], "tree entry collision")
        directories[parent][parts[-1]] = entry
    def encode(directory):
        rows = directories[directory]
        payload = bytearray()
        for name in sorted(rows, key=lambda item: item.encode() + (b"/" if rows[item][0] == "40000" else b"")):
            mode, value = rows[name]
            oid = encode(value) if mode == "40000" else value
            payload.extend(mode.encode() + b" " + name.encode() + b"\0" + bytes.fromhex(oid))
        return hashlib.sha1(b"tree " + str(len(payload)).encode() + b"\0" + payload).hexdigest()
    return encode("")


def bind_sources(summary):
    sha = os.environ["GITHUB_SHA"]
    require(re.fullmatch("[0-9a-f]{40}", sha), "candidate SHA")
    require(metadata(["rev-parse", "HEAD"], "head").decode().strip() == sha, "candidate HEAD differs")
    tree = metadata(["rev-parse", "HEAD^{tree}"], "head-tree").decode().strip()
    inventory = metadata(["ls-tree", "-rz", "HEAD"], "source-inventory")
    leaves = parse_tree(inventory)
    require(tree_oid(leaves) == tree, "independent current Git tree reconstruction differs")
    require(all(leaves.get(path, (None,))[0] == "100644" for path in OWNED), "four exact regular added sources required")
    require(tree_oid({path: value for path, value in leaves.items() if path not in OWNED}) == BASE_TREE,
            "candidate differs from base outside exact four added source files")
    summary.update(source_tree=tree, base_tree=BASE_TREE, candidate_added_paths=OWNED,
                   source_inventory={"bytes": len(inventory), "sha256": hashlib.sha256(inventory).hexdigest(),
                                     "entries": len(leaves)})
    summary["source_hashes"] = {}
    for path in [*BASE_SOURCES, *OWNED]:
        file = ROOT / path
        regular(file, ROOT, 4 << 20)
        record = {"sha256": digest(file), "git_blob": git_blob(file), "bytes": file.stat().st_size}
        require(leaves.get(path) == ("100644", record["git_blob"]), "source bytes differ from candidate Git blob: " + path)
        if path in BASE_SOURCES:
            require(record == BASE_SOURCES[path], "fixed base prerequisite differs: " + path)
        summary["source_hashes"][path] = record
    return leaves


def bind_bundles(summary, leaves):
    require(SECONDARY.resolve() == SECONDARY and SECONDARY.parent == ROOT and not SECONDARY.is_symlink(), "secondary checkout containment")
    require(metadata(["rev-parse", "HEAD"], "generated-head", SECONDARY).decode().strip() == GENERATED,
            "generated secondary HEAD differs")
    require(metadata(["rev-parse", "HEAD^{tree}"], "generated-tree", SECONDARY).decode().strip() == GENERATED_TREE,
            "audited generated tree differs")
    new_leaves = parse_tree(metadata(["ls-tree", "-rz", "HEAD", "--", BUNDLE], "generated-path", SECONDARY))
    require(set(new_leaves) == {BUNDLE}, "exact generated bundle tree path")
    summary["bundles"] = {}
    for label, owner in [("old", ROOT), ("new", SECONDARY)]:
        path = owner / BUNDLE
        expected = CONTENT[label]
        regular(path, owner, expected["bytes"])
        require(path.stat().st_size == expected["bytes"] and digest(path) == expected["sha256"]
                and git_blob(path) == expected["git_blob"], "actual " + label + " bundle bytes/hash differ")
        require((leaves if label == "old" else new_leaves).get(BUNDLE) == ("100644", expected["git_blob"]),
                "bundle tree/OID binding differs")
        summary["bundles"][label] = {**expected, "path": BUNDLE, "verified_absolute_path": str(path)}
        os.environ["ER_M9E_COMPAT_" + label.upper() + "_BUNDLE"] = str(path)


def format_sources(summary):
    args = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*args, "--check", *[str(ROOT / path) for path in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*args, *[str(ROOT / path) for path in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        changed = metadata(["diff", "--name-only", "-z"], "format-changed-paths").decode().strip("\0").split("\0")
        require(bool(changed) and set(changed) <= set(RUST_SOURCES), "formatter changed unowned paths")
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        require(0 < patch.stat().st_size <= 262144, "bounded nonempty formatting patch required")
        shutil.copyfile(patch, FULL / "format.patch")
        summary["format_patch"] = {"bytes": patch.stat().st_size, "sha256": digest(patch), "paths": changed,
                                   "formatted_hashes": {path: digest(ROOT / path) for path in RUST_SOURCES}}
        raise RuntimeError("exact two-path remote formatting patch required; no runtime qualification")


def artifact_record(row, *, test):
    name = TEST_TARGET if test else "er-cli"
    source = RUST_SOURCES[0] if test else "rust/crates/er-cli/src/main.rs"
    target = row.get("target", {})
    profile = row.get("profile", {})
    executable = Path(row.get("executable") or "")
    require(row.get("manifest_path") == str(ROOT / "rust/crates/er-cli/Cargo.toml")
            and row.get("features") == [] and target.get("name") == name
            and target.get("kind") == (["test"] if test else ["bin"])
            and target.get("src_path") == str(ROOT / source)
            and profile.get("test") is test and profile.get("debug_assertions") is True
            and profile.get("opt_level") == "0", "Cargo source/package/profile differs")
    regular(executable, TARGET, 128 << 20)
    require(os.access(executable, os.X_OK), "artifact is not executable")
    if test:
        require(executable.parent == TARGET / "debug/deps" and re.fullmatch(TEST_TARGET + "-[0-9a-f]{16}", executable.name),
                "test executable path differs")
    else:
        require(executable == TARGET / "debug/er-cli", "actual Cargo CLI executable path differs")
    return {"path": str(executable), "bytes": executable.stat().st_size, "sha256": digest(executable),
            "package_id": row["package_id"], "target": target, "profile": profile}


def validate_evidence(path):
    regular(path, REPORT, 16 << 10)
    def unique(pairs):
        result = {}
        for name, value in pairs:
            require(name not in result, "duplicate evidence key")
            result[name] = value
        return result
    evidence = json.loads(path.read_bytes(), object_pairs_hook=unique)
    expected_keys = {"schema_version", "scope", "old", "new", "directions", "producer_concurrency", "same_content_snapshot_restore_and_replay_continued",
                     "foreign_checkpoint_and_capsule_rejected", "foreign_save_read_preserved_pending_request", "save_source"}
    require(set(evidence) == expected_keys and type(evidence["schema_version"]) is int and evidence["schema_version"] == 1
            and type(evidence["directions"]) is int and evidence["directions"] == 2
            and type(evidence["producer_concurrency"]) is int and evidence["producer_concurrency"] == 2
            and evidence["scope"] == "ACTUAL_NATIVE_CURRENT_DISPATCHER_TWO_BUNDLE_COMPATIBILITY"
            and evidence["save_source"] == "GameSaveV2::new of exact public Active checkpoint; no natural Save-menu claim",
            "test evidence header differs")
    for name in ["same_content_snapshot_restore_and_replay_continued", "foreign_checkpoint_and_capsule_rejected",
                 "foreign_save_read_preserved_pending_request"]:
        require(evidence[name] is True, "test evidence completion differs")
    numbers = {"snapshot_bytes": 4 << 20, "save_bytes": 4 << 20, "capsule_bytes": 2 << 20,
               "base_position": 9007199254740991, "final_position": 9007199254740991,
               "attempts": 256, "resolved_turns": 1, "presentation_acknowledgments": 1024,
               "turn_before": 9007199254740991, "turn_after": 9007199254740991}
    hashes = {"snapshot_digest", "action_snapshot_digest", "capsule_digest", "save_digest"}
    for label in ("old", "new"):
        item = evidence[label]
        require(set(item) == {*numbers, *hashes, "bundle_hash", "selected_move_option", "bootstrap"}, "exact artifact evidence fields required")
        require(item["bundle_hash"] == CONTENT[label]["bundle_hash"], "real content identity differs")
        for name, maximum in numbers.items():
            require(type(item[name]) is int and 0 <= item[name] <= maximum, "bounded integer evidence differs: " + name)
        require(all(item[name] > 0 for name in numbers if name not in ("base_position", "turn_before"))
                and item["resolved_turns"] == 1 and item["turn_after"] == item["turn_before"] + 1
                and item["final_position"] - item["base_position"] == item["attempts"], "actual turn/capsule evidence differs")
        require(type(item["selected_move_option"]) is str and re.fullmatch(r"battle/move/(?:[0-3]|struggle)", item["selected_move_option"]),
                "public legal move option differs")
        require(all(type(item[name]) is str and re.fullmatch("blake3-v1:[0-9a-f]{64}", item[name]) for name in hashes),
                "canonical evidence digest differs")
        bootstrap = item["bootstrap"]
        require(type(bootstrap) is dict and set(bootstrap) == {"scope", "environment", "event_count", "result_count",
                "maximum_events_per_call", "event_stream_digest", "snapshot_digest", "selected_starter_ids"},
                "exact public batch bootstrap evidence required")
        require(bootstrap["scope"] == "ACTUAL_CLI_BATCH_NATURAL_RAW"
                and type(bootstrap["environment"]) is int and bootstrap["environment"] == 1
                and type(bootstrap["maximum_events_per_call"]) is int and bootstrap["maximum_events_per_call"] == 2,
                "single-environment bounded raw batch differs")
        require(type(bootstrap["event_count"]) is int and 24 <= bootstrap["event_count"] <= 16384
                and bootstrap["event_count"] % 2 == 0 and type(bootstrap["result_count"]) is int
                and bootstrap["result_count"] == bootstrap["event_count"] and item["base_position"] == 0,
                "actual ordered raw events or fresh capture frontier differs")
        require(all(type(bootstrap[name]) is str and re.fullmatch("blake3-v1:[0-9a-f]{64}", bootstrap[name])
                for name in ("event_stream_digest", "snapshot_digest")), "bootstrap source digest differs")
        starters = bootstrap["selected_starter_ids"]
        require(type(starters) is list and len(starters) == 6
                and all(type(value) is int and 1 <= value <= 9007199254740991 for value in starters)
                and starters == sorted(set(starters)), "actual selected starter identities differ")
    require(evidence["old"]["snapshot_digest"] != evidence["new"]["snapshot_digest"], "two actual snapshots must differ")
    require(evidence["old"]["bootstrap"]["event_stream_digest"] == evidence["new"]["bootstrap"]["event_stream_digest"]
            and evidence["old"]["bootstrap"]["event_count"] == evidence["new"]["bootstrap"]["event_count"]
            and evidence["old"]["bootstrap"]["selected_starter_ids"] == evidence["new"]["bootstrap"]["selected_starter_ids"]
            and evidence["old"]["bootstrap"]["snapshot_digest"] != evidence["new"]["bootstrap"]["snapshot_digest"],
            "both content cohorts must execute the identical real natural raw journey")
    return {"bytes": path.stat().st_size, "sha256": digest(path), "facts": evidence}


def execute(summary):
    run(["cargo", "clippy", "--locked", "-p", "er-cli", "--bin", "er-cli", "--test", TEST_TARGET,
         "--no-deps", "--", "-D", "warnings"], "clippy")
    build = run(["cargo", "test", "--locked", "-p", "er-cli", "--test", TEST_TARGET,
                 "--no-run", "--message-format=json"], "build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "actual successful Cargo stream required")
    summary["artifacts"] = {}
    for label, name in [("test", TEST_TARGET), ("cli", "er-cli")]:
        candidates = [row for row in rows if row.get("reason") == "compiler-artifact"
                      and row.get("target", {}).get("name") == name and row.get("executable")]
        require(len(candidates) == 1, "one actual " + label + " executable artifact required")
        summary["artifacts"][label] = artifact_record(candidates[0], test=label == "test")
    binary = summary["artifacts"]["test"]["path"]
    os.environ["ER_M9E_COMPAT_CLI"] = summary["artifacts"]["cli"]["path"]
    evidence = REPORT / "test-evidence.json"
    os.environ["ER_M9E_COMPAT_EVIDENCE"] = str(evidence)
    listing = run([binary, "--list", "--format", "terse"], "list", seconds=30, bound=16384)
    require(listing.read_text() == TEST_ID + ": test\n", "exact one-test inventory differs")
    result = run([binary, "--format", "terse", "--nocapture", "--test-threads=1"], "execute",
                 cwd=ROOT / "rust/crates/er-cli", bound=256 << 10)
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", result.read_text())
    require(counts == [("1", "0", "0", "0", "0")], "whole actual one-test target must pass unfiltered")
    summary["test_evidence"] = validate_evidence(evidence)
    summary["tests"] = {"executed": 1, "passed": 1, "failed": 0, "ignored": 0, "filtered": 0, "ids": [TEST_ID]}
    for artifact in summary["artifacts"].values():
        require(digest(Path(artifact["path"])) == artifact["sha256"], "executed artifact changed")


def cleanup(summary):
    removed = {}
    for path, owner in [(TARGET, REPORT), (SECONDARY, ROOT)]:
        require(not path.is_symlink() and path.resolve() == path and path.parent == owner.resolve(), "cleanup owned containment differs")
        if path.exists():
            shutil.rmtree(path)
        require(not path.exists(), "owned cleanup incomplete")
        removed[path.name] = True
    summary["cleanup"] = {"removed": removed, "completed": True}


def main(summary):
    global DEADLINE, run_bounded
    started = os.environ["M9E_COMPAT_STARTED_AT"]
    require(re.fullmatch("[0-9]{10}", started), "workflow shared start timestamp required")
    elapsed = time.time() - int(started)
    require(0 <= elapsed < 1780, "checkout/setup exhausted shared 1800 second budget")
    DEADLINE = time.monotonic() + 1800 - elapsed
    summary["elapsed_before_producer_seconds"] = elapsed
    regular(ROOT / HELPER, ROOT, 256 << 10)
    require(digest(ROOT / HELPER) == HELPER_SHA and "m9e_current_cost" not in sys.modules, "verified helper differs or was preloaded")
    import m9e_current_cost
    require(Path(m9e_current_cost.__file__).resolve() == ROOT / HELPER, "imported helper path differs")
    run_bounded = m9e_current_cost.run_bounded
    leaves = bind_sources(summary)
    bind_bundles(summary, leaves)
    summary["compiler_configuration"] = PROFILE
    format_sources(summary)
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text().strip()
    require(re.fullmatch(r"rustc 1\.97\.1 \([^\n]+\)", compiler), "pinned compiler differs")
    summary["toolchain"] = compiler
    execute(summary)
    for path, expected in summary["source_hashes"].items():
        require(digest(ROOT / path) == expected["sha256"], "source changed during actual execution")
    for label, owner in [("old", ROOT), ("new", SECONDARY)]:
        require(digest(owner / BUNDLE) == CONTENT[label]["sha256"], "runtime bundle changed")


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE,
               "qualification": "actual native CurrentDispatcher one battle turn per real bundle; own checkpoint/save/replay continuation and transactional cross-content rejection; no Worker/browser/full campaign claim"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            cleanup(summary)
            require(DEADLINE is not None and time.monotonic() <= DEADLINE, "post-cleanup shared deadline exceeded")
            summary["post_cleanup_deadline_checked"] = True
        except Exception as error:
            summary["status"] = "failed"
            summary["cleanup_failure"] = str(error)[:2048]
    if summary["status"] != "passed":
        message = (summary.get("failure", summary.get("cleanup_failure", "failed")) + "\nBounded tail; full logs stay remote.\n").encode()[:4096]
        tail = b""
        if FAILED_LOG is not None and FAILED_LOG.is_file():
            with FAILED_LOG.open("rb") as stream:
                allowance = 262144 - len(message)
                stream.seek(max(0, FAILED_LOG.stat().st_size - allowance))
                tail = stream.read(allowance)
        (FULL / "failure.txt").write_bytes(message + tail)
    summary["logs"] = LOGS
    encoded = (json.dumps(summary, sort_keys=True, indent=2) + "\n").encode()
    require(len(encoded) <= 32768, "compact proof exceeds32KiB")
    (COMPACT / "summary.json").write_bytes(encoded)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
