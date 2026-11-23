/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Spirit Punch (Tier B, package effect). "My punching move echoes as a second, weaker Ghost hit."
//
// Source: abilities/newcomer-signature-mechanics.ts, SpiritPunchAbAttr (PostAttackAbAttr; the base class's two arguments
// (attackCondition, showAbility) are constructor arguments 0 and 1, the echo numbers and types are now 2 to 5).
//   canApply, ORIGINAL order, now guards && gate && residual (all clauses pure, no RNG):
//     guards    1. super.canApply: the base attack condition, by default `move.category !== STATUS`
//                  -> constructor slot "ctor:0" (library atom move.damaging)
//               2. params.damage > 0                                (no library atom yet: R-B13-3)
//               3. params.hitResult < HitResult.NO_EFFECT           (no library atom yet: R-B13-4)
//     gate      4. move.hasFlag(PUNCHING_MOVE)                      -> library atom move.flag PUNCHING_MOVE
//     residual  5. holder.turnData.hitCount <= 1                    (a single-hit move: R-B13-36)
//               6. !isSignatureFollowup(move)                       (the move is not itself an echo or counter: R-B13-37)
//               7. my last move record exists                       (feasibility)
//               8. SPIRIT_PUNCH_RECORD[holder] !== that record      (once per move I used: R-B13-5)
//   apply: SPIRIT_PUNCH_RECORD[holder] = my last move record      (even when simulated)
//          simulated, or the foe fainted: stop
//          multiplier = (I have the bonus type ? bonusEchoPercent : echoPercent) / 100   (30 and 50 reproduce 0.3 and 0.5)
//          message "<me>'s Spirit Punch echoed!", then the scripted follow-up phase: the SAME move id, power
//          move.power * multiplier (at least 1), echoType, the move's own category, always hits, ignores the target's
//          Defense boosts, cannot crit and cannot trigger on-KO effects.
import { SpiritPunchAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
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
      throw new Error(`"${String(value)}" is not a known type`);
    }
    return resolved;
  },
  fromInstance: (raw: unknown): string | undefined =>
    Object.keys(TYPE_CHOICES).find(name => TYPE_CHOICES[name] === raw),
};

export default defineDecl(SpiritPunchAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Echo my punching move as a second weaker hit",
  summary: params =>
    `After my punching move hurts the target, the same move hits again as a ${params.echoType}-type echo at ${params.echoPercent}% power (${params.bonusEchoPercent}% if I am ${params.bonusType} type). It ignores the target's Defense boosts.`,
  synonyms: [
    "double punch",
    "second hit",
    "echo hit",
    "ghost echo",
    "spirit punch",
    "ghostly follow up",
    "extra punch",
  ],
  examples: ["My punches hit a second time as a Ghost echo at 30% power"],
  params: [
    // Constructor arguments 0 (attack condition) and 1 (show ability) are the base class's: 0 is the ctor:0 condition
    // slot below, 1 stays undefined for every user (base default).
    {
      id: "echoPercent",
      ctorIndex: 2,
      path: "echoPercent",
      control: "number",
      label: "Echo power (percent of the move's power)",
      editable: true,
      gateIndependent: true,
      default: 30,
      min: 1,
      max: 200,
      step: 5,
    },
    {
      id: "bonusEchoPercent",
      ctorIndex: 3,
      path: "bonusEchoPercent",
      control: "number",
      label: "Echo power when I have the bonus type (percent)",
      editable: true,
      gateIndependent: true,
      default: 50,
      min: 1,
      max: 200,
      step: 5,
    },
    {
      id: "echoType",
      ctorIndex: 4,
      path: "echoType",
      control: "select",
      label: "Type of the echo",
      editable: true,
      gateIndependent: true,
      default: "Ghost",
      options: Object.keys(TYPE_CHOICES),
      codec: typeCodec,
    },
    {
      id: "bonusType",
      ctorIndex: 5,
      path: "bonusType",
      control: "select",
      label: "My type that makes the echo stronger",
      editable: true,
      gateIndependent: true,
      default: "Ghost",
      options: Object.keys(TYPE_CHOICES),
      codec: typeCodec,
    },
  ],
  conditions: [
    // Clause 1: the base class's attack condition (a real constructor argument). Every user takes the default.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // Clause 4: the move is a punching move (library atom, see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really deal damage and must not be blocked or immune (checked inside the class until the librarian adds those conditions, R-B13-3 and R-B13-4)",
    "The move must be a single hit, not a multi-hit move (R-B13-36)",
    "An echo never starts another echo: the move must not be one of the ability's own follow-up moves (R-B13-37)",
    "Once per move I used (a private record inside the class, R-B13-5)",
    "The echo does not happen if the target has already fainted",
    "The echo always hits, ignores the target's Defense boosts, cannot crit and triggers no on-KO effects (fixed in the class)",
  ],
  effect: { id: "effect.package", params: ["echoPercent", "bonusEchoPercent", "echoType", "bonusType"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // A plain damaging hit shows the gate (not a punch) staying closed; the punch itself is driven by B13/spirit-punch.test.ts.
      name: "damaging hit and the foe's HP",
      axes: { foeMove: ["TACKLE"], foeHp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only. The trigger (after my hit) and the conditions that can be expressed are separate and bound to library atoms: the attack condition (ctor:0, move.damaging) and the punching rule (gate, move.flag). Why the effect cannot be split with today's blocks: it queues a SCRIPTED follow-up of the SAME move I just used at a share of ITS power (and the move's own category), with flags (always hits, ignores defence boosts, cannot crit, suppresses on-KO) held in module WeakSets; effect.scripted-move takes a fixed move id and a fixed power, so it cannot echo 'the move I used'. Requested: R-B13-40 `effect.echo-move` (echo the move I used at {percent}% power as a {type} hit, with the four fixed flags). Several conditions stay inside the class as guards/residual and are listed as 'also requires' with requests: damage dealt (R-B13-3), hit not blocked (R-B13-4), once per move (R-B13-5), a single-hit move (R-B13-36) and not-one-of-my-own-follow-ups (R-B13-37, a correctness rule that should become a guard). Review of the numbers: the 30% / 50% powers and the two types were literals; they are now trailing constructor arguments 2 to 5 (defaults reproduce the old values: 30/100 and 50/100 are the very doubles 0.3 and 0.5). Users: Spirit Punch (5983, attr 0). ODDITIES (not fixed): (1) apply stores the move record BEFORE its simulated and fainted-target checks, so a simulated call or a KO still spends the once-per-move memory; (2) a move with variable power (power -1) or 0 echoes at power max(1, floor(...)) because the helper clamps it; (3) the 'cannot crit' and 'no on-KO effects' of the ability text are enforced by the scripted move outside this class.",
});
