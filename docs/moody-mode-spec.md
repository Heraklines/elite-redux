# Consolidated Moody Mode specification

I am treating every boon you did not object to as accepted. Where you gave corrections, those corrections replace the original version. Where you said something should become an upgrade rather than a separate boon, I folded it into that line.

The active catalogue below contains **exactly 100 base boon lines**. Concepts that were removed, deferred, or still lack enough game-specific information are listed separately afterward.

## Enemy boon generation

There is no persistent enemy boon ledger and no separate “mutation” system.

For each generated enemy team:

1. Determine the player’s current **boon budget**: every boon acquisition or upgrade counts as one roll.
2. Generate the same number of boon rolls fresh for that enemy team.
3. Draw from the same rarity-weighted pool as the player.
4. Duplicate rolls upgrade or evolve an already-generated enemy boon.
5. Assign each boon to the best eligible enemy target.

Suggested targeting heuristic for Pokémon-specific boons:

```text
35% mechanical synergy with moves, abilities, items and typing
25% role importance / designated ace
20% BST and effective combat strength
10% likelihood the boon will actually trigger
10% counter-value against the player’s recent strongest Pokémon
```

When no meaningful synergy distinction exists, assign it to the eligible **highest-BST Pokémon**, normally the ace. Pair boons use the best compatible pair; move boons select the best eligible move; slot boons bind to generated roster positions or resolved roles.

The counter component can be increased for bosses. The player’s most dangerous Pokémon can be measured from recent KOs, boss-segment damage, total damage, field time, item investment, Speed dependence, physical/special bias, weather dependence, and repeated move usage. Hard counters are permitted; they are simply weighted outcomes rather than mandatory every time.

Meta boons remain part of the intended shared pool, but their enemy-generator behavior can be added later rather than inventing a second system now.

---

# Rarity and line structure

Because the player sees these only after bosses, the pool does not need low-impact filler.

| Rarity     | Approximate base weight | Intended power                                                       |
| ---------- | ----------------------: | -------------------------------------------------------------------- |
| **Great**  |                     52% | Narrow, conditional, Pokémon-specific, slot-specific                 |
| **Ultra**  |                     30% | Strong build-around or broader effect                                |
| **Rogue**  |                     14% | Team-wide, highly transformative, or unusually abusable              |
| **Master** |                      4% | Run-warping, reality-bending, revival, prediction, rule manipulation |

Each boon normally has:

* **Base:** first acquisition.
* **Rank II:** improved numbers, reliability, or additional charge.
* **Evolution A/B:** a qualitative branch after another upgrade. Team-wide ascensions normally occur here rather than as ordinary base cards.

After eight unique boon lines, upgrade and evolution offers become substantially more common. At twelve unique lines, new lines stop appearing unless the player replaces an existing one.

The numerical values below are initial balance targets.

---

# The 100 boon lines

## I. Formation and party-slot boons

### 01. Crowned Vanguard — **Great; slot**

**Base:** The occupant’s first damaging move each battle gains +1 priority.

**Rank II:** If that move already has increased priority, it gains 20% power instead.

**Evolution — Royal Vanguard:** The effect refreshes once after the occupant leaves the field and spends at least three complete turns benched.

**Evolution — Ambush Doctrine:** Every occupied party slot receives a weaker version once per battle. Existing priority moves gain 15% power.

---

### 02. Bastion Seat — **Great; slot**

**Base:** On its first entry each battle, the occupant gains a barrier equal to 20% of maximum HP.

**Rank II:** Barrier becomes 30%.

**Evolution — Citadel Seat:** After the occupant spends three turns benched, its next entry restores a 15% barrier.

**Evolution — Bastion Doctrine:** Every party member gains a 12% barrier on its first entry.

---

### 03. Relay Seat — **Great; slot**

**Base:** When the occupant voluntarily switches out, the incoming Pokémon inherits one random positive stat stage from it.

**Rank II:** It transfers up to two total stages, with no more than one stage from each stat.

**Evolution — Perfect Handoff:** It transfers the two highest available stages and removes one negative stage from the incoming Pokémon.

**Evolution — Momentum Relay:** Every voluntary switch by the team transfers one random positive stage, once per Pokémon per battle.

---

### 04. Echo Seat — **Ultra; slot**

**Base:** The occupant’s first eligible damaging move each battle repeats at 25% power.

The echo consumes no PP and does not reproduce secondary effects, recoil, charge turns, multi-hit structure, self-KO effects, or other recursively triggerable components.

**Rank II:** Echo power becomes 35%.

**Evolution — Reverberant Seat:** The boon can trigger a second time after the occupant leaves and later re-enters.

**Evolution — Echo Doctrine:** Every party member’s first eligible damaging move echoes at 15% power.

---

### 05. Sanctuary Seat — **Master; slot**

**Base:** The first major status or volatile condition directed at the occupant each battle is completely negated.

**Rank II:** The first direct stat reduction is also negated, using a separate charge.

**Evolution — Hallowed Seat:** The status/volatile protection refreshes once after the occupant re-enters.

**Evolution — Sanctuary Doctrine:** The first two qualifying effects directed at anyone on the team are negated.

---

### 06. Hungry Seat — **Great; slot**

**Base:** Every KO scored from this slot grants one Feast token, maximum three. At the beginning of the next battle, each token heals the occupant by 8% and restores 1 PP to its most depleted move.

**Rank II:** Maximum four tokens; healing becomes 10%.

**Evolution — Glutton’s Throne:** Excess healing becomes a barrier and Feast tokens are retained if the occupant begins at full HP and PP.

**Evolution — Feast for All:** Half of the generated healing and PP recovery is redirected to the lowest-HP benched ally.

---

### 07. Twin Sigil — **Ultra; two slots**

**Base:** Switching directly between the two marked slots heals the incoming Pokémon by 8%. If one occupant faints, the other gains +1 in its highest offensive stat.

**Rank II:** Switch healing becomes 12%, and the incoming Pokémon clears one negative stat stage.

**Evolution — Twin Engine:** Direct switches also transfer one random positive stat stage.

**Evolution — Last Twin:** If one partner faints, the survivor gains +1 Attack, Special Attack, and Speed for three turns.

---

### 08. Empty Throne — **Rogue; team**

**Base:** Every truly unoccupied party slot grants all conscious Pokémon +10% maximum HP and damage. Every occupied but fainted slot grants +6%.

Empty and fainted slots are counted separately, with no cap.

**Rank II:** Empty slots grant +12%; fainted slots grant +8%.

**Evolution — Solitary Kingdom:** Each empty slot additionally grants +5% Speed.

**Evolution — Court of Ashes:** Fainted slots grant the full 10% bonus, and becoming the final conscious Pokémon clears one major status and creates a 20% barrier.

---

### 09. Rotating Spotlight — **Great; rotating slot**

**Base:** One occupied slot becomes the Star each wave, following a deterministic seeded rotation. The Star gains 50% more experience and 20% power on its first damaging move.

**Rank II:** Experience becomes +75%; first-move power becomes +30%.

**Evolution — Encore:** If the Star scores a KO, it heals 10% and remains the Star for the following wave.

**Evolution — Ensemble:** The two adjacent slots receive half of the Star’s combat bonus.

---

### 10. Last Chair — **Ultra; slot**

**Base:** When the occupant becomes the final conscious party member, it heals 25%, clears negative stat stages, and gains +1 Speed. Once per battle.

**Rank II:** Healing becomes 35%, and volatile conditions are also cleared.

**Evolution — Sole Survivor:** It additionally gains +1 in its highest offensive stat and 20% damage for three turns.

**Evolution — Refusal to Fall:** It gains a 30% barrier and becomes immune to forced switching for the rest of the battle.

---

## II. Pokémon-bound identity and progression

### 11. Chosen One — **Great; Pokémon**

**Base:** The first elite or boss KO scored by the selected Pokémon during each ten-wave segment grants one permanent Glory stack. Each stack grants 2% damage, maximum ten. Fainting removes one stack.

