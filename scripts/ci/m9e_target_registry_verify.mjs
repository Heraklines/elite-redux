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
function validateDaily(d) {
  keys(d,["scope","starter_keys","effective_count","tuning_has_override","tuning_override","clock_cases","repeated","positive_days","scan_limit","scanned_days","source_calls"]);
  assert.equal(d.scope,"actual getPokerusStarters with captured Date and unmocked Phaser RNG; identity membership matches starter selection predicate, not UI execution");
  assert.equal(d.starter_keys.length,570);
  assert.equal(new Set(d.starter_keys).size,570);
  for (const key of d.starter_keys) assert(typeof key === "string" && /^[1-9][0-9]{0,8}$/.test(key));
  assert.deepEqual(d.starter_keys,[...d.starter_keys].sort((a,b)=>Number(a)-Number(b)));
  integer(d.effective_count,1,10);bool(d.tuning_has_override);
  if (!d.tuning_has_override) assert.equal(d.tuning_override,null);
  const raw=d.tuning_override;
  const resolved=Number.isInteger(raw) && raw>=0 && raw<=10 ? raw : 5;
  assert.equal(d.effective_count,resolved);
  const times=[0,1,86_399_999,86_400_000,-1,-86_400_000,-86_400_001,1_783_641_600_000,8_640_000_000_000_000,-8_640_000_000_000_000];
  assert.deepEqual(d.clock_cases.map(c=>c.milliseconds),times);
  function observation(c) {
    keys(c,["milliseconds","midnight","seed","ids","selected_starters","before","after"]);
    integer(c.milliseconds,-8_640_000_000_000_000,8_640_000_000_000_000);
    assert.equal(c.midnight,Math.floor(c.milliseconds/86_400_000)*86_400_000);
    assert.equal(c.seed,String(c.midnight));
    assert.equal(c.ids.length,d.effective_count);assert.equal(new Set(c.ids).size,c.ids.length);
    for(const id of c.ids){integer(id,1,100000000);assert(d.starter_keys.includes(String(id)));}
    keys(c.before,["rng","offset","seed_override"]);
    assert(typeof c.before.rng === "string" && c.before.rng.startsWith("!rnd,") && c.before.rng.length<=256);
    integer(c.before.offset,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER);
    assert(typeof c.before.seed_override === "string" && c.before.seed_override.length<=256);
    assert.deepEqual(c.after,c.before);
    assert.deepEqual(c.before,d.clock_cases[0].before);
    assert.deepEqual(c.selected_starters.map(s=>s.id),[1,4,7]);
    for(const s of c.selected_starters){keys(s,["id","pokerus"]);bool(s.pokerus);assert.equal(s.pokerus,c.ids.includes(s.id));}
  }
  for(const c of [...d.clock_cases,d.repeated,...d.positive_days]) observation(c);
  assert.deepEqual(d.repeated,d.clock_cases[0]);
  assert.deepEqual(d.clock_cases[0].ids,d.clock_cases[1].ids);
  assert.deepEqual(d.clock_cases[0].ids,d.clock_cases[2].ids);
  assert.deepEqual(d.clock_cases[4].ids,d.clock_cases[5].ids);
  assert.equal(d.scan_limit,4096);integer(d.scanned_days,1,4096);
  assert.equal(d.source_calls,times.length+1+d.scanned_days);
  integer(d.positive_days.length,1,3);
  const found=new Set();let prior=-1;
  for(const c of d.positive_days){
    assert(c.milliseconds>prior && c.milliseconds>=0 && c.milliseconds%86_400_000===0);
    assert(c.milliseconds/86_400_000<d.scanned_days);prior=c.milliseconds;
    let fresh=false;
    for(const s of c.selected_starters) if(s.pokerus && !found.has(s.id)){fresh=true;found.add(s.id);}
    assert(fresh);
  }
  assert.deepEqual([...found].sort((a,b)=>a-b),[1,4,7]);
  assert.equal(d.positive_days.at(-1).milliseconds/86_400_000+1,d.scanned_days);
}
function validateStats(s) {
  keys(s,["scope","context","original_custom_nature","cases","original_fields_restored","custom_data_restored","rng_restored"]);
  assert.equal(s.scope,"actual calculateStats on controlled fresh player fields; not XP or LevelUpPhase");
  keys(s.context,["species","form","modifiers","challenges","spliced","spliced_source_type","fun_mode","fun_source_type","fusion","fun_pseudo_mega","fun_shuffle","cursed_stat","moody","wonder_guard"]);
  const c=s.context;assert.equal(c.species,1);assert.equal(c.form,0);assert.equal(c.modifiers,0);assert.equal(c.challenges,0);
  for(const key of ["spliced","fun_mode","fusion","fun_pseudo_mega","fun_shuffle","wonder_guard"]) assert.equal(c[key],false);
  assert.equal(c.spliced_source_type,"undefined");assert.equal(c.fun_source_type,"undefined");
  assert.equal(c.cursed_stat,-1);assert.equal(c.moody,null);
  integer(s.original_custom_nature,-1,24);
  for(const key of ["original_fields_restored","custom_data_restored","rng_restored"]) assert.equal(s[key],true);
  const names=["hardy-level5-missing-hp","hardy-level6-carry-hp","lonely-level6","modest-level13","hardy-level7-fainted","hardy-level4-clamp"];
  assert.deepEqual(s.cases.map(c=>c.name),names);
  assert.deepEqual(s.cases.map(c=>c.level),[5,6,6,13,7,4]);
  assert.deepEqual(s.cases.map(c=>c.nature),[0,0,1,15,0,0]);
  const expectedIvs=[[0,1,2,3,4,5],[0,1,2,3,4,5],Array(6).fill(31),Array(6).fill(0),Array(6).fill(0),Array(6).fill(0)];
  for(const [i,row] of s.cases.entries()){
    keys(row,["name","level","nature","ivs","pre_stats","pre_hp","base_stats","post_stats","post_hp"]);
    assert.deepEqual(row.ivs,expectedIvs[i]);
    for(const key of ["pre_stats","base_stats","post_stats"]){assert.equal(row[key].length,6);for(const value of row[key]) integer(value,1,Number.MAX_SAFE_INTEGER);}
    assert.deepEqual(row.base_stats,s.cases[0].base_stats);
    integer(row.pre_hp,0,Number.MAX_SAFE_INTEGER);integer(row.post_hp,0,row.post_stats[0]);
  }
  const [a,b,,high,dead,clamp]=s.cases;
  assert.equal(a.pre_hp,7);assert.equal(b.pre_hp,a.post_hp);assert.deepEqual(b.pre_stats,a.post_stats);
  assert.equal(s.cases[2].pre_hp,7);assert.equal(high.pre_hp,7);
  assert.equal(dead.pre_hp,0);assert.equal(dead.post_hp,0);
  assert.deepEqual(clamp.pre_stats,high.post_stats);assert.equal(clamp.pre_hp,high.post_stats[0]);
  assert(clamp.post_stats[0]<clamp.pre_stats[0]);assert.equal(clamp.post_hp,clamp.post_stats[0]);
  assert(b.post_stats[0]>a.post_stats[0]);assert.equal(b.post_hp,b.pre_hp+b.post_stats[0]-b.pre_stats[0]);
  // The data is source-method output. Rust comparison owns the independent stat
  // calculation; this validator binds controlled inputs and observed HP edges.
}
function validate(row) {
  keys(row, ["schema_version","source_sha","seed","scope","roster_source_sha","roster_run_id","roster_sha256","shattered_ability_id","abilities","moves","daily_pokerus","stats","balance"]);
  assert.equal(row.schema_version, 5);
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
    keys(m, ["id","name","target","category","accuracy","power","pp","attrs","variable","multi_hit","pulse","sound_based","post_victory_stat","no_effect","no_effect_attrs"]);
    assert(typeof m.name === "string" && m.name.length <= 256);
    assert(kinds.includes(m.target)); attrs(m.attrs);
    integer(m.category,0,2);integer(m.accuracy,-1,100);integer(m.power,-1,1000);integer(m.pp,1,100);
    for (const key of ["variable","multi_hit","pulse","sound_based","post_victory_stat","no_effect"]) bool(m[key]);
  }
  assert.equal(row.moves.find(m => m.id === 448).sound_based, true);
  for (const move of row.moves) { assert.equal(move.no_effect, false); assert.deepEqual(move.no_effect_attrs, []); }
  validateDaily(row.daily_pokerus);
  validateStats(row.stats);
  keys(row.balance,["battle_friendship_gain","values"]);assert.equal(row.balance.battle_friendship_gain,3);
  assert.deepEqual(row.balance.values.map(v=>v.key),["vanilla.friendship.lossFaint","vanilla.friendship.candyMultClassic"]);
  for(const [i,v] of row.balance.values.entries()){
    keys(v,["key","has_override","raw_override","effective"]);bool(v.has_override);
    if(!v.has_override) assert.equal(v.raw_override,null);
    const r=v.raw_override;const valid=typeof r === "number" && Number.isFinite(r) && (i===0 ? Number.isInteger(r) && r>=0 && r<=100 : r>=1 && r<=10);
    assert.equal(v.effective,valid ? r : i===0 ? 5 : 3);
  }
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
  r => { r.moves[0].no_effect = true; },
  r => { r.stats.cases[4].post_hp = 1; },
  r => { r.balance.battle_friendship_gain = 4; },
  r => { r.stats.original_fields_restored = false; },
  r => { r.moves[0].no_effect_attrs = ["InheritedNoEffectAttr"]; },
  r => { r.daily_pokerus.clock_cases[4].midnight = 0; },
  r => { r.daily_pokerus.clock_cases[0].after.offset += 1; },
  r => { r.daily_pokerus.starter_keys.reverse(); },
  r => { r.daily_pokerus.positive_days = []; },
  r => { r.daily_pokerus.effective_count = 3; r.daily_pokerus.tuning_has_override = false; r.daily_pokerus.tuning_override = null; },
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
const output = `${JSON.stringify({schema_version:2,status:"passed",scope:"registry observations and actual source queue nesting; no gameplay or general neutrality qualification",source_sha:row.source_sha,ability_count:24,move_count:27,negative_cases:rejected,families,phase_order:phaseOrder,no_effect_family_ids:row.moves.filter(m=>m.no_effect).map(m=>m.id),daily_pokerus:{clock_cases:row.daily_pokerus.clock_cases.length,positive_starters:[1,4,7],effective_count:row.daily_pokerus.effective_count,starter_key_count:570,source_calls:row.daily_pokerus.source_calls,rng_restored:true},stat_cases:row.stats.cases.length,balance:row.balance,exports:raws.map(raw => ({bytes:raw.length,sha256:digest(raw)}))})}\n`;
assert(Buffer.byteLength(output) <= 8192);
fs.writeFileSync(process.argv[4], output, {flag:"wx"});
