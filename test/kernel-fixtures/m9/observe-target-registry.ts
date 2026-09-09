import { townBiome } from "#balance/biomes/town";
import { ER_ACHIEVEMENT_REWARDS, resolveAchievementRewardTeam } from "#data/elite-redux/er-achievement-rewards";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { GameData } from "#system/game-data";
import { defaultStarterSpecies } from "#app/constants";
import { Gender } from "#data/gender";
import { achvs, LevelAchv } from "#system/achv";
import Overrides from "#app/overrides";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { createHash } from "node:crypto";
import { allAbilities, allMoves, allSpecies } from "#data/data-lists";
import { globalScene } from "#app/global-scene";
import { speciesStarterCosts, FRIENDSHIP_GAIN_FROM_BATTLE } from "#balance/starters";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { getPokemonSpecies, getPokerusStarters } from "#utils/pokemon-utils";
import { ExpBoosterModifier, PokemonExpBoosterModifier, ExpShareModifier, ExpBalanceModifier,
  MultipleParticipantExpBonusModifier, BaseStatModifier, PokemonBaseStatTotalModifier, PokemonBaseStatFlatModifier,
  PokemonIncrementingStatModifier, PokemonNatureWeightModifier } from "#modifiers/modifier";
import { getMoodyCoordinatorMaxHpMultiplier, getMoodyCoordinatorHpDebt }
  from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { Nature } from "#enums/nature";
