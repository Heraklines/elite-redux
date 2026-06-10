# Black Shiny ability pool — full ER ability audit (DRAFT for maintainer review)

All **1033** ER abilities were reviewed by description (June 10 2026) to find the
ones **broadly useful on almost any Pokémon** — the pool that feeds a Black
Shiny's 3 random abilities and its switchable 5th "gift" slot (whose active
choice is **shared with allies on the field**, so ally value counts too).

**Inclusion criteria**
- Works regardless of the holder's type, moveset, species or form.
- No weather / terrain / fog precondition (unless it sets it up itself).
- Not a signature / form-change / no-effect ability.
- Mild conditions are fine (calibrated on the maintainer's own example,
  Lead Coat: −40% physical taken, 0.9x Speed).

The machine-readable draft lives in
`src/data/elite-redux/er-black-shiny-gift-pool.ts` (NOT wired into gameplay —
nothing ships until the maintainer trims/approves this list).

---

## CORE POOL — recommended include (96)

### Generic offense
| id | ability | why |
|----|---------|-----|
| 37 | Huge Power | doubles Atk (physical halves the roster — see note) |
| 74 | Pure Power | doubles SpAtk |
| 301 | Cryptic Power | Pure Power clone |
| 323 | Majestic Bird | SpAtk ×1.5 |
| 55 | Hustle | ×1.4 damage at 0.9 acc — any attacker |
| 91 | Adaptability | STAB ×2 — every mon has STAB |
| 287 | Mystic Power | ALL moves gain STAB boost |
| 494 | Arcane Force | all moves STAB + SE +10% |
| 110 | Tinted Lens | double damage when resisted |
| 233 | Neuroforce | +35% on super-effective |
| 125 | Sheer Force | trade secondaries for ×1.3 |
| 148 | Analytic | ×1.3 when moving last |
| 198 | Stakeout | ×2 vs switch-ins |
| 88 | Download | +1 Atk/SpAtk on entry by foe's weaker defense |
| 424 | Equinox | boosts the weaker attack stat to match the higher |
| 86 | Simple | doubles own stat changes |
| 153 | Moxie | +1 Atk per KO |
| 533 | Hubris | +1 SpAtk per KO |
| 264 | Chilling Neigh | +1 Atk per KO |
| 265 | Grim Neigh | +1 SpAtk per KO |
| 454 | Adrenaline Rush | +1 Spe per KO |
| 858 | Breezy Neigh | +1 Spe per KO (clone) |
| 220 | Soul-Heart | +1 SpAtk on ANY faint on field |
| 771 | Forsaken Heart | +1 Atk on ANY faint on field |
| 224 | Beast Boost | +1 highest stat per KO |
| 569 | Supreme Overlord | +10% offenses per fainted ally |
| 888 | Soul Harvest | +5% offenses/SpDef per fainted mon |
| 201 | Berserk | +1 highest attack at half HP |
| 292 | Avenger | ×1.5 next move after an ally fainted |
| 640 | Rhythmic | +10% per repeated move use |
| 896 | Spyware | sharply raises a stat based on the foe |

