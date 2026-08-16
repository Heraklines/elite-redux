/* This file is generated from docs/moody-mode-spec.md. Do not edit by hand. */

import type { MoodyBoonDefinition, MoodyCurseDefinition } from "#data/elite-redux/moody/moody-types";

export const MOODY_BOONS = [
  {
    id: "crowned-vanguard",
    number: 1,
    name: "Crowned Vanguard",
    rarity: "great",
    scope: "slot",
    targetKind: "slot",
    base: "The occupant’s first damaging move each battle gains +1 priority.",
    rankTwo: "If that move already has increased priority, it gains 20% power instead.",
    evolutions: [
      {
        id: "royal-vanguard",
        name: "Royal Vanguard",
        description:
          "The effect refreshes once after the occupant leaves the field and spends at least three complete turns benched.",
      },
      {
        id: "ambush-doctrine",
        name: "Ambush Doctrine",
        description:
          "Every occupied party slot receives a weaker version once per battle. Existing priority moves gain 15% power.",
      },
    ],
    fullDescription:
      "**Base:** The occupant’s first damaging move each battle gains +1 priority.\n\n**Rank II:** If that move already has increased priority, it gains 20% power instead.\n\n**Evolution — Royal Vanguard:** The effect refreshes once after the occupant leaves the field and spends at least three complete turns benched.\n\n**Evolution — Ambush Doctrine:** Every occupied party slot receives a weaker version once per battle. Existing priority moves gain 15% power.",
  },
  {
    id: "bastion-seat",
    number: 2,
    name: "Bastion Seat",
    rarity: "great",
    scope: "slot",
    targetKind: "slot",
    base: "On its first entry each battle, the occupant gains a barrier equal to 20% of maximum HP.",
    rankTwo: "Barrier becomes 30%.",
    evolutions: [
      {
        id: "citadel-seat",
        name: "Citadel Seat",
        description: "After the occupant spends three turns benched, its next entry restores a 15% barrier.",
      },
      {
        id: "bastion-doctrine",
        name: "Bastion Doctrine",
        description: "Every party member gains a 12% barrier on its first entry.",
      },
    ],
    fullDescription:
      "**Base:** On its first entry each battle, the occupant gains a barrier equal to 20% of maximum HP.\n\n**Rank II:** Barrier becomes 30%.\n\n**Evolution — Citadel Seat:** After the occupant spends three turns benched, its next entry restores a 15% barrier.\n\n**Evolution — Bastion Doctrine:** Every party member gains a 12% barrier on its first entry.",
  },
  {
    id: "relay-seat",
    number: 3,
    name: "Relay Seat",
    rarity: "great",
    scope: "slot",
    targetKind: "slot",
    base: "When the occupant voluntarily switches out, the incoming Pokémon inherits one random positive stat stage from it.",
    rankTwo: "It transfers up to two total stages, with no more than one stage from each stat.",
    evolutions: [
      {
        id: "perfect-handoff",
        name: "Perfect Handoff",
        description:
          "It transfers the two highest available stages and removes one negative stage from the incoming Pokémon.",
      },
      {
        id: "momentum-relay",
        name: "Momentum Relay",
        description:
          "Every voluntary switch by the team transfers one random positive stage, once per Pokémon per battle.",
      },
    ],
    fullDescription:
      "**Base:** When the occupant voluntarily switches out, the incoming Pokémon inherits one random positive stat stage from it.\n\n**Rank II:** It transfers up to two total stages, with no more than one stage from each stat.\n\n**Evolution — Perfect Handoff:** It transfers the two highest available stages and removes one negative stage from the incoming Pokémon.\n\n**Evolution — Momentum Relay:** Every voluntary switch by the team transfers one random positive stage, once per Pokémon per battle.",
  },
  {
    id: "echo-seat",
    number: 4,
    name: "Echo Seat",
    rarity: "ultra",
    scope: "slot",
    targetKind: "slot",
    base: "The occupant’s first eligible damaging move each battle repeats at 25% power.\n\nThe echo consumes no PP and does not reproduce secondary effects, recoil, charge turns, multi-hit structure, self-KO effects, or other recursively triggerable components.",
    rankTwo: "Echo power becomes 35%.",
    evolutions: [
      {
        id: "reverberant-seat",
        name: "Reverberant Seat",
        description: "The boon can trigger a second time after the occupant leaves and later re-enters.",
      },
      {
        id: "echo-doctrine",
        name: "Echo Doctrine",
        description: "Every party member’s first eligible damaging move echoes at 15% power.",
      },
    ],
    fullDescription:
      "**Base:** The occupant’s first eligible damaging move each battle repeats at 25% power.\n\nThe echo consumes no PP and does not reproduce secondary effects, recoil, charge turns, multi-hit structure, self-KO effects, or other recursively triggerable components.\n\n**Rank II:** Echo power becomes 35%.\n\n**Evolution — Reverberant Seat:** The boon can trigger a second time after the occupant leaves and later re-enters.\n\n**Evolution — Echo Doctrine:** Every party member’s first eligible damaging move echoes at 15% power.",
  },
  {
    id: "sanctuary-seat",
    number: 5,
    name: "Sanctuary Seat",
    rarity: "master",
    scope: "slot",
    targetKind: "slot",
    base: "The first major status or volatile condition directed at the occupant each battle is completely negated.",
    rankTwo: "The first direct stat reduction is also negated, using a separate charge.",
    evolutions: [
      {
        id: "hallowed-seat",
        name: "Hallowed Seat",
        description: "The status/volatile protection refreshes once after the occupant re-enters.",
      },
      {
        id: "sanctuary-doctrine",
        name: "Sanctuary Doctrine",
        description: "The first two qualifying effects directed at anyone on the team are negated.",
      },
    ],
    fullDescription:
      "**Base:** The first major status or volatile condition directed at the occupant each battle is completely negated.\n\n**Rank II:** The first direct stat reduction is also negated, using a separate charge.\n\n**Evolution — Hallowed Seat:** The status/volatile protection refreshes once after the occupant re-enters.\n\n**Evolution — Sanctuary Doctrine:** The first two qualifying effects directed at anyone on the team are negated.",
  },
  {
    id: "hungry-seat",
    number: 6,
    name: "Hungry Seat",
    rarity: "great",
    scope: "slot",
    targetKind: "slot",
    base: "Every KO scored from this slot grants one Feast token, maximum three. At the beginning of the next battle, each token heals the occupant by 8% and restores 1 PP to its most depleted move.",
    rankTwo: "Maximum four tokens; healing becomes 10%.",
    evolutions: [
      {
        id: "glutton-s-throne",
        name: "Glutton’s Throne",
        description:
          "Excess healing becomes a barrier and Feast tokens are retained if the occupant begins at full HP and PP.",
      },
      {
        id: "feast-for-all",
        name: "Feast for All",
        description: "Half of the generated healing and PP recovery is redirected to the lowest-HP benched ally.",
      },
    ],
    fullDescription:
      "**Base:** Every KO scored from this slot grants one Feast token, maximum three. At the beginning of the next battle, each token heals the occupant by 8% and restores 1 PP to its most depleted move.\n\n**Rank II:** Maximum four tokens; healing becomes 10%.\n\n**Evolution — Glutton’s Throne:** Excess healing becomes a barrier and Feast tokens are retained if the occupant begins at full HP and PP.\n\n**Evolution — Feast for All:** Half of the generated healing and PP recovery is redirected to the lowest-HP benched ally.",
  },
  {
    id: "twin-sigil",
    number: 7,
    name: "Twin Sigil",
    rarity: "ultra",
    scope: "two slots",
    targetKind: "slots",
    base: "Switching directly between the two marked slots heals the incoming Pokémon by 8%. If one occupant faints, the other gains +1 in its highest offensive stat.",
    rankTwo: "Switch healing becomes 12%, and the incoming Pokémon clears one negative stat stage.",
    evolutions: [
      {
        id: "twin-engine",
        name: "Twin Engine",
        description: "Direct switches also transfer one random positive stat stage.",
      },
      {
        id: "last-twin",
        name: "Last Twin",
        description: "If one partner faints, the survivor gains +1 Attack, Special Attack, and Speed for three turns.",
      },
    ],
    fullDescription:
      "**Base:** Switching directly between the two marked slots heals the incoming Pokémon by 8%. If one occupant faints, the other gains +1 in its highest offensive stat.\n\n**Rank II:** Switch healing becomes 12%, and the incoming Pokémon clears one negative stat stage.\n\n**Evolution — Twin Engine:** Direct switches also transfer one random positive stat stage.\n\n**Evolution — Last Twin:** If one partner faints, the survivor gains +1 Attack, Special Attack, and Speed for three turns.",
  },
  {
    id: "empty-throne",
    number: 8,
    name: "Empty Throne",
    rarity: "rogue",
    scope: "team",
    targetKind: "team",
    base: "Every truly unoccupied party slot grants all conscious Pokémon +10% maximum HP and damage. Every occupied but fainted slot grants +6%.\n\nEmpty and fainted slots are counted separately, with no cap.",
    rankTwo: "Empty slots grant +12%; fainted slots grant +8%.",
    evolutions: [
      {
        id: "solitary-kingdom",
        name: "Solitary Kingdom",
        description: "Each empty slot additionally grants +5% Speed.",
      },
      {
        id: "court-of-ashes",
        name: "Court of Ashes",
        description:
          "Fainted slots grant the full 10% bonus, and becoming the final conscious Pokémon clears one major status and creates a 20% barrier.",
      },
    ],
    fullDescription:
      "**Base:** Every truly unoccupied party slot grants all conscious Pokémon +10% maximum HP and damage. Every occupied but fainted slot grants +6%.\n\nEmpty and fainted slots are counted separately, with no cap.\n\n**Rank II:** Empty slots grant +12%; fainted slots grant +8%.\n\n**Evolution — Solitary Kingdom:** Each empty slot additionally grants +5% Speed.\n\n**Evolution — Court of Ashes:** Fainted slots grant the full 10% bonus, and becoming the final conscious Pokémon clears one major status and creates a 20% barrier.",
  },
  {
    id: "rotating-spotlight",
    number: 9,
    name: "Rotating Spotlight",
    rarity: "great",
    scope: "rotating slot",
    targetKind: "slot",
    base: "One occupied slot becomes the Star each wave, following a deterministic seeded rotation. The Star gains 50% more experience and 20% power on its first damaging move.",
    rankTwo: "Experience becomes +75%; first-move power becomes +30%.",
    evolutions: [
      {
        id: "encore",
        name: "Encore",
        description: "If the Star scores a KO, it heals 10% and remains the Star for the following wave.",
      },
      {
        id: "ensemble",
        name: "Ensemble",
        description: "The two adjacent slots receive half of the Star’s combat bonus.",
      },
    ],
    fullDescription:
      "**Base:** One occupied slot becomes the Star each wave, following a deterministic seeded rotation. The Star gains 50% more experience and 20% power on its first damaging move.\n\n**Rank II:** Experience becomes +75%; first-move power becomes +30%.\n\n**Evolution — Encore:** If the Star scores a KO, it heals 10% and remains the Star for the following wave.\n\n**Evolution — Ensemble:** The two adjacent slots receive half of the Star’s combat bonus.",
  },
  {
    id: "last-chair",
    number: 10,
    name: "Last Chair",
    rarity: "ultra",
    scope: "slot",
    targetKind: "slot",
    base: "When the occupant becomes the final conscious party member, it heals 25%, clears negative stat stages, and gains +1 Speed. Once per battle.",
    rankTwo: "Healing becomes 35%, and volatile conditions are also cleared.",
    evolutions: [
      {
        id: "sole-survivor",
        name: "Sole Survivor",
        description: "It additionally gains +1 in its highest offensive stat and 20% damage for three turns.",
      },
      {
        id: "refusal-to-fall",
        name: "Refusal to Fall",
        description: "It gains a 30% barrier and becomes immune to forced switching for the rest of the battle.",
      },
    ],
    fullDescription:
      "**Base:** When the occupant becomes the final conscious party member, it heals 25%, clears negative stat stages, and gains +1 Speed. Once per battle.\n\n**Rank II:** Healing becomes 35%, and volatile conditions are also cleared.\n\n**Evolution — Sole Survivor:** It additionally gains +1 in its highest offensive stat and 20% damage for three turns.\n\n**Evolution — Refusal to Fall:** It gains a 30% barrier and becomes immune to forced switching for the rest of the battle.",
  },
  {
    id: "chosen-one",
    number: 11,
    name: "Chosen One",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The first elite or boss KO scored by the selected Pokémon during each ten-wave segment grants one permanent Glory stack. Each stack grants 2% damage, maximum ten. Fainting removes one stack.",
    rankTwo: "Maximum fifteen stacks; each stack also grants 0.5% damage reduction.",
    evolutions: [
      {
        id: "conqueror",
        name: "Conqueror",
        description:
          "Glory grants 3% damage per stack, but only boss KOs and boss health-segment breaks create stacks.",
      },
      {
        id: "living-legend",
        name: "Living Legend",
        description:
          "Maximum twenty stacks and fainting no longer removes them, but ordinary elite KOs grant progress only every second time.",
      },
    ],
    fullDescription:
      "**Base:** The first elite or boss KO scored by the selected Pokémon during each ten-wave segment grants one permanent Glory stack. Each stack grants 2% damage, maximum ten. Fainting removes one stack.\n\n**Rank II:** Maximum fifteen stacks; each stack also grants 0.5% damage reduction.\n\n**Evolution — Conqueror:** Glory grants 3% damage per stack, but only boss KOs and boss health-segment breaks create stacks.\n\n**Evolution — Living Legend:** Maximum twenty stacks and fainting no longer removes them, but ordinary elite KOs grant progress only every second time.",
  },
  {
    id: "scar-reader",
    number: 12,
    name: "Scar Reader",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "After being damaged by an elemental type, the selected Pokémon takes 25% less damage from that type for the rest of the battle.",
    rankTwo: "Reduction becomes 35%.",
    evolutions: [
      {
        id: "pattern-reader",
        name: "Pattern Reader",
        description: "It can maintain resistance against the two most recent damaging types, each at 25%.",
      },
      {
        id: "deep-scar",
        name: "Deep Scar",
        description: "The first resistance learned in a battle remains active for the first turn of the next battle.",
      },
    ],
    fullDescription:
      "**Base:** After being damaged by an elemental type, the selected Pokémon takes 25% less damage from that type for the rest of the battle.\n\n**Rank II:** Reduction becomes 35%.\n\n**Evolution — Pattern Reader:** It can maintain resistance against the two most recent damaging types, each at 25%.\n\n**Evolution — Deep Scar:** The first resistance learned in a battle remains active for the first turn of the next battle.",
  },
  {
    id: "signature-technique",
    number: 13,
    name: "Signature Technique",
    rarity: "great",
    scope: "exact move",
    targetKind: "move",
    base: "Select one exact move. It gains 15% power, and every third use consumes no PP.",
    rankTwo: "Power becomes 25%; every third use also gains increased secondary-effect probability where applicable.",
    evolutions: [
      {
        id: "masterpiece",
        name: "Masterpiece",
        description: "Power becomes 40%, and the move’s final PP guarantees one eligible secondary effect.",
      },
      {
        id: "school-founder",
        name: "School Founder",
        description:
          "The exact-move bonus becomes smaller, but all moves sharing one selected move tag—such as slicing, sound, punch, bite, hammer, bullet, dance, recoil, or multi-hit—gain 15% power.",
      },
    ],
    fullDescription:
      "**Base:** Select one exact move. It gains 15% power, and every third use consumes no PP.\n\n**Rank II:** Power becomes 25%; every third use also gains increased secondary-effect probability where applicable.\n\n**Evolution — Masterpiece:** Power becomes 40%, and the move’s final PP guarantees one eligible secondary effect.\n\n**Evolution — School Founder:** The exact-move bonus becomes smaller, but all moves sharing one selected move tag—such as slicing, sound, punch, bite, hammer, bullet, dance, recoil, or multi-hit—gain 15% power.",
  },
  {
    id: "improviser",
    number: 14,
    name: "Improviser",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "After the selected Pokémon uses four distinct move slots during one battle, it gains +1 in a random stat. Once per battle.\n\nAll four slots count, including on Pokémon that know more than four moves.",
    rankTwo: "It can trigger twice per battle.",
    evolutions: [
      {
        id: "virtuoso",
        name: "Virtuoso",
        description: "It triggers after three distinct move slots and rolls two random stats.",
      },
      {
        id: "improvisational-doctrine",
        name: "Improvisational Doctrine",
        description:
          "Every allied Pokémon can trigger a weaker one-stat version once per battle after using four distinct move slots.",
      },
    ],
    fullDescription:
      "**Base:** After the selected Pokémon uses four distinct move slots during one battle, it gains +1 in a random stat. Once per battle.\n\nAll four slots count, including on Pokémon that know more than four moves.\n\n**Rank II:** It can trigger twice per battle.\n\n**Evolution — Virtuoso:** It triggers after three distinct move slots and rolls two random stats.\n\n**Evolution — Improvisational Doctrine:** Every allied Pokémon can trigger a weaker one-stat version once per battle after using four distinct move slots.",
  },
  {
    id: "blood-rival",
    number: 15,
    name: "Blood Rival",
    rarity: "great",
    scope: "Pokémon plus elemental type",
    targetKind: "pokemon-type",
    base: "Select one enemy elemental type. The Pokémon deals 25% more damage to that type and heals 8% after defeating one.",
    rankTwo: "Damage becomes 35%; healing becomes 12%.",
    evolutions: [
      {
        id: "slayer",
        name: "Slayer",
        description: "It also takes 20% less damage from the selected type.",
      },
      {
        id: "obsession",
        name: "Obsession",
        description:
          "Every ten KOs against that type grants a permanent additional 2% damage against it, maximum ten stacks.",
      },
    ],
    fullDescription:
      "**Base:** Select one enemy elemental type. The Pokémon deals 25% more damage to that type and heals 8% after defeating one.\n\n**Rank II:** Damage becomes 35%; healing becomes 12%.\n\n**Evolution — Slayer:** It also takes 20% less damage from the selected type.\n\n**Evolution — Obsession:** Every ten KOs against that type grants a permanent additional 2% damage against it, maximum ten stacks.",
  },
  {
    id: "survivor-s-pride",
    number: 16,
    name: "Survivor’s Pride",
    rarity: "master",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Once per biome, if the selected Pokémon would faint from above 20% HP, it survives at 1 HP and gains +2 Speed.",
    rankTwo: "It also clears negative stat stages and volatile conditions.",
    evolutions: [
      {
        id: "deathless-pride",
        name: "Deathless Pride",
        description: "The trigger becomes once per boss battle.",
      },
      {
        id: "last-laugh",
        name: "Last Laugh",
        description:
          "The next damaging move after surviving gains 100% power and cannot miss, but the trigger remains once per biome.",
      },
    ],
    fullDescription:
      "**Base:** Once per biome, if the selected Pokémon would faint from above 20% HP, it survives at 1 HP and gains +2 Speed.\n\n**Rank II:** It also clears negative stat stages and volatile conditions.\n\n**Evolution — Deathless Pride:** The trigger becomes once per boss battle.\n\n**Evolution — Last Laugh:** The next damaging move after surviving gains 100% power and cannot miss, but the trigger remains once per biome.",
  },
  {
    id: "quiet-mentor",
    number: 17,
    name: "Quiet Mentor",
    rarity: "great",
    scope: "Pokémon affecting adjacent slots",
    targetKind: "slot",
    base: "At battle start, the two party slots adjacent to the Mentor gain +1 in the Mentor’s highest non-HP stat for one turn.",
    rankTwo: "Duration becomes two turns.",
    evolutions: [
      {
        id: "senior-mentor",
        name: "Senior Mentor",
        description: "Every other occupied slot receives the one-turn bonus.",
      },
      {
        id: "balanced-tutelage",
        name: "Balanced Tutelage",
        description:
          "One adjacent slot receives the Mentor’s highest offensive stat; the other receives its highest defensive stat.",
      },
    ],
    fullDescription:
      "**Base:** At battle start, the two party slots adjacent to the Mentor gain +1 in the Mentor’s highest non-HP stat for one turn.\n\n**Rank II:** Duration becomes two turns.\n\n**Evolution — Senior Mentor:** Every other occupied slot receives the one-turn bonus.\n\n**Evolution — Balanced Tutelage:** One adjacent slot receives the Mentor’s highest offensive stat; the other receives its highest defensive stat.",
  },
  {
    id: "copycat-heart",
    number: 18,
    name: "Copycat Heart",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The first positive stat increase received by an enemy each battle is copied by the selected Pokémon.",
    rankTwo: "The first two increases are copied.",
    evolutions: [
      {
        id: "better-than-you",
        name: "Better Than You",
        description: "Copied increases gain one additional stage, subject to the normal cap.",
      },
      {
        id: "shared-inspiration",
        name: "Shared Inspiration",
        description: "The first copied boost is also granted to one random adjacent ally.",
      },
    ],
    fullDescription:
      "**Base:** The first positive stat increase received by an enemy each battle is copied by the selected Pokémon.\n\n**Rank II:** The first two increases are copied.\n\n**Evolution — Better Than You:** Copied increases gain one additional stage, subject to the normal cap.\n\n**Evolution — Shared Inspiration:** The first copied boost is also granted to one random adjacent ally.",
  },
  {
    id: "mithridatism",
    number: 19,
    name: "Mithridatism",
    rarity: "ultra",
    scope: "Pokémon with permanent status progression",
    targetKind: "pokemon",
    base: "The Pokémon tracks every major status it suffers and subsequently cures. After curing the same status three times, it gains permanent Resistance I against that status: a 50% chance to prevent that status before it is applied. Burn, Poison, Toxic, Paralysis, Sleep, and Frostbite are tracked separately.",
    rankTwo: "Every successful cure heals 10% HP.\n\nAfter six cures of the same status, choose an evolution:",
    evolutions: [
      {
        id: "acquired-immunity",
        name: "Acquired Immunity",
        description: "The Pokémon becomes immune to that status.",
      },
      {
        id: "weaponized-affliction",
        name: "Weaponized Affliction",
        description:
          "Resistance I becomes Resistance II, a 75% chance to prevent that status. If the status is applied, the Pokémon gains 25% damage plus 20% damage reduction while afflicted.",
      },
    ],
    fullDescription:
      "**Base:** The Pokémon tracks every major status it suffers and subsequently cures. After curing the same status three times, it gains permanent Resistance I against that status: a 50% chance to prevent that status before it is applied. Burn, Poison, Toxic, Paralysis, Sleep, and Frostbite are tracked separately.\n\n**Rank II:** Every successful cure heals 10% HP.\n\nAfter six cures of the same status, choose an evolution:\n\n**Evolution — Acquired Immunity:** The Pokémon becomes immune to that status.\n\n**Evolution — Weaponized Affliction:** Resistance I becomes Resistance II, a 75% chance to prevent that status. If the status is applied, the Pokémon gains 25% damage plus 20% damage reduction while afflicted.",
  },
  {
    id: "heirloom-bearer",
    number: 20,
    name: "Heirloom Bearer",
    rarity: "ultra",
    scope: "Pokémon plus item stack",
    targetKind: "item-stack",
    base: "Select one exact held-item stack. Its numerical or trigger-based effect becomes 25% stronger and it cannot be stolen or suppressed.",
    rankTwo: "Amplification becomes 40%.",
    evolutions: [
      {
        id: "living-heirloom",
        name: "Living Heirloom",
        description: "Its first eligible activation each battle triggers twice.",
      },
      {
        id: "family-treasury",
        name: "Family Treasury",
        description: "A second selected item stack receives 20% amplification and suppression protection.",
      },
    ],
    fullDescription:
      "**Base:** Select one exact held-item stack. Its numerical or trigger-based effect becomes 25% stronger and it cannot be stolen or suppressed.\n\n**Rank II:** Amplification becomes 40%.\n\n**Evolution — Living Heirloom:** Its first eligible activation each battle triggers twice.\n\n**Evolution — Family Treasury:** A second selected item stack receives 20% amplification and suppression protection.",
  },
  {
    id: "parting-gift",
    number: 21,
    name: "Parting Gift",
    rarity: "great",
    scope: "slot",
    targetKind: "slot",
    base: "The first voluntary switch out of the marked slot each battle heals the incoming Pokémon by 10% and removes one volatile condition.",
    rankTwo: "Healing becomes 15%, and one negative stat stage is removed.",
    evolutions: [
      {
        id: "keepsake",
        name: "Keepsake",
        description: "The incoming Pokémon also inherits one random positive stat stage.",
      },
      {
        id: "parting-doctrine",
        name: "Parting Doctrine",
        description: "The first voluntary switch by every party member heals the incoming Pokémon by 8%.",
      },
    ],
    fullDescription:
      "**Base:** The first voluntary switch out of the marked slot each battle heals the incoming Pokémon by 10% and removes one volatile condition.\n\n**Rank II:** Healing becomes 15%, and one negative stat stage is removed.\n\n**Evolution — Keepsake:** The incoming Pokémon also inherits one random positive stat stage.\n\n**Evolution — Parting Doctrine:** The first voluntary switch by every party member heals the incoming Pokémon by 8%.",
  },
  {
    id: "counterrotation",
    number: 22,
    name: "Counterrotation",
    rarity: "ultra",
    scope: "incoming slot",
    targetKind: "slot",
    base: "When the marked slot receives a Pokémon after another ally was damaged earlier during the same turn, the incoming Pokémon takes 25% less damage until the turn ends.",
    rankTwo: "Reduction becomes 40%.",
    evolutions: [
      {
        id: "perfect-counterstep",
        name: "Perfect Counterstep",
        description: "Its next move also gains +1 priority.",
      },
      {
        id: "counterrotation-doctrine",
        name: "Counterrotation Doctrine",
        description:
          "Every ally can receive 20% same-turn damage reduction once per battle when switching in under those conditions.",
      },
    ],
    fullDescription:
      "**Base:** When the marked slot receives a Pokémon after another ally was damaged earlier during the same turn, the incoming Pokémon takes 25% less damage until the turn ends.\n\n**Rank II:** Reduction becomes 40%.\n\n**Evolution — Perfect Counterstep:** Its next move also gains +1 priority.\n\n**Evolution — Counterrotation Doctrine:** Every ally can receive 20% same-turn damage reduction once per battle when switching in under those conditions.",
  },
  {
    id: "tag-combo",
    number: 23,
    name: "Tag Combo",
    rarity: "rogue",
    scope: "Pokémon pair",
    targetKind: "pokemon-pair",
    base: "Mark two Pokémon. When switching directly from one partner to the other, the incoming Pokémon’s next damaging move borrows one randomly selected eligible secondary effect from a damaging move known by the outgoing partner. That borrowed effect is guaranteed.\n\nRestrictions:\n\n* Status moves never contribute.\n* Only effects tagged as safely borrowable qualify.\n* Form changes, revival, one-hit-KO logic, omniboosts, and structural move effects are excluded.\n* If no eligible damaging move exists, the trigger remains unused.\n* Base version triggers once total per battle.",
    rankTwo: "It can trigger once in each direction.",
    evolutions: [
      {
        id: "relay-chemistry",
        name: "Relay Chemistry",
        description: "The borrowed secondary applies to the next two eligible damaging moves.",
      },
      {
        id: "double-tag",
        name: "Double Tag",
        description: "The incoming move also produces a 20% echo using the outgoing partner’s offensive stat.",
      },
    ],
    fullDescription:
      "**Base:** Mark two Pokémon. When switching directly from one partner to the other, the incoming Pokémon’s next damaging move borrows one randomly selected eligible secondary effect from a damaging move known by the outgoing partner. That borrowed effect is guaranteed.\n\nRestrictions:\n\n* Status moves never contribute.\n* Only effects tagged as safely borrowable qualify.\n* Form changes, revival, one-hit-KO logic, omniboosts, and structural move effects are excluded.\n* If no eligible damaging move exists, the trigger remains unused.\n* Base version triggers once total per battle.\n\n**Rank II:** It can trigger once in each direction.\n\n**Evolution — Relay Chemistry:** The borrowed secondary applies to the next two eligible damaging moves.\n\n**Evolution — Double Tag:** The incoming move also produces a 20% echo using the outgoing partner’s offensive stat.",
  },
  {
    id: "hold-the-line",
    number: 24,
    name: "Hold the Line",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "After remaining active for three complete turns, the Pokémon gains +1 Defense and Special Defense and becomes immune to forced switching until it leaves the field.",
    rankTwo: "It activates after two complete turns.",
    evolutions: [
      {
        id: "entrenched",
        name: "Entrenched",
        description: "The defensive bonuses become +2.",
      },
      {
        id: "bulwark",
        name: "Bulwark",
        description: "While entrenched, the first ally switching in behind it gains a 20% barrier.",
      },
    ],
    fullDescription:
      "**Base:** After remaining active for three complete turns, the Pokémon gains +1 Defense and Special Defense and becomes immune to forced switching until it leaves the field.\n\n**Rank II:** It activates after two complete turns.\n\n**Evolution — Entrenched:** The defensive bonuses become +2.\n\n**Evolution — Bulwark:** While entrenched, the first ally switching in behind it gains a 20% barrier.",
  },
  {
    id: "revenge-entry",
    number: 25,
    name: "Revenge Entry",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Entering immediately after an ally faints grants +1 Speed and 20% move power for two turns.",
    rankTwo: "It also grants +1 in the Pokémon’s highest offensive stat.",
    evolutions: [
      {
        id: "vengeful-sweep",
        name: "Vengeful Sweep",
        description: "Scoring a KO during the window extends the effect by one turn.",
      },
      {
        id: "protective-revenge",
        name: "Protective Revenge",
        description: "The power bonus is replaced by a 30% barrier and a full volatile-condition cleanse.",
      },
    ],
    fullDescription:
      "**Base:** Entering immediately after an ally faints grants +1 Speed and 20% move power for two turns.\n\n**Rank II:** It also grants +1 in the Pokémon’s highest offensive stat.\n\n**Evolution — Vengeful Sweep:** Scoring a KO during the window extends the effect by one turn.\n\n**Evolution — Protective Revenge:** The power bonus is replaced by a 30% barrier and a full volatile-condition cleanse.",
  },
  {
    id: "turntable",
    number: 26,
    name: "Turntable",
    rarity: "rogue",
    scope: "team rhythm rule",
    targetKind: "rule",
    base: "Turns alternate between:\n\n* **Offbeat:** 15% increased outgoing damage.\n* **Downbeat:** 15% reduced incoming damage.",
    rankTwo: "Both modifiers become 20%.",
    evolutions: [
      {
        id: "syncopation",
        name: "Syncopation",
        description:
          "The first move used on Offbeat gains +1 priority; the first status received on Downbeat is negated.",
      },
      {
        id: "double-time",
        name: "Double Time",
        description: "Each beat lasts two turns and provides a stronger 25% modifier.",
      },
    ],
    fullDescription:
      "**Base:** Turns alternate between:\n\n* **Offbeat:** 15% increased outgoing damage.\n* **Downbeat:** 15% reduced incoming damage.\n\n**Rank II:** Both modifiers become 20%.\n\n**Evolution — Syncopation:** The first move used on Offbeat gains +1 priority; the first status received on Downbeat is negated.\n\n**Evolution — Double Time:** Each beat lasts two turns and provides a stronger 25% modifier.",
  },
  {
    id: "countermelody",
    number: 27,
    name: "Countermelody",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "When the opponent uses the same move twice consecutively, the selected Pokémon’s next different move gains +1 priority, cannot miss, and deals 20% more damage.",
    rankTwo: "The trigger can occur twice per battle.",
    evolutions: [
      {
        id: "dissonance",
        name: "Dissonance",
        description: "The repeated enemy move’s secondary effects are suppressed on its next use.",
      },
      {
        id: "call-and-response",
        name: "Call and Response",
        description: "Every ally can trigger a weaker version once per battle.",
      },
    ],
    fullDescription:
      "**Base:** When the opponent uses the same move twice consecutively, the selected Pokémon’s next different move gains +1 priority, cannot miss, and deals 20% more damage.\n\n**Rank II:** The trigger can occur twice per battle.\n\n**Evolution — Dissonance:** The repeated enemy move’s secondary effects are suppressed on its next use.\n\n**Evolution — Call and Response:** Every ally can trigger a weaker version once per battle.",
  },
  {
    id: "type-echo",
    number: 28,
    name: "Type Echo",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "If the previous allied damaging action came from a different Pokémon and used the same elemental type, the selected Pokémon’s next damaging move produces a 25% echo.",
    rankTwo: "Echo becomes 35%.",
    evolutions: [
      {
        id: "resonant-pair",
        name: "Resonant Pair",
        description: "Bind the effect to two Pokémon; either partner can trigger a 50% echo after the other.",
      },
      {
        id: "type-choir",
        name: "Type Choir",
        description: "The effect becomes team-wide at 20% echo power.",
      },
    ],
    fullDescription:
      "**Base:** If the previous allied damaging action came from a different Pokémon and used the same elemental type, the selected Pokémon’s next damaging move produces a 25% echo.\n\n**Rank II:** Echo becomes 35%.\n\n**Evolution — Resonant Pair:** Bind the effect to two Pokémon; either partner can trigger a 50% echo after the other.\n\n**Evolution — Type Choir:** The effect becomes team-wide at 20% echo power.",
  },
  {
    id: "off-brand-genius",
    number: 29,
    name: "Off-Brand Genius",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Non-STAB damaging moves used by the selected Pokémon gain 20% power.",
    rankTwo: "Bonus becomes 30%.",
    evolutions: [
      {
        id: "polymath",
        name: "Polymath",
        description: "Non-STAB moves also receive improved accuracy and secondary-effect probability.",
      },
      {
        id: "off-brand-doctrine",
        name: "Off-Brand Doctrine",
        description: "Every ally receives a 15% non-STAB damage bonus.",
      },
    ],
    fullDescription:
      "**Base:** Non-STAB damaging moves used by the selected Pokémon gain 20% power.\n\n**Rank II:** Bonus becomes 30%.\n\n**Evolution — Polymath:** Non-STAB moves also receive improved accuracy and secondary-effect probability.\n\n**Evolution — Off-Brand Doctrine:** Every ally receives a 15% non-STAB damage bonus.",
  },
  {
    id: "specialist-s-focus",
    number: 30,
    name: "Specialist’s Focus",
    rarity: "great",
    scope: "Pokémon plus elemental type",
    targetKind: "pokemon-type",
    base: "Select one elemental type. The Pokémon’s moves of that type gain 20% power; all of its other damaging move types lose 5%.",
    rankTwo: "Selected type becomes +35%; other types become −10%.",
    evolutions: [
      {
        id: "fanatic",
        name: "Fanatic",
        description: "Selected type becomes +55%; other types become −15%.",
      },
      {
        id: "specialist-doctrine",
        name: "Specialist Doctrine",
        description: "Every ally receives +15% for the selected type and −5% for other damaging types.",
      },
    ],
    fullDescription:
      "**Base:** Select one elemental type. The Pokémon’s moves of that type gain 20% power; all of its other damaging move types lose 5%.\n\n**Rank II:** Selected type becomes +35%; other types become −10%.\n\n**Evolution — Fanatic:** Selected type becomes +55%; other types become −15%.\n\n**Evolution — Specialist Doctrine:** Every ally receives +15% for the selected type and −5% for other damaging types.",
  },
  {
    id: "conservation-law",
    number: 31,
    name: "Conservation Law",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The Pokémon’s moves become stronger as their remaining PP decreases:\n\n* Below half PP: +8%\n* At or below one-quarter: +20%\n* Final PP: +35%",
    rankTwo: "Bonuses become +15%, +30%, and +50%.",
    evolutions: [
      {
        id: "final-reserve",
        name: "Final Reserve",
        description: "Final PP gains 100% power and guarantees one eligible secondary effect.",
      },
      {
        id: "conservation-doctrine",
        name: "Conservation Doctrine",
        description: "Every ally receives a weaker +5%, +15%, and +30% version.",
      },
    ],
    fullDescription:
      "**Base:** The Pokémon’s moves become stronger as their remaining PP decreases:\n\n* Below half PP: +8%\n* At or below one-quarter: +20%\n* Final PP: +35%\n\n**Rank II:** Bonuses become +15%, +30%, and +50%.\n\n**Evolution — Final Reserve:** Final PP gains 100% power and guarantees one eligible secondary effect.\n\n**Evolution — Conservation Doctrine:** Every ally receives a weaker +5%, +15%, and +30% version.",
  },
  {
    id: "deep-reservoir",
    number: 32,
    name: "Deep Reservoir",
    rarity: "great",
    scope: "exact move",
    targetKind: "move",
    base: "The selected move gains 3 maximum PP. Every fifth use restores 1 PP to the Pokémon’s most depleted other move.",
    rankTwo: "It gains 5 PP and triggers every fourth use.",
    evolutions: [
      {
        id: "artesian-move",
        name: "Artesian Move",
        description: "The restoration grants 1 PP to every depleted other move.",
      },
      {
        id: "deep-wells",
        name: "Deep Wells",
        description: "Every move gains 2 maximum PP, while the selected move retains the restoration trigger.",
      },
    ],
    fullDescription:
      "**Base:** The selected move gains 3 maximum PP. Every fifth use restores 1 PP to the Pokémon’s most depleted other move.\n\n**Rank II:** It gains 5 PP and triggers every fourth use.\n\n**Evolution — Artesian Move:** The restoration grants 1 PP to every depleted other move.\n\n**Evolution — Deep Wells:** Every move gains 2 maximum PP, while the selected move retains the restoration trigger.",
  },
  {
    id: "full-repertoire",
    number: 33,
    name: "Full Repertoire",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The first use each battle of a Physical, Special, and Status move rolls a non-repeating reward from a broad pool:\n\n* 20% barrier\n* Heal 20%\n* Restore 3 total PP\n* Remove one major status or volatile condition\n* +1 random stat\n* Next move gains +1 priority\n* Next damaging move guarantees an eligible secondary effect\n* Temporary resistance to the last damaging type received\n\nUsing all three categories triggers **Curtain Call**, rolling two additional rewards.\n\nOnly Pokémon that can use all three move categories, or can realistically learn them, are eligible.",
    rankTwo: "Reward magnitudes increase by approximately 25%.",
    evolutions: [
      {
        id: "virtuoso",
        name: "Virtuoso",
        description: "Curtain Call triggers after two categories, while using all three grants another reward.",
      },
      {
        id: "repertoire-doctrine",
        name: "Repertoire Doctrine",
        description:
          "Every party member receives a reduced version, but only one category reward per category per battle.",
      },
    ],
    fullDescription:
      "**Base:** The first use each battle of a Physical, Special, and Status move rolls a non-repeating reward from a broad pool:\n\n* 20% barrier\n* Heal 20%\n* Restore 3 total PP\n* Remove one major status or volatile condition\n* +1 random stat\n* Next move gains +1 priority\n* Next damaging move guarantees an eligible secondary effect\n* Temporary resistance to the last damaging type received\n\nUsing all three categories triggers **Curtain Call**, rolling two additional rewards.\n\nOnly Pokémon that can use all three move categories, or can realistically learn them, are eligible.\n\n**Rank II:** Reward magnitudes increase by approximately 25%.\n\n**Evolution — Virtuoso:** Curtain Call triggers after two categories, while using all three grants another reward.\n\n**Evolution — Repertoire Doctrine:** Every party member receives a reduced version, but only one category reward per category per battle.",
  },
  {
    id: "refrain",
    number: 34,
    name: "Refrain",
    rarity: "ultra",
    scope: "exact move",
    targetKind: "move",
    base: "Consecutive use of the selected move escalates both power and PP cost:\n\n| Consecutive use | Power | PP cost |\n| --------------- | ----: | ------: |\n| First           |  100% |       1 |\n| Second          |  120% |       2 |\n| Third           |  145% |       3 |\n| Fourth+         |  175% |       4 |\n\nUsing another move, switching, missing, or failing resets the sequence.",
    rankTwo: "Maximum power becomes 200%.",
    evolutions: [
      {
        id: "crescendo",
        name: "Crescendo",
        description: "Later repetitions reach still higher power, with unchanged PP escalation.",
      },
      {
        id: "efficient-refrain",
        name: "Efficient Refrain",
        description: "PP costs become 1/1/2/3, but maximum power remains 175%.",
      },
    ],
    fullDescription:
      "**Base:** Consecutive use of the selected move escalates both power and PP cost:\n\n| Consecutive use | Power | PP cost |\n| --------------- | ----: | ------: |\n| First           |  100% |       1 |\n| Second          |  120% |       2 |\n| Third           |  145% |       3 |\n| Fourth+         |  175% |       4 |\n\nUsing another move, switching, missing, or failing resets the sequence.\n\n**Rank II:** Maximum power becomes 200%.\n\n**Evolution — Crescendo:** Later repetitions reach still higher power, with unchanged PP escalation.\n\n**Evolution — Efficient Refrain:** PP costs become 1/1/2/3, but maximum power remains 175%.",
  },
  {
    id: "failure-is-data",
    number: 35,
    name: "Failure Is Data",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The first move each battle that misses, fails, or hits an immunity refunds its PP, grants +1 Speed, and makes the Pokémon’s next move unable to miss.",
    rankTwo: "Two activations per battle.",
    evolutions: [
      {
        id: "scientific-method",
        name: "Scientific Method",
        description: "The next eligible secondary effect is also guaranteed.",
      },
      {
        id: "team-research",
        name: "Team Research",
        description: "Every allied Pokémon can trigger the base effect once per battle.",
      },
    ],
    fullDescription:
      "**Base:** The first move each battle that misses, fails, or hits an immunity refunds its PP, grants +1 Speed, and makes the Pokémon’s next move unable to miss.\n\n**Rank II:** Two activations per battle.\n\n**Evolution — Scientific Method:** The next eligible secondary effect is also guaranteed.\n\n**Evolution — Team Research:** Every allied Pokémon can trigger the base effect once per battle.",
  },
  {
    id: "overdraft",
    number: 36,
    name: "Overdraft",
    rarity: "ultra",
    scope: "exact move",
    targetKind: "move",
    base: "The selected move may be used at zero PP once per battle by paying 20% maximum HP. The overdrawn use gains 30% power and guarantees one eligible secondary effect.",
    rankTwo: "HP cost becomes 15%; power bonus becomes 45%.",
    evolutions: [
      {
        id: "blood-credit",
        name: "Blood Credit",
        description: "It may be overdrawn twice, but the second use costs 30% maximum HP.",
      },
      {
        id: "emergency-funding",
        name: "Emergency Funding",
        description: "Any move can be overdrawn once per battle, but the guaranteed secondary effect is removed.",
      },
    ],
    fullDescription:
      "**Base:** The selected move may be used at zero PP once per battle by paying 20% maximum HP. The overdrawn use gains 30% power and guarantees one eligible secondary effect.\n\n**Rank II:** HP cost becomes 15%; power bonus becomes 45%.\n\n**Evolution — Blood Credit:** It may be overdrawn twice, but the second use costs 30% maximum HP.\n\n**Evolution — Emergency Funding:** Any move can be overdrawn once per battle, but the guaranteed secondary effect is removed.",
  },
  {
    id: "final-draft",
    number: 37,
    name: "Final Draft",
    rarity: "rogue",
    scope: "exact move",
    targetKind: "move",
    base: "When the selected move reaches its final PP, choose one ending:\n\n* **Climax:** +100% power.\n* **Precision:** perfect accuracy and guaranteed eligible secondary effect.\n* **Revision:** normal use, then restore 2 PP by paying 15% maximum HP.\n\nBecause this choice happens only at a highly specific moment, it is acceptable despite minimizing routine battle pop-ups.",
    rankTwo: "Climax becomes +130%, Revision restores 3 PP, and Precision also gains 20% power.",
    evolutions: [
      {
        id: "director-s-cut",
        name: "Director’s Cut",
        description: "Choose two endings, but the move becomes unusable for the rest of that battle afterward.",
      },
      {
        id: "collected-works",
        name: "Collected Works",
        description: "Every move can trigger a weaker Final Draft once per battle.",
      },
    ],
    fullDescription:
      "**Base:** When the selected move reaches its final PP, choose one ending:\n\n* **Climax:** +100% power.\n* **Precision:** perfect accuracy and guaranteed eligible secondary effect.\n* **Revision:** normal use, then restore 2 PP by paying 15% maximum HP.\n\nBecause this choice happens only at a highly specific moment, it is acceptable despite minimizing routine battle pop-ups.\n\n**Rank II:** Climax becomes +130%, Revision restores 3 PP, and Precision also gains 20% power.\n\n**Evolution — Director’s Cut:** Choose two endings, but the move becomes unusable for the rest of that battle afterward.\n\n**Evolution — Collected Works:** Every move can trigger a weaker Final Draft once per battle.",
  },
  {
    id: "prismatic-opening",
    number: 38,
    name: "Prismatic Opening",
    rarity: "rogue",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The selected Pokémon’s first damaging move each battle becomes the most effective legal elemental type against its target, but deals 30% less damage.\n\nExplicit type immunities still apply.",
    rankTwo: "Penalty becomes 20%.",
    evolutions: [
      {
        id: "perfect-refraction",
        name: "Perfect Refraction",
        description: "The penalty is removed.",
      },
      {
        id: "prismatic-doctrine",
        name: "Prismatic Doctrine",
        description: "Every allied Pokémon receives one use, but at a 35% penalty.",
      },
    ],
    fullDescription:
      "**Base:** The selected Pokémon’s first damaging move each battle becomes the most effective legal elemental type against its target, but deals 30% less damage.\n\nExplicit type immunities still apply.\n\n**Rank II:** Penalty becomes 20%.\n\n**Evolution — Perfect Refraction:** The penalty is removed.\n\n**Evolution — Prismatic Doctrine:** Every allied Pokémon receives one use, but at a 35% penalty.",
  },
  {
    id: "elemental-dividend",
    number: 39,
    name: "Elemental Dividend",
    rarity: "rogue",
    scope: "team",
    targetKind: "team",
    base: "The first time each allied Pokémon exploits an elemental weakness during a battle, it gains a 20% barrier. Exploiting a 4× weakness creates a 40% barrier.",
    rankTwo: "Values become 25% and 50%.",
    evolutions: [
      {
        id: "diversified-portfolio",
        name: "Diversified Portfolio",
        description: "The Pokémon may trigger again by exploiting a different weakness type.",
      },
      {
        id: "compound-elements",
        name: "Compound Elements",
        description:
          "Barrier above 100% maximum HP converts into healing. Any amount left after reaching full HP grants the next damaging move up to 50% more power, at one percentage point per 1% maximum HP converted.",
      },
    ],
    fullDescription:
      "**Base:** The first time each allied Pokémon exploits an elemental weakness during a battle, it gains a 20% barrier. Exploiting a 4× weakness creates a 40% barrier.\n\n**Rank II:** Values become 25% and 50%.\n\n**Evolution — Diversified Portfolio:** The Pokémon may trigger again by exploiting a different weakness type.\n\n**Evolution — Compound Elements:** Barrier above 100% maximum HP converts into healing. Any amount left after reaching full HP grants the next damaging move up to 50% more power, at one percentage point per 1% maximum HP converted.",
  },
  {
    id: "chromatic-relay",
    number: 40,
    name: "Chromatic Relay",
    rarity: "rogue",
    scope: "team sequence",
    targetKind: "team",
    base: "Consecutive allied damaging moves using distinct elemental types gain:\n\n* Second distinct type: +15%\n* Third: +40%\n* Fourth: +90%\n\nRepeating a type resets the chain. Switching does not.",
    rankTwo: "Missing or failing no longer resets the chain; only repeating a type does.",
    evolutions: [
      {
        id: "spectrum-break",
        name: "Spectrum Break",
        description:
          "The fourth distinct move also ignores 25% of the target’s defenses and guarantees an eligible secondary effect.",
      },
      {
        id: "endless-spectrum",
        name: "Endless Spectrum",
        description: "Every additional new type after the fourth remains at +90% and heals the acting Pokémon by 10%.",
      },
    ],
    fullDescription:
      "**Base:** Consecutive allied damaging moves using distinct elemental types gain:\n\n* Second distinct type: +15%\n* Third: +40%\n* Fourth: +90%\n\nRepeating a type resets the chain. Switching does not.\n\n**Rank II:** Missing or failing no longer resets the chain; only repeating a type does.\n\n**Evolution — Spectrum Break:** The fourth distinct move also ignores 25% of the target’s defenses and guarantees an eligible secondary effect.\n\n**Evolution — Endless Spectrum:** Every additional new type after the fourth remains at +90% and heals the acting Pokémon by 10%.",
  },
  {
    id: "microclimate",
    number: 41,
    name: "Microclimate",
    rarity: "ultra",
    scope: "slot",
    targetKind: "slot",
    base: "On the marked slot’s first entry each battle, choose one of three seeded weather options. The selected weather lasts three turns.",
    rankTwo: "Four weather options and four turns.",
    evolutions: [
      {
        id: "stormglass-heart",
        name: "Stormglass Heart",
        description: "All available weather conditions are offered and last five turns.",
      },
      {
        id: "mobile-front",
        name: "Mobile Front",
        description:
          "The effect can activate a second time after the occupant leaves and re-enters, but each weather lasts only three turns.",
      },
    ],
    fullDescription:
      "**Base:** On the marked slot’s first entry each battle, choose one of three seeded weather options. The selected weather lasts three turns.\n\n**Rank II:** Four weather options and four turns.\n\n**Evolution — Stormglass Heart:** All available weather conditions are offered and last five turns.\n\n**Evolution — Mobile Front:** The effect can activate a second time after the occupant leaves and re-enters, but each weather lasts only three turns.",
  },
  {
    id: "eye-of-the-storm",
    number: 42,
    name: "Eye of the Storm",
    rarity: "rogue",
    scope: "team/weather",
    targetKind: "field",
    base: "Once per battle, when weather naturally ends or is replaced, the active Pokémon heals 30% and restores 5 total PP, distributed to its most depleted moves.",
    rankTwo: "Healing becomes 40%; PP restoration becomes 8.",
    evolutions: [
      {
        id: "calm-center",
        name: "Calm Center",
        description: "It also gains a 25% barrier.",
      },
      {
        id: "storm-communion",
        name: "Storm Communion",
        description: "The effect can trigger twice, and the lowest-HP benched ally heals 15%.",
      },
    ],
    fullDescription:
      "**Base:** Once per battle, when weather naturally ends or is replaced, the active Pokémon heals 30% and restores 5 total PP, distributed to its most depleted moves.\n\n**Rank II:** Healing becomes 40%; PP restoration becomes 8.\n\n**Evolution — Calm Center:** It also gains a 25% barrier.\n\n**Evolution — Storm Communion:** The effect can trigger twice, and the lowest-HP benched ally heals 15%.",
  },
  {
    id: "climate-contrarian",
    number: 43,
    name: "Climate Contrarian",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Moves used by the selected Pokémon that would normally be weakened by the current weather ignore that penalty and instead gain 10% power.",
    rankTwo: "Bonus becomes 20%.",
    evolutions: [
      {
        id: "perverse-climate",
        name: "Perverse Climate",
        description: "These moves are treated as weather-boosted for relevant interactions and secondary mechanics.",
      },
      {
        id: "contrarian-doctrine",
        name: "Contrarian Doctrine",
        description: "Every ally receives the 10% version.",
      },
    ],
    fullDescription:
      "**Base:** Moves used by the selected Pokémon that would normally be weakened by the current weather ignore that penalty and instead gain 10% power.\n\n**Rank II:** Bonus becomes 20%.\n\n**Evolution — Perverse Climate:** These moves are treated as weather-boosted for relevant interactions and secondary mechanics.\n\n**Evolution — Contrarian Doctrine:** Every ally receives the 10% version.",
  },
  {
    id: "terrain-weaver",
    number: 44,
    name: "Terrain Weaver",
    rarity: "ultra",
    scope: "grounded slot",
    targetKind: "slot",
    base: "On the marked grounded slot’s first entry, choose one of three seeded terrain options. It lasts three turns.",
    rankTwo: "Four turns and access to every normal terrain option.",
    evolutions: [
      {
        id: "landshaper",
        name: "Landshaper",
        description: "It can activate a second time after re-entry.",
      },
      {
        id: "territorial-claim",
        name: "Territorial Claim",
        description: "Benefits provided by the chosen terrain are 25% stronger for the player’s side.",
      },
    ],
    fullDescription:
      "**Base:** On the marked grounded slot’s first entry, choose one of three seeded terrain options. It lasts three turns.\n\n**Rank II:** Four turns and access to every normal terrain option.\n\n**Evolution — Landshaper:** It can activate a second time after re-entry.\n\n**Evolution — Territorial Claim:** Benefits provided by the chosen terrain are 25% stronger for the player’s side.",
  },
  {
    id: "four-seasons",
    number: 45,
    name: "Four Seasons",
    rarity: "rogue",
    scope: "field rule",
    targetKind: "field",
    base: "The battlefield cycles through Sun, Rain, Sand, and Snow every four turns, with a one-turn warning. Each transition heals the active Pokémon by 5%.",
    rankTwo: "Transitions occur every three turns and heal 8%.",
    evolutions: [
      {
        id: "five-seasons",
        name: "Five Seasons",
        description: "Fog joins the cycle and every weather receives a distinct transition effect.",
      },
      {
        id: "seasonal-memory",
        name: "Seasonal Memory",
        description:
          "For one turn after a transition, the active Pokémon retains the outgoing weather’s beneficial effects in addition to the new weather.",
      },
    ],
    fullDescription:
      "**Base:** The battlefield cycles through Sun, Rain, Sand, and Snow every four turns, with a one-turn warning. Each transition heals the active Pokémon by 5%.\n\n**Rank II:** Transitions occur every three turns and heal 8%.\n\n**Evolution — Five Seasons:** Fog joins the cycle and every weather receives a distinct transition effect.\n\n**Evolution — Seasonal Memory:** For one turn after a transition, the active Pokémon retains the outgoing weather’s beneficial effects in addition to the new weather.",
  },
  {
    id: "battlefield-memory",
    number: 46,
    name: "Battlefield Memory",
    rarity: "master",
    scope: "cross-battle field state",
    targetKind: "field",
    base: "Permitted weather, terrain, hazards, and side conditions present at the end of a trainer battle persist for exactly one turn of the next trainer battle.\n\nEnemy setters can immediately replace them. Scripted biome weather, form-controller states, and explicitly nonpersistent effects are excluded.",
    rankTwo: "Persistence becomes two turns.",
    evolutions: [
      {
        id: "home-field-memory",
        name: "Home-Field Memory",
        description: "Carried beneficial effects operate 25% more strongly for the player.",
      },
      {
        id: "selective-memory",
        name: "Selective Memory",
        description: "Harmful player-side hazards and conditions are not carried.",
      },
    ],
    fullDescription:
      "**Base:** Permitted weather, terrain, hazards, and side conditions present at the end of a trainer battle persist for exactly one turn of the next trainer battle.\n\nEnemy setters can immediately replace them. Scripted biome weather, form-controller states, and explicitly nonpersistent effects are excluded.\n\n**Rank II:** Persistence becomes two turns.\n\n**Evolution — Home-Field Memory:** Carried beneficial effects operate 25% more strongly for the player.\n\n**Evolution — Selective Memory:** Harmful player-side hazards and conditions are not carried.",
  },
  {
    id: "weather-wake",
    number: 47,
    name: "Weather Wake",
    rarity: "ultra",
    scope: "weather transition",
    targetKind: "field",
    base: "Replacing or ending weather creates a final aftereffect:\n\n* **Sun:** The next Fire move gains 30% power.\n* **Rain:** The active Pokémon heals 15%.\n* **Sand:** The player receives a one-turn Reflect-like effect reducing physical damage by 25%.\n* **Snow:** The player receives a one-turn Light Screen-like effect reducing special damage by 25%.\n* **Fog:** The active Pokémon gains +1 Accuracy, and its next eligible secondary-effect chance increases by 20 percentage points.\n\nThe Sand and Snow effects are temporary directional screens, not absorbable HP barriers.",
    rankTwo: "Power, healing, and mitigation increase by approximately one-third.",
    evolutions: [
      {
        id: "lingering-wake",
        name: "Lingering Wake",
        description: "The aftereffect lasts two turns.",
      },
    ],
    fullDescription:
      "**Base:** Replacing or ending weather creates a final aftereffect:\n\n* **Sun:** The next Fire move gains 30% power.\n* **Rain:** The active Pokémon heals 15%.\n* **Sand:** The player receives a one-turn Reflect-like effect reducing physical damage by 25%.\n* **Snow:** The player receives a one-turn Light Screen-like effect reducing special damage by 25%.\n* **Fog:** The active Pokémon gains +1 Accuracy, and its next eligible secondary-effect chance increases by 20 percentage points.\n\nThe Sand and Snow effects are temporary directional screens, not absorbable HP barriers.\n\n**Rank II:** Power, healing, and mitigation increase by approximately one-third.\n\n**Evolution — Lingering Wake:** The aftereffect lasts two turns.",
  },
  {
    id: "adrenal-condition",
    number: 48,
    name: "Adrenal Condition",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The first major status received each battle grants +1 Speed and 15% increased damage while the status remains.",
    rankTwo: "It also grants +1 in the Pokémon’s highest offensive stat.",
    evolutions: [
      {
        id: "conditioned-athlete",
        name: "Conditioned Athlete",
        description: "Every distinct major status can trigger once per battle.",
      },
      {
        id: "adrenal-doctrine",
        name: "Adrenal Doctrine",
        description: "Every ally gains +1 Speed and 10% damage when first statused.",
      },
    ],
    fullDescription:
      "**Base:** The first major status received each battle grants +1 Speed and 15% increased damage while the status remains.\n\n**Rank II:** It also grants +1 in the Pokémon’s highest offensive stat.\n\n**Evolution — Conditioned Athlete:** Every distinct major status can trigger once per battle.\n\n**Evolution — Adrenal Doctrine:** Every ally gains +1 Speed and 10% damage when first statused.",
  },
  {
    id: "burning-resolve",
    number: 49,
    name: "Burning Resolve",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Burn no longer reduces the selected Pokémon’s Attack. While burned, it gains 20% Special Defense.",
    rankTwo: "It also gains 20% Attack.",
    evolutions: [
      {
        id: "cauterized",
        name: "Cauterized",
        description: "Burn damage is halved, and dealing direct damage heals 5%.",
      },
      {
        id: "burning-doctrine",
        name: "Burning Doctrine",
        description: "Every allied Pokémon ignores burn’s Attack reduction.",
      },
    ],
    fullDescription:
      "**Base:** Burn no longer reduces the selected Pokémon’s Attack. While burned, it gains 20% Special Defense.\n\n**Rank II:** It also gains 20% Attack.\n\n**Evolution — Cauterized:** Burn damage is halved, and dealing direct damage heals 5%.\n\n**Evolution — Burning Doctrine:** Every allied Pokémon ignores burn’s Attack reduction.",
  },
  {
    id: "toxic-bloom",
    number: 50,
    name: "Toxic Bloom",
    rarity: "rogue",
    scope: "team",
    targetKind: "team",
    base: "Poison cannot directly reduce an allied Pokémon below 1 HP. Poisoned allies deal 25% more damage. Scoring a KO resets the toxic counter to its first stage.\n\nPoison damage still occurs normally and still escalates until reset.",
    rankTwo: "Damage bonus becomes 35%.",
    evolutions: [
      {
        id: "venom-garden",
        name: "Venom Garden",
        description:
          "When a poisoned ally scores a KO, the replacement enemy becomes normally poisoned where legally possible.",
      },
      {
        id: "toxic-renewal",
        name: "Toxic Renewal",
        description: "Half of poison damage suffered becomes a temporary barrier after the damage resolves.",
      },
    ],
    fullDescription:
      "**Base:** Poison cannot directly reduce an allied Pokémon below 1 HP. Poisoned allies deal 25% more damage. Scoring a KO resets the toxic counter to its first stage.\n\nPoison damage still occurs normally and still escalates until reset.\n\n**Rank II:** Damage bonus becomes 35%.\n\n**Evolution — Venom Garden:** When a poisoned ally scores a KO, the replacement enemy becomes normally poisoned where legally possible.\n\n**Evolution — Toxic Renewal:** Half of poison damage suffered becomes a temporary barrier after the damage resolves.",
  },
  {
    id: "insomniac-dreams",
    number: 51,
    name: "Insomniac Dreams",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "While asleep, the selected Pokémon may continue using Status moves at −1 priority. Its maximum sleep duration is reduced by one turn.",
    rankTwo: "Status moves operate at normal priority.",
    evolutions: [
      {
        id: "lucid-dreamer",
        name: "Lucid Dreamer",
        description:
          "It may also use explicitly tagged dream, Psychic, or Ghost damaging moves at 50% power while asleep.",
      },
      {
        id: "shared-dream",
        name: "Shared Dream",
        description: "Whenever it successfully acts while asleep, one adjacent ally gains +1 in a random stat.",
      },
    ],
    fullDescription:
      "**Base:** While asleep, the selected Pokémon may continue using Status moves at −1 priority. Its maximum sleep duration is reduced by one turn.\n\n**Rank II:** Status moves operate at normal priority.\n\n**Evolution — Lucid Dreamer:** It may also use explicitly tagged dream, Psychic, or Ghost damaging moves at 50% power while asleep.\n\n**Evolution — Shared Dream:** Whenever it successfully acts while asleep, one adjacent ally gains +1 in a random stat.",
  },
  {
    id: "frostbound-time",
    number: 52,
    name: "Frostbound Time",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The first time each battle the selected Pokémon receives Frostbite, the condition’s penalties are suppressed and it gains a 25% barrier. It still counts as Frostbitten for synergies. Frostbite is cured when the barrier breaks or after two turns.",
    rankTwo: "Barrier becomes 35% and can last three turns.",
    evolutions: [
      {
        id: "permafrost-engine",
        name: "Permafrost Engine",
        description: "While the barrier remains, special damage increases by 25%.",
      },
      {
        id: "thaw-burst",
        name: "Thaw Burst",
        description:
          "When Frostbite is cured, the Pokémon heals 20% and its next move guarantees an eligible secondary effect.",
      },
    ],
    fullDescription:
      "**Base:** The first time each battle the selected Pokémon receives Frostbite, the condition’s penalties are suppressed and it gains a 25% barrier. It still counts as Frostbitten for synergies. Frostbite is cured when the barrier breaks or after two turns.\n\n**Rank II:** Barrier becomes 35% and can last three turns.\n\n**Evolution — Permafrost Engine:** While the barrier remains, special damage increases by 25%.\n\n**Evolution — Thaw Burst:** When Frostbite is cured, the Pokémon heals 20% and its next move guarantees an eligible secondary effect.",
  },
  {
    id: "shared-antibodies",
    number: 53,
    name: "Shared Antibodies",
    rarity: "rogue",
    scope: "team",
    targetKind: "team",
    base: "When any ally cures a major status, the entire team becomes immune to that status for three turns.",
    rankTwo: "Immunity lasts five turns.",
    evolutions: [
      {
        id: "herd-immunity",
        name: "Herd Immunity",
        description: "The initial cure also heals every conscious ally by 10%.",
      },
      {
        id: "adaptive-serum",
        name: "Adaptive Serum",
        description:
          "The first attempted application of that status during the immunity window is reflected onto its source.",
      },
    ],
    fullDescription:
      "**Base:** When any ally cures a major status, the entire team becomes immune to that status for three turns.\n\n**Rank II:** Immunity lasts five turns.\n\n**Evolution — Herd Immunity:** The initial cure also heals every conscious ally by 10%.\n\n**Evolution — Adaptive Serum:** The first attempted application of that status during the immunity window is reflected onto its source.",
  },
  {
    id: "status-bank",
    number: 54,
    name: "Status Bank",
    rarity: "master",
    scope: "team",
    targetKind: "team",
    base: "The first incoming major status each battle is stored rather than applied. The next damaging allied hit applies the stored status to its target where legal.\n\nIf the target is invalid, the status remains stored.",
    rankTwo: "The bank can store two statuses in order.",
    evolutions: [
      {
        id: "interest-bearing-status",
        name: "Interest-Bearing Status",
        description:
          "A status held for a full turn upgrades where applicable—for example, normal poison becomes toxic poison.",
      },
      {
        id: "joint-account",
        name: "Joint Account",
        description:
          "The first two incoming statuses are stored, and the next two valid damaging hits withdraw them separately.",
      },
    ],
    fullDescription:
      "**Base:** The first incoming major status each battle is stored rather than applied. The next damaging allied hit applies the stored status to its target where legal.\n\nIf the target is invalid, the status remains stored.\n\n**Rank II:** The bank can store two statuses in order.\n\n**Evolution — Interest-Bearing Status:** A status held for a full turn upgrades where applicable—for example, normal poison becomes toxic poison.\n\n**Evolution — Joint Account:** The first two incoming statuses are stored, and the next two valid damaging hits withdraw them separately.",
  },
  {
    id: "misery-loves-company",
    number: 55,
    name: "Misery Loves Company",
    rarity: "rogue",
    scope: "team",
    targetKind: "team",
    base: "Statused allies take 15% less damage from unstatused enemies and use Status moves with +1 priority.",
    rankTwo: "Damage reduction becomes 20%.",
    evolutions: [
      {
        id: "schadenfreude",
        name: "Schadenfreude",
        description: "Statused allies also deal 20% more damage to unstatused enemies.",
      },
      {
        id: "shared-misery",
        name: "Shared Misery",
        description: "When an ally first becomes statused, the lowest-HP other ally gains a 15% barrier.",
      },
    ],
    fullDescription:
      "**Base:** Statused allies take 15% less damage from unstatused enemies and use Status moves with +1 priority.\n\n**Rank II:** Damage reduction becomes 20%.\n\n**Evolution — Schadenfreude:** Statused allies also deal 20% more damage to unstatused enemies.\n\n**Evolution — Shared Misery:** When an ally first becomes statused, the lowest-HP other ally gains a 15% barrier.",
  },
  {
    id: "volatile-memory",
    number: 56,
    name: "Volatile Memory",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "After the selected Pokémon suffers a particular volatile condition—confusion, Taunt, Encore, flinching, and similar—it cannot receive that same condition again for the remainder of the battle.",
    rankTwo: "The initial volatile condition expires one turn earlier.",
    evolutions: [
      {
        id: "long-memory",
        name: "Long Memory",
        description: "The acquired immunity persists through the following battle.",
      },
      {
        id: "collective-memory",
        name: "Collective Memory",
        description:
          "Once one ally suffers a volatile condition, the entire team becomes immune to that condition for the remainder of the battle.",
      },
    ],
    fullDescription:
      "**Base:** After the selected Pokémon suffers a particular volatile condition—confusion, Taunt, Encore, flinching, and similar—it cannot receive that same condition again for the remainder of the battle.\n\n**Rank II:** The initial volatile condition expires one turn earlier.\n\n**Evolution — Long Memory:** The acquired immunity persists through the following battle.\n\n**Evolution — Collective Memory:** Once one ally suffers a volatile condition, the entire team becomes immune to that condition for the remainder of the battle.",
  },
  {
    id: "purge-pulse",
    number: 57,
    name: "Purge Pulse",
    rarity: "ultra",
    scope: "team action counter",
    targetKind: "team",
    base: "Every fifth allied action removes one negative stat stage, major status, or volatile condition from the active Pokémon and inflicts minor typeless damage on the enemy.",
    rankTwo: "Triggers every fourth action.",
    evolutions: [
      {
        id: "purifying-wave",
        name: "Purifying Wave",
        description: "It removes every effect from one selected category: stages, status, or volatiles.",
      },
      {
        id: "contaminant-burst",
        name: "Contaminant Burst",
        description: "Damage scales with the number and severity of effects removed.",
      },
    ],
    fullDescription:
      "**Base:** Every fifth allied action removes one negative stat stage, major status, or volatile condition from the active Pokémon and inflicts minor typeless damage on the enemy.\n\n**Rank II:** Triggers every fourth action.\n\n**Evolution — Purifying Wave:** It removes every effect from one selected category: stages, status, or volatiles.\n\n**Evolution — Contaminant Burst:** Damage scales with the number and severity of effects removed.",
  },
  {
    id: "aftercare",
    number: 58,
    name: "Aftercare",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Curing a major status grants a status-specific rebound:\n\n* Burn: +1 Attack.\n* Poison/Toxic: heal 20%.\n* Paralysis: +1 Speed.\n* Sleep: next action gains +1 priority.\n* Frostbite: gain a 25% barrier.",
    rankTwo:
      "Healing and barrier values increase, and stat rebounds last for the remainder of the current field appearance.",
    evolutions: [
      {
        id: "rehabilitation",
        name: "Rehabilitation",
        description: "Each distinct status can trigger its rebound once per battle.",
      },
      {
        id: "community-care",
        name: "Community Care",
        description:
          "Adjacent active allies receive half of the healing or barrier rebound. Their Attack or Speed rebound lasts one turn; the Sleep rebound still applies only to their next action.",
      },
    ],
    fullDescription:
      "**Base:** Curing a major status grants a status-specific rebound:\n\n* Burn: +1 Attack.\n* Poison/Toxic: heal 20%.\n* Paralysis: +1 Speed.\n* Sleep: next action gains +1 priority.\n* Frostbite: gain a 25% barrier.\n\n**Rank II:** Healing and barrier values increase, and stat rebounds last for the remainder of the current field appearance.\n\n**Evolution — Rehabilitation:** Each distinct status can trigger its rebound once per battle.\n\n**Evolution — Community Care:** Adjacent active allies receive half of the healing or barrier rebound. Their Attack or Speed rebound lasts one turn; the Sleep rebound still applies only to their next action.",
  },
  {
    id: "overflow-ward",
    number: 59,
    name: "Overflow Ward",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Excess healing received by the selected Pokémon becomes a barrier, maximum 25% of maximum HP.",
    rankTwo: "Maximum barrier becomes 40%.",
    evolutions: [
      {
        id: "reservoir",
        name: "Reservoir",
        description: "Barrier may reach 60%, but decays by 10% per turn above 40%.",
      },
      {
        id: "overflow-doctrine",
        name: "Overflow Doctrine",
        description: "Every ally receives the base effect with a 20% cap.",
      },
    ],
    fullDescription:
      "**Base:** Excess healing received by the selected Pokémon becomes a barrier, maximum 25% of maximum HP.\n\n**Rank II:** Maximum barrier becomes 40%.\n\n**Evolution — Reservoir:** Barrier may reach 60%, but decays by 10% per turn above 40%.\n\n**Evolution — Overflow Doctrine:** Every ally receives the base effect with a 20% cap.",
  },
  {
    id: "shared-cup",
    number: 60,
    name: "Shared Cup",
    rarity: "ultra",
    scope: "team",
    targetKind: "team",
    base: "Half of all excess healing is redirected to the lowest-HP benched ally.",
    rankTwo: "Redirected proportion becomes 75%.",
    evolutions: [
      {
        id: "communion",
        name: "Communion",
        description: "Healing is distributed among all damaged benched allies.",
      },
      {
        id: "overflow-vintage",
        name: "Overflow Vintage",
        description: "Excess redirected healing becomes barriers on the recipients.",
      },
    ],
    fullDescription:
      "**Base:** Half of all excess healing is redirected to the lowest-HP benched ally.\n\n**Rank II:** Redirected proportion becomes 75%.\n\n**Evolution — Communion:** Healing is distributed among all damaged benched allies.\n\n**Evolution — Overflow Vintage:** Excess redirected healing becomes barriers on the recipients.",
  },
  {
    id: "damage-ceiling",
    number: 61,
    name: "Damage Ceiling",
    rarity: "rogue",
    scope: "slot",
    targetKind: "slot",
    base: "The first hit each battle that would deal more than 60% of the occupant’s maximum HP is capped at 60%.",
    rankTwo: "Cap becomes 50%.",
    evolutions: [
      {
        id: "shatterproof-seat",
        name: "Shatterproof Seat",
        description: "The protection refreshes once after the occupant leaves and re-enters.",
      },
      {
        id: "ceiling-doctrine",
        name: "Ceiling Doctrine",
        description: "Every ally’s first qualifying hit is capped at 70%.",
      },
    ],
    fullDescription:
      "**Base:** The first hit each battle that would deal more than 60% of the occupant’s maximum HP is capped at 60%.\n\n**Rank II:** Cap becomes 50%.\n\n**Evolution — Shatterproof Seat:** The protection refreshes once after the occupant leaves and re-enters.\n\n**Evolution — Ceiling Doctrine:** Every ally’s first qualifying hit is capped at 70%.",
  },
  {
    id: "layered-armor",
    number: 62,
    name: "Layered Armor",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Each additional hit from the same multi-hit move or same-turn attack sequence deals 20% less damage multiplicatively.",
    rankTwo: "Reduction becomes 30%.",
    evolutions: [
      {
        id: "ablative-layers",
        name: "Ablative Layers",
        description:
          "Echoes, follow-up attacks, and chained damage from the same originating action count as part of the sequence.",
      },
      {
        id: "layered-doctrine",
        name: "Layered Doctrine",
        description: "Every ally receives a 15% reduction per subsequent hit.",
      },
    ],
    fullDescription:
      "**Base:** Each additional hit from the same multi-hit move or same-turn attack sequence deals 20% less damage multiplicatively.\n\n**Rank II:** Reduction becomes 30%.\n\n**Evolution — Ablative Layers:** Echoes, follow-up attacks, and chained damage from the same originating action count as part of the sequence.\n\n**Evolution — Layered Doctrine:** Every ally receives a 15% reduction per subsequent hit.",
  },
  {
    id: "emergency-shell",
    number: 63,
    name: "Emergency Shell",
    rarity: "ultra",
    scope: "team",
    targetKind: "team",
    base: "The first time an ally falls below 25% HP, it clears negative stat stages and gains a 20% barrier.",
    rankTwo: "Barrier becomes 30%, and volatile conditions are cleared.",
    evolutions: [
      {
        id: "emergency-protocol",
        name: "Emergency Protocol",
        description: "Every Pokémon can trigger the effect once per battle.",
      },
      {
        id: "counter-shell",
        name: "Counter-Shell",
        description: "The protected Pokémon’s next damaging move gains 50% power.",
      },
    ],
    fullDescription:
      "**Base:** The first time an ally falls below 25% HP, it clears negative stat stages and gains a 20% barrier.\n\n**Rank II:** Barrier becomes 30%, and volatile conditions are cleared.\n\n**Evolution — Emergency Protocol:** Every Pokémon can trigger the effect once per battle.\n\n**Evolution — Counter-Shell:** The protected Pokémon’s next damaging move gains 50% power.",
  },
  {
    id: "guarded-setup",
    number: 64,
    name: "Guarded Setup",
    rarity: "ultra",
    scope: "team",
    targetKind: "team",
    base: "The first non-damaging move used by each Pokémon each battle creates a 15% barrier before the move resolves.",
    rankTwo: "Barrier becomes 25%.",
    evolutions: [
      {
        id: "safe-preparation",
        name: "Safe Preparation",
        description: "The barrier also blocks the first incoming major status while it remains.",
      },
      {
        id: "offensive-guard",
        name: "Offensive Guard",
        description: "If the move raises stats, the user’s next damaging move gains 20% power.",
      },
    ],
    fullDescription:
      "**Base:** The first non-damaging move used by each Pokémon each battle creates a 15% barrier before the move resolves.\n\n**Rank II:** Barrier becomes 25%.\n\n**Evolution — Safe Preparation:** The barrier also blocks the first incoming major status while it remains.\n\n**Evolution — Offensive Guard:** If the move raises stats, the user’s next damaging move gains 20% power.",
  },
  {
    id: "rest-cycle",
    number: 65,
    name: "Rest Cycle",
    rarity: "great",
    scope: "team",
    targetKind: "team",
    base: "Pokémon that never enter the current battle recover 15% HP and 1 PP for every move before the next battle.",
    rankTwo: "Recovery becomes 25% HP and 2 PP.",
    evolutions: [
      {
        id: "deep-rest",
        name: "Deep Rest",
        description: "Major statuses and volatile conditions are also cured.",
      },
      {
        id: "rotation-plan",
        name: "Rotation Plan",
        description: "After sitting out one battle, the Pokémon gains +1 in its highest stat on its next entry.",
      },
    ],
    fullDescription:
      "**Base:** Pokémon that never enter the current battle recover 15% HP and 1 PP for every move before the next battle.\n\n**Rank II:** Recovery becomes 25% HP and 2 PP.\n\n**Evolution — Deep Rest:** Major statuses and volatile conditions are also cured.\n\n**Evolution — Rotation Plan:** After sitting out one battle, the Pokémon gains +1 in its highest stat on its next entry.",
  },
  {
    id: "last-rites",
    number: 66,
    name: "Last Rites",
    rarity: "rogue",
    scope: "team",
    targetKind: "team",
    base: "When an ally faints, the next Pokémon entering gains one random eligible move known by the fallen ally as a temporary additional move with 1 PP.\n\n* It may become the fifth through eighth move.\n* A Pokémon already holding eight moves gains nothing.\n* The move disappears at battle end.\n* Signature structural moves, transformation moves, one-hit-KO moves, and other invalid moves are excluded.",
    rankTwo: "The temporary move gains 2 PP.",
    evolutions: [
      {
        id: "inheritance",
        name: "Inheritance",
        description: "Three eligible moves are pre-rolled and the player chooses one upon entry.",
      },
      {
        id: "final-testament",
        name: "Final Testament",
        description: "The entrant also gains one random compatible ability of the fallen Pokémon for one turn.",
      },
    ],
    fullDescription:
      "**Base:** When an ally faints, the next Pokémon entering gains one random eligible move known by the fallen ally as a temporary additional move with 1 PP.\n\n* It may become the fifth through eighth move.\n* A Pokémon already holding eight moves gains nothing.\n* The move disappears at battle end.\n* Signature structural moves, transformation moves, one-hit-KO moves, and other invalid moves are excluded.\n\n**Rank II:** The temporary move gains 2 PP.\n\n**Evolution — Inheritance:** Three eligible moves are pre-rolled and the player chooses one upon entry.\n\n**Evolution — Final Testament:** The entrant also gains one random compatible ability of the fallen Pokémon for one turn.",
  },
  {
    id: "no-one-left-behind",
    number: 67,
    name: "No One Left Behind",
    rarity: "rogue",
    scope: "team",
    targetKind: "team",
    base: "Winning with exactly one conscious Pokémon revives two random fainted allies at 25% HP. Once per ten-wave segment.",
    rankTwo: "Revives three allies at 35%.",
    evolutions: [
      {
        id: "rally",
        name: "Rally",
        description: "Revives every fainted ally at 25%.",
      },
      {
        id: "chosen-rescue",
        name: "Chosen Rescue",
        description: "Revives two selected allies at 50%.",
      },
    ],
    fullDescription:
      "**Base:** Winning with exactly one conscious Pokémon revives two random fainted allies at 25% HP. Once per ten-wave segment.\n\n**Rank II:** Revives three allies at 35%.\n\n**Evolution — Rally:** Revives every fainted ally at 25%.\n\n**Evolution — Chosen Rescue:** Revives two selected allies at 50%.",
  },
  {
    id: "phoenix-clause",
    number: 68,
    name: "Phoenix Clause",
    rarity: "master",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The selected Pokémon revives at 25% HP once per ten-wave segment.",
    rankTwo: "Revival becomes 40% and clears statuses and negative stages.",
    evolutions: [
      {
        id: "eternal-ember",
        name: "Eternal Ember",
        description: "It can trigger once per boss battle.",
      },
      {
        id: "ashen-return",
        name: "Ashen Return",
        description: "It revives at 25% with +1 to all stats for three turns.",
      },
    ],
    fullDescription:
      "**Base:** The selected Pokémon revives at 25% HP once per ten-wave segment.\n\n**Rank II:** Revival becomes 40% and clears statuses and negative stages.\n\n**Evolution — Eternal Ember:** It can trigger once per boss battle.\n\n**Evolution — Ashen Return:** It revives at 25% with +1 to all stats for three turns.",
  },
  {
    id: "dead-man-s-action",
    number: 69,
    name: "Dead Man’s Action",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "If the selected Pokémon has committed a damaging move but faints before acting, it performs that move at 50% power immediately before leaving the field.",
    rankTwo: "Power becomes 75%.",
    evolutions: [
      {
        id: "last-word",
        name: "Last Word",
        description: "The move occurs at full power and retains eligible secondary effects.",
      },
      {
        id: "posthumous-support",
        name: "Posthumous Support",
        description: "Eligible Status moves can also resolve after the user faints.",
      },
    ],
    fullDescription:
      "**Base:** If the selected Pokémon has committed a damaging move but faints before acting, it performs that move at 50% power immediately before leaving the field.\n\n**Rank II:** Power becomes 75%.\n\n**Evolution — Last Word:** The move occurs at full power and retains eligible secondary effects.\n\n**Evolution — Posthumous Support:** Eligible Status moves can also resolve after the user faints.",
  },
  {
    id: "glass-memory",
    number: 70,
    name: "Glass Memory",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Damage absorbed by the selected Pokémon’s barriers is recorded. When the barrier breaks, its next damaging move adds typeless bonus damage equal to 50% of the recorded amount, capped at 50% of the user’s maximum HP.",
    rankTwo: "Conversion becomes 75%, with a 75% maximum-HP cap.",
    evolutions: [
      {
        id: "shattered-retort",
        name: "Shattered Retort",
        description: "In multi-target battles, the stored damage can strike every enemy at reduced strength.",
      },
      {
        id: "tempered-glass",
        name: "Tempered Glass",
        description: "If the barrier expires intact, the stored value converts into healing and PP instead.",
      },
    ],
    fullDescription:
      "**Base:** Damage absorbed by the selected Pokémon’s barriers is recorded. When the barrier breaks, its next damaging move adds typeless bonus damage equal to 50% of the recorded amount, capped at 50% of the user’s maximum HP.\n\n**Rank II:** Conversion becomes 75%, with a 75% maximum-HP cap.\n\n**Evolution — Shattered Retort:** In multi-target battles, the stored damage can strike every enemy at reduced strength.\n\n**Evolution — Tempered Glass:** If the barrier expires intact, the stored value converts into healing and PP instead.",
  },
  {
    id: "deferred-pain",
    number: 71,
    name: "Deferred Pain",
    rarity: "rogue",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "The selected Pokémon receives 65% of incoming direct damage immediately. The remaining 35% becomes Damage Debt and is paid at the end of the following turn.\n\nHealing received before collection reduces the debt point-for-point. Debt follows the Pokémon through switching and can cause a faint. Total stored debt is capped at 50% maximum HP.",
    rankTwo: "The split becomes 50/50.",
    evolutions: [
      {
        id: "debt-restructuring",
        name: "Debt Restructuring",
        description: "Barriers can absorb Damage Debt when it matures.",
      },
      {
        id: "collection-notice",
        name: "Collection Notice",
        description:
          "If the debt is completely eliminated through healing or barriers, the next damaging move gains power based on the amount erased.",
      },
    ],
    fullDescription:
      "**Base:** The selected Pokémon receives 65% of incoming direct damage immediately. The remaining 35% becomes Damage Debt and is paid at the end of the following turn.\n\nHealing received before collection reduces the debt point-for-point. Debt follows the Pokémon through switching and can cause a faint. Total stored debt is capped at 50% maximum HP.\n\n**Rank II:** The split becomes 50/50.\n\n**Evolution — Debt Restructuring:** Barriers can absorb Damage Debt when it matures.\n\n**Evolution — Collection Notice:** If the debt is completely eliminated through healing or barriers, the next damaging move gains power based on the amount erased.",
  },
  {
    id: "compound-interest",
    number: 72,
    name: "Compound Interest",
    rarity: "great",
    scope: "economy",
    targetKind: "economy",
    base: "After every boss, gain 5% of your current unspent money. Total interest earned is capped at 25% of your current money.",
    rankTwo: "Growth becomes 7.5%.",
    evolutions: [
      {
        id: "patient-capital",
        name: "Patient Capital",
        description:
          "The total-interest cap becomes 50% of current money. Each biome transition also pays 3% of current unspent money within that cap.",
      },
      {
        id: "aggressive-investment",
        name: "Aggressive Investment",
        description: "Growth becomes 10%, but purchasing anything resets accumulated interest growth.",
      },
    ],
    fullDescription:
      "**Base:** After every boss, gain 5% of your current unspent money. Total interest earned is capped at 25% of your current money.\n\n**Rank II:** Growth becomes 7.5%.\n\n**Evolution — Patient Capital:** The total-interest cap becomes 50% of current money. Each biome transition also pays 3% of current unspent money within that cap.\n\n**Evolution — Aggressive Investment:** Growth becomes 10%, but purchasing anything resets accumulated interest growth.",
  },
  {
    id: "warranty",
    number: 73,
    name: "Warranty",
    rarity: "rogue",
    scope: "Pokémon plus consumable stack",
    targetKind: "item-stack",
    base: "Select one consumable item stack. Its first activation each battle does not consume a stack.",
    rankTwo: "Its first two activations do not consume stacks.",
    evolutions: [
      {
        id: "lifetime-warranty",
        name: "Lifetime Warranty",
        description: "The first activation is doubled as well as preserved.",
      },
      {
        id: "extended-warranty",
        name: "Extended Warranty",
        description:
          "Every party member’s first consumable has a chance not to be consumed, but the selected stack retains guaranteed preservation.",
      },
    ],
    fullDescription:
      "**Base:** Select one consumable item stack. Its first activation each battle does not consume a stack.\n\n**Rank II:** Its first two activations do not consume stacks.\n\n**Evolution — Lifetime Warranty:** The first activation is doubled as well as preserved.\n\n**Evolution — Extended Warranty:** Every party member’s first consumable has a chance not to be consumed, but the selected stack retains guaranteed preservation.",
  },
  {
    id: "recycler",
    number: 74,
    name: "Recycler",
    rarity: "rogue",
    scope: "reward screen",
    targetKind: "reward",
    base: "Once per reward screen, destroy one offered option to reroll the other two with improved base-rarity weighting.",
    rankTwo: "Rerolled options cannot fall below their original base rarity.",
    evolutions: [
      {
        id: "closed-loop",
        name: "Closed Loop",
        description: "The destroyed item’s exact category is excluded from both rerolls.",
      },
      {
        id: "upcycler",
        name: "Upcycler",
        description:
          "Destroy two options to generate one item guaranteed to be at least one base tier higher before Luck.",
      },
    ],
    fullDescription:
      "**Base:** Once per reward screen, destroy one offered option to reroll the other two with improved base-rarity weighting.\n\n**Rank II:** Rerolled options cannot fall below their original base rarity.\n\n**Evolution — Closed Loop:** The destroyed item’s exact category is excluded from both rerolls.\n\n**Evolution — Upcycler:** Destroy two options to generate one item guaranteed to be at least one base tier higher before Luck.",
  },
  {
    id: "set-collector",
    number: 75,
    name: "Set Collector",
    rarity: "ultra",
    scope: "item and vitamin sets",
    targetKind: "item-stack",
    base: "Three distinct items from a set activate its three-piece bonus; five activate its five-piece bonus. Duplicate stacks do not count. **Complete Nutrition** (HP Up, Protein, Iron, Calcium, Zinc, Carbos): all stats +5%/+10%. **Restoration Kit** (Leftovers, Shell Bell, Healing Charm, Berry Pouch, Reviver Seed): direct healing +15%/+25%, plus a 10% max-HP barrier on the first heal at five pieces. **Tactician's Tools** (Quick Claw, King's Rock, Wide Lens, Grip Claw, Baton): accuracy +10%, then also +1 priority and +10% power to the first move. **Volatile Core** (Toxic Orb, Flame Orb, Frostbite Orb, Focus Band, White Herb): damage +8%/+15%, then self-inflicted status damage is halved.",
    rankTwo: "One chosen set requires one fewer distinct item.",
    evolutions: [
      {
        id: "curator",
        name: "Curator",
        description: "Two different set bonuses can be active simultaneously without conflict.",
      },
      {
        id: "complete-collection",
        name: "Complete Collection",
        description:
          "One chosen five-piece becomes stronger: Complete Nutrition +15% all stats; Restoration Kit +35% healing and a 15% barrier; Tactician's Tools +15% accuracy, +1 first-move priority, and +25% first-move power; Volatile Core +25% damage and 25% self-inflicted status damage.",
      },
    ],
    fullDescription:
      "**Base:** Three distinct items from a set activate its three-piece bonus; five activate its five-piece bonus. Duplicate stacks do not count. **Complete Nutrition** (HP Up, Protein, Iron, Calcium, Zinc, Carbos): all stats +5%/+10%. **Restoration Kit** (Leftovers, Shell Bell, Healing Charm, Berry Pouch, Reviver Seed): direct healing +15%/+25%, plus a 10% max-HP barrier on the first heal at five pieces. **Tactician's Tools** (Quick Claw, King's Rock, Wide Lens, Grip Claw, Baton): accuracy +10%, then also +1 priority and +10% power to the first move. **Volatile Core** (Toxic Orb, Flame Orb, Frostbite Orb, Focus Band, White Herb): damage +8%/+15%, then self-inflicted status damage is halved.\n\n**Rank II:** One chosen set requires one fewer distinct item.\n\n**Evolution — Curator:** Two different set bonuses can be active simultaneously without conflict.\n\n**Evolution — Complete Collection:** One chosen five-piece becomes stronger: Complete Nutrition +15% all stats; Restoration Kit +35% healing and a 15% barrier; Tactician's Tools +15% accuracy, +1 first-move priority, and +25% first-move power; Volatile Core +25% damage and 25% self-inflicted status damage.",
  },
  {
    id: "blood-market",
    number: 76,
    name: "Blood Market",
    rarity: "ultra",
    scope: "biome market",
    targetKind: "economy",
    base: "At a biome market, one item can be purchased through Blood Debt rather than money. The debt is placed on the most-used Pokémon from the preceding biome and reduces its maximum HP until the next biome transition.\n\nDebt scales with item tier. The player cannot dump the cost onto an irrelevant bench Pokémon.",
    rankTwo: "Blood Debt is approximately 25% smaller.",
    evolutions: [
      {
        id: "split-bill",
        name: "Split Bill",
        description: "Debt may be divided between the two most-used Pokémon.",
      },
      {
        id: "blood-premium",
        name: "Blood Premium",
        description: "The purchased item receives an additional stack or enhanced effect, but the debt is increased.",
      },
    ],
    fullDescription:
      "**Base:** At a biome market, one item can be purchased through Blood Debt rather than money. The debt is placed on the most-used Pokémon from the preceding biome and reduces its maximum HP until the next biome transition.\n\nDebt scales with item tier. The player cannot dump the cost onto an irrelevant bench Pokémon.\n\n**Rank II:** Blood Debt is approximately 25% smaller.\n\n**Evolution — Split Bill:** Debt may be divided between the two most-used Pokémon.\n\n**Evolution — Blood Premium:** The purchased item receives an additional stack or enhanced effect, but the debt is increased.",
  },
  {
    id: "bounty-board",
    number: 77,
    name: "Bounty Board",
    rarity: "ultra",
    scope: "ten-wave contract",
    targetKind: "contract",
    base: "After a boss, accept one feasible optional objective for the following segment. Completion awards a high-tier item and a chance at a relic.\n\nPossible objective families include:\n\n* No allied faint.\n* No healing.\n* No consecutive move repetition.\n* Use at least five elemental types.\n* Every conscious party member must act.\n* Lowest-level Pokémon scores a KO.\n* Break a boss segment with a designated Pokémon.\n* Do not use super-effective attacks.\n* Inflict several distinct statuses.\n* Do not trigger consumables.\n* Switch a minimum number of times.\n* No Pokémon scores more than one KO.\n* Maintain a marked Pokémon above a health threshold.\n* Win under a designated weather.\n* Complete the boss under a turn limit.\n\nOnly objectives that the current party and moves can complete are offered.",
    rankTwo: "Three feasible contracts are offered and reward quality improves.",
    evolutions: [
      {
        id: "master-contract",
        name: "Master Contract",
        description: "A substantially harder objective guarantees a Master-tier reward.",
      },
      {
        id: "relic-hunter",
        name: "Relic Hunter",
        description: "Completing a two-segment contract chain guarantees a choice among relics.",
      },
    ],
    fullDescription:
      "**Base:** After a boss, accept one feasible optional objective for the following segment. Completion awards a high-tier item and a chance at a relic.\n\nPossible objective families include:\n\n* No allied faint.\n* No healing.\n* No consecutive move repetition.\n* Use at least five elemental types.\n* Every conscious party member must act.\n* Lowest-level Pokémon scores a KO.\n* Break a boss segment with a designated Pokémon.\n* Do not use super-effective attacks.\n* Inflict several distinct statuses.\n* Do not trigger consumables.\n* Switch a minimum number of times.\n* No Pokémon scores more than one KO.\n* Maintain a marked Pokémon above a health threshold.\n* Win under a designated weather.\n* Complete the boss under a turn limit.\n\nOnly objectives that the current party and moves can complete are offered.\n\n**Rank II:** Three feasible contracts are offered and reward quality improves.\n\n**Evolution — Master Contract:** A substantially harder objective guarantees a Master-tier reward.\n\n**Evolution — Relic Hunter:** Completing a two-segment contract chain guarantees a choice among relics.",
  },
  {
    id: "recruiter-s-eye",
    number: 78,
    name: "Recruiter’s Eye",
    rarity: "rogue",
    scope: "capture and collection",
    targetKind: "team",
    base: "The first eligible wild encounter in each biome is generated with at least one collectible trait not yet owned for that species, where one exists.\n\nEligible missing traits include:\n\n* One of the catchable active abilities not yet obtained.\n* An egg move not yet obtained.\n* A nature not yet obtained.\n\nThe first capture attempt also reveals the target’s IVs and which guaranteed missing-trait category it carries.",
    rankTwo: "It guarantees two different missing traits when possible.",
    evolutions: [
      {
        id: "ability-hunter",
        name: "Ability Hunter",
        description: "Uncaught active abilities receive the highest priority.",
      },
      {
        id: "completionist",
        name: "Completionist",
        description:
          "The generator prioritizes the rarest remaining missing trait and grants a modest catch-rate bonus against that target.\n\nNo hidden-form data or unnecessary move-pool information is added.",
      },
    ],
    fullDescription:
      "**Base:** The first eligible wild encounter in each biome is generated with at least one collectible trait not yet owned for that species, where one exists.\n\nEligible missing traits include:\n\n* One of the catchable active abilities not yet obtained.\n* An egg move not yet obtained.\n* A nature not yet obtained.\n\nThe first capture attempt also reveals the target’s IVs and which guaranteed missing-trait category it carries.\n\n**Rank II:** It guarantees two different missing traits when possible.\n\n**Evolution — Ability Hunter:** Uncaught active abilities receive the highest priority.\n\n**Evolution — Completionist:** The generator prioritizes the rarest remaining missing trait and grants a modest catch-rate bonus against that target.\n\nNo hidden-form data or unnecessary move-pool information is added.",
  },
  {
    id: "contraband-slot",
    number: 79,
    name: "Contraband Slot",
    rarity: "master",
    scope: "item stack",
    targetKind: "item-stack",
    base: "Select one exact item stack. It ignores one normal compatibility or stack-cap restriction and cannot be suppressed.",
    rankTwo: "It ignores both compatibility and cap restrictions and receives 25% effect amplification.",
    evolutions: [
      {
        id: "black-market-arsenal",
        name: "Black-Market Arsenal",
        description: "A second stack receives the base effect.",
      },
      {
        id: "smuggler-king",
        name: "Smuggler King",
        description: "The selected stack may exceed its normal cap by two additional increments.",
      },
    ],
    fullDescription:
      "**Base:** Select one exact item stack. It ignores one normal compatibility or stack-cap restriction and cannot be suppressed.\n\n**Rank II:** It ignores both compatibility and cap restrictions and receives 25% effect amplification.\n\n**Evolution — Black-Market Arsenal:** A second stack receives the base effect.\n\n**Evolution — Smuggler King:** The selected stack may exceed its normal cap by two additional increments.",
  },
  {
    id: "diversity-charter",
    number: 80,
    name: "Diversity Charter",
    rarity: "rogue",
    scope: "team composition",
    targetKind: "team",
    base: "ry unique elemental type represented anywhere in the party exactly once. Dual- and triple-typed Pokémon may contribute multiple types, but duplicate types add nothing.\n\n**Base thresholds are cumulative:**\n\n* 4 unique types: +5% maximum HP.\n* 6 unique types: +10% damage.\n* 8 unique types: +8% damage reduction.\n* 10 unique types: +10% Speed.\n* 12 unique types: first damaging move by each Pokémon gains 15% power.",
    rankTwo: "Thresholds become 3/5/7/9/11.",
    evolutions: [
      {
        id: "cosmopolitan-team",
        name: "Cosmopolitan Team",
        description: "Every numerical bonus is multiplied by 1.5.",
      },
      {
        id: "adaptive-charter",
        name: "Adaptive Charter",
        description:
          "At ten unique types, the first super-effective hit received by each Pokémon also creates a 15% barrier.",
      },
    ],
    fullDescription:
      "Count every unique elemental type represented anywhere in the party exactly once. Dual- and triple-typed Pokémon may contribute multiple types, but duplicate types add nothing.\n\n**Base thresholds are cumulative:**\n\n* 4 unique types: +5% maximum HP.\n* 6 unique types: +10% damage.\n* 8 unique types: +8% damage reduction.\n* 10 unique types: +10% Speed.\n* 12 unique types: first damaging move by each Pokémon gains 15% power.\n\n**Rank II:** Thresholds become 3/5/7/9/11.\n\n**Evolution — Cosmopolitan Team:** Every numerical bonus is multiplied by 1.5.\n\n**Evolution — Adaptive Charter:** At ten unique types, the first super-effective hit received by each Pokémon also creates a 15% barrier.",
  },
  {
    id: "monotype-oath",
    number: 81,
    name: "Monotype Oath",
    rarity: "ultra",
    scope: "team plus elemental type",
    targetKind: "pokemon-type",
    base: "Select one elemental type. Every party member sharing that type grants all matching party members +4% damage with that type and +3% maximum HP, maximum six contributors.",
    rankTwo: "Values become +5% and +4%.",
    evolutions: [
      {
        id: "pure-doctrine",
        name: "Pure Doctrine",
        description:
          "If every conscious party member shares the type, their first damaging move each battle gains +1 priority.",
      },
      {
        id: "protective-oath",
        name: "Protective Oath",
        description: "Matching Pokémon also gain 5% resistance per contributor against attacks of the selected type.",
      },
    ],
    fullDescription:
      "**Base:** Select one elemental type. Every party member sharing that type grants all matching party members +4% damage with that type and +3% maximum HP, maximum six contributors.\n\n**Rank II:** Values become +5% and +4%.\n\n**Evolution — Pure Doctrine:** If every conscious party member shares the type, their first damaging move each battle gains +1 priority.\n\n**Evolution — Protective Oath:** Matching Pokémon also gain 5% resistance per contributor against attacks of the selected type.",
  },
  {
    id: "underdog-dividend",
    number: 82,
    name: "Underdog Dividend",
    rarity: "great",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "A selected Pokémon at least five levels below the current party average gains 2% to non-HP stats per missing level, maximum 20%, and 50% increased experience.\n\nIf it is not fully evolved, both bonuses are multiplied by 1.25. Mega Evolution does not count as an ordinary evolution stage for this check.",
    rankTwo: "Maximum stat compensation becomes 30%; experience becomes +75%.",
    evolutions: [
      {
        id: "giant-killer",
        name: "Giant Killer",
        description: "The temporary combat bonus doubles against enemies above its own level.",
      },
      {
        id: "graduate",
        name: "Graduate",
        description: "When it catches up, it retains a permanent 5% stat bonus.",
      },
    ],
    fullDescription:
      "**Base:** A selected Pokémon at least five levels below the current party average gains 2% to non-HP stats per missing level, maximum 20%, and 50% increased experience.\n\nIf it is not fully evolved, both bonuses are multiplied by 1.25. Mega Evolution does not count as an ordinary evolution stage for this check.\n\n**Rank II:** Maximum stat compensation becomes 30%; experience becomes +75%.\n\n**Evolution — Giant Killer:** The temporary combat bonus doubles against enemies above its own level.\n\n**Evolution — Graduate:** When it catches up, it retains a permanent 5% stat bonus.",
  },
  {
    id: "growth-ring",
    number: 83,
    name: "Growth Ring",
    rarity: "ultra",
    scope: "not-fully-evolved Pokémon",
    targetKind: "pokemon",
    base: "A Pokémon that is not fully evolved gains 20% to all stats. Mega Evolution is irrelevant to eligibility.",
    rankTwo: "Bonus becomes 30%.",
    evolutions: [
      {
        id: "evergrowth",
        name: "Evergrowth",
        description: "When the Pokémon evolves, it permanently retains 10% and the Ring can be reassigned.",
      },
      {
        id: "refusal-to-grow",
        name: "Refusal to Grow",
        description: "The Pokémon remains eligible while unevolved and receives 40% stats plus 10% move power.",
      },
    ],
    fullDescription:
      "**Base:** A Pokémon that is not fully evolved gains 20% to all stats. Mega Evolution is irrelevant to eligibility.\n\n**Rank II:** Bonus becomes 30%.\n\n**Evolution — Evergrowth:** When the Pokémon evolves, it permanently retains 10% and the Ring can be reassigned.\n\n**Evolution — Refusal to Grow:** The Pokémon remains eligible while unevolved and receives 40% stats plus 10% move power.",
  },
  {
    id: "flawless-ledger",
    number: 84,
    name: "Flawless Ledger",
    rarity: "rogue",
    scope: "persistent reward progression",
    targetKind: "reward",
    base: "Flawless waves build progress toward permanent Ledger marks. A wave is flawless when no allied Pokémon faints.\n\nMark requirements escalate:\n\n```text\nMark 1: 2 flawless waves\nMark 2: 2 more\nMark 3: 3 more\nMark 4: 3 more\nMark 5: 4 more\nMark 6: 4 more\n...and so forth\n```\n\nA nonflawless wave resets progress toward the next mark but does not remove earned marks.\n\nEvery two marks produce one permanent **pre-Luck rarity uplift**:\n\n* Two marks: one reward slot gains +1 base rarity.\n* Four marks: two reward slots gain +1.\n* Six marks: three reward slots gain +1.\n* Eight marks: one slot gains a second uplift.\n* Further pairs continue wrapping across available reward slots.\n\nLuck is applied only afterward.",
    rankTwo: "The first failed flawless streak in each biome does not reset current progress.",
    evolutions: [
      {
        id: "exact-accounting",
        name: "Exact Accounting",
        description: "The player chooses which reward slots receive the uplifts.",
      },
      {
        id: "compound-ledger",
        name: "Compound Ledger",
        description: "Every third uplift also increases the quantity or stack size of one reward.",
      },
    ],
    fullDescription:
      "**Base:** Flawless waves build progress toward permanent Ledger marks. A wave is flawless when no allied Pokémon faints.\n\nMark requirements escalate:\n\n```text\nMark 1: 2 flawless waves\nMark 2: 2 more\nMark 3: 3 more\nMark 4: 3 more\nMark 5: 4 more\nMark 6: 4 more\n...and so forth\n```\n\nA nonflawless wave resets progress toward the next mark but does not remove earned marks.\n\nEvery two marks produce one permanent **pre-Luck rarity uplift**:\n\n* Two marks: one reward slot gains +1 base rarity.\n* Four marks: two reward slots gain +1.\n* Six marks: three reward slots gain +1.\n* Eight marks: one slot gains a second uplift.\n* Further pairs continue wrapping across available reward slots.\n\nLuck is applied only afterward.\n\n**Rank II:** The first failed flawless streak in each biome does not reset current progress.\n\n**Evolution — Exact Accounting:** The player chooses which reward slots receive the uplifts.\n\n**Evolution — Compound Ledger:** Every third uplift also increases the quantity or stack size of one reward.",
  },
  {
    id: "hunter-s-mark",
    number: 85,
    name: "Hunter’s Mark",
    rarity: "great",
    scope: "elemental enemy type",
    targetKind: "enemy-type",
    base: "Select one enemy type. Every ten KOs against that type grants a choice between:\n\n* +15% damage against it.\n* +15% resistance to its attacks.\n* +15% capture effectiveness against it.",
    rankTwo: "Threshold becomes eight KOs.",
    evolutions: [
      {
        id: "apex-hunter",
        name: "Apex Hunter",
        description: "Boss health segments belonging to that type count as three KOs.",
      },
      {
        id: "broad-hunt",
        name: "Broad Hunt",
        description: "Select a second type, but both types receive only 75% of the accumulated bonuses.",
      },
    ],
    fullDescription:
      "**Base:** Select one enemy type. Every ten KOs against that type grants a choice between:\n\n* +15% damage against it.\n* +15% resistance to its attacks.\n* +15% capture effectiveness against it.\n\n**Rank II:** Threshold becomes eight KOs.\n\n**Evolution — Apex Hunter:** Boss health segments belonging to that type count as three KOs.\n\n**Evolution — Broad Hunt:** Select a second type, but both types receive only 75% of the accumulated bonuses.",
  },
  {
    id: "pair-bond",
    number: 86,
    name: "Pair Bond",
    rarity: "ultra",
    scope: "two Pokémon",
    targetKind: "pokemon-pair",
    base: "While both marked Pokémon remain conscious, each deals 10% more damage. Directly switching between them heals the incoming partner by 8%. If one faints, the other gains +1 in its highest offensive stat for two turns.",
    rankTwo: "Damage becomes 15%; switch healing becomes 12%.",
    evolutions: [
      {
        id: "soulmates",
        name: "Soulmates",
        description: "Direct switching also transfers one random positive stat stage.",
      },
      {
        id: "avenger-bond",
        name: "Avenger Bond",
        description:
          "When one partner faints, the survivor gains +1 to all stats and temporarily borrows one eligible move from the fallen partner.",
      },
    ],
    fullDescription:
      "**Base:** While both marked Pokémon remain conscious, each deals 10% more damage. Directly switching between them heals the incoming partner by 8%. If one faints, the other gains +1 in its highest offensive stat for two turns.\n\n**Rank II:** Damage becomes 15%; switch healing becomes 12%.\n\n**Evolution — Soulmates:** Direct switching also transfers one random positive stat stage.\n\n**Evolution — Avenger Bond:** When one partner faints, the survivor gains +1 to all stats and temporarily borrows one eligible move from the fallen partner.",
  },
  {
    id: "bench-academy",
    number: 87,
    name: "Bench Academy",
    rarity: "great",
    scope: "rotating Pokémon target",
    targetKind: "pokemon",
    base: "The lowest-level party member receives double experience only while it is at least five levels below the party average.\n\nWhen it reaches within four levels, the Academy retargets. Each successful graduation grants the whole team a permanent 1% maximum-HP bonus, maximum ten graduations.",
    rankTwo: "Experience becomes +150%.",
    evolutions: [
      {
        id: "elite-academy",
        name: "Elite Academy",
        description: "Graduation also transfers one selected vitamin stack from a donor at partial value.",
      },
      {
        id: "peer-tutoring",
        name: "Peer Tutoring",
        description: "The second-lowest eligible Pokémon receives half of the experience bonus.",
      },
    ],
    fullDescription:
      "**Base:** The lowest-level party member receives double experience only while it is at least five levels below the party average.\n\nWhen it reaches within four levels, the Academy retargets. Each successful graduation grants the whole team a permanent 1% maximum-HP bonus, maximum ten graduations.\n\n**Rank II:** Experience becomes +150%.\n\n**Evolution — Elite Academy:** Graduation also transfers one selected vitamin stack from a donor at partial value.\n\n**Evolution — Peer Tutoring:** The second-lowest eligible Pokémon receives half of the experience bonus.",
  },
  {
    id: "bossbreaker",
    number: 88,
    name: "Bossbreaker",
    rarity: "ultra",
    scope: "Pokémon",
    targetKind: "pokemon",
    base: "Whenever the selected Pokémon breaks a boss health segment, it heals 15% and gains 20% damage for two turns.",
    rankTwo: "Healing becomes 25%; damage becomes 30%.",
    evolutions: [
      {
        id: "segment-eater",
        name: "Segment Eater",
        description: "It also restores 3 total PP.",
      },
      {
        id: "veteran-breaker",
        name: "Veteran Breaker",
        description:
          "Every three segments broken grants a permanent 2% boss-damage bonus, maximum five stacks.\n\nOnly actual boss health segments count.",
      },
    ],
    fullDescription:
      "**Base:** Whenever the selected Pokémon breaks a boss health segment, it heals 15% and gains 20% damage for two turns.\n\n**Rank II:** Healing becomes 25%; damage becomes 30%.\n\n**Evolution — Segment Eater:** It also restores 3 total PP.\n\n**Evolution — Veteran Breaker:** Every three segments broken grants a permanent 2% boss-damage bonus, maximum five stacks.\n\nOnly actual boss health segments count.",
  },
  {
    id: "legacy-slot",
    number: 89,
    name: "Legacy Slot",
    rarity: "rogue",
    scope: "slot",
    targetKind: "slot",
    base: "When the occupant is permanently replaced or released, select one compatible progression-based Pokémon boon it possessed. The slot stores 50% of its stacks or progression for the next occupant.\n\nEligible examples include Chosen One, Mithridatism, Hunter’s Mark, and Bossbreaker. Binary mythic effects are not eligible.",
    rankTwo: "Inheritance becomes 75%.",
    evolutions: [
      {
        id: "dynasty",
        name: "Dynasty",
        description: "The slot can preserve two separate progression imprints.",
      },
      {
        id: "perfect-succession",
        name: "Perfect Succession",
        description: "One imprint transfers at 100%, but the slot cannot store a second one.",
      },
    ],
    fullDescription:
      "**Base:** When the occupant is permanently replaced or released, select one compatible progression-based Pokémon boon it possessed. The slot stores 50% of its stacks or progression for the next occupant.\n\nEligible examples include Chosen One, Mithridatism, Hunter’s Mark, and Bossbreaker. Binary mythic effects are not eligible.\n\n**Rank II:** Inheritance becomes 75%.\n\n**Evolution — Dynasty:** The slot can preserve two separate progression imprints.\n\n**Evolution — Perfect Succession:** One imprint transfers at 100%, but the slot cannot store a second one.",
  },
  {
    id: "time-loop",
    number: 90,
    name: "Time Loop",
    rarity: "master",
    scope: "boss battle rule",
    targetKind: "rule",
    base: "Once per boss battle, when the first allied Pokémon would faint, combat rewinds to the beginning of that turn. The player may choose different actions.\n\nRepeating the same actions recreates the same outcome unless a changed action alters what happens next.",
    rankTwo: "The player may decline the automatic rewind and save it for a later faint.",
    evolutions: [
      {
        id: "deja-vu",
        name: "Deja Vu",
        description:
          "After rewinding, the previously selected enemy actions remain visible before the player recommits.",
      },
      {
        id: "second-timeline",
        name: "Second Timeline",
        description: "One non-boss battle per ten-wave segment can also be rewound.",
      },
    ],
    fullDescription:
      "**Base:** Once per boss battle, when the first allied Pokémon would faint, combat rewinds to the beginning of that turn. The player may choose different actions.\n\nRepeating the same actions recreates the same outcome unless a changed action alters what happens next.\n\n**Rank II:** The player may decline the automatic rewind and save it for a later faint.\n\n**Evolution — Deja Vu:** After rewinding, the previously selected enemy actions remain visible before the player recommits.\n\n**Evolution — Second Timeline:** One non-boss battle per ten-wave segment can also be rewound.",
  },
  {
    id: "recapitulation",
    number: 91,
    name: "Recapitulation",
    rarity: "master",
    scope: "team action history",
    targetKind: "team",
    base: "Every third allied damaging action causes spectral versions of the two previous allied damaging moves to strike the current target at 33% power.\n\nEchoes:\n\n* Consume no PP.\n* Do not reproduce secondary effects.\n* Do not reproduce recoil, multi-hit logic, charge turns, self-KO, or recursive triggers.\n* Use their original attackers’ offensive stats.",
    rankTwo: "Echo power becomes 40%.",
    evolutions: [
      {
        id: "grand-recap",
        name: "Grand Recap",
        description: "The third move also echoes itself at 20% power.",
      },
      {
        id: "extended-history",
        name: "Extended History",
        description: "Every fourth action replays the previous three moves at 30% power.",
      },
    ],
    fullDescription:
      "**Base:** Every third allied damaging action causes spectral versions of the two previous allied damaging moves to strike the current target at 33% power.\n\nEchoes:\n\n* Consume no PP.\n* Do not reproduce secondary effects.\n* Do not reproduce recoil, multi-hit logic, charge turns, self-KO, or recursive triggers.\n* Use their original attackers’ offensive stats.\n\n**Rank II:** Echo power becomes 40%.\n\n**Evolution — Grand Recap:** The third move also echoes itself at 20% power.\n\n**Evolution — Extended History:** Every fourth action replays the previous three moves at 30% power.",
  },
  {
    id: "pocket-turn",
    number: 92,
    name: "Pocket Turn",
    rarity: "ultra",
    scope: "team resource",
    targetKind: "team",
    base: "Missing, hitting an immunity, or being completely blocked generates one Tempo, maximum three. At three Tempo, the next allied move gains +1 priority and produces a 50% echo.",
    rankTwo: "Only two Tempo are required.",
    evolutions: [
      {
        id: "stored-tempo",
        name: "Stored Tempo",
        description: "The team can bank enough Tempo for two Pocket Turns.",
      },
      {
        id: "time-theft",
        name: "Time Theft",
        description: "Consuming Tempo also reduces the target’s move priority by one for that action.",
      },
    ],
    fullDescription:
      "**Base:** Missing, hitting an immunity, or being completely blocked generates one Tempo, maximum three. At three Tempo, the next allied move gains +1 priority and produces a 50% echo.\n\n**Rank II:** Only two Tempo are required.\n\n**Evolution — Stored Tempo:** The team can bank enough Tempo for two Pocket Turns.\n\n**Evolution — Time Theft:** Consuming Tempo also reduces the target’s move priority by one for that action.",
  },
  {
    id: "ability-carousel",
    number: 93,
    name: "Ability Carousel",
    rarity: "master",
    scope: "team formation",
    targetKind: "team",
    base: "At battle start, every Pokémon temporarily gains one random compatible ability from the next occupied party slot in addition to its existing abilities.\n\n* It cannot borrow an ability it already has.\n* A Pokémon with four abilities can temporarily have a fifth.\n* The ability lasts one turn.\n* Form-controller, mutually exclusive, structurally invalid, and duplicate-prohibited abilities are filtered out.\n* There is no repeated player choice; selection is seeded and random.",
    rankTwo: "Duration becomes two turns.",
    evolutions: [
      {
        id: "fast-carousel",
        name: "Fast Carousel",
        description: "The effect triggers again on the first direct switch between adjacent occupied slots.",
      },
      {
        id: "grand-carousel",
        name: "Grand Carousel",
        description: "The borrowed ability is drawn from either adjacent slot using compatibility and synergy weights.",
      },
    ],
    fullDescription:
      "**Base:** At battle start, every Pokémon temporarily gains one random compatible ability from the next occupied party slot in addition to its existing abilities.\n\n* It cannot borrow an ability it already has.\n* A Pokémon with four abilities can temporarily have a fifth.\n* The ability lasts one turn.\n* Form-controller, mutually exclusive, structurally invalid, and duplicate-prohibited abilities are filtered out.\n* There is no repeated player choice; selection is seeded and random.\n\n**Rank II:** Duration becomes two turns.\n\n**Evolution — Fast Carousel:** The effect triggers again on the first direct switch between adjacent occupied slots.\n\n**Evolution — Grand Carousel:** The borrowed ability is drawn from either adjacent slot using compatibility and synergy weights.",
  },
  {
    id: "mirror-theft",
    number: 94,
    name: "Mirror Theft",
    rarity: "master",
    scope: "team",
    targetKind: "team",
    base: "The first enemy-created positive stat increase, weather, terrain, hazard, or side condition each battle is copied to the player’s side where logically possible.",
    rankTwo: "The first two eligible effects are copied.",
    evolutions: [
      {
        id: "perfect-theft",
        name: "Perfect Theft",
        description: "The copied effect is removed from the enemy after being stolen.",
      },
      {
        id: "hall-of-mirrors",
        name: "Hall of Mirrors",
        description: "Each allied Pokémon may copy one enemy stat increase once per battle.",
      },
    ],
    fullDescription:
      "**Base:** The first enemy-created positive stat increase, weather, terrain, hazard, or side condition each battle is copied to the player’s side where logically possible.\n\n**Rank II:** The first two eligible effects are copied.\n\n**Evolution — Perfect Theft:** The copied effect is removed from the enemy after being stolen.\n\n**Evolution — Hall of Mirrors:** Each allied Pokémon may copy one enemy stat increase once per battle.",
  },
  {
    id: "phase-shift",
    number: 95,
    name: "Phase Shift",
    rarity: "master",
    scope: "turn rule",
    targetKind: "rule",
    base: "Every fifth turn is visibly marked Ethereal. Direct damage dealt to the player’s side is reduced by 90% during that turn; Status, setup, field, and switching actions still function normally.",
    rankTwo: "The Ethereal turn occurs every fourth turn.",
    evolutions: [
      {
        id: "ghost-turn",
        name: "Ghost Turn",
        description: "Allied direct damage is increased by 25% during Ethereal turns.",
      },
      {
        id: "stable-phase",
        name: "Stable Phase",
        description:
          "The protection remains until the first direct hit lands, ensuring at least one attack is heavily mitigated.",
      },
    ],
    fullDescription:
      "**Base:** Every fifth turn is visibly marked Ethereal. Direct damage dealt to the player’s side is reduced by 90% during that turn; Status, setup, field, and switching actions still function normally.\n\n**Rank II:** The Ethereal turn occurs every fourth turn.\n\n**Evolution — Ghost Turn:** Allied direct damage is increased by 25% during Ethereal turns.\n\n**Evolution — Stable Phase:** The protection remains until the first direct hit lands, ensuring at least one attack is heavily mitigated.",
  },
  {
    id: "apex-plunder",
    number: 96,
    name: "Apex Plunder",
    rarity: "master",
    scope: "Pokémon plus boss segment",
    targetKind: "pokemon",
    base: "After defeating a boss with additional health segments, select one Pokémon to steal a 25%-HP segment.\n\nWhen that Pokémon would faint, the segment breaks and restores it to 25% HP. The segment persists between battles until broken and is restored only by defeating another segmented boss.",
    rankTwo: "Segment becomes 50%.",
    evolutions: [
      {
        id: "segment-hoard",
        name: "Segment Hoard",
        description: "The Pokémon may store two separate 25% segments.",
      },
      {
        id: "apex-heart",
        name: "Apex Heart",
        description: "A single 25% segment refreshes at every biome transition.",
      },
    ],
    fullDescription:
      "**Base:** After defeating a boss with additional health segments, select one Pokémon to steal a 25%-HP segment.\n\nWhen that Pokémon would faint, the segment breaks and restores it to 25% HP. The segment persists between battles until broken and is restored only by defeating another segmented boss.\n\n**Rank II:** Segment becomes 50%.\n\n**Evolution — Segment Hoard:** The Pokémon may store two separate 25% segments.\n\n**Evolution — Apex Heart:** A single 25% segment refreshes at every biome transition.",
  },
  {
    id: "inversion-window",
    number: 97,
    name: "Inversion Window",
    rarity: "master",
    scope: "team",
    targetKind: "team",
    base: "The first resisted allied attack each battle is treated as super-effective. The first super-effective attack received by the team is treated as resisted.",
    rankTwo: "Each side of the effect gains a second activation.",
    evolutions: [
      {
        id: "reverse-polarity",
        name: "Reverse Polarity",
        description: "The first allied attack that would hit an elemental immunity is treated as neutral instead.",
      },
      {
        id: "inversion-doctrine",
        name: "Inversion Doctrine",
        description: "Every allied Pokémon receives one weaker offensive and defensive inversion window.",
      },
    ],
    fullDescription:
      "**Base:** The first resisted allied attack each battle is treated as super-effective. The first super-effective attack received by the team is treated as resisted.\n\n**Rank II:** Each side of the effect gains a second activation.\n\n**Evolution — Reverse Polarity:** The first allied attack that would hit an elemental immunity is treated as neutral instead.\n\n**Evolution — Inversion Doctrine:** Every allied Pokémon receives one weaker offensive and defensive inversion window.",
  },
  {
    id: "borrowed-future",
    number: 98,
    name: "Borrowed Future",
    rarity: "rogue",
    scope: "pre-battle information",
    targetKind: "team",
    base: "Before battle:\n\n1. The enemy roster and lead are generated.\n2. The enemy commits its first action.\n3. The player sees the lead and committed action.\n4. The player may reorder the party once.\n5. The enemy cannot recalculate that committed action.\n\nThe revealed action is committed and cannot be recalculated.",
    rankTwo: "The enemy lead’s complete visible moveset, abilities, and item stacks are also revealed.",
    evolutions: [
      {
        id: "parallel-futures",
        name: "Parallel Futures",
        description: "In doubles or triples, the committed action of every currently active enemy is revealed.",
      },
      {
        id: "contingency-plan",
        name: "Contingency Plan",
        description:
          "The player may also change one selected move or held-item arrangement before locking the battle state.",
      },
    ],
    fullDescription:
      "**Base:** Before battle:\n\n1. The enemy roster and lead are generated.\n2. The enemy commits its first action.\n3. The player sees the lead and committed action.\n4. The player may reorder the party once.\n5. The enemy cannot recalculate that committed action.\n\nThe revealed action is committed and cannot be recalculated.\n\n**Rank II:** The enemy lead’s complete visible moveset, abilities, and item stacks are also revealed.\n\n**Evolution — Parallel Futures:** In doubles or triples, the committed action of every currently active enemy is revealed.\n\n**Evolution — Contingency Plan:** The player may also change one selected move or held-item arrangement before locking the battle state.",
  },
  {
    id: "pressure-valve",
    number: 99,
    name: "Pressure Valve",
    rarity: "ultra",
    scope: "Pokémon plus selected conversion",
    targetKind: "pokemon",
    base: "Any attempted positive stat increase that would exceed the normal +6 cap is converted instead of being wasted.\n\nAt acquisition, choose one valve:\n\n* **Barrier valve:** 8% maximum-HP barrier per excess stage.\n* **Healing valve:** heal 6% per excess stage.\n* **PP valve:** restore 1 PP to the most depleted move per excess stage.\n\nOnly stat stages above the normal +6 cap are converted.",
    rankTwo: "Values become 12% barrier, 10% healing, or 2 PP.",
    evolutions: [
      {
        id: "multi-valve",
        name: "Multi-Valve",
        description: "Overflow automatically chooses the currently most useful conversion.",
      },
      {
        id: "overpressure",
        name: "Overpressure",
        description: "Every three overflow stages also empower the next damaging move by 50%.",
      },
    ],
    fullDescription:
      "**Base:** Any attempted positive stat increase that would exceed the normal +6 cap is converted instead of being wasted.\n\nAt acquisition, choose one valve:\n\n* **Barrier valve:** 8% maximum-HP barrier per excess stage.\n* **Healing valve:** heal 6% per excess stage.\n* **PP valve:** restore 1 PP to the most depleted move per excess stage.\n\nOnly stat stages above the normal +6 cap are converted.\n\n**Rank II:** Values become 12% barrier, 10% healing, or 2 PP.\n\n**Evolution — Multi-Valve:** Overflow automatically chooses the currently most useful conversion.\n\n**Evolution — Overpressure:** Every three overflow stages also empower the next damaging move by 50%.",
  },
  {
    id: "negative-space",
    number: 100,
    name: "Negative Space",
    rarity: "ultra",
    scope: "Pokémon plus sealed moves",
    targetKind: "move",
    base: "On acquisition, select one known move to **seal**. The move remains learned and visible but cannot be selected while the boon is active. The Pokémon gains 10% damage and 6% damage reduction.\n\nThe seal cannot remove its final damaging move or a structurally required move.",
    rankTwo: "A second move may be sealed; each sealed move grants the bonus separately.",
    evolutions: [
      {
        id: "void-specialist",
        name: "Void Specialist",
        description: "Up to three moves may be sealed, each granting 12% damage and 8% damage reduction.",
      },
      {
        id: "open-form",
        name: "Open Form",
        description:
          "Only one move may be sealed, but the Pokémon’s first usable move each battle gains +1 priority and 25% power.\n\nSeals remain fixed until the boon is replaced, evolved, or explicitly retargeted at a biome transition. They cannot be toggled freely between battles.",
      },
    ],
    fullDescription:
      "**Base:** On acquisition, select one known move to **seal**. The move remains learned and visible but cannot be selected while the boon is active. The Pokémon gains 10% damage and 6% damage reduction.\n\nThe seal cannot remove its final damaging move or a structurally required move.\n\n**Rank II:** A second move may be sealed; each sealed move grants the bonus separately.\n\n**Evolution — Void Specialist:** Up to three moves may be sealed, each granting 12% damage and 8% damage reduction.\n\n**Evolution — Open Form:** Only one move may be sealed, but the Pokémon’s first usable move each battle gains +1 priority and 25% power.\n\nSeals remain fixed until the boon is replaced, evolved, or explicitly retargeted at a biome transition. They cannot be toggled freely between battles.",
  },
] as const satisfies readonly MoodyBoonDefinition[];

