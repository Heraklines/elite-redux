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
  assert.equal(d.starter_keys.length,706);
  assert.equal(new Set(d.starter_keys).size,706);
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
  keys(s.context,["species","form","modifiers","modifier_observations","challenges","spliced","spliced_source_type","fun_mode","fun_source_type","fusion","fun_pseudo_mega","fun_shuffle","cursed_stat","moody","wonder_guard"]);
  const c=s.context;assert.equal(c.species,1);assert.equal(c.form,0);assert.equal(c.modifiers,1);assert.equal(c.challenges,0);
  for(const key of ["spliced","fun_mode","fusion","fun_pseudo_mega","fun_shuffle","wonder_guard"]) assert.equal(c[key],false);
  assert.equal(c.spliced_source_type,"undefined");assert.equal(c.fun_source_type,"undefined");
  assert.equal(c.cursed_stat,-1);assert.equal(c.moody,null);
  assert.equal(c.modifier_observations.length,1);
  for(const m of c.modifier_observations){
    keys(m,["constructor","type_id","stack_count","virtual_stack_count","total_stacks","stat_families","xp_families"]);
    assert(typeof m.constructor === "string" && m.constructor.length>0);
    assert(typeof m.type_id === "string" && m.type_id.length>0);
    integer(m.stack_count,0,Number.MAX_SAFE_INTEGER);integer(m.virtual_stack_count,0,Number.MAX_SAFE_INTEGER);
    assert.equal(m.total_stacks,m.stack_count+m.virtual_stack_count);
    assert.deepEqual(m.stat_families,[false,false,false,false,false]);
    assert.deepEqual(m.xp_families,[false,false,false,false,false,false]);
  }
  integer(s.original_custom_nature,-1,24);
  for(const key of ["original_fields_restored","custom_data_restored","rng_restored"]) assert.equal(s[key],true);
  const names=["hardy-level5-missing-hp","hardy-level6-carry-hp","lonely-level6","modest-level13","hardy-level7-fainted","hardy-level4-clamp"];
  assert.deepEqual(s.cases.map(c=>c.name),names);
  assert.deepEqual(s.cases.map(c=>c.level),[5,6,6,13,7,4]);
  assert.deepEqual(s.cases.map(c=>c.nature),[0,0,1,15,0,0]);
  const expectedIvs=[[0,1,2,3,4,5],[0,1,2,3,4,5],Array(6).fill(31),Array(6).fill(0),Array(6).fill(0),Array(6).fill(0)];
  for(const [i,row] of s.cases.entries()){
    keys(row,["name","level","nature","ivs","pre_stats","pre_hp","base_stats","post_stats","post_hp","hp_before","hp_after"]);
    for(const hp of [row.hp_before,row.hp_after]){keys(hp,["multiplier","debt","max_hp"]);assert.equal(hp.multiplier,1);assert.equal(hp.debt,0);integer(hp.max_hp,1,Number.MAX_SAFE_INTEGER);}
    assert.equal(row.hp_before.max_hp,row.pre_stats[0]);assert.equal(row.hp_after.max_hp,row.post_stats[0]);
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
// Pinned399d enums: WILD=0, CLASSIC=0, TOWN=0; SINGLE_FORMAT.id="single".
// Source override defaults: health_segments=0, species=null, level=0.
// These are assertions for the unchanged startup, not replacement observations.
function validateInitialEncounter(value) {
  keys(value,["scope","wave","battle_type","mode","biome","trainer_absent","double","format","cadence_boss","overrides","enemies","rng_unchanged"]);
  assert.equal(value.scope,"actual fresh initial encounter before controlled observations; not later waves or custom doubles");
  assert.equal(value.wave,1);
  assert.equal(value.battle_type,0);
  assert.equal(value.mode,0);
  assert.equal(value.biome,0);
  assert.equal(value.trainer_absent,true);
  assert.equal(value.double,false);
  assert.equal(value.format,"single");
  assert.equal(value.cadence_boss,false);
  assert.equal(value.rng_unchanged,true);
  keys(value.overrides,["health_segments","species","level"]);
  for (const field of Object.values(value.overrides)) keys(field,["source_type","value"]);
  assert.deepEqual(value.overrides.health_segments,{source_type:"number",value:0});
  assert.deepEqual(value.overrides.species,{source_type:"object",value:null});
  assert.deepEqual(value.overrides.level,{source_type:"number",value:0});
  assert(Array.isArray(value.enemies));
  assert.equal(value.enemies.length,1);
  for (const row of value.enemies) {
    keys(row,["id","species","form","level","boss_segments","boss_segment_index","is_boss","predicate_segments","sub_legendary","legendary","mythical"]);
    integer(row.id,0,Number.MAX_SAFE_INTEGER);
    integer(row.species,1,Number.MAX_SAFE_INTEGER);
    integer(row.form,0,Number.MAX_SAFE_INTEGER);
    integer(row.level,1,Number.MAX_SAFE_INTEGER);
    for (const key of ["boss_segments","boss_segment_index","predicate_segments"]) assert.equal(row[key],0);
    for (const key of ["is_boss","sub_legendary","legendary","mythical"]) assert.equal(row[key],false);
  }
}

// Invoke on an ACTUAL already-validated sidecar. Each clone changes just the
// named receipt fact; no synthetic passing fixture or production mutation.
function initialEncounterMutants(actual) {
  const mutations = [
    ["initial-missing-predicate", v => { delete v.enemies[0].predicate_segments; }],
    ["initial-boss-owner", v => { v.enemies[0].boss_segments = 1; }],
    ["initial-boss-predicate", v => { v.enemies[0].predicate_segments = 1; }],
    ["initial-legendary", v => { v.enemies[0].legendary = true; }],
    ["initial-forced-nonboss", v => { v.overrides.health_segments.value = 1; }],
    ["initial-species-override", v => { v.overrides.species = {source_type:"number",value:16}; }],
    ["initial-missing-override-vs-null", v => { v.overrides.species.source_type = "undefined"; }],
    ["initial-double", v => { v.double = true; v.format = "double"; }],
    ["initial-trainer", v => { v.trainer_absent = false; }],
    ["initial-rng-moved", v => { v.rng_unchanged = false; }],
    ["initial-false-is-not-zero", v => { v.enemies[0].boss_segments = false; }],
    ["initial-extra-owner", v => { v.enemies[0].unbound_owner = true; }],
  ];
  for (const [, mutate] of mutations) {
    const value = structuredClone(actual);
    mutate(value);
    assert.throws(() => validateInitialEncounter(value));
  }
  return mutations.map(([name]) => name);
}

const hex = value => assert(typeof value === "string" && /^[0-9a-f]{64}$/.test(value));
const decimal = value => assert(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && value.length<=1024);
const defaultSpecies = [1,4,7,152,155,158,252,255,258,387,390,393,495,498,501,650,653,656,722,725,728,810,813,816,906,909,912];
function validateDex(d) {
  keys(d,["scope","initial","context","cases","root_uncaught","genderless_dex_attr","original_account_unchanged"]);
  assert.equal(d.scope,"actual initDexData/initStarterData through public fromRaw constructor, then direct ordered account methods; not Pokemon.evolve or phase execution");
  assert.equal(d.original_account_unchanged,true);
  const i=d.initial;
  keys(i,["constructor","date_milliseconds","trainer_id","secret_id","all_species_ids","dex_ids_sha256","default_starter_ids",
    "zero_entry","default_attributes","default_ivs","default_natures","starter_ids","starter_zero","starter_ability_default",
    "account_defaults","level_achievements","default_dex_entry_aliases","rng_restored","full_state_sha256"]);
  assert.equal(i.constructor,"new GameData(true)");assert.equal(i.date_milliseconds,1783641600000);assert.equal(i.trainer_id,0);assert.equal(i.secret_id,0);
  const ids=value=>{assert(Array.isArray(value));integer(value.length,27,4096);assert.equal(new Set(value).size,value.length);for(const id of value)integer(id,1,1000000);};
  ids(i.all_species_ids);ids(i.starter_ids);
  assert.deepEqual(i.starter_ids,[...i.starter_ids].sort((a,b)=>a-b));
  assert(i.starter_ids.every(id=>i.all_species_ids.includes(id)));
  assert.equal(i.dex_ids_sha256,digest(Buffer.from(JSON.stringify([...i.all_species_ids].sort((a,b)=>a-b)))));
  assert.deepEqual(i.default_starter_ids,defaultSpecies);
  assert(defaultSpecies.every(id=>i.all_species_ids.includes(id) && i.starter_ids.includes(id)));
  keys(i.zero_entry,["seenAttr","caughtAttr","natureAttr","seenCount","caughtCount","hatchedCount","ivs","ribbons"]);
  assert.deepEqual({...i.zero_entry,ribbons:null},{seenAttr:"0",caughtAttr:"0",natureAttr:0,seenCount:0,caughtCount:0,hatchedCount:0,ivs:[0,0,0,0,0,0],ribbons:null});
  assert.equal(i.zero_entry.ribbons,"0");
  assert.equal(i.default_attributes,"157");assert.deepEqual(i.default_ivs,[15,15,15,15,15,15]);
  assert.equal(i.default_natures.length,27);
  assert.deepEqual(i.default_natures.map(row=>row[0]).sort((a,b)=>a-b),[...defaultSpecies].sort((a,b)=>a-b));
  for(const row of i.default_natures){assert.equal(row.length,2);integer(row[1],1,1<<25);assert([0,6,12,18,24].some(n=>(1<<(n+1))===row[1]));}
  assert.deepEqual(i.starter_zero,{moveset:null,eggMoves:0,candyCount:0,friendship:0,abilityAttr:0,passiveAttr:0,valueReduction:0,classicWinCount:0});
  assert.equal(i.starter_ability_default,1);assert.equal(i.default_dex_entry_aliases,true);assert.equal(i.rng_restored,true);hex(i.full_state_sha256);
  keys(i.account_defaults,["highest_level","achv_unlocks","voucher_unlocks","voucher_counts","eggs"]);
  assert.equal(i.account_defaults.highest_level,0);assert.deepEqual(i.account_defaults.achv_unlocks,{});
  assert.deepEqual(i.account_defaults.voucher_unlocks,{});assert.deepEqual(i.account_defaults.eggs,[]);
  assert.deepEqual(i.account_defaults.voucher_counts,{0:0,1:0,2:0,3:0});
  assert.deepEqual(i.level_achievements,[["LV_100",100],["LV_250",250],["LV_1000",1000]]);
  const c=d.context;
  keys(c,["source_species","target_species","form","ability_index","nature","gender","shiny","variant","ivs","dex_attr","root","starter_root","full_unlocks","level_moves_1_10","perfect_reward","original","coop","daily","fun","mystery","fusion","black_shiny","shiny_lab"]);
  assert.equal(c.source_species,1);assert.equal(c.target_species,2);assert.equal(c.form,0);assert.equal(c.ability_index,0);
  assert.equal(c.nature,0);assert.equal(c.gender,0);assert.equal(c.shiny,false);assert.equal(c.variant,0);
    assert(Array.isArray(c.level_moves_1_10));integer(c.level_moves_1_10.length,1,64);
  for(const row of c.level_moves_1_10){assert.equal(row.length,2);integer(row[0],1,10);integer(row[1],1,1000000);}
  keys(c.perfect_reward,["id","recipe","difficulty","team"]);
  assert(typeof c.perfect_reward.id === "string" && c.perfect_reward.id.length>0);
  assert.deepEqual(c.perfect_reward.recipe,{kind:"candyTeam",perMon:10});
  assert(["youngster","ace","elite","hell"].includes(c.perfect_reward.difficulty));
  assert.deepEqual(c.perfect_reward.team,[{species:2,root:1,starter_root:1}]);
  const perfectCandy=Math.round(10*({youngster:1,ace:1.5,elite:2,hell:3}[c.perfect_reward.difficulty]));
assert.deepEqual(c.ivs,[31,1,2,3,4,5]);assert.equal(c.dex_attr,"149");assert.equal(c.root,1);assert.equal(c.starter_root,1);
  assert.deepEqual(c.full_unlocks.map(row=>row[0]),[1,2]);
  for(const [id,value] of c.full_unlocks){integer(id,1,2);decimal(value);assert((BigInt(value)&149n)===149n);}
  keys(c.original,["species","form","ability_index","nature","gender","shiny","variant"]);
  assert.equal(c.original.species,1);integer(c.original.form,0,65535);integer(c.original.ability_index,0,2);
  integer(c.original.nature,0,24);integer(c.original.gender,-1,1);bool(c.original.shiny);integer(c.original.variant,0,3);
  for(const flag of ["coop","daily","fun","mystery","fusion","black_shiny","shiny_lab"])assert.equal(c[flag],false);
  assert.equal(d.genderless_dex_attr,"145");
  assert.deepEqual(d.root_uncaught,{root_caught:"0",caught_result:false,full_state_unchanged:true});
  const dex=new Map(i.all_species_ids.map(id=>[id,structuredClone(i.zero_entry)]));
  const starters=new Map(i.starter_ids.map(id=>[id,{...i.starter_zero,abilityAttr:defaultSpecies.includes(id)?1:0}]));
  for(const [id,nature] of i.default_natures)Object.assign(dex.get(id),{seenAttr:"157",caughtAttr:"157",natureAttr:nature,ivs:[15,15,15,15,15,15]});
  const checkDelta=(change,kind,ivs,perfect)=>{
    keys(change,["dex","starters","rest","before_sha256","after_sha256"]);hex(change.before_sha256);hex(change.after_sha256);
    assert(Array.isArray(change.dex)&&Array.isArray(change.starters)&&Array.isArray(change.rest));
    assert.deepEqual(change.dex.map(row=>row[0]),[...change.dex.map(row=>row[0])].sort((a,b)=>a-b));
    assert.equal(new Set(change.dex.map(row=>row[0])).size,change.dex.length);
    const expected=structuredClone(dex);
    if(kind==="ivs")for(const id of [2,1])expected.get(id).ivs=expected.get(id).ivs.map((value,index)=>Math.max(value,ivs[index]));
    if(kind==="seen")expected.get(2).seenAttr=(BigInt(expected.get(2).seenAttr)|149n).toString();
    if(kind==="caught")for(const id of [2,1]){
      expected.get(id).caughtAttr=(BigInt(expected.get(id).caughtAttr)|(149n&BigInt(c.full_unlocks.find(row=>row[0]===id)[1]))).toString();
      expected.get(id).natureAttr|=2;
    }
    const changed=[...dex.keys()].sort((a,b)=>a-b).filter(id=>JSON.stringify(dex.get(id))!==JSON.stringify(expected.get(id)));
    assert.deepEqual(change.dex.map(row=>row[0]),changed);
    for(const [id,before,after] of change.dex){assert.deepEqual(before,dex.get(id));assert.deepEqual(after,expected.get(id));dex.set(id,after);}
    // Only the actual perfect-IV achievement owner may affect non-dex state.
    if(!perfect || kind!=="ivs"){
      assert.deepEqual(change.starters,[]);assert.deepEqual(change.rest,[]);
    } else {
      assert.equal(change.starters.length,1);
      assert.equal(new Set(change.starters.map(row=>row[0])).size,change.starters.length);
      for(const row of change.starters){assert.equal(row.length,3);const[id,before,after]=row;assert.deepEqual(before,starters.get(id));
        assert.equal(id,1);assert.equal(after.candyCount,before.candyCount+perfectCandy);
        assert.deepEqual({...after,candyCount:before.candyCount},before);starters.set(id,after);}
      assert.equal(new Set(change.rest.map(row=>row[0])).size,change.rest.length);
      for(const row of change.rest){assert.equal(row.length,3);assert(typeof row[0]==="string");assert.notDeepEqual(row[1],row[2]);}
      const unlock=change.rest.find(row=>row[0]==="achvUnlocks");assert(unlock);
      assert.deepEqual(unlock[1],{});assert.deepEqual(Object.keys(unlock[2]),[c.perfect_reward.id]);
      assert.equal(Object.values(unlock[2])[0],1783641600000);
    }
    const any=change.dex.length+change.starters.length+change.rest.length;
    if(any===0)assert.equal(change.before_sha256,change.after_sha256);else assert.notEqual(change.before_sha256,change.after_sha256);
  };
  assert.deepEqual(d.cases.map(row=>row.name),["owned-ivysaur-account-methods","repeat-idempotent-account-methods","perfect-ivs-real-validation"]);
  let frontier=i.full_state_sha256;
  for(const [index,row] of d.cases.entries()){
    keys(row,["name","ivs","caught_result","achievement_calls","ivs_delta","seen_delta","caught_delta"]);
    assert.deepEqual(row.ivs,index===2?[31,31,31,31,31,31]:[31,1,2,3,4,5]);
    assert.equal(row.caught_result,false);assert.deepEqual(row.achievement_calls,index===2?["PERFECT_IVS","PERFECT_IVS"]:[]);
    for(const kind of ["ivs","seen","caught"]){const delta=row[`${kind}_delta`];assert.equal(delta.before_sha256,frontier);checkDelta(delta,kind,row.ivs,index===2);frontier=delta.after_sha256;}
  }
}

function validatePreviousSidecar(row) {
  keys(row,["schema_version","source_sha","seed","legacy_sha256","initial_encounter","town_boss_pool","dex"]);
  assert.equal(row.schema_version,1);assert.equal(row.source_sha,"399d5d368f0b5642ebf8f45bd8a5e73350fa4de7");
  assert.equal(row.seed,"m9e-target-registry-source-v1");
  assert.equal(row.legacy_sha256,"9b58691e1c5b3796e2b1bfe511483a445b7ab158e72e895fd15c86e5f9bc4576");
  validateInitialEncounter(row.initial_encounter);validateTownBossPool(row.town_boss_pool);validateDex(row.dex);
}

function validateFaintScore(score,encounter) {
  keys(score,["scope","initial","context","cases","score_restored","own_fields_restored","unrelated_values_unchanged","rng_restored"]);
  assert.equal(score.scope,"actual addFaintedEnemyScore method only; controlled level/IV inputs, no FaintPhase execution");
  assert.deepEqual(score.initial,{battle_score:0,enemy_faints:0,enemy_history:0,player_history:0});
  for(const key of ["score_restored","own_fields_restored","unrelated_values_unchanged","rng_restored"])assert.equal(score[key],true);
  const c=score.context;
  keys(c,["enemy_id","species","form","natural_level","natural_ivs","hp","base_exp","current_cap","cap_override","held_score_sources","is_boss","boss_segments"]);
  const enemy=encounter.enemies[0];
  assert.equal(c.enemy_id,enemy.id);assert.equal(c.species,enemy.species);assert.equal(c.form,enemy.form);
  assert.equal(c.natural_level,enemy.level);integer(c.hp,1,Number.MAX_SAFE_INTEGER);
  integer(c.base_exp,1,Number.MAX_SAFE_INTEGER);integer(c.current_cap,1,Number.MAX_SAFE_INTEGER);
  assert.equal(c.cap_override,0);assert.deepEqual(c.held_score_sources,[]);
  assert.equal(c.is_boss,false);assert.equal(c.boss_segments,0);
  assert(Array.isArray(c.natural_ivs));assert.equal(c.natural_ivs.length,6);
  for(const iv of c.natural_ivs)integer(iv,0,31);
  const inputs=[['natural-initial-enemy',c.natural_level,c.natural_ivs],
    ['level1-zero-ivs',1,[0,0,0,0,0,0]],['level5-perfect-ivs',5,[31,31,31,31,31,31]],
    ['level13-mixed-ivs',13,[0,1,2,3,4,5]],['level2-mid-ivs',2,[15,15,15,15,15,15]]];
  assert.equal(score.cases.length,inputs.length);
  let before=0;
  let fractional=0;
  for(const [index,row] of score.cases.entries()){
    keys(row,["name","level","ivs","base_exp","cap","before","after","increment"]);
    assert.deepEqual([row.name,row.level,row.ivs],inputs[index]);
    assert.equal(row.base_exp,c.base_exp);assert.equal(row.cap,c.current_cap);
    integer(row.before,0,Number.MAX_SAFE_INTEGER);integer(row.after,0,Number.MAX_SAFE_INTEGER);
    integer(row.increment,1,Number.MAX_SAFE_INTEGER);assert.equal(row.increment,row.after-row.before);
    assert.equal(row.before,before);
    // Independent binary64 source equation; no replacement of the observed method.
    const increase=c.base_exp*(row.level/c.current_cap)*((row.ivs.reduce((sum,iv)=>sum+iv,0)/93)*0.2+0.8);
    if(increase!==Math.floor(increase))fractional++;
    assert.equal(row.after,before+Math.ceil(increase));
    assert(row.after>before);before=row.after;
  }
  assert(fractional>0,"actual controlled cases must exercise ceil on a fractional score");
}

function validateSidecar(row) {
  keys(row,["schema_version","source_sha","seed","legacy_sha256","initial_encounter","town_boss_pool","dex","faint_score"]);
  assert.equal(row.schema_version,2);
  const {faint_score,...previous}=row;previous.schema_version=1;
  validatePreviousSidecar(previous);
  const raw=Buffer.from(`${JSON.stringify(previous)}\n`);
  assert.equal(raw.length,27634);
  assert.equal(digest(raw),"c4f31f8504f4c6c9435af8c0d90496bc14de297623dea916d464de44b2124d56");
  validateFaintScore(faint_score,row.initial_encounter);
}

// Exact399d town.ts source c26b7950d04e26fab6816fbb4894d7b8e5c6f18952c0cdd40bf5c5940f0f7760;
// numeric SpeciesId binding6323f21fd3dfb859b6ae682f2f94507ad140ceeff811fdee43289779cf6665ba.
// Full45 source tier/time rows, including empty boss pools; no fixture body.
const sourceTownPoolRows = [[0,-1,[16,19,21,263,265,276,399,504,506,661,831,915]],[0,0,[10,161,165,187,191,266,396,519,546,664,734,819]],[0,1,[10,161,165,187,191,266,396,519,546,664,734,819]],[0,2,[13,163,167,261,268,509,824]],[0,3,[13,163,167,261,268,509,824]],[1,-1,[273,293,543,926]],[1,0,[29,32,69,261,270,300,415,420,572,921]],[1,1,[29,32,69,261,270,300,415,420,572,921]],[1,2,[23,43,46,48,52,285,401]],[1,3,[23,43,46,48,52,285,401]],[2,-1,[63,173,174,283,440,821,924]],[2,0,[]],[2,1,[]],[2,2,[]],[2,3,[]],[3,-1,[133,172,175,280,290,447]],[3,0,[]],[3,1,[]],[3,2,[]],[3,3,[]],[4,-1,[132,446,570]],[4,0,[]],[4,1,[]],[4,2,[]],[4,3,[]],[5,-1,[]],[5,0,[]],[5,1,[]],[5,2,[]],[5,3,[]],[6,-1,[]],[6,0,[]],[6,1,[]],[6,2,[]],[6,3,[]],[7,-1,[]],[7,0,[]],[7,1,[]],[7,2,[]],[7,3,[]],[8,-1,[]],[8,0,[]],[8,1,[]],[8,2,[]],[8,3,[]]];
function validateTownBossPool(value) {
  keys(value,["scope","wave","level","biome","trainer_chance","pool_rows","species","rng_unchanged"]);
  assert.equal(value.scope,"initialized Town pool and actual first-wave boss predicate; not encounter selection parity");
  assert.equal(value.wave,1);assert.equal(value.level,5);assert.equal(value.biome,0);
  assert.equal(value.trainer_chance,0);assert.equal(value.rng_unchanged,true);
  assert.deepEqual(value.pool_rows,sourceTownPoolRows);
  const ids = [...new Set(sourceTownPoolRows.flatMap(row => row[2]))].sort((a,b)=>a-b);
  assert.equal(ids.length,67);
  assert(Array.isArray(value.species));assert.equal(value.species.length,ids.length);
  for (const [index,row] of value.species.entries()) {
    assert(Array.isArray(row));assert.equal(row.length,5);
    assert.deepEqual(row,[ids[index],false,false,false,0]);
  }
}
function townBossPoolMutants(actual) {
  const mutations = [
    ["town-missing-species", v => { v.species.pop(); }],
    ["town-duplicate-species", v => { v.species[1] = v.species[0]; }],
    ["town-legendary", v => { v.species[0][2] = true; }],
    ["town-actual-boss", v => { v.species[0][4] = 2; }],
    ["town-missing-empty-pool", v => { v.pool_rows.pop(); }],
    ["town-altered-membership", v => { v.pool_rows[0][2].pop(); }],
    ["town-altered-time", v => { v.pool_rows[0][1] = 0; }],
    ["town-boolean-segments", v => { v.species[0][4] = false; }],
    ["town-trainer-chance", v => { v.trainer_chance = 1; }],
    ["town-rng-change", v => { v.rng_unchanged = false; }],
  ];
  for (const [, mutate] of mutations) {
    const value = structuredClone(actual);mutate(value);
    assert.throws(() => validateTownBossPool(value));
  }
  return mutations.map(([name]) => name);
}

assert.equal(process.argv.length, 11);
const raws = process.argv.slice(2, 4).map(path => {
  const stat = fs.lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 32768);
  return fs.readFileSync(path);
});
assert(raws[0].equals(raws[1]));
const row = JSON.parse(raws[0]);
validate(row);
assert.equal(raws[0].length,29641);
assert.equal(digest(raws[0]),"9b58691e1c5b3796e2b1bfe511483a445b7ab158e72e895fd15c86e5f9bc4576");
const sidecarRaws=process.argv.slice(7,9).map(path=>{
  const stat=fs.lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=32768);
  return fs.readFileSync(path);
});
assert(sidecarRaws[0].equals(sidecarRaws[1]));
const sidecar=JSON.parse(sidecarRaws[0]);validateSidecar(sidecar);
const sidecarNegatives=[...initialEncounterMutants(sidecar.initial_encounter),...townBossPoolMutants(sidecar.town_boss_pool)];
const scoreNegatives=[];
for(const[name,mutate]of[
  ["score-initial",v=>{v.initial.battle_score=1;}],
  ["score-initial-faints",v=>{v.initial.enemy_faints=1;}],
  ["score-initial-history",v=>{v.initial.enemy_history=1;}],
  ["score-identity",v=>{v.context.enemy_id++;}],
  ["score-held-source",v=>{v.context.held_score_sources.push({class_name:"x",multiplier:2});}],
  ["score-boss",v=>{v.context.is_boss=true;}],
  ["score-cap-override",v=>{v.context.cap_override=-1;}],
  ["score-cap",v=>{v.context.current_cap=0;}],
  ["score-base-exp",v=>{v.context.base_exp+=v.context.current_cap*465;for(const row of v.cases)row.base_exp=v.context.base_exp;}],
  ["score-case-count",v=>{v.cases.pop();}],
  ["score-case-order",v=>{[v.cases[1],v.cases[2]]=[v.cases[2],v.cases[1]];}],
  ["score-amount",v=>{v.cases[0].after++;}],
  ["score-equation",v=>{v.cases[0].increment++;for(const[index,row]of v.cases.entries()){row.after++;if(index>0)row.before++;}}],
  ["score-chain",v=>{v.cases[1].before=0;}],
  ["score-integer-type",v=>{v.cases[0].before=false;}],
  ["score-restoration",v=>{v.score_restored=false;}],
  ["score-rng",v=>{v.rng_restored=false;}],
]){const copy=structuredClone(sidecar.faint_score);mutate(copy);assert.throws(()=>validateFaintScore(copy,sidecar.initial_encounter));scoreNegatives.push(name);}
for(const[name,mutate]of[
  ["dex-default-attribute",v=>{v.dex.initial.default_attributes="149";}],
  ["dex-missing-species",v=>{v.dex.initial.all_species_ids.pop();}],
  ["dex-duplicate-starter",v=>{v.dex.initial.starter_ids.push(v.dex.initial.starter_ids[0]);}],
  ["dex-zero-ability",v=>{v.dex.initial.starter_ability_default=0;}],
  ["dex-unknown-highest-level",v=>{v.dex.initial.account_defaults.highest_level=null;}],
  ["dex-nonzero-highest-level",v=>{v.dex.initial.account_defaults.highest_level=5;}],
  ["dex-genderless-male-bit",v=>{v.dex.genderless_dex_attr="149";}],
  ["dex-repeated-payment",v=>{v.dex.cases[1].caught_delta.starters=[[1,{},{}]];}],
  ["dex-iv-prevolution-missing",v=>{v.dex.cases[0].ivs_delta.dex.shift();}],
  ["dex-validation-order",v=>{v.dex.cases[2].achievement_calls.pop();}],
  ["dex-root-gate",v=>{v.dex.root_uncaught.full_state_unchanged=false;}],
  ["dex-perfect-reward",v=>{v.dex.cases[2].ivs_delta.starters[0][2].candyCount++;}],
  ["dex-level-threshold",v=>{v.dex.initial.level_achievements[0][1]=99;}],
]){const copy=structuredClone(sidecar);mutate(copy);assert.throws(()=>validateSidecar(copy));sidecarNegatives.push(name);}
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
  r => { r.stats.context.modifier_observations[0].stat_families[0] = true; },
  r => { r.stats.context.modifier_observations[0].xp_families[0] = true; },
  r => { r.stats.cases[0].hp_before.debt = 1; },
  r => { r.stats.cases[0].hp_after.multiplier = 2; },
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
  "src/data/elite-redux/archetypes/ability-meta-consumers.ts","src/battle.ts",
  "src/phases/turn-end-phase.ts","src/phases/field-phase.ts",
  "src/utils/speed-order-generator.ts","src/data/pokemon/pokemon-data.ts"];
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
contains("src/data/pokemon/pokemon-data.ts","turnCount = 1;");
contains("src/data/pokemon/pokemon-data.ts","waveTurnCount = 1;");
contains("src/phases/turn-end-phase.ts","pokemon.tempSummonData.turnCount++;");
contains("src/phases/turn-end-phase.ts","pokemon.tempSummonData.waveTurnCount++;");
contains("src/phases/field-phase.ts","inSpeedOrder(ArenaTagSide.BOTH)");
contains("src/utils/speed-order-generator.ts","pokemonList = globalScene.getField(true);");
contains("src/battle.ts","public battleScore = 0;");
contains("src/battle.ts","public enemyFaints = 0;");
contains("src/battle.ts","public playerFaintsHistory: FaintLogEntry[] = [];");
contains("src/battle.ts","public enemyFaintsHistory: FaintLogEntry[] = [];");
contains("src/battle-scene.ts","enemy.getSpeciesForm().getBaseExp()");
contains("src/battle-scene.ts","* (enemy.level / this.getMaxExpLevel())");
contains("src/battle-scene.ts","* ((enemy.ivs.reduce((iv: number, total: number) => (total += iv), 0) / 93) * 0.2 + 0.8);");
contains("src/battle-scene.ts","scoreIncrease *= (m as PokemonHeldItemModifier).getScoreMultiplier()");
contains("src/battle-scene.ts","scoreIncrease *= Math.sqrt(enemy.bossSegments);");
contains("src/battle-scene.ts","this.currentBattle.battleScore += Math.ceil(scoreIncrease);");
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
function validateVictoryTail(t) {
  keys(t,["schema_version","source_sha","seed","legacy_sha256","scope","abilities","raw_bulbasaur",
    "modifiers","charge_steps","training_cache","money","rng_unchanged","turn_counters","battle_scores","growl"]);
  assert.equal(t.schema_version,4); assert.equal(t.source_sha,"399d5d368f0b5642ebf8f45bd8a5e73350fa4de7");
  assert.equal(t.seed,"m9e-target-registry-source-v1");
  assert.equal(t.legacy_sha256,"9b58691e1c5b3796e2b1bfe511483a445b7ab158e72e895fd15c86e5f9bc4576");
  assert.equal(t.scope,"initialized registry, initial-context consumers and actual direct neutral TurnEnd counter dispatch; not full battle-loop execution");
  assert.equal(t.rng_unchanged,true);
  const growl=t.growl;
  keys(growl,["scope","move","families","abilities","cases","battle_rng_unchanged","rng_restored"]);
  assert.equal(growl.scope,"actual Growl attr and captured stat child; controlled Attack stages, visual tween disabled; not a selected move or full battle loop");
  keys(growl.move,["id","category","power","attack_class","status_class","effective_category","effective_power","simulated_damage","chance","stats","stages","self_target"]);
  assert.equal(growl.move.attack_class,false);assert.equal(growl.move.status_class,true);assert.equal(growl.move.effective_category,1);assert.equal(growl.move.effective_power,60);integer(growl.move.simulated_damage,1,1000000);
  assert.equal(growl.move.id,45);assert.equal(growl.move.category,1);assert.equal(growl.move.power,60);
  assert([-1,100].includes(growl.move.chance));assert.deepEqual(growl.move.stats,[1]);assert.equal(growl.move.stages,-1);assert.equal(growl.move.self_target,false);
  assert.equal(growl.rng_restored,true);assert.equal(growl.battle_rng_unchanged,true);assert.deepEqual(growl.abilities.map(a=>a.id),abilityIds);
  const statFamilies=["MoveEffectChanceMultiplierAbAttr","IgnoreMoveEffectsAbAttr","UserFieldIgnoreMoveEffectsAbAttr","StatStageChangeMultiplierAbAttr","ProtectStatAbAttr","ConditionalUserFieldProtectStatAbAttr","ReflectStatStageChangeAbAttr","PostStatStageChangeAbAttr","PostAllyStatStageChangeAbAttr"];
  assert.deepEqual(growl.families,statFamilies);
  for(const ability of growl.abilities){keys(ability,["id","families"]);assert.equal(ability.families.length,statFamilies.length);
    for(const [familyIndex,attrs]of ability.families.entries()){const family=statFamilies[familyIndex];assert(attrs.length<=16);
      for(const attr of attrs){keys(attr,["name","stats","protected_stat","protects_attack"]);assert.equal(typeof attr.name,"string");assert(attr.name.length<=128);
        if(attr.stats!==null){assert(Array.isArray(attr.stats));for(const stat of attr.stats)integer(stat,1,7);}
        if(attr.protected_stat!==null)integer(attr.protected_stat,1,7);if(attr.protects_attack!==null)bool(attr.protects_attack);}
      if(ability.id===51&&family==="ProtectStatAbAttr"){assert.equal(attrs.length,1);assert.equal(attrs[0].protects_attack,false);}
      else if(ability.id===172&&family==="PostStatStageChangeAbAttr"){assert.deepEqual(attrs.map(a=>a.name),["PostStatStageChangeStatStageChangeAbAttr"]);}
      else assert.deepEqual(attrs,[]);
    }
  }
  assert.equal(growl.cases.length,3);
  for(const [index,row]of growl.cases.entries()){keys(row,["before","queued","after","decreased","applied","chance","message"]);
    assert.equal(row.before,[0,6,-6][index]);assert.equal(row.queued,row.before);assert.equal(row.after,[-1,5,-6][index]);
    assert.equal(row.decreased,index!==2);assert.equal(row.applied,true);assert.equal(row.chance,growl.move.chance);assert.equal(row.message,true);}
  const scores=t.battle_scores;
  keys(scores,["scope","enemy_count","double","is_boss","cases","restored","rng_restored"]);
  assert.equal(scores.scope,"actual addBattleScore with controlled settled turns and score inputs; single ordinary enemy only, no BattleEnd phase execution");
  assert.equal(scores.enemy_count,1);assert.equal(scores.double,false);assert.equal(scores.is_boss,false);
  assert.equal(scores.restored,true);assert.equal(scores.rng_restored,true);assert.equal(scores.cases.length,33);
  for(const [index,row]of scores.cases.entries()){
    keys(row,["turn","input","multiplier","before","after"]);
    assert.equal(row.turn,2+Math.floor(index/3));assert.equal(row.input,[1,113,10000][index%3]);
    assert.equal(row.before,7);
    const value=1-Math.min(row.turn-2,10)/10;
    const multiplier=value===0?0:value===1?1:1-Math.cos(value*Math.PI/2);
    assert.equal(row.multiplier,multiplier);
    assert.equal(row.after,7+Math.ceil(row.input*multiplier));
  }
  const counters=t.turn_counters;
  keys(counters,["scope","before","after"]);
  assert.equal(counters.scope,"actual initialized fresh holders and direct source TurnEndPhase.start; no selected turn or battle-loop witness");
  for(const [index,image]of[counters.before,counters.after].entries()){
    keys(image,["turn","holders"]);assert.equal(image.turn,index+1);
    assert.equal(image.holders.length,2);assert.equal(new Set(image.holders.map(p=>p.id)).size,2);
    assert.deepEqual(image.holders.map(p=>p.player),[true,false]);
    for(const p of image.holders){keys(p,["id","player","hp","max_hp","turn_count","wave_turn_count"]);
      integer(p.id,0,Number.MAX_SAFE_INTEGER);bool(p.player);integer(p.max_hp,1,1000000);integer(p.hp,1,p.max_hp);
      assert.equal(p.turn_count,index+1);assert.equal(p.wave_turn_count,index+1);}
  }
  assert.deepEqual(counters.after.holders.map(p=>[p.id,p.player,p.hp,p.max_hp]),
    counters.before.holders.map(p=>[p.id,p.player,p.hp,p.max_hp]));
  assert.deepEqual(t.abilities.map(a=>a.id),abilityIds);
  for (const a of t.abilities) {keys(a,["id","post_turn","post_battle"]); attrs(a.post_turn); attrs(a.post_battle);}
  const p=t.raw_bulbasaur;
  keys(p,["species","form","ability_index","active","passive_slots","applicable_sources"]);
  assert.equal(p.species,1); integer(p.form,0,255); integer(p.ability_index,0,2); integer(p.active,0,65535);
  assert(Array.isArray(p.passive_slots) && p.passive_slots.length>=3 && p.passive_slots.length<=8);
  for(const id of p.passive_slots) if(id!==null) integer(id,0,65535);
  assert(Array.isArray(p.applicable_sources) && p.applicable_sources.length>=1 && p.applicable_sources.length<=9);
  assert.equal(p.applicable_sources.filter(a=>!a.passive).length,1);
  for(const a of p.applicable_sources) {
    keys(a,["id","passive","slot"]); integer(a.id,0,65535); bool(a.passive);
    if(a.passive){integer(a.slot,0,7);assert.equal(a.id,p.passive_slots[a.slot]);}
    else {assert.equal(a.id,p.active);assert.equal(a.slot,null);}
  }
  assert.deepEqual(t.modifiers,[{class_name:"MapModifier",stack_count:1,map:true,lapsing:false,lapsing_held:false}]);
  assert.deepEqual(t.charge_steps.map(s=>s.method),["erAdvanceCommunityItemCharges","erAdvanceTacticalRecharges","advanceErWardStoneCharges"]);
  for(const s of t.charge_steps){keys(s,["method","after"]);assert.deepEqual(s.after,t.modifiers);}
  const c=t.training_cache; keys(c,["difficulty","before","awards","after"]);
  assert.equal(typeof c.difficulty,"string"); assert.notEqual(c.difficulty,"hell"); assert(c.difficulty.length<=64);
  assert.deepEqual(c.awards,[]); assert.deepEqual(c.after,c.before);
  keys(c.before,["version","segmentStartEquivalentWave","presenceByPokemonId","claimedMilestones"]);
  assert.equal(c.before.version,1); integer(c.before.segmentStartEquivalentWave,0,1);
  assert.deepEqual(c.before.presenceByPokemonId,{}); assert.deepEqual(c.before.claimedMilestones,[]);
  const m=t.money;keys(m,["before","calculated","returned","captured","after","restored"]);
  assert.deepEqual(m.before,{value:1,captured:false});
  for(const s of [m.before,m.after,m.restored]){keys(s,["value","captured"]);bool(s.captured);assert(Number.isFinite(s.value)&&s.value>0&&s.value<=1000);}
  assert(Number.isFinite(m.calculated)&&m.calculated>0&&m.calculated<=1000);
  assert.equal(m.returned,m.calculated);assert.equal(m.captured,m.calculated);
  assert.deepEqual(m.after,{value:m.calculated,captured:true});assert.deepEqual(m.restored,m.before);
}
const tailRaws=[process.argv[9],process.argv[10]].map(path=>{
  assert.equal(fs.statSync(path).isFile(),true); const raw=fs.readFileSync(path);assert(raw.length<=16384);return raw;
});
assert(tailRaws[0].equals(tailRaws[1]));
const tailObservation=JSON.parse(tailRaws[0]);validateVictoryTail(tailObservation);
let tailNegatives=0;
for(const change of [t=>{delete t.growl;},t=>t.growl.move.stages=1,t=>t.growl.move.chance=30,t=>t.growl.cases[0].queued=-1,t=>t.growl.cases[0].after=0,t=>t.growl.cases[2].decreased=true,t=>t.growl.abilities[0].families.pop(),t=>t.growl.rng_restored=false,t=>t.growl.battle_rng_unchanged=false,t=>{delete t.battle_scores;},t=>t.battle_scores.cases.pop(),t=>t.battle_scores.cases[0].turn=3,t=>t.battle_scores.cases[1].input=114,t=>t.battle_scores.cases[4].multiplier=1,t=>t.battle_scores.cases[4].after++,t=>t.battle_scores.double=true,t=>t.battle_scores.restored=false,t=>t.battle_scores.rng_restored=false,t=>t.abilities.pop(),t=>t.abilities[1].id=t.abilities[0].id,
  t=>t.abilities[0].post_turn=[false],t=>t.raw_bulbasaur.applicable_sources=[],
  t=>t.modifiers[0].lapsing=true,t=>t.rng_unchanged=false,t=>t.money.captured=-1,
  t=>{delete t.turn_counters;},t=>t.turn_counters.before.holders[0].turn_count=0,
  t=>t.turn_counters.after.holders[0].turn_count=1,t=>t.turn_counters.after.holders[1].wave_turn_count=3,
  t=>t.turn_counters.after.holders[0].hp--,t=>t.turn_counters.after.turn=1,
  t=>t.charge_steps[0].after=[],t=>t.training_cache.after={},t=>t.legacy_sha256="bad",t=>t.source_sha="bad"]){
  const mutant=structuredClone(tailObservation);change(mutant);assert.throws(()=>validateVictoryTail(mutant));tailNegatives++;
}
const tailSummary={scope:tailObservation.scope,negative_cases:tailNegatives,battle_score_cases:tailObservation.battle_scores.cases.length,turn_counters:tailObservation.turn_counters,
  exports:tailRaws.map(raw=>({bytes:raw.length,sha256:digest(raw)})),
  empty_post_turn_and_battle_ids:tailObservation.abilities.filter(a=>a.post_turn.length===0&&a.post_battle.length===0).map(a=>a.id),
  nonempty_families:tailObservation.abilities.filter(a=>a.post_turn.length||a.post_battle.length),
  raw_bulbasaur:tailObservation.raw_bulbasaur,money_multiplier:tailObservation.money.calculated};
