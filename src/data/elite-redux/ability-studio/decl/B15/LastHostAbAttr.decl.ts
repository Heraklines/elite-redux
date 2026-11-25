/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3. Tier C, engine-query (a presence marker). "Once per battle, when I would be knocked out while a foe is infested, I stay at 1 HP; the infested foe with the most HP loses its Infestation and 25% of its max HP."
//
// Source: src/data/elite-redux/abilities/last-host.ts, class LastHostAbAttr (extends AbAttr; constructor passes showAbility false; apply is empty, there is no canApply of its own).
// The effect is erTryLastHost, called from Pokemon.damage (src/field/pokemon.ts) for direct AND indirect damage, after the Endure/Sturdy clamp and deliberately outside its preventEndure guard,
// only when `!surviveDamage.value && this.hp - damage <= 0`. In order:
//   1. pokemon.hp < 1 -> false                                            -> guard (already fainted)
//   2. holder has an active LastHostAbAttr (found by constructor name)    -> presence (the marker)
//   3. LAST_HOST_USED.get(holder) === current wave index -> false         -> condition: once per battle (module WeakMap holder -> wave index; read by the AI snapshot via erLastHostUsedWave)
//   4. infested = active foes with the INFESTATION tag; none -> false     -> condition: a foe is infested
//   5. host = the infested foe with the HIGHEST current hp (first of equals); write the wave; remove its Infestation; queue the message; host.damageAndUpdate(toDmgValue(maxHp * share, 1), INDIRECT)
//   6. return true; the caller sets damage = hp - 1
// Constructor change (behaviour-neutral): the host damage share (default 0.25) is a constructor argument; the seam reads it from the holder's live attr.
// No random draw.
import { LastHostAbAttr } from "#data/elite-redux/abilities/last-host";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(LastHostAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Survive a knockout at 1 HP by using up a foe's Infestation",
  summary: params =>
    `Once per battle, if I would be knocked out by any damage while a foe is infested, I stay at 1 HP; the infested foe with the most HP loses its Infestation and ${Math.round(Number(params.hostDamageShare) * 100)}% of its max HP.`,
  synonyms: [
    "last host",
    "cling to life",
    "survive at 1 hp",
    "endure once",
    "parasite saves me",
    "sturdy",
    "focus sash",
  ],
  examples: [
    "Once per battle I survive a lethal hit at 1 HP if a foe is infested, and that foe loses a quarter of its HP",
  ],
  params: [
    {
      id: "hostDamageShare",
      ctorIndex: 0,
      path: "hostDamageShare",
      control: "slider",
      min: 0.05,
      max: 1,
      step: 0.05,
      label: "Max HP the infested foe loses (0.25 = 25%)",
      editable: true,
      default: 0.25,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "It works against every kind of damage, including poison, weather and recoil",
    "It can be used only once per battle, even if I heal afterwards",
    "At least one foe on the field must be infested; the infested foe with the most HP is chosen",
    "The foe's loss can knock it out, and a foe that blocks indirect damage is not spared",
    "It is built into the game's damage handling and is not part of this block",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The marker is consulted by the damage handling when a hit would knock the holder out, which is not a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "take a hit while a foe is infested", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Engine-query (presence marker read by erTryLastHost by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Last Host (5906 attr 0). The class has no condition of its own; the conditions (once per battle, a foe is infested) and the effect (stay at 1 HP, consume the Infestation, hurt the host) live in the engine seam and are requested as library blocks: R-B15-16 (the moment 'when I would be knocked out' with the effect 'stay at 1 HP') and R-B15-17 (condition 'a foe has {battle effect}' and effect 'remove it from the foe with the most HP and hurt that foe by a share of its max HP'). The only number is typed (host damage share). Suspected oddities, NOT fixed: (1) the host loses HP through damageAndUpdate INDIRECT without asking Magic Guard (BlockNonDirectDamageAbAttr), so a Magic Guard host is hurt; (2) the once-per-battle memory is keyed by the WAVE index, so a wave that is re-fought re-arms it; (3) the survival message is hard-coded English, not a translated string; (4) the check runs AFTER Endure and Sturdy, so when one of those already saved the holder Last Host is not consumed (intended).",
});