**Rank II:** Maximum fifteen stacks; each stack also grants 0.5% damage reduction.

**Evolution — Conqueror:** Glory grants 3% damage per stack, but only boss KOs and boss health-segment breaks create stacks.

**Evolution — Living Legend:** Maximum twenty stacks and fainting no longer removes them, but ordinary elite KOs grant progress only every second time.

---

### 12. Scar Reader — **Ultra; Pokémon**

**Base:** After being damaged by an elemental type, the selected Pokémon takes 25% less damage from that type for the rest of the battle.

**Rank II:** Reduction becomes 35%.

**Evolution — Pattern Reader:** It can maintain resistance against the two most recent damaging types, each at 25%.

**Evolution — Deep Scar:** The first resistance learned in a battle remains active for the first turn of the next battle.

---

### 13. Signature Technique — **Great; exact move**

**Base:** Select one exact move. It gains 15% power, and every third use consumes no PP.

**Rank II:** Power becomes 25%; every third use also gains increased secondary-effect probability where applicable.

**Evolution — Masterpiece:** Power becomes 40%, and the move’s final PP guarantees one eligible secondary effect.

**Evolution — School Founder:** The exact-move bonus becomes smaller, but all moves sharing one selected move tag—such as slicing, sound, punch, bite, hammer, bullet, dance, recoil, or multi-hit—gain 15% power.

---

### 14. Improviser — **Great; Pokémon**

**Base:** After the selected Pokémon uses four distinct move slots during one battle, it gains +1 in a random stat. Once per battle.

All four slots count, including on Pokémon that know more than four moves.

**Rank II:** It can trigger twice per battle.

**Evolution — Virtuoso:** It triggers after three distinct move slots and rolls two random stats.

**Evolution — Improvisational Doctrine:** Every allied Pokémon can trigger a weaker one-stat version once per battle after using four distinct move slots.

---

### 15. Blood Rival — **Great; Pokémon plus elemental type**

**Base:** Select one enemy elemental type. The Pokémon deals 25% more damage to that type and heals 8% after defeating one.

**Rank II:** Damage becomes 35%; healing becomes 12%.

**Evolution — Slayer:** It also takes 20% less damage from the selected type.

**Evolution — Obsession:** Every ten KOs against that type grants a permanent additional 2% damage against it, maximum ten stacks.

---

### 16. Survivor’s Pride — **Master; Pokémon**

**Base:** Once per biome, if the selected Pokémon would faint from above 20% HP, it survives at 1 HP and gains +2 Speed.

**Rank II:** It also clears negative stat stages and volatile conditions.

**Evolution — Deathless Pride:** The trigger becomes once per boss battle.

**Evolution — Last Laugh:** The next damaging move after surviving gains 100% power and cannot miss, but the trigger remains once per biome.

---

### 17. Quiet Mentor — **Great; Pokémon affecting adjacent slots**

**Base:** At battle start, the two party slots adjacent to the Mentor gain +1 in the Mentor’s highest non-HP stat for one turn.

**Rank II:** Duration becomes two turns.

**Evolution — Senior Mentor:** Every other occupied slot receives the one-turn bonus.

**Evolution — Balanced Tutelage:** One adjacent slot receives the Mentor’s highest offensive stat; the other receives its highest defensive stat.

---

### 18. Copycat Heart — **Ultra; Pokémon**

**Base:** The first positive stat increase received by an enemy each battle is copied by the selected Pokémon.

**Rank II:** The first two increases are copied.

**Evolution — Better Than You:** Copied increases gain one additional stage, subject to the normal cap.

**Evolution — Shared Inspiration:** The first copied boost is also granted to one random adjacent ally.

---

### 19. Mithridatism — **Ultra; Pokémon with permanent status progression**

**Base:** The Pokémon tracks every major status it suffers and subsequently cures. After curing the same status three times, it gains permanent Resistance I against that status: a 50% chance to prevent that status before it is applied. Burn, Poison, Toxic, Paralysis, Sleep, and Frostbite are tracked separately.

**Rank II:** Every successful cure heals 10% HP.

After six cures of the same status, choose an evolution:

**Evolution — Acquired Immunity:** The Pokémon becomes immune to that status.

**Evolution — Weaponized Affliction:** Resistance I becomes Resistance II, a 75% chance to prevent that status. If the status is applied, the Pokémon gains 25% damage plus 20% damage reduction while afflicted.

---

### 20. Heirloom Bearer — **Ultra; Pokémon plus item stack**

**Base:** Select one exact held-item stack. Its numerical or trigger-based effect becomes 25% stronger and it cannot be stolen or suppressed.

**Rank II:** Amplification becomes 40%.

**Evolution — Living Heirloom:** Its first eligible activation each battle triggers twice.

**Evolution — Family Treasury:** A second selected item stack receives 20% amplification and suppression protection.

---

## III. Switching, pairing, and tempo

### 21. Parting Gift — **Great; slot**

**Base:** The first voluntary switch out of the marked slot each battle heals the incoming Pokémon by 10% and removes one volatile condition.

**Rank II:** Healing becomes 15%, and one negative stat stage is removed.

**Evolution — Keepsake:** The incoming Pokémon also inherits one random positive stat stage.

**Evolution — Parting Doctrine:** The first voluntary switch by every party member heals the incoming Pokémon by 8%.

---

### 22. Counterrotation — **Ultra; incoming slot**

**Base:** When the marked slot receives a Pokémon after another ally was damaged earlier during the same turn, the incoming Pokémon takes 25% less damage until the turn ends.

**Rank II:** Reduction becomes 40%.

**Evolution — Perfect Counterstep:** Its next move also gains +1 priority.

**Evolution — Counterrotation Doctrine:** Every ally can receive 20% same-turn damage reduction once per battle when switching in under those conditions.

---

### 23. Tag Combo — **Rogue; Pokémon pair**

**Base:** Mark two Pokémon. When switching directly from one partner to the other, the incoming Pokémon’s next damaging move borrows one randomly selected eligible secondary effect from a damaging move known by the outgoing partner. That borrowed effect is guaranteed.

Restrictions:

* Status moves never contribute.
* Only effects tagged as safely borrowable qualify.
* Form changes, revival, one-hit-KO logic, omniboosts, and structural move effects are excluded.
* If no eligible damaging move exists, the trigger remains unused.
* Base version triggers once total per battle.

**Rank II:** It can trigger once in each direction.

**Evolution — Relay Chemistry:** The borrowed secondary applies to the next two eligible damaging moves.

**Evolution — Double Tag:** The incoming move also produces a 20% echo using the outgoing partner’s offensive stat.

---

### 24. Hold the Line — **Great; Pokémon**

**Base:** After remaining active for three complete turns, the Pokémon gains +1 Defense and Special Defense and becomes immune to forced switching until it leaves the field.

**Rank II:** It activates after two complete turns.

**Evolution — Entrenched:** The defensive bonuses become +2.

**Evolution — Bulwark:** While entrenched, the first ally switching in behind it gains a 20% barrier.

---

### 25. Revenge Entry — **Great; Pokémon**

**Base:** Entering immediately after an ally faints grants +1 Speed and 20% move power for two turns.

**Rank II:** It also grants +1 in the Pokémon’s highest offensive stat.

**Evolution — Vengeful Sweep:** Scoring a KO during the window extends the effect by one turn.

**Evolution — Protective Revenge:** The power bonus is replaced by a 30% barrier and a full volatile-condition cleanse.

---

### 26. Turntable — **Rogue; team rhythm rule**

**Base:** Turns alternate between:

* **Offbeat:** 15% increased outgoing damage.
* **Downbeat:** 15% reduced incoming damage.

**Rank II:** Both modifiers become 20%.

**Evolution — Syncopation:** The first move used on Offbeat gains +1 priority; the first status received on Downbeat is negated.

**Evolution — Double Time:** Each beat lasts two turns and provides a stronger 25% modifier.

---

