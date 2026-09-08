"""Exact published XP and drain composition; original XP provenance retained. File bodies are hashed only on the runner."""
import hashlib
import json
from pathlib import Path

FILES = {"rust/fixtures/m9/engineering/complete-progression-definitions-v1.json":{"bytes":3724089,"git_blob":"9d8a49da2746c5e5cf3b3eeddafdf67d7d23c7aa","sha256":"bba00376cae18feae56bebe38c5be0f1bb3aae3fd9a6e99e3ec7fa60a15de08f"},"rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json":{"bytes":1219,"git_blob":"326d6ec54f75cf008a73ef84e616c792b819858e","sha256":"5e7b15370e91e99beb816148471453fb318d1387ce23866a055e3e297d8908a9"},"rust/fixtures/m9/engineering/game-content-bundle-v2.json":{"bytes":16340147,"git_blob":"6bd2537b440de33974642c4565e0d275ef3b3624","sha256":"f11ed4151b9157f1f7f296c6b2801ffaed02a3c43b6a31816e5145a478175913"},"rust/fixtures/m9/engineering/progression-content-pack-v2.json":{"bytes":3576205,"git_blob":"e9c7ed41d2fa5be32d279a8cd9524a720e5f1665","sha256":"1864120e3130162bdd11c9370ae436140b0896a062fa10da9100445776bad17b"},"rust/fixtures/m9/engineering/progression-oracle-report-v2.json":{"bytes":510,"git_blob":"96ecd22adee9d85269d7f5cfe57927fd539aaa12","sha256":"64b4b759c46a897720230ffa0c87d73158d6ff69c2e18f4bdfb2d9c64408bec7"},"rust/fixtures/m9/engineering/battle-content-pack-v3.json":{"bytes":8098725,"git_blob":"31754b90593cfafda833cdc093e3bac52c467680","sha256":"0d64674d1c25de70a17d15a4ccb1c8062c5b75a069dcede8b0e6b3a6b808f6d8"},"rust/fixtures/m9/engineering/run-content-pack-v3.json":{"bytes":1845,"git_blob":"bf487e1941035eeafad762f6419021a8e38866bc","sha256":"be4291d3f6dacb63706080ad531f7c83b07ea14ba4edd7e73d69faa2f8a3a2e7"}}
PATHS = list(FILES)
POLICY_KEY = "current_generated_xp_fixtures"
SOURCE = "scripts/ci/m9e_generated_xp.py"
SELFTESTS = "scripts/ci/test_m9e_generated_xp.py"
POLICY = {"export_source":"339af2ce53399d1f5e3aec6ff045c71292946293","prior_publication":{"export_run":"34125184738","publication_commit":"24beac2761fec35131380ba4b64fc5bd2cf4129d","export_source":"d0a2e37059e65c4cd7fa8743ce6cb9e3dfec2caa","publication_tree":"1df6c9f6525f5ee8072ec5fa42b2a6de0e145bb9"},"schema_version":2,"files":{"rust/fixtures/m9/engineering/complete-progression-definitions-v1.json":{"bytes":3724089,"git_blob":"9d8a49da2746c5e5cf3b3eeddafdf67d7d23c7aa","sha256":"bba00376cae18feae56bebe38c5be0f1bb3aae3fd9a6e99e3ec7fa60a15de08f"},"rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json":{"bytes":1219,"git_blob":"326d6ec54f75cf008a73ef84e616c792b819858e","sha256":"5e7b15370e91e99beb816148471453fb318d1387ce23866a055e3e297d8908a9"},"rust/fixtures/m9/engineering/game-content-bundle-v2.json":{"bytes":16340147,"git_blob":"6bd2537b440de33974642c4565e0d275ef3b3624","sha256":"f11ed4151b9157f1f7f296c6b2801ffaed02a3c43b6a31816e5145a478175913"},"rust/fixtures/m9/engineering/progression-content-pack-v2.json":{"bytes":3576205,"git_blob":"e9c7ed41d2fa5be32d279a8cd9524a720e5f1665","sha256":"1864120e3130162bdd11c9370ae436140b0896a062fa10da9100445776bad17b"},"rust/fixtures/m9/engineering/progression-oracle-report-v2.json":{"bytes":510,"git_blob":"96ecd22adee9d85269d7f5cfe57927fd539aaa12","sha256":"64b4b759c46a897720230ffa0c87d73158d6ff69c2e18f4bdfb2d9c64408bec7"},"rust/fixtures/m9/engineering/battle-content-pack-v3.json":{"bytes":8098725,"git_blob":"31754b90593cfafda833cdc093e3bac52c467680","sha256":"0d64674d1c25de70a17d15a4ccb1c8062c5b75a069dcede8b0e6b3a6b808f6d8"},"rust/fixtures/m9/engineering/run-content-pack-v3.json":{"bytes":1845,"git_blob":"bf487e1941035eeafad762f6419021a8e38866bc","sha256":"be4291d3f6dacb63706080ad531f7c83b07ea14ba4edd7e73d69faa2f8a3a2e7"}},"export_run":"34279828626","publication_tree":"6c71c8c3f0580bdadfdc1240769654b96cfe2ad7","publication_commit":"b4862e9db04455732673bf3e75478f2ef9f63e75"}
PACK_IDS = {
    "er-content-compiler:m9e_bundle": [
        "direct_bundle_is_byte_stable_and_prepares_without_v1_domains"],
    "er-content-compiler:m9e_full_content": [
        "complete_bootstrap_catalog_cross_references_full_battle_and_world",
        "complete_pinned_definitions_build_one_prepared_battle_pack",
        "complete_pinned_world_preserves_pool_dimensions"],
}
BUNDLE = "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
MANIFEST = "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json"


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def exact(value, expected, message):
    if type(value) is not dict or encoded(value) != encoded(expected):
        raise RuntimeError(message)


