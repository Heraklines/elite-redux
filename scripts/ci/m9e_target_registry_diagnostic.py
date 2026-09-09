"""Remote actual pinned initialized ability/move registry diagnostic; no gameplay qualification."""
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
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-target-registry-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
OUTPUT = FULL / "generated"
ORACLE = REPORT / "oracle"
STORE = ROOT / ".m9e-target-registry-source"
PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
BASE = "dcd09ddf17ef2e979b2d344c279ba0e6c5a1f89b"
BASE_TREE = "4a792b5072a436686243c82f03b79eaf2a3a6e4a"
ASSET_COMMIT = "d5f67989d02b7082ca32e7eaddf3b9421916ff12"
ASSET_PATH = "battle-anims/tackle.json"
ASSET_REPOSITORY = "https://github.com/Heraklines/er-assets.git"
ASSET_URL = f"https://api.github.com/repos/Heraklines/er-assets/contents/{ASSET_PATH}?ref={ASSET_COMMIT}"
HELPER = "test/kernel-fixtures/m9/observe-target-registry.ts"
INJECTED = "test/kernel-fixtures/m9-observe-target-registry.test.ts"
TITLE = "observe actual initialized target capability registry"
VERIFIER = "scripts/ci/m9e_target_registry_verify.mjs"
PRODUCER = "scripts/ci/m9e_target_registry_diagnostic.py"
WORKFLOW = ".github/workflows/m9e-target-registry-focused.yml"
ADDITIONS = sorted([HELPER, VERIFIER, PRODUCER, WORKFLOW])
BOUNDED_HELPER = "scripts/ci/m9e_current_cost.py"
BOUNDED_HELPER_SHA256 = "5a25e98778cc7103375a5342600c4bc6e5a22252935f435f847e6434f00e7cd8"
BOUNDED_HELPER_BYTES = 38620
EXPORTER_SHA256 = "ead3b8682301077ab2de7f8509d7ce3fe2afb402bf3e80b5ac0261531a5254cb"
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
  "vitest.config.ts": [
    "63f02204ea787fcd3c6b0598809f59f08be15995b6675bd34245d329eafc8e20",
    3291
  ],
  "vite.config.ts": [
    "bb1328fdbafe05e60000477241444f20ea0fe9340d46d10fd8f59e81752feb6a",
    3478
  ],
  "tsconfig.json": [
    "963f966510990bc2c33b7288d3788142da2911b96d43e537e6557d1c4547f463",
    4514
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
  "src/data/data-lists.ts": [
    "b6475bc34bf5192d2fc79f7ebffde91210377476ab8e5ce2c2705ccf46f72ef7",
    898
  ],
  "src/field/pokemon.ts": [
    "67fdc53c78562c61284861d1687c942500b904bd992d67bec02b0f8ae04ea4c4",
    444743
  ],
  "src/data/moves/move-utils.ts": [
    "6f296e67ba9be531ba12dd1455cbebd04b7fdedfe6ec8cadb2d3df73743d50eb",
    11852
  ],
  "src/data/moves/move.ts": [
    "d685b7d48caaf9c1428dde1fa497ec31f63b798c1b8bcb19ca7ec9c69188bf4e",
    585155
  ],
  "src/data/abilities/ability.ts": [
    "95cb52f5f4f07d5d5bc5cd18520ace4546a668eae0e34f0f2698828be2979130",
    13309
  ],
  "src/data/abilities/ab-attrs.ts": [
    "5d9c4c27cfc2423e31ccd70f06be699d042d9639621b9b541c817c4d3502754f",
    274887
  ],
  "src/data/abilities/init-abilities.ts": [
    "88f561808d25a17567ff7801d3451480a0f5517a41701b3097261f8f6a620dd3",
    97611
  ],
  "src/data/elite-redux/abilities/shattered-psyche.ts": [
    "a59275e90c68e1cae011eeef40fdbc40d9457bbd88b859acbc52ed42f2b10bfd",
    14422
  ],
  "src/data/elite-redux/archetype-dispatcher.ts": [
    "ca70a4b7fc88b33e8f19ff440069bec6d37d45c2f715f820f1adf6cd2cfcec8b",
    386298
  ],
  "src/data/elite-redux/init-editor-authored-abilities.ts": [
    "3db48c289c276f313cb619f858aaf99e5cdffdc8d76dcde9b7206dfd6eb31643",
    2087
  ],
  "src/data/elite-redux/init-elite-redux-ability-upgrades.ts": [
    "f7e2098cbe0fc205110c2e8a86a2841330d65879ea589bd91227285247720fd3",
    48308
  ],
  "src/data/elite-redux/init-elite-redux-custom-abilities.ts": [
    "aa8f26d7cfbe48aa4950fdef1c863c111b94b943f2d5624b9ac57d7db875fd7f",
    54398
  ],
  "src/enums/move-flags.ts": [
    "ad4f5357dc7a3d42c956269d41a3b4677cc363142df25afa258e6f6225073fa5",
    4449
  ],
  "src/enums/move-target.ts": [
    "dd9272781d53e85b051fe071bb12d23d54c3625892bc973f535f4f14cd68cd80",
    1194
  ],
  "src/phase-tree.ts": ["2a152ebab21e2d54e72a0655896ece0d731c48aa82d61d8130d2a30f1e895b3c", 9396],
  "src/phase-manager.ts": ["8905870d2c79b52032e8d7770b864d4511c77480fce3c04cd4d7c9595995547b", 51511],
  "src/phases/turn-start-phase.ts": ["1e55cd59ec77c473a1c048a978fcf031a6b205aa9c8e04a0e6f55d76f8fa475c", 18754],
  "src/phases/move-phase.ts": ["9e83a1b00a494f638dcc7e6dd59867ca1e7c72ad27ef5568d65a8af9da1325ce", 54218],
  "src/phases/move-effect-phase.ts": ["5e02a2c6f6fdb11ea6b30143ff881975e8d2f5b88f020c9c84f61c89d29a4382", 57798],
  "src/phases/faint-phase.ts": ["4a71a91d8e582fd3244ac4eb7d3d268749c4167233f5855ca26e16515f351b10", 22615],
  "src/phases/victory-phase.ts": ["699cb5273390636dc83b0dc17332ba66b5a59e62c58802010d5f0aefa274bc05", 33397],
  "src/battle-scene.ts": ["0e2c5eff0aa70c45c4ef92a4c279d93d35b6e1fc71719d481603e5d2242ae2af", 235075],
  "src/data/elite-redux/archetypes/ability-meta-consumers.ts": ["87d53ff46ef2148debdd250827657180cefcbd187a7c494fd6b6f6973d522166", 5899]
}


