import { allAbilities, allMoves } from "#data/data-lists";
import { getErEndlessState, getErEndlessBattleRuntime } from "#data/elite-redux/er-endless-continuation";
import { getMoodyCoordinatorEffectState } from "#data/elite-redux/moody/moody-coordinator-combat-state";
import { getMoodyHealingMultiplier } from "#data/elite-redux/moody/moody-scene-adapter";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { MoveEffectPhase } from "#phases/move-effect-phase";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const SEED = "m9e-defender-source-v1";
let game: Phaser.Game | null = null;
let manager: GameManager | null = null;
const restores: (() => void)[] = [];

afterAll(() => {
  for (const restore of restores.reverse()) restore();
  manager?.promptHandler.clearPrompts();
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  game?.destroy(true);
});

test("observe actual defender absorb phase and healing ownership", async () => {
  const output = process.env.M9_DEFENDER_ABILITY_OUTPUT;
  if (output == null) throw new Error("M9_DEFENDER_ABILITY_OUTPUT required");
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
  const scene = manager.scene;
  const actor = manager.field.getPlayerPokemon();
  const holder = manager.field.getEnemyPokemon();
  const pm = scene.phaseManager;
  const environment = () => ({
    classic: scene.gameMode.isClassic,
    moody_absent: getMoodyModeState() == null,
    set_collector_absent: getMoodyCoordinatorEffectState("set-collector") == null,
    endless_absent: getErEndlessState() == null,
    endless_battle_absent: getErEndlessBattleRuntime() == null,
    actor_heal_multiplier: getMoodyHealingMultiplier(actor),
    holder_heal_multiplier: getMoodyHealingMultiplier(holder),
    holder_heal_block: holder.getTag(BattlerTagType.HEAL_BLOCK) != null,
    holder_bleed: holder.getTag(BattlerTagType.ER_BLEED) != null,
    ability_flyouts: scene.showAbilityFlyouts,
  });
  const bootstrap = {
    environment: environment(),
    actor: { species: actor.species.speciesId, hp: actor.hp, max_hp: actor.getMaxHp(), ability: actor.getAbility().id },
    holder: { species: holder.species.speciesId, hp: holder.hp, max_hp: holder.getMaxHp(), ability: holder.getAbility().id },
  };
  for (const fn of [holder.heal, holder.getMoveEffectiveness, actor.randBattleSeedInt,
    holder.getCriticalHitResult, pm.unshiftNew, pm.prepareCurrentPhaseForStart,
    MoveEffectPhase.prototype.hitCheck]) expect(vi.isMockFunction(fn)).toBe(false);
  expect(bootstrap.environment.classic).toBe(true);
  expect(bootstrap.environment.moody_absent).toBe(true);
  expect(bootstrap.environment.set_collector_absent).toBe(true);
  expect(bootstrap.environment.endless_absent).toBe(true);
  expect(bootstrap.environment.endless_battle_absent).toBe(true);

  // Explicit controlled inputs AFTER the genuine source bootstrap. No source
  // global, phase queue, RNG result, implementation method or oracle is replaced.
  actor.setAbilityOverrideForSlot(0, AbilityId.NONE);
  holder.setAbilityOverrideForSlot(0, 5082 as AbilityId);
  actor.setMove(0, MoveId.POISON_STING);
  for (let slot = 0; slot < 4; slot++) holder.setMove(slot, MoveId.HARDEN);
  expect(holder.getAbility().id).toBe(5082);
  const absorb = allAbilities[5082].attrs.find(attr => attr.constructor.name === "TypeAbsorbHealAbAttr");
  if (absorb == null || !("getHealFraction" in absorb) || typeof absorb.getHealFraction !== "function") {
    throw new Error("actual initialized absorb getter missing");
  }
  const healFraction = absorb.getHealFraction();
  expect(healFraction).toBe(0.25);
  const move = allMoves[MoveId.POISON_STING];
  const metadata = {
    ability: { id: 5082, attrs: allAbilities[5082].attrs.map(attr => attr.constructor.name), heal_fraction: healFraction },
    move: { id: move.id, type: move.type, target: move.moveTarget, category: move.category,
      accuracy: move.accuracy, attrs: move.attrs.map(attr => attr.constructor.name) },
    controlled_inputs: ["actor active ability NONE", "holder active ability 5082", "actor slot0 Poison Sting", "holder four Harden slots", "holder HP wounded/full per case"],
  };
  type Row = Record<string, string | number | boolean | null | number[] | string[]>;
  let journal: Row[] = [];
  const add = (row: Row) => {
    if (journal.length >= 160) throw new Error("bounded defender journal exhausted");
    journal.push({ ordinal: journal.length, phase: pm.getCurrentPhase().phaseName, ...row });
  };
  function observe<T extends object, K extends keyof T>(object: T, key: K,
    apply: (invoke: () => unknown, args: unknown[]) => unknown) {
    const original = object[key];
    if (typeof original !== "function") throw new Error("observer target is not callable");
    object[key] = new Proxy(original, { apply(target, self, args) { return apply(() => Reflect.apply(target, self, args), args); } }) as T[K];
    restores.push(() => { object[key] = original; });
  }
  observe(pm, "unshiftNew", (invoke, args) => {
    if (args[0] === "PokemonHealPhase") add({ kind: "queue_heal", battler: Number(args[1]), requested: Number(args[2]), message_null: args[3] === null, show_full_hp: args[4] === true, hp: holder.hp });
    return invoke();
  });
  observe(pm, "queueAbilityDisplay", (invoke, args) => {
    if (args[0] === holder) add({ kind: "ability_display", passive: args[1] === true, show: args[2] === true, slot: Number(args[3] ?? 0), ability: Number(args[4] ?? holder.getAbility().id), hp: holder.hp });
    return invoke();
  });
  observe(pm, "prepareCurrentPhaseForStart", (invoke, args) => {
    const result = invoke();
    const name = pm.getCurrentPhase().phaseName;
    if (["MovePhase", "MoveEffectPhase", "MoveEndPhase", "PokemonHealPhase", "ShowAbilityPhase", "HideAbilityPhase", "TurnEndPhase"].includes(name)) {
      add({ kind: "phase_start", hp: holder.hp });
    }
    return result;
  });
  observe(holder, "heal", (invoke, args) => {
    add({ kind: "heal_before", requested: Number(args[0]), hp: holder.hp });
    const value = invoke();
    add({ kind: "heal_after", actual: Number(value), hp: holder.hp });
    return value;
  });
  observe(holder, "getCriticalHitResult", (invoke, args) => {
    add({ kind: "critical_call", hp: holder.hp });
    return invoke();
  });
  observe(actor, "randBattleSeedInt", (invoke, args) => {
    const result = invoke();
    add({ kind: "actor_rng", range: Number(args[0]), min: Number(args[1] ?? 0), result: Number(result) });
    return result;
  });
  observe(MoveEffectPhase.prototype, "hitCheck", (invoke, args) => {
    add({ kind: "hit_check_before", holder_target: args[0] === holder, hp: holder.hp });
    const result = invoke();
    if (!Array.isArray(result) || result.length !== 2) throw new Error("unexpected real hitCheck output");
    add({ kind: "hit_check_after", holder_target: args[0] === holder, result: Number(result[0]), effectiveness: Number(result[1]), hp: holder.hp });
    return result;
  });
  const ledger = () => ({
    wave: [...holder.waveData.abilitiesApplied].sort((a, b) => a - b),
    summon: [...holder.summonData.abilitiesApplied].sort((a, b) => a - b),
  });
  const cases = [];
  for (const id of ["wounded", "full"] as const) {
    journal = [];
    const maxHP = holder.getMaxHp();
    holder.hp = id === "wounded" ? Math.max(1, Math.floor(maxHP / 2)) : maxHP;
    const before = { hp: holder.hp, max_hp: maxHP, environment: environment(), ledger: ledger() };
    const queueBefore = pm.getQueuedPhaseNames();
    const simulated = holder.getMoveEffectiveness(actor, move, false, true);
    expect(simulated).toBe(0);
    expect(holder.hp).toBe(before.hp);
    expect(ledger()).toEqual(before.ledger);
    expect(pm.getQueuedPhaseNames()).toEqual(queueBefore);
    expect(journal).toEqual([]);
    const logStart = manager.phaseInterceptor.log.length;
    manager.move.select(MoveId.POISON_STING);
    await manager.phaseInterceptor.to("TurnEndPhase");
    const phases = manager.phaseInterceptor.log.slice(logStart);
    expect(phases.length).toBeLessThanOrEqual(128);
    const heals = journal.filter(row => row.kind === "heal_after");
    const requested = Math.max(Math.floor(maxHP / 4), 1);
    expect(holder.hp).toBe(Math.min(maxHP, before.hp + (id === "wounded" ? requested : 0)));
    expect(heals).toHaveLength(id === "wounded" ? 1 : 0);
    expect(journal.filter(row => row.kind === "queue_heal")).toHaveLength(id === "wounded" ? 1 : 0);
    expect(journal.filter(row => row.kind === "critical_call")).toHaveLength(0);
    expect(journal.filter(row => row.kind === "actor_rng" && row.phase === "MoveEffectPhase")).toHaveLength(0);
    expect(journal.find(row => row.kind === "hit_check_after" && row.holder_target)?.result).toBe(id === "wounded" ? 3 : 2);
    expect(journal.some(row => row.kind === "ability_display" && row.show === true && row.ability === 5082)).toBe(true);
    expect(ledger().wave).toContain(5082);
    expect(ledger().summon).toContain(5082);
    cases.push({ id, before, simulated, after: { hp: holder.hp, environment: environment(), ledger: ledger() }, phases, journal });
    if (id === "wounded") { journal = []; await manager.toNextTurn(); }
  }
  const raw = `${JSON.stringify({ schema_version: 1, source_sha: PIN, seed: SEED,
    scope: "actual source PhaseTree diagnostic after genuine bootstrap with explicit controlled Pokemon inputs; not Rust qualification",
    bootstrap, metadata, cases })}\n`;
  expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(32768);
  writeFileSync(output, raw, "utf8");
});
