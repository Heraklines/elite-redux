/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. "Moves that depend on the weather do nothing to me" (Weather Control, Neutralizing Fog).
//
// Source: src/data/elite-redux/archetypes/weather-based-move-block.ts, WeatherBasedMoveBlockAbAttr (extends MoveImmunityAbAttr).
// Constructor: no arguments; it hands the parent the closure `blocksWeatherMove(pokemon, attacker, move)`, and the parent's `super(true)` shows the banner.
// Dispatched while the game checks whether a move can hit (applyAbAttrs("MoveImmunityAbAttr")). Clauses, in the original order (Tier B):
//   canApply 1  `!cancelled.value`: no other ability has already blocked this move (the parent's)           GUARD-like (class method `guards`)
//   canApply 2  the attacker is not the holder (`pokemon !== opponent`, first half of the old closure)       GUARD-like (same method)
//   canApply 3  the move is one of the 15 weather-based moves (second half of the old closure)             GATE (replaceable): `WEATHER_BASED_MOVES.has(move.id)`
//   apply       `cancelled = true` (the parent's)                                                            EFFECT (calc)
//   message     the parent's "moveImmunity" trigger message (unchanged)
// The 15 moves: Weather Ball, Solar Beam, Solar Blade, Hurricane, Thunder, Blizzard, Silver Wind, Wildbolt Storm, Bleakwind Storm, Sandsear Storm,
// Springtide Storm, Sheer Cold, Fire Pledge, Water Pledge and Grass Pledge. No random draw, no state, no `simulated` test.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { WeatherBasedMoveBlockAbAttr } from "#data/elite-redux/archetypes/weather-based-move-block";

export default defineDecl(WeatherBasedMoveBlockAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Be immune to moves that depend on the weather",
  summary: () =>
    "Weather Ball, Solar Beam, Hurricane, Thunder, Blizzard and the other weather-based moves of foes do nothing to me. Example: Weather Control.",
  synonyms: [
    "weather control",
    "neutralizing fog",
    "immune to weather moves",
    "block solar beam and thunder",
    "no weather ball",
    "weather move immunity",
  ],
  examples: [
    "Foes' weather-based moves such as Thunder and Solar Beam do nothing to me, like Weather Control",
    "Block Hurricane and Blizzard",
  ],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the list of 15 weather-based moves is fixed in the class (it is a curated list of the dex). Staff reach the same behaviour, or another list, with a composed rule (calc.move-immunity + any of 'the move is X' + block it); the 15 moves are what the gate binding spells out.",
  conditions: [
    // The gate: the move is one of the 15 weather-based moves, an `any` group of move-is atoms.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A Pokemon never blocks its own move",
    "Does nothing when another ability has already blocked the move",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "weather moves and other moves aimed at the holder",
      axes: { foeMove: ["THUNDER", "TACKLE", "SOLAR_BEAM", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 2 attrs, both gates bound to an `any` of 15 move-is atoms: Weather Control (5092 attr 0) and Neutralizing Fog (5540 attr 1; also added by the ability-upgrade patch of ability 839 in init-elite-redux-ability-upgrades.ts). The class has no constructor argument, so there is nothing to bind but the gate. The old canApply (the parent's `!cancelled.value && immuneCondition(...)`) is split in that order into `guards` (not already cancelled, and the attacker is not the holder) and `gate` (the move list); the constructor still hands the parent the same closure through the shared helper, so the parent's accessor behaves as before. The list is a curated copy of the dex (the comment in the class says the ER WEATHER_BASED flag is not used on purpose), so the 15 moves in the binding are the whole list; a new weather move needs a new entry in the class. Oddities, not fixed: (a) the self-targeting weather moves (Morning Sun, Synthesis, Moonlight, Shore Up, Aurora Veil) are not on the list on purpose, as the class comment says; (b) the list ignores the ER weather-based move flag: five moves carry the flag but are not listed, so they are not blocked (Boiling Flame, Depletion Beam, Eerie Spell, Ominous Wind and Revival Blessing; the test prints them); (c) the block is a plain cancel, so no type-matchup text is used; (d) the ability banner is shown.",
});