DAILY_SOURCE_PINS = {"src/enums/ability-id.ts":["7dba96b370f03f820f3188c51874d1e615b40e220b35a2652995ab2aff306a56",31607],"src/enums/nature.ts":["41f46d31d6a91c75be598e55ac7a75c42e809aa5a21a7f733d11c4718fe090c2",260],"src/data/elite-redux/moody/moody-state.ts":["a4fb78efb9b3a5a1918660d4c504e0f5761cb6d0cef0b5c024ca7feaccca8dae",25183],"src/ui/handlers/starter-select-ui-handler.ts":["227a9a17f3ae45b09c9650cf6022f23d640714d9a8b2cfbd9d76720691d2186e",358829],"src/game-mode.ts":["836ff150ce901f95b4a20b5962ee55ba7e6fff0c21e9b0e619cec3228d3d9370",28647],"src/data/elite-redux/er-fun-mode.ts":["b81e58ddd75e3cadcc24dc49aa823cc6f34db5bc092b5674e730835824dd1051",15719],"src/data/elite-redux/er-balance-knobs.ts":["0e968f13019693ecfa184bf2f6f71416568711d970917956ba76b97424bd1fef",33608],"src/data/elite-redux/er-balance-tuning.ts":["a9d2f5e6e46422eeaf014b8881913eec0c5bc36377caadd2e09d8081c984c1c4",6197],"src/utils/common.ts":["65a83f24675a5b56a426f6d2d49c1e2549fad641e3e187e6b031154cec286e48",14626],"src/data/balance/starters.ts":["21bd9442711f1f7381f5e7e5c4a51dac43db0584272fd5b4767493f8a68e39ef",22732],"src/utils/pokemon-utils.ts":["69347ffc750d55d17279e7efd35ed6fdb26cdf0caefdf36a6f56bc1bdb70e456",9032]}
ORACLE_PINS.update(DAILY_SOURCE_PINS)
DAILY_INITIALIZATION_PINS = {"src/init/init.ts":["64e5cd4219f2dd2460560f790719fef7cf373907721897871c317bf6035f1ae7",30003],"src/data/elite-redux/init-elite-redux-egg-tiers.ts":["1e39d3c2d1827e43adb806412cb27ce56905023196a95c5921dbd910aea1ba25",21945],"src/data/elite-redux/init-elite-redux-starter-costs.ts":["bb0a5613d52c50b40adcf5754de2a0555473ec9d89a734d9f5d214755d3d0494",6226],"src/data/elite-redux/init-elite-redux-species-tuning.ts":["d03413ef6ab7b41839b661dfada242dd4691bb5a901d4a8d22fefe336889247c",4665],"src/data/elite-redux/init-elite-redux-custom-mons.ts":["5812cf088dd13629a0a3b14dd6523ddf2cdaaea6f1faeda3dd61e588e2ca33c4",9396],"src/data/elite-redux/init-elite-redux-custom-species.ts":["c2d67bba52927710929f424d721de03ac0135114d09e9af7cefa9b2ed97d0678",35217],"src/data/elite-redux/er-egg-pool-bans.ts":["69ea53ea9fc9133a7c053a2c42a659488555aea9e7344da995545a5199294cc4",13660]}
ORACLE_PINS.update(DAILY_INITIALIZATION_PINS)
STAT_OWNER_PINS = {"src/modifier/modifier.ts":["ce600a1acbe931402679f95832919f8d4ec05ad9e4ff2bce5a9e68b1aaa21b4f",157626],"src/data/elite-redux/moody/moody-runtime-game-adapter.ts":["d5e316a6f5ec1fbf550993f4f8552bb93253109eb762331b955fdcb150ee0b80",105998],"src/phases/select-starter-phase.ts":["818c060ada86e24a31a0bb0095e75dd915604d2812e9edf865bd5a17b647fe57",69292]}
ORACLE_PINS.update(STAT_OWNER_PINS)
TUNING_PATH = "src/data/elite-redux/er-balance-tuning.json"
TUNING_BLOB = "04755b16e916c3e364917b67a9718cf0ee01ae6b"
RNG_FILES = ["node_modules/phaser/package.json", "node_modules/phaser/src/math/random-data-generator/RandomDataGenerator.js"]

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
                                                       "User-Agent": "m9e-target-registry"})
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
        require(TUNING_PATH in records and records[TUNING_PATH]["git_blob"] == TUNING_BLOB, "immutable effective tuning source required")
        for path, (digest, size) in ORACLE_PINS.items():
            require(records[path]["sha256"] == digest and records[path]["bytes"] == size,
                    "reviewed oracle source pin differs: " + path)
        require(any(path.startswith("locales/en/") for path in records), "missing pinned English locales")
    return records


