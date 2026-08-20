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

const manifests = new Map();
for (const name of manifestNames) {
  const source = await text(`rust/fixtures/m4/${name}`);
  assertNoDraftMarkers(source, name);
  const value = JSON.parse(source);
  assert(value.schema_version === 1, `${name}: schema_version must be 1`);
  manifests.set(name, value);
}

const slice = manifests.get("m4-slice-manifest.json");
assert(slice.m3_base_sha === expectedSha && slice.oracle_game_sha === expectedSha, "slice provenance mismatch");
assert(slice.segment.start_wave === 9 && slice.segment.end_wave === 11, "slice wave range mismatch");
assert(slice.segment.initial_biome.id === 0 && slice.segment.selected_biome.id === 1, "slice biome choice mismatch");
assert(slice.segment.driver === "raw-physical-keys-only", "slice driver must be raw keys");
assert(slice.segment.natural_single_seed_claim === false, "composed slice may not claim a natural seed");
assert(slice.progression.species.id === 7, "parity progression species must be Squirtle 7");
assert(slice.progression.growth_rate.id === 3, "parity progression growth must be Medium Slow 3");
assert(slice.progression.parity_level_before === 8 && slice.progression.parity_level_after === 9, "parity progression must cross 8 to 9");
assert(slice.progression.level_move_candidates.length === 1 && slice.progression.level_move_candidates[0].id === 229, "parity move must be Rapid Spin 229");
assert(JSON.stringify(slice.progression.parity_initial_moves) === "[33,39,55,110]", "parity initial moves mismatch");
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
assert(oracle.contract_state === "G12_FROZEN_EXPORT_REQUIRED_BEFORE_M4B", "oracle publication state mismatch");
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
