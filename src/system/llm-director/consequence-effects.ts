import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { Egg } from "#data/egg";
import type { ConsequenceEffect, TargetSpec } from "#data/llm-director/beat-schema";
import type { BiomeId } from "#enums/biome-id";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { PlayerPokemon } from "#field/pokemon";
import type { ModifierType } from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/utils/encounter-phase-utils";
import { VoucherType } from "#system/voucher";
import { randSeedInt } from "#utils/common";

/**
 * Dispatches the v2 `Consequence.effects[]` array. Each effect is a tagged
 * variant from `ConsequenceEffect`; we route to the correct subroutine here.
 *
 * Many effects are implemented end-to-end (heal, damage, status, items, money,
 * biome, weather, eggs, vouchers, level/xp, friendship, custom). The rest are
 * stubbed with `console.info` so the LLM still gets to express them in
 * narrative — the player sees `epilogueText` + the `custom`-effect
 * description, which is the experiential consequence even when the game
 * cannot mechanically simulate the change. v2 will tighten the gaps.
 *
 * IMPORTANT: this is invoked from a phase, so we may freely mutate
 * `globalScene` and queue messages. Order is preserved: effects fire in
 * array order, but `queueMessage` unshifts, so reverse-order is required if
 * we want LLM-source-order display. We don't — we want simple "all effects
 * apply, then a short summary" semantics, which keeps the messaging cap low.
 */
/**
 * Apply each effect in source order. Effect handlers MUTATE game state
 * directly (heal HP, change biome, etc.) but DO NOT queue messages —
 * instead they return any narrative text they produced. The caller
 * collects those messages and queues ONE consolidated `$`-paginated
 * MessagePhase so Enter advances through them as pages of a single
 * dialog instead of fighting between separate MessagePhases that race
 * with battle UI mode changes (the bug that left the player stuck on
 * "the torn corner of the map dissolves" with no way to advance).
 */
export function applyEffects(effects: readonly ConsequenceEffect[]): string[] {
  const messages: string[] = [];
  for (const effect of effects) {
    try {
      const msg = dispatchOne(effect);
      if (msg) {
        messages.push(msg);
      }
    } catch (err) {
      console.error(`[llm-director] effect crashed type=${effect.type}`, err);
    }
  }
  return messages;
}

/**
 * Resolve a TargetSpec to concrete party members. `undefined` defaults to
 * "all" — most effects apply to the whole party. "random" uses the seeded
 * RNG so saves can replay deterministically. Empty result = effect no-ops
 * silently (logged at the call site).
 */
export function resolveTargets(spec: TargetSpec | undefined, party: PlayerPokemon[]): PlayerPokemon[] {
  if (party.length === 0) {
    return [];
  }
  if (!spec || spec === "all") {
    return [...party];
  }
  if (spec === "random") {
    return [party[randSeedInt(party.length)]];
  }
  if ("partyIndex" in spec) {
    const member = party[spec.partyIndex];
    return member ? [member] : [];
  }
  if ("species" in spec) {
    const match = party.find(p => p.species.speciesId === spec.species);
    return match ? [match] : [];
  }
  return [];
}

function getParty(): PlayerPokemon[] {
  return globalScene.getPlayerParty();
}

function dispatchOne(effect: ConsequenceEffect): string | null {
  switch (effect.type) {
    case "heal_party_hp":
      applyHealHp(effect);
      return null;
    case "heal_party_status":
      applyHealStatus(effect);
      return null;
    case "heal_party_full":
      applyHealFull(effect);
      return null;
    case "revive":
      applyRevive(effect);
      return null;
    case "revive_all":
      applyReviveAll();
      return null;
    case "status_inflict":
      applyStatusInflict(effect);
      return null;
    case "damage_party":
      applyDamageParty(effect);
      return null;
    case "give_item":
      applyGiveItem(effect);
      return null;
    case "remove_item":
      applyRemoveItem(effect);
      return null;
    case "give_money":
      applyGiveMoney(effect);
      return null;
    case "lose_money":
      applyLoseMoney(effect);
      return null;
    case "level_up":
      applyLevelUp(effect);
      return null;
    case "give_xp":
      applyGiveXp(effect);
      return null;
    case "friendship_boost":
      applyFriendshipBoost(effect);
      return null;
    case "set_biome":
      return applySetBiome(effect);
    case "weather_change":
      applyWeatherChange(effect);
      return null;
    case "give_egg":
      applyGiveEgg(effect);
      return null;
    case "give_voucher":
      applyGiveVoucher(effect);
      return null;
    case "custom":
      return applyCustom(effect);
    case "faint":
      applyFaint(effect);
      return null;
    // --- stubbed (schema-visible, log + no-op for v1) ------------------
    case "heal_party_pp":
    case "stat_boost_temp":
    case "stat_boost_permanent":
    case "evolve":
    case "learn_move":
    case "forget_move":
    case "change_ability":
    case "change_type":
    case "change_form":
    case "give_held_item":
    case "remove_held_item":
    case "tera_change":
    case "shiny_unlock":
    case "release_pokemon":
    case "level_down":
    case "trigger_battle":
    case "trigger_boss_battle":
    case "skip_wave":
    case "force_capture_chance":
    case "field_effect":
    case "reveal_map_ahead":
    case "buff_persistent":
    case "debuff_persistent":
    case "lose_egg":
      console.info(`[llm-director] effect-stubbed type=${effect.type} — TODO v2 implement end-to-end`);
      return null;
  }
}

