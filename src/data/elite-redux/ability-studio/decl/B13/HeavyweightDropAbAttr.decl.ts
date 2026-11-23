/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Heavyweight, part 2 of 2 (Tier B, event-effect). "The first Heavy Slam, Heat Crash or punch that hurts the target each turn lowers its Defense by 1."
//
// Source: abilities/newcomer-signature-mechanics.ts, HeavyweightDropAbAttr (PostAttackAbAttr; no constructor of its own
// before this chunk, so the base class's two arguments (attackCondition, showAbility) were its constructor; the stat
// and the stage change are now trailing arguments 2 and 3, defaults = the old literals Defense and -1).
//   canApply, ORIGINAL order, now guards && gate && residual (all clauses pure, no RNG):
//     guards    1. super.canApply: the base attack condition, by default `move.category !== STATUS`
//                  -> constructor slot "ctor:0" (library atom move.damaging)
//               2. params.damage > 0                          (no library atom yet: requested R-B13-3)
//     gate      3. move is Heavy Slam, Heat Crash or has PUNCHING_MOVE -> library atoms (as the power attr)
//     residual  4. HEAVYWEIGHT_DROP_TURN[holder] !== "wave:turn"        (once per turn: private memory)
//   apply: remember this turn (even when simulated); not simulated: queue a dropStages change of dropStat on the FOE
//          (not the holder).
import { HeavyweightDropAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { Stat } from "#enums/stat";

// Player-facing stat names (never the enum constants).
const STAT_CHOICES: Record<string, Stat> = {
  Attack: Stat.ATK,
  Defense: Stat.DEF,
  "Sp. Atk": Stat.SPATK,
  "Sp. Def": Stat.SPDEF,
  Speed: Stat.SPD,
};

export default defineDecl(HeavyweightDropAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Lower the target's stat after a heavy or punching hit",
  summary: params =>
    `After my Heavy Slam, Heat Crash or punching move damages the target, its ${params.stat} changes by ${params.stages} stage. Works once per turn.`,
  synonyms: [
    "armor break",
    "lower defense on punch",
    "crush defense",
    "weight slam debuff",
    "heavyweight",
    "once a turn drop",
  ],
  examples: ["My first punch each turn lowers the target's Defense by 1"],
  params: [
    // Constructor arguments 0 (attack condition) and 1 (show ability) are the base class's: 0 is the ctor:0 condition
    // slot below, 1 stays undefined for every user (base default).
    {
      id: "stat",
      ctorIndex: 2,
      path: "dropStat",
      control: "select",
      label: "Stat that is changed on the target",
      editable: true,
      gateIndependent: true,
      default: "Defense",
      options: Object.keys(STAT_CHOICES),
      codec: {
        toCtor: value => {
          const resolved = STAT_CHOICES[String(value)];
          if (resolved === undefined) {
            throw new Error(`"${String(value)}" is not a stat that can be changed`);
          }
          return resolved;
        },
        fromInstance: raw => Object.keys(STAT_CHOICES).find(name => STAT_CHOICES[name] === raw),
      },
    },
    {
      id: "stages",
      ctorIndex: 3,
      path: "dropStages",
      control: "number",
      label: "Stage change (negative lowers, -6 to 6)",
      editable: true,
      gateIndependent: true,
      default: -1,
      min: -6,
      max: 6,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // Clause 1: the base class's attack condition (a real constructor argument). Every user takes the default.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // Clause 3: Heavy Slam, Heat Crash or a punching move (library atoms, see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really deal damage (checked inside the class until the librarian adds that condition)",
    "It works only once per turn for each Pokemon (a private memory inside the class)",
    "The change always goes to the target I hit, never to me (fixed in the class)",
  ],
  effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // A damaging move and a status-free hit decide the first clause; the grid cannot make a punch or Heavy Slam.
      name: "damaging hit and the foe's HP",
      axes: { foeMove: ["TACKLE"], foeHp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Fully decomposed with existing blocks: trigger after my hit, condition atoms for the move kind, effect.stat-stage (stat and stages are params). The stat change always goes to the TARGET (foe), which is the meaning of the ability and is not a param: a rebuilt attr is the class itself built from its constructor arguments (the decl lists no effect target, so no block can retarget it to the holder); a generic effect.stat-stage block would show a Who choice, but this declaration pins it to the foe and the text says so. Users: Heavyweight (5982, attr 1). The 'damage > 0' guard and the once-per-turn residual stay in the class (requests R-B13-3 and R-B13-17: a condition that reads the class's own once-per-turn memory; the library once-per atom keeps ITS OWN memory, so it is not interchangeable). Review of the numbers: the stat (Defense) and the change (-1) were literals, now trailing constructor arguments 2 and 3 with the old values as defaults. ODDITIES (not fixed): (1) apply stores the turn BEFORE its simulated check, so a simulated call spends the once-per-turn memory; no engine path simulates PostAttack today. (2) The memory key is wave and turn number only, shared by all targets, so a spread move that hits two foes lowers only the first. (3) The ability text says 'weight-based and punching moves'; Low Kick and Grass Knot are not included.",
});
