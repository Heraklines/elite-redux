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
  if (!pokemon.canApplyAbility(passive)) {
    return;
  }

  let ability: Ability;
  if (passive) {
    // ER 3-passive: resolve the requested slot. Default to slot 0 for callers
    // that set `passive: true` without specifying a slot (legacy behavior).
    const slot = params.passiveSlot ?? 0;
    const slotAbility = pokemon.getPassiveAbilities()[slot];
    if (!slotAbility) {
      // Empty slot — nothing to apply. Do NOT fall back to getPassiveAbility(),
      // as that would double-fire for legacy species (which fill slots 1/2 with NONE).
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
      globalScene.phaseManager.queueAbilityDisplay(pokemon, passive, true);
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
      globalScene.phaseManager.queueAbilityDisplay(pokemon, passive, false);
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

  // Apply the active ability first.
  params.passive = false;
  params.passiveSlot = undefined;
  applySingleAbAttrs(attrType, params, config);

  // Then iterate each non-empty passive slot (ER 3-passive model).
  // Empty slots return null from getPassiveAbilities() and are skipped.
  // Track ability ids we've already dispatched in this call so that:
  //   (a) a passive slot matching the active ability id is skipped (legacy invariant), AND
  //   (b) duplicate ids across passive slots — e.g. data-entry mistake where
  //       `inns[]` lists the same ability twice — fire only once.
  // The per-slot id check inside applySingleAbAttrs remains as defensive belt-and-suspenders
  // for callers that invoke applySingleAbAttrs directly with `passive: true`.
  const seenIds = new Set<number>();
  seenIds.add(params.pokemon.getAbility().id);
  const passiveAbilities = params.pokemon.getPassiveAbilities();
  for (let slot = 0; slot < 3; slot++) {
    const slotAbility = passiveAbilities[slot];
    if (slotAbility === null || seenIds.has(slotAbility.id)) {
      continue;
    }
    seenIds.add(slotAbility.id);
    params.passive = true;
    params.passiveSlot = slot as 0 | 1 | 2;
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
  const activeId = pokemon.getAbility().id;
  const passiveAbilities = pokemon.getPassiveAbilities();

  const attrFilter = (attr: AbAttrMap["PostSummonAbAttr"]) =>
    !attr.is("PostSummonFormChangeAbAttr") && !attr.is("PostSummonFormChangeByWeatherAbAttr");

  // Apply the active ability if its id has not yet been applied this turn.
  // Per-id idempotence prevents the form-change re-application from double-firing
  // (e.g. Mega Tyranitar re-applies Sand Stream once even if a prior trigger already ran it).
  if (!formChangeAbilitiesApplied.has(activeId)) {
    formChangeAbilitiesApplied.add(activeId);
    const activeParams = {
      ...params,
      passive: false as const,
      passiveSlot: undefined,
    } as AbAttrParamMap["PostSummonAbAttr"];
    applySingleAbAttrs("PostSummonAbAttr", activeParams, { attrFilter });
  }

  // Apply each non-empty passive slot whose id has not yet been applied.
  // Form change abilities currently don't work as passives, but we future-proof here
  // by iterating all 3 ER slots. The per-id idempotence is enforced via
  // formChangeAbilitiesApplied — we re-check on each slot (not a pre-snapshot)
  // so two slots sharing the same id don't double-fire within a single call.
  for (let slot = 0; slot < 3; slot++) {
    const slotAbility = passiveAbilities[slot];
    if (slotAbility === null || formChangeAbilitiesApplied.has(slotAbility.id)) {
      continue;
    }
    formChangeAbilitiesApplied.add(slotAbility.id);
    const passiveParams = {
      ...params,
      passive: true as const,
      passiveSlot: slot as 0 | 1 | 2,
    } as AbAttrParamMap["PostSummonAbAttr"];
    applySingleAbAttrs("PostSummonAbAttr", passiveParams, { attrFilter });
  }
}

/**
 * Applies ability attributes which activate when the ability is lost or suppressed (i.e. primal weather)
 */
export function applyOnLoseAbAttrs(params: AbAttrBaseParams): void {
  applySingleAbAttrs("PreLeaveFieldAbAttr", params);

  applySingleAbAttrs("IllusionBreakAbAttr", params);
}
