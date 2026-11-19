import type { Ability } from "#abilities/ability";
import { AbilityId } from "#enums/ability-id";
import type { Pokemon } from "#field/pokemon";

const ABILITY_STUDIO_BLOCK_CAPABILITIES = {
  ACCELERATE_CHARGE_SKIP: "accelerate-charge-skip",
  ANGELS_WRATH_MOVE_REWRITES: "angels-wrath-move-rewrites",
  AURORA_BOREALIS_ICE_WEATHER: "aurora-borealis-ice-weather",
  BURN_FATIGUE_ACTION_FAILURE: "burn-fatigue-action-failure",
  BURN_FATIGUE_DAMAGE: "burn-fatigue-damage",
  CHLOROPLAST_SUN_MOVES: "chloroplast-sun-moves",
  DEADLY_SENTENCING_SUPPRESSION: "deadly-sentencing-suppression",
  DNA_SCRAMBLE_FORM_CHANGE: "dna-scramble-form-change",
  MINION_CONTROL_HIT_POWER: "minion-control-hit-power",
  MOON_SPIRIT_MOONLIGHT_HEAL: "moon-spirit-moonlight-heal",
  REAP_AND_SOW_SUN: "reap-and-sow-sun",
  RELIC_STONE_STAB_SUPPRESSION: "relic-stone-stab-suppression",
  SLEEPING_IN_REPEAT_BLOCK: "sleeping-in-repeat-block",
  SLEEPING_IN_YAWN_STYLE: "sleeping-in-yawn-style",
  SPATIAL_MAGIC_SWITCH: "spatial-magic-switch",
  SYMBIOSIS_ITEM_TRANSFER: "symbiosis-item-transfer",
  TEMPORAL_RUPTURE_ROAR_OF_TIME: "temporal-rupture-roar-of-time",
  UPCYCLE_FOOD_FIELD: "upcycle-food-field",
  UPCYCLE_POISON_BOOST: "upcycle-poison-boost",
} as const;

/**
 * Engine queries (decomposition spec 1.4). The engine used to ask "does this Pokemon have ability X?" at about a
 * hundred places, which no rebuilt attr can answer. Each of those places now asks for the ROLE X plays there
 * ({@linkcode abilityQuery}), and an ability answers yes by being X (as before) or by carrying a
 * runtime-capability block with the role's id (what a staff ability does). One role per ability and engine
 * meaning; an ability the engine reads in two unrelated ways has two roles, so staff can pick one without the other.
 */
export const ABILITY_STUDIO_ENGINE_QUERIES = {
  AURA_BREAK_INVERSION: "aura-break-inversion",
  BATTLE_BOND_FORM: "battle-bond-form",
  BERSERK_VOLATILE_BOOST: "berserk-volatile-boost",
  COMATOSE_SLEEP: "comatose-sleep",
  COMMANDER_HOSTING: "commander-hosting",
  DARK_AURA_FIELD: "dark-aura-field",
  FAIRY_AURA_FIELD: "fairy-aura-field",
  FLOWER_GIFT_FORM: "flower-gift-form",
  FORECAST_FORM: "forecast-form",
  GULP_MISSILE_FORM: "gulp-missile-form",
  GUTS_STATUS_BOOST: "guts-status-boost",
  HEAVY_METAL_WEIGHT: "heavy-metal-weight",
  ICE_FACE_FORM: "ice-face-form",
  ILLUMINATE_DARK_ACCURACY: "illuminate-dark-accuracy",
  KLUTZ_ITEM_SUPPRESSION: "klutz-item-suppression",
  LEVITATE_FLOAT: "levitate-float",
  MIMICRY_TERRAIN_TYPE: "mimicry-terrain-type",
  MINUS_PAIRING: "minus-pairing",
  MULTITYPE_PLATE_FORMS: "multitype-plate-forms",
  MULTITYPE_TYPE_LOCK: "multitype-type-lock",
  OVERCOAT_POWDER_IMMUNITY: "overcoat-powder-immunity",
  PLUS_PAIRING: "plus-pairing",
  POISON_HEAL_RECOVERY: "poison-heal-recovery",
  PRANKSTER_DARK_IMMUNITY: "prankster-dark-immunity",
  PROTOSYNTHESIS_BOOSTER: "protosynthesis-booster",
  QUARK_DRIVE_BOOSTER: "quark-drive-booster",
  QUICK_DRAW_TARGET: "quick-draw-target",
  RKS_SYSTEM_MEMORY_FORMS: "rks-system-memory-forms",
  RKS_SYSTEM_TYPE_LOCK: "rks-system-type-lock",
  SAND_FORCE_MOVESET: "sand-force-moveset",
  SHADOW_TAG_TRAP_IMMUNITY: "shadow-tag-trap-immunity",
  SHEER_FORCE_SECONDARY_EFFECTS: "sheer-force-secondary-effects",
  SNOW_WARNING_MOVESET: "snow-warning-moveset",
  SOLAR_POWER_MOVESET: "solar-power-moveset",
  STANCE_CHANGE_FORMS: "stance-change-forms",
  STENCH_TOXIC_TERRAIN: "stench-toxic-terrain",
  TRUANT_LOAFING: "truant-loafing",
  UNBURDEN_SPEED: "unburden-speed",
  WANDERING_SPIRIT_SWAP: "wandering-spirit-swap",
  WIND_POWER_CHARGE: "wind-power-charge",
  WIND_RIDER_BOOST: "wind-rider-boost",
  WONDER_GUARD_BOSS_CATCH: "wonder-guard-boss-catch",
  WONDER_GUARD_SINGLE_HP: "wonder-guard-single-hp",
} as const;