export const MOODY_CURSES = [
  {
    id: "frayed-supplies",
    number: 1,
    name: "Frayed Supplies",
    dread: 1,
    description: "Direct healing is 25% weaker. Barriers and revival HP are unaffected.",
  },
  {
    id: "thin-wallet",
    number: 2,
    name: "Thin Wallet",
    dread: 1,
    description: "Biome-market prices are 30% higher.",
  },
  {
    id: "restless-lead",
    number: 3,
    name: "Restless Lead",
    dread: 1,
    description: "The same Pokémon cannot lead two consecutive battles.",
  },
  {
    id: "type-tax",
    number: 4,
    name: "Type Tax",
    dread: 1,
    description:
      "Every duplicate party typing after the first reduces the power of that type’s moves by 4%. Dual and triple typings can contribute several duplicates.",
  },
  {
    id: "jealous-relics",
    number: 5,
    name: "Jealous Relics",
    dread: 1,
    description: "The second and subsequent copies or stacks of the same item operate at reduced effectiveness.",
  },
  {
    id: "slow-to-warm",
    number: 6,
    name: "Slow to Warm",
    dread: 2,
    description:
      "Each Pokémon’s first damaging move after entering deals 15% less damage and acts with reduced Speed priority.",
  },
  {
    id: "fading-momentum",
    number: 7,
    name: "Fading Momentum",
    dread: 1,
    description: "Every three turns, one positive stat stage on the active Pokémon decays.",
  },
  {
    id: "no-takebacks",
    number: 8,
    name: "No Takebacks",
    dread: 1,
    description:
      "Reward rerolls are disabled. Other effects that replace or recycle options cost twice as much or require an additional sacrifice.",
  },
  {
    id: "exposed-flank",
    number: 9,
    name: "Exposed Flank",
    dread: 1,
    description: "The first direct hit received by each Pokémon during a battle deals 15% additional damage.",
  },
  {
    id: "accumulated-fatigue",
    number: 10,
    name: "Accumulated Fatigue",
    dread: 1,
    description: "A Pokémon used in three consecutive waves deals 15% less damage until it sits out one full battle.",
  },
  {
    id: "mortal-wounds",
    number: 11,
    name: "Mortal Wounds",
    dread: 2,
    description: "Fainted Pokémon cannot be revived until the next biome transition.",
  },
  {
    id: "shared-pain",
    number: 12,
    name: "Shared Pain",
    dread: 2,
    description:
      "Ten percent of direct damage suffered is also dealt to the lowest-HP benched ally. Shared Pain cannot directly cause a bench faint.",
  },
  {
    id: "no-retreat",
    number: 13,
    name: "No Retreat",
    dread: 2,
    description:
      "After using a damaging move, the Pokémon cannot voluntarily switch for three turns or until one active Pokémon faints.",
  },
  {
    id: "fog-of-war",
    number: 14,
    name: "Fog of War",
    dread: 2,
    description:
      "Enemy moves, abilities, item stacks, and relevant boon targets remain hidden until observed in battle.",
  },
  {
    id: "withering-pp",
    number: 15,
    name: "Withering PP",
    dread: 2,
    description: "Every fourth move use consumes one additional PP.",
  },
  {
    id: "brittle-weakness",
    number: 16,
    name: "Brittle Weakness",
    dread: 2,
    description: "Super-effective attacks against the player’s team deal 20% additional damage.",
  },
  {
    id: "cursed-inventory",
    number: 17,
    name: "Cursed Inventory",
    dread: 2,
    description:
      "At each biome transition:\n\n1. Identify the most-used Pokémon from the preceding biome.\n2. Randomly select one eligible complete item or vitamin stack it possesses.\n3. Disable the entire stack whenever that Pokémon is active.\n4. Reveal the cursed stack clearly.\n5. Reroll it at the next biome transition.\n\nIf the most-used Pokémon has no eligible stack, continue down the usage ranking.",
  },
  {
    id: "elite-pursuit",
    number: 18,
    name: "Elite Pursuit",
    dread: 2,
    description:
      "Every fifth non-boss wave becomes a boss-trainer-equivalent encounter. It does not grant the usual enhanced boss reward.",
  },
  {
    id: "hollow-victory",
    number: 19,
    name: "Hollow Victory",
    dread: 2,
    description:
      "Winning with any allied faint reduces the base rarity of the next reward before Luck. A flawless victory removes one accumulated penalty.",
  },
  {
    id: "oathbound",
    number: 20,
    name: "Oathbound",
    dread: 2,
    description:
      "Designate one Anchor Pokémon. If it faints:\n\n* Every other conscious ally loses 20% current HP.\n* The active enemy gains +1 Speed.\n\nThe Anchor is visibly marked throughout the run.",
  },
  {
    id: "the-long-night",
    number: 21,
    name: "The Long Night",
    dread: 2,
    description:
      "Automatic healing at biome transitions is disabled, and purchasable healing items cost twice as much. Healing from moves, boons, relics, and owned items still functions.",
  },
  {
    id: "sweeper-s-tax",
    number: 22,
    name: "Sweeper’s Tax",
    dread: 2,
    description:
      "Track consecutive KOs by the same Pokémon within a battle:\n\n* First KO: 15% maximum-HP recoil.\n* Second KO: 30% recoil and −1 Speed.\n* Third KO: 45% recoil and another −1 Speed.\n* Later KOs: recoil rises by another 15%; Speed continues declining at defined thresholds.\n\nThe chain resets when another ally scores a KO or the battle ends. Switching does not reset it.",
  },
  {
    id: "public-enemy",
    number: 23,
    name: "Public Enemy",
    dread: 3,
    description:
      "Every trainer may generate seven or eight Pokémon. Extra roster slots use legal members from that trainer's normal generation pool.\n\nBoss trainers also gain **Second Act**: when their final Pokémon first faints, it revives at full HP with one additional full health segment and +1 to all stats. Boss trainers are encounters flagged by the game as bosses, including Gym Leaders, Elite Four, Champions, evil-team admins and leaders, major rivals, and equivalent named bosses.",
  },
  {
    id: "mood-swing",
    number: 24,
    name: "Mood Swing",
    dread: 3,
    description:
      "Every ten waves, one random player boon becomes dormant. At higher wave depths, two boons may become dormant, but never more than two.\n\nThe disabled boons reroll every ten waves. Their progression and counters are preserved.",
  },
  {
    id: "nemesis-protocol",
    number: 25,
    name: "Nemesis Protocol",
    dread: 3,
    description:
      "Enemy-team boon generation heavily increases counter-weighting against the player’s highest recent Threat Score.\n\nBosses are especially likely to receive boons that pressure the carry’s:\n\n* Physical or special bias\n* Speed dependence\n* Repeated move\n* Setup reliance\n* Weather or terrain\n* Status strategy\n* Healing loop\n* Item concentration\n\nCounter-weighting applies when each new enemy team is generated.",
  },
  {
    id: "blood-moon",
    number: 26,
    name: "Blood Moon",
    dread: 3,
    description:
      "When a boss trainer’s entire roster is defeated, every Pokémon in that roster revives once at 25% HP.\n\nNegative stat stages and major statuses are cleared. Consumed items are not restored.",
  },
  {
    id: "reverse-snowball",
    number: 27,
    name: "Reverse Snowball",
    dread: 3,
    description:
      "Every consecutive battle won without an allied faint grants future enemies 3% increased HP and other stats, up to +30% after ten flawless wins.\n\nThe bonus resets only when **more than half of the player’s current party faints during one battle**.",
  },
  {
    id: "cursed-draft",
    number: 28,
    name: "Cursed Draft",
    dread: 3,
    description:
      "One of the three boon offers after each boss is hidden. It is guaranteed to be beneficial, but its identity, rarity, scope, and target type are revealed only after selection.",
  },
  {
    id: "entropy",
    number: 29,
    name: "Entropy",
    dread: 3,
    description:
      "At every biome transition, one move on every party Pokémon is temporarily replaced until the following biome transition.\n\nReplacement rules:\n\n* Similar category and approximate power band.\n* Preserve at least one damaging move where possible.\n* Exclude form-controller, signature-structural, one-hit-KO, and required moves.\n* Reveal every replacement before the first battle.",
  },
  {
    id: "feedback-loop",
    number: 30,
    name: "Feedback Loop",
    dread: 3,
    description:
      "Whenever one action activates multiple boon effects, the acting Pokémon suffers feedback damage for every triggered boon after the first:\n\n* Second boon: 4% maximum HP.\n* Third boon: another 6%.\n* Fourth and later: another 8% each.\n\nFeedback cannot directly reduce the Pokémon below 1 HP, but ordinary damage can still make it faint.",
  },
] as const satisfies readonly MoodyCurseDefinition[];
