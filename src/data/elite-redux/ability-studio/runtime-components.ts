import { AbAttr, PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { AbilityId } from "#enums/ability-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { AbilityStudioCondition, AbilityStudioEffect } from "./ability-blueprint";
import {
  type AbilityStudioRuleContext,
  applyAbilityStudioEffects,
  matchesAbilityStudioCondition,
} from "./rule-ab-attrs";
import {
  type AbilityStudioRuntimeCapability,
  activateAbilityStudioRuntimeComponent,
  restrictAbilityStudioRuntimeComponent,
} from "./runtime-capabilities";

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
  readonly conditions: readonly (AbilityStudioRuntimeConditionReference | AbilityStudioCondition)[];
  readonly effects: readonly (AbilityStudioRuntimeSource | AbilityStudioEffect)[];
}

class AbilityStudioPostAttackConditionSignalAbAttr extends PostAttackAbAttr {
  private readonly satisfied = new WeakSet<object>();
  private readonly condition: AbilityStudioCondition;

  constructor(condition: AbilityStudioCondition) {
    super(() => true, false);
    this.condition = condition;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return matchesAbilityStudioCondition(this.condition, runtimeRuleContext("PostAttackAbAttr", params));
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated !== true) {
      this.satisfied.add(params.pokemon.battleData);
    }
  }

  override getTriggerMessage(): null {
    return null;
  }

  public consume(pokemon: Pokemon): void {
    this.satisfied.delete(pokemon.battleData);
  }

  public isSatisfied(pokemon: Pokemon): boolean {
    return this.satisfied.has(pokemon.battleData);
  }
}

export class AbilityStudioRuntimeCapabilityAbAttr extends AbAttr {
  public readonly abilityStudioCapability: AbilityStudioRuntimeCapability;
  public readonly componentLabel: string;
  public readonly componentHookId: string;
  public readonly componentHookLabel: string;
  private activeBattleData?: WeakSet<object>;

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

  public restrictToTriggeredActivation(): void {
    this.activeBattleData = new WeakSet<object>();
  }

  public activateFor(pokemon: Pokemon): void {
    this.activeBattleData?.add(pokemon.battleData);
  }

  public isActiveFor(pokemon?: Pokemon): boolean {
    return (
      this.activeBattleData === undefined || (pokemon !== undefined && this.activeBattleData.has(pokemon.battleData))
    );
  }
}

export class AbilityStudioSourceAbilityAbAttr extends AbAttr {
  public readonly abilityStudioSourceAbilityId: number;
  public readonly componentLabel: string;
  public readonly componentHookId: string;
  public readonly componentHookLabel: string;
  private activeBattleData?: WeakSet<object>;

  constructor(sourceAbilityId: number, abilityName: string) {
    super(false);
    this.abilityStudioSourceAbilityId = sourceAbilityId;
    this.componentLabel = `${abilityName} linked runtime behavior`;
    this.componentHookId = "source-ability-runtime-check";
    this.componentHookLabel = `Whenever a game system checks for ${abilityName}`;
  }

  public restrictToTriggeredActivation(): void {
    this.activeBattleData = new WeakSet<object>();
  }

  public activateFor(pokemon: Pokemon): void {
    this.activeBattleData?.add(pokemon.battleData);
  }

