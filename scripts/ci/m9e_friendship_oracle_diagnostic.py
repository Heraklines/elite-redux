"""Remote actual pinned friendship/candy source-method observations; no Rust parity claim."""
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

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-friendship-oracle-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
OUTPUT = FULL / "generated"
ORACLE = REPORT / "oracle"
STORE = ROOT / ".m9e-friendship-oracle-source"
PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
BASE = "7240a1f6277ac1fd51d4e121c2da7b73692c0c1b"
BASE_TREE = "8c06c28995e036597200e6e73cc5ea447a4b1838"
ASSET_COMMIT = "d5f67989d02b7082ca32e7eaddf3b9421916ff12"
ASSET_PATH = "battle-anims/tackle.json"
ASSET_REPOSITORY = "https://github.com/Heraklines/er-assets.git"
ASSET_URL = f"https://api.github.com/repos/Heraklines/er-assets/contents/{ASSET_PATH}?ref={ASSET_COMMIT}"
HELPER = "test/kernel-fixtures/m9/export-friendship-oracle.ts"
INJECTED = "test/kernel-fixtures/m9-export-friendship-oracle.test.ts"
TITLE = "export actual pinned friendship and candy method observations"
VERIFIER = "scripts/ci/m9e_friendship_oracle_verify.mjs"
PRODUCER = "scripts/ci/m9e_friendship_oracle_diagnostic.py"
WORKFLOW = ".github/workflows/m9e-friendship-oracle-focused.yml"
ADDITIONS = sorted([HELPER, VERIFIER, PRODUCER, WORKFLOW])
BOUNDED_HELPER = "scripts/ci/m9e_current_cost.py"
BOUNDED_HELPER_SHA256 = "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75"
BOUNDED_HELPER_BYTES = 38615
EXPORTER_SHA256 = "9e61537148a14ac103bb8427efdc9608ebc24e74a78c9235aba676a162949df8"
OUTPUT_BOUNDS = {"export-one.json": 32768, "export-two.json": 32768,
                 "effects-one.json": 12288, "effects-two.json": 12288, "validation.json": 8192}
ORACLE_CONFIG = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".nvmrc", ".gitmodules",
                 "vitest.config.ts", "vite.config.ts", "tsconfig.json"]
