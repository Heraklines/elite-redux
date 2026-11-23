/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4. PARKED until the librarian adds the WHEN `event.foe-enters` with dispatch key MudballReactiveAbAttr (request R-B14-4.3);
// then rename this file to MudballReactiveAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "When a foe enters the field, I answer it with a free Mud Bomb at 20 power, if it is a Flying type."
//
// Source: bernerd-roster-mechanics.ts MudballReactiveAbAttr (extends AbAttr) and the function erMudballOnOpponentSummon in the same file,
// called by PostSummonPhase for EVERY Pokemon that enters (src/phases/post-summon-phase.ts, about line 75). Nothing is dispatched through
// applyAbAttrs: the function finds the attr by class name on each living opposing holder. Its clauses, in the original order:
//   guard  1. !incoming.isFainted()                       the entering Pokemon is standing (checked once, for every holder)
//   gate   2. incoming.isOfType(FLYING)                   -> library mon.has-type { who: other, type: FLYING }   (now `gate` of the class)
//   guard  3. !holder.isFainted()                         the Mudball holder is standing
//   guard  4. the holder has an active MudballReactiveAbAttr
//   effect 5. unshift a MovePhase of `scriptedPokemonMove(MUD_BOMB, 20)` from the holder at the entering foe, MoveUseMode.INDIRECT
// Class edit (a pure move of code, defaults unchanged): the move and the power were literals in the function; they are now constructor
// arguments 0 and 1 of the attr and the function reads them from the attr it finds. The Flying test moved into the class as `gate`
// (`canAnswer`, gatedCanApply) with a `gateOverride`; the three "standing / has the attr" clauses stay in the function. The pure tests
// (`isFainted`, `isOfType`) are asked in a slightly different order and count; none has a side effect or draws a random number.
import { MudballReactiveAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { moveNameCodec } from "#data/elite-redux/ability-studio/decl/B14/chunk4-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MudballReactiveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.foe-enters",
  label: "Answer a foe entering the field with a free move",
  summary: params =>
    `When a foe enters the field, I use ${params.moveId} on it at ${params.power} power for free. Add a condition to limit it. Example: a Flying foe enters and a 20 power Mud Bomb hits it.`,
  synonyms: [
    "mudball",
    "welcome attack",
    "hit the foe that switches in",
    "switch in punishment",
    "entry hazard attack",
    "free move when a foe enters",
    "anti flying",
    "mud bomb",
  ],
  examples: ["When a Flying foe enters, I hit it with a 20 power Mud Bomb"],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      path: "moveId",
      control: "text",
      label: "Move to use (its name, for example Mud Bomb)",
      editable: true,
      default: "Mud bomb",
      codec: moveNameCodec,
      gateIndependent: true,
    },
    {
      id: "power",
      ctorIndex: 1,
      path: "power",
      control: "number",
      min: 1,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of the free move",
      editable: true,
      default: 20,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [mon.has-type { who: other, type: FLYING }]. Removable: without it every foe that enters is answered.
    { slot: "gate", ctx: "params", lib: "mon.has-type", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only while the foe that entered is still standing",
    "Only while I am still standing",
    "The free move is used on the foe that entered, as an indirect move (it cannot set off another free move)",
  ],
  effect: { id: "effect.scripted-move", params: ["moveId", "power"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The moment (a foe entering) has no L2 template, and the class is not dispatched through applyAbAttrs; test/tests/elite-redux/decomp/B14/chunk4.test.ts drives erMudballOnOpponentSummon with a real Flying and a real non-Flying foe and counts the MovePhase it queues.",
  probes: [{ name: "a foe enters the field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B. Users (1): Mudball (6097) attr 1 (attr 0 is a PostSummonScriptedMoveAbAttr of Mud Sport on entry, another batch). The effect is the library scripted-move (the same indirect MovePhase), with the move and power as typed settings. The Flying test is the only condition, bound by hand (bindings in pending/bindings.chunk4.pending.ts, mon.has-type other FLYING). The moment is new: 'when a foe enters the field' provides the holder and the entering foe (as `other`); request R-B14-4.3. Oddities, not fixed: (1) PostSummonPhase calls the function for every Pokemon that enters, on either side and for both of a double's entries, so two foes entering together are answered one by one.",
});
