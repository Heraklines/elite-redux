import { allAbilities, allMoves } from "#data/data-lists";
import { globalScene } from "#app/global-scene";
import { speciesStarterCosts, FRIENDSHIP_GAIN_FROM_BATTLE } from "#balance/starters";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { getPokemonSpecies, getPokerusStarters } from "#utils/pokemon-utils";
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
  expect(starterKeys).toHaveLength(570);
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
  const statContext = {
    species:pokemon.species.speciesId, form:pokemon.formIndex,
    modifiers:globalScene.modifiers.length, challenges:globalScene.gameMode.challenges.length,
    spliced:globalScene.gameMode.isSplicedOnly === true, spliced_source_type:typeof globalScene.gameMode.isSplicedOnly,
    fun_mode:globalScene.gameMode.isFun === true, fun_source_type:typeof globalScene.gameMode.isFun,
    fusion:pokemon.isFusion(),
    fun_pseudo_mega:pokemon.isFunPseudoMega(), fun_shuffle:getFunModeConfig().shuffleStats,
    cursed_stat:pokemon.customPokemonData.erCursedStat, moody:getMoodyModeState(),
    wonder_guard:pokemon.hasAbility(AbilityId.WONDER_GUARD, false, true),
  };
  expect(statContext.modifiers).toBe(0);expect(statContext.challenges).toBe(0);
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
    base_stats:number[];post_stats:number[];post_hp:number}> = [];
  try {
    pokemon.stats=[...original.stats];
    pokemon.customPokemonData.nature=-1;
    const runStat=(name:string,level:number,nature:Nature,ivs:number[],hp:number) => {
      pokemon.level=level;pokemon.nature=nature;pokemon.ivs=[...ivs];pokemon.hp=hp;
      const preStats=[...pokemon.stats];const preHp=pokemon.hp;
      const baseStats=pokemon.calculateBaseStats();
      expect(baseStats).toEqual(pokemon.getSpeciesForm(true).baseStats);
      pokemon.calculateStats();
      statCases.push({name,level,nature,ivs:[...ivs],pre_stats:preStats,pre_hp:preHp,
        base_stats:baseStats,post_stats:[...pokemon.stats],post_hp:pokemon.hp});
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
});
