/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Eclipse Wing, part 3 of 3 (Tier C, engine-query). "Once per wave, a lethal hit from full HP leaves me at 1 HP and I strike back."
//
// Source: abilities/newcomer-signature-mechanics.ts, EclipseWingMarkerAbAttr (extends AbAttr directly; apply is empty).
// The class is a MARKER that the engine looks for by name: tryEclipseWing(defender, source) checks hasAttr(defender,
// "EclipseWingMarkerAbAttr"), and Pokemon.damageAndUpdate (field/pokemon.ts:6660) calls it for a direct, lethal hit. The rule, in order:
//   a source exists, the defender is at FULL HP, its max HP is above 1, it carries this marker, and it did not already use it this wave
//   -> remember the wave, remember the attacker as my counter target, queue the two messages, and queue a counterPower (120) counterType (Dark) special
//      follow-up move aimed at the attacker (a scripted phase). The hit itself is stopped at 1 HP by damageAndUpdate.
// No RNG. Constructor arguments: counterPower (default 120) and counterType (default Dark), read by tryEclipseWing from the defender's marker attr. The faint at the end of the turn is EclipseWingTurnEndAbAttr (chunk 4); the power boost is
// EclipseWingPowerAbAttr (this chunk).
import { EclipseWingMarkerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PokemonType } from "#enums/pokemon-type";

// Player-facing type names (never the enum constants).
const TYPE_CHOICES: Record<string, PokemonType> = {
  Normal: PokemonType.NORMAL,
  Fighting: PokemonType.FIGHTING,
  Flying: PokemonType.FLYING,
  Poison: PokemonType.POISON,
  Ground: PokemonType.GROUND,
  Rock: PokemonType.ROCK,
  Bug: PokemonType.BUG,
  Ghost: PokemonType.GHOST,
  Steel: PokemonType.STEEL,
  Fire: PokemonType.FIRE,
  Water: PokemonType.WATER,
  Grass: PokemonType.GRASS,
  Electric: PokemonType.ELECTRIC,
  Psychic: PokemonType.PSYCHIC,
  Ice: PokemonType.ICE,
  Dragon: PokemonType.DRAGON,
  Dark: PokemonType.DARK,
  Fairy: PokemonType.FAIRY,
};

const typeCodec = {
  toCtor: (value: unknown): PokemonType => {
    const resolved = TYPE_CHOICES[String(value)];
    if (resolved === undefined) {
      throw new Error(`"${String(value)}" is not a known move type`);
    }
    return resolved;
  },
  fromInstance: (raw: unknown): string | undefined =>
    Object.keys(TYPE_CHOICES).find(name => TYPE_CHOICES[name] === raw),
};

export default defineDecl(EclipseWingMarkerAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Survive a knock-out from full HP once a wave and strike back",
  summary: params =>
    `While I have this, once per wave a hit that would knock me out from full HP leaves me at 1 HP and I answer with a ${params.counterPower} power ${params.counterType} special move against the attacker.`,
  synonyms: [
    "survive at 1 hp",
    "endure from full health",
    "focus sash",
    "counter attack when nearly knocked out",
    "revenge strike",
    "eclipse wing",
  ],
  examples: ["Once per wave I survive a knock-out from full HP and hit back with a Dark move, like Eclipse Wing"],
  params: [
    {
      id: "counterPower",
      ctorIndex: 0,
      path: "counterPower",
      control: "number",
      label: "Power of my counter-strike (power points)",
      editable: true,
      gateIndependent: true,
      default: 120,
      min: 1,
      max: 250,
      step: 5,
      integer: true,
    },
    {
      id: "counterType",
      ctorIndex: 1,
      path: "counterType",
      control: "select",
      label: "Type of my counter-strike",
      editable: true,
      gateIndependent: true,
      default: "Dark",
      options: Object.keys(TYPE_CHOICES),
      codec: typeCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only a direct hit that would knock me out, only while I am at full HP, and only if my max HP is above 1",
    "Only once per wave",
    "The counter is a special move that always hits",
    "At the end of the turn I may faint if my counter knocked its target out (the turn-end part of this ability)",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The flag is consulted by name inside the damage code, which is not a dispatched moment; B13/chunk5.test.ts proves the rule by calling tryEclipseWing with a full-HP holder.",
  probes: [{ name: "a damaging hit that does not knock me out", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "ENGINE-QUERY, justified: the class is a flag; the rule (survive a lethal hit from full HP once per wave, then counter-strike) lives in tryEclipseWing, called by name from Pokemon.damageAndUpdate (field/pokemon.ts:6660), so a rebuilt attr cannot carry it. The trigger (a moment when I take a lethal direct hit) and its conditions (full HP, not used this wave) are not dispatched, so no WHEN or IF block can wrap them: requested as R-B13-53 (a dispatched WHEN 'Before a direct hit would knock me out' with the slots holder, other, damage and a way to leave me at 1 HP, plus effect 'Strike back with a scripted move'). The dispatch key list of while.active needs this class (R-B13-19; the same minimal flag-key entry the earlier chunks made was added). The 120 power and the Dark type were literals of tryEclipseWing; they are now constructor arguments 0 and 1 of this class (defaults 120 and Dark) and tryEclipseWing reads them from the defender's marker attr (it already finds the attr by name). The full-HP rule and the once-per-wave limit stay in the function. Users: Eclipse Wing (5971, attr 2). ODDITIES (not fixed): (1) the once-per-wave memory is a WeakMap entry keyed by the Pokemon and holding the wave index, so it resets on the next wave and is NOT reset by switching out and in within a wave; (2) the caller tests 'direct hit that would knock me out' first, and Life Preserver (a different ability) is tried before this one, so a hit it already clamped never reaches this rule.",
});
