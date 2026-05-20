/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C0: minimal battle harness for ability/move tests.
//
// This is a LIGHTWEIGHT recording layer around `applyAbAttrs` that lets Phase C
// archetype-primitive tests verify ER abilities/moves behave correctly. It is
// NOT a full battle simulator — there is no real damage math, no globalScene
// integration, no turn loop. It is a focused, fast harness for:
//
//   1. Constructing duck-typed `Pokemon`-shaped objects with a given
//      active ability + up to 3 passives.
//   2. Triggering ability application via `applyAbAttrs(...)`.
//   3. Recording which slots fired, which `AbAttr` classes the dispatcher
//      tried to apply, and the params snapshot the dispatcher passed.
//   4. Returning a structured result the test can assert against.
//
// Modes (controlled by `HarnessSpec.applyMode`):
//   - "record-only" (default): the harness wraps `Ability.prototype.getAttrs`
//     for the run; each returned attr's `apply()` is replaced with a recorder
//     that does NOT execute the real apply. Safe to use with real vanilla
//     abilities (Intimidate, Drought, …) that would otherwise crash trying
//     to access `globalScene.arena`.
//   - "execute-attrs": the recorder still records, then calls the real
//     `apply()`. Use this ONLY when the abilities involved have no
//     globalScene dependencies (e.g. stub AbAttrs you constructed for an
//     archetype test). The harness will not protect you from globalScene
//     crashes in this mode — it's your responsibility.
//
// Design constraints (PER TASK C0):
//   - DO NOT depend on globalScene, BattleScene, GameManager, or Phaser.
//   - DO NOT implement battle math (damage, accuracy, type effectiveness).
//   - DO NOT mutate global state (allAbilities, allSpecies, …) beyond the
//     lifetime of a single `runHarness()` call.
//   - DO duck-type Pokemon to the minimum surface area `applyAbAttrs` touches.
//   - DO record everything that fires for downstream assertions.
// =============================================================================

import { Ability } from "#abilities/ability";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams, AbAttrMap, AbAttrParamMap } from "#types/ability-types";

/**
 * Identifier for the ability slot that fired.
 *
 * `"active"` is the species' normal (non-passive) ability;
 * `"passive-0" | "passive-1" | "passive-2"` correspond to the three ER innate
 * passive slots in declaration order.
 */
export type AbilitySlot = "active" | "passive-0" | "passive-1" | "passive-2";

/** Spec for a single Pokemon participant in the harness. */
export interface HarnessPokemonSpec {
  /** The active (non-passive) ability id. Use `AbilityId.NONE` to opt out. */
  readonly activeAbilityId: AbilityId;
  /**
   * Up to 3 ER passive (innate) ability ids in slot order. `NONE` leaves the
   * slot empty (the dispatcher will skip it). When omitted, all 3 slots are
   * empty — i.e. the Pokemon has only its active ability.
   */
  readonly passiveAbilityIds?: readonly [AbilityId, AbilityId, AbilityId];
  /**
   * If `true`, the stub's {@linkcode HarnessPokemon.canApplyAbility} returns
   * `false` for the active slot. Use to model suppression (Neutralizing Gas,
   * Gastro Acid, …).
   * @defaultValue `false`
   */
  readonly suppressActive?: boolean;
  /**
   * Slots (0/1/2) for which the stub's
   * {@linkcode HarnessPokemon.canApplyAbility} returns `false`. Use to model
   * per-slot suppression / `hasPassive`-disabled state.
   * @defaultValue `[]` (no suppression)
   */
  readonly suppressPassiveSlots?: readonly (0 | 1 | 2)[];
}

/**
 * The recorded slot-firing result for one ability dispatch.
 *
 * One {@linkcode AbilityFired} entry is created per slot that the dispatcher
 * iterates AND that has at least one matching `AbAttr` of the trigger's type
 * (a slot whose ability has zero attrs of the dispatched type is effectively
 * a no-op).
 */
export interface AbilityFired {
  /** The Pokemon role this firing belongs to (subject or opponent). */
  readonly role: "subject" | "opponent";
  /** Which slot fired. */
  readonly slot: AbilitySlot;
  /** The ability id that was dispatched. */
  readonly abilityId: AbilityId;
}

