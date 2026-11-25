/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1, part 2 of 2 of Ballaster (Tier B, event-effect with two branches). "After a damaging hit I store a charge; on the next
// one (or at once for a Fire or Water hit) I use a move on the attacker."
//
// Source: fakemon-pitch-mechanics.ts, BallasterAbAttr (PostDefendAbAttr). canApply, original clause order, now
// `guards && gate` (every clause is pure; no random draw, no residual):
//   guards  1. damage > 0                          the hit really dealt damage
//           2. !pokemon.isFainted()                I have not fainted
//           3. !opponent.isFainted()               the attacker has not fainted
//   gate    4. move.category !== STATUS            a damaging move   -> library atom move.damaging
// apply (not simulated), the state machine on `summonData.erAbilityProvenance` (the marker "ballaster:1" is the charge):
//   hasCharge = marker present; immediate = the incoming move's type (after abilities) is one of `immediateTypes`
//   the marker is removed;
//   if !immediate && !hasCharge: store the marker again and stop          (branch "store a charge")
//   else: queue a free (INDIRECT) MovePhase of `retaliationMove` at `retaliationPower` on the attacker   (branch "use the move")
// So a Fire or Water hit retaliates at once even with no charge; any other damaging hit charges me first and the NEXT damaging
// hit (of any type) retaliates. Both outcomes clear the old charge first. BallasterResetAbAttr (part 1) clears it on entry.
//
// WHAT IS A CONDITION AND WHAT IS NOT: clause 4 (damaging move only) is the replaceable condition. Clauses 1 to 3 are guards.
// The charge memory and the "Fire or Water hits at once" test live in `apply`, not in canApply, so they are not IF blocks today;
// they are typed settings (`immediateTypes`) plus the written branches below. A rule that wants them as IF blocks needs the
// library requests R-B16-3 (a memory condition "I am charged" and the effect "charge myself") in requests/B16.md.
import { BallasterAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(BallasterAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Hit back with a move after taking damaging hits",
  summary: params =>
    `A damaging hit charges me up. After the next one (at once for a ${params.immediateTypes} hit) I use ${params.moveId} with ${params.power} power on the attacker.`,
  synonyms: [
    "ballaster",
    "counter attack",
    "retaliate",
    "revenge move",
    "steam eruption",
    "hit back after two hits",
    "charge up then strike",
  ],
  examples: [
    "After two damaging hits I strike back with an 80 power Steam Eruption; Fire and Water hits trigger it at once",
  ],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      path: "retaliationMove",
      control: "text",
      label: "Move used in return (type its name, for example Steam Eruption)",
      editable: true,
      gateIndependent: true,
      default: "STEAM_ERUPTION",
      codec: enumCodec(MoveId, "move"),
    },
    {
      id: "power",
      ctorIndex: 1,
      path: "retaliationPower",
      control: "number",
      min: 1,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of that move",
      editable: true,
      gateIndependent: true,
      default: 80,
    },
    {
      id: "immediateTypes",
      ctorIndex: 2,
      path: "immediateTypes",
      control: "text",
      label: "Hit types that make me use the move at once, with no charge needed (comma separated)",
      editable: true,
      gateIndependent: true,
      default: "FIRE,WATER",
      options: TYPE_OPTIONS,
      codec: enumListCodec(PokemonType, "type"),
    },
  ],
  conditions: [
    // Clause 4: the move deals damage (move.category !== STATUS). Removable: "any hit I take, even a status move" is a valid design
    // (the guards still demand real damage, so a status move would still be filtered by clause 1).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "The hit must really have dealt damage (more than 0)",
    "The attacker must still be standing",
    "Nothing happens while the game only previews a hit",
    "I keep only one stored charge at a time, and it is cleared every time I enter the battle",
  ],
  branches: [
    {
      label: "Store a charge",
      conditions: [
        "the move is not one of the hit types that act at once (immediateTypes)",
        "I have no stored charge yet",
      ],
      effect: { id: "effect.arm-effect", params: [] },
    },
    {
      label: "Use the move on the attacker",
      conditions: [
        "the move is one of the hit types that act at once (immediateTypes), or I already have a stored charge",
      ],
      effect: { id: "effect.scripted-move", params: ["moveId", "power"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [
    {
      // The shared template's foe is a Magikarp that the retaliation (80 power) knocks out, which ends the battle before the next
      // turn the harness waits for. Solar Beam charges on turn 1 and hits on turn 2, so the shared twin sees ONE damaging hit: the
      // charge path. The retaliation paths (second hit, Fire or Water hit at once) are twinned against a sturdy foe in
      // test/tests/elite-redux/decomp/B16/chunk1.test.ts.
      name: "one damaging Grass hit (stores a charge)",
      axes: { foeMove: ["SOLAR_BEAM"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B with two written branches. Trigger (after I am hit) and the damaging-move gate are real, swappable library blocks (gate bound to move.damaging for the one user). The three numbers/types of the effect (move, power, hit types that act at once) were literals; they are now trailing constructor arguments with the old values as defaults and are params. NOT split into IF blocks, for a written reason: the charge memory (a marker in summonData.erAbilityProvenance) and the Fire-or-Water test are read and written inside `apply`, and the library has no memory condition ('I am charged') nor an implemented 'charge myself' effect (effect.arm-effect is planned, not implemented); requested as R-B16-3. The guards (damage above 0, the attacker standing) are listed as feasibility until the librarian registers them (R-B16-4, R-B16-5); `not-fainted` is the registered guard for clause 2. Users: Ballaster (6006, attr 1; attr 0 is BallasterResetAbAttr). L2: see the probe comment (the shared twin reaches only the charge path; the retaliation is twinned in B16/chunk1.test.ts). Oddities, not fixed: (1) the type test uses `opponent.getMoveType(move)`, the attacker's type after ability changes, so Normalize-style abilities change which hits act at once; that is the intended reading. (2) hits needed = 2 is built into the marker, not a setting. (3) `apply` reads `simulated`, `canApply` does not, but canApply is pure.",
});