### Generic defense
| id | ability | why |
|----|---------|-----|
| 4 | Battle Armor | crit-immune + 20% less damage |
| 75 | Shell Armor | clone |
| 753 | Crust Coat | clone |
| 709 | Dream State | clone |
| 5 | Sturdy | survive any one-shot at full HP |
| 169 | Fur Coat | halves physical |
| 246 | Ice Scales | halves special |
| 571 | Fire Scales | clone |
| 870 | Ice Plumes | clone |
| 296 | Lead Coat | −40% physical, 0.9x Spe (the maintainer's example) |
| 539 | Chrome Coat | −40% special, 0.9x Spe |
| 272 | Prism Scales | −30% special |
| 393 | Arctic Fur | −35% both |
| 1021 | Aura Armor | −35% all |
| 705 | Terastal Treasure | −40% all, −20% Spe |
| 1004 | Feathercoat | −10% / −20% if resisted |
| 111 | Filter | −35% from super-effective |
| 116 | Solid Rock | clone |
| 232 | Prism Armor | clone |
| 317 | Permafrost | clone |
| 582 | Thick Skin | clone |
| 712 | Flame Shield | clone |
| 318 | Primal Armor | −50% from super-effective |
| 136 | Multiscale | half damage at full HP |
| 231 | Shadow Shield | clone |
| 955 | Brain Mass | clone |
| 607 | Tera Shell | all hits NVE at full HP |
| 98 | Magic Guard | only damaged by attacks |
| 326 | Impenetrable | clone |
| 156 | Magic Bounce | reflects status moves |
| 763 | Conjurer Of Deceit | Magic Guard + Magic Bounce |
| 109 | Unaware | ignores foe stat changes |
| 29 | Clear Body | stat-drop immune |
| 230 | Full Metal Body | clone |
| 240 | Mirror Armor | bounces stat drops |
| 634 | Last Stand | Def/SpDef scale up as HP drops |
| 192 | Stamina | +1 Def when hit |
| 488 | Tipping Point | +1 SpAtk when hit |
| 519 | Fortitude | +1 SpDef when hit |
| 83 | Anger Point | +1 Atk when hit |
| 427 | Cheating Death | ignores the first two hits |
| 583 | Gallantry | ignores the first hit |
| 773 | Soothsayer | resists everything for 3 turns on first entry |
| 671 | Bad Omen | foes min-roll, can't crit, −5% acc |
| 597 | Olé! | 20% dodge vs single-target |
| 1000 | Survivor Bias | NVE moves can't KO |
| 724 | Lucky Halo | no self stat drops + endures one KO |
| 24 | Rough Skin | 1/8 chip on contact |
| 160 | Iron Barbs | clone |
| 574 | Sharp Edges | 1/6 chip on contact |
| 214 | Queenly Majesty | blocks priority for itself AND ally |
| 219 | Dazzling | clone |
| 567 | Armor Tail | clone |

### Sustain
| id | ability | why |
|----|---------|-----|
| 144 | Regenerator | 1/3 on switch-out |
| 30 | Natural Cure | status heal on switch |
| 483 | Natural Recovery | both of the above |
| 307 | Self Sufficient | 1/16 per turn |
| 415 | Self Repair | Self Sufficient + Natural Cure |
| 991 | Resilience | 1/4 heal whenever below half |
| 748 | Energy Siphon | heal 1/4 of damage dealt |
| 875 | Energy Tap | heal 1/8 of damage dealt |
| 737 | Life Steal | drain 1/10 from foes each turn |
| 331 | Soul Eater | KO heals 1/4 (Predator/Looter/Scavenger are clones: 345/363/364) |
| 61 | Shed Skin | 30% self status cure per turn |

### Speed / tempo / entry
| id | ability | why |
|----|---------|-----|
| 3 | Speed Boost | +1 Spe per turn |
| 234 | Intrepid Sword | +1 Atk on entry |
| 235 | Dauntless Shield | +1 Def on entry |
| 803 | Headstrong | +1 SpDef on entry |
| 330 | Majestic Moth | +1 highest stat on entry |
| 22 | Intimidate | −1 Atk to foes on entry |
| 329 | Scare | −1 SpAtk to foes on entry |
| 632 | Terrify | −2 SpAtk to foes on entry |
| 598 | Malicious | lowers foe's best Atk and Def stat |
| 677 | Petrify | clears foe buffs + −1 Spe on entry |
| 46 | Pressure | double PP drain + clears foe buffs on entry |
| 53 | Pickup (ER) | removes all hazards on entry |
| 350 | Violent Rush | +50% Spe / +20% Atk on first turn |
| 573 | Rapid Response | +50% Spe / +20% SpAtk on first turn |
| 557 | Readied Action | double damage on first turn |
| 435 | Ambush | guaranteed crit on first turn |
| 648 | On the Prowl | +1 priority on first turn |
| 370 | Opportunist | +1 priority vs foes below half |
| 259 | Quick Draw | 30% chance to move first |
| 864 | Chuckster | once per entry: half damage + phaze the attacker |
| 690 | Restraining Order | force the attacker out once per switch-in |
| 1030 | Sleek Scales | +15% Speed while defending |

### Accuracy / crit
| id | ability | why |
|----|---------|-----|
| 14 | Compound Eyes | ×1.3 accuracy |
| 35 | Illuminate | ×1.2 accuracy |
| 51 | Keen Eye | ×1.2 acc + immune to drops |
| 99 | No Guard | never miss (both ways) |
| 105 | Super Luck | +1 crit |
| 97 | Sniper | crits ×2.25 |
| 806 | Super Sniper | Sniper + punishes switches |
| 340 | Fatal Precision | SE moves never miss, always crit |
| 794 | Deadly Precision | SE never miss + ignore abilities |
| 921 | Flawless Precision | both of the above |
| 828 | Overzealous | SE moves get +1 priority |
| 815 | Overrule | crits pierce abilities, ×2 vs resists |
| 814 | Strategic Pause | +2 crit when slower + Analytic |
| 860 | Haste Makes Waste | Stall + Analytic |
| 32 | Serene Grace | doubles secondary-effect chances |
| 104 | Mold Breaker | pierce abilities |

### Ally support (shines in the SHARED gift slot)
| id | ability | why |
|----|---------|-----|
| 132 | Friend Guard | ally takes −50% |
| 217 | Battery | ally special ×1.3 |
| 249 | Power Spot | ally attacks ×1.3 |
| 672 | Mosh Pit | ally ×1.25 (×1.5 recoil moves) |
| 990 | Polarity | party's highest stat +30% |
| 162 | Victory Star | own + ally accuracy ×1.2 |
| 140 | Telepathy | no friendly fire |
| 131 | Healer | 30% per turn to cure self/ally status |
| 783 | Caretaker | Healer + Friend Guard |
| 685 | Hospitality | heal partner 25% on entry |
| 485 | Soothing Aroma | cures party status on entry |
| 165 | Aroma Veil | team CC protection |
| 175 | Sweet Veil | team sleep immunity |
| 595 | Noise Cancel | team sound immunity |
| 562 | Costar | copies ally stat changes on entry |

### CC / utility
| id | ability | why |
|----|---------|-----|
| 576 | Good As Gold | immune to status moves |
| 12 | Oblivious | CC immunity package |
| 20 | Own Tempo | confusion/Intimidate immunity |
| 39 | Inner Focus | flinch immunity |
| 553 | Guard Dog | can't be phased, inverts Intimidate |
| 242 | Stalwart | no redirection/crits/suppression |
| 547 | Purifying Salt | status-immune, −50% Ghost |
| 855 | Hyper Cleanse | status-immune, −50% poison damage |
| 19 | Shield Dust | immune to secondaries + hazards |
| 142 | Overcoat | weather/powder immune, −20% special |
| 838 | Guardian Coat | same, −20% physical |
| 151 | Infiltrator | pierce subs/screens |
| 128 | Defiant | +2 Atk when stat-dropped |
| 172 | Competitive | +2 SpAtk when stat-dropped |
| 605 | Contempt | Unaware + Defiant |
| 916 | Narcissist | sharply raise offenses when dropped |
| 555 | Egoist | raise own stats when foes raise theirs |
| 556 | Subdue | doubles own stat-drop effects |
| 127 | Unnerve | foes can't use consumables |

> Clones are listed so you can dedupe or keep for variety — the draft TS keeps
> ONE canonical id per effect group and notes the clones.

---

## BORDERLINE — your call (conditional, double-edged, or synergy-dependent)
- **Double-edged**: 126 Contrary, 637 Battle Aura (+2 crit for EVERYONE),
  577 Sharing Is Caring (stat changes shared with ALL battlers), 578–581 Ruin
  quartet (also hits your ally in doubles), 256 Neutralizing Gas, 866 Relic
  Stone (nobody gets STAB), 536 Blood Price (+30% dmg, −10% HP).
- **Needs a status/condition**: 62 Guts, 63 Marvel Scale, 95 Quick Feet,
  90 Poison Heal, 137 Toxic Boost, 138 Flare Boost, 196 Merciless,
  703 Rage Point, 772 Relentless, 284 Exploit Weakness, 414 Pretty Princess,
  305 Dreamcatcher, 534 Cosmic Daze.
- **Berry-dependent**: 82 Gluttony, 139 Harvest, 247 Ripen, 566 Cud Chew,
  652 Sugar Rush, 890 Craving.
- **Moveset-leaning but common**: 92 Skill Link, 101 Technician, 158 Prankster,
  205 Triage, 288 Perfectionist, 662 Higher Rank, 203 Long Reach,
  748-adjacent 385 Nosferatu (contact only), 510 Mycelium Might.
- **Weather/terrain SETTERS (self-enabling archetypes)**: 2 Drizzle,
  70 Drought, 45 Sand Stream, 117 Snow Warning, 226–229 Surges, 436 Atlas,
  346 Twisted Dimension, 473 Inversion, 619 Low Visibility.
- **Anti-meta tech**: 109-adjacent 147 Wonder Skin, 341 Fort Knox,
  354 Weather Control, 426 Clueless, 251 Screen Cleaner, 602 Lawnmower,
  907 Turf War, 532 Permanence, 570 Ill Will, 518 Spiteful, 546 Salt Circle,
  913 Strikeout, 943 Sap Trap.
- **Hazards-on-hit**: 400/401 Spikes, 402 Toxic Spikes, 405 Stealth Rocks,
  906 Drop Blocks, 910 Loose Thorns (universal defensively, spammy).
- **Contact-punish status**: 9 Static, 27 Effect Spore, 49 Flame Body,
  38 Poison Point, 130 Cursed Body, 183 Gooey, 221 Tangling Hair,
  618 Fragrant Daze, 928 Hypnotic Touch, 608 Toxic Chain (any-move 30% toxic
  — strong), 852 Envenom, 720 Stun Shock (60%!), 691 Assassin's Tools.
- **Self-revival**: 629 Shallow Grave / 899 Backup Power (condition-gated).

## EXCLUDED — categories (≈700 abilities)
- **Type-locked boosts/immunities/absorbs** (Blaze/Torrent/Transistor/Volt
  Absorb/Levitate/Motor Drive/Justified/…): useless without that type or
  matchup. ~190.
- **-ate converters & "Normal moves become X"** (Pixilate/Refrigerate/
  Galvanize/Fertilize/Draconize/…): moveset-warping, not universal. ~30.
- **Move-class boosts** (punch/bite/slash/kick/horn/hammer/sound/arrow/
  launcher/wing/dance/drill/throw…): need a matching moveset; pointless for
  the ally-share gimmick. ~120.
- **Weather/terrain/fog-GATED effects** (Swift Swim, Chlorophyll, Whiteout,
  Ectoplasm, every "in fog/sand/hail/rain/sun/terrain" rider): dead without
  the setup. ~90.
- **Species/form/signature** (Schooling, Zen Mode, Disguise, Stance Change,
  Battle Bond, Multitype, RKS, Commander, Angel's Wrath, Heaven Asunder,
  Temporal Rupture, Multi-Headed, As One, Embody Aspect — also id-ambiguous,
  Eternal Flower, Giant Shuriken, Wrestle Showman…). ~80.
- **On-entry move casters / gimmick openers** (Forewarn, Doombringer, Web
  Spinner, Monkey Business, Wildfire, Jumpscare, Let's Dance…): one-shot
  novelty, mostly weak. ~50.
- **Composites of excluded parts** (Seaborne, Solar Flare, Big Leaves, Magma
  Eater, Aquatic Dweller, Sand Bender, ...). ~120.
- **Negative / no-effect / unimplemented** (Truant, Slow Start, Defeatist,
  Klutz, Lethargy, Ball Fetch, Cheek Pouch, Bad Company, Wimp Out, Coward,
  Tactical Retreat…). ~25.

---

**Process**: trim/extend the CORE list and pick winners from BORDERLINE; the
TS draft mirrors this file. Once you approve, the Black Shiny spawn roll and
gift slot will draw exclusively from the approved ids.