const output = `${JSON.stringify({schema_version:5,victory_tail:tailSummary,status:"passed",scope:"registry observations and actual source queue nesting; no gameplay or general neutrality qualification",source_sha:row.source_sha,ability_count:24,move_count:27,negative_cases:rejected,sidecar_negative_cases:sidecarNegatives,score_negative_cases:scoreNegatives,faint_score:{cases:sidecar.faint_score.cases.length,base_exp:sidecar.faint_score.context.base_exp,current_cap:sidecar.faint_score.context.current_cap,initial:sidecar.faint_score.initial},sidecars:sidecarRaws.map(raw=>({bytes:raw.length,sha256:digest(raw)})),dex:{species:sidecar.dex.initial.all_species_ids.length,starters:sidecar.dex.initial.starter_ids.length,defaults:27,cases:3,highest_level:sidecar.dex.initial.account_defaults.highest_level},initial_encounter:sidecar.initial_encounter,town_boss_pool:{pool_rows:sidecar.town_boss_pool.pool_rows.length,species:sidecar.town_boss_pool.species.length},families,phase_order:phaseOrder,no_effect_family_ids:row.moves.filter(m=>m.no_effect).map(m=>m.id),daily_pokerus:{clock_cases:row.daily_pokerus.clock_cases.length,positive_starters:[1,4,7],effective_count:row.daily_pokerus.effective_count,starter_key_count:706,source_calls:row.daily_pokerus.source_calls,rng_restored:true},stat_cases:row.stats.cases.length,balance:row.balance,exports:raws.map(raw => ({bytes:raw.length,sha256:digest(raw)}))})}\n`;
assert(Buffer.byteLength(output) <= 8192);
fs.writeFileSync(process.argv[4], output, {flag:"wx"});
