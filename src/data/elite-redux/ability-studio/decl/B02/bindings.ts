/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1 bindings (spec 2.1), keyed by (abilityId, attrIndex). `attrIndex` is the position in `ability.attrs`
// (read from the live game, not from the order of the `.attr()` lines). Every line below was read by hand from the
// class source and the live instance dump; the L1 differential then compares each Tier B gate and each closure with
// its library form over the state grid.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

type Site = readonly [abilityId: number, attrIndex: number, name: string];

function bindEach(spec: unknown, sites: readonly Site[], slot = "ctor:0"): void {
  for (const [abilityId, attrIndex] of sites) {
    bindCondition(abilityId, attrIndex, spec, slot);
  }
}

// The contact test every Tier B gate of this chunk starts with:
// `move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })`
const CONTACT = { id: "move.flag", flag: "MAKES_CONTACT" };

// =============================================================================================
// PostDefendContactDamageAbAttr (Tier B). Slot "gate": the contact test. The `!simulated` guard and the
// `!attacker.hasAbilityWithAttr("BlockNonDirectDamageAbAttr")` residual stay in the class.
// =============================================================================================
bindEach(
  CONTACT,
  [
    [24, 0, "Rough Skin"],
    [160, 0, "Iron Barbs"],
    [5289, 0, "Sharp Edges"],
    [5541, 0, "Poison Quills"],
    [5619, 3, "Dragonfruit"],
    [5956, 3, "Dragonfruit (second id)"],
    [5967, 0, "Prickly Armor"],
    [6112, 2, "In the Rough"],
    [20016, 0, "Samehada"],
  ],
  "gate",
);

// =============================================================================================
// PostDefendPerishSongAbAttr (Tier B). Slot "gate": the contact test; "attacker has no Perish Song countdown" is the residual.
// =============================================================================================
bindEach(CONTACT, [[253, 0, "Perish Body"]], "gate");

// =============================================================================================
// PostDefendWeatherChangeAbAttr (Tier A). Slot ctor:1, a PokemonDefendCondition (target, user, move).
// Sand Spit passes `move.category !== MoveCategory.STATUS`, which is the move.damaging atom.
// Cryo Proficiency (5223, attr 4) passes no closure: the optional slot is absent and needs no binding.
// =============================================================================================
bindEach({ id: "move.damaging" }, [[245, 0, "Sand Spit"]], "ctor:1");

// =============================================================================================
// PostDefendAbilitySwapAbAttr (Tier B). Slot "gate": the contact test; swappable and the Wandering Spirit pairing
// rule are the residual.
// =============================================================================================
bindEach(
  CONTACT,
  [
    [254, 0, "Wandering Spirit"],
    [5001, 0, "Wandering Spirit (ER twin)"],
  ],
  "gate",
);

// =============================================================================================
// PostDefendAbilityGiveAbAttr (Tier B). Slot "gate": the contact test; suppressable, "not itself a giver" and the
// Mummy family rule are the residual.
// =============================================================================================
bindEach(
  CONTACT,
  [
    [152, 1, "Mummy"],
    [268, 1, "Lingering Aroma"],
    [5377, 4, "Blood Stain"],
    [6084, 1, "Lingering Musk"],
  ],
  "gate",
);

// =============================================================================================
// PostDefendMoveDisableAbAttr (Tier B, RNG). Slot "gate", in the ORIGINAL clause order:
//   attacker.getTag(DISABLED) == null && contact && (chance === -1 || randBattleSeedInt(100) < chance)
// The chance atom stays LAST so a non-contact hit or an already disabled attacker draws no random number.
// =============================================================================================
bindEach(
  {
    all: [{ not: { id: "tag.has", who: "other", tag: "DISABLED" } }, CONTACT, { id: "rng.chance", pct: 30 }],
  },
  [[130, 0, "Cursed Body"]],
  "gate",
);

// =============================================================================================
// PostStatStageChangeStatStageChangeAbAttr (Tier A). Slot ctor:0, a PokemonStatStageChangeCondition
// (target, stats, stages) => boolean. All six users pass `stages < 0` (stage.just-changed, direction lowered), but no
// adapter turns a library IF into that signature yet (request B02-7), so each is a legacy closure with that reason.
// =============================================================================================
const STAT_CHANGE_REASON =
  "Closure `stages < 0` maps to stage.just-changed (direction lowered), but the slot has no adapter: the library only adapts attack, defend and holder closures, not the (target, stats, stages) signature of a stat-change condition (request B02-7 in requests/B02.md)";
for (const [abilityId, attrIndex] of [
  [128, 0], // Defiant
  [172, 0], // Competitive
  [5312, 1], // Contempt
  [5617, 0], // Narcissist
  [5686, 3], // Lucha Libre
  [5725, 1], // Duality
] as const) {
  bindLegacyClosure(abilityId, attrIndex, STAT_CHANGE_REASON, "ctor:0");
}