### 27. Countermelody — **Great; Pokémon**

**Base:** When the opponent uses the same move twice consecutively, the selected Pokémon’s next different move gains +1 priority, cannot miss, and deals 20% more damage.

**Rank II:** The trigger can occur twice per battle.

**Evolution — Dissonance:** The repeated enemy move’s secondary effects are suppressed on its next use.

**Evolution — Call and Response:** Every ally can trigger a weaker version once per battle.

---

## IV. Movecraft, elemental sequencing, and PP

### 28. Type Echo — **Ultra; Pokémon**

**Base:** If the previous allied damaging action came from a different Pokémon and used the same elemental type, the selected Pokémon’s next damaging move produces a 25% echo.

**Rank II:** Echo becomes 35%.

**Evolution — Resonant Pair:** Bind the effect to two Pokémon; either partner can trigger a 50% echo after the other.

**Evolution — Type Choir:** The effect becomes team-wide at 20% echo power.

---

### 29. Off-Brand Genius — **Great; Pokémon**

**Base:** Non-STAB damaging moves used by the selected Pokémon gain 20% power.

**Rank II:** Bonus becomes 30%.

**Evolution — Polymath:** Non-STAB moves also receive improved accuracy and secondary-effect probability.

**Evolution — Off-Brand Doctrine:** Every ally receives a 15% non-STAB damage bonus.

---

### 30. Specialist’s Focus — **Great; Pokémon plus elemental type**

**Base:** Select one elemental type. The Pokémon’s moves of that type gain 20% power; all of its other damaging move types lose 5%.

**Rank II:** Selected type becomes +35%; other types become −10%.

**Evolution — Fanatic:** Selected type becomes +55%; other types become −15%.

**Evolution — Specialist Doctrine:** Every ally receives +15% for the selected type and −5% for other damaging types.

---

### 31. Conservation Law — **Ultra; Pokémon**

**Base:** The Pokémon’s moves become stronger as their remaining PP decreases:

* Below half PP: +8%
* At or below one-quarter: +20%
* Final PP: +35%

**Rank II:** Bonuses become +15%, +30%, and +50%.

**Evolution — Final Reserve:** Final PP gains 100% power and guarantees one eligible secondary effect.

**Evolution — Conservation Doctrine:** Every ally receives a weaker +5%, +15%, and +30% version.

---

### 32. Deep Reservoir — **Great; exact move**

**Base:** The selected move gains 3 maximum PP. Every fifth use restores 1 PP to the Pokémon’s most depleted other move.

**Rank II:** It gains 5 PP and triggers every fourth use.

**Evolution — Artesian Move:** The restoration grants 1 PP to every depleted other move.

**Evolution — Deep Wells:** Every move gains 2 maximum PP, while the selected move retains the restoration trigger.

---

### 33. Full Repertoire — **Ultra; Pokémon**

**Base:** The first use each battle of a Physical, Special, and Status move rolls a non-repeating reward from a broad pool:

* 20% barrier
* Heal 20%
* Restore 3 total PP
* Remove one major status or volatile condition
* +1 random stat
* Next move gains +1 priority
* Next damaging move guarantees an eligible secondary effect
* Temporary resistance to the last damaging type received

Using all three categories triggers **Curtain Call**, rolling two additional rewards.

Only Pokémon that can use all three move categories, or can realistically learn them, are eligible.

**Rank II:** Reward magnitudes increase by approximately 25%.

**Evolution — Virtuoso:** Curtain Call triggers after two categories, while using all three grants another reward.

**Evolution — Repertoire Doctrine:** Every party member receives a reduced version, but only one category reward per category per battle.

---

### 34. Refrain — **Ultra; exact move**

**Base:** Consecutive use of the selected move escalates both power and PP cost:

| Consecutive use | Power | PP cost |
| --------------- | ----: | ------: |
| First           |  100% |       1 |
| Second          |  120% |       2 |
| Third           |  145% |       3 |
| Fourth+         |  175% |       4 |

Using another move, switching, missing, or failing resets the sequence.

**Rank II:** Maximum power becomes 200%.

**Evolution — Crescendo:** Later repetitions reach still higher power, with unchanged PP escalation.

**Evolution — Efficient Refrain:** PP costs become 1/1/2/3, but maximum power remains 175%.

---

### 35. Failure Is Data — **Ultra; Pokémon**

**Base:** The first move each battle that misses, fails, or hits an immunity refunds its PP, grants +1 Speed, and makes the Pokémon’s next move unable to miss.

**Rank II:** Two activations per battle.

**Evolution — Scientific Method:** The next eligible secondary effect is also guaranteed.

**Evolution — Team Research:** Every allied Pokémon can trigger the base effect once per battle.

---

### 36. Overdraft — **Ultra; exact move**

**Base:** The selected move may be used at zero PP once per battle by paying 20% maximum HP. The overdrawn use gains 30% power and guarantees one eligible secondary effect.

**Rank II:** HP cost becomes 15%; power bonus becomes 45%.

**Evolution — Blood Credit:** It may be overdrawn twice, but the second use costs 30% maximum HP.

**Evolution — Emergency Funding:** Any move can be overdrawn once per battle, but the guaranteed secondary effect is removed.

---

### 37. Final Draft — **Rogue; exact move**

**Base:** When the selected move reaches its final PP, choose one ending:

* **Climax:** +100% power.
* **Precision:** perfect accuracy and guaranteed eligible secondary effect.
* **Revision:** normal use, then restore 2 PP by paying 15% maximum HP.

Because this choice happens only at a highly specific moment, it is acceptable despite minimizing routine battle pop-ups.

**Rank II:** Climax becomes +130%, Revision restores 3 PP, and Precision also gains 20% power.

**Evolution — Director’s Cut:** Choose two endings, but the move becomes unusable for the rest of that battle afterward.

**Evolution — Collected Works:** Every move can trigger a weaker Final Draft once per battle.

---

## V. Weather, terrain, and elemental field manipulation

### 38. Prismatic Opening — **Rogue; Pokémon**

**Base:** The selected Pokémon’s first damaging move each battle becomes the most effective legal elemental type against its target, but deals 30% less damage.

Explicit type immunities still apply.

**Rank II:** Penalty becomes 20%.

**Evolution — Perfect Refraction:** The penalty is removed.

**Evolution — Prismatic Doctrine:** Every allied Pokémon receives one use, but at a 35% penalty.

---

### 39. Elemental Dividend — **Rogue; team**

**Base:** The first time each allied Pokémon exploits an elemental weakness during a battle, it gains a 20% barrier. Exploiting a 4× weakness creates a 40% barrier.

**Rank II:** Values become 25% and 50%.

**Evolution — Diversified Portfolio:** The Pokémon may trigger again by exploiting a different weakness type.

**Evolution — Compound Elements:** Barrier above 100% maximum HP converts into healing. Any amount left after reaching full HP grants the next damaging move up to 50% more power, at one percentage point per 1% maximum HP converted.

---

### 40. Chromatic Relay — **Rogue; team sequence**

**Base:** Consecutive allied damaging moves using distinct elemental types gain:

* Second distinct type: +15%
* Third: +40%
* Fourth: +90%

Repeating a type resets the chain. Switching does not.

**Rank II:** Missing or failing no longer resets the chain; only repeating a type does.

**Evolution — Spectrum Break:** The fourth distinct move also ignores 25% of the target’s defenses and guarantees an eligible secondary effect.

**Evolution — Endless Spectrum:** Every additional new type after the fourth remains at +90% and heals the acting Pokémon by 10%.

---

### 41. Microclimate — **Ultra; slot**

**Base:** On the marked slot’s first entry each battle, choose one of three seeded weather options. The selected weather lasts three turns.

**Rank II:** Four weather options and four turns.

**Evolution — Stormglass Heart:** All available weather conditions are offered and last five turns.

**Evolution — Mobile Front:** The effect can activate a second time after the occupant leaves and re-enters, but each weather lasts only three turns.

