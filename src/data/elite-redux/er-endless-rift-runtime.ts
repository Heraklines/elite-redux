import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getFunRealMegaChoices } from "#data/elite-redux/er-fun-mega-mode";
import {
  getErEndlessBattleRuntime,
  getErEndlessState,
  hasErEndlessRift,
  isErEndlessContinuationActive,
  setErEndlessBattleRuntime,
  type ErEndlessBattleRuntimeSaveData,
} from "#data/elite-redux/er-endless-continuation";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat, type PermanentStat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { SwitchType } from "#enums/switch-type";
import { WeatherType } from "#enums/weather-type";
import { TerrainType } from "#data/terrain";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { PokemonMove } from "#moves/pokemon-move";
import { toDmgValue } from "#utils/common";

export type ErEndlessMoveOutcome = "hit" | "miss" | "failed" | "immune";

export interface ErEndlessSwitchTransfer {
  stages?: number[] | undefined;
  status?: StatusEffect | undefined;
}

let applyingSoulLink = false;
let applyingMirroredStatus = false;

const ORDINARY_TYPES = Array.from({ length: PokemonType.FAIRY + 1 }, (_, index) => index as PokemonType);
const CAROUSEL_WEATHER = [
  WeatherType.NONE,
  WeatherType.SUNNY,
  WeatherType.RAIN,
  WeatherType.SANDSTORM,
  WeatherType.HAIL,
  WeatherType.SNOW,
  WeatherType.FOG,
] as const;
const CAROUSEL_TERRAIN = [
  TerrainType.NONE,
  TerrainType.MISTY,
  TerrainType.ELECTRIC,
  TerrainType.GRASSY,
  TerrainType.PSYCHIC,
  TerrainType.TOXIC,
] as const;

function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pokemonKey(pokemon: Pokemon): string {
  return `${pokemon.isPlayer() ? "p" : "e"}:${pokemon.id}`;
}

function moveSlot(pokemon: Pokemon, move: Move): number {
  return pokemon.getMoveset().findIndex(candidate => candidate?.moveId === move.id);
}

const SCRAMBLE_EXCLUDED_MOVES = new Set<MoveId>([
  MoveId.NONE,
  MoveId.STRUGGLE,
  MoveId.SKETCH,
  MoveId.TRANSFORM,
  MoveId.REVIVAL_BLESSING,
]);

function eligibleTemporaryMoves(): Move[] {
  return allMoves.filter((move): move is Move =>
    move != null
    && !SCRAMBLE_EXCLUDED_MOVES.has(move.id)
    && move.pp > 0
    && !move.name.endsWith(" (N)")
    && !move.hasAttr("OneHitKOAttr")
    && !move.hasAttr("SacrificialAttr")
    && !move.hasAttr("SacrificialAttrOnHit"),
  );
}

function ensureMoveSnapshot(pokemon: Pokemon, current: ErEndlessBattleRuntimeSaveData): void {
  const key = pokemonKey(pokemon);
  if (current.moveSnapshots[key]) {
    return;
  }
  current.moveSnapshots[key] = pokemon.getMoveset().map(move => ({
    moveId: move.moveId,
    ppUsed: move.ppUsed,
    ppUp: move.ppUp,
    maxPpOverride: move.maxPpOverride,
  }));
}

type PokemonMoveConstructor = new (
  moveId: MoveId,
  ppUsed?: number,
  ppUp?: number,
  maxPpOverride?: number,
) => PokemonMove;

function createPokemonMove(
  pokemon: Pokemon,
  moveId: MoveId,
  ppUsed = 0,
  ppUp = 0,
  maxPpOverride?: number,
): PokemonMove {
  const reference = pokemon.getMoveset()[0];
  const MoveConstructor = reference.constructor as PokemonMoveConstructor;
  return new MoveConstructor(moveId, ppUsed, ppUp, maxPpOverride);
}

function selectTemporaryMoveMatching(
  domain: string,
  excluded: ReadonlySet<MoveId>,
  predicate: (move: Move) => boolean,
): Move | null {
  const candidates = eligibleTemporaryMoves().filter(move => !excluded.has(move.id) && predicate(move));
  return candidates.length > 0
    ? candidates[hash32(`${getErEndlessState()?.seed ?? ""}:${domain}`) % candidates.length]
    : null;
}

function installMetronomeVeilMoves(pokemon: Pokemon, current: ErEndlessBattleRuntimeSaveData): void {
  ensureMoveSnapshot(pokemon, current);
  const selected: Move[] = [];
  const excluded = new Set<MoveId>();
  const originalMoves = pokemon.getMoveset().slice(0, 4);
  for (let slot = 0; slot < originalMoves.length; slot++) {
    const original = originalMoves[slot].getMove();
    const move = selectTemporaryMoveMatching(
      `veil:${current.wave}:${pokemonKey(pokemon)}:${slot}`,
      excluded,
      candidate =>
        original.category === MoveCategory.STATUS
          ? candidate.category === MoveCategory.STATUS
          : candidate.category !== MoveCategory.STATUS,
    ) ?? original;
    selected.push(move);
    excluded.add(move.id);
  }
  pokemon.moveset = selected.map(move => createPokemonMove(pokemon, move.id, 0, 0, 4));
}

