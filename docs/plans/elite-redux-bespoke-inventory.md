# Elite Redux — Bespoke Inventory (Phase C → D handoff)

> Auto-generated. Regenerate: `pnpm run er:audit-archetype-coverage`.
>
> Last regenerated: 2026-05-22T02:52:32.985Z.

This doc enumerates the ER abilities and moves the C2/C3 archetype classifier
could NOT slot into an archetype primitive. Each entry needs a hand-written
implementation in the Phase D wire-up layer.

The `Taxonomy Hint` column groups bespoke entries by the archetype they most
resemble — useful for batching related hand-writes in the Phase D pass. A hint
of `unclassified` means the description didn't match any keyword bucket; those
are typically multi-mechanic abilities that don't fit any one archetype.

## Summary

- Bespoke abilities: **258**
- Bespoke moves: **57**
- Total long-tail entries needing hand-write: **315**

### Bespoke abilities by taxonomy hint

| Hint | Count |
|---|---|
| `unclassified` | 159 |
| `chance-status-on-hit` | 33 |
| `entry-effect` | 9 |
| `weather-or-terrain-interaction` | 9 |
| `stat-trigger-on-event` | 8 |
| `damage-reduction-generic` | 6 |
| `status-immunity` | 6 |
| `accuracy-mod` | 5 |
| `crit-mod` | 5 |
| `lifesteal` | 4 |
| `priority-modifier` | 4 |
| `type-damage-boost-or-flag-damage-boost` | 4 |
| `form-change` | 2 |
| `move-replacement` | 2 |
| `multi-hit-override` | 1 |
| `passive-recovery` | 1 |

### Bespoke moves by taxonomy hint

| Hint | Count |
|---|---|
| `unclassified` | 49 |
| `priority-modifier` | 3 |
| `entry-effect` | 1 |
| `lifesteal` | 1 |
| `multi-hit-override` | 1 |
| `stat-trigger-on-event` | 1 |
| `weather-or-terrain-interaction` | 1 |

## Bespoke abilities (258)