/** Short name for call sites: . */
export const ENGINE_QUERY = ABILITY_STUDIO_ENGINE_QUERIES;

export type AbilityStudioEngineQuery =
  (typeof ABILITY_STUDIO_ENGINE_QUERIES)[keyof typeof ABILITY_STUDIO_ENGINE_QUERIES];

export const ABILITY_STUDIO_RUNTIME_CAPABILITIES = {
  ...ABILITY_STUDIO_BLOCK_CAPABILITIES,
  ...ABILITY_STUDIO_ENGINE_QUERIES,
} as const;

export type AbilityStudioRuntimeCapability =
  (typeof ABILITY_STUDIO_RUNTIME_CAPABILITIES)[keyof typeof ABILITY_STUDIO_RUNTIME_CAPABILITIES];

const runtimeComponentActivations = new WeakMap<object, WeakSet<object>>();

export function restrictAbilityStudioRuntimeComponent(attr: object): void {
  runtimeComponentActivations.set(attr, new WeakSet<object>());
}

export function activateAbilityStudioRuntimeComponent(attr: object, pokemon: Pokemon): void {
  runtimeComponentActivations.get(attr)?.add(pokemon.battleData);
}

export function abilityStudioRuntimeComponentIsActive(attr: object, pokemon?: Pokemon): boolean {
  const activations = runtimeComponentActivations.get(attr);
  if (activations !== undefined && (pokemon === undefined || !activations.has(pokemon.battleData))) {
    return false;
  }
  return !("isActiveFor" in attr) || (typeof attr.isActiveFor === "function" && attr.isActiveFor(pokemon) === true);
}

export function abilityStudioAbilityHasCapability(
  ability: Ability,
  capability: AbilityStudioRuntimeCapability,
  pokemon?: Pokemon,
): boolean {
  return ability.attrs.some(
    attr =>
      "abilityStudioCapability" in attr
      && attr.abilityStudioCapability === capability
      && abilityStudioRuntimeComponentIsActive(attr, pokemon),
  );
}

/** The ability each engine query stands for: the identity the engine used to test. */
export const ABILITY_STUDIO_ENGINE_QUERY_SOURCES: Readonly<Record<AbilityStudioEngineQuery, AbilityId>> = {
  "aura-break-inversion": AbilityId.AURA_BREAK,
  "battle-bond-form": AbilityId.BATTLE_BOND,
  "berserk-volatile-boost": AbilityId.BERSERK,
  "comatose-sleep": AbilityId.COMATOSE,
  "commander-hosting": AbilityId.COMMANDER,
  "dark-aura-field": AbilityId.DARK_AURA,
  "fairy-aura-field": AbilityId.FAIRY_AURA,
  "flower-gift-form": AbilityId.FLOWER_GIFT,
  "forecast-form": AbilityId.FORECAST,
  "gulp-missile-form": AbilityId.GULP_MISSILE,
  "guts-status-boost": AbilityId.GUTS,
  "heavy-metal-weight": AbilityId.HEAVY_METAL,
  "ice-face-form": AbilityId.ICE_FACE,
  "illuminate-dark-accuracy": AbilityId.ILLUMINATE,
  "klutz-item-suppression": AbilityId.KLUTZ,
  "levitate-float": AbilityId.LEVITATE,
  "mimicry-terrain-type": AbilityId.MIMICRY,
  "minus-pairing": AbilityId.MINUS,
  "multitype-plate-forms": AbilityId.MULTITYPE,
  "multitype-type-lock": AbilityId.MULTITYPE,
  "overcoat-powder-immunity": AbilityId.OVERCOAT,
  "plus-pairing": AbilityId.PLUS,
  "poison-heal-recovery": AbilityId.POISON_HEAL,
  "prankster-dark-immunity": AbilityId.PRANKSTER,
  "protosynthesis-booster": AbilityId.PROTOSYNTHESIS,
  "quark-drive-booster": AbilityId.QUARK_DRIVE,
  "quick-draw-target": AbilityId.QUICK_DRAW,
  "rks-system-memory-forms": AbilityId.RKS_SYSTEM,
  "rks-system-type-lock": AbilityId.RKS_SYSTEM,
  "sand-force-moveset": AbilityId.SAND_FORCE,
  "shadow-tag-trap-immunity": AbilityId.SHADOW_TAG,
  "sheer-force-secondary-effects": AbilityId.SHEER_FORCE,
  "snow-warning-moveset": AbilityId.SNOW_WARNING,
  "solar-power-moveset": AbilityId.SOLAR_POWER,
  "stance-change-forms": AbilityId.STANCE_CHANGE,
  "stench-toxic-terrain": AbilityId.STENCH,
  "truant-loafing": AbilityId.TRUANT,
  "unburden-speed": AbilityId.UNBURDEN,
  "wandering-spirit-swap": AbilityId.WANDERING_SPIRIT,
  "wind-power-charge": AbilityId.WIND_POWER,
  "wind-rider-boost": AbilityId.WIND_RIDER,
  "wonder-guard-boss-catch": AbilityId.WONDER_GUARD,
  "wonder-guard-single-hp": AbilityId.WONDER_GUARD,
};