function installMoveScramblerCharges(pokemon: Pokemon, current: ErEndlessBattleRuntimeSaveData): void {
  ensureMoveSnapshot(pokemon, current);
  if (hasErEndlessRift("metronome-veil")) {
    return;
  }
  pokemon.moveset = pokemon.getMoveset().map(move => {
    const remaining = Math.max(1, move.getMovePp() - move.ppUsed);
    return createPokemonMove(pokemon, move.moveId, 0, 0, remaining);
  });
}

function emptyRuntime(wave: number): ErEndlessBattleRuntimeSaveData {
  return {
    wave,
    typeOverrides: {},
    priorityDeltas: {},
    healUses: {},
    barriers: {},
    refrainSlots: {},
    refrainRepeats: {},
    oathMasks: {},
    bloodcasts: {},
    forcedRotationIds: [],
    moveSnapshots: {},
    avalancheTriggers: {},
    avalancheEchoTurns: {},
    erosion: {},
    deferredDamage: [],
    reservoirInitialized: false,
    playerReservoir: 0,
    enemyReservoir: 0,
    graveReturnAvailable: false,
    graveReturnUsed: false,
    suppressedRelics: {},
    formSnapshots: {},
    echoMoveSignatures: {},
    raidEmptyMinionSlots: [],
  };
}

/** Remember a defeated raid minion seat until a later boss-segment pulse refills it. */
export function markErEndlessRaidMinionSlotEmpty(fieldIndex: number): void {
  const current = runtime();
  if (
    !current
    || !Number.isSafeInteger(fieldIndex)
    || fieldIndex < 0
    || current.raidEmptyMinionSlots.includes(fieldIndex)
  ) {
    return;
  }
  current.raidEmptyMinionSlots.push(fieldIndex);
  current.raidEmptyMinionSlots.sort((left, right) => left - right);
}

/** Refill one empty minion seat on every second raid-boss segment break. */
export function queueErEndlessRaidReserve(brokenSegments: number): void {
  const current = runtime();
  if (!current || brokenSegments <= 0 || brokenSegments % 2 !== 0) {
    return;
  }
  const fieldIndex = current.raidEmptyMinionSlots.shift();
  if (fieldIndex == null) {
    return;
  }
  const activeSlots = Math.max(1, globalScene.currentBattle.getBattlerCount());
  const reserveIndex = globalScene
    .getEnemyParty()
    .findIndex((pokemon, index) => index >= activeSlots && pokemon.isAllowedInBattle() && !pokemon.isOnField());
  if (reserveIndex < 0) {
    return;
  }
  globalScene.phaseManager.unshiftNew(
    "SwitchSummonPhase",
    SwitchType.SWITCH,
    fieldIndex,
    reserveIndex,
    false,
    false,
  );
}

export function finalizeErEndlessBattleRuntime(): void {
  const current = prepareErEndlessBattleRuntime();
  if (!current || current.reservoirInitialized) {
    return;
  }
  const activeSlots = Math.max(1, globalScene.currentBattle?.getBattlerCount?.() ?? 1);
  const capacity = (partySize: number) => 24 + 4 * (activeSlots - 1) + 2 * Math.max(0, partySize - 6);
  current.playerReservoir = capacity(globalScene.getPlayerParty().length);
  current.enemyReservoir = capacity(globalScene.getEnemyParty().length);
  current.reservoirInitialized = true;
}

function deterministicDifferent<T extends number>(
  values: readonly T[],
  previous: number | undefined,
  domain: string,
): T {
  const available = previous == null || values.length < 2 ? values : values.filter(value => value !== previous);
  const current = runtime();
  const seed = getErEndlessState()?.seed ?? "";
  return available[hash32(`${seed}:${domain}:${current?.wave ?? 0}:${globalScene.currentBattle.turn ?? 0}`) % available.length];
}

function rollCarouselWeather(): void {
  const current = runtime();
  if (!current) {
    return;
  }
  const next = deterministicDifferent(CAROUSEL_WEATHER, current.lastWeather, "weather-carousel");
  current.lastWeather = next;
  globalScene.arena.trySetWeather(next, undefined, 0);
}

function rollCarouselTerrain(): void {
  const current = runtime();
  if (!current) {
    return;
  }
  const next = deterministicDifferent(CAROUSEL_TERRAIN, current.lastTerrain, "terrain-carousel");
  current.lastTerrain = next;
  globalScene.arena.trySetTerrain(next, false, undefined, 0);
}

