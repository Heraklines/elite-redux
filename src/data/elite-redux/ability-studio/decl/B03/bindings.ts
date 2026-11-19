/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B03 (spec 2.1): the library form of every constructor closure (slot "ctor:N") and every
// Tier B gate (slot "gate") of the eight classes, keyed by (abilityId, attrIndex). "attr N" is the position in
// `ability.attrs`, as printed by the live dump of every site.
//
// Every line below was read by hand from the live attr (closure source, chance, flags) and mapped to atoms that call the
// SAME engine predicate. A closure that has no such atom is a legacy-closure with the missing piece named; the
// request itself is in requests/B03.md. The L1 differential evaluates each original closure and its library form.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

type Site = readonly [abilityId: number, attrIndex: number, name: string];

function bindEach(spec: unknown, sites: readonly Site[], slot: string): void {
  for (const [abilityId, attrIndex] of sites) {
    bindCondition(abilityId, attrIndex, spec, slot);
  }
}

// =============================================================================================
// PostAttackApplyBattlerTagAbAttr (Tier B, RNG). Slot "gate", in the ORIGINAL order:
//   move.damaging, contact (only when contactRequired), the chance roll, then the yes/no part of the chance closure.
// The roll is drawn BEFORE the closure is read in the original (`randBattleSeedInt(100) < this.chance(...)`), so a
// condition that the closure folds into "N or 0" sits AFTER `rng.chance`: same draw count, same answer.
// =============================================================================================
const damaging = { id: "move.damaging" };
const contact = { id: "move.flag", flag: "MAKES_CONTACT" };
const roll = (pct: number): unknown => ({ id: "rng.chance", pct });

// `() => 50`, contactRequired = true
bindEach(
  { all: [damaging, contact, roll(50)] },
  [
    [56, 1, "Cute Charm"],
    [5216, 2, "Prim and Proper"],
    [5238, 1, "Pure Love"],
    [5527, 1, "Tender Affection"],
  ],
  "gate",
);
// `() => 20`, contactRequired = true
bindEach({ all: [damaging, contact, roll(20)] }, [[12, 3, "Oblivious"]], "gate");
// `() => 20` and `() => 10`, contactRequired = false (two separate attrs of one ability)
bindEach({ all: [damaging, roll(20)] }, [[5631, 0, "Wings of Pestilence (bleed)"]], "gate");
bindEach({ all: [damaging, roll(10)] }, [[5631, 1, "Wings of Pestilence (curse)"]], "gate");

// `user.isOfType(WATER) && user.getMoveType(move) === WATER ? 10 : 0`
bindEach(
  {
    all: [
      damaging,
      roll(10),
      { id: "mon.has-type", who: "holder", type: "WATER" },
      { id: "move.type", type: "WATER", effective: true },
    ],
  },
  [
    [5053, 2, "Hydrate"],
    [5689, 2, "Waterborne"],
    [5955, 2, "Waterborne (second id)"],
  ],
  "gate",
);
// Spectralize (5123 attr 2, Ghost, 10): the library form would be the same as the Water and Dark ones, but the L2
// battle twin cannot reach it: the scenario foe is a Normal type, so a Ghost move never lands and the attr is never
// evaluated. Legacy until the harness has a foe-species axis (request in requests/B03.md).
bindLegacyClosure(
  5123,
  2,
  "Spectralize (Ghost user, Ghost move, 10): the layout is the same as Hydrate and Deviate, but no L2 scenario can reach it (every foe the harness offers is Normal and immune to Ghost moves); needs a foe-species axis in the L2 harness (request in requests/B03.md)",
  "gate",
);
// `user.isOfType(DARK) && user.getMoveType(move) === DARK ? 10 : 0`
bindEach(
  {
    all: [
      damaging,
      roll(10),
      { id: "mon.has-type", who: "holder", type: "DARK" },
      { id: "move.type", type: "DARK", effective: true },
    ],
  },
  [
    [5501, 2, "Deviate"],
    [5714, 3, "Mob Boss"],
  ],
  "gate",
);
// `hangry(user) && user.getMoveType(move) === DARK && user.isOfType(DARK) ? 10 : 0`, hangry = `user.getFormKey() === "hangry"`
bindEach(
  {
    all: [
      damaging,
      roll(10),
      { id: "mon.in-form", who: "holder", key: "hangry" },
      { id: "move.type", type: "DARK", effective: true },
      { id: "mon.has-type", who: "holder", type: "DARK" },
    ],
  },
  [[5486, 12, "Two-Faced"]],
  "gate",
);