def inventory_receipt(records, label):
    path = FULL / f"{label}-inventory.json"
    write_json(path, records, 8 << 20)
    return {"count": len(records), **file_fact(path, 8 << 20)}


def installed_phaser_inputs():
    # pnpm's package entry is a link. Resolve only this reviewed dependency,
    # preserving the strict nonredirected rule for every source/output file.
    store = ORACLE / "node_modules" / ".pnpm"
    require(store.is_dir() and not store.is_symlink() and store.resolve() == store,
            "owned real pnpm package store required")
    package = (ORACLE / "node_modules" / "phaser").resolve(strict=True)
    parts = package.relative_to(store).parts
    require(len(parts) == 3 and parts[1:] == ("node_modules", "phaser")
            and re.fullmatch(r"phaser@3\.90\.0(?:_patch_hash=[a-z0-9]+)?", parts[0]),
            "exact owned Phaser3.90.0 package containment required")
    result = {}
    for logical in RNG_FILES:
        relative = Path(logical).relative_to("node_modules/phaser")
        actual = package / relative
        require(actual.resolve(strict=True) == actual, "nested Phaser file redirect")
        result[logical] = {"resolved_path": actual.relative_to(ORACLE).as_posix(),
                           **file_fact(actual, 262144)}
    return result

def initialize(summary):
    global DEADLINE, WORK_DEADLINE, run_bounded
    epoch = os.environ.get("M9E_FOCUS_STARTED_AT", "")
    require(re.fullmatch(r"[0-9]{10}", epoch), "exact precheckout timestamp required")
    elapsed = time.time() - int(epoch)
    require(0 <= elapsed < 1780, "invalid elapsed or setup exhausted budget/cleanup reserve")
    DEADLINE = time.monotonic() + 1800 - elapsed
    WORK_DEADLINE = DEADLINE - 20
    summary["started_at"] = int(epoch)
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



