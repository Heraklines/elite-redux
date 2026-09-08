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
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-drain-content-publication"
COMPACT = REPORT / "compact"
REPO = "Heraklines/elite-redux"
API = "https://api.github.com/repos/" + REPO
QUALIFIED = "4395e38a8eb3e3f32951925fab8a4945bc463daa"
QUALIFIED_TREE = "5bedb51d3aaece58a9913cd885a8a495507446be"
ORACLE = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
EXPORT_RUN = 34261503406
SUMMARY_ID = 10070164680
DIAGNOSTICS_ID = 10070165478
SUMMARY_SHA256 = "c75a36ee26665b480098d0dd4f4ffbc04151022c87eabc61ca450e0d0691532b"
SOURCE_BRANCH = "codex/m9e-drain-content-publication-focused-v2-20260908"
DESTINATION = "codex/m9e-drain-regenerated-content-20260908"
PUBLISHER = "scripts/ci/m9e_drain_content_publication.py"
WORKFLOW = ".github/workflows/m9e-drain-content-publication-focused.yml"
RUNNER_HELPER = "scripts/ci/m9e_current_cost.py"
HELPER_SHA256 = "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75"
PREFIX = "rust/fixtures/m9/engineering/"
FILES = json.loads(r'''{"battle-content-pack-v3.json":["battle-content-pack-v3.json",8093947,"19d02806cfd82a59814a8786a00a2d0e783b064651b74271d1d2bc8a685f2b5e","a3cb39b2a30a404e799e04dfaacfee910a2eae0d"],"game-content-bundle-v2-manifest.json":["game-content-bundle-v2-manifest.json",1219,"793ac4bc98a74232850f7a1c124fd876c212a18e7db0afa2c15a65e33108502f","062fcdc9016d38a29932c1852e70379859f05c1b"],"game-content-bundle-v2.json":["game-content-bundle-v2.json",16335369,"a42bf206c6e9a848df5774e58c1f0190f562ceefb90f4dc07e97125eaf0ae6af","cabb11ce9bc146b3a615bf334d5342d7b67528da"],"run-content-pack-v3.json":["run-content-pack-v3.json",1845,"7286f3aa5e17189c46a70d9e6e46e51760efd7b577e120c0501c106e8a411004","6ca98567b96ce029c834a6e4adb1bc9880014077"]}''')
PRODUCTS = json.loads(r'''{"rust/crates/er-battle/src/m6/routine_executor.rs":"9e260b9d1f31ad33fc2fea7ef4a9fd118fa89b25","rust/crates/er-battle/src/m7_resolver.rs":"96ff381b8f980c8573261716d271634520ab7781","rust/crates/er-content-compiler/src/lib.rs":"9a55d6ebe50763b7cb91a1ea1deb447f7c38e953","rust/crates/er-content-compiler/src/m9e_full_content.rs":"dcdd475e3f351f2c3a8995f06c25fe4100fc7d09","rust/crates/er-content-compiler/src/m9e_move_drains.rs":"e0697d2d5e7b623f6aad758bc9f4a9407c3286b7","rust/crates/er-game/tests/m9e_move_drains.rs":"87a11dac12833e449b56558fd484b7517974441e"}''')
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
        raw = archive.read("generated/" + name)
        require(fact(raw) == {"bytes": length, "sha256": digest, "git_blob": oid}, "exact audited export bytes required")
        row = summary["bundle_export"]["files"][name]
        require(fact(raw) == {key: row[key] for key in ("bytes", "sha256", "git_blob")}, "export receipt binding differs")
        before = read_checkout(PREFIX + destination, candidate[PREFIX + destination]["sha"])
        require(fact(before) == {key: row["before_" + key] for key in ("bytes", "sha256", "git_blob")}, "original fixture bytes differ")
        payloads[PREFIX + destination] = raw
    baseline_raw = archive.read("generated/drain-baseline-metadata.json")
    require(len(baseline_raw) == 3694 and sha256(baseline_raw) == "b22d23b3bc7122fac411d0410c9d1fed5d3884d61a984e2877f78bb8e88b6f10", "exact audited baseline metadata required")
    baseline = json.loads(baseline_raw)
    for row in summary["commands"]:
        raw = archive.read(row["name"] + ".log")
        require(len(raw) == row["log_bytes"] and sha256(raw) == row["log_sha256"], "actual generation/test log differs")
    def old(name):
        return json.loads(read_checkout(PREFIX + name, candidate[PREFIX + name]["sha"]))
    def new(name):
        return json.loads(payloads[PREFIX + name])
    battle, old_battle = new("battle-content-pack-v3.json"), old("battle-content-pack-v3.json")
    bundle, old_bundle = new("game-content-bundle-v2.json"), old("game-content-bundle-v2.json")
    run, old_run = new("run-content-pack-v3.json"), old("run-content-pack-v3.json")
    manifest, old_manifest = new("game-content-bundle-v2-manifest.json"), old("game-content-bundle-v2-manifest.json")
    require(old_bundle["battle"] == old_battle and old_bundle["run"] == old_run and bundle["battle"] == battle and bundle["run"] == run, "whole bundle components differ from exports")
    require(len(old_battle["programs"]) == 3679 and len(battle["programs"]) == 3691 and battle["programs"][:3679] == old_battle["programs"], "all original program slots must remain exact")
    expected_ids = {71,72,141,202,409,532,570,577,613,733,891,902}
    require(len(battle["moves"]) == len(old_battle["moves"]), "move inventory changed")
    changed_moves = set()
    for index, (before, after) in enumerate(zip(old_battle["moves"], battle["moves"])):
        if before == after:
            continue
        require(index in expected_ids and isinstance(before, dict) and isinstance(after, dict), "unexpected move changed")
        programs = after["mechanic_programs"]
        require(len(programs) == len(before["mechanic_programs"]) + 1 and programs[:-1] == before["mechanic_programs"], "only one appended drain program per move")
        restored = dict(after)
        restored["mechanic_programs"] = before["mechanic_programs"]
        require(restored == before, "move definition changed beyond its drain binding")
        changed_moves.add(index)
    require(changed_moves == expected_ids, "exact twelve source moves required")
    classes = json.loads(json.dumps(battle["classifications"]))
    require(len(classes) == len(old_battle["classifications"]) == 9411, "classification coverage differs")
    for before in baseline["admitted_classifications"]:
        matches = [index for index, row in enumerate(classes) if row["behavior_unit"] == before["behavior_unit"]]
        require(len(matches) == 1 and classes[matches[0]]["kind"] == "COMPILED" and before["kind"] == "BESPOKE", "exact classification transition required")
        classes[matches[0]] = before
    require(classes == old_battle["classifications"], "every other classification must remain exact")
    restored = dict(battle)
    for key in ("content_hash", "programs", "moves", "classifications"):
        restored[key] = old_battle[key]
    def diagnostic_value(value):
        raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        result = {"type": type(value).__name__, "bytes": len(raw), "sha256": sha256(raw)}
        if len(raw) <= 4096:
            result["value"] = value
        return result
    unexpected = {key: {"before": diagnostic_value(old_battle.get(key)), "after": diagnostic_value(restored.get(key))}
                  for key in sorted(set(restored) | set(old_battle)) if restored.get(key) != old_battle.get(key)}
    require(len(unexpected) <= 16, "unexpected battle field diagnostic bound")
    receipt["unexpected_battle_fields"] = unexpected
    require(restored == old_battle, "other battle data changed")
    expected_run = dict(old_run)
    expected_run.update(battle_content_hash=battle["content_hash"], content_hash=run["content_hash"])
    require(run == expected_run, "run changed beyond derived identities")
    expected_bundle = dict(old_bundle)
    expected_bundle.update(battle=battle, run=run, content_hash=bundle["content_hash"])
    require(bundle == expected_bundle, "other complete bundle components changed")
    expected_manifest = json.loads(json.dumps(old_manifest))
    expected_manifest["content_hash"] = bundle["content_hash"]
    expected_manifest["components"].update(battle=battle["content_hash"], run=run["content_hash"])
    require(manifest == expected_manifest, "manifest changed beyond three derived identities")
    receipt["validated_content"] = {"moves": sorted(expected_ids), "programs_before":3679, "programs_after":3691,
        "classifications":9411, "other_data_conserved":True, "bundle_hash":bundle["content_hash"],
        "qualification":"ordinary unconditional drains only; inherited manifest labels do not establish full M9"}
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
            and run.get("head_branch") == "codex/m9e-drain-durable-baseline-focused-20260908"
            and run.get("path") == ".github/workflows/m9e-static-drain-bundle-focused.yml", "qualified completed export workflow differs")
    summary_raw, summary_artifact = artifact(SUMMARY_ID, "m9e-static-drain-bundle-summary-" + QUALIFIED, 7325, "summary")
    with checked_zip(summary_raw, {"summary.json": 65536}, 65536) as archive:
        raw = archive.read("summary.json")
    require(len(raw) == 28003 and sha256(raw) == SUMMARY_SHA256, "exact locally audited compact summary bytes required")
    summary = json.loads(raw)
    require(summary.get("source_sha") == QUALIFIED and summary.get("run_id") == str(EXPORT_RUN)
            and summary.get("run_attempt") == "1" and summary.get("status") == "passed"
            and summary.get("tests_executed") == 5 and summary["bundle_export"]["status"] == "passed"
            and summary["cleanup"]["success"] is True and summary["cleanup"]["target_removed"] is True
            and summary["elapsed_seconds"] < 1800, "audited export identity/cleanup differs")
    receipt["export_evidence"] = {"run_id": EXPORT_RUN, "source_sha": QUALIFIED, "source_tree": QUALIFIED_TREE,
                                  "summary_sha256": SUMMARY_SHA256, "summary_artifact": summary_artifact}
    raw, diagnostics_artifact = artifact(DIAGNOSTICS_ID, "m9e-static-drain-bundle-diagnostics-" + QUALIFIED, 3230327, "diagnostics")
    expected = {row["name"] + ".log": row["log_bytes"] for row in summary["commands"]}
    require(len(expected) == 48, "complete actual command log inventory required")
    expected.update({"generated/" + name: values[1] for name, values in FILES.items()})
    expected["generated/drain-baseline-metadata.json"] = 3694
    with checked_zip(raw, expected, 96 << 20) as archive:
        payloads = validate_payloads(summary, archive, candidate, receipt)
    receipt["export_evidence"]["diagnostics_artifact"] = diagnostics_artifact
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
    result = request("/git/commits", "create-commit", body={"message": "Publish audited source-generated ordinary drain bundle",
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
