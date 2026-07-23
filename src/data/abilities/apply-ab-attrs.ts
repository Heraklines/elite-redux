import type { Ability } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import type {
  AbAttrBaseParams,
  AbAttrMap,
  AbAttrParamMap,
  AbAttrString,
  CallableAbAttrString,
} from "#types/ability-types";

type AbAttrPredicate<T extends AbAttrString> = (attr: AbAttrMap[T]) => boolean;

/**
 * ER enemy difficulty scaling: cap how many of the 3 passive (innate) slots
 * an enemy pokemon can use based on its current level. Player pokemon are
 * unaffected (their passives are gated by candy-unlock state as designed).
 *
 * Curve:
 *   L1-14:  1 innate (slot 0 only)         — fresh-game encounters stay tame
 *   L15-23: 2 innates (slots 0-1)          — mid-route ramp
 *   L24-39: 3 innates (slots 0-2)          — late-route / gym leaders
 *   L40+:   3 innates (all slots)          — endgame parity with player
 *
 * Note: pokerogue's "active" ability is separate from passive slots — the
 * gate only restricts the 3 passive (innate) iteration; the active ability
 * always fires regardless of level.
 */
export function getEnemyPassiveSlotLimit(pokemon: { isEnemy?: () => boolean; level?: number }): number {
  // Defensive: harness-test mock pokemon lack `isEnemy`/`level` fields. Treat
  // missing fields as "not gated" so unit tests that exercise apply-ab-attrs
  // directly still see all 3 passive slots fire.
  if (typeof pokemon.isEnemy !== "function" || !pokemon.isEnemy()) {
    return 3;
  }
  const lvl = pokemon.level ?? 100;
  if (lvl >= 24) {
    return 3;
  }
  if (lvl >= 15) {
    return 2;
  }
  return 1;
}

interface ApplyAbAttrConfig<T extends AbAttrString> {
  /** An optional array to which ability trigger messges will be added */
  messages?: string[] | undefined;
  /**
   * An optional filter to use when determining what attributes to use.
   * Any {@linkcode AbAttr}s for which this returns `false` will be skipped during attribute application.
   */
  attrFilter?: AbAttrPredicate<T>;
}

function applySingleAbAttrs<T extends AbAttrString>(
  attrType: T,
  params: AbAttrParamMap[T],
  { attrFilter = () => true, messages }: ApplyAbAttrConfig<T> = {},
) {
  const { simulated = false, passive = false, pokemon } = params;
  // ER 3-passive: resolve the requested slot. Default to slot 0 for callers
  // that set `passive: true` without specifying a slot (legacy behavior).
  const slot = params.passiveSlot ?? 0;
  if (!pokemon.canApplyAbility(passive, slot)) {
    return;
  }

  let ability: Ability;
  if (passive) {
    const slotAbility = pokemon.getPassiveAbilities()[slot];
    if (!slotAbility) {
      // Empty slot — nothing to apply. Do NOT fall back to getPassiveAbility(),
      // as that would double-fire for legacy species (which fill slots 1/2 with NONE).
      // (canApplyAbility above also returns false for an empty slot — this is a
      // defensive belt-and-suspenders guard for the type narrowing.)
      return;
    }
    ability = slotAbility;
    // Defensive: avoid double-firing when this passive slot matches the active ability.
    // For dispatches that arrive via applyAbAttrsInternal, this is redundant with the
    // seenIds dedup in the loop above — but applySingleAbAttrs is also reachable
    // directly (e.g. applyOnGainAbAttrs, applyPostFormChangeAbAttrs, applyOnLoseAbAttrs)
    // with `passive: true`, so we keep this guard to preserve the legacy
    // "no double-fire when active === passive" invariant for all entry points.
    if (ability.id === pokemon.getAbility().id) {
      return;
    }
  } else {
    ability = pokemon.getAbility();
  }
  const attrs = ability.getAttrs(attrType);

  for (const attr of attrs) {
    if (!attrFilter(attr)) {
      continue;
    }

    // TODO: Make `getCondition` default to `() => true` instead of `null`
    const condition = attr.getCondition();
    // We require an `as any` cast to suppress an error about the `params` type not being assignable to
    // the type of the argument expected by `attr.canApply()`. This is OK, because we know that
    // `attr` is an instance of the `attrType` class provided to the method, and typescript _will_ check
    // that the `params` object has the correct properties for that class at the callsites.
    if ((condition && !condition(pokemon)) || !attr.canApply(params as any)) {
      continue;
    }

    let abShown = false;

    if (attr.showAbility && !simulated) {
      globalScene.phaseManager.queueAbilityDisplay(pokemon, passive, true, slot);
      abShown = true;
    }

    const message = attr.getTriggerMessage(params as any, ability.name);
    if (message) {
      if (!simulated) {
        globalScene.phaseManager.queueMessage(message);
      }
      // TODO: Should messages be added to the array if they aren't actually shown?
      messages?.push(message);
    }

    // The `as any` cast here uses the same reasoning as above.
    attr.apply(params as any);

    if (abShown) {
      globalScene.phaseManager.queueAbilityDisplay(pokemon, passive, false, slot);
    }

    if (!simulated) {
      pokemon.waveData.abilitiesApplied.add(ability.id);
      pokemon.summonData.abilitiesApplied.add(ability.id);
    }
  }
}