/** Recorded attr observation (one per AbAttr the dispatcher tried to apply on a slot). */
export interface AttrCall {
  /** The Pokemon role this attr call belongs to (subject or opponent). */
  readonly role: "subject" | "opponent";
  /** Which slot's ability owned the attr. */
  readonly slot: AbilitySlot;
  /** The ability id whose attr ran. */
  readonly abilityId: AbilityId;
  /** Constructor name of the AbAttr (e.g. `"PostSummonStatStageChangeAbAttr"`). */
  readonly attrType: string;
  /** The params object the dispatcher passed (may be mutated by `apply()` in execute mode). */
  readonly params: unknown;
}

/** The structured outcome of a single harness run. */
export interface HarnessResult {
  /** All slot-firings, in dispatch order. */
  readonly fired: readonly AbilityFired[];
  /** All observed attr applications, in dispatch order. */
  readonly attrCalls: readonly AttrCall[];
  /** Trigger messages queued by the abilities (only populated in execute-attrs mode). */
  readonly messages: readonly string[];
  /** Errors caught during dispatch — non-fatal to the harness itself. */
  readonly errors: readonly string[];
}

/** A duck-typed pokemon stub that satisfies the surface area `applyAbAttrs` touches. */
export interface HarnessPokemon {
  getAbility(): Ability;
  getPassiveAbilities(): readonly [Ability | null, Ability | null, Ability | null];
  hasPassive(): boolean;
  canApplyAbility(passive?: boolean, passiveSlot?: 0 | 1 | 2): boolean;
  waveData: { abilitiesApplied: Set<AbilityId> };
  summonData: { abilitiesApplied: Set<AbilityId> };
}

/**
 * Build a duck-typed Pokemon stub from a {@linkcode HarnessPokemonSpec}.
 *
 * Mirrors the pattern in `test/data/abilities/apply-ab-attrs-passives.test.ts`,
 * generalized so harness callers don't reinvent it.
 *
 * @remarks
 * The stub's `canApplyAbility(passive, slot)` respects `suppressActive` and
 * `suppressPassiveSlots` so tests can model Gastro-Acid-style suppression
 * without touching `globalScene`.
 */
export function makeHarnessPokemon(spec: HarnessPokemonSpec): HarnessPokemon {
  const activeAbility = allAbilities[spec.activeAbilityId];
  if (!activeAbility) {
    throw new Error(`[battle-harness] active ability id ${spec.activeAbilityId} not in allAbilities`);
  }
  const passiveSlotIds = spec.passiveAbilityIds ?? ([AbilityId.NONE, AbilityId.NONE, AbilityId.NONE] as const);
  const passiveSlotAbilities: readonly [Ability | null, Ability | null, Ability | null] = [
    passiveSlotIds[0] === AbilityId.NONE ? null : (allAbilities[passiveSlotIds[0]] ?? null),
    passiveSlotIds[1] === AbilityId.NONE ? null : (allAbilities[passiveSlotIds[1]] ?? null),
    passiveSlotIds[2] === AbilityId.NONE ? null : (allAbilities[passiveSlotIds[2]] ?? null),
  ];
  const suppressedSlots = new Set<0 | 1 | 2>(spec.suppressPassiveSlots ?? []);
  const suppressActive = spec.suppressActive === true;

  return {
    getAbility: () => activeAbility,
    getPassiveAbilities: () => passiveSlotAbilities,
    hasPassive: () => passiveSlotAbilities.some(a => a !== null),
    canApplyAbility: (passive = false, passiveSlot: 0 | 1 | 2 = 0) => {
      if (!passive) {
        return !suppressActive;
      }
      if (passiveSlotAbilities[passiveSlot] === null) {
        return false;
      }
      return !suppressedSlots.has(passiveSlot);
    },
    waveData: { abilitiesApplied: new Set<AbilityId>() },
    summonData: { abilitiesApplied: new Set<AbilityId>() },
  };
}

/**
 * The set of triggers the harness knows how to dispatch.
 *
 * Each trigger maps to an `applyAbAttrs(...)` invocation whose params shape
 * is satisfied by just {@linkcode AbAttrBaseParams} (`pokemon` + `simulated`).
 * Triggers that require extra params (move, opponent, damage holder, …) need
 * a dedicated scenario factory in `scenarios.ts` to supply those params —
 * they're not added to this union yet because C0 doesn't ship them.
 */