# DEX_SOURCE_ADDITIONS: preserve every preceding qualified source pin.
ORACLE_PINS.update({
  "src/constants.ts": [
    "afc6d1b7102ebbd84da11d7d0b6beaaedb1f0de633d5a5f8bdc914131e4dbbdf",
    5571
  ],
  "src/data/gender.ts": [
    "90b57b814b73b72732c92d6533e9f9c876c6cea0627cb1f83ec4b64483722116",
    486
  ],
  "src/enums/ability-attr.ts": [
    "bfbb7255e907db24a9b0885b9831e374644ede7f6cdd00c88918884c1d9d6ec7",
    350
  ],
  "src/enums/dex-attr.ts": [
    "331f83996f2ef931e3ff5067f764c5bdd51f6c572344941018c76ef0d95823f5",
    291
  ],
  "src/system/achv.ts": [
    "6255c52e60695bca88fab0fc91dab7a0b779d40d06bc563fd26927800e3847e5",
    65655
  ],
  "src/data/elite-redux/er-achievement-rewards.ts": [
    "28d729a2e88fe0761fe9a293a08fba5d10c1a17037af7eb362f4ca7835f026c2",
    56578
  ],
  "src/overrides.ts": [
    "50c3f84157ecbd881534a01b989b2bf4da197b33870c0e84fd1b17847b0b0ae3",
    17413
  ],
  "src/enums/battle-type.ts": [
    "4c84f68729ddf68f5d5e8cec595ece20b0219a4467edff3bd9a1ac3511df1c7b",
    154
  ],
  "src/enums/game-modes.ts": [
    "20dafb4f0957f2a9a90b0925216b0f907fe1fa07e861f8337395dd037d044b9a",
    515
  ],
  "src/system/game-data.ts": [
    "16a69ee97d552e16ab6bb6bb2504d358a05fcf1ca80a6d53c38a4f3d1910e89f",
    325510
  ],
  "src/system/game-stats.ts": [
    "beac4a1162cd0e1b0ec342751142f2f2a7d1833a22d6e95b5bd4a90259922091",
    6781
  ],
  "src/data/elite-redux/er-run-difficulty.ts": [
    "944ddde4b3b6fda355e2be1b0688472a0cb56dfc654042dc604d4200e8be1809",
    6093
  ],
  "src/data/battle-format.ts": [
    "7619f84967643acc73a39c9e45f76c6a3ff4944b1f1794254bf37c279e9bffe8",
    16071
  ],
  "src/enums/biome-id.ts": [
    "23fba809ca467412434152faee002351fda15a164086255469664be7f2a2e072",
    658
  ],
  "src/data/balance/biomes/town.ts": [
    "c26b7950d04e26fab6816fbb4894d7b8e5c6f18952c0cdd40bf5c5940f0f7760",
    5293
  ],
  "src/@types/biomes.ts": [
    "907660afaba3151efa30e593a1cc0e62637416f27bef8b91ba417ef618020aed",
    2382
  ],
  "src/system/ribbons/ribbon-data.ts": [
    "f7bb2d610c2ea75036a328b7ab8ff19b38e29bd281f2c650b20c6fa0f8d19ba4",
    7408
  ],
  "src/enums/species-id.ts": [
    "6323f21fd3dfb859b6ae682f2f94507ad140ceeff811fdee43289779cf6665ba",
    104981
  ]
})
RECONNAISSANCE_METHODS = {
  "constructor": {
    "sha256": "816eeedca0d9550f2fb784a1db82f92d15f9be7141da9cf7c81b93772d8b2b5e",
    "bytes": 1359
  },
  "initDexData": {
    "sha256": "c5ded94bb7168881c81f03dc007f178a3635aded466855c90ca27dd5603b1124",
    "bytes": 1306
  },
  "initStarterData": {
    "sha256": "ada7540a7d684201c738fe6004c25f70c183e73ee4daa72267cc503613daab69",
    "bytes": 920
  },
  "createStarterDataEntry": {
    "sha256": "c52e757ef51c72011189703d9e23c95859aa92b8955c313681ca9ffadc7bce74",
    "bytes": 354
  },
  "getRootStarterSpeciesId": {
    "sha256": "a34feb42c475f23d904a796de6e0e94cee3d27455a47b446f0aaabfa068997f9",
    "bytes": 689
  },
  "getStarterDataEntry": {
    "sha256": "e5fdfcb6b704258cb148c3236d58d6e55cb5d711d671b3413d908c50515ba3d6",
    "bytes": 965
  },
  "setPokemonSeen": {
    "sha256": "2d249bb1059a2d2cfa51d6a8fd2175a82e913cb26ff3d26c0f2fc5626229ea3b",
    "bytes": 1021
  },
  "setPokemonCaught": {
    "sha256": "86114b7449ab214c026e6ae5d393cb276b70edab42bde6f7eaefc3770208acbd",
    "bytes": 4139
  },
  "setPokemonSpeciesCaught": {
    "sha256": "36df697263855fbe8a07ea17d5dc2d9b1f50615413e64316cdf473b01827dabd",
    "bytes": 6378
  },
  "updateSpeciesDexIvs": {
    "sha256": "d55dbe526d6bf905b080bd8cc76f9d2d9fac47e0a2e9b00e5fc9c0dcbaf7e6b2",
    "bytes": 574
  }
}