DEADLINE = None
WORK_DEADLINE = None
run_bounded = None
sequence = 0
logs = {}
failed_log = None
active_step = "initialization"
ORACLE_PINS = {
  "src/field/pokemon.ts": [
    "67fdc53c78562c61284861d1687c942500b904bd992d67bec02b0f8ae04ea4c4",
    444743
  ],
  "src/data/balance/starters.ts": [
    "21bd9442711f1f7381f5e7e5c4a51dac43db0584272fd5b4767493f8a68e39ef",
    22732
  ],
  "src/timed-event-manager.ts": [
    "3f6c749aca7b5624f50ec3a46b355cafe5cd23508a4c621548c76265f97bf426",
    11631
  ],
  "src/system/ribbons/ribbon-methods.ts": [
    "32ad366a3f5550cc3cff7908fec9b78c0112f05848cb31dd596913804d2887c4",
    3757
  ],
  "src/system/ribbons/ribbon-data.ts": [
    "f7bb2d610c2ea75036a328b7ab8ff19b38e29bd281f2c650b20c6fa0f8d19ba4",
    7408
  ],
  "src/data/elite-redux/er-reward-rates.ts": [
    "581c4d395bbd6698204051f24b64b3d83139349b525fa1d7df36dcf3297779d0",
    7108
  ],
  "src/data/elite-redux/er-balance-tuning.ts": [
    "a9d2f5e6e46422eeaf014b8881913eec0c5bc36377caadd2e09d8081c984c1c4",
    6197
  ],
  "src/data/elite-redux/er-fun-mode.ts": [
    "b81e58ddd75e3cadcc24dc49aa823cc6f34db5bc092b5674e730835824dd1051",
    15719
  ],
  "src/data/elite-redux/moody/moody-state.ts": [
    "a4fb78efb9b3a5a1918660d4c504e0f5761cb6d0cef0b5c024ca7feaccca8dae",
    25183
  ],
  "src/modifier/modifier.ts": [
    "ce600a1acbe931402679f95832919f8d4ec05ad9e4ff2bce5a9e68b1aaa21b4f",
    157626
  ],
  "src/modifier/modifier-type.ts": [
    "264145c654c09aac83befb454ad8c9adb3f6992383fcdf73da121bc28a935a30",
    145957
  ],
  "src/utils/modifier-utils.ts": [
    "77fb8bad86c548e0c2bf59041a94802536742170776650018f0be5efcf2bd194",
    1204
  ],
  "src/ui/containers/candy-bar.ts": [
    "990a4ac8f440065ceb031e936e8b7cf1845f6e24718839bfe5ddc70dac5ff85b",
    3959
  ],
  "test/framework/game-manager.ts": [
    "a99cb2a27094bb0cb4bbe04e999e3c0cc5f6065702f83dcd45a2c04e05eaff7b",
    23088
  ],
  "test/framework/game-wrapper.ts": [
    "34dcb986d61ca6a6fc97636588acbda250720c1b34c518cbe810a0c96b6bb40d",
    8252
  ],
  "test/helpers/classic-mode-helper.ts": [
    "c218ade479acccb33f6e9acb8b813f4fc48d5e930458820bd6182bda0e7b3851",
    4917
  ],
  "test/helpers/overrides-helper.ts": [
    "4e55a4a5a1fc33fe1887b1d06dcb69112e382bd4034b080a0781ab78a7e19c4a",
    30737
  ],
  "test/utils/game-manager-utils.ts": [
    "2fac4ff9be5eeb65945b97e20b0c58fb11b358684e33cf389464cbba0997c070",
    3945
  ],
  "test/setup/vitest.setup.ts": [
    "9367d5e030ce9fa486acdc61528fdd2386275eab38f7002215129296c79e58bd",
    5060
  ],
  "test/setup/test-file-initialization.ts": [
    "158221a4fea3aa7a903fdcaac6e24b9f8846edfd696a68a9037803bf92ffabd7",
    2617
  ],
  "vitest.config.ts": [
    "63f02204ea787fcd3c6b0598809f59f08be15995b6675bd34245d329eafc8e20",
    3291
  ],
  "src/system/game-data.ts": [
    "16a69ee97d552e16ab6bb6bb2504d358a05fcf1ca80a6d53c38a4f3d1910e89f",
    325510
  ],
  "src/data/elite-redux/er-balance-tuning.json": [
    "751c6a45e1d065bf2b493d63c51e323b0d4dcd2679153516b17e0cc3b3a4e310",
    331
  ],
  "src/battle-scene.ts": [
    "0e2c5eff0aa70c45c4ef92a4c279d93d35b6e1fc71719d481603e5d2242ae2af",
    235075
  ],
  "package.json": [
    "b29655956a73f24aaff59781b9352f937598123900589d055abf1a10fd12f903",
    6588
  ],
  "pnpm-lock.yaml": [
    "dcbcaf6df44509c71b28becffdd70b33a7410a0873f5b1297ede84150a6effff",
    145307
  ],
  "pnpm-workspace.yaml": [
    "b4ba52dbe9a3ecfef2dae27aa09649452214a97bcfec28f7fbc402e309d0e593",
    739
  ],
  ".nvmrc": [
    "ca60797658d7260e78179fff372eda677f04040820d398ccbebb2934e85dc16f",
    7
  ],
  ".gitmodules": [
    "9aeca9f1c3e77fe18b90f9e4c5a817c8f4e90fb581f2ffe0176782c9e5ec2f45",
    182
  ],
  "vite.config.ts": [
    "bb1328fdbafe05e60000477241444f20ea0fe9340d46d10fd8f59e81752feb6a",
    3478
  ],
  "tsconfig.json": [
    "963f966510990bc2c33b7288d3788142da2911b96d43e537e6557d1c4547f463",
    4514
  ],
  "src/data/elite-redux/moody/moody-formation-game-adapter.ts": [
    "c94e75bcf4a68ce89f00671dd1fc0baa723c6e80d2ab7b047a2350a8e5fdcf35",
    63756
  ],
  "src/data/elite-redux/moody/moody-runtime-game-adapter.ts": [
    "d5e316a6f5ec1fbf550993f4f8552bb93253109eb762331b955fdcb150ee0b80",
    105998
  ],
  "src/game-mode.ts": [
    "836ff150ce901f95b4a20b5962ee55ba7e6fff0c21e9b0e619cec3228d3d9370",
    28647
  ],
  "src/data/elite-redux/er-achievement-rewards.ts": [
    "28d729a2e88fe0761fe9a293a08fba5d10c1a17037af7eb362f4ca7835f026c2",
    56578
  ],
  "src/system/achv.ts": [
    "6255c52e60695bca88fab0fc91dab7a0b779d40d06bc563fd26927800e3847e5",
    65655
  ],
  "src/data/elite-redux/er-shiny-lab-effects.ts": [
    "2e693c5a5fbfd26d7ed29de8515b38efcc7cdd142c8f0424c62d301c6ca138ff",
    71964
  ],
  "src/data/elite-redux/er-shiny-lab-config.ts": [
    "8314ac781dc930a15808cebf195bc07b2fe4fdd28b5a33e811a7ab39e2ce16d2",
    9461
  ],
  "src/data/elite-redux/er-run-difficulty.ts": [
    "944ddde4b3b6fda355e2be1b0688472a0cb56dfc654042dc604d4200e8be1809",
    6093
  ],
  "src/overrides.ts": [
    "50c3f84157ecbd881534a01b989b2bf4da197b33870c0e84fd1b17847b0b0ae3",
    17413
  ]
}


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