---

### 42. Eye of the Storm — **Rogue; team/weather**

**Base:** Once per battle, when weather naturally ends or is replaced, the active Pokémon heals 30% and restores 5 total PP, distributed to its most depleted moves.

**Rank II:** Healing becomes 40%; PP restoration becomes 8.

**Evolution — Calm Center:** It also gains a 25% barrier.

**Evolution — Storm Communion:** The effect can trigger twice, and the lowest-HP benched ally heals 15%.

---

### 43. Climate Contrarian — **Great; Pokémon**

**Base:** Moves used by the selected Pokémon that would normally be weakened by the current weather ignore that penalty and instead gain 10% power.

**Rank II:** Bonus becomes 20%.

**Evolution — Perverse Climate:** These moves are treated as weather-boosted for relevant interactions and secondary mechanics.

**Evolution — Contrarian Doctrine:** Every ally receives the 10% version.

---

### 44. Terrain Weaver — **Ultra; grounded slot**

**Base:** On the marked grounded slot’s first entry, choose one of three seeded terrain options. It lasts three turns.

**Rank II:** Four turns and access to every normal terrain option.

**Evolution — Landshaper:** It can activate a second time after re-entry.

**Evolution — Territorial Claim:** Benefits provided by the chosen terrain are 25% stronger for the player’s side.

---

### 45. Four Seasons — **Rogue; field rule**

**Base:** The battlefield cycles through Sun, Rain, Sand, and Snow every four turns, with a one-turn warning. Each transition heals the active Pokémon by 5%.

**Rank II:** Transitions occur every three turns and heal 8%.

**Evolution — Five Seasons:** Fog joins the cycle and every weather receives a distinct transition effect.

**Evolution — Seasonal Memory:** For one turn after a transition, the active Pokémon retains the outgoing weather’s beneficial effects in addition to the new weather.

---

### 46. Battlefield Memory — **Master; cross-battle field state**

**Base:** Permitted weather, terrain, hazards, and side conditions present at the end of a trainer battle persist for exactly one turn of the next trainer battle.

Enemy setters can immediately replace them. Scripted biome weather, form-controller states, and explicitly nonpersistent effects are excluded.

**Rank II:** Persistence becomes two turns.

**Evolution — Home-Field Memory:** Carried beneficial effects operate 25% more strongly for the player.

**Evolution — Selective Memory:** Harmful player-side hazards and conditions are not carried.

---

### 47. Weather Wake — **Ultra; weather transition**

**Base:** Replacing or ending weather creates a final aftereffect:

* **Sun:** The next Fire move gains 30% power.
* **Rain:** The active Pokémon heals 15%.
* **Sand:** The player receives a one-turn Reflect-like effect reducing physical damage by 25%.
* **Snow:** The player receives a one-turn Light Screen-like effect reducing special damage by 25%.
* **Fog:** The active Pokémon gains +1 Accuracy, and its next eligible secondary-effect chance increases by 20 percentage points.

The Sand and Snow effects are temporary directional screens, not absorbable HP barriers.

**Rank II:** Power, healing, and mitigation increase by approximately one-third.

**Evolution — Lingering Wake:** The aftereffect lasts two turns.

---

## VI. Status-oriented playstyles

### 48. Adrenal Condition — **Great; Pokémon**

**Base:** The first major status received each battle grants +1 Speed and 15% increased damage while the status remains.

**Rank II:** It also grants +1 in the Pokémon’s highest offensive stat.

**Evolution — Conditioned Athlete:** Every distinct major status can trigger once per battle.

**Evolution — Adrenal Doctrine:** Every ally gains +1 Speed and 10% damage when first statused.

---

### 49. Burning Resolve — **Great; Pokémon**

**Base:** Burn no longer reduces the selected Pokémon’s Attack. While burned, it gains 20% Special Defense.

**Rank II:** It also gains 20% Attack.

**Evolution — Cauterized:** Burn damage is halved, and dealing direct damage heals 5%.

**Evolution — Burning Doctrine:** Every allied Pokémon ignores burn’s Attack reduction.

---

### 50. Toxic Bloom — **Rogue; team**

**Base:** Poison cannot directly reduce an allied Pokémon below 1 HP. Poisoned allies deal 25% more damage. Scoring a KO resets the toxic counter to its first stage.

Poison damage still occurs normally and still escalates until reset.

**Rank II:** Damage bonus becomes 35%.

**Evolution — Venom Garden:** When a poisoned ally scores a KO, the replacement enemy becomes normally poisoned where legally possible.

**Evolution — Toxic Renewal:** Half of poison damage suffered becomes a temporary barrier after the damage resolves.

---

### 51. Insomniac Dreams — **Ultra; Pokémon**

**Base:** While asleep, the selected Pokémon may continue using Status moves at −1 priority. Its maximum sleep duration is reduced by one turn.

**Rank II:** Status moves operate at normal priority.

**Evolution — Lucid Dreamer:** It may also use explicitly tagged dream, Psychic, or Ghost damaging moves at 50% power while asleep.

**Evolution — Shared Dream:** Whenever it successfully acts while asleep, one adjacent ally gains +1 in a random stat.

---

### 52. Frostbound Time — **Ultra; Pokémon**

**Base:** The first time each battle the selected Pokémon receives Frostbite, the condition’s penalties are suppressed and it gains a 25% barrier. It still counts as Frostbitten for synergies. Frostbite is cured when the barrier breaks or after two turns.

**Rank II:** Barrier becomes 35% and can last three turns.

**Evolution — Permafrost Engine:** While the barrier remains, special damage increases by 25%.

**Evolution — Thaw Burst:** When Frostbite is cured, the Pokémon heals 20% and its next move guarantees an eligible secondary effect.

---

### 53. Shared Antibodies — **Rogue; team**

**Base:** When any ally cures a major status, the entire team becomes immune to that status for three turns.

**Rank II:** Immunity lasts five turns.

**Evolution — Herd Immunity:** The initial cure also heals every conscious ally by 10%.

**Evolution — Adaptive Serum:** The first attempted application of that status during the immunity window is reflected onto its source.

---

### 54. Status Bank — **Master; team**

**Base:** The first incoming major status each battle is stored rather than applied. The next damaging allied hit applies the stored status to its target where legal.

If the target is invalid, the status remains stored.

**Rank II:** The bank can store two statuses in order.

**Evolution — Interest-Bearing Status:** A status held for a full turn upgrades where applicable—for example, normal poison becomes toxic poison.

**Evolution — Joint Account:** The first two incoming statuses are stored, and the next two valid damaging hits withdraw them separately.

---

### 55. Misery Loves Company — **Rogue; team**

**Base:** Statused allies take 15% less damage from unstatused enemies and use Status moves with +1 priority.

**Rank II:** Damage reduction becomes 20%.

**Evolution — Schadenfreude:** Statused allies also deal 20% more damage to unstatused enemies.

**Evolution — Shared Misery:** When an ally first becomes statused, the lowest-HP other ally gains a 15% barrier.

---

### 56. Volatile Memory — **Ultra; Pokémon**

**Base:** After the selected Pokémon suffers a particular volatile condition—confusion, Taunt, Encore, flinching, and similar—it cannot receive that same condition again for the remainder of the battle.

**Rank II:** The initial volatile condition expires one turn earlier.

**Evolution — Long Memory:** The acquired immunity persists through the following battle.

**Evolution — Collective Memory:** Once one ally suffers a volatile condition, the entire team becomes immune to that condition for the remainder of the battle.

---

### 57. Purge Pulse — **Ultra; team action counter**

**Base:** Every fifth allied action removes one negative stat stage, major status, or volatile condition from the active Pokémon and inflicts minor typeless damage on the enemy.

**Rank II:** Triggers every fourth action.

**Evolution — Purifying Wave:** It removes every effect from one selected category: stages, status, or volatiles.

**Evolution — Contaminant Burst:** Damage scales with the number and severity of effects removed.

---