export function applyErEndlessBattleStart(): void {
  const current = prepareErEndlessBattleRuntime();
  if (!current) {
    return;
  }
  finalizeErEndlessBattleRuntime();
  if (hasErEndlessRift("mega-storm") || hasErEndlessRift("primal-convergence")) {
    for (const pokemon of [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()]) {
      const key = pokemonKey(pokemon);
      let targetFormIndex = -1;
      if (hasErEndlessRift("mega-storm")) {
        const choices = getFunRealMegaChoices(pokemon.species, pokemon.formIndex);
        const physicalPower = pokemon.getMoveset().reduce(
          (sum, move) => sum + (move.getMove().category === MoveCategory.PHYSICAL ? move.getMove().power : 0),
          0,
        );
        const specialPower = pokemon.getMoveset().reduce(
          (sum, move) => sum + (move.getMove().category === MoveCategory.SPECIAL ? move.getMove().power : 0),
          0,
        );
        targetFormIndex = choices.toSorted((left, right) => {
          const score = (formIndex: number) => {
            const form = pokemon.species.forms[formIndex];
            return (physicalPower >= specialPower ? form.baseStats[1] : form.baseStats[3]) * 2 + form.baseStats[5];
          };
          return score(right.formIndex) - score(left.formIndex);
        })[0]?.formIndex ?? -1;
      }
      if (targetFormIndex < 0 && hasErEndlessRift("primal-convergence")) {
        const advanced = pokemon.species.forms
          .map((form, formIndex) => ({ form, formIndex }))
          .filter(({ form }) => /^(primal|origin|crowned|apex|ultra|eternamax)/u.test(form.formKey));
        targetFormIndex = advanced.toSorted((left, right) => right.form.baseTotal - left.form.baseTotal)[0]?.formIndex ?? -1;
      }
      if (targetFormIndex >= 0 && targetFormIndex !== pokemon.formIndex) {
        current.formSnapshots[key] = pokemon.formIndex;
        pokemon.formIndex = targetFormIndex;
        pokemon.calculateStats();
        pokemon.generateName();
        pokemon.updateScale();
      }
    }
  }
  if (hasErEndlessRift("relic-blackout") && Object.keys(current.suppressedRelics).length === 0) {
    for (const [side, forPlayer] of [["player", true], ["enemy", false]] as const) {
      const candidates = globalScene.findModifiers(
        modifier => modifier.constructor.name === "ErRelicModifier"
          && typeof (modifier as unknown as { kind?: unknown }).kind === "string",
        forPlayer,
      ) as unknown as { kind: string }[];
      if (candidates.length > 0) {
        const index = hash32(`${getErEndlessState()?.seed ?? ""}:relic-blackout:${current.wave}:${side}`) % candidates.length;
        current.suppressedRelics[side] = candidates[index].kind;
      }
    }
  }
  if (hasErEndlessRift("metronome-veil") || hasErEndlessRift("move-scrambler")) {
    for (const pokemon of [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()]) {
      if (hasErEndlessRift("metronome-veil")) {
        installMetronomeVeilMoves(pokemon, current);
      }
      if (hasErEndlessRift("move-scrambler")) {
        installMoveScramblerCharges(pokemon, current);
      }
    }
  }
  if (hasErEndlessRift("weather-carousel")) {
    rollCarouselWeather();
    rollCarouselTerrain();
  }
  if (hasErEndlessRift("status-roulette")) {
    for (const [side, field] of [globalScene.getPlayerField(), globalScene.getEnemyField()].entries()) {
      const active = field.filter(pokemon => pokemon.isActive(true));
      const count = Math.min(2, Math.ceil(active.length / 2));
      const candidates = [...active];
      for (let index = 0; index < count && candidates.length > 0; index++) {
        const targetIndex = hash32(`${getErEndlessState()?.seed ?? ""}:status-target:${current.wave}:${side}:${index}`) % candidates.length;
        const target = candidates.splice(targetIndex, 1)[0];
        const weighted = [
          StatusEffect.BURN,
          StatusEffect.BURN,
          StatusEffect.POISON,
          StatusEffect.POISON,
          StatusEffect.PARALYSIS,
          StatusEffect.PARALYSIS,
          StatusEffect.SLEEP,
          StatusEffect.FREEZE,
        ];
        const offset = hash32(`${getErEndlessState()?.seed ?? ""}:status-kind:${current.wave}:${target.id}`) % weighted.length;
        for (let attempt = 0; attempt < weighted.length; attempt++) {
          if (target.trySetStatus(weighted[(offset + attempt) % weighted.length], undefined, undefined, null, false, true)) {
            break;
          }
        }
      }
    }
  }
}

export function prepareErEndlessBattleRuntime(): ErEndlessBattleRuntimeSaveData | undefined {
  if (!isErEndlessContinuationActive()) {
    return undefined;
  }
  const wave = globalScene.currentBattle.waveIndex;
  const existing = getErEndlessBattleRuntime();
  if (existing?.wave === wave) {
    return existing;
  }
  const runtime = emptyRuntime(wave);
  setErEndlessBattleRuntime(runtime);
  return runtime;
}

export function clearErEndlessBattleRuntime(): void {
  setErEndlessBattleRuntime(undefined);
}

