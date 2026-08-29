import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const M4_FINAL_SHA = "dde38446141880ec32331622307cc19105aee309";
const M5_ORACLE_SHA = "328824692f95b1aa1b38af85b54a6b72d9259eb4";
const M5_ORACLE_TREE_SHA = "55ea78195244827bbacb21f7e0531b0827eae137";
const CATALOG_SHA256 = "2c836841aaf7f736ae0b31faba2782d77dcd963eaa5033d3dfab9e182554459c";
const contractNames = [
  "m5-api.md",
  "m5-content-compiler.md",
  "m5-contract.toml",
  "m5-error-policy.md",
  "m5-mechanics-ir.md",
  "m5-oracle-export.md",
  "m5-ownership.toml",
  "m5-state-snapshot.md",
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

async function bytes(path) {
  return readFile(join(root, path));
}

async function text(path) {
  return (await bytes(path)).toString("utf8");
}

function parseFlatToml(source, label) {
  const values = new Map();
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = raw.replace(/\s+#.*$/u, "").trim();
    if (!line || line.startsWith("[")) {
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line);
    if (!match) {
      continue;
    }
    const [, key, encoded] = match;
    assert(!values.has(key), `${label}:${index + 1}: duplicate TOML key ${key}`);
    let value;
    if (/^"(?:[^"\\]|\\.)*"$/u.test(encoded)) {
      value = JSON.parse(encoded);
    } else if (/^(?:true|false)$/u.test(encoded)) {
      value = encoded === "true";
    } else if (/^-?\d+$/u.test(encoded)) {
      value = Number(encoded);
    } else {
      continue;
    }
    values.set(key, value);
  }
  return values;
}

function assertFrozenText(source, label) {
  assert(source.trim().length > 0, `${label}: empty contract`);
  assert(!/\b(?:TODO|TBD|PLACEHOLDER|FIXME)\b/u.test(source), `${label}: contains an unfrozen marker`);
}

const contractTexts = new Map();
for (const name of contractNames) {
  const source = await text(`rust/contracts/${name}`);
  assertFrozenText(source, name);
  contractTexts.set(name, source);
}

const contract = parseFlatToml(contractTexts.get("m5-contract.toml"), "m5-contract.toml");
const exact = {
  m4_base_sha: M4_FINAL_SHA,
  m4_gate_run_id: 32609726694,
  m5_oracle_sha: M5_ORACLE_SHA,
  m5_oracle_tree_sha: M5_ORACLE_TREE_SHA,
  m5_source_catalog_sha256: CATALOG_SHA256,
  game_state_schema_version: 3,
  battle_state_schema_version: 3,
  pokemon_state_schema_version: 3,
  battle_content_pack_schema_version: 2,
  run_content_pack_schema_version: 2,
  mechanics_ir_version: 1,
  mechanics_program_version: 1,
  mechanic_state_schema_version: 1,
  source_catalog_version: 1,
  classification_manifest_version: 1,
  bespoke_manifest_version: 1,
  battle_turn_material_version: 3,
  battle_replacement_material_version: 3,
  wave_advance_material_version: 2,
  run_interaction_material_version: 2,
  restorable_snapshot_version: 4,
  kernel_trace_version: 4,
  mechanical_digest_version: 3,
  kernel_determinism_digest_version: 3,
  pair_determinism_digest_version: 3,
  battle_content_hash_version: 2,
  production_typescript_read_only: true,
  dynamic_content_callbacks: false,
  embedded_script_content: false,
  dynamic_trait_object_content: false,
  source_catalog_move_count: 921,
  source_catalog_ability_count: 311,
  source_catalog_modifier_type_count: 215,
  source_catalog_status_count: 8,
  source_catalog_weather_count: 13,
  source_catalog_terrain_count: 6,
  source_catalog_battler_tag_count: 123,
  source_catalog_arena_tag_count: 42,
  source_catalog_positional_tag_count: 3,
  source_catalog_mechanic_class_count: 1122,
  source_catalog_attribute_attachment_count: 1787,
};
for (const [key, expected] of Object.entries(exact)) {
  assert(contract.get(key) === expected, `m5-contract.toml: ${key} must equal ${JSON.stringify(expected)}`);
}

const catalogBytes = await bytes("rust/fixtures/m5/source-catalog-v1.json");
assert(createHash("sha256").update(catalogBytes).digest("hex") === CATALOG_SHA256, "source catalog byte digest mismatch");
assert(catalogBytes.at(-1) === 0x0a, "source catalog must end in one LF");
const catalog = JSON.parse(catalogBytes.toString("utf8"));
const catalogCounts = {
  moves: 921,
  abilities: 311,
  modifier_types: 215,
  statuses: 8,
  weather: 13,
  terrain: 6,
  battler_tags: 123,
  arena_tags: 42,
  positional_tags: 3,
  mechanic_classes: 1122,
  attribute_attachments: 1787,
};
assert(catalog.schema_version === 1, "source catalog schema mismatch");
assert(catalog.oracle_sha === M5_ORACLE_SHA, "source catalog oracle SHA mismatch");
assert(catalog.oracle_tree_sha === M5_ORACLE_TREE_SHA, "source catalog tree SHA mismatch");
for (const [key, expected] of Object.entries(catalogCounts)) {
  assert(Array.isArray(catalog[key]) && catalog[key].length === expected, `source catalog ${key} count mismatch`);
}
for (const key of ["moves", "abilities"]) {
  assert(catalog[key].every(entry => Number.isSafeInteger(entry.numeric_id)), `${key} contains unresolved numeric IDs`);
}

const finalManifest = JSON.parse(await text("rust/fixtures/m4/m4-final-qualification.json"));
assert(finalManifest.milestone === "M4" && finalManifest.sha === M4_FINAL_SHA, "M4 final manifest identity mismatch");
assert(finalManifest.gate_run_id === 32609726694, "M4 final manifest run mismatch");
for (const [key, value] of Object.entries(finalManifest)) {
  if (!new Set(["milestone", "sha", "gate_run_id"]).has(key)) {
    assert(value === "success", `M4 final manifest ${key} must be success`);
  }
}

const ownership = contractTexts.get("m5-ownership.toml");
for (const required of [
  "rust/crates/er-mechanics/**",
  "rust/crates/er-content-compiler/**",
  "rust/crates/er-state/src/migration_v3.rs",
  "rust/crates/er-kernel/src/snapshot_v4.rs",
  ".github/workflows/rust-kernel-m5.yml",
]) {
  assert(ownership.includes(`"${required}"`), `m5-ownership.toml: missing ${required}`);
}

const attestation = {
  schema_version: 1,
  milestone: "M5",
  gate: "G16_CONTRACT_BOOTSTRAP",
  m4_base_sha: M4_FINAL_SHA,
  oracle_sha: M5_ORACLE_SHA,
  oracle_tree_sha: M5_ORACLE_TREE_SHA,
  source_catalog_sha256: CATALOG_SHA256,
  contract_versions: Object.fromEntries([...contract].filter(([key]) => key.endsWith("_version"))),
  catalog_counts: catalogCounts,
};
const attestationPath = process.env.M5_ATTESTATION_PATH ?? "artifacts/m5-g16-attestation.json";
await mkdir(dirname(join(root, attestationPath)), { recursive: true });
await writeFile(join(root, attestationPath), `${JSON.stringify(attestation)}\n`);
console.log(`M5 contract freeze: validated ${contractNames.length} contracts and ${Object.values(catalogCounts).reduce((sum, count) => sum + count, 0)} catalog entries`);
