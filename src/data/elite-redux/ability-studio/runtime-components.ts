import { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { AbilityId } from "#enums/ability-id";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { AbilityStudioRuntimeCapability } from "./runtime-capabilities";

export type AbilityStudioRuntimeConditionKind = "ability" | "holder" | "event";

export interface AbilityStudioRuntimeSource {
  readonly abilityId: number;
  readonly attrIndex: number;
  readonly attrType: string;
}

export interface AbilityStudioRuntimeConditionReference extends AbilityStudioRuntimeSource {
  readonly kind: AbilityStudioRuntimeConditionKind;
  readonly conditionIndex?: number;
}

export interface AbilityStudioRuntimeComponentRule {
  readonly key: string;
  readonly prerequisiteHooks?: readonly AbilityStudioRuntimeSource[];
  readonly hook: AbilityStudioRuntimeSource;
  readonly chance: number;
  readonly conditionLogic?: "all" | "any";
  readonly conditions: readonly AbilityStudioRuntimeConditionReference[];
  readonly effects: readonly AbilityStudioRuntimeSource[];
}

export class AbilityStudioRuntimeCapabilityAbAttr extends AbAttr {
  public readonly abilityStudioCapability: AbilityStudioRuntimeCapability;
  public readonly componentLabel: string;
  public readonly componentHookId: string;
  public readonly componentHookLabel: string;

  constructor(
    abilityStudioCapability: AbilityStudioRuntimeCapability,
    componentLabel: string,
    componentHookId: string,
    componentHookLabel: string,
  ) {
    super(false);
    this.abilityStudioCapability = abilityStudioCapability;
    this.componentLabel = componentLabel;
    this.componentHookId = componentHookId;
    this.componentHookLabel = componentHookLabel;
  }
}

export class AbilityStudioSourceAbilityAbAttr extends AbAttr {
  public readonly abilityStudioSourceAbilityId: number;
  public readonly componentLabel: string;
  public readonly componentHookId: string;
  public readonly componentHookLabel: string;

  constructor(sourceAbilityId: number, abilityName: string) {
    super(false);
    this.abilityStudioSourceAbilityId = sourceAbilityId;
    this.componentLabel = `${abilityName} linked runtime behavior`;
    this.componentHookId = "source-ability-runtime-check";
    this.componentHookLabel = `Whenever a game system checks for ${abilityName}`;
  }
}

export const ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS: ReadonlySet<AbilityId> = new Set([
  AbilityId.AURA_BREAK,
  AbilityId.BATTLE_BOND,
  AbilityId.BERSERK,
  AbilityId.COMATOSE,
  AbilityId.COMMANDER,
  AbilityId.DARK_AURA,
  AbilityId.FAIRY_AURA,
  AbilityId.FLOWER_GIFT,
  AbilityId.FORECAST,
  AbilityId.GULP_MISSILE,
  AbilityId.GUTS,
  AbilityId.HEAVY_METAL,
  AbilityId.ICE_FACE,
  AbilityId.ILLUMINATE,
  AbilityId.KLUTZ,
  AbilityId.LEVITATE,
  AbilityId.MIMICRY,
  AbilityId.MINUS,
  AbilityId.MULTITYPE,
  AbilityId.OVERCOAT,
  AbilityId.PLUS,
  AbilityId.POISON_HEAL,
  AbilityId.PRANKSTER,
  AbilityId.PROTOSYNTHESIS,
  AbilityId.QUARK_DRIVE,
  AbilityId.QUICK_DRAW,
  AbilityId.RKS_SYSTEM,
  AbilityId.SAND_FORCE,
  AbilityId.SHADOW_TAG,
  AbilityId.SHEER_FORCE,
  AbilityId.SNOW_WARNING,
  AbilityId.SOLAR_POWER,
  AbilityId.STANCE_CHANGE,
  AbilityId.STENCH,
  AbilityId.TRUANT,
  AbilityId.UNBURDEN,
  AbilityId.WANDERING_SPIRIT,
  AbilityId.WIND_POWER,
  AbilityId.WIND_RIDER,
  AbilityId.WONDER_GUARD,
]);

export function installAbilityStudioSourceAbilityComponents(abilities: readonly (Ability | undefined)[]): number {
  let installed = 0;
  for (const ability of abilities) {
    if (
      ability === undefined
      || ability.id <= 0
      || !ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS.has(ability.id)
      || !ability.name
      || ability.name.startsWith("???")
      || ability.attrs.some(attr => attr instanceof AbilityStudioSourceAbilityAbAttr)
    ) {
      continue;
    }
    (ability.attrs as AbAttr[]).push(new AbilityStudioSourceAbilityAbAttr(ability.id, ability.name));
    installed++;
  }
  return installed;
}

export function abilityStudioRuntimeConfiguration(attr: AbAttr): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(attr).filter(
      ([key, value]) =>
        !["apply", "canApply", "getCondition", "getTriggerMessage"].includes(key) && typeof value !== "function",
    ),
  );
}