// -------------------------------------------------------------------------
// Heal / restore
// -------------------------------------------------------------------------

function applyHealHp(effect: { target?: TargetSpec; percentMaxHp: number }): void {
  const targets = resolveTargets(effect.target, getParty());
  for (const p of targets) {
    if (p.isFainted()) {
      continue;
    }
    const amount = Math.ceil((p.getMaxHp() * effect.percentMaxHp) / 100);
    p.heal(amount);
  }
  console.info(`[llm-director] heal_party_hp percent=${effect.percentMaxHp} count=${targets.length}`);
}

function applyHealStatus(effect: { target?: TargetSpec }): void {
  const targets = resolveTargets(effect.target, getParty());
  for (const p of targets) {
    if (p.status) {
      // asPhase=false to avoid scheduling a ResetStatusPhase inside a beat
      // phase — we just want immediate clear without animation interference.
      p.resetStatus(false, false, false, false);
    }
  }
  console.info(`[llm-director] heal_party_status count=${targets.length}`);
}

function applyHealFull(effect: { target?: TargetSpec }): void {
  const targets = resolveTargets(effect.target, getParty());
  for (const p of targets) {
    if (p.isFainted()) {
      continue;
    }
    p.heal(p.getMaxHp());
    if (p.status) {
      p.resetStatus(false, false, false, false);
    }
    // PP refill — directly clear ppUsed on each move slot.
    for (const move of p.moveset) {
      if (move) {
        move.ppUsed = 0;
      }
    }
  }
  console.info(`[llm-director] heal_party_full count=${targets.length}`);
}

function applyRevive(effect: { target?: TargetSpec; percentMaxHp?: number }): void {
  const targets = resolveTargets(effect.target, getParty());
  const pct = effect.percentMaxHp ?? 50;
  for (const p of targets) {
    if (!p.isFainted()) {
      continue;
    }
    p.resetStatus(true, false, false, false);
    p.hp = Math.max(1, Math.ceil((p.getMaxHp() * pct) / 100));
  }
  console.info(`[llm-director] revive percent=${pct} count=${targets.length}`);
}

function applyReviveAll(): void {
  for (const p of getParty()) {
    if (!p.isFainted()) {
      continue;
    }
    p.resetStatus(true, false, false, false);
    p.hp = p.getMaxHp();
  }
  console.info("[llm-director] revive_all (sacred ash)");
}

// -------------------------------------------------------------------------
// Damage / status
// -------------------------------------------------------------------------

const STATUS_KEY_TO_ENUM: Record<string, StatusEffect> = {
  POISON: StatusEffect.POISON,
  BURN: StatusEffect.BURN,
  PARALYSIS: StatusEffect.PARALYSIS,
  SLEEP: StatusEffect.SLEEP,
  FREEZE: StatusEffect.FREEZE,
  TOXIC: StatusEffect.TOXIC,
};

function applyStatusInflict(effect: { target?: TargetSpec; status: string }): void {
  const targets = resolveTargets(effect.target, getParty());
  const statusEffect = STATUS_KEY_TO_ENUM[effect.status];
  if (statusEffect === undefined) {
    console.warn(`[llm-director] unknown status="${effect.status}"`);
    return;
  }
  for (const p of targets) {
    if (p.isFainted()) {
      continue;
    }
    // trySetStatus checks immunities (Electric vs paralysis, Fire vs burn,
    // etc.). Story-driven effects shouldn't fight type immunity, so we skip
    // the failures rather than forcing.
    p.trySetStatus(statusEffect);
  }
  console.info(`[llm-director] status_inflict status=${effect.status} count=${targets.length}`);
}

function applyDamageParty(effect: { target?: TargetSpec; percentMaxHp: number }): void {
  const targets = resolveTargets(effect.target, getParty());
  for (const p of targets) {
    if (p.isFainted()) {
      continue;
    }
    const amount = Math.ceil((p.getMaxHp() * effect.percentMaxHp) / 100);
    // Floor at 1 HP — story damage shouldn't outright KO unless `faint`
    // effect is used. Lets the player feel the hit but stay alive.
    p.hp = Math.max(1, p.hp - amount);
  }
  console.info(`[llm-director] damage_party percent=${effect.percentMaxHp} count=${targets.length}`);
}

