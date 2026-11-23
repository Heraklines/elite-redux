/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. "Moves with one property do nothing to me or my ally" (Noise Cancel: sound moves).
//
// Source: src/data/elite-redux/archetypes/user-field-flag-immunity.ts, UserFieldFlagImmunityAbAttr (extends PreDefendAbAttr).
// Constructor: one options object `{ flag }`; `super(true)` shows the ability banner. This attr rides NO standard dispatch key: Pokemon.getMoveEffectiveness
// (field/pokemon.ts:4234) walks the target's whole side and calls `canApply` and `apply` on every attr of every Pokemon there
// whose constructor NAME is "UserFieldFlagImmunityAbAttr" (the checked Pokemon is that holder), so the holder's ally is protected too. Clauses, in the original order (Tier B):
//   canApply 1  the attacker is not the Pokemon being checked (`opponent !== pokemon`)                      GUARD-like (class method `guards`)
//   canApply 2  `move.doesFlagEffectApply({ flag, user: attacker, target: pokemon })`                       GATE (replaceable)
//   canApply 3  at least one standing Pokemon of the checked Pokemon's side is on the field                 RESIDUAL (feasibility kept in the class)
//   apply       `typeMultiplier = 0` (NOT `cancelled`: the move reads as a plain type immunity, "It doesn't affect ...")   EFFECT (calc)
// No random draw, no state, no `simulated` test: it is a hard immunity that must also hold in the real hit.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { UserFieldFlagImmunityAbAttr } from "#data/elite-redux/archetypes/user-field-flag-immunity";
import { flagInOptionsCodec } from "./b12-chunk4-codecs";

export default defineDecl(UserFieldFlagImmunityAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.incoming-move",
  label: "Protect my side from moves with one property",
  summary: params =>
    `Moves with the ${params.flag} property do nothing to me or my ally. Example: Sound, so Hyper Voice and Growl fail, like Noise Cancel.`,
  synonyms: [
    "soundproof for the team",
    "party soundproof",
    "block sound moves for my ally",
    "protect the party from a kind of move",
    "noise cancel",
    "immune to a move property",
  ],
  examples: [
    "Sound moves do nothing to me or my ally, like Noise Cancel",
    "Punching moves do nothing to me or my ally",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      path: "opts",
      ctorOption: "flag",
      control: "select",
      label: "Move property that is blocked (Sound, Punching, Biting...)",
      editable: true,
      default: "SOUND_BASED",
      options: MOVE_FLAG_OPTIONS,
      codec: flagInOptionsCodec,
    },
  ],
  // The setting is the same value as the gate's property: moving the setting moves the compiled gate's property.
  gateParams: [{ param: "flag", block: "move.flag", field: "flag" }],
  conditions: [
    // The gate: the move has the property (move.flag, which asks the game's own flag check, so abilities that ignore the property count).
    { slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A Pokemon never blocks its own move",
    "At least one standing Pokemon of the protected side must be on the field",
    "Status moves with the property are blocked too (there is no damaging-move test)",
  ],
  // Zeroing the matchup is "Block it"; the class sets the matchup to 0 (not the cancel flag), which is noted below.
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "sound moves and other moves aimed at the holder",
      axes: { foeMove: ["HYPER_VOICE", "TACKLE", "EMBER", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The class is never dispatched through a dispatch key: Pokemon.getMoveEffectiveness finds it by its class name on every Pokemon of the target's side, so the shared L2 cannot see it as an evaluated attr; B12's own test (B12/chunk4.test.ts) drives the original and the rebuild for every move of the game.",
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Noise Cancel (5302 attr 0, SOUND_BASED). The old canApply is split in its original order into `guards` (the attacker is not the checked Pokemon), `gate` (the property test) and `residual` (a standing Pokemon of the side is on the field). WHEN: the class has no own dispatch key, so it borrows the 'Before I take a hit' moment (the PreDefendAbAttr family, a legacy grouping), which gives the gate the attacker as the move user; a real WHEN is requested (R-B12-36). The ally protection is an engine loop that a rebuilt attr does not reproduce: Pokemon.getMoveEffectiveness asks every Pokemon of the target's side and finds the attr by its class name, so a holder protects its ally because the engine asks every Pokemon of the target's side for the attr and calls it with that Pokemon, the holder, as the checked one (an engine-query, noted here only). Oddities, not fixed: (a) clause 3 can only fail if the checked Pokemon itself is fainted or off the field, so it is practically always true; (b) there is no damaging-move test, so a status move with the property (Growl, Metal Sound) is blocked, which matches Soundproof; (c) `apply` zeroes the type matchup and does not set `cancelled`; (d) the engine loops over the whole side and calls apply for each attr that passes, then stops at the first zero.",
});
