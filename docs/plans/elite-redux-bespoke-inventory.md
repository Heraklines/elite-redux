# Elite Redux — Bespoke Inventory (Phase C → D handoff)

> Auto-generated. Regenerate: `pnpm run er:audit-archetype-coverage`.
>
> Last regenerated: 2026-06-01T14:48:39.242Z.

This doc enumerates the ER abilities and moves the C2/C3 archetype classifier
could NOT slot into an archetype primitive. Each entry needs a hand-written
implementation in the Phase D wire-up layer.

The `Taxonomy Hint` column groups bespoke entries by the archetype they most
resemble — useful for batching related hand-writes in the Phase D pass. A hint
of `unclassified` means the description didn't match any keyword bucket; those
are typically multi-mechanic abilities that don't fit any one archetype.

## Summary

- Bespoke abilities: **386**
- Bespoke moves: **57**
- Total long-tail entries needing hand-write: **443**

### Bespoke abilities by taxonomy hint

| Hint | Count |
|---|---|
| `unclassified` | 201 |
| `entry-effect` | 62 |
| `chance-status-on-hit` | 37 |
| `accuracy-mod` | 17 |
| `weather-or-terrain-interaction` | 12 |
| `type-damage-boost-or-flag-damage-boost` | 10 |
| `stat-trigger-on-event` | 8 |
| `status-immunity` | 8 |
| `damage-reduction-generic` | 7 |
| `priority-modifier` | 6 |
| `crit-mod` | 5 |
| `lifesteal` | 5 |
| `form-change` | 4 |
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

## Bespoke abilities (386)