| ER ID | Name | Description | Taxonomy Hint |
|---|---|---|---|
| 0 | ------- | Empty ability slot. | `unclassified` |
| 254 | WandrngSprit | Trades ability with attacker on contact. | `chance-status-on-hit` |
| 268 | Chloroplast | Weather Ball, Solar Beam/Blade, Growth act as if used in sun. | `weather-or-terrain-interaction` |
| 270 | Pyromancy | Moves inflict burn 5x as often. | `unclassified` |
| 273 | Power Fists | Iron Fist moves target Special Defense and get a 1.3x boost. | `unclassified` |
| 275 | Rampage | No recharge after a KO, if it usually would need to recharge. | `unclassified` |
| 278 | Antarctic Bird | Ice-type and Flying-type moves get a 1.3x power boost. | `type-damage-boost-or-flag-damage-boost` |
| 282 | Aerodynamics | Boosts Speed instead of being hit by Flying-type moves. | `unclassified` |
| 284 | Exploit Weakness | Targets lowest defense vs statused foes. | `unclassified` |
| 285 | Ground Shock | Target Grounds aren't immune to Electric but resist it instead. | `status-immunity` |
| 286 | Ancient Idol | Uses Def and Sp. Def instead of Atk and Sp. Atk when attacking. | `unclassified` |
| 287 | Mystic Power | All moves gain the 1.5x power boost from STAB. | `type-damage-boost-or-flag-damage-boost` |
| 289 | Growing Tooth | Raises Attack by one stage after using a biting move. | `unclassified` |
| 291 | Aurora Borealis | Ice-type moves gain STAB. Moves always benefit from hail. | `unclassified` |
| 292 | Avenger | If a party Pokémon fainted last turn, next move gets 1.5x boost. | `stat-trigger-on-event` |
| 297 | Amphibious | Water moves gain STAB. Can't become drenched. | `status-immunity` |
| 301 | Cryptic Power | Doubles own Sp. Atk stat. Boosts raw stat, not base stat. | `unclassified` |
| 304 | Magical Dust | Makes foe Psychic-type on contact. Also works on offense. | `chance-status-on-hit` |
| 321 | Juggernaut | Contact moves add 20% Def to attack. Paralysis-immune. | `chance-status-on-hit` |
| 323 | Majestic Bird | Boosts own Sp. Atk by 1.5x. Boosts raw stat, not base stat. | `unclassified` |
| 326 | Impenetrable | Only damaged by attacks. | `unclassified` |
| 332 | Soul Linker | Enemies take all the damage they deal, same for this Pokémon. | `unclassified` |
| 333 | Sweet Dreams | Heals 1/8 of max HP every turn if asleep. Immune to Bad Dreams. | `lifesteal` |
| 334 | Bad Luck | Foes can't crit, deal min damage, 5% less acc, & no effect chance. | `unclassified` |
| 335 | Haunted Spirit | When this Pokémon is KO'd, casts a Curse on the attacker. | `unclassified` |
| 340 | Fatal Precision | Super-effective moves never miss and always crit. | `accuracy-mod` |
| 341 | Fort Knox | Blocks most damage boosting and multihit abilities. | `multi-hit-override` |
| 342 | Seaweed | Takes 1/2 dmg from Fire if Grass. Grass deals x2 dmg to Fire. | `unclassified` |
| 347 | Multi-Headed | Hits as many times, as it has heads. | `unclassified` |
| 348 | North Wind | 3 turns Aurora Veil on entry. Immune to Hail damage. | `entry-effect` |
| 349 | Overcharge | Electric is super effective vs Electric. Can paralyze Electric. | `unclassified` |
| 352 | Sage Power | Ups Special Attack by 50% and locks move. | `unclassified` |
| 353 | Bone Zone | Bone moves ignore immunities and deal 2x on not very effective. | `unclassified` |
| 354 | Weather Control | Negates all weather based moves from enemies. | `weather-or-terrain-interaction` |
| 355 | Speed Force | Contact moves use 20% of its Speed stat additionally. | `chance-status-on-hit` |
| 357 | Molten Down | Fire-type is super effective against Rock-type. | `unclassified` |
| 360 | Field Explorer | Boosts field moves by 50%. Cut, Surf, Strength etc. | `unclassified` |
| 365 | Lunar Eclipse | Fairy & Dark gains STAB. Hypnosis has 1.5x accuracy. | `accuracy-mod` |
| 367 | Power Core | The Pokémon uses +20% of its Defense or SpDef during moves. | `unclassified` |
| 369 | Bad Company | Not implemented right now. Has no effect. | `unclassified` |
| 372 | Momentum | Contact moves use the Speed stat for damage calculation. | `chance-status-on-hit` |
| 373 | Grip Pincer | 50% chance to trap. Then ignores Defense & accuracy checks. | `accuracy-mod` |
| 375 | Precise Fist | Punching moves get +1 crit and 5x effect chance. | `unclassified` |
| 376 | Deadeye | Arrow & cannon moves never miss. Crits hit weakest defense. | `accuracy-mod` |
| 378 | Amplifier | Ups sound moves by 30% and makes them hit both foes. | `unclassified` |
| 388 | Thundercall | Triggers Smite at 20% power when using an Electric move. | `unclassified` |
| 391 | Hardened Sheath | Ups Attack by +1 when using horn moves. | `unclassified` |
| 394 | Lethargy | Damage drops 20% each turn to 20%. Resets on switch-in. | `entry-effect` |
| 396 | Steel Barrel | Immune to recoil damage, but not immune to Explosion/crash dmg. | `status-immunity` |
| 398 | Fungal Infection | Contact moves inflict Leech Seed on the target. | `chance-status-on-hit` |
| 400 | Scrapyard | Sets a layer of Spikes when hit (contact move). | `chance-status-on-hit` |
| 401 | Loose Quills | Sets a layer of Spikes when hit (contact move). | `chance-status-on-hit` |
| 405 | Loose Rocks | Deploys Stealth Rocks when hit by contact. | `chance-status-on-hit` |
| 406 | Spinning Top | Fighting moves up speed +1 and clear hazards. | `unclassified` |
| 407 | Retribution Blow | Uses Hyper Beam if any foe uses an stat boosting move. | `unclassified` |
| 411 | Toxic Spill | Non-Poison-types take 1/8 dmg every turn when on field. | `unclassified` |
| 412 | Desert Cloak | Protects its side from status and secondary effects in sand. | `unclassified` |
| 423 | Hydro Circuit | Electric moves +50%; Water moves siphon 25% damage. | `unclassified` |
| 424 | Equinox | Boosts Atk or SpAtk to match the higher value. | `unclassified` |
| 425 | Absorbant | Drain moves recover +50% HP & apply Leech Seed. | `unclassified` |
| 426 | Clueless | Negates Weather, Rooms and Terrains. | `weather-or-terrain-interaction` |
| 427 | Cheating Death | Gets no damage for the first two hits. | `unclassified` |
| 429 | Coward | Sets up Protect on switch-in. Only works once. | `entry-effect` |
| 431 | Dune Terror | Sand reduces damage by 35%. Boosts Ground moves by 20%. | `damage-reduction-generic` |
| 434 | Elemental Charge | 20% chance to BRN/FRZ/PARA with respective types. | `unclassified` |
| 435 | Ambush | Guaranteed critical hit on first turn. | `crit-mod` |
| 438 | Jaws of Carnage | Devours 1/2 of the foe when defeating it. | `unclassified` |
| 444 | Evaporate | Takes no damage and sets Mist if hit by water. | `unclassified` |
| 447 | Furnace | User gains +2 Speed when when hit by rocks. | `chance-status-on-hit` |
| 455 | Archmage | 30% chance of adding a type related effect to each move. | `unclassified` |
| 456 | Cryomancy | Moves inflict frostbite 5x as often. | `unclassified` |
| 457 | Phantom Pain | Ghost-type moves deal normal damage to Normal. | `unclassified` |
| 463 | Jungle's Guard | Protects Grass-type allies from status and stat drops. | `unclassified` |
| 464 | Hunter's Horn | Boost horn moves and heals 1/4 HP when defeating an enemy. | `lifesteal` |
| 466 | Plasma Lamp | Boost accuracy & power of Fire & Electric type moves by 1.2x. | `accuracy-mod` |
| 468 | Super Hot Goo | Inflicts burn and lowers Speed on contact. | `chance-status-on-hit` |
| 474 | Accelerate | Moves that need a charge turn are now used instantly. | `unclassified` |
| 476 | Itchy Defense | Causes infestation when hit by a contact move. | `chance-status-on-hit` |
| 478 | Moon Spirit | Fairy & Dark gains STAB. Moonlight recovers 75% HP. | `passive-recovery` |
| 482 | Sand Guard | Blocks priority and reduces special damage by 1/2 in sand. | `priority-modifier` |
| 487 | Super Strain | KOs lower Attack by +1. Take 25% recoil damage. | `unclassified` |
| 488 | Tipping Point | Getting hit raises SpAtk. Critical hits maximize SpAtk. | `crit-mod` |
| 491 | Aftershock | Triggers Magnitude 4-7 after using a damaging move. | `unclassified` |
| 492 | Freezing Point | 20% chance to get frostbitten on contact and 30% non-contact. | `chance-status-on-hit` |
| 494 | Arcane Force | All moves gain STAB. Ups “supereffective” by 10%. | `unclassified` |
| 500 | Heaven Asunder | Spacial Rend always crits. Ups crit level by +1. | `unclassified` |
| 505 | Mystic Blades | Keen edge moves become special and deal 30% more damage. | `unclassified` |
| 506 | Determination | Ups Special Attack by 50% if suffering. | `unclassified` |
| 515 | Retriever | Retrieves item on switch-out. | `unclassified` |
| 518 | Spiteful | Reduces attacker's PP on contact. | `chance-status-on-hit` |
| 519 | Fortitude | Boosts SpDef +1 when hit. Maxes SpDef on crit. | `chance-status-on-hit` |
| 523 | Grappler | Trapping moves last 6 turns. Trapping deals 1/6 HP. | `unclassified` |
| 532 | Permanence | Foes can't heal in any way. | `unclassified` |
| 536 | Blood Price | Does 30% more damage but lose 10% HP when attacking. | `unclassified` |
| 544 | Airborne | Boosts own & ally's Flying-type moves by 1.3x. | `unclassified` |
| 545 | Parroting | Copies sound moves used by others. | `move-replacement` |
| 551 | Impulse | Non-contact moves use the Speed stat for damage. | `chance-status-on-hit` |
| 552 | Terminal Velocity | Special moves use 20% of its Speed stat additionally. | `unclassified` |
| 555 | Egoist | Raises its own stats when foes raise theirs. | `unclassified` |
| 556 | Subdue | Doubles stat drop effects used by this pokemon. | `unclassified` |
| 559 | Guilt Trip | Sharply lowers attacker's Attack and SpAtk when fainting. | `stat-trigger-on-event` |
| 564 | Tactical Retreat | Flees when stats are lowered. | `unclassified` |
| 568 | Mind Crunch | Biting moves use SpAtk and deal 30% more damage. | `unclassified` |
| 570 | Ill Will | Deletes the PP of the move that faints this Pokemon. | `stat-trigger-on-event` |
| 574 | Sharp Edges | 1/6 HP damage when touched. | `unclassified` |
| 577 | Sharing Is Caring | Stat changes are shared between all battlers. | `unclassified` |
| 583 | Gallantry | Gets no damage for first hit. | `unclassified` |
| 585 | Sun Basking | Blocks priority and reduces physical damage by 1/2 in sun. | `priority-modifier` |
| 586 | Winged King | Ups “supereffective” by 33%. | `unclassified` |
| 588 | Iron Serpent | Ups “supereffective” by 33%. | `unclassified` |
| 589 | Catastrophe | Sun boosts Water. Rain boosts Fire. | `unclassified` |
| 591 | Celestial Blessing | Recovers 1/12 of its health each turn under Misty Terrain. | `weather-or-terrain-interaction` |
| 592 | Minion Control | Moves hit an extra time for each healthy party member. | `unclassified` |
| 595 | Noise Cancel | Protects the party from sound-based moves. | `unclassified` |
| 597 | Olé! | 20% chance to evade single-target moves. | `unclassified` |
| 598 | Malicious | Lowers the foe's highest Attack and Defense stat. | `unclassified` |
| 599 | Dead Power | 1.5x Attack boost. 20% chance to curse on contact moves. | `chance-status-on-hit` |
| 601 | Mythical Arrows | Arrow moves become special and deal 30% more damage. | `unclassified` |
| 602 | Lawnmower | Removes terrain on switch-in. Stat up if terrain removed. | `entry-effect` |
| 609 | Parasitic Spores | Deals 1/8 HP damage to non-Ghost. Spreads on contact. | `chance-status-on-hit` |
| 611 | Entrance | Confusion also inflicts infatuation. | `unclassified` |
| 612 | Rejection | Applies Quash on switch-in. | `entry-effect` |
| 623 | Surprise! | Astonishes enemy priority users in fog. | `priority-modifier` |
| 627 | Ethereal Rush | This Pokémon's Speed gets a 1.5x boost in fog. | `unclassified` |
| 629 | Shallow Grave | Revives at 25% HP once after fainting in fog. | `stat-trigger-on-event` |
| 634 | Last Stand | Def and SpDef increase as HP drops. Max 1.6x. | `unclassified` |
| 637 | Battle Aura | Boosts each battler's crit rate by +2. | `crit-mod` |
| 639 | Piercing Solo | Sound moves cause bleeding. | `unclassified` |
| 640 | Rhythmic | Deals 10% more damage for each repeated move use. | `unclassified` |
| 643 | Denting Blows | Hammer moves lower Defense. | `unclassified` |
| 645 | Soul Crusher | Hammer moves hit SpDef and get a 1.1x power boost. | `type-damage-boost-or-flag-damage-boost` |
| 649 | Pretentious | Dealing a KO raises Crit by one stage. | `unclassified` |
| 653 | Rest in Peace | Heals 1/8 of max HP every turn in fog. | `lifesteal` |
| 655 | Smokey Maneuvers | Evasion is boosted by 1.25x in fog. | `unclassified` |
| 656 | Tag | Attacks switching opponents with a 20BP Pursuit. | `entry-effect` |
| 658 | Power Edge | Keen Edge moves target Special Defense and get a 1.3x boost. | `unclassified` |
| 662 | Higher Rank | Priority moves get a 1.2x boost. | `priority-modifier` |
| 663 | Funeral Pyre | Non-Ghost and Dark-types take 1/4 damage every turn. | `unclassified` |
| 668 | No Turning Back | Boosts all stats but can't retreat when below 1/2 max HP. | `unclassified` |
| 671 | Bad Omen | Foes min roll. Takes 1/4 damage from crits. | `unclassified` |
| 672 | Mosh Pit | Ally's attacks get a 1.25x boost. 1.5x if attack causes recoil. | `unclassified` |
| 673 | Blood Stain | Is always bleeding if not immune. Spreads on contact. | `chance-status-on-hit` |
| 674 | Blood Stigma | Immune to status. Gets a 2x boost vs bleeding foes. | `status-immunity` |
| 687 | Vitality Strike | Heals for 10% of the damage dealt by punching moves. | `unclassified` |
| 690 | Restraining Order | Forces the attacker out when hit, once each switch-in. | `entry-effect` |
| 691 | Assassin's Tools | Contact moves have a 30% chance to PSN, PRLZ, or BLD. | `chance-status-on-hit` |
| 695 | Slipstream | Moves use 20% of its Speed stat additionally. | `unclassified` |
| 697 | Dragon's Ritual | Dealing a KO raises Attack and Speed by one stage. | `unclassified` |
| 700 | Color Spectrum | Same-type attacks get a 1.2x boost. Changes type each turn. | `unclassified` |
| 702 | From the Shadows | Attacks trap and have a 20% flinch chance when moving first. | `unclassified` |
| 703 | Rage Point | Gets a 1.5x boost while statused. Raises offenses when crit. | `unclassified` |
| 704 | Hot Coals | Sets a trap that burns the next foe that switches in. | `unclassified` |
| 705 | Terastal Treasure | Reduces damage taken by 40%, but lowers speed by 20%. | `damage-reduction-generic` |
| 708 | Megabite | Biting moves use SpAtk and deal 30% more damage. | `unclassified` |
| 711 | Lunar Affinity | Copies lunar moves used by others. | `move-replacement` |
| 715 | Hover | Adds Psychic type to itself. Avoids Ground attacks. | `unclassified` |
| 722 | Whiplash | Physical attacks lower defense. | `unclassified` |
| 724 | Lucky Halo | Negates self stat drops. Endures the a single KO. | `unclassified` |
| 729 | Victory Bomb | Attacks with a 100BP Fire-type Explosion on fainting. | `stat-trigger-on-event` |
| 730 | Razor Sharp | Critical hits also inflict bleeding. | `crit-mod` |
| 731 | To The Bone | Critical hits get a 1.5x boost and inflict bleeding. | `crit-mod` |
| 733 | Taekkyeon | All attacks are dances. | `unclassified` |
| 734 | Ape Shift | Transforms below 50% HP, curing status and always critting. | `unclassified` |
| 735 | Know Your Place | Contact attacks make foes move last for 5 turns. | `chance-status-on-hit` |
| 737 | Life Steal | Steals 1/10 HP from foes each turn. | `unclassified` |
| 740 | Set Ablaze | Inflicting burn also inflicts fear. | `unclassified` |
| 742 | Magical Fists | Punching moves use Special Attack and get a 1.3x boost. | `unclassified` |
| 750 | Neurotoxin | Inflicting poison also lowers Attack, SpAtk, and Speed. | `unclassified` |
| 751 | Energy Horns | Mighty horn moves become special and deal 30% more damage. | `unclassified` |
| 764 | Deep Freeze | Boosts Water and Ice by 1.25x. Halves Fire damage taken. | `type-damage-boost-or-flag-damage-boost` |
| 769 | JunshiSanda | Punches and Kicks are both Punches and Kicks. | `unclassified` |
| 771 | Forsaken Heart | KOs dealt anywhere on the field raise Attack by one stage. | `unclassified` |
| 773 | Soothsayer | Resists all attacks for three turns on first entry. | `unclassified` |
| 774 | Corrupted Mind | Psychic moves ignore resists and get 1.4x effect chance. | `unclassified` |
| 775 | Flame Coat | Non-Fire-types take 1/8 dmg every turn when on field. | `unclassified` |
| 782 | Hemolysis | Poisoned foes lose all stat buffs and can't heal. | `unclassified` |
| 787 | Cryo Architect | Boosts Attack and Def when hit by Water or Ice. | `chance-status-on-hit` |
| 807 | Woodland Curse | Uses Forest's Curse on Entry. Adds Grass type on contact. | `entry-effect` |
| 808 | Malodor | Suppresses attacker's abilities on contact. | `chance-status-on-hit` |
| 809 | Blur | Uses Speed as defense stat when hit by contact. | `chance-status-on-hit` |
| 810 | Elude | Uses Speed as defense stat when hit by non-contact. | `chance-status-on-hit` |
| 812 | Reverberate | Normal moves are Sound moves. | `unclassified` |
| 816 | Mental Pollution | Suppresses others' abilities when it becomes enraged. | `unclassified` |
| 817 | Madness Enhancement | Enrages in fog, halves damage when enraged. | `damage-reduction-generic` |
| 819 | Serpent Bind | 50% chance to trap, then drop the their speed by -1 each turn. | `unclassified` |
| 820 | Soul Tap | Drain 10% HP from foes at the end of each turn in fog. | `unclassified` |
| 824 | Frostbind | Inflicting Frostbite also inflicts Disable. | `unclassified` |
| 828 | Overzealous (N) | User's super-effective moves have +1 prio. | `unclassified` |
| 831 | Grass Flute | Sound moves inflict Fear. | `unclassified` |
| 832 | Hemotoxin | Supresses abilities of the target when they're poisoned. | `unclassified` |
| 833 | Harukaze | Setting Grassy Terrain sets Tailwind and vice versa. | `weather-or-terrain-interaction` |
| 837 | Chokehold | Binding moves lower speed and paralyze. | `unclassified` |
| 838 | Guardian Coat | Blocks weather dmg and powders. Takes -20% physical damage. | `weather-or-terrain-interaction` |
| 842 | Festivities | Sound moves become dance moves and vice versa. | `unclassified` |
| 843 | Fey Flight | Adds Fairy-type and levitates. | `unclassified` |
| 855 | Hyper Cleanse | Immune to status. Halves poison damage taken. | `status-immunity` |
| 862 | Thermal Slide | Ups speed by 50% in sun or hail. | `unclassified` |
| 864 | Chuckster | Once per entry, take 1/2 damage and force-switch the target. | `unclassified` |
| 866 | Relic Stone | Other battlers don't benefit from STAB. | `unclassified` |
| 871 | Fire Aspect | Absorbs fire moves and always burns with fire. | `unclassified` |
| 874 | Winter Throne | 1/8 Damage each turn to non-ice. Heals Ice 1/8 each turn. | `unclassified` |
| 876 | Sludge Spit | follows up with 35BP Venom Bolt after using an attack. | `unclassified` |
| 879 | Chilling Pellets | Uses 13BP Icicle Spear when hit by contact. | `chance-status-on-hit` |
| 880 | Paint Shot | Mega launcher moves change the target's type to the move used. | `form-change` |
| 883 | Warmonger | Boosts the user's rock, steel, and fighting moves by 30%. | `unclassified` |
| 884 | Locust Swarm | Changes into Hivemind form until 1/4 HP or less. | `unclassified` |
| 885 | Revelation | Changes into Revelation form until 1/4 HP or less. | `unclassified` |
| 886 | Curse of Famine | Eats terrain, restores hp, and boosts a defense. | `weather-or-terrain-interaction` |
| 888 | Soul Harvest | Fainted Pokemon increase your offenses and spdef by 5%. | `stat-trigger-on-event` |
| 889 | Thick Blubber | Take 1/4 damage from fire and ice in return for having 1/2 speed. | `unclassified` |
| 890 | Craving | Eat a random berry at the end of the turn. | `unclassified` |
| 891 | Rat King | Allies with a BST below 400 get their stats boosted by 50%. | `unclassified` |
| 892 | Crispy Cream | 30% to inflict burn/frostbite when hit by contact. | `chance-status-on-hit` |
| 896 | Spyware | Sharply raises a stat based on foe's strong point. | `unclassified` |
| 898 | Power Leak | When hit, set up Electric Terrain. | `chance-status-on-hit` |
| 899 | Backup Power | Revives at 25% HP once after fainting in Electric Terrain. | `stat-trigger-on-event` |
| 904 | Strong Foundation | Takes 1/2 Water and Ground dmg and can't be forced out. | `status-immunity` |
| 905 | Fog Machine | When hit, Set up Eerie Fog. | `chance-status-on-hit` |
| 906 | Drop Blocks | When hit, set up spikes. | `chance-status-on-hit` |
| 909 | Loose Thorns | Sets Creeping Thorns when hit by contact. | `chance-status-on-hit` |
| 911 | Greedy | Uses Thief when it loses an item. | `unclassified` |
| 912 | Musical Notes | Status moves become sound-based. | `unclassified` |
| 913 | Strikeout | Forces the foe out if they don't attack for 3 turns. | `unclassified` |
| 914 | Home Run | Landing a crit boosts your 3 lowest stats once per turn. | `unclassified` |
| 923 | Mashed Potato | Syrup Bomb effect on the foe for 3 turns. | `unclassified` |
| 927 | Wings of Pestilence | Every attack has a 20% Bleed chance and 10% Curse chance. | `unclassified` |
| 931 | Hammer Fist | Boosts punch and hammer moves by 25%. | `unclassified` |
| 932 | Drakelp Head | Weakens first move taken and drops opponent's attack. | `unclassified` |
| 933 | Polarity | Increases the party's highest stat by 30% | `unclassified` |
| 937 | Sumo Wrestler | Uses 20BP Circle Throw at the end of each 2nd turn. | `unclassified` |
| 938 | Cosmic Wings | Flying moves become Fairy-type. | `unclassified` |
| 940 | Cool Exit | Uses Chilly Reception at the end of your 2nd turn. | `unclassified` |
| 941 | Devious Present | Boosts Ice and throwing moves by 50%. | `unclassified` |
| 942 | Christmas Nightmare | Enemies take 1/8 damage when in hail. | `unclassified` |
| 943 | Sap Trap | Lowers foe's speed at the end of turns. At -3 they get trapped. | `unclassified` |
| 944 | Dead Bark | Adds Ghost type. Takes 15% less damage. 30% less damage if SE. | `damage-reduction-generic` |
| 945 | Chainsaw | Keen edge attacks lower defense by -1. | `unclassified` |
| 953 | Zen Garden | Sets up Grassy or Psychic Terrain at random. | `weather-or-terrain-interaction` |
| 956 | Brain Overload | When hit, sets up Psychic Terrain. | `chance-status-on-hit` |
| 957 | Brain Mass | Halves damage taken while at full HP. | `damage-reduction-generic` |
| 960 | Giant Shuriken | Water Shuriken hits once with 100BP and +1 crit. | `unclassified` |
| 963 | Wrestle Showman | Flying Press gains +10BP and causes Taunt. | `unclassified` |
| 967 | Foggy Eye | While in Fog, boost Ghost moves by 50% and resist Ghost moves. | `unclassified` |
| 975 | Talon Trap | 50% chance to trap on contact. 100% if entered this turn. | `chance-status-on-hit` |
| 979 | Eternal Flower | Reduces the stats of other Megas by 20%. | `form-change` |
| 981 | Hollow Ice Zone | Ice-type moves apply Ice Statue and then make the user switch. | `unclassified` |
| 987 | Rain Shroud | Ups evasion by 30% in rain. | `unclassified` |
| 991 | Resilience | Heal 1/4 of max HP whenever below 1/2 health | `lifesteal` |
| 993 | Thunder Clouds | After using a special move, launch a 35 BP Thunderbolt | `unclassified` |
| 998 | Acid Reflux | Uses 20BP Acid when it takes damage. | `unclassified` |
| 1000 | Survivor Bias | Not very effective moves can't cause fainting. | `stat-trigger-on-event` |
| 1004 | Feathercoat | Takes 10% less damage from attacks, 20% if resisted. | `damage-reduction-generic` |
| 1005 | Power Outage | Boosts first Electric attack by 2x then loses Electric type. | `unclassified` |
| 1008 | Daredevil | +1 Atk after using recoil move. 1/2 recoil damage. | `unclassified` |
| 1012 | Petal Shield | Maxes Def on entry. -1 Def when hit. | `entry-effect` |
| 1018 | Abominable Monster | Ups SpDef by 1.5x in hail. | `unclassified` |
| 1027 | Jungle Fever | If Grassy Terrain is active, gets a 1.5x Speed boost. | `weather-or-terrain-interaction` |
| 1030 | Sleek Scales | The Pokémon uses +15% of its Speed when defending. | `unclassified` |