export function claimErEndlessGraveReturn(pokemon: Pokemon): boolean {
  const current = runtime();
  if (!pokemon.isEnemy() || !current?.graveReturnAvailable || current.graveReturnUsed) {
    return false;
  }
  current.graveReturnUsed = true;
  return true;
}

export function isErEndlessRelicSuppressed(kind: string, forPlayer: boolean): boolean {
  const current = getErEndlessBattleRuntime();
  return current?.suppressedRelics[forPlayer ? "player" : "enemy"] === kind;
}

export function getErEndlessRelicNumericMultiplier(): number {
  return hasErEndlessRift("relic-overdrive") ? 2 : 1;
}

export function restoreErEndlessBattleOverlays(): void {
  const current = getErEndlessBattleRuntime();
  if (!current) {
    return;
  }
  for (const pokemon of [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()]) {
    const snapshot = current.moveSnapshots[pokemonKey(pokemon)];
    if (snapshot) {
      pokemon.moveset = snapshot.map(move => createPokemonMove(
        pokemon,
        move.moveId as MoveId,
        move.ppUsed,
        move.ppUp,
        move.maxPpOverride,
      ));
    }
    const formIndex = current.formSnapshots[pokemonKey(pokemon)];
    if (formIndex != null && pokemon.formIndex !== formIndex) {
      pokemon.formIndex = formIndex;
      pokemon.calculateStats();
      pokemon.generateName();
      pokemon.updateScale();
    }
  }
  clearErEndlessBattleRuntime();
}

function runtime(): ErEndlessBattleRuntimeSaveData | undefined {
  return prepareErEndlessBattleRuntime();
}

export function getErEndlessEffectiveTypes(pokemon: Pokemon, canonicalTypes: readonly PokemonType[]): PokemonType[] {
  if (!hasErEndlessRift("full-type-flux")) {
    return [...canonicalTypes];
  }
  const current = runtime();
  if (!current) {
    return [...canonicalTypes];
  }
  const key = pokemonKey(pokemon);
  const existing = current.typeOverrides[key];
  if (existing?.length) {
    return existing as PokemonType[];
  }
  const count = Math.max(1, new Set(canonicalTypes.filter(type => type !== PokemonType.UNKNOWN)).size);
  const available = [...ORDINARY_TYPES];
  const selected: PokemonType[] = [];
  const seed = getErEndlessState()?.seed ?? "";
  for (let slot = 0; slot < count && available.length > 0; slot++) {
    const index = hash32(`${seed}:types:${current.wave}:${pokemonKey(pokemon)}:${slot}`) % available.length;
    selected.push(available.splice(index, 1)[0]);
  }
  current.typeOverrides[key] = selected;
  return selected;
}

function invertEffectiveness(value: number): number {
  if (value === 0) {
    return 2;
  }
  return 1 / value;
}

export function applyErEndlessTypeEffectiveness(
  source: Pokemon | undefined,
  target: Pokemon,
  moveType: PokemonType,
  value: number,
): number {
  let result = value;
  if (hasErEndlessRift("fractured-immunities") && result === 0) {
    result = 0.25;
  }
  if (hasErEndlessRift("inverse-rift")) {
    result = invertEffectiveness(result);
  }
  if (hasErEndlessRift("resistance-erosion") && source) {
    const entry = runtime()?.erosion[pokemonKey(source)];
    if (entry?.sourceId === target.id && entry.moveType === moveType) {
      result = Math.min(4, result * 2 ** entry.stages);
    }
  }
  return result;
}

export function getErEndlessMovePriorityDelta(user: Pokemon, move: Move): number {
  if (!hasErEndlessRift("priority-roulette")) {
    return 0;
  }
  const current = runtime();
  const slot = moveSlot(user, move);
  if (!current || slot < 0) {
    return 0;
  }
  const key = pokemonKey(user);
  current.priorityDeltas[key] ??= user.getMoveset().map((_, index) => {
    const roll = hash32(`${getErEndlessState()?.seed ?? ""}:priority:${current.wave}:${key}:${index}`) % 4;
    return roll === 0 ? -1 : roll === 3 ? 1 : 0;
  });
  return current.priorityDeltas[key][slot] ?? 0;
}

export function applyErEndlessCalculatedDamage(
  source: Pokemon,
  _target: Pokemon,
  move: Move,
  damage: number,
): number {
  let result = damage;
  if (
    hasErEndlessRift("echo-chamber")
    && move.category !== MoveCategory.STATUS
    && move.power > 0
    && !move.hasAttr("SacrificialAttr")
    && !move.hasAttr("SacrificialAttrOnHit")
  ) {
    const current = runtime();
    const key = pokemonKey(source);
    const signature = `${globalScene.currentBattle.turn ?? 0}:${move.id}`;
    if (current && current.echoMoveSignatures[key] == null) {
      current.echoMoveSignatures[key] = signature;
    }
    if (current?.echoMoveSignatures[key] === signature) {
      result *= 1.25;
    }
  }
  if (hasErEndlessRift("refrain")) {
    const current = runtime();
    const slot = moveSlot(source, move);
    const key = pokemonKey(source);
    if (current && slot >= 0 && current.refrainSlots[key] === slot) {
      result *= Math.max(0.4, 0.8 ** ((current.refrainRepeats[key] ?? 0) + 1));
    }
  }
  if (hasErEndlessRift("escalation-clock")) {
    result *= 1 + Math.min(1, Math.max(0, (globalScene.currentBattle.turn ?? 1) - 1) * 0.1);
  }
  if (hasErEndlessRift("mega-decay") && isErEndlessAdvancedForm(source)) {
    result *= 1.25;
  }
  return toDmgValue(result);
}

