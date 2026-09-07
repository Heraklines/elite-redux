// Remote-only JSON conservation verifier. This does not replace the pinned source-method assertions.
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [root, output, phase] = process.argv.slice(2);
assert(root && output && ["exports", "compiled"].includes(phase));
const pin = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const fixture = join(root, "rust/fixtures/m9/engineering");
function bytes(path) {
  assert(statSync(path).size > 0 && statSync(path).size <= 32 * 1024 * 1024, path);
  return readFileSync(path);
}
function json(path) { return JSON.parse(bytes(path).toString("utf8")); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function sameFile(left, right) { assert(bytes(left).equals(bytes(right)), `${left} differs from ${right}`); }
function withoutExperience(value) {
  const copy = structuredClone(value);
  for (const row of copy.species) { assert(Object.hasOwn(row, "experience")); delete row.experience; }
  return copy;
}
const oldDefinitions = json(join(fixture, "complete-progression-definitions-v1.json"));
const definitions = json(join(output, "export-one.json"));
assert.equal(definitions.oracle_sha, pin);
assert.equal(definitions.schema_version, 1);
assert.equal(definitions.species.length, 3384);
assert.equal(oldDefinitions.species.length, 3384);
assert(oldDefinitions.species.every(row => !Object.hasOwn(row, "experience")));
sameFile(join(output, "export-one.json"), join(output, "export-two.json"));
const stripped = withoutExperience(definitions);
assert.deepEqual(stripped, oldDefinitions);
assert(Buffer.from(`${JSON.stringify(stripped)}\n`).equals(bytes(join(fixture, "complete-progression-definitions-v1.json"))),
  "removing only XP metadata must recover exact pinned export bytes");
const boosts = { mega: "MEGA", "mega-x": "MEGA_X", "mega-y": "MEGA_Y", primal: "PRIMAL",
  gigantamax: "GIGANTAMAX", eternamax: "ETERNAMAX" };
const groups = new Map();
const counts = {};
const examples = {};
for (const row of definitions.species) {
  const xp = row.experience;
  assert.deepEqual(Object.keys(xp).sort(), ["base_exp", "boost", "source_form", "source_form_count",
    "source_form_key", "source_sprite_key"].sort());
  assert(Number.isSafeInteger(row.species_id) && row.species_id > 0);
  assert(Number.isSafeInteger(row.form_index) && row.form_index >= 0 && row.form_index <= 65535);
  assert(Number.isSafeInteger(xp.base_exp) && xp.base_exp >= 0);
  assert(Number.isSafeInteger(xp.source_form_count) && xp.source_form_count >= 0 && xp.source_form_count <= 65535);
  assert.equal(typeof xp.source_sprite_key, "string");
  assert.equal(xp.source_form_key, row.form_key);
  assert(xp.source_form_key === null || typeof xp.source_form_key === "string");
  assert.equal(xp.boost, Object.hasOwn(boosts, xp.source_sprite_key) ? boosts[xp.source_sprite_key] : "OTHER");
  assert.deepEqual(xp.source_form, row.form_index === 0 ? { kind: "SPECIES" } : { kind: "FORM", index: row.form_index - 1 });
  if (!groups.has(row.species_id)) groups.set(row.species_id, []);
  groups.get(row.species_id).push(row);
  counts[xp.boost] = (counts[xp.boost] ?? 0) + 1;
  examples[xp.boost] ??= { species_id: row.species_id, form_index: row.form_index, ...xp };
}
for (const rows of groups.values()) {
  const count = rows[0].experience.source_form_count;
  assert.equal(rows.length, count + 1);
  rows.forEach((row, index) => {
    assert.equal(row.form_index, index);
    assert.equal(row.experience.source_form_count, count);
    if (index > 0) assert.equal(typeof row.experience.source_form_key, "string");
  });
  assert.equal(rows[0].experience.source_sprite_key, count ? rows[1].experience.source_sprite_key : "");
}
assert(counts.OTHER > 0 && Object.keys(counts).some(key => key !== "OTHER"));
const result = {
  schema_version: 1, phase, oracle_sha: pin, source_rows: 3384, species_groups: groups.size,
  fresh_export_byte_identity: true, stripped_full_structure_identity: true, stripped_original_byte_identity: true,
  stripped_sha256: hash(Buffer.from(`${JSON.stringify(stripped)}\n`)), boost_counts: counts,
  selected_semantic_rows: Object.values(examples),
  source_bound_method_checks_per_export: { get_base_exp: 3384, get_species_form: 3384 + groups.size,
    out_of_range_form_fallback: groups.size },
  source_method_evidence: "The two actual pinned Vitest executions assert unadjusted baseExp versus getBaseExp and initialized Pokemon.getSpeciesForm(true) for every row; this verifier independently checks exported metadata and conservation.",
};
if (phase === "compiled") {
  for (const [generated, checked] of [["old-pack.json", "progression-content-pack-v2.json"],
    ["old-bindings.json", "progression-behavior-bindings-v2.json"], ["old-report.json", "progression-oracle-report-v2.json"]]) {
    sameFile(join(output, generated), join(fixture, checked));
  }
  sameFile(join(output, "new-bindings.json"), join(fixture, "progression-behavior-bindings-v2.json"));
  const oldPack = json(join(output, "old-pack.json"));
  const newPack = json(join(output, "new-pack.json"));
  assert.equal(newPack.species.length, 3384);
  assert.match(newPack.content_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(newPack.content_hash, oldPack.content_hash);
  const normalizedPack = withoutExperience(newPack);
  normalizedPack.content_hash = oldPack.content_hash;
  assert.deepEqual(normalizedPack, oldPack);
  const byIdentity = new Map(definitions.species.map(row => [`${row.species_id}/${row.form_index}`, row.experience]));
  const seen = new Set();
  for (const row of newPack.species) {
    const key = `${row.species}/${row.form}`;
    assert(!seen.has(key) && byIdentity.has(key)); seen.add(key);
    assert.deepEqual(row.experience, byIdentity.get(key));
  }
  assert.equal(seen.size, 3384);
  const oldReport = json(join(output, "old-report.json"));
  const newReport = json(join(output, "new-report.json"));
  assert.equal(newReport.content_hash, newPack.content_hash);
  const normalizedReport = structuredClone(newReport); normalizedReport.content_hash = oldReport.content_hash;
  assert.deepEqual(normalizedReport, oldReport);
  const oldBundle = json(join(fixture, "game-content-bundle-v2.json"));
  const newBundle = json(join(output, "new-bundle.json"));
  assert.deepEqual(newBundle.progression, newPack);
  assert.notEqual(newBundle.content_hash, oldBundle.content_hash);
  const normalizedBundle = structuredClone(newBundle);
  normalizedBundle.content_hash = oldBundle.content_hash; normalizedBundle.progression = oldBundle.progression;
  assert.deepEqual(normalizedBundle, oldBundle);
  const oldManifest = json(join(fixture, "game-content-bundle-v2-manifest.json"));
  const newManifest = json(join(output, "new-bundle-manifest.json"));
  assert.equal(newManifest.content_hash, newBundle.content_hash);
  assert.equal(newManifest.components.progression, newPack.content_hash);
  const normalizedManifest = structuredClone(newManifest);
  normalizedManifest.content_hash = oldManifest.content_hash;
  normalizedManifest.components.progression = oldManifest.components.progression;
  assert.deepEqual(normalizedManifest, oldManifest);
  Object.assign(result, { old_compiler_three_files_byte_identity: true, evolution_bindings_byte_identity: true,
    compiled_metadata_identity: true, old_pack_structure_conserved: true, bundle_only_progression_changed: true,
    progression_content_hash: newPack.content_hash, bundle_content_hash: newBundle.content_hash, counts: newReport.counts });
}
const encoded = Buffer.from(`${JSON.stringify(result)}\n`);
assert(encoded.length <= 16384);
writeFileSync(join(output, `${phase}-validation.json`), encoded, { flag: "wx" });