def source_method_closure(summary):
    path = ORACLE / "src/system/game-data.ts"
    fact = file_fact(path, 400000)
    require(fact["git_blob"] == "b88d78bbcf0e36c937af4fa30e45e73d7e5aea90"
            and fact["sha256"] == "16a69ee97d552e16ab6bb6bb2504d358a05fcf1ca80a6d53c38a4f3d1910e89f"
            and fact["bytes"] == 325510, "actual pinned GameData identity")
    rows = path.read_text(encoding="utf-8").splitlines()
    require(rows.count("export class GameData {") == 1, "exact GameData class anchor")
    start_class = rows.index("export class GameData {")
    selected = []
    methods = {}
    for name, expected in RECONNAISSANCE_METHODS.items():
        matches = [i for i in range(start_class, len(rows))
                   if re.match(r"^  (?:(?:public|private|async) )*" + re.escape(name) + r"\(", rows[i])]
        require(len(matches) == 1, "unique named actual method: " + name)
        start = matches[0]
        end = next((i for i in range(start, len(rows)) if rows[i] == "  }"), None)
        require(end is not None, "complete named method boundary: " + name)
        raw = ("\n".join(rows[start:end + 1]) + "\n").encode()
        methods[name] = {"line_start": start + 1, "line_end": end + 1,
                         "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                         "reconnaissance_matches": len(raw) == expected["bytes"]
                         and hashlib.sha256(raw).hexdigest() == expected["sha256"]}
        selected.append(f"\nMETHOD {name} LINES {start + 1}-{end + 1}\n" + raw.decode())
    excerpt = ("Pinned399d src/system/game-data.ts " + json.dumps(fact, sort_keys=True)
               + "\n" + "".join(selected)).encode()
    require(len(excerpt) <= 32768, "named source method excerpt bound")
    destination = OUTPUT / "source-methods.txt"
    require(not destination.exists(), "fresh named source excerpt")
    destination.write_bytes(excerpt)
    summary["game_data_method_source"] = {"path": "src/system/game-data.ts", **fact,
        "excerpt": file_fact(destination, 32768), "methods": methods,
        "reconnaissance_source": "dcd09ddf17ef2e979b2d344c279ba0e6c5a1f89b",
        "reconnaissance_sha256": "d46396460429b26df9553f4bd6d59d1d32fbca8836ed5e9fd1bba6de061df4f6"}
    require(all(row["reconnaissance_matches"] for row in methods.values()),
            "reviewed GameData method differs from actual399d; inspect retained named source excerpt")


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    require(os.environ.get("GITHUB_REF_NAME") == "codex/m9e-dex-encounter-source-20260910" and os.environ.get("GITHUB_EVENT_NAME") == "push", "exact source branch/event")
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "candidate SHA format")
    require(git_text(ROOT, ["rev-parse", "HEAD"], "candidate-head") == sha, "candidate identity")
    require(git_text(ROOT, ["rev-parse", BASE + "^{tree}"], "baseline-tree") == BASE_TREE, "base tree identity")
    changed = git_text(ROOT, ["diff", "--name-status", "--no-renames", BASE, sha], "exact-additions").splitlines()
    require(changed == ["A\t" + path for path in ADDITIONS], "candidate must contain only four additive oracle paths")
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
    summary["daily_tuning_source"] = {"path": TUNING_PATH, **pinned[TUNING_PATH]}
    source_method_closure(summary)
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
    rng_inputs = installed_phaser_inputs()
    require(json.loads((ORACLE / rng_inputs[RNG_FILES[0]]["resolved_path"]).read_bytes()).get("version") == "3.90.0", "qualified Phaser version required")
    summary["phaser_runtime_inputs"] = rng_inputs
    summary["fresh_process_exports"] = []
    for ordinal in ("one", "two"):
        destination = OUTPUT / f"export-{ordinal}.json"
        report = FULL / f"vitest-{ordinal}.json"
        require(not destination.exists() and not report.exists(), "fresh outputs required")
        require(file_fact(ORACLE / INJECTED) == injected, "exporter changed before execution")
        run(["pnpm", "exec", "vitest", "run", INJECTED, "--pool=forks", "--isolate", "--no-file-parallelism",
             "--reporter=json", "--outputFile=" + str(report)], "fresh-export-" + ordinal,
            cwd=ORACLE, extra={"M9_TARGET_REGISTRY_OUTPUT": str(destination),
                "M9_DEX_ENCOUNTER_OUTPUT": str(OUTPUT / f"sidecar-{ordinal}.json")})
        summary["fresh_process_exports"].append({"ordinal": ordinal, "report": validate_vitest(report),
            "export": file_fact(destination, 32768), "helper_sha256": injected["sha256"],
            "sidecar": file_fact(OUTPUT / f"sidecar-{ordinal}.json", 32768)})
        require(file_fact(destination,32768)["bytes"] == 29641 and file_fact(destination,32768)["sha256"] ==
                "9b58691e1c5b3796e2b1bfe511483a445b7ab158e72e895fd15c86e5f9bc4576", "retained qualified legacy bytes differ")
        require(inventory(ORACLE, PIN, "oracle-after-" + ordinal) == pinned, "export changed pinned source")
    require((OUTPUT / "export-one.json").read_bytes() == (OUTPUT / "export-two.json").read_bytes(),
            "two actual fresh source outputs are not byte-identical")
    phase_paths = ["src/phase-tree.ts", "src/phase-manager.ts", "src/phases/turn-start-phase.ts",
        "src/phases/move-phase.ts", "src/phases/move-effect-phase.ts", "src/phases/faint-phase.ts",
        "src/phases/victory-phase.ts", "src/field/pokemon.ts", "src/battle-scene.ts",
        "src/data/elite-redux/archetypes/ability-meta-consumers.ts"]
    phase_pins = FULL / "phase-source-pins.json"
    phase_pins.write_text(json.dumps({"oracle": PIN, "sources": {path: ORACLE_PINS[path]
        for path in phase_paths}}, sort_keys=True) + "\n", encoding="utf-8")
    require(phase_pins.stat().st_size <= 32768, "phase source pin bound")
    run(["node", str(ROOT / VERIFIER), str(OUTPUT / "export-one.json"), str(OUTPUT / "export-two.json"),
         str(OUTPUT / "validation.json"), str(ORACLE), str(phase_pins),
         str(OUTPUT / "sidecar-one.json"), str(OUTPUT / "sidecar-two.json")],
        "independent-data-and-source-queue-verification", seconds=60, bound=65536)
    summary["data_validation"] = json.loads((OUTPUT / "validation.json").read_bytes())
    require(summary["data_validation"].get("status") == "passed", "independent data verifier did not pass")
    require(inventory(ORACLE, PIN, "oracle-after-queue-verification") == pinned,
            "oracle changed during actual queue verification")
    require(installed_phaser_inputs() == rng_inputs, "actual Phaser source changed")
    require(inventory(ROOT, sha, "candidate-after", candidate=True) == candidate, "candidate changed")
    require(file_fact(ORACLE / INJECTED) == injected, "exporter changed after execution")
    require(file_fact(ORACLE / "assets" / ASSET_PATH, 256 << 10)["sha256"] == summary["tackle_input"]["sha256"],
            "tackle asset changed")
    summary["conservation"] = {"candidate": True, "oracle_after_install": True,
                               "oracle_after_each_export": True, "oracle_after_queue_verification": True, "injected_exporter": True, "asset": True}
    summary["generated"] = {path.name: file_fact(path, 32768) for path in sorted(OUTPUT.iterdir())}
    require(set(summary["generated"]) == {"export-one.json", "export-two.json", "sidecar-one.json", "sidecar-two.json", "source-methods.txt", "validation.json"}, "exact output inventory")
    require(sum(row["bytes"] for row in summary["generated"].values()) <= 6 * 32768, "aggregate generated bound")
    require(time.monotonic() < WORK_DEADLINE, "work deadline exceeded before reserved cleanup")


