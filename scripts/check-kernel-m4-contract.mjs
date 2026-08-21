import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

const root = process.cwd();
const expectedSha = "45c89493e7edec9c4da247a98cd7858b1f015c09";

const contractNames = [
  "m4-api.md",
  "m4-atomic-transition.md",
  "m4-biome-encounter.md",
  "m4-contract.toml",
  "m4-error-policy.md",
  "m4-game-control.md",
  "m4-oracle-export.md",
  "m4-ownership.toml",
  "m4-performance.md",
  "m4-progression.md",
  "m4-reward-market.md",
  "m4-run-material.md",
  "m4-snapshot-trace.md",
];
const manifestNames = [
  "m4-benchmark-manifest.json",
  "m4-capability-manifest.json",
  "m4-coverage-map.json",
  "m4-oracle-manifest.json",
  "m4-slice-manifest.json",
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function text(path) {
  return readFile(join(root, path), "utf8");
}

function parseFlatToml(source, label) {
  const values = new Map();
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = raw.replace(/\s+#.*$/u, "").trim();
    if (!line || line.startsWith("[")) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line);
    if (!match) continue;
    const [, key, encoded] = match;
    assert(!values.has(key), `${label}:${index + 1}: duplicate TOML key ${key}`);
    let value;
    if (/^"(?:[^"\\]|\\.)*"$/u.test(encoded)) value = JSON.parse(encoded);
    else if (/^(?:true|false)$/u.test(encoded)) value = encoded === "true";
    else if (/^-?\d+$/u.test(encoded)) value = Number(encoded);
    else continue;
    values.set(key, value);
  }
  return values;
}

function assertNoDraftMarkers(source, label) {
  const forbidden = /\b(?:TODO|TBD|PLACEHOLDER|FIXME)\b/u;
  assert(!forbidden.test(source), `${label}: contains an unfrozen draft marker`);
}

const contractTexts = new Map();
for (const name of contractNames) {
  const source = await text(`rust/contracts/${name}`);
  assert(source.trim().length > 0, `${name}: empty contract`);
  assertNoDraftMarkers(source, name);
  contractTexts.set(name, source);
}

const contract = parseFlatToml(contractTexts.get("m4-contract.toml"), "m4-contract.toml");
const exactContract = {
  m3_base_sha: expectedSha,
  m4_oracle_sha: expectedSha,
  m3_parity_oracle_sha: "3b534099919efae827019d4a3f3c4ab0ecd6d67b",
  game_state_schema_version: 2,
  battle_state_schema_version: 2,
  pokemon_state_schema_version: 2,
  battle_turn_material_version: 2,
  battle_replacement_material_version: 2,
  wave_advance_material_version: 1,
  run_interaction_material_version: 1,
  run_terminal_material_version: 1,
  restorable_snapshot_version: 3,
  kernel_trace_version: 3,
  mechanical_digest_version: 2,
  surface_digest_version: 1,
  parity_segment_start_wave: 9,
  parity_segment_end_wave: 11,
  parity_segment_initial_state: "oracle-exported-wave-9-canonical-state",
  parity_segment_driver: "raw-physical-keys-only",
  parity_segment_semantic_shortcuts: false,
  regular_reward_reroll_and_locks: true,
  biome_market_reroll_and_locks: false,
  production_typescript_read_only: true,
};
for (const [key, expected] of Object.entries(exactContract)) {
  assert(contract.get(key) === expected, `m4-contract.toml: ${key} must equal ${JSON.stringify(expected)}`);
}

const ownership = contractTexts.get("m4-ownership.toml");
for (const branch of [
  "wrk/rk-m4a-01-types",
  "wrk/rk-m4a-state",
  "wrk/rk-m4a-run-content",
  "wrk/rk-m4a-oracle",
  "wrk/rk-m4a-oracle-progression",
  "wrk/rk-m4a-oracle-rewards",
  "wrk/rk-m4a-oracle-biome",
  "wrk/rk-m4a-oracle-migration",
  "wrk/rk-m4a-oracle-content",
  "wrk/rk-m4a-snapshot",
  "wrk/rk-m4a-settlement",
  "wrk/rk-m4a-battle-content",
  "wrk/rk-m4a-oracle-isolation",
]) {
  assert(ownership.includes(`branch = "${branch}"`), `m4-ownership.toml: missing active isolated branch ${branch}`);
}
for (const path of [
  "rust/crates/er-state/src/game_v2.rs",
  "rust/crates/er-run/src/rng_audit.rs",
  "scripts/export-kernel-m4-oracle.mjs",
  "test/kernel-fixtures/m4/export/progression-capture.ts",
  "test/kernel-fixtures/m4/export/reward-market-capture.ts",
  "test/kernel-fixtures/m4/export/biome-encounter-capture.ts",
  "test/kernel-fixtures/m4/export/migration-companion-capture.ts",
  "test/kernel-fixtures/m4/export/run-content-capture.ts",
  "rust/crates/er-types/src/trace_v3.rs",
  "rust/crates/er-run/src/settlement.rs",
  "rust/crates/er-content/src/m4_pack.rs",
  "test/kernel-fixtures/m4/export-helper-runner.test.ts",
]) {
  assert(ownership.includes(`"${path}"`), `m4-ownership.toml: missing active owned path ${path}`);
}

const manifests = new Map();
for (const name of manifestNames) {
  const source = await text(`rust/fixtures/m4/${name}`);
  assertNoDraftMarkers(source, name);
  const value = JSON.parse(source);
  assert(value.schema_version === 1, `${name}: schema_version must be 1`);
  manifests.set(name, value);
}

