import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const abilityIds = [0,18,41,43,47,49,51,62,65,66,67,75,82,94,113,172,192,257,268,5006,5033,5082,5097,5115];
const moveIds = [10,33,39,40,43,45,57,61,64,78,79,98,103,105,108,110,165,230,310,331,336,458,497,501,541,580];
const digest = raw => crypto.createHash("sha256").update(raw).digest("hex");
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const bool = value => assert.equal(typeof value, "boolean");
const integer = (value, min, max) => assert(Number.isSafeInteger(value) && value >= min && value <= max);
const attrs = value => {
  assert(Array.isArray(value) && value.length <= 128);
  for (const name of value) assert(typeof name === "string" && /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(name));
};
function validate(row) {
  keys(row, ["schema_version","source_sha","seed","scope","roster_source_sha","roster_run_id","roster_sha256","shattered_ability_id","abilities","moves"]);
  assert.equal(row.schema_version, 2);
  assert.equal(row.source_sha, "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7");
  assert.equal(row.seed, "m9e-target-registry-source-v1");
  assert.equal(row.scope, "actual initialized registry diagnostic; no ability activation, target execution or neutrality claim");
  assert.equal(row.roster_source_sha, "f0a2b8c185a4e68dc88b4ea0b34128aeb8b28356");
  assert.equal(row.roster_run_id, "34373633488");
  assert.equal(row.roster_sha256, "52ed4b310f5f5fcb69a9ae17b1235d244a3719668fce7ef3c01a643be846e186");
  assert.equal(row.shattered_ability_id, 5968);
  assert.deepEqual(row.abilities.map(a => a.id), abilityIds);
  assert.deepEqual(row.moves.map(m => m.id), moveIds);
  for (const a of row.abilities) {
    keys(a, ["id","name","attrs","conditions","spread","spread_flags","redirect_types","studio_capabilities","studio_sources","bypass_faint","suppressable","shattered_id"]);
    assert(typeof a.name === "string" && a.name.length <= 256);
    attrs(a.attrs); integer(a.conditions, 0, 128);
    for (const key of ["spread","bypass_faint","suppressable","shattered_id"]) bool(a[key]);
    assert.equal(a.shattered_id, a.id === row.shattered_ability_id);
    assert(Array.isArray(a.spread_flags) && a.spread_flags.length <= 128);
    assert.equal(a.spread, a.spread_flags.length > 0);
    for (const flag of a.spread_flags) integer(flag, 1, 2 ** 31);
    for (const field of ["redirect_types","studio_capabilities","studio_sources"]) assert(Array.isArray(a[field]) && a[field].length <= 128);
    for (const type of a.redirect_types) integer(type, 0, 255);
    for (const id of a.studio_sources) integer(id, 0, 1000000);
    for (const capability of a.studio_capabilities) assert(typeof capability === "string" && /^[a-z][a-z0-9-]{0,127}$/.test(capability));
  }
  const kinds = ["USER","NEAR_OTHER","ALL_NEAR_OTHERS","NEAR_ENEMY","ALL_NEAR_ENEMIES","RANDOM_NEAR_ENEMY","ALL_ENEMIES","ATTACKER","NEAR_ALLY","ALLY","USER_OR_NEAR_ALLY","USER_AND_ALLIES","ALL","USER_SIDE","ENEMY_SIDE","BOTH_SIDES","PARTY","CURSE","OTHER","ALL_OTHERS"];
  for (const m of row.moves) {
    keys(m, ["id","name","target","attrs","variable","multi_hit","pulse"]);
    assert(typeof m.name === "string" && m.name.length <= 256);
    assert(kinds.includes(m.target)); attrs(m.attrs);
    for (const key of ["variable","multi_hit","pulse"]) bool(m[key]);
  }
}
assert.equal(process.argv.length, 5);
const raws = process.argv.slice(2, 4).map(path => {
  const stat = fs.lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 32768);
  return fs.readFileSync(path);
});
assert(raws[0].equals(raws[1]));
const row = JSON.parse(raws[0]);
validate(row);
let rejected = 0;
for (const mutate of [
  r => { r.abilities[0].spread = 0; },
  r => { r.abilities.pop(); },
  r => { r.moves[0].variable = null; },
  r => { r.moves.reverse(); },
  r => { r.roster_sha256 = "0".repeat(64); },
  r => { r.abilities[0].extra = true; },
]) {
  const copy = structuredClone(row); mutate(copy);
  assert.throws(() => validate(copy)); rejected++;
}
const output = `${JSON.stringify({schema_version:1,status:"passed",scope:"registry schema/provenance and fresh-process equality only; source behavior still requires review",source_sha:row.source_sha,ability_count:24,move_count:26,negative_cases:rejected,exports:raws.map(raw => ({bytes:raw.length,sha256:digest(raw)}))})}\n`;
assert(Buffer.byteLength(output) <= 8192);
fs.writeFileSync(process.argv[4], output, {flag:"wx"});