function applyFaint(effect: { target: TargetSpec }): void {
  const targets = resolveTargets(effect.target, getParty());
  for (const p of targets) {
    if (p.isFainted()) {
      continue;
    }
    p.hp = 0;
    p.trySetStatus(StatusEffect.FAINT);
  }
  console.info(`[llm-director] faint count=${targets.length}`);
}

// -------------------------------------------------------------------------
// Inventory / economy
// -------------------------------------------------------------------------

function applyGiveItem(effect: { modifierType: string; qty?: number }): void {
  const factories = modifierTypes as Record<string, (() => ModifierType) | undefined>;
  const rawFactory = factories[effect.modifierType];
  if (typeof rawFactory !== "function") {
    console.warn(`[llm-director] give_item unknown modifierType="${effect.modifierType}"`);
    return;
  }
  const resolved = resolveItemThunk(rawFactory, effect.modifierType);
  if (!resolved) {
    return;
  }
  const qty = Math.max(1, effect.qty ?? 1);
  for (let i = 0; i < qty; i++) {
    globalScene.phaseManager.unshiftNew("ModifierRewardPhase", resolved);
  }
  console.info(`[llm-director] give_item type=${effect.modifierType} qty=${qty}`);
}

/**
 * Resolve a `modifierTypes[id]` factory into a thunk that returns a fully-
 * materialized `ModifierType` (with `id`, `tier`, and — for generators like
 * `TM_COMMON` / `EVOLUTION_ITEM` — a concrete pick).
 *
 * Uses PokeRogue's canonical `generateModifierType` helper (the same one
 * mystery encounters use, e.g. `absolute-avarice-encounter.ts:290`,
 * `bug-type-superfan-encounter.ts:221`). Without this, passing a bare
 * generator to `ModifierRewardPhase` shows "You received !" with an empty
 * name, because the generator's `localeKey` is unset until `generateType`
 * runs against the player's party.
 *
 * Returns `null` when the generator has no compatible pick for the current
 * party (e.g. TM_COMMON when no party member can learn any common-tier TM);
 * caller should skip the reward rather than enqueue an empty phase.
 */
export function resolveItemThunk(rawFactory: () => ModifierType, id: string): (() => ModifierType) | null {
  const resolved = generateModifierType(rawFactory);
  if (!resolved) {
    console.warn(
      `[llm-director] give_item generator "${id}" produced no compatible item for current party — skipping reward`,
    );
    return null;
  }
  return () => resolved;
}

function applyRemoveItem(effect: { modifierType: string; qty?: number }): void {
  // We don't have a clean "remove modifier of type X by string key" path —
  // mods are identified by class instance, not the string key the LLM uses.
  // Surface the intent in logs; v2 will need a name → modifier-class map.
  console.info(
    `[llm-director] remove_item-stubbed type=${effect.modifierType} qty=${effect.qty ?? "all"} — TODO v2 implement (modifier-by-key removal not yet supported)`,
  );
}

function applyGiveMoney(effect: { amount: number }): void {
  globalScene.addMoney(Math.max(1, Math.floor(effect.amount)));
  console.info(`[llm-director] give_money amount=${effect.amount}`);
}

function applyLoseMoney(effect: { amount: number }): void {
  const loss = Math.max(1, Math.floor(effect.amount));
  globalScene.money = Math.max(0, globalScene.money - loss);
  globalScene.updateMoneyText();
  globalScene.animateMoneyChanged(false);
  console.info(`[llm-director] lose_money amount=${loss}`);
}

const EGG_TIER_MAP: Record<string, EggTier> = {
  common: EggTier.COMMON,
  rare: EggTier.RARE,
  epic: EggTier.EPIC,
  legendary: EggTier.LEGENDARY,
};

function applyGiveEgg(effect: { tier: string }): void {
  const tier = EGG_TIER_MAP[effect.tier];
  if (tier === undefined) {
    console.warn(`[llm-director] give_egg unknown tier="${effect.tier}"`);
    return;
  }
  const egg = new Egg({
    tier,
    sourceType: EggSourceType.EVENT,
    pulled: false,
  });
  egg.addEggToGameData();
  console.info(`[llm-director] give_egg tier=${effect.tier}`);
}

const VOUCHER_KEY_MAP: Record<string, VoucherType> = {
  REGULAR: VoucherType.REGULAR,
  PLUS: VoucherType.PLUS,
  PREMIUM: VoucherType.PREMIUM,
  GOLDEN: VoucherType.GOLDEN,
};