export function abilityStudioRuntimeCapabilityLabel(attr: AbAttr): string | undefined {
  return attr instanceof AbilityStudioRuntimeCapabilityAbAttr || attr instanceof AbilityStudioSourceAbilityAbAttr
    ? attr.componentLabel
    : undefined;
}

export function abilityStudioRuntimeCapabilityHookLabel(attr: AbAttr): string | undefined {
  return attr instanceof AbilityStudioRuntimeCapabilityAbAttr || attr instanceof AbilityStudioSourceAbilityAbAttr
    ? attr.componentHookLabel
    : undefined;
}

const HOOK_TYPES = new Set([
  "PostBattleInitAbAttr",
  "PreDefendAbAttr",
  "PostDefendAbAttr",
  "PostStatStageChangeAbAttr",
  "PostAllyStatStageChangeAbAttr",
  "PreAttackAbAttr",
  "PostAttackAbAttr",
  "PostSetStatusAbAttr",
  "PostVictoryAbAttr",
  "PostKnockOutAbAttr",
  "PostSummonAbAttr",
  "PreSwitchOutAbAttr",
  "PreLeaveFieldAbAttr",
  "PreStatStageChangeAbAttr",
  "PreSetStatusAbAttr",
  "PreApplyBattlerTagAbAttr",
  "PostWakeUpAbAttr",
  "PreWeatherDamageAbAttr",
  "PreWeatherEffectAbAttr",
  "PostWeatherChangeAbAttr",
  "PostWeatherLapseAbAttr",
  "PostTerrainChangeAbAttr",
  "PostTurnAbAttr",
  "PostBiomeChangeAbAttr",
  "PostMoveUsedAbAttr",
  "PostItemLostAbAttr",
  "PostBattleAbAttr",
  "PostFaintAbAttr",
  "PreSummonAbAttr",
  "RedirectMoveAbAttr",
  "FlinchEffectAbAttr",
  "CancelInteractionAbAttr",
]);

export function abilityStudioRuntimeClassChain(value: object): string[] {
  const chain: string[] = [];
  let current: object | null = value;
  while (current !== null) {
    const name = current.constructor?.name;
    if (!name || name === "Object") {
      break;
    }
    chain.push(name);
    current = Object.getPrototypeOf(current) as object | null;
  }
  return chain;
}

export function abilityStudioRuntimeHookId(attr: AbAttr): string {
  if (attr instanceof AbilityStudioRuntimeCapabilityAbAttr || attr instanceof AbilityStudioSourceAbilityAbAttr) {
    return attr.componentHookId;
  }
  const chain = abilityStudioRuntimeClassChain(attr);
  return chain.find(type => HOOK_TYPES.has(type)) ?? chain[0];
}

