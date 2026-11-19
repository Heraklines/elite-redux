/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / package (Tier C).
//
// Read by hand from archetypes/on-faint-effect.ts. PostFaint hook (WHEN "when I faint"), constructor `{ effect }` where
// `effect` is a discriminated union of seven payloads; `super(true)` so the ability banner shows. The constructor validates the
// payload (no NONE weather, a damage fraction in (0, 1], layers a positive integer, turns a non-negative integer, at least one
// non-zero stat change). canApply and apply both switch on `effect.kind`:
//   set-weather            canApply arena.canSetWeather(weather)            apply trySetWeather(weather, holder)
//   set-terrain            canApply arena.canSetTerrain(terrain)            apply trySetTerrain(terrain, false, holder)
//   attacker-damage-flat   canApply attacker AND move known AND the attacker does not block indirect damage
//                          (applyAbAttrs "BlockNonDirectDamageAbAttr", Magic Guard)    apply damageAndUpdate(toDmgValue(max * fraction), INDIRECT)
//   set-hazard             canApply true                                    apply addTag(hazard) `layers` times on the OTHER side
//   attacker-battler-tag   canApply attacker alive AND not of an excluded type   apply attacker.addTag(tag, turns, undefined, holder.id)
//   attacker-stat-change   canApply attacker alive                          apply one StatStageChangePhase per stat on the attacker,
//                          then per living ally of the attacker
//   attacker-pp-drain      canApply attacker alive, move known, move is damaging, the move is in the attacker's moveset with PP left
//                          apply set ppUsed to the full PP, a move-used event and the message
// `apply` returns at once when simulated. No random draw anywhere.
//
// Why a package: the seven payloads are one class with kind-specific rules, and the library cannot yet express "the Pokemon that
// knocked me out" as a target for most of them (requests R-B10-07 to R-B10-10 in requests/B10.md). The effect is edited as ONE
// sentence that starts with what happens (see b10-codecs.ts): a declared param fills one slot and the class reads one object.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { onFaintEffectCodec } from "./b10-codecs";

export default defineDecl(OnFaintEffectAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.faint",
  label: "Do something when I faint",
  summary: params => `When I faint: ${params.effect}`,
  synonyms: [
    "last words",
    "aftermath",
    "revenge when knocked out",
    "curse the attacker",
    "guilt trip",
    "ill will",
    "haunted spirit",
    "vengeful spirit",
  ],
  examples: [
    "When I am knocked out, curse the attacker unless it is a Ghost type",
    "Set the weather: Sandstorm",
    "Hurt the Pokemon that knocked me out: 25% of its max HP",
    "Change the stats of the Pokemon that knocked me out: Attack -2, Sp. Atk -2; its allies: Attack -1, Sp. Atk -1",
    "Put a lasting effect on the Pokemon that knocked me out: Cursed, not against Ghost",
    "Set a hazard on the foe's side: Stealth rock x1",
    "Drain the PP of the move that knocked me out",
  ],
  params: [
    {
      id: "effect",
      ctorIndex: 0,
      ctorOption: "effect",
      path: "effect",
      control: "text",
      label: "What happens when I faint (one sentence, written like the examples)",
      editable: true,
      default: "Set the weather: Sandstorm",
      codec: onFaintEffectCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Setting the weather or terrain only works if the field accepts it (a stronger weather cannot be replaced)",
    "Hurting the attacker needs a known attacker and move, and does nothing to a Pokemon that blocks indirect damage (like Magic Guard)",
    "Anything aimed at the attacker needs a living attacker; a lasting effect skips the types you list",
    "Draining PP needs a damaging move that is in the attacker's moveset with PP left",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: ["effect"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe knocks me out", axes: {} }],
  l2StaticReason:
    "The L2 faint scenario never makes the engine evaluate a PostFaintAbAttr of the holder (the reach ratchet lists event.faint as unreached), so the original cannot be shown evaluating the attr. The B10 test (test/tests/elite-redux/decomp/B10/on-faint-effect.test.ts) drives canApply and apply of the original and the rebuild for every live user and every payload kind.",
  status: "decomposed",
  notes:
    "Package, justified (see the header). Users (5 attrs): Haunted Spirit (cursed attacker, not against Ghost), Vengeful Spirit (the same), Guilt Trip (attacker Attack -2 and Sp. Atk -2, its allies -1 each), Ill Will (drain PP) and Cursed Spirit (inherits the Haunted Spirit part); nothing to bind. The text codec round-trips every live payload (checked by the B10 test, test/tests/elite-redux/decomp/B10/on-faint-effect.test.ts). set-weather, set-terrain, set-hazard are not used by a live ability today but are declared and covered by the codec test. Oddities, not fixed: a lasting effect written without 'for N turns' lasts until lifted (the class treats a missing number as 0); the hazard payload is added to the side opposite the fainting Pokemon even when the attacker is on the same side as the fainter.",
});