def cleanup():
    require(not ORACLE.is_symlink() and ORACLE.resolve().parent == REPORT.resolve(), "owned cleanup containment")
    if ORACLE.exists():
        shutil.rmtree(ORACLE)


def bound_partial_outputs():
    removed = []
    for path in sorted(OUTPUT.iterdir()):
        require(path.parent == OUTPUT and path.is_file() and not path.is_symlink(), "unexpected generated output type")
        if path.name not in {"export-one.json", "export-two.json", "sidecar-one.json", "sidecar-two.json", "source-methods.txt", "validation.json"} or path.stat().st_size > 32768:
            removed.append({"name": path.name[:128], "bytes": path.stat().st_size})
            path.unlink()
    return removed


def entry():
    require(not REPORT.exists() and REPORT.resolve().parent == Path(os.environ["RUNNER_TEMP"]).resolve(),
            "fresh contained report directory required")
    OUTPUT.mkdir(parents=True)
    COMPACT.mkdir()
    summary = {"schema_version": 1, "source_sha": os.environ.get("GITHUB_SHA"), "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"), "branch": os.environ.get("GITHUB_REF_NAME"), "event": os.environ.get("GITHUB_EVENT_NAME"), "baseline": BASE, "oracle_sha": PIN,
        "scope": "retained actual daily/registry/stat/queue observations plus fresh dex constructor and direct account methods, initial encounter; no evolution-phase or runtime XP qualification",
        "status": "failed", "limits": {"per_command_seconds": 600, "shared_seconds": 1800,
        "cleanup_reserve_seconds": 20, "data_file_bytes": 32768, "source_excerpt_bytes":32768, "aggregate_generated_bytes":196608, "compact_metadata_bytes": 65536}}
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