def run(args, name, *, cwd=ROOT, seconds=600, bound=16 << 20, extra=None, cleanup_command=False):
    global sequence, failed_log, active_step
    require(run_bounded is not None and DEADLINE is not None, "bounded runner not initialized")
    require(0 < seconds <= 600, "command exceeds 600 second cap")
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
    logs[name].update(argv=args, seconds_cap=seconds, byte_cap=bound, exit_code=0)
    return output


def git_text(repository, args, name):
    return run(["git", *args], name, cwd=repository, seconds=30, bound=16384).read_text().strip()



def fetch_tackle():
    # One immutable single-file JSON request, including base64 and Git blob provenance.
    # The parent run_bounded process group enforces 60 seconds including all socket reads.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise RuntimeError("pinned tackle input redirect rejected")
    request = urllib.request.Request(ASSET_URL, headers={"Accept": "application/vnd.github+json",
                                                       "User-Agent": "m9e-friendship-oracle"})
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



def inventory(repository, revision, name, candidate=False):
    tree = run(["git", "ls-tree", "-r", "-l", "-z", revision], name + "-tree", cwd=repository,
               seconds=30, bound=4 << 20).read_bytes()
    records = {}
    for row in tree.split(b"\0"):
        if not row:
            continue
        require(time.monotonic() < WORK_DEADLINE, "inventory exhausted work deadline")
        metadata, encoded = row.split(b"\t", 1)
        mode, kind, oid, size = metadata.decode().split()
        path = encoded.decode()
        if not candidate and path == "assets":
            require(mode == "160000" and kind == "commit" and oid == ASSET_COMMIT, "pinned assets gitlink")
            records[path] = {"mode": mode, "git_commit": oid}
            continue
        selected = path in [*ADDITIONS, BOUNDED_HELPER] if candidate else (
            path in ORACLE_CONFIG or path.startswith(("src/", "test/", "plugins/", "locales/", "patches/")))
        if not selected:
            continue
        require(mode in ("100644", "100755") and kind == "blob", "unexpected source mode: " + path)
        fact = file_fact(repository / path)
        require(fact["bytes"] == int(size) and fact["git_blob"] == oid, "tracked source differs: " + path)
        require(path not in records, "duplicate source path")
        records[path] = {**fact, "mode": mode}
    required = [*ADDITIONS, BOUNDED_HELPER] if candidate else [*ORACLE_PINS, "assets",
        "test/setup/font-face.setup.ts", "test/setup/matchers.setup.ts", "test/mocks/mock-loader.ts",
        "test/mocks/mock-fetch.ts", "src/data/pokemon-species.ts"]
    require(all(path in records for path in required), "missing required input inventory")
    require(1 <= len(records) <= 20000, "source inventory count bound")
    if not candidate:
        for path, (digest, size) in ORACLE_PINS.items():
            require(records[path]["sha256"] == digest and records[path]["bytes"] == size,
                    "reviewed oracle source pin differs: " + path)
        require(any(path.startswith("locales/en/") for path in records), "missing pinned English locales")
    return records