function isErEndlessAdvancedForm(pokemon: Pokemon): boolean {
  return /^(mega(?:-|$)|primal|origin|crowned|apex|ultra|eternamax)/u.test(pokemon.getFormKey());
}

export function applyErEndlessDirectDamage(
  target: Pokemon,
  source: Pokemon | undefined,
  damage: number,
): number {
  if (!source || damage <= 0) {
    return damage;
  }
  const current = runtime();
  if (current && hasErEndlessRift("soul-link") && !applyingSoulLink) {
    const allies = (target.isPlayer() ? globalScene.getPlayerField() : globalScene.getEnemyField())
      .filter(pokemon => pokemon != null && pokemon.isActive(true) && !pokemon.isFainted(true));
    if (allies.length > 1) {
      const base = Math.floor(damage / allies.length);
      let remainder = damage - base * allies.length;
      const shares = allies.map(() => base + (remainder-- > 0 ? 1 : 0));
      applyingSoulLink = true;
      try {
        for (let index = 0; index < allies.length; index++) {
          const ally = allies[index];
          if (ally === target) {
            damage = absorbErEndlessBarrier(ally, shares[index]);
          } else {
            const share = absorbErEndlessBarrier(ally, shares[index]);
            if (share > 0) {
              ally.damageAndUpdate(share);
            }
          }
        }
      } finally {
        applyingSoulLink = false;
      }
      return damage;
    }
  }
  if (current && hasErEndlessRift("deferred-damage")) {
    const delayed = Math.max(0, Math.floor(damage * 0.3));
    if (delayed > 0) {
      current.deferredDamage.push({
        fieldIndex: target.getFieldIndex(),
        isPlayer: target.isPlayer(),
        amount: delayed,
        dueTurn: (globalScene.currentBattle.turn ?? 1) + 2,
      });
      damage -= delayed;
    }
  }
  return current ? absorbErEndlessBarrier(target, damage) : damage;
}

function absorbErEndlessBarrier(pokemon: Pokemon, damage: number): number {
  const current = runtime();
  if (!current || !hasErEndlessRift("overheal-barrier")) {
    return damage;
  }
  const key = pokemonKey(pokemon);
  const barrier = current.barriers[key] ?? 0;
  const absorbed = Math.min(barrier, damage);
  current.barriers[key] = barrier - absorbed;
  return damage - absorbed;
}

export function applyErEndlessHealing(
  pokemon: Pokemon,
  amount: number,
  revive = false,
): { amount: number; excessBarrier: number } {
  if (hasErEndlessRift("healing-lock")) {
    return { amount: revive ? Math.max(0, 1 - pokemon.hp) : 0, excessBarrier: 0 };
  }
  const current = runtime();
  if (!current) {
    return { amount, excessBarrier: 0 };
  }
  const key = pokemonKey(pokemon);
  let adjusted = amount;
  if (hasErEndlessRift("diminishing-recovery")) {
    const uses = current.healUses[key] ?? 0;
    adjusted = Math.floor(adjusted * Math.max(0.2, 0.7 ** uses));
    if (adjusted > 0 && (pokemon.hp < pokemon.getMaxHp() || hasErEndlessRift("overheal-barrier"))) {
      current.healUses[key] = uses + 1;
    }
  }
  let excessBarrier = 0;
  if (hasErEndlessRift("overheal-barrier")) {
    excessBarrier = Math.max(0, adjusted - Math.max(0, pokemon.getMaxHp() - pokemon.hp));
    if (excessBarrier > 0) {
      const cap = Math.floor(pokemon.getMaxHp() * 0.3);
      current.barriers[key] = Math.min(cap, (current.barriers[key] ?? 0) + excessBarrier);
    }
  }
  return { amount: adjusted, excessBarrier };
}

export function getErEndlessStatusStatMultiplier(pokemon: Pokemon, stat: PermanentStat): number {
  if (!hasErEndlessRift("status-polarity") || !pokemon.status) {
    return 1;
  }
  switch (pokemon.status.effect) {
    case StatusEffect.BURN:
      return stat === Stat.DEF ? 1.3 : 1;
    case StatusEffect.POISON:
      return stat === Stat.SPATK ? 1.3 : 1;
    case StatusEffect.TOXIC:
      return stat === Stat.SPD ? 1 + Math.min(0.5, pokemon.status.toxicTurnCount * 0.1) : 1;
    case StatusEffect.PARALYSIS:
      return stat === Stat.SPDEF ? 1.3 : 1;
    default:
      return 1;
  }
}