### 58. Aftercare — **Ultra; Pokémon**

**Base:** Curing a major status grants a status-specific rebound:

* Burn: +1 Attack.
* Poison/Toxic: heal 20%.
* Paralysis: +1 Speed.
* Sleep: next action gains +1 priority.
* Frostbite: gain a 25% barrier.

**Rank II:** Healing and barrier values increase, and stat rebounds last for the remainder of the current field appearance.

**Evolution — Rehabilitation:** Each distinct status can trigger its rebound once per battle.

**Evolution — Community Care:** Adjacent active allies receive half of the healing or barrier rebound. Their Attack or Speed rebound lasts one turn; the Sleep rebound still applies only to their next action.

---

## VII. Barriers, survival, healing, and fainting

### 59. Overflow Ward — **Great; Pokémon**

**Base:** Excess healing received by the selected Pokémon becomes a barrier, maximum 25% of maximum HP.

**Rank II:** Maximum barrier becomes 40%.

**Evolution — Reservoir:** Barrier may reach 60%, but decays by 10% per turn above 40%.

**Evolution — Overflow Doctrine:** Every ally receives the base effect with a 20% cap.

---

### 60. Shared Cup — **Ultra; team**

**Base:** Half of all excess healing is redirected to the lowest-HP benched ally.

**Rank II:** Redirected proportion becomes 75%.

**Evolution — Communion:** Healing is distributed among all damaged benched allies.

**Evolution — Overflow Vintage:** Excess redirected healing becomes barriers on the recipients.

---

### 61. Damage Ceiling — **Rogue; slot**

**Base:** The first hit each battle that would deal more than 60% of the occupant’s maximum HP is capped at 60%.

**Rank II:** Cap becomes 50%.

**Evolution — Shatterproof Seat:** The protection refreshes once after the occupant leaves and re-enters.

**Evolution — Ceiling Doctrine:** Every ally’s first qualifying hit is capped at 70%.

---

### 62. Layered Armor — **Great; Pokémon**

**Base:** Each additional hit from the same multi-hit move or same-turn attack sequence deals 20% less damage multiplicatively.

**Rank II:** Reduction becomes 30%.

**Evolution — Ablative Layers:** Echoes, follow-up attacks, and chained damage from the same originating action count as part of the sequence.

**Evolution — Layered Doctrine:** Every ally receives a 15% reduction per subsequent hit.

---

### 63. Emergency Shell — **Ultra; team**

**Base:** The first time an ally falls below 25% HP, it clears negative stat stages and gains a 20% barrier.

**Rank II:** Barrier becomes 30%, and volatile conditions are cleared.

**Evolution — Emergency Protocol:** Every Pokémon can trigger the effect once per battle.

**Evolution — Counter-Shell:** The protected Pokémon’s next damaging move gains 50% power.

---

### 64. Guarded Setup — **Ultra; team**

**Base:** The first non-damaging move used by each Pokémon each battle creates a 15% barrier before the move resolves.

**Rank II:** Barrier becomes 25%.

**Evolution — Safe Preparation:** The barrier also blocks the first incoming major status while it remains.

**Evolution — Offensive Guard:** If the move raises stats, the user’s next damaging move gains 20% power.

---

### 65. Rest Cycle — **Great; team**

**Base:** Pokémon that never enter the current battle recover 15% HP and 1 PP for every move before the next battle.

**Rank II:** Recovery becomes 25% HP and 2 PP.

**Evolution — Deep Rest:** Major statuses and volatile conditions are also cured.

**Evolution — Rotation Plan:** After sitting out one battle, the Pokémon gains +1 in its highest stat on its next entry.

---

### 66. Last Rites — **Rogue; team**

**Base:** When an ally faints, the next Pokémon entering gains one random eligible move known by the fallen ally as a temporary additional move with 1 PP.

* It may become the fifth through eighth move.
* A Pokémon already holding eight moves gains nothing.
* The move disappears at battle end.
* Signature structural moves, transformation moves, one-hit-KO moves, and other invalid moves are excluded.

**Rank II:** The temporary move gains 2 PP.

**Evolution — Inheritance:** Three eligible moves are pre-rolled and the player chooses one upon entry.

**Evolution — Final Testament:** The entrant also gains one random compatible ability of the fallen Pokémon for one turn.

---

### 67. No One Left Behind — **Rogue; team**

**Base:** Winning with exactly one conscious Pokémon revives two random fainted allies at 25% HP. Once per ten-wave segment.

**Rank II:** Revives three allies at 35%.

**Evolution — Rally:** Revives every fainted ally at 25%.

**Evolution — Chosen Rescue:** Revives two selected allies at 50%.

---

### 68. Phoenix Clause — **Master; Pokémon**

**Base:** The selected Pokémon revives at 25% HP once per ten-wave segment.

**Rank II:** Revival becomes 40% and clears statuses and negative stages.

**Evolution — Eternal Ember:** It can trigger once per boss battle.

**Evolution — Ashen Return:** It revives at 25% with +1 to all stats for three turns.

---

### 69. Dead Man’s Action — **Ultra; Pokémon**

**Base:** If the selected Pokémon has committed a damaging move but faints before acting, it performs that move at 50% power immediately before leaving the field.

**Rank II:** Power becomes 75%.

**Evolution — Last Word:** The move occurs at full power and retains eligible secondary effects.

**Evolution — Posthumous Support:** Eligible Status moves can also resolve after the user faints.

---

### 70. Glass Memory — **Ultra; Pokémon**

**Base:** Damage absorbed by the selected Pokémon’s barriers is recorded. When the barrier breaks, its next damaging move adds typeless bonus damage equal to 50% of the recorded amount, capped at 50% of the user’s maximum HP.

**Rank II:** Conversion becomes 75%, with a 75% maximum-HP cap.

**Evolution — Shattered Retort:** In multi-target battles, the stored damage can strike every enemy at reduced strength.

**Evolution — Tempered Glass:** If the barrier expires intact, the stored value converts into healing and PP instead.

---

### 71. Deferred Pain — **Rogue; Pokémon**

**Base:** The selected Pokémon receives 65% of incoming direct damage immediately. The remaining 35% becomes Damage Debt and is paid at the end of the following turn.

Healing received before collection reduces the debt point-for-point. Debt follows the Pokémon through switching and can cause a faint. Total stored debt is capped at 50% maximum HP.

**Rank II:** The split becomes 50/50.

**Evolution — Debt Restructuring:** Barriers can absorb Damage Debt when it matures.

**Evolution — Collection Notice:** If the debt is completely eliminated through healing or barriers, the next damaging move gains power based on the amount erased.

---

## VIII. Economy, capture, items, and team construction

### 72. Compound Interest — **Great; economy**

**Base:** After every boss, gain 5% of your current unspent money. Total interest earned is capped at 25% of your current money.

**Rank II:** Growth becomes 7.5%.

**Evolution — Patient Capital:** The total-interest cap becomes 50% of current money. Each biome transition also pays 3% of current unspent money within that cap.

**Evolution — Aggressive Investment:** Growth becomes 10%, but purchasing anything resets accumulated interest growth.

---

### 73. Warranty — **Rogue; Pokémon plus consumable stack**

**Base:** Select one consumable item stack. Its first activation each battle does not consume a stack.

**Rank II:** Its first two activations do not consume stacks.

**Evolution — Lifetime Warranty:** The first activation is doubled as well as preserved.

**Evolution — Extended Warranty:** Every party member’s first consumable has a chance not to be consumed, but the selected stack retains guaranteed preservation.

---

### 74. Recycler — **Rogue; reward screen**

**Base:** Once per reward screen, destroy one offered option to reroll the other two with improved base-rarity weighting.

**Rank II:** Rerolled options cannot fall below their original base rarity.

**Evolution — Closed Loop:** The destroyed item’s exact category is excluded from both rerolls.

**Evolution — Upcycler:** Destroy two options to generate one item guaranteed to be at least one base tier higher before Luck.

---