export type HarnessTrigger =
  | "PostSummonAbAttr"
  | "PostBattleInitAbAttr"
  | "PostTurnAbAttr"
  | "PostFaintAbAttr"
  | "PostStatStageChangeAbAttr";

/**
 * Behavior for the `attr.apply()` invocation inside the dispatch loop.
 *
 * - `"record-only"` (the safe default): each returned attr's `apply` is
 *   replaced with a recorder that does NOT run the real `apply`. Use when
 *   you want to verify "which abilities/attrs fired" without running battle
 *   code. Works with all real abilities (no globalScene dependency).
 * - `"execute-attrs"`: the recorder records AND then calls the real
 *   `apply()`. Use only when the abilities involved have no globalScene
 *   dependencies (e.g. archetype-primitive stubs you constructed in your
 *   test).
 */
export type HarnessApplyMode = "record-only" | "execute-attrs";

/** Spec for a single harness run. */
export interface HarnessSpec {
  /** The Pokemon whose ability we are testing. */
  readonly subject: HarnessPokemonSpec;
  /**
   * Optional opponent. Provided so triggers that care about the other side
   * (e.g. on-KO, on-take-damage) can be modeled. Not required for triggers
   * like `PostSummonAbAttr` that only touch the subject.
   */
  readonly opponent?: HarnessPokemonSpec;
  /** The trigger to dispatch. */
  readonly trigger: HarnessTrigger;
  /**
   * Whether the dispatch is simulated (no message-flyout side effects).
   * Defaults to `true` because the harness has no `globalScene` to render to.
   */
  readonly simulated?: boolean;
  /**
   * How to handle `attr.apply()`. See {@linkcode HarnessApplyMode}.
   * @defaultValue `"record-only"`
   */
  readonly applyMode?: HarnessApplyMode;
}

/**
 * Run a single harness dispatch and collect the recorded outcomes.
 *
 * @param spec - The harness specification.
 * @returns A {@linkcode HarnessResult} with the fired slots, attr calls,
 *   messages, and any errors. The returned object is frozen — callers may
 *   inspect it but must not mutate it.
 *
 * @example
 * ```ts
 * const result = runHarness({
 *   subject: { activeAbilityId: AbilityId.INTIMIDATE },
 *   trigger: "PostSummonAbAttr",
 * });
 * expect(result.fired).toHaveLength(1);
 * expect(result.fired[0].slot).toBe("active");
 * ```
 */
export function runHarness(spec: HarnessSpec): HarnessResult {
  const subject = makeHarnessPokemon(spec.subject);
  const opponent = spec.opponent ? makeHarnessPokemon(spec.opponent) : null;
  const simulated = spec.simulated ?? true;
  const applyMode: HarnessApplyMode = spec.applyMode ?? "record-only";

  const fired: AbilityFired[] = [];
  const attrCalls: AttrCall[] = [];
  const messages: string[] = [];
  const errors: string[] = [];

  const dispatch = (pokemon: HarnessPokemon, role: "subject" | "opponent") => {
    // The dispatcher's params object is mutated in-place by
    // `applyAbAttrsInternal` (it sets `passive` and `passiveSlot` per slot
    // it visits). Our recording hook reads `passive` / `passiveSlot` off
    // this same object to attribute each attr to the slot the dispatcher
    // is currently iterating.
    const dispatchParams = {
      pokemon: pokemon as unknown as Pokemon,
      simulated,
    } as AbAttrBaseParams as AbAttrParamMap[typeof spec.trigger];

    const restore = installRecordingHook({
      role,
      dispatchParams,
      attrCalls,
      executeAttrs: applyMode === "execute-attrs",
    });
    try {
      applyAbAttrs(spec.trigger, dispatchParams, messages);
    } catch (e) {
      errors.push(`dispatch ${spec.trigger} (${role}): ${(e as Error).message}`);
    } finally {
      restore();
    }

    recordFiringsFor(pokemon, role, spec.trigger, fired);
  };

  dispatch(subject, "subject");
  if (opponent) {
    dispatch(opponent, "opponent");
  }

  return Object.freeze<HarnessResult>({
    fired: Object.freeze(fired),
    attrCalls: Object.freeze(attrCalls),
    messages: Object.freeze(messages),
    errors: Object.freeze(errors),
  });
}