  public isActiveFor(pokemon?: Pokemon): boolean {
    return (
      this.activeBattleData === undefined || (pokemon !== undefined && this.activeBattleData.has(pokemon.battleData))
    );
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

export const ABILITY_STUDIO_RUNTIME_HOOK_CONTEXTS: Readonly<Record<string, readonly string[]>> = {
  PostBattleInitAbAttr: ["holder", "battle initialization"],
  PreDefendAbAttr: ["holder", "attacker", "move", "incoming damage", "simulation state"],
  PostDefendAbAttr: ["holder", "attacker", "move", "damage dealt", "hit result", "simulation state"],
  PostStatStageChangeAbAttr: ["holder", "changed stats", "stage delta", "source", "simulation state"],
  PostAllyStatStageChangeAbAttr: ["holder", "ally", "changed stats", "stage delta", "simulation state"],
  PreAttackAbAttr: ["holder", "target", "move", "move calculation", "simulation state"],
  PostAttackAbAttr: ["holder", "target", "move", "damage dealt", "hit result", "simulation state"],
  PostSetStatusAbAttr: ["holder", "status", "source", "simulation state"],
  PostVictoryAbAttr: ["holder", "defeated Pokemon", "simulation state"],
  PostKnockOutAbAttr: ["holder", "defeated Pokemon", "simulation state"],
  PostSummonAbAttr: ["holder", "entry state", "simulation state"],
  PreSwitchOutAbAttr: ["holder", "switch state", "simulation state"],
  PreLeaveFieldAbAttr: ["holder", "field-leave state", "simulation state"],
  PreStatStageChangeAbAttr: ["holder", "changed stats", "stage delta", "source", "cancellation state"],
  PreSetStatusAbAttr: ["holder", "status", "source", "cancellation state"],
  PreApplyBattlerTagAbAttr: ["holder", "volatile effect", "source", "cancellation state"],
  PostWakeUpAbAttr: ["holder", "wake-up state"],
  PreWeatherDamageAbAttr: ["holder", "weather", "cancellation state"],
  PreWeatherEffectAbAttr: ["holder", "weather", "cancellation state"],
  PostWeatherChangeAbAttr: ["holder", "weather", "simulation state"],
  PostWeatherLapseAbAttr: ["holder", "weather", "simulation state"],
  PostTerrainChangeAbAttr: ["holder", "terrain", "simulation state"],
  PostTurnAbAttr: ["holder", "turn-end state", "simulation state"],
  PostBiomeChangeAbAttr: ["holder", "biome", "simulation state"],
  PostMoveUsedAbAttr: ["holder", "move user", "move", "targets", "simulation state"],
  PostItemLostAbAttr: ["holder", "opponent", "lost-item state"],
  PostBattleAbAttr: ["holder", "victory state"],
  PostFaintAbAttr: ["holder", "attacker", "move", "simulation state"],
  PreSummonAbAttr: ["holder", "pre-entry state"],
  RedirectMoveAbAttr: ["holder", "move user", "move", "targets", "redirection state"],
  FlinchEffectAbAttr: ["holder", "flinch state", "simulation state"],
  CancelInteractionAbAttr: ["holder", "cancellation state"],
  "source-ability-runtime-check": ["holder", "direct engine check"],
};

export function abilityStudioRuntimeHookContext(hookId: string): readonly string[] {
  return ABILITY_STUDIO_RUNTIME_HOOK_CONTEXTS[hookId] ?? ["holder", `runtime:${hookId}`];
}

export function abilityStudioRuntimeHookSupports(targetHookId: string, sourceHookId: string): boolean {
  const target = new Set(abilityStudioRuntimeHookContext(targetHookId));
  return abilityStudioRuntimeHookContext(sourceHookId).every(value => target.has(value));
}

const ABILITY_STUDIO_RUNTIME_EFFECT_CONTEXTS: Readonly<Record<string, readonly string[]>> = {
  PostBattleInitAbAttr: ["holder"],
  PostSummonAbAttr: ["holder", "simulation state"],
  PreSwitchOutAbAttr: ["holder"],
  PreLeaveFieldAbAttr: ["holder"],
  PostWakeUpAbAttr: ["holder"],
  PostTurnAbAttr: ["holder", "simulation state"],
  PostBiomeChangeAbAttr: ["holder", "biome", "simulation state"],
  PostBattleAbAttr: ["holder", "victory state"],
  PreSummonAbAttr: ["holder"],
  CancelInteractionAbAttr: ["holder", "cancellation state"],
};

export function abilityStudioRuntimeEffectHookContext(hookId: string): readonly string[] {
  return ABILITY_STUDIO_RUNTIME_EFFECT_CONTEXTS[hookId] ?? abilityStudioRuntimeHookContext(hookId);
}

export function abilityStudioRuntimeEffectHookSupports(targetHookId: string, sourceHookId: string): boolean {
  const target = new Set(abilityStudioRuntimeHookContext(targetHookId));
  return abilityStudioRuntimeEffectHookContext(sourceHookId).every(value => target.has(value));
}

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

function isRuntimeSource(value: AbilityStudioRuntimeSource | AbilityStudioEffect): value is AbilityStudioRuntimeSource {
  return "abilityId" in value;
}

function isRuntimeCondition(
  value: AbilityStudioRuntimeConditionReference | AbilityStudioCondition,
): value is AbilityStudioRuntimeConditionReference {
  return "abilityId" in value;
}

function runtimeSourceKey(source: AbilityStudioRuntimeSource): string {
  return `${source.abilityId}:${source.attrIndex}:${source.attrType}`;
}

type RuntimeRuleParams = AbAttrBaseParams & {
  readonly opponent?: Pokemon;
  readonly attacker?: Pokemon;
  readonly victim?: Pokemon;
  readonly target?: Pokemon;
  readonly move?: Move;
};

function runtimeRuleContext(hookId: string, params: AbAttrBaseParams): AbilityStudioRuleContext {
  const runtime = params as RuntimeRuleParams;
  const other = runtime.opponent ?? runtime.attacker ?? runtime.victim ?? runtime.target;
  const moveSource = ["PreDefendAbAttr", "PostDefendAbAttr", "PostFaintAbAttr"].includes(hookId)
    ? other
    : params.pokemon;
  return {
    holder: params.pokemon,
    other,
    move: runtime.move,
    moveSource,
    simulated: !!params.simulated,
  };
}

const runtimeRuleHelpers = new WeakMap<AbAttr, { before: readonly AbAttr[]; after: readonly AbAttr[] }>();

export function compileAbilityStudioRuntimeComponentRule(
  rule: AbilityStudioRuntimeComponentRule,
  resolveAbility: (id: number) => Ability | undefined,
): AbAttr {
  const hookSource = resolveAttr(rule.hook, resolveAbility);
  const hookId = abilityStudioRuntimeHookId(hookSource.attr);
  const helperAttrs: { before: AbAttr[]; after: AbAttr[] } = { before: [], after: [] };
  const consumedSignals: Array<(params: AbAttrBaseParams) => void> = [];
  const clonedSources = new Map<string, { ability: Ability; attr: AbAttr }>();
  const resolveClonedSource = (reference: AbilityStudioRuntimeSource): { ability: Ability; attr: AbAttr } => {
    const key = runtimeSourceKey(reference);
    const existing = clonedSources.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const source = resolveAttr(reference, resolveAbility);
    const cloned = { ability: source.ability, attr: cloneAttr(source.attr) };
    clonedSources.set(key, cloned);
    return cloned;
  };
  const conditions = rule.conditions.map(reference => {
    if (!isRuntimeCondition(reference)) {
      if (reference.kind === "move" && !abilityStudioRuntimeHookContext(hookId).includes("move")) {
        const signal = new AbilityStudioPostAttackConditionSignalAbAttr(reference);
        helperAttrs.before.push(signal);
        consumedSignals.push(params => signal.consume(params.pokemon));
        return (params: AbAttrBaseParams) => signal.isSatisfied(params.pokemon);
      }
      return (params: AbAttrBaseParams) => matchesAbilityStudioCondition(reference, runtimeRuleContext(hookId, params));
    }
    const source = resolveClonedSource(reference);
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
    if (abilityStudioRuntimeHookSupports(hookId, abilityStudioRuntimeHookId(source.attr))) {
      return (params: AbAttrBaseParams) => source.attr.canApply(params as never);
    }
    const satisfied = new WeakSet<object>();
    const signal = cloneAttr(resolveAttr(reference, resolveAbility).attr) as AbAttr & {
      apply: (params: AbAttrBaseParams) => void;
      getTriggerMessage: () => null;
    };
    signal.apply = params => {
      if (params.simulated !== true) {
        satisfied.add(params.pokemon.battleData);
      }
    };
    signal.getTriggerMessage = () => null;
    signal.showAbility = false;
    helperAttrs.before.push(signal);
    consumedSignals.push(params => satisfied.delete(params.pokemon.battleData));
    return (params: AbAttrBaseParams) => satisfied.has(params.pokemon.battleData);
  });
  const explicitEventGates = new Set(
    rule.conditions
      .filter(isRuntimeCondition)
      .filter(condition => condition.kind === "event")
      .map(runtimeSourceKey),
  );
  const effects = rule.effects.map(reference => {
    if (!isRuntimeSource(reference)) {
      return { effect: reference } as const;
    }
    const source = resolveClonedSource(reference);
    const capability = source.attr;
    if (
      (capability instanceof AbilityStudioRuntimeCapabilityAbAttr
        || capability instanceof AbilityStudioSourceAbilityAbAttr)
      && runtimeSourceKey(reference) !== runtimeSourceKey(rule.hook)
    ) {
      capability.restrictToTriggeredActivation();
      helperAttrs.after.push(capability);
      return {
        activate: (params: AbAttrBaseParams) => {
          if (params.simulated !== true) {
            capability.activateFor(params.pokemon);
          }
        },
      } as const;
    }
    if (
      abilityStudioRuntimeMethodOwner(source.attr, "apply") === "AbAttr"
      && runtimeSourceKey(reference) !== runtimeSourceKey(rule.hook)
    ) {
      const directCapability = source.attr;
      restrictAbilityStudioRuntimeComponent(directCapability);
      helperAttrs.after.push(directCapability);
      return {
        activate: (params: AbAttrBaseParams) => {
          if (params.simulated !== true) {
            activateAbilityStudioRuntimeComponent(directCapability, params.pokemon);
          }
        },
      } as const;
    }
    if (!abilityStudioRuntimeEffectHookSupports(hookId, abilityStudioRuntimeHookId(source.attr))) {
      const active = new WeakSet<object>();
      const deferred = source.attr as AbAttr & { apply: (params: AbAttrBaseParams) => void };
      const apply = deferred.apply.bind(deferred);
      deferred.addCondition(pokemon => active.has(pokemon.battleData));
      deferred.apply = params => {
        apply(params);
        if (params.simulated !== true) {
          active.delete(params.pokemon.battleData);
        }
      };
      helperAttrs.after.push(deferred);
      return {
        activate: (params: AbAttrBaseParams) => {
          if (params.simulated !== true) {
            active.add(params.pokemon.battleData);
          }
        },
      } as const;
    }
    return {
      attr: source.attr,
      checkEligibility: !explicitEventGates.has(runtimeSourceKey(reference)),
    } as const;
  });
  const eligibleEffects = new WeakMap<AbAttrBaseParams, readonly boolean[]>();
  const resolveEligibleEffects = (params: AbAttrBaseParams): readonly boolean[] =>
    effects.map(effect => ("attr" in effect && effect.checkEligibility ? effect.attr.canApply(params as never) : true));
  const carrier = cloneAttr(hookSource.attr) as AbAttr & {
    apply: (params: AbAttrBaseParams) => void;
    canApply: (params: AbAttrBaseParams) => boolean;
    getCondition: () => null;
    getTriggerMessage: (params: AbAttrBaseParams, abilityName: string) => string | null;
  };
  carrier.getCondition = () => null;
  carrier.canApply = params => {
    const ruleCanApply =
      (conditions.length === 0
        || (rule.conditionLogic === "any"
          ? conditions.some(condition => condition(params))
          : conditions.every(condition => condition(params))))
      && (params.simulated === true || rule.chance >= 100 || params.pokemon.randBattleSeedInt(100) < rule.chance);
    if (!ruleCanApply) {
      return false;
    }
    const eligible = resolveEligibleEffects(params);
    eligibleEffects.set(params, eligible);
    return eligible.some(Boolean);
  };
  carrier.apply = params => {
    const eligible = eligibleEffects.get(params) ?? resolveEligibleEffects(params);
    for (const [index, effect] of effects.entries()) {
      if (!eligible[index]) {
        continue;
      }
      if ("attr" in effect) {
        effect.attr.apply(params as never);
      } else if ("activate" in effect) {
        effect.activate(params);
      } else {
        applyAbilityStudioEffects([effect.effect], runtimeRuleContext(hookId, params));
      }
    }
    for (const consume of consumedSignals) {
      consume(params);
    }
  };
  carrier.getTriggerMessage = (params, abilityName) => {
    const eligible = eligibleEffects.get(params) ?? effects.map(() => true);
    for (const [index, effect] of effects.entries()) {
      if (!eligible[index]) {
        continue;
      }
      const message = "attr" in effect ? effect.attr.getTriggerMessage(params as never, abilityName) : null;
      if (message) {
        return message;
      }
    }
    return null;
  };
  carrier.showAbility = effects.some(effect => !("attr" in effect) || effect.attr.showAbility);
  runtimeRuleHelpers.set(carrier, helperAttrs);
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
  const helpers = runtimeRuleHelpers.get(carrier) ?? { before: [], after: [] };
  const prerequisites = rule.prerequisiteHooks ?? [];
  if (prerequisites.length === 0) {
    return [...helpers.before, carrier, ...helpers.after];
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
  return [...signals, ...helpers.before, carrier, ...helpers.after];
}