## Bespoke moves (57)

| ER ID | Name | Description | Taxonomy Hint |
|---|---|---|---|
| 760 | Outburst | Severe special damage but makes the user faint. | `stat-trigger-on-event` |
| 761 | Seismic Fist | A ground-breaking punch. 20% chance to drop Def. | `unclassified` |
| 769 | Primal Beam | An strange beam that uses the user's Attack, may rise it. | `unclassified` |
| 788 | Jagged Punch | Not done yet. | `unclassified` |
| 810 | Blood Shot | Makes the target bleed with black magic. | `unclassified` |
| 811 | Flash Freeze | Drains the heat from the target, causing frostbite. | `unclassified` |
| 822 | Energy Wave | Deals damage. | `unclassified` |
| 823 | Fluttering Leaf | Deals damage and switches. | `unclassified` |
| 832 | Boiling Flame | Deals damage. Does increase damage in rain. | `unclassified` |
| 834 | Double Lariat | Hits both targets. Silences hit targets. | `unclassified` |
| 836 | Yggdrasil Force | Lowers user's Atk and Def. | `unclassified` |
| 837 | Drain Brain | Lowers targets SpAtk. Heals that much HP. | `lifesteal` |
| 841 | Gem Missile | +1 priority. | `priority-modifier` |
| 844 | Inverse Room | Reverses type matchups for 5 turns. | `unclassified` |
| 846 | Karma | Raises SpAtk and SpDef. Lowers Speed. | `unclassified` |
| 853 | Raging Souls | Sharply lowers user's SpAtk. | `unclassified` |
| 897 | Creeping Thorns | Thorns surround the foe. Hurts foes on switch in. | `entry-effect` |
| 935 | Megaton Hammer | A devistating blow delivered with a heavy weapon. | `unclassified` |
| 949 | Beatdown | Hits 2-5 times with an attack flurry. | `unclassified` |
| 950 | Eerie Fog | An unnatural fog descends, draining stat boosts. | `unclassified` |
| 951 | Mystic Dance | Not implemented. | `unclassified` |
| 954 | Kilobite | Rushes forward and bites the foe's weak spot. | `unclassified` |
| 955 | Tangling Husk | Slows attackers while avoiding damage from non-Fire moves. | `unclassified` |
| 962 | Sparkling Barrage | Hits 3 Times with light rays. | `multi-hit-override` |
| 963 | Spectral Serenade | Not Implemented. | `unclassified` |
| 964 | Merculight | Evades attacks and paralyzes the attacker. | `unclassified` |
| 966 | Spectral Flame | Emits a flame that moves as if alive and inflicts burn. | `unclassified` |
| 967 | Trepidation | The foe falls into despair and misses all Psychic moves. | `unclassified` |
| 969 | Fetch | The user runs off the field in search of its lost item. | `unclassified` |
| 970 | Transmute | Strikes the foe, remaking the user's item on KO. | `unclassified` |
| 971 | Clear Skies | Clears the weather and prevents new weather. | `weather-or-terrain-interaction` |
| 974 | Vexing Void | A terrifying void engulfs the foe. | `unclassified` |
| 975 | Eclipse | The darkness within erupts from the user for heavy damage. | `unclassified` |
| 977 | Caltrops | Spreads dangerous spikes that inflict bleeding. | `unclassified` |
| 979 | Safe Passage | Guides an ally onto the field, shielding them from harm. | `unclassified` |
| 989 | Showtime | Sets the stage with a Magic Room then bows out. | `unclassified` |
| 990 | Banished Power | Strikes with a forbidden power that empowers the user. | `unclassified` |
| 991 | Triple Tremor | Strikes with three intensifying shockwaves. | `unclassified` |
| 999 | Metallic Melody | Hits the body rhythmically to damage the opponent with sound. | `unclassified` |
| 1000 | Blue Moon | The user unleashes the spirit from a full blue moon. | `unclassified` |
| 1003 | Septic Switch | Supress abilities then switch. | `unclassified` |
| 1005 | Incite | Adds dark type and enrages foe. | `unclassified` |
| 1006 | Toxic Terrain | Boosts Poison and damages mons for 8 turns. | `unclassified` |
| 1007 | Jetstream Burst | Strikes by using flurries of wind. | `unclassified` |
| 1008 | Sky Quake | Strikes with harsh winds. | `unclassified` |
| 1009 | Sunstrike (N) | Strikes with harsh winds. | `unclassified` |
| 1010 | Tempest Storm (N) | Sets a thundershock storm. | `unclassified` |
| 1016 | Party Favors | Damages the foe and heals allies. | `unclassified` |
| 1017 | Shot Put | A ball attack. 30% speed drop. | `unclassified` |
| 1020 | Dragon Dash | +1 priority attack. | `priority-modifier` |
| 1021 | Pocket Sand | +1 priority, 10% acc drop. | `priority-modifier` |
| 1022 | Concoction | Damages and uses a berry. | `unclassified` |
| 1023 | Hacksaw | Super effective vs Steel. | `unclassified` |
| 1024 | Godspeed | Super effective vs Steel. | `unclassified` |
| 1027 | Rain Flush | A powerful rain attack. Lowers the user's defenses. | `unclassified` |
| 1028 | Ice Wall | Sets reflect with ice. | `unclassified` |
| 1029 | Obscured Shot | Strikes first if the foe is preparing an attack. | `unclassified` |