const slice = manifests.get("m4-slice-manifest.json");
assert(slice.m3_base_sha === expectedSha, "slice M3 base mismatch");
for (const [name, manifest] of manifests) {
  assert(manifest.m4_oracle_sha === expectedSha, `${name}: M4 oracle SHA mismatch`);
  assert(manifest.m3_parity_oracle_sha === "3b534099919efae827019d4a3f3c4ab0ecd6d67b", `${name}: M3 parity oracle SHA mismatch`);
}
assert(slice.segment.start_wave === 9 && slice.segment.end_wave === 11, "slice wave range mismatch");
assert(slice.segment.initial_biome.id === 0 && slice.segment.selected_biome.id === 1, "slice biome choice mismatch");
assert(slice.segment.driver === "raw-physical-keys-only", "slice driver must be raw keys");
assert(slice.segment.natural_single_seed_claim === false, "composed slice may not claim a natural seed");
assert(
  JSON.stringify(slice.segment.required_control_order) ===
    '["BATTLE","MOVE_LEARN","REWARD_SHOP","BATTLE","BIOME_MARKET","CROSSROADS","BIOME_SELECT","BATTLE"]',
  "composed slice control order must preserve the wave-9 reward, wave-10 market/Crossroads, and wave-11 battle spine",
);
assert(slice.progression.species.id === 932, "parity progression species must be Nacli 932");
assert(slice.progression.growth_rate.id === 3, "parity progression growth must be Medium Slow 3");
assert(slice.progression.parity_level_before === 16 && slice.progression.parity_level_after === 17, "parity progression must cross 16 to 17");
assert(JSON.stringify(slice.progression.level_move_candidates.map(entry => entry.id)) === "[34]", "parity move candidates mismatch");
assert(JSON.stringify(slice.progression.parity_initial_moves) === "[1,52,77,78]", "parity initial moves mismatch");
assert(slice.progression.level_cap_source === "TEST_ONLY_LEVEL_CAP_OVERRIDE_17", "parity level-cap override mismatch");
assert(slice.progression.pause_evolutions === false && slice.progression.evolution_level === 23, "parity evolution boundary mismatch");
assert(slice.progression.initial_moves_source === "ORACLE_COMPOSED_SUPPORTED_BATTLE_LOADOUT", "parity loadout source mismatch");
assert(slice.battle_content.move_ids.includes(34), "battle content omits Body Slam 34");
assert(JSON.stringify(slice.battle_content.m4_additional_move_ids) === "[34]", "M4 additional battle move closure must contain only Body Slam 34");
assert(slice.regular_reward_shop.supports_reroll === true && slice.regular_reward_shop.supports_locks === true, "regular shop must own reroll and locks");
assert(slice.biome_market.supports_reroll === false && slice.biome_market.supports_locks === false, "biome market must not expose reroll or locks");
assert(slice.encounter_candidates.length === 1 && slice.encounter_candidates[0].source === "ORACLE_CAPTURE_REQUIRED", "parity encounter must remain an explicit captured-vector prerequisite");
assert(slice.enemy_modifiers === "EMPTY_ONLY", "selected enemy modifiers must be empty-only");

const modifierIds = new Set();
const modifierKeys = new Set();
for (const entry of slice.modifier_ids) {
  assert(Number.isSafeInteger(entry.id) && entry.id > 0, `invalid ModifierId ${entry.id}`);
  assert(!modifierIds.has(entry.id), `duplicate ModifierId ${entry.id}`);
  assert(!modifierKeys.has(entry.key), `duplicate modifier key ${entry.key}`);
  modifierIds.add(entry.id);
  modifierKeys.add(entry.key);
}
const capabilities = manifests.get("m4-capability-manifest.json");
for (const key of capabilities.supported.modifier_registry_keys) {
  assert(modifierKeys.has(key), `supported modifier ${key} lacks a frozen numeric mapping`);
}
assert(capabilities.silent_noop_forbidden === true, "silent no-op policy must be forbidden");
assert(capabilities.replica_generation_forbidden === true, "replica generation must be forbidden");

const coverage = manifests.get("m4-coverage-map.json");
assert(coverage.fixture_requirements.initial_state === "ORACLE_EXPORTED_WAVE_9_CANONICAL_STATE", "coverage start-state requirement mismatch");
assert(coverage.fixture_requirements.driver === "RAW_PHYSICAL_KEYS_ONLY", "coverage raw-key requirement mismatch");

const oracle = manifests.get("m4-oracle-manifest.json");
assert(oracle.contract_state === "G13_PUBLISHED_FRESH_PROCESS_VERIFIED", "oracle publication state mismatch");
assert(oracle.parity_segment.semantic_shortcuts_forbidden === true, "semantic shortcuts must be forbidden");
assert(oracle.required_outputs.length === new Set(oracle.required_outputs).size, "oracle outputs must be unique");

const api = contractTexts.get("m4-api.md");
for (const required of [
  "GameState.player_party` is the only player-party owner",
  "<epoch>:<ownerSeat>:<KIND>:<address>",
  "V2/WAVE/e{epoch}/w{wave}/tick{tick}",
  "apply_authority_material",
  "oracle-exported wave-9 canonical state",
]) {
  assert(api.includes(required), `m4-api.md: missing frozen clause ${required}`);
}

const attestation = {
  schema_version: 1,
  milestone: "M4-G12",
  candidate_sha: process.env.GITHUB_SHA ?? "LOCAL_STATIC_CHECK",
  m3_base_sha: expectedSha,
  m4_oracle_sha: expectedSha,
  contract_files: contractNames,
  manifest_files: manifestNames,
  parity_segment: slice.segment.id,
  oracle_publication_state: oracle.contract_state,
};
const output = process.env.M4_ATTESTATION_PATH;
if (output) {
  await mkdir(dirname(join(root, output)), { recursive: true });
  await writeFile(join(root, output), `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(attestation));