| ER ID | Name | Description | Taxonomy Hint |
|---|---|---|---|
| 0 | ------- | Empty ability slot. | `unclassified` |
| 254 | WandrngSprit | Trades ability with attacker on contact. | `chance-status-on-hit` |
| 261 | CuriusMedicn | Resets its ally's stat changes on entry. | `entry-effect` |
| 268 | Chloroplast | Weather Ball, Solar Beam/Blade, Growth act as if used in sun. | `weather-or-terrain-interaction` |
| 269 | Whiteout | Ups highest attacking stat by 1.5x in hail. | `unclassified` |
| 270 | Pyromancy | Moves inflict burn 5x as often. | `unclassified` |
| 271 | Keen Edge | Boosts the power of slashing moves by 1.3x. | `type-damage-boost-or-flag-damage-boost` |
| 273 | Power Fists | Iron Fist moves target Special Defense and get a 1.3x boost. | `unclassified` |
| 275 | Rampage | No recharge after a KO, if it usually would need to recharge. | `unclassified` |
| 276 | Vengeance | Boosts Ghost-type moves by 1.2x, or 1.5x when below 1/3 HP. | `unclassified` |
| 278 | Antarctic Bird | Ice-type and Flying-type moves get a 1.3x power boost. | `type-damage-boost-or-flag-damage-boost` |
| 282 | Aerodynamics | Boosts Speed instead of being hit by Flying-type moves. | `unclassified` |
| 283 | Christmas Spirit | Takes 50% less damage if hail is active. | `damage-reduction-generic` |
| 284 | Exploit Weakness | Targets lowest defense vs statused foes. | `unclassified` |
| 285 | Ground Shock | Target Grounds aren't immune to Electric but resist it instead. | `status-immunity` |
| 286 | Ancient Idol | Uses Def and Sp. Def instead of Atk and Sp. Atk when attacking. | `unclassified` |
| 287 | Mystic Power | All moves gain the 1.5x power boost from STAB. | `type-damage-boost-or-flag-damage-boost` |
| 289 | Growing Tooth | Raises Attack by one stage after using a biting move. | `unclassified` |
| 291 | Aurora Borealis | Ice-type moves gain STAB. Moves always benefit from hail. | `unclassified` |
| 292 | Avenger | If a party Pokémon fainted last turn, next move gets 1.5x boost. | `stat-trigger-on-event` |
| 293 | Let's Roll | Casts Defense Curl on entry. | `entry-effect` |
| 297 | Amphibious | Water moves gain STAB. Can't become drenched. | `status-immunity` |
| 299 | Earthbound | Boosts Ground-type moves by 1.2x, or 1.5x when under 1/3 HP. | `unclassified` |
| 301 | Cryptic Power | Doubles own Sp. Atk stat. Boosts raw stat, not base stat. | `unclassified` |
| 303 | Fossilized | Halves dmg taken by Rock moves. Boosts own Rock moves by 1.2x. | `unclassified` |
| 304 | Magical Dust | Makes foe Psychic-type on contact. Also works on offense. | `chance-status-on-hit` |
| 313 | Dragonslayer | Deals 1.5x damage to Dragons. Takes 0.5x damage from Dragons. | `type-damage-boost-or-flag-damage-boost` |
| 314 | Mountaineer | Immune to Rock-type attacks and Stealth Rock damage. | `status-immunity` |
| 320 | Air Blower | Casts a 3-turn Tailwind on entry. | `entry-effect` |
| 321 | Juggernaut | Contact moves add 20% Def to attack. Paralysis-immune. | `chance-status-on-hit` |
| 323 | Majestic Bird | Boosts own Sp. Atk by 1.5x. Boosts raw stat, not base stat. | `unclassified` |
| 326 | Impenetrable | Only damaged by attacks. | `unclassified` |
| 327 | Hypnotist | Hypnosis accuracy is 90% when used by this Pokémon. | `accuracy-mod` |
| 329 | Scare | Lowers foes' Sp. Atk by one stage on entry. | `entry-effect` |
| 330 | Majestic Moth | On entry, raises highest calculated stat by one stage. | `entry-effect` |
| 332 | Soul Linker | Enemies take all the damage they deal, same for this Pokémon. | `unclassified` |
| 333 | Sweet Dreams | Heals 1/8 of max HP every turn if asleep. Immune to Bad Dreams. | `lifesteal` |
| 334 | Bad Luck | Foes can't crit, deal min damage, 5% less acc, & no effect chance. | `unclassified` |
| 335 | Haunted Spirit | When this Pokémon is KO'd, casts a Curse on the attacker. | `unclassified` |
| 337 | Raw Wood | Halves dmg taken by Grass moves. Boosts own Grass moves by 1.2x. | `unclassified` |
| 340 | Fatal Precision | Super-effective moves never miss and always crit. | `accuracy-mod` |
| 341 | Fort Knox | Blocks most damage boosting and multihit abilities. | `multi-hit-override` |
| 342 | Seaweed | Takes 1/2 dmg from Fire if Grass. Grass deals x2 dmg to Fire. | `unclassified` |
| 345 | Scavenger | Dealing a KO heals 1/4 of this Pokémon's max HP. | `lifesteal` |
| 347 | Multi-Headed | Hits as many times, as it has heads. | `unclassified` |
| 348 | North Wind | 3 turns Aurora Veil on entry. Immune to Hail damage. | `entry-effect` |
| 349 | Overcharge | Electric is super effective vs Electric. Can paralyze Electric. | `unclassified` |
| 350 | Violent Rush | Boosts Speed by 50% + Attack by 20% on first turn. | `unclassified` |
| 352 | Sage Power | Ups Special Attack by 50% and locks move. | `unclassified` |
| 353 | Bone Zone | Bone moves ignore immunities and deal 2x on not very effective. | `unclassified` |
| 354 | Weather Control | Negates all weather based moves from enemies. | `weather-or-terrain-interaction` |
| 355 | Speed Force | Contact moves use 20% of its Speed stat additionally. | `chance-status-on-hit` |
| 356 | Sea Guardian | Ups highest stat by +1 on entry when it rains. | `entry-effect` |
| 357 | Molten Down | Fire-type is super effective against Rock-type. | `unclassified` |
| 360 | Field Explorer | Boosts field moves by 50%. Cut, Surf, Strength etc. | `unclassified` |
| 365 | Lunar Eclipse | Fairy & Dark gains STAB. Hypnosis has 1.5x accuracy. | `accuracy-mod` |
| 367 | Power Core | The Pokémon uses +20% of its Defense or SpDef during moves. | `unclassified` |
| 368 | Sighting System | Moves always hit. Moves last for moves less than 80% accuracy. | `accuracy-mod` |
| 369 | Bad Company | Not implemented right now. Has no effect. | `unclassified` |
| 372 | Momentum | Contact moves use the Speed stat for damage calculation. | `chance-status-on-hit` |
| 373 | Grip Pincer | 50% chance to trap. Then ignores Defense & accuracy checks. | `accuracy-mod` |
| 375 | Precise Fist | Punching moves get +1 crit and 5x effect chance. | `unclassified` |
| 376 | Deadeye | Arrow & cannon moves never miss. Crits hit weakest defense. | `accuracy-mod` |
| 377 | Artillery | Mega Launcher moves always hit and hit both foes. | `form-change` |
| 378 | Amplifier | Ups sound moves by 30% and makes them hit both foes. | `unclassified` |
| 380 | Sun Worship | Ups highest stat by +1 on entry when sunny. | `entry-effect` |
| 382 | Volcano Rage | Triggers 50 BP Eruption after using a Fire-type move. | `unclassified` |
| 383 | Cold Rebound | Attacks with Icy Wind when hit by a contact move. | `chance-status-on-hit` |
| 384 | Low Blow | Attacks with 40BP Feint Attack on switch-in. | `entry-effect` |
| 389 | Thundercall | Triggers Smite at 20% power when using an Electric move. | `unclassified` |
| 392 | Hardened Sheath | Ups Attack by +1 when using horn moves. | `unclassified` |
| 394 | Lethargy | Damage drops 20% each turn to 20%. Resets on switch-in. | `entry-effect` |
| 396 | Steel Barrel | Immune to recoil damage, but not immune to Explosion/crash dmg. | `status-immunity` |
| 397 | Pyro Shells | Triggers 50 BP Outburst after using a Mega Launcher move. | `form-change` |
| 398 | Fungal Infection | Contact moves inflict Leech Seed on the target. | `chance-status-on-hit` |
| 400 | Scrapyard | Sets a layer of Spikes when hit (contact move). | `chance-status-on-hit` |
| 401 | Loose Quills | Sets a layer of Spikes when hit (contact move). | `chance-status-on-hit` |
| 403 | Roundhouse | Kicks always hit. Damages foes' weaker defenses. | `accuracy-mod` |
| 405 | Loose Rocks | Deploys Stealth Rocks when hit by contact. | `chance-status-on-hit` |
| 406 | Spinning Top | Fighting moves up speed +1 and clear hazards. | `unclassified` |
| 407 | Retribution Blow | Uses Hyper Beam if any foe uses an stat boosting move. | `unclassified` |
| 411 | Toxic Spill | Non-Poison-types take 1/8 dmg every turn when on field. | `unclassified` |
| 412 | Desert Cloak | Protects its side from status and secondary effects in sand. | `unclassified` |
| 421 | Sweeping Edge | Keen Edge moves always hit and hit both foes. | `accuracy-mod` |
| 422 | Gifted Mind | Nulls Psychic weakness; status moves always hit. | `accuracy-mod` |
| 423 | Hydro Circuit | Electric moves +50%; Water moves siphon 25% damage. | `unclassified` |
| 424 | Equinox | Boosts Atk or SpAtk to match the higher value. | `unclassified` |
| 425 | Absorbant | Drain moves recover +50% HP & apply Leech Seed. | `unclassified` |
| 426 | Clueless | Negates Weather, Rooms and Terrains. | `weather-or-terrain-interaction` |
| 427 | Cheating Death | Gets no damage for the first two hits. | `unclassified` |
| 428 | Cheap Tactics | Attacks with Scratch on switch-in. | `entry-effect` |
| 429 | Coward | Sets up Protect on switch-in. Only works once. | `entry-effect` |
| 431 | Dune Terror | Sand reduces damage by 35%. Boosts Ground moves by 20%. | `damage-reduction-generic` |
| 434 | Elemental Charge | 20% chance to BRN/FRZ/PARA with respective types. | `unclassified` |
| 435 | Ambush | Guaranteed critical hit on first turn. | `crit-mod` |
| 437 | Radiance | +20% accuracy; Dark moves fail when user is present. | `accuracy-mod` |
| 438 | Jaws of Carnage | Devours 1/2 of the foe when defeating it. | `unclassified` |
| 439 | Angel's Wrath | Drastically alters all of the users moves. | `unclassified` |
| 442 | Fae Hunter | Deals 1.5x damage to Fairy. Takes 0.5x damage from Fairy. | `type-damage-boost-or-flag-damage-boost` |
| 444 | Evaporate | Takes no damage and sets Mist if hit by water. | `unclassified` |
| 445 | Lumberjack | Deals 1.5x damage to Grass. Takes 0.5x damage from Grass. | `type-damage-boost-or-flag-damage-boost` |
| 447 | Furnace | User gains +2 Speed when when hit by rocks. | `chance-status-on-hit` |
| 455 | Archmage | 30% chance of adding a type related effect to each move. | `unclassified` |
| 456 | Cryomancy | Moves inflict frostbite 5x as often. | `unclassified` |
| 457 | Phantom Pain | Ghost-type moves deal normal damage to Normal. | `unclassified` |
| 461 | Monkey Business | Uses Tickle on entry. | `entry-effect` |
| 463 | Jungle's Guard | Protects Grass-type allies from status and stat drops. | `unclassified` |
| 464 | Hunter's Horn | Boost horn moves and heals 1/4 HP when defeating an enemy. | `lifesteal` |
| 466 | Plasma Lamp | Boost accuracy & power of Fire & Electric type moves by 1.2x. | `accuracy-mod` |
| 468 | Super Hot Goo | Inflicts burn and lowers Speed on contact. | `chance-status-on-hit` |
| 471 | Cold Plasma | Electric type moves now inflict burn instead of paralysis. | `unclassified` |
| 473 | Inversion | Sets up Inverse Room on entry, lasts 3 turns. | `entry-effect` |
| 474 | Accelerate | Moves that need a charge turn are now used instantly. | `unclassified` |
| 475 | Frost Burn | Triggers 40BP Ice Beam after using a Fire-type move. | `unclassified` |
| 476 | Itchy Defense | Causes infestation when hit by a contact move. | `chance-status-on-hit` |
| 477 | Generator | Charges up once on entry or when electric terrain is active. | `entry-effect` |
| 478 | Moon Spirit | Fairy & Dark gains STAB. Moonlight recovers 75% HP. | `passive-recovery` |
| 479 | Dust Cloud | Attacks with Sand Attack on switch-in. | `entry-effect` |
| 481 | Trickster | Uses Disable on switch-in. | `entry-effect` |
| 482 | Sand Guard | Blocks priority and reduces special damage by 1/2 in sand. | `priority-modifier` |
| 485 | Soothing Aroma | Cures party status on entry. | `entry-effect` |
| 487 | Super Strain | KOs lower Attack by +1. Take 25% recoil damage. | `unclassified` |
| 488 | Tipping Point | Getting hit raises SpAtk. Critical hits maximize SpAtk. | `crit-mod` |
| 491 | Aftershock | Triggers Magnitude 4-7 after using a damaging move. | `unclassified` |
| 492 | Freezing Point | 20% chance to get frostbitten on contact and 30% non-contact. | `chance-status-on-hit` |
| 494 | Arcane Force | All moves gain STAB. Ups “supereffective” by 10%. | `unclassified` |
| 495 | Doombringer | Uses Doom Desire on switch-in. | `entry-effect` |
| 496 | Wishmaker | Uses Wish on switch-in. Three uses per battle. | `entry-effect` |
| 498 | Suppress | Casts Torment on entry. | `entry-effect` |
| 500 | Heaven Asunder | Spacial Rend always crits. Ups crit level by +1. | `unclassified` |
| 503 | High Tide | Triggers 50 BP Surf after using a Water-type move. | `unclassified` |
| 504 | Change of Heart | Uses Heart Swap on switch-in. | `entry-effect` |
| 505 | Mystic Blades | Keen edge moves become special and deal 30% more damage. | `unclassified` |
| 506 | Determination | Ups Special Attack by 50% if suffering. | `unclassified` |
| 511 | Telekinetic | Casts Telekinesis on entry. | `entry-effect` |
| 514 | Powder Burst | Casts Powder on entry. | `entry-effect` |
| 515 | Retriever | Retrieves item on switch-out. | `unclassified` |
| 516 | Monster Mash | Casts Trick-or-Treat on entry. | `entry-effect` |
| 517 | Two Step | Triggers 50BP Revelation Dance after using a Dance move. | `unclassified` |
| 518 | Spiteful | Reduces attacker's PP on contact. | `chance-status-on-hit` |
| 519 | Fortitude | Boosts SpDef +1 when hit. Maxes SpDef on crit. | `chance-status-on-hit` |
| 521 | Phantom Thief | Attacks with 40BP Spectral Thief on switch-in. | `entry-effect` |
| 523 | Grappler | Trapping moves last 6 turns. Trapping deals 1/6 HP. | `unclassified` |
| 526 | Monster Hunter | Deals 1.5x damage to Dark. Takes 0.5x damage from Dark. | `type-damage-boost-or-flag-damage-boost` |
| 529 | Berserk DNA | Sharply ups highest attacking stat but enrages on entry. | `entry-effect` |
| 531 | Clap Trap | Counters contact with 50BP Snap Trap. | `chance-status-on-hit` |
| 532 | Permanence | Foes can't heal in any way. | `unclassified` |
| 536 | Blood Price | Does 30% more damage but lose 10% HP when attacking. | `unclassified` |
| 541 | Web Spinner | Uses String Shot on switch-in. | `entry-effect` |
| 544 | Airborne | Boosts own & ally's Flying-type moves by 1.3x. | `unclassified` |
| 545 | Parroting | Copies sound moves used by others. | `move-replacement` |
| 546 | Salt Circle | Prevents opposing pokemon from fleeing on entry. | `entry-effect` |
| 551 | Impulse | Non-contact moves use the Speed stat for damage. | `chance-status-on-hit` |
| 552 | Terminal Velocity | Special moves use 20% of its Speed stat additionally. | `unclassified` |
| 555 | Egoist | Raises its own stats when foes raise theirs. | `unclassified` |
| 556 | Subdue | Doubles stat drop effects used by this pokemon. | `unclassified` |
| 557 | Readied Action | Doubles attack on first turn. | `unclassified` |
| 559 | Guilt Trip | Sharply lowers attacker's Attack and SpAtk when fainting. | `stat-trigger-on-event` |
| 564 | Tactical Retreat | Flees when stats are lowered. | `unclassified` |
| 568 | Mind Crunch | Biting moves use SpAtk and deal 30% more damage. | `unclassified` |
| 570 | Ill Will | Deletes the PP of the move that faints this Pokemon. | `stat-trigger-on-event` |
| 573 | Rapid Response | Boosts Speed by 50% + SpAtk by 20% on first turn. | `unclassified` |
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
| 603 | Flourish | Boosts Grass moves by 50% in grassy terrain. | `weather-or-terrain-interaction` |
| 604 | Desert Spirit | Summons sand on entry. Ground moves hit airborne in sand. | `entry-effect` |
| 609 | Parasitic Spores | Deals 1/8 HP damage to non-Ghost. Spreads on contact. | `chance-status-on-hit` |
| 611 | Entrance | Confusion also inflicts infatuation. | `unclassified` |
| 612 | Rejection | Applies Quash on switch-in. | `entry-effect` |
| 616 | Demolitionist | Readied Action + Ignores Protect + screens break on readied turn | `unclassified` |
| 619 | Low Visibility | Summons Eerie Fog on entry. | `entry-effect` |
| 621 | Ectoplasm | Ups highest attacking stat by 1.5x in fog. | `unclassified` |
| 623 | Surprise! | Astonishes enemy priority users in fog. | `priority-modifier` |
| 625 | Greater Spirit | Ups highest stat by +1 on entry in fog. | `entry-effect` |
| 627 | Ethereal Rush | This Pokémon's Speed gets a 1.5x boost in fog. | `unclassified` |
| 629 | Shallow Grave | Revives at 25% HP once after fainting in fog. | `stat-trigger-on-event` |
| 631 | Shiny Lightning | Grants a 1.2x accuracy boost. Thunder never misses. | `accuracy-mod` |
| 632 | Terrify | Lowers foes' Sp. Atk by two stages on entry. | `entry-effect` |
| 633 | Ice Downfall | Counters contact with 60BP Icicle Crash. | `chance-status-on-hit` |
| 634 | Last Stand | Def and SpDef increase as HP drops. Max 1.6x. | `unclassified` |
| 636 | Blood Bath | Immune to bleed. Inflict fear when inflicting bleed. | `status-immunity` |
| 637 | Battle Aura | Boosts each battler's crit rate by +2. | `crit-mod` |
| 639 | Piercing Solo | Sound moves cause bleeding. | `unclassified` |
| 640 | Rhythmic | Deals 10% more damage for each repeated move use. | `unclassified` |
| 641 | Chunky Bass Line | Triggers a 40BP Earthquake after using a sound move. | `unclassified` |
| 643 | Denting Blows | Hammer moves lower Defense. | `unclassified` |
| 645 | Soul Crusher | Hammer moves hit SpDef and get a 1.1x power boost. | `type-damage-boost-or-flag-damage-boost` |
| 648 | On the Prowl | +1 priority for the first turn. Negative priority becomes +0. | `priority-modifier` |
| 649 | Pretentious | Dealing a KO raises Crit by one stage. | `unclassified` |
| 653 | Rest in Peace | Heals 1/8 of max HP every turn in fog. | `lifesteal` |
| 655 | Smokey Maneuvers | Evasion is boosted by 1.25x in fog. | `unclassified` |
| 656 | Tag | Attacks switching opponents with a 20BP Pursuit. | `entry-effect` |
| 658 | Power Edge | Keen Edge moves target Special Defense and get a 1.3x boost. | `unclassified` |
| 660 | Ultra Instinct | Counters contact with 20BP Vacuum Wave. Takes .8x damage. | `chance-status-on-hit` |
| 662 | Higher Rank | Priority moves get a 1.2x boost. | `priority-modifier` |
| 663 | Funeral Pyre | Non-Ghost and Dark-types take 1/4 damage every turn. | `unclassified` |
| 668 | No Turning Back | Boosts all stats but can't retreat when below 1/2 max HP. | `unclassified` |
| 669 | Flammable Coat | Changes forms when using or hit by a Fire-type move. | `unclassified` |
| 670 | Draco Morale | Uses Dragon Cheer on switch-in. | `entry-effect` |
| 671 | Bad Omen | Foes min roll. Takes 1/4 damage from crits. | `unclassified` |
| 672 | Mosh Pit | Ally's attacks get a 1.25x boost. 1.5x if attack causes recoil. | `unclassified` |
| 673 | Blood Stain | Is always bleeding if not immune. Spreads on contact. | `chance-status-on-hit` |
| 674 | Blood Stigma | Immune to status. Gets a 2x boost vs bleeding foes. | `status-immunity` |
| 676 | Sidewinder | First biting move each entry gets +1 priority. Resets on KO. | `priority-modifier` |
| 677 | Petrify | Clears stat buffs then lowers speed by one stage on entry. | `entry-effect` |
| 687 | Vitality Strike | Heals for 10% of the damage dealt by punching moves. | `unclassified` |
| 690 | Restraining Order | Forces the attacker out when hit, once each switch-in. | `entry-effect` |
| 691 | Assassin's Tools | Contact moves have a 30% chance to PSN, PRLZ, or BLD. | `chance-status-on-hit` |
| 692 | Frostmaw | Biting moves have a 50% chance to inflict frostbite. | `unclassified` |
| 695 | Slipstream | Moves use 20% of its Speed stat additionally. | `unclassified` |
| 697 | Dragon's Ritual | Dealing a KO raises Attack and Speed by one stage. | `unclassified` |
| 698 | Pinnacle Blade | Slashing moves always hit and break protection and barriers. | `accuracy-mod` |
| 699 | Energized | Generator + charges up on KO with an Electric-type move. | `unclassified` |
| 700 | Color Spectrum | Same-type attacks get a 1.2x boost. Changes type each turn. | `unclassified` |
| 702 | From the Shadows | Attacks trap and have a 20% flinch chance when moving first. | `unclassified` |
| 703 | Rage Point | Gets a 1.5x boost while statused. Raises offenses when crit. | `unclassified` |
| 704 | Hot Coals | Sets a trap that burns the next foe that switches in. | `unclassified` |
| 705 | Terastal Treasure | Reduces damage taken by 40%, but lowers speed by 20%. | `damage-reduction-generic` |
| 708 | Megabite | Biting moves use SpAtk and deal 30% more damage. | `unclassified` |
| 710 | Dream Whimsy | Uses Yawn on switch-in. | `entry-effect` |
| 711 | Lunar Affinity | Copies lunar moves used by others. | `move-replacement` |
| 715 | Hover | Adds Psychic type to itself. Avoids Ground attacks. | `unclassified` |
| 717 | Wildfire | Attacks with Fire Spin on entry. | `entry-effect` |
| 718 | Jumpscare | Attacks with Astonish on first switch-in. | `entry-effect` |
| 719 | Tar Toss | Uses Tar Shot on switch-in. | `entry-effect` |
| 722 | Whiplash | Physical attacks lower defense. | `unclassified` |
| 724 | Lucky Halo | Negates self stat drops. Endures the a single KO. | `unclassified` |
| 728 | Wind Rage | Uses Defog on switch-in. Air-based moves get a 1.3x boost. | `entry-effect` |
| 729 | Victory Bomb | Attacks with a 100BP Fire-type Explosion on fainting. | `stat-trigger-on-event` |
| 730 | Razor Sharp | Critical hits also inflict bleeding. | `crit-mod` |
| 731 | To The Bone | Critical hits get a 1.5x boost and inflict bleeding. | `crit-mod` |
| 732 | Blade Dance | Triggers 50 BP Leaf Blade after using a dance move. | `unclassified` |
| 733 | Taekkyeon | All attacks are dances. | `unclassified` |
| 734 | Ape Shift | Transforms below 50% HP, curing status and always critting. | `unclassified` |
| 735 | Know Your Place | Contact attacks make foes move last for 5 turns. | `chance-status-on-hit` |
| 736 | Deep Cuts | Slashing moves have a 50% chance to inflict bleeding. | `unclassified` |
| 737 | Life Steal | Steals 1/10 HP from foes each turn. | `unclassified` |
| 740 | Set Ablaze | Inflicting burn also inflicts fear. | `unclassified` |
| 742 | Magical Fists | Punching moves use Special Attack and get a 1.3x boost. | `unclassified` |
| 745 | Sand Pit | Attacks with 20BP Sand Tomb on switch-in. | `entry-effect` |
| 750 | Neurotoxin | Inflicting poison also lowers Attack, SpAtk, and Speed. | `unclassified` |
| 751 | Energy Horns | Mighty horn moves become special and deal 30% more damage. | `unclassified` |
| 764 | Deep Freeze | Boosts Water and Ice by 1.25x. Halves Fire damage taken. | `type-damage-boost-or-flag-damage-boost` |
| 769 | JunshiSanda | Punches and Kicks are both Punches and Kicks. | `unclassified` |
| 771 | Forsaken Heart | KOs dealt anywhere on the field raise Attack by one stage. | `unclassified` |
| 773 | Soothsayer | Resists all attacks for three turns on first entry. | `unclassified` |
| 774 | Corrupted Mind | Psychic moves ignore resists and get 1.4x effect chance. | `unclassified` |
| 775 | Flame Coat | Non-Fire-types take 1/8 dmg every turn when on field. | `unclassified` |
| 782 | Hemolysis | Poisoned foes lose all stat buffs and can't heal. | `unclassified` |
| 784 | Poseidon's Dominion | Attacks with Whirlpool on entry. | `entry-effect` |
| 786 | Lullaby | Sing accuracy is 90% when used by this Pokémon. | `accuracy-mod` |
| 787 | Cryo Architect | Boosts Attack and Def when hit by Water or Ice. | `chance-status-on-hit` |
| 788 | Glacial Rage | Triggers 50 BP Blizzard after using a Ice-type move. | `unclassified` |
| 791 | DNA Scramble | Changes forms based on the the move used. | `unclassified` |
| 794 | Deadly Precision | Super-effective moves never miss and ignore abilities. | `accuracy-mod` |
| 804 | Firefighter | Deals 1.5x damage to Fire. Takes 0.5x damage from Fire. | `type-damage-boost-or-flag-damage-boost` |
| 807 | Woodland Curse | Uses Forest's Curse on Entry. Adds Grass type on contact. | `entry-effect` |
| 808 | Malodor | Suppresses attacker's abilities on contact. | `chance-status-on-hit` |
| 809 | Blur | Uses Speed as defense stat when hit by contact. | `chance-status-on-hit` |
| 810 | Elude | Uses Speed as defense stat when hit by non-contact. | `chance-status-on-hit` |
| 812 | Reverberate | Normal moves are Sound moves. | `unclassified` |
| 813 | Mixed Martial Arts | Normal moves are flagged as Punch + Kick moves. | `unclassified` |
| 816 | Mental Pollution | Suppresses others' abilities when it becomes enraged. | `unclassified` |
| 817 | Madness Enhancement | Enrages in fog, halves damage when enraged. | `damage-reduction-generic` |
| 819 | Serpent Bind | 50% chance to trap, then drop the their speed by -1 each turn. | `unclassified` |
| 820 | Soul Tap | Drain 10% HP from foes at the end of each turn in fog. | `unclassified` |
| 823 | Chilling Presence | 10BP Icy Wind on entry. | `entry-effect` |
| 824 | Frostbind | Inflicting Frostbite also inflicts Disable. | `unclassified` |
| 828 | Overzealous (N) | User's super-effective moves have +1 prio. | `unclassified` |
| 830 | Temporal Rupture | Roar of Time is altered drastically. | `unclassified` |
| 831 | Grass Flute | Sound moves inflict Fear. | `unclassified` |
| 832 | Hemotoxin | Supresses abilities of the target when they're poisoned. | `unclassified` |
| 833 | Harukaze | Setting Grassy Terrain sets Tailwind and vice versa. | `weather-or-terrain-interaction` |
| 834 | Toxic Surge | sets Toxic Terrain on entry. | `entry-effect` |
| 836 | Biofilm | 50% spdef boost under Toxic Terrain. | `weather-or-terrain-interaction` |
| 837 | Chokehold | Binding moves lower speed and paralyze. | `unclassified` |
| 838 | Guardian Coat | Blocks weather dmg and powders. Takes -20% physical damage. | `weather-or-terrain-interaction` |
| 839 | Neutralizing Fog | Uses Defog on entry. | `entry-effect` |
| 842 | Festivities | Sound moves become dance moves and vice versa. | `unclassified` |
| 843 | Fey Flight | Adds Fairy-type and levitates. | `unclassified` |
| 851 | Komodo | Adds Dragon-type + moves have 30% Bad Poison chance. | `unclassified` |
| 853 | Purple Haze | Triggers a 20BP Poison Gas after using a move. | `unclassified` |
| 855 | Hyper Cleanse | Immune to status. Halves poison damage taken. | `status-immunity` |
| 862 | Thermal Slide | Ups speed by 50% in sun or hail. | `unclassified` |
| 864 | Chuckster | Once per entry, take 1/2 damage and force-switch the target. | `unclassified` |
| 866 | Relic Stone | Other battlers don't benefit from STAB. | `unclassified` |
| 868 | Lightning Aspect | Absorbs electric moves then ups highest stat by +1. | `unclassified` |
| 869 | Fire Aspect | Absorbs fire moves and always burns with fire. | `unclassified` |
| 874 | Winter Throne | 1/8 Damage each turn to non-ice. Heals Ice 1/8 each turn. | `unclassified` |
| 876 | Sludge Spit | follows up with 35BP Venom Bolt after using an attack. | `unclassified` |
| 877 | Swamp Thing | Sets the Swamp Pledge effect on entry. | `entry-effect` |
| 878 | Frosty Prescence | Uses Mist on entry. | `entry-effect` |
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
| 893 | Deep Fried | Summons a sea of fire on entry. | `entry-effect` |
| 895 | Lunar Wrath | After using a Ghost move, follow up with a 50BP Moongeist Beam. | `unclassified` |
| 896 | Spyware | Sharply raises a stat based on foe's strong point. | `unclassified` |
| 898 | Power Leak | When hit, set up Electric Terrain. | `chance-status-on-hit` |
| 899 | Backup Power | Revives at 25% HP once after fainting in Electric Terrain. | `stat-trigger-on-event` |
| 904 | Strong Foundation | Takes 1/2 Water and Ground dmg and can't be forced out. | `status-immunity` |
| 905 | Fog Machine | When hit, Set up Eerie Fog. | `chance-status-on-hit` |
| 906 | Drop Blocks | When hit, set up spikes. | `chance-status-on-hit` |
| 907 | Turf War | Destroys terrain and boosts highest stat on entry. | `entry-effect` |
| 908 | Greedy | Uses Thief when it loses an item. | `unclassified` |
| 909 | Lightsaber | Adds Fire-type. Keen Edge moves have 25% burn or paralysis. | `unclassified` |
| 910 | Loose Thorns | Sets Creeping Thorns when hit by contact. | `chance-status-on-hit` |
| 911 | Musical Notes | Status moves become sound-based. | `unclassified` |
| 913 | Strikeout | Forces the foe out if they don't attack for 3 turns. | `unclassified` |
| 914 | Home Run | Landing a crit boosts your 3 lowest stats once per turn. | `unclassified` |
| 916 | Narcissist | When a stat is lowered, sharply raise both offenses. | `unclassified` |
| 917 | Let's Dance | Uses Teeter Dance on entry, Confusing the field. | `entry-effect` |
| 921 | Flawless Precision | Fatal + Deadly Precision. | `unclassified` |
| 922 | Chainsaw | Keen edge attacks lower defense by -1. | `unclassified` |
| 925 | Mashed Potato | Syrup Bomb effect on the foe for 3 turns. | `unclassified` |
| 927 | Taste the Rainbow | Summons the Rainbow Pledge effect on entry. | `entry-effect` |
| 930 | Wings of Pestilence | Every attack has a 20% Bleed chance and 10% Curse chance. | `unclassified` |
| 933 | Hammer Fist | Boosts punch and hammer moves by 25%. | `unclassified` |
| 935 | Raging Storm | Ups highest attacking stat by 1.5x in rain. | `unclassified` |
| 937 | Sumo Wrestler | Uses 20BP Circle Throw at the end of each 2nd turn. | `unclassified` |
| 938 | Cosmic Wings | Flying moves become Fairy-type. | `unclassified` |
| 940 | Cool Exit | Uses Chilly Reception at the end of your 2nd turn. | `unclassified` |
| 941 | Devious Present | Boosts Ice and throwing moves by 50%. | `unclassified` |
| 942 | Christmas Nightmare | Enemies take 1/8 damage when in hail. | `unclassified` |
| 943 | Sap Trap | Lowers foe's speed at the end of turns. At -3 they get trapped. | `unclassified` |
| 944 | Dead Bark | Adds Ghost type. Takes 15% less damage. 30% less damage if SE. | `damage-reduction-generic` |
| 945 | Echolocation | In fog, deal 20% more damage and never miss. | `accuracy-mod` |
| 947 | I Am Steve | Uses No Retreat on entry. | `entry-effect` |
| 949 | Foamy Web | Casts an unremovable Sticky Web on entry. Lasts 5 turns. | `entry-effect` |
| 950 | Sharp Talons | Kicking moves have a 50% Bleed chance. | `unclassified` |
| 951 | Zen Garden | Sets up Grassy or Psychic Terrain at random. | `weather-or-terrain-interaction` |
| 953 | Hypnotic Trance | Hypnosis never misses and also causes Confusion. | `accuracy-mod` |
| 954 | Brain Overload | When hit, sets up Psychic Terrain. | `chance-status-on-hit` |
| 955 | Brain Mass | Halves damage taken while at full HP. | `damage-reduction-generic` |
| 958 | Giant Shuriken | Water Shuriken hits once with 100BP and +1 crit. | `unclassified` |
| 959 | Rain Shroud | Ups evasion by 30% in rain. | `unclassified` |
| 962 | Wrestle Showman | Flying Press gains +10BP and causes Taunt. | `unclassified` |
| 965 | Foggy Eye | While in Fog, boost Ghost moves by 50% and resist Ghost moves. | `unclassified` |
| 972 | Break it Down | After using an attack, follow up with a 20BP Rapid Spin. | `unclassified` |
| 973 | Talon Trap | 50% chance to trap on contact. 100% if entered this turn. | `chance-status-on-hit` |
| 975 | Backflip | After using a Dance move, follow up with a 50BP Chip Away. | `unclassified` |
| 977 | Eternal Flower | Reduces the stats of other Megas by 20%. | `form-change` |
| 979 | Hollow Ice Zone | Ice-type moves apply Ice Statue and then make the user switch. | `unclassified` |
| 980 | Overcast | Low Visibility + Sets Mist on entry. | `entry-effect` |
| 982 | Flower Necklace | This Pokémon's SpDef gets a 1.5x boost in Grassy Terrain. | `weather-or-terrain-interaction` |
| 987 | Storm Cloud | Summon rain on entry for 8 turns. Gain Electric-type STAB. | `entry-effect` |
| 989 | Drakelp Head | Weakens first move taken and drops opponent's attack. | `unclassified` |
| 990 | Polarity | Increases the party's highest stat by 30% | `unclassified` |
| 991 | Resilience | Heal 1/4 of max HP whenever below 1/2 health | `lifesteal` |
| 993 | Thunder Clouds | After using a special move, launch a 35 BP Thunderbolt | `unclassified` |
| 994 | Unrelenting | All attacking moves can hit 2-5 times | `unclassified` |
| 995 | Elemental Aegis | Takes 1/2 damage from Fire, Electric and Water-type attacks. | `unclassified` |
| 996 | Aegis Ward | Takes 1/2 damage from Dark, Ghost and Psychic-type attacks. | `unclassified` |
| 998 | Acid Reflux | Uses 20BP Acid when it takes damage. | `unclassified` |
| 1000 | Survivor Bias | Not very effective moves can't cause fainting. | `stat-trigger-on-event` |
| 1004 | Feathercoat | Takes 10% less damage from attacks, 20% if resisted. | `damage-reduction-generic` |
| 1005 | Power Outage | Boosts first Electric attack by 2x then loses Electric type. | `unclassified` |
| 1006 | Electro Booster | Uses Magnet Rise on entry. | `entry-effect` |
| 1008 | Daredevil | +1 Atk after using recoil move. 1/2 recoil damage. | `unclassified` |
| 1009 | Frost Dragon | Triggers 50 BP Blizzard after using a Dragon or Ice-type move. | `unclassified` |
| 1012 | Petal Shield | Maxes Def on entry. -1 Def when hit. | `entry-effect` |
| 1018 | Abominable Monster | Ups SpDef by 1.5x in hail. | `unclassified` |
| 1027 | Jungle Fever | If Grassy Terrain is active, gets a 1.5x Speed boost. | `weather-or-terrain-interaction` |
| 1028 | King of the Jungle | Infiltrator + deals 1.5x more damage to Grass-types. | `unclassified` |
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