/**
 * Install a recording hook on `Ability.prototype.getAttrs` for the lifetime
 * of one dispatch. Each returned attr is replaced with a wrapper whose
 * `apply` records the call into `attrCalls`.
 *
 * Returns a `restore()` function that puts the original `getAttrs` back —
 * call this in a `finally` block so concurrent tests are never affected.
 *
 * @remarks
 * We hook `getAttrs` because it's the single chokepoint the dispatcher uses
 * to retrieve attrs for a slot (see {@linkcode applySingleAbAttrs}). By
 * wrapping the returned array we capture exactly the attrs the dispatcher
 * will iterate, with no noise from unrelated attrs.
 *
 * In **record-only** mode the wrapper also overrides `canApply`,
 * `getCondition`, and `getTriggerMessage` to no-ops (always `true`, `null`,
 * `null`). This is necessary because many real abilities' pre-flight checks
 * touch `globalScene.arena` (e.g. `PostSummonWeatherChangeAbAttr.canApply`),
 * which would crash the dispatcher before our recorder gets a chance to fire.
 *
 * In **execute-attrs** mode we leave all methods except `apply` untouched —
 * the test is responsible for ensuring the involved attrs have no
 * globalScene dependencies. (Typical case: stub AbAttrs constructed by an
 * archetype-primitive test.)
 *
 * Method overrides use `Object.defineProperty` on the per-call wrapper
 * (created via `Object.create(attr)`) so the original prototype chain stays
 * intact for any methods we don't intercept.
 */
function installRecordingHook(opts: {
  role: "subject" | "opponent";
  dispatchParams: unknown;
  attrCalls: AttrCall[];
  executeAttrs: boolean;
}): () => void {
  const proto = Ability.prototype as unknown as {
    getAttrs: <T extends keyof AbAttrMap>(this: Ability, attrType: T) => AbAttrMap[T][];
  };
  const originalGetAttrs = proto.getAttrs;

  proto.getAttrs = function recordingGetAttrs<T extends keyof AbAttrMap>(this: Ability, attrType: T): AbAttrMap[T][] {
    const realAttrs = originalGetAttrs.call(this, attrType);
    const ownerAbilityId = this.id;
    // Cast through `unknown`: the wrapped objects preserve the original
    // prototype chain so they're substitutable for the original attr's type
    // at runtime, but TypeScript can't see that across the `Object.create`
    // boundary because each attr in `realAttrs` may be one of dozens of
    // disparate subtypes whose mapped intersection collapses to `never`.
    return realAttrs.map(attr => {
      const wrapped = Object.create(attr) as typeof attr;

      // In record-only mode, override BOTH `canApply` and `apply` to be
      // no-ops. We MUST override `canApply` because many real abilities'
      // `canApply` implementations touch `globalScene.arena` (e.g.
      // `PostSummonWeatherChangeAbAttr` queries the current weather). The
      // dispatcher calls `canApply` BEFORE `apply`, so if we let it run we
      // crash before our recorder gets to fire.
      //
      // We also override `getCondition` to always return null. The base
      // class returns `extraCondition || null`, which is usually null, but
      // some abilities install conditions that touch globalScene too.
      // In execute-attrs mode we leave these untouched so the test can
      // assert the real condition's behavior.
      if (!opts.executeAttrs) {
        Object.defineProperty(wrapped, "canApply", {
          configurable: true,
          writable: true,
          enumerable: false,
          value: () => true,
        });
        Object.defineProperty(wrapped, "getCondition", {
          configurable: true,
          writable: true,
          enumerable: false,
          value: () => null,
        });
        // Suppress trigger messages too — some abilities format messages
        // by reading globalScene state. The dispatcher pushes the result
        // into the messages array regardless, but a null short-circuits it.
        Object.defineProperty(wrapped, "getTriggerMessage", {
          configurable: true,
          writable: true,
          enumerable: false,
          value: () => null,
        });
      }

      // Override `apply` on the per-call wrapper. Using Object.defineProperty
      // ensures we're not just shadowing a prototype property accidentally.
      Object.defineProperty(wrapped, "apply", {
        configurable: true,
        writable: true,
        enumerable: false,
        value(params: unknown) {
          const dispatchParams = opts.dispatchParams as {
            passive?: boolean;
            passiveSlot?: 0 | 1 | 2;
          };
          opts.attrCalls.push({
            role: opts.role,
            slot: resolveSlot(dispatchParams),
            abilityId: ownerAbilityId,
            attrType: attr.constructor.name,
            params,
          });
          if (opts.executeAttrs) {
            return (attr.apply as (p: unknown) => unknown).call(attr, params);
          }
          return;
        },
      });
      return wrapped;
    }) as unknown as AbAttrMap[T][];
  };

  return () => {
    proto.getAttrs = originalGetAttrs;
  };
}

