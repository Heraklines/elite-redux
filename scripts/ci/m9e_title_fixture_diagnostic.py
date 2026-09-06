"""Remote-only interpretation of a fixed prior Rust fixture; not qualification."""
import hashlib
import io
import json
import os
from pathlib import Path
import urllib.error
import urllib.request
import zipfile

import m9e_title_storage as title

SOURCE = "51f0668df0e6f78cf65359f51cd8dc776723f77d"
ARTIFACT = 9993284356
ARCHIVE_BYTES = 5322322
API = f"https://api.github.com/repos/Heraklines/elite-redux/actions/artifacts/{ARTIFACT}"
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/compact/title-fixture-diagnostic.json"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


def api_request(url):
    return urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                                              "Accept": "application/vnd.github+json"})


def member(archive, suffix, maximum):
    matches = [item for item in archive.infolist() if item.filename == suffix or item.filename.endswith("/" + suffix)]
    if len(matches) != 1 or not 0 < matches[0].file_size <= maximum:
        raise RuntimeError("exact prior fixture member missing or over bound")
    with archive.open(matches[0]) as stream:
        raw = stream.read(maximum + 1)
    if len(raw) != matches[0].file_size:
        raise RuntimeError("prior fixture member size changed")
    return raw


def main(result):
    with urllib.request.urlopen(api_request(API), timeout=30) as response:
        metadata = json.loads(response.read(16385))
    if (metadata["name"] != "m9e-browser-assets-" + SOURCE or metadata["size_in_bytes"] != ARCHIVE_BYTES
            or metadata["expired"] or metadata["workflow_run"]["head_sha"] != SOURCE):
        raise RuntimeError("fixed prior artifact identity differs")
    opener = urllib.request.build_opener(NoRedirect())
    try:
        opener.open(api_request(API + "/zip"), timeout=30)
    except urllib.error.HTTPError as response:
        if response.code != 302:
            raise RuntimeError("artifact redirect was not successful") from None
        location = response.headers["Location"]
    else:
        raise RuntimeError("artifact API did not return its signed download")
    if not location.startswith("https://"):
        raise RuntimeError("artifact download is not HTTPS")
    # The API credential is never sent to the signed storage URL or written out.
    with urllib.request.urlopen(location, timeout=60) as response:
        raw = response.read(ARCHIVE_BYTES + 1)
    if len(raw) != ARCHIVE_BYTES:
        raise RuntimeError("fixed prior archive size differs")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        manifest_raw = member(archive, "m9e-v7-title-storage-assets.json", 16 << 10)
        fixture_raw = member(archive, "m9e-v7-title-storage-fixtures.json", 32 << 20)
    manifest = json.loads(manifest_raw)
    if (manifest["source_sha"] != SOURCE or len(fixture_raw) != manifest["fixture"]["bytes"]
            or hashlib.sha256(fixture_raw).hexdigest() != manifest["fixture"]["sha256"]):
        raise RuntimeError("prior fixture manifest/hash differs")
    fixture = json.loads(fixture_raw)
    owner = fixture["initial"]["lifecycle"]["value"]
    result.update(fixture_bytes=len(fixture_raw), fixture_sha256=manifest["fixture"]["sha256"],
                  initial_control=owner["control"], initial_storage=owner["current_storage"],
                  initial_stage=owner["stage"], initial_pressed=owner["pressed_keys"],
                  initial_save_slots=owner["catalog"]["save_slots"],
                  menu_matches_reference=owner["control"] == title.bootstrap_control("TITLE", 1, 1, 2))
    result["oracle"] = title.fixture_oracle(fixture, manifest["cohort"]["content_sha256"])
    result["status"] = "passed"


result = {"status": "failed", "qualification": "prior produced fixture diagnostic only; no new candidate runtime qualification",
          "produced_source_sha": SOURCE, "helper_source_sha": os.environ["GITHUB_SHA"],
          "run_id": os.environ["GITHUB_RUN_ID"], "artifact_id": ARTIFACT}
try:
    main(result)
except Exception as error:
    result["error"] = str(error)[:512]
finally:
    encoded = (json.dumps(result, sort_keys=True, indent=2) + "\n").encode()
    if len(encoded) > 16384:
        raise RuntimeError("prior fixture diagnostic exceeded compact bound")
    OUT.write_bytes(encoded)
    print(encoded.decode())
raise SystemExit(0 if result["status"] == "passed" else 1)