export function onErEndlessStatusApplied(pokemon: Pokemon, effect: StatusEffect): void {
  if (!hasErEndlessRift("status-polarity") || effect !== StatusEffect.FREEZE) {
    return;
  }
  const current = runtime();
  if (!current) {
    return;
  }
  const key = pokemonKey(pokemon);
  current.barriers[key] = Math.max(current.barriers[key] ?? 0, Math.floor(pokemon.getMaxHp() * 0.2));
}

export function onErEndlessStatusInflicted(
  target: Pokemon,
  source: Pokemon | undefined,
  effect: StatusEffect,
): void {
  onErEndlessStatusApplied(target, effect);
  if (
    !source
    || source === target
    || effect === StatusEffect.NONE
    || effect === StatusEffect.FAINT
    || !hasErEndlessRift("misery-mirror")
    || applyingMirroredStatus
  ) {
    return;
  }
  const current = runtime();
  if (!current) {
    return;
  }
  const roll = hash32(
    `${getErEndlessState()?.seed ?? ""}:misery:${current.wave}:${globalScene.currentBattle.turn}:${source.id}:${target.id}:${effect}`,
  ) % 2;
  if (roll !== 0) {
    return;
  }
  applyingMirroredStatus = true;
  try {
    source.trySetStatus(effect, source, undefined, null, false, true);
  } finally {
    applyingMirroredStatus = false;
  }
}

export function applyErEndlessContagion(
  attacker: Pokemon,
  target: Pokemon,
  makesContact: boolean,
  dealtDamage: boolean,
): void {
  const effect = target.status?.effect;
  const current = runtime();
  if (!current || !makesContact || !dealtDamage || !effect || !hasErEndlessRift("contagion")) {
    return;
  }
  const roll = hash32(
    `${getErEndlessState()?.seed ?? ""}:contagion:${current.wave}:${globalScene.currentBattle.turn}:${attacker.id}:${target.id}:${effect}`,
  ) % 10;
  if (roll < 3) {
    attacker.trySetStatus(effect, target, undefined, null, false, true);
  }
}

export function prepareErEndlessSwitch(
  outgoing: Pokemon,
  voluntary: boolean,
): ErEndlessSwitchTransfer {
  const current = runtime();
  if (!current) {
    return {};
  }
  const key = pokemonKey(outgoing);
  delete current.refrainSlots[key];
  delete current.refrainRepeats[key];
  delete current.erosion[key];
  for (const [sourceKey, entry] of Object.entries(current.erosion)) {
    if (entry.sourceId === outgoing.id) {
      delete current.erosion[sourceKey];
    }
  }
  if (!voluntary) {
    return {};
  }
  if (hasErEndlessRift("pursuit-field") && !outgoing.isFainted(true)) {
    outgoing.damageAndUpdate(Math.max(1, Math.floor(outgoing.getMaxHp() / 8)));
  }
  return {
    stages: hasErEndlessRift("baton-world") ? [...outgoing.getStatStages()] : undefined,
    status: hasErEndlessRift("status-relay") ? outgoing.status?.effect : undefined,
  };
}

export function completeErEndlessSwitch(
  outgoing: Pokemon,
  incoming: Pokemon,
  transfer: ErEndlessSwitchTransfer,
): void {
  if (transfer.stages) {
    const stages = incoming.getStatStages();
    for (let index = 0; index < stages.length; index++) {
      stages[index] = transfer.stages[index] ?? 0;
    }
  }
  if (transfer.status && incoming.trySetStatus(transfer.status, outgoing, undefined, null, false, true)) {
    outgoing.resetStatus(false);
  }
}

export function recordErEndlessKo(source: Pokemon | undefined): void {
  const current = runtime();
  if (!current || !source || !hasErEndlessRift("forced-rotation")) {
    return;
  }
  if (!current.forcedRotationIds.includes(source.id)) {
    current.forcedRotationIds.push(source.id);
  }
}

export function canApplyErEndlessAvalancheTrigger(
  pokemon: Pokemon,
  abilityId: number,
  discrete: boolean,
  resolvedAsEndlessAvalanche?: boolean,
): boolean {
  if (
    !discrete
    || !hasErEndlessRift("trigger-burnout")
    || !(resolvedAsEndlessAvalanche ?? pokemon.isEndlessAvalancheAbility(abilityId))
  ) {
    return true;
  }
  const current = runtime();
  return !current || (current.avalancheTriggers[`${pokemonKey(pokemon)}:${abilityId}`] ?? 0) < 3;
}

const AVALANCHE_ECHO_EXCLUDED_ATTRS = [
  "FormChange",
  "Transform",
  "MoveReplace",
  "MoveCopy",
  "PostSummon",
  "PreLeaveField",
];