/**
 * Re-derive the set of slots that fired during a dispatch. Mirrors the
 * iteration rules in `applyAbAttrsInternal`:
 *   1. Active fires iff `canApplyAbility(false)` returned true AND the
 *      active ability has at least one attr of the dispatched trigger.
 *   2. Each non-empty passive slot N fires iff:
 *      - `canApplyAbility(true, N)` returned true,
 *      - slot N's ability id has not yet been seen this dispatch, AND
 *      - the slot's ability has at least one attr of the dispatched trigger.
 *
 * We require ≥ 1 matching attr to count a slot as "fired" — a slot whose
 * ability has zero attrs of the trigger type is a no-op from the
 * dispatcher's perspective. This matches the test-facing semantics of "did
 * the ability actually react to this trigger?".
 *
 * @remarks
 * This is post-hoc derivation — we can't observe the dispatcher's actual
 * loop without monkey-patching `applySingleAbAttrs`. Because the
 * dispatcher's rules are deterministic and we have the same inputs,
 * re-deriving gives the same answer.
 */
function recordFiringsFor(
  pokemon: HarnessPokemon,
  role: "subject" | "opponent",
  trigger: HarnessTrigger,
  fired: AbilityFired[],
): void {
  const seenIds = new Set<AbilityId>();
  // Active.
  if (pokemon.canApplyAbility(false, 0)) {
    const activeAbility = pokemon.getAbility();
    if (activeAbility.getAttrs(trigger as keyof AbAttrMap).length > 0) {
      fired.push({ role, slot: "active", abilityId: activeAbility.id });
    }
    seenIds.add(activeAbility.id);
  }
  // Passives 0/1/2.
  const passives = pokemon.getPassiveAbilities();
  for (let slot = 0; slot < 3; slot++) {
    const slotIndex = slot as 0 | 1 | 2;
    const passive = passives[slot];
    if (passive === null) {
      continue;
    }
    if (seenIds.has(passive.id)) {
      continue;
    }
    if (!pokemon.canApplyAbility(true, slotIndex)) {
      continue;
    }
    if (passive.getAttrs(trigger as keyof AbAttrMap).length > 0) {
      fired.push({ role, slot: slotLabel(slotIndex), abilityId: passive.id });
    }
    seenIds.add(passive.id);
  }
}

function resolveSlot(params: { passive?: boolean; passiveSlot?: 0 | 1 | 2 }): AbilitySlot {
  if (!params.passive) {
    return "active";
  }
  return slotLabel((params.passiveSlot ?? 0) as 0 | 1 | 2);
}

function slotLabel(slot: 0 | 1 | 2): AbilitySlot {
  switch (slot) {
    case 0:
      return "passive-0";
    case 1:
      return "passive-1";
    case 2:
      return "passive-2";
  }
}

/**
 * Convenience: filter a {@linkcode HarnessResult.fired} list down to firings
 * for a specific role (subject or opponent). Tests reaching for "did
 * opponent's ability fire?" assertions read better with this than with raw
 * `.fired.filter(...)`.
 */
export function firedForRole(result: HarnessResult, role: "subject" | "opponent"): readonly AbilityFired[] {
  return result.fired.filter(f => f.role === role);
}

/**
 * Convenience: filter a {@linkcode HarnessResult.attrCalls} list down to
 * attribute calls of a specific class name. Used by archetype tests to
 * answer "did `TypeDamageBoostAbAttr` run?".
 */
export function attrCallsByType(result: HarnessResult, attrType: string): readonly AttrCall[] {
  return result.attrCalls.filter(c => c.attrType === attrType);
}
