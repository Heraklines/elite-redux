/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 1. "When I enter the battle, I lay a one-use trap on the opposing side" (Spore Bed).
//
// Source: src/data/elite-redux/archetypes/entry-trap-on-foe-side.ts, class EntryTrapOnFoeSideAbAttr (extends PostSummonAbAttr).
// Dispatched when the holder enters (`applyAbAttrs("PostSummonAbAttr")`). `canApply` is `true` (no condition at all). `apply`:
//   1. `simulated`                                          -> do nothing
//   2. side: `this.side === "self" ? ownSide : foeSide`     (own side = PLAYER for a player holder, else ENEMY; foe side the other)
//   3. `arena.addTag(ER_INFESTATION_TRAP, 0, undefined, pokemon.id, targetSide)`   turnCount 0: it stays until it catches someone
//   4. `tag = arena.getTagOnSide(ER_INFESTATION_TRAP, targetSide)`; `if (tag instanceof ErEntryTrapTag) tag.configure(appliedTag)`
// The trap itself (arena-tag.ts ErEntryTrapTag, line 2180) is an EntryHazardTag, grounded-only, max 1 layer: the next grounded
// Pokemon to switch in on that side gets `appliedTag` for 4 to 5 turns (one seeded draw `randBattleSeedIntRange(4, 5)` at THAT moment,
// not now) and the trap is spent.
// Constructor: (appliedTag = INFESTATION, side = "foe"), both exposed. showAbility is `super(true)`. No random draw in this class.
//
// A PACKAGE on purpose, and only for the effect. The trigger (when I enter) is a normal swappable WHEN and extra IFs can be ANDed on
// top. The effect is "lay this particular trap and configure it with the chosen battle effect" in one apply: the library effect
// `effect.arena-tag` (planned) only names a tag and a side and has no second step to hand the placed trap its battle effect, and the
// trap is a special arena tag with its own catch-and-spend rule. Both choices are typed settings below. Request R-B09-21 asks for a
// first-class "lay a one-use entry trap" effect so that this block can later be listed as an ordinary effect.
import { EntryTrapOnFoeSideAbAttr } from "#data/elite-redux/archetypes/entry-trap-on-foe-side";
import { TRAP_EFFECT_OPTIONS, TRAP_SIDE_FOE, TRAP_SIDE_OPTIONS, trapEffectCodec, trapSideCodec } from "./chunk1-codecs";

export default defineDecl(EntryTrapOnFoeSideAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Lay a one-use trap for the next Pokemon that switches in",
  summary: params =>
    `When I enter, I lay a one-use trap on ${String(params.side).toLowerCase()}. The next grounded Pokemon to switch in there gets ${String(params.effect)} for 4 to 5 turns.`,
  synonyms: [
    "spore bed",
    "entry trap",
    "hazard that traps",
    "infestation trap",
    "switch in trap",
    "one time hazard",
    "lay a trap",
  ],
  examples: ["Leave an infestation trap on the foe's side when I enter, like Spore Bed"],
  params: [
    {
      id: "effect",
      ctorIndex: 0,
      path: "appliedTag",
      control: "select",
      label: "Battle effect the trap gives to the Pokemon it catches",
      editable: true,
      default: "Infestation",
      options: TRAP_EFFECT_OPTIONS,
      codec: trapEffectCodec,
    },
    {
      id: "side",
      ctorIndex: 1,
      path: "side",
      control: "select",
      label: "Side the trap is laid on",
      editable: true,
      default: TRAP_SIDE_FOE,
      options: TRAP_SIDE_OPTIONS,
      codec: trapSideCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only grounded Pokemon set the trap off, and only the first one that switches in",
    "If a trap is already on that side it is not laid twice (it keeps one layer)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: ["effect", "side"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "entering with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Package, 1 attr: Spore Bed (5902 attr 0). Justification: the effect lays a special arena trap (ErEntryTrapTag, one layer, grounded only, spent after one catch) and then calls tag.configure(appliedTag) on the placed tag; effect.arena-tag has no way to say the second step. Both constructor arguments are typed settings (the battle effect from a short list of effects that make sense for a trap, and the side). Only Infestation is proven by a battle test (Spore Bed); the other listed effects go through the same pokemon.addTag path but no ability uses them. The 4 to 5 turn duration is drawn from the seeded RNG when the trap goes off, not when it is laid, so this class draws nothing. Oddity, not fixed: when a trap is already on the side, arena.addTag only runs the overlap rule and the class still calls configure on the EXISTING tag, so a second holder with another battle effect would rewrite the first trap's effect (even a spent one). Honest bucket: package-only (trigger separate).",
});