export function recordErEndlessAvalancheTrigger(
  pokemon: Pokemon,
  abilityId: number,
  attrName: string,
  discrete: boolean,
  resolvedAsEndlessAvalanche?: boolean,
): boolean {
  if (!(resolvedAsEndlessAvalanche ?? pokemon.isEndlessAvalancheAbility(abilityId))) {
    return false;
  }
  const current = runtime();
  if (!current) {
    return false;
  }
  if (discrete && hasErEndlessRift("trigger-burnout")) {
    const triggerKey = `${pokemonKey(pokemon)}:${abilityId}`;
    current.avalancheTriggers[triggerKey] = (current.avalancheTriggers[triggerKey] ?? 0) + 1;
  }
  if (
    !discrete
    || !hasErEndlessRift("ability-echo")
    || AVALANCHE_ECHO_EXCLUDED_ATTRS.some(excluded => attrName.includes(excluded))
  ) {
    return false;
  }
  const turn = globalScene.currentBattle.turn ?? 1;
  const echoKey = pokemonKey(pokemon);
  if (current.avalancheEchoTurns[echoKey] === turn) {
    return false;
  }
  current.avalancheEchoTurns[echoKey] = turn;
  return true;
}

function reservoirCost(move: Move): number {
  return move.pp <= 5 ? 3 : move.pp <= 10 ? 2 : 1;
}

export function canUseErEndlessMove(pokemon: Pokemon, move: Move, individualOutOfPp: boolean): boolean {
  const current = runtime();
  if (!current) {
    return !individualOutOfPp;
  }
  if (!current.reservoirInitialized) {
    finalizeErEndlessBattleRuntime();
  }
  if (hasErEndlessRift("four-move-oath")) {
    const slot = moveSlot(pokemon, move);
    if (slot >= 0 && ((current.oathMasks[pokemonKey(pokemon)] ?? 0) & (1 << slot)) !== 0) {
      return false;
    }
  }
  if (hasErEndlessRift("shared-reservoir")) {
    const remaining = pokemon.isPlayer() ? current.playerReservoir : current.enemyReservoir;
    return move.id === MoveId.STRUGGLE || remaining >= reservoirCost(move);
  }
  return !individualOutOfPp || hasErEndlessRift("bloodcasting");
}

export function consumeErEndlessMoveCost(pokemon: Pokemon, move: Move, basePpCost: number): { useIndividualPp: boolean; ppCost: number; bloodcast: boolean } {
  const current = runtime();
  if (!current) {
    return { useIndividualPp: true, ppCost: basePpCost, bloodcast: false };
  }
  if (!current.reservoirInitialized) {
    finalizeErEndlessBattleRuntime();
  }
  const key = pokemonKey(pokemon);
  const slot = moveSlot(pokemon, move);
  const repeats = hasErEndlessRift("refrain") && current.refrainSlots[key] === slot
    ? (current.refrainRepeats[key] ?? 0) + 1
    : 0;
  const extra = Math.min(3, repeats);
  if (hasErEndlessRift("shared-reservoir")) {
    const cost = reservoirCost(move) + extra;
    if (pokemon.isPlayer()) {
      current.playerReservoir = Math.max(0, current.playerReservoir - cost);
    } else {
      current.enemyReservoir = Math.max(0, current.enemyReservoir - cost);
    }
    return { useIndividualPp: false, ppCost: 0, bloodcast: false };
  }
  const pokemonMove = slot >= 0 ? pokemon.getMoveset()[slot] : undefined;
  const bloodcast = hasErEndlessRift("bloodcasting") && pokemonMove?.isOutOfPp() === true;
  if (bloodcast) {
    current.bloodcasts[key] = true;
  }
  return { useIndividualPp: !bloodcast, ppCost: basePpCost + extra, bloodcast };
}

