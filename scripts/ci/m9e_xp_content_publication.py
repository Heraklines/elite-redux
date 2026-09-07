"""Remote-only publication of five audited generated files to one new source branch."""
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
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-xp-content-publication"
COMPACT = REPORT / "compact"
REPO = "Heraklines/elite-redux"
API = "https://api.github.com/repos/" + REPO
QUALIFIED = "d0a2e37059e65c4cd7fa8743ce6cb9e3dfec2caa"
QUALIFIED_TREE = "c5cdb77b44ad47dca88aa7d23da6f9cfc1eb0cc6"
ORACLE = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
EXPORT_RUN = 34125184738
SUMMARY_ID = 10019875329
DIAGNOSTICS_ID = 10019876147
SUMMARY_SHA256 = "88ffbea480f96eaecafb8e96c33d324dda041b73eac05dd8b14316d509be2c91"
SOURCE_BRANCH = "codex/m9e-xp-content-publication-focused-20260907"
DESTINATION = "codex/m9e-xp-regenerated-content-20260907"
PUBLISHER = "scripts/ci/m9e_xp_content_publication.py"
WORKFLOW = ".github/workflows/m9e-xp-content-publication-focused.yml"
RUNNER_HELPER = "scripts/ci/m9e_current_cost.py"
HELPER_SHA256 = "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75"
PREFIX = "rust/fixtures/m9/engineering/"
FILES = {
    "export-one.json": ("complete-progression-definitions-v1.json", 3724089,
        "bba00376cae18feae56bebe38c5be0f1bb3aae3fd9a6e99e3ec7fa60a15de08f", "9d8a49da2746c5e5cf3b3eeddafdf67d7d23c7aa"),
    "new-pack.json": ("progression-content-pack-v2.json", 3576205,
        "1864120e3130162bdd11c9370ae436140b0896a062fa10da9100445776bad17b", "e9c7ed41d2fa5be32d279a8cd9524a720e5f1665"),
    "new-report.json": ("progression-oracle-report-v2.json", 510,
        "64b4b759c46a897720230ffa0c87d73158d6ff69c2e18f4bdfb2d9c64408bec7", "96ecd22adee9d85269d7f5cfe57927fd539aaa12"),
    "new-bundle.json": ("game-content-bundle-v2.json", 16325821,
        "9afce9fd3bc6e05e2159f19e8578ff64fc342b8a5974bec5f15648b0799d74d2", "778d0bd4f31fac16c2823ad1ad0c6a8761fede68"),
    "new-bundle-manifest.json": ("game-content-bundle-v2-manifest.json", 1219,
        "63bf9531e080c09ea47b12b328af0a09abe7333e5c0d228dd45fa666f239bb2e", "76c320db3187e35ba64eccecf382fb7473209f8d"),
}
PRODUCTS = {
    "rust/crates/er-content-compiler/src/m9e_progression.rs": "4937b4bfafb7d0ba87a73ae8e8860db6d5ba9fbc",
    "rust/crates/er-content-compiler/tests/m9e_progression.rs": "dfe5baa0882f0e6527fd56044049c78095fa846a",
    "rust/crates/er-progression/src/content_v2.rs": "bbb2f3f2d487ca583aa8ca57d0bb38291e160924",
    "rust/crates/er-progression/tests/m9e_content_v2.rs": "7b40115ba0c097c00452b23a11f628c8a793751d",
    "test/kernel-fixtures/m9/export-progression-content.ts": "70abbdaef7c890a2bfc4a0c9884d95645406e207",
    "rust/crates/er-progression/src/lib.rs": "903cfec7029dc73d4b6c30ae2027789c7cd66009",
    "rust/crates/er-progression/src/current_experience.rs": "f9be041d6bbf29db4fc7ffb75097e6f3a5fbe958",
    "rust/crates/er-progression/tests/m9e_current_experience.rs": "561f402846e700ae0444aaec6f07a194c37738a3",
}
GENERATED = {"compiled-validation.json", "export-one.json", "export-two.json", "exports-validation.json",
             "new-bindings.json", "new-bundle-manifest.json", "new-bundle.json", "new-pack.json", "new-report.json",
             "old-bindings.json", "old-pack.json", "old-report.json"}
LOG_NAMES = ["candidate-head", "oracle-store-head", "node-version", "pnpm-version", "rust-version",
             "candidate-tree", "candidate-tree", "oracle-worktree", "oracle-head", "oracle-tree",
             "assets-repository", "pinned-tackle-input", "pinned-dependencies", "oracle-after-install-tree",
             "fresh-export-one", "oracle-after-one-tree", "fresh-export-two", "oracle-after-two-tree",
             "verify-exports", "build-compilers", "old-progression-compile", "new-progression-compile",
             "new-bundle-compile", "verify-compiled", "candidate-final-tree", "cleanup"]
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
               "User-Agent": "m9e-xp-source-publication", "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]}
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
            req = urllib.request.Request(location, headers={"User-Agent": "m9e-xp-source-publication"})
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
    generated = summary.get("generated")
    require(type(generated) is dict and set(generated) == GENERATED, "audited exact generated inventory required")
    payloads = {}
    total = 0
    for name in sorted(GENERATED):
        raw = archive.read("generated/" + name)
        total += len(raw)
        require(fact(raw) == generated[name], "remote generated bytes differ from audited receipt: " + name)
        if name in FILES:
            destination, length, digest, oid = FILES[name]
            require(fact(raw) == {"bytes": length, "sha256": digest, "git_blob": oid}, "fixed audited five-file identity differs")
            payloads[PREFIX + destination] = raw
        elif name == "new-bindings.json":
            unchanged = PREFIX + "progression-behavior-bindings-v2.json"
            require(raw == read_checkout(unchanged, candidate[unchanged]["sha"]), "evolution bindings changed")
            receipt["unchanged_evolution_bindings"] = fact(raw)
    require(total <= 64 << 20, "generated remote aggregate bound")
    require(generated["export-one.json"] == generated["export-two.json"], "audited two exports differ")
    for label, member in (("candidate_inputs", "candidate-inventory.json"), ("oracle_inputs", "oracle-inventory.json")):
        raw = archive.read(member)
        require(fact(raw) == {key: summary[label][key] for key in ("bytes", "sha256", "git_blob")}, "full remote inventory hash differs")
        require(len(json.loads(raw)) == summary[label]["count"], "full remote inventory count differs")
    for row in summary["fresh_process_exports"]:
        raw = archive.read("vitest-" + row["ordinal"] + ".json")
        require(fact(raw) == {key: row["report"][key] for key in ("bytes", "sha256", "git_blob")}, "actual remote Vitest report hash differs")
    # Recheck all five actual JSON payloads against the unchanged checked-out base before creating Git objects.
    definitions = json.loads(payloads[PREFIX + "complete-progression-definitions-v1.json"])
    pack = json.loads(payloads[PREFIX + "progression-content-pack-v2.json"])
    report = json.loads(payloads[PREFIX + "progression-oracle-report-v2.json"])
    bundle = json.loads(payloads[PREFIX + "game-content-bundle-v2.json"])
    manifest = json.loads(payloads[PREFIX + "game-content-bundle-v2-manifest.json"])
    def old(name):
        path = PREFIX + name
        return json.loads(read_checkout(path, candidate[path]["sha"]))
    old_definitions = old("complete-progression-definitions-v1.json")
    old_pack = old("progression-content-pack-v2.json")
    old_report = old("progression-oracle-report-v2.json")
    old_bundle = old("game-content-bundle-v2.json")
    old_manifest = old("game-content-bundle-v2-manifest.json")
    require(definitions.get("oracle_sha") == ORACLE and len(definitions["species"]) == 3384
            and len(pack["species"]) == 3384, "actual 3384-row source/pack coverage differs")
    exported_metadata = {}
    for row in definitions["species"]:
        key = (row["species_id"], row["form_index"])
        require(key not in exported_metadata and "experience" in row, "actual exported identity/metadata missing")
        exported_metadata[key] = row.pop("experience")
    require(definitions == old_definitions, "full original definitions structure changed")
    for row in pack["species"]:
        require(row.get("experience") == exported_metadata.pop((row["species"], row["form"])), "actual compiled XP metadata differs")
        del row["experience"]
    require(not exported_metadata, "compiled metadata coverage incomplete")
    new_pack_hash = pack["content_hash"]
    require(new_pack_hash == "b167ad856885c95dab4f1e9cdf1456dd4924f6c4dbc8443e12918f232215192e", "qualified progression hash differs")
    pack["content_hash"] = old_pack["content_hash"]
    require(pack == old_pack, "old progression structure changed")
    require(report["content_hash"] == new_pack_hash, "actual new report binding differs")
    report["content_hash"] = old_report["content_hash"]
    require(report == old_report, "full old report/counts changed")
    require(bundle["progression"] == json.loads(payloads[PREFIX + "progression-content-pack-v2.json"]), "bundle progression differs")
    new_bundle_hash = bundle["content_hash"]
    require(new_bundle_hash == "blake3-v1:dc4ab1ede5c52152e40f1dc5579d93841898126903b3047bf66b60efd7646493", "qualified bundle hash differs")
    bundle["progression"] = old_bundle["progression"]
    bundle["content_hash"] = old_bundle["content_hash"]
    require(bundle == old_bundle, "bundle changed beyond progression")
    require(manifest["content_hash"] == new_bundle_hash and manifest["components"]["progression"] == new_pack_hash,
            "actual bundle manifest binding differs")
    manifest["content_hash"] = old_manifest["content_hash"]
    manifest["components"]["progression"] = old_manifest["components"]["progression"]
    require(manifest == old_manifest, "manifest changed beyond progression and total hashes")
    receipt["validated_content"] = {"species_forms": 3384, "progression_hash": new_pack_hash,
                                     "bundle_hash": new_bundle_hash, "only_progression_changed": True,
                                     "original_structure_and_counts_conserved": True}
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
            and run.get("head_branch") == "codex/m9e-xp-content-export-focused-20260907"
            and run.get("path") == ".github/workflows/m9e-xp-content-export-focused.yml", "qualified completed export workflow differs")
    summary_raw, summary_artifact = artifact(SUMMARY_ID, "m9e-xp-content-export-summary-" + QUALIFIED, 7418, "summary")
    with checked_zip(summary_raw, {"summary.json": 65536}, 65536) as archive:
        raw = archive.read("summary.json")
    require(len(raw) == 22990 and sha256(raw) == SUMMARY_SHA256, "exact locally audited compact summary bytes required")
    summary = json.loads(raw)
    require(summary.get("source_sha") == QUALIFIED and summary.get("run_id") == str(EXPORT_RUN)
            and summary.get("run_attempt") == "1" and summary.get("status") == "passed"
            and summary.get("candidate_tree") == QUALIFIED_TREE and summary.get("oracle_sha") == ORACLE
            and all(summary["cleanup"].get(key) is True for key in ("removed", "oracle_removed", "target_removed",
                                                                  "completed_within_1800_seconds")), "audited export identity/cleanup differs")
    receipt["export_evidence"] = {"run_id": EXPORT_RUN, "source_sha": QUALIFIED, "source_tree": QUALIFIED_TREE,
                                  "summary_sha256": SUMMARY_SHA256, "summary_artifact": summary_artifact}
    raw, diagnostics_artifact = artifact(DIAGNOSTICS_ID, "m9e-xp-content-export-diagnostics-" + QUALIFIED, 4860145, "diagnostics")
    expected = {f"{index:03d}-{name}.log": 16 << 20 for index, name in enumerate(LOG_NAMES, 1)}
    expected.update({"generated/" + name: 32 << 20 for name in GENERATED})
    expected.update({"candidate-inventory.json": 8 << 20, "oracle-inventory.json": 8 << 20,
                     "tackle-input.json": 8192, "vitest-one.json": 1 << 20, "vitest-two.json": 1 << 20})
    with checked_zip(raw, expected, 96 << 20) as archive:
        payloads = validate_payloads(summary, archive, candidate, receipt)
    receipt["export_evidence"]["diagnostics_artifact"] = diagnostics_artifact
    receipt["files"] = {path: fact(data) for path, data in payloads.items()}
    updated = {path: dict(row) for path, row in candidate.items()}
    for path, data in payloads.items():
        require(path in updated and updated[path]["type"] == "blob" and updated[path]["mode"] == "100644",
                "only existing five regular fixture paths may change")
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
    result = request("/git/commits", "create-commit", body={"message": "Regenerate pinned M9 progression content with source XP metadata",
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
    receipt = {"schema_version": 1, "status": "failed", "scope": "five verified generated source files on one new named branch; no main update or deploy"}
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