function applyAbAttrsInternal<T extends CallableAbAttrString>(
  attrType: T,
  params: AbAttrParamMap[T],
  config: ApplyAbAttrConfig<T>,
) {
  // If the pokemon is not defined, no ability attributes can be applied.
  // This check is necessary because of callers secretly passing `null`s to this function
  // (most notably during switch out/entrance code)
  // TODO: Find and remove all instances where this occurs
  if (!params.pokemon) {
    return;
  }
  if (params.passive !== undefined) {
    applySingleAbAttrs(attrType, params, config);
    return;
  }

  for (const source of params.pokemon.getActiveAbilitySources()) {
    params.passive = source.passive;
    params.passiveSlot = source.passiveSlot;
    applySingleAbAttrs(attrType, params, config);
  }

  // Restore passive/passiveSlot if they were undefined on entry to allow re-use of parameter objects
  params.passive = undefined;
  params.passiveSlot = undefined;
}

/**
 * Apply all ability attributes matching the given type.
 * @param attrType - The name of the ability attribute to apply
 * @param params - The parameters to pass to the ability attribute's `apply` method
 * @param messages - An optional array to which ability trigger messges will be added
 */
export function applyAbAttrs<T extends CallableAbAttrString>(
  attrType: T,
  params: AbAttrParamMap[T],
  messages?: string[],
): void {
  applyAbAttrsInternal(attrType, params, { messages });
}

export function applyFilteredAbAttrs<T extends CallableAbAttrString>(
  attrType: T,
  params: AbAttrParamMap[T],
  attrFilter: (attr: AbAttrMap[T]) => boolean,
  messages?: string[],
): void {
  applyAbAttrsInternal(attrType, params, { attrFilter, messages });
}

/**
 * Apply `PostSummonAbAttr` once for every currently eligible passive source.
 * Uses the centralized source enumeration so slot gates, suppression, GIFT
 * sources, and duplicate ability ids match normal attribute dispatch.
 */
export function applyPostSummonPassiveAbAttrs(pokemon: AbAttrBaseParams["pokemon"]): void {
  for (const source of pokemon.getActiveAbilitySources()) {
    if (!source.passive) {
      continue;
    }
    applySingleAbAttrs("PostSummonAbAttr", {
      pokemon,
      passive: true,
      passiveSlot: source.passiveSlot,
    } as AbAttrParamMap["PostSummonAbAttr"]);
  }
}

// TODO: Improve the type signatures of the following methods / refactor the apply methods

/**
 * `AbAttrPredicate` used to avoid triggering Imposter and other non re-activating `PostSummonAbAttr`s
 * when gaining the ability again.
 */
const postSummonGainedMidTurnCondition: AbAttrPredicate<"PostSummonAbAttr"> = attr => attr.shouldActivateOnGain();

/**
 * Applies abilities when they become active mid-turn through **temporary** effects
 * (such as from ability-changing or suppressing effects).
 *
 * Ignores passives as they don't change and shouldn't be reapplied when main abilities change
 */
// TODO: Rework to call `applyAbAttrsInternal` rather than iterating over `[false, true]` at callsites
export function applyOnGainAbAttrs(params: AbAttrBaseParams): void {
  applySingleAbAttrs("PostSummonAbAttr", params, { attrFilter: postSummonGainedMidTurnCondition });
}

/**
 * Apply the effects of abilities when they become active mid-turn from a Pokemon changing its form.
 *
 * @param params - The parameters to pass to the ability attribute's `apply` method
 * @remarks
 * In keeping with mainline behavior (such as Mega Tyranitar re-applying Sand Stream on Mega Evolving),
 * this will re-apply all relevant abilities **regardless** of whether the form change altered the ability or not.
 * @privateRemarks
 * This will not apply any attributes that extend off of `PostSummonFormChangeAbAttr` to prevent infinite loops,
 * and will only apply each unique `AbilityId` once per turn for a similar reason.
 */
export function applyPostFormChangeAbAttrs(params: Omit<AbAttrBaseParams, "passive">): void {
  const { pokemon } = params;
  const { formChangeAbilitiesApplied } = pokemon.turnData;
  const attrFilter = (attr: AbAttrMap["PostSummonAbAttr"]) =>
    !attr.is("PostSummonFormChangeAbAttr") && !attr.is("PostSummonFormChangeByWeatherAbAttr");

  for (const source of pokemon.getActiveAbilitySources()) {
    if (formChangeAbilitiesApplied.has(source.ability.id)) {
      continue;
    }
    formChangeAbilitiesApplied.add(source.ability.id);
    const sourceParams = {
      ...params,
      passive: source.passive,
      passiveSlot: source.passiveSlot,
    } as AbAttrParamMap["PostSummonAbAttr"];
    applySingleAbAttrs("PostSummonAbAttr", sourceParams, { attrFilter });
  }
}

/**
 * Applies ability attributes which activate when the ability is lost or suppressed (i.e. primal weather)
 */
export function applyOnLoseAbAttrs(params: AbAttrBaseParams): void {
  applySingleAbAttrs("PreLeaveFieldAbAttr", params);

  applySingleAbAttrs("IllusionBreakAbAttr", params);
}
