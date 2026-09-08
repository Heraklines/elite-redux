"""Remote-only publication of four audited generated files to one new source branch."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-recoil-content-publication"
COMPACT = REPORT / "compact"
REPO = "Heraklines/elite-redux"
API = "https://api.github.com/repos/" + REPO
QUALIFIED = "339af2ce53399d1f5e3aec6ff045c71292946293"
QUALIFIED_TREE = "38e1cbdde7013d4ecb90145cc7df74637158f82e"
ORACLE = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
EXPORT_RUN = 34279828626
SUMMARY_ID = 10077245237
DIAGNOSTICS_ID = 10077246070
SUMMARY_SHA256 = "eb971f630ec0fc3f621f84f8b06e17c3bda30128a68426ce04bc4f5c752d5316"
SOURCE_BRANCH = "codex/m9e-recoil-content-publication-focused-20260908"
DESTINATION = "codex/m9e-recoil-regenerated-content-20260908"
PUBLISHER = "scripts/ci/m9e_recoil_content_publication.py"
WORKFLOW = ".github/workflows/m9e-recoil-content-publication-focused.yml"
RUNNER_HELPER = "scripts/ci/m9e_current_cost.py"
HELPER_SHA256 = "5a25e98778cc7103375a5342600c4bc6e5a22252935f435f847e6434f00e7cd8"
PREFIX = "rust/fixtures/m9/engineering/"
FILES = json.loads(r'''{"battle-content-pack-v3.json":["battle-content-pack-v3.json",8098725,"0d64674d1c25de70a17d15a4ccb1c8062c5b75a069dcede8b0e6b3a6b808f6d8","31754b90593cfafda833cdc093e3bac52c467680"],"game-content-bundle-v2-manifest.json":["game-content-bundle-v2-manifest.json",1219,"5e7b15370e91e99beb816148471453fb318d1387ce23866a055e3e297d8908a9","326d6ec54f75cf008a73ef84e616c792b819858e"],"game-content-bundle-v2.json":["game-content-bundle-v2.json",16340147,"f11ed4151b9157f1f7f296c6b2801ffaed02a3c43b6a31816e5145a478175913","6bd2537b440de33974642c4565e0d275ef3b3624"],"run-content-pack-v3.json":["run-content-pack-v3.json",1845,"be4291d3f6dacb63706080ad531f7c83b07ea14ba4edd7e73d69faa2f8a3a2e7","bf487e1941035eeafad762f6419021a8e38866bc"]}''')
PRODUCTS = json.loads(r'''{"rust/crates/er-battle/src/m6/routine_executor.rs":"9e260b9d1f31ad33fc2fea7ef4a9fd118fa89b25","rust/crates/er-battle/src/m7_resolver.rs":"4c077c39bfeaceab28a41eb158d96584c9cecd8a","rust/crates/er-content-compiler/src/lib.rs":"21da7a6ad18c61eb6cede46636dcd97b5584f748","rust/crates/er-content-compiler/src/m9e_full_content.rs":"5e6802b8cab93b88dceb29751a64785620c1000f","rust/crates/er-content-compiler/src/m9e_move_drains.rs":"e0697d2d5e7b623f6aad758bc9f4a9407c3286b7","rust/crates/er-content-compiler/src/m9e_move_recoil.rs":"8e4da23a818382c53d70893f91d444ec21ae6ff2","rust/crates/er-game/tests/m9e_move_recoil.rs":"35c84d6e0d5798879de271d17824a4dd32ea8fdf"}''')
DEADLINE = time.monotonic() + 870
stage = "initialization"
calls = []


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def blob(data):
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def fact(data):
    return {"bytes": len(data), "sha256": sha256(data), "git_blob": blob(data)}


def write_json(path, value, bound=32768):
    data = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(data) <= bound, "compact receipt exceeds bound")
    with path.open("xb") as stream:
        stream.write(data)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(path, label, *, body=None, allow_missing=False, archive=False):
    """API token is sent only to the fixed API origin, never to an artifact redirect."""
    global stage
    stage = label
    started = time.monotonic()
    require(started < DEADLINE, "publication deadline exhausted")
    require(path.startswith("/") and ".." not in path and len(path) <= 1024, "fixed API path required")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
               "User-Agent": "m9e-drain-source-publication", "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]}
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    require(payload is None or len(payload) <= 24 << 20, "bounded Git data request required")
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=payload, headers=headers, method="GET" if body is None else "POST")
    opener = urllib.request.build_opener(NoRedirect)
    try:
        response = opener.open(req, timeout=min(30, max(1, DEADLINE - time.monotonic())))
    except urllib.error.HTTPError as error:
        if error.code == 404 and allow_missing:
            calls.append({"label": label, "method": "GET", "status": 404, "bytes": 0})
            return None
        if archive and error.code in (301, 302, 303, 307, 308):
            location = error.headers.get("Location", "")
            parsed = urllib.parse.urlsplit(location)
            require(len(location) <= 8192 and parsed.scheme == "https" and parsed.username is None
                    and parsed.password is None and parsed.port in (None, 443)
                    and parsed.hostname is not None and (parsed.hostname.endswith(".blob.core.windows.net")
                        or parsed.hostname.endswith(".actions.githubusercontent.com")), "artifact redirect origin rejected")
            # The signed URL is held only in memory. Never record it or forward Authorization.
            req = urllib.request.Request(location, headers={"User-Agent": "m9e-drain-source-publication"})
            try:
                response = opener.open(req, timeout=min(30, max(1, DEADLINE - time.monotonic())))
            except Exception:
                raise RuntimeError("bounded artifact download failed: " + label) from None
        else:
            raise RuntimeError("GitHub API rejected " + label + " with HTTP " + str(error.code)) from None
    except Exception:
        raise RuntimeError("bounded API request failed: " + label) from None
    limit = (6 << 20) if archive else (16 << 20)
    data = bytearray()
    with response:
        require(response.status in (200, 201), "unexpected successful API status: " + label)
        while True:
            require(time.monotonic() < min(DEADLINE, started + 120), "API/download response deadline: " + label)
            chunk = response.read(min(65536, limit - len(data) + 1))
            if not chunk:
                break
            data.extend(chunk)
            require(len(data) <= limit, "API/download response bound: " + label)
    require(time.monotonic() < min(DEADLINE, started + 120), "API/download completion deadline: " + label)
    calls.append({"label": label, "method": "GET" if body is None else "POST", "status": response.status,
                  "bytes": len(data), "sha256": sha256(data)})
    if archive:
        return bytes(data)
    try:
        return json.loads(data)
    except Exception:
        raise RuntimeError("invalid bounded API JSON: " + label) from None


def tree(commit, label):
    info = request("/git/commits/" + commit, label + "-commit")
    require(info.get("sha") == commit and re.fullmatch(r"[0-9a-f]{40}", info.get("tree", {}).get("sha", "")),
            "exact source commit/tree required")
    tree_sha = info["tree"]["sha"]
    response = request("/git/trees/" + tree_sha + "?recursive=1", label + "-tree")
    require(response.get("sha") == tree_sha and response.get("truncated") is False
            and type(response.get("tree")) is list and 1 <= len(response["tree"]) <= 50000, "complete bounded Git tree required")
    entries = {}
    for row in response["tree"]:
        path = row.get("path", "")
        require(type(path) is str and len(path) <= 4096 and 1 <= len(path.split("/")) <= 32
                and str(PurePosixPath(path)) == path and not path.startswith("/")
                and all(part not in ("", ".", "..") for part in path.split("/")) and path not in entries,
                "canonical unique Git tree path required")
        mode, kind, oid = row.get("mode"), row.get("type"), row.get("sha")
        require((mode, kind) in (("040000", "tree"), ("100644", "blob"), ("100755", "blob"),
                                 ("120000", "blob"), ("160000", "commit"))
                and type(oid) is str and re.fullmatch(r"[0-9a-f]{40}", oid), "Git tree entry mode/type/hash")
        entries[path] = {"mode": mode, "type": kind, "sha": oid}
    require(compute_tree(entries) == tree_sha, "Git tree canonical object hash differs")
    return info, entries


def compute_tree(entries):
    """Recompute Git's documented tree object format with hashlib SHA-1, preserving empty trees."""
    children = {"": {}}
    for path, row in entries.items():
        parent, _, name = path.rpartition("/")
        children.setdefault(parent, {})[name] = dict(row)
        if row["type"] == "tree":
            children.setdefault(path, {})
    for parent in children:
        require(not parent or parent in entries and entries[parent]["type"] == "tree", "orphan Git tree entry")
    result = None
    for path in sorted(children, key=lambda value: (value.count("/") + bool(value), value), reverse=True):
        rows = children[path]
        ordered = sorted(rows, key=lambda name: (name + ("/" if rows[name]["type"] == "tree" else "")).encode())
        raw = b"".join(rows[name]["mode"].lstrip("0").encode() + b" " + name.encode() + b"\0"
                       + bytes.fromhex(rows[name]["sha"]) for name in ordered)
        oid = hashlib.sha1(f"tree {len(raw)}\0".encode() + raw).hexdigest()
        if path:
            parent, _, name = path.rpartition("/")
            children[parent][name]["sha"] = oid
        else:
            result = oid
    return result