// No library form yet. Each reason names the missing piece; requests/B03.md has the full request.
const FLINCH_REASON =
  "the chance is `!move.hasAttr('FlinchAttr') && !move.hitsSubstitute(user, target) ? 10 : 0`; needs atoms move.has-flinch-effect and move.hits-substitute (request in requests/B03.md)";
bindLegacyClosure(1, 0, `Stench: ${FLINCH_REASON}`, "gate");
bindLegacyClosure(6085, 0, `Pungency: ${FLINCH_REASON}`, "gate");

const ALWAYS_DRAW_REASON =
  "the chance is 100 when the condition holds, and the original STILL draws randBattleSeedInt(100) at 100 while rng.chance never draws at 100 (random-draw drift); needs rng.chance with an always-roll option (request in requests/B03.md)";
bindLegacyClosure(
  5318,
  2,
  `Balloon Bomb: ${ALWAYS_DRAW_REASON}; the condition is move is Explosion, Self-Destruct or Misty Explosion`,
  "gate",
);
bindLegacyClosure(5680, 0, `Hollow Ice Zone: ${ALWAYS_DRAW_REASON}; the condition is the move's type is Ice`, "gate");
bindLegacyClosure(
  5663,
  1,
  `Wrestle Showman: ${ALWAYS_DRAW_REASON}; the condition is that the move is the one with move number 560`,
  "gate",
);

const RAW_FLAG_REASON =
  "the closure reads the raw `move.hasFlag(flag)`, while the move.flag atom calls doesFlagEffectApply, which also honours abilities that inject flags (Rapier, kicking injectors), so they differ for such holders; needs an atom for the move's own flag (request in requests/B03.md)";
bindLegacyClosure(5395, 0, `Frostmaw (biting move, 50): ${RAW_FLAG_REASON}`, "gate");
bindLegacyClosure(5438, 0, `Deep Cuts (slicing move, 50): ${RAW_FLAG_REASON}`, "gate");
bindLegacyClosure(5942, 0, `Puncture (slicing move, 50): ${RAW_FLAG_REASON}`, "gate");
bindLegacyClosure(5651, 0, `Sharp Talons (kicking move, 50): ${RAW_FLAG_REASON}`, "gate");
bindLegacyClosure(5718, 1, `Icicle Fist (punching move, 30): ${RAW_FLAG_REASON}`, "gate");

// =============================================================================================
// PostAttackAbilityGiveAbAttr (Tier B). Slot "gate": a damaging move that makes contact.
// =============================================================================================
bindEach({ all: [damaging, contact] }, [[5377, 5, "Blood Stain"]], "gate");

// =============================================================================================
// PostDefendStealHeldItemAbAttr (Tier A). Slot ctor:0, a PokemonDefendCondition (target, user, move):
// `move.doesFlagEffectApply({ flag: MAKES_CONTACT, user, target })` with user = the attacker.
// =============================================================================================
bindEach({ id: "move.flag", flag: "MAKES_CONTACT" }, [[124, 0, "Pickpocket"]], "ctor:0");

// =============================================================================================
// SynchronizeStatusAbAttr (Tier B). Slot "gate": the status carried by the dispatch is Burn, Paralysis, Poison or Toxic.
// =============================================================================================
bindLegacyClosure(
  28,
  1,
  "Synchronize: the gate reads the status that the dispatch carries (`effect`), no atom reads that slot; needs status.just-set (request in requests/B03.md)",
  "gate",
);

// =============================================================================================
// PostVictoryFormChangeAbAttr (Tier A). Slot ctor:0 is a form function (pokemon) => form number, not a yes/no closure.
// =============================================================================================
bindLegacyClosure(
  210,
  0,
  "Battle Bond (Greninja): the closure is `() => 2`, a form NUMBER; the library has no 'I am already in my target form' atom and no form-function slot (request in requests/B03.md)",
  "ctor:0",
);
bindLegacyClosure(
  210,
  3,
  "Battle Bond (other species): the closure is `getBattleBondTargetFormIndex(p) ?? p.formIndex`, read from the species' form-change table; needs the same atom and slot as attr 0 (request in requests/B03.md)",
  "ctor:0",
);

// =============================================================================================
// CopyFaintedAllyAbilityAbAttr (Tier B). Slot "gate": `pokemon.isPlayer() === victim.isPlayer()`, the fainted Pokemon is
// on my side. side.is "ally" is `other !== holder && same side`; adding "self" gives exactly `same side` (the original
// is also true when the victim is the holder itself).
// =============================================================================================
bindEach(
  {
    any: [
      { id: "side.is", kind: "self" },
      { id: "side.is", kind: "ally" },
    ],
  },
  [[222, 0, "Receiver"]],
  "gate",
);

