/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Boot Hill (Tier B, package effect). "When I knock a foe out, I plant a one-use marker that hurts the next foe to enter."
//
// Source: abilities/newcomer-signature-mechanics.ts, BootHillAbAttr (PostAttackAbAttr; no constructor of its own: the base
// class's two arguments (attackCondition, showAbility) are constructor arguments 0 and 1; the damage divisor is argument 2, the Speed stage count argument 3).
//   canApply, ORIGINAL order, now guards && gate && residual (all clauses pure, no RNG):
//     guards    1. super.canApply: the base attack condition, by default `move.category !== STATUS` -> constructor slot "ctor:0"
//               2. params.damage > 0                                    (R-B13-3)
//     gate      3. opponent.isFainted()                                  (the target was knocked out, R-B13-44)
//     residual  4. !isSignatureFollowup(move)                            (not one of the ability's own follow-up moves, R-B13-37)
//   apply: globalScene.arena.addTag(GRAVE_MARKER, 0 turns left, no move, my id, the FOE side, quiet = true)   (even when simulated)
//          message "<me> planted a Grave Marker!"
//   The marker is consumed by applyGraveMarkerOnEntry (called by name from phases/switch-summon-phase.ts:465): the next foe that
//   enters that side takes max(1, floor(maxHp / damageDivisor)) indirect damage (the marker's owner is the source) and, if it
//   survives, its Speed stage falls by speedStages (never below -6). The function finds the planter through the marker's
//   sourceId and reads both numbers from the planter's Boot Hill attr (defaults 8 and 1 when the planter or the attr is gone).
import { BootHillAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BootHillAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Plant a marker on the foe's side when I knock a target out",
  summary: params =>
    `When my damaging move knocks the target out, a one-use marker is planted on the foe's side. The next foe that enters takes 1 out of ${params.damageDivisor} parts of its max HP (about ${Math.round(100 / Number(params.damageDivisor))}%) and loses ${params.speedStages} Speed stage(s).`,
  synonyms: [
    "grave marker",
    "knockout hazard",
    "revenge trap",
    "entry hazard on kill",
    "tombstone",
    "boot hill",
    "punish the next switch in",
  ],
  examples: ["When I knock out a foe, the next foe to come in takes damage and loses Speed, like Boot Hill"],
  params: [
    {
      id: "damageDivisor",
      ctorIndex: 2,
      path: "damageDivisor",
      control: "number",
      label: "Marker damage: the foe loses 1 out of this many parts of its max HP (parts)",
      editable: true,
      gateIndependent: true,
      default: 8,
      min: 1,
      max: 100,
      step: 1,
      integer: true,
    },
    {
      id: "speedStages",
      ctorIndex: 3,
      path: "speedStages",
      control: "number",
      label: "Speed stages the marker takes from the foe (stages)",
      editable: true,
      gateIndependent: true,
      default: 1,
      min: 0,
      max: 6,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // Clause 1: the base class's attack condition (a real constructor argument). Every user takes the default.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // Clause 3: the target was knocked out (a legacy-closure binding, see bindings.ts and R-B13-44).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must deal damage",
    "The move must not itself be a follow-up move of this ability",
    "Markers do not stack: a second knock-out only changes who owns the one marker on that side",
    "The marker is used up by the next foe that enters, who loses the set part of its max HP and the set number of Speed stages",
  ],
  effect: { id: "effect.package", params: ["damageDivisor", "speedStages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [
    {
      // The foe survives a Tackle at either HP, so the knock-out gate stays closed; the planted marker is driven by B13/chunk5.test.ts.
      name: "damaging hit and the foe's HP",
      axes: { foeMove: ["TACKLE"], foeHp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only. The trigger (after my hit) is a normal WHEN, the attack condition is the library atom move.damaging (ctor:0) and 'the target was knocked out' is the editable gate (a legacy-closure binding until R-B13-44 `mon.fainted{who}` exists). Why the effect cannot be split with today's blocks: it plants a field effect of a kind the library does not list (`effect.arena-tag` takes a free text tag name, is not implemented, cannot carry the owner id, the 'quiet' flag or the 0-turn lifetime, and the entry damage and Speed drop live in applyGraveMarkerOnEntry, not in the tag); requested as R-B13-46 `effect.plant-entry-marker`. The 1/8 HP and the 1 stage were literals of that function; they are now constructor arguments 2 and 3 (defaults 8 and 1) and the function reads them from the planter's attr (marker.sourceId -> getPokemonById -> attr; defaults when the planter or attr is gone, so a marker whose planter left the field still behaves as shipped). The base class takes the first two arguments. Users: Boot Hill (5985, attr 0). ODDITIES (not fixed): (1) apply ignores `simulated`, so a simulated call plants a marker; no engine path simulates PostAttack today; (2) the class is also a plain PostAttack effect, so a knock-out by an ordinary hit of a multi-hit move counts on the hit that kills; (3) the marker is planted even when the foe side has no Pokemon left to enter; it is created with 0 turns and is only ever removed by applyGraveMarkerOnEntry; (4) a second marker does not stack, the existing one only changes owner (GraveMarkerTag.onOverlap), so damage credit goes to the latest planter.",
});