def enabled(config):
    value = config.get(POLICY_KEY)
    if value is None:
        return False
    exact(value, POLICY, "generated XP fixture policy identities disagree")
    return True


def expected_binding():
    # The source-bound policy retains every per-file identity; the phase receipt
    # names that exact cohort after bind has checked all seven actual byte streams.
    cohort = {**POLICY, "files": FILES}
    return {"schema_version": 1, "cohort_sha256": hashlib.sha256(encoded(cohort)).hexdigest(),
            "verified_files": len(FILES), "verification": "git-tree-and-streamed-bytes"}


def validate_binding(value):
    exact(value, expected_binding(), "generated XP fixture receipt identities disagree")
    if len(encoded(value)) > 192:
        raise RuntimeError("generated XP fixture receipt exceeds 192 bytes")


def bind(root, capture):
    """Bound exact candidate Git entries and streamed bytes; no fixture JSON parsing."""
    root = Path(root).resolve()
    tree = capture(["git", "ls-tree", "-r", "HEAD", "--", *PATHS], root)
    if not isinstance(tree, str) or len(tree.encode()) > 4096:
        raise RuntimeError("generated XP candidate tree metadata exceeds bound")
    observed = {}
    for line in tree.splitlines():
        pieces = line.split("\t")
        if len(pieces) != 2:
            raise RuntimeError("generated XP candidate tree fields disagree")
        head, path = pieces
        fields = head.split(" ")
        if (len(fields) != 3 or fields[:2] != ["100644", "blob"]
                or path not in FILES or path in observed or fields[2] != FILES[path]["git_blob"]):
            raise RuntimeError("generated XP candidate tree identity differs")
        observed[path] = fields[2]
    if set(observed) != set(FILES):
        raise RuntimeError("generated XP candidate tree omits a fixture")
    for relative, expected in FILES.items():
        path = root / relative
        if (path.is_symlink() or not path.is_file() or path.resolve() != path
                or path.stat().st_size != expected["bytes"]):
            raise RuntimeError("generated XP fixture path or byte count differs")
        count = 0
        sha256 = hashlib.sha256()
        blob = hashlib.sha1(f"blob {expected['bytes']}\0".encode())
        with path.open("rb") as stream:
            while block := stream.read(65536):
                count += len(block)
                if count > expected["bytes"]:
                    raise RuntimeError("generated XP fixture grew during hashing")
                sha256.update(block)
                blob.update(block)
        if (count != expected["bytes"] or sha256.hexdigest() != expected["sha256"]
                or blob.hexdigest() != expected["git_blob"]):
            raise RuntimeError("generated XP actual fixture bytes differ")
    value = expected_binding()
    validate_binding(value)
    return value


def identity_fields(root, capture):
    config_path = Path(root) / "scripts/ci/m9e-targets.json"
    config = json.loads(config_path.read_bytes())
    return {"generated_fixture_inputs": bind(root, capture)} if enabled(config) else {}


def apply_plan(config, plan, root, capture, merge):
    if not enabled(config):
        return
    plan["requires_generated_xp_fixtures"] = True
    plan["generated_fixture_inputs"] = bind(root, capture)
    plan["packages"] = sorted(set(plan["packages"]) | {"er-content-compiler"})
    for key, ids in PACK_IDS.items():
        crate, target = key.split(":")
        plan["required_native_targets"] = merge(plan["required_native_targets"], {crate: [target]})
        plan["required_native_test_ids"] = {**plan["required_native_test_ids"], key: list(ids)}
        if plan["execution_scope"] is not None:
            plan["execution_scope"] = merge(plan["execution_scope"], {crate: [target]})


def validate_native(plan, identity, inventory):
    required = plan.get("requires_generated_xp_fixtures", False)
    present = "generated_fixture_inputs" in identity
    if type(required) is not bool or required != present:
        raise RuntimeError("generated XP native obligation or phase identity absent")
    if not required:
        if "generated_fixture_inputs" in plan:
            raise RuntimeError("generated XP receipt without obligation")
        return
    validate_binding(plan.get("generated_fixture_inputs"))
    validate_binding(identity.get("generated_fixture_inputs"))
    if identity.get("files", {}).get("content") != FILES[MANIFEST]["sha256"]:
        raise RuntimeError("generated XP manifest phase identity differs")
    for key, ids in PACK_IDS.items():
        rows = [row for row in inventory if row["crate"] + ":" + row["target"] == key]
        crate, target = key.split(":")
        if (len(rows) != 1 or rows[0]["ids"] != ids or rows[0]["historical_excluded_ids"]
                or plan.get("required_native_test_ids", {}).get(key) != ids
                or plan.get("required_native_targets", {}).get(crate, []).count(target) != 1):
            raise RuntimeError("generated XP complete compiler witness omitted")


def validate_platform(proof, native):
    if not native["plan"].get("requires_generated_xp_fixtures"):
        return
    validate_binding(proof.get("identity", {}).get("generated_fixture_inputs"))
    if (proof.get("browser_assets", {}).get("assets", {}).get("game-content-bundle-v2.json", {}).get("sha256")
            != FILES[BUNDLE]["sha256"]):
        raise RuntimeError("generated XP platform uses a foreign content cohort")


def verify_completion(root, capture, identity):
    fields = identity_fields(root, capture)
    expected = {"generated_fixture_inputs": identity["generated_fixture_inputs"]} if "generated_fixture_inputs" in identity else {}
    if fields != expected:
        raise RuntimeError("generated XP fixture changed across phase execution")