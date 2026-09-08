"""Remote reuse of pinned friendship observations for the whole native B target."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile

FULL = None
ORACLE_DATA = None
ORACLE_RUN = 34149970288
ORACLE_SHA = "7e8e98922524b209a168bb028c7784dd7c43294f"
ORACLE_BRANCH = "codex/m9e-friendship-effects-sidecar-focused-20260907"
ORACLE_ARTIFACT = 10029032038
ORACLE_ARCHIVE_BYTES = 1777599
ORACLE_FILES = {
    "export-one.json": [21428, "8182bb42b37ade8fd26bf9885b26c08d9a5c6b8ce028b6261fa369077d3e0e00"],
    "effects-one.json": [6397, "f56af6cd8fb70f707a80d3e7e6906681965be329cd8e0ac1021e9ccdcb9dbf5a"],
}
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


def main():
    global FULL, ORACLE_DATA
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("M9E_NATIVE_LANE") != "b"
            or not re.fullmatch(r"[0-9a-f]{40}", os.environ.get("GITHUB_SHA", ""))):
        raise RuntimeError("authenticated remote native B input preparation required")
    temporary = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    FULL = temporary / "m9e-feedback" / "full"
    FULL.mkdir(parents=True, exist_ok=True)
    if FULL.is_symlink() or FULL.resolve() != FULL:
        raise RuntimeError("owned remote diagnostic directory required")
    ORACLE_DATA = FULL / "qualified-oracle"
    fetch_qualified_oracle()


if __name__ == "__main__":
    main()
