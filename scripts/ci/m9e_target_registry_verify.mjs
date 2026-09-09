import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const abilityIds = [0,18,41,43,47,49,51,62,65,66,67,75,82,94,113,172,192,257,268,5006,5033,5082,5097,5115];
const moveIds = [10,33,39,40,43,45,57,61,64,78,79,98,103,105,108,110,165,230,310,331,336,448,458,497,501,541,580];
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
  assert.equal(row.schema_version, 4);
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
    keys(a, ["id","name","attrs","conditions","meta_kinds","post_faint","post_knock_out","post_victory","spread","spread_flags","redirect_types","studio_capabilities","studio_sources","bypass_faint","suppressable","shattered_id"]);
    assert(typeof a.name === "string" && a.name.length <= 256);
    attrs(a.attrs);
    assert(Array.isArray(a.meta_kinds) && a.meta_kinds.every(kind => typeof kind === "string" && /^[a-z][a-z0-9-]{0,127}$/.test(kind))); integer(a.conditions, 0, 128);
    for (const key of ["spread","bypass_faint","suppressable","shattered_id","post_faint","post_knock_out","post_victory"]) bool(a[key]);
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
    keys(m, ["id","name","target","attrs","variable","multi_hit","pulse","sound_based","post_victory_stat"]);
    assert(typeof m.name === "string" && m.name.length <= 256);
    assert(kinds.includes(m.target)); attrs(m.attrs);
    for (const key of ["variable","multi_hit","pulse","sound_based","post_victory_stat"]) bool(m[key]);
  }
  assert.equal(row.moves.find(m => m.id === 448).sound_based, true);
}
assert.equal(process.argv.length, 7);
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
  r => { r.moves.find(m => m.id === 448).sound_based = false; },
  r => { r.roster_sha256 = "0".repeat(64); },
  r => { r.abilities[0].extra = true; },
  r => { r.abilities[0].post_faint = 0; },
  r => { r.abilities[0].post_knock_out = null; },
  r => { r.abilities[0].post_victory = "false"; },
  r => { r.moves[0].post_victory_stat = undefined; },
]) {
  const copy = structuredClone(row); mutate(copy);
  assert.throws(() => validate(copy)); rejected++;
}
// Exercise the actual pinned queue. The payloads reproduce only the reviewed
// insertion callsites; this is deliberately not a full battle-engine witness.
const oracle = resolve(process.argv[5]);
const pinFile = fs.lstatSync(process.argv[6]);
assert(pinFile.isFile() && !pinFile.isSymbolicLink() && pinFile.size <= 32768);
const pins = JSON.parse(fs.readFileSync(process.argv[6]));
assert.equal(pins.oracle, row.source_sha);
const required = ["src/phase-tree.ts", "src/phase-manager.ts", "src/phases/turn-start-phase.ts",
  "src/phases/move-phase.ts", "src/phases/move-effect-phase.ts", "src/phases/faint-phase.ts",
  "src/phases/victory-phase.ts", "src/field/pokemon.ts", "src/battle-scene.ts",
  "src/data/elite-redux/archetypes/ability-meta-consumers.ts"];
keys(pins.sources, required);
const sources = new Map();
const sourceHashes = {};
for (const path of required) {
  const input = resolve(oracle, path);
  assert(input.startsWith(oracle + sep));
  const stat = fs.lstatSync(input);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024);
  const bytes = fs.readFileSync(input);
  assert.equal(bytes.length, pins.sources[path][1]);
  assert.equal(digest(bytes), pins.sources[path][0]);
  sourceHashes[path] = digest(bytes);
  sources.set(path, bytes.toString("utf8"));
}
const contains = (path, text) => assert(sources.get(path).includes(text), `${path}: ${text}`);
contains("src/phase-manager.ts", 'this.phaseQueue.addPhase(this.create("FaintPhase", ...args), true);');
contains("src/phase-manager.ts", "this.phaseQueue.pushPhase(this.checkDynamic(phase));");
contains("src/phases/turn-start-phase.ts", 'globalScene.phaseManager.pushNew(\n      "MovePhase",');
contains("src/phases/turn-start-phase.ts", "globalScene.phaseManager.queueTurnEndPhases();");
contains("src/phases/move-phase.ts", 'globalScene.phaseManager.unshiftNew("MoveEffectPhase", user.getBattlerIndex(), targets, move, this.useMode);');
contains("src/phases/move-phase.ts", 'globalScene.phaseManager.unshiftNew(\n      "MoveEndPhase",');
contains("src/phases/move-effect-phase.ts", "globalScene.phaseManager.queueFaintPhase(");
contains("src/field/pokemon.ts", "globalScene.phaseManager.queueFaintPhase(this.getBattlerIndex(), preventEndure);");
contains("src/phases/faint-phase.ts", 'globalScene.phaseManager.unshiftNew("VictoryPhase", this.battlerIndex);');
for (const family of ["PostFaintAbAttr", "PostKnockOutAbAttr", "PostVictoryAbAttr"])
  contains("src/phases/faint-phase.ts", `applyAbAttrs("${family}"`);
