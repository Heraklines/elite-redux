/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3. Package (Tier C). "Before I use a move, I change into the form my species links to that move's type; a Normal-type move returns me to my base form."
//
// Source: src/data/elite-redux/abilities/omniform.ts, class OmniformAbAttr (extends PostSummonAbAttr; constructor passes showAbility false, activateOnGain stays true). No canApply of its own
// (PostSummonAbAttr answers true), so there is no condition, guard or gate in the class. apply (the entry half), in order:
//   1. if simulated: return                                                   -> effect-side
//   2. erOmniformPreloadTargets(holder): holder must carry it (isActive(true), by constructor name); warm the sprite atlas of every form the holder could change into
//      (fire and forget, try/catch, purely cosmetic: it never changes a stat, move or random draw)
// The REAL mechanic is NOT in apply: erOmniformOnMoveStart(user, move), called from MovePhase.start before the move resolves (non-follow-up use), finds the holder's attr by constructor name and:
//   a. move.type === NORMAL (the move's printed type)   -> erOmniformRevertToBase (a no-op when already on base), then stop
//   b. target = lookupOmniformTarget(user, user.getMoveType(move)): the registry (omniform-registry.ts, filled by er-newcomer-species.ts) maps (holder species and form, move type) -> target form; none -> stop
//   c. target equals the current species and form -> stop (nothing to adapt)
//   d. swap species and form, recompute stats, pin Omniform (summonData.ability), rebuild the moveset: the used move keeps its slot; the other slots come from the target form's own stored moveset
//      (a per-evolution mon) or from deriveMoveset (a seeded learnset pick of derivedMoveCount moves, the ONLY random draws: globalScene.randBattleSeedInt, one per shuffle step)
//   e. play the transform effect and the "adapted into" message, then hold the move flow until it lands
// Reverts on leaveField (erOmniformRevertOnLeaveField).
// Constructor change (behaviour-neutral): the number of derived moves (default 3) is a constructor argument; erOmniformOnMoveStart reads it from the holder's live attr.
import { OmniformAbAttr } from "#data/elite-redux/abilities/omniform";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(OmniformAbAttr, {
  tier: "C",
  kind: "package",
  when: "while.active",
  label: "Change form to match the type of the move I use",
  summary: params =>
    `Before I use a move, I change into the form linked to that move's type; a Normal-type move returns me to my base form. A form without its own moves gets ${params.derivedMoveCount} from its learnset.`,
  synonyms: [
    "omniform",
    "adaptive evolution",
    "eeveelution",
    "form by move type",
    "change form before attacking",
    "type shifting",
    "partner eevee",
  ],
  examples: [
    "Use a Fire move and turn into the Fire form first, a Normal move and go back to the base form",
    "Shapeshift to match each attack like an eeveelution",
  ],
  params: [
    {
      id: "derivedMoveCount",
      ctorIndex: 0,
      path: "derivedMoveCount",
      control: "number",
      min: 1,
      max: 4,
      step: 1,
      integer: true,
      label: "Moves a form without its own stored moves gets from its learnset (no form needs it today)",
      editable: true,
      default: 3,
    },
    {
      id: "showAbility",
      ctorIndex: 1,
      path: "showAbility",
      control: "boolean",
      label: "Show the ability name when it triggers",
      // Only the saved studio ability Blase Powder wraps this attr with the name shown; every other user keeps the default (hidden).
      editable: false,
      default: false,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only a Pokemon whose species and form have a link for the move's type changes; the links are species data, not settings",
    "A Normal-type move (by its printed type) always returns me to the base form, and does nothing when I am already there",
    "A link to my own current form does nothing",
    "My other moves are replaced by the new form's moves, and the move being used keeps its slot",
    "Everything reverts when I leave the field, and the ability stays with me through the change",
    "The form change happens in the game's move handling just before the move; on entry the ability only preloads the pictures of the forms",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["derivedMoveCount"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "move start (not the class apply): deriveMoveset shuffles the learnset pool with one seeded draw per step, only for a form without its own stored moveset",
    ],
    state: "battle",
    simulated: "respects",
  },
  l2StaticReason:
    "The class apply only preloads sprites at entry; the form change is driven by the move handling before the move, which is not a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "enter and use a move", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified. 14 attrs in 14 abilities: Omniform (5929 attr 0) and the partner composites Adaptive Fur (5946 attr 2), Water Veil (5947 attr 3), Short Circuit (5948 attr 1), Flash Fire (5949 attr 1), Magic Bounce (5950 attr 1), Self Sufficient (5951 attr 1), Keen Edge (5952 attr 1), Ice Body (5953 attr 3), Pixilate (5954 attr 4), Fluffy (6001 attr 2), Stamina (6002 attr 2), Stainless Steel (6003 attr 6) and the saved studio ability Blase Powder (20012 attr 1, whose Omniform attr is wrapped by the studio rule carrier and carries its own canApply and apply). None of the 14 has a constructor closure, so no binding is needed. The class has no condition or gate of its own and the trigger is separate, so nothing is hidden inside the package. It cannot be split because the library has none of the pieces: a moment 'before I use a move' that this class can hang on (event.before-i-use-move and event.my-move-starts exist, but they are dispatched by other attr classes and the form change is driven straight from MovePhase.start by constructor name), a table-driven form change (effect.change-form is not implemented and takes one fixed form key, not a per-type table), moveset replacement with per-form PP memory, the pinned ability and the revert on leaving; requested as R-B15-23 (effect 'change form by the type of the move I use, from a form table, with its own moves per form'). The only number is typed (derived move count). The registry of links is species data filled by er-newcomer-species.ts and is not a setting. Suspected oddities, NOT fixed: (1) the Normal revert tests the PRINTED type (move.type) while the form lookup uses the EFFECTIVE type (getMoveType), so a Normal move that an ability turns into Fire reverts instead of adapting; (2) the entry half (sprite preload) is cosmetic and is the only thing the class apply does, so the WHEN of the declaration is 'while active' and not 'on entry'; (3) Blase Powder is a studio-built ability whose Omniform attr is an instance carrying overridden canApply and apply and the ability name shown; the non-editable setting 'showAbility' (constructor argument 1, added behaviour-neutral with default false) carries that one difference so L1 finds the rebuilt attr structurally identical. The L2 twin of Blase Powder still differs (the rule's Rage Powder, Powder and Unaware parts are lost) because recomposeAttr rebuilds the studio rule carrier as a plain Omniform attr; that is a harness and build-attr matter for every class that is the hook of a saved studio rule, requested as R-B15-27; (4) DEAD CODE, found while testing the seam: the learnset pick (deriveMoveset, the only user of derivedMoveCount) runs only when isErOmniformMon is false, but a holder can only have a mapping when its family has more than one form, which is exactly what isErOmniformMon tests, so in the game every mapped holder uses the stored per-form moves and the derived move count never matters; it is kept as a typed setting because the code reads it, and proven by a test that forces the legacy path.",
});