def inventory_receipt(records, label):
    path = FULL / f"{label}-inventory.json"
    write_json(path, records, 8 << 20)
    return {"count": len(records), **file_fact(path, 8 << 20)}


def initialize(summary):
    global DEADLINE, WORK_DEADLINE, run_bounded
    epoch = os.environ.get("M9E_FOCUS_STARTED_AT", "")
    require(re.fullmatch(r"[0-9]{10}", epoch), "exact precheckout timestamp required")
    elapsed = time.time() - int(epoch)
    require(0 <= elapsed < 1780, "invalid elapsed or setup exhausted budget/cleanup reserve")
    DEADLINE = time.monotonic() + 1800 - elapsed
    WORK_DEADLINE = DEADLINE - 20
    summary["elapsed_before_producer_seconds"] = elapsed
    helper = ROOT / BOUNDED_HELPER
    fact = file_fact(helper, BOUNDED_HELPER_BYTES)
    require(fact["bytes"] == BOUNDED_HELPER_BYTES and fact["sha256"] == BOUNDED_HELPER_SHA256
            and "m9e_current_cost" not in sys.modules, "bounded helper differs or preloaded")
    import m9e_current_cost
    require(Path(m9e_current_cost.__file__).resolve() == helper, "bounded helper imported from wrong path")
    run_bounded = m9e_current_cost.run_bounded
    for name in ("NODE_PATH", "NODE_OPTIONS"):
        require(name not in os.environ, "ambient execution override: " + name)
    os.environ.update({"GIT_NO_LAZY_FETCH": "1", "GIT_LFS_SKIP_SMUDGE": "1", "GIT_TERMINAL_PROMPT": "0",
                       "NODE_OPTIONS": "--max-old-space-size=4096"})


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "candidate SHA format")
    require(git_text(ROOT, ["rev-parse", "HEAD"], "candidate-head") == sha, "candidate identity")
    require(git_text(ROOT, ["rev-parse", BASE + "^{tree}"], "baseline-tree") == BASE_TREE, "base tree identity")
    changed = git_text(ROOT, ["diff", "--name-status", "--no-renames", BASE, sha], "exact-additions").splitlines()
    require(changed == ["M\t" + path for path in ADDITIONS], "candidate must contain only four reviewed sidecar modifications")
    require(git_text(STORE, ["rev-parse", "HEAD"], "oracle-store-head") == PIN, "pinned object store identity")
    for name, command, expected in (("node", ["node", "--version"], "v24.9.0"),
                                    ("pnpm", ["pnpm", "--version"], "10.33.2")):
        actual = run(command, name + "-version", seconds=30, bound=16384).read_text().strip()
        require(actual == expected, "pinned tool version: " + name)
        summary.setdefault("versions", {})[name] = actual
    candidate = inventory(ROOT, sha, "candidate", candidate=True)
    require(candidate[HELPER]["sha256"] == EXPORTER_SHA256, "reviewed exporter pin differs")
    summary["candidate_tree"] = git_text(ROOT, ["rev-parse", "HEAD^{tree}"], "candidate-tree")
    summary["candidate_inputs"] = candidate
    summary["candidate_inventory"] = inventory_receipt(candidate, "candidate")
    require(not ORACLE.exists(), "fresh isolated oracle required")
    run(["git", "-c", "submodule.recurse=false", "worktree", "add", "--detach", str(ORACLE), PIN],
        "oracle-worktree", cwd=STORE, seconds=60)
    require(git_text(ORACLE, ["rev-parse", "HEAD"], "oracle-head") == PIN, "isolated oracle identity")
    pinned = inventory(ORACLE, PIN, "oracle")
    summary["oracle_inventory"] = inventory_receipt(pinned, "oracle")
    summary["reviewed_oracle_inputs"] = {path: pinned[path] for path in ORACLE_PINS}
    require(git_text(ORACLE, ["config", "--file", ".gitmodules", "--get", "submodule.assets.url"],
                     "assets-repository") == ASSET_REPOSITORY, "assets repository identity")
    run([sys.executable, str(ROOT / PRODUCER), "--fetch-tackle"], "pinned-tackle-input", seconds=60, bound=262144)
    summary["tackle_input"] = json.loads((FULL / "tackle-input.json").read_bytes())
    require(not (ORACLE / INJECTED).exists(), "injection cannot replace pinned source")
    (ORACLE / INJECTED).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / HELPER, ORACLE / INJECTED)
    injected = file_fact(ORACLE / INJECTED)
    require(injected == file_fact(ROOT / HELPER), "exact injected exporter required")
    summary["injected_exporter"] = {"candidate_path": HELPER, "oracle_path": INJECTED, **injected}
    run(["pnpm", "install", "--frozen-lockfile"], "pinned-dependencies", cwd=ORACLE)
    require(inventory(ORACLE, PIN, "oracle-after-install") == pinned, "install changed pinned source")
    summary["fresh_process_exports"] = []
    for ordinal in ("one", "two"):
        destination = OUTPUT / f"export-{ordinal}.json"
        sidecar = OUTPUT / f"effects-{ordinal}.json"
        report = FULL / f"vitest-{ordinal}.json"
        require(not destination.exists() and not sidecar.exists() and not report.exists(), "fresh outputs required")
        require(file_fact(ORACLE / INJECTED) == injected, "exporter changed before execution")
        run(["pnpm", "exec", "vitest", "run", INJECTED, "--pool=forks", "--isolate", "--no-file-parallelism",
             "--reporter=json", "--outputFile=" + str(report)], "fresh-export-" + ordinal,
            cwd=ORACLE, extra={"M9_FRIENDSHIP_ORACLE_OUTPUT": str(destination),
                               "M9_FRIENDSHIP_EFFECTS_OUTPUT": str(sidecar)})
        summary["fresh_process_exports"].append({"ordinal": ordinal, "report": validate_vitest(report),
            "export": file_fact(destination, 32768), "sidecar": file_fact(sidecar, 12288),
            "helper_sha256": injected["sha256"]})
        require(file_fact(destination, 32768)["bytes"] == 21428 and file_fact(destination, 32768)["sha256"] ==
                "8182bb42b37ade8fd26bf9885b26c08d9a5c6b8ce028b6261fa369077d3e0e00", "frozen legacy observation differs")
        require(inventory(ORACLE, PIN, "oracle-after-" + ordinal) == pinned, "export changed pinned source")
    require((OUTPUT / "export-one.json").read_bytes() == (OUTPUT / "export-two.json").read_bytes(),
            "two actual fresh source outputs are not byte-identical")
    run(["node", str(ROOT / VERIFIER), str(OUTPUT / "export-one.json"), str(OUTPUT / "export-two.json"),
         str(OUTPUT / "effects-one.json"), str(OUTPUT / "effects-two.json"),
         str(OUTPUT / "validation.json")], "independent-data-verification", seconds=60, bound=65536)
    file_fact(OUTPUT / "validation.json", 8192)
    summary["data_validation"] = json.loads((OUTPUT / "validation.json").read_bytes())
    require(summary["data_validation"].get("status") == "passed", "independent data verifier did not pass")
    require(inventory(ROOT, sha, "candidate-after", candidate=True) == candidate, "candidate changed")
    require(file_fact(ORACLE / INJECTED) == injected, "exporter changed after execution")
    require(file_fact(ORACLE / "assets" / ASSET_PATH, 256 << 10)["sha256"] == summary["tackle_input"]["sha256"],
            "tackle asset changed")
    summary["conservation"] = {"candidate": True, "oracle_after_install": True,
                               "oracle_after_each_export": True, "injected_exporter": True, "asset": True}
    require({path.name for path in OUTPUT.iterdir()} == set(OUTPUT_BOUNDS), "exact five output names")
    summary["generated"] = {name: file_fact(OUTPUT / name, bound) for name, bound in OUTPUT_BOUNDS.items()}
    require(set(summary["generated"]) == set(OUTPUT_BOUNDS), "exact output inventory")
    require(sum(row["bytes"] for row in summary["generated"].values()) <= 98304, "aggregate generated bound")
    require(time.monotonic() < WORK_DEADLINE, "work deadline exceeded before reserved cleanup")