contains("src/phases/faint-phase.ts", 'pvmove.getAttrs("PostVictoryStatStageChangeAttr")');
contains("src/phases/victory-phase.ts", "globalScene.applyPartyExp(expValue, true);");
contains("src/data/elite-redux/archetypes/ability-meta-consumers.ts", 'Reflect.get(attr, "erMetaKind") === kind');
contains("src/data/elite-redux/archetypes/ability-meta-consumers.ts", 'eligibleAttrs<ExperienceGainMarker>(pokemon, "experience-gain-multiplier").reduce(');
const { PhaseTree } = await import(pathToFileURL(resolve(oracle, "src/phase-tree.ts")).href);
function queueCase(name, nested, laterFaint, faintChild) {
  const tree = new PhaseTree();
  const order = [];
  let hp = 20;
  let hpAtVictory;
  const phase = (phaseName, body = () => {}) => ({phaseName, body, is: candidate => candidate === phaseName});
  const victory = phase("Victory", () => { hpAtVictory = hp; });
  const enemyFaint = phase("EnemyFaint", () => {
    if (faintChild) tree.addPhase(phase("PostFaintChild", () => { hp = 0; }));
    tree.addPhase(victory);
  });
  const effect = phase("EarlierMoveEffect", () => { tree.addPhase(enemyFaint, true); });
  tree.pushPhase(phase("EarlierMove", () => {
    if (nested) { tree.addPhase(effect); tree.addPhase(phase("EarlierMoveEnd")); }
    else tree.addPhase(enemyFaint, true);
  }));
  tree.pushPhase(phase("LaterMove", () => {
    if (laterFaint) tree.addPhase(phase("LaterMoveEffect", () => {
      hp = 0; tree.addPhase(phase("PlayerFaint"), true);
    }));
  }));
  for (const label of ["CheckInterlude", "Weather", "PositionalTag", "Berry", "CheckStatus", "TurnEnd"])
    tree.pushPhase(phase(label));
  for (let budget = 0; budget < 32; budget++) {
    const next = tree.getNextPhase();
    if (!next) break;
    order.push(next.phaseName); next.body();
  }
  assert.equal(tree.getNextPhase(), undefined);
  for (const label of ["EarlierMove", "LaterMove", "EnemyFaint", "Victory", "TurnEnd"])
    assert.equal(order.filter(value => value === label).length, 1);
  assert(order.indexOf("EnemyFaint") < order.indexOf("Victory"));
  if (nested) {
    assert(order.indexOf("EarlierMoveEnd") < order.indexOf("EnemyFaint"));
    assert(order.indexOf("Victory") < order.indexOf("LaterMove"));
    assert(order.indexOf("Victory") < order.indexOf("TurnEnd"));
  } else assert(order.indexOf("TurnEnd") < order.indexOf("Victory"));
  if (faintChild) assert(order.indexOf("PostFaintChild") < order.indexOf("Victory"));
  assert.equal(hpAtVictory, faintChild ? 0 : 20);
  assert.equal(hp, laterFaint || faintChild ? 0 : 20);
  return {name, nested_move_effect:nested, order, hp_at_victory:hpAtVictory,
    hp_after_turn:hp, friendship_eligible_at_victory:hpAtVictory > 0};
}
const cases = [queueCase("nested-living-through-turn", true, false, false),
  queueCase("nested-victory-before-later-player-faint", true, true, false),
  queueCase("nested-post-faint-child-before-victory", true, false, true),
  queueCase("flattened-counterexample-is-not-source-move-nesting", false, false, false)];
const phaseOrder = {scope:"actual PhaseTree with source-bound labeled callers; not full battle execution",
  source_hashes:sourceHashes, cases,
  required_runtime_boundary:"Victory occurs in the MoveEffect child subtree before the next base Move; turn-end recipient HP is not the source award-time preimage"};
const families = {post_faint:row.abilities.filter(a => a.post_faint).map(a => a.id),
  post_knock_out:row.abilities.filter(a => a.post_knock_out).map(a => a.id),
  post_victory:row.abilities.filter(a => a.post_victory).map(a => a.id),
  post_victory_stat:row.moves.filter(m => m.post_victory_stat).map(m => m.id),
  experience_meta:row.abilities.filter(a => a.meta_kinds.includes("experience-gain-multiplier")).map(a => a.id)};
const output = `${JSON.stringify({schema_version:2,status:"passed",scope:"registry observations and actual source queue nesting; no gameplay or general neutrality qualification",source_sha:row.source_sha,ability_count:24,move_count:27,negative_cases:rejected,families,phase_order:phaseOrder,exports:raws.map(raw => ({bytes:raw.length,sha256:digest(raw)}))})}\n`;
assert(Buffer.byteLength(output) <= 8192);
fs.writeFileSync(process.argv[4], output, {flag:"wx"});