import { AbilityId } from "#enums/ability-id";
import { getFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { ER_SHATTERED_PSYCHE_ABILITY_ID } from "#data/elite-redux/abilities/shattered-psyche";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { MoveFlags } from "#enums/move-flags";
import { MoveTarget } from "#enums/move-target";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

// Diagnostic only: actual initialized source registry, not a gameplay oracle.
// IDs are the complete ability/move union observed by the genuine Rust natural
// constructor in run 34373633488, plus NONE, SURF, RECOVER and STRUGGLE for
// explicitly identified later positive/negative targeting witnesses.
const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const SEED = "m9e-target-registry-source-v1";
const ABILITIES = [0, 18, 41, 43, 47, 49, 51, 62, 65, 66, 67, 75, 82, 94, 113, 172, 192, 257, 268, 5006, 5033, 5082, 5097, 5115];
const MOVES = [10, 33, 39, 40, 43, 45, 57, 61, 64, 78, 79, 98, 103, 105, 108, 110, 165, 230, 310, 331, 336, 448, 458, 497, 501, 541, 580];
let game: Phaser.Game | null = null;
let manager: GameManager | null = null;

afterAll(() => {
  vi.useRealTimers();
  manager?.promptHandler.clearPrompts();
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  game?.destroy(true);
});

test("observe actual initialized target capability registry", async () => {
  const output = process.env.M9_TARGET_REGISTRY_OUTPUT;
  if (output == null) throw new Error("M9_TARGET_REGISTRY_OUTPUT required");
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(PIN);
  game = new Phaser.Game({ type: Phaser.HEADLESS, seed: [SEED] });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  manager = new GameManager(game);
  manager.override.disableShinies = false;
  manager.override.normalizeIVs = false;
  manager.override.normalizeNatures = false;
  manager.override.shiny(null).enemyShiny(null).playerIVs(null).enemyIVs(null)
    .nature(null).enemyNature(null).battleStyle(BattleStyle.SET)
    .startingBiome(BiomeId.TOWN).startingWave(1).seed(SEED);
  await manager.classicMode.startBattle(SpeciesId.BULBASAUR);
  const initialEncounter=observeInitialEncounterContext();
  const townBossPool=observeTownBossPool();
  const abilities = ABILITIES.map(id => {
    const ability = allAbilities[id];
    expect(ability?.id).toBe(id);
    expect(vi.isMockFunction(ability.hasAttr)).toBe(false);
    expect(vi.isMockFunction(ability.getAttrs)).toBe(false);
    return {
      id, name: ability.name,
      attrs: ability.attrs.map(attr => attr.constructor.name),
      conditions: ability.conditions.length,
      meta_kinds: ability.attrs.flatMap(attr => "erMetaKind" in attr ? [attr.erMetaKind] : []),
      post_faint: ability.hasAttr("PostFaintAbAttr"),
      post_knock_out: ability.hasAttr("PostKnockOutAbAttr"),
      post_victory: ability.hasAttr("PostVictoryAbAttr"),
      spread: ability.hasAttr("SpreadTargetByFlagAbAttr"),
      spread_flags: ability.getAttrs("SpreadTargetByFlagAbAttr").map(attr => attr.flag),
      redirect_types: ability.getAttrs("RedirectTypeMoveAbAttr").map(attr => attr.type),
      studio_capabilities: ability.attrs.flatMap(attr =>
        "abilityStudioCapability" in attr ? [attr.abilityStudioCapability] : []),
      studio_sources: ability.attrs.flatMap(attr =>
        "abilityStudioSourceAbilityId" in attr ? [attr.abilityStudioSourceAbilityId] : []),
      bypass_faint: ability.bypassFaint,
      suppressable: ability.suppressable,
      shattered_id: id === ER_SHATTERED_PSYCHE_ABILITY_ID,
    };
  });
  const moves = MOVES.map(id => {
    const move = allMoves[id];
    expect(move?.id).toBe(id);
    expect(vi.isMockFunction(move.hasAttr)).toBe(false);
    expect(vi.isMockFunction(move.getAttrs)).toBe(false);
    expect(vi.isMockFunction(move.hasFlag)).toBe(false);
    return {
      id, name: move.name, target: MoveTarget[move.moveTarget],
      category:move.category, accuracy:move.accuracy, power:move.power, pp:move.pp,
      attrs: move.attrs.map(attr => attr.constructor.name),
      variable: move.hasAttr("VariableTargetAttr"),
      multi_hit: move.hasAttr("MultiHitAttr"),
      pulse: move.hasFlag(MoveFlags.PULSE_MOVE),
      sound_based: move.hasFlag(MoveFlags.SOUND_BASED),
      post_victory_stat: move.hasAttr("PostVictoryStatStageChangeAttr"),
      no_effect: move.hasAttr("NoEffectAttr"),
      no_effect_attrs: move.getAttrs("NoEffectAttr").map(attr => attr.constructor.name),
    };
  });
  // Only Date is controlled. Source selection and Phaser RNG remain call-through,
  // and no target method, tuning table, account or source registry is replaced.
  expect(vi.isMockFunction(getPokerusStarters)).toBe(false);
  expect(vi.isMockFunction(globalScene.executeWithSeedOffset)).toBe(false);
  expect(vi.isMockFunction(Phaser.Math.RND.pick)).toBe(false);
  const starterKeys = Object.keys(speciesStarterCosts);
  // Actual initialized registry includes the source init-chain custom roots and removals.
  expect(starterKeys).toHaveLength(706);
  expect(new Set(starterKeys).size).toBe(706);
  expect(starterKeys).toEqual([...starterKeys].sort((a,b)=>Number(a)-Number(b)));
  const effectiveCount = erBalanceNum("vanilla.pokerusCount");
  expect(Number.isInteger(effectiveCount) && effectiveCount > 0 && effectiveCount <= 10).toBe(true);
  const tuning = JSON.parse(readFileSync("src/data/elite-redux/er-balance-tuning.json", "utf8")) as Record<string, unknown>;
  expect(vi.isMockFunction(erBalanceNum)).toBe(false);
  const balanceValues={battle_friendship_gain:FRIENDSHIP_GAIN_FROM_BATTLE,
    values:["vanilla.friendship.lossFaint","vanilla.friendship.candyMultClassic"].map(key=>({
      key,has_override:Object.hasOwn(tuning,key),raw_override:tuning[key] ?? null,effective:erBalanceNum(key)}))};
  const clockCases = [0, 1, 86_399_999, 86_400_000, -1, -86_400_000,
    -86_400_001, 1_783_641_600_000, 8_640_000_000_000_000, -8_640_000_000_000_000];
  let sourceCalls = 0;
  const observeDaily = (milliseconds: number) => {
    vi.setSystemTime(milliseconds);
    const date = new Date();
    expect(date.getTime()).toBe(milliseconds);
    date.setUTCHours(0, 0, 0, 0);
    const before = { rng: Phaser.Math.RND.state(), offset: globalScene.rngOffset,
      seed_override: globalScene.rngSeedOverride };
    const selected = getPokerusStarters();
    sourceCalls += 1;
    const after = { rng: Phaser.Math.RND.state(), offset: globalScene.rngOffset,
      seed_override: globalScene.rngSeedOverride };
    expect(after).toEqual(before);
    expect(selected).toHaveLength(effectiveCount);
    expect(new Set(selected).size).toBe(effectiveCount);
    const ids = selected.map(species => species.speciesId);
    expect(ids.every(id => starterKeys.includes(String(id)))).toBe(true);
    expect(selected.every(species => getPokemonSpecies(species.speciesId) === species)).toBe(true);
    return { milliseconds, midnight: date.getTime(), seed: date.getTime().toString(), ids,
      selected_starters: [1, 4, 7].map(id => ({id, pokerus:selected.includes(getPokemonSpecies(id))})),
      before, after };
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  const dailyCases = clockCases.map(observeDaily);
  const repeated = observeDaily(clockCases[0]);
  expect(repeated).toEqual(dailyCases[0]);
  const positiveDays: ReturnType<typeof observeDaily>[] = [];
  const missing = new Set([1, 4, 7]);
  let scannedDays = 0;
  // A bounded search calls the actual source function for each date. It does not
  // compute a matching daily seed or substitute selected species.
  for (let day = 0; day < 4096 && missing.size > 0; day += 1) {
    const observation = observeDaily(day * 86_400_000);
    scannedDays += 1;
    if (observation.selected_starters.some(row => row.pokerus && missing.has(row.id))) {
      positiveDays.push(observation);
      for (const row of observation.selected_starters) if (row.pokerus) missing.delete(row.id);
    }
  }
  expect(missing.size).toBe(0);
  vi.useRealTimers();
  const dailyPokerus = {
    scope:"actual getPokerusStarters with captured Date and unmocked Phaser RNG; identity membership matches starter selection predicate, not UI execution",
    starter_keys:starterKeys, effective_count:effectiveCount,
    tuning_has_override:Object.hasOwn(tuning, "vanilla.pokerusCount"),
    tuning_override:tuning["vanilla.pokerusCount"] ?? null,
    clock_cases:dailyCases, repeated, positive_days:positiveDays,
    scan_limit:4096, scanned_days:scannedDays, source_calls:sourceCalls,
  };
  const pokemon = globalScene.getPlayerPokemon();
  if (pokemon == null) throw new Error("Actual fresh player required");
  expect(pokemon.species.speciesId).toBe(SpeciesId.BULBASAUR);
  expect(pokemon.formIndex).toBe(0);
  expect(vi.isMockFunction(pokemon.calculateStats)).toBe(false);
  const observeModifiers=()=>globalScene.modifiers.map(modifier=>({
    constructor:modifier.constructor.name,type_id:modifier.type.id,stack_count:modifier.stackCount,
    virtual_stack_count:modifier.virtualStackCount,total_stacks:modifier.getStackCount(),
    stat_families:[BaseStatModifier,PokemonBaseStatTotalModifier,PokemonBaseStatFlatModifier,
      PokemonIncrementingStatModifier,PokemonNatureWeightModifier].map(kind=>modifier instanceof kind),
    xp_families:[ExpBoosterModifier,PokemonExpBoosterModifier,ExpShareModifier,ExpBalanceModifier,
      MultipleParticipantExpBonusModifier,PokemonIncrementingStatModifier].map(kind=>modifier instanceof kind)}));
  const modifierObservations=observeModifiers();
  expect(modifierObservations).toHaveLength(1);
  expect(modifierObservations.every(row=>row.stat_families.every(value=>!value))).toBe(true);
  expect(modifierObservations.every(row=>row.xp_families.every(value=>!value))).toBe(true);
  const observeHp=()=>({multiplier:getMoodyCoordinatorMaxHpMultiplier(pokemon),
    debt:getMoodyCoordinatorHpDebt(pokemon.id),max_hp:pokemon.getMaxHp()});
  const statContext = {
    species:pokemon.species.speciesId, form:pokemon.formIndex,
    modifiers:globalScene.modifiers.length, modifier_observations:modifierObservations, challenges:globalScene.gameMode.challenges.length,
    spliced:globalScene.gameMode.isSplicedOnly === true, spliced_source_type:typeof globalScene.gameMode.isSplicedOnly,
    fun_mode:globalScene.gameMode.isFun === true, fun_source_type:typeof globalScene.gameMode.isFun,
    fusion:pokemon.isFusion(),
    fun_pseudo_mega:pokemon.isFunPseudoMega(), fun_shuffle:getFunModeConfig().shuffleStats,
    cursed_stat:pokemon.customPokemonData.erCursedStat, moody:getMoodyModeState(),
    wonder_guard:pokemon.hasAbility(AbilityId.WONDER_GUARD, false, true),
  };
  expect(statContext.modifiers).toBe(1);expect(statContext.challenges).toBe(0);
  expect(globalScene.gameMode.isSplicedOnly).toBeUndefined();expect(globalScene.gameMode.isFun).toBeUndefined();
  expect(statContext.spliced).toBe(false);expect(statContext.fun_mode).toBe(false);expect(statContext.fusion).toBe(false);
  expect(statContext.fun_pseudo_mega).toBe(false);expect(statContext.fun_shuffle).toBe(false);
  expect(statContext.cursed_stat).toBe(-1);expect(statContext.moody).toBeNull();
  expect(statContext.wonder_guard).toBe(false);
  const original = {level:pokemon.level,nature:pokemon.nature,custom_nature:pokemon.customPokemonData.nature,
    ivs:pokemon.ivs,stats:pokemon.stats,hp:pokemon.hp};
  const customBefore=JSON.stringify(pokemon.customPokemonData);
  const rngBeforeStats=Phaser.Math.RND.state();
  const statCases: Array<{name:string;level:number;nature:number;ivs:number[];pre_stats:number[];pre_hp:number;
    base_stats:number[];post_stats:number[];post_hp:number;
    hp_before:ReturnType<typeof observeHp>;hp_after:ReturnType<typeof observeHp>}> = [];
  try {
    pokemon.stats=[...original.stats];
    pokemon.customPokemonData.nature=-1;
    const runStat=(name:string,level:number,nature:Nature,ivs:number[],hp:number) => {
      pokemon.level=level;pokemon.nature=nature;pokemon.ivs=[...ivs];pokemon.hp=hp;
      const preStats=[...pokemon.stats];const preHp=pokemon.hp;const hpBefore=observeHp();
      expect(hpBefore.multiplier).toBe(1);expect(hpBefore.debt).toBe(0);
      const baseStats=pokemon.calculateBaseStats();
      expect(baseStats).toEqual(pokemon.getSpeciesForm(true).baseStats);
      pokemon.calculateStats();
      const hpAfter=observeHp();expect(hpAfter.multiplier).toBe(1);expect(hpAfter.debt).toBe(0);
      statCases.push({name,level,nature,ivs:[...ivs],pre_stats:preStats,pre_hp:preHp,
        base_stats:baseStats,post_stats:[...pokemon.stats],post_hp:pokemon.hp,hp_before:hpBefore,hp_after:hpAfter});
    };
    runStat("hardy-level5-missing-hp",5,Nature.HARDY,[0,1,2,3,4,5],7);
    runStat("hardy-level6-carry-hp",6,Nature.HARDY,[0,1,2,3,4,5],pokemon.hp);
    runStat("lonely-level6",6,Nature.LONELY,[31,31,31,31,31,31],7);
    runStat("modest-level13",13,Nature.MODEST,[0,0,0,0,0,0],7);
    const highStats=[...pokemon.stats];
    runStat("hardy-level7-fainted",7,Nature.HARDY,[0,0,0,0,0,0],0);
    pokemon.stats=highStats;
    runStat("hardy-level4-clamp",4,Nature.HARDY,[0,0,0,0,0,0],highStats[0]);
  } finally {
    pokemon.level=original.level;pokemon.nature=original.nature;
    pokemon.customPokemonData.nature=original.custom_nature;
    pokemon.ivs=original.ivs;pokemon.stats=original.stats;pokemon.hp=original.hp;
  }
  expect(JSON.stringify(pokemon.customPokemonData)).toBe(customBefore);
  expect(Phaser.Math.RND.state()).toBe(rngBeforeStats);
  expect(pokemon.ivs).toBe(original.ivs);expect(pokemon.stats).toBe(original.stats);
  expect(pokemon.level).toBe(original.level);expect(pokemon.nature).toBe(original.nature);
  expect(pokemon.hp).toBe(original.hp);
  const statObservations={scope:"actual calculateStats on controlled fresh player fields; not XP or LevelUpPhase",
    context:statContext, original_custom_nature:original.custom_nature,
    cases:statCases, original_fields_restored:true, custom_data_restored:true, rng_restored:true};
  expect(observeModifiers()).toEqual(modifierObservations);
  expect(Object.keys(speciesStarterCosts)).toEqual(starterKeys);
  const raw = `${JSON.stringify({
    schema_version: 5, source_sha: PIN, seed: SEED,
    scope: "actual initialized registry diagnostic; no ability activation, target execution or neutrality claim",
    roster_source_sha: "f0a2b8c185a4e68dc88b4ea0b34128aeb8b28356",
    roster_run_id: "34373633488",
    roster_sha256: "52ed4b310f5f5fcb69a9ae17b1235d244a3719668fce7ef3c01a643be846e186",
    shattered_ability_id: ER_SHATTERED_PSYCHE_ABILITY_ID,
    abilities, moves, daily_pokerus:dailyPokerus, stats:statObservations, balance:balanceValues,
  })}\n`;
  expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(32768);
  writeFileSync(output, raw, "utf8");
  expect(Buffer.byteLength(raw,"utf8")).toBe(29641);
  const legacySha=createHash("sha256").update(raw).digest("hex");
  expect(legacySha).toBe("9b58691e1c5b3796e2b1bfe511483a445b7ab158e72e895fd15c86e5f9bc4576");
  const sidecarPath=process.env.M9_DEX_ENCOUNTER_OUTPUT;
  if(!sidecarPath) throw new Error("M9_DEX_ENCOUNTER_OUTPUT required");
  const dex=await observeDexAccountMethods();
  const sidecar=`${JSON.stringify({schema_version:1,source_sha:PIN,seed:SEED,legacy_sha256:legacySha,
    initial_encounter:initialEncounter,town_boss_pool:townBossPool,dex})}\n`;
  expect(Buffer.byteLength(sidecar,"utf8")).toBeLessThanOrEqual(32768);
  writeFileSync(sidecarPath,sidecar,{encoding:"utf8",flag:"wx"});
});

// Add imports to the existing cfff exporter (globalScene, Phaser, expect, vi,
// BiomeId are already imported):
// import Overrides from "#app/overrides";
// import { BattleType } from "#enums/battle-type";
// import { GameModes } from "#enums/game-modes";
// Call immediately after the existing natural classicMode.startBattle and
// BEFORE controlled stats/evolution/dex changes; retain as initial_encounter.
function observeInitialEncounterContext() {
  const battle = globalScene.currentBattle;
  const enemies = globalScene.getEnemyParty();
  expect(battle.waveIndex).toBe(1);
  expect(battle.battleType).toBe(BattleType.WILD);
  expect(globalScene.gameMode.modeId).toBe(GameModes.CLASSIC);
  expect(globalScene.arena.biomeId).toBe(BiomeId.TOWN);
  expect(battle.trainer == null).toBe(true);
  expect(battle.double).toBe(false);
  expect(enemies).toHaveLength(1);
  expect(vi.isMockFunction(globalScene.getEncounterBossSegments)).toBe(false);
  expect(vi.isMockFunction(globalScene.gameMode.isBoss)).toBe(false);
  const rngBefore = Phaser.Math.RND.state();
  const rows = enemies.map(mon => {
    expect(mon.isEnemy()).toBe(true);
    expect(vi.isMockFunction(mon.isBoss)).toBe(false);
    const before = [mon.bossSegments, mon.bossSegmentIndex];
    const predicateSegments = globalScene.getEncounterBossSegments(battle.waveIndex, mon.level, mon.species);
    expect(mon.bossSegments).toBe(0);
    expect(mon.bossSegmentIndex).toBe(0);
    expect(mon.isBoss()).toBe(false);
    expect(predicateSegments).toBe(0);
    expect(mon.species.subLegendary).toBe(false);
    expect(mon.species.legendary).toBe(false);
    expect(mon.species.mythical).toBe(false);
    expect([mon.bossSegments, mon.bossSegmentIndex]).toEqual(before);
    return {
      id: mon.id, species: mon.species.speciesId, form: mon.formIndex, level: mon.level,
      boss_segments: mon.bossSegments, boss_segment_index: mon.bossSegmentIndex,
      is_boss: mon.isBoss(), predicate_segments: predicateSegments,
      sub_legendary: mon.species.subLegendary, legendary: mon.species.legendary,
      mythical: mon.species.mythical,
    };
  });
  expect(Phaser.Math.RND.state()).toBe(rngBefore);
  const observed = (value: unknown) => ({ source_type: typeof value, value: value ?? null });
  return {
    scope: "actual fresh initial encounter before controlled observations; not later waves or custom doubles",
    wave: battle.waveIndex, battle_type: battle.battleType,
    mode: globalScene.gameMode.modeId, biome: globalScene.arena.biomeId,
    trainer_absent: battle.trainer == null, double: battle.double,
    format: battle.arrangement.format.id,
    cadence_boss: globalScene.gameMode.isBoss(battle.waveIndex),
    overrides: {
      health_segments: observed(Overrides.ENEMY_HEALTH_SEGMENTS_OVERRIDE),
      species: observed(Overrides.ENEMY_SPECIES_OVERRIDE),
      level: observed(Overrides.ENEMY_LEVEL_OVERRIDE),
    },
    enemies: rows, rng_unchanged: Phaser.Math.RND.state() === rngBefore,
  };
}

// Source-method observation on a genuine scene/Pokemon. This deliberately calls
// the public account methods used by evolve, not evolve or an evolution phase.
async function observeDexAccountMethods() {
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(1_783_641_600_000);
  const scene = globalScene;
  const originalAccount = scene.gameData;
  const pokemon = scene.getPlayerParty()[0];
  const original = { level:pokemon.level, species:pokemon.species, form:pokemon.formIndex, ability:pokemon.abilityIndex,
    nature:pokemon.nature, gender:pokemon.gender, shiny:pokemon.shiny, variant:pokemon.variant,
    ivs:pokemon.ivs };
  const rng = Phaser.Math.RND.state();
  const encode = (value:unknown) => JSON.stringify(value, (_key,value) => typeof value === "bigint" ? value.toString() : value);
  const hash = (value:unknown) => createHash("sha256").update(encode(value)).digest("hex");
  const snapshot = (account:GameData) => JSON.parse(encode({dex:account.dexData,starters:account.starterData,
    rest:Object.fromEntries(Object.entries(account).filter(([key])=>key!=="dexData" && key!=="starterData" && key!=="defaultDexData"))}));
  const originalAccountHash = hash(snapshot(originalAccount));
  expect(vi.isMockFunction(pokemon.getSpeciesForm().getLevelMoves)).toBe(false);
  const sourceLevelMoves=pokemon.getSpeciesForm().getLevelMoves().filter(([level])=>level>=1 && level<=10).map(row=>[...row]);
  expect(vi.isMockFunction(pokemon.getDexAttr)).toBe(false);
  expect(vi.isMockFunction(GameData)).toBe(false);
  expect(vi.isMockFunction(getErDifficulty)).toBe(false);
  expect(vi.isMockFunction(resolveAchievementRewardTeam)).toBe(false);
  const account = new GameData(true);
  expect(Phaser.Math.RND.state()).toBe(rng);
  const defaults = snapshot(account);
  expect(Object.keys(account.defaultDexData)).toEqual(Object.keys(account.dexData));
  for(const key of Object.keys(account.dexData)) expect(account.defaultDexData[key]).toBe(account.dexData[key]);
  const allIds = allSpecies.map(species=>species.speciesId);
  expect(new Set(allIds).size).toBe(allIds.length);
  expect(Object.keys(account.dexData).map(Number)).toEqual([...allIds].sort((a,b)=>a-b));
  const defaultIds = [...defaultStarterSpecies];
  const zero = {seenAttr:"0",caughtAttr:"0",natureAttr:0,seenCount:0,caughtCount:0,hatchedCount:0,
    ivs:[0,0,0,0,0,0],ribbons:defaults.dex[allIds[0]].ribbons};
  const sparse = [];
  for (const id of allIds) {
    const row = defaults.dex[id];
    expect(Object.keys(row).sort()).toEqual(Object.keys(zero).sort());
    if (!defaultIds.includes(id)) expect(row).toEqual(zero);
    else {
      expect(row.seenAttr).toBe("157"); expect(row.caughtAttr).toBe("157");
      expect(row.ivs).toEqual([15,15,15,15,15,15]);
      expect([0,6,12,18,24].map(n=>1<<(n+1))).toContain(row.natureAttr);
      expect({...row,seenAttr:"0",caughtAttr:"0",natureAttr:0,ivs:[0,0,0,0,0,0]}).toEqual(zero);
      sparse.push([id,row.natureAttr]);
    }
  }
  const starterIds=Object.keys(account.starterData).map(Number);
  const starterZero={...defaults.starters[starterIds[0]],abilityAttr:0};
  expect(starterZero).toEqual({moveset:null,eggMoves:0,candyCount:0,friendship:0,abilityAttr:0,
    passiveAttr:0,valueReduction:0,classicWinCount:0});
  for(const id of starterIds) expect(defaults.starters[id]).toEqual({...starterZero,abilityAttr:defaultIds.includes(id)?1:0});
  expect(defaultIds.every(id=>starterIds.includes(id))).toBe(true);
  const initial={constructor:"new GameData(true)",date_milliseconds:Date.now(),trainer_id:account.trainerId,secret_id:account.secretId,
    all_species_ids:allIds,dex_ids_sha256:hash(Object.keys(account.dexData).map(Number)),default_starter_ids:defaultIds,
    zero_entry:zero,default_attributes:"157",default_ivs:[15,15,15,15,15,15],default_natures:sparse,
    starter_ids:starterIds,starter_zero:starterZero,starter_ability_default:1,
    account_defaults:{highest_level:account.gameStats.highestLevel,achv_unlocks:{...account.achvUnlocks},
      voucher_unlocks:{...account.voucherUnlocks},voucher_counts:{...account.voucherCounts},eggs:[...account.eggs]},
    level_achievements:Object.entries(achvs).filter(([,a])=>a instanceof LevelAchv).map(([key,a])=>[key,(a as LevelAchv).level]),
    default_dex_entry_aliases:true,rng_restored:true,full_state_sha256:hash(defaults)};
  // Default call-through observer only, installed after proving the original is
  // not a mock; it does not suppress the achievement owner's actual effects.
  expect(vi.isMockFunction(scene.validateAchv)).toBe(false);
  const achievements=vi.spyOn(scene,"validateAchv");
  const calls=()=>achievements.mock.calls.map(args=>{
    const entry=Object.entries(achvs).find(([,value])=>value===args[0]);
    expect(entry).toBeDefined();return entry![0];
  });
  try {
    scene.gameData=account;
    expect(vi.isMockFunction(account.updateSpeciesDexIvs)).toBe(false);
    expect(vi.isMockFunction(account.setPokemonSeen)).toBe(false);
    expect(vi.isMockFunction(account.setPokemonCaught)).toBe(false);
    expect(pokemon.species.speciesId).toBe(SpeciesId.BULBASAUR);
    expect(pokemon.fusionSpecies == null).toBe(true);
    expect(pokemon.customPokemonData.erBlackShiny === true).toBe(false);
    expect(pokemon.customPokemonData.erShinyLab == null).toBe(true);
    expect(scene.gameMode.isCoop===true).toBe(false);
    expect(scene.gameMode.isDaily===true).toBe(false);
    expect(scene.gameMode.isFun===true).toBe(false);
    expect(scene.currentBattle.isBattleMysteryEncounter()).toBe(false);
    pokemon.species=getPokemonSpecies(SpeciesId.IVYSAUR);pokemon.formIndex=0;pokemon.abilityIndex=0;
    pokemon.nature=Nature.HARDY;pokemon.gender=Gender.MALE;pokemon.shiny=false;pokemon.variant=0;
    pokemon.ivs=[31,1,2,3,4,5];
    const context={source_species:1,target_species:2,form:0,ability_index:0,nature:Nature.HARDY,
      gender:Gender.MALE,shiny:false,variant:0,ivs:[...pokemon.ivs],dex_attr:pokemon.getDexAttr().toString(),
      root:pokemon.species.getRootSpeciesId(),starter_root:account.getRootStarterSpeciesId(pokemon.species.speciesId),
      level_moves_1_10:sourceLevelMoves,
      perfect_reward:{id:achvs.PERFECT_IVS.id,recipe:ER_ACHIEVEMENT_REWARDS.PERFECT_IVS,difficulty:getErDifficulty(),
        team:resolveAchievementRewardTeam(scene.getPlayerParty(),scene.currentBattle?.mysteryEncounter?.misc?.originalParty)
          .map(mon=>({species:mon.species.speciesId,root:mon.species.getRootSpeciesId(),starter_root:account.getRootStarterSpeciesId(mon.species.speciesId)}))},
      full_unlocks:[1,2].map(id=>[id,getPokemonSpecies(id).getFullUnlocksData().toString()]),
      original:{species:original.species.speciesId,form:original.form,ability_index:original.ability,
        nature:original.nature,gender:original.gender,shiny:original.shiny,variant:original.variant},
      coop:false,daily:false,fun:false,mystery:false,fusion:false,black_shiny:false,shiny_lab:false};
    const delta=(before:ReturnType<typeof snapshot>,after:ReturnType<typeof snapshot>)=>{
      const changed=(a:Record<string,unknown>,b:Record<string,unknown>)=>Object.keys(a).filter(key=>encode(a[key])!==encode(b[key])).map(key=>[Number(key),a[key],b[key]]);
      expect(Object.keys(after.dex)).toEqual(Object.keys(before.dex));
      expect(Object.keys(after.starters)).toEqual(Object.keys(before.starters));
      expect(Object.keys(after.rest)).toEqual(Object.keys(before.rest));
      return {dex:changed(before.dex,after.dex),starters:changed(before.starters,after.starters),
        rest:Object.keys(before.rest).filter(key=>encode(before.rest[key])!==encode(after.rest[key])).map(key=>[key,before.rest[key],after.rest[key]]),
        before_sha256:hash(before),after_sha256:hash(after)};
    };
    const observe=async(name:string,ivs:number[])=>{
      pokemon.ivs=ivs;const before=snapshot(account);const start=calls().length;
      account.updateSpeciesDexIvs(pokemon.species.speciesId,pokemon.ivs);
      const afterIvs=snapshot(account);
      account.setPokemonSeen(pokemon,false);
      const afterSeen=snapshot(account);
      const result=await account.setPokemonCaught(pokemon,false);
      const after=snapshot(account);
      return {name,ivs:[...ivs],caught_result:result,achievement_calls:calls().slice(start),
        ivs_delta:delta(before,afterIvs),seen_delta:delta(afterIvs,afterSeen),caught_delta:delta(afterSeen,after)};
    };
    const ordinary=await observe("owned-ivysaur-account-methods",[31,1,2,3,4,5]);
    const repeat=await observe("repeat-idempotent-account-methods",[31,1,2,3,4,5]);
    const beforeRental=snapshot(account);account.dexData[1].caughtAttr=0n;
    const gatedBefore=snapshot(account);const gated=await account.setPokemonCaught(pokemon,false);
    expect(gated).toBe(false);expect(snapshot(account)).toEqual(gatedBefore);
    account.dexData[1].caughtAttr=BigInt(beforeRental.dex[1].caughtAttr);
    expect(snapshot(account)).toEqual(beforeRental);
    const rental={root_caught:"0",caught_result:gated,full_state_unchanged:true};
    const genderBefore=pokemon.gender;pokemon.gender=Gender.GENDERLESS;
    const genderless=pokemon.getDexAttr().toString();pokemon.gender=genderBefore;
    const perfect=await observe("perfect-ivs-real-validation",[31,31,31,31,31,31]);
    return {scope:"actual initDexData/initStarterData through public fromRaw constructor, then direct ordered account methods; not Pokemon.evolve or phase execution",
      initial,context,cases:[ordinary,repeat,perfect],root_uncaught:rental,genderless_dex_attr:genderless,
      original_account_unchanged:hash(snapshot(originalAccount))===originalAccountHash};
  } finally {
    achievements.mockRestore();vi.useRealTimers();scene.gameData=originalAccount;
    pokemon.species=original.species;pokemon.formIndex=original.form;pokemon.abilityIndex=original.ability;
    pokemon.nature=original.nature;pokemon.gender=original.gender;pokemon.shiny=original.shiny;
    pokemon.variant=original.variant;pokemon.ivs=original.ivs;
    expect(hash(snapshot(originalAccount))).toBe(originalAccountHash);
    expect(Phaser.Math.RND.state()).toBe(rng);
  }
}

// Additional import, exact cached399d source module (5293 bytes):
// import { townBiome } from "#balance/biomes/town";
// Call after observeInitialEncounterContext, before controlled probes.
function observeTownBossPool() {
  expect(globalScene.currentBattle.waveIndex).toBe(1);
  expect(globalScene.arena.biomeId).toBe(BiomeId.TOWN);
  expect(townBiome.biomeId).toBe(BiomeId.TOWN);
  expect(townBiome.trainerChance).toBe(0);
  expect(vi.isMockFunction(globalScene.getEncounterBossSegments)).toBe(false);
  const ids = new Set<SpeciesId>();
  const poolRows: Array<[number, number, number[]]> = [];
  for (const [tier, times] of Object.entries(townBiome.pokemonPool)) {
    for (const [time, pool] of Object.entries(times)) {
      expect(Array.isArray(pool)).toBe(true);
      const values = pool.map(id => {
        expect(Number.isSafeInteger(id)).toBe(true);
        expect(id).toBeGreaterThan(0);
        ids.add(id);
        return id;
      });
      poolRows.push([Number(tier), Number(time), values]);
    }
  }
  poolRows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // Bounds protect the diagnostic; they do not truncate the source catalog.
  expect(poolRows.length).toBeLessThanOrEqual(64);
  expect(ids.size).toBeGreaterThan(0);
  expect(ids.size).toBeLessThanOrEqual(128);
  const rngBefore = Phaser.Math.RND.state();
  const rows = [...ids].sort((a, b) => a - b).map(id => {
    const species = getPokemonSpecies(id);
    expect(species.speciesId).toBe(id);
    const segments = globalScene.getEncounterBossSegments(1, 5, species);
    expect(species.subLegendary).toBe(false);
    expect(species.legendary).toBe(false);
    expect(species.mythical).toBe(false);
    expect(segments).toBe(0);
    return [id, species.subLegendary, species.legendary, species.mythical, segments] as const;
  });
  expect(Phaser.Math.RND.state()).toBe(rngBefore);
  return {
    scope: "initialized Town pool and actual first-wave boss predicate; not encounter selection parity",
    wave: 1, level: 5, biome: townBiome.biomeId, trainer_chance: townBiome.trainerChance,
    pool_rows: poolRows, species: rows, rng_unchanged: Phaser.Math.RND.state() === rngBefore,
  };
}