def cleanup():
    require(not ORACLE.is_symlink() and ORACLE.resolve().parent == REPORT.resolve(), "owned cleanup containment")
    if ORACLE.exists():
        shutil.rmtree(ORACLE)


def bound_partial_outputs():
    removed = []
    for path in sorted(OUTPUT.iterdir()):
        require(path.parent == OUTPUT and path.is_file() and not path.is_symlink(), "unexpected generated output type")
        if path.name not in OUTPUT_BOUNDS or not 0 < path.stat().st_size <= OUTPUT_BOUNDS[path.name]:
            removed.append({"name": path.name[:128], "bytes": path.stat().st_size})
            path.unlink()
    return removed


def entry():
    require(not REPORT.exists() and REPORT.resolve().parent == Path(os.environ["RUNNER_TEMP"]).resolve(),
            "fresh contained report directory required")
    OUTPUT.mkdir(parents=True)
    COMPACT.mkdir()
    summary = {"schema_version": 1, "source_sha": os.environ.get("GITHUB_SHA"), "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"), "baseline": BASE, "oracle_sha": PIN,
        "scope": "two real source-method exports; controlled GameManager fixtures; no Rust parity/runtime payment",
        "status": "failed", "limits": {"per_command_seconds": 600, "shared_seconds": 1800,
        "cleanup_reserve_seconds": 20, "legacy_file_bytes": 32768, "sidecar_file_bytes": 12288,
        "validation_file_bytes": 8192, "aggregate_generated_bytes": 98304, "compact_metadata_bytes": 65536}}
    error = None
    try:
        require(all(re.fullmatch(r"[1-9][0-9]{0,19}", summary[key] or "") for key in ("run_id", "run_attempt")),
                "positive GitHub run identities required")
        initialize(summary)
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
                raise RuntimeError("partial output violated bounds")
        except Exception as caught:
            error = error or caught
            summary["status"] = "failed"
            summary["output_error"] = str(caught)[:4096]
        try:
            if run_bounded is not None:
                run([sys.executable, str(ROOT / PRODUCER), "--cleanup"], "cleanup", seconds=20,
                    bound=65536, cleanup_command=True)
                require(not ORACLE.exists(), "owned source cleanup incomplete")
                require(time.monotonic() < DEADLINE, "shared deadline exceeded after cleanup")
                summary["cleanup"] = {"oracle_removed": True, "completed_within_1800_seconds": True}
            else:
                require(not ORACLE.exists(), "initialization failed after creating oracle")
                summary["cleanup"] = {"oracle_never_created": True, "runner_not_initialized": True}
        except Exception as caught:
            error = error or caught
            summary["status"] = "failed"
            summary["cleanup_error"] = str(caught)[:4096]
        summary["commands"] = logs
        if error is not None:
            data = (json.dumps(summary.get("failure", {"error": str(error)})) + "\n").encode()
            if failed_log is not None and failed_log.is_file():
                with failed_log.open("rb") as stream:
                    stream.seek(max(0, failed_log.stat().st_size - (56 << 10)))
                    data += stream.read(56 << 10)
            require(len(data) <= 65536, "named failure limit")
            (FULL / "failure.txt").write_bytes(data)
            summary["named_failure"] = file_fact(FULL / "failure.txt", 65536)
        write_json(COMPACT / "summary.json", summary, 65536)
    if error is not None:
        raise SystemExit(1)


if __name__ == "__main__":
    if sys.argv[1:] == ["--fetch-tackle"]:
        fetch_tackle()
    elif sys.argv[1:] == ["--cleanup"]:
        cleanup()
    else:
        require(len(sys.argv) == 1, "unexpected arguments")
        entry()