export function recordErEndlessMoveOutcome(
  user: Pokemon,
  move: Move,
  outcome: ErEndlessMoveOutcome,
  target?: Pokemon,
): void {
  const current = runtime();
  if (!current) {
    return;
  }
  const key = pokemonKey(user);
  const slot = moveSlot(user, move);
  const moveType = user.getMoveType(move, true);
  if (hasErEndlessRift("refrain") && slot >= 0) {
    if (current.refrainSlots[key] === slot) {
      current.refrainRepeats[key] = Math.min(20, (current.refrainRepeats[key] ?? 0) + 1);
    } else {
      current.refrainSlots[key] = slot;
      current.refrainRepeats[key] = 0;
    }
  }
  if (hasErEndlessRift("four-move-oath") && slot >= 0) {
    const usableMask = user.getMoveset().reduce((mask, candidate, index) => candidate?.moveId ? mask | (1 << index) : mask, 0);
    const nextMask = (current.oathMasks[key] ?? 0) | (1 << slot);
    current.oathMasks[key] = (nextMask & usableMask) === usableMask ? 0 : nextMask;
  }
  if (hasErEndlessRift("resistance-erosion")) {
    if (outcome !== "hit" || move.category === MoveCategory.STATUS) {
      delete current.erosion[key];
    } else {
      const previous = current.erosion[key];
      current.erosion[key] = {
        sourceId: target?.id ?? -1,
        moveType,
        stages: previous?.sourceId === target?.id && previous.moveType === moveType ? Math.min(4, previous.stages + 1) : 1,
      };
    }
  }
  if (hasErEndlessRift("move-scrambler") && slot >= 0) {
    const currentMove = user.getMoveset()[slot];
    const currentCategory = currentMove.getMove().category;
    const excluded = new Set(user.getMoveset().map(candidate => candidate.moveId));
    const replacement = selectTemporaryMoveMatching(
      `scramble:${current.wave}:${key}:${slot}:${globalScene.currentBattle.turn}:${currentMove.ppUsed}`,
      excluded,
      candidate =>
        currentCategory === MoveCategory.STATUS
          ? candidate.category === MoveCategory.STATUS
          : candidate.category !== MoveCategory.STATUS,
    );
    if (replacement) {
      // A changed move starts with its own full PP. Carrying the old move's PP
      // usage/max override could make the replacement immediately unusable or
      // display an impossible PP total.
      user.moveset[slot] = createPokemonMove(user, replacement.id);
    }
  }
  if (current.bloodcasts[key]) {
    delete current.bloodcasts[key];
    if (!user.isFainted(true)) {
      user.damageAndUpdate(toDmgValue(user.getMaxHp() * 0.15), { ignoreSegments: true });
    }
  }
}

export function applyErEndlessTurnEnd(): void {
  const current = getErEndlessBattleRuntime();
  if (!current) {
    return;
  }
  const turn = globalScene.currentBattle.turn ?? 1;
  const completedTurn = Math.max(0, turn - 1);
  const allActive = [...globalScene.getPlayerField(), ...globalScene.getEnemyField()].filter(
    pokemon => pokemon != null && pokemon.isActive(true),
  );
  if (hasErEndlessRift("entropy")) {
    for (const pokemon of allActive) {
      pokemon.getStatStages().forEach((stage, index) => {
        pokemon.getStatStages()[index] = stage === 0 ? 0 : stage - Math.sign(stage);
      });
    }
  }
  if (hasErEndlessRift("sudden-death") && completedTurn >= 8) {
    const fraction = Math.min(0.3, 0.05 * (completedTurn - 7));
    for (const pokemon of allActive) {
      pokemon.damageAndUpdate(toDmgValue(pokemon.getMaxHp() * fraction), { ignoreSegments: true });
    }
  }
  if (hasErEndlessRift("mega-decay")) {
    for (const pokemon of allActive.filter(isErEndlessAdvancedForm)) {
      pokemon.damageAndUpdate(toDmgValue(pokemon.getMaxHp() * 0.05), { ignoreSegments: true });
    }
  }
  if (hasErEndlessRift("status-polarity")) {
    for (const pokemon of allActive.filter(pokemon => pokemon.status?.effect === StatusEffect.SLEEP)) {
      pokemon.heal(toDmgValue(pokemon.getMaxHp() * 0.08));
    }
  }
  if (hasErEndlessRift("weather-carousel")) {
    if (completedTurn > 0 && completedTurn % 2 === 0) {
      rollCarouselWeather();
    }
    if (completedTurn > 0 && completedTurn % 3 === 0) {
      rollCarouselTerrain();
    }
  }
  const due = current.deferredDamage.filter(entry => entry.dueTurn <= turn);
  current.deferredDamage = current.deferredDamage.filter(entry => entry.dueTurn > turn);
  for (const entry of due) {
    const party = entry.isPlayer ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
    const target = party.find(pokemon => pokemon.isActive(true) && pokemon.getFieldIndex() === entry.fieldIndex);
    target?.damageAndUpdate(entry.amount, { ignoreSegments: true });
  }
  if (hasErEndlessRift("forced-rotation") && current.forcedRotationIds.length > 0) {
    const reserved = new Set<number>();
    for (const player of [true, false]) {
      const party = player ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
      const capacity = globalScene.currentBattle.getBattlerCount();
      for (let fieldIndex = 0; fieldIndex < capacity; fieldIndex++) {
        const outgoing = party[fieldIndex];
        if (!outgoing || !current.forcedRotationIds.includes(outgoing.id) || outgoing.isFainted(true)) {
          continue;
        }
        const reserveIndex = party.findIndex(
          (candidate, index) => index >= capacity && candidate.isAllowedInBattle() && !reserved.has(candidate.id),
        );
        if (reserveIndex < 0) {
          continue;
        }
        reserved.add(party[reserveIndex].id);
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          SwitchType.FORCE_SWITCH,
          fieldIndex,
          reserveIndex,
          true,
          player,
        );
      }
    }
    current.forcedRotationIds = [];
  }
}

export function isErEndlessHeldItemSuppressed(): boolean {
  return hasErEndlessRift("empty-hands");
}