### 75. Set Collector — **Ultra; item and vitamin sets**

**Base:** Three distinct items from a set activate its three-piece bonus; five activate its five-piece bonus. Duplicate stacks do not count. **Complete Nutrition** (HP Up, Protein, Iron, Calcium, Zinc, Carbos): all stats +5%/+10%. **Restoration Kit** (Leftovers, Shell Bell, Healing Charm, Berry Pouch, Reviver Seed): direct healing +15%/+25%, plus a 10% max-HP barrier on the first heal at five pieces. **Tactician's Tools** (Quick Claw, King's Rock, Wide Lens, Grip Claw, Baton): accuracy +10%, then also +1 priority and +10% power to the first move. **Volatile Core** (Toxic Orb, Flame Orb, Frostbite Orb, Focus Band, White Herb): damage +8%/+15%, then self-inflicted status damage is halved.

**Rank II:** One chosen set requires one fewer distinct item.

**Evolution — Curator:** Two different set bonuses can be active simultaneously without conflict.

**Evolution — Complete Collection:** One chosen five-piece becomes stronger: Complete Nutrition +15% all stats; Restoration Kit +35% healing and a 15% barrier; Tactician's Tools +15% accuracy, +1 first-move priority, and +25% first-move power; Volatile Core +25% damage and 25% self-inflicted status damage.

---

### 76. Blood Market — **Ultra; biome market**

**Base:** At a biome market, one item can be purchased through Blood Debt rather than money. The debt is placed on the most-used Pokémon from the preceding biome and reduces its maximum HP until the next biome transition.

Debt scales with item tier. The player cannot dump the cost onto an irrelevant bench Pokémon.

**Rank II:** Blood Debt is approximately 25% smaller.

**Evolution — Split Bill:** Debt may be divided between the two most-used Pokémon.

**Evolution — Blood Premium:** The purchased item receives an additional stack or enhanced effect, but the debt is increased.

---

### 77. Bounty Board — **Ultra; ten-wave contract**

**Base:** After a boss, accept one feasible optional objective for the following segment. Completion awards a high-tier item and a chance at a relic.

Possible objective families include:

* No allied faint.
* No healing.
* No consecutive move repetition.
* Use at least five elemental types.
* Every conscious party member must act.
* Lowest-level Pokémon scores a KO.
* Break a boss segment with a designated Pokémon.
* Do not use super-effective attacks.
* Inflict several distinct statuses.
* Do not trigger consumables.
* Switch a minimum number of times.
* No Pokémon scores more than one KO.
* Maintain a marked Pokémon above a health threshold.
* Win under a designated weather.
* Complete the boss under a turn limit.

Only objectives that the current party and moves can complete are offered.

**Rank II:** Three feasible contracts are offered and reward quality improves.

**Evolution — Master Contract:** A substantially harder objective guarantees a Master-tier reward.

**Evolution — Relic Hunter:** Completing a two-segment contract chain guarantees a choice among relics.

---

### 78. Recruiter’s Eye — **Rogue; capture and collection**

**Base:** The first eligible wild encounter in each biome is generated with at least one collectible trait not yet owned for that species, where one exists.

Eligible missing traits include:

* One of the catchable active abilities not yet obtained.
* An egg move not yet obtained.
* A nature not yet obtained.

The first capture attempt also reveals the target’s IVs and which guaranteed missing-trait category it carries.

**Rank II:** It guarantees two different missing traits when possible.

**Evolution — Ability Hunter:** Uncaught active abilities receive the highest priority.

**Evolution — Completionist:** The generator prioritizes the rarest remaining missing trait and grants a modest catch-rate bonus against that target.

No hidden-form data or unnecessary move-pool information is added.

---

### 79. Contraband Slot — **Master; item stack**

**Base:** Select one exact item stack. It ignores one normal compatibility or stack-cap restriction and cannot be suppressed.

**Rank II:** It ignores both compatibility and cap restrictions and receives 25% effect amplification.

**Evolution — Black-Market Arsenal:** A second stack receives the base effect.

**Evolution — Smuggler King:** The selected stack may exceed its normal cap by two additional increments.

---

### 80. Diversity Charter — **Rogue; team composition**

Count every unique elemental type represented anywhere in the party exactly once. Dual- and triple-typed Pokémon may contribute multiple types, but duplicate types add nothing.

**Base thresholds are cumulative:**

* 4 unique types: +5% maximum HP.
* 6 unique types: +10% damage.
* 8 unique types: +8% damage reduction.
* 10 unique types: +10% Speed.
* 12 unique types: first damaging move by each Pokémon gains 15% power.

**Rank II:** Thresholds become 3/5/7/9/11.

**Evolution — Cosmopolitan Team:** Every numerical bonus is multiplied by 1.5.

**Evolution — Adaptive Charter:** At ten unique types, the first super-effective hit received by each Pokémon also creates a 15% barrier.

---

### 81. Monotype Oath — **Ultra; team plus elemental type**

**Base:** Select one elemental type. Every party member sharing that type grants all matching party members +4% damage with that type and +3% maximum HP, maximum six contributors.

**Rank II:** Values become +5% and +4%.

**Evolution — Pure Doctrine:** If every conscious party member shares the type, their first damaging move each battle gains +1 priority.

**Evolution — Protective Oath:** Matching Pokémon also gain 5% resistance per contributor against attacks of the selected type.

---

### 82. Underdog Dividend — **Great; Pokémon**

**Base:** A selected Pokémon at least five levels below the current party average gains 2% to non-HP stats per missing level, maximum 20%, and 50% increased experience.

If it is not fully evolved, both bonuses are multiplied by 1.25. Mega Evolution does not count as an ordinary evolution stage for this check.

**Rank II:** Maximum stat compensation becomes 30%; experience becomes +75%.

**Evolution — Giant Killer:** The temporary combat bonus doubles against enemies above its own level.

**Evolution — Graduate:** When it catches up, it retains a permanent 5% stat bonus.

---

### 83. Growth Ring — **Ultra; not-fully-evolved Pokémon**

**Base:** A Pokémon that is not fully evolved gains 20% to all stats. Mega Evolution is irrelevant to eligibility.

**Rank II:** Bonus becomes 30%.

**Evolution — Evergrowth:** When the Pokémon evolves, it permanently retains 10% and the Ring can be reassigned.

**Evolution — Refusal to Grow:** The Pokémon remains eligible while unevolved and receives 40% stats plus 10% move power.

---

### 84. Flawless Ledger — **Rogue; persistent reward progression**

**Base:** Flawless waves build progress toward permanent Ledger marks. A wave is flawless when no allied Pokémon faints.

Mark requirements escalate:

```text
Mark 1: 2 flawless waves
Mark 2: 2 more
Mark 3: 3 more
Mark 4: 3 more
Mark 5: 4 more
Mark 6: 4 more
...and so forth
```

A nonflawless wave resets progress toward the next mark but does not remove earned marks.

Every two marks produce one permanent **pre-Luck rarity uplift**:

* Two marks: one reward slot gains +1 base rarity.
* Four marks: two reward slots gain +1.
* Six marks: three reward slots gain +1.
* Eight marks: one slot gains a second uplift.
* Further pairs continue wrapping across available reward slots.

Luck is applied only afterward.

**Rank II:** The first failed flawless streak in each biome does not reset current progress.

**Evolution — Exact Accounting:** The player chooses which reward slots receive the uplifts.

**Evolution — Compound Ledger:** Every third uplift also increases the quantity or stack size of one reward.

---

### 85. Hunter’s Mark — **Great; elemental enemy type**

**Base:** Select one enemy type. Every ten KOs against that type grants a choice between:

* +15% damage against it.
* +15% resistance to its attacks.
* +15% capture effectiveness against it.

**Rank II:** Threshold becomes eight KOs.

**Evolution — Apex Hunter:** Boss health segments belonging to that type count as three KOs.

**Evolution — Broad Hunt:** Select a second type, but both types receive only 75% of the accumulated bonuses.