def leaves(entries):
    return {path: row for path, row in entries.items() if row["type"] != "tree"}


def read_checkout(path, expected_blob, bound=32 << 20):
    absolute = ROOT / path
    require(absolute.is_file() and not absolute.is_symlink() and absolute.resolve() == absolute
            and 0 < absolute.stat().st_size <= bound, "exact checkout file required: " + path)
    data = absolute.read_bytes()
    require(blob(data) == expected_blob, "checkout source differs from candidate tree: " + path)
    return data


def artifact(artifact_id, expected_name, expected_size, label):
    row = request("/actions/artifacts/" + str(artifact_id), label + "-metadata")
    require(type(row.get("id")) is int and row["id"] == artifact_id and row.get("name") == expected_name
            and row.get("expired") is False and type(row.get("size_in_bytes")) is int
            and row["size_in_bytes"] == expected_size and row.get("workflow_run", {}).get("id") == EXPORT_RUN
            and row["workflow_run"].get("head_sha") == QUALIFIED, "exact immutable artifact metadata required")
    digest = row.get("digest")
    require(type(digest) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", digest), "artifact service SHA256 required")
    raw = request("/actions/artifacts/" + str(artifact_id) + "/zip", label + "-download", archive=True)
    require(len(raw) == expected_size and "sha256:" + sha256(raw) == digest, "actual ZIP size/digest differs")
    return raw, {"id": artifact_id, "name": expected_name, "run_id": EXPORT_RUN, "source_sha": QUALIFIED,
                  "bytes": len(raw), "sha256": sha256(raw)}


def checked_zip(raw, expected, limit):
    archive = zipfile.ZipFile(io.BytesIO(raw))
    infos = archive.infolist()
    require(len(infos) <= len(expected) + 1, "archive entry count exceeds allowlist")
    seen = set()
    size = 0
    for info in infos:
        name = info.filename
        require(name not in seen, "duplicate archive member")
        seen.add(name)
        require(not info.flag_bits & 1 and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                "encrypted or unsupported archive member")
        mode = info.external_attr >> 16
        require(not stat.S_ISLNK(mode), "archive symlink rejected")
        if info.is_dir():
            require(name == "generated/" and info.file_size == 0, "unexpected archive directory")
            continue
        require(name in expected and 0 <= info.file_size <= expected[name], "archive path/size allowlist differs")
        size += info.file_size
        require(size <= limit, "archive uncompressed total exceeds bound")
    require(seen - {"generated/"} == set(expected), "complete exact archive file inventory required")
    return archive


def validate_payloads(summary, archive, candidate, receipt):
    payloads = {}
    for name, (destination, length, digest, oid) in FILES.items():
        raw = archive.read(name)
        require(fact(raw) == {"bytes": length, "sha256": digest, "git_blob": oid}, "exact independently audited export bytes")
        require(fact(raw) == summary["serialized_exports"]["files"][name], "actual qualification export binding")
        payloads[PREFIX + destination] = raw
    def old(name):
        return json.loads(read_checkout(PREFIX + name, candidate[PREFIX + name]["sha"]))
    def new(name):
        return json.loads(payloads[PREFIX + name])
    battle, old_battle = new("battle-content-pack-v3.json"), old("battle-content-pack-v3.json")
    bundle, old_bundle = new("game-content-bundle-v2.json"), old("game-content-bundle-v2.json")
    run, old_run = new("run-content-pack-v3.json"), old("run-content-pack-v3.json")
    manifest, old_manifest = new("game-content-bundle-v2-manifest.json"), old("game-content-bundle-v2-manifest.json")
    require(old_bundle["battle"] == old_battle and old_bundle["run"] == old_run and bundle["battle"] == battle and bundle["run"] == run, "complete bundle components match")
    require(len(old_battle["programs"]) == 3691 and len(battle["programs"]) == 3697 and battle["programs"][:3691] == old_battle["programs"], "every original program preserved")
    expected_ids = {36,66,457,528,543,617}
    require(len(battle["moves"]) == len(old_battle["moves"]), "move inventory unchanged")
    changed_moves = set()
    for index, (before, after) in enumerate(zip(old_battle["moves"], battle["moves"])):
        if before == after:
            continue
        require(index in expected_ids and isinstance(before, dict) and isinstance(after, dict), "only six ordinary moves change")
        programs = after["mechanic_programs"]
        require(len(programs) == len(before["mechanic_programs"]) + 1 and programs[:-1] == before["mechanic_programs"], "one appended recoil binding per move")
        restored = dict(after)
        restored["mechanic_programs"] = before["mechanic_programs"]
        require(restored == before, "every other move field unchanged")
        changed_moves.add(index)
    require(changed_moves == expected_ids, "exact six moves")
    classes, prior_classes = battle["classifications"], old_battle["classifications"]
    require(len(classes) == len(prior_classes) == 9411, "complete classification inventory")
    admitted_units = []
    for before, after in zip(prior_classes, classes):
        if before == after:
            continue
        require(before["kind"] == "BESPOKE" and after["kind"] == "COMPILED" and before["behavior_unit"] == after["behavior_unit"], "only source-identical bespoke to compiled transitions")
        admitted_units.append(before["behavior_unit"])
    require(len(admitted_units) == 6, "exact six source unit transitions")
    canonical = lambda value: json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    require(len(set(map(canonical, admitted_units))) == 6, "unique admitted source units")
    expected_bespoke = json.loads(json.dumps(old_battle["bespoke"]))
    removed = []
    for entry in expected_bespoke["entries"]:
        removed.extend(unit for unit in entry["behavior_units"] if unit in admitted_units)
        entry["behavior_units"] = [unit for unit in entry["behavior_units"] if unit not in admitted_units]
    expected_bespoke["entries"] = [entry for entry in expected_bespoke["entries"] if entry["behavior_units"]]
    require(len(removed) == 6 and sorted(map(canonical, removed)) == sorted(map(canonical, admitted_units)) and battle["bespoke"] == expected_bespoke, "exact six source units removed; other bespoke dispatch conserved")
    restored = dict(battle)
    for key in ("content_hash", "programs", "moves", "classifications", "bespoke"):
        restored[key] = old_battle[key]
    require(restored == old_battle, "all other battle material conserved")
    expected_run = dict(old_run)
    expected_run.update(battle_content_hash=battle["content_hash"], content_hash=run["content_hash"])
    require(run == expected_run, "run changes only derived identity")
    expected_bundle = dict(old_bundle)
    expected_bundle.update(battle=battle, run=run, content_hash=bundle["content_hash"])
    require(bundle == expected_bundle, "every other complete bundle component conserved")
    expected_manifest = json.loads(json.dumps(old_manifest))
    expected_manifest["content_hash"] = bundle["content_hash"]
    expected_manifest["components"].update(battle=battle["content_hash"], run=run["content_hash"])
    require(manifest == expected_manifest, "exact three manifest identity changes")
    identity = summary["serialized_exports"]["identity"]
    require(identity == {"bundle_hash":bundle["content_hash"], "battle_hash":battle["content_hash"], "run_hash":run["content_hash"], "progression_hash":bundle["progression"]["content_hash"]}, "all qualified content identities")
    receipt["validated_content"] = {"moves":sorted(expected_ids), "programs_before":3691, "programs_after":3697, "classifications":9411,
        "admitted_units":admitted_units, "other_data_conserved":True, "identity":identity,
        "qualification":"six ordinary exact-fraction recoils only; no full M9 claim"}
    return payloads

def existing_ref(parent, expected_tree, label):
    row = request("/git/ref/heads/" + DESTINATION, label, allow_missing=True)
    if row is None:
        return None
    require(row.get("ref") == "refs/heads/" + DESTINATION and row.get("object", {}).get("type") == "commit",
            "existing destination ref type differs")
    commit = request("/git/commits/" + row["object"]["sha"], label + "-commit")
    require(commit.get("sha") == row["object"]["sha"] and commit.get("tree", {}).get("sha") == expected_tree
            and [item.get("sha") for item in commit.get("parents", [])] == [parent],
            "existing destination branch has a different parent/tree; no update authorized")
    return commit["sha"]


def publish(receipt):
    parent = os.environ["GITHUB_SHA"]
    require(os.environ.get("GITHUB_REPOSITORY") == REPO and os.environ.get("GITHUB_REF") == "refs/heads/" + SOURCE_BRANCH
            and re.fullmatch(r"[0-9a-f]{40}", parent) and os.environ.get("GITHUB_TOKEN"), "exact publisher source context required")
    receipt.update(source_sha=parent, source_branch=SOURCE_BRANCH, destination_branch=DESTINATION,
                   run_id=os.environ.get("GITHUB_RUN_ID"), run_attempt=os.environ.get("GITHUB_RUN_ATTEMPT"))
    require(all(re.fullmatch(r"[1-9][0-9]{0,19}", receipt[key] or "") for key in ("run_id", "run_attempt")), "publisher run identity")
    info, candidate = tree(parent, "publisher")
    require([row.get("sha") for row in info.get("parents", [])] == [QUALIFIED], "publisher parent must be exact qualified export source")
    base_info, base = tree(QUALIFIED, "qualified")
    require(base_info["tree"]["sha"] == QUALIFIED_TREE, "qualified source tree changed")
    current_leaves, old_leaves = leaves(candidate), leaves(base)
    changes = {path for path in current_leaves.keys() | old_leaves.keys() if current_leaves.get(path) != old_leaves.get(path)}
    require(changes == {PUBLISHER, WORKFLOW} and all(path not in old_leaves for path in changes),
            "publisher candidate differs beyond its two added source files")
    expected_candidate = {path: dict(row) for path, row in base.items()}
    for path in changes:
        expected_candidate[path] = dict(candidate[path])
    require(compute_tree(expected_candidate) == info["tree"]["sha"],
            "publisher candidate has additional tree/directory changes")
    receipt["publisher_sources"] = {}
    for path in (PUBLISHER, WORKFLOW, RUNNER_HELPER):
        require(candidate[path]["mode"] == "100644", "publisher source mode differs")
        receipt["publisher_sources"][path] = fact(read_checkout(path, candidate[path]["sha"], 262144))
    require(receipt["publisher_sources"][RUNNER_HELPER]["sha256"] == HELPER_SHA256, "bounded runner helper changed")
    receipt["qualified_products"] = {}
    for path, oid in PRODUCTS.items():
        require(candidate[path] == {"mode": "100644", "type": "blob", "sha": oid}, "qualified product tree changed")
        receipt["qualified_products"][path] = fact(read_checkout(path, oid, 262144))
    run = request("/actions/runs/" + str(EXPORT_RUN), "qualified-export-run")
    require(type(run.get("id")) is int and run["id"] == EXPORT_RUN and run.get("head_sha") == QUALIFIED and run.get("status") == "completed"
            and run.get("conclusion") == "success" and type(run.get("run_attempt")) is int and run["run_attempt"] == 1
            and run.get("head_branch") == "codex/m9e-recoil-bundle-focused-20260908"
            and run.get("path") == ".github/workflows/m9e-recoil-bundle-focused.yml", "qualified completed export workflow differs")
    summary_raw, summary_artifact = artifact(SUMMARY_ID, "m9e-recoil-bundle-summary-" + QUALIFIED, 6694, "summary")
    with checked_zip(summary_raw, {"summary.json": 65536}, 65536) as archive:
        raw = archive.read("summary.json")
    require(len(raw) == 27107 and sha256(raw) == SUMMARY_SHA256, "exact locally audited compact summary bytes required")
    summary = json.loads(raw)
    require(summary.get("source_sha") == QUALIFIED and summary.get("run_id") == str(EXPORT_RUN)
            and summary.get("run_attempt") == "1" and summary.get("status") == "passed"
            and summary.get("tests_executed") == 5 and summary["full_bundle_execution"]["tests"] == 5 and summary["full_bundle_execution"]["battle_pack_override"] is False
            and summary["cleanup"]["success"] is True and summary["cleanup"]["target_removed"] is True
            and summary["elapsed_seconds"] < 1800, "audited export identity/cleanup differs")
    receipt["export_evidence"] = {"run_id": EXPORT_RUN, "source_sha": QUALIFIED, "source_tree": QUALIFIED_TREE,
                                  "summary_sha256": SUMMARY_SHA256, "summary_artifact": summary_artifact}
    raw, diagnostics_artifact = artifact(DIAGNOSTICS_ID, "m9e-recoil-bundle-diagnostics-" + QUALIFIED, 102297, "diagnostics")
    expected = {row["name"] + ".log": row["log_bytes"] for row in summary["commands"]}
    require(len(expected) == 47, "all actual qualification commands")
    with checked_zip(raw, expected, 16 << 20) as archive:
        for row in summary["commands"]:
            actual = archive.read(row["name"] + ".log")
            require(len(actual) == row["log_bytes"] and sha256(actual) == row["log_sha256"], "every actual qualified command log")
    receipt["export_evidence"]["diagnostics_artifact"] = diagnostics_artifact
    raw, exports_artifact = artifact(10077247166, "m9e-recoil-bundle-exports-" + QUALIFIED, 3122126, "exports")
    with checked_zip(raw, {name: values[1] for name, values in FILES.items()}, 32 << 20) as archive:
        payloads = validate_payloads(summary, archive, candidate, receipt)
    receipt["export_evidence"]["exports_artifact"] = exports_artifact
    receipt["files"] = {path: fact(data) for path, data in payloads.items()}
    updated = {path: dict(row) for path, row in candidate.items()}
    for path, data in payloads.items():
        require(path in updated and updated[path]["type"] == "blob" and updated[path]["mode"] == "100644",
                "only existing four regular fixture paths may change")
        updated[path]["sha"] = blob(data)
    expected_tree = compute_tree(updated)
    require(expected_tree != info["tree"]["sha"], "generated tree must change")
    receipt.update(parent=parent, parent_tree=info["tree"]["sha"], expected_tree=expected_tree, all_inputs_validated=True)
    # No Git object/ref write occurs above this point.
    existing = existing_ref(parent, expected_tree, "destination-preflight")
    if existing is not None:
        receipt.update(status="already-published", commit=existing, tree=expected_tree, ref_created=False)
        return
    for index, (path, data) in enumerate(payloads.items(), 1):
        result = request("/git/blobs", "create-blob-" + str(index),
                         body={"content": base64.b64encode(data).decode(), "encoding": "base64"})
        require(result.get("sha") == blob(data), "created Git blob differs from validated payload")
    result = request("/git/trees", "create-tree", body={"base_tree": info["tree"]["sha"], "tree": [
        {"path": path, "mode": "100644", "type": "blob", "sha": blob(data)} for path, data in payloads.items()]})
    require(result.get("sha") == expected_tree, "created Git tree differs from prevalidated complete tree")
    result = request("/git/commits", "create-commit", body={"message": "Publish audited source-generated ordinary recoil bundle",
                     "tree": expected_tree, "parents": [parent]})
    commit = result.get("sha")
    require(type(commit) is str and re.fullmatch(r"[0-9a-f]{40}", commit) and result.get("tree", {}).get("sha") == expected_tree
            and [row.get("sha") for row in result.get("parents", [])] == [parent], "created commit parent/tree differs")
    receipt.update(commit=commit, tree=expected_tree)
    # Recheck races. An existing different branch is never updated, even after Git objects were created.
    existing = existing_ref(parent, expected_tree, "destination-before-create")
    if existing is not None:
        receipt.update(status="already-published", commit=existing, ref_created=False)
        return
    confirmed_create = False
    try:
        result = request("/git/refs", "create-destination-ref", body={"ref": "refs/heads/" + DESTINATION, "sha": commit})
        require(result.get("ref") == "refs/heads/" + DESTINATION and result.get("object", {}).get("sha") == commit,
                "created destination ref differs")
        confirmed_create = True
    except Exception:
        # Resolve a lost create response or simultaneous exact publication; never retry a ref write or PATCH.
        existing = existing_ref(parent, expected_tree, "destination-after-uncertain-create")
        require(existing is not None, "destination creation failed or remains uncertain; no force update attempted")
        receipt.update(commit=existing, ref_create_response_uncertain=True)
    require(existing_ref(parent, expected_tree, "destination-final") == receipt["commit"], "final exact branch readback differs")
    receipt.update(status="published", ref_created=True if confirmed_create else None)


def child():
    receipt = {"schema_version": 1, "status": "failed", "scope": "four verified generated source files on one new named branch; no main update or deploy"}
    error = None
    try:
        publish(receipt)
        require(time.monotonic() < DEADLINE, "publication completion deadline exceeded")
    except Exception as caught:
        error = caught
        # Never include raw HTTP exceptions, response bodies, Authorization or signed URLs.
        receipt.update(status="failed", failure={"stage": stage, "reason": str(caught)[:1024] if isinstance(caught, RuntimeError)
                                                 else "bounded publication validation failed"})
    receipt["api_calls"] = calls
    write_json(COMPACT / "receipt.json", receipt)
    if error is not None:
        raise SystemExit(1)


def entry():
    require(not REPORT.exists() and REPORT.resolve().parent == Path(os.environ["RUNNER_TEMP"]).resolve(), "fresh owned publication output required")
    COMPACT.mkdir(parents=True)
    output = REPORT / "bounded-process.log"
    try:
        run_bounded([sys.executable, str(ROOT / PUBLISHER), "--publish"], cwd=ROOT, environment=dict(os.environ),
                    output=output, seconds=900, byte_limit=262144, global_deadline=time.monotonic() + 900)
    except Exception:
        if not (COMPACT / "receipt.json").exists():
            write_json(COMPACT / "receipt.json", {"schema_version": 1, "status": "failed",
                       "source_sha": os.environ.get("GITHUB_SHA"), "destination_branch": DESTINATION,
                       "run_id": os.environ.get("GITHUB_RUN_ID"), "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
                       "failure": "bounded publisher ended without a final receipt; inspect exact destination ref before retrying"})
        raise SystemExit(1) from None
    finally:
        # Entire artifact ZIPs and large payloads existed only in the child process memory.
        if output.exists():
            output.unlink()


if __name__ == "__main__":
    if sys.argv[1:] == ["--publish"]:
        child()
    else:
        require(len(sys.argv) == 1, "unexpected publisher arguments")
        entry()
