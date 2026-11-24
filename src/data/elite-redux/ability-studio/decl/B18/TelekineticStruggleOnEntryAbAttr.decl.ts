/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { PokemonType } from "#enums/pokemon-type";
// Telekinetic (Tier C, package). "When I enter the battle, DO make the first living foe use only Struggle on its next turn".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PostSummonAbAttr (showAbility true). Dispatch:
// applyAbAttrs("PostSummonAbAttr", { pokemon, simulated }) when a Pokemon enters. There is no canApply of its own.
// apply, in the ORIGINAL order: return when simulated; opponent = the first NOT-fainted entry of pokemon.getOpponents(false)
// (`false` on purpose: the player's entry hook can run before the enemy lead finished its own summon); return (nothing
// happens) when there is none, or it is one of the immune types (Psychic or Dark by default), or `abilityQuery(opponent, HEAVY_METAL_WEIGHT)`, or it has the
// super heavy ability (ER 848); otherwise `opponent.tempSummonData.erTelekineticStruggle = true`. The readers are
// PokemonMove.isUsable (any move but Struggle is unusable, pokemon-move.ts:65), the AI adapter (combat-engine-adapter.ts:418)
// and the turn end, which clears the mark (turn-end-phase.ts:155).
import { TelekineticStruggleOnEntryAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";

export default defineDecl(TelekineticStruggleOnEntryAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Force the first foe to use only Struggle for one turn",
  summary: params =>
    `When I enter the battle, the first living foe can only use Struggle on its next turn. Foes of these types are not affected: ${params.immuneTypes}. Heavy Metal and super heavy foes are never affected.`,
  synonyms: [
    "telekinetic",
    "struggle lock",
    "lock the foe's moves",
    "no moves for a turn",
    "disable all moves",
    "one turn lockout",
  ],
  examples: ["The foe in front can only Struggle on its first turn, like Telekinetic"],
  params: [
    {
      id: "immuneTypes",
      ctorIndex: 0,
      path: "immuneTypes",
      control: "text",
      label: "Foe types that are not affected (comma separated)",
      editable: true,
      default: "PSYCHIC,DARK",
      options: enumOptions(PokemonType),
      codec: enumListCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "There must be a foe that is still standing",
    "The foe must not be one of the immune types (Psychic or Dark by default)",
    "The foe must not have Heavy Metal weight or the super heavy ability",
    "Nothing happens while the game is only previewing",
  ],
  effect: { id: "effect.package", params: ["immuneTypes"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry against the default foe", axes: {} }],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: 'the foe can only use Struggle next turn' sets a per-summon mark (summonData `erTelekineticStruggle`) that move selection and the AI read and the turn end clears; the library has no such effect (request R-B18-17). The immune types are a typed setting (the constructor takes them, default Psychic and Dark, added with this declaration without changing behaviour for the shipped ability). The foe checks (standing, not an immune type, no Heavy Metal weight, no super heavy ability) are listed as feasibility and STAY in apply, not in a gate, on purpose: they run AFTER the ability pop-up (showAbility is true), so moving them into canApply would hide the pop-up when the foe is immune, a visible behaviour change, and test/data/elite-redux/abilities/telekinetic-targeting.test.ts calls apply directly and expects them there. The trigger (event.on-entry) is a separate block; the foe checks would be atoms (mon.has-type with who: other, plus a weight and an ability check) if event.on-entry provided the first foe (request R-B18-17, slot `other`). Users: Telekinetic (5240, attr 0). ODDITIES (not fixed): (1) the first not-fainted opponent is chosen from getOpponents(false), which includes foes not yet fully on the field; (2) the mark is cleared at the end of the very next turn for every Pokemon, so if the foe switches in after the entry it is already clear; (3) the player's own entry hook can run before the enemy lead is out, then the lead is still targeted because onField=false.",
});
