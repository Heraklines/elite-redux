/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2. Package (Tier C). "When I enter, the foe across from me gains Dragon as an extra type; later, a foe I damage with a biting or Dragon move gains it too."
//
// Source: src/data/elite-redux/abilities/draconic-voodoo.ts, class DraconicVoodooAbAttr (extends PostSummonAbAttr; constructor passes showAbility false,
// activateOnGain stays true). No canApply of its own (PostSummonAbAttr answers true), so there is no condition, guard or gate in the class.
// apply (the entry half), in order:
//   1. if simulated: return                                                                   -> effect-side
//   2. target = opponentAcross(holder): the foe in the same field slot, else the first foe; none -> nothing
//   3. graftDragon(target, type): no-op when the target already has the type (native, Tera or grafted); else graftType (type-graft substrate: stacks on top,
//      survives the target switching out, expires at wave end) and queue the "gained the type" message
// The ON-HIT half is NOT in this class: erDraconicVoodooOnHit is called from erBatch4OnTargetHit (batch4-on-hit.ts, once per target per hit of an attacking move,
// from MoveEffectPhase.applyOnTargetEffects), finds the holder's attr by constructor name and tests, in order: damaging, target not fainted, holder carries it
// (isActive(true) and an active DraconicVoodooAbAttr), then `move.hasFlag(BITING_MOVE) || user.getMoveType(move) === type`, then graftDragon(target, type).
// Constructor change (behaviour-neutral): the type is a constructor argument (default Dragon); both halves read it from the holder's live attr.
// No random draw. State: the graft substrate's own record (type-graft.ts).
import { DraconicVoodooAbAttr } from "#data/elite-redux/abilities/draconic-voodoo";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(DraconicVoodooAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Add an extra type to the foe across from me",
  summary: params =>
    `When I enter, the foe across from me gains the ${params.type} type on top of its own. Later, a foe I damage with a biting move or a ${params.type}-type move gains it too.`,
  synonyms: [
    "draconic voodoo",
    "add a type to the foe",
    "extra type on entry",
    "make the foe dragon type",
    "type graft",
    "give the opponent a type",
  ],
  examples: [
    "When I enter, the foe in front of me becomes part Dragon",
    "Biting moves add a type to whatever they hit",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "graftedType",
      control: "select",
      label: "Type added to foes",
      editable: true,
      default: "DRAGON",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A foe that already has the type is left alone",
    "If nothing stands across from me, the first foe is used",
    "The type is added on top of the foe's own types, stays when it switches out and fades at the end of the wave",
    "The on-hit half (a biting move or a move of that type, only when it deals damage and the target is still standing) is built into the game's hit handling and is not part of this block",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "enter against a foe that is not that type", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified. 1 attr in 1 ability: Draconic Voodoo (5930 attr 0). The entry trigger is a separate swappable WHEN and the class has no condition, so nothing is hidden. The effect cannot be split because the library has no 'add a type to a Pokemon' effect (the graft substrate with its wave-end expiry and its message), see request R-B15-4 (the same graft effect Bad Splice needs). The second half of the ability (graft on a damaging biting or same-type hit) lives in the engine's hit seam (batch4-on-hit.ts), found by constructor name; it needs a WHEN 'when my attack damages a target' that the library lacks and a printed-flag atom (biting uses move.hasFlag), requests R-B15-12 (the moment) and R-B15-6 (the flag atom). The only setting is the type (typed, default Dragon), shared by both halves. Suspected oddities, NOT fixed: (1) the on-hit half tests the PRINTED biting flag while most flag consumers use doesFlagEffectApply; (2) the entry half targets one foe only (across, else first), the on-hit half any damaged target, which matches the ability text; (3) a foe that is Tera Dragon counts as already Dragon (isOfType) and is skipped silently.",
});
