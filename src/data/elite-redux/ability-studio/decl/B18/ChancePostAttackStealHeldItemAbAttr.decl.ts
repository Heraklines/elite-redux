/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4, Tier B event-effect, RNG in canApply. Gluttony, Low Blow and Cheap Tactics. "After my attack lands, IF the chance roll
// succeeds, DO steal one of the target's items" (optionally only berries, only on contact, only with certain moves).
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PostAttackStealHeldItemAbAttr (ab-attrs.ts:2222) over PostAttackAbAttr
// (ab-attrs.ts:2196). Constructor `({ chance, berryOnly?, contactRequired?, moveIds? })`; it builds the parent's steal condition from the
// options INSIDE the constructor and passes it up (the parent keeps it in a private field). Dispatch:
// applyAbAttrs("PostAttackAbAttr", { pokemon: holder, opponent: target, move, hitResult, damage }) in move-effect-phase.ts (applyOnTargetEffects).
// canApply, in the ORIGINAL order (now gate && residual):
//   gate        (simulated || randBattleSeedInt(100) < options.chance)   -> RNG draw 1 (library atom rng.chance), FIRST, as before
//   residual    super.canApply(params), unchanged, in the parents:
//                 PostAttackAbAttr: attackCondition(user, target, move) = move.category !== STATUS (the default)
//                 !simulated
//                 hitResult < HitResult.NO_EFFECT                                          (the hit dealt damage; TODO in the parent)
//                 stealCondition: options.moveIds (if any) includes move.id; options.contactRequired -> doesFlagEffectApply(CONTACT)
//                 heldItems = getTargetHeldItems(target) (berries only when berryOnly) filtered by isTransferable; if any,
//                 stolenItem = heldItems[randBattleSeedInt(heldItems.length)]   -> RNG draw 2; then canTransferHeldItemModifier(stolenItem, holder)
// apply       the parent's: tryTransferHeldItemModifier(stolenItem, holder) and the steal message (only the parent's own i18n text).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ChancePostAttackStealHeldItemAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { moveNameListCodec } from "./b18-chunk4-codecs";

/** The class keeps ONE options object; every param here is one key of it, and a flag left off leaves its key out (like the shipped users). */
type StealOptions = { chance?: number; berryOnly?: boolean; contactRequired?: boolean; moveIds?: unknown };
const optionsOf = (raw: unknown): StealOptions | undefined =>
  typeof raw === "object" && raw !== null ? (raw as StealOptions) : undefined;

export default defineDecl(ChancePostAttackStealHeldItemAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Chance to steal an item after my attack hits",
  summary: params =>
    `After my damaging attack hits, ${params.chance}% chance to steal one of the target's items (berries only: ${params.berryOnly ? "yes" : "no"}; contact needed: ${params.contactRequired ? "yes" : "no"}; only these moves: ${params.moveIds === "" ? "any" : params.moveIds}).`,
  synonyms: [
    "steal item on hit",
    "thief",
    "pickpocket",
    "steal a berry",
    "take the target's item",
    "gluttony steal",
    "low blow",
    "cheap tactics",
  ],
  examples: [
    "30% chance to steal a berry when I hit with a contact move, like Gluttony",
    "30% chance to steal the target's item when I use Scratch, like Cheap Tactics",
  ],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      ctorOption: "chance",
      path: "options",
      control: "slider",
      min: 1,
      max: 99,
      step: 1,
      integer: true,
      label: "Chance to steal (%, 1-99)",
      editable: true,
      default: 30,
      codec: { toCtor: value => Number(value), fromInstance: raw => optionsOf(raw)?.chance },
    },
    {
      id: "berryOnly",
      ctorIndex: 0,
      ctorOption: "berryOnly",
      path: "options",
      control: "boolean",
      label: "Only berries can be stolen",
      editable: true,
      gateIndependent: true,
      default: false,
      codec: {
        toCtor: value => (value === true ? true : undefined),
        fromInstance: raw => optionsOf(raw)?.berryOnly === true,
      },
    },
    {
      id: "contactRequired",
      ctorIndex: 0,
      ctorOption: "contactRequired",
      path: "options",
      control: "boolean",
      label: "Only moves that make contact can steal",
      editable: true,
      gateIndependent: true,
      default: false,
      codec: {
        toCtor: value => (value === true ? true : undefined),
        fromInstance: raw => optionsOf(raw)?.contactRequired === true,
      },
    },
    {
      id: "moveIds",
      ctorIndex: 0,
      ctorOption: "moveIds",
      path: "options",
      control: "text",
      label: "Only these moves can steal (comma separated move names, empty = any move)",
      editable: true,
      gateIndependent: true,
      default: "",
      codec: {
        toCtor: moveNameListCodec.toCtor,
        fromInstance: raw => moveNameListCodec.fromInstance(optionsOf(raw)?.moveIds),
      },
    },
  ],
  // The chance is repeated in the gate's chance atom, so moving the slider moves the compiled gate too.
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  // The gate is the chance roll alone, rng.chance (see bindings.ts); it is evaluated first, as the old canApply did.
  conditions: [{ slot: "gate", ctx: "params", lib: "rng.chance", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "The move must have dealt damage (a status move, or a hit that did nothing, never steals)",
    "Nothing happens when the game only previews the hit",
    "The target must hold an item that can be taken and I must be able to carry it; the item is picked at random",
  ],
  effect: { id: "effect.steal-item", params: ["berryOnly"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: ["chance roll (gate)", "random pick of the item to steal (inherited, after the filters)"],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "a contact move, a move without contact, Scratch, Feint Attack and a status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "SCRATCH", "FEINT_ATTACK", "SWORDS_DANCE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package (the steal is the library's effect.steal-item). Users (3 attrs): Gluttony (82, attr 2: 30%, berries only, contact needed), Low Blow (5121, attr 1: 30%, Feint Attack only) and Cheap Tactics (5164, attr 1: 30%, Scratch only). Class change (pure move, no behaviour change): gateOverride field, canApply = gatedCanApply, gate = the chance roll, residual = super.canApply(params). HONEST LIMIT: only the chance is a replaceable IF block. The move filter (moveIds), the contact test and the berry limit are typed SETTINGS of this block, not separate IF blocks, because the class builds the filters into a closure inside its constructor and hands it to PostAttackStealHeldItemAbAttr, which keeps it in a private field and runs it inside its own canApply, together with the item draw; the subclass cannot run the item pick without running those filters again, so a gate atom for 'the move is Scratch' or 'the move makes contact' would be a fake switch (the parent would still test the setting). Changing the setting rebuilds the real constructor and does change the behaviour, and every setting can be edited. Request R-B18-36 asks the owner of ab-attrs.ts to split PostAttackStealHeldItemAbAttr.canApply into a gate (steal condition) and a residual (item pick) so those filters can become library blocks (move.is-move, move.flag). The inherited rules also include `hitResult < NO_EFFECT` (no library atom, request R-B01-23) and `!simulated`. DRAWS: two random numbers per successful attempt, in this order: (1) the chance roll (rng.chance answers true without a draw when simulated; the class does the same), (2) the random item pick inside the inherited canApply. The chance is capped at 99 because rng.chance skips the draw at 100 or more while the class always draws (no shipped ability uses 100). `stolenItem` is per-instance transient state set in canApply and cleared in apply, which is why the harness builds fresh instances. A simulated call never steals (the parent returns false) and draws nothing (the chance answers true without a draw). ODDITIES, not fixed: (1) `target != null` is always true for this dispatch; (2) the steal message is the parent's generic one; (3) a user whose berryOnly is set but whose target holds no berry still burns the chance roll.",
});
