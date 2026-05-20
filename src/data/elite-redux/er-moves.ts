// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/v2.65beta.json
// Regenerate with: pnpm run er:build
// =============================================================================

export interface ErMoveDraft {
  readonly id: number;
  readonly moveConst: string;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly longDescription: string;
  readonly types: readonly number[];
  readonly power: number;
  readonly accuracy: number;
  readonly pp: number;
  readonly priority: number;
  readonly split: number;
  readonly target: number;
  readonly effect: number;
  readonly effectChance: number;
  readonly flags: readonly number[];
  readonly arg: string;
  readonly usesHpType: boolean;
  readonly archetype: "vanilla" | "unknown";
}

export const ER_MOVES: readonly ErMoveDraft[] = [
  {
    "id": 0,
    "moveConst": "MOVE_NONE",
    "name": "-",
    "shortName": "-",
    "description": "",
    "longDescription": "",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 0,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 1,
    "moveConst": "MOVE_POUND",
    "name": "Pound",
    "shortName": "Pound",
    "description": "Pounds the foe with forelegs or tail.",
    "longDescription": "A physical attack delivered with a long tail or a foreleg, etc.",
    "types": [
      0
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 2,
    "moveConst": "MOVE_KARATE_CHOP",
    "name": "Karate Chop",
    "shortName": "Karate Chop",
    "description": "A chopping attack with a high critical-hit ratio.",
    "longDescription": "The foe is attacked with a sharp chop. It has a high critical-hit ratio.",
    "types": [
      1
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 3,
    "moveConst": "MOVE_DOUBLE_SLAP",
    "name": "Double Slap",
    "shortName": "Double Slap",
    "description": "Slaps the foe at least twice. May cause confusion.",
    "longDescription": "Repeatedly slaps the foe. Each hit after the second has a 10% confusion chance.",
    "types": [
      0
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 4,
    "moveConst": "MOVE_COMET_PUNCH",
    "name": "Comet Punch",
    "shortName": "Comet Punch",
    "description": "Repeatedly punches the foe 2 to 5 times. +1 priority.",
    "longDescription": "Hits 2 to 5 times. Has +1 priority. Iron Fist boost.",
    "types": [
      0
    ],
    "power": 15,
    "accuracy": 100,
    "pp": 10,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 5,
    "moveConst": "MOVE_MEGA_PUNCH",
    "name": "Mega Punch",
    "shortName": "Mega Punch",
    "description": "A strong punch thrown with incredible power.",
    "longDescription": "The foe is slugged by a punch with great power. Iron Fist boost.",
    "types": [
      0
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 6,
    "moveConst": "MOVE_PAY_DAY",
    "name": "Pay Day",
    "shortName": "Pay Day",
    "description": "Throws coins at the foe. Money is recovered after.",
    "longDescription": "Numerous coins are hurled at the foe. Money is earned after battle.",
    "types": [
      0
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 2,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 7,
    "moveConst": "MOVE_FIRE_PUNCH",
    "name": "Fire Punch",
    "shortName": "Fire Punch",
    "description": "A fiery punch that may burn the foe.",
    "longDescription": "The foe is punched with a fiery fist. 10% burn chance. Iron Fist boost.",
    "types": [
      2
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 8,
    "moveConst": "MOVE_ICE_PUNCH",
    "name": "Ice Punch",
    "shortName": "Ice Punch",
    "description": "An icy punch that may leave the foe with frostbite.",
    "longDescription": "The foe is punched with an icy fist. 10% frostbite chance. Iron Fist boost.",
    "types": [
      3
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 4,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 9,
    "moveConst": "MOVE_THUNDER_PUNCH",
    "name": "Thunder Punch",
    "shortName": "ThunderPunch",
    "description": "An electrified punch that may paralyze the foe.",
    "longDescription": "A punch with an electrified fist. 10% paralyze chance. Iron Fist boost.",
    "types": [
      4
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 10,
    "moveConst": "MOVE_SCRATCH",
    "name": "Scratch",
    "shortName": "Scratch",
    "description": "Scratches the foe with sharp claws.",
    "longDescription": "Hard, pointed, and sharp claws rake the foe.",
    "types": [
      0
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 11,
    "moveConst": "MOVE_VISE_GRIP",
    "name": "Vise Grip",
    "shortName": "Vise Grip",
    "description": "Grips the foe with large and powerful pincers.",
    "longDescription": "Huge, impressive pincers grip and squeeze the foe. Very high crit ratio.",
    "types": [
      5
    ],
    "power": 120,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 12,
    "moveConst": "MOVE_GUILLOTINE",
    "name": "Guillotine",
    "shortName": "Guillotine",
    "description": "A powerful pincer attack High critical ratio.",
    "longDescription": "A vicious tearing attack with pincers. Keen Edge boost. High crit ratio.",
    "types": [
      5
    ],
    "power": 120,
    "accuracy": 80,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 13,
    "moveConst": "MOVE_RAZOR_WIND",
    "name": "Razor Wind",
    "shortName": "Razor Wind",
    "description": "Wind slices through Rock for super effective damage.",
    "longDescription": "super effective vs Rock. +1 priority in tailwind. High crit. keen edge boost.",
    "types": [
      6
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      1,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 14,
    "moveConst": "MOVE_SWORDS_DANCE",
    "name": "Swords Dance",
    "shortName": "Swords Dance",
    "description": "A fighting dance that sharply raises Attack.",
    "longDescription": "A frenetic dance of fighting. It sharply raises the Attack stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 7,
    "effectChance": 0,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 15,
    "moveConst": "MOVE_CUT",
    "name": "Cut",
    "shortName": "Cut",
    "description": "Cuts the foe. Always crits.",
    "longDescription": "Sharp Steel attack, always crits. Keen Edge boost. Field-based.",
    "types": [
      7
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      4,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 16,
    "moveConst": "MOVE_GUST",
    "name": "Gust",
    "shortName": "Gust",
    "description": "A sudden gust of wind. Has +1 priority.",
    "longDescription": "Strikes the foe with a gust of wind whipped up by wings. Air-based.",
    "types": [
      6
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 8,
    "effectChance": 0,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 17,
    "moveConst": "MOVE_WING_ATTACK",
    "name": "Wing Attack",
    "shortName": "Wing Attack",
    "description": "Strikes the foe with wings spread wide.",
    "longDescription": "The foe is struck with large, imposing wings spread wide. Air-based.",
    "types": [
      6
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 18,
    "moveConst": "MOVE_WHIRLWIND",
    "name": "Whirlwind",
    "shortName": "Whirlwind",
    "description": "Blows away the foe with wind and ends the battle.",
    "longDescription": "The foe is made to switch out with an ally. In the wild, the battle ends.",
    "types": [
      6
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": -6,
    "split": 1,
    "target": 0,
    "effect": 9,
    "effectChance": 0,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 19,
    "moveConst": "MOVE_FLY",
    "name": "Fly",
    "shortName": "Fly",
    "description": "Flies up on the first turn, then strikes the next turn.",
    "longDescription": "A 2-turn move. Use it to fly to any known town. Air-based.",
    "types": [
      6
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 0,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 20,
    "moveConst": "MOVE_BIND",
    "name": "Bind",
    "shortName": "Bind",
    "description": "Binds and squeezes the foe for 2 to 5 turns.",
    "longDescription": "A long body or tentacles are used to bind the foe for four or five turns.",
    "types": [
      0
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 21,
    "moveConst": "MOVE_SLAM",
    "name": "Slam",
    "shortName": "Slam",
    "description": "Slams the foe with a long tail, vine, etc.",
    "longDescription": "The foe is struck with a long tail, vines, etc.",
    "types": [
      0
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 22,
    "moveConst": "MOVE_VINE_WHIP",
    "name": "Vine Whip",
    "shortName": "Vine Whip",
    "description": "Strikes with slender vines. Has 30% flinch chance.",
    "longDescription": "The foe is struck with slender, whip-like vines. 30% flinch chance.",
    "types": [
      8
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 23,
    "moveConst": "MOVE_STOMP",
    "name": "Stomp",
    "shortName": "Stomp",
    "description": "Stomps the foe and terrain flat. May cause flinching.",
    "longDescription": "Destroys terrain. 30% chance to flinch. Strike boost.",
    "types": [
      0
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 13,
    "effectChance": 30,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 24,
    "moveConst": "MOVE_DOUBLE_KICK",
    "name": "Double Kick",
    "shortName": "Double Kick",
    "description": "A double-kicking attack that strikes the foe twice.",
    "longDescription": "Kicks the foe quickly twice. Striker boost.",
    "types": [
      1
    ],
    "power": 45,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 25,
    "moveConst": "MOVE_MEGA_KICK",
    "name": "Mega Kick",
    "shortName": "Mega Kick",
    "description": "An extremely powerful kick with intense force.",
    "longDescription": "The foe is attacked by a kick with great power. Striker boost.",
    "types": [
      0
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 26,
    "moveConst": "MOVE_JUMP_KICK",
    "name": "Jump Kick",
    "shortName": "Jump Kick",
    "description": "A strong jumping kick. May miss and hurt the kicker.",
    "longDescription": "The user jumps up high, then kicks. Hurts on miss. Striker boost.",
    "types": [
      1
    ],
    "power": 100,
    "accuracy": 95,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 15,
    "effectChance": 0,
    "flags": [
      0,
      8,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 27,
    "moveConst": "MOVE_ROLLING_KICK",
    "name": "Rolling Kick",
    "shortName": "Rolling Kick",
    "description": "A fast kick delivered from a rapid spin.",
    "longDescription": "A quick kick from a rolling spin. +1 priority. Striker boost.",
    "types": [
      1
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 28,
    "moveConst": "MOVE_SAND_ATTACK",
    "name": "Sand Attack",
    "shortName": "Sand Attack",
    "description": "Reduces the foe's accuracy by hurling sand in its face.",
    "longDescription": "A lot of sand is hurled in the foe's face, reducing its accuracy.",
    "types": [
      9
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 16,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 29,
    "moveConst": "MOVE_HEADBUTT",
    "name": "Headbutt",
    "shortName": "Headbutt",
    "description": "A ramming attack that may cause flinching.",
    "longDescription": "The user sticks its head out and rams. 30% flinch chance. Field-based.",
    "types": [
      0
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 30,
    "moveConst": "MOVE_HORN_ATTACK",
    "name": "Horn Attack",
    "shortName": "Horn Attack",
    "description": "Jabs the foe with sharp horns. High crit chance.",
    "longDescription": "Jabs with sharply pointed horn. High crit. Mighty Horn boost.",
    "types": [
      0
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 31,
    "moveConst": "MOVE_FURY_ATTACK",
    "name": "Fury Attack",
    "shortName": "Fury Attack",
    "description": "Jabs the foe 2 to 5 times with sharp horns, etc.",
    "longDescription": "Hits 2-5x with a horn or beak. High crit. Mighty Horn boost.",
    "types": [
      0
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0,
      1,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 32,
    "moveConst": "MOVE_HORN_DRILL",
    "name": "Horn Drill",
    "shortName": "Horn Drill",
    "description": "Ignores abilities and stat changes. High crit.",
    "longDescription": "Ignores the target's ability and stat changes. High crit. Mighty Horn boost.",
    "types": [
      0
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [
      0,
      1,
      9,
      10
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 33,
    "moveConst": "MOVE_TACKLE",
    "name": "Tackle",
    "shortName": "Tackle",
    "description": "Charges the foe with a full-body tackle.",
    "longDescription": "A physical attack in which the user charges, full body, into the foe.",
    "types": [
      0
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 34,
    "moveConst": "MOVE_BODY_SLAM",
    "name": "Body Slam",
    "shortName": "Body Slam",
    "description": "A full-body slam that may cause paralysis.",
    "longDescription": "The user drops its full body on the foe. 30% paralyze chance.",
    "types": [
      0
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 35,
    "moveConst": "MOVE_WRAP",
    "name": "Wrap",
    "shortName": "Wrap",
    "description": "Wraps and squeezes the foe 2 to 5 times with vines, etc.",
    "longDescription": "A long body or vines are used to wrap the foe for four or five turns.",
    "types": [
      0
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 36,
    "moveConst": "MOVE_TAKE_DOWN",
    "name": "Take Down",
    "shortName": "Take Down",
    "description": "Slams into the foe, knocking them back and lowering speed.",
    "longDescription": "Slams the foe back. 20% chance to lower Speed.",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 37,
    "moveConst": "MOVE_THRASH",
    "name": "Thrash",
    "shortName": "Thrash",
    "description": "A rampage of 2 to 3 turns that confuses the user.",
    "longDescription": "The user rampages about for two to three turns, then becomes confused.",
    "types": [
      0
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 3,
    "effect": 18,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 38,
    "moveConst": "MOVE_DOUBLE_EDGE",
    "name": "Double-Edge",
    "shortName": "Double-Edge",
    "description": "A life-risking tackle that also hurts the user.",
    "longDescription": "A reckless, life-risking tackle that also has 33% recoil damage.",
    "types": [
      0
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 39,
    "moveConst": "MOVE_TAIL_WHIP",
    "name": "Tail Whip",
    "shortName": "Tail Whip",
    "description": "Wags the tail to lower the foe's Defense.",
    "longDescription": "The user wags its tail cutely, making the foe lower its Defense stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 20,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 40,
    "moveConst": "MOVE_POISON_STING",
    "name": "Poison Sting",
    "shortName": "Poison Sting",
    "description": "Has 10% poison chance and +1 priority.",
    "longDescription": "Quick and painful sting. Has 10% poison chance. Has +1 priority.",
    "types": [
      10
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 21,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 41,
    "moveConst": "MOVE_TWINEEDLE",
    "name": "Twineedle",
    "shortName": "Twineedle",
    "description": "Stingers on the forelegs jab the foe twice.",
    "longDescription": "The foe is stabbed twice with foreleg stingers. 50% poison chance.",
    "types": [
      5
    ],
    "power": 45,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 21,
    "effectChance": 50,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 42,
    "moveConst": "MOVE_PIN_MISSILE",
    "name": "Pin Missile",
    "shortName": "Pin Missile",
    "description": "Sharp pins are fired to strike 2 to 5 times.",
    "longDescription": "Sharp pins are shot at the foe and hit two to five times at once.",
    "types": [
      5
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 43,
    "moveConst": "MOVE_LEER",
    "name": "Leer",
    "shortName": "Leer",
    "description": "Frightens the foe with a leer to lower Defense.",
    "longDescription": "The foe is given an intimidating look that lowers its Defense stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 20,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 44,
    "moveConst": "MOVE_BITE",
    "name": "Bite",
    "shortName": "Bite",
    "description": "Bites with vicious fangs. May cause flinching.",
    "longDescription": "The user bites with vicious fangs. 30% flinch chance. Strong Jaw boost.",
    "types": [
      11
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 45,
    "moveConst": "MOVE_GROWL",
    "name": "Growl",
    "shortName": "Growl",
    "description": "Growls cutely to reduce the foe's Attack.",
    "longDescription": "The user growls in a cute way, making the foe lower its Attack stat.",
    "types": [
      0
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 22,
    "effectChance": 100,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 46,
    "moveConst": "MOVE_ROAR",
    "name": "Roar",
    "shortName": "Roar",
    "description": "Makes the foe flee to end the battle.",
    "longDescription": "The foe is made to switch out with an ally. In the wild, the battle ends.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": -6,
    "split": 2,
    "target": 0,
    "effect": 23,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 47,
    "moveConst": "MOVE_SING",
    "name": "Sing",
    "shortName": "Sing",
    "description": "A soothing song lulls the foe into a deep slumber.",
    "longDescription": "A soothing song in a calming voice lulls the foe into a deep slumber.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 60,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 24,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 48,
    "moveConst": "MOVE_SUPERSONIC",
    "name": "Supersonic",
    "shortName": "Supersonic",
    "description": "Emits bizarre sound waves that may confuse foes.",
    "longDescription": "The user generates odd sound waves that confuse foes.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 25,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 49,
    "moveConst": "MOVE_SONIC_BOOM",
    "name": "Sonic Boom",
    "shortName": "Sonic Boom",
    "description": "Launches shock waves that are super effective vs rock.",
    "longDescription": "The foe is hit with a shock wave that is super effective vs steel types.",
    "types": [
      0
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 50,
    "moveConst": "MOVE_DISABLE",
    "name": "Disable",
    "shortName": "Disable",
    "description": "Psychically disables one of the foe's moves.",
    "longDescription": "For a few turns, it prevents the foe from using the move it last used.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 26,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 51,
    "moveConst": "MOVE_ACID",
    "name": "Acid",
    "shortName": "Acid",
    "description": "Super effective vs Steel. May lower Defense.",
    "longDescription": "Super effective vs Steel. Hits both foes. 30% chance to lower SpDef.",
    "types": [
      10
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 52,
    "moveConst": "MOVE_EMBER",
    "name": "Ember",
    "shortName": "Ember",
    "description": "A weak fire attack that burns the target.",
    "longDescription": "The foe is attacked with small flames. 100% burn chance.",
    "types": [
      2
    ],
    "power": 20,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 53,
    "moveConst": "MOVE_FLAMETHROWER",
    "name": "Flamethrower",
    "shortName": "Flamethrower",
    "description": "A powerful fire attack that may inflict a burn.",
    "longDescription": "The foe is scorched with intense flames. 10% burn chance.",
    "types": [
      2
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 54,
    "moveConst": "MOVE_MIST",
    "name": "Mist",
    "shortName": "Mist",
    "description": "Creates a mist that stops reduction of abilities.",
    "longDescription": "The ally party is protected by a mist that prevents stat reductions.",
    "types": [
      3
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 27,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 55,
    "moveConst": "MOVE_WATER_GUN",
    "name": "Water Gun",
    "shortName": "Water Gun",
    "description": "Squirts water to attack the foe.",
    "longDescription": "A quick quirt of water. 10% drench chance. +1 priority. Mega Launcher boost.",
    "types": [
      12
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 28,
    "effectChance": 10,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 56,
    "moveConst": "MOVE_HYDRO_PUMP",
    "name": "Hydro Pump",
    "shortName": "Hydro Pump",
    "description": "Blasts water at high power to strike the foe.",
    "longDescription": "Blasts with a massive amount of water. 30% drench chance. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 110,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 28,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 57,
    "moveConst": "MOVE_SURF",
    "name": "Surf",
    "shortName": "Surf",
    "description": "Creates a huge wave, then crashes it down on the foe.",
    "longDescription": "A big wave crashes down on the foe. 20% drench chance. Field-based.",
    "types": [
      12
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 28,
    "effectChance": 20,
    "flags": [
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 58,
    "moveConst": "MOVE_ICE_BEAM",
    "name": "Ice Beam",
    "shortName": "Ice Beam",
    "description": "Blasts the foe with an icy beam. May cause frostbite.",
    "longDescription": "The foe is struck with an icy beam. 10% frostbite chance. Mega Launcher boost",
    "types": [
      3
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 4,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 59,
    "moveConst": "MOVE_BLIZZARD",
    "name": "Blizzard",
    "shortName": "Blizzard",
    "description": "Hits the foe with an icy storm. May cause frostbite.",
    "longDescription": "The foe is blasted with a blizzard. 20% frostbite chance. Weather-based.",
    "types": [
      3
    ],
    "power": 110,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 4,
    "effectChance": 30,
    "flags": [
      13,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 60,
    "moveConst": "MOVE_PSYBEAM",
    "name": "Psybeam",
    "shortName": "Psybeam",
    "description": "Fires a peculiar ray that lowers Special Attack.",
    "longDescription": "A peculiar ray is shot at the foe. that lowers SpAtk. Mega Launcher boost",
    "types": [
      13
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 29,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 61,
    "moveConst": "MOVE_BUBBLE_BEAM",
    "name": "Bubble Beam",
    "shortName": "Bubble Beam",
    "description": "Forcefully sprays bubbles that hit repeatedly.",
    "longDescription": "A spray of bubbles strikes the foe 2-5 times. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 62,
    "moveConst": "MOVE_AURORA_BEAM",
    "name": "Aurora Beam",
    "shortName": "Aurora Beam",
    "description": "A rainbow-colored beam which lowers the foe's Attack 100%.",
    "longDescription": "A rainbow-colored attack beam. 100% attack drop. Mega Launcher boost",
    "types": [
      3
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 22,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 63,
    "moveConst": "MOVE_HYPER_BEAM",
    "name": "Hyper Beam",
    "shortName": "Hyper Beam",
    "description": "Powerful, but leaves the user immobile the next turn.",
    "longDescription": "Does severe damage. Needs recharging. Mega Launcher boost",
    "types": [
      0
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 30,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 64,
    "moveConst": "MOVE_PECK",
    "name": "Peck",
    "shortName": "Peck",
    "description": "Attacks the foe with a jabbing beak, etc.",
    "longDescription": "Hits 2-5x with a horn or beak. Mighty Horn boost.",
    "types": [
      6
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 65,
    "moveConst": "MOVE_DRILL_PECK",
    "name": "Drill Peck",
    "shortName": "Drill Peck",
    "description": "A corkscrewing attack with a high critical-hit ratio.",
    "longDescription": "A corkscrewing attack. High crit. Mighty Horn boost.",
    "types": [
      6
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1,
      9,
      10
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 66,
    "moveConst": "MOVE_SUBMISSION",
    "name": "Submission",
    "shortName": "Submission",
    "description": "A reckless body slam that also hurts the user.",
    "longDescription": "A reckless, full-body throw attack. 33% recoil damage.",
    "types": [
      1
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 67,
    "moveConst": "MOVE_LOW_KICK",
    "name": "Low Kick",
    "shortName": "Low Kick",
    "description": "A kick that inflicts more damage on heavier foes.",
    "longDescription": "Inflicts more damage on heavier foes. Striker boost.",
    "types": [
      1
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 31,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 68,
    "moveConst": "MOVE_COUNTER",
    "name": "Counter",
    "shortName": "Counter",
    "description": "Retaliates any physical hit with double the power.",
    "longDescription": "A retaliation move that counters any physical hit with double the damage.",
    "types": [
      1
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "priority": -5,
    "split": 0,
    "target": 5,
    "effect": 32,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 69,
    "moveConst": "MOVE_SEISMIC_TOSS",
    "name": "Seismic Toss",
    "shortName": "Seismic Toss",
    "description": "Carries the foe into the sky then deals damage based on level.",
    "longDescription": "Immobilizes and then slams the foe. Inflicts level damage and triggers hazards.",
    "types": [
      1
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 33,
    "effectChance": 0,
    "flags": [
      0,
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 70,
    "moveConst": "MOVE_STRENGTH",
    "name": "Strength",
    "shortName": "Strength",
    "description": "A powerful slam attack. Lowers the user's defenses.",
    "longDescription": "The foe is slugged at maximum power. Drops Defenses. Field-based.",
    "types": [
      14
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 34,
    "effectChance": 100,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 71,
    "moveConst": "MOVE_ABSORB",
    "name": "Absorb",
    "shortName": "Absorb",
    "description": "Covers the foe with plants that remove stat changes",
    "longDescription": "Covers the foe with plants that remove stat changes.",
    "types": [
      8
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 35,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 72,
    "moveConst": "MOVE_MEGA_DRAIN",
    "name": "Mega Drain",
    "shortName": "Mega Drain",
    "description": "An attack that absorbs 75% of the damage inflicted.",
    "longDescription": "A tough attack that drains 75% of the damage it inflicted to restore HP.",
    "types": [
      8
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 73,
    "moveConst": "MOVE_LEECH_SEED",
    "name": "Leech Seed",
    "shortName": "Leech Seed",
    "description": "Plants a seed on the foe to steal HP on every turn.",
    "longDescription": "Plants a seed that steals HP every turn. Never misses if user is Grass-type.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 37,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 74,
    "moveConst": "MOVE_GROWTH",
    "name": "Growth",
    "shortName": "Growth",
    "description": "Forces the body to grow. Ups Attack and SpAtk",
    "longDescription": "The user's body is forced to grow, raising its Atk. and Sp. Atk stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 38,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 75,
    "moveConst": "MOVE_RAZOR_LEAF",
    "name": "Razor Leaf",
    "shortName": "Razor Leaf",
    "description": "Cuts both foes with sharp leaves. Always crits.",
    "longDescription": "Both foes are hit with a cutting leaf. Always crits. Keen Edge boost.",
    "types": [
      8
    ],
    "power": 55,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 76,
    "moveConst": "MOVE_SOLAR_BEAM",
    "name": "Solar Beam",
    "shortName": "Solar Beam",
    "description": "Absorbs light in one turn, then attacks next turn.",
    "longDescription": "Strong 2-turn move. Weather-based. Mega Launcher boost",
    "types": [
      8
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 39,
    "effectChance": 0,
    "flags": [
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 77,
    "moveConst": "MOVE_POISON_POWDER",
    "name": "Poison Powder",
    "shortName": "PoisonPowder",
    "description": "Scatters a toxic powder that may poison the foe.",
    "longDescription": "A cloud of toxic dust is scattered. It poisons the foe.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 75,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 40,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 78,
    "moveConst": "MOVE_STUN_SPORE",
    "name": "Stun Spore",
    "shortName": "Stun Spore",
    "description": "Scatters a powder that may paralyze the foe.",
    "longDescription": "Wildly scatters powder that paralyzes the foe. Can paralyze Electric-types.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 41,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 79,
    "moveConst": "MOVE_SLEEP_POWDER",
    "name": "Sleep Powder",
    "shortName": "Sleep Powder",
    "description": "Scatters a powder that may cause the foe to sleep.",
    "longDescription": "A sleep-inducing dust is scattered in high volume around a foe.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 75,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 24,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 80,
    "moveConst": "MOVE_PETAL_DANCE",
    "name": "Petal Dance",
    "shortName": "Petal Dance",
    "description": "A rampage of 2 to 3 turns that confuses the user.",
    "longDescription": "The user attacks with petals for two to three turns, then gets confused.",
    "types": [
      8
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 3,
    "effect": 18,
    "effectChance": 100,
    "flags": [
      0,
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 81,
    "moveConst": "MOVE_STRING_SHOT",
    "name": "String Shot",
    "shortName": "String Shot",
    "description": "Binds the foes with string to harshly reduce Speed.",
    "longDescription": "The foe is bound with strings shot from the mouth to reduce its Speed.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 42,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 82,
    "moveConst": "MOVE_DRAGON_RAGE",
    "name": "Dragon Rage",
    "shortName": "Dragon Rage",
    "description": "Launches shock waves that can damage Fairy mons.",
    "longDescription": "The foe is hit with a shock wave that can damage Fairy Pokémon neutrally.",
    "types": [
      15
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 43,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 83,
    "moveConst": "MOVE_FIRE_SPIN",
    "name": "Fire Spin",
    "shortName": "Fire Spin",
    "description": "Traps the foe in a ring of fire for 2 to 5 turns.",
    "longDescription": "The foe is trapped in an intense spiral of fire that rages four or five turns.",
    "types": [
      2
    ],
    "power": 50,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 84,
    "moveConst": "MOVE_THUNDER_SHOCK",
    "name": "Thunder Shock",
    "shortName": "ThunderShock",
    "description": "An electrical attack that may flinch the foe.",
    "longDescription": "An electric shock attack with a 30% flinch chance.",
    "types": [
      4
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 85,
    "moveConst": "MOVE_THUNDERBOLT",
    "name": "Thunderbolt",
    "shortName": "Thunderbolt",
    "description": "A strong electrical attack that may paralyze the foe.",
    "longDescription": "A strong electrical attack with a 10% paralyze chance.",
    "types": [
      4
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 5,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 86,
    "moveConst": "MOVE_THUNDER_WAVE",
    "name": "Thunder Wave",
    "shortName": "Thunder Wave",
    "description": "A weak jolt of electricity that paralyzes the foe.",
    "longDescription": "A weak shock paralyzes the foe. Never misses if user is Electric-type.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 44,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 87,
    "moveConst": "MOVE_THUNDER",
    "name": "Thunder",
    "shortName": "Thunder",
    "description": "A lightning attack that may cause paralysis.",
    "longDescription": "A brutal lightning attack. 30% paralyze chance. Weather-based.",
    "types": [
      4
    ],
    "power": 110,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 45,
    "effectChance": 30,
    "flags": [
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 88,
    "moveConst": "MOVE_ROCK_THROW",
    "name": "Rock Throw",
    "shortName": "Rock Throw",
    "description": "Throws small rocks to strike the foe.",
    "longDescription": "The user attacks with small rocks. Throw-based.",
    "types": [
      14
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 89,
    "moveConst": "MOVE_EARTHQUAKE",
    "name": "Earthquake",
    "shortName": "Earthquake",
    "description": "A powerful quake, but has no effect on flying foes.",
    "longDescription": "An earthquake that strikes all Pokémon in battle excluding the user.",
    "types": [
      9
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 90,
    "moveConst": "MOVE_FISSURE",
    "name": "Fissure",
    "shortName": "Fissure",
    "description": "Very powerful attack. Hits both foes.",
    "longDescription": "The foe is dropped into a fissure. Hits both foes.",
    "types": [
      9
    ],
    "power": 120,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 91,
    "moveConst": "MOVE_DIG",
    "name": "Dig",
    "shortName": "Dig",
    "description": "Digs underground the first turn and strikes next turn.",
    "longDescription": "An attack that hits on the 2nd turn. Field-based.",
    "types": [
      9
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 0,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 92,
    "moveConst": "MOVE_TOXIC",
    "name": "Toxic",
    "shortName": "Toxic",
    "description": "Poisons the foe with an intensifying toxin.",
    "longDescription": "Inflicts a poison that gets worse every turn. Never misses if user is Poison-type.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 46,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 93,
    "moveConst": "MOVE_CONFUSION",
    "name": "Confusion",
    "shortName": "Confusion",
    "description": "A psychic attack that causes confusion.",
    "longDescription": "A weak telekinetic attack that confuses the foe.",
    "types": [
      13
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 47,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 94,
    "moveConst": "MOVE_PSYCHIC",
    "name": "Psychic",
    "shortName": "Psychic",
    "description": "A powerful psychic attack that may lower Sp. Def.",
    "longDescription": "A strong telekinetic attack. 20% chance to drop foe's SpDef stat.",
    "types": [
      13
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 95,
    "moveConst": "MOVE_HYPNOSIS",
    "name": "Hypnosis",
    "shortName": "Hypnosis",
    "description": "A hypnotizing move that may induce sleep.",
    "longDescription": "Hypnotic suggestion is used to make the foe fall into a deep sleep.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 60,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 24,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 96,
    "moveConst": "MOVE_MEDITATE",
    "name": "Meditate",
    "shortName": "Meditate",
    "description": "Meditates peacefully to raise Attack and SpDef.",
    "longDescription": "Meditates to raise Attack and Special Defense.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 49,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 97,
    "moveConst": "MOVE_AGILITY",
    "name": "Agility",
    "shortName": "Agility",
    "description": "Relaxes the body to sharply boost Speed.",
    "longDescription": "The user relaxes and lightens its body to sharply boost its Speed.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 50,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 98,
    "moveConst": "MOVE_QUICK_ATTACK",
    "name": "Quick Attack",
    "shortName": "Quick Attack",
    "description": "An extremely fast attack that always strikes first.",
    "longDescription": "An almost invisibly fast attack with +2 priority.",
    "types": [
      0
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 2,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 99,
    "moveConst": "MOVE_RAGE",
    "name": "Rage",
    "shortName": "Rage",
    "description": "A rampage of 2 to 3 turns that confuses the user.",
    "longDescription": "The user thrashes about for two to three turns, then becomes confused.",
    "types": [
      1
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 3,
    "effect": 18,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 100,
    "moveConst": "MOVE_TELEPORT",
    "name": "Teleport",
    "shortName": "Teleport",
    "description": "A psychic move for fleeing from battle instantly.",
    "longDescription": "Use it to flee from any wild Pokémon. Also warps to the last POKé CENTER.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": -6,
    "split": 2,
    "target": 2,
    "effect": 51,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 101,
    "moveConst": "MOVE_NIGHT_SHADE",
    "name": "Night Shade",
    "shortName": "Night Shade",
    "description": "Inflicts damage identical to the user's level.",
    "longDescription": "An attack with a mirage that inflicts damage matching the user's level.",
    "types": [
      16
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 52,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 102,
    "moveConst": "MOVE_MIMIC",
    "name": "Mimic",
    "shortName": "Mimic",
    "description": "Copies a move used by the foe during one battle.",
    "longDescription": "The user copies the move last used by the foe for the rest of the battle.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 53,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 103,
    "moveConst": "MOVE_SCREECH",
    "name": "Screech",
    "shortName": "Screech",
    "description": "Emits a screech to sharply reduce the foe's Defense.",
    "longDescription": "An ear-splitting screech is emitted to sharply reduce the foe's Defense.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 85,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 54,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 104,
    "moveConst": "MOVE_DOUBLE_TEAM",
    "name": "Double Team",
    "shortName": "Double Team",
    "description": "Creates illusory copies to raise evasiveness.",
    "longDescription": "The user creates illusory copies of itself to raise its evasiveness.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 55,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 105,
    "moveConst": "MOVE_RECOVER",
    "name": "Recover",
    "shortName": "Recover",
    "description": "Recovers up to half the user's maximum HP.",
    "longDescription": "A self-healing move that restores HP by up to half of the user's maximum HP.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 56,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 106,
    "moveConst": "MOVE_HARDEN",
    "name": "Harden",
    "shortName": "Harden",
    "description": "Stiffens the body's muscles to raise Defense.",
    "longDescription": "The user stiffens all the muscles in its body to raise its Defense stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 57,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 107,
    "moveConst": "MOVE_MINIMIZE",
    "name": "Minimize",
    "shortName": "Minimize",
    "description": "Minimizes the user's size to raise evasiveness.",
    "longDescription": "The user compresses all the cells in its body to raise its evasiveness.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 1,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 58,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 108,
    "moveConst": "MOVE_SMOKESCREEN",
    "name": "Smokescreen",
    "shortName": "Smokescreen",
    "description": "Obscures the user's party in smoke for 5 turns.",
    "longDescription": "Obscures the user's party in smoke for 5 turns, increasing evasiveness by 25%.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 59,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 109,
    "moveConst": "MOVE_CONFUSE_RAY",
    "name": "Confuse Ray",
    "shortName": "Confuse Ray",
    "description": "A sinister ray that confuses the foe.",
    "longDescription": "The foe is exposed to a sinister ray that triggers confusion.",
    "types": [
      16
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 25,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 110,
    "moveConst": "MOVE_WITHDRAW",
    "name": "Withdraw",
    "shortName": "Withdraw",
    "description": "Withdraws the body into its hard shell to raise Defense.",
    "longDescription": "The user withdraws its body in its hard shell, raising its Defense stat.",
    "types": [
      12
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 1,
    "split": 2,
    "target": 2,
    "effect": 57,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 111,
    "moveConst": "MOVE_DEFENSE_CURL",
    "name": "Defense Curl",
    "shortName": "Defense Curl",
    "description": "Curls up to conceal weak spots and raise Defense.",
    "longDescription": "The user curls up to conceal weak spots and raise its Defense stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 60,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 112,
    "moveConst": "MOVE_BARRIER",
    "name": "Barrier",
    "shortName": "Barrier",
    "description": "Forms the Psychic Terrain into a powerful barrier.",
    "longDescription": "The user sets Light Screen and Reflect if Psychic Terrain is active.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 61,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 113,
    "moveConst": "MOVE_LIGHT_SCREEN",
    "name": "Light Screen",
    "shortName": "Light Screen",
    "description": "Creates a wall of light that lowers Sp. Atk damage.",
    "longDescription": "A wall of light cuts damage from Sp. Atk attacks for five turns.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 62,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 114,
    "moveConst": "MOVE_HAZE",
    "name": "Haze",
    "shortName": "Haze",
    "description": "Creates a black haze that eliminates all stat changes.",
    "longDescription": "Eliminates all stat changes among all Pokémon engaged in battle.",
    "types": [
      3
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 63,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 115,
    "moveConst": "MOVE_REFLECT",
    "name": "Reflect",
    "shortName": "Reflect",
    "description": "Creates a wall of light that weakens physical attacks.",
    "longDescription": "A wall of light cuts damage from physical attacks for five turns.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 64,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 116,
    "moveConst": "MOVE_FOCUS_ENERGY",
    "name": "Focus Energy",
    "shortName": "Focus Energy",
    "description": "Focuses power to raise the critical-hit ratio.",
    "longDescription": "The user takes a deep breath and focuses to raise its critical-hit ratio.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 65,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 117,
    "moveConst": "MOVE_BIDE",
    "name": "Bide",
    "shortName": "Bide",
    "description": "Endures attack for 2 turns to retaliate double.",
    "longDescription": "The user endures attacks for two turns, then strikes back double.",
    "types": [
      0
    ],
    "power": 1,
    "accuracy": 0,
    "pp": 10,
    "priority": 1,
    "split": 0,
    "target": 2,
    "effect": 66,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 118,
    "moveConst": "MOVE_METRONOME",
    "name": "Metronome",
    "shortName": "Metronome",
    "description": "An unknown power uses any Pokémon move at random.",
    "longDescription": "An unknown power stimulates the brain into using any move at random.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 5,
    "effect": 67,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 119,
    "moveConst": "MOVE_MIRROR_MOVE",
    "name": "Mirror Move",
    "shortName": "Mirror Move",
    "description": "Counters the foe's attack with the same move.",
    "longDescription": "The user counters the move last used by the foe with the same move.",
    "types": [
      6
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 5,
    "effect": 68,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 120,
    "moveConst": "MOVE_SELF_DESTRUCT",
    "name": "Self-Destruct",
    "shortName": "SelfDestruct",
    "description": "Inflicts severe damage but makes the user faint.",
    "longDescription": "The user blows up to inflict severe damage. Deals 2x damage if hit first.",
    "types": [
      0
    ],
    "power": 200,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 69,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 121,
    "moveConst": "MOVE_EGG_BOMB",
    "name": "Egg Bomb",
    "shortName": "Egg Bomb",
    "description": "An egg is forcibly hurled at the foe.",
    "longDescription": "Hurls a hot egg. 30% Burn chance. 1.5x damage under Gravity. Throw-based.",
    "types": [
      2
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 70,
    "effectChance": 30,
    "flags": [
      12,
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 122,
    "moveConst": "MOVE_LICK",
    "name": "Lick",
    "shortName": "Lick",
    "description": "Licks with a long tongue to injure. May also flinch.",
    "longDescription": "The foe is licked and hit with a long tongue. 30% flinch chance.",
    "types": [
      16
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 123,
    "moveConst": "MOVE_SMOG",
    "name": "Smog",
    "shortName": "Smog",
    "description": "An exhaust-gas attack that may also poison.",
    "longDescription": "The foe is attacked with exhaust gases. 50% poison chance.",
    "types": [
      10
    ],
    "power": 50,
    "accuracy": 70,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 21,
    "effectChance": 50,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 124,
    "moveConst": "MOVE_SLUDGE",
    "name": "Sludge",
    "shortName": "Sludge",
    "description": "Super effective vs Water. May poison foes.",
    "longDescription": "Hurls toxic sludge at the foe. Super-effective on Water. 30% poison chance.",
    "types": [
      10
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 125,
    "moveConst": "MOVE_BONE_CLUB",
    "name": "Bone Club",
    "shortName": "Bone Club",
    "description": "Clubs the foe with a bone. May cause flinching.",
    "longDescription": "The foe is clubbed with a bone. 30% flinch chance.",
    "types": [
      9
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      15
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 126,
    "moveConst": "MOVE_FIRE_BLAST",
    "name": "Fire Blast",
    "shortName": "Fire Blast",
    "description": "Incinerates everything it strikes. May cause a burn.",
    "longDescription": "The foe is hit with an intense flame. It has a 20% burn chance.",
    "types": [
      2
    ],
    "power": 110,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 127,
    "moveConst": "MOVE_WATERFALL",
    "name": "Waterfall",
    "shortName": "Waterfall",
    "description": "Charges the foe with speed to climb waterfalls.",
    "longDescription": "A powerful charge attack. 20% flinch chance. Field-based.",
    "types": [
      12
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 20,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 128,
    "moveConst": "MOVE_CLAMP",
    "name": "Clamp",
    "shortName": "Clamp",
    "description": "Traps and squeezes the foe for 2 to 5 turns.",
    "longDescription": "The foe is clamped and squeezed by the user's shell for four or five turns.",
    "types": [
      12
    ],
    "power": 50,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 129,
    "moveConst": "MOVE_SWIFT",
    "name": "Swift",
    "shortName": "Swift",
    "description": "Sprays star-shaped rays that never miss.",
    "longDescription": "Special-based extreme speed. Has +2 priority.",
    "types": [
      0
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 5,
    "priority": 2,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 130,
    "moveConst": "MOVE_SKULL_BASH",
    "name": "Skull Bash",
    "shortName": "Skull Bash",
    "description": "Tucks in the head, then attacks on the next turn.",
    "longDescription": "The user raises its Attack on the 1st turn, then attacks on the 2nd turn.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 71,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 131,
    "moveConst": "MOVE_SPIKE_CANNON",
    "name": "Spike Cannon",
    "shortName": "Spike Cannon",
    "description": "Launches sharp spikes that strike 2 to 5 times.",
    "longDescription": "Sharp spikes are fired two to five times. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 132,
    "moveConst": "MOVE_CONSTRICT",
    "name": "Constrict",
    "shortName": "Constrict",
    "description": "Constricts to inflict pain. May lower Speed.",
    "longDescription": "The foe is attacked with long tentacles or vines. Lowers foe's Speed.",
    "types": [
      0
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 133,
    "moveConst": "MOVE_AMNESIA",
    "name": "Amnesia",
    "shortName": "Amnesia",
    "description": "Forgets about something and sharply raises Sp. Def.",
    "longDescription": "Forgets about something and sharply raises Sp. Def.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 72,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 134,
    "moveConst": "MOVE_KINESIS",
    "name": "Kinesis",
    "shortName": "Kinesis",
    "description": "Animates the foe's item, surprising them.",
    "longDescription": "Causes the foe's item to fly away, removing it and flinching the target.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 1,
    "split": 2,
    "target": 0,
    "effect": 73,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 135,
    "moveConst": "MOVE_SOFT_BOILED",
    "name": "Soft-Boiled",
    "shortName": "Soft-Boiled",
    "description": "Recovers up to half the user's maximum HP.",
    "longDescription": "Heals the user by up to half its full HP. It can be used to heal an ally.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 74,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 136,
    "moveConst": "MOVE_HIGH_JUMP_KICK",
    "name": "High Jump Kick",
    "shortName": "HighJumpKick",
    "description": "A jumping knee kick. If it misses, the user is hurt.",
    "longDescription": "A strong jumping knee kick. Hurts on miss. Striker boost.",
    "types": [
      1
    ],
    "power": 130,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 15,
    "effectChance": 0,
    "flags": [
      0,
      8,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 137,
    "moveConst": "MOVE_GLARE",
    "name": "Glare",
    "shortName": "Glare",
    "description": "Intimidates and frightens the foe into paralysis.",
    "longDescription": "An intense gaze frightens the foe into paralysis. Can paralyze Electric-types.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 41,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 138,
    "moveConst": "MOVE_DREAM_EATER",
    "name": "Dream Eater",
    "shortName": "Dream Eater",
    "description": "Takes one half the damage inflicted on a sleeping foe.",
    "longDescription": "Absorbs half the damage it inflicted on a sleeping foe to restore HP.",
    "types": [
      13
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 75,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 139,
    "moveConst": "MOVE_POISON_GAS",
    "name": "Poison Gas",
    "shortName": "Poison Gas",
    "description": "Super effective vs Flying. gas that may poison.",
    "longDescription": "Super effective vs Flying. Hits both foes. 30% chance to poison.",
    "types": [
      10
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 20,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 140,
    "moveConst": "MOVE_BARRAGE",
    "name": "Barrage",
    "shortName": "Barrage",
    "description": "Hurls round objects at the foe 2 to 5 times.",
    "longDescription": "Round objects are hurled at the foe to strike two to five times.",
    "types": [
      7
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      12,
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 141,
    "moveConst": "MOVE_LEECH_LIFE",
    "name": "Leech Life",
    "shortName": "Leech Life",
    "description": "An attack that steals half the damage inflicted.",
    "longDescription": "An attack that absorbs half the damage it inflicted. Strong Jaw boost.",
    "types": [
      5
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 142,
    "moveConst": "MOVE_LOVELY_KISS",
    "name": "Lovely Kiss",
    "shortName": "Lovely Kiss",
    "description": "Demands a kiss with a scary face that induces sleep.",
    "longDescription": "The user forces a kiss on the foe with a scary face that induces sleep.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 85,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 24,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 143,
    "moveConst": "MOVE_SKY_ATTACK",
    "name": "Sky Attack",
    "shortName": "Sky Attack",
    "description": "Searches out weak spots, then strikes the next turn.",
    "longDescription": "Raises its Attack on the first turn, then makes a brutal strike on the second.",
    "types": [
      6
    ],
    "power": 140,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 71,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 144,
    "moveConst": "MOVE_TRANSFORM",
    "name": "Transform",
    "shortName": "Transform",
    "description": "Alters the user's cells to become a copy of the foe.",
    "longDescription": "The user transforms into a copy of the foe with even the same move set.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 76,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 145,
    "moveConst": "MOVE_BUBBLE",
    "name": "Bubble",
    "shortName": "Bubble",
    "description": "An attack using bubbles. Always lowers foe's Speed.",
    "longDescription": "A spray of bubbles hits both foes. 100% chance to drop foe's Speed.",
    "types": [
      12
    ],
    "power": 55,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 17,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 146,
    "moveConst": "MOVE_DIZZY_PUNCH",
    "name": "Dizzy Punch",
    "shortName": "Dizzy Punch",
    "description": "A rhythmic punch that may confuse the foe.",
    "longDescription": "The foe is hit with a rhythmic punch. 20% confusion chance.",
    "types": [
      0
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 47,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 147,
    "moveConst": "MOVE_SPORE",
    "name": "Spore",
    "shortName": "Spore",
    "description": "Scatters a cloud of spores that always induce sleep.",
    "longDescription": "The user scatters bursts of fine spores that induce sleep.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 24,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 148,
    "moveConst": "MOVE_FLASH",
    "name": "Flash",
    "shortName": "Flash",
    "description": "Looses a blast of light. 50% chance to drop Atk.",
    "longDescription": "A blast of light that has 50% chance to drop foe's Atk. Field-based.",
    "types": [
      4
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 22,
    "effectChance": 50,
    "flags": [
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 149,
    "moveConst": "MOVE_PSYWAVE",
    "name": "Psywave",
    "shortName": "Psywave",
    "description": "Quick wave of psychic energy. Has +1 priority.",
    "longDescription": "A quick wave of psychic energy. +1 priority. 10% confusion chance.",
    "types": [
      13
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 47,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 150,
    "moveConst": "MOVE_SPLASH",
    "name": "Splash",
    "shortName": "Splash",
    "description": "Does more damage if the user outweighs the foe.",
    "longDescription": "The user slams the foe. 20% drench chance. Heavier users are stronger.",
    "types": [
      12
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 77,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 151,
    "moveConst": "MOVE_ACID_ARMOR",
    "name": "Acid Armor",
    "shortName": "Acid Armor",
    "description": "Liquifies the user's body to sharply raise Defense.",
    "longDescription": "The user alters its cells to liquefy itself and sharply raise Defense.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 78,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 152,
    "moveConst": "MOVE_CRABHAMMER",
    "name": "Crabhammer",
    "shortName": "Crabhammer",
    "description": "Hammers with a pincer. Has a high critical-hit ratio.",
    "longDescription": "A large pincer is used to hammer the foe. It has a high critical-hit ratio.",
    "types": [
      12
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 153,
    "moveConst": "MOVE_EXPLOSION",
    "name": "Explosion",
    "shortName": "Explosion",
    "description": "Inflicts severe damage but makes the user faint.",
    "longDescription": "The user explodes to inflict terrible damage even while fainting itself.",
    "types": [
      0
    ],
    "power": 250,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 69,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 154,
    "moveConst": "MOVE_FURY_SWIPES",
    "name": "Fury Swipes",
    "shortName": "Fury Swipes",
    "description": "Rakes the foe with sharp claws, etc., 2 to 5 times.",
    "longDescription": "Hits 2-5x with sharp claws or scythes. High crit rate. Keen edge boost.",
    "types": [
      0
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 155,
    "moveConst": "MOVE_BONEMERANG",
    "name": "Bonemerang",
    "shortName": "Bonemerang",
    "description": "Throws a bone. Hits airborne targets and strikes twice.",
    "longDescription": "The user throws a bone that hits the foe once, then once again on return.",
    "types": [
      9
    ],
    "power": 45,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      15,
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 156,
    "moveConst": "MOVE_REST",
    "name": "Rest",
    "shortName": "Rest",
    "description": "The user sleeps for 2 turns, restoring HP and status.",
    "longDescription": "The user sleeps for two turns to fully restore HP and heal any status problem.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 79,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 157,
    "moveConst": "MOVE_ROCK_SLIDE",
    "name": "Rock Slide",
    "shortName": "Rock Slide",
    "description": "Large boulders are hurled. May cause flinching.",
    "longDescription": "Large boulders are hurled at the foe. 20% flinch chance. Throw-based.",
    "types": [
      14
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 12,
    "effectChance": 20,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 158,
    "moveConst": "MOVE_HYPER_FANG",
    "name": "Hyper Fang",
    "shortName": "Hyper Fang",
    "description": "Attacks with sharp fangs. May cause flinching.",
    "longDescription": "The foe is attacked with sharp fangs. 30% flinch chance. Strong Jaw boost.",
    "types": [
      0
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 159,
    "moveConst": "MOVE_SHARPEN",
    "name": "Sharpen",
    "shortName": "Sharpen",
    "description": "Sharpens its edges to boost Attack and Crit.",
    "longDescription": "The user sharpens its edges. Raises highest Attack and Crit and sets Cutthroat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 80,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 160,
    "moveConst": "MOVE_CONVERSION",
    "name": "Conversion",
    "shortName": "Conversion",
    "description": "Boosts SpAtk and Speed and changes type.",
    "longDescription": "Boosts SpAtk and Speeds and changes its type to its first move's type.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 81,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 161,
    "moveConst": "MOVE_TRI_ATTACK",
    "name": "Tri Attack",
    "shortName": "Tri Attack",
    "description": "Fires three types of beams at the same time.",
    "longDescription": "30% chance to paralyze, burn, or frostbite foes. Uses highest Attack.",
    "types": [
      0
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 82,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 162,
    "moveConst": "MOVE_SUPER_FANG",
    "name": "Super Fang",
    "shortName": "Super Fang",
    "description": "Attacks with sharp fangs and cuts half the foe's HP.",
    "longDescription": "The user attacks with sharp fangs and halves the foe's HP.",
    "types": [
      0
    ],
    "power": 1,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 83,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 163,
    "moveConst": "MOVE_SLASH",
    "name": "Slash",
    "shortName": "Slash",
    "description": "Slashes with claws, etc. Always crits.",
    "longDescription": "The foe is slashed with claws, etc. Always crits. Keen Edge boost.",
    "types": [
      0
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [
      0,
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 164,
    "moveConst": "MOVE_SUBSTITUTE",
    "name": "Substitute",
    "shortName": "Substitute",
    "description": "Creates a decoy using 1/4 of the user's maximum HP.",
    "longDescription": "The user creates a decoy using one-quarter of its full HP.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 84,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 165,
    "moveConst": "MOVE_STRUGGLE",
    "name": "Struggle",
    "shortName": "Struggle",
    "description": "Used only if all PP are gone. Also hurts the user a little.",
    "longDescription": "An attack that is used only if there is no PP. It also hurts the user.",
    "types": [
      0
    ],
    "power": 50,
    "accuracy": 0,
    "pp": 1,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 85,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 166,
    "moveConst": "MOVE_SKETCH",
    "name": "Sketch",
    "shortName": "Sketch",
    "description": "Copies the foe's last move permanently.",
    "longDescription": "This move copies the move last used by the foe, then disappears.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 1,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 86,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 167,
    "moveConst": "MOVE_TRIPLE_KICK",
    "name": "Triple Kick",
    "shortName": "Triple Kick",
    "description": "Kicks the foe 3 times in a row with rising intensity.",
    "longDescription": "A 3-kick attack. More powerful with each successive hit. Striker boost.",
    "types": [
      1
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 87,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 168,
    "moveConst": "MOVE_THIEF",
    "name": "Thief",
    "shortName": "Thief",
    "description": "While attacking, it may steal the foe's held item.",
    "longDescription": "Steals or removes the foe's item. +1 priority if the user has no item.",
    "types": [
      11
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 88,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 169,
    "moveConst": "MOVE_SPIDER_WEB",
    "name": "Spider Web",
    "shortName": "Spider Web",
    "description": "Ensnares the foe to stop it from fleeing or switching.",
    "longDescription": "Ensnares the foe with sticky string so it doesn't flee or switch out.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 89,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 170,
    "moveConst": "MOVE_MIND_READER",
    "name": "Mind Reader",
    "shortName": "Mind Reader",
    "description": "Reads the opponent's mind to dodge their attack.",
    "longDescription": "Dodges all attacks and lowers the SpDef of attackers. May fail if used in succession.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 171,
    "moveConst": "MOVE_NIGHTMARE",
    "name": "Nightmare",
    "shortName": "Nightmare",
    "description": "Haunts the foe with a terrifying nightmare doing heavy damage.",
    "longDescription": "Deals heavy damage to a sleeping foe and makes them lose 1/4 HP each turn.",
    "types": [
      16
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 91,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 172,
    "moveConst": "MOVE_FLAME_WHEEL",
    "name": "Flame Wheel",
    "shortName": "Flame Wheel",
    "description": "Rolls into a wheel to strike with rising intensity.",
    "longDescription": "A rolling attack that becomes stronger each time it hits.",
    "types": [
      2
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 92,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 173,
    "moveConst": "MOVE_SNORE",
    "name": "Snore",
    "shortName": "Snore",
    "description": "A loud attack that can be used only while asleep.",
    "longDescription": "An attack that can be used only while asleep. Has a 30% flinch chance.",
    "types": [
      0
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 93,
    "effectChance": 30,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 174,
    "moveConst": "MOVE_CURSE",
    "name": "Curse",
    "shortName": "Curse",
    "description": "A move that functions differently for GHOSTS.",
    "longDescription": "Inflicts a curse when used in fog or by Ghosts. For others boosts stats.",
    "types": [
      16
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 94,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 175,
    "moveConst": "MOVE_FLAIL",
    "name": "Flail",
    "shortName": "Flail",
    "description": "Inflicts critical damage when the user's HP is low.",
    "longDescription": "A desperate attack that deals critical damage when the user is below 50% HP.",
    "types": [
      0
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 95,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 176,
    "moveConst": "MOVE_CONVERSION_2",
    "name": "Conversion 2",
    "shortName": "Conversion 2",
    "description": "Boosts SpAtk and Speed and changes type.",
    "longDescription": "Boosts SpAtk and Speed and changes type to resist the last attack taken.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 96,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 177,
    "moveConst": "MOVE_AEROBLAST",
    "name": "Aeroblast",
    "shortName": "Aeroblast",
    "description": "Launches a vacuumed blast. High crit ratio.",
    "longDescription": "A vortex of air is shot at the foe. High crit ratio. Air-based.",
    "types": [
      6
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      1,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 178,
    "moveConst": "MOVE_COTTON_SPORE",
    "name": "Cotton Spore",
    "shortName": "Cotton Spore",
    "description": "Spores cling to the foe, sharply reducing Speed.",
    "longDescription": "Cotton-like spores cling to the foe, sharply reducing its Speed stat.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 42,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 179,
    "moveConst": "MOVE_REVERSAL",
    "name": "Reversal",
    "shortName": "Reversal",
    "description": "Inflicts critical damage when the user's HP is low.",
    "longDescription": "A desperate attack that deals critical damage when the user is below 50% HP.",
    "types": [
      1
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 95,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 180,
    "moveConst": "MOVE_SPITE",
    "name": "Spite",
    "shortName": "Spite",
    "description": "Spitefully cuts the PP of the foe's last move.",
    "longDescription": "A move that cuts 2 to 5 PP from the move last used by the foe.",
    "types": [
      16
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 97,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 181,
    "moveConst": "MOVE_POWDER_SNOW",
    "name": "Powder Snow",
    "shortName": "Powder Snow",
    "description": "Blasts the foe with a snowy gust. May cause freezing.",
    "longDescription": "Blasts the foe with a snowy gust. 30% chance to frostbite the foe.",
    "types": [
      3
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 4,
    "effectChance": 30,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 182,
    "moveConst": "MOVE_PROTECT",
    "name": "Protect",
    "shortName": "Protect",
    "description": "Evades attack, but may fail if used in succession.",
    "longDescription": "Enables the user to evade all attacks. It may fail if used in succession.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 183,
    "moveConst": "MOVE_MACH_PUNCH",
    "name": "Mach Punch",
    "shortName": "Mach Punch",
    "description": "A punch is thrown at wicked speed to strike first.",
    "longDescription": "A punch thrown at blinding speed. +1 priority. Iron Fist boost.",
    "types": [
      1
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 184,
    "moveConst": "MOVE_SCARY_FACE",
    "name": "Scary Face",
    "shortName": "Scary Face",
    "description": "Frightens with a scary face to sharply reduce Speed.",
    "longDescription": "Frightens the foe with a scary face. Inflicts fear and sharply lowers Speed.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 98,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 185,
    "moveConst": "MOVE_FEINT_ATTACK",
    "name": "Feint Attack",
    "shortName": "Feint Attack",
    "description": "Draws the foe close, then strikes without fail.",
    "longDescription": "The user draws up close to the foe disarmingly, then hits without fail.",
    "types": [
      11
    ],
    "power": 80,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 186,
    "moveConst": "MOVE_SWEET_KISS",
    "name": "Sweet Kiss",
    "shortName": "Sweet Kiss",
    "description": "Demands a kiss, causing confusion and infatuation.",
    "longDescription": "Kisses the foe with a sweet cuteness that causes confusion and infatuation.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 75,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 99,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 187,
    "moveConst": "MOVE_BELLY_DRUM",
    "name": "Belly Drum",
    "shortName": "Belly Drum",
    "description": "Maximizes Attack while sacrificing HP.",
    "longDescription": "The user maximizes its Attack stat at the cost of half its full HP.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 100,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 188,
    "moveConst": "MOVE_SLUDGE_BOMB",
    "name": "Sludge Bomb",
    "shortName": "Sludge Bomb",
    "description": "Sludge is hurled to inflict damage. May also poison.",
    "longDescription": "Filthy sludge is hurled at the foe. 30% poison chance.",
    "types": [
      10
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 21,
    "effectChance": 30,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 189,
    "moveConst": "MOVE_MUD_SLAP",
    "name": "Mud-Slap",
    "shortName": "Mud-Slap",
    "description": "Hurls mud in the foe's face dealing repeated damage.",
    "longDescription": "Mud is hurled in the foe's face to inflict damage 2-5 times.",
    "types": [
      9
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 190,
    "moveConst": "MOVE_OCTAZOOKA",
    "name": "Octazooka",
    "shortName": "Octazooka",
    "description": "Fires a lump of ink to damage and cut accuracy.",
    "longDescription": "Ink is blasted in the foe's face. Lowers accuracy. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 120,
    "accuracy": 50,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 101,
    "effectChance": 100,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 191,
    "moveConst": "MOVE_SPIKES",
    "name": "Spikes",
    "shortName": "Spikes",
    "description": "Sets spikes that hurt a foe switching in.",
    "longDescription": "A trap of spikes is laid around the foe's party to hurt foes switching in.",
    "types": [
      9
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 7,
    "effect": 102,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 192,
    "moveConst": "MOVE_ZAP_CANNON",
    "name": "Zap Cannon",
    "shortName": "Zap Cannon",
    "description": "Powerful and sure to cause paralysis, but inaccurate.",
    "longDescription": "An electric blast is fired like a cannon. Always paralyzes. Mega Launcher boost",
    "types": [
      4
    ],
    "power": 120,
    "accuracy": 50,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 5,
    "effectChance": 100,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 193,
    "moveConst": "MOVE_FORESIGHT",
    "name": "Foresight",
    "shortName": "Foresight",
    "description": "Negates the foe's efforts to heighten evasiveness.",
    "longDescription": "Completely negates the foe's efforts to heighten its ability to evade.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 103,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 194,
    "moveConst": "MOVE_DESTINY_BOND",
    "name": "Destiny Bond",
    "shortName": "Destiny Bond",
    "description": "If the user faints, the foe is also made to faint.",
    "longDescription": "If the user faints, the foe delivering the final hit also faints.",
    "types": [
      16
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 104,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 195,
    "moveConst": "MOVE_PERISH_SONG",
    "name": "Perish Song",
    "shortName": "Perish Song",
    "description": "Any Pokémon hearing this song faints in 3 turns.",
    "longDescription": "Any battler that hears this faints in three turns unless it switches.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 105,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 196,
    "moveConst": "MOVE_ICY_WIND",
    "name": "Icy Wind",
    "shortName": "Icy Wind",
    "description": "A chilling attack that lowers the foe's Speed.",
    "longDescription": "A chilling wind is used to attack. Lowers foe's Speed. Air-based.",
    "types": [
      3
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 17,
    "effectChance": 100,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 197,
    "moveConst": "MOVE_DETECT",
    "name": "Detect",
    "shortName": "Detect",
    "description": "Evades attack, but may fail if used in succession.",
    "longDescription": "Evades attacks that may miss. Cannot be broken. May fail if used in succession.",
    "types": [
      1
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 198,
    "moveConst": "MOVE_BONE_RUSH",
    "name": "Bone Rush",
    "shortName": "Bone Rush",
    "description": "Strikes with a bone 2 to 5 times. Always goes first.",
    "longDescription": "Strikes with a bone 2 to 5 times. Hits swiftly with +1 priority.",
    "types": [
      9
    ],
    "power": 15,
    "accuracy": 100,
    "pp": 10,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      15
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 199,
    "moveConst": "MOVE_LOCK_ON",
    "name": "Lock-On",
    "shortName": "Lock-On",
    "description": "Locks on to the foe to ensure the next move hits.",
    "longDescription": "The user locks on to the foe, making the next move sure to hit.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 106,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 200,
    "moveConst": "MOVE_OUTRAGE",
    "name": "Outrage",
    "shortName": "Outrage",
    "description": "A rampage of 2 to 3 turns that confuses the user.",
    "longDescription": "The user thrashes about for two to three turns, then becomes confused.",
    "types": [
      15
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 3,
    "effect": 18,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 201,
    "moveConst": "MOVE_SANDSTORM",
    "name": "Sandstorm",
    "shortName": "Sandstorm",
    "description": "Causes a sandstorm that rages for several turns.",
    "longDescription": "An 8-turn sandstorm that damages all types except Rock, Ground, and Steel.",
    "types": [
      14
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 107,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 202,
    "moveConst": "MOVE_GIGA_DRAIN",
    "name": "Giga Drain",
    "shortName": "Giga Drain",
    "description": "An attack that steals half the damage inflicted.",
    "longDescription": "A harsh attack that absorbs half the damage it inflicted to restore HP.",
    "types": [
      8
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 203,
    "moveConst": "MOVE_ENDURE",
    "name": "Endure",
    "shortName": "Endure",
    "description": "Endures any attack for 1 turn, leaving at least 1HP.",
    "longDescription": "The user endures any hit with 1 HP left. It may fail if used in succession.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 108,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 204,
    "moveConst": "MOVE_CHARM",
    "name": "Charm",
    "shortName": "Charm",
    "description": "Charms the foe and sharply reduces its Attack.",
    "longDescription": "The foe is charmed by the user's cute appeals, sharply cutting its Attack.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 109,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 205,
    "moveConst": "MOVE_ROLLOUT",
    "name": "Rollout",
    "shortName": "Rollout",
    "description": "Rolls into a ball to strike with rising intensity.",
    "longDescription": "A rolling attack that becomes stronger each time it hits.",
    "types": [
      14
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 92,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 206,
    "moveConst": "MOVE_FALSE_SWIPE",
    "name": "False Swipe",
    "shortName": "False Swipe",
    "description": "An attack that leaves the foe with at least 1 HP.",
    "longDescription": "Can't KO the foe. 50% chance to inflict bleed. Keen Edge boost.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 110,
    "effectChance": 50,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 207,
    "moveConst": "MOVE_SWAGGER",
    "name": "Swagger",
    "shortName": "Swagger",
    "description": "Enrages the foe, but also sharply raises Attack.",
    "longDescription": "A move that makes the foe enraged, but also sharply raises its Attack.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 85,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 111,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 208,
    "moveConst": "MOVE_MILK_DRINK",
    "name": "Milk Drink",
    "shortName": "Milk Drink",
    "description": "Recovers up to half the user's maximum HP.",
    "longDescription": "Heals the user by up to half its full HP. It can be used to heal an ally.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 74,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 209,
    "moveConst": "MOVE_SPARK",
    "name": "Spark",
    "shortName": "Spark",
    "description": "An electrified tackle with +2 priority. May paralyze.",
    "longDescription": "Rapid electrical tackle. Has 10% paralyze chance. Has +2 priority.",
    "types": [
      4
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 2,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 210,
    "moveConst": "MOVE_FURY_CUTTER",
    "name": "Fury Cutter",
    "shortName": "Fury Cutter",
    "description": "Slices the foe 3 times in a row with rising intensity.",
    "longDescription": "A 3-slice attack. More powerful with each successive hit. Keen Edge boost.",
    "types": [
      5
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 87,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 211,
    "moveConst": "MOVE_STEEL_WING",
    "name": "Steel Wing",
    "shortName": "Steel Wing",
    "description": "Strikes the foe with hard wings spread wide.",
    "longDescription": "Hits with wings of steel. 20% chance to raise Defense. Air-based.",
    "types": [
      7
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 112,
    "effectChance": 20,
    "flags": [
      0,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 212,
    "moveConst": "MOVE_MEAN_LOOK",
    "name": "Mean Look",
    "shortName": "Mean Look",
    "description": "Fixes the foe with a mean look that prevents escape.",
    "longDescription": "The foe is fixed with a mean look that prevents it from escaping.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 89,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 213,
    "moveConst": "MOVE_ATTRACT",
    "name": "Attract",
    "shortName": "Attract",
    "description": "Halves the Atk & SpAtk of the opposite gender.",
    "longDescription": "Inflicts infatuation on opposite gender which halves Atk and SpAtk.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 90,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 113,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 214,
    "moveConst": "MOVE_SLEEP_TALK",
    "name": "Sleep Talk",
    "shortName": "Sleep Talk",
    "description": "Uses an available move randomly while asleep.",
    "longDescription": "While asleep, the user randomly uses one of the moves it knows.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 5,
    "effect": 114,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 215,
    "moveConst": "MOVE_HEAL_BELL",
    "name": "Heal Bell",
    "shortName": "Heal Bell",
    "description": "Chimes soothingly to heal all status abnormalities.",
    "longDescription": "Heals the status problems of allies and restores 30% HP to the user.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 115,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 216,
    "moveConst": "MOVE_RETURN",
    "name": "Return",
    "shortName": "Return",
    "description": "A reliable and strong Normal-type attack.",
    "longDescription": "A strong and reliable attack that shows the user's loyalty.",
    "types": [
      0
    ],
    "power": 102,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 217,
    "moveConst": "MOVE_PRESENT",
    "name": "Present",
    "shortName": "Present",
    "description": "A sly attack that damages foes and heals allies.",
    "longDescription": "Deals typeless damage to foes, restores 50% HP to allies.",
    "types": [
      18
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 116,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 218,
    "moveConst": "MOVE_FRUSTRATION",
    "name": "Frustration",
    "shortName": "Frustration",
    "description": "Deals double damage if the last move failed.",
    "longDescription": "The user unleashes its frustration. Failing moves doubles damage.",
    "types": [
      11
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 117,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 219,
    "moveConst": "MOVE_SAFEGUARD",
    "name": "Safeguard",
    "shortName": "Safeguard",
    "description": "A mystical force prevents all status problems.",
    "longDescription": "It protects the user's party from all status problems for five turns.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 118,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 220,
    "moveConst": "MOVE_PAIN_SPLIT",
    "name": "Pain Split",
    "shortName": "Pain Split",
    "description": "Adds the user and foe's HP, then shares them equally.",
    "longDescription": "The user adds its HP to the foe's HP, then equally shares the total HP.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 119,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 221,
    "moveConst": "MOVE_SACRED_FIRE",
    "name": "Sacred Fire",
    "shortName": "Sacred Fire",
    "description": "A mystical fire attack that may inflict a burn.",
    "longDescription": "A mystical and powerful fire attack that always inflicts a burn.",
    "types": [
      2
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 222,
    "moveConst": "MOVE_MAGNITUDE",
    "name": "Magnitude",
    "shortName": "Magnitude",
    "description": "A ground-shaking attack of random intensity.",
    "longDescription": "A ground-shaking attack against all standing Pokémon. Its power varies.",
    "types": [
      9
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 120,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 223,
    "moveConst": "MOVE_DYNAMIC_PUNCH",
    "name": "Dynamic Punch",
    "shortName": "DynamicPunch",
    "description": "Powerful and sure to cause confusion, but inaccurate.",
    "longDescription": "The foe is punched with the user's full power. It confuses the foe if it hits.",
    "types": [
      1
    ],
    "power": 120,
    "accuracy": 50,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 47,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 224,
    "moveConst": "MOVE_MEGAHORN",
    "name": "Megahorn",
    "shortName": "Megahorn",
    "description": "A brutal ramming attack using out-thrust horns.",
    "longDescription": "A brutal ramming attack. Ignores foe's stat changes. Mighty Horn boost.",
    "types": [
      5
    ],
    "power": 120,
    "accuracy": 85,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 225,
    "moveConst": "MOVE_DRAGON_BREATH",
    "name": "Dragon Breath",
    "shortName": "DragonBreath",
    "description": "Strikes the foe with an incredible blast of breath.",
    "longDescription": "The foe is hit with an incredible blast. 100% burn chance.",
    "types": [
      15
    ],
    "power": 20,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 226,
    "moveConst": "MOVE_BATON_PASS",
    "name": "Baton Pass",
    "shortName": "Baton Pass",
    "description": "Switches out the user while keeping effects in play.",
    "longDescription": "The user switches out, passing along any stat changes to the new battler.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 121,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 227,
    "moveConst": "MOVE_ENCORE",
    "name": "Encore",
    "shortName": "Encore",
    "description": "Makes the foe repeat its last move over 2 to 6 turns.",
    "longDescription": "Makes the foe use the move it last used repeatedly for two to six turns.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 122,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 228,
    "moveConst": "MOVE_PURSUIT",
    "name": "Pursuit",
    "shortName": "Pursuit",
    "description": "Inflicts bad damage if used on a foe switching out.",
    "longDescription": "An attack move that works especially well on a foe that is switching out.",
    "types": [
      11
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 123,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 229,
    "moveConst": "MOVE_RAPID_SPIN",
    "name": "Rapid Spin",
    "shortName": "Rapid Spin",
    "description": "Clears some hazards. Ups speed by +1.",
    "longDescription": "Frees the user from Bind, Leech Seed, Spikes etc. Ups Speed by +1.",
    "types": [
      0
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 124,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 230,
    "moveConst": "MOVE_SWEET_SCENT",
    "name": "Sweet Scent",
    "shortName": "Sweet Scent",
    "description": "Allures the foe to harshly reduce evasiveness.",
    "longDescription": "Allures the foe to reduce evasiveness. It also attracts wild Pokémon.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 125,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 231,
    "moveConst": "MOVE_IRON_TAIL",
    "name": "Iron Tail",
    "shortName": "Iron Tail",
    "description": "Attacks with a rock-hard tail. May lower Defense.",
    "longDescription": "An attack with a steel-hard tail. 20% chance to lower foe's Defense.",
    "types": [
      7
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 232,
    "moveConst": "MOVE_METAL_CLAW",
    "name": "Metal Claw",
    "shortName": "Metal Claw",
    "description": "A claw attack that may raise the user's Attack.",
    "longDescription": "The foe is attacked with steel claws. 20% chance to raise the user's Attack.",
    "types": [
      7
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 127,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 233,
    "moveConst": "MOVE_VITAL_THROW",
    "name": "Vital Throw",
    "shortName": "Vital Throw",
    "description": "Makes the user's move last, but it never misses.",
    "longDescription": "Makes the user attack after the foe. In return, it will not miss.",
    "types": [
      1
    ],
    "power": 120,
    "accuracy": 0,
    "pp": 10,
    "priority": -1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 234,
    "moveConst": "MOVE_MORNING_SUN",
    "name": "Morning Sun",
    "shortName": "Morning Sun",
    "description": "Restores HP. The amount varies with the weather.",
    "longDescription": "Restores the user's HP. The amount of HP regained varies with the weather.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 128,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 235,
    "moveConst": "MOVE_SYNTHESIS",
    "name": "Synthesis",
    "shortName": "Synthesis",
    "description": "Restores HP. The amount varies with the weather.",
    "longDescription": "Restores the user's HP. The amount of HP regained varies with the weather.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 129,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 236,
    "moveConst": "MOVE_MOONLIGHT",
    "name": "Moonlight",
    "shortName": "Moonlight",
    "description": "Restores HP. The amount varies with the weather.",
    "longDescription": "Restores the user's HP. The amount of HP regained varies with the weather.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 130,
    "effectChance": 0,
    "flags": [
      16
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 237,
    "moveConst": "MOVE_HIDDEN_POWER",
    "name": "Hidden Power",
    "shortName": "Hidden Power",
    "description": "The effectiveness varies with the user.",
    "longDescription": "An attack that varies in type depending on the user.",
    "types": [
      0
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 131,
    "effectChance": 0,
    "flags": [
      5
    ],
    "arg": "",
    "usesHpType": true,
    "archetype": "vanilla"
  },
  {
    "id": 238,
    "moveConst": "MOVE_CROSS_CHOP",
    "name": "Cross Chop",
    "shortName": "Cross Chop",
    "description": "A double-chopping attack. High critical-hit ratio.",
    "longDescription": "The foe is hit with double chops. It has a high critical-hit ratio.",
    "types": [
      1
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 239,
    "moveConst": "MOVE_TWISTER",
    "name": "Twister",
    "shortName": "Twister",
    "description": "Whips up a vicious twister to engulf the foe.",
    "longDescription": "A vicious twister envelops the foe for 4 to 5 turns. Air-based.",
    "types": [
      15
    ],
    "power": 50,
    "accuracy": 90,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 11,
    "effectChance": 100,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 240,
    "moveConst": "MOVE_RAIN_DANCE",
    "name": "Rain Dance",
    "shortName": "Rain Dance",
    "description": "Boosts the power of Water-type moves for 5 turns.",
    "longDescription": "A heavy rain falls for eight turns, powering up Water-type moves 50%.",
    "types": [
      12
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 132,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 241,
    "moveConst": "MOVE_SUNNY_DAY",
    "name": "Sunny Day",
    "shortName": "Sunny Day",
    "description": "Boosts the power of Fire-type moves for 5 turns.",
    "longDescription": "The sun blazes for eight turns, powering up Fire-type moves by 50%.",
    "types": [
      2
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 133,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 242,
    "moveConst": "MOVE_CRUNCH",
    "name": "Crunch",
    "shortName": "Crunch",
    "description": "Crunches with sharp fangs. May lower Defense.",
    "longDescription": "The foe is crunched with sharp fangs. 20% chance to lower foe's Def.",
    "types": [
      11
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 243,
    "moveConst": "MOVE_MIRROR_COAT",
    "name": "Mirror Coat",
    "shortName": "Mirror Coat",
    "description": "Counters the foe's special attack at double the power.",
    "longDescription": "A retaliation move that pays back the foe's special attack double.",
    "types": [
      13
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "priority": -5,
    "split": 1,
    "target": 5,
    "effect": 134,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 244,
    "moveConst": "MOVE_PSYCH_UP",
    "name": "Psych Up",
    "shortName": "Psych Up",
    "description": "Copies the foe's effect(s) and gives to the user.",
    "longDescription": "The user hypnotizes itself into copying any stat change made by the foe.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 135,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 245,
    "moveConst": "MOVE_EXTREME_SPEED",
    "name": "Extreme Speed",
    "shortName": "ExtremeSpeed",
    "description": "An extremely fast and powerful attack.",
    "longDescription": "A blindingly speedy charge attack with +2 priority.",
    "types": [
      0
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 5,
    "priority": 2,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 246,
    "moveConst": "MOVE_ANCIENT_POWER",
    "name": "Ancient Power",
    "shortName": "AncientPower",
    "description": "An attack that may raise all stats.",
    "longDescription": "An ancient power is used to attack. 10% chance to raise all the user's stats.",
    "types": [
      14
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 136,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 247,
    "moveConst": "MOVE_SHADOW_BALL",
    "name": "Shadow Ball",
    "shortName": "Shadow Ball",
    "description": "Hurls a black blob that may lower the foe's Sp. Def.",
    "longDescription": "A shadowy blob is hurled at the foe. 20% chance to lower foe's SpDef.",
    "types": [
      16
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 20,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 248,
    "moveConst": "MOVE_FUTURE_SIGHT",
    "name": "Future Sight",
    "shortName": "Future Sight",
    "description": "Heightens inner power to strike 2 turns later.",
    "longDescription": "Two turns after this move is used, the foe is attacked psychically.",
    "types": [
      13
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 137,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 249,
    "moveConst": "MOVE_ROCK_SMASH",
    "name": "Rock Smash",
    "shortName": "Rock Smash",
    "description": "A rock-crushing attack that lowers the foe's Defense.",
    "longDescription": "An attack which also cuts foe's Defense. It can also smash cracked boulders.",
    "types": [
      1
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 250,
    "moveConst": "MOVE_WHIRLPOOL",
    "name": "Whirlpool",
    "shortName": "Whirlpool",
    "description": "Traps and hurts the foe in a whirlpool for 2 to 5 turns.",
    "longDescription": "The foe is trapped for four or five turns. 30% drench chance. Field-based.",
    "types": [
      12
    ],
    "power": 50,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 30,
    "flags": [
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 251,
    "moveConst": "MOVE_BEAT_UP",
    "name": "Beat Up",
    "shortName": "Beat Up",
    "description": "Summons party Pokémon to join in the attack.",
    "longDescription": "All party Pokémon join in the attack. The more allies, the more damage.",
    "types": [
      11
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 138,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 252,
    "moveConst": "MOVE_FAKE_OUT",
    "name": "Fake Out",
    "shortName": "Fake Out",
    "description": "A 1st-turn, 1st-strike move that causes flinching.",
    "longDescription": "An attack that hits first and causes flinching. Usable only on 1st turn.",
    "types": [
      0
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "priority": 3,
    "split": 0,
    "target": 0,
    "effect": 139,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 253,
    "moveConst": "MOVE_UPROAR",
    "name": "Uproar",
    "shortName": "Uproar",
    "description": "A tantrum of 2 to 3 turns that confuses the user.",
    "longDescription": "The user throws a tantrum for two to three turns, then becomes confused.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 3,
    "effect": 18,
    "effectChance": 100,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 254,
    "moveConst": "MOVE_STOCKPILE",
    "name": "Stockpile",
    "shortName": "Stockpile",
    "description": "Charges up power for up to 3 turns.",
    "longDescription": "The user charges up power for use later. It can be used three times.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 140,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 255,
    "moveConst": "MOVE_SPIT_UP",
    "name": "Spit Up",
    "shortName": "Spit Up",
    "description": "Spits up stored stockpiles for heavy damage.",
    "longDescription": "Uses the attacker's primary type. Uses Stockpiles in place of PP if available.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 2,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 141,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 256,
    "moveConst": "MOVE_SWALLOW",
    "name": "Swallow",
    "shortName": "Swallow",
    "description": "Swallows down Stockpiles to restore HP.",
    "longDescription": "Restores 50% HP. Uses Stockpiles in place of PP if available.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 2,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 142,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 257,
    "moveConst": "MOVE_HEAT_WAVE",
    "name": "Heat Wave",
    "shortName": "Heat Wave",
    "description": "Exhales a hot breath on the foe. May inflict a burn.",
    "longDescription": "The user exhales a heated breath. 10% burn chance. Air-based.",
    "types": [
      2
    ],
    "power": 95,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 3,
    "effectChance": 10,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 258,
    "moveConst": "MOVE_HAIL",
    "name": "Hail",
    "shortName": "Hail",
    "description": "Summons a hailstorm that strikes every turn.",
    "longDescription": "A hailstorm lasting eight turns damages all Pokémon except the Ice-type.",
    "types": [
      3
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 143,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 259,
    "moveConst": "MOVE_TORMENT",
    "name": "Torment",
    "shortName": "Torment",
    "description": "Torments the foe and stops successive use of a move.",
    "longDescription": "It enrages the foe, making it incapable of using the same move successively.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 144,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 260,
    "moveConst": "MOVE_FLATTER",
    "name": "Flatter",
    "shortName": "Flatter",
    "description": "Enrages the foe, but raises its SpAtk",
    "longDescription": "Flattery is used to enrage the foe, but its Sp. Atk also rises.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 145,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 261,
    "moveConst": "MOVE_WILL_O_WISP",
    "name": "Will-O-Wisp",
    "shortName": "Will-O-Wisp",
    "description": "Inflicts a burn on the foe with intense fire.",
    "longDescription": "A blueish-white flame burns the target. Never misses if user is Fire-type.",
    "types": [
      2
    ],
    "power": 0,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 146,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 262,
    "moveConst": "MOVE_MEMENTO",
    "name": "Memento",
    "shortName": "Memento",
    "description": "The user faints and lowers the foe's abilities.",
    "longDescription": "The user faints, but sharply lowers the foe's Attack and SpAtk",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 147,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 263,
    "moveConst": "MOVE_FACADE",
    "name": "Facade",
    "shortName": "Facade",
    "description": "Doubles damage if burned, paralyzed, or poisoned.",
    "longDescription": "An attack that is boosted if user is burned, poisoned, or paralyzed.",
    "types": [
      0
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 148,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 264,
    "moveConst": "MOVE_FOCUS_PUNCH",
    "name": "Focus Punch",
    "shortName": "Focus Punch",
    "description": "A powerful loyalty attack. Damage is reduced if hit.",
    "longDescription": "Moves last. Damage reduced to 40BP if hit. Iron Fist boost.",
    "types": [
      1
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 20,
    "priority": -3,
    "split": 0,
    "target": 0,
    "effect": 149,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 265,
    "moveConst": "MOVE_SMELLING_SALTS",
    "name": "Smelling Salts",
    "shortName": "SmellngSalts",
    "description": "Deals damage and cures the user of their status.",
    "longDescription": "Deals damage and cures the user's status.",
    "types": [
      1
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 150,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 266,
    "moveConst": "MOVE_FOLLOW_ME",
    "name": "Follow Me",
    "shortName": "Follow Me",
    "description": "Draws attention to make foes attack only the user.",
    "longDescription": "The user draws attention to itself, making foes attack only the user.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 2,
    "split": 2,
    "target": 2,
    "effect": 151,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 267,
    "moveConst": "MOVE_NATURE_POWER",
    "name": "Nature Power",
    "shortName": "Nature Power",
    "description": "Type and power changes depending on the terrain.",
    "longDescription": "This move's type and power changes depending on the terrain when used.",
    "types": [
      0
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 152,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 268,
    "moveConst": "MOVE_CHARGE",
    "name": "Charge",
    "shortName": "Charge",
    "description": "Charges power to boost the electric move used next.",
    "longDescription": "The user charges power to boost the Electric move it uses next.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 153,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 269,
    "moveConst": "MOVE_TAUNT",
    "name": "Taunt",
    "shortName": "Taunt",
    "description": "Taunts the foe into only using attack moves.",
    "longDescription": "The foe is taunted into a rage that allows it to use only attack moves.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 154,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 270,
    "moveConst": "MOVE_HELPING_HAND",
    "name": "Helping Hand",
    "shortName": "Helping Hand",
    "description": "Boosts the power of the recipient's moves.",
    "longDescription": "A move that boosts the power of the ally's attack in a battle.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 5,
    "split": 2,
    "target": 8,
    "effect": 155,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 271,
    "moveConst": "MOVE_TRICK",
    "name": "Trick",
    "shortName": "Trick",
    "description": "Tricks the foe into trading held items.",
    "longDescription": "A move that tricks the foe into trading held items with the user.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 156,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 272,
    "moveConst": "MOVE_ROLE_PLAY",
    "name": "Role Play",
    "shortName": "Role Play",
    "description": "Mimics the target and copies its special ability.",
    "longDescription": "The user mimics the foe completely and copies the foe's ability.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 157,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 273,
    "moveConst": "MOVE_WISH",
    "name": "Wish",
    "shortName": "Wish",
    "description": "A wish that restores HP. It takes time to work.",
    "longDescription": "A self-healing move that restores half the full HP on the next turn.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 158,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 274,
    "moveConst": "MOVE_ASSIST",
    "name": "Assist",
    "shortName": "Assist",
    "description": "Attacks randomly with one of the partner's moves.",
    "longDescription": "The user randomly picks and uses a move of an allied Pokémon.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 5,
    "effect": 159,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 275,
    "moveConst": "MOVE_INGRAIN",
    "name": "Ingrain",
    "shortName": "Ingrain",
    "description": "Lays roots that restore HP. The user can't switch out.",
    "longDescription": "The user lays roots that restore HP on every turn. It can't switch out.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 160,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 276,
    "moveConst": "MOVE_SUPERPOWER",
    "name": "Superpower",
    "shortName": "Superpower",
    "description": "Boosts strength sharply, but lowers abilities.",
    "longDescription": "A powerful attack, but it also lowers the user's Attack and Defense stats.",
    "types": [
      1
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 161,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 277,
    "moveConst": "MOVE_MAGIC_COAT",
    "name": "Magic Coat",
    "shortName": "Magic Coat",
    "description": "Reflects special effects back to the attacker.",
    "longDescription": "Reflects back the foe's Leech Seed and any status-damaging move.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 4,
    "split": 2,
    "target": 5,
    "effect": 162,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 278,
    "moveConst": "MOVE_RECYCLE",
    "name": "Recycle",
    "shortName": "Recycle",
    "description": "Recycles a used item for one more use.",
    "longDescription": "A move that recycles a used item for use once more.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 163,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 279,
    "moveConst": "MOVE_REVENGE",
    "name": "Revenge",
    "shortName": "Revenge",
    "description": "An attack that gains power if injured by the foe.",
    "longDescription": "An attack move that gains in intensity if the target has hurt the user.",
    "types": [
      1
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 164,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 280,
    "moveConst": "MOVE_BRICK_BREAK",
    "name": "Brick Break",
    "shortName": "Brick Break",
    "description": "Destroys barriers such as Reflect and causes damage.",
    "longDescription": "An attack that also breaks any barrier like Light Screen and Reflect.",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 165,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 281,
    "moveConst": "MOVE_YAWN",
    "name": "Yawn",
    "shortName": "Yawn",
    "description": "Lulls the foe into yawning, then sleeping next turn.",
    "longDescription": "A huge yawn lulls the foe into falling asleep on the next turn.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 166,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 282,
    "moveConst": "MOVE_KNOCK_OFF",
    "name": "Knock Off",
    "shortName": "Knock Off",
    "description": "Knocks down the foe's held item to prevent its use.",
    "longDescription": "Knocks down the foe's held item to prevent its use during the battle.",
    "types": [
      11
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 167,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 283,
    "moveConst": "MOVE_ENDEAVOR",
    "name": "Endeavor",
    "shortName": "Endeavor",
    "description": "Gains power if the user's HP is lower than the foe's HP.",
    "longDescription": "Gains power the fewer HP the user has compared with the foe.",
    "types": [
      0
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 168,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 284,
    "moveConst": "MOVE_ERUPTION",
    "name": "Eruption",
    "shortName": "Eruption",
    "description": "The higher the user's HP, the more damage caused.",
    "longDescription": "The higher the user's HP, the more powerful it is. Mega Launcher boost",
    "types": [
      2
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 169,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 285,
    "moveConst": "MOVE_SKILL_SWAP",
    "name": "Skill Swap",
    "shortName": "Skill Swap",
    "description": "The user swaps special abilities with the target.",
    "longDescription": "The user employs its psychic power to swap abilities with the foe.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 170,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 286,
    "moveConst": "MOVE_IMPRISON",
    "name": "Imprison",
    "shortName": "Imprison",
    "description": "Prevents foes from using moves known by the user.",
    "longDescription": "Prevents foes from using any move that is also known by the user.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 171,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 287,
    "moveConst": "MOVE_REFRESH",
    "name": "Refresh",
    "shortName": "Refresh",
    "description": "Rests for a moment to cure status and heal.",
    "longDescription": "Cures status and heals the user for 25% HP.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 172,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 288,
    "moveConst": "MOVE_GRUDGE",
    "name": "Grudge",
    "shortName": "Grudge",
    "description": "If the user faints, deletes all PP of foe's last move.",
    "longDescription": "If the user faints, this move deletes the PP of the move that finished it.",
    "types": [
      16
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 173,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 289,
    "moveConst": "MOVE_SNATCH",
    "name": "Snatch",
    "shortName": "Snatch",
    "description": "Steals the effects of the move the target uses next.",
    "longDescription": "Steals the effects of the foe's healing or status-changing move.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 5,
    "effect": 174,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 290,
    "moveConst": "MOVE_SECRET_POWER",
    "name": "Secret Power",
    "shortName": "Secret Power",
    "description": "Physical Hidden Power. Varies with the user.",
    "longDescription": "Physical Hidden Power. Varies in type depending on the user. Field-based.",
    "types": [
      0
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 131,
    "effectChance": 0,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": true,
    "archetype": "vanilla"
  },
  {
    "id": 291,
    "moveConst": "MOVE_DIVE",
    "name": "Dive",
    "shortName": "Dive",
    "description": "Dives underwater the first turn and strikes next turn.",
    "longDescription": "The user dives underwater and hits next turn. 10% drench chance. Field-based.",
    "types": [
      12
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 10,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 292,
    "moveConst": "MOVE_ARM_THRUST",
    "name": "Arm Thrust",
    "shortName": "Arm Thrust",
    "description": "Straight-arm punches that strike the foe 2 to 5 times.",
    "longDescription": "Straigh-arm punches that hit two to five times.",
    "types": [
      1
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 293,
    "moveConst": "MOVE_CAMOUFLAGE",
    "name": "Camouflage",
    "shortName": "Camouflage",
    "description": "Shields the user from an attack and becomes that type.",
    "longDescription": "Protects against attacks and copies their types. May fail if used in succession.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 294,
    "moveConst": "MOVE_TAIL_GLOW",
    "name": "Tail Glow",
    "shortName": "Tail Glow",
    "description": "Flashes a light that raises Sp. Atk by +3.",
    "longDescription": "The user flashes a light that raises its Sp. Atk stat by +3.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 175,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 295,
    "moveConst": "MOVE_LUSTER_PURGE",
    "name": "Luster Purge",
    "shortName": "Luster Purge",
    "description": "Attacks with a burst of light. May lower Sp. Def.",
    "longDescription": "A burst of light injures the foe. Has 50% chance to lower the foe's SpDef.",
    "types": [
      13
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 50,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 296,
    "moveConst": "MOVE_MIST_BALL",
    "name": "Mist Ball",
    "shortName": "Mist Ball",
    "description": "Attacks with a flurry of down. May lower SpAtk",
    "longDescription": "A flurry of down hits the foe. Has 50% chance to lower the foe's SpAtk.",
    "types": [
      13
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 29,
    "effectChance": 50,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 297,
    "moveConst": "MOVE_FEATHER_DANCE",
    "name": "Feather Dance",
    "shortName": "FeatherDance",
    "description": "Envelops the foe with down to sharply reduce Attack.",
    "longDescription": "The foe is covered with a mass of down that sharply cuts the Attack stat.",
    "types": [
      6
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 109,
    "effectChance": 0,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 298,
    "moveConst": "MOVE_TEETER_DANCE",
    "name": "Teeter Dance",
    "shortName": "Teeter Dance",
    "description": "Confuses all Pokémon on the scene.",
    "longDescription": "A wobbly dance that confuses all the Pokémon in battle.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 4,
    "effect": 176,
    "effectChance": 0,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 299,
    "moveConst": "MOVE_BLAZE_KICK",
    "name": "Blaze Kick",
    "shortName": "Blaze Kick",
    "description": "A kick with a high critical-hit ratio. May cause a burn.",
    "longDescription": "A fiery kick with a high crit ratio. 10% burn chance. Striker boost.",
    "types": [
      2
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 10,
    "flags": [
      0,
      1,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 300,
    "moveConst": "MOVE_MUD_SPORT",
    "name": "Mud Sport",
    "shortName": "Mud Sport",
    "description": "Covers the user in mud to raise electrical resistance.",
    "longDescription": "Weakens Electric-type attacks while the user is in the battle.",
    "types": [
      9
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 177,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 301,
    "moveConst": "MOVE_ICE_BALL",
    "name": "Ice Ball",
    "shortName": "Ice Ball",
    "description": "Rolls into a ball to strike with rising intensity.",
    "longDescription": "A rolling attack that becomes stronger each time it rolls.",
    "types": [
      3
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 92,
    "effectChance": 0,
    "flags": [
      0,
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 302,
    "moveConst": "MOVE_NEEDLE_ARM",
    "name": "Needle Arm",
    "shortName": "Needle Arm",
    "description": "Attacks with thorny arms. May cause flinching.",
    "longDescription": "Attacks with thorny arms. Sets creeping thorns. Iron Fist boost.",
    "types": [
      8
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 178,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 303,
    "moveConst": "MOVE_SLACK_OFF",
    "name": "Slack Off",
    "shortName": "Slack Off",
    "description": "Slacks off and restores half the maximum HP.",
    "longDescription": "The user slacks off and restores its HP by half its full HP.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 56,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 304,
    "moveConst": "MOVE_HYPER_VOICE",
    "name": "Hyper Voice",
    "shortName": "Hyper Voice",
    "description": "A loud attack that uses sound waves to injure.",
    "longDescription": "The user lets loose a horribly loud shout with the power to damage.",
    "types": [
      0
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 305,
    "moveConst": "MOVE_POISON_FANG",
    "name": "Poison Fang",
    "shortName": "Poison Fang",
    "description": "A sharp-fanged attack. May badly poison the foe.",
    "longDescription": "The foe is bitten with toxic fangs. 50% poison chance. Strong Jaw boost.",
    "types": [
      10
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 179,
    "effectChance": 50,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 306,
    "moveConst": "MOVE_CRUSH_CLAW",
    "name": "Crush Claw",
    "shortName": "Crush Claw",
    "description": "Tears at the foe with sharp claws. May lower Defense.",
    "longDescription": "The foe is attacked with sharp claws. 50% chance to lower foe's Defense.",
    "types": [
      0
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 50,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 307,
    "moveConst": "MOVE_BLAST_BURN",
    "name": "Blast Burn",
    "shortName": "Blast Burn",
    "description": "Powerful, but can't be used next turn.",
    "longDescription": "The foe is hit with a huge explosion. Can only be used every-other turn.",
    "types": [
      2
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 308,
    "moveConst": "MOVE_HYDRO_CANNON",
    "name": "Hydro Cannon",
    "shortName": "Hydro Cannon",
    "description": "Powerful, but can't be used the next turn.",
    "longDescription": "The foe is hit with a watery cannon. Can only be used every-other turn.",
    "types": [
      12
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 309,
    "moveConst": "MOVE_METEOR_MASH",
    "name": "Meteor Mash",
    "shortName": "Meteor Mash",
    "description": "Fires a meteor-like punch. May raise Attack.",
    "longDescription": "Hard, fast punch. 20% chance to raise user's Attack. Iron Fist boost.",
    "types": [
      7
    ],
    "power": 90,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 127,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 310,
    "moveConst": "MOVE_ASTONISH",
    "name": "Astonish",
    "shortName": "Astonish",
    "description": "An attack that shocks the foe into flinching.",
    "longDescription": "A startling shout that flinches the target. Can only be used on the first turn.",
    "types": [
      16
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "priority": 3,
    "split": 0,
    "target": 0,
    "effect": 139,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 311,
    "moveConst": "MOVE_WEATHER_BALL",
    "name": "Weather Ball",
    "shortName": "Weather Ball",
    "description": "The move's type and power change with the weather.",
    "longDescription": "Varies in power and type depending on the weather. Weather-based.",
    "types": [
      0
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 180,
    "effectChance": 0,
    "flags": [
      12,
      13,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 312,
    "moveConst": "MOVE_AROMATHERAPY",
    "name": "Aromatherapy",
    "shortName": "Aromatherapy",
    "description": "Heals all status problems with a soothing scent.",
    "longDescription": "Heals the status problems of allies and restores 30% HP to the user.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 115,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 313,
    "moveConst": "MOVE_FAKE_TEARS",
    "name": "Fake Tears",
    "shortName": "Fake Tears",
    "description": "Feigns crying to sharply lower the foe's Sp. Def.",
    "longDescription": "The user feigns crying to sharply lower the foe's Sp. Def stat.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 181,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 314,
    "moveConst": "MOVE_AIR_CUTTER",
    "name": "Air Cutter",
    "shortName": "Air Cutter",
    "description": "Hacks with razorlike wind. High critical-hit ratio.",
    "longDescription": "Strikes with sharp wind. High crit ratio. Air-based. Keen edge boost.",
    "types": [
      6
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      1,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 315,
    "moveConst": "MOVE_OVERHEAT",
    "name": "Overheat",
    "shortName": "Overheat",
    "description": "Allows a full-power attack, but sharply lowers SpAtk",
    "longDescription": "An intense attack that also sharply reduces the user's Sp. Atk stat.",
    "types": [
      2
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 182,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 316,
    "moveConst": "MOVE_ODOR_SLEUTH",
    "name": "Odor Sleuth",
    "shortName": "Odor Sleuth",
    "description": "Negates the foe's efforts to heighten evasiveness.",
    "longDescription": "Completely negates the foe's efforts to heighten its ability to evade.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 103,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 317,
    "moveConst": "MOVE_ROCK_TOMB",
    "name": "Rock Tomb",
    "shortName": "Rock Tomb",
    "description": "Stops the foe from moving with rocks and cuts Speed.",
    "longDescription": "Attacks with Boulders that lower speed on hit. Throw-based.",
    "types": [
      14
    ],
    "power": 55,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 100,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 318,
    "moveConst": "MOVE_SILVER_WIND",
    "name": "Silver Wind",
    "shortName": "Silver Wind",
    "description": "A powdery attack that may raise abilities.",
    "longDescription": "Attacks with silver dust. 10% chance to raise all stats. Weather-based.",
    "types": [
      5
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 136,
    "effectChance": 10,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 319,
    "moveConst": "MOVE_METAL_SOUND",
    "name": "Metal Sound",
    "shortName": "Metal Sound",
    "description": "Emits a horrible screech that sharply lowers Sp. Def.",
    "longDescription": "A horrible metallic screech is used to sharply lower the foe's Sp. Def.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 85,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 181,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 320,
    "moveConst": "MOVE_GRASS_WHISTLE",
    "name": "Grass Whistle",
    "shortName": "GrassWhistle",
    "description": "Lulls the foe into sleep with a pleasant melody.",
    "longDescription": "A pleasant melody is played to lull the foe into a deep sleep.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 60,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 24,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 321,
    "moveConst": "MOVE_TICKLE",
    "name": "Tickle",
    "shortName": "Tickle",
    "description": "Makes the foe laugh to lower Attack and Defense.",
    "longDescription": "The foe is made to laugh, reducing its Attack and Defense stats.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 183,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 322,
    "moveConst": "MOVE_COSMIC_POWER",
    "name": "Cosmic Power",
    "shortName": "Cosmic Power",
    "description": "Raises Defense and Sp. Def with a mystic power.",
    "longDescription": "The user absorbs a mystic power to raise its Defense and Sp. Def.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 184,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 323,
    "moveConst": "MOVE_WATER_SPOUT",
    "name": "Water Spout",
    "shortName": "Water Spout",
    "description": "Inflicts more damage if the user's HP is high.",
    "longDescription": "Does more damage at high HP. 10% drench chance. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 169,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 324,
    "moveConst": "MOVE_SIGNAL_BEAM",
    "name": "Signal Beam",
    "shortName": "Signal Beam",
    "description": "A strange beam attack that may confuse the foe.",
    "longDescription": "Hits with a flashing beam. 20% confusion chance Mega Launcher boost",
    "types": [
      5
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 47,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 325,
    "moveConst": "MOVE_SHADOW_PUNCH",
    "name": "Shadow Punch",
    "shortName": "Shadow Punch",
    "description": "An unavoidable punch that is thrown from shadows.",
    "longDescription": "A strong punch from the shadows. Always hits. Iron Fist boost.",
    "types": [
      16
    ],
    "power": 90,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 326,
    "moveConst": "MOVE_EXTRASENSORY",
    "name": "Extrasensory",
    "shortName": "Extrasensory",
    "description": "Attacks with a peculiar power. May cause flinching.",
    "longDescription": "Attacks with an odd power. 10% flinch chance. Never misses. Increased crit rate.",
    "types": [
      13
    ],
    "power": 90,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 12,
    "effectChance": 10,
    "flags": [
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 327,
    "moveConst": "MOVE_SKY_UPPERCUT",
    "name": "Sky Uppercut",
    "shortName": "Sky Uppercut",
    "description": "An uppercut thrown as if leaping into the sky.",
    "longDescription": "The user attacks with an uppercut thrown skywards. Iron Fist boost.",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 328,
    "moveConst": "MOVE_SAND_TOMB",
    "name": "Sand Tomb",
    "shortName": "Sand Tomb",
    "description": "Traps and hurts the foe in quicksand for 2 to 5 turns.",
    "longDescription": "The foe is trapped inside a painful sandstorm for four or five turns.",
    "types": [
      9
    ],
    "power": 50,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 329,
    "moveConst": "MOVE_SHEER_COLD",
    "name": "Sheer Cold",
    "shortName": "Sheer Cold",
    "description": "Super effective on Water. 20% frostbite chance.",
    "longDescription": "This move is super effective on Water. 20% frostbite chance.",
    "types": [
      3
    ],
    "power": 100,
    "accuracy": 80,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 185,
    "effectChance": 20,
    "flags": [
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 330,
    "moveConst": "MOVE_MUDDY_WATER",
    "name": "Muddy Water",
    "shortName": "Muddy Water",
    "description": "Attacks with muddy water. May lower accuracy.",
    "longDescription": "Ground-and Water-type at the same time. 30% chance to lower foe's accuracy.",
    "types": [
      9,
      12
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 101,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 331,
    "moveConst": "MOVE_BULLET_SEED",
    "name": "Bullet Seed",
    "shortName": "Bullet Seed",
    "description": "Shoots 2 to 5 seeds in a row to strike the foe.",
    "longDescription": "The user shoots seeds at the foe. Two to five seeds are shot at once.",
    "types": [
      8
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 332,
    "moveConst": "MOVE_AERIAL_ACE",
    "name": "Aerial Ace",
    "shortName": "Aerial Ace",
    "description": "An extremely speedy and unavoidable attack.",
    "longDescription": "Always crits and never misses. Keen Edge boost.",
    "types": [
      6
    ],
    "power": 60,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 333,
    "moveConst": "MOVE_ICICLE_SPEAR",
    "name": "Icicle Spear",
    "shortName": "Icicle Spear",
    "description": "Attacks the foe by firing 2 to 5 icicles in a row.",
    "longDescription": "Sharp icicles are fired at the foe. It strikes two to five times.",
    "types": [
      3
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 334,
    "moveConst": "MOVE_IRON_DEFENSE",
    "name": "Iron Defense",
    "shortName": "Iron Defense",
    "description": "Hardens the body's surface to sharply raise Defense.",
    "longDescription": "The user hardens its body's surface to sharply raise its Defense stat.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 78,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 335,
    "moveConst": "MOVE_BLOCK",
    "name": "Block",
    "shortName": "Block",
    "description": "Blocks the foe's way to prevent escape.",
    "longDescription": "The user blocks the foe's way with arms spread wide to prevent escape.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 89,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 336,
    "moveConst": "MOVE_HOWL",
    "name": "Howl",
    "shortName": "Howl",
    "description": "Howls to raise the spirit and boosts Attack.",
    "longDescription": "The user howls to raise its spirit and boost its Attack stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 186,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 337,
    "moveConst": "MOVE_DRAGON_CLAW",
    "name": "Dragon Claw",
    "shortName": "Dragon Claw",
    "description": "Slashes the foe with sharp claws.",
    "longDescription": "Sharp, huge claws hook and slash the foe quickly. Keen Edge boost.",
    "types": [
      15
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 338,
    "moveConst": "MOVE_FRENZY_PLANT",
    "name": "Frenzy Plant",
    "shortName": "Frenzy Plant",
    "description": "Powerful, but can't be used next turn.",
    "longDescription": "The foe is hit with an enormous branch. Can only be used every-other turn.",
    "types": [
      8
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 339,
    "moveConst": "MOVE_BULK_UP",
    "name": "Bulk Up",
    "shortName": "Bulk Up",
    "description": "Bulks up the body to boost both Attack and Defense.",
    "longDescription": "The user bulks up its body to boost both its Attack and Defense stats.",
    "types": [
      1
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 187,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 340,
    "moveConst": "MOVE_BOUNCE",
    "name": "Bounce",
    "shortName": "Bounce",
    "description": "Bounces up, then down the next turn. May paralyze.",
    "longDescription": "The user bounces on the foe on the 2nd turn. 30% paralyze chance.",
    "types": [
      6
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 341,
    "moveConst": "MOVE_MUD_SHOT",
    "name": "Mud Shot",
    "shortName": "Mud Shot",
    "description": "10% Speed drop chance. Has +1 priority.",
    "longDescription": "Has a 10% chance to drop foe's Speed. Has +1 priority. Mega Launcher boost",
    "types": [
      9
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 17,
    "effectChance": 10,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 342,
    "moveConst": "MOVE_POISON_TAIL",
    "name": "Poison Tail",
    "shortName": "Poison Tail",
    "description": "Forces the target to Switch. May also poison.",
    "longDescription": "An attack that forces the target to switch. 10% poison chance.",
    "types": [
      10
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": -6,
    "split": 0,
    "target": 0,
    "effect": 9,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 343,
    "moveConst": "MOVE_COVET",
    "name": "Covet",
    "shortName": "Covet",
    "description": "Cutely begs to obtain an item held by the foe.",
    "longDescription": "Steals or removes the foe's item. +1 priority if the user has no item.",
    "types": [
      0
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 88,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 344,
    "moveConst": "MOVE_VOLT_TACKLE",
    "name": "Volt Tackle",
    "shortName": "Volt Tackle",
    "description": "A life-risking tackle that slightly hurts the user.",
    "longDescription": "The user throws an electrified tackle. 25% recoil, 10% paralyze chance.",
    "types": [
      4
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 10,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 345,
    "moveConst": "MOVE_MAGICAL_LEAF",
    "name": "Magical Leaf",
    "shortName": "Magical Leaf",
    "description": "Attacks with a strange leaf that cannot be evaded.",
    "longDescription": "Attacks with a leaf that can't be evaded and deals physical damage.",
    "types": [
      8
    ],
    "power": 80,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 4,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 346,
    "moveConst": "MOVE_WATER_SPORT",
    "name": "Water Sport",
    "shortName": "Water Sport",
    "description": "The user becomes soaked to raise resistance to fire.",
    "longDescription": "Weakens Fire-type attacks while the user is in the battle.",
    "types": [
      12
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 188,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 347,
    "moveConst": "MOVE_CALM_MIND",
    "name": "Calm Mind",
    "shortName": "Calm Mind",
    "description": "Raises Sp. Atk and Sp. Def by focusing the mind.",
    "longDescription": "The user focuses its mind to raise the Sp. Atk and Sp. Def stats.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 189,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 348,
    "moveConst": "MOVE_LEAF_BLADE",
    "name": "Leaf Blade",
    "shortName": "Leaf Blade",
    "description": "Slashes with a sharp leaf. High critical-hit ratio.",
    "longDescription": "The foe is slashed with a sharp leaf. High crit ratio. Keen Edge boost.",
    "types": [
      8
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 349,
    "moveConst": "MOVE_DRAGON_DANCE",
    "name": "Dragon Dance",
    "shortName": "Dragon Dance",
    "description": "A mystical dance that ups Attack and Speed.",
    "longDescription": "A mystic, powerful dance that boosts the user's Attack and Speed stats.",
    "types": [
      15
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 190,
    "effectChance": 0,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 350,
    "moveConst": "MOVE_ROCK_BLAST",
    "name": "Rock Blast",
    "shortName": "Rock Blast",
    "description": "Hurls boulders at the foe 2 to 5 times in a row.",
    "longDescription": "The user hurls two to five hard rocks at the foe to attack.",
    "types": [
      14
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 351,
    "moveConst": "MOVE_SHOCK_WAVE",
    "name": "Shock Wave",
    "shortName": "Shock Wave",
    "description": "A fast and unavoidable +2 priority attack.",
    "longDescription": "A rapid jolt of electricity strikes. Never misses. Has +2 priority.",
    "types": [
      4
    ],
    "power": 40,
    "accuracy": 0,
    "pp": 15,
    "priority": 2,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 352,
    "moveConst": "MOVE_WATER_PULSE",
    "name": "Water Pulse",
    "shortName": "Water Pulse",
    "description": "Attacks with ultrasonic waves. May confuse the foe.",
    "longDescription": "A pulsing blast of water. Has 20% confusion chance. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 47,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 353,
    "moveConst": "MOVE_DOOM_DESIRE",
    "name": "Doom Desire",
    "shortName": "Doom Desire",
    "description": "Summons strong sunlight to attack 2 turns later.",
    "longDescription": "A move that attacks the foe with a blast of light two turns after use.",
    "types": [
      7
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 137,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 354,
    "moveConst": "MOVE_PSYCHO_BOOST",
    "name": "Psycho Boost",
    "shortName": "Psycho Boost",
    "description": "Allows a full-power attack, but sharply lowers SpAtk",
    "longDescription": "An intense attack that also sharply reduces the user's Sp. Atk stat.",
    "types": [
      13
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 182,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 355,
    "moveConst": "MOVE_ROOST",
    "name": "Roost",
    "shortName": "Roost",
    "description": "Restores the user's HP by half of its max HP.",
    "longDescription": "The user lands and rests its body. It restores up to half of its max HP.",
    "types": [
      6
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 191,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 356,
    "moveConst": "MOVE_GRAVITY",
    "name": "Gravity",
    "shortName": "Gravity",
    "description": "Gravity is intensified negating levitation.",
    "longDescription": "Gravity is upped for five turns, making flight unusuable and negating Levitate.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 192,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 357,
    "moveConst": "MOVE_MIRACLE_EYE",
    "name": "Miracle Eye",
    "shortName": "Miracle Eye",
    "description": "Inverts the target's type matchups.",
    "longDescription": "The foe is treated as being in inverse room. Psychic-type is immune to Dark.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 193,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 358,
    "moveConst": "MOVE_WAKE_UP_SLAP",
    "name": "Wake-Up Slap",
    "shortName": "Wake-Up Slap",
    "description": "Powerful against sleeping foes, but also heals them.",
    "longDescription": "This attack hits sleeping foes for big damage. It also wakes the foe up.",
    "types": [
      1
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 194,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 359,
    "moveConst": "MOVE_HAMMER_ARM",
    "name": "Hammer Arm",
    "shortName": "Hammer Arm",
    "description": "A swinging fist attack that also lowers Speed.",
    "longDescription": "A strong, heavy fist is swung. Drops the user's Speed. Iron Fist boost.",
    "types": [
      1
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 195,
    "effectChance": 100,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 360,
    "moveConst": "MOVE_GYRO_BALL",
    "name": "Gyro Ball",
    "shortName": "Gyro Ball",
    "description": "A high-speed spin that does more damage to faster foes.",
    "longDescription": "A fast spin. The slower the user, the greater the damage.",
    "types": [
      7
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 196,
    "effectChance": 0,
    "flags": [
      0,
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 361,
    "moveConst": "MOVE_HEALING_WISH",
    "name": "Healing Wish",
    "shortName": "Healing Wish",
    "description": "The user faints to heal up the recipient.",
    "longDescription": "The user faints. Its replacement has its HP restored and status cured.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 197,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 362,
    "moveConst": "MOVE_BRINE",
    "name": "Brine",
    "shortName": "Brine",
    "description": "Deals Super Effective damage vs Water.",
    "longDescription": "Deals Super Effective damage vs Water.",
    "types": [
      12
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 363,
    "moveConst": "MOVE_NATURAL_GIFT",
    "name": "Natural Gift",
    "shortName": "Natural Gift",
    "description": "The effectiveness varies with the held Berry.",
    "longDescription": "The user's Berry determines this attack's type and its power.",
    "types": [
      0
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 198,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 364,
    "moveConst": "MOVE_FEINT",
    "name": "Feint",
    "shortName": "Feint",
    "description": "An attack that hits foes using moves like Protect.",
    "longDescription": "Hits a foe using moves like Protect, lifting the effect of those moves.",
    "types": [
      0
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 10,
    "priority": 2,
    "split": 0,
    "target": 0,
    "effect": 199,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 365,
    "moveConst": "MOVE_PLUCK",
    "name": "Pluck",
    "shortName": "Pluck",
    "description": "Plucks the foe's item away, eating it if it's a Berry.",
    "longDescription": "Plucks away the foe's item, eating it if it's a Berry. Strong Jaw boost.",
    "types": [
      6
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 200,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 366,
    "moveConst": "MOVE_TAILWIND",
    "name": "Tailwind",
    "shortName": "Tailwind",
    "description": "Whips up a turbulent breeze that raises Speed.",
    "longDescription": "A turbulent whirl-wind that ups the Speed stat of the party for 4 turns.",
    "types": [
      6
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 201,
    "effectChance": 0,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 367,
    "moveConst": "MOVE_ACUPRESSURE",
    "name": "Acupressure",
    "shortName": "Acupressure",
    "description": "The user sharply raises one of its stats.",
    "longDescription": "The user applies pressure to stress points, sharply boosting one stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 9,
    "effect": 202,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 368,
    "moveConst": "MOVE_METAL_BURST",
    "name": "Metal Burst",
    "shortName": "Metal Burst",
    "description": "Retaliates any hit with greater power.",
    "longDescription": "The user retaliates with greater power against the last foe to damage it.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": -5,
    "split": 0,
    "target": 5,
    "effect": 203,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 369,
    "moveConst": "MOVE_U_TURN",
    "name": "U-turn",
    "shortName": "U-turn",
    "description": "Does damage then switches out the user.",
    "longDescription": "The user strikes, and then switches with a waiting party Pokémon.",
    "types": [
      5
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 204,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 370,
    "moveConst": "MOVE_CLOSE_COMBAT",
    "name": "Close Combat",
    "shortName": "Close Combat",
    "description": "A strong attack but lowers the defensive stats.",
    "longDescription": "Fights up close, without guarding. Cuts Defenses.",
    "types": [
      1
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 34,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 371,
    "moveConst": "MOVE_PAYBACK",
    "name": "Payback",
    "shortName": "Payback",
    "description": "An attack that gains power if the user moves last.",
    "longDescription": "If the user moves after the foe, this attack does double the damage.",
    "types": [
      11
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 205,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 372,
    "moveConst": "MOVE_ASSURANCE",
    "name": "Assurance",
    "shortName": "Assurance",
    "description": "An attack that gains power if the foe has been hurt.",
    "longDescription": "Power doubles if the foe has already taken damage in the same turn.",
    "types": [
      11
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 206,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 373,
    "moveConst": "MOVE_EMBARGO",
    "name": "Embargo",
    "shortName": "Embargo",
    "description": "Prevents the foe from using any items.",
    "longDescription": "Prevents the foe from using its item. Items cannot be used on it, either.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 207,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 374,
    "moveConst": "MOVE_FLING",
    "name": "Fling",
    "shortName": "Fling",
    "description": "The effectiveness varies with the held item.",
    "longDescription": "The user flings its item to attack. Outcome varies with items. Throw-based.",
    "types": [
      11
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 208,
    "effectChance": 100,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 375,
    "moveConst": "MOVE_PSYCHO_SHIFT",
    "name": "Psycho Shift",
    "shortName": "Psycho Shift",
    "description": "Transfers status problems to the foe.",
    "longDescription": "The user transfers its status problems to the target using psychic powers.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 209,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 376,
    "moveConst": "MOVE_TRUMP_CARD",
    "name": "Trump Card",
    "shortName": "Trump Card",
    "description": "Inflicts critical damage when the user's HP is low.",
    "longDescription": "A desperate attack that deals critical damage when the user is below 50% HP.",
    "types": [
      0
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 95,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 377,
    "moveConst": "MOVE_HEAL_BLOCK",
    "name": "Heal Block",
    "shortName": "Heal Block",
    "description": "Prevents the foe from recovering any HP.",
    "longDescription": "The foe cannot use any moves, held items or Abilities that recover HP.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 210,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 378,
    "moveConst": "MOVE_WRING_OUT",
    "name": "Wring Out",
    "shortName": "Wring Out",
    "description": "Crushes quicker foes, nullifying their ability.",
    "longDescription": "Negates abilities until switch out if the foe moves first. Ignores abilities.",
    "types": [
      0
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 211,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 379,
    "moveConst": "MOVE_POWER_TRICK",
    "name": "Power Trick",
    "shortName": "Power Trick",
    "description": "The user swaps its Attack and Defense stats.",
    "longDescription": "The user swaps its Attack and Defense stats and stat boosts.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 212,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 380,
    "moveConst": "MOVE_GASTRO_ACID",
    "name": "Gastro Acid",
    "shortName": "Gastro Acid",
    "description": "Suppresses the foe's ability and poisons it.",
    "longDescription": "Spews stomach acid at the foe, negating its abilities and poisoning it.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 213,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 381,
    "moveConst": "MOVE_LUCKY_CHANT",
    "name": "Lucky Chant",
    "shortName": "Lucky Chant",
    "description": "Prevents the foe from landing critical hits.",
    "longDescription": "For 5 turns, the foe is prevented from landing critical hits.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 214,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 382,
    "moveConst": "MOVE_ME_FIRST",
    "name": "Me First",
    "shortName": "Me First",
    "description": "Executes the foe's attack with greater power.",
    "longDescription": "The foe's intended move is stolen and used first, with greater power.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 215,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 383,
    "moveConst": "MOVE_COPYCAT",
    "name": "Copycat",
    "shortName": "Copycat",
    "description": "The user mimics the last move used by a foe.",
    "longDescription": "The user tries to mimic the move used immediately before it.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 5,
    "effect": 216,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 384,
    "moveConst": "MOVE_POWER_SWAP",
    "name": "Power Swap",
    "shortName": "Power Swap",
    "description": "Swaps Attack and Special Attack with the foe.",
    "longDescription": "Swaps Attack and Special Attack stats and stat boosts with the target.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 217,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 385,
    "moveConst": "MOVE_GUARD_SWAP",
    "name": "Guard Swap",
    "shortName": "Guard Swap",
    "description": "Swaps Defense and Special Defense with the foe.",
    "longDescription": "Swaps Defense and Special Defense stats and stat boosts with the target.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 218,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 386,
    "moveConst": "MOVE_PUNISHMENT",
    "name": "Punishment",
    "shortName": "Punishment",
    "description": "Does more damage if the foe has powered up.",
    "longDescription": "Deals more damage if the user has more stat changes. Pierces increased defenses.",
    "types": [
      11
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 219,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 387,
    "moveConst": "MOVE_LAST_RESORT",
    "name": "Last Resort",
    "shortName": "Last Resort",
    "description": "Can only be used if every other move has been used.",
    "longDescription": "This fails unless the user has used its other moves in the battle already.",
    "types": [
      0
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 220,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 388,
    "moveConst": "MOVE_WORRY_SEED",
    "name": "Worry Seed",
    "shortName": "Worry Seed",
    "description": "Plants a seed that causes Fear and gives Insomina.",
    "longDescription": "A seed that is planted that causes Fear and gives Insomnia.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 221,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 389,
    "moveConst": "MOVE_SUCKER_PUNCH",
    "name": "Sucker Punch",
    "shortName": "Sucker Punch",
    "description": "Strikes first if the foe is preparing an attack.",
    "longDescription": "User strikes first. It fails if the foe is not attacking.",
    "types": [
      11
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 5,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 222,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 390,
    "moveConst": "MOVE_TOXIC_SPIKES",
    "name": "Toxic Spikes",
    "shortName": "Toxic Spikes",
    "description": "Sets spikes that poison a foe switching in.",
    "longDescription": "Poison spikes are laid at the foe's feet. They poison foes that switch in.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 7,
    "effect": 223,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 391,
    "moveConst": "MOVE_HEART_SWAP",
    "name": "Heart Swap",
    "shortName": "Heart Swap",
    "description": "Swaps any stat changes with the foe.",
    "longDescription": "The user employs its psychic powers to swap stat changes with the target.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 224,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 392,
    "moveConst": "MOVE_AQUA_RING",
    "name": "Aqua Ring",
    "shortName": "Aqua Ring",
    "description": "Forms a veil of water that restores HP.",
    "longDescription": "The user envelops itself in a veil of water. It regains 1/16 HP every turn.",
    "types": [
      12
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 225,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 393,
    "moveConst": "MOVE_MAGNET_RISE",
    "name": "Magnet Rise",
    "shortName": "Magnet Rise",
    "description": "The user levitates with electromagnetism.",
    "longDescription": "The user levitates using electrically generated magnetism for five turns.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 226,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 394,
    "moveConst": "MOVE_FLARE_BLITZ",
    "name": "Flare Blitz",
    "shortName": "Flare Blitz",
    "description": "A charge that may burn the foe. Also hurts the user.",
    "longDescription": "A ruthless, fiery charge which has 33% recoil. Has 10% burn chance.",
    "types": [
      2
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 10,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 395,
    "moveConst": "MOVE_FORCE_PALM",
    "name": "Force Palm",
    "shortName": "Force Palm",
    "description": "Sends a shock wave through the foe, clearing their stats.",
    "longDescription": "The foe is attacked with a shock wave. Clears stat changes.",
    "types": [
      1
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 35,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 396,
    "moveConst": "MOVE_AURA_SPHERE",
    "name": "Aura Sphere",
    "shortName": "Aura Sphere",
    "description": "Attacks with an aura blast that cannot be evaded.",
    "longDescription": "A strong blast of aura power. Always hits. Mega Launcher boost",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 397,
    "moveConst": "MOVE_ROCK_POLISH",
    "name": "Rock Polish",
    "shortName": "Rock Polish",
    "description": "Polishes the body to sharply raise Speed.",
    "longDescription": "The user polishes its body to reduce drag. This sharply raises its Speed.",
    "types": [
      14
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 50,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 398,
    "moveConst": "MOVE_POISON_JAB",
    "name": "Poison Jab",
    "shortName": "Poison Jab",
    "description": "A stabbing attack that may poison the foe.",
    "longDescription": "A stabbing attack with 30% poison chance. Iron Fist & Mighty Horn boost.",
    "types": [
      10
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 21,
    "effectChance": 30,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 399,
    "moveConst": "MOVE_DARK_PULSE",
    "name": "Dark Pulse",
    "shortName": "Dark Pulse",
    "description": "Attacks with a horrible aura. May cause flinching.",
    "longDescription": "Releases an aura with dark thoughts. 20% flinch chance. Mega Launcher boost",
    "types": [
      11
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 12,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 400,
    "moveConst": "MOVE_NIGHT_SLASH",
    "name": "Night Slash",
    "shortName": "Night Slash",
    "description": "Hits as soon as possible. High critical-hit ratio.",
    "longDescription": "The user waits to strike, slashing the foe. High crit. Keen Edge boost.",
    "types": [
      11
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 401,
    "moveConst": "MOVE_AQUA_TAIL",
    "name": "Aqua Tail",
    "shortName": "Aqua Tail",
    "description": "The user swings its tail like a wave to attack.",
    "longDescription": "The user attacks by swinging its tail. High crit chance.",
    "types": [
      12
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 402,
    "moveConst": "MOVE_SEED_BOMB",
    "name": "Seed Bomb",
    "shortName": "Seed Bomb",
    "description": "A barrage of hard seeds is fired at the foe.",
    "longDescription": "A barrage of hard-shelled seeds is slammed on the foe from above.",
    "types": [
      8
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      12,
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 403,
    "moveConst": "MOVE_AIR_SLASH",
    "name": "Air Slash",
    "shortName": "Air Slash",
    "description": "Attacks with a blade of air. May cause flinching.",
    "longDescription": "A blade of air with 30% flinch chance. Keen Edge boost. Air-based.",
    "types": [
      6
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 404,
    "moveConst": "MOVE_X_SCISSOR",
    "name": "X-Scissor",
    "shortName": "X-Scissor",
    "description": "Cuts like scissors. High critical-hit ratio.",
    "longDescription": "Slashes with crossed scythes, claws etc. High crit ratio. Keen Edge boost.",
    "types": [
      5
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 405,
    "moveConst": "MOVE_BUG_BUZZ",
    "name": "Bug Buzz",
    "shortName": "Bug Buzz",
    "description": "A damaging sound wave that may lower Sp. Def.",
    "longDescription": "A harsh sound wave from the user. 20% chance to drop foe's Sp. Def.",
    "types": [
      5
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 20,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 406,
    "moveConst": "MOVE_DRAGON_PULSE",
    "name": "Dragon Pulse",
    "shortName": "Dragon Pulse",
    "description": "Generates a shock wave to damage the foe.",
    "longDescription": "The user's gaping mouth generates a shock wave attack. Mega Launcher boost",
    "types": [
      15
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 407,
    "moveConst": "MOVE_DRAGON_RUSH",
    "name": "Dragon Rush",
    "shortName": "Dragon Rush",
    "description": "Tackles the foe with menace. Damages the user.",
    "longDescription": "A tackle exhibiting devastating menace. 20% flinch chance. 33% recoil.",
    "types": [
      15
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 227,
    "effectChance": 20,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 408,
    "moveConst": "MOVE_POWER_GEM",
    "name": "Power Gem",
    "shortName": "Power Gem",
    "description": "Attacks with rays of light that sparkle like diamonds.",
    "longDescription": "A ray of light is shot at the foe, sparkling as if it were made of gems.",
    "types": [
      14
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 409,
    "moveConst": "MOVE_DRAIN_PUNCH",
    "name": "Drain Punch",
    "shortName": "Drain Punch",
    "description": "A punch that absorbs over 30% of damage inflicted.",
    "longDescription": "A forceful punch that recovers 50% of the damage. Iron Fist boost.",
    "types": [
      1
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 410,
    "moveConst": "MOVE_VACUUM_WAVE",
    "name": "Vacuum Wave",
    "shortName": "Vacuum Wave",
    "description": "Whirls its fists to send a wave that strikes first.",
    "longDescription": "A pure vacuum is fired at the foe. +1 priority.",
    "types": [
      1
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 411,
    "moveConst": "MOVE_FOCUS_BLAST",
    "name": "Focus Blast",
    "shortName": "Focus Blast",
    "description": "Attacks at full power. May lower Sp. Def.",
    "longDescription": "Mental power is un-leashed. 65% chance to lower foe's SpDef. Mega Launcher boost",
    "types": [
      1
    ],
    "power": 120,
    "accuracy": 75,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 65,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 412,
    "moveConst": "MOVE_ENERGY_BALL",
    "name": "Energy Ball",
    "shortName": "Energy Ball",
    "description": "Draws power from nature to attack. May lower Sp. Def.",
    "longDescription": "Power is drawn from nature and fired at the foe. 10% chance to drop foe's SpDef.",
    "types": [
      8
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 10,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 413,
    "moveConst": "MOVE_BRAVE_BIRD",
    "name": "Brave Bird",
    "shortName": "Brave Bird",
    "description": "A low altitude charge that also hurts the user.",
    "longDescription": "Wings tucked in, the user charges at the foe. 33% recoil damage.",
    "types": [
      6
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      0,
      8,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 414,
    "moveConst": "MOVE_EARTH_POWER",
    "name": "Earth Power",
    "shortName": "Earth Power",
    "description": "Makes the ground erupt with power. May lower Sp. Def.",
    "longDescription": "The ground erupts below the foe. 10% chance to lower the foe's SpDef.",
    "types": [
      9
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 415,
    "moveConst": "MOVE_SWITCHEROO",
    "name": "Switcheroo",
    "shortName": "Switcheroo",
    "description": "Swaps items with the foe faster than the eye can see.",
    "longDescription": "The user trades held items with the foe faster than the eye can follow.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 156,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 416,
    "moveConst": "MOVE_GIGA_IMPACT",
    "name": "Giga Impact",
    "shortName": "Giga Impact",
    "description": "Powerful, but leaves the user immobile the next turn.",
    "longDescription": "Hits with immense force. Deals severe damage, needs to recharge.",
    "types": [
      0
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 30,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 417,
    "moveConst": "MOVE_NASTY_PLOT",
    "name": "Nasty Plot",
    "shortName": "Nasty Plot",
    "description": "Thinks bad thoughts to sharply boost SpAtk",
    "longDescription": "The user stimulates its brain with bad thoughts, sharply raising its SpAtk",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 228,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 418,
    "moveConst": "MOVE_BULLET_PUNCH",
    "name": "Bullet Punch",
    "shortName": "Bullet Punch",
    "description": "Punches as fast as a bul-let. It always hits first.",
    "longDescription": "Bullet-fast punches barrage the target. +1 priority. Iron Fist boost.",
    "types": [
      7
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 419,
    "moveConst": "MOVE_AVALANCHE",
    "name": "Avalanche",
    "shortName": "Avalanche",
    "description": "An attack that gains power if injured by the foe.",
    "longDescription": "An attack move that gains in intensity if the target has hurt the user.",
    "types": [
      3
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": -4,
    "split": 0,
    "target": 1,
    "effect": 164,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 420,
    "moveConst": "MOVE_ICE_SHARD",
    "name": "Ice Shard",
    "shortName": "Ice Shard",
    "description": "Hurls a chunk of ice that always strike first.",
    "longDescription": "Flash-frozen ice chunks are hurled at the foe. +1 priority.",
    "types": [
      3
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 421,
    "moveConst": "MOVE_SHADOW_CLAW",
    "name": "Shadow Claw",
    "shortName": "Shadow Claw",
    "description": "Strikes with a shadow claw. High critical-hit ratio.",
    "longDescription": "Claws made from shadows strike the foe. High crit. Keen Edge boost.",
    "types": [
      16
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 422,
    "moveConst": "MOVE_THUNDER_FANG",
    "name": "Thunder Fang",
    "shortName": "Thunder Fang",
    "description": "May cause flinching or leave the foe paralyzed.",
    "longDescription": "Electrified fangs. 10% paralyze or flinch chance. Strong Jaw boost.",
    "types": [
      4
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 229,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 423,
    "moveConst": "MOVE_ICE_FANG",
    "name": "Ice Fang",
    "shortName": "Ice Fang",
    "description": "May cause flinching or leave the foe frostbiten.",
    "longDescription": "Frozen fangs. 10% frostbite or flinch chance. Strong Jaw boost.",
    "types": [
      3
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 229,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 424,
    "moveConst": "MOVE_FIRE_FANG",
    "name": "Fire Fang",
    "shortName": "Fire Fang",
    "description": "May cause flinching or leave the foe with a burn.",
    "longDescription": "Fiery fangs. 10% burn or flinch chance. Strong Jaw boost.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 229,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 425,
    "moveConst": "MOVE_SHADOW_SNEAK",
    "name": "Shadow Sneak",
    "shortName": "Shadow Sneak",
    "description": "Extends the user's shadow to strike first.",
    "longDescription": "The user's shadow extends and strikes the foe. +1 priority.",
    "types": [
      16
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 426,
    "moveConst": "MOVE_MUD_BOMB",
    "name": "Mud Bomb",
    "shortName": "Mud Bomb",
    "description": "Can hit Flying foes, then knocks them to the ground.",
    "longDescription": "This move also hits foes that are in the air, and knocks them down.",
    "types": [
      9
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 230,
    "effectChance": 100,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 427,
    "moveConst": "MOVE_PSYCHO_CUT",
    "name": "Psycho Cut",
    "shortName": "Psycho Cut",
    "description": "Tears with psychic blades. High critical-hit ratio.",
    "longDescription": "Psychic blades strike the foe. High crit ratio. Keen Edge boost.",
    "types": [
      13
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [
      1,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 428,
    "moveConst": "MOVE_ZEN_HEADBUTT",
    "name": "Zen Headbutt",
    "shortName": "Zen Headbutt",
    "description": "Hits with a strong head-butt. May cause flinching.",
    "longDescription": "The user focuses, and strikes the foe. 20% flinch chance. Field-based.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 429,
    "moveConst": "MOVE_MIRROR_SHOT",
    "name": "Mirror Shot",
    "shortName": "Mirror Shot",
    "description": "Emits a flash of energy to damage and cut SpDef.",
    "longDescription": "A flash of energy is loosed at the foe. Lowers Special Defense.",
    "types": [
      7
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 430,
    "moveConst": "MOVE_FLASH_CANNON",
    "name": "Flash Cannon",
    "shortName": "Flash Cannon",
    "description": "Releases a blast of light that may lower Sp. Def.",
    "longDescription": "Light energy attack. 10% chance to lower their SpDef stat. Mega Launcher boost",
    "types": [
      7
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 10,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 431,
    "moveConst": "MOVE_ROCK_CLIMB",
    "name": "Rock Climb",
    "shortName": "Rock Climb",
    "description": "A charging attack that may confuse the foe.",
    "longDescription": "A charging attack. 30% confusion chance. Field-based.",
    "types": [
      14
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 30,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 432,
    "moveConst": "MOVE_DEFOG",
    "name": "Defog",
    "shortName": "Defog",
    "description": "Removes obstacles and lowers evasion.",
    "longDescription": "Wind blows across the battlefield, clearing barriers, obstacles, etc.",
    "types": [
      6
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 231,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 433,
    "moveConst": "MOVE_TRICK_ROOM",
    "name": "Trick Room",
    "shortName": "Trick Room",
    "description": "Slower Pokémon get to move first for 5 turns.",
    "longDescription": "A bizarre area is constructed for 5 turns where slower Pokémon move first.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": -7,
    "split": 2,
    "target": 6,
    "effect": 232,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 434,
    "moveConst": "MOVE_DRACO_METEOR",
    "name": "Draco Meteor",
    "shortName": "Draco Meteor",
    "description": "Casts comets onto the foe. Harshly lowers the SpAtk",
    "longDescription": "Comets strike down upon the foe. This harshly reduces the user's Sp. Atk stat.",
    "types": [
      15
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 182,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 435,
    "moveConst": "MOVE_DISCHARGE",
    "name": "Discharge",
    "shortName": "Discharge",
    "description": "Zaps the field with electri-city. May cause paralysis.",
    "longDescription": "Electricity is loosed on the field. 30% paralyze chance to foes/ally.",
    "types": [
      4
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 5,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 436,
    "moveConst": "MOVE_LAVA_PLUME",
    "name": "Lava Plume",
    "shortName": "Lava Plume",
    "description": "Scarlet flames torch everything around the user.",
    "longDescription": "Scarlet flames wash over all Pokémon in battle. 30% burn chance.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 3,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 437,
    "moveConst": "MOVE_LEAF_STORM",
    "name": "Leaf Storm",
    "shortName": "Leaf Storm",
    "description": "Whips up a storm of leaves. Harshly lowers SpAtk",
    "longDescription": "A storm of sharp leaves is whipped up. The user's Sp. Atk sharply falls.",
    "types": [
      8
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 182,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 438,
    "moveConst": "MOVE_POWER_WHIP",
    "name": "Power Whip",
    "shortName": "Power Whip",
    "description": "Violently lashes the foe with vines or tentacles.",
    "longDescription": "The user violently whirls its vines or tentacles to lash at the foe.",
    "types": [
      8
    ],
    "power": 120,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 439,
    "moveConst": "MOVE_ROCK_WRECKER",
    "name": "Rock Wrecker",
    "shortName": "Rock Wrecker",
    "description": "Powerful, but leaves the user immobile the next turn.",
    "longDescription": "Hurls a massive rock at the foe. User recharges after hit. Throw-based.",
    "types": [
      14
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      12,
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 440,
    "moveConst": "MOVE_CROSS_POISON",
    "name": "Cross Poison",
    "shortName": "Cross Poison",
    "description": "Two slashes that may poison a foe and do critical damage.",
    "longDescription": "Hits twice. High crit ratio. 10% poison chance. Keen Edge boost.",
    "types": [
      10
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 21,
    "effectChance": 10,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 441,
    "moveConst": "MOVE_GUNK_SHOT",
    "name": "Gunk Shot",
    "shortName": "Gunk Shot",
    "description": "Shoots filthy garbage at the foe. May also poison.",
    "longDescription": "Filthy garbage is shot at the foe. 30% poison chance. Mega Launcher boost",
    "types": [
      10
    ],
    "power": 120,
    "accuracy": 80,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 21,
    "effectChance": 30,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 442,
    "moveConst": "MOVE_IRON_HEAD",
    "name": "Iron Head",
    "shortName": "Iron Head",
    "description": "Slams the foe with a hard head. May cause flinching.",
    "longDescription": "The user slams the foe with its steel-hard head. 30% flinch chance.",
    "types": [
      7
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 443,
    "moveConst": "MOVE_MAGNET_BOMB",
    "name": "Magnet Bomb",
    "shortName": "Magnet Bomb",
    "description": "Launches a magnet that is Super Effective vs Steel.",
    "longDescription": "Launches a magnetic bomb that is Super Effective vs Steel. Never misses.",
    "types": [
      7
    ],
    "power": 70,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 444,
    "moveConst": "MOVE_STONE_EDGE",
    "name": "Stone Edge",
    "shortName": "Stone Edge",
    "description": "Stabs the foe with stones. High critical-hit ratio.",
    "longDescription": "Sharpened stones stab the foe from below. Critical hits land more easily.",
    "types": [
      14
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 445,
    "moveConst": "MOVE_CAPTIVATE",
    "name": "Captivate",
    "shortName": "Captivate",
    "description": "Deals additional damage if the target is infatuated.",
    "longDescription": "Deals double damage vs infatuated foes.",
    "types": [
      17
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 233,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 446,
    "moveConst": "MOVE_STEALTH_ROCK",
    "name": "Stealth Rock",
    "shortName": "Stealth Rock",
    "description": "Sets floating stones that hurt a foe switching in.",
    "longDescription": "Levitating stones surround the foe. This hurts foes that switch in.",
    "types": [
      14
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 7,
    "effect": 234,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 447,
    "moveConst": "MOVE_GRASS_KNOT",
    "name": "Grass Knot",
    "shortName": "Grass Knot",
    "description": "A snare attack that does more damage to heavier foes.",
    "longDescription": "A snaring grass trap that inflicts more damage on heavier foes.",
    "types": [
      8
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 31,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 448,
    "moveConst": "MOVE_CHATTER",
    "name": "Chatter",
    "shortName": "Chatter",
    "description": "Attacks with a sound wave that causes confusion.",
    "longDescription": "The foe is left confused by sound waves of deafening chatter.",
    "types": [
      6
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 47,
    "effectChance": 100,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 449,
    "moveConst": "MOVE_JUDGMENT",
    "name": "Judgment",
    "shortName": "Judgment",
    "description": "The type varies with the kind of Plate held.",
    "longDescription": "The type of this move varies with the kind of Plate the user is holding.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 235,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 450,
    "moveConst": "MOVE_BUG_BITE",
    "name": "Bug Bite",
    "shortName": "Bug Bite",
    "description": "Tears away the foe's item, eating it if it's a Berry.",
    "longDescription": "Removes the foe's item and eats it if it's a Berry. Strong Jaw boost.",
    "types": [
      5
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 200,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 451,
    "moveConst": "MOVE_CHARGE_BEAM",
    "name": "Charge Beam",
    "shortName": "Charge Beam",
    "description": "Fires a beam of electricity. Raises Sp. Atk by one stage.",
    "longDescription": "Attacks with an electric charge. Raises own SpAtk. Mega Launcher boost",
    "types": [
      4
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 236,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 452,
    "moveConst": "MOVE_WOOD_HAMMER",
    "name": "Wood Hammer",
    "shortName": "Wood Hammer",
    "description": "Slams the body into a foe The user gets hurt too.",
    "longDescription": "The user slams its rugged body into the foe. 33% recoil damage.",
    "types": [
      8
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      0,
      8,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 453,
    "moveConst": "MOVE_AQUA_JET",
    "name": "Aqua Jet",
    "shortName": "Aqua Jet",
    "description": "Strikes first by dashing at the foe at a high speed.",
    "longDescription": "The user lunges at the foe at a fast speed. This has +1 priority.",
    "types": [
      12
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 454,
    "moveConst": "MOVE_ATTACK_ORDER",
    "name": "Attack Order",
    "shortName": "Attack Order",
    "description": "Underlings pummel the foe. High critical-hit ratio.",
    "longDescription": "Underlings pummel the foe. Critical hits land more easily.",
    "types": [
      5
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 455,
    "moveConst": "MOVE_DEFEND_ORDER",
    "name": "Defend Order",
    "shortName": "Defend Order",
    "description": "Raises Defense and Sp. Def with a living shield.",
    "longDescription": "Underlings form a living shield which up the user's Sp. Def and Defense.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 184,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 456,
    "moveConst": "MOVE_HEAL_ORDER",
    "name": "Heal Order",
    "shortName": "Heal Order",
    "description": "The user's underlings show up to heal half its max HP.",
    "longDescription": "The user calls out its underlings to heal it, restoring half of its max HP.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 56,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 457,
    "moveConst": "MOVE_HEAD_SMASH",
    "name": "Head Smash",
    "shortName": "Head Smash",
    "description": "A life-risking headbutt that seriously hurts the user.",
    "longDescription": "A hazardous, full-power headbutt hits the foe. 50% recoil damage.",
    "types": [
      14
    ],
    "power": 150,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 237,
    "effectChance": 0,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 458,
    "moveConst": "MOVE_DOUBLE_HIT",
    "name": "Double Hit",
    "shortName": "Double Hit",
    "description": "Slams the foe with a tail etc. Strikes twice.",
    "longDescription": "The user slams the foe twice in a row. Increased crit rate.",
    "types": [
      0
    ],
    "power": 45,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 459,
    "moveConst": "MOVE_ROAR_OF_TIME",
    "name": "Roar of Time",
    "shortName": "Roar of Time",
    "description": "Moves last, but forces the target to switch out.",
    "longDescription": "A blast which distorts even time. Forces the target to switch. Moves last.",
    "types": [
      15
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": -6,
    "split": 1,
    "target": 0,
    "effect": 9,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 460,
    "moveConst": "MOVE_SPACIAL_REND",
    "name": "Spacial Rend",
    "shortName": "Spacial Rend",
    "description": "Tears the foe, and space. High critical-hit ratio.",
    "longDescription": "The foe, and the space around it, is torn. Critical hits land more easily.",
    "types": [
      15
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 461,
    "moveConst": "MOVE_LUNAR_DANCE",
    "name": "Lunar Dance",
    "shortName": "Lunar Dance",
    "description": "The user faints to heal up the recipient.",
    "longDescription": "The user faints. Its replacement has its HP restored and status cured.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 197,
    "effectChance": 0,
    "flags": [
      3,
      16
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 462,
    "moveConst": "MOVE_CRUSH_GRIP",
    "name": "Crush Grip",
    "shortName": "Crush Grip",
    "description": "Crushes quicker foes, nullifying their ability.",
    "longDescription": "This attack will also negate the foe's Ability if it has moved already.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 211,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 463,
    "moveConst": "MOVE_MAGMA_STORM",
    "name": "Magma Storm",
    "shortName": "Magma Storm",
    "description": "Traps the foe in a vortex of fire for 2 to 5 turns.",
    "longDescription": "The foe becomes trapped within a maelstrom of fire for 4 or 5 turns.",
    "types": [
      2
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 464,
    "moveConst": "MOVE_DARK_VOID",
    "name": "Dark Void",
    "shortName": "Dark Void",
    "description": "Drags the foe into total darkness, inducing Sleep.",
    "longDescription": "The foe is dragged into a world of total darkness that puts it to sleep.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 80,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 24,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 465,
    "moveConst": "MOVE_SEED_FLARE",
    "name": "Seed Flare",
    "shortName": "Seed Flare",
    "description": "Generates a shock wave that sharply reduces Sp. Def.",
    "longDescription": "A shock wave is loosed at the foe. 40% chance to lower foe's SpDef.",
    "types": [
      8
    ],
    "power": 120,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 238,
    "effectChance": 40,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 466,
    "moveConst": "MOVE_OMINOUS_WIND",
    "name": "Ominous Wind",
    "shortName": "Ominous Wind",
    "description": "A repulsive attack that may raise all stats.",
    "longDescription": "10% chance to raise all user's stats. Deals double damage in fog.",
    "types": [
      16
    ],
    "power": 55,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 10,
    "flags": [
      13,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 467,
    "moveConst": "MOVE_SHADOW_FORCE",
    "name": "Shadow Force",
    "shortName": "Shadow Force",
    "description": "Vanishes on the first turn then strikes the next turn.",
    "longDescription": "The user vanishes. The next turn, it strikes the foe, ignoring Protect.",
    "types": [
      16
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 468,
    "moveConst": "MOVE_HONE_CLAWS",
    "name": "Hone Claws",
    "shortName": "Hone Claws",
    "description": "Sharpens its claws to raise Attack and Accuracy.",
    "longDescription": "The user sharpens its claws to boost its Attack stat and accuracy.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 239,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 469,
    "moveConst": "MOVE_WIDE_GUARD",
    "name": "Wide Guard",
    "shortName": "Wide Guard",
    "description": "Evades wide-ranging attacks for one turn.",
    "longDescription": "For 1 turn, the user and its allies are protected from wide-ranging moves.",
    "types": [
      14
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 3,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 470,
    "moveConst": "MOVE_GUARD_SPLIT",
    "name": "Guard Split",
    "shortName": "Guard Split",
    "description": "Averages changes to Defense and Sp. Def with the foe.",
    "longDescription": "The user's Defense and Sp. Def stats are averaged with those of the target.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 240,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 471,
    "moveConst": "MOVE_POWER_SPLIT",
    "name": "Power Split",
    "shortName": "Power Split",
    "description": "Averages changes to Attack and Sp. Atk with the foe.",
    "longDescription": "The user's Attack and Sp. Atk stats are averaged with those of the target.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 241,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 472,
    "moveConst": "MOVE_WONDER_ROOM",
    "name": "Wonder Room",
    "shortName": "Wonder Room",
    "description": "Attack and SpAtk stats are swapped for 5 turns.",
    "longDescription": "For 5 turns, Attack and SpAtk stats are swapped and their stat buffs are ignored.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 242,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 473,
    "moveConst": "MOVE_PSYSHOCK",
    "name": "Psyshock",
    "shortName": "Psyshock",
    "description": "Attacks with a psychic wave that does physical damage.",
    "longDescription": "The user casts an odd psychic wave to attack the foe for physical damage.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 4,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 474,
    "moveConst": "MOVE_VENOSHOCK",
    "name": "Venoshock",
    "shortName": "Venoshock",
    "description": "Does double damage if the foe is poisoned.",
    "longDescription": "A special liquid that damages for double the power on poisoned targets.",
    "types": [
      10
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 243,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 475,
    "moveConst": "MOVE_AUTOTOMIZE",
    "name": "Autotomize",
    "shortName": "Autotomize",
    "description": "Sheds additional weight to sharply boost Speed.",
    "longDescription": "The user sheds part of its body to be lighter, sharply raising its Speed.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 244,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 476,
    "moveConst": "MOVE_RAGE_POWDER",
    "name": "Rage Powder",
    "shortName": "Rage Powder",
    "description": "Scatters powder to make foes attack only the user.",
    "longDescription": "Foes aim only at the user, enraged by a cloud of its irritating powder.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 2,
    "split": 2,
    "target": 2,
    "effect": 151,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 477,
    "moveConst": "MOVE_TELEKINESIS",
    "name": "Telekinesis",
    "shortName": "Telekinesis",
    "description": "Makes the foe float. It is easier to hit for 3 turns.",
    "longDescription": "The user floats its foe psychically for 3 turns, making the foe easier to hit.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 245,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 478,
    "moveConst": "MOVE_MAGIC_ROOM",
    "name": "Magic Room",
    "shortName": "Magic Room",
    "description": "Disables stones and passive DMG for 5 turns.",
    "longDescription": "Prevents passive damage and disables mega stones for 5 turns.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 246,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 479,
    "moveConst": "MOVE_SMACK_DOWN",
    "name": "Smack Down",
    "shortName": "Smack Down",
    "description": "Throws a rock to knock the foe down to the ground.",
    "longDescription": "The user throws a stone at its foe. Flying foes will fall to the ground.",
    "types": [
      14
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 230,
    "effectChance": 100,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 480,
    "moveConst": "MOVE_STORM_THROW",
    "name": "Storm Throw",
    "shortName": "Storm Throw",
    "description": "This attack always results in a critical hit.",
    "longDescription": "A fierce blow upon the foe which will always result in a critical hit.",
    "types": [
      1
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 481,
    "moveConst": "MOVE_FLAME_BURST",
    "name": "Flame Burst",
    "shortName": "Flame Burst",
    "description": "Also hits the foe's ally for 1/4 dmg. Has +1 priority.",
    "longDescription": "Also hits foe's ally for 1/4 dmg. +1 priority. Mega Launcher boost",
    "types": [
      2
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 247,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 482,
    "moveConst": "MOVE_SLUDGE_WAVE",
    "name": "Sludge Wave",
    "shortName": "Sludge Wave",
    "description": "Swamps the foe with a wave of sludge. May also poison.",
    "longDescription": "It swamps the area around the user with sludge. 10% poison chance.",
    "types": [
      10
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 21,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 483,
    "moveConst": "MOVE_QUIVER_DANCE",
    "name": "Quiver Dance",
    "shortName": "Quiver Dance",
    "description": "Dances to raise Sp. Atk Sp. Def and Speed.",
    "longDescription": "A beautiful, mystic dance which boosts the user's Sp. Atk, Sp. Def and Speed.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 248,
    "effectChance": 0,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 484,
    "moveConst": "MOVE_HEAVY_SLAM",
    "name": "Heavy Slam",
    "shortName": "Heavy Slam",
    "description": "Does more damage if the user outweighs the foe.",
    "longDescription": "The user slams the foe with its heavy body. Heavier users are stronger.",
    "types": [
      7
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 77,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 485,
    "moveConst": "MOVE_SYNCHRONOISE",
    "name": "Synchronoise",
    "shortName": "Synchronoise",
    "description": "An odd shock wave that Matches user's second type.",
    "longDescription": "An odd shockwave. Matches the user's second type. Sound-based.",
    "types": [
      13
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 249,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 486,
    "moveConst": "MOVE_ELECTRO_BALL",
    "name": "Electro Ball",
    "shortName": "Electro Ball",
    "description": "Hurls an orb that does more damage to slower foes.",
    "longDescription": "An electric orb is hurled at the foe. Faster users deal greater damage.",
    "types": [
      4
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 250,
    "effectChance": 0,
    "flags": [
      12,
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 487,
    "moveConst": "MOVE_SOAK",
    "name": "Soak",
    "shortName": "Soak",
    "description": "Sprays water at the foe making it Water-type.",
    "longDescription": "The foe is struck by a torrent of water which changes its type to Water.",
    "types": [
      12
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 251,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 488,
    "moveConst": "MOVE_FLAME_CHARGE",
    "name": "Flame Charge",
    "shortName": "Flame Charge",
    "description": "Attacks in a cloak of flames. Raises Speed.",
    "longDescription": "Cloaked in flames, the user strikes. This raises its Speed stat.",
    "types": [
      2
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 252,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 489,
    "moveConst": "MOVE_COIL",
    "name": "Coil",
    "shortName": "Coil",
    "description": "Coils up to raise Attack Defense and Accuracy.",
    "longDescription": "The user coils up, raising its Attack, Defense and its accuracy.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 253,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 490,
    "moveConst": "MOVE_LOW_SWEEP",
    "name": "Low Sweep",
    "shortName": "Low Sweep",
    "description": "Attacks the foe's legs lowering its Speed.",
    "longDescription": "The user strikes swiftly at the foe's legs, lowering the foe's Speed stat.",
    "types": [
      1
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 491,
    "moveConst": "MOVE_ACID_SPRAY",
    "name": "Acid Spray",
    "shortName": "Acid Spray",
    "description": "Sprays a hide-melting acid. Sharply reduces Sp. Def.",
    "longDescription": "An acidic fluid is spat at the foe. This harshly lowers the foe's Sp. Def.",
    "types": [
      10
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 238,
    "effectChance": 100,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 492,
    "moveConst": "MOVE_FOUL_PLAY",
    "name": "Foul Play",
    "shortName": "Foul Play",
    "description": "The higher the foe's Attack the more damage caused.",
    "longDescription": "The higher the foe's Attack stat, the greater the damage this deals.",
    "types": [
      11
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 254,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 493,
    "moveConst": "MOVE_SIMPLE_BEAM",
    "name": "Simple Beam",
    "shortName": "Simple Beam",
    "description": "A beam that changes the foe's ability to Simple.",
    "longDescription": "The user's odd psychic wave changes the foe's Ability to Simple.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 255,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 494,
    "moveConst": "MOVE_ENTRAINMENT",
    "name": "Entrainment",
    "shortName": "Entrainment",
    "description": "Makes the foe mimic the user, gaining its ability.",
    "longDescription": "An odd dance that compels the target to mimic the Ability of the user.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 256,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 495,
    "moveConst": "MOVE_AFTER_YOU",
    "name": "After You",
    "shortName": "After You",
    "description": "Helps out the foe, letting it move next.",
    "longDescription": "The user helps the target and forces it to move right after the user.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 257,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 496,
    "moveConst": "MOVE_ROUND",
    "name": "Round",
    "shortName": "Round",
    "description": "A song that inflicts damage. Others can join in too.",
    "longDescription": "A loud song attack. Deals 2x damage if ally also uses Round. 20% flinch chance.",
    "types": [
      0
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 258,
    "effectChance": 20,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 497,
    "moveConst": "MOVE_ECHOED_VOICE",
    "name": "Echoed Voice",
    "shortName": "Echoed Voice",
    "description": "Slices the foe 3 times in a with rising intensity.",
    "longDescription": "A 3-hit attack. More powerful with each successive hit. Sound-based.",
    "types": [
      0
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 87,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 498,
    "moveConst": "MOVE_CHIP_AWAY",
    "name": "Chip Away",
    "shortName": "Chip Away",
    "description": "Chips away at the foe's attack and defense.",
    "longDescription": "40% chance to lower Attack and/or Defense. Ignores stat changes.",
    "types": [
      0
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 40,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 499,
    "moveConst": "MOVE_CLEAR_SMOG",
    "name": "Clear Smog",
    "shortName": "Clear Smog",
    "description": "Attacks with white haze that eliminates all stat changes.",
    "longDescription": "A clump of special mud is hurled at the foe, resetting their stat changes.",
    "types": [
      10
    ],
    "power": 50,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 35,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 500,
    "moveConst": "MOVE_STORED_POWER",
    "name": "Stored Power",
    "shortName": "Stored Power",
    "description": "The higher the user's stats the more damage caused.",
    "longDescription": "The more the user's stats are raised, the greater this move's power.",
    "types": [
      13
    ],
    "power": 20,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 259,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 501,
    "moveConst": "MOVE_QUICK_GUARD",
    "name": "Quick Guard",
    "shortName": "Quick Guard",
    "description": "Protects against priority attacks for 3 turns.",
    "longDescription": "Protects the user and its allies from priority for 3 turns.",
    "types": [
      1
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 1,
    "split": 2,
    "target": 2,
    "effect": 260,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 502,
    "moveConst": "MOVE_ALLY_SWITCH",
    "name": "Ally Switch",
    "shortName": "Ally Switch",
    "description": "The user switches places with its partner.",
    "longDescription": "The user teleports using a strange power and swaps with its ally.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 2,
    "split": 2,
    "target": 8,
    "effect": 261,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 503,
    "moveConst": "MOVE_SCALD",
    "name": "Scald",
    "shortName": "Scald",
    "description": "Shoots boiling water at the foe. May inflict a burn.",
    "longDescription": "Boiling hot water is shot at the foe. 30% burn chance.",
    "types": [
      12
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 504,
    "moveConst": "MOVE_SHELL_SMASH",
    "name": "Shell Smash",
    "shortName": "Shell Smash",
    "description": "Raises offensive stats, but lowers defensive stats.",
    "longDescription": "A broken shell ups Atk, Sp.Atk and Spe, while reducing Def and Sp.Def.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 262,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 505,
    "moveConst": "MOVE_HEAL_PULSE",
    "name": "Heal Pulse",
    "shortName": "Heal Pulse",
    "description": "Recovers up to half the target's maximum HP.",
    "longDescription": "A pulse is loosed, healing the target by up to half of their maximum HP.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 263,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 506,
    "moveConst": "MOVE_HEX",
    "name": "Hex",
    "shortName": "Hex",
    "description": "Does double damage if the foe has a status problem.",
    "longDescription": "Double damage to foes affected by status problems.",
    "types": [
      16
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 264,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 507,
    "moveConst": "MOVE_SKY_DROP",
    "name": "Sky Drop",
    "shortName": "Sky Drop",
    "description": "Takes the foe into the sky then drops it the next turn.",
    "longDescription": "Immobilizes and then slams the foe. Deals damage and triggers hazards. Throw based.",
    "types": [
      6
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 33,
    "effectChance": 0,
    "flags": [
      0,
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 508,
    "moveConst": "MOVE_SHIFT_GEAR",
    "name": "Shift Gear",
    "shortName": "Shift Gear",
    "description": "Rotates its gears to raise Attack and Speed.",
    "longDescription": "The user rotates its gears, raising its Attack and sharply raising its Speed.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 265,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 509,
    "moveConst": "MOVE_CIRCLE_THROW",
    "name": "Circle Throw",
    "shortName": "Circle Throw",
    "description": "Knocks the foe away to end the battle.",
    "longDescription": "The foe is thrown, dragging out another Pokémon into battle. Wild Pokémon flee.",
    "types": [
      1
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": -6,
    "split": 0,
    "target": 0,
    "effect": 9,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 510,
    "moveConst": "MOVE_INCINERATE",
    "name": "Incinerate",
    "shortName": "Incinerate",
    "description": "Burns up Berries and Gems preventing their use.",
    "longDescription": "A fiery attack that burns up any Berry or Gem the foe may be holding.",
    "types": [
      2
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 266,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 511,
    "moveConst": "MOVE_QUASH",
    "name": "Quash",
    "shortName": "Quash",
    "description": "Suppresses distortions that let battlers move first.",
    "longDescription": "Suppresses most effects that would affect turn order.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 267,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 512,
    "moveConst": "MOVE_ACROBATICS",
    "name": "Acrobatics",
    "shortName": "Acrobatics",
    "description": "Does 1.5x damage if the user has no item.",
    "longDescription": "The user nimbly strikes the foe. 50% more damage without an item.",
    "types": [
      6
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 268,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 513,
    "moveConst": "MOVE_REFLECT_TYPE",
    "name": "Reflect Type",
    "shortName": "Reflect Type",
    "description": "The user makes the foe reflect the user's type.",
    "longDescription": "The user projects its type onto the foe, making it the same type.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 1,
    "split": 2,
    "target": 0,
    "effect": 269,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 514,
    "moveConst": "MOVE_RETALIATE",
    "name": "Retaliate",
    "shortName": "Retaliate",
    "description": "An attack that does more damage if an ally fainted.",
    "longDescription": "This vengeful move deals double damage if an ally fainted in the turn before.",
    "types": [
      0
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 270,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 515,
    "moveConst": "MOVE_FINAL_GAMBIT",
    "name": "Final Gambit",
    "shortName": "Final Gambit",
    "description": "The user faints to damage the foe equal to its HP.",
    "longDescription": "This attack causes the user to faint, but does damage equal to its HP.",
    "types": [
      1
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 271,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 516,
    "moveConst": "MOVE_BESTOW",
    "name": "Bestow",
    "shortName": "Bestow",
    "description": "The user gives its item and status to the foe.",
    "longDescription": "The user gives its item and status to the foe.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 272,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 517,
    "moveConst": "MOVE_INFERNO",
    "name": "Inferno",
    "shortName": "Inferno",
    "description": "Powerful and sure to inflict a burn, but inaccurate.",
    "longDescription": "The foe is engulfed in an intense fire. Burns the foe. Mega Launcher boost",
    "types": [
      2
    ],
    "power": 120,
    "accuracy": 50,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 518,
    "moveConst": "MOVE_WATER_PLEDGE",
    "name": "Water Pledge",
    "shortName": "Water Pledge",
    "description": "Attacks with a column of water. May make a rainbow.",
    "longDescription": "Creates a rainbow in sun or a swamp with grass. Uses highest attack.",
    "types": [
      12
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 519,
    "moveConst": "MOVE_FIRE_PLEDGE",
    "name": "Fire Pledge",
    "shortName": "Fire Pledge",
    "description": "Attacks with a column of fire. May burn the grass.",
    "longDescription": "Creates a rainbow in rain or a firestorm with grass. Uses highest attack.",
    "types": [
      2
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 520,
    "moveConst": "MOVE_GRASS_PLEDGE",
    "name": "Grass Pledge",
    "shortName": "Grass Pledge",
    "description": "Attacks with a column of grass. May create a swamp.",
    "longDescription": "Creates a swamp in rain and a firestorm in sun. Uses highest attack.",
    "types": [
      8
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 521,
    "moveConst": "MOVE_VOLT_SWITCH",
    "name": "Volt Switch",
    "shortName": "Volt Switch",
    "description": "Does damage then switches out the user.",
    "longDescription": "The user strikes, and then switches with a waiting party Pokémon.",
    "types": [
      4
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 204,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 522,
    "moveConst": "MOVE_STRUGGLE_BUG",
    "name": "Struggle Bug",
    "shortName": "Struggle Bug",
    "description": "Inflicts critical damage when the user's HP is low.",
    "longDescription": "A desperate attack that deals critical damage when the user is below 50% HP.",
    "types": [
      5
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 95,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 523,
    "moveConst": "MOVE_BULLDOZE",
    "name": "Bulldoze",
    "shortName": "Bulldoze",
    "description": "Stomps down on the ground. Lowers Speed.",
    "longDescription": "A mighty stomp which hits all foes, and lowers their Speed stat.",
    "types": [
      9
    ],
    "power": 55,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 274,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 524,
    "moveConst": "MOVE_FROST_BREATH",
    "name": "Frost Breath",
    "shortName": "Frost Breath",
    "description": "This attack always results in a critical hit.",
    "longDescription": "A fierce blow upon the foe which will always result in a critical hit.",
    "types": [
      3
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 4,
    "effectChance": 30,
    "flags": [
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 525,
    "moveConst": "MOVE_DRAGON_TAIL",
    "name": "Dragon Tail",
    "shortName": "Dragon Tail",
    "description": "Knocks the foe away to end the battle.",
    "longDescription": "The foe is thrown, dragging out another Pokémon into battle. Wild Pokémon flee.",
    "types": [
      15
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": -6,
    "split": 0,
    "target": 0,
    "effect": 9,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 526,
    "moveConst": "MOVE_WORK_UP",
    "name": "Work Up",
    "shortName": "Work Up",
    "description": "The user is roused. Ups Attack and SpAtk",
    "longDescription": "The user is roused, and its Attack and Sp. Atk stats increase.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 275,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 527,
    "moveConst": "MOVE_ELECTROWEB",
    "name": "Electroweb",
    "shortName": "Electroweb",
    "description": "Snares the foe with an electric net. Lowers Speed.",
    "longDescription": "The foe is caught in an electric net. This lowers their Speed stat.",
    "types": [
      4
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 17,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 528,
    "moveConst": "MOVE_WILD_CHARGE",
    "name": "Wild Charge",
    "shortName": "Wild Charge",
    "description": "An electrical tackle with 10% paralyze chance.",
    "longDescription": "An electric, reckless crash attack with 10% paralyze chance.",
    "types": [
      4
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 529,
    "moveConst": "MOVE_DRILL_RUN",
    "name": "Drill Run",
    "shortName": "Drill Run",
    "description": "Spins its body like a drill. High critical-hit ratio.",
    "longDescription": "Rotates its body like a drill. High crit ratio. Mighty Horn boost.",
    "types": [
      9
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1,
      9,
      10
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 530,
    "moveConst": "MOVE_DUAL_CHOP",
    "name": "Dual Chop",
    "shortName": "Dual Chop",
    "description": "Attacks with brutal hits that strike twice.",
    "longDescription": "Brutal strikes hit twice. High crit ratio. Keen Edge boost.",
    "types": [
      15
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 531,
    "moveConst": "MOVE_HEART_STAMP",
    "name": "Heart Stamp",
    "shortName": "Heart Stamp",
    "description": "A sudden blow after a cute act. May cause flinching.",
    "longDescription": "The foe's guard drops, and the user strikes. 30% flinch chance.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 532,
    "moveConst": "MOVE_HORN_LEECH",
    "name": "Horn Leech",
    "shortName": "Horn Leech",
    "description": "An attack that absorbs half the damage inflicted.",
    "longDescription": "Absorbs half the damage. Ignores foe's stat changes. Mighty Horn boost.",
    "types": [
      8
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 533,
    "moveConst": "MOVE_SACRED_SWORD",
    "name": "Sacred Sword",
    "shortName": "Sacred Sword",
    "description": "Strikes through the foe's stat changes.",
    "longDescription": "The user cuts its foe. Ignores foe's stat changes. Keen Edge boost.",
    "types": [
      1
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 534,
    "moveConst": "MOVE_RAZOR_SHELL",
    "name": "Razor Shell",
    "shortName": "Razor Shell",
    "description": "Tears at the foe with sharp shells. May lower Defense.",
    "longDescription": "High crit ratio. 50% chance to lower foe's Def. Keen Edge boost.",
    "types": [
      12
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 50,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 535,
    "moveConst": "MOVE_HEAT_CRASH",
    "name": "Heat Crash",
    "shortName": "Heat Crash",
    "description": "Does more damage if the user outweighs the foe.",
    "longDescription": "The user slams the foe with its heavy body. Heavier users are stronger.",
    "types": [
      2
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 77,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 536,
    "moveConst": "MOVE_LEAF_TORNADO",
    "name": "Leaf Tornado",
    "shortName": "Leaf Tornado",
    "description": "Traps and hurts the foe in a tornado for 2 to 5 turns.",
    "longDescription": "The foe is trapped with sharp leaves for four or five turns.",
    "types": [
      8
    ],
    "power": 50,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 537,
    "moveConst": "MOVE_STEAMROLLER",
    "name": "Steamroller",
    "shortName": "Steamroller",
    "description": "A speedy attack that crushes the foe with the user's body.",
    "longDescription": "Attacks as if Speed was 50% higher for determining turn order.",
    "types": [
      5
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 538,
    "moveConst": "MOVE_COTTON_GUARD",
    "name": "Cotton Guard",
    "shortName": "Cotton Guard",
    "description": "Wraps its body in cotton. Drastically raises Defense.",
    "longDescription": "The user protects itself with soft cotton, drastically raising its Defense.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 276,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 539,
    "moveConst": "MOVE_NIGHT_DAZE",
    "name": "Night Daze",
    "shortName": "Night Daze",
    "description": "Looses a pitch-black shock wave. Has +1 priority.",
    "longDescription": "Strucks with a pitch-black shock wave. Has +1 priority.",
    "types": [
      11
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 540,
    "moveConst": "MOVE_PSYSTRIKE",
    "name": "Psystrike",
    "shortName": "Psystrike",
    "description": "Attacks with a psychic wave that does physical damage.",
    "longDescription": "The user casts an odd psychic wave to attack the foe for physical damage.",
    "types": [
      13
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 4,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 541,
    "moveConst": "MOVE_TAIL_SLAP",
    "name": "Tail Slap",
    "shortName": "Tail Slap",
    "description": "Strikes the foe with its tail 2 to 5 times.",
    "longDescription": "The user attacks by striking the foe with its hard tail, two to five times.",
    "types": [
      0
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 542,
    "moveConst": "MOVE_HURRICANE",
    "name": "Hurricane",
    "shortName": "Hurricane",
    "description": "Traps the foe in a fierce wind. May cause confusion.",
    "longDescription": "30% chance to confuse the foe. Weather-and Air-based.",
    "types": [
      6
    ],
    "power": 110,
    "accuracy": 80,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 277,
    "effectChance": 30,
    "flags": [
      13,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 543,
    "moveConst": "MOVE_HEAD_CHARGE",
    "name": "Head Charge",
    "shortName": "Head Charge",
    "description": "A charge using guard hair. It hurts the user a little.",
    "longDescription": "Powerful guard hair headbutts the foe in an attack. 25% recoil damage.",
    "types": [
      0
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 278,
    "effectChance": 0,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 544,
    "moveConst": "MOVE_GEAR_GRIND",
    "name": "Gear Grind",
    "shortName": "Gear Grind",
    "description": "Throws two steel gears that strike twice.",
    "longDescription": "The user attacks by throwing steel gears at its target twice.",
    "types": [
      7
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 545,
    "moveConst": "MOVE_SEARING_SHOT",
    "name": "Searing Shot",
    "shortName": "Searing Shot",
    "description": "Scarlet flames torch everything around the user.",
    "longDescription": "Scarlet flames torch the field. 30% burn chance. Mega Launcher boost",
    "types": [
      2
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 3,
    "effectChance": 30,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 546,
    "moveConst": "MOVE_TECHNO_BLAST",
    "name": "Techno Blast",
    "shortName": "Techno Blast",
    "description": "The type varies based on the user.",
    "longDescription": "A beam of light. Changes type based on Hidden Power type.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 131,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": true,
    "archetype": "vanilla"
  },
  {
    "id": 547,
    "moveConst": "MOVE_RELIC_SONG",
    "name": "Relic Song",
    "shortName": "Relic Song",
    "description": "Attacks with an ancient song. May induce sleep.",
    "longDescription": "An ancient song that may induce sleep. Uses highest Attack stat.",
    "types": [
      0
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 1,
    "effect": 279,
    "effectChance": 10,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 548,
    "moveConst": "MOVE_SECRET_SWORD",
    "name": "Secret Sword",
    "shortName": "Secret Sword",
    "description": "Cuts with a long horn that does physical damage.",
    "longDescription": "The user cuts its foe, oddly dealing physical damage. Keen Edge boost.",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 4,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 549,
    "moveConst": "MOVE_GLACIATE",
    "name": "Glaciate",
    "shortName": "Glaciate",
    "description": "Blows very cold air at the foe. It lowers their Speed.",
    "longDescription": "The user blows freezing cold air at its foes that lowers their Speed.",
    "types": [
      3
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 17,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 550,
    "moveConst": "MOVE_BOLT_STRIKE",
    "name": "Bolt Strike",
    "shortName": "Bolt Strike",
    "description": "Strikes with a great amount of lightning. May paralyze.",
    "longDescription": "The user strikes its foe with electricity. 30% paralyze chance.",
    "types": [
      4
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 551,
    "moveConst": "MOVE_BLUE_FLARE",
    "name": "Blue Flare",
    "shortName": "Blue Flare",
    "description": "Engulfs the foe in a blue flame. May inflict a burn.",
    "longDescription": "The foe is engulfed in a beautiful flame. 20% burn chance.",
    "types": [
      2
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 552,
    "moveConst": "MOVE_FIERY_DANCE",
    "name": "Fiery Dance",
    "shortName": "Fiery Dance",
    "description": "Dances cloaked in flames. May raise SpAtk",
    "longDescription": "The user flaps its flame-cloaked wings. 50% chance to raise its SpAtk.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 236,
    "effectChance": 50,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 553,
    "moveConst": "MOVE_FREEZE_SHOCK",
    "name": "Freeze Shock",
    "shortName": "Freeze Shock",
    "description": "A powerful 2-turn move that may paralyze the foe.",
    "longDescription": "Paralyzes attackers that make contact while charging. 30% paralyze chance.",
    "types": [
      3
    ],
    "power": 140,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 280,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 554,
    "moveConst": "MOVE_ICE_BURN",
    "name": "Ice Burn",
    "shortName": "Ice Burn",
    "description": "A powerful 2-turn move that may inflict a burn.",
    "longDescription": "Burns attackers that make contact while charging. 30% burn chance.",
    "types": [
      3
    ],
    "power": 140,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 280,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 555,
    "moveConst": "MOVE_SNARL",
    "name": "Snarl",
    "shortName": "Snarl",
    "description": "Yells and rants at the foe lowering its SpAtk",
    "longDescription": "The user yells as if it is ranting, lowering the Sp. Atk of its foe.",
    "types": [
      11
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 29,
    "effectChance": 100,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 556,
    "moveConst": "MOVE_ICICLE_CRASH",
    "name": "Icicle Crash",
    "shortName": "Icicle Crash",
    "description": "Drops large icicles on the foe. May cause flinching.",
    "longDescription": "Sharp icicles fall onto the foe, with a 20% flinch chance.",
    "types": [
      3
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 557,
    "moveConst": "MOVE_V_CREATE",
    "name": "V-create",
    "shortName": "V-create",
    "description": "Very powerful, but lowers Defense, Sp. Def and Speed.",
    "longDescription": "A powerful strike that lowers the user's Defense, Sp. Def and Speed.",
    "types": [
      2
    ],
    "power": 180,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 281,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 558,
    "moveConst": "MOVE_FUSION_FLARE",
    "name": "Fusion Flare",
    "shortName": "Fusion Flare",
    "description": "Summons a fireball. Works well with a thunderbolt.",
    "longDescription": "A giant flame that deals more damage when joined with a big thunderbolt.",
    "types": [
      2
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 282,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 559,
    "moveConst": "MOVE_FUSION_BOLT",
    "name": "Fusion Bolt",
    "shortName": "Fusion Bolt",
    "description": "Summons a thunderbolt. Works well with a fireball.",
    "longDescription": "A giant thunderbolt that deals more damage when joined with a big flame.",
    "types": [
      4
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 282,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 560,
    "moveConst": "MOVE_FLYING_PRESS",
    "name": "Flying Press",
    "shortName": "Flying Press",
    "description": "This attack does Fighting and Flying-type damage.",
    "longDescription": "A wrestling attack that is Fighting or Flying based on effectiveness.",
    "types": [
      1,
      6
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 561,
    "moveConst": "MOVE_MAT_BLOCK",
    "name": "Mat Block",
    "shortName": "Mat Block",
    "description": "Evades damaging moves for one turn.",
    "longDescription": "A pulled-up mat is used to protect the user and its ally from damaging moves.",
    "types": [
      1
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 1,
    "split": 2,
    "target": 2,
    "effect": 283,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 562,
    "moveConst": "MOVE_BELCH",
    "name": "Belch",
    "shortName": "Belch",
    "description": "Lets out a loud belch. Must eat a Berry to use it.",
    "longDescription": "The user eats its held Berry and lets out a damaging belch at the foe.",
    "types": [
      10
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 284,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 563,
    "moveConst": "MOVE_ROTOTILLER",
    "name": "Rototiller",
    "shortName": "Rototiller",
    "description": "Ups the Attack and Sp. Atk of Grass-type Pokémon.",
    "longDescription": "Boosts the Atk and SpAtk of Grass-types by 1 stage or 2 stages in Grassy Terrain.",
    "types": [
      9
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 285,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 564,
    "moveConst": "MOVE_STICKY_WEB",
    "name": "Sticky Web",
    "shortName": "Sticky Web",
    "description": "Weaves a sticky net that slows foes switching in.",
    "longDescription": "A sticky net woven around the foe that drops the Speed of foes that switch in.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 7,
    "effect": 286,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 565,
    "moveConst": "MOVE_FELL_STINGER",
    "name": "Fell Stinger",
    "shortName": "Fell Stinger",
    "description": "If it knocks out a foe the Attack stat is raised.",
    "longDescription": "If this attack knocks out a foe, the user's Attack rises by +3.",
    "types": [
      5
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 287,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 566,
    "moveConst": "MOVE_PHANTOM_FORCE",
    "name": "Phantom Force",
    "shortName": "PhantomForce",
    "description": "Vanishes on the first turn then strikes the next turn.",
    "longDescription": "The user vanishes. The next turn, it strikes the foe, ignoring Protect.",
    "types": [
      16
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 567,
    "moveConst": "MOVE_TRICK_OR_TREAT",
    "name": "Trick-Or-Treat",
    "shortName": "TrickOrTreat",
    "description": "Goes trick-or-treating making the foe Ghost-type.",
    "longDescription": "The user adds the Ghost-type to its foe and makes it weakened by fog.",
    "types": [
      16
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 288,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 568,
    "moveConst": "MOVE_NOBLE_ROAR",
    "name": "Noble Roar",
    "shortName": "Noble Roar",
    "description": "Intimidates foes, cutting their Attack and SpAtk",
    "longDescription": "A noble roar that intimidates foes and lowers their Attack and SpAtk",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 289,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 569,
    "moveConst": "MOVE_ION_DELUGE",
    "name": "Ion Deluge",
    "shortName": "Ion Deluge",
    "description": "Electrifies Normal-type moves with charged atoms.",
    "longDescription": "The user disperses charged particles which electrify Normal-type moves.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 1,
    "split": 2,
    "target": 6,
    "effect": 290,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 570,
    "moveConst": "MOVE_PARABOLIC_CHARGE",
    "name": "Parabolic Charge",
    "shortName": "ParabolcChrg",
    "description": "Damages adjacent Pokémon and heals up by 1/4 of it.",
    "longDescription": "The user attacks all around it, and restores HP by 25% of damage dealt.",
    "types": [
      4
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 36,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 571,
    "moveConst": "MOVE_FORESTS_CURSE",
    "name": "Forest's Curse",
    "shortName": "Forest'sCurs",
    "description": "Puts a curse on the foe making the foe Grass-type.",
    "longDescription": "The user puts a forest curse on the foe. The foe is now Grass-type as well.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 288,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 572,
    "moveConst": "MOVE_PETAL_BLIZZARD",
    "name": "Petal Blizzard",
    "shortName": "PetalBlizzrd",
    "description": "Stirs up a violent storm of petals to attack.",
    "longDescription": "A violent petal blizzard stirs up, hitting everything around it.",
    "types": [
      8
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 573,
    "moveConst": "MOVE_FREEZE_DRY",
    "name": "Freeze-Dry",
    "shortName": "Freeze-Dry",
    "description": "Super effective on Water-types. May cause freezing.",
    "longDescription": "This move is super effective on Water. 10% frostbite chance.",
    "types": [
      3
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 185,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 574,
    "moveConst": "MOVE_DISARMING_VOICE",
    "name": "Disarming Voice",
    "shortName": "DisrmngVoice",
    "description": "Lets out a charming cry that cannot be evaded.",
    "longDescription": "The user cries out with a disarmingly cute voice. This never misses.",
    "types": [
      17
    ],
    "power": 60,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 575,
    "moveConst": "MOVE_PARTING_SHOT",
    "name": "Parting Shot",
    "shortName": "Parting Shot",
    "description": "Lowers the foe's Attack and Sp. Atk, then switches out.",
    "longDescription": "The foe's Attack and Sp. Atk stats are lowered by a parting threat.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 291,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 576,
    "moveConst": "MOVE_TOPSY_TURVY",
    "name": "Topsy-Turvy",
    "shortName": "Topsy-Turvy",
    "description": "Swaps all stat changes that affect the target.",
    "longDescription": "All stat changes affecting the foe turn topsy-turvy and are inverted.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 292,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 577,
    "moveConst": "MOVE_DRAINING_KISS",
    "name": "Draining Kiss",
    "shortName": "DrainingKiss",
    "description": "An attack that absorbs over 50% of damage inflicted.",
    "longDescription": "A kiss that absorbs 50% of damage it inflicted to restore HP.",
    "types": [
      17
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 578,
    "moveConst": "MOVE_CRAFTY_SHIELD",
    "name": "Crafty Shield",
    "shortName": "CraftyShield",
    "description": "Evades status moves for one turn.",
    "longDescription": "A mysterious power protects the user and its allies from status moves.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 3,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 579,
    "moveConst": "MOVE_FLOWER_SHIELD",
    "name": "Flower Shield",
    "shortName": "FlowerShield",
    "description": "Raises the Defense of Grass-type Pokémon.",
    "longDescription": "A mysterious power raises the Defense of all Grass-type Pokémon in battle.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 293,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 580,
    "moveConst": "MOVE_GRASSY_TERRAIN",
    "name": "Grassy Terrain",
    "shortName": "GrssyTerrain",
    "description": "The ground turns to grass for 8 turns. Restores HP.",
    "longDescription": "For 8 turns, the ground turns grassy. This ups Grass-type moves, and heals.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 294,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 581,
    "moveConst": "MOVE_MISTY_TERRAIN",
    "name": "Misty Terrain",
    "shortName": "MistyTerrain",
    "description": "Covers the ground with mist for 8 turns. Blocks status.",
    "longDescription": "Boosts Fairy-type moves for 8 turns, and prevents status conditions for all.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 295,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 582,
    "moveConst": "MOVE_ELECTRIFY",
    "name": "Electrify",
    "shortName": "Electrify",
    "description": "Electrifies the foe, making its next move Electric-type.",
    "longDescription": "Makes the foe's next move Electric-type. May fail if used in succession.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 3,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 296,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 583,
    "moveConst": "MOVE_PLAY_ROUGH",
    "name": "Play Rough",
    "shortName": "Play Rough",
    "description": "Plays rough with the foe. May lower Attack.",
    "longDescription": "The user and foe play rough, with a 10% chance to drop foe's Attack.",
    "types": [
      17
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 22,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 584,
    "moveConst": "MOVE_FAIRY_WIND",
    "name": "Fairy Wind",
    "shortName": "Fairy Wind",
    "description": "Quick cloud of pixie dust. Has +1 priority.",
    "longDescription": "A quick moving cloud of pixie dust. Has +1 Priority. Air-based.",
    "types": [
      17
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 585,
    "moveConst": "MOVE_MOONBLAST",
    "name": "Moonblast",
    "shortName": "Moonblast",
    "description": "Attacks with the power of the moon. May lower SpAtk",
    "longDescription": "The power of the moon strikes the foe. 20% chance to lower foe's SpAtk.",
    "types": [
      17
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 29,
    "effectChance": 20,
    "flags": [
      16
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 586,
    "moveConst": "MOVE_BOOMBURST",
    "name": "Boomburst",
    "shortName": "Boomburst",
    "description": "Attack everything then take recoil.",
    "longDescription": "Attacks everything around the user. Takes 50% recoil after.",
    "types": [
      0
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 237,
    "effectChance": 0,
    "flags": [
      8,
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 587,
    "moveConst": "MOVE_FAIRY_LOCK",
    "name": "Fairy Lock",
    "shortName": "Fairy Lock",
    "description": "Locks down the battlefield preventing escape next turn.",
    "longDescription": "For 1 turn, the user locks down the battlefield and prevents fleeing.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 297,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 588,
    "moveConst": "MOVE_KINGS_SHIELD",
    "name": "King's Shield",
    "shortName": "King'sShield",
    "description": "Evades damage, and reduces Attack if struck.",
    "longDescription": "A protective stance is assumed. Contact by the foe lowers its Attack.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 589,
    "moveConst": "MOVE_PLAY_NICE",
    "name": "Play Nice",
    "shortName": "Play Nice",
    "description": "Befriend the foe, lowering its Attack without fail.",
    "longDescription": "Lowers all foes' Attack by 1 stage. Always hits.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 298,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 590,
    "moveConst": "MOVE_CONFIDE",
    "name": "Confide",
    "shortName": "Confide",
    "description": "Shares a secret with the foe, lowering SpAtk",
    "longDescription": "The foe's Sp. Atk drops after being told a secret by the user.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 299,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 591,
    "moveConst": "MOVE_DIAMOND_STORM",
    "name": "Diamond Storm",
    "shortName": "DiamondStorm",
    "description": "Whips up a storm of diamonds. May up Defense.",
    "longDescription": "A storm of diamonds pelts the foes. 50% chance to up user's Defense.",
    "types": [
      14
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 300,
    "effectChance": 50,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 592,
    "moveConst": "MOVE_STEAM_ERUPTION",
    "name": "Steam Eruption",
    "shortName": "SteamErption",
    "description": "Immerses the foe in heated steam. May inflict a burn.",
    "longDescription": "30% burn chance. Deals normal damage in Harsh Sunlight. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 593,
    "moveConst": "MOVE_HYPERSPACE_HOLE",
    "name": "Hyperspace Hole",
    "shortName": "HyprspceHole",
    "description": "Uses a warp hole to attack. Can't be evaded.",
    "longDescription": "Using a wormhole, the user strikes. Has +1 priority. Ignores Protect etc.",
    "types": [
      16
    ],
    "power": 100,
    "accuracy": 0,
    "pp": 5,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 199,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 594,
    "moveConst": "MOVE_WATER_SHURIKEN",
    "name": "Water Shuriken",
    "shortName": "WatrShuriken",
    "description": "Throws 2 to 5 stars that are sure to strike first.",
    "longDescription": "The user hits the foe with 2 to 5 throwing stars. +1 priority.",
    "types": [
      12
    ],
    "power": 18,
    "accuracy": 100,
    "pp": 20,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 595,
    "moveConst": "MOVE_MYSTICAL_FIRE",
    "name": "Mystical Fire",
    "shortName": "MysticalFire",
    "description": "Breathes a special, hot fire. May lower SpAtk",
    "longDescription": "The user breathes a special, hot fire. This lowers the foe's Sp. Atk stat.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 29,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 596,
    "moveConst": "MOVE_SPIKY_SHIELD",
    "name": "Spiky Shield",
    "shortName": "Spiky Shield",
    "description": "Evades attack, and causes bleeding if struck.",
    "longDescription": "This prickly shield protects the user and causes bleeding on contact.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 597,
    "moveConst": "MOVE_AROMATIC_MIST",
    "name": "Aromatic Mist",
    "shortName": "AromaticMist",
    "description": "Raises the Special Defense of the user and its partner.",
    "longDescription": "Sharply raises the Special Defense of the user and its partner.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 301,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 598,
    "moveConst": "MOVE_EERIE_IMPULSE",
    "name": "Eerie Impulse",
    "shortName": "EerieImpulse",
    "description": "Exposes the foe to a pulse that sharply cuts SpAtk",
    "longDescription": "The foe's Sp. Atk is harshly lowered by exposure to an eerie impulse.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 302,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 599,
    "moveConst": "MOVE_VENOM_DRENCH",
    "name": "Venom Drench",
    "shortName": "Venom Drench",
    "description": "Lowers the Attack, Sp. Atk and Speed of a poisoned foe.",
    "longDescription": "Poisoned foes suffer lowered Attack, Sp. Atk and Speed stats.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 1,
    "effect": 303,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 600,
    "moveConst": "MOVE_POWDER",
    "name": "Powder",
    "shortName": "Powder",
    "description": "Damages the foe if it uses a Fire-type move.",
    "longDescription": "If the foe uses a Fire-type move, it will be damaged by this powder.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 1,
    "split": 2,
    "target": 0,
    "effect": 304,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 601,
    "moveConst": "MOVE_GEOMANCY",
    "name": "Geomancy",
    "shortName": "Geomancy",
    "description": "Raises Sp. Atk, Sp. Def and Speed on the 2nd turn.",
    "longDescription": "On the 2nd turn, the user sharply ups its Sp. Atk, Sp. Def and Speed stats.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 305,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 602,
    "moveConst": "MOVE_MAGNETIC_FLUX",
    "name": "Magnetic Flux",
    "shortName": "MagneticFlux",
    "description": "Boosts the defenses of those with Plus or Minus.",
    "longDescription": "The user boosts the defenses of allies with the Plus or Minus Ability.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 306,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 603,
    "moveConst": "MOVE_HAPPY_HOUR",
    "name": "Happy Hour",
    "shortName": "Happy Hour",
    "description": "Doubles the amount of Prize Money received.",
    "longDescription": "This move doubles the amount of prize money received after battle.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 307,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 604,
    "moveConst": "MOVE_ELECTRIC_TERRAIN",
    "name": "Electric Terrain",
    "shortName": "ElctrcTrrain",
    "description": "Electrifies the ground for 8 turns. Prevents sleep.",
    "longDescription": "For 8 turns, the charged ground ups Electric-type moves and prevents sleep.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 308,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 605,
    "moveConst": "MOVE_DAZZLING_GLEAM",
    "name": "Dazzling Gleam",
    "shortName": "DazzlngGleam",
    "description": "Damages foes by emitting a bright flash.",
    "longDescription": "The user emits a powerful flash, hitting all foes.",
    "types": [
      17
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 606,
    "moveConst": "MOVE_CELEBRATE",
    "name": "Celebrate",
    "shortName": "Celebrate",
    "description": "Congratulates you on your special day.",
    "longDescription": "The Pokémon congratulates you on your special day!",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 307,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 607,
    "moveConst": "MOVE_HOLD_HANDS",
    "name": "Hold Hands",
    "shortName": "Hold Hands",
    "description": "The user and ally hold hands making them happy.",
    "longDescription": "The user and ally hold hands. This makes them very happy.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 8,
    "effect": 307,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 608,
    "moveConst": "MOVE_BABY_DOLL_EYES",
    "name": "Baby-Doll Eyes",
    "shortName": "BabyDollEyes",
    "description": "Lowers the foe's Attack before it can move.",
    "longDescription": "Before it can move, the foe's Attack stat is lowered by an adorable stare.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 1,
    "split": 2,
    "target": 0,
    "effect": 298,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 609,
    "moveConst": "MOVE_NUZZLE",
    "name": "Nuzzle",
    "shortName": "Nuzzle",
    "description": "Rubs its cheeks against the foe, paralyzing it.",
    "longDescription": "The user's electrified cheeks nuzzle the foe, paralyzing the foe.",
    "types": [
      4
    ],
    "power": 20,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 610,
    "moveConst": "MOVE_HOLD_BACK",
    "name": "Hold Back",
    "shortName": "Hold Back",
    "description": "An attack that leaves the foe with at least 1 HP.",
    "longDescription": "Can't KO the foe. 50% chance to cause confusion.",
    "types": [
      1
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 110,
    "effectChance": 50,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 611,
    "moveConst": "MOVE_INFESTATION",
    "name": "Infestation",
    "shortName": "Infestation",
    "description": "The foe is infested and attacked for 2 to 5 turns.",
    "longDescription": "The foe is infested for 4 or 5 turns. The foe cannot flee during this time.",
    "types": [
      5
    ],
    "power": 50,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 612,
    "moveConst": "MOVE_POWER_UP_PUNCH",
    "name": "Power-Up Punch",
    "shortName": "PowerUpPunch",
    "description": "A hard punch that raises the user's Attack.",
    "longDescription": "The user strikes, strengthening its fists. This raises their Attack stat.",
    "types": [
      1
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 127,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 613,
    "moveConst": "MOVE_OBLIVION_WING",
    "name": "Oblivion Wing",
    "shortName": "OblivionWing",
    "description": "An attack that absorbs over 75% of damage inflicted.",
    "longDescription": "The user absorbs over 75% of the damage inflicted. Air-based.",
    "types": [
      6
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 614,
    "moveConst": "MOVE_THOUSAND_ARROWS",
    "name": "Thousand Arrows",
    "shortName": "ThousndArrws",
    "description": "Can hit Flying foes, then knocks them to the ground.",
    "longDescription": "This move also hits foes that are in the air, and knocks them down.",
    "types": [
      9
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 230,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 615,
    "moveConst": "MOVE_THOUSAND_WAVES",
    "name": "Thousand Waves",
    "shortName": "ThousndWaves",
    "description": "Those hit by the wave can no longer escape.",
    "longDescription": "Those hit by this crawling wave can no longer escape the battle.",
    "types": [
      9
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 309,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 616,
    "moveConst": "MOVE_LANDS_WRATH",
    "name": "Land's Wrath",
    "shortName": "Land's Wrath",
    "description": "Gathers the energy of the land to attack every foe.",
    "longDescription": "The user gathers the energy of the land and focuses it on its foes.",
    "types": [
      9
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 13,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 617,
    "moveConst": "MOVE_LIGHT_OF_RUIN",
    "name": "Light Of Ruin",
    "shortName": "LightOfRuin",
    "description": "Fires a great beam of light that also hurts the user.",
    "longDescription": "The user fires a powerful beam of light that has 50% recoil damage.",
    "types": [
      17
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 237,
    "effectChance": 0,
    "flags": [
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 618,
    "moveConst": "MOVE_ORIGIN_PULSE",
    "name": "Origin Pulse",
    "shortName": "Origin Pulse",
    "description": "Beams of glowing blue light blast both foes.",
    "longDescription": "Attacks both foes with deep blue beams of light. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 619,
    "moveConst": "MOVE_PRECIPICE_BLADES",
    "name": "Precipice Blades",
    "shortName": "PrcipceBldes",
    "description": "Fearsome blades of stone attack both foes.",
    "longDescription": "The foes are all attacked with fearsome blades of stone and rock.",
    "types": [
      9
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 620,
    "moveConst": "MOVE_DRAGON_ASCENT",
    "name": "Dragon Ascent",
    "shortName": "DragonAscent",
    "description": "A strong attack but lowers the defensive stats.",
    "longDescription": "The user soars up, then strikes. This cuts its Defense and Sp. Def stats.",
    "types": [
      6
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 34,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 621,
    "moveConst": "MOVE_HYPERSPACE_FURY",
    "name": "Hyperspace Fury",
    "shortName": "HyprspceFury",
    "description": "Uses a warp hole to attack. Can't be evaded.",
    "longDescription": "Using a wormhole, the user strikes. Has +1 priority. Ignores Protect etc.",
    "types": [
      11
    ],
    "power": 100,
    "accuracy": 0,
    "pp": 5,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 310,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 622,
    "moveConst": "MOVE_SHORE_UP",
    "name": "Shore Up",
    "shortName": "Shore Up",
    "description": "Restores the user's HP. More HP in a sandstorm.",
    "longDescription": "Heals the user by up to half its full HP, restoring more in a sandstorm.",
    "types": [
      9
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 311,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 623,
    "moveConst": "MOVE_FIRST_IMPRESSION",
    "name": "First Impression",
    "shortName": "FrstImpressn",
    "description": "Hits hard and first. Only works first turn.",
    "longDescription": "An attack that hits first with great power. Usable only on first turn.",
    "types": [
      5
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 3,
    "split": 0,
    "target": 0,
    "effect": 139,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 624,
    "moveConst": "MOVE_BANEFUL_BUNKER",
    "name": "Baneful Bunker",
    "shortName": "BanefulBunkr",
    "description": "Protects user and poisons foes on contact.",
    "longDescription": "This move protects the user and poisons any foe that makes contact.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 625,
    "moveConst": "MOVE_SPIRIT_SHACKLE",
    "name": "Spirit Shackle",
    "shortName": "SpiritShackl",
    "description": "After being hit, foes can no longer escape.",
    "longDescription": "The foe's shadow is pinned down when it is hit, preventing it from escaping.",
    "types": [
      16
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 309,
    "effectChance": 100,
    "flags": [
      1,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 626,
    "moveConst": "MOVE_DARKEST_LARIAT",
    "name": "Darkest Lariat",
    "shortName": "DarkstLariat",
    "description": "Swings the arms to strike It ignores stat changes.",
    "longDescription": "The foe swings both arms to hit its foe, ignoring any stat changes.",
    "types": [
      11
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 627,
    "moveConst": "MOVE_SPARKLING_ARIA",
    "name": "Sparkling Aria",
    "shortName": "SparklngAria",
    "description": "Sings with bubbles. Cures burns on contact.",
    "longDescription": "Musical bubbles hit those around the user, healing the burn of those hit.",
    "types": [
      12
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 312,
    "effectChance": 100,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 628,
    "moveConst": "MOVE_ICE_HAMMER",
    "name": "Ice Hammer",
    "shortName": "Ice Hammer",
    "description": "Swings a fist to strike. Deals good, consistent damage.",
    "longDescription": "A strong, heavy fist is swung. Iron Fist boost.",
    "types": [
      3
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 629,
    "moveConst": "MOVE_FLORAL_HEALING",
    "name": "Floral Healing",
    "shortName": "FloralHeal",
    "description": "Restores an ally's HP. Heals more on grass.",
    "longDescription": "Heals the target by up to half its max HP. It heals more in grassy terrain.",
    "types": [
      17
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 263,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 630,
    "moveConst": "MOVE_HIGH_HORSEPOWER",
    "name": "High Horsepower",
    "shortName": "HiHorsepower",
    "description": "Slams hard into the foe with its entire body.",
    "longDescription": "The user fiercely attacks the foe. Striker boost.",
    "types": [
      9
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 631,
    "moveConst": "MOVE_STRENGTH_SAP",
    "name": "Strength Sap",
    "shortName": "Strength Sap",
    "description": "Saps the foe's Attack to heal HP, then drops Attack.",
    "longDescription": "Restores HP by the amount of the foe's Attack stat, and drops their Attack.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 313,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 632,
    "moveConst": "MOVE_SOLAR_BLADE",
    "name": "Solar Blade",
    "shortName": "Solar Blade",
    "description": "Charges first turn, then chops with a blade of light.",
    "longDescription": "A 2-turn move that slices the foe. Weather-based. Keen Edge boost.",
    "types": [
      8
    ],
    "power": 125,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 39,
    "effectChance": 0,
    "flags": [
      0,
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 633,
    "moveConst": "MOVE_LEAFAGE",
    "name": "Leafage",
    "shortName": "Leafage",
    "description": "Attacks with a flurry of small leaves.",
    "longDescription": "The user attacks by pelting the target with leaves.",
    "types": [
      8
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 634,
    "moveConst": "MOVE_SPOTLIGHT",
    "name": "Spotlight",
    "shortName": "Spotlight",
    "description": "Makes the foe attack the spotlighted Pokémon.",
    "longDescription": "For 1 turn, a spot-light is shone on the foe so that only it is attacked.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 3,
    "split": 2,
    "target": 0,
    "effect": 151,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 635,
    "moveConst": "MOVE_TOXIC_THREAD",
    "name": "Toxic Thread",
    "shortName": "Toxic Thread",
    "description": "Attacks with a thread that poisons and drops Speed.",
    "longDescription": "Poisoned threads shoot at the foe, poisoning it and lowering its Speed.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 314,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 636,
    "moveConst": "MOVE_LASER_FOCUS",
    "name": "Laser Focus",
    "shortName": "Laser Focus",
    "description": "Guarantees the next move will be a critical hit.",
    "longDescription": "The user focuses intensely, making sure its next move is a critical hit.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 315,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 637,
    "moveConst": "MOVE_GEAR_UP",
    "name": "Gear Up",
    "shortName": "Gear Up",
    "description": "Boosts the attacks of those with Plus or Minus.",
    "longDescription": "The user rotates its gears, raising its SpAtk and sharply raising its Speed.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 316,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 638,
    "moveConst": "MOVE_THROAT_CHOP",
    "name": "Throat Chop",
    "shortName": "Throat Chop",
    "description": "Chops the throat to disable sound moves for 2 turns.",
    "longDescription": "For 2 turns after being hit, the foe cannot use moves that emit sound.",
    "types": [
      11
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 317,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 639,
    "moveConst": "MOVE_POLLEN_PUFF",
    "name": "Pollen Puff",
    "shortName": "Pollen Puff",
    "description": "Explodes on foes, but restores ally's HP.",
    "longDescription": "A pollen puff that will explode to damage foes, but will heal allies.",
    "types": [
      5
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 116,
    "effectChance": 0,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 640,
    "moveConst": "MOVE_ANCHOR_SHOT",
    "name": "Anchor Shot",
    "shortName": "Anchor Shot",
    "description": "Strangles the foe with a chain. The foe can't switch.",
    "longDescription": "The user's anchor chain strikes and entangles the foe, preventing escape.",
    "types": [
      7
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 309,
    "effectChance": 100,
    "flags": [
      0,
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 641,
    "moveConst": "MOVE_PSYCHIC_TERRAIN",
    "name": "Psychic Terrain",
    "shortName": "PsychcTrrain",
    "description": "The ground turns weird for 8 turns. Blocks priority.",
    "longDescription": "For 8 turns, faster moves will fail and Psychic-type moves deal more damage.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 318,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 642,
    "moveConst": "MOVE_LUNGE",
    "name": "Lunge",
    "shortName": "Lunge",
    "description": "Lunges at the foe to lower its Attack stat.",
    "longDescription": "The user lunges at the foe with full force, lowering the foe's Attack stat.",
    "types": [
      5
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 22,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 643,
    "moveConst": "MOVE_FIRE_LASH",
    "name": "Fire Lash",
    "shortName": "Fire Lash",
    "description": "Whips the foe with fire lowering its Defense.",
    "longDescription": "The foe is struck with a burning lash that lowers its Defense stat.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 644,
    "moveConst": "MOVE_POWER_TRIP",
    "name": "Power Trip",
    "shortName": "Power Trip",
    "description": "It hits harder the more stat boosts the user has.",
    "longDescription": "The more the user's stats are raised, the greater this attack's power.",
    "types": [
      11
    ],
    "power": 20,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 259,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 645,
    "moveConst": "MOVE_BURN_UP",
    "name": "Burn Up",
    "shortName": "Burn Up",
    "description": "Burns out the user fully removing the Fire type.",
    "longDescription": "To strike at full force, the user burns out and loses its Fire-type.",
    "types": [
      2
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 319,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 646,
    "moveConst": "MOVE_SPEED_SWAP",
    "name": "Speed Swap",
    "shortName": "Speed Swap",
    "description": "Swaps Speed with the foe.",
    "longDescription": "Swaps Speed stat and stat boosts with the target.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 320,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 647,
    "moveConst": "MOVE_SMART_STRIKE",
    "name": "Smart Strike",
    "shortName": "Smart Strike",
    "description": "Hits with an accurate horn that never misses.",
    "longDescription": "Stabs the foe with a sharp horn. Ignores Abilities. Mighty Horn boost.",
    "types": [
      7
    ],
    "power": 80,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 648,
    "moveConst": "MOVE_PURIFY",
    "name": "Purify",
    "shortName": "Purify",
    "description": "Cures the foe's status to restore HP.",
    "longDescription": "The user tries to heal the target's status condition to restore its own HP.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 321,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 649,
    "moveConst": "MOVE_REVELATION_DANCE",
    "name": "Revelation Dance",
    "shortName": "RvlationDnce",
    "description": "Dances with mystical power. Matches user's first type.",
    "longDescription": "The user attacks by dancing. The user's type determines the type of this move.",
    "types": [
      0
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 322,
    "effectChance": 0,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 650,
    "moveConst": "MOVE_CORE_ENFORCER",
    "name": "Core Enforcer",
    "shortName": "CoreEnforcer",
    "description": "Hits with a ray that nullifies the foe's ability.",
    "longDescription": "This attack will also negate the foe's Ability if it has moved already.",
    "types": [
      15
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 211,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 651,
    "moveConst": "MOVE_TROP_KICK",
    "name": "Trop Kick",
    "shortName": "Trop Kick",
    "description": "An intense kick from the tropics. Lowers Attack.",
    "longDescription": "An intense, tropical kick. This lowers foe's Attack. Striker boost.",
    "types": [
      8
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 22,
    "effectChance": 100,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 652,
    "moveConst": "MOVE_INSTRUCT",
    "name": "Instruct",
    "shortName": "Instruct",
    "description": "Orders the target to use its last move again.",
    "longDescription": "The user instructs the target to use the target's last move again.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 323,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 653,
    "moveConst": "MOVE_BEAK_BLAST",
    "name": "Beak Blast",
    "shortName": "Beak Blast",
    "description": "Heats up beak to attack. Burns foe on contact.",
    "longDescription": "The user strikes with its heated beak. Has 30% burn chance.",
    "types": [
      6
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 30,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 654,
    "moveConst": "MOVE_CLANGING_SCALES",
    "name": "Clanging Scales",
    "shortName": "ClngngScales",
    "description": "Makes a big noise with its scales. Drops Defense.",
    "longDescription": "The user attacks by rubbing the scales on its body. This lowers its Defense.",
    "types": [
      15
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 324,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 655,
    "moveConst": "MOVE_DRAGON_HAMMER",
    "name": "Dragon Hammer",
    "shortName": "DragonHammer",
    "description": "Swings its whole body like a hammer to damage.",
    "longDescription": "Using its body like a hammer, the user attacks its foe.",
    "types": [
      15
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 656,
    "moveConst": "MOVE_BRUTAL_SWING",
    "name": "Brutal Swing",
    "shortName": "Brutal Swing",
    "description": "Violently swings around to hurt everyone nearby.",
    "longDescription": "The user violently swings its body around, damaging everyone nearby.",
    "types": [
      11
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 657,
    "moveConst": "MOVE_AURORA_VEIL",
    "name": "Aurora Veil",
    "shortName": "Aurora Veil",
    "description": "Weakens all attacks, but only usable with hail.",
    "longDescription": "For 5 turns, damage from attacks are weakened. This fails without Hail.",
    "types": [
      3
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 325,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 658,
    "moveConst": "MOVE_SHELL_TRAP",
    "name": "Shell Trap",
    "shortName": "Shell Trap",
    "description": "Sets a shell trap that damages on contact.",
    "longDescription": "The user sets a shell trap that is set off by physical attacks.",
    "types": [
      2
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 10,
    "priority": -3,
    "split": 1,
    "target": 5,
    "effect": 326,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 659,
    "moveConst": "MOVE_FLEUR_CANNON",
    "name": "Fleur Cannon",
    "shortName": "Fleur Cannon",
    "description": "A strong ray that harshly lowers Sp. Attack.",
    "longDescription": "A strong beam. Harshly lowers the user's SpAtk Mega Launcher boost",
    "types": [
      17
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 182,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 660,
    "moveConst": "MOVE_PSYCHIC_FANGS",
    "name": "Psychic Fangs",
    "shortName": "PsychicFangs",
    "description": "Chomps with psychic fangs. Destroys any barriers.",
    "longDescription": "Breaks any barrier like Light Screen and Reflect. Strong Jaw boost.",
    "types": [
      13
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 165,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 661,
    "moveConst": "MOVE_STOMPING_TANTRUM",
    "name": "Stomping Tantrum",
    "shortName": "StmpngTantrm",
    "description": "Stomps around angrily. Stronger after a failure.",
    "longDescription": "A frustrated strike that deals twice the damage if the last move failed.",
    "types": [
      9
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 117,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 662,
    "moveConst": "MOVE_SHADOW_BONE",
    "name": "Shadow Bone",
    "shortName": "Shadow Bone",
    "description": "Strikes with a haunted bone. Might drop Defense.",
    "longDescription": "The foe is hit by a spirit bone. 20% chance to drop foe's Defense.",
    "types": [
      16
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 20,
    "flags": [
      15
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 663,
    "moveConst": "MOVE_ACCELEROCK",
    "name": "Accelerock",
    "shortName": "Accelerock",
    "description": "Hits with a high-speed rock that always goes first.",
    "longDescription": "The user smashes into the foe at high speed. Has +1 priority.",
    "types": [
      14
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 664,
    "moveConst": "MOVE_LIQUIDATION",
    "name": "Liquidation",
    "shortName": "Liquidation",
    "description": "Slams the foe with water. Can lower Defense.",
    "longDescription": "A full-force blast of water with a 20% chance to lower foe's Defense.",
    "types": [
      12
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 665,
    "moveConst": "MOVE_PRISMATIC_LASER",
    "name": "Prismatic Laser",
    "shortName": "PrsmaticLasr",
    "description": "A high power laser that can't be used next turn.",
    "longDescription": "Severely damaging laser beams. Can't be used twice in a row. Mega Launcher boost",
    "types": [
      13
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 666,
    "moveConst": "MOVE_SPECTRAL_THIEF",
    "name": "Spectral Thief",
    "shortName": "SpectrlThief",
    "description": "Steals the target's stat boosts, then attacks.",
    "longDescription": "Hiding in the foe's shadow, the user steals its stat boosts and attacks.",
    "types": [
      16
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 327,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 667,
    "moveConst": "MOVE_SUNSTEEL_STRIKE",
    "name": "Sunsteel Strike",
    "shortName": "SnsteelStrke",
    "description": "A sun-fueled strike that ignores abilities.",
    "longDescription": "Slams into the foe like a meteor. Ignores Abilities. Mega Launcher boost",
    "types": [
      7
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 668,
    "moveConst": "MOVE_MOONGEIST_BEAM",
    "name": "Moongeist Beam",
    "shortName": "MoongestBeam",
    "description": "A moon-powered beam that ignores abilities.",
    "longDescription": "A sinister ray attacks the foe. Ignores Abilities. Mega Launcher boost",
    "types": [
      16
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      16
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 669,
    "moveConst": "MOVE_TEARFUL_LOOK",
    "name": "Tearful Look",
    "shortName": "Tearful Look",
    "description": "The user tears up, dropping Special Attack.",
    "longDescription": "The foe's Special Attack is lowered by the user's teary eyes.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 1,
    "split": 2,
    "target": 0,
    "effect": 299,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 670,
    "moveConst": "MOVE_ZING_ZAP",
    "name": "Zing Zap",
    "shortName": "Zing Zap",
    "description": "An electrified impact that can cause flinching.",
    "longDescription": "A strong electric blast crashes on the foe. 30% flinch chance.",
    "types": [
      4
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 671,
    "moveConst": "MOVE_NATURES_MADNESS",
    "name": "Nature's Madness",
    "shortName": "Natur'sMadns",
    "description": "Halves the foe's HP with the power of nature.",
    "longDescription": "The user hits the foe with the force of nature, halving the foe's HP.",
    "types": [
      17
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 328,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 672,
    "moveConst": "MOVE_MULTI_ATTACK",
    "name": "Multi-Attack",
    "shortName": "Multi-Attack",
    "description": "An attack that changes with Memories.",
    "longDescription": "A high-energy slam. The memory held determines the move's type.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 235,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 673,
    "moveConst": "MOVE_MIND_BLOWN",
    "name": "Mind Blown",
    "shortName": "Mind Blown",
    "description": "It explodes the user's head to damage everything around.",
    "longDescription": "The user attacks everything nearby, causing its own head to explode.",
    "types": [
      2
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 329,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 674,
    "moveConst": "MOVE_PLASMA_FISTS",
    "name": "Plasma Fists",
    "shortName": "Plasma Fists",
    "description": "Hits with electrical fists. Normal moves become Electric.",
    "longDescription": "Electrifies Normal-type moves used in the same turn. Iron Fist boost.",
    "types": [
      4
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 330,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 675,
    "moveConst": "MOVE_PHOTON_GEYSER",
    "name": "Photon Geyser",
    "shortName": "PhotonGeyser",
    "description": "User's highest attack stat determines its category.",
    "longDescription": "A pillar of light. Uses the best Atk stat. Mega Launcher boost",
    "types": [
      13
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 4,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 676,
    "moveConst": "MOVE_ZIPPY_ZAP",
    "name": "Zippy Zap",
    "shortName": "Zippy Zap",
    "description": "Electric bursts always go first and land a critical hit.",
    "longDescription": "High-speed electric bursts that always go first and land in a critical hit.",
    "types": [
      4
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 15,
    "priority": 2,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 677,
    "moveConst": "MOVE_SPLISHY_SPLASH",
    "name": "Splishy Splash",
    "shortName": "SplishySplsh",
    "description": "A huge electrified wave that may paralyze the foe.",
    "longDescription": "The user creates a huge electrified wave that may paralyze the foe.",
    "types": [
      12
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 5,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 678,
    "moveConst": "MOVE_FLOATY_FALL",
    "name": "Floaty Fall",
    "shortName": "Floaty Fall",
    "description": "Floats in air and dives at angle. May cause flinching.",
    "longDescription": "Floats in the air and dives at a steep angle. It may make the target flinch.",
    "types": [
      6
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 679,
    "moveConst": "MOVE_PIKA_PAPOW",
    "name": "Pika Papow",
    "shortName": "Pika Papow",
    "description": "A reliable and strong Electric type attack. Uses best offense.",
    "longDescription": "Pikachu's love for its trainer raises this move's power. It never misses.",
    "types": [
      4
    ],
    "power": 110,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 680,
    "moveConst": "MOVE_BOUNCY_BUBBLE",
    "name": "Bouncy Bubble",
    "shortName": "BouncyBubble",
    "description": "An attack that absorbs all the damage inflicted.",
    "longDescription": "An attack that absorbs all the damage it inflicted to restore HP.",
    "types": [
      12
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 681,
    "moveConst": "MOVE_BUZZY_BUZZ",
    "name": "Buzzy Buzz",
    "shortName": "Buzzy Buzz",
    "description": "Shoots a jolt of electricity that always paralyzes.",
    "longDescription": "The user shoots a jolt of electricity that always paralyzes the foe.",
    "types": [
      4
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 5,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 682,
    "moveConst": "MOVE_SIZZLY_SLIDE",
    "name": "Sizzly Slide",
    "shortName": "Sizzly Slide",
    "description": "User cloaked in fire charges. Leaves the foe with a burn.",
    "longDescription": "The user cloaks itself in fire and charges at the foe, leaving a burn.",
    "types": [
      2
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 683,
    "moveConst": "MOVE_GLITZY_GLOW",
    "name": "Glitzy Glow",
    "shortName": "Glitzy Glow",
    "description": "Telekinetic force that sets wall, lowering Sp. Atk damage.",
    "longDescription": "A Telekinetic force attacks the foe, putting a wall that raises Sp. Defense.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 331,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 684,
    "moveConst": "MOVE_BADDY_BAD",
    "name": "Baddy Bad",
    "shortName": "Baddy Bad",
    "description": "Acting badly, attacks. Sets wall, lowering Attack damage.",
    "longDescription": "The user acts bad and attacks, putting a wall that raises Defense.",
    "types": [
      11
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 332,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 685,
    "moveConst": "MOVE_SAPPY_SEED",
    "name": "Sappy Seed",
    "shortName": "Sappy Seed",
    "description": "Giant stalk scatters seeds that drain HP every turn.",
    "longDescription": "Grows a giant stalk, scattering seeds that drain the foe's HP every turn.",
    "types": [
      8
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 333,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 686,
    "moveConst": "MOVE_FREEZY_FROST",
    "name": "Freezy Frost",
    "shortName": "Freezy Frost",
    "description": "Crystal from cold haze hits. Eliminates all stat changes.",
    "longDescription": "Attack with crystal made of cold frozen haze. It eliminates all stat changes.",
    "types": [
      3
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 334,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 687,
    "moveConst": "MOVE_SPARKLY_SWIRL",
    "name": "Sparkly Swirl",
    "shortName": "SparklySwirl",
    "description": "Wrap foe with whirlwind of scent. Heals party's status.",
    "longDescription": "Wraps foe with a whirlwind of scent. It heals all status of the user's party.",
    "types": [
      17
    ],
    "power": 120,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 335,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 688,
    "moveConst": "MOVE_VEEVEE_VOLLEY",
    "name": "Veevee Volley",
    "shortName": "VeeveeVolley",
    "description": "A reliable and strong Normal type attack. Uses best offense.",
    "longDescription": "Eevee's love for its trainer raises this move's power. It never misses.",
    "types": [
      0
    ],
    "power": 110,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 689,
    "moveConst": "MOVE_DOUBLE_IRON_BASH",
    "name": "Double Iron Bash",
    "shortName": "DublIronBash",
    "description": "The user spins and hits with its arms. May cause flinch.",
    "longDescription": "Spinning rapidly, the user strikes twice. Has 30% flinch chance.",
    "types": [
      7
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 690,
    "moveConst": "MOVE_DYNAMAX_CANNON",
    "name": "Dynamax Cannon",
    "shortName": "DynamxCannon",
    "description": "Fires a strong beam. Deals 2x damage to Mega foes.",
    "longDescription": "The user unleashes a strong beam that damages Mega foes twice as hard.",
    "types": [
      15
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 691,
    "moveConst": "MOVE_SNIPE_SHOT",
    "name": "Snipe Shot",
    "shortName": "Snipe Shot",
    "description": "The user ignores effects that draw in moves.",
    "longDescription": "The user ignores effects that draw in moves. High crit. Mega Launcher boost",
    "types": [
      12
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 336,
    "effectChance": 0,
    "flags": [
      1,
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 692,
    "moveConst": "MOVE_JAW_LOCK",
    "name": "Jaw Lock",
    "shortName": "Jaw Lock",
    "description": "Prevents the user and the target from escaping.",
    "longDescription": "Prevents both the user and the foe from switching out. Strong Jaw boost.",
    "types": [
      1
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 337,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 693,
    "moveConst": "MOVE_STUFF_CHEEKS",
    "name": "Stuff Cheeks",
    "shortName": "Stuff Cheeks",
    "description": "Consumes the user's Berry, then sharply raises Def.",
    "longDescription": "The user eats its held Berry, then sharply raises its Defense stat.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 338,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 694,
    "moveConst": "MOVE_NO_RETREAT",
    "name": "No Retreat",
    "shortName": "No Retreat",
    "description": "Raises all of the user's stats but prevents escape.",
    "longDescription": "Ups all the user's stats. However, the user cannot switch out or flee.",
    "types": [
      1
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 339,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 695,
    "moveConst": "MOVE_TAR_SHOT",
    "name": "Tar Shot",
    "shortName": "Tar Shot",
    "description": "Lowers the foe's Speed and makes it weak to Fire.",
    "longDescription": "Sticky tar lowers the foe's Speed, and makes it weaker to Fire-type moves.",
    "types": [
      14
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 340,
    "effectChance": 0,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 696,
    "moveConst": "MOVE_MAGIC_POWDER",
    "name": "Magic Powder",
    "shortName": "Magic Powder",
    "description": "Magic powder changes the target into a Psychic-type.",
    "longDescription": "A cloud of magic powder that changes the foe to Psychic-type.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 251,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 697,
    "moveConst": "MOVE_DRAGON_DARTS",
    "name": "Dragon Darts",
    "shortName": "Dragon Darts",
    "description": "The user attacks twice. Parental Bond boost.",
    "longDescription": "User fires two dragon-shaped darts. 1.25x boost from Parental Bond.",
    "types": [
      15
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 698,
    "moveConst": "MOVE_TEATIME",
    "name": "Teatime",
    "shortName": "Teatime",
    "description": "All Pokémon have teatime and eat their Berries.",
    "longDescription": "All Pokémon in the battle have teatime, and eat their held Berry.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 341,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 699,
    "moveConst": "MOVE_OCTOLOCK",
    "name": "Octolock",
    "shortName": "Octolock",
    "description": "Traps the foe to lower Def and Sp. Def fall each turn.",
    "longDescription": "Prevents escape, and lowers the Sp. Def and Defense of the foe each turn.",
    "types": [
      1
    ],
    "power": 20,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 342,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 700,
    "moveConst": "MOVE_BOLT_BEAK",
    "name": "Bolt Beak",
    "shortName": "Bolt Beak",
    "description": "Double power if the user moves before the target.",
    "longDescription": "If attacking before the target, move power doubles. Strong Jaw boost",
    "types": [
      4
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 343,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 701,
    "moveConst": "MOVE_FISHIOUS_REND",
    "name": "Fishious Rend",
    "shortName": "FishiousRend",
    "description": "Double power if the user moves before the target.",
    "longDescription": "If attacking before the target, move power doubles. Strong Jaw boost",
    "types": [
      12
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 343,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 702,
    "moveConst": "MOVE_COURT_CHANGE",
    "name": "Court Change",
    "shortName": "Court Change",
    "description": "The user swaps effects on either side of the field.",
    "longDescription": "A mysterious power that swaps the effects on either side of the field.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 344,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 703,
    "moveConst": "MOVE_CLANGOROUS_SOUL",
    "name": "Clangorous Soul",
    "shortName": "SonorousSoul",
    "description": "The user uses some of its HP to raise all its stats.",
    "longDescription": "The user raises all its stats by using 1/3 of its HP.",
    "types": [
      15
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 345,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 704,
    "moveConst": "MOVE_BODY_PRESS",
    "name": "Body Press",
    "shortName": "Body Press",
    "description": "Does more damage the higher the user's Def.",
    "longDescription": "A body slam attack which inflicts more damage the higher the user's Defense.",
    "types": [
      1
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 346,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 705,
    "moveConst": "MOVE_DECORATE",
    "name": "Decorate",
    "shortName": "Decorate",
    "description": "Strikes foes with a brush or decorates allies to buff them.",
    "longDescription": "Damages foes. Raises allies' Attack, Special Attack, and Crit by 2 stages.",
    "types": [
      17
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 347,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 706,
    "moveConst": "MOVE_DRUM_BEATING",
    "name": "Drum Beating",
    "shortName": "Drum Beating",
    "description": "Plays a drum to attack. The foe's Speed is lowered.",
    "longDescription": "The user attacks the foe with its drum, lowering the foe's Speed stat.",
    "types": [
      8
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 707,
    "moveConst": "MOVE_SNAP_TRAP",
    "name": "Snap Trap",
    "shortName": "Snap Trap",
    "description": "Snares the target in a snap trap for four to five turns.",
    "longDescription": "The user snares the target in a snap trap for four to five turns.",
    "types": [
      7
    ],
    "power": 100,
    "accuracy": 85,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 708,
    "moveConst": "MOVE_PYRO_BALL",
    "name": "Pyro Ball",
    "shortName": "Pyro Ball",
    "description": "Launches a fiery ball at the target. It may cause a burn.",
    "longDescription": "The user launches a fiery ball at the foe. 10% chance to burn the foe.",
    "types": [
      2
    ],
    "power": 120,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 10,
    "flags": [
      7,
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 709,
    "moveConst": "MOVE_BEHEMOTH_BLADE",
    "name": "Behemoth Blade",
    "shortName": "BehemthBlade",
    "description": "Strikes as a sword. It deals 2x damage to Dynamaxed foes.",
    "longDescription": "The user strikes as a sword, dealing double the damage to Mega Pokemon.",
    "types": [
      7
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 710,
    "moveConst": "MOVE_BEHEMOTH_BASH",
    "name": "Behemoth Bash",
    "shortName": "BehemothBash",
    "description": "Does more damage the higher the user's Def.",
    "longDescription": "Uses defense for damage calculation. Double damage vs Mega Pokemon.",
    "types": [
      7
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 346,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 711,
    "moveConst": "MOVE_AURA_WHEEL",
    "name": "Aura Wheel",
    "shortName": "Aura Wheel",
    "description": "Raises Speed to attack. Both Electric-and Dark-type.",
    "longDescription": "Electric or Dark based on effectiveness. Raises Speed.",
    "types": [
      4,
      11
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 252,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 712,
    "moveConst": "MOVE_BREAKING_SWIPE",
    "name": "Breaking Swipe",
    "shortName": "BreakngSwipe",
    "description": "Swings its tail to attack. Lowers the Atk of those hit.",
    "longDescription": "The user swings at both foes with its tail, lowering the foes' Attack stat.",
    "types": [
      15
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 22,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 713,
    "moveConst": "MOVE_BRANCH_POKE",
    "name": "Branch Poke",
    "shortName": "Branch Poke",
    "description": "The user pokes the target with a pointed branch.",
    "longDescription": "The user attacks the foe by poking it with a sharply pointed branch.",
    "types": [
      8
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 714,
    "moveConst": "MOVE_OVERDRIVE",
    "name": "Overdrive",
    "shortName": "Overdrive",
    "description": "The user twangs its guitar, causing strong vibrations.",
    "longDescription": "The user twangs its guitar to attack both foes with a huge, echoing boom.",
    "types": [
      4
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 715,
    "moveConst": "MOVE_APPLE_ACID",
    "name": "Apple Acid",
    "shortName": "Apple Acid",
    "description": "Attacks with tart apple acid to lower the foe's Sp. Def.",
    "longDescription": "An acidic liquid attack created from tart apples. Lowers the foe's Sp. Def.",
    "types": [
      8
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 716,
    "moveConst": "MOVE_GRAV_APPLE",
    "name": "Grav Apple",
    "shortName": "Grav Apple",
    "description": "Drops an apple from above. Lowers the foe's Defense.",
    "longDescription": "Drops an apple on the foe, lowering the foe's Defense. Throw-based.",
    "types": [
      8
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 70,
    "effectChance": 100,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 717,
    "moveConst": "MOVE_SPIRIT_BREAK",
    "name": "Spirit Break",
    "shortName": "Spirit Break",
    "description": "Attacks with spirit-breaking force. Lowers SpAtk",
    "longDescription": "A forceful, spirit-breaking attack that lowers the foe's Sp. Atk stat.",
    "types": [
      17
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 29,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 718,
    "moveConst": "MOVE_STRANGE_STEAM",
    "name": "Strange Steam",
    "shortName": "StrangeSteam",
    "description": "Emits a strange steam to potentially confuse the foe.",
    "longDescription": "The user attacks by emitting steam. 20% chance to confuse the foe.",
    "types": [
      17
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 47,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 719,
    "moveConst": "MOVE_LIFE_DEW",
    "name": "Life Dew",
    "shortName": "Life Dew",
    "description": "Scatters water to restore the HP of itself and allies.",
    "longDescription": "The user restores the HP of itself and its allies with mysterious water.",
    "types": [
      12
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 348,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 720,
    "moveConst": "MOVE_OBSTRUCT",
    "name": "Obstruct",
    "shortName": "Obstruct",
    "description": "Protects itself, harshly lowering Def on contact.",
    "longDescription": "Protects the user, and lowers the Defense of foes that make contact.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 721,
    "moveConst": "MOVE_FALSE_SURRENDER",
    "name": "False Surrender",
    "shortName": "FalsSurrendr",
    "description": "Bows to stab the foe with hair. It never misses.",
    "longDescription": "The user pretends to bow, then stabs its foe. This move never misses.",
    "types": [
      11
    ],
    "power": 80,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 722,
    "moveConst": "MOVE_METEOR_ASSAULT",
    "name": "Meteor Assault",
    "shortName": "MeteorAssalt",
    "description": "Attacks with a thick leek. Can't be used next turn.",
    "longDescription": "Attacks wildly with a thick leek. Can only be used every-other turn. Keen Edge boost.",
    "types": [
      1
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 723,
    "moveConst": "MOVE_ETERNABEAM",
    "name": "Eternabeam",
    "shortName": "Eternabeam",
    "description": "Eternatus' strongest move. The user rests next turn.",
    "longDescription": "Eternatus's most powerful move. On the next turn, the user must rest.",
    "types": [
      15
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 724,
    "moveConst": "MOVE_STEEL_BEAM",
    "name": "Steel Beam",
    "shortName": "Steel Beam",
    "description": "Fires a beam of steel from its body. It hurts the user.",
    "longDescription": "Fires a powerful beam of steel. 50% recoil damage. Mega Launcher boost.",
    "types": [
      7
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 349,
    "effectChance": 0,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 725,
    "moveConst": "MOVE_EXPANDING_FORCE",
    "name": "Expanding Force",
    "shortName": "ExpandngForc",
    "description": "Power goes up and damages all foes on Psychic Terrain.",
    "longDescription": "This move's power goes up and damages all foes while on Psychic Terrain.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 350,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 726,
    "moveConst": "MOVE_STEEL_ROLLER",
    "name": "Steel Roller",
    "shortName": "Steel Roller",
    "description": "Rolls over the opponent while destroying terrain.",
    "longDescription": "Rolls over the opponent while destroying terrain.",
    "types": [
      7
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 13,
    "effectChance": 0,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 727,
    "moveConst": "MOVE_SCALE_SHOT",
    "name": "Scale Shot",
    "shortName": "Scale Shot",
    "description": "Shoots scales 2 to 5 times. Ups Speed, lowers defense.",
    "longDescription": "Hits 2 to 5 times. Boosts Speed, but lowers Defense. Mega Launcher boost",
    "types": [
      15
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 100,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 728,
    "moveConst": "MOVE_METEOR_BEAM",
    "name": "Meteor Beam",
    "shortName": "Meteor Beam",
    "description": "A 2-turn move that raises Sp. Attack before attacking.",
    "longDescription": "A 2-turn move that gathers space power raising Sp. Attack before attacking.",
    "types": [
      14
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 71,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 729,
    "moveConst": "MOVE_SHELL_SIDE_ARM",
    "name": "Shell Side Arm",
    "shortName": "ShellSideArm",
    "description": "Deals better of physical and special damage. May poison.",
    "longDescription": "Physical or special damage, whichever is more effective May poison the foe.",
    "types": [
      10
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 5,
    "target": 0,
    "effect": 21,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 730,
    "moveConst": "MOVE_MISTY_EXPLOSION",
    "name": "Mistsplosion",
    "shortName": "Mistsplosion",
    "description": "Hit everything and faint. Powers up on Misty Terrain.",
    "longDescription": "Attacks everything and faints the user. Its power increases on Misty Terrain.",
    "types": [
      17
    ],
    "power": 200,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 69,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 731,
    "moveConst": "MOVE_GRASSY_GLIDE",
    "name": "Grassy Glide",
    "shortName": "Grassy Glide",
    "description": "Gliding on ground, hits. Goes first on Grassy Terrain.",
    "longDescription": "Gliding on the ground, it attacks. Always goes first on Grassy Terrain.",
    "types": [
      8
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 351,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 732,
    "moveConst": "MOVE_RISING_VOLTAGE",
    "name": "Rising Voltage",
    "shortName": "RisngVoltage",
    "description": "This move's power doubles when on Electric Terrain.",
    "longDescription": "Its power doubles on Electric Terrain when the target is grounded.",
    "types": [
      4
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 352,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 733,
    "moveConst": "MOVE_TERRAIN_PULSE",
    "name": "Terrain Pulse",
    "shortName": "TerrainPulse",
    "description": "Type and power changes depending on the terrain.",
    "longDescription": "This move's type and power changes depending on the terrain when used.",
    "types": [
      0
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 152,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 734,
    "moveConst": "MOVE_SKITTER_SMACK",
    "name": "Skitter Smack",
    "shortName": "SkitterSmack",
    "description": "User skitters behind foe to attack. Lowers foe's SpAtk",
    "longDescription": "The user skitters behind the foe to attack. This lowers the foe's SpAtk",
    "types": [
      5
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 29,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 735,
    "moveConst": "MOVE_BURNING_JEALOUSY",
    "name": "Burning Jealousy",
    "shortName": "BrningJelosy",
    "description": "Attacks both foes with a 50% chance to burn boosted foes.",
    "longDescription": "Attacks both foes jealously. 50% burn chance if foe has stat boosts.",
    "types": [
      2
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 353,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 736,
    "moveConst": "MOVE_LASH_OUT",
    "name": "Lash Out",
    "shortName": "Lash Out",
    "description": "Increases in damage as the user's stats are lowered",
    "longDescription": "+20 BP for each negative stat stage and ignores negative attack stages.",
    "types": [
      11
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 354,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 737,
    "moveConst": "MOVE_POLTERGEIST",
    "name": "Poltergeist",
    "shortName": "Poltergeist",
    "description": "Control foe's item to attack. Fails if foe has no item.",
    "longDescription": "Controls the foe's item to attack. It fails if the foe has no item.",
    "types": [
      16
    ],
    "power": 110,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 355,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 738,
    "moveConst": "MOVE_CORROSIVE_GAS",
    "name": "Corrosive Gas",
    "shortName": "CorrosiveGas",
    "description": "Highly acidic gas melts items held by surrounding Pokémon.",
    "longDescription": "Highly acidic gas that melts items held by every surrounding Pokémon.",
    "types": [
      10
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 0,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 739,
    "moveConst": "MOVE_COACHING",
    "name": "Coaching",
    "shortName": "Coaching",
    "description": "Properly coaches allies to up their Attack and Defense.",
    "longDescription": "The user properly coaches its ally Pokémon, upping their Attack and Defense.",
    "types": [
      1
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 8,
    "effect": 356,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 740,
    "moveConst": "MOVE_FLIP_TURN",
    "name": "Flip Turn",
    "shortName": "Flip Turn",
    "description": "Attacks and rushes back to switch with a party Pokémon.",
    "longDescription": "The user strikes, and then switches with a waiting party Pokémon.",
    "types": [
      12
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 204,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 741,
    "moveConst": "MOVE_TRIPLE_AXEL",
    "name": "Triple Axel",
    "shortName": "Triple Axel",
    "description": "A 3-kick attack that gets more powerful with each hit.",
    "longDescription": "A 3-kick attack. More powerful with each successive hit. Striker boost.",
    "types": [
      3
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 87,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 742,
    "moveConst": "MOVE_DUAL_WINGBEAT",
    "name": "Dual Wingbeat",
    "shortName": "DualWingbeat",
    "description": "User slams the target with wings and hits twice in a row.",
    "longDescription": "The user slams the foe with its wings. Hits twice. Air-based.",
    "types": [
      6
    ],
    "power": 45,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      0,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 743,
    "moveConst": "MOVE_SCORCHING_SANDS",
    "name": "Scorchng Sands",
    "shortName": "ScorchngSnds",
    "description": "Throws scorching sand at the target. May leave a burn.",
    "longDescription": "Throws scorching sand at the target. 30% chance to burn the target.",
    "types": [
      9
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 744,
    "moveConst": "MOVE_JUNGLE_HEALING",
    "name": "Jungle Healing",
    "shortName": "JungleHealng",
    "description": "Heals HP and status of itself and allies in battle.",
    "longDescription": "Becomes one with the jungle, healing HP and status of itself and allies.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 348,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 745,
    "moveConst": "MOVE_WICKED_BLOW",
    "name": "Wicked Blow",
    "shortName": "Wicked Blow",
    "description": "Mastering the Dark style, strikes with a critical hit.",
    "longDescription": "Having mastered the Dark style, strikes with a fierce blow. Iron Fist boost.",
    "types": [
      11
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 746,
    "moveConst": "MOVE_SURGING_STRIKES",
    "name": "Surging Strikes",
    "shortName": "SurgngStrkes",
    "description": "Mastering the Water style, strikes with 3 critical hits.",
    "longDescription": "Having mastered the Water style, strikes 3 critical hits with a flowing motion.",
    "types": [
      12
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      0,
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 747,
    "moveConst": "MOVE_THUNDER_CAGE",
    "name": "Thunder Cage",
    "shortName": "Thunder Cage",
    "description": "Traps the foe in a cage of electricity for 2 to 5 turns.",
    "longDescription": "The user traps the foe in a cage of electricity for four or five turns.",
    "types": [
      4
    ],
    "power": 80,
    "accuracy": 90,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 11,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 748,
    "moveConst": "MOVE_DRAGON_ENERGY",
    "name": "Dragon Energy",
    "shortName": "DragonEnergy",
    "description": "The higher the user's HP the more damage caused.",
    "longDescription": "The higher the user's HP, the more powerful it is. Mega Launcher boost",
    "types": [
      15
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 169,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 749,
    "moveConst": "MOVE_FREEZING_GLARE",
    "name": "Freezing Glare",
    "shortName": "FreezngGlare",
    "description": "Shoots psychic power from the eyes. May frostbite the foe.",
    "longDescription": "The user shoots psychic power from its eyes to attack. 20% frostbite chance.",
    "types": [
      13
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 4,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 750,
    "moveConst": "MOVE_FIERY_WRATH",
    "name": "Fiery Wrath",
    "shortName": "Fiery Wrath",
    "description": "An attack fueled by your wrath. May cause flinching.",
    "longDescription": "It uses its wrath to fuel a fire-like aura attack. Has 20% flinch chance.",
    "types": [
      11
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 12,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 751,
    "moveConst": "MOVE_THUNDEROUS_KICK",
    "name": "Thunderous Kick",
    "shortName": "ThnderusKick",
    "description": "Uses a lightning-like kick to hit. Lowers foe's Defense.",
    "longDescription": "Fast lightning kick. It lowers the foe's Defense. Striker boost.",
    "types": [
      1
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 100,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 752,
    "moveConst": "MOVE_GLACIAL_LANCE",
    "name": "Glacial Lance",
    "shortName": "GlacialLance",
    "description": "Strikes by hurling a blizzard-cloaked icicle lance at a foe.",
    "longDescription": "Strikes by hurling a blizzard-cloaked icicle lance at opposing Pokémon.",
    "types": [
      3
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 753,
    "moveConst": "MOVE_ASTRAL_BARRAGE",
    "name": "Astral Barrage",
    "shortName": "AstrlBarrage",
    "description": "Strikes by sending a frightful amount of ghosts at a foe.",
    "longDescription": "Attacks with ghosts that hit both targets. Throw-Based.",
    "types": [
      16
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 754,
    "moveConst": "MOVE_EERIE_SPELL",
    "name": "Eerie Spell",
    "shortName": "Eerie Spell",
    "description": "Attacks with psychic power. Foe's last move has 3 PP cut.",
    "longDescription": "Foe's last move has 6 PP cut. Never misses in fog.",
    "types": [
      13
    ],
    "power": 110,
    "accuracy": 80,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 357,
    "effectChance": 0,
    "flags": [
      11,
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 755,
    "moveConst": "MOVE_DEATHROLL",
    "name": "Deathroll",
    "shortName": "Deathroll",
    "description": "Does a deadly roll in water. Ignores target's stat changes.",
    "longDescription": "20% confusion chance. Strong Jaw boost. Ignores target's stat changes.",
    "types": [
      12
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 47,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 756,
    "moveConst": "MOVE_EXCALIBUR",
    "name": "Excalibur",
    "shortName": "Excalibur",
    "description": "Double damage on Dragon-types. High critical ratio.",
    "longDescription": "Double damage on Dragons. High critical ratio. Keen Edge boost.",
    "types": [
      7
    ],
    "power": 120,
    "accuracy": 80,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 20,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 757,
    "moveConst": "MOVE_AQUA_FANG",
    "name": "Aqua Fang",
    "shortName": "Aqua Fang",
    "description": "Has 10% flinch chance. Strong Jaw boost.",
    "longDescription": "Bites with aquatic fangs. Has 20% flinch chance. Strong Jaw boost.",
    "types": [
      12
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 758,
    "moveConst": "MOVE_WAVE_CRASH",
    "name": "Wave Crash",
    "shortName": "Wave Crash",
    "description": "A life-risking tackle that with 33% recoil damage.",
    "longDescription": "Slams into the target on a giant wave. 10% drench chance. 33% recoil.",
    "types": [
      12
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 10,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 759,
    "moveConst": "MOVE_SMITE",
    "name": "Smite",
    "shortName": "Smite",
    "description": "Attacks from above with strong electricity. Smack Down effect.",
    "longDescription": "Attacks from above with strong electricity. 20% paralysis chance. Smack Down effect.",
    "types": [
      4
    ],
    "power": 120,
    "accuracy": 80,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 230,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 760,
    "moveConst": "MOVE_OUTBURST",
    "name": "Outburst",
    "shortName": "Outburst",
    "description": "Severe special damage but makes the user faint.",
    "longDescription": "The user explodes to inflict terrible damage even while fainting itself.",
    "types": [
      0
    ],
    "power": 250,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 4,
    "effect": 69,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 761,
    "moveConst": "MOVE_SEISMIC_FIST",
    "name": "Seismic Fist",
    "shortName": "Seismic Fist",
    "description": "A ground-breaking punch. 20% chance to drop Def.",
    "longDescription": "Throws a ground-breaking fist. 20% chance to drop the foe's Def.",
    "types": [
      9
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 762,
    "moveConst": "MOVE_IRON_FANGS",
    "name": "Iron Fangs",
    "shortName": "Iron Fangs",
    "description": "Chomps with hard fangs. Destroys any barriers.",
    "longDescription": "Breaks any barrier like Light Screen and Reflect. Strong Jaw boost.",
    "types": [
      7
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 165,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 763,
    "moveConst": "MOVE_SHADOW_FANGS",
    "name": "Shadow Fangs",
    "shortName": "Shadow Fangs",
    "description": "A bone-chilling bite. 10% curse chance.",
    "longDescription": "The foe shudders. 10% chance to curse the foe. Strong Jaw boost.",
    "types": [
      16
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 358,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 764,
    "moveConst": "MOVE_LOVELY_BITE",
    "name": "Lovely Bite",
    "shortName": "Lovely Bite",
    "description": "Bites the foe with love. 10% chance to infatuate.",
    "longDescription": "An affectionate bite. 10% chance to infatuate the foe. Strong Jaw boost.",
    "types": [
      17
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 359,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 765,
    "moveConst": "MOVE_JAGGED_FANGS",
    "name": "Jagged Fangs",
    "shortName": "Jagged Fangs",
    "description": "Bites aggressively. 10% chance to up Atk.",
    "longDescription": "A ferocious bite. 10% chance to raise user's Attack. Strong Jaw boost.",
    "types": [
      14
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 127,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 766,
    "moveConst": "MOVE_SCORCHED_EARTH",
    "name": "Scorched Earth",
    "shortName": "Scor.Earth",
    "description": "Precisely burns the ground under the foe. May burn.",
    "longDescription": "Fire or Ground based on effectiveness. Has 10% burn chance.",
    "types": [
      2,
      9
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 767,
    "moveConst": "MOVE_RAGING_FURY",
    "name": "Raging Fury",
    "shortName": "Raging Fury",
    "description": "A rampage of 2 to 3 turns that confuses the user.",
    "longDescription": "The user thrashes about for two to three turns, then becomes confused.",
    "types": [
      2
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 3,
    "effect": 18,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 768,
    "moveConst": "MOVE_PLASMA_PULSE",
    "name": "Plasma Pulse",
    "shortName": "Plasma Pulse",
    "description": "Double damage to foes with status problems.",
    "longDescription": "Double damage against status. 10% paralyze chance. Mega Launcher boost",
    "types": [
      4
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 264,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 769,
    "moveConst": "MOVE_PRIMAL_BEAM",
    "name": "Primal Beam",
    "shortName": "Primal Beam",
    "description": "An strange beam that uses the user's Attack, may rise it.",
    "longDescription": "An strange beam that uses the user's Attack, may rise own Atk.",
    "types": [
      15
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 127,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 770,
    "moveConst": "MOVE_DRACONIC_FANGS",
    "name": "Draconic Fangs",
    "shortName": "DraconicFang",
    "description": "Bites with draconic fangs. May cause flinching.",
    "longDescription": "The user bites with draconic fangs. 20% flinch chance. Strong Jaw boost.",
    "types": [
      15
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 771,
    "moveConst": "MOVE_PIXIE_BEAM",
    "name": "Pixie Beam",
    "shortName": "Pixie Beam",
    "description": "A powerfull magic beam 30% chance to drop user SpAtk.",
    "longDescription": "A powerful magic beam. 20% chance to lower SpAtk. Mega launcher.",
    "types": [
      17
    ],
    "power": 110,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 29,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 772,
    "moveConst": "MOVE_PIXIE_SLASH",
    "name": "Pixie Slash",
    "shortName": "Pixie Slash",
    "description": "The foe is slashed with a whimsical blade. High Crit ratio.",
    "longDescription": "The foe is slashed with a whimsical blade. High Crit ratio. Keen Edge boost.",
    "types": [
      17
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 773,
    "moveConst": "MOVE_SEISMIC_BLADE",
    "name": "Seismic Blade",
    "shortName": "SeismicBlde",
    "description": "The foe is slashed with a tectonic blade. High Crit ratio.",
    "longDescription": "The foe is slashed with a tectonic blade. High Crit ratio. Keen Edge boost.",
    "types": [
      9
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 774,
    "moveConst": "MOVE_MOUNTAIN_CHUNK",
    "name": "Mountain Chunk",
    "shortName": "Mtn.Chunk",
    "description": "Hurls a chunk of a mountain at the opponent. Can flinch.",
    "longDescription": "Hurls a chunk of a mountain at the foe. 30% flinch chance. Mega Launcher boost.",
    "types": [
      9
    ],
    "power": 110,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 775,
    "moveConst": "MOVE_ARCHER_SHOT",
    "name": "Archer Shot",
    "shortName": "Archer Shot",
    "description": "Shoots a dead center arrow at the target. Archer boost.",
    "longDescription": "Shoots a dead center arrow at the target. Archer boost.",
    "types": [
      0
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 776,
    "moveConst": "MOVE_FROST_BRAND",
    "name": "Frost Brand",
    "shortName": "Frost Brand",
    "description": "The foe is slashed with an icy blade. May inflict frostbite.",
    "longDescription": "Slahes with an ice-cold cryo blade. 10% frostbite chance. Keen Edge boost.",
    "types": [
      3
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 4,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 777,
    "moveConst": "MOVE_FROST_BOLT",
    "name": "Frost Bolt",
    "shortName": "Frost Bolt",
    "description": "Not done yet.",
    "longDescription": "The user shoots a freezing arrow. 20% frostbite chance. Arrow boost.",
    "types": [
      3
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 4,
    "effectChance": 20,
    "flags": [
      1,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 778,
    "moveConst": "MOVE_GLACIER_CRASH",
    "name": "Glacier Crash",
    "shortName": "GlacierCrash",
    "description": "Not done yet.",
    "longDescription": "A large glacier crashes into foes. Hits all others. Mega Launcher boost.",
    "types": [
      3
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 779,
    "moveConst": "MOVE_SUPERSONIC_SHOT",
    "name": "Supersonic Shot",
    "shortName": "S.SonicShot",
    "description": "An arrow attack. always crits.",
    "longDescription": "Fires a high-speed arrow. Always crits. Archer boost.",
    "types": [
      6
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      4,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 780,
    "moveConst": "MOVE_ZEPHYR_RUSH",
    "name": "Zephyr Rush",
    "shortName": "Zephyr Rush",
    "description": "Not done yet.",
    "longDescription": "User fires itself with a gale. Hurts on miss. Mega Launcher boost. Air-based.",
    "types": [
      6
    ],
    "power": 100,
    "accuracy": 95,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 15,
    "effectChance": 0,
    "flags": [
      0,
      8,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 781,
    "moveConst": "MOVE_SHOCKING_JAB",
    "name": "Shocking Jab",
    "shortName": "Shocking Jab",
    "description": "Not done yet.",
    "longDescription": "An electric jab strikes the foe. 20% paralysis chance. Mighty Horn boost.",
    "types": [
      4
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 20,
    "flags": [
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 782,
    "moveConst": "MOVE_SHOCKING_EDGE",
    "name": "Shocking Edge",
    "shortName": "ShockEdge",
    "description": "Not done yet.",
    "longDescription": "The foe is slashed with an electric blade. 10% paralyze chance. Keen Edge boost.",
    "types": [
      4
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 783,
    "moveConst": "MOVE_LIGHTNING_STRIKE",
    "name": "Lightning Strike",
    "shortName": "LightStrike",
    "description": "A rapid strike with a lightning bolt, maybe raising Speed.",
    "longDescription": "Leaps, strikes with a lightning bolt. 20% chance to raise Speed. Mega Launcher boost.",
    "types": [
      4
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 252,
    "effectChance": 20,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 784,
    "moveConst": "MOVE_VOLT_BOLT",
    "name": "Volt Bolt",
    "shortName": "Volt Bolt",
    "description": "Not done yet.",
    "longDescription": "Doubles damage if foe is paralyzed. Arrow move. Archer boost.",
    "types": [
      4
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 243,
    "effectChance": 0,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 785,
    "moveConst": "MOVE_KINETIC_BARRAGE",
    "name": "Kinetic Barrage",
    "shortName": "KinetcBarrge",
    "description": "Throws nearby objects using telekinesis. May Confuse.",
    "longDescription": "Lifts up objects and hurls them at the foe. 30% confusion. Mega Launcher boost.",
    "types": [
      13
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 47,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 786,
    "moveConst": "MOVE_FERTILE_FANGS",
    "name": "Fertile Fangs",
    "shortName": "FertileFangs",
    "description": "User inserts its ingraining fangs. May apply leech seed.",
    "longDescription": "Inserts ingraining fangs. 10% chance to apply Leech Seed. Strong Jaw boost.",
    "types": [
      8
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 360,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 787,
    "moveConst": "MOVE_SCATTER_BLAST",
    "name": "Scatter Blast",
    "shortName": "ScatterBlast",
    "description": "Not done yet.",
    "longDescription": "A blast of sand that scatters Stealth Rocks. Mega Launcher boost.",
    "types": [
      9
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 361,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 788,
    "moveConst": "MOVE_JAGGED_PUNCH",
    "name": "Jagged Punch",
    "shortName": "Jagged Punch",
    "description": "Not done yet.",
    "longDescription": "The foe is punched by a stony fist. 10% chance to set Stealth Rocks.",
    "types": [
      14
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 361,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 789,
    "moveConst": "MOVE_CUTSIE_SLAP",
    "name": "Cutsie Slap",
    "shortName": "Cutsie Slap",
    "description": "Slaps the foe cutely. May cause infatuation.",
    "longDescription": "The foe is slapped cutely. 10% infatuation chance. Iron Fist boost.",
    "types": [
      17
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 359,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 790,
    "moveConst": "MOVE_FAIRY_SPHERES",
    "name": "Fairy Spheres",
    "shortName": "FairySphere",
    "description": "Not done yet.",
    "longDescription": "Magical spheres hit 2 to 5 times. Hits SpDef. Mega Launcher boost.",
    "types": [
      17
    ],
    "power": 20,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 6,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 791,
    "moveConst": "MOVE_BRAMBLE_BLAST",
    "name": "Bramble Blast",
    "shortName": "BrambleBlast",
    "description": "30% chance to apply leech seed. Archer boost.",
    "longDescription": "Fires thorny brambles. 30% chance to apply Leech Seed. Archer boost.",
    "types": [
      8
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 360,
    "effectChance": 30,
    "flags": [
      0,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 792,
    "moveConst": "MOVE_ASTEROID_DOWNFALL",
    "name": "Asteroid Shot",
    "shortName": "AsteroidShot",
    "description": "Launches a asteroid onto the target. Cannot miss.",
    "longDescription": "Launches a small asteroid onto the target. Cannot miss. Mega Launcher boost.",
    "types": [
      14
    ],
    "power": 90,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 793,
    "moveConst": "MOVE_AQUA_BASH",
    "name": "Aqua Bash",
    "shortName": "Aqua Bash",
    "description": "A mystical jab strikes the foe. 20% flinch chance.",
    "longDescription": "A mystical jab strikes the foe. 20% flinch chance. Mighty Horn boost.",
    "types": [
      12
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 20,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 794,
    "moveConst": "MOVE_TECTONIC_FANGS",
    "name": "Tectonic Fangs",
    "shortName": "Tect.Fangs",
    "description": "User inserts its ground shaking fangs. 10% chance to flinch.",
    "longDescription": "User inserts its ground shaking fangs, 10% chance to flinch. Strong Jaw boost.",
    "types": [
      9
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 795,
    "moveConst": "MOVE_CUPID_SHOT",
    "name": "Cupid Shot",
    "shortName": "Cupid Shot",
    "description": "Not done yet.",
    "longDescription": "20% chance to infatuate the foe. Arrow move. Archer boost.",
    "types": [
      17
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 359,
    "effectChance": 20,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 796,
    "moveConst": "MOVE_CLAY_DART",
    "name": "Clay Dart",
    "shortName": "Clay Dart",
    "description": "Not done yet.",
    "longDescription": "Super-effective on Flying-types. Arrow move. Archer boost.",
    "types": [
      9
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 797,
    "moveConst": "MOVE_DIAMOND_ARROW",
    "name": "Diamond Arrow",
    "shortName": "DiamondArrow",
    "description": "Not done yet.",
    "longDescription": "Cuts through foe's stat changes. Sharp as a diamond. Archer boost.",
    "types": [
      14
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 798,
    "moveConst": "MOVE_DIAMOND_BLADE",
    "name": "Diamond Blade",
    "shortName": "DiamondBlade",
    "description": "Not done yet.",
    "longDescription": "Slashes with an unbreakable blade. 10% chance of Stealth Rocks. Keen Edge boost.",
    "types": [
      14
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 799,
    "moveConst": "MOVE_VENOM_BOLT",
    "name": "Venom Bolt",
    "shortName": "Venom Bolt",
    "description": "Not done yet.",
    "longDescription": "Shoots a toxic arrow with precision. +1 crit 20% poison chance. Archer boost.",
    "types": [
      10
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 21,
    "effectChance": 20,
    "flags": [
      1,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 800,
    "moveConst": "MOVE_FUMIGATION_BOMB",
    "name": "Fumigation Bomb",
    "shortName": "Fumi.Bomb",
    "description": "Not done yet.",
    "longDescription": "Hurls a pesticide bomb. Super-effective on Bug-types. Mega Launcher boost.",
    "types": [
      10
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 801,
    "moveConst": "MOVE_BLACK_MAGIC",
    "name": "Black Magic",
    "shortName": "Black Magic",
    "description": "Not done yet.",
    "longDescription": "Calls on dark power to attack. 20% chance to inflict bleed.",
    "types": [
      11
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 802,
    "moveConst": "MOVE_FLAME_TONGUE",
    "name": "Flame Tongue",
    "shortName": "Flame Tongue",
    "description": "Not done yet.",
    "longDescription": "Slashes foe with a fiery blade. 10% chance to burn. Keen Edge boost.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 803,
    "moveConst": "MOVE_BLAZING_ARROW",
    "name": "Blazing Arrow",
    "shortName": "BlazingArrow",
    "description": "Not done yet.",
    "longDescription": "Fires a blazing arrow. +1 crit chance. 20% burn chance. Archer boost.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 20,
    "flags": [
      1,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 804,
    "moveConst": "MOVE_ROCKET_PUNCH",
    "name": "Rocket Shot",
    "shortName": "Rocket Shot",
    "description": "Not done yet.",
    "longDescription": "Launches a body part like a rocket. Has +1 crit rate. Mega Launcher boost.",
    "types": [
      7
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 805,
    "moveConst": "MOVE_WEB_SHOT",
    "name": "Web Shot",
    "shortName": "Web Shot",
    "description": "Not done yet.",
    "longDescription": "Fires a sticky trap. Sets up Sticky Web. +1 crit chance. Archer boost.",
    "types": [
      5
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 362,
    "effectChance": 100,
    "flags": [
      1,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 806,
    "moveConst": "MOVE_AURA_FORCE",
    "name": "Aura Force",
    "shortName": "Aura Force",
    "description": "Not done yet.",
    "longDescription": "Imbues strikes with aura power. Super-effective on Ghost. Mega Launcher boost.",
    "types": [
      1
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 807,
    "moveConst": "MOVE_DRAKE_MISSILE",
    "name": "Draco Missile",
    "shortName": "DracoMissile",
    "description": "Not done yet.",
    "longDescription": "Hits both foes on the field with draconic force. Archer boost.",
    "types": [
      15
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 808,
    "moveConst": "MOVE_LOTUS_SHOWER",
    "name": "Lotus Shower",
    "shortName": "Lotus Shower",
    "description": "Not done yet.",
    "longDescription": "Lotus drifts to foes and explodes. Hits both foes. 10% Sleep. Mega Launcher boost.",
    "types": [
      8
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 279,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 809,
    "moveConst": "MOVE_JAGGED_HORNS",
    "name": "Jagged Horns",
    "shortName": "Jagged Horns",
    "description": "Not done yet.",
    "longDescription": "A rocky jab strikes the foe. 10% flinch chance. 10% bleed chance. Mighty Horn boost.",
    "types": [
      14
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 229,
    "effectChance": 10,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 810,
    "moveConst": "MOVE_BLOOD_SHOT",
    "name": "Blood Shot",
    "shortName": "Blood Shot",
    "description": "Makes the target bleed with black magic.",
    "longDescription": "Hurls a sphere of cursed blood magic. Causes the foe to bleed profusely.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 363,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 811,
    "moveConst": "MOVE_FLASH_FREEZE",
    "name": "Flash Freeze",
    "shortName": "Flash Freeze",
    "description": "Drains the heat from the target, causing frostbite.",
    "longDescription": "Rapidly chills the foe, causing frostbite. Never misses if user is Ice-type.",
    "types": [
      3
    ],
    "power": 0,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 364,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 812,
    "moveConst": "MOVE_PHANTOM_GLOVES",
    "name": "Phantom Glove",
    "shortName": "PhantomGlove",
    "description": "Not done yet.",
    "longDescription": "Throws foe with a ghostly hand. 30% chance to lower Speed. Mega Launcher boost.",
    "types": [
      16
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 813,
    "moveConst": "MOVE_HOMING_FLETCH",
    "name": "Homing Fletch",
    "shortName": "HomingFletch",
    "description": "Not done yet.",
    "longDescription": "User fires a seeking arrow. Cannot miss. Has +1 crit chance. Archer boost.",
    "types": [
      7
    ],
    "power": 80,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      1,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 814,
    "moveConst": "MOVE_BITTER_MALICE",
    "name": "Bitter Malice",
    "shortName": "BitterMalice",
    "description": "Attacks with spine-chilling resentment. May cause frostbite.",
    "longDescription": "A spine-chilling strike. 30% frostbite chance. 50% boost if target is statused.",
    "types": [
      16
    ],
    "power": 85,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 365,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 815,
    "moveConst": "MOVE_INFERNAL_PARADE",
    "name": "Infernal Parade",
    "shortName": "Infer.Parade",
    "description": "Not done yet.",
    "longDescription": "Attacks with spectral fireballs. 30% burn chance. 50% if target has status.",
    "types": [
      16
    ],
    "power": 85,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 365,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 816,
    "moveConst": "MOVE_DEVIOUS_SHOT",
    "name": "Devious Shot",
    "shortName": "Devious Shot",
    "description": "Not done yet.",
    "longDescription": "A devious arrow strike. +1 crit chance. 50% bleed chance. Archer boost.",
    "types": [
      11
    ],
    "power": 80,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 50,
    "flags": [
      1,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 817,
    "moveConst": "MOVE_STARBURST",
    "name": "Starburst",
    "shortName": "Starburst",
    "description": "The user crashes a large star onto the opponent. May flinch.",
    "longDescription": "The user crashes a star shaped ray down. 30% flinch chance. Mega Launcher boost.",
    "types": [
      0
    ],
    "power": 110,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 818,
    "moveConst": "MOVE_CHEAP_SHOT",
    "name": "Cheap Shot",
    "shortName": "Cheap Shot",
    "description": "The user sneaks into the shadows, then attacks.",
    "longDescription": "The user sneaks into shadows, then attacks with hidden projectile. Mega Launcher boost.",
    "types": [
      11
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 819,
    "moveConst": "MOVE_TORRENT_FIST",
    "name": "Torrent Fist",
    "shortName": "Torrent Fist",
    "description": "20% chance to drop speed. Iron Fist boost.",
    "longDescription": "Strikes with a water-infused fist. 20% chance to drop speed. Iron Fist boost.",
    "types": [
      12
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 820,
    "moveConst": "MOVE_STAR_CRASH",
    "name": "Star Crash",
    "shortName": "Star Crash",
    "description": "33% recoil damage.",
    "longDescription": "Strikes the foe like a falling star. 33% recoil damage.",
    "types": [
      17
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 821,
    "moveConst": "MOVE_STONE_AXE",
    "name": "Stone Axe",
    "shortName": "Stone Axe",
    "description": "Deals damage and sets stealth rock. Keen edge.",
    "longDescription": "Swings its Stone Axes into the foe, leaving behind Stealth Rocks. Keen Edge boost.",
    "types": [
      14
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 361,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 822,
    "moveConst": "MOVE_ENERGY_WAVE",
    "name": "Energy Wave",
    "shortName": "Energy Wave",
    "description": "Deals damage.",
    "longDescription": "The user unleashes a deadly wave of energy to strike the enemy.",
    "types": [
      0
    ],
    "power": 115,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 823,
    "moveConst": "MOVE_FLUTTERING_LEAF",
    "name": "Fluttering Leaf",
    "shortName": "FlutteringLf",
    "description": "Deals damage and switches.",
    "longDescription": "The user moves like a fluttering leaf and strikes. User switches afterwards.",
    "types": [
      8
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 204,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 824,
    "moveConst": "MOVE_HEADLONG_RUSH",
    "name": "Headlong Rush",
    "shortName": "HeadlongRush",
    "description": "Drops Def and SpDef.",
    "longDescription": "The user slams the target with a full-body tackle, dropping both its defenses.",
    "types": [
      9
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 34,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 825,
    "moveConst": "MOVE_REVIVAL_BLESSING",
    "name": "Revival Blessing",
    "shortName": "RevivalBless",
    "description": "Revives a fainted teammate with 50% HP.",
    "longDescription": "Revives a fainted teammate, restoring them to 50% HP with holy power.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 1,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 366,
    "effectChance": 0,
    "flags": [
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 826,
    "moveConst": "MOVE_WHIRLING_STRIKES",
    "name": "Whirling Strikes",
    "shortName": "WhirlngStrks",
    "description": "Hits 3 times. Each hit does more damage.",
    "longDescription": "Hits 3 times. Each hit does more damage. Striker.",
    "types": [
      6
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 87,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 827,
    "moveConst": "MOVE_MIND_BREAK",
    "name": "Mind Break",
    "shortName": "Mind Break",
    "description": "20% confuse chance.",
    "longDescription": "Uses psychic power to shatter foes' psyche. 20% chance to confuse.",
    "types": [
      13
    ],
    "power": 110,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 47,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 828,
    "moveConst": "MOVE_WYRM_WIND",
    "name": "Wyrm Wind",
    "shortName": "Wyrm Wind",
    "description": "Hits 2-5 times. Drops SpDef, raises Speed.",
    "longDescription": "Hits 2-5 times. Lowers SpDef. Raises Speed. Mega launcher boost.",
    "types": [
      15
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 1,
    "effectChance": 100,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 829,
    "moveConst": "MOVE_SHED_TAIL",
    "name": "Shed Tail",
    "shortName": "Shed Tail",
    "description": "Uses 50% HP to create substitute and switch out.",
    "longDescription": "The user creates a substitute using its own HP and switches with a party Pokémon.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 367,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 830,
    "moveConst": "MOVE_BERRY_SMASH",
    "name": "Berry Smash",
    "shortName": "Berry Smash",
    "description": "Deals damage. User eats their berry.",
    "longDescription": "User smashes its berry, gaining its effect. Super Slammer boost.",
    "types": [
      8
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 368,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 831,
    "moveConst": "MOVE_HYDRO_STEAM",
    "name": "Hydro Steam",
    "shortName": "Hydro Steam",
    "description": "The user blasts the target with boiling-hot water.",
    "longDescription": "The user blasts the target with boiling hot water. Boosted in harsh sunlight.",
    "types": [
      12
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 369,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 832,
    "moveConst": "MOVE_SUPERHOT_FLAME",
    "name": "Boiling Flame",
    "shortName": "SuperFlame",
    "description": "Deals damage. Does increase damage in rain.",
    "longDescription": "Deals damage. Deals increased damage in rain.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 369,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 833,
    "moveConst": "MOVE_TRIPLE_ARROWS",
    "name": "Triple Arrows",
    "shortName": "TripleArrow",
    "description": "50% chance to lower Def. 30% chance to flinch. High-crit.",
    "longDescription": "50% chance to drop Def. 30% chance to flinch. High crit. Arrow-based.",
    "types": [
      1
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 50,
    "flags": [
      0,
      1,
      7,
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 834,
    "moveConst": "MOVE_DOUBLE_LARIAT",
    "name": "Double Lariat",
    "shortName": "DoubleLariat",
    "description": "Hits both targets. Silences hit targets.",
    "longDescription": "User hits both foes with whirling arms. Foes cannot use any sound moves after.",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 317,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 835,
    "moveConst": "MOVE_LEECH_BLADE",
    "name": "Leech Blade",
    "shortName": "Leech Blade",
    "description": "Heals 50% damage done.",
    "longDescription": "Heals 50% of damage done to the foe. Keen Edge boost.",
    "types": [
      8
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 836,
    "moveConst": "MOVE_YGGDRASIL_FORCE",
    "name": "Yggdrasil Force",
    "shortName": "YggdrasilFrc",
    "description": "Lowers user's Atk and Def.",
    "longDescription": "Nature's overcharges the user's strike. Lowers Atk and Def.",
    "types": [
      8
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 161,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 837,
    "moveConst": "MOVE_DRAIN_BRAIN",
    "name": "Drain Brain",
    "shortName": "Drain Brain",
    "description": "Lowers targets SpAtk. Heals that much HP.",
    "longDescription": "Saps the foe's SpAtk and heals HP by the same amount.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 370,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 838,
    "moveConst": "MOVE_PSYCHOKINETIC_SLAM",
    "name": "Psychokinetic Slam",
    "shortName": "PsychokinSlm",
    "description": "Deals damage. 33% recoil damage.",
    "longDescription": "User charges, boosted by psychic power. 33% recoil damage.",
    "types": [
      13
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 839,
    "moveConst": "MOVE_ESPER_WING",
    "name": "Esper Wing",
    "shortName": "Esper Wing",
    "description": "Deals damage. Drains 50% hp.",
    "longDescription": "The user slashes the foe with aura wings. Drains 50% HP. Air-based.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0,
      11,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 840,
    "moveConst": "MOVE_MORTAL_SPIN",
    "name": "Mortal Spin",
    "shortName": "Mortal Spin",
    "description": "Deals damage. Removes hazards. Poisons targets.",
    "longDescription": "The user spins and removes all hazards. This also poisons the foe.",
    "types": [
      10
    ],
    "power": 30,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 371,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 841,
    "moveConst": "MOVE_GEM_MISSILE",
    "name": "Gem Missile",
    "shortName": "Gem Missile",
    "description": "+1 priority.",
    "longDescription": "A fast attack that strikes the foe with a sharp gem. +1 priority.",
    "types": [
      14
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 842,
    "moveConst": "MOVE_RIDER_KICK",
    "name": "Rider Kick",
    "shortName": "Rider Kick",
    "description": "Deals damage that can't miss. Ignores target ability.",
    "longDescription": "An unerring kick that ignores the foe's ability. Can't miss. Striker boost.",
    "types": [
      5
    ],
    "power": 90,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 843,
    "moveConst": "MOVE_AQUA_CUTTER",
    "name": "Aqua Cutter",
    "shortName": "Aqua Cutter",
    "description": "20% chance to bleed. High-crit.",
    "longDescription": "The user expels pressurized water. 20% bleed chance. High crit ratio.",
    "types": [
      12
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 20,
    "flags": [
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 844,
    "moveConst": "MOVE_INVERSE_ROOM",
    "name": "Inverse Room",
    "shortName": "Inverse Room",
    "description": "Reverses type matchups for 5 turns.",
    "longDescription": "The user exerts an unknown power that reverses the type chart for 5 turns.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 372,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 845,
    "moveConst": "MOVE_BLAZING_BONE",
    "name": "Blazing Bone",
    "shortName": "Blazing Bone",
    "description": "Hits 2-5 times. +1 priority.",
    "longDescription": "Strikes with a fiery bone 2-5 times. Has +1 priority. Bone-based.",
    "types": [
      2
    ],
    "power": 15,
    "accuracy": 100,
    "pp": 10,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      15
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 846,
    "moveConst": "MOVE_KARMA",
    "name": "Karma",
    "shortName": "Karma",
    "description": "Raises SpAtk and SpDef. Lowers Speed.",
    "longDescription": "Purges its impurities. Lowers Speed, raises SpAtk and SpDef.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 373,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 847,
    "moveConst": "MOVE_CHILLING_WATER",
    "name": "Chilling Water",
    "shortName": "ChillngWater",
    "description": "Shoots ice-cold water at the foe. May cause frostbite.",
    "longDescription": "Fires ice-cold water at the foe. 30% chance to inflict Frostbite.",
    "types": [
      12
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 4,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 848,
    "moveConst": "MOVE_GHASTLY_ECHO",
    "name": "Ghastly Echo",
    "shortName": "Ghastly Echo",
    "description": "Deals damage and switches out, empowring the ally.",
    "longDescription": "Deals damage and switches. Switch-in gets 50% boost for 1 turn. Sound-based.",
    "types": [
      16
    ],
    "power": 20,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 374,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 849,
    "moveConst": "MOVE_CHILLY_RECEPTION",
    "name": "Chilly Reception",
    "shortName": "ChillyRecep",
    "description": "Sets hail and switches.",
    "longDescription": "The user tells a bad joke and switches with an ally. This summons hail.",
    "types": [
      3
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 375,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 850,
    "moveConst": "MOVE_ICE_SPINNER",
    "name": "Ice Spinner",
    "shortName": "Ice Spinner",
    "description": "Deals damage and removes terrain.",
    "longDescription": "Deals damage and removes active terrain. Field-based.",
    "types": [
      3
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 13,
    "effectChance": 100,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 851,
    "moveConst": "MOVE_TIDY_UP",
    "name": "Tidy Up",
    "shortName": "Tidy Up",
    "description": "Removes hazards. Boosts Atk and Speed.",
    "longDescription": "The user tidies up and removes hazards. This also boosts its Atk and Speed.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 376,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 852,
    "moveConst": "MOVE_POPULATION_BOMB",
    "name": "Population Bomb",
    "shortName": "PopulationBm",
    "description": "Hits 10 times.",
    "longDescription": "The user's fellows gather in droves to attack the foe 1 to 10 times in a row.",
    "types": [
      0
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 377,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 853,
    "moveConst": "MOVE_RAGING_SOULS",
    "name": "Raging Souls",
    "shortName": "Raging Souls",
    "description": "Sharply lowers user's SpAtk.",
    "longDescription": "Souls from astral plane strike the foe. This lowers Sp. Atk by 2 stages.",
    "types": [
      16
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 182,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 854,
    "moveConst": "MOVE_TWIN_BEAM",
    "name": "Twin Beam",
    "shortName": "Twin Beam",
    "description": "Hits twice.",
    "longDescription": "The user shoots two mystical beams from its eyes. Mega Launcher boost.",
    "types": [
      13
    ],
    "power": 45,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 855,
    "moveConst": "MOVE_REQUIEM",
    "name": "Requiem",
    "shortName": "Requiem",
    "description": "10% chance to curse.",
    "longDescription": "Sings a haunting melody. 10% chance to inflict curse. Sound-based.",
    "types": [
      16
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 358,
    "effectChance": 10,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 856,
    "moveConst": "MOVE_ARMOR_CANNON",
    "name": "Armor Cannon",
    "shortName": "Armor Cannon",
    "description": "Lowers user's Atk and Def.",
    "longDescription": "The user shoots its own armor. This lowers its defs. Mega Launcher boost.",
    "types": [
      2
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 34,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 857,
    "moveConst": "MOVE_BITTER_BLADE",
    "name": "Bitter Blade",
    "shortName": "Bitter Blade",
    "description": "Heals 50% damage done.",
    "longDescription": "The user forces its bitter feelings into a slashing attack and restores health.",
    "types": [
      2
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 858,
    "moveConst": "MOVE_SOIL_DRAIN",
    "name": "Soil Drain",
    "shortName": "Soil Drain",
    "description": "Heals 50% damage done.",
    "longDescription": "Foe's power is leeched into the ground. Heals 50% of damage done.",
    "types": [
      9
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 36,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 859,
    "moveConst": "MOVE_GIGATON_HAMMER",
    "name": "Gigaton Hammer",
    "shortName": "GigatonHammr",
    "description": "Super effective vs Steel. Can't be used twice in a row.",
    "longDescription": "Super effective vs Steel. Can't be used twice in a row. Hammer-based.",
    "types": [
      7
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 860,
    "moveConst": "MOVE_TRIPLE_DIVE",
    "name": "Triple Dive",
    "shortName": "Triple Dive",
    "description": "Hits 3 times.",
    "longDescription": "The user performs a perfectly timed triple dive, hitting the foe three times.",
    "types": [
      12
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 87,
    "effectChance": 0,
    "flags": [
      0,
      5
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 861,
    "moveConst": "MOVE_JET_PUNCH",
    "name": "Jet Punch",
    "shortName": "Jet Punch",
    "description": "+1 priority.",
    "longDescription": "An aquatic punch. Always goes first. Iron Fist boost.",
    "types": [
      12
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 862,
    "moveConst": "MOVE_RAGE_FIST",
    "name": "Rage Fist",
    "shortName": "Rage Fist",
    "description": "+20 base power per time damaged.",
    "longDescription": "+20 base power per time damaged. Max. +120 power. Iron fist boost.",
    "types": [
      16
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 378,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 863,
    "moveConst": "MOVE_WICKED_TORQUE",
    "name": "Wicked Torque",
    "shortName": "WickedTorque",
    "description": "10% chance to sleep.",
    "longDescription": "10% chance to put the foe to sleep with a wicked twist.",
    "types": [
      11
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 279,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 864,
    "moveConst": "MOVE_BLAZING_TORQUE",
    "name": "Blazing Torque",
    "shortName": "BlazngTorque",
    "description": "30% chance to burn.",
    "longDescription": "30% chance to burn the foe with fiery force.",
    "types": [
      2
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 865,
    "moveConst": "MOVE_NOXIOUS_TORQUE",
    "name": "Noxious Torque",
    "shortName": "NxiousTorque",
    "description": "30% chance to poison.",
    "longDescription": "30% chance to poison the foe with toxic spins.",
    "types": [
      10
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 21,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 866,
    "moveConst": "MOVE_MAGICAL_TORQUE",
    "name": "Magical Torque",
    "shortName": "MgicalTorque",
    "description": "30% chance to confuse.",
    "longDescription": "30% chance to confuse the foe with mystical spins.",
    "types": [
      17
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 47,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 867,
    "moveConst": "MOVE_COMBAT_TORQUE",
    "name": "Combat Torque",
    "shortName": "CombatTorque",
    "description": "30% chance to paralyze",
    "longDescription": "30% chance to paralyze the foe with a fierce slam.",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 868,
    "moveConst": "MOVE_KOWTOW_CLEAVE",
    "name": "Kowtow Cleave",
    "shortName": "KowtowCleave",
    "description": "Can't miss. High-crit.",
    "longDescription": "Slashes the target. Can't miss. High-crit. Keen Edge boost.",
    "types": [
      11
    ],
    "power": 85,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 869,
    "moveConst": "MOVE_FLOWER_TRICK",
    "name": "Flower Trick",
    "shortName": "Flower Trick",
    "description": "Can't miss. Always crits.",
    "longDescription": "The user throws a bouquet at the foe. This move always hits and lands a crit hit.",
    "types": [
      8
    ],
    "power": 70,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 378,
    "effectChance": 0,
    "flags": [
      4
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 870,
    "moveConst": "MOVE_AQUA_STEP",
    "name": "Aqua Step",
    "shortName": "Aqua Step",
    "description": "Deals damage. Raises speed.",
    "longDescription": "The user attacks the foe with light and fluid dance steps. Raises user's Speed.",
    "types": [
      12
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 252,
    "effectChance": 100,
    "flags": [
      0,
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 871,
    "moveConst": "MOVE_TORCH_SONG",
    "name": "Torch Song",
    "shortName": "Torch Song",
    "description": "Deals damage. Raises SpAtk.",
    "longDescription": "The user blows fire as if singing a song. Raises SpAtk by +1. Sound based.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 379,
    "effectChance": 100,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 872,
    "moveConst": "MOVE_GLAIVE_RUSH",
    "name": "Glaive Rush",
    "shortName": "Glaive Rush",
    "description": "Deals damage. User takes double damage for rest of turn.",
    "longDescription": "Charges at the foe. The foe's next move deals double damage. Keen edge boost.",
    "types": [
      15
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 873,
    "moveConst": "MOVE_SILK_TRAP",
    "name": "Silk Trap",
    "shortName": "Silk Trap",
    "description": "The user spins a silken trap protects and lowers target speed",
    "longDescription": "The user protects itself with a silken trap. Contact by the foe lowers its Speed.",
    "types": [
      5
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 874,
    "moveConst": "MOVE_LAST_RESPECTS",
    "name": "Last Respects",
    "shortName": "LastRespect",
    "description": "An avenging attack empowered by lost allies.",
    "longDescription": "The user attacks to avenge its allies. More fainted allies, greater the power.",
    "types": [
      16
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 378,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 875,
    "moveConst": "MOVE_LUMINA_CRASH",
    "name": "Lumina Crash",
    "shortName": "Lumina Crash",
    "description": "Lowers SpDef with a peculiar light.",
    "longDescription": "The user unleashes a peculiar light which harshly lowers the foe's Sp. Def.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 238,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 876,
    "moveConst": "MOVE_ORDER_UP",
    "name": "Order Up",
    "shortName": "Order Up",
    "description": "The user attacks with elegant poise Boosts stat with Tatsugiri.",
    "longDescription": "The user attacks with poise. Gets a stat boost based on the Tatsugiri's form.",
    "types": [
      15
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 877,
    "moveConst": "MOVE_SPICY_EXTRACT",
    "name": "Spicy Extract",
    "shortName": "SpicExtract",
    "description": "A spicy extract sharply raises Atk and lowers Def.",
    "longDescription": "The user's spices sharply raises the foe's Atk & harshly lowers its Def.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 380,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 878,
    "moveConst": "MOVE_SPIN_OUT",
    "name": "Spin Out",
    "shortName": "Spin Out",
    "description": "The user spins furiously by straining its legs. Lowers speed",
    "longDescription": "The user furiously spins to attack the foe. Harshly lowers the user's Speed.",
    "types": [
      7
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 879,
    "moveConst": "MOVE_SALT_CURE",
    "name": "Salt Cure",
    "shortName": "Salt Cure",
    "description": "The user salt cures the target, inflicting damage every turn.",
    "longDescription": "The user salt cures the foe. Water and Steel take more damage every turn.",
    "types": [
      14
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 880,
    "moveConst": "MOVE_DOODLE",
    "name": "Doodle",
    "shortName": "Doodle",
    "description": "Copies the foe's ability to the user and its ally.",
    "longDescription": "The user sketches the foe and changes its and its allies ability to match it.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 381,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 881,
    "moveConst": "MOVE_FILLET_AWAY",
    "name": "Fillet Away",
    "shortName": "Fillet Away",
    "description": "The user sharply boosts stats using its own HP.",
    "longDescription": "The user sharply boosts its Atk, Sp. Atk, and Speed by using its HP.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 382,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 882,
    "moveConst": "MOVE_RAGING_BULL",
    "name": "Raging Bull",
    "shortName": "Raging Bull",
    "description": "Smashes barriers like a raging bull.",
    "longDescription": "This move's type depends on the user form. Also breaks the foe's barriers.",
    "types": [
      0
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 165,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 883,
    "moveConst": "MOVE_MAKE_IT_RAIN",
    "name": "Make It Rain",
    "shortName": "Make It Rain",
    "description": "The user attacks by throwing out a mass of coins Lower's user SPA",
    "longDescription": "The user attacks by throwing coins. This lowers its SpAtk Money is earned.",
    "types": [
      7
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 884,
    "moveConst": "MOVE_PSYBLADE",
    "name": "Psyblade",
    "shortName": "Psyblade",
    "description": "The user rends the target with an ethereal blade.",
    "longDescription": "The user rends the target with ethereal blades. Boosted in Electric Terrain.",
    "types": [
      13
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 378,
    "effectChance": 0,
    "flags": [
      0,
      1,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 885,
    "moveConst": "MOVE_RUINATION",
    "name": "Ruination",
    "shortName": "Ruination",
    "description": "The user summons a ruinous disaster that cuts HP in half.",
    "longDescription": "The user summons a ruinous disaster. This cuts the foe's HP in half.",
    "types": [
      11
    ],
    "power": 1,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 328,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 886,
    "moveConst": "MOVE_COLLISION_COURSE",
    "name": "Collision Course",
    "shortName": "Col.Course",
    "description": "Causes an ancient explosion. Deals more damage on weakness.",
    "longDescription": "The user transforms and crashes to the ground. Deals 33% more damage on super effective.",
    "types": [
      1
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 378,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 887,
    "moveConst": "MOVE_ELECTRO_DRIFT",
    "name": "Electro Drift",
    "shortName": "EletroDrift",
    "description": "Attacks with future power. Deals more damage on weakness.",
    "longDescription": "The user races forward at ultrafast speeds. Deals 33% more damage on super effective.",
    "types": [
      4
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 378,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 888,
    "moveConst": "MOVE_POUNCE",
    "name": "Pounce",
    "shortName": "Pounce",
    "description": "The user pounces on the target, lowering their Speed.",
    "longDescription": "The user attacks by pouncing on the foe. This lowers the foe's Speed.",
    "types": [
      5
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 889,
    "moveConst": "MOVE_TRAILBLAZE",
    "name": "Trailblaze",
    "shortName": "Trailblaze",
    "description": "Deals damage and boosts the user's Speed stat.",
    "longDescription": "The user attacks suddenly as leaping from tall grass. Raises user's Speed.",
    "types": [
      8
    ],
    "power": 50,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 252,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 890,
    "moveConst": "MOVE_HYPER_DRILL",
    "name": "Hyper Drill",
    "shortName": "Hyper Drill",
    "description": "Spins and pierces the target Hits through protect.",
    "longDescription": "The user spins the pointed part of its body to attack. Can hit through protect.",
    "types": [
      0
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      9,
      10
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 891,
    "moveConst": "MOVE_DOUBLE_SHOCK",
    "name": "Double Shock",
    "shortName": "Double Shock",
    "description": "Unleashes two strong shocks, then loses the Electric-type.",
    "longDescription": "Unleashes two strong shocks, then loses the Electric-type.",
    "types": [
      4
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 319,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 892,
    "moveConst": "MOVE_COMEUPPANCE",
    "name": "Comeuppance",
    "shortName": "Comeuppance",
    "description": "Retaliates against an attacker with great force.",
    "longDescription": "The user hits with much greater force against the foe that last hurt it.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": -5,
    "split": 0,
    "target": 5,
    "effect": 203,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 893,
    "moveConst": "MOVE_BLOOD_MOON",
    "name": "Blood Moon",
    "shortName": "Blood Moon",
    "description": "The user unleashes the spirit from a full red moon.",
    "longDescription": "The user's spirit surges from a crimson full moon. Can't be used twice in a row.",
    "types": [
      0
    ],
    "power": 140,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      16
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 894,
    "moveConst": "MOVE_AXE_KICK",
    "name": "Axe Kick",
    "shortName": "Axe Kick",
    "description": "An all-in, reckless kick that might confuse the foe.",
    "longDescription": "Slams its heel. 30% confusion chance. Hurts on miss. Striker boost.",
    "types": [
      11
    ],
    "power": 120,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 15,
    "effectChance": 30,
    "flags": [
      0,
      8,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 895,
    "moveConst": "MOVE_BARB_BARRAGE",
    "name": "Barb Barrage",
    "shortName": "Barb Barrage",
    "description": "The user launches countless toxic barbs 30% chance to poison",
    "longDescription": "Barbs are shot at the foe. 30% chance to poison. 50% boost if target is statused.",
    "types": [
      10
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 365,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 896,
    "moveConst": "MOVE_SMASHIN_REALITIES",
    "name": "Smashin' Realities",
    "shortName": "SmashReality",
    "description": "smashes the realities around it. Removes weather and terrain",
    "longDescription": "Removes weather and terrain. -3 priority. Hammer based.",
    "types": [
      11
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 5,
    "priority": -3,
    "split": 0,
    "target": 0,
    "effect": 383,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 897,
    "moveConst": "MOVE_CREEPING_THORNS",
    "name": "Creeping Thorns",
    "shortName": "CreepngThrns",
    "description": "Thorns surround the foe. Hurts foes on switch in.",
    "longDescription": "Thorn-covered vines surround the foe. This hurts foes on switch in.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 7,
    "effect": 234,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 898,
    "moveConst": "MOVE_MATCHA_GOTCHA",
    "name": "Matcha Gotcha",
    "shortName": "MatchaGotcha",
    "description": "Fires a blast of tea. May burn and heals 50% dmg dealt.",
    "longDescription": "Fires a tea blast. Absorbs half the damage inflicted. 20% burn chance.",
    "types": [
      8
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 384,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 899,
    "moveConst": "MOVE_SYRUP_BOMB",
    "name": "Syrup Bomb",
    "shortName": "Syrup Bomb",
    "description": "An explosion of sugary syrup slows the foe over 3 turns.",
    "longDescription": "Causes an explosion with syrup, slowing the target's Speed each turn for 3 turns.",
    "types": [
      8
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 900,
    "moveConst": "MOVE_IVY_CUDGEL",
    "name": "Ivy Cudgel",
    "shortName": "Ivy Cudgel",
    "description": "Strikes the foe with an ivy-wrapped cudgel.",
    "longDescription": "Type changes depending on the mask. High crit. Hammer-based.",
    "types": [
      8
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 249,
    "effectChance": 0,
    "flags": [
      1,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 901,
    "moveConst": "MOVE_ELECTRO_SHOT",
    "name": "Electro Shot",
    "shortName": "Electro Shot",
    "description": "gathers electricity for a high-voltage shot. +1 SPA",
    "longDescription": "Charging 1st turn: boosts SpAtk. Fires on second turn. In rain: fires immediately.",
    "types": [
      4
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 385,
    "effectChance": 100,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 902,
    "moveConst": "MOVE_FICKLE_BEAM",
    "name": "Fickle Beam",
    "shortName": "Fickle Beam",
    "description": "Shoots a strange beam of light that might deal double damage.",
    "longDescription": "Shoots a beam of light to inflict damage. 30% chance to deal double damage.",
    "types": [
      15
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 378,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 903,
    "moveConst": "MOVE_BURNING_BULWARK",
    "name": "Burning Bulwark",
    "shortName": "BurnBulwark",
    "description": "The user's intensely hot fur protects from attacks.",
    "longDescription": "The user's hot fur shields from attacks and burns any direct attacker.",
    "types": [
      2
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 904,
    "moveConst": "MOVE_THUNDERCLAP",
    "name": "Thunderclap",
    "shortName": "Thunderclap",
    "description": "Preempts the foe's attack with a flash of lightning.",
    "longDescription": "User strikes first with +1 priority. Fails if target's not readying an attack.",
    "types": [
      4
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 5,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 222,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 905,
    "moveConst": "MOVE_TACHYON_CUTTER",
    "name": "Tachyon Cutter",
    "shortName": "TachyonCut.",
    "description": "Launches particle blades at the target twice in a row.",
    "longDescription": "Launches particle blades twice. Never misses. uses higher offense.",
    "types": [
      7
    ],
    "power": 50,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 906,
    "moveConst": "MOVE_HARD_PRESS",
    "name": "Hard Press",
    "shortName": "Hard Press",
    "description": "Crushes quicker foes, nullifying their ability.",
    "longDescription": "This attack will also negate the foe's Ability if it has moved already.",
    "types": [
      7
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 211,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 907,
    "moveConst": "MOVE_DRAGON_CHEER",
    "name": "Dragon Cheer",
    "shortName": "Dragon Cheer",
    "description": "Raises crit by one stage for all allies. +2 if DRAGON",
    "longDescription": "Raises crit by +1 for all allies. +2 crit for Dragons.",
    "types": [
      15
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 386,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 908,
    "moveConst": "MOVE_ALLURING_VOICE",
    "name": "Alluring Voice",
    "shortName": "Allur.Voice",
    "description": "Attacks the target using its angelic voice. May confuse.",
    "longDescription": "Attacks with an angelic voice. Causes confusion if target's stats were boosted.",
    "types": [
      17
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 353,
    "effectChance": 100,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 909,
    "moveConst": "MOVE_MIGHTY_CLEAVE",
    "name": "Mighty Cleave",
    "shortName": "MightyCleave",
    "description": "Wields a light blade. Hits through protect.",
    "longDescription": "The user wields light atop its head to cleave the target. Hits through Protect.",
    "types": [
      14
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 910,
    "moveConst": "MOVE_TEMPER_FLARE",
    "name": "Temper Flare",
    "shortName": "Temper Flare",
    "description": "Attacks desperately, Doubles dmg if it missed the previous turn",
    "longDescription": "Spurred by desperation, user attacks. Power doubles if previous move failed.",
    "types": [
      2
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 117,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 911,
    "moveConst": "MOVE_SUPERCELL_SLAM",
    "name": "Supercell Slam",
    "shortName": "SupercelSlam",
    "description": "Tackles with its shock body. Hurts on miss.",
    "longDescription": "The user takes 50% HP in recoil on miss. Hammer-based.",
    "types": [
      4
    ],
    "power": 100,
    "accuracy": 95,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 15,
    "effectChance": 0,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 912,
    "moveConst": "MOVE_PSYCHIC_NOISE",
    "name": "Psychic Noise",
    "shortName": "PsychicNoise",
    "description": "Attacks with sound waves. Target can't heal.",
    "longDescription": "The user attacks with unpleasant sound waves. Blocks healing for 2 turns.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 913,
    "moveConst": "MOVE_UPPER_HAND",
    "name": "Upper Hand",
    "shortName": "Upper Hand",
    "description": "Deals damage and flinches if the target uses a prio. move.",
    "longDescription": "Flinches the target. +3 priority. Fails if the target doesn't use a priority move.",
    "types": [
      1
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 15,
    "priority": 3,
    "split": 0,
    "target": 0,
    "effect": 387,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 914,
    "moveConst": "MOVE_MALIGNANT_CHAIN",
    "name": "Malignant Chain",
    "shortName": "Malig.Chain",
    "description": "The user pours toxins into the target. Badly poisons the target",
    "longDescription": "Attacks with a poison imbued chain. 50% toxic chance. uses higher offense.",
    "types": [
      10
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 273,
    "effectChance": 50,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 915,
    "moveConst": "MOVE_LUNAR_BLESSING",
    "name": "Lunar Blessing",
    "shortName": "LunarBlessng",
    "description": "Heals HP and status of itself and allies in battle.",
    "longDescription": "Heals 25% HP to all allied battlers and cures their status.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 348,
    "effectChance": 0,
    "flags": [
      16
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 916,
    "moveConst": "MOVE_CHLOROBLAST",
    "name": "Chloroblast",
    "shortName": "Chloroblast",
    "description": "Deal powerful damage. Take 50% max HP damage.",
    "longDescription": "The user attack the foe with its amassed chlorophyll. This does 50% in recoil.",
    "types": [
      8
    ],
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 349,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 917,
    "moveConst": "MOVE_PSYSHIELD_BASH",
    "name": "Psyshield Bash",
    "shortName": "PsyshieldBsh",
    "description": "Deals damage. Raises Defense by 1 stage.",
    "longDescription": "Deals damage. Raises Defense by 1 stage. Mighty horn.",
    "types": [
      13
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 112,
    "effectChance": 100,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 918,
    "moveConst": "MOVE_CEASELESS_EDGE",
    "name": "Ceaseless Edge",
    "shortName": "CeaselessEdg",
    "description": "Deals damage. Applies spikes.",
    "longDescription": "The user slashes the foe with shell blade. Leaves Splinters. A high crit hit ratio.",
    "types": [
      11
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 388,
    "effectChance": 100,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 919,
    "moveConst": "MOVE_VICTORY_DANCE",
    "name": "Victory Dance",
    "shortName": "VictoryDance",
    "description": "Raises Attack, Defense, and Speed by 1 stage.",
    "longDescription": "An intense dance which boosts the user's Attack, Defense and Speed.",
    "types": [
      1
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 389,
    "effectChance": 0,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 920,
    "moveConst": "MOVE_BLEAKWIND_STORM",
    "name": "Bleakwind Storm",
    "shortName": "BleakwndStrm",
    "description": "Attacks with savage, roaring winds. Sets tailwind.",
    "longDescription": "Attacks with savage, roaring winds. Sets tailwind. Weather-based.",
    "types": [
      6
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 1,
    "effect": 390,
    "effectChance": 100,
    "flags": [
      13,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 921,
    "moveConst": "MOVE_WILDBOLT_STORM",
    "name": "Wildbolt Storm",
    "shortName": "WildboltStrm",
    "description": "Savagely attacks the foe with a thunderous tempest. Sets rain.",
    "longDescription": "Attacks the foe with a thunderous tempest. Sets rain. Weather-based.",
    "types": [
      4
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 1,
    "effect": 391,
    "effectChance": 100,
    "flags": [
      13,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 922,
    "moveConst": "MOVE_SANDSEAR_STORM",
    "name": "Sandsear Storm",
    "shortName": "SandsearStrm",
    "description": "Attacks with searing winds and hot sand. Sets sandstorm.",
    "longDescription": "Attacks with searing winds and sands. Sets sandstorm. Weather-based.",
    "types": [
      9
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 1,
    "effect": 392,
    "effectChance": 100,
    "flags": [
      13,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 923,
    "moveConst": "MOVE_SPRINGTIDE_STORM",
    "name": "Springtide Storm",
    "shortName": "SprngtidStrm",
    "description": "Attacks with winds of love and hate. Sets fairy terrain.",
    "longDescription": "Attacks with winds of love and hate. Sets fairy terrain. Weather-based.",
    "types": [
      17
    ],
    "power": 100,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 1,
    "effect": 393,
    "effectChance": 100,
    "flags": [
      13,
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 924,
    "moveConst": "MOVE_DIRE_CLAW",
    "name": "Dire Claw",
    "shortName": "Dire Claw",
    "description": "Slices the foe. Might paralyze, poison, or bleed.",
    "longDescription": "A slice that has a 50% chance to cause paralysis, poison, or bleed. Keen Edge boost.",
    "types": [
      10
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 273,
    "effectChance": 50,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 925,
    "moveConst": "MOVE_SHELTER",
    "name": "Shelter",
    "shortName": "Shelter",
    "description": "Sharply raises the Defense of the user and their partner.",
    "longDescription": "Sharply raises the Defense of the user and their partner.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 394,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 926,
    "moveConst": "MOVE_WILD_SWING",
    "name": "Wild Swing",
    "shortName": "Wild Swing",
    "description": "Takes a mighty swing that forces the foe to retreat.",
    "longDescription": "Forces the target to switch. -6 priority. Hammer-based.",
    "types": [
      0
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": -6,
    "split": 0,
    "target": 0,
    "effect": 9,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 927,
    "moveConst": "MOVE_FEMUR_BREAKER",
    "name": "Femur Breaker",
    "shortName": "FemurBreaker",
    "description": "The foe is struck fearsomely on the legs. Paralyzes the target.",
    "longDescription": "The user strikes the foe's legs. Always paralyzes. Hammer-based.",
    "types": [
      4
    ],
    "power": 120,
    "accuracy": 70,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 100,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 928,
    "moveConst": "MOVE_SQUEAKY_HAMMER",
    "name": "Squeaky Hammer",
    "shortName": "SqeakyHammer",
    "description": "The user hits the opponent with an cute sounding attack.",
    "longDescription": "An oddly sounding attack that may infatuate the foe. Hammer-based.",
    "types": [
      17
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 359,
    "effectChance": 20,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 929,
    "moveConst": "MOVE_PRIMITIVE_STRIKE",
    "name": "Primitive Strike",
    "shortName": "PrmitveStrke",
    "description": "A slow but mighty strike from the ancient past.",
    "longDescription": "The foe is struck with ancient attacks. -2 priority. Hammer-based.",
    "types": [
      9
    ],
    "power": 120,
    "accuracy": 95,
    "pp": 5,
    "priority": -2,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 930,
    "moveConst": "MOVE_SMASHING_PUMPKINS",
    "name": "Smashing Pumpkins",
    "shortName": "SmshngPmpkns",
    "description": "Smashes the foe with a seed-filled pumpkin.",
    "longDescription": "Deals damage and sets grassy terrain. Hammer-based.",
    "types": [
      8
    ],
    "power": 60,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 395,
    "effectChance": 100,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 931,
    "moveConst": "MOVE_AIRBORNE_SLAM",
    "name": "Airborne Slam",
    "shortName": "AirborneSlam",
    "description": "Slams the user, always aiming for the head. 20% chance to confuse.",
    "longDescription": "20% chance to confuse. Hammer-based.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 0,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 396,
    "effectChance": 0,
    "flags": [
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 932,
    "moveConst": "MOVE_SPINE_BREAKER",
    "name": "Spine Breaker",
    "shortName": "SpineBreaker",
    "description": "The foe is struck fearsomely on the back. 30% chance to paralyze.",
    "longDescription": "Strikes the foe fearsomely on the back. 30% chance to paralyze.",
    "types": [
      14
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 30,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 933,
    "moveConst": "MOVE_CRACKLE_SLAM",
    "name": "Crackle Slam",
    "shortName": "Crackle Slam",
    "description": "Strikes with a conductive hammer. Super-effective vs Steel.",
    "longDescription": "Slams foes with lots of electricity. Super-effective against Steel. Hammer-based.",
    "types": [
      4
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 934,
    "moveConst": "MOVE_SQUALL_HAMMER",
    "name": "Squall Hammer",
    "shortName": "SquallHammer",
    "description": "Hammers the foe with winds that might remove hazards.",
    "longDescription": "50% chance to clear hazards. -1 priority. Hammer-based.",
    "types": [
      6
    ],
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "priority": -1,
    "split": 0,
    "target": 0,
    "effect": 231,
    "effectChance": 50,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 935,
    "moveConst": "MOVE_MEGATON_HAMMER",
    "name": "Megaton Hammer",
    "shortName": "MegatonHammr",
    "description": "A devistating blow delivered with a heavy weapon.",
    "longDescription": "A massive strike with a hammer of immense power. Ignores Protect.",
    "types": [
      1
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 936,
    "moveConst": "MOVE_BATTERING_RAM",
    "name": "Battering Ram",
    "shortName": "BatteringRam",
    "description": "Charges its whole body forwards with the force of a hammer.",
    "longDescription": "The user launches a heavy object. Breaks barriers. Hammer-based.",
    "types": [
      15
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 165,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 937,
    "moveConst": "MOVE_PITFALL",
    "name": "Pitfall",
    "shortName": "Pitfall",
    "description": "An overhead strike that attempts to bury the opponent.",
    "longDescription": "30% chance to trap and make attacks always hit the target. Hammer-based.",
    "types": [
      9
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 273,
    "effectChance": 30,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 938,
    "moveConst": "MOVE_VIRAL_STRIKE",
    "name": "Viral Strike",
    "shortName": "Viral Strike",
    "description": "Slams the foe and transfers the user's status.",
    "longDescription": "Transfers the user's status to the target, curing the user. Hammer-based.",
    "types": [
      10
    ],
    "power": 110,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 939,
    "moveConst": "MOVE_SHADOW_HAMMER",
    "name": "Shadow Hammer",
    "shortName": "ShadowHammer",
    "description": "The user forms a part of their body into a hammer and strikes.",
    "longDescription": "The user slams its ghostly body into the foe. 33% recoil damage.",
    "types": [
      16
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      0,
      8,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 940,
    "moveConst": "MOVE_BONK",
    "name": "Bonk",
    "shortName": "Bonk",
    "description": "Strikes the foe on the head, possibly causing drowsiness.",
    "longDescription": "50% chance to cause drowsiness. Hammer-based.",
    "types": [
      17
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 273,
    "effectChance": 50,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 941,
    "moveConst": "MOVE_MOLTEN_STRIKE",
    "name": "Molten Strike",
    "shortName": "MoltenStrike",
    "description": "Slams the foe like a molten hammer, but lowers Speed.",
    "longDescription": "Lowers the user's speed. Iron fist boost. Hammer-based.",
    "types": [
      2
    ],
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 100,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 942,
    "moveConst": "MOVE_MIRAGE_SLAM",
    "name": "Mirage Slam",
    "shortName": "Mirage Slam",
    "description": "A psychedelic slam that hits again in the Future.",
    "longDescription": "Predicts a 40bp Future Sight. Hammer-based.",
    "types": [
      13
    ],
    "power": 120,
    "accuracy": 85,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 943,
    "moveConst": "MOVE_EARTHSPLITTER",
    "name": "Earthsplitter",
    "shortName": "Earthspltter",
    "description": "A might slam that can lower defense.",
    "longDescription": "Can lower the defense of targets. Hammer-based.",
    "types": [
      7
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 50,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 944,
    "moveConst": "MOVE_BEETLE_BASH",
    "name": "Beetle Bash",
    "shortName": "Beetle Bash",
    "description": "Attacks with a beetle-like hammer. May confuse.",
    "longDescription": "Slams with a beetle-like hammer. 30% to confuse. Hammer-based.",
    "types": [
      5
    ],
    "power": 120,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 47,
    "effectChance": 30,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 945,
    "moveConst": "MOVE_PEBBLE_SHOWER",
    "name": "Pebble Shower",
    "shortName": "PebbleShower",
    "description": "20% chance to flinch. Hits both targets.",
    "longDescription": "A rain of pebbles hits both targets. 20% flinch chance.",
    "types": [
      14
    ],
    "power": 75,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 12,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 946,
    "moveConst": "MOVE_RAPID_RIVER",
    "name": "Rapid River",
    "shortName": "Rapid River",
    "description": "Hits twice. Mega Launcher boost.",
    "longDescription": "A surge of water that hits twice. 10% drench chance. Mega Launcher boost.",
    "types": [
      12
    ],
    "power": 45,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 28,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 947,
    "moveConst": "MOVE_TOXIC_NEEDLES",
    "name": "Toxic Needles",
    "shortName": "ToxicNeedles",
    "description": "Hits 2-5 times. 10% chance to poison.",
    "longDescription": "Toxic pins are shot at the foe and hit 2 - 5 times. 10% poison chance.",
    "types": [
      10
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 948,
    "moveConst": "MOVE_SMOLDER_BASH",
    "name": "Smolder Bash",
    "shortName": "Smolder Bash",
    "description": "A scorching jab that has a 10% chance to burn.",
    "longDescription": "Bashes the foe with a fiery horn. 10% chance to burn. Horn-based.",
    "types": [
      2
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 3,
    "effectChance": 10,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 949,
    "moveConst": "MOVE_BEATDOWN",
    "name": "Beatdown",
    "shortName": "Beatdown",
    "description": "Hits 2-5 times with an attack flurry.",
    "longDescription": "Attacks the foe with a flurry of blows. hits 2-5 times.",
    "types": [
      11
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 950,
    "moveConst": "MOVE_EERIE_FOG",
    "name": "Eerie Fog",
    "shortName": "Eerie Fog",
    "description": "An unnatural fog descends, draining stat boosts.",
    "longDescription": "An eerie fog lasting eight turns drains boosts from non-Ghost and Psychic mons.",
    "types": [
      16
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 397,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 951,
    "moveConst": "MOVE_MYSTIC_DANCE",
    "name": "Mystic Dance",
    "shortName": "Mystic Dance",
    "description": "Not implemented.",
    "longDescription": "A mystic, powerful dance that boosts the user's SpAtk and Speed stats.",
    "types": [
      15
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 398,
    "effectChance": 0,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 952,
    "moveConst": "MOVE_RELENTLESS_CLOBBER",
    "name": "Relentless Clobber",
    "shortName": "RelentlessC",
    "description": "Hits 2-5 times with an attack flurry.",
    "longDescription": "Pummels the target repeatedly. Hammer based.",
    "types": [
      11
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 953,
    "moveConst": "MOVE_POP_MAYHEM",
    "name": "Popping Mayhem",
    "shortName": "PoppingMayh",
    "description": "Hits 2-5 times and can burn.",
    "longDescription": "Pelts the target with hot kernels.10% burn chance.",
    "types": [
      2
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 10,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 954,
    "moveConst": "MOVE_KILOBITE",
    "name": "Kilobite",
    "shortName": "Kilobite",
    "description": "Rushes forward and bites the foe's weak spot.",
    "longDescription": "Rushes forward and bites the foe. -1 Speed to foe or +1 Speed to user.",
    "types": [
      7
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 399,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 955,
    "moveConst": "MOVE_TANGLING_HUSK",
    "name": "Tangling Husk",
    "shortName": "TanglingHusk",
    "description": "Slows attackers while avoiding damage from non-Fire moves.",
    "longDescription": "Protects against non-Fire-type moves. Slows attackers on contact.",
    "types": [
      8
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 956,
    "moveConst": "MOVE_RIP_AND_TEAR",
    "name": "Rip and Tear",
    "shortName": "Rip and Tear",
    "description": "The user tears into the foe with its fangs.",
    "longDescription": "Lowers Speed. 50% chance to bleed. Can't be used twice in a row.",
    "types": [
      11
    ],
    "power": 110,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 400,
    "effectChance": 50,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 957,
    "moveConst": "MOVE_BRAVADO",
    "name": "Bravado",
    "shortName": "Bravado",
    "description": "Doubles damage if burned, paralyzed, or poisoned.",
    "longDescription": "An attack that is boosted if user is burned, poisoned, or paralyzed.",
    "types": [
      0
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 148,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 958,
    "moveConst": "MOVE_TERROR_CHARGE",
    "name": "Terror Charge",
    "shortName": "TerrorCharge",
    "description": "A frightening headbutt that may bleed or fear.",
    "longDescription": "50% chance to bleed. 50% chance to fear. Double damage when switching in.",
    "types": [
      11
    ],
    "power": 65,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 50,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 959,
    "moveConst": "MOVE_TERROR_LOCKS",
    "name": "Terror Locks",
    "shortName": "Terror Locks",
    "description": "Cut the foe with long, black hair.",
    "longDescription": "30% chance to bleed. 50% more damage if the foe is bleeding. Keen Edge boost.",
    "types": [
      16
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 960,
    "moveConst": "MOVE_DREAM_INVERSION",
    "name": "Dream Invasion",
    "shortName": "DreamInversn",
    "description": "Strikes through dreams, hitting sleeping foes hard.",
    "longDescription": "Deals 2x damage to sleeping foes. 10% chance for drowsy. Hits both foes.",
    "types": [
      0
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 273,
    "effectChance": 10,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 961,
    "moveConst": "MOVE_TERA_STARSTORM",
    "name": "Tera Starstorm",
    "shortName": "TeraStarstrm",
    "description": "Strikes both foes with a rain of crystals.",
    "longDescription": "Strikes both foes with a rain of crystals. Uses higher offense.",
    "types": [
      0
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 962,
    "moveConst": "MOVE_SPARKLING_BARRAGE",
    "name": "Sparkling Barrage",
    "shortName": "SprklngBrrge",
    "description": "Hits 3 Times with light rays.",
    "longDescription": "The user shoots 3 beams of light at the target.",
    "types": [
      13
    ],
    "power": 30,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 963,
    "moveConst": "MOVE_SPECTRAL_SERENADE",
    "name": "Spectral Serenade",
    "shortName": "SpctrlSrnade",
    "description": "Not Implemented.",
    "longDescription": "The foe is hit with a huge explosion. Can only be used every-other turn.",
    "types": [
      16
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 964,
    "moveConst": "MOVE_MERCULIGHT",
    "name": "Merculight",
    "shortName": "Merculight",
    "description": "Evades attacks and paralyzes the attacker.",
    "longDescription": "Evades attacks with certainty, paralyzing attackers. May fail if used in succession.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 4,
    "split": 2,
    "target": 2,
    "effect": 90,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 965,
    "moveConst": "MOVE_BIG_BLAST",
    "name": "Big Bang",
    "shortName": "Big Bang",
    "description": "Does Damage. Small burn chance.",
    "longDescription": "The foe is hit with a huge explosion. 20% burn chance.",
    "types": [
      0
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 3,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 966,
    "moveConst": "MOVE_SPECTRAL_FLAME",
    "name": "Spectral Flame",
    "shortName": "SpecterFlame",
    "description": "Emits a flame that moves as if alive and inflicts burn.",
    "longDescription": "Burns the target, including Fire types. Suppresses abilities in fog.",
    "types": [
      16
    ],
    "power": 0,
    "accuracy": 85,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 401,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 967,
    "moveConst": "MOVE_TREPIDATION",
    "name": "Trepidation",
    "shortName": "Trepidation",
    "description": "The foe falls into despair and misses all Psychic moves.",
    "longDescription": "The foe falls into despair. All Psychic-type moves they use miss for 3 turns.",
    "types": [
      10
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 402,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 968,
    "moveConst": "MOVE_ASTRAL_HAND",
    "name": "Astral Hand",
    "shortName": "Astral Hand",
    "description": "Projects a fist to strike the foe.",
    "longDescription": "Strikes the foe with a projected fist. Ignores stat boosts. Iron Fist boost.",
    "types": [
      13
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 969,
    "moveConst": "MOVE_FETCH",
    "name": "Fetch",
    "shortName": "Fetch",
    "description": "The user runs off the field in search of its lost item.",
    "longDescription": "The user retrieves its lost item and switches to an ally.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 403,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 970,
    "moveConst": "MOVE_TRANSMUTE",
    "name": "Transmute",
    "shortName": "Transmute",
    "description": "Strikes the foe, remaking the user's item on KO.",
    "longDescription": "Recovers a used item if this attack knocks out the opponent.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 378,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 971,
    "moveConst": "MOVE_CLEAR_SKIES",
    "name": "Clear Skies",
    "shortName": "Clear Skies",
    "description": "Clears the weather and prevents new weather.",
    "longDescription": "Clears the current weather and prevents new weather from being set for 5 turns.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 15,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 404,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 972,
    "moveConst": "MOVE_READY_OR_NOT",
    "name": "Ready or Not",
    "shortName": "Ready or Not",
    "description": "Hides on the first turn and then surprises the foe.",
    "longDescription": "Hides on the first turn scares the foe on the second. 30% flinch chance.",
    "types": [
      0
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 973,
    "moveConst": "MOVE_GIANT_GALE",
    "name": "Giant Gale",
    "shortName": "Giant Gale",
    "description": "Strikes the foe with a mighty gale, but lowers Speed.",
    "longDescription": "Strikes with a mighty gale, but the user's Speed is lowered. Air based.",
    "types": [
      6
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 974,
    "moveConst": "MOVE_VEXING_VOID",
    "name": "Vexing Void",
    "shortName": "Vexing Void",
    "description": "A terrifying void engulfs the foe.",
    "longDescription": "30% chance to lower Special Defense. Never misses in fog.",
    "types": [
      11
    ],
    "power": 110,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 48,
    "effectChance": 30,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 975,
    "moveConst": "MOVE_ECLIPSE",
    "name": "Eclipse",
    "shortName": "Eclipse",
    "description": "The darkness within erupts from the user for heavy damage.",
    "longDescription": "Deals heavy damage. Afterwards the user loses its Dark typing.",
    "types": [
      11
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 319,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 976,
    "moveConst": "MOVE_TAKE_FLIGHT",
    "name": "Take Flight",
    "shortName": "Take Flight",
    "description": "Blasts the foe with wind and takes to the sky.",
    "longDescription": "Deals damage and then switches out. Air based.",
    "types": [
      6
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 204,
    "effectChance": 0,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 977,
    "moveConst": "MOVE_CALTROPS",
    "name": "Caltrops",
    "shortName": "Caltrops",
    "description": "Spreads dangerous spikes that inflict bleeding.",
    "longDescription": "Spreads spikes that inflict bleeding on the next opponent to switch in.",
    "types": [
      7
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 7,
    "effect": 405,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 978,
    "moveConst": "MOVE_TAKE_HEART",
    "name": "Take Heart",
    "shortName": "Take Heart",
    "description": "Steadies itself, healing its status and boosting Special.",
    "longDescription": "Heals status and raises SpAtk and SpDef by 1 stage.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 406,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 979,
    "moveConst": "MOVE_SAFE_PASSAGE",
    "name": "Safe Passage",
    "shortName": "Safe Passage",
    "description": "Guides an ally onto the field, shielding them from harm.",
    "longDescription": "Guides an ally onto the field. They take -35% damage this turn.",
    "types": [
      0
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 51,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 980,
    "moveConst": "MOVE_ESPER_WALTZ",
    "name": "Esper Waltz",
    "shortName": "Esper Waltz",
    "description": "A mesmerizing waltz that may raise Special Attack.",
    "longDescription": "50% chance to raise Special Attack. Dance move.",
    "types": [
      13
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 236,
    "effectChance": 50,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 981,
    "moveConst": "MOVE_ZAP_JIVE",
    "name": "Zap Jive",
    "shortName": "Zap Jive",
    "description": "An electrifying dance that may raise Speed.",
    "longDescription": "50% chance to raise Speed. Dance move.",
    "types": [
      4
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 252,
    "effectChance": 50,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 982,
    "moveConst": "MOVE_HEX_TROT",
    "name": "Hex Trot",
    "shortName": "Hex Trot",
    "description": "A lively yet haunting dance that may raise Speed.",
    "longDescription": "50% chance to raise Speed. Dance move.",
    "types": [
      16
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 252,
    "effectChance": 50,
    "flags": [
      3
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 983,
    "moveConst": "MOVE_MOUNTAIN_GALE",
    "name": "Mountain Gale",
    "shortName": "MountainGale",
    "description": "A bone chilling wind buffets foes. May flinch.",
    "longDescription": "Hits both opponents. 30% chance to flinch. Air based.",
    "types": [
      3
    ],
    "power": 100,
    "accuracy": 85,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 12,
    "effectChance": 30,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 984,
    "moveConst": "MOVE_BAD_EGG",
    "name": "Bad Egg",
    "shortName": "Bad Egg",
    "description": "Throws an egg filled with toxins. Poisons on hit.",
    "longDescription": "Throws an egg filled with toxins. Badly poisons the target",
    "types": [
      10
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 985,
    "moveConst": "MOVE_MYSTICAL_POWER",
    "name": "Mystical Power",
    "shortName": "MysticalPowr",
    "description": "Strikes with a strange power that empowers the user.",
    "longDescription": "Deals damage and raises the user's highest attack or defense by 1 stage.",
    "types": [
      13
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "vanilla"
  },
  {
    "id": 986,
    "moveConst": "MOVE_DRAGON_JAB",
    "name": "Dragon Jab",
    "shortName": "Dragon Jab",
    "description": "Jabs with a horn. can bleed on hit.",
    "longDescription": "A jabbing attack. 30%  chance to inflict bleeding. Mighty Horn boost.",
    "types": [
      15
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 30,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 987,
    "moveConst": "MOVE_ICICLE_IMPALE",
    "name": "Icicle Impale",
    "shortName": "IcicleImaple",
    "description": "Jabs with a horn. May lower defense.",
    "longDescription": "A jabbing attack. 30%  chance to lower Defense. Mighty Horn boost.",
    "types": [
      3
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 30,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 988,
    "moveConst": "MOVE_TOXIC_PLUNGE",
    "name": "Toxic Plunge",
    "shortName": "Toxic Plunge",
    "description": "Dives into a pool of poison then strikes on the next turn.",
    "longDescription": "Dives and then attacks on the next turn. 20% chance to poison.",
    "types": [
      10
    ],
    "power": 110,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 10,
    "effectChance": 20,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 989,
    "moveConst": "MOVE_SHOWTIME",
    "name": "Showtime",
    "shortName": "Showtime",
    "description": "Sets the stage with a Magic Room then bows out.",
    "longDescription": "Clears other rooms and sets Magic Room, then switches to an ally.",
    "types": [
      13
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 2,
    "effect": 407,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 990,
    "moveConst": "MOVE_BANISHED_POWER",
    "name": "Banished Power",
    "shortName": "BanishedPowr",
    "description": "Strikes with a forbidden power that empowers the user.",
    "longDescription": "Deals damage and raises the user's highest attack or defense by 1 stage.",
    "types": [
      11
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 3,
    "target": 0,
    "effect": 273,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 991,
    "moveConst": "MOVE_TRIPLE_TREMOR",
    "name": "Triple Tremor",
    "shortName": "TripleTremor",
    "description": "Strikes with three intensifying shockwaves.",
    "longDescription": "Hits three times. More powerful with each successive hit.",
    "types": [
      9
    ],
    "power": 20,
    "accuracy": 90,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 87,
    "effectChance": 0,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 992,
    "moveConst": "MOVE_FIRE_GLAIVE",
    "name": "Fire Glaive",
    "shortName": "Fire Glaive",
    "description": "The user strikes with a white hot horn.",
    "longDescription": "Strikes with a white hot horn, ignoring stat changes. Might Horn boost.",
    "types": [
      2
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      9
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 993,
    "moveConst": "MOVE_DEPLETION_BEAM",
    "name": "Depletion Beam",
    "shortName": "DepltionBeam",
    "description": "Attacks with metallic power. Foe's last move has 3 PP cut.",
    "longDescription": "Foe's last move has 3 PP cut. Mega launcher boost.",
    "types": [
      15
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 357,
    "effectChance": 0,
    "flags": [
      13
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 994,
    "moveConst": "MOVE_ONE_INCH_PUNCH",
    "name": "One-Inch Punch",
    "shortName": "OneInchPunch",
    "description": "Picks a weak spot and then strikes with immense force.",
    "longDescription": "A powerful punch that never misses. High crit rate. Iron Fist boost.",
    "types": [
      1
    ],
    "power": 90,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      1
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 995,
    "moveConst": "MOVE_BERSERKER_HORN",
    "name": "Berserker Horn",
    "shortName": "BerserkrHorn",
    "description": "Spins its body like a drill. High critical-hit ratio.",
    "longDescription": "Rotates its body like a drill. High crit ratio. Mighty Horn boost.",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 6,
    "effectChance": 10,
    "flags": [
      0,
      1,
      9,
      10
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 996,
    "moveConst": "MOVE_ONI_FIST",
    "name": "Oni Fist",
    "shortName": "Oni Fist",
    "description": "An unavoidable punch that is thrown from shadows.",
    "longDescription": "A strong punch from the shadows. Always hits. Iron Fist boost.",
    "types": [
      11
    ],
    "power": 90,
    "accuracy": 0,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 997,
    "moveConst": "MOVE_INSECT_IMPACT",
    "name": "Insect Impact",
    "shortName": "InsectImpact",
    "description": "A punch that may drop the target's defense stat.",
    "longDescription": "A powerful punch. 30% chance to drop defense. Iron Fist boost.",
    "types": [
      5
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 126,
    "effectChance": 30,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 998,
    "moveConst": "MOVE_LIGHTNING_BULLET",
    "name": "Lightning Bullet",
    "shortName": "LghtngBullet",
    "description": "Shoots a powerful energy projectile that may paralyze.",
    "longDescription": "Shoots a strong energy projectile. 10% paralyze chance Mega Launcher Boost.",
    "types": [
      4
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 5,
    "effectChance": 10,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 999,
    "moveConst": "MOVE_METALLIC_MELODY",
    "name": "Metallic Melody",
    "shortName": "MetalcMelody",
    "description": "Hits the body rhythmically to damage the opponent with sound.",
    "longDescription": "The user emits a sound by hitting their metallic body rhythmically.",
    "types": [
      7
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      11
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1000,
    "moveConst": "MOVE_BLUE_MOON",
    "name": "Blue Moon",
    "shortName": "Blue Moon",
    "description": "The user unleashes the spirit from a full blue moon.",
    "longDescription": "The user's spirit surges from a azure full moon. Cannot be used twice in a row.",
    "types": [
      3
    ],
    "power": 130,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      16
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1001,
    "moveConst": "MOVE_FIVE_STAR_FURY",
    "name": "Five-Star Fury",
    "shortName": "Star Fury",
    "description": "Repeatedly punches the foe 2 to 5 times. +1 priority.",
    "longDescription": "Hits 2 to 5 times. Has +1 priority. Iron Fist boost.",
    "types": [
      5
    ],
    "power": 15,
    "accuracy": 100,
    "pp": 10,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1002,
    "moveConst": "MOVE_TSUNAMI_HAMMER",
    "name": "Tsunami Hammer",
    "shortName": "WaveHammer",
    "description": "Super effective vs Water. Can't be used twice in a row.",
    "longDescription": "Super effective vs Poison. Can't be used twice in a row. Hammer-based.",
    "types": [
      12
    ],
    "power": 125,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      0,
      6
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1003,
    "moveConst": "MOVE_SEPTIC_SWITCH",
    "name": "Septic Switch",
    "shortName": "Sep Switch",
    "description": "Supress abilities then switch.",
    "longDescription": "Supresses the targets abilities then switches out.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 408,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1004,
    "moveConst": "MOVE_WATERLOG",
    "name": "Waterlog",
    "shortName": "Waterlog",
    "description": "Target moves last and may be drenched.",
    "longDescription": "Makes the target move last. 20% drench chance, 50% in rain.",
    "types": [
      12
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "priority": 3,
    "split": 2,
    "target": 0,
    "effect": 409,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1005,
    "moveConst": "MOVE_INCITE",
    "name": "Incite",
    "shortName": "Incite",
    "description": "Adds dark type and enrages foe.",
    "longDescription": "Adds the Dark type to the target and enrages them.",
    "types": [
      11
    ],
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 0,
    "effect": 288,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1007,
    "moveConst": "MOVE_JETSTREAM_BURST",
    "name": "Jetstream Burst",
    "shortName": "Jet Burst",
    "description": "Strikes by using flurries of wind.",
    "longDescription": "Attacks with wind that hits both targets.",
    "types": [
      6
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1008,
    "moveConst": "MOVE_SKY_QUAKE",
    "name": "Sky Quake",
    "shortName": "Sky Quake",
    "description": "Strikes with harsh winds.",
    "longDescription": "Howling winds shake the heavens, hitting both foes.",
    "types": [
      6
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 1,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1006,
    "moveConst": "MOVE_TOXIC_TERRAIN",
    "name": "Toxic Terrain",
    "shortName": "ToxicTerrain",
    "description": "Boosts Poison and damages mons for 8 turns.",
    "longDescription": "Boosts Poison-type moves for 8 turns and deals 1/16 HP damage.",
    "types": [
      10
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 10,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 410,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1009,
    "moveConst": "MOVE_SUNSTRIKE",
    "name": "Sunstrike (N)",
    "shortName": "Sunstrike",
    "description": "Strikes with harsh winds.",
    "longDescription": "Strikes and negates evs, items, boosts, and hits lowest defense.",
    "types": [
      2
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1010,
    "moveConst": "MOVE_TEMPEST_STORM",
    "name": "Tempest Storm (N)",
    "shortName": "TempStorm",
    "description": "Sets a thundershock storm.",
    "longDescription": "Hits both sides with a thundershock at the end of each turn for 2-5 turns.",
    "types": [
      4
    ],
    "power": 0,
    "accuracy": 0,
    "pp": 5,
    "priority": 0,
    "split": 2,
    "target": 6,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1011,
    "moveConst": "MOVE_PRISM_BLAST",
    "name": "Prism Blast",
    "shortName": "Prism Shot",
    "description": "Deals damage, lowers accuracy, and may confuse.",
    "longDescription": "Fires and energy prism that damages and reduces accuracy. 10% chance to confuse.",
    "types": [
      14
    ],
    "power": 95,
    "accuracy": 90,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 0,
    "effectChance": 10,
    "flags": [
      12
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1012,
    "moveConst": "MOVE_SEISMIC_SLAM",
    "name": "Seismic Slam",
    "shortName": "SeismicSlam",
    "description": "Deals damage. 33% recoil damage.",
    "longDescription": "Charges with earth shattering power. 33% recoil damage.",
    "types": [
      9
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      0,
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1013,
    "moveConst": "MOVE_CHILLER",
    "name": "Chiller",
    "shortName": "Chiller",
    "description": "Hits 3 times with snowballs.",
    "longDescription": "Hits the foe with 3 explosive snowballs. 10% Frostbite.",
    "types": [
      3
    ],
    "power": 30,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 4,
    "effectChance": 10,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1014,
    "moveConst": "MOVE_SPREAD_BOMB",
    "name": "Spread Bomb",
    "shortName": "WideBomb",
    "description": "Hits everyone else. 30% Burn chance.",
    "longDescription": "A wide reaching bomb is thrown, hitting the field with A 30% burn chance.",
    "types": [
      2
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 4,
    "effect": 3,
    "effectChance": 20,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1015,
    "moveConst": "MOVE_BALL_TOSS",
    "name": "Ball Toss",
    "shortName": "BallToss",
    "description": "A ball attack. 20% flinch.",
    "longDescription": "Throws a ball forward. 20% flinch chance",
    "types": [
      0
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 0,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1016,
    "moveConst": "MOVE_PARTY_FAVORS",
    "name": "Party Favors",
    "shortName": "PartyFavor",
    "description": "Damages the foe and heals allies.",
    "longDescription": "Heals you and your ally by 25% and does damage.",
    "types": [
      17
    ],
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 411,
    "effectChance": 0,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1017,
    "moveConst": "MOVE_SHOT_PUT",
    "name": "Shot Put",
    "shortName": "Shot Put",
    "description": "A ball attack. 30% speed drop.",
    "longDescription": "Throws a heavy sphere. 30% to lower speed.",
    "types": [
      7
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 17,
    "effectChance": 0,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1018,
    "moveConst": "MOVE_BLOCK_DROPPER",
    "name": "Block Dropper",
    "shortName": "Block Drop",
    "description": "A ball attack. 20% flinch.",
    "longDescription": "Drops 2 to 5 blocks onto the target.",
    "types": [
      9
    ],
    "power": 25,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 1,
    "effectChance": 0,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1019,
    "moveConst": "MOVE_SABER_SLASHES",
    "name": "Saber Slashes",
    "shortName": "Sabers",
    "description": "A ball attack. 20% flinch.",
    "longDescription": "Hits twice. Uses elec. or fire based on effectiveness.",
    "types": [
      2,
      4
    ],
    "power": 35,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 14,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1020,
    "moveConst": "MOVE_DRAGON_DASH",
    "name": "Dragon Dash",
    "shortName": "DragonDash",
    "description": "+1 priority attack.",
    "longDescription": "Lunges at the target quickly. +1 prio.",
    "types": [
      15
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 1,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1021,
    "moveConst": "MOVE_POCKET_SAND",
    "name": "Pocket Sand",
    "shortName": "PocketSand",
    "description": "+1 priority, 10% acc drop.",
    "longDescription": "The user throws sand on a dime. 10% acc. drop, +1 priority.",
    "types": [
      9
    ],
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 101,
    "effectChance": 0,
    "flags": [
      14
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1022,
    "moveConst": "MOVE_CONCOCTION",
    "name": "Concoction",
    "shortName": "Concoction",
    "description": "Damages and uses a berry.",
    "longDescription": "Attacks and uses a random berry effect.",
    "types": [
      8
    ],
    "power": 30,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 412,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1023,
    "moveConst": "MOVE_UNSCREW",
    "name": "Hacksaw",
    "shortName": "Hacksaw",
    "description": "Super effective vs Steel.",
    "longDescription": "Tampers with the target. Stronger vs Steel.",
    "types": [
      7
    ],
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1024,
    "moveConst": "MOVE_GODSPEED",
    "name": "Godspeed",
    "shortName": "Godspeed",
    "description": "Super effective vs Steel.",
    "longDescription": "Swoops with incredible speed. +2 prio.",
    "types": [
      6
    ],
    "power": 65,
    "accuracy": 0,
    "pp": 5,
    "priority": 2,
    "split": 0,
    "target": 0,
    "effect": 0,
    "effectChance": 0,
    "flags": [
      2
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1025,
    "moveConst": "MOVE_PSYCHO_WAVE",
    "name": "Psycho Wave",
    "shortName": "Psycho Wave",
    "description": "A life-risking energy with 50% recoil.",
    "longDescription": "A hazardous energy ball hits the foe. 50% recoil damage.",
    "types": [
      13
    ],
    "power": 150,
    "accuracy": 85,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 237,
    "effectChance": 0,
    "flags": [
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1026,
    "moveConst": "MOVE_ATOMIC_FIRE",
    "name": "Atomic Fire",
    "shortName": "Atomic Fire",
    "description": "A life-risking energy with 50% recoil.",
    "longDescription": "A hazardous energy ball hits the foe. 50% recoil damage.",
    "types": [
      2
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 19,
    "effectChance": 0,
    "flags": [
      8
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1027,
    "moveConst": "MOVE_RAIN_FLUSH",
    "name": "Rain Flush",
    "shortName": "RainFlush",
    "description": "A powerful rain attack. Lowers the user's defenses.",
    "longDescription": "An all consuming rain hits the foe. drops your defenses.",
    "types": [
      12
    ],
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 1,
    "target": 0,
    "effect": 34,
    "effectChance": 100,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1028,
    "moveConst": "MOVE_ICE_WALL",
    "name": "Ice Wall",
    "shortName": "Ice Wall",
    "description": "Sets reflect with ice.",
    "longDescription": "The user applies a stone cold barrier, setting reflect.",
    "types": [
      3
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 5,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 332,
    "effectChance": 0,
    "flags": [],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1029,
    "moveConst": "MOVE_OBSCURED_SHOT",
    "name": "Obscured Shot",
    "shortName": "SneakShot",
    "description": "Strikes first if the foe is preparing an attack.",
    "longDescription": "User strikes first. It fails if the foe is not attacking.",
    "types": [
      11
    ],
    "power": 70,
    "accuracy": 100,
    "pp": 5,
    "priority": 1,
    "split": 1,
    "target": 0,
    "effect": 222,
    "effectChance": 0,
    "flags": [
      0
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1030,
    "moveConst": "MOVE_BLITZ_ARROW",
    "name": "Blitz Arrow",
    "shortName": "BlitzArrow",
    "description": "20% flinch chance. arrow based.",
    "longDescription": "Shoots an arrow with fighter will. 20% flinch chance.",
    "types": [
      1
    ],
    "power": 85,
    "accuracy": 100,
    "pp": 10,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 12,
    "effectChance": 20,
    "flags": [
      17
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  },
  {
    "id": 1031,
    "moveConst": "MOVE_RUMBLE_KICK",
    "name": "Rumble Kick",
    "shortName": "RumbleKick",
    "description": "May down attack. Striker.",
    "longDescription": "A kick from a reinforced leg. 20% Atk drop. Striker.",
    "types": [
      14
    ],
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "priority": 0,
    "split": 0,
    "target": 0,
    "effect": 22,
    "effectChance": 30,
    "flags": [
      0,
      7
    ],
    "arg": "",
    "usesHpType": false,
    "archetype": "unknown"
  }
] as const;