function applyGiveVoucher(effect: { voucherType: string }): void {
  const vt = VOUCHER_KEY_MAP[effect.voucherType];
  if (vt === undefined) {
    console.warn(`[llm-director] give_voucher unknown voucherType="${effect.voucherType}"`);
    return;
  }
  globalScene.gameData.voucherCounts[vt] = (globalScene.gameData.voucherCounts[vt] ?? 0) + 1;
  console.info(`[llm-director] give_voucher type=${effect.voucherType}`);
}

// -------------------------------------------------------------------------
// Stat / progression
// -------------------------------------------------------------------------

function applyLevelUp(effect: { target?: TargetSpec; levels: number }): void {
  const targets = resolveTargets(effect.target, getParty());
  for (const p of targets) {
    for (let i = 0; i < effect.levels; i++) {
      // LevelUpPhase increments level and queues stat-up animations + the
      // standard fanfare. partyIndex is required so the phase finds the
      // right Pokémon.
      const partyIndex = getParty().indexOf(p);
      if (partyIndex < 0) {
        continue;
      }
      globalScene.phaseManager.unshiftNew("LevelUpPhase", partyIndex, p.level + i, p.level + i + 1);
    }
  }
  console.info(`[llm-director] level_up levels=${effect.levels} count=${targets.length}`);
}

function applyGiveXp(effect: { target?: TargetSpec; amount: number }): void {
  const targets = resolveTargets(effect.target, getParty());
  for (const p of targets) {
    const partyIndex = getParty().indexOf(p);
    if (partyIndex < 0) {
      continue;
    }
    globalScene.phaseManager.unshiftNew("ExpPhase", partyIndex, effect.amount);
  }
  console.info(`[llm-director] give_xp amount=${effect.amount} count=${targets.length}`);
}

function applyFriendshipBoost(effect: { target?: TargetSpec; amount: number }): void {
  const targets = resolveTargets(effect.target, getParty());
  for (const p of targets) {
    p.addFriendship(effect.amount);
  }
  console.info(`[llm-director] friendship_boost amount=${effect.amount} count=${targets.length}`);
}

// -------------------------------------------------------------------------
// Field / world
// -------------------------------------------------------------------------

function applySetBiome(effect: { biomeId: number; flavorText?: string }): string | null {
  globalScene.phaseManager.unshiftNew("SwitchBiomePhase", effect.biomeId as BiomeId);
  console.info(`[llm-director] set_biome biomeId=${effect.biomeId}`);
  return effect.flavorText ?? null;
}

const WEATHER_KEY_MAP: Record<string, WeatherType> = {
  RAIN: WeatherType.RAIN,
  SUNNY: WeatherType.SUNNY,
  SANDSTORM: WeatherType.SANDSTORM,
  HAIL: WeatherType.HAIL,
  FOG: WeatherType.FOG,
  HEAVY_RAIN: WeatherType.HEAVY_RAIN,
  HARSH_SUN: WeatherType.HARSH_SUN,
  STRONG_WINDS: WeatherType.STRONG_WINDS,
};

function applyWeatherChange(effect: { weather: string; duration: string; waves?: number }): void {
  const wt = WEATHER_KEY_MAP[effect.weather];
  if (wt === undefined) {
    console.warn(`[llm-director] weather_change unknown weather="${effect.weather}"`);
    return;
  }
  // trySetWeather picks up at the start of next battle. Duration semantics
  // (next_battle vs n_waves) are honored at a policy level by the arena: the
  // weather persists until something else clears it. Tracking a multi-wave
  // weather plan is a v2 feature; for now both durations behave identically
  // (set + persist).
  globalScene.arena.trySetWeather(wt);
  console.info(
    `[llm-director] weather_change weather=${effect.weather} duration=${effect.duration} waves=${effect.waves ?? "-"}`,
  );
}

// -------------------------------------------------------------------------
// Custom (escape hatch) — narrative-only, no mechanical effect
// -------------------------------------------------------------------------

function applyCustom(effect: { description: string; severity?: string; positive?: boolean }): string {
  // The "effect" is the narrative. Return the prefixed description; the
  // caller consolidates all effect messages + epilogue into ONE
  // `$`-paginated MessagePhase so the player can advance through them
  // as pages of a single dialog instead of fighting between separate
  // MessagePhases that race with battle UI mode changes.
  const prefix = effect.positive === true ? "✨ " : effect.positive === false ? "⚠ " : "";
  console.info(
    `[llm-director] custom-effect description="${effect.description}" severity=${effect.severity ?? "-"} positive=${effect.positive ?? "-"}`,
  );
  return `${prefix}${effect.description}`;
}