// =============================================================================================
// IgnoreOpponentStatStagesAbAttr (Tier A, chunk 2). Optional slot ctor:1, `opponentCondition(opponent)`. Only the two
// "trapped foe" abilities pass one; the other eight need no binding.
// =============================================================================================
const TRAPPED_FOE_REASON =
  "the closure is `opponent.getTag(TrappedTag) !== undefined`, an instanceof test over every trapping effect (Trapped, Ingrain, Octolock, Bind, Wrap and more); `tag.has` reads one battle effect name, so no atom answers 'the foe is trapped' (request `mon.is-trapped` in requests/B03.md)";
bindLegacyClosure(
  5110,
  1,
  `Grip Pincer (Defense and Sp. Def ignored while the foe is trapped): ${TRAPPED_FOE_REASON}`,
  "ctor:1",
);
bindLegacyClosure(
  5354,
  3,
  `Venoblaze Pincers (Defense and Sp. Def ignored while the foe is trapped): ${TRAPPED_FOE_REASON}`,
  "ctor:1",
);

// =============================================================================================
// Chunk 3. PostSummonRemoveBattlerTagAbAttr (Tier B). Slot "gate": `immuneTags.some(t => !!pokemon.getTag(t))`, spelled as
// an `any` over `tag.has` (`pokemon.getTag(BattlerTagType[tag]) !== undefined`, the same test). The list of effects is
// the constructor argument of each user, read from the live attr.
// =============================================================================================
const tagHas = (tag: string): unknown => ({ id: "tag.has", who: "holder", tag });
// Oblivious: Infatuation and Taunt
bindEach({ any: [tagHas("INFATUATED"), tagHas("TAUNT")] }, [[12, 1, "Oblivious"]], "gate");
// Own Tempo: Confusion
bindEach({ any: [tagHas("CONFUSED")] }, [[20, 1, "Own Tempo"]], "gate");

// =============================================================================================
// PostSummonHealStatusAbAttr (Tier B). Slot "gate": the status I have is one of the listed ones (the list of every user is
// non-empty, so the 'empty list = any status' branch of the class is not used by anyone). `status.has` reads
// `pokemon.status?.effect === StatusEffect[status]`; the class's own residual 'I have a status at all' stays in the class.
// =============================================================================================
const statusHas = (status: string): unknown => ({ id: "status.has", who: "holder", status });
const anyOf = (...statuses: string[]): unknown => ({ any: statuses.map(statusHas) });
// paralysis: Limber, Steadfast, Superheavy
bindEach(
  anyOf("PARALYSIS"),
  [
    [7, 1, "Limber"],
    [80, 2, "Steadfast"],
    [5549, 2, "Superheavy"],
  ],
  "gate",
);
// sleep: Insomnia, Vital Spirit, Brainpower
bindEach(
  anyOf("SLEEP"),
  [
    [15, 1, "Insomnia"],
    [72, 1, "Vital Spirit"],
    [5940, 4, "Brainpower"],
  ],
  "gate",
);
// poison and bad poison: Immunity
bindEach(anyOf("POISON", "TOXIC"), [[17, 1, "Immunity"]], "gate");
// freeze: Magma Armor
bindEach(anyOf("FREEZE"), [[40, 1, "Magma Armor"]], "gate");
// burn: Water Veil (two ids), Water Bubble, Thermal Exchange, Purifying Waters, Flame Bubble, Thermal Entropy
bindEach(
  anyOf("BURN"),
  [
    [41, 1, "Water Veil"],
    [5947, 1, "Water Veil (second id)"],
    [199, 3, "Water Bubble"],
    [270, 2, "Thermal Exchange"],
    [5231, 2, "Purifying Waters"],
    [5368, 3, "Flame Bubble"],
    [5711, 2, "Thermal Entropy"],
  ],
  "gate",
);

// =============================================================================================
// DownloadAbAttr (Tier B). Slot "gate": `enemyDef <= enemySpDef`, the foes' rounded average Defense is not higher than
// their rounded average Sp. Def (a tie is true). No atom reads the foes' averages yet; it stays the class's own gate.
// =============================================================================================
bindLegacyClosure(
  88,
  0,
  "Download: the gate compares the foes' rounded average Defense with their rounded average Sp. Def; needs the atom foe.average-defense-not-higher (request in requests/B03.md)",
  "gate",
);
