/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B08 chunk 1 (spec 2.1): the library form of every Tier B gate (slot "gate") of the
// classes below, keyed by (abilityId, attrIndex). "attr N" is the position in `ability.attrs`.
//
// Every line was written by hand after reading the class, then the live instance (chance, type, outcome and contact
// settings of each user). The L1 differential evaluates the class's own gate and the compiled library gate over the
// state grid and fails on any difference.
//
// Classes without a binding here: AllyAttackPowerBoostAbAttr and ChanceDodgeAbAttr (Tier C, no constructor closure),
// AttackStatSubstituteAbAttr and BoneMoveTypeChartAbAttr (Tier C, nothing to bind).
import { bindCondition } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// AddTypeToAttackerOnContactAbAttr (Tier B). Slot "gate": doesFlagEffectApply(MAKES_CONTACT, user: attacker, target: holder).
// The residual (not Terastallized, does not have the type) stays in the class.
// =============================================================================================
bindCondition(5508, 1, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate"); // Woodland Curse (adds Grass)

// =============================================================================================
// AbsorbantAbAttr (Tier B). Slot "gate", in the ORIGINAL clause order: the move drains (HitHealAttr), then the target is not
// protected from added effects (Shield Dust). The residual (the target can receive Leech Seed) stays in the class.
// =============================================================================================
bindCondition(
  5161,
  0,
  {
    all: [{ id: "move.drains" }, { not: { id: "mon.protected-from-effects", who: "other" } }],
  },
  "gate",
); // Absorbant

// =============================================================================================
// ChanceStatusOnHitAbAttr (Tier B). Slot "gate", in the ORIGINAL clause order:
//   contact: move.doesFlagEffectApply(MAKES_CONTACT)  ->  attacker has no status (only without tag outcomes)  ->  chance roll
// The chance atom stays LAST so a non-contact hit or a statused attacker draws no random number.
// =============================================================================================
const contactStatusGate = (pct: number): unknown => ({
  all: [
    { id: "move.flag", flag: "MAKES_CONTACT" },
    { id: "status.has", who: "other", status: "NONE" },
    { id: "rng.chance", pct },
  ],
});

bindCondition(143, 1, contactStatusGate(30), "gate"); // Poison Touch: 30% poison on contact
bindCondition(5199, 0, contactStatusGate(30), "gate"); // Super Hot Goo: 30% burn on contact
bindCondition(5350, 0, contactStatusGate(50), "gate"); // Arc Flash: 50% burn on contact
bindCondition(5448, 0, contactStatusGate(100), "gate"); // Daybreak: 100% burn on contact (the roll is skipped at 100)
bindCondition(5629, 0, contactStatusGate(20), "gate"); // Hypnotic Touch: 20% sleep on contact

// Crispy Cream pools a burn and a frostbite TAG under one 30% roll. With a tag outcome the class does NOT test
// "attacker has no status" (a tag can still land on a statused attacker), so the gate has no status.has atom.
bindCondition(
  5593,
  0,
  {
    all: [
      { id: "move.flag", flag: "MAKES_CONTACT" },
      { id: "rng.chance", pct: 30 },
    ],
  },
  "gate",
);

// The non-contact tier (contactExcluded), in the ORIGINAL clause order: the move must INHERENTLY lack the contact flag
// (move.hasFlag, which ignores the attacker's Long Reach), the hit must be a damaging one (EFFECTIVE, SUPER_EFFECTIVE,
// NOT_VERY_EFFECTIVE, ONE_HIT_KO, so a Growl never procs it), the attacker has no status, then the chance roll LAST.
const nonContactStatusGate = (pct: number): unknown => ({
  all: [
    { not: { id: "move.inherent-flag", flag: "MAKES_CONTACT" } },
    { id: "hit.landed-damage" },
    { id: "status.has", who: "other", status: "NONE" },
    { id: "rng.chance", pct },
  ],
});
bindCondition(9, 1, nonContactStatusGate(10), "gate"); // Static: 10% paralysis on non-contact
bindCondition(49, 1, nonContactStatusGate(20), "gate"); // Flame Body: 20% burn on non-contact
bindCondition(5358, 1, nonContactStatusGate(10), "gate"); // White Noise: 10% paralysis on non-contact
bindCondition(5733, 3, nonContactStatusGate(20), "gate"); // Smoldering Wood: 20% burn on non-contact

// =============================================================================================
// AteConditionalStatusAbAttr (Tier B). Slot "gate": holder.isOfType(T) && holder.getMoveType(move) === T, then (status and
// tag outcomes) the chance roll. The roll atom is last. The heal outcome (Fertilize) never rolls, so its gate has none.
// =============================================================================================
const ateGate = (type: string, pct: number): unknown => ({
  all: [
    { id: "mon.has-type", who: "holder", type },
    { id: "move.type", type, effective: true },
    { id: "rng.chance", pct },
  ],
});

bindCondition(5017, 2, ateGate("FIRE", 10), "gate"); // Immolate: burn
bindCondition(5104, 3, ateGate("FIRE", 10), "gate"); // Solar Flare: burn (the Immolate half)
bindCondition(6108, 2, ateGate("FIRE", 10), "gate"); // Blaze Release: burn
bindCondition(5063, 2, ateGate("POISON", 10), "gate"); // Intoxicate: badly poison
bindCondition(5428, 2, ateGate("POISON", 10), "gate"); // Sludgy Mix: badly poison
bindCondition(5140, 2, ateGate("ROCK", 10), "gate"); // Mineralize: bleed
bindCondition(5557, 2, ateGate("ROCK", 10), "gate"); // Molten Coat: bleed
bindCondition(5621, 3, ateGate("ROCK", 10), "gate"); // Lead Claws: bleed
bindCondition(5190, 2, ateGate("PSYCHIC", 10), "gate"); // Emanate: confusion
bindCondition(5219, 2, ateGate("PSYCHIC", 10), "gate"); // Enlightened: confusion
bindCondition(5940, 2, ateGate("PSYCHIC", 10), "gate"); // Brainpower: confusion
bindCondition(6036, 4, ateGate("PSYCHIC", 10), "gate"); // Nucleus: confusion

// Fertilize: the heal outcome is deterministic, so no chance atom.
bindCondition(
  5237,
  2,
  {
    all: [
      { id: "mon.has-type", who: "holder", type: "GRASS" },
      { id: "move.type", type: "GRASS", effective: true },
    ],
  },
  "gate",
);

// =============================================================================================================================
// B08 CHUNK 2. The library form of every Tier B gate (slot "gate") of the eight classes below, keyed by (abilityId, attrIndex).
// Every line below was written by hand after reading the class and the live instance of the user (chance, contact settings,
// filter, target requirements). The gate keeps the ORIGINAL clause order and the chance roll is always the LAST atom, so a
// cheap check that fails draws no random number.
// =============================================================================================================================

// ---------------------------------------------------------------------------------------------------------------------------
// ChanceBattlerTagOnHitAbAttr (Tier B, 16 users, defensive: the holder is hit). Original gate order:
//   contactExcluded (inherent contact false AND a damaging hit) -> contactRequired (user-aware contact) -> chance roll.
// There is no "the attacker has no status" test (a lasting effect can land on a statused attacker).
// ---------------------------------------------------------------------------------------------------------------------------
const tagHitContactGate = (pct: number): unknown => ({
  all: [
    { id: "move.flag", flag: "MAKES_CONTACT" },
    { id: "rng.chance", pct },
  ],
});
const tagHitNonContactGate = (pct: number): unknown => ({
  all: [
    { not: { id: "move.inherent-flag", flag: "MAKES_CONTACT" } },
    { id: "hit.landed-damage" },
    { id: "rng.chance", pct },
  ],
});
const tagHitAnyMoveGate = (pct: number): unknown => ({ all: [{ id: "rng.chance", pct }] });

bindCondition(5207, 0, tagHitContactGate(100), "gate"); // Itchy Defense: infestation, 100% on contact (the roll is skipped at 100)
bindCondition(5222, 0, tagHitContactGate(20), "gate"); // Freezing Point: frostbite, 20% on contact
bindCondition(5222, 1, tagHitNonContactGate(30), "gate"); // Freezing Point: frostbite, 30% on non-contact
bindCondition(5223, 0, tagHitContactGate(20), "gate"); // Cryo Proficiency: frostbite, 20% on contact
bindCondition(5223, 1, tagHitNonContactGate(30), "gate"); // Cryo Proficiency: frostbite, 30% on non-contact
bindCondition(5227, 1, tagHitContactGate(30), "gate"); // Yuki Onna: infatuation, 30% on contact
bindCondition(5265, 0, tagHitContactGate(30), "gate"); // Spike Armor: bleeding, 30% on contact
bindCondition(5266, 0, tagHitAnyMoveGate(30), "gate"); // Voodoo Power: bleeding, 30% on ANY move (neither contact setting)
bindCondition(5322, 0, tagHitContactGate(30), "gate"); // Fragrant Daze: confusion, 30% on contact
bindCondition(5334, 0, tagHitContactGate(30), "gate"); // Menacing Situation: fear, 30% on contact
bindCondition(5370, 1, tagHitAnyMoveGate(30), "gate"); // Snowy Wrath: frostbite, 30% on ANY move (neither contact setting)
bindCondition(5377, 2, tagHitContactGate(100), "gate"); // Blood Stain: bleeding, 100% on contact
bindCondition(5945, 2, tagHitContactGate(100), "gate"); // Decomposer: infestation, 100% on contact
bindCondition(6004, 1, tagHitContactGate(20), "gate"); // Cryogenesis: frostbite, 20% on contact
bindCondition(6004, 2, tagHitNonContactGate(30), "gate"); // Cryogenesis: frostbite, 30% on non-contact

// Talon Trap: 50% to trap on contact, but 100% on the holder's FIRST turn (firstTurnChance 100). The class swaps the chance when
// waveTurnCount === 1, and a chance of 100 skips the draw, so the library form is any[ first turn, 50% chance ]: on the first turn
// the any is true with no draw, otherwise the roll is drawn.
bindCondition(
  5674,
  0,
  {
    all: [
      { id: "move.flag", flag: "MAKES_CONTACT" },
      { any: [{ id: "time.first-turn" }, { id: "rng.chance", pct: 50 }] },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// ChanceStatusOnAttackAbAttr (Tier B, 43 attrs, offensive: the holder hits). The parent's damaging-move test, the simulated
// shortcut and the guards (Shield Dust, the holder itself) stay in the class. Original gate order:
//   contactExcluded (inherent contact false) -> contactRequired (user-aware contact) -> filter (flag: inherent, type: the
//   move's OWN type) -> critRequired -> chance roll. There is NO hit-result test in this class.
// ---------------------------------------------------------------------------------------------------------------------------
const statusAttackContactGate = (pct: number): unknown => ({
  all: [
    { id: "move.flag", flag: "MAKES_CONTACT" },
    { id: "rng.chance", pct },
  ],
});
const statusAttackNonContactGate = (pct: number): unknown => ({
  all: [{ not: { id: "move.inherent-flag", flag: "MAKES_CONTACT" } }, { id: "rng.chance", pct }],
});
const statusAttackFlagGate = (flag: string, pct: number): unknown => ({
  all: [
    { id: "move.inherent-flag", flag },
    { id: "rng.chance", pct },
  ],
});
const statusAttackTypeGate = (type: string, pct: number): unknown => ({
  all: [
    { id: "move.type", type, effective: false },
    { id: "rng.chance", pct },
  ],
});
const statusAttackAnyMoveGate = (pct: number): unknown => ({ all: [{ id: "rng.chance", pct }] });
const statusAttackCritGate = (pct: number): unknown => ({
  all: [{ id: "hit.critical" }, { id: "rng.chance", pct }],
});

bindCondition(9, 3, statusAttackNonContactGate(10), "gate"); // Static: paralysis, 10% on non-contact
bindCondition(49, 3, statusAttackNonContactGate(20), "gate"); // Flame Body: burn, 20% on non-contact
bindCondition(206, 3, statusAttackTypeGate("ELECTRIC", 10), "gate"); // Galvanize: paralysis, 10% on Electric moves
bindCondition(5076, 0, statusAttackFlagGate("BITING_MOVE", 50), "gate"); // Solenoglyphs: toxic, 50% on biting moves
bindCondition(5124, 2, statusAttackContactGate(30), "gate"); // Spectral Shroud: toxic, 30% on contact
bindCondition(5152, 4, statusAttackTypeGate("ELECTRIC", 10), "gate"); // Atomic Burst: paralysis, 10% on Electric moves
bindCondition(5152, 5, statusAttackTypeGate("ELECTRIC", 10), "gate"); // Atomic Burst (second copy): paralysis, 10% on Electric moves
bindCondition(5170, 0, statusAttackTypeGate("FIRE", 20), "gate"); // Elemental Charge: burn, 20% on Fire moves
bindCondition(5170, 2, statusAttackTypeGate("ELECTRIC", 20), "gate"); // Elemental Charge: paralysis, 20% on Electric moves
bindCondition(5177, 0, statusAttackFlagGate("BITING_MOVE", 50), "gate"); // Shocking Jaws: paralysis, 50% on biting moves
bindCondition(5186, 0, statusAttackTypeGate("POISON", 30), "gate"); // Archmage: toxic, 30% on Poison moves
bindCondition(5186, 1, statusAttackTypeGate("FIRE", 30), "gate"); // Archmage: burn, 30% on Fire moves
bindCondition(5202, 0, statusAttackTypeGate("ELECTRIC", 10), "gate"); // Cold Plasma: burn, 10% on Electric moves
bindCondition(5254, 0, statusAttackFlagGate("BITING_MOVE", 50), "gate"); // Flaming Jaws: burn, 50% on biting moves
bindCondition(5300, 1, statusAttackFlagGate("SLICING_MOVE", 20), "gate"); // Molten Blades: burn, 20% on slicing moves
bindCondition(5319, 1, statusAttackFlagGate("BITING_MOVE", 50), "gate"); // Flaming Maw: burn, 50% on biting moves
bindCondition(5350, 1, statusAttackContactGate(50), "gate"); // Arc Flash: paralysis, 50% on contact
bindCondition(5354, 1, statusAttackContactGate(20), "gate"); // Venoblaze Pincers: burn or poison, 20% on contact
bindCondition(5358, 3, statusAttackNonContactGate(10), "gate"); // White Noise: paralysis, 10% on non-contact
bindCondition(5394, 0, statusAttackContactGate(30), "gate"); // Assassin's Tools: poison, paralysis or bleeding, 30% on contact
bindCondition(5409, 1, statusAttackFlagGate("BITING_MOVE", 50), "gate"); // Shocking Maw: paralysis, 50% on biting moves
bindCondition(5423, 0, statusAttackContactGate(60), "gate"); // Stun Shock: paralysis or poison, 60% on contact
bindCondition(5428, 5, statusAttackTypeGate("POISON", 10), "gate"); // Sludgy Mix: toxic, 10% on Poison moves
bindCondition(5448, 1, statusAttackContactGate(100), "gate"); // Daybreak: burn, 100% on contact (the roll is skipped at 100)
bindCondition(5480, 3, statusAttackContactGate(30), "gate"); // Blight Scale: poison, 30% on contact
bindCondition(5553, 0, statusAttackAnyMoveGate(30), "gate"); // Envenom: poison, 30% on any damaging move
bindCondition(5557, 3, statusAttackTypeGate("ROCK", 50), "gate"); // Molten Coat: burn, 50% on Rock moves
bindCondition(5580, 1, statusAttackAnyMoveGate(10), "gate"); // Chilling Pellets: toxic, 10% on any damaging move
bindCondition(5593, 1, statusAttackContactGate(30), "gate"); // Crispy Cream: burn or frostbite, 30% on contact
bindCondition(5598, 0, statusAttackTypeGate("ELECTRIC", 30), "gate"); // Virus: poison, 30% on Electric moves
bindCondition(5610, 1, statusAttackFlagGate("SLICING_MOVE", 25), "gate"); // Lightsaber: burn or paralysis, 25% on slicing moves
bindCondition(5613, 0, statusAttackFlagGate("HORN_BASED", 50), "gate"); // Laser Drill: burn, 50% on horn moves
bindCondition(5629, 1, statusAttackContactGate(20), "gate"); // Hypnotic Touch: sleep, 20% on contact
bindCondition(5670, 2, statusAttackNonContactGate(10), "gate"); // Fire's Wrath: burn, 10% on non-contact
bindCondition(5715, 0, statusAttackTypeGate("GRASS", 30), "gate"); // Ghost Pepper: burn, 30% on Grass moves
bindCondition(5733, 5, statusAttackNonContactGate(20), "gate"); // Smoldering Wood: burn, 20% on non-contact
bindCondition(5941, 1, statusAttackTypeGate("POISON", 30), "gate"); // Familiar: toxic, 30% on Poison moves
bindCondition(5941, 2, statusAttackTypeGate("FIRE", 30), "gate"); // Familiar: burn, 30% on Fire moves
bindCondition(5957, 3, statusAttackAnyMoveGate(30), "gate"); // Komodo: poison, 30% on any damaging move
bindCondition(6107, 2, statusAttackCritGate(100), "gate"); // Fourth Degree: burn, 100% on a critical hit
bindCondition(6109, 4, statusAttackCritGate(100), "gate"); // Kagutsuchi: burn, 100% on a critical hit
bindCondition(20005, 5, statusAttackTypeGate("ELECTRIC", 10), "gate"); // Thunder Gods Vessel: paralysis, 10% on Electric moves
bindCondition(20006, 5, statusAttackTypeGate("ELECTRIC", 10), "gate"); // Malicious Empathy: paralysis, 10% on Electric moves

// ---------------------------------------------------------------------------------------------------------------------------
// ChanceBattlerTagOnAttackAbAttr (Tier B, 66 attrs, offensive). The parent's attack check and the guards (Shield Dust, the
// holder itself) stay in the class. Original gate order (matchesMove, matchesTarget, passesChance):
//   listed move ids -> contactExcluded (inherent) -> contactRequired (user-aware) -> filter (flag: inherent, type: the move's
//   OWN type) -> the target already has a tag -> the target has a status -> critical hit -> chance (roll LAST).
// ---------------------------------------------------------------------------------------------------------------------------
const tagAttackContactGate = (pct: number): unknown => ({
  all: [
    { id: "move.flag", flag: "MAKES_CONTACT" },
    { id: "rng.chance", pct },
  ],
});
const tagAttackNonContactGate = (pct: number): unknown => ({
  all: [{ not: { id: "move.inherent-flag", flag: "MAKES_CONTACT" } }, { id: "rng.chance", pct }],
});
const tagAttackFlagGate = (flag: string, pct: number): unknown => ({
  all: [
    { id: "move.inherent-flag", flag },
    { id: "rng.chance", pct },
  ],
});
const tagAttackTypeGate = (type: string, pct: number): unknown => ({
  all: [
    { id: "move.type", type, effective: false },
    { id: "rng.chance", pct },
  ],
});
const tagAttackAnyMoveGate = (pct: number): unknown => ({ all: [{ id: "rng.chance", pct }] });
const tagAttackTargetHasTagGate = (tag: string, pct: number): unknown => ({
  all: [
    { id: "tag.has", who: "other", tag },
    { id: "rng.chance", pct },
  ],
});
const tagAttackCritGate = (pct: number): unknown => ({
  all: [{ id: "hit.critical" }, { id: "rng.chance", pct }],
});

bindCondition(174, 3, tagAttackTypeGate("ICE", 10), "gate"); // Refrigerate: frostbite, 10% on Ice moves
bindCondition(182, 3, tagAttackTypeGate("FAIRY", 10), "gate"); // Pixilate: infatuation, 10% on Fairy moves
bindCondition(5033, 0, tagAttackFlagGate("SOUND_BASED", 50), "gate"); // Loud Bang: confusion, 50% on sound moves
bindCondition(5042, 2, tagAttackTypeGate("PSYCHIC", 100), "gate"); // Magical Dust: puppet control, 100% on Psychic moves
bindCondition(5073, 1, tagAttackAnyMoveGate(10), "gate"); // Haunted Spirit: curse, 10% on any damaging move
bindCondition(5110, 0, tagAttackContactGate(50), "gate"); // Grip Pincer: wrap, 50% on contact
bindCondition(5110, 3, tagAttackAnyMoveGate(100), "gate"); // Grip Pincer: bind, 100% on any damaging move
bindCondition(5135, 0, tagAttackContactGate(100), "gate"); // Fungal Infection: leech seed, 100% on contact
bindCondition(5144, 1, tagAttackContactGate(10), "gate"); // Fearmonger: fear, 10% on contact
bindCondition(5170, 1, tagAttackTypeGate("ICE", 20), "gate"); // Elemental Charge: frostbite, 20% on Ice moves
bindCondition(5186, 2, tagAttackTypeGate("ICE", 30), "gate"); // Archmage: frostbite, 30% on Ice moves
bindCondition(5186, 3, tagAttackTypeGate("WATER", 30), "gate"); // Archmage: confusion, 30% on Water moves
bindCondition(5186, 4, tagAttackTypeGate("DARK", 30), "gate"); // Archmage: bleeding, 30% on Dark moves
bindCondition(5186, 5, tagAttackTypeGate("GROUND", 30), "gate"); // Archmage: trapped, 30% on Ground moves
bindCondition(5186, 6, tagAttackTypeGate("NORMAL", 30), "gate"); // Archmage: encore, 30% on Normal moves
bindCondition(5186, 7, tagAttackTypeGate("GHOST", 30), "gate"); // Archmage: disable, 30% on Ghost moves
bindCondition(5222, 2, tagAttackContactGate(20), "gate"); // Freezing Point: frostbite, 20% on contact
bindCondition(5222, 3, tagAttackNonContactGate(30), "gate"); // Freezing Point: frostbite, 30% on non-contact
bindCondition(5223, 2, tagAttackContactGate(20), "gate"); // Cryo Proficiency: frostbite, 20% on contact
bindCondition(5223, 3, tagAttackNonContactGate(30), "gate"); // Cryo Proficiency: frostbite, 30% on non-contact
bindCondition(5227, 2, tagAttackContactGate(30), "gate"); // Yuki Onna: infatuation, 30% on contact
bindCondition(5252, 0, tagAttackAnyMoveGate(100), "gate"); // Grappler: bind, 100% on any damaging move
bindCondition(5265, 1, tagAttackContactGate(30), "gate"); // Spike Armor: bleeding, 30% on contact
bindCondition(5301, 0, tagAttackAnyMoveGate(20), "gate"); // Haunting Frenzy: flinch, 20% on any damaging move
bindCondition(5306, 1, tagAttackContactGate(20), "gate"); // Dead Power: curse, 20% on contact
bindCondition(5314, 1, tagAttackContactGate(100), "gate"); // Parasitic Spores: parasitic spores, 100% on contact
bindCondition(5315, 0, tagAttackTargetHasTagGate("CONFUSED", 100), "gate"); // Entrance: infatuation, 100% when the target is confused
bindCondition(5322, 1, tagAttackContactGate(30), "gate"); // Fragrant Daze: confusion, 30% on contact
bindCondition(5326, 0, tagAttackFlagGate("SOUND_BASED", 50), "gate"); // Beautiful Music: infatuation, 50% on sound moves
bindCondition(5330, 0, tagAttackFlagGate("SOUND_BASED", 50), "gate"); // Resonance: bleeding, 50% on sound moves
bindCondition(5334, 1, tagAttackContactGate(30), "gate"); // Menacing Situation: fear, 30% on contact
bindCondition(5340, 1, tagAttackTargetHasTagGate("ER_BLEED", 100), "gate"); // Blood Bath: fear, 100% when the target is bleeding
bindCondition(5342, 1, tagAttackTargetHasTagGate("ER_BLEED", 100), "gate"); // Bloodlust: fear, 100% when the target is bleeding
bindCondition(5343, 0, tagAttackFlagGate("SOUND_BASED", 100), "gate"); // Piercing Solo: bleeding, 100% on sound moves
bindCondition(5351, 4, tagAttackTypeGate("FAIRY", 10), "gate"); // Unicorn: infatuation, 10% on Fairy moves
bindCondition(5354, 2, tagAttackContactGate(50), "gate"); // Venoblaze Pincers: wrap, 50% on contact
bindCondition(5354, 5, tagAttackAnyMoveGate(100), "gate"); // Venoblaze Pincers: bind, 100% on any damaging move
bindCondition(5377, 3, tagAttackContactGate(100), "gate"); // Blood Stain: bleeding, 100% on contact
bindCondition(5432, 0, tagAttackCritGate(100), "gate"); // Razor Sharp: bleeding, 100% on a critical hit
bindCondition(5433, 1, tagAttackCritGate(100), "gate"); // To The Bone: bleeding, 100% on a critical hit
bindCondition(
  5441,
  0,
  {
    all: [
      { id: "status.has", who: "other", status: "BURN" },
      { id: "rng.chance", pct: 100 },
    ],
  },
  "gate",
); // Set Ablaze: fear, 100% when the target is burned
bindCondition(5457, 3, tagAttackTypeGate("FAIRY", 10), "gate"); // Twinkle Toes: infatuation, 10% on Fairy moves
bindCondition(5519, 1, tagAttackAnyMoveGate(50), "gate"); // Tentalock: wrap, 50% on any damaging move
bindCondition(5520, 0, tagAttackAnyMoveGate(50), "gate"); // Serpent Bind: wrap, 50% on any damaging move
bindCondition(5525, 0, tagAttackTargetHasTagGate("ER_FROSTBITE", 100), "gate"); // Frostbind: disable, 100% when the target is frostbitten
bindCondition(5532, 0, tagAttackFlagGate("SOUND_BASED", 100), "gate"); // Grass Flute: fear, 100% on sound moves
bindCondition(5538, 0, tagAttackAnyMoveGate(100), "gate"); // Chokehold: bind, 100% on any damaging move
bindCondition(5546, 1, tagAttackFlagGate("HORN_BASED", 30), "gate"); // Impaler: bleeding, 30% on horn moves
bindCondition(5550, 1, tagAttackContactGate(50), "gate"); // World Serpent: wrap, 50% on contact
bindCondition(
  5654,
  1,
  {
    all: [
      { id: "move.is-move", moveId: "HYPNOSIS" },
      { id: "rng.chance", pct: 100 },
    ],
  },
  "gate",
); // Hypnotic Trance: confusion, 100% when I use Hypnosis (a status move)
bindCondition(5682, 1, tagAttackTargetHasTagGate("ER_FROSTBITE", 100), "gate"); // Cryostasis: flinch, 100% when the target is frostbitten
bindCondition(5933, 3, tagAttackContactGate(50), "gate"); // First Serpent: wrap, 50% on contact
bindCondition(5941, 3, tagAttackTypeGate("ICE", 30), "gate"); // Familiar: frostbite, 30% on Ice moves
bindCondition(5941, 4, tagAttackTypeGate("WATER", 30), "gate"); // Familiar: confusion, 30% on Water moves
bindCondition(5941, 5, tagAttackTypeGate("DARK", 30), "gate"); // Familiar: bleeding, 30% on Dark moves
bindCondition(5941, 6, tagAttackTypeGate("GROUND", 30), "gate"); // Familiar: trapped, 30% on Ground moves
bindCondition(5941, 7, tagAttackTypeGate("NORMAL", 30), "gate"); // Familiar: encore, 30% on Normal moves
bindCondition(5941, 8, tagAttackTypeGate("GHOST", 30), "gate"); // Familiar: disable, 30% on Ghost moves
bindCondition(5945, 1, tagAttackContactGate(100), "gate"); // Decomposer: parasitic spores, 100% on contact
bindCondition(5954, 3, tagAttackTypeGate("FAIRY", 10), "gate"); // Pixilate (second id): infatuation, 10% on Fairy moves
bindCondition(6004, 3, tagAttackContactGate(20), "gate"); // Cryogenesis: frostbite, 20% on contact
bindCondition(6004, 4, tagAttackNonContactGate(30), "gate"); // Cryogenesis: frostbite, 30% on non-contact
bindCondition(6100, 0, tagAttackFlagGate("BITING_MOVE", 100), "gate"); // Foreboding Fangs: fear, 100% on biting moves
bindCondition(20007, 3, tagAttackTypeGate("FAIRY", 10), "gate"); // Fae Heart: infatuation, 10% on Fairy moves

// Talon Trap (offensive half): 50% to trap on contact, 100% on the holder's first turn (see the defensive half above).
bindCondition(
  5674,
  1,
  {
    all: [
      { id: "move.flag", flag: "MAKES_CONTACT" },
      { any: [{ id: "time.first-turn" }, { id: "rng.chance", pct: 50 }] },
    ],
  },
  "gate",
);

// Radio Jam: 30% to disable on a sound move, but 100% when the foe has already moved this turn AND its last move was a sound
// move (the per-hit chance function `chanceResolver`, which a constructor cannot take as a param). The class draws only when the
// resolved chance is not 100, so the library form is any[ <the 100% case>, 30% chance ]: the any is true with no draw in the 100%
// case and rolls the 30% otherwise.
bindCondition(
  5303,
  0,
  {
    all: [
      { id: "move.inherent-flag", flag: "SOUND_BASED" },
      {
        any: [
          {
            all: [
              { id: "time.acted", who: "other" },
              { id: "time.last-move-flag", who: "other", flag: "SOUND_BASED" },
            ],
          },
          { id: "rng.chance", pct: 30 },
        ],
      },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// ConditionalDamageAbAttr (Tier B, 6 users). Slot "gate" = the parent's closure = evaluateCondition(situation, holder, target).
// The guard (there is a target) stays in the class.
// ---------------------------------------------------------------------------------------------------------------------------
// any-active-asleep: false while the target is mid-switch, then true when any active Pokemon has SLEEP or the holder is Comatose-like.
const anyoneAsleepGate = (): unknown => ({
  all: [{ not: { id: "mon.switching-out", who: "other" } }, { id: "field.anyone-asleep" }],
});
bindCondition(5043, 0, anyoneAsleepGate(), "gate"); // Dreamcatcher: x2 power while any Pokemon is asleep
bindCondition(5560, 2, anyoneAsleepGate(), "gate"); // Dreamscape: x2 power while any Pokemon is asleep

// target-has-lowered-stat: BATTLE_STATS is all seven stats with stages (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy,
// Evasion), which is exactly what stat ANY of stage.compare reads: some stage is below zero.
bindCondition(5150, 0, { id: "stage.compare", who: "other", stat: "ANY", cmp: "lt", n: 0 }, "gate"); // Pretty Princess: x1.5 power when the target has a lowered stat

// target-has-any-tag [CONFUSED, ER_ENRAGE]
const confusedOrEnragedGate = (): unknown => ({
  any: [
    { id: "tag.has", who: "other", tag: "CONFUSED" },
    { id: "tag.has", who: "other", tag: "ER_ENRAGE" },
  ],
});
bindCondition(5263, 0, confusedOrEnragedGate(), "gate"); // Cosmic Daze: x2 power against a confused or enraged target
bindCondition(5640, 1, confusedOrEnragedGate(), "gate"); // Cosmic Dust: x2 power against a confused or enraged target

bindCondition(5378, 1, { id: "tag.has", who: "other", tag: "ER_BLEED" }, "gate"); // Blood Stigma: x2 power against a bleeding target

// ---------------------------------------------------------------------------------------------------------------------------
// FirstDefendDamageReductionAbAttr and FirstDefendAttackerAtkDropAbAttr (Tier B, one user: Drakelp Head). Slot "gate" = the
// parent's fixed closure `move.category !== STATUS`. The unspent one-time shield stays in the class as the residual.
// ---------------------------------------------------------------------------------------------------------------------------
bindCondition(5690, 0, { id: "move.damaging" }, "gate"); // Drakelp Head: halve the first damaging hit
bindCondition(5690, 1, { id: "move.damaging" }, "gate"); // Drakelp Head: lower the attacker's Attack after the first damaging hit

// ---------------------------------------------------------------------------------------------------------------------------
// ContactQuashAbAttr (Tier B, 2 users). Slot "gate" = doesFlagEffectApply(MAKES_CONTACT, user: attacker, target: holder).
// The attacker and attack-move guards stay in the class.
// ---------------------------------------------------------------------------------------------------------------------------
bindCondition(5437, 0, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate"); // Know Your Place: the attacker moves last for 5 turns
bindCondition(5649, 0, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate"); // Tangled Tails: the attacker moves last for 5 turns
