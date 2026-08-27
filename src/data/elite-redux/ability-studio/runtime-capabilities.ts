import type { Ability } from "#abilities/ability";
import type { Pokemon } from "#field/pokemon";

export const ABILITY_STUDIO_RUNTIME_CAPABILITIES = {
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