---

## IX. Bonds, training, and inherited progression

### 86. Pair Bond — **Ultra; two Pokémon**

**Base:** While both marked Pokémon remain conscious, each deals 10% more damage. Directly switching between them heals the incoming partner by 8%. If one faints, the other gains +1 in its highest offensive stat for two turns.

**Rank II:** Damage becomes 15%; switch healing becomes 12%.

**Evolution — Soulmates:** Direct switching also transfers one random positive stat stage.

**Evolution — Avenger Bond:** When one partner faints, the survivor gains +1 to all stats and temporarily borrows one eligible move from the fallen partner.

---

### 87. Bench Academy — **Great; rotating Pokémon target**

**Base:** The lowest-level party member receives double experience only while it is at least five levels below the party average.

When it reaches within four levels, the Academy retargets. Each successful graduation grants the whole team a permanent 1% maximum-HP bonus, maximum ten graduations.

**Rank II:** Experience becomes +150%.

**Evolution — Elite Academy:** Graduation also transfers one selected vitamin stack from a donor at partial value.

**Evolution — Peer Tutoring:** The second-lowest eligible Pokémon receives half of the experience bonus.

---

### 88. Bossbreaker — **Ultra; Pokémon**

**Base:** Whenever the selected Pokémon breaks a boss health segment, it heals 15% and gains 20% damage for two turns.

**Rank II:** Healing becomes 25%; damage becomes 30%.

**Evolution — Segment Eater:** It also restores 3 total PP.

**Evolution — Veteran Breaker:** Every three segments broken grants a permanent 2% boss-damage bonus, maximum five stacks.

Only actual boss health segments count.

---

### 89. Legacy Slot — **Rogue; slot**

**Base:** When the occupant is permanently replaced or released, select one compatible progression-based Pokémon boon it possessed. The slot stores 50% of its stacks or progression for the next occupant.

Eligible examples include Chosen One, Mithridatism, Hunter’s Mark, and Bossbreaker. Binary mythic effects are not eligible.

**Rank II:** Inheritance becomes 75%.

**Evolution — Dynasty:** The slot can preserve two separate progression imprints.

**Evolution — Perfect Succession:** One imprint transfers at 100%, but the slot cannot store a second one.

---

## X. Mythic and rule-bending boons

### 90. Time Loop — **Master; boss battle rule**

**Base:** Once per boss battle, when the first allied Pokémon would faint, combat rewinds to the beginning of that turn. The player may choose different actions.

Repeating the same actions recreates the same outcome unless a changed action alters what happens next.

**Rank II:** The player may decline the automatic rewind and save it for a later faint.

**Evolution — Deja Vu:** After rewinding, the previously selected enemy actions remain visible before the player recommits.

**Evolution — Second Timeline:** One non-boss battle per ten-wave segment can also be rewound.

---

### 91. Recapitulation — **Master; team action history**

**Base:** Every third allied damaging action causes spectral versions of the two previous allied damaging moves to strike the current target at 33% power.

Echoes:

* Consume no PP.
* Do not reproduce secondary effects.
* Do not reproduce recoil, multi-hit logic, charge turns, self-KO, or recursive triggers.
* Use their original attackers’ offensive stats.

**Rank II:** Echo power becomes 40%.

**Evolution — Grand Recap:** The third move also echoes itself at 20% power.

**Evolution — Extended History:** Every fourth action replays the previous three moves at 30% power.

---

### 92. Pocket Turn — **Ultra; team resource**

**Base:** Missing, hitting an immunity, or being completely blocked generates one Tempo, maximum three. At three Tempo, the next allied move gains +1 priority and produces a 50% echo.

**Rank II:** Only two Tempo are required.

**Evolution — Stored Tempo:** The team can bank enough Tempo for two Pocket Turns.

**Evolution — Time Theft:** Consuming Tempo also reduces the target’s move priority by one for that action.

---

### 93. Ability Carousel — **Master; team formation**

**Base:** At battle start, every Pokémon temporarily gains one random compatible ability from the next occupied party slot in addition to its existing abilities.

* It cannot borrow an ability it already has.
* A Pokémon with four abilities can temporarily have a fifth.
* The ability lasts one turn.
* Form-controller, mutually exclusive, structurally invalid, and duplicate-prohibited abilities are filtered out.
* There is no repeated player choice; selection is seeded and random.

**Rank II:** Duration becomes two turns.

**Evolution — Fast Carousel:** The effect triggers again on the first direct switch between adjacent occupied slots.

**Evolution — Grand Carousel:** The borrowed ability is drawn from either adjacent slot using compatibility and synergy weights.

---

### 94. Mirror Theft — **Master; team**

**Base:** The first enemy-created positive stat increase, weather, terrain, hazard, or side condition each battle is copied to the player’s side where logically possible.

**Rank II:** The first two eligible effects are copied.

**Evolution — Perfect Theft:** The copied effect is removed from the enemy after being stolen.

**Evolution — Hall of Mirrors:** Each allied Pokémon may copy one enemy stat increase once per battle.

---

### 95. Phase Shift — **Master; turn rule**

**Base:** Every fifth turn is visibly marked Ethereal. Direct damage dealt to the player’s side is reduced by 90% during that turn; Status, setup, field, and switching actions still function normally.

**Rank II:** The Ethereal turn occurs every fourth turn.

**Evolution — Ghost Turn:** Allied direct damage is increased by 25% during Ethereal turns.

**Evolution — Stable Phase:** The protection remains until the first direct hit lands, ensuring at least one attack is heavily mitigated.

---

### 96. Apex Plunder — **Master; Pokémon plus boss segment**

**Base:** After defeating a boss with additional health segments, select one Pokémon to steal a 25%-HP segment.

When that Pokémon would faint, the segment breaks and restores it to 25% HP. The segment persists between battles until broken and is restored only by defeating another segmented boss.

**Rank II:** Segment becomes 50%.

**Evolution — Segment Hoard:** The Pokémon may store two separate 25% segments.

**Evolution — Apex Heart:** A single 25% segment refreshes at every biome transition.

---

### 97. Inversion Window — **Master; team**

**Base:** The first resisted allied attack each battle is treated as super-effective. The first super-effective attack received by the team is treated as resisted.

**Rank II:** Each side of the effect gains a second activation.

**Evolution — Reverse Polarity:** The first allied attack that would hit an elemental immunity is treated as neutral instead.

**Evolution — Inversion Doctrine:** Every allied Pokémon receives one weaker offensive and defensive inversion window.

---

### 98. Borrowed Future — **Rogue; pre-battle information**

**Base:** Before battle:

1. The enemy roster and lead are generated.
2. The enemy commits its first action.
3. The player sees the lead and committed action.
4. The player may reorder the party once.
5. The enemy cannot recalculate that committed action.

The revealed action is committed and cannot be recalculated.

**Rank II:** The enemy lead’s complete visible moveset, abilities, and item stacks are also revealed.

**Evolution — Parallel Futures:** In doubles or triples, the committed action of every currently active enemy is revealed.

**Evolution — Contingency Plan:** The player may also change one selected move or held-item arrangement before locking the battle state.

---

### 99. Pressure Valve — **Ultra; Pokémon plus selected conversion**

**Base:** Any attempted positive stat increase that would exceed the normal +6 cap is converted instead of being wasted.

At acquisition, choose one valve:

* **Barrier valve:** 8% maximum-HP barrier per excess stage.
* **Healing valve:** heal 6% per excess stage.
* **PP valve:** restore 1 PP to the most depleted move per excess stage.

Only stat stages above the normal +6 cap are converted.

**Rank II:** Values become 12% barrier, 10% healing, or 2 PP.

**Evolution — Multi-Valve:** Overflow automatically chooses the currently most useful conversion.

**Evolution — Overpressure:** Every three overflow stages also empower the next damaging move by 50%.

---

### 100. Negative Space — **Ultra; Pokémon plus sealed moves**

