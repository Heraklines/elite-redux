/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 4 / calc modifier (AI only), Tier A. PARKED: status legacy-closure-pending-request.
//
// Not named `*.decl.ts`, so the registry glob does not pick it up. Reasons (requests/B07.md):
//   R-B07-15  the WHEN for the AI moveset moment does not exist (the dispatch key AiMovegenMoveStatsAbAttr is unexposed), the same blocker as
//             the parent class AiMovegenMoveStatsAbAttr (see its parked declaration);
//   R-B07-16  the constructor arguments (`moveType`, `boostedMove`) are captured inside the closure and never stored on the instance, so the
//             harness cannot read them back from a live attr (L0: "param has no path"). The request asks for two stored fields.
// It has no binding of its own: the closure is built inside the constructor (not an argument), see notes.
//
// To finish: after both requests are done, set `when` to the final id, rename this file to SummonTerrainAiMovegenMoveStatsAbAttr.decl.ts,
// run L0 / L1 / L2.
//
// What the class is (read from ab-attrs.ts):
//   constructor(moveType, boostedMove?)  builds the closure and passes it to AiMovegenMoveStatsAbAttr (showAbility false):
//     if (abilityQuery(pokemon, LEVITATE_FLOAT) || pokemon.isOfType(FLYING)) return;      FEASIBILITY-like rule: the terrain does not help
//                                                                                          an ungrounded holder (kept as a condition below:
//                                                                                          a staff member may want a terrain that helps fliers)
//     if (move.type === moveType) powerMult.value *= 1.3;                                  the type boost (the 1.3 is a literal)
//     if (boostedMove && move.id === boostedMove[0]) powerMult.value *= boostedMove[1];    the signature move's own boost
//   canApply  (inherited) `globalScene.movesetGenInProgress`: dead code in a real battle.
// The same dispatch site and frame as AiMovegenMoveStatsAbAttr (Move.effectivePowerAbilityCheck). No random draw, no state.
import { SummonTerrainAiMovegenMoveStatsAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(SummonTerrainAiMovegenMoveStatsAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  // PLACEHOLDER id: the WHEN of request R-B07-15 ("While the game builds an enemy's moveset").
  when: "calc.ai-moveset-stats",
  label: "Computer opponents rate my terrain moves higher",
  summary: params =>
    `Only when the game picks moves for a computer-controlled Pokemon: it rates ${params.moveType} moves as 1.3 times as strong (and one signature move extra), unless I float or am a Flying type.`,
  synonyms: [
    "terrain surge ai",
    "enemy ai terrain",
    "ai move rating",
    "electric surge",
    "grassy surge",
    "psychic surge",
    "terrain boost",
  ],
  examples: [
    "The AI treats Electric moves as 1.3 times stronger and Rising Voltage as twice as strong, like Electric Surge",
  ],
  params: [
    {
      id: "moveType",
      ctorIndex: 0,
      // Needs R-B07-16: the constructor must keep the argument as a public field with this name.
      path: "moveType",
      control: "select",
      label: "Type of moves the computer opponent rates higher",
      editable: true,
      default: "ELECTRIC",
      options: enumOptions(PokemonType),
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "boostedMove",
      ctorIndex: 1,
      // Needs R-B07-16: the constructor must keep the pair as a public field with this name (undefined when there is none).
      path: "boostedMove",
      control: "text",
      label: "Signature move and its extra multiplier, like Rising Voltage,2 (leave empty for none)",
      editable: true,
      default: "",
      codec: {
        toCtor: value => {
          const text = String(value).trim();
          if (text.length === 0) {
            return;
          }
          const [name, factor] = text.split(",").map(part => part.trim());
          // Staff type "Rising Voltage,2"; the enum member is RISING_VOLTAGE.
          const id = (MoveId as unknown as Record<string, number | string>)[
            (name ?? "").toUpperCase().replace(/[ -]+/g, "_")
          ];
          const multiplier = Number(factor);
          if (typeof id !== "number" || !Number.isFinite(multiplier)) {
            throw new Error(`"${text}" is not a known move and multiplier (use for example Rising Voltage,2)`);
          }
          return [id, multiplier];
        },
        fromInstance: raw => {
          if (raw === undefined || raw === null) {
            return "";
          }
          if (!Array.isArray(raw) || typeof raw[0] !== "number") {
            return;
          }
          const name = Object.keys(MoveId).find(key => (MoveId as unknown as Record<string, unknown>)[key] === raw[0]);
          // The text staff see: RISING_VOLTAGE becomes "Rising Voltage".
          const readable = name
            ?.toLowerCase()
            .split("_")
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
          return readable === undefined ? undefined : `${readable},${String(raw[1])}`;
        },
      },
    },
  ],
  // The closure is built INSIDE the constructor from the two settings (it is not a constructor argument), so there is no condition slot to
  // bind: the Flying/floating rule is the first feasibility line below, the type test and the signature move are the two settings.
  conditions: [],
  guards: [],
  feasibility: [
    "Only runs while the game is building the moveset of a computer-controlled Pokemon, never during a real battle",
    "Does nothing for a Pokemon that floats or is a Flying type: it cannot use the terrain",
  ],
  effect: { id: "effect.package", params: ["moveType", "boostedMove"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The moment exists only while the enemy moveset generator runs (no battle turn reaches it); the direct test test/tests/elite-redux/decomp/B07/flag-sites-4.test.ts drives Move.calculateEffectivePower once the declaration is live.",
  probes: [
    { name: "a move of the boosted type and the signature move are rated while the moveset generator runs", axes: {} },
  ],
  status: "decomposed",
  notes:
    "Tier A, status legacy-closure-pending-request (R-B07-15 and R-B07-16). Effect package, reason: no library effect rates a move for the AI (R-B07-15); the two typed settings are exactly the numbers and choices the closure uses (the type, the signature move and its multiplier; the 1.3 is a literal in the class). Users (live dump): Electric Surge (226, attr 2: ELECTRIC, [RISING_VOLTAGE, 2]), Psychic Surge (227, attr 2: PSYCHIC, [EXPANDING_FORCE, 1.5]), Grassy Surge (229, attr 2: GRASS, none) and the composed Psychic Supremacy (20000, attr 4, which includes Psychic Surge's attr and so shares its two arguments). Misty Surge uses the PARENT class with an inline closure, not this one (see AiMovegenMoveStatsAbAttr). ODDITY (not fixed): Grassy Surge has no signature move although Grassy Glide exists, which looks like an omission rather than a rule.",
});
