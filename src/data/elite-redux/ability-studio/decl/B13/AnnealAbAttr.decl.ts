/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Anneal, part 2 of 2 (Tier B, package effect). "A resisted hit raises my Defense (physical) or Sp. Def, up to twice."
//
// Source: abilities/newcomer-signature-mechanics.ts, AnnealAbAttr (PostDefendAbAttr; the four numbers and stats are
// constructor arguments added in this chunk, defaults = the old literals). canApply, original order, now
// guards && gate && residual (every clause is pure):
//   guards    1. damage > 0                                         (the hit really hurt me)
//             2. hitResult < HitResult.NO_EFFECT                    (it was not blocked or immune)
//   gate      3. holder.getMoveEffectiveness(foe, move) <= 0.5      -> library atom move.effectiveness {lte 0.5}
//             4. holder.getMoveEffectiveness(foe, move) > 0         -> library atom move.effectiveness {gt 0}
//   residual  5. ANNEAL[holder].gained < maxTriggers                (private counter, no atom yet)
//             6. ANNEAL[holder].lastMoveRecord !== the foe's last move record   (a multi-hit move counts once)
//   apply     gained++ and remember the foe's move record (even when simulated); not simulated: queue a +stages
//             change on the holder for physicalStat (physical move) or specialStat (any other move).
// No RNG. The stat is picked by the move category, which no existing effect block can do: package.
import { AnnealAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
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

const statCodec = {
  toCtor: (value: unknown): Stat => {
    const resolved = STAT_CHOICES[String(value)];
    if (resolved === undefined) {
      throw new Error(`"${String(value)}" is not a stat that can be raised`);
    }
    return resolved;
  },
  fromInstance: (raw: unknown): string | undefined =>
    Object.keys(STAT_CHOICES).find(name => STAT_CHOICES[name] === raw),
};

export default defineDecl(AnnealAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-hit",
  label: "Raise a defence after a resisted hit, a few times per entry",
  summary: params =>
    `After a damaging hit that my typing resists (but does not block), I gain ${params.stages} stage${Number(params.stages) === 1 ? "" : "s"} of ${params.physicalStat} if it was physical, else ${params.specialStat}. At most ${params.maxTriggers} times per switch-in, once per foe move.`,
  synonyms: [
    "resist boost",
    "harden when resisted",
    "defense up after resisted hit",
    "temper",
    "anneal",
    "metal fatigue",
  ],
  examples: ["After a not very effective hit, raise Defense or Sp. Def by 1, up to 2 times per entry"],
  params: [
    {
      id: "maxTriggers",
      ctorIndex: 0,
      path: "maxTriggers",
      control: "number",
      label: "Most boosts per switch-in",
      editable: true,
      gateIndependent: true,
      default: 2,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "stages",
      control: "number",
      label: "Stages gained per boost (1-6)",
      editable: true,
      gateIndependent: true,
      default: 1,
      min: 1,
      max: 6,
      step: 1,
      integer: true,
    },
    {
      id: "physicalStat",
      ctorIndex: 2,
      path: "physicalStat",
      control: "select",
      label: "Stat raised after a physical move",
      editable: true,
      gateIndependent: true,
      default: "Defense",
      options: Object.keys(STAT_CHOICES),
      codec: statCodec,
    },
    {
      id: "specialStat",
      ctorIndex: 3,
      path: "specialStat",
      control: "select",
      label: "Stat raised after a special or other damaging move",
      editable: true,
      gateIndependent: true,
      default: "Sp. Def",
      options: Object.keys(STAT_CHOICES),
      codec: statCodec,
    },
  ],
  conditions: [
    // Clauses 3 and 4: the move was resisted but not an immunity (two library atoms, see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really deal damage and must not be blocked or fully immune (checked inside the class until the librarian adds those conditions)",
    "I can gain only a limited number of boosts per switch-in, and a multi-hit move counts once (a private counter inside the class)",
  ],
  effect: { id: "effect.package", params: ["maxTriggers", "stages", "physicalStat", "specialStat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // The default holder is a Normal type, so no foe move here is resisted; the resisted cases are in B13/anneal.test.ts.
      name: "damaging hits of different kinds and the holder's HP",
      axes: { foeMove: ["TACKLE", "WATER_GUN"], hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only. The trigger (after I am hit) and the resisted-hit condition (two move.effectiveness atoms bound in bindings.ts) are separate and swappable. Why the effect cannot be split with today's blocks: it raises a stat that is chosen by the incoming move's category (physical: one stat, otherwise another) and it updates a private counter and a once-per-foe-move memory; effect.stat-stage has one fixed stat and no memory, so staff would need an effect with a 'stat that matches the hit's category' choice (requested as R-B13-15). The guards (damage dealt, not blocked) and the residual (counter below the cap, new foe move) stay in the class and are listed under 'also requires'; requests R-B13-3, R-B13-4, R-B13-6 and R-B13-14 add the atoms. Review of the numbers: the cap (2), the stages (1) and the two stats (Defense, Sp. Def) were literals; they are now trailing constructor arguments with the old values as defaults and are params. Users: Anneal (5979, attr 1). ODDITIES (not fixed): (1) apply bumps the counter and stores the move record even when simulated (only the stat change is skipped); the harness never simulates PostDefend. (2) The effectiveness gate calls getMoveEffectiveness twice (kept as it was). (3) A resisted move that is 'immune' is excluded by the second clause (effectiveness > 0). (4) The ability text says the raise is for a physical move or a special move; a damaging status-category hit cannot occur, so the 'other' stat only ever follows a special move.",
});