**Base:** On acquisition, select one known move to **seal**. The move remains learned and visible but cannot be selected while the boon is active. The Pokémon gains 10% damage and 6% damage reduction.

The seal cannot remove its final damaging move or a structurally required move.

**Rank II:** A second move may be sealed; each sealed move grants the bonus separately.

**Evolution — Void Specialist:** Up to three moves may be sealed, each granting 12% damage and 8% damage reduction.

**Evolution — Open Form:** Only one move may be sealed, but the Pokémon’s first usable move each battle gains +1 priority and 25% power.

Seals remain fixed until the boon is replaced, evolved, or explicitly retargeted at a biome transition. They cannot be toggled freely between battles.

---

# Thirty run curses

Curses use difficulty rather than rarity:

* **Dread I:** disruptive but manageable.
* **Dread II:** materially changes the run.
* **Dread III:** oppressive, build-defining, or heavily counter-targeted.

## Dread I

### 01. Frayed Supplies

Direct healing is 25% weaker. Barriers and revival HP are unaffected.

### 02. Thin Wallet

Biome-market prices are 30% higher.

### 03. Restless Lead

The same Pokémon cannot lead two consecutive battles.

### 04. Type Tax

Every duplicate party typing after the first reduces the power of that type’s moves by 4%. Dual and triple typings can contribute several duplicates.

### 05. Jealous Relics

The second and subsequent copies or stacks of the same item operate at reduced effectiveness.

---

## Dread II

### 06. Slow to Warm

Each Pokémon’s first damaging move after entering deals 15% less damage and acts with reduced Speed priority.

---

## Dread I

### 07. Fading Momentum

Every three turns, one positive stat stage on the active Pokémon decays.

### 08. No Takebacks

Reward rerolls are disabled. Other effects that replace or recycle options cost twice as much or require an additional sacrifice.

### 09. Exposed Flank

The first direct hit received by each Pokémon during a battle deals 15% additional damage.

### 10. Accumulated Fatigue

A Pokémon used in three consecutive waves deals 15% less damage until it sits out one full battle.

---

## Dread II

### 11. Mortal Wounds

Fainted Pokémon cannot be revived until the next biome transition.

### 12. Shared Pain

Ten percent of direct damage suffered is also dealt to the lowest-HP benched ally. Shared Pain cannot directly cause a bench faint.

### 13. No Retreat

After using a damaging move, the Pokémon cannot voluntarily switch for three turns or until one active Pokémon faints.

### 14. Fog of War

Enemy moves, abilities, item stacks, and relevant boon targets remain hidden until observed in battle.

### 15. Withering PP

Every fourth move use consumes one additional PP.

### 16. Brittle Weakness

Super-effective attacks against the player’s team deal 20% additional damage.

### 17. Cursed Inventory

At each biome transition:

1. Identify the most-used Pokémon from the preceding biome.
2. Randomly select one eligible complete item or vitamin stack it possesses.
3. Disable the entire stack whenever that Pokémon is active.
4. Reveal the cursed stack clearly.
5. Reroll it at the next biome transition.

If the most-used Pokémon has no eligible stack, continue down the usage ranking.

### 18. Elite Pursuit

Every fifth non-boss wave becomes a boss-trainer-equivalent encounter. It does not grant the usual enhanced boss reward.

### 19. Hollow Victory

Winning with any allied faint reduces the base rarity of the next reward before Luck. A flawless victory removes one accumulated penalty.

### 20. Oathbound

Designate one Anchor Pokémon. If it faints:

* Every other conscious ally loses 20% current HP.
* The active enemy gains +1 Speed.

The Anchor is visibly marked throughout the run.

### 21. The Long Night

Automatic healing at biome transitions is disabled, and purchasable healing items cost twice as much. Healing from moves, boons, relics, and owned items still functions.

### 22. Sweeper’s Tax

Track consecutive KOs by the same Pokémon within a battle:

* First KO: 15% maximum-HP recoil.
* Second KO: 30% recoil and −1 Speed.
* Third KO: 45% recoil and another −1 Speed.
* Later KOs: recoil rises by another 15%; Speed continues declining at defined thresholds.

The chain resets when another ally scores a KO or the battle ends. Switching does not reset it.

---

## Dread III

### 23. Public Enemy

Every trainer may generate seven or eight Pokémon. Extra roster slots use legal members from that trainer's normal generation pool.

Boss trainers also gain **Second Act**: when their final Pokémon first faints, it revives at full HP with one additional full health segment and +1 to all stats. Boss trainers are encounters flagged by the game as bosses, including Gym Leaders, Elite Four, Champions, evil-team admins and leaders, major rivals, and equivalent named bosses.

### 24. Mood Swing

Every ten waves, one random player boon becomes dormant. At higher wave depths, two boons may become dormant, but never more than two.

The disabled boons reroll every ten waves. Their progression and counters are preserved.

### 25. Nemesis Protocol

Enemy-team boon generation heavily increases counter-weighting against the player’s highest recent Threat Score.

Bosses are especially likely to receive boons that pressure the carry’s:

* Physical or special bias
* Speed dependence
* Repeated move
* Setup reliance
* Weather or terrain
* Status strategy
* Healing loop
* Item concentration

Counter-weighting applies when each new enemy team is generated.

### 26. Blood Moon

When a boss trainer’s entire roster is defeated, every Pokémon in that roster revives once at 25% HP.

Negative stat stages and major statuses are cleared. Consumed items are not restored.

### 27. Reverse Snowball

Every consecutive battle won without an allied faint grants future enemies 3% increased HP and other stats, up to +30% after ten flawless wins.

The bonus resets only when **more than half of the player’s current party faints during one battle**.

### 28. Cursed Draft

One of the three boon offers after each boss is hidden. It is guaranteed to be beneficial, but its identity, rarity, scope, and target type are revealed only after selection.

### 29. Entropy

At every biome transition, one move on every party Pokémon is temporarily replaced until the following biome transition.

Replacement rules:

* Similar category and approximate power band.
* Preserve at least one damaging move where possible.
* Exclude form-controller, signature-structural, one-hit-KO, and required moves.
* Reveal every replacement before the first battle.

### 30. Feedback Loop

Whenever one action activates multiple boon effects, the acting Pokémon suffers feedback damage for every triggered boon after the first:

* Second boon: 4% maximum HP.
* Third boon: another 6%.
* Fourth and later: another 8% each.

Feedback cannot directly reduce the Pokémon below 1 HP, but ordinary damage can still make it faint.

---

# Removed, folded, or held for later

## Folded into existing lines

* **Ambush Doctrine** → Crowned Vanguard evolution.
* **Momentum Relay** → Relay Seat evolution.
* Team-wide versions of **Parting Gift**, **Failure Is Data**, **Conservation Law**, **Off-Brand Genius**, and several defensive effects → later evolutions rather than equal-rarity base cards.

## Removed from the active catalogue

* **Chain Formation:** insufficiently concrete and strategically vague.
* **Combo String:** too similar to Improviser, Full Repertoire, Chromatic Relay, and other sequencing effects.
* **Salvage Rights:** explicitly removed pending a genuinely better scavenging mechanic.
* **Loaded Dice:** name conflicts with an existing item and guaranteed secondary effects become especially problematic with flinching.
* **Usurer’s Gift:** incompatible with being acquired during the run.

## Workshop backlog, not counted among the 100

* **Hit-and-Run:** mechanically interesting, but requires authoritative post-KO replacement and simultaneous-faint handling.
* **Elemental Reforge:** unclear whether permanent, per-battle, per-move, or meaningfully attractive compared with existing coverage.
* **Remix:** functional, but currently too close to several other move-transformation lines.
* **Fate Draft:** the battle-law pool needs a much stronger pass; the current collection is inconsistent.
* **Release Dividend:** successor inheritance remains insufficiently distinctive and potentially exploitable.
* **Fault Tolerance:** viable but niche; every suppressible ability, item, and boon would need a bespoke “one final enhanced activation” definition.