export interface AbilityQueryOptions {
  /** Only count abilities that are currently in effect (default `true`, like `hasAbility`). */
  readonly canApply?: boolean;
  /** Ignore the override a Transform put on the Pokemon (default `false`, like `hasAbility`). */
  readonly ignoreOverride?: boolean;
}

/**
 * Does `pokemon` play the engine role `query`? True when one of its ability sources is the original ability the
 * engine used to test for (so `hasAbility(AbilityId.X)` and `abilityQuery(p, X_ROLE)` agree for every existing
 * ability), or carries a runtime-capability block with that role (what a staff-built ability does).
 */
export function abilityQuery(
  pokemon: Pokemon,
  query: AbilityStudioEngineQuery,
  options: AbilityQueryOptions = {},
): boolean {
  const { canApply = true, ignoreOverride = false } = options;
  // The original ability (or anything that references it) answers exactly as `hasAbility` always did, so the
  // pre-sweep behaviour cannot change. Only then does the role-carrier check run. Plain test doubles that stub
  // `hasAbility` alone have no capability lookup, hence the optional call.
  return (
    pokemon.hasAbility(ABILITY_STUDIO_ENGINE_QUERY_SOURCES[query], canApply, ignoreOverride)
    || (pokemon.hasAbilityStudioCapability?.(query, canApply, ignoreOverride) ?? false)
  );
}

/**
 * The same question for one ability object (no holder): is this ability the original, or does it carry the role's
 * block? For the few engine rules that classify an ability itself, such as which innate slots are always live.
 */
export function abilityHasEngineQuery(
  ability: Ability | null | undefined,
  query: AbilityStudioEngineQuery,
  pokemon?: Pokemon,
): boolean {
  if (!ability) {
    return false;
  }
  const source = ABILITY_STUDIO_ENGINE_QUERY_SOURCES[query];
  return (
    ability.id === source
    || abilityStudioAbilityReferencesSource(ability, source, pokemon)
    || abilityStudioAbilityHasCapability(ability, query, pokemon)
  );
}

const ENGINE_QUERIES_BY_SOURCE: ReadonlyMap<AbilityId, readonly AbilityStudioEngineQuery[]> = (() => {
  const bySource = new Map<AbilityId, AbilityStudioEngineQuery[]>();
  for (const [query, source] of Object.entries(ABILITY_STUDIO_ENGINE_QUERY_SOURCES) as [
    AbilityStudioEngineQuery,
    AbilityId,
  ][]) {
    bySource.set(source, [...(bySource.get(source) ?? []), query]);
  }
  return bySource;
})();

/** The role an ability id stands for, when the engine reads that ability in exactly one way. */
function soleEngineQueryOf(abilityId: AbilityId): AbilityStudioEngineQuery | undefined {
  const queries = ENGINE_QUERIES_BY_SOURCE.get(abilityId);
  return queries?.length === 1 ? queries[0] : undefined;
}

/**
 * `hasAbility(id)` for engine code that is handed an ability id as DATA (a form-change trigger, an ability battler
 * tag). When the engine reads that ability in one way only, a carrier of that role counts too; otherwise this is
 * exactly `hasAbility`, because a carrier of one of several roles is not "the ability".
 */
export function abilityQueryById(pokemon: Pokemon, abilityId: AbilityId, options: AbilityQueryOptions = {}): boolean {
  const query = soleEngineQueryOf(abilityId);
  return query === undefined
    ? pokemon.hasAbility(abilityId, options.canApply ?? true, options.ignoreOverride ?? false)
    : abilityQuery(pokemon, query, options);
}

/** Is `ability` (an object, not a holder) the ability `abilityId`, or a carrier of its sole engine role? */
export function abilityIsById(ability: Ability | null | undefined, abilityId: AbilityId, pokemon?: Pokemon): boolean {
  const query = soleEngineQueryOf(abilityId);
  return query === undefined ? ability?.id === abilityId : abilityHasEngineQuery(ability, query, pokemon);
}

export function abilityStudioAbilityReferencesSource(
  ability: Ability,
  sourceAbilityId: number,
  pokemon?: Pokemon,
): boolean {
  return ability.attrs.some(
    attr =>
      "abilityStudioSourceAbilityId" in attr
      && attr.abilityStudioSourceAbilityId === sourceAbilityId
      && abilityStudioRuntimeComponentIsActive(attr, pokemon),
  );
}