export function abilityStudioRuntimeMethodOwner(value: object, method: "apply" | "canApply" | "getCondition"): string {
  let current = Object.getPrototypeOf(value) as object | null;
  while (current !== null) {
    if (Object.hasOwn(current, method)) {
      return current.constructor.name;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return "AbAttr";
}

function resolveAttr(
  source: AbilityStudioRuntimeSource,
  resolveAbility: (id: number) => Ability | undefined,
): { ability: Ability; attr: AbAttr } {
  const ability = resolveAbility(source.abilityId);
  if (ability === undefined) {
    throw new Error(`component source ability ${source.abilityId} is not registered`);
  }
  const attr = ability.attrs[source.attrIndex];
  if (attr === undefined) {
    throw new Error(`ability ${source.abilityId} has no component at index ${source.attrIndex}`);
  }
  if (attr.constructor.name !== source.attrType) {
    throw new Error(
      `ability ${source.abilityId} component ${source.attrIndex} is ${attr.constructor.name}, expected ${source.attrType}`,
    );
  }
  return { ability, attr };
}

function cloneAttr(attr: AbAttr): AbAttr {
  return Object.assign(Object.create(Object.getPrototypeOf(attr)), attr) as AbAttr;
}

export function compileAbilityStudioRuntimeComponentRule(
  rule: AbilityStudioRuntimeComponentRule,
  resolveAbility: (id: number) => Ability | undefined,
): AbAttr {
  const hookSource = resolveAttr(rule.hook, resolveAbility);
  const hookId = abilityStudioRuntimeHookId(hookSource.attr);
  const conditions = rule.conditions.map(reference => {
    const source = resolveAttr(reference, resolveAbility);
    if (reference.kind === "ability") {
      const condition = source.ability.conditions[reference.conditionIndex ?? -1];
      if (condition === undefined) {
        throw new Error(
          `component condition ${reference.conditionIndex} is missing from ability ${reference.abilityId}`,
        );
      }
      return (params: AbAttrBaseParams) => condition(params.pokemon);
    }
    if (reference.kind === "holder") {
      const condition = source.attr.getCondition();
      if (condition === null) {
        throw new Error(`component ${reference.attrType} has no holder condition`);
      }
      return (params: AbAttrBaseParams) => condition(params.pokemon);
    }
    if (abilityStudioRuntimeHookId(source.attr) !== hookId) {
      throw new Error(`event condition ${reference.attrType} is incompatible with hook ${hookId}`);
    }
    const attr = cloneAttr(source.attr);
    return (params: AbAttrBaseParams) => attr.canApply(params as never);
  });
  const effects = rule.effects.map(reference => {
    const source = resolveAttr(reference, resolveAbility);
    if (abilityStudioRuntimeHookId(source.attr) !== hookId) {
      throw new Error(`effect ${reference.attrType} is incompatible with hook ${hookId}`);
    }
    return cloneAttr(source.attr);
  });
  const carrier = cloneAttr(hookSource.attr) as AbAttr & {
    apply: (params: AbAttrBaseParams) => void;
    canApply: (params: AbAttrBaseParams) => boolean;
    getCondition: () => null;
    getTriggerMessage: (params: AbAttrBaseParams, abilityName: string) => string | null;
  };
  carrier.getCondition = () => null;
  carrier.canApply = params =>
    (conditions.length === 0
      || (rule.conditionLogic === "any"
        ? conditions.some(condition => condition(params))
        : conditions.every(condition => condition(params))))
    && (params.simulated === true || rule.chance >= 100 || params.pokemon.randBattleSeedInt(100) < rule.chance);
  carrier.apply = params => {
    for (const effect of effects) {
      effect.apply(params as never);
    }
  };
  carrier.getTriggerMessage = (params, abilityName) => {
    for (const effect of effects) {
      const message = effect.getTriggerMessage(params as never, abilityName);
      if (message) {
        return message;
      }
    }
    return null;
  };
  carrier.showAbility = effects.some(effect => effect.showAbility);
  return carrier;
}

export function compileAbilityStudioRuntimeComponentRuleAttrs(
  rule: AbilityStudioRuntimeComponentRule,
  resolveAbility: (id: number) => Ability | undefined,
): AbAttr[] {
  const carrier = compileAbilityStudioRuntimeComponentRule(rule, resolveAbility) as AbAttr & {
    apply: (params: AbAttrBaseParams) => void;
    canApply: (params: AbAttrBaseParams) => boolean;
  };
  const prerequisites = rule.prerequisiteHooks ?? [];
  if (prerequisites.length === 0) {
    return [carrier];
  }
  const progress = new WeakMap<object, number>();
  const signals = prerequisites.map((source, index) => {
    const signal = cloneAttr(resolveAttr(source, resolveAbility).attr) as AbAttr & {
      apply: (params: AbAttrBaseParams) => void;
      canApply: (params: AbAttrBaseParams) => boolean;
      getCondition: () => null;
      getTriggerMessage: () => null;
    };
    signal.getCondition = () => null;
    signal.canApply = params => params.simulated !== true;
    signal.apply = params => {
      const stateKey = params.pokemon.battleData;
      const current = progress.get(stateKey) ?? 0;
      if (current === index) {
        progress.set(stateKey, index + 1);
      } else if (index === 0) {
        progress.set(stateKey, 1);
      }
    };
    signal.getTriggerMessage = () => null;
    signal.showAbility = false;
    return signal;
  });
  const carrierCanApply = carrier.canApply.bind(carrier);
  const carrierApply = carrier.apply.bind(carrier);
  carrier.canApply = params =>
    progress.get(params.pokemon.battleData) === prerequisites.length && carrierCanApply(params);
  carrier.apply = params => {
    carrierApply(params);
    if (params.simulated !== true) {
      progress.delete(params.pokemon.battleData);
    }
  };
  return [...signals, carrier];
}
