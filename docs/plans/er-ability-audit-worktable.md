# ER Ability Audit Worktable

### 1 Stench  [(vanilla-map)] pkrg=1
  ABBR: 10% chance to flinch targets. Toxic terrain is permanent.
  FULL: Attacks gain +10% flinch chance. Chance is rolled separately on multi-hit attacks. Toxic Terrain turns do not decrease while the user is present.
  CODE: PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["FLINCHED"]}

### 2 Drizzle  [(vanilla-map)] pkrg=2
  ABBR: Summons rain on entry. Lasts 8 turns.
  FULL: Drizzle summons rain weather when the Pokemon enters battle, lasting 8 turns (12 with Damp Rock held). Rain boosts Water moves by 50% and cuts Fire damage by 50%. Certain moves and abilities have special interactions with rain. Cannot override primal weather conditions.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=2,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=2,erTurns=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 3 Speed Boost  [(vanilla-map)] pkrg=3
  ABBR: Raises own Speed by one stage after every turn.
  FULL: User's Speed increases by one stage at end of each full turn they remain on the field. Doesn't activate on the turn the user is switched in.
  CODE: SpeedBoostAbAttr{showAbility=true,extraCondition=undefined}

### 4 Battle Armor  [(vanilla-map)] pkrg=4
  ABBR: Immune to critical hits. Takes 20% less damage from attacks.
  FULL: Incoming damage is reduced by 20% (x0.8), multiplicative with other damage reduction. Additionally, critical hits are blocked, functioning as regular hits and not activating on-crit effects like To The Bone's bleed.
  CODE: BlockCritAbAttr{showAbility=false,extraCondition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8}

### 5 Sturdy  [(vanilla-map)] pkrg=5
  ABBR: At full HP, cannot be KO in one hit, stays at 1 HP instead.
  FULL: When at full HP, this Pokemon will survive any single attack with at least 1 HP remaining. This functions like a Focus Sash, and so does not protect against multihit attacks or follow-up attacks (e.g. Aftershock, Thundercall).
  CODE: PreDefendFullHpEndureAbAttr{showAbility=true,extraCondition=undefined} | BlockOneHitKOAbAttr{showAbility=true,extraCondition=undefined}

### 6 Damp  [(vanilla-map)] pkrg=6
  ABBR: Makes foe Water-type on contact. Also works on offense.
  FULL: If the user makes contact with another Pokemon, offensively or defensively, the other Pokemon's type is changed to pure Water. This happens immediately for multihit or priority moves and can remove STAB in the middle of an enemy's multihit move.
  CODE: PostDefendChangeAttackerTypeAbAttr{showAbility=false,extraCondition=undefined,type=10,contactOnly=true,requireFlag=null,side="attacker"} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 7 Limber  [(vanilla-map)] pkrg=7
  ABBR: Para immune, takes half recoil, immune to self stat drops.
  FULL: All recoil damage to the user is halved; this includes moves with scaling recoil damage like Brave Bird, moves with crash damage like Jump Kick, or moves with fixed recoil like Steel Beam. Paralysis also cannot affect the user, and if they gain Limber, existing paralysis is cured.
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[3]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[3],statusHealed=undefined} | ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=undefined} | RecoilDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,opts={"factor":0.5}}

### 8 Sand Veil  [(vanilla-map)] pkrg=8
  ABBR: Evasion is boosted by 1.25x while a sandstorm is active.
  FULL: During sandstorm, enemy Pokemon's accuracy is divided by 1.25, and user is immune to sand damage. Bypassed by No Guard/Mold Breaker.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=7,multiplier=1.2,condition=undefined} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[3]}

### 9 Static  [(vanilla-map)] pkrg=9
  ABBR: 30% chance to paralyze on contact, 10% on non-contact.
  FULL: Has a chance to paralyze when attacking or when hit by a move. Has a 10% chance to paralyze on non-contact attacks and a 30% chance to paralyze on contact attacks.
  CODE: PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[3]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[3],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined}

### 10 Volt Absorb  [(vanilla-map)] pkrg=10
  ABBR: Heals 25% of max HP when hit by an Electric-type move.
  FULL: This Pokemon absorbs Electric- type moves completely, converting them into energy that restores 25% of its maximum HP. Provides complete immunity to Electric damage and effects like paralysis from Thunder Wave. Absolutely perfect for Water/Flying types to remove their 4x Electric weakness.
  CODE: TypeImmunityHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=12,condition=null}

### 11 Water Absorb  [(vanilla-map)] pkrg=11
  ABBR: Heals 25% of max HP when hit by a Water-type move.
  FULL: The user gains immunity to Water-type moves and they heal for 25% of their max HP when hit by them.
  CODE: TypeImmunityHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=10,condition=null}

### 12 Oblivious  [(vanilla-map)] pkrg=12
  ABBR: Immune to infatuation, Scare, Intimidate and Taunt.
  FULL: This Pokemon is immune to infatuation, Scare, Intimidate and Taunt. When gaining this ability while afflicted by any of the mentioned statuses, instantly cures them.
  CODE: BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["INFATUATED","TAUNT","ER_FEAR"]} | PostSummonRemoveBattlerTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneTags=["INFATUATED","TAUNT"]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 13 Cloud Nine  [(vanilla-map)] pkrg=13
  ABBR: Clears weather and prevents its effects.
  FULL: Cloud Nine clears all weather upon switch-in and nullifies weather effects (including Primal weathers) while the user remains on the field. Weather can still be set, but provides no damage boosts or ability triggers until the user switches out.
  CODE: SuppressWeatherEffectAbAttr{showAbility=true,extraCondition=undefined,affectsImmutable=true} | PostSummonUnnamedMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,message="The effects of the weather disappeared."} | PostSummonWeatherSuppressedFormChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true} | PostFaintUnsuppressedWeatherFormChangeAbAttr{showAbility=true,extraCondition=undefined}

### 14 Compound Eyes  [(vanilla-map)] pkrg=14
  ABBR: Grants a 1.3x accuracy boost.
  FULL: Boosts the user's accuracy by 1.3x.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.3,condition=undefined} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 15 Insomnia  [(vanilla-map)] pkrg=15
  ABBR: Cannot fall asleep. Rest fails if used.
  FULL: Prevents falling asleep by any means, including sleep moves, abilities like Yawn, and other effects that cause sleep status. Rest will fail completely when used. If gained while asleep (via Worry Seed/Skill Swap), immediately wakes up. Can be bypassed by Mold Breaker and similar abilities. TEST
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[4]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[4],statusHealed=undefined} | BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["DROWSY"]}

### 16 Color Change  [(vanilla-map)] pkrg=16
  ABBR: Changes type to a resist or an immunity before getting hit.
  FULL: Transforms the user into the best defensive type before taking damage. Prioritizes immunities over resistances. Only changes to a pure type. Once per turn.
  CODE: PostDefendTypeChangeAbAttr{showAbility=true,extraCondition=undefined,type=undefined}

### 17 Immunity  [(vanilla-map)] pkrg=17
  ABBR: Cannot be poisoned. Halves damage taken from Poison moves.
  FULL: Prevents poisoning. Reduces all Poison-type damage by 50%. Multiplicative with other sources of damage reduction. If poisoned when gaining this ability, the poison is immediately cured.
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[1,2]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[1,2],statusHealed=undefined} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 18 Flash Fire  [(vanilla-map)] pkrg=18
  ABBR: Powers up Fire-type moves by 1.5x if hit by a Fire-type move.
  FULL: Flash Fire grants complete immunity to Fire-type moves. When hit by Fire attacks, powers up the user's Fire moves by 50% until switching out. The boost doesn't stack from multiple Fire hits.
  CODE: TypeImmunityAddBattlerTagAbAttr{showAbility=true,extraCondition=undefined,immuneType=9,condition=null,tagType="FIRE_BOOST",turnCount=1}

### 19 Shield Dust  [(vanilla-map)] pkrg=19
  ABBR: Immune to added move effects, hazards, and powder moves.
  FULL: Blocks all secondary effects from damaging moves. Grants immunity to entry hazards. Blocks all powder moves including Sleep Powder, Stun Spore, Poison Powder, Spore, Cotton Spore, Rage Powder, Powder, and Magic Powder.
  CODE: IgnoreMoveEffectsAbAttr{showAbility=false,extraCondition=undefined}

### 20 Own Tempo  [(vanilla-map)] pkrg=20
  ABBR: Immune to confusion, Intimidate and Scare.
  FULL: Grants immunity to confusion, Intimidate, and Scare. Immediately cures confusion when receiving this ability.
  CODE: BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["CONFUSED","ER_FEAR"]} | PostSummonRemoveBattlerTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneTags=["CONFUSED"]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 21 Suction Cups  [(vanilla-map)] pkrg=21
  ABBR: Cannot be forced to switch out by an enemy's move.
  FULL: Prevents forced switching from moves and Red Card.
  CODE: ForceSwitchOutImmunityAbAttr{showAbility=true,extraCondition=undefined}

### 22 Intimidate  [(vanilla-map)] pkrg=22
  ABBR: Lowers foes' Atk by one stage on entry.
  FULL: Upon entering battle, the user drops the Attack stat of all opposing Pokemon by one stage.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[1],stages=-1,selfTarget=false,intimidate=true}

### 23 Shadow Tag  [(vanilla-map)] pkrg=23
  ABBR: Opponents can't be switched out. Ghosts aren't affected.
  FULL: Prevents all non-Shadow Tag or Ghost-type foes from switching out. Pokemon holding Shed Shell or using a pivot move such as Flip Turn can escape. Activates during the next turn if the user switches in mid battle.
  CODE: ArenaTrapAbAttr{showAbility=false,extraCondition=undefined,arenaTrapCondition=<fn>}

### 24 Rough Skin  [(vanilla-map)] pkrg=24
  ABBR: Enemies lose 1/8 of max HP if they use a contact move.
  FULL: Damages attackers using contact moves for 1/8 of their max HP. Activates on every hit for multihitting moves.
  CODE: PostDefendContactDamageAbAttr{showAbility=true,extraCondition=undefined,damageRatio=8}

### 25 Wonder Guard  [(vanilla-map)] pkrg=25
  ABBR: Is only hit by Super-effective attacks or indirect damage.
  FULL: Only super-effective attacks or indirect damage can hurt the user. All other direct attacks deal zero damage. Other sources such as poison or ability damage still function as normal.
  CODE: NonSuperEffectiveImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneType=null,condition=null}

### 26 Levitate  [(vanilla-map)] pkrg=26
  ABBR: Immune to Ground-type moves. Ups own Flying moves by 1.25x.
  FULL: The user is immune to Ground- type moves and other ground effects such as Spikes and terrains. Boosts the damage of Flying-type moves by 25%.
  CODE: AttackTypeImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneType=4,condition=<fn>} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25}

### 27 Effect Spore  [(vanilla-map)] pkrg=27
  ABBR: 30% chance to inflict SLP, PARA or PSN if hit by a contact move.
  FULL: When hit by a contact move, 30% chance to inflict sleep, paralysis, or poison. Chosen randomly.
  CODE: EffectSporeAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[1,3,4]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[4],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[3],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[1],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined}

### 28 Synchronize  [(vanilla-map)] pkrg=28
  ABBR: Enemies inflicting status on this Pokémon get same status.
  FULL: When inflicted with a non- volatile status (except sleep), the attacker receives the same status. Bypasses Substitute. If the user can cure the status when it is inflicted, they will inflict the status to the attacker before curing it.
  CODE: SyncEncounterNatureAbAttr{showAbility=false,extraCondition=undefined} | SynchronizeStatusAbAttr{showAbility=true,extraCondition=undefined}

### 29 Clear Body  [(vanilla-map)] pkrg=29
  ABBR: Immune to stat drops.
  FULL: Gives immunity to all stat reductions from moves and abilities. Includes self stat drops from moves like Overheat.
  CODE: ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=undefined}

### 30 Natural Cure  [(vanilla-map)] pkrg=30
  ABBR: Heals status condition upon switching out.
  FULL: Cures all status conditions when switching out.
  CODE: PreSwitchOutResetStatusAbAttr{showAbility=false,extraCondition=undefined}

### 31 Lightning Rod  [(vanilla-map)] pkrg=31
  ABBR: Redirects Electric moves. Absorbs them, ups highest Atk.
  FULL: The user draws in Electric-type moves and gains immunity to them. Additionally, Electric-type moves boost the highest attacking stat of the user by one stage.
  CODE: RedirectTypeMoveAbAttr{showAbility=true,extraCondition=undefined,type=12} | TypeImmunityHighestAttackStatStageAbAttr{showAbility=true,extraCondition=undefined,immuneType=12,condition=null,stages=1}

### 32 Serene Grace  [(vanilla-map)] pkrg=32
  ABBR: Doubles chance of secondary effects on its own moves.
  FULL: Doubles the activation chance of the user's secondary effects on their attacks.
  CODE: MoveEffectChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=2}

### 33 Swift Swim  [(vanilla-map)] pkrg=33
  ABBR: This Pokémon's Speed gets a 1.5x boost if rain is active.
  FULL: Boosts Speed by 50% during rain.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined}

### 34 Chlorophyll  [(vanilla-map)] pkrg=34
  ABBR: This Pokémon's Speed gets a 1.5x boost if sun is active.
  FULL: Boosts the Pokemon's Speed by 50% during sun.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined}

### 35 Illuminate  [(vanilla-map)] pkrg=35
  ABBR: Grants a 1.2x accuracy boost.
  FULL: Boosts the user's accuracy by 1.2x. Removes Ghost-typing on target when landing an attack.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=undefined}

### 36 Trace  [(vanilla-map)] pkrg=36
  ABBR: Copies the foe's ability. Does not copy innates.
  FULL: Copies the ability of an opposing Pokemon when entering battle, replacing itself in the current ability slot. Cannot copy Trace, Wonder Guard, and most form related abilities. In doubles, targets the first valid opponent at random.
  CODE: PostSummonCopyAbilityAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,target=undefined,targetAbilityName=undefined}

### 37 Huge Power  [(vanilla-map)] pkrg=37
  ABBR: Doubles own Attack stat. Boosts raw stat, not base stat.
  FULL: Increases the user's Attack stat by 2x. Multiplicative with other damage boosts.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=2,condition=undefined} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 38 Poison Point  [(vanilla-map)] pkrg=38
  ABBR: 30% chance to poison on contact. Also works on offense.
  FULL: Has a 30% chance to inflict poison on contact moves, both when attacking and being attacked.
  CODE: PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[1]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[1],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[1]}

### 39 Inner Focus  [(vanilla-map)] pkrg=39
  ABBR: Blocks flinch, Intimidate, Scare. Focus Blast never misses.
  FULL: Focus Blast never misses. Unaffected by flinch, Intimidate, or Scare.
  CODE: BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["FLINCHED","ER_FEAR"]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 40 Magma Armor  [(vanilla-map)] pkrg=40
  ABBR: Frostbite-immune. Takes 30% less dmg from Water/Ice-type moves.
  FULL: Immune to frostbite. Reduces damage received from Water and Ice-type moves by 30%. Multiplicative with other sources of damage reduction.
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[5]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[5],statusHealed=undefined} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.7} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.7}

### 41 Water Veil  [(vanilla-map)] pkrg=41
  ABBR: Burn-immune. Casts Aqua Ring on entry.
  FULL: Uses Aqua Ring on entry, which restores 1/16 HP each turn. Grants immunity to burn status and removes burn on switching in.
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[6]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[6],statusHealed=undefined} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"scripted-move","move":392},once=false}

### 42 Magnet Pull  [(vanilla-map)] pkrg=42
  ABBR: Traps opposing Steel-types. Ghosts aren't affected.
  FULL: Prevents Steel-type Pokemon from switching out while the user is present. Ghost-types are immune to this effect. Pokemon holding Shed Shell or using a pivot move such as Flip Turn can escape. Activates during the next turn if the user switches in mid battle.
  CODE: ArenaTrapAbAttr{showAbility=false,extraCondition=undefined,arenaTrapCondition=<fn>}

### 43 Soundproof  [(vanilla-map)] pkrg=43
  ABBR: Immune to sound-based moves.
  FULL: Grants immunity to sound-based moves. Self-targeting sound moves are not blocked.
  CODE: MoveImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneCondition=<fn>}

### 44 Rain Dish  [(vanilla-map)] pkrg=44
  ABBR: Heals 1/8 of max HP every turn if rain is active.
  FULL: Restores 1/8 max HP at the end of each turn in rain.
  CODE: PostWeatherLapseHealAbAttr{showAbility=true,extraCondition=undefined,weatherTypes=[2,7],healFactor=2}

### 45 Sand Stream  [(vanilla-map)] pkrg=45
  ABBR: Summons a sandstorm on entry. Lasts 8 turns.
  FULL: Summons a Sandstorm for 8 turns (12 with Smooth Rock) on entry. Damages non-Rock/Ground/Steel types by 1/16 HP per turn. Rock- types gain a 50% Special Defense boost. Halves the effectiveness of sun related moves.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=3,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=3,erTurns=8}

### 46 Pressure  [(vanilla-map)] pkrg=46
  ABBR: Doubles foe's PP usage. Clears stat buffs on entry.
  FULL: Doubles PP usage of opposing moves and clears all positive stat stages on entry.
  CODE: IncreasePpAbAttr{showAbility=true,extraCondition=undefined} | PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>} | ClearOpponentStatBuffsOnSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true}

### 47 Thick Fat  [(vanilla-map)] pkrg=47
  ABBR: Takes 1/2 damage from Fire-type and Ice-type attacks.
  FULL: Reduces damage received from Fire and Ice-type moves by 50%. Multiplicative with other sources of damage reduction.
  CODE: ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 48 Early Bird  [(vanilla-map)] pkrg=48
  ABBR: Awakens twice as fast from sleep.
  FULL: Allows the user to wake up from sleep twice as fast. Subtract 2 sleep turns every turn instead of 1.
  CODE: ReduceStatusEffectDurationAbAttr{showAbility=false,extraCondition=undefined,statusEffect=4}

### 49 Flame Body  [(vanilla-map)] pkrg=49
  ABBR: 30% chance to burn on contact, 20% non. Also works on offense.
  FULL: Contact with this Pokemon has a 30% chance to inflict burn. Non- contact has a 20% chance. Works offensively and defensively.
  CODE: PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[6]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=20,effects=[6],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[6]}

### 50 Run Away  [(vanilla-map)] pkrg=50
  ABBR: Guarantees fleeing. Raises Speed if stats lowered by an enemy.
  FULL: Guarantees successful escape from wild Pokemon battles regardless of speed differences. When any of the user's stats are lowered by an opponent's move or ability, raises the user's Speed by 2 stages.
  CODE: RunSuccessAbAttr{showAbility=true,extraCondition=undefined} | StatTriggerOnStatLoweredAbAttr{showAbility=true,extraCondition=undefined,event="on-stat-lowered",stats=[{"stat":5,"stages":1}]}

### 51 Keen Eye  [(vanilla-map)] pkrg=51
  ABBR: Immune to accuracy drops. Grants a 1.2x accuracy boost.
  FULL: Prevents accuracy stat stage drops. All moves gain a 1.2x accuracy boost.
  CODE: ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=6} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=undefined}

### 52 Hyper Cutter  [(vanilla-map)] pkrg=52
  ABBR: Enemies can't lower Atk/SpAtk. Contact moves get +1 Crit.
  FULL: Hyper Cutter prevents enemies from lowering the user's Attack stat through moves or abilities. All contact moves used by this Pokemon have their critical hit rate increased by one stage.
  CODE: ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=1} | ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=3} | CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"flag":1}}

### 53 Pickup  [(vanilla-map)] pkrg=53
  ABBR: Removes all hazards on entry. Not immune to hazards.
  FULL: Clears all entry hazards from your side of the field when entering battle. The Pokemon is still susceptible to hazards while clearing them.
  CODE: PostBattleLootAbAttr{showAbility=true,extraCondition=undefined,randItem=undefined} | PostSummonRemoveArenaTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,arenaTags=["SPIKES","TOXIC_SPIKES","STEALTH_ROCK","STICKY_WEB"]}

### 54 Truant  [(vanilla-map)] pkrg=54
  ABBR: Can't use attacking moves twice in a row.
  FULL: Prevents consecutive attacking moves. After using an attack, the user must loaf around next turn and cannot attack. Status moves remain unaffected.
  CODE: PostSummonAddBattlerTagAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,tagType="TRUANT",turnCount=1}

### 55 Hustle  [(vanilla-map)] pkrg=55
  ABBR: 0.9x accuracy. Boosts damage by 1.4x.
  FULL: Boosts the power of attacks by 1.4x but reduces their accuracy by 10%. Only affects non-status moves.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1.4,condition=undefined} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=0.8,condition=<fn>} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 56 Cute Charm  [(vanilla-map)] pkrg=56
  ABBR: 50% chance to attract on contact. Also works on offense.
  FULL: When hit by making contact (offensively or defensively), has a 50% chance to infatuate the attacker (cuts their Attack and Special Attack in half). This only works on Pokemon of the opposite gender.
  CODE: PostDefendContactApplyTagChanceAbAttr{showAbility=true,extraCondition=undefined,chance=50,tagType="INFATUATED",turnCount=undefined} | PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=<fn>,effects=["INFATUATED"]}

### 57 Plus  [(vanilla-map)] pkrg=57
  ABBR: Deals double damage if an ally Pokémon has Minus or Plus.
  FULL: Doubles the Pokemon's offensive power when partnered with an ally that has Plus or Minus.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=3,multiplier=2,condition=undefined}

### 58 Minus  [(vanilla-map)] pkrg=58
  ABBR: Deals double damage if an ally Pokémon has Minus or Plus.
  FULL: Doubles the Pokemon's offensive power when partnered with an ally that has Minus or Plus.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=3,multiplier=2,condition=undefined}

### 59 Forecast  [(vanilla-map)] pkrg=59
  ABBR: Changes form with the weather. Attacks when setting weather.
  FULL: Changes form and type to match active weather. When using weather setting moves, follows up with Weather Ball (100 BP, Special, matching type with set weather). Transforms on entry, weather changes, and turn end. Unsuppressable ability that works even under Mold Breaker effects.
  CODE: NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined} | PostSummonFormChangeByWeatherAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true} | PostWeatherChangeFormChangeAbAttr{showAbility=false,extraCondition=undefined,ability=59,formRevertingWeathers=[0,3,9,6]}

### 60 Sticky Hold  [(vanilla-map)] pkrg=60
  ABBR: Can't lose its item.
  FULL: The user's item cannot be forcibly removed or stolen.
  CODE: BlockItemTheftAbAttr{showAbility=true,extraCondition=undefined}

### 61 Shed Skin  [(vanilla-map)] pkrg=61
  ABBR: 30% chance to heal its status condition at the end of a turn.
  FULL: At the end of each turn, there's a 30% chance for the user to cure status conditions afflicted on them.
  CODE: PostTurnResetStatusAbAttr{showAbility=true,extraCondition=<fn>,allyTarget=false,target=undefined}

### 62 Guts  [(vanilla-map)] pkrg=62
  ABBR: Ups Atk by 1.5x if suffering from a status condition.
  FULL: Boosts Attack stat by 50% when suffering from any status condition. Negates the Attack drop from burn status.
  CODE: BypassBurnDamageReductionAbAttr{showAbility=false,extraCondition=undefined} | StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=1,multiplier=1.5,condition=undefined}

### 63 Marvel Scale  [(vanilla-map)] pkrg=63
  ABBR: Ups Def by 1.5x when statused.
  FULL: Increases base Defense by 50% when afflicted with any status condition.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=2,multiplier=1.5,condition=undefined}

### 64 Liquid Ooze  [(vanilla-map)] pkrg=64
  ABBR: Draining causes harm to enemies instead of healing them.
  FULL: Liquid Ooze reverses all healing effects from drain moves, causing the attacker to take damage instead. Affects Absorb, Drain Punch, Giga Drain, Leech Life, and similar draining attacks. The damage equals what would have been healed. Perfect counter to healing-based strategies.
  CODE: ReverseDrainAbAttr{showAbility=true,extraCondition=undefined}

### 65 Overgrow  [(vanilla-map)] pkrg=65
  ABBR: Boosts Grass-type moves by 1.2x, or 1.5x when under 1/3 HP.
  FULL: Boosts the power of Grass-type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: LowHpMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.5} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 66 Blaze  [(vanilla-map)] pkrg=66
  ABBR: Boosts Fire-type moves by 1.2x, or 1.5x when under 1/3 HP.
  FULL: Boosts the power of Fire-type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: LowHpMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.5} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 67 Torrent  [(vanilla-map)] pkrg=67
  ABBR: Boosts Water-type moves by 1.2x, or 1.5x when under 1/3 HP.
  FULL: Boosts the power of Water-type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: LowHpMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.5} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 68 Swarm  [(vanilla-map)] pkrg=68
  ABBR: Boosts Bug-type moves by 1.2x, or 1.5x when under 1/3 HP.
  FULL: Boosts the power of Bug-type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: LowHpMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.5} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 69 Rock Head  [(vanilla-map)] pkrg=69
  ABBR: Immune to recoil damage, but not immune to Explosion/crash dmg.
  FULL: Prevents all recoil damage from the user's moves and abilities. Also grants immunity to enrage recoil damage. Does not prevent crash damage or Explosion/Self- Destruct damage.
  CODE: BlockRecoilDamageAttr{showAbility=false,extraCondition=undefined}

### 70 Drought  [(vanilla-map)] pkrg=70
  ABBR: Summons sun on entry. Lasts 8 turns.
  FULL: Summons harsh sunlight for 8 turns (12 with Heat Rock) on entry. Boosts Fire moves by 50%, reduces Water moves by 50%. Activates extra effects on sun related moves.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=1,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=1,erTurns=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 71 Arena Trap  [(vanilla-map)] pkrg=71
  ABBR: Enemies can't flee. Ghosts and ungrounded Pokémon are immune.
  FULL: Prevents all non-levitating or Ghost-type foes from switching out. Pokemon holding Shed Shell or using a pivot move such as Flip Turn can escape. Activates during the next turn if the user switches in mid battle
  CODE: ArenaTrapAbAttr{showAbility=false,extraCondition=undefined,arenaTrapCondition=<fn>} | DoubleBattleChanceAbAttr{showAbility=false,extraCondition=undefined}

### 72 Vital Spirit  [(vanilla-map)] pkrg=72
  ABBR: Can't fall asleep. Fighting-type moves heal status.
  FULL: Immune to sleep. When the Pokemon uses a Fighting-type move, it heals all status conditions immediately after the move resolves. Removes sleep when gained.
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[4]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[4],statusHealed=undefined} | BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["DROWSY"]} | HealStatusOnMoveTypeAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,moveType=1}

### 73 White Smoke  [(vanilla-map)] pkrg=73
  ABBR: Sets Smokescreen for 3 turns on switch-in.
  FULL: Sets Smokescreen on entry, lasting 3 turns. Smokescreen increases the evasiveness of your party by 25%.
  CODE: ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=undefined} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-screen-or-room","tag":"MIST","turns":3},once=false}

### 74 Pure Power  [(vanilla-map)] pkrg=74
  ABBR: Doubles own Sp.Atk stat. Boosts raw stat, not base stat.
  FULL: Increases the user's Attack stat by 2x. Multiplicative with other damage boosts.
  CODE: AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=2,condition=undefined}

### 75 Shell Armor  [(vanilla-map)] pkrg=75
  ABBR: Immune to critical hits. Takes 20% less damage from attacks.
  FULL: Incoming damage is reduced by 20% (x0.8), multiplicative with other damage reduction. Additionally, critical hits are blocked, functioning as regular hits and not activating on-crit effects like To The Bone's bleed.
  CODE: BlockCritAbAttr{showAbility=false,extraCondition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8}

### 76 Air Lock  [(vanilla-map)] pkrg=76
  ABBR: Cloud Nine + Air Blower.
  FULL: Sets Tailwind for 3 turns and clears all weather effects on entry. Primal weathers are suppressed. Weather can still be set while the user is on the field, but will have no effect until the user switches.
  CODE: SuppressWeatherEffectAbAttr{showAbility=true,extraCondition=undefined,affectsImmutable=true} | PostSummonUnnamedMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,message="The effects of the weather disappeared."} | PostSummonWeatherSuppressedFormChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true} | PostFaintUnsuppressedWeatherFormChangeAbAttr{showAbility=true,extraCondition=undefined} | EntryTailwindClearWeatherAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true}

### 77 Tangled Feet  [(vanilla-map)] pkrg=77
  ABBR: Uses Speed as defensive stat when confused or enraged.
  FULL: When the user is confused or enraged, the Pokemon uses its Speed stat instead of Defense or Special Defense for damage calculations. Choice Scarf does not affect this ability.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=7,multiplier=2,condition=undefined}

### 78 Motor Drive  [(vanilla-map)] pkrg=78
  ABBR: Boosts Speed instead of being hit by Electric-type moves.
  FULL: Immune to Electric-type moves, and boost Speed by 1 stage when the user is hit by them. Activates on each hit of a multihit move.
  CODE: TypeImmunityStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,immuneType=12,condition=null,stat=5,stages=1}

### 79 Rivalry  [(vanilla-map)] pkrg=79
  ABBR: Deals 1.25x to same gender. Takes .75x from opposite gender.
  FULL: Boosts the user's damage by 25% against same-gender Pokemon and reduces damage taken by 25% from opposite-gender Pokemon. No effect with genderless Pokemon.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=0.75}

### 80 Steadfast  [(vanilla-map)] pkrg=80
  ABBR: Raises Speed by one stage if this Pokémon flinches.
  FULL: Getting flinched raises Speed by one stage.
  CODE: FlinchStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=[5],stages=1}

### 81 Snow Cloak  [(vanilla-map)] pkrg=81
  ABBR: Evasion is boosted by 1.25x under hail.
  FULL: Evasion is boosted by 1.25x under hail.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=7,multiplier=1.2,condition=undefined} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[4]}

### 82 Gluttony  [(vanilla-map)] pkrg=82
  ABBR: Eats berries early. Berries also restore 1/3 of max HP.
  FULL: Berries that normally activate at 1/4 HP trigger at 1/2 HP instead. Additionally, after consuming any berry, the user recovers 1/3 of max HP. Does not include berries consumed through moves like Pluck.
  CODE: ReduceBerryUseThresholdAbAttr{showAbility=false,extraCondition=undefined} | HealFromBerryUseAbAttr{showAbility=true,extraCondition=undefined,healPercent=0.3333333333333333}

### 83 Anger Point  [(vanilla-map)] pkrg=83
  ABBR: Getting hit raises Atk by +1. Critical hits maximize Attack.
  FULL: When hit, raises the user's Attack by 1 stage or maximizes it on critical hits. Activates on each hit of a multihit move.
  CODE: PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=1,stages=12} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=1,selfTarget=true,allOthers=false}

### 84 Unburden  [(vanilla-map)] pkrg=84
  ABBR: Consuming its held item doubles Speed until switched out.
  FULL: When consuming or losing a held item, the user's base Speed stat is multiplied by x2. Boost goes away when switching out, gaining a new item, or upon losing the ability.
  CODE: PostItemLostApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,tagType="UNBURDEN"}

### 85 Heatproof  [(vanilla-map)] pkrg=85
  ABBR: Halves damage taken from Fire-type moves. Takes no burn damage.
  FULL: Halves damage from Fire-type moves. Immune to burn damage and Attack drops from burn status.
  CODE: ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReduceBurnDamageAbAttr{showAbility=false,extraCondition=undefined,multiplier=0.5}

### 86 Simple  [(vanilla-map)] pkrg=86
  ABBR: Doubles all stat changes on this Pokémon.
  FULL: Doubles all stat changes on this Pokémon.
  CODE: StatStageChangeMultiplierAbAttr{showAbility=false,extraCondition=undefined,multiplier=2}

### 87 Dry Skin  [(vanilla-map)] pkrg=87
  ABBR: Water/Rain heals. Fire/Sun hurts.
  FULL: The user heals 25% HP from Water-type moves and 12.5% HP each turn in rain. Takes 25% more damage from Fire moves and loses 12.5% HP per turn in sun.
  CODE: PostWeatherLapseDamageAbAttr{showAbility=true,extraCondition=undefined,weatherTypes=[1,8],damageFactor=2} | PostWeatherLapseHealAbAttr{showAbility=true,extraCondition=undefined,weatherTypes=[2,7],healFactor=2} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=1.25} | TypeImmunityHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=10,condition=null}

### 88 Download  [(vanilla-map)] pkrg=88
  ABBR: Raises Atk/Sp. Atk by one stage depending on opponent.
  FULL: When switching in, if the foe's Defense is higher than Special Defense, raise Special Attack by one stage. If Special Defense is higher or equal, raise Attack by one stage.
  CODE: DownloadAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,enemyDef=undefined,enemySpDef=undefined,enemyCountTally=undefined,stats=undefined}

### 89 Iron Fist  [(vanilla-map)] pkrg=89
  ABBR: Boosts the power of punching moves by 1.3x.
  FULL: Boosts the power of punching moves by 30%.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 90 Poison Heal  [(vanilla-map)] pkrg=90
  ABBR: Restores 1/8 of max HP after each turn if poisoned.
  FULL: Restores 1/8 max HP per turn instead of taking damage when poisoned. Works with both regular poison and toxic poison. Also prevents damage from Toxic terrain.
  CODE: PostTurnStatusHealAbAttr{showAbility=false,extraCondition=undefined,effects=[2,1]} | BlockStatusDamageAbAttr{showAbility=false,extraCondition=undefined,effects=[2,1]}

### 91 Adaptability  [(vanilla-map)] pkrg=91
  ABBR: Increases STAB from 1.5x to 2x.
  FULL: Boosts STAB damage boost on moves from 1.5x to 2.0x damage.
  CODE: StabBoostAbAttr{showAbility=false,extraCondition=undefined}

### 92 Skill Link  [(vanilla-map)] pkrg=92
  ABBR: Multi-hit moves always hit the maximum number of times.
  FULL: Multihit moves to always hit 5 times. For moves that only hit 3 times or Population Bomb, there will be one accuracy check for all hits instead of individual checks for each hit.
  CODE: MaxMultiHitAbAttr{showAbility=false,extraCondition=undefined} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 93 Hydration  [(vanilla-map)] pkrg=93
  ABBR: Cures own status at the end of every turn in rain.
  FULL: During rain, cures all status conditions at the end of the turn.
  CODE: PostTurnResetStatusAbAttr{showAbility=true,extraCondition=undefined,allyTarget=false,target=undefined}

### 94 Solar Power  [(vanilla-map)] pkrg=94
  ABBR: Ups highest attacking stat by 1.5x in sun.
  FULL: Boosts the Pokemon's highest attacking stat by 50% during sun.
  CODE: PostWeatherLapseDamageAbAttr{showAbility=true,extraCondition=undefined,weatherTypes=[1,8],damageFactor=2} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.5,condition=undefined}

### 95 Quick Feet  [(vanilla-map)] pkrg=95
  ABBR: Ups Speed by 1.5x if suffering from a status condition.
  FULL: Boosts Speed stat by 50% when suffering from any status condition. Negates the Speed drop from paralysis status.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=5,multiplier=2,condition=undefined} | StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=5,multiplier=1.5,condition=undefined}

### 96 Normalize  [(vanilla-map)] pkrg=96
  ABBR: Its moves become Normal-type, get 1.1x boost, ignore resists.
  FULL: Converts all damaging moves to Normal-type and grants a 10% power boost. Normal-type moves bypass resistances, but not immunities.
  CODE: MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=0,condition=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.1}

### 97 Sniper  [(vanilla-map)] pkrg=97
  ABBR: Critical hits have a 2.25x dmg multiplier instead of 1.5x.
  FULL: Boosts critical hit damage from 1.5x to 2.25x by applying an additional 50% multiplier.
  CODE: MultCritAbAttr{showAbility=false,extraCondition=undefined,multAmount=1.5} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 98 Magic Guard  [(vanilla-map)] pkrg=98
  ABBR: Only damaged by attacks.
  FULL: Grants immunity to all non- attack damage sources including entry hazards, weather damage, status conditions, and recoil.
  CODE: BlockNonDirectDamageAbAttr{showAbility=false,extraCondition=undefined}

### 99 No Guard  [(vanilla-map)] pkrg=99
  ABBR: Attacks used by and on this Pokémon bypass accuracy checks.
  FULL: Guarantees hits for all moves used by and against the user.
  CODE: AlwaysHitAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | DoubleBattleChanceAbAttr{showAbility=false,extraCondition=undefined}

### 100 Stall  [(vanilla-map)] pkrg=100
  ABBR: Takes 30% less damage if it hasn't moved yet.
  FULL: Reduces damage by 30% if the user has not moved yet. Multiplicative with other damage reduction sources. Works when the user switches in mid-turn.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.7}

### 101 Technician  [(vanilla-map)] pkrg=101
  ABBR: Moves with 60 BP or less get a 1.5x boost.
  FULL: Boosts moves with 60 BP or less by 1.5x. Does not boost moves with 60 BP or less if they potentially can have more than 60 BP, such as Revenge or Venoshock.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 102 Leaf Guard  [(vanilla-map)] pkrg=102
  ABBR: Cures own status at the end of every turn in sun.
  FULL: During sun, cures all status conditions at the end of the turn.
  CODE: PostTurnResetStatusAbAttr{showAbility=true,extraCondition=undefined,allyTarget=true,target=undefined}

### 103 Klutz  [(vanilla-map)] pkrg=103
  ABBR: Own held item has no effect. Mega Stones are unaffected.
  FULL: Disables all held item effects. Items can still be knocked off or stolen but give no benefits. Item-based moves like Fling fail. Mega Stones bypass this restriction.
  CODE: 

### 104 Mold Breaker  [(vanilla-map)] pkrg=104
  ABBR: Moves hit through abilities. Also affects innates.
  FULL: Allows moves to ignore the target's abilities and innates that interfere with effects or reduce damage. Does not bypass abilities that modify base stats such as Grass Pelt.
  CODE: PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>}

### 105 Super Luck  [(vanilla-map)] pkrg=105
  ABBR: Raises critical-hit ratio of own moves by +1.
  FULL: Adds +1 to the critical hit stage of all the Pokemon's damaging moves.
  CODE: BonusCritAbAttr{showAbility=false,extraCondition=undefined}

### 106 Aftermath  [(vanilla-map)] pkrg=106
  ABBR: After fainting uses 100 BP Explosion or Outburst.
  FULL: Uses a 100 BP Explosion or Outburst (whichever is higher) when knocked out. Using explosion moves will always Flinch the target.
  CODE: PostFaintDetonateAbAttr{showAbility=true,extraCondition=undefined,power=100,flinch=true,type=0}

### 107 Anticipation  [(vanilla-map)] pkrg=107
  ABBR: Senses Super-effective moves. Dodges one Super-effective hit.
  FULL: Alerts the Pokemon when facing opponents with super-effective moves on switch-in. Dodge the first super effective hit received in battle.
  CODE: PostSummonMessageAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,messageFunc=<fn>} | DodgeFirstSuperEffectiveAbAttr{showAbility=true,extraCondition=undefined,immuneType=null,condition=null}

### 108 Forewarn  [(vanilla-map)] pkrg=108
  ABBR: Casts an 80 BP Future Sight on entry.
  FULL: Casts an 80 BP Future Sight on the opposing Pokemon when switching in. Strikes 2 turns later, bypassing substitutes and other protections. The attack cannot miss once initiated and ignores accuracy checks. This cannot target the same Pokemon twice.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"scripted-move","move":248},once=false}

### 109 Unaware  [(vanilla-map)] pkrg=109
  ABBR: Ignores foes' stat changes, both positive and negative ones.
  FULL: Ignores all the foes' stat stage changes during damage calculations.
  CODE: IgnoreOpponentStatStagesAbAttr{showAbility=false,extraCondition=undefined,stats=[1,2,3,4,6,7]}

### 110 Tinted Lens  [(vanilla-map)] pkrg=110
  ABBR: Attacks deal double damage if resisted.
  FULL: Doubles damage when attacking into resistances. If a move would be resisted (0.5x damage or less), the damage is multiplied by 2x.
  CODE: MoveDamageBoostAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=2,condition=<fn>}

### 111 Filter  [(vanilla-map)] pkrg=111
  ABBR: Takes 35% less damage from Super-effective moves.
  FULL: Reduces damage from super- effective attacks by 35%. Multiplicative with other sources of damage reduction.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65}

### 112 Slow Start  [(vanilla-map)] pkrg=112
  ABBR: Halves Offenses and Speed during the first 5 turns out.
  FULL: Halves Attack, Special Attack, and Speed for the first 5 turns after switching in. The turn counter resets each time the Pokemon switches out.
  CODE: PostSummonAddBattlerTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,tagType="SLOW_START",turnCount=5}

### 113 Scrappy  [(vanilla-map)] pkrg=113
  ABBR: Normal/Fighting can hit Ghosts. Immune to Intimidate/Scare.
  FULL: The user can land Normal and Fighting-type moves on Ghost- types for neutral damage. Grants immunity to Intimidate and Scare.
  CODE: IgnoreTypeImmunityAbAttr{showAbility=false,extraCondition=undefined,defenderType=7,allowedMoveTypes=[0,1]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 114 Storm Drain  [(vanilla-map)] pkrg=114
  ABBR: Redirects Water moves. Absorbs them, ups highest Atk.
  FULL: The user draws in Water-type moves and gains immunity to them. Additionally, Water-type moves boost the highest attacking stat of the user by one stage.
  CODE: RedirectTypeMoveAbAttr{showAbility=true,extraCondition=undefined,type=10} | TypeImmunityHighestAttackStatStageAbAttr{showAbility=true,extraCondition=undefined,immuneType=10,condition=null,stages=1}

### 115 Ice Body  [(vanilla-map)] pkrg=115
  ABBR: Heals 1/8 of max HP every turn in hail.
  FULL: Restores 1/8 max HP at the end of each turn in hail. Also grants immunity to hail damage.
  CODE: BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[4]} | PostWeatherLapseHealAbAttr{showAbility=true,extraCondition=undefined,weatherTypes=[4,5],healFactor=2}

### 116 Solid Rock  [(vanilla-map)] pkrg=116
  ABBR: Takes 35% less damage from Super-effective moves.
  FULL: Reduces damage from super- effective attacks by 35%. Multiplicative with other sources of damage reduction.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65}

### 117 Snow Warning  [(vanilla-map)] pkrg=117
  ABBR: Summons hail on entry. Lasts 8 turns.
  FULL: Summons hailstorm for 8 turns (12 with Icy Rock) on entry. Damages non-Ice types by 1/16 HP per turn. Boosts the Defense stat of Ice-type Pokemon by 50%. Halves the effectiveness of sun related moves.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=4,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=4,erTurns=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 118 Honey Gather  [(vanilla-map)] pkrg=118
  ABBR: Has a 50% chance to find Honey each turn.
  FULL: Has a 50% chance to get Honey each turn if it had no item. Honey heals 1/16 HP per turn and can be eaten in a pinch to heal 1/4 HP. Works even if the user didn't start with Honey as its item.
  CODE: MoneyAbAttr{showAbility=true,extraCondition=undefined}

### 119 Frisk  [(vanilla-map)] pkrg=119
  ABBR: Checks foes' item and disables their items for two turns.
  FULL: Upon entering battle, reveals the opponents' items and prevents them from working for 2 turns. Does not prevent Mega Stones and other similar items from working.
  CODE: FriskAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true} | DisableFoeItemsOnEntryAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true}

### 120 Reckless  [(vanilla-map)] pkrg=120
  ABBR: Moves causing recoil damage deal 1.2x more damage.
  FULL: Increases the damage of moves that cause recoil by 20%. This bonus also applies when moves gain recoil through other means, such as madness or abilities.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 121 Multitype  [(vanilla-map)] pkrg=121
  ABBR: Held Plate item decides holder's type.
  FULL: The user changes form based of the type of Plate they are currently holding. Plates cannot be removed, and Multitype cannot be overridden, suppressed, swapped, or copied in any way.
  CODE: NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 122 Flower Gift  [(vanilla-map)] pkrg=122
  ABBR: Increases the party's SpAtk and SpDef by 1.5x in Sun.
  FULL: During sun, boost base Special Attack and Special Defense by 50% for this Pokemon and all allies.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=3,multiplier=1.5,condition=undefined} | StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=4,multiplier=1.5,condition=undefined} | AllyStatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=3,multiplier=1.5,ignorable=true} | AllyStatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=4,multiplier=1.5,ignorable=true} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined} | PostSummonFormChangeByWeatherAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true} | PostWeatherChangeFormChangeAbAttr{showAbility=false,extraCondition=undefined,ability=122,formRevertingWeathers=[0,3,9,6,4,7,5,2]}

### 123 Bad Dreams  [(vanilla-map)] pkrg=123
  ABBR: Sleeping Pokémon lose 1/4 of max HP at the end of each turn.
  FULL: All sleeping opponents lose 25% of their max HP at the end of each turn.
  CODE: ErBadDreamsAbAttr{showAbility=true,extraCondition=undefined}

### 124 Pickpocket  [(vanilla-map)] pkrg=124
  ABBR: Steals the foe's held item on contact.
  FULL: The user steals the target's held item on contact if they are currently holding no item. Does not work with Mega Stones and other similar items.
  CODE: PostDefendStealHeldItemAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stolenItem=undefined}

### 125 Sheer Force  [(vanilla-map)] pkrg=125
  ABBR: Exchanges added effects on its moves for 1.3x more power.
  FULL: Removes most beneficial secondary effects after landing attacks in exchange for a 1.3x boost. Notably prevents Life Orb recoil when using these moves. Removable effects include reducing the target's stats, increasing the user's stats, inflicting status on a target and flinching.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5} | MoveEffectChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=0}

### 126 Contrary  [(vanilla-map)] pkrg=126
  ABBR: Stat raises turn into stat drops for this Pokémon and vice versa.
  FULL: Reverses all stat changes affecting this Pokemon. Works with self-inflicted changes.
  CODE: StatStageChangeMultiplierAbAttr{showAbility=false,extraCondition=undefined,multiplier=-1}

### 127 Unnerve  [(vanilla-map)] pkrg=127
  ABBR: Foes can't use consumable items.
  FULL: Prevents all opposing Pokemon from consuming held items.
  CODE: PreventBerryUseAbAttr{showAbility=true,extraCondition=undefined}

### 128 Defiant  [(vanilla-map)] pkrg=128
  ABBR: Raises Attack by two stages if stats are lowered by an enemy.
  FULL: When the user has their stats lowered by another Pokemon, they raise their Attack by 2 stages.
  CODE: PostStatStageChangeStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,statsToChange=[1],stages=2}

### 129 Defeatist  [(vanilla-map)] pkrg=129
  ABBR: Halves Atk and Sp. Atk stats if user is below 1/3 of max HP.
  FULL: Halves both Attack and Special Attack stats when HP drops below 33% of maximum. Deactivates after healing above this threshold.
  CODE: ErDefeatistStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=0.5,condition=undefined} | ErDefeatistStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=0.5,condition=undefined}

### 130 Cursed Body  [(vanilla-map)] pkrg=130
  ABBR: 30% chance to disable moves if enemy makes contact.
  FULL: The user has a 30% chance to disable the attacker's move for 4 turns when hit by contact moves. The disabled move cannot be selected until the effect wears off.
  CODE: PostDefendMoveDisableAbAttr{showAbility=true,extraCondition=undefined,chance=30}

### 131 Healer  [(vanilla-map)] pkrg=131
  ABBR: 30% chance to heal user or ally's status at the end of each turn.
  FULL: Gives a 30% chance to cure status conditions at the end of each turn for both the user and their ally if they are out in a double battle. Makes 2 separate checks for each Pokemon.
  CODE: PostTurnResetStatusAbAttr{showAbility=true,extraCondition=<fn>,allyTarget=true,target=undefined}

### 132 Friend Guard  [(vanilla-map)] pkrg=132
  ABBR: Reduces damage that ally takes by 50% in double battles.
  FULL: In a double battle, the user's ally receives 50% less damage. Multiplicative with other damage reduction sources.
  CODE: AlliedFieldDamageReductionAbAttr{showAbility=true,extraCondition=undefined,damageMultiplier=0.5}

### 133 Weak Armor  [(vanilla-map)] pkrg=133
  ABBR: If hit by a contact attack: -1 Defense and +2 Speed.
  FULL: When hit by a contact move, raises the user's Speed by 2 stages and lowers their defense by 1 stage. Activates on each hit of a multihit move.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=2,stages=-1,selfTarget=true,allOthers=false} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=2,selfTarget=true,allOthers=false}

### 134 Heavy Metal  [(vanilla-map)] pkrg=134
  ABBR: Take half damage from Ghost and Dark.
  FULL: Takes half damage from Ghost and Dark-type attacks. Doubles the Pokemon's weight, which affects some moves.
  CODE: ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 135 Light Metal  [(vanilla-map)] pkrg=135
  ABBR: Boosts Speed by 1.3x and halves this Pokémon's weight.
  FULL: Light Metal halves the Pokemon's weight and boosts their Speed stat by 30%. Makes weight-based attacks such as Low Kick deal less damage against this Pokemon. However, it also decreases damage from the user's Heavy Slam and similar weight- based moves.
  CODE: WeightMultiplierAbAttr{showAbility=false,extraCondition=undefined,multiplier=0.5} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.3,condition=undefined}

### 136 Multiscale  [(vanilla-map)] pkrg=136
  ABBR: At full HP, halves damage taken from attacks
  FULL: Reduces all incoming damage by 50% when the Pokemon is at max HP. Multiplicative with other sources of damage reduction.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 137 Toxic Boost  [(vanilla-map)] pkrg=137
  ABBR: Ups Atk by 1.5x if poisoned. Immune to Poison status damage.
  FULL: Increases the Pokemon's Attack stat by 50% when poisoned (regular or badly poisoned). Immediately applies poison to user when in Toxic Terrain, regardless of them being grounded or not. Nullifies poison damage.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5} | BlockStatusDamageAbAttr{showAbility=false,extraCondition=undefined,effects=[1,2]}

### 138 Flare Boost  [(vanilla-map)] pkrg=138
  ABBR: Ups Sp. Atk by 1.5x if burned. Ignites in fog.
  FULL: Raises the Pokemon's Special Attack stat by 50% when burned. Negates burn damage. Immediately applies burn to self in fog.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 139 Harvest  [(vanilla-map)] pkrg=139
  ABBR: 50% chance to recycle a used Berry every turn, 100% in sun.
  FULL: 50% chance to restore berry on turn end, 100% in sun. Includes berries that were used for Fling, Natural Gift, or eaten.
  CODE: PostTurnRestoreBerryAbAttr{showAbility=true,extraCondition=undefined,berriesUnderCap=undefined,procChance=<fn>}

### 140 Telepathy  [(vanilla-map)] pkrg=140
  ABBR: Protects team from friendly fire.
  FULL: Protects the Pokemon from all damage-dealing moves used by its allies in double battles.
  CODE: MoveImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneCondition=<fn>}

### 141 Moody  [(vanilla-map)] pkrg=141
  ABBR: Sharply raises one stat and lowers another each turn.
  FULL: At the end of each turn, randomly selects one stat to raise by 2 stages and another different stat to lower by 1 stage.
  CODE: MoodyAbAttr{showAbility=true,extraCondition=undefined}

### 142 Overcoat  [(vanilla-map)] pkrg=142
  ABBR: Blocks weather dmg and powders. Takes -20% special damage.
  FULL: Provides immunity to weather damage from Sandstorm and Hail, and blocks all powder moves including Sleep Powder, Stun Spore, Poison Powder, Spore, Cotton Spore, Rage Powder, Powder, and Magic Powder. Also reduces incoming special damage by 20%. Multiplicative with other damage reduction sources.
  CODE: BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[]} | MoveImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneCondition=<fn>} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8}

### 143 Poison Touch  [(vanilla-map)] pkrg=143
  ABBR: 30% chance to poison on contact. Also works on offense.
  FULL: Has a 30% chance to inflict poison on contact moves, both when attacking and being attacked.
  CODE: PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[1]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[1],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[1]}

### 144 Regenerator  [(vanilla-map)] pkrg=144
  ABBR: Heals 1/3 of max HP upon switching out.
  FULL: Restores 33% of maximum HP when switching out. This heal is not blocked by Heal Block.
  CODE: PreSwitchOutHealAbAttr{showAbility=false,extraCondition=undefined}

### 145 Big Pecks  [(vanilla-map)] pkrg=145
  ABBR: Boosts the power of contact moves by 1.3x.
  FULL: Boosts the power of contact moves by 30%.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 146 Sand Rush  [(vanilla-map)] pkrg=146
  ABBR: This Pokémon's Speed gets a 1.5x boost in a sandstorm.
  FULL: Boosts the Pokemon's Speed stat by 50% in sand. Also grants immunity to sandstorm damage.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[3]}

### 147 Wonder Skin  [(vanilla-map)] pkrg=147
  ABBR: Blocks most damage boosting and multihit abilities.
  FULL: Immune to all damage boosting ability effects from opponents, other than Parental Bond and Multi-Headed.
  CODE: WonderSkinAbAttr{showAbility=false,extraCondition=undefined} | PostDefendSuppressOpponentDamageBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.77}

### 148 Analytic  [(vanilla-map)] pkrg=148
  ABBR: Attacks get a 1.3x power boost if it moves last.
  FULL: When the user moves after the target, boosts attack power by 30%.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 149 Illusion  [(vanilla-map)] pkrg=149
  ABBR: Appears as last party slot and boosts power by 1.3x until hit.
  FULL: Makes the Pokemon appear as the last alive party member. Boosts the user's damage by 30% until the illusion breaks.
  CODE: 

### 150 Imposter  [(vanilla-map)] pkrg=150
  ABBR: Transforms into the foe on entry.
  FULL: Transforms the Pokemon into the opponent upon switching in. Copies their appearance, stats (minus HP), types, abilities, moves, and stat changes. Each copied move has 5 PP. Cannot transform if the target has Substitute, is already transformed, has Illusion active, or is semi-invulnerable.
  CODE: PostSummonTransformAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=false,targetIndex=-1}

### 151 Infiltrator  [(vanilla-map)] pkrg=151
  ABBR: Own moves bypass Substitutes and damage reduction screens.
  FULL: Allows moves to bypass the effects of screens, Safeguard, Mist, and Substitute.
  CODE: InfiltratorAbAttr{showAbility=false,extraCondition=undefined}

### 152 Mummy  [(vanilla-map)] pkrg=152
  ABBR: If hit, makes the attacker's ability Mummy.
  FULL: When the user receives a contact move from another Pokemon who does not have this ability, it replaces their current ability with Mummy.
  CODE: PostDefendAbilityGiveAbAttr{showAbility=true,extraCondition=undefined,ability=152}

### 153 Moxie  [(vanilla-map)] pkrg=153
  ABBR: Dealing a KO raises Attack by one stage.
  FULL: Boosts the user's Attack by one stage whenever it knocks out an opponent with a direct hit.
  CODE: PostVictoryStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=1,stages=1}

### 154 Justified  [(vanilla-map)] pkrg=154
  ABBR: Boosts Attack instead of being hit by Dark-type moves.
  FULL: Immune to Dark-type moves, and boost Attack by 1 stage when the user is hit by them.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=1,selfTarget=true,allOthers=false}

### 155 Rattled  [(vanilla-map)] pkrg=155
  ABBR: If hit by Bug, Dark or Ghost move, or flinches: +1 Speed.
  FULL: Boosts Speed by one stage when hit by Bug, Dark, or Ghost-type moves or when the user flinches. Activates multiple times against multihit moves.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=1,selfTarget=true,allOthers=false} | PostIntimidateStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=[5],stages=1,overwrites=false}

### 156 Magic Bounce  [(vanilla-map)] pkrg=156
  ABBR: Bounces back the effect of status moves to their user.
  FULL: Reflects most status moves back to the user before they can take effect. The bounced move targets the original user with no additional accuracy check. Does not reflect moves that were already reflected.
  CODE: ReflectStatusMoveAbAttr{showAbility=true,extraCondition=undefined}

### 157 Sap Sipper  [(vanilla-map)] pkrg=157
  ABBR: Redirects Grass moves. Absorbs them, ups highest Atk.
  FULL: Immune to Grass-type moves, and boost highest attacking stat by 1 stage when the user is hit by them.
  CODE: TypeImmunityHighestAttackStatStageAbAttr{showAbility=true,extraCondition=undefined,immuneType=11,condition=null,stages=1}

### 158 Prankster  [(vanilla-map)] pkrg=158
  ABBR: Status moves have +1 priority but fail on opposing Dark-types.
  FULL: Status moves gain +1 priority. Status moves fail when directly targeting opposing Dark-type Pokemon.
  CODE: ChangeMovePriorityAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=1}

### 159 Sand Force  [(vanilla-map)] pkrg=159
  ABBR: Ups highest attacking stat by 1.5x in sand.
  FULL: Boosts the Pokemon's highest attacking stat by 50% in sand. Immune to sandstorm damage.
  CODE: MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[3]}

### 160 Iron Barbs  [(vanilla-map)] pkrg=160
  ABBR: Enemies lose 1/8 of max HP if they use a contact move.
  FULL: Enemies lose 1/8 of max HP if they use a contact move.
  CODE: PostDefendContactDamageAbAttr{showAbility=true,extraCondition=undefined,damageRatio=8}

### 161 Zen Mode  [(vanilla-map)] pkrg=161
  ABBR: Transforms into Zen Mode on entry until end of battle.
  FULL: Triggers form change upon battle entry.
  CODE: PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=undefined,formFunc=<fn>} | PostSummonFormChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,formFunc=<fn>} | PostTurnFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 162 Victory Star  [(vanilla-map)] pkrg=162
  ABBR: Gives 1.2x accuracy boost to its own and its allies' moves.
  FULL: Boosts the user's and their ally's accuracy by 1.2x when active in a double battle.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=undefined} | AllyStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,ignorable=false} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 163 Turboblaze  [(vanilla-map)] pkrg=163
  ABBR: Moves hit through abilities. Adds Fire type to itself.
  FULL: Allows moves to ignore the target's abilities and innates that interfere with effects or reduce damage. Does not bypass abilities that modify base stats such as Grass Pelt. Adds Fire to the user's typing. Retains Fire typing even upon losing the ability, going away only when switching out.
  CODE: PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":9},once=false}

### 164 Teravolt  [(vanilla-map)] pkrg=164
  ABBR: Moves hit through abilities. Adds Electric type to itself.
  FULL: Allows moves to ignore the target's abilities and innates that interfere with effects or reduce damage. Does not bypass abilities that modify base stats such as Grass Pelt. Adds Electric to the user's typing. Retains Electric typing even upon losing the ability, going away only when switching out.
  CODE: PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":12},once=false}

### 165 Aroma Veil  [(vanilla-map)] pkrg=165
  ABBR: Protects team from infatuation, heal block, and disabling.
  FULL: Protects the user and allies from infatuation, heal block effects, and disabling moves including Disable, Taunt, Encore, and Torment.
  CODE: UserFieldBattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["INFATUATED","HEAL_BLOCK","DISABLED"]}

### 166 Flower Veil  [(vanilla-map)] pkrg=166
  ABBR: Protects Grass-type allies from status and stat drops.
  FULL: Prevents all status conditions and stat reductions for Grass- type allies.
  CODE: ConditionalUserFieldStatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[],condition=<fn>} | ConditionalUserFieldBattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["DROWSY"],condition=<fn>} | ConditionalUserFieldProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=undefined,condition=<fn>}

### 167 Cheek Pouch  [(vanilla-map)] pkrg=167
  ABBR: This ability has no effect.
  FULL: No effect.
  CODE: 

### 168 Protean  [(vanilla-map)] pkrg=168
  ABBR: Changes type depending on the move it's about to use.
  FULL: Before each attack, the user overrides their type to match the move's type.  Activates once per turn.
  CODE: PokemonTypeChangeAbAttr{showAbility=true,extraCondition=undefined,moveType=-1}

### 169 Fur Coat  [(vanilla-map)] pkrg=169
  ABBR: Halves damage taken by Physical moves. Does NOT double Defense.
  FULL: Halves all incoming Attack damage. Multiplicative with other sources of damage reduction.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 170 Magician  [(vanilla-map)] pkrg=170
  ABBR: Steals the foe's held item after using a non-contact move.
  FULL: The user steals the target's held item when landing a non-contact move if they are currently holding no item. Does not work with Mega Stones and other similar items.
  CODE: ErMagicianStealAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,stealCondition=undefined,stolenItem=undefined}

### 171 Bulletproof  [(vanilla-map)] pkrg=171
  ABBR: Immune to projectile, ball, or bomb-based moves.
  FULL: Provides immunity to ball, bomb, and projectile moves. Includes Acid Spray, Rock Wrecker, Pollen Puff, and Barrage.
  CODE: MoveImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneCondition=<fn>}

### 172 Competitive  [(vanilla-map)] pkrg=172
  ABBR: Raises Sp. Atk by two stages if stats are lowered by an enemy.
  FULL: When the user has their stats lowered by another Pokemon, they raise their Special Attack by 2 stages.
  CODE: PostStatStageChangeStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,statsToChange=[3],stages=2}

### 173 Strong Jaw  [(vanilla-map)] pkrg=173
  ABBR: Boosts the power of bite/fang moves by 1.3x.
  FULL: Boosts the power of biting and fang moves by 30%.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 174 Refrigerate  [(vanilla-map)] pkrg=174
  ABBR: Normal moves become Ice. Ice moves are empowered.
  FULL: Changes the user's Normal-type moves to Ice-type. If the user is Ice-type its Ice-type moves have a 10% frostbite chance, otherwise it gains Ice STAB.
  CODE: MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=14,condition=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=14,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 175 Sweet Veil  [(vanilla-map)] pkrg=175
  ABBR: This Pokémon and its ally are immune to sleep.
  FULL: Provides sleep immunity to both the user and their ally in double battles.
  CODE: UserFieldStatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[4]} | PostSummonUserFieldRemoveStatusEffectAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,statusEffect=[4]} | UserFieldBattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["DROWSY"]}

### 176 Stance Change  [(vanilla-map)] pkrg=176
  ABBR: Turns into Blade or Shield form depending on move used.
  FULL: Changes Aegislash's form based on moves used. Shield form switches to Blade when using damaging moves. Blade switches to Shield with King's Shield. Redux forms swap between physical/special based on move type. Unsuppressable. Form changes occur before attacks execute.
  CODE: NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 177 Gale Wings  [(vanilla-map)] pkrg=177
  ABBR: Flying-type moves get +1 priority at full HP.
  FULL: Grants +1 priority to Flying- type moves when at full HP.
  CODE: ChangeMovePriorityAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1}

### 178 Mega Launcher  [(vanilla-map)] pkrg=178
  ABBR: Boosts Beam/Pump/Cannon/Shot/ Gun/Pulse, etc. moves by 1.3x.
  FULL: Boosts pulse, beam, ball, and aura moves by 30%.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 179 Grass Pelt  [(vanilla-map)] pkrg=179
  ABBR: This Pokémon's Defense gets a 1.5x boost in Grassy Terrain.
  FULL: Boosts the user's Defense stat by 50% when in Grassy Terrain.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=2,multiplier=1.5,condition=undefined}

### 180 Symbiosis  [(vanilla-map)] pkrg=180
  ABBR: Passes own item to its ally if said ally consumes its item.
  FULL: Transfers the holder's item to an ally immediately after that ally consumes or uses up their held item.
  CODE: 

### 181 Tough Claws  [(vanilla-map)] pkrg=181
  ABBR: Boosts the power of contact moves by 1.3x.
  FULL: Contact moves are boosted by 30%.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 182 Pixilate  [(vanilla-map)] pkrg=182
  ABBR: Normal moves become Fairy. Fairy moves are empowered.
  FULL: Changes the user's Normal-type moves to Fairy-type. If the user is Fairy-type its Fairy-type moves have a 10% infatuate chance, otherwise it gains Fairy STAB.
  CODE: MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=17,condition=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=17,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 183 Gooey  [(vanilla-map)] pkrg=183
  ABBR: Lowers Speed of enemies that make contact with this Pokémon.
  FULL: When the user is hit by a contact move, the attacker reduces their Speed by one stage. Activates multiple times against multihit moves.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=-1,selfTarget=false,allOthers=false}

### 184 Aerilate  [(vanilla-map)] pkrg=184
  ABBR: Normal moves become Flying. Flying moves are empowered.
  FULL: Changes the user's Normal-type moves to Flying-type. If the user is Flying-type its Flying-type moves are 10% faster, otherwise it gains Flying STAB.
  CODE: MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=2,condition=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=2,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 185 Parental Bond  [(vanilla-map)] pkrg=185
  ABBR: Moves hit twice. 1st hit at 100% power, 2nd hit at 25%.
  FULL: Makes all attacks hit twice in succession. The first hit deals 100%, while the second hit deals 25%. Each hit rolls secondary effects independently (except flinch). Bypasses Fort Knox/Wonder Skin.
  CODE: AddSecondStrikeAbAttr{showAbility=true,extraCondition=undefined} | MoveDamageBoostAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.25,condition=<fn>} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 186 Dark Aura  [(vanilla-map)] pkrg=186
  ABBR: Boosts Dark moves by 1.33x for all while this Pokémon is out.
  FULL: All Dark-type moves for the user, their allies, and the opponent get a 1.33x boost. Boost is reversed by Aura Break.
  CODE: PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>} | FieldMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,powerMultiplier=1.3333333333333333}

### 187 Fairy Aura  [(vanilla-map)] pkrg=187
  ABBR: Boosts Fairy moves by 1.33x for all while this Pokémon is out.
  FULL: All Fairy-type moves for the user, their allies, and the opponent get a 1.33x boost. Boost is reversed by Aura Break.
  CODE: PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>} | FieldMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,powerMultiplier=1.3333333333333333}

### 188 Aura Break  [(vanilla-map)] pkrg=188
  ABBR: Cancels aura abilities and makes them 25% weaker instead.
  FULL: Causes Dark Aura and Fairy Aura to reduce their respective type moves by 25% instead of boosting them by 33%.
  CODE: FieldMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=<fn>,condition=<fn>,powerMultiplier=0.5625} | FieldMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=<fn>,condition=<fn>,powerMultiplier=0.5625} | PostSummonMessageAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,messageFunc=<fn>}

### 189 Primordial Sea  [(vanilla-map)] pkrg=189
  ABBR: Heavy Rain until switched out. Fire-type moves are unusable.
  FULL: Creates Heavy Rain that lasts until user switches. Completely nullifies all damaging Fire moves. Water moves gain 50% boost. Cannot be overridden except by other primal weather. Activates extra effects on rain related moves. Halves the effectiveness of sun related moves.
  CODE: PostSummonWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=7} | PostBiomeChangeWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,weatherType=7} | PreLeaveFieldClearWeatherAbAttr{showAbility=false,extraCondition=undefined,weatherType=7} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 190 Desolate Land  [(vanilla-map)] pkrg=190
  ABBR: Intense Sun until switched out. Water-type moves are unusable.
  FULL: Creates Extremely Harsh Sunlight lasting until user switches. Completely nullifies all damaging Water moves. Fire moves gain 50% boost. Cannot be overridden except by other primal weather. Activates extra effects on sun related moves.
  CODE: PostSummonWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=8} | PostBiomeChangeWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,weatherType=8} | PreLeaveFieldClearWeatherAbAttr{showAbility=false,extraCondition=undefined,weatherType=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 191 Delta Stream  [(vanilla-map)] pkrg=191
  ABBR: Strong Winds until switched out. Weather-based moves not usable.
  FULL: Creates Strong Winds lasting until user switches. Reduces super-effective damage to all active Flying-types to neutral. Blocks all weather-based moves from hitting opponents. Cannot be overridden except by other primal weather.
  CODE: PostSummonWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=9} | PostBiomeChangeWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,weatherType=9} | PreLeaveFieldClearWeatherAbAttr{showAbility=false,extraCondition=undefined,weatherType=9}

### 192 Stamina  [(vanilla-map)] pkrg=192
  ABBR: Getting hit raises Def by +1. Critical hits maximize Defense.
  FULL: When hit, raises the user's Defense by 1 stage or maximizes it on critical hits. Activates on each hit of a multihit move.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=2,stages=1,selfTarget=true,allOthers=false} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=2,stages=12}

### 193 Wimp Out  [(vanilla-map)] pkrg=193
  ABBR: At 1/2 of max HP or below, instantly switches out.
  FULL: When the Pokemon receives damage and its HP drops to 50% or below for the first time in battle, it switches out to safety. Activates on the last hit of multihit moves.
  CODE: PostDamageForceSwitchAbAttr{showAbility=true,extraCondition=undefined,helper={"switchType":1},hpRatio=0.5}

### 194 Emergency Exit  [(vanilla-map)] pkrg=194
  ABBR: At 1/2 of max HP or below, instantly switches out.
  FULL: When the Pokemon receives damage and its HP drops to 50% or below for the first time in battle, it switches out to safety. Activates on the last hit of multihit moves.
  CODE: PostDamageForceSwitchAbAttr{showAbility=true,extraCondition=undefined,helper={"switchType":1},hpRatio=0.5}

### 195 Water Compaction  [(vanilla-map)] pkrg=195
  ABBR: Takes 1/2 dmg from Water-type moves. +2 Def when hit by those.
  FULL: Reduces damage from Water-type moves by 50% and raises Defense by 2 stages when hit by Water moves. Multiplicative with other sources of damage reduction. Defense boost applies after the hit lands. Activates on each hit of a multihit move.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=2,stages=2,selfTarget=true,allOthers=false} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 196 Merciless  [(vanilla-map)] pkrg=196
  ABBR: Always crits slowed, poisoned, paralyzed, or bleeding foes.
  FULL: Guarantees critical hits against targets who are poisoned, paralyzed, bleeding, or have their speed lowered.
  CODE: ConditionalCritAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>}

### 197 Shields Down  [(vanilla-map)] pkrg=197
  ABBR: At 1/2 of max HP or below, transforms into Core form.
  FULL: Transforms Minior from Meteor Form to Core Form when HP drops to 50% or below. In Meteor Form, grants immunity to all status conditions. When using Shell Smash, immediately transforms to Core Form regardless of current HP. Cannot revert to Meteor Form once transformed during battle.
  CODE: PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=undefined,formFunc=<fn>} | PostSummonFormChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,formFunc=<fn>} | PostTurnFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>} | StatusEffectImmunityAbAttr{showAbility=true,extraCondition=<fn>,immuneEffects=[]} | BattlerTagImmunityAbAttr{showAbility=true,extraCondition=<fn>,immuneTagTypes=["DROWSY"]} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined} | NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 198 Stakeout  [(vanilla-map)] pkrg=198
  ABBR: Deals double damage to opponents being switched in.
  FULL: Deals double damage to opponents that just switched in. Only works right after they switch in for 1 turn.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2}

### 199 Water Bubble  [(vanilla-map)] pkrg=199
  ABBR: Halves Fire dmg taken. Doubles Water dmg dealt. No burns.
  FULL: Doubles the power of Water-type moves and reduces Fire-type damage taken by 50%. Also provides complete immunity to burns, removing existing burns upon gaining the ability.
  CODE: ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2} | StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[6]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[6],statusHealed=undefined}

### 200 Steelworker  [(vanilla-map)] pkrg=200
  ABBR: Normal moves become Steel. Steel resists Ghost and Dark.
  FULL: Changes the user's Normal-type moves to Steel-type. If the user is Steel-type it resists Ghost and Dark, otherwise it gains Steel STAB.
  CODE: MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=8,condition=<fn>} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 201 Berserk  [(vanilla-map)] pkrg=201
  ABBR: Boosts highest attack by +1 when at 1/2 of max HP or lower.
  FULL: Berserk activates when the Pokemon drops to half HP or below from an opposing attack, boosting its highest attacking stat by one stage. Includes stat stages to determine which gets boosted. Triggers only once per battle. Other damage sources that bring you to half HP or below will not activate it.
  CODE: PostDefendHpGatedStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,hpGate=0.5,stats=[3],stages=1,selfTarget=true} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=1,selfTarget=true,allOthers=false}

### 202 Slush Rush  [(vanilla-map)] pkrg=202
  ABBR: This Pokémon's Speed gets a 1.5x boost in hail.
  FULL: Boosts the Pokemon's Speed stat by 50% during hail. Also grants immunity to hail damage.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined}

### 203 Long Reach  [(vanilla-map)] pkrg=203
  ABBR: Physical moves get a 1.2x bonus and don't make contact.
  FULL: Long Reach prevents the user from making contact with targets when using contact moves. Additionally, physical moves receive a 1.2x damage boost.
  CODE: IgnoreContactAbAttr{showAbility=true,extraCondition=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 204 Liquid Voice  [(vanilla-map)] pkrg=204
  ABBR: Sound moves get a 1.2x boost and become Water if Normal.
  FULL: Liquid Voice converts Normal- type sound moves to Water-type and boosts them by 20%.
  CODE: MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=10,condition=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 205 Triage  [(vanilla-map)] pkrg=205
  ABBR: Moves that have a healing effect gain +3 priority.
  FULL: Triage grants +3 priority to most healing moves. Includes draining moves like Giga Drain, and delayed healing moves like Wish. Does not work with  Aqua Ring, Grassy Terrain, Ingrain, Leech Seed, Pain Split, Present, or Pollen Puff.
  CODE: ChangeMovePriorityAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=3}

### 206 Galvanize  [(vanilla-map)] pkrg=206
  ABBR: Normal moves become Electric. Electric moves are empowered.
  FULL: Changes the user's Normal-type moves to Electric-type. If the user is Electric-type its Electric-type moves have a 10% chance to paralyze, otherwise it gains Electric STAB.
  CODE: MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=12,condition=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=12,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 207 Surge Surfer  [(vanilla-map)] pkrg=207
  ABBR: If Electric Terrain is active, gets a 1.5x Speed boost.
  FULL: Surge Surfer boosts the Pokemon's Speed by 50% when Electric Terrain is active. The boost applies immediately and disappears when it ends.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=5,multiplier=1.5,condition=undefined}

### 208 Schooling  [(vanilla-map)] pkrg=208
  ABBR: If Lv. 20 or more: changes into School form until 1/4 HP or less.
  FULL: When at level 20 or above, transforms into School Form. Reverts to Solo Form when HP drops to 25% or less. This form change triggers automatically upon entry and at end of each turn. Cannot be overridden, suppressed, swapped, or copied in any way.
  CODE: PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=undefined,formFunc=<fn>} | PostSummonFormChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,formFunc=<fn>} | PostTurnFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 209 Disguise  [(vanilla-map)] pkrg=209
  ABBR: Protects once against an attack. Restores protection in fog.
  FULL: Disguise blocks the first damaging move that hits the Pokemon and changes its form after. Only non-status moves are blocked. In fog, the disguise is restored immediately once per switch in, or when fog is set again.
  CODE: NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined} | FormBlockDamageAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0,formIndex=0,recoil=0.125,i18nKey="abilityTriggers:disguiseAvoidedDamage"} | PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=undefined,formFunc=<fn>} | PostFaintFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>}

### 210 Battle Bond  [(vanilla-map)] pkrg=210
  ABBR: Transforms into Battle Bond form after dealing a KO.
  FULL: Battle Bond immediately triggers a form change when this Pokemon deals the finishing blow to an opposing Pokemon. Cannot be copied.
  CODE: PostVictoryFormChangeAbAttr{showAbility=true,extraCondition=<fn>,formFunc=<fn>} | PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=<fn>,formFunc=<fn>} | PostFaintFormChangeAbAttr{showAbility=true,extraCondition=<fn>,formFunc=<fn>} | PostVictoryStatStageChangeAbAttr{showAbility=true,extraCondition=<fn>,stats=[1,3,5],stages=1}

### 211 Power Construct  [(vanilla-map)] pkrg=211
  ABBR: At 1/2 of max HP or below, transforms into Complete form.
  FULL: Power Construct transforms Zygarde 50% or 10% forms into Complete form when HP drops to 50% or below at the end of any turn. Complete form has massive 216 HP (doubled from 108), making it an extremely bulky tank. The transformation is permanent for the battle and cannot be suppressed.
  CODE: PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=<fn>,formFunc=<fn>} | PostSummonFormChangeAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,formFunc=<fn>} | PostTurnFormChangeAbAttr{showAbility=true,extraCondition=<fn>,formFunc=<fn>} | PostFaintFormChangeAbAttr{showAbility=true,extraCondition=<fn>,formFunc=<fn>} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 212 Corrosion  [(vanilla-map)] pkrg=212
  ABBR: Poison is super effective vs Steel. Can poison any type.
  FULL: Poison-type moves become super effective against Steel-type Pokemon. Additionally, this Pokemon can inflict poison status on any type.
  CODE: IgnoreTypeStatusEffectImmunityAbAttr{showAbility=false,extraCondition=undefined,statusEffect=[1,2],defenderType=[8,3]}

### 213 Comatose  [(vanilla-map)] pkrg=213
  ABBR: Can move, but is always asleep. Immune to status conditions.
  FULL: Comatose considers the user as asleep for moves and statuses. The Pokemon can move normally and gains immunity to all status conditions. Cannot be copied or suppressed. Rest fails when used.
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[1,2,3,4,5,6]} | BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["DROWSY"]}

### 214 Queenly Majesty  [(vanilla-map)] pkrg=214
  ABBR: Protects itself and ally from priority moves.
  FULL: Queenly Majesty prevents the user and its ally from being targeted by priority moves with priority higher than 0.
  CODE: FieldPriorityMoveImmunityAbAttr{showAbility=true,extraCondition=undefined}

### 215 Innards Out  [(vanilla-map)] pkrg=215
  ABBR: If KO'd, deals as much damage as what the fatal attack dealt.
  FULL: Innards Out activates when the Pokemon is knocked out by an opponent's attack. It inflicts the same amount of damage the fatal attack dealt back to the attacker. Cannot affect attackers protected by Magic Guard.
  CODE: PostFaintHPDamageAbAttr{showAbility=true,extraCondition=undefined}

### 216 Dancer  [(vanilla-map)] pkrg=216
  ABBR: Copies dance moves used by others.
  FULL: When any Pokemon on the field uses a dance move, this Pokemon immediately uses the same move after. Triggers once per move.
  CODE: PostDancingMoveAbAttr{showAbility=true,extraCondition=undefined}

### 217 Battery  [(vanilla-map)] pkrg=217
  ABBR: Grants a 1.3x power boost to ally's Special attacks.
  FULL: Battery provides a 30% boost to ally Pokemon's Special attacks in double battles. Does not affect the user's own moves.
  CODE: AllyMoveCategoryPowerBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,powerMultiplier=1.3}

### 218 Fluffy  [(vanilla-map)] pkrg=218
  ABBR: Takes 1/2 dmg from contact moves but Fire moves hurt it 2x more.
  FULL: Fluffy reduces damage from contact moves by 50%. Fire-type moves to deal double damage to the user. Multiplicative with other forms of damage reduction.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=2}

### 219 Dazzling  [(vanilla-map)] pkrg=219
  ABBR: Protects itself and ally from priority moves.
  FULL: Dazzling blocks all priority moves from opponents targeting the user or allies.
  CODE: FieldPriorityMoveImmunityAbAttr{showAbility=true,extraCondition=undefined}

### 220 Soul-Heart  [(vanilla-map)] pkrg=220
  ABBR: KOs dealt anywhere on the field raise Sp. Atk by one stage.
  FULL: Soul-Heart raises Special Attack by one stage when any Pokemon faints on the battlefield, including allies and enemies.
  CODE: PostKnockOutStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=3,stages=1}

### 221 Tangling Hair  [(vanilla-map)] pkrg=221
  ABBR: Lowers Speed of enemies that make contact with this Pokémon.
  FULL: When the user is hit by a contact move, the attacker reduces their Speed by one stage. Activates multiple times against multihit moves.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=-1,selfTarget=false,allOthers=false}

### 222 Receiver  [(vanilla-map)] pkrg=222
  ABBR: In Double Battles, copies its fainting partner's ability.
  FULL: Receiver copies a fainted ally's ability, replacing Receiver. Persists until switched out.
  CODE: CopyFaintedAllyAbilityAbAttr{showAbility=true,extraCondition=undefined}

### 223 Power of Alchemy  [(vanilla-map)] pkrg=223
  ABBR: Transmutes berries on entry. Transmutes items when lost.
  FULL: Upon entry, transmutes all opposing Berries into Black Sludge. When any Pokemon loses an item during battle, it gets replaced by Black Sludge. If Black Sludge is removed, it gets replaced by Big Nugget.
  CODE: CopyFaintedAllyAbilityAbAttr{showAbility=true,extraCondition=undefined}

### 224 Beast Boost  [(vanilla-map)] pkrg=224
  ABBR: Dealing a KO raises highest calculated stat by one stage.
  FULL: Beast Boost raises the user's highest calculated stat by one stage each time it KOs an opponent. The stat raised is determined by comparing the raw stat without current modifiers such as stat raises.
  CODE: PostVictoryStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=<fn>,stages=1}

### 225 RKS System  [(vanilla-map)] pkrg=225
  ABBR: Held Memory determines its type. Also has Protean + Adaptability.
  FULL: RKS System changes the user's form based on its held Memory disc. Before each attack, the user overrides their type to match the move's type. Boosts STAB from 1.5x to 2.0x damage.
  CODE: NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 226 Electro Surge  [entry-effect] pkrg=5000
  ABBR: Casts Electric Terrain on entry. Lasts 8 turns.
  FULL: Creates Electric Terrain for 8 turns (12 with Terrain Extender) upon entry. Grounded Pokemon cannot fall asleep and Electric moves gain 30% power boost. Overrides other terrains when activated.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-terrain","terrain":2,"turns":8},once=false}

### 227 Psychic Surge  [(vanilla-map)] pkrg=227
  ABBR: Casts Psychic Terrain on entry. Lasts 8 turns.
  FULL: Creates Psychic Terrain for 8 turns (12 with Terrain Extender) on entry. Grounded Pokemon are immune to priority moves from opponents. Psychic moves gain 30% power boost. Expanding Force hits all foes with increased power. Nature Power becomes Psychic. Overrides other existing terrains.
  CODE: ErTerrainSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,terrainType=4,erTurns=8} | PostBiomeChangeTerrainChangeAbAttr{showAbility=true,extraCondition=undefined,terrainType=4} | SummonTerrainAiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 228 Misty Surge  [(vanilla-map)] pkrg=228
  ABBR: Casts Misty Terrain on entry. Lasts 8 turns.
  FULL: Creates Misty Terrain on entry, lasting 8 turns (12 with Terrain Extender). Misty Terrain prevents all status conditions for grounded Pokemon and boosts Fairy-type moves by 30%. Overrides existing terrain.
  CODE: ErTerrainSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,terrainType=1,erTurns=8} | PostBiomeChangeTerrainChangeAbAttr{showAbility=true,extraCondition=undefined,terrainType=1} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 229 Grassy Surge  [(vanilla-map)] pkrg=229
  ABBR: Casts Grassy Terrain on entry. Lasts 8 turns.
  FULL: Creates Grassy Terrain for 8 turns (12 with Terrain Extender) on entry. Grounded Pokemon heal 1/16 HP per turn and Grass moves gain 30% power. Overrides other terrains.
  CODE: ErTerrainSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,terrainType=3,erTurns=8} | PostBiomeChangeTerrainChangeAbAttr{showAbility=true,extraCondition=undefined,terrainType=3} | SummonTerrainAiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 230 Full Metal Body  [(vanilla-map)] pkrg=230
  ABBR: Immune to stat drops.
  FULL: Full Metal Body gives immunity to all stat reductions from moves and abilities. Includes self stat drops from moves like Overheat.
  CODE: ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=undefined}

### 231 Shadow Shield  [(vanilla-map)] pkrg=231
  ABBR: At full HP, halves damage taken from attacks
  FULL: Shadow Shield halves damage from all attacks when at full HP. Multiplicative with other damage reduction sources.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 232 Prism Armor  [(vanilla-map)] pkrg=232
  ABBR: Takes 35% less damage from Super-effective moves.
  FULL: Reduces damage from super- effective attacks by 35%. Multiplicative with other sources of damage reduction.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65}

### 233 Neuroforce  [(vanilla-map)] pkrg=233
  ABBR: Grants an additional 1.35x boost to Super-effective moves.
  FULL: Super effective attacks are boosted by 35%.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.35}

### 234 Intrepid Sword  [(vanilla-map)] pkrg=234
  ABBR: On entry, raises Attack by one stage.
  FULL: Intrepid Sword raises the Pokemon's Attack stat by one stage when switching into battle.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[1],stages=1,selfTarget=true,intimidate=false} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 235 Dauntless Shield  [(vanilla-map)] pkrg=235
  ABBR: On entry, raises Defense by one stage.
  FULL: Dauntless Shield immediately raises Defense by one stage when entering battle.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[2],stages=1,selfTarget=true,intimidate=false} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 236 Libero  [(vanilla-map)] pkrg=236
  ABBR: Before using a move, changes its type to the move's type.
  FULL: Libero overrides the user's type to match the move being used before it attacks. Cannot activate on Struggle moves.
  CODE: PokemonTypeChangeAbAttr{showAbility=true,extraCondition=undefined,moveType=-1}

### 237 Ball Fetch  [(vanilla-map)] pkrg=237
  ABBR: No effect in battle.
  FULL: No effect in battle.
  CODE: FetchBallAbAttr{showAbility=true,extraCondition=undefined}

### 238 Cotton Down  [(vanilla-map)] pkrg=238
  ABBR: Lowers the Speed of all foes by one stage when hit.
  FULL: Cotton Down triggers when the Pokemon is hit by any attack, lowering the Speed of ALL Pokemon by one stage. Activates multiple times against multihit moves.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=-1,selfTarget=false,allOthers=true}

### 239 Propeller Tail  [(vanilla-map)] pkrg=239
  ABBR: Swift Swim + Redirection Immunity.
  FULL: Propeller Tail boosts the user's Speed by 50% during rain and grants immunity to redirection effects. The speed boost works in all forms of rain.
  CODE: BlockRedirectAbAttr{showAbility=true,extraCondition=undefined}

### 240 Mirror Armor  [(vanilla-map)] pkrg=240
  ABBR: Bounces back any stat drops inflicted by an enemy.
  FULL: Mirror Armor reflects all stat- lowering effects aimed at the user back to the attacker. The reflection bypasses immunities.
  CODE: ReflectStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,reflectedStat=undefined}

### 241 Gulp Missile  [(vanilla-map)] pkrg=241
  ABBR: Gulps a prey after Dive/Surf. If hit, shoots prey at enemy.
  FULL: When Cramorant uses Surf, Triple Dive or Dive, it catches prey: Gulping form if HP >50% or Gorging form if HP <=50%. When hit in either form, spits prey dealing 25% max HP damage to attacker and returns to base. Gulping Form also lowers Defense by 1; Gorging Form paralyzes. Cannot be suppressed etc.
  CODE: NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 242 Stalwart  [(vanilla-map)] pkrg=242
  ABBR: Isn't affected by redirection, crits, or ability suppression.
  FULL: Can't have its moves redirected, can't be critically hit, and can't have its abilities suppressed. Ability suppression includes effects such as Mold Breaker, Gastro Acid, Neutralizing Gas, and Mycelium Might.
  CODE: BlockRedirectAbAttr{showAbility=true,extraCondition=undefined}

### 243 Steam Engine  [(vanilla-map)] pkrg=243
  ABBR: Maximizes Speed if hit by a Fire-type or Water-type attack.
  FULL: Steam Engine maximizes the Speed stat to +6 stages when hit by any Fire-type or Water-type move. The boost occurs immediately after taking damage.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=6,selfTarget=true,allOthers=false}

### 244 Punk Rock  [(vanilla-map)] pkrg=244
  ABBR: Sound moves deal 1.3x more dmg. Takes -50% dmg from sound moves.
  FULL: Punk Rock amplifies the user's sound moves by 30% and reduces incoming sound move damage by 50%. Damage reduction is multiplicative with other sources.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 245 Sand Spit  [(vanilla-map)] pkrg=245
  ABBR: Summons a sandstorm when hit. Attacker is then grounded.
  FULL: When damaged by an attack summons an 8-turn sandstorm if one isn't present. If a sandstorm is summoned the attacker is knocked to the ground. The user gains immunity to sandstorm damage. Does not activate if the user faints from the attack.
  CODE: PostDefendWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,weatherType=3,condition=<fn>}

### 246 Ice Scales  [(vanilla-map)] pkrg=246
  ABBR: Halves damage taken by Special moves. Does NOT double SpDef.
  FULL: Halves all incoming Special Attack damage. Multiplicative with other sources of damage reduction.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 247 Ripen  [(vanilla-map)] pkrg=247
  ABBR: Doubles resistance, healing and stat raises provided by Berries.
  FULL: Ripen doubles all beneficial berry effects. Healing berries restore twice as much HP, stat- boosting berries raise stats by 2 stages instead of 1, resist berries reduce super-effective damage by 75% instead of 50%, and PP-restoring berries restore twice as much PP.
  CODE: DoubleBerryEffectAbAttr{showAbility=true,extraCondition=undefined}

### 248 Ice Face  [(vanilla-map)] pkrg=248
  ABBR: Protects once against an attack. Restores protection under hail.
  FULL: Ice Face transforms Eiscue into its Noice Face form after taking a physical attack, negating damage once. While in Noice form, if hail is set or if the user is swapped in, revert to Ice Face form. Cannot be copied or suppressed.
  CODE: NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined} | PostSummonFormChangeAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,formFunc=<fn>} | IceFaceFormChangeAbAttr{showAbility=true,extraCondition=undefined,formIndex=1} | FormBlockDamageAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0,formIndex=0,recoil=0,i18nKey="abilityTriggers:iceFaceAvoidedDamage"} | PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=undefined,formFunc=<fn>}

### 249 Power Spot  [(vanilla-map)] pkrg=249
  ABBR: Grants a 1.3x boost to ally's attacks.
  FULL: Power Spot boosts allies' attack power by 30% in double battles. The user itself receives no boost.
  CODE: AllyMoveCategoryPowerBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,powerMultiplier=1.3}

### 250 Mimicry  [(vanilla-map)] pkrg=250
  ABBR: Changes type depending on active Terrain.
  FULL: Mimicry changes the Pokemon's type to match active terrain: Electric on Electric Terrain, Fairy on Misty Terrain, Grass on Grassy Terrain, or Psychic on Psychic Terrain. The type change persists until terrain ends or the Pokemon switches out. Retains type changes from moves like Soak.
  CODE: TerrainEventTypeChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true}

### 251 Screen Cleaner  [(vanilla-map)] pkrg=251
  ABBR: Clears screens from both sides on entry. Can reset screens.
  FULL: Screen Cleaner removes all protective screens from both sides of the battlefield - Reflect, Light Screen, Aurora Veil, and Smokescreen - when the Pokemon enters battle. It also allows the Pokemon to set screens while they are already active, refreshing their duration.
  CODE: PostSummonRemoveArenaTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,arenaTags=["AURORA_VEIL","LIGHT_SCREEN","REFLECT"]}

### 252 Steely Spirit  [(vanilla-map)] pkrg=252
  ABBR: Boosts own & ally's Steel-type moves by 1.3x.
  FULL: Steely Spirit increases the power of Steel-type moves by 30% for both the user and its allies in battle.
  CODE: UserFieldMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,powerMultiplier=1.3}

### 253 Perish Body  [(vanilla-map)] pkrg=253
  ABBR: If hit, casts Perish Song.
  FULL: When hit by a contact move, Perish Body activates Perish Song on both the user and the attacker. Both Pokemon will faint in 3 turns unless they switch out.
  CODE: PostDefendPerishSongAbAttr{showAbility=true,extraCondition=undefined,turns=4}

### 254 WandrngSprit  [bespoke] pkrg=5001
  ABBR: Trades ability with attacker on contact.
  FULL: When hit by a contact move, Wandering Spirit swaps abilities with the attacker. Both Pokemon regain their original ability upon switching out. Cannot swap with abilities that are also unable to be copied or suppressed.
  CODE: PostDefendAbilitySwapAbAttr{showAbility=true,extraCondition=undefined}

### 255 Gorilla Tactics  [(vanilla-map)] pkrg=255
  ABBR: Raises own Atk by 1.5x, but can only use the first chosen move.
  FULL: Gorilla Tactics boosts physical move power by 50% but locks the user into using the first move selected until they switch out.
  CODE: GorillaTacticsAbAttr{showAbility=false,extraCondition=undefined} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 256 Neutralizing Gas  [(vanilla-map)] pkrg=256
  ABBR: All abilities are nullified.
  FULL: Fills the area with gas that completely suppresses all abilities except unsuppressable ones. Effect lasts while user is on field. After the user attempts to switch, all suppressed abilities reactivate their entry effects. Cannot be copied or swapped.
  CODE: PostSummonAddArenaTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,tagType="NEUTRALIZING_GAS",turnCount=0,side=undefined,quiet=undefined,sourceId=undefined} | PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr{showAbility=false,extraCondition=undefined} | NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 257 Pastel Veil  [(vanilla-map)] pkrg=257
  ABBR: Casts Safeguard on entry.
  FULL: Pastel Veil automatically sets up Safeguard for the user's team when the Pokemon enters battle. Safeguard lasts for 5 turns and protects all team members from status conditions.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"scripted-move","move":219},once=false}

### 258 HungerSwitch  [(vanilla-map)] pkrg=258
  ABBR: Changes between Full and Hangry forms after each turn.
  FULL: Automatically switches between Full and Hangry forms at the end of each turn. Cannot be overridden, suppressed, swapped, or copied in any way.
  CODE: PostTurnFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>} | PostTurnFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>} | NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 259 Quick Draw  [(vanilla-map)] pkrg=259
  ABBR: 30% chance to move first.
  FULL: Quick Draw gives a 30% chance for the user to act first in their priority bracket. Stacks multiplicatively with Quick Claw for a 44% chance to activate.
  CODE: BypassSpeedChanceAbAttr{showAbility=true,extraCondition=undefined,chance=30}

### 260 Unseen Fist  [(vanilla-map)] pkrg=260
  ABBR: Contact moves strike through protection.
  FULL: Unseen Fist allows all contact moves to bypass protection moves and ignore any secondary effects associated with them.
  CODE: IgnoreProtectOnContactAbAttr{showAbility=true,extraCondition=undefined}

### 261 CuriusMedicn  [bespoke] pkrg=5002
  ABBR: Resets its ally's stat changes on entry.
  FULL: Curious Medicine removes an ally's positive and negative stat changes on the user's entry.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":114}}

### 262 Transistor  [(vanilla-map)] pkrg=262
  ABBR: Boosts the power of Electric-type moves by 1.5x.
  FULL: Transistor increases the power of all Electric-type moves by 50%. Stacks additively with other damage modifiers.
  CODE: MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 263 Dragon's Maw  [(vanilla-map)] pkrg=263
  ABBR: Boosts the power of Dragon-type moves by 1.5x.
  FULL: Dragon's Maw boosts the power of Dragon-type moves by 50%.
  CODE: MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 264 ChillngNeigh  [stat-trigger-on-event] pkrg=5003
  ABBR: KOs raise Attack by one stage.
  FULL: When this Pokemon knocks out an opponent with a direct attack, its Attack stat increases by one stage.
  CODE: StatTriggerOnKoAbAttr{showAbility=true,extraCondition=undefined,event="on-ko",stats=[{"stat":1,"stages":1}]}

### 265 Grim Neigh  [(vanilla-map)] pkrg=265
  ABBR: KOs raise Sp. Atk by one stage.
  FULL: Grim Neigh boosts the Pokemon's Special Attack by one stage when it causes an opponent to faint with a direct attack.
  CODE: PostVictoryStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=3,stages=1}

### 266 As One  [composite-vanilla-mashup] pkrg=5004
  ABBR: Unnerve + Chilling Neigh.
  FULL: Prevents all opposing Pokemon from consuming held items. Raise Attack by one stage when the user knocks out an opponent with a direct attack.
  CODE: PreventBerryUseAbAttr{showAbility=true,extraCondition=undefined} | PostVictoryStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=1,stages=1}

### 266 As One  [composite-vanilla-mashup] pkrg=5004
  ABBR: Unnerve + Grim Neigh.
  FULL: Prevents all opposing Pokemon from consuming held items. Raise Attack by one stage when the user knocks out an opponent with a direct attack.
  CODE: PreventBerryUseAbAttr{showAbility=true,extraCondition=undefined} | PostVictoryStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=1,stages=1}

### 268 Chloroplast  [bespoke] pkrg=5006
  ABBR: Weather Ball, Solar Beam/Blade, Growth act as if used in sun.
  FULL: Weather Ball doubles power and becomes Fire-type. Solar moves charge instantly. Growth boosts Attack and Special Attack by 2 stages. Moonlight, Morning Sun, and Synthesis recover 2/3 of your max HP. Grass and Water Pledge creates a sea of fire or rainbow respectively.
  CODE: 

### 269 Whiteout  [bespoke] pkrg=5007
  ABBR: Ups highest attacking stat by 1.5x in hail.
  FULL: Whiteout boosts the Pokemon's highest attacking stat by 50% during hail. Also grants immunity to hail damage.
  CODE: SelfHighestStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1.5,condition=undefined,candidates=[1,3],mult=1.5,weathers=[4,5]}

### 270 Pyromancy  [bespoke] pkrg=5008
  ABBR: Moves inflict burn 5x as often.
  FULL: Pyromancy multiplies the burn chance of all moves by 5x. Does not interact with Flame Body.
  CODE: StatusChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,status=6}

### 271 Keen Edge  [bespoke] pkrg=5009
  ABBR: Boosts the power of slashing moves by 1.3x.
  FULL: Keen Edge boosts all slashing attacks by 30%.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 272 Prism Scales  [damage-reduction-generic] pkrg=5010
  ABBR: Takes 30% less damage from Special attacks.
  FULL: Prism Scales reduces damage from all Special attacks by 30%. Stacks multiplicatively with other damage reduction sources.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.7,reductionAmount=0.3,filterSpec={"kind":"category","category":1}}

### 273 Power Fists  [bespoke] pkrg=5011
  ABBR: Iron Fist moves target Special Defense and get a 1.3x boost.
  FULL: Punching moves gain a 30% damage boost and target Special Defense instead of Defense.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=128,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | DefenseStatSwapOnFlagAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1,opts={"flag":128,"swap":"target-spdef-instead-of-def"}}

### 274 Sand Song  [type-conversion] pkrg=5012
  ABBR: Sound moves get a 1.2x boost and become Ground if Normal.
  FULL: Sand Song boosts the power of all sound-based moves by 20% and converts Normal-type sound moves to Ground-type.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=4,condition=<fn>,source={"kind":"flag","flag":4,"requireType":0},configuredNewType=4} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"flag","flag":4,"requireType":0},multiplier=1.2}

### 275 Rampage  [bespoke] pkrg=5013
  ABBR: No recharge after a KO, if it usually would need to recharge.
  FULL: Rampage eliminates recharge turns when the user successfully KOs an opponent with a direct attack.
  CODE: PostVictoryClearTagAbAttr{showAbility=true,extraCondition=undefined,tags=["RECHARGING"]}

### 276 Vengeance  [bespoke] pkrg=5014
  ABBR: Boosts Ghost-type moves by 1.2x, or 1.5x when below 1/3 HP.
  FULL: Boosts the power of Ghost-type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25}

### 277 Blitz Boxer  [priority-modifier] pkrg=5015
  ABBR: At full HP, gives +1 priority to this Pokémon's punching moves.
  FULL: Blitz Boxer grants +1 priority to all punching moves when at full HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"flag":128},condition={"kind":"full-hp"}}

### 278 Antarctic Bird  [bespoke] pkrg=5016
  ABBR: Ice-type and Flying-type moves get a 1.3x power boost.
  FULL: Antarctic Bird grants a 1.3x power boost to both Ice-type and Flying-type moves. Additive with other damage boosts.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=14,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=2,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 279 Immolate  [type-conversion] pkrg=5017
  ABBR: Normal moves become Fire. Fire moves are empowered.
  FULL: Changes the user's Normal-type moves to Fire-type. If the user is Fire-type its Fire-type moves have a 10% chance to burn, otherwise it gains Fire STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=9,condition=<fn>,source={"kind":"type","type":0},configuredNewType=9} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 280 Crystallize  [type-conversion] pkrg=5018
  ABBR: Rock-type moves become Ice and get a 1.1x boost.
  FULL: Crystallize converts all Rock- type moves to Ice-type and boosts their power by 10%.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=14,condition=<fn>,source={"kind":"type","type":5},configuredNewType=14} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.1,source={"kind":"type","type":5},multiplier=1.1}

### 281 Electrocytes  [type-damage-boost] pkrg=5019
  ABBR: Boosts the power of Electric-type moves by 1.25x.
  FULL: Electrocytes boosts Electric- type moves by 25%.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25,type=12,highHpMultiplier=1.25,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 282 Aerodynamics  [bespoke] pkrg=5020
  ABBR: Boosts Speed instead of being hit by Flying-type moves.
  FULL: When targeted by Flying-type moves, Aerodynamics absorbs the attack and raises the user's Speed stat by one stage.
  CODE: TypeAbsorbStatBoostAbAttr{showAbility=true,extraCondition=undefined,immuneType=2,condition=null,stat=5,stages=1}

### 283 Christmas Spirit  [bespoke] pkrg=5021
  ABBR: Takes 50% less damage if hail is active.
  FULL: Christmas Spirit reduces all incoming damage by 50% during hail weather. Grants immunity to hail damage. Multiplicative with other damage reduction sources.
  CODE: WeatherDamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,weathers=[4,5],reductionMultiplier=0.5}

### 284 Exploit Weakness  [bespoke] pkrg=5022
  ABBR: Targets lowest defense vs statused foes.
  FULL: When attacking a statused opponent, targets their lower defensive stat.
  CODE: DefenseStatSwapOnStatusedFoeAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1}

### 285 Ground Shock  [bespoke] pkrg=5023
  ABBR: Target Grounds aren't immune to Electric but resist it instead.
  FULL: Ground Shock allows Electric moves to hit Ground-type Pokemon for 0.5x damage.
  CODE: OffensiveTypeChartOverrideAbAttr{showAbility=false,extraCondition=undefined,rules=[{"attackType":12,"defenderType":4,"newMultiplier":0.5}]}

### 286 Ancient Idol  [bespoke] pkrg=5024
  ABBR: Uses Def and Sp. Def instead of Atk and Sp. Atk when attacking.
  FULL: Physical moves use the Defense stat of the user instead of Attack for damage, while special moves use the Special Defense stat of the user instead of Special Attack.
  CODE: AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=2,specialStat=4,contactOnly=false,flag=undefined,useHigherOffense=false}

### 287 Mystic Power  [bespoke] pkrg=5025
  ABBR: All moves gain the 1.5x power boost from STAB.
  FULL: Mystic Power grants the 1.5x STAB damage bonus to all moves regardless of type matching. Does not boost moves that already receive a STAB bonus.
  CODE: StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=null,multiplier=1.5}

### 288 Perfectionist  [bespoke] pkrg=5026
  ABBR: Move BP < 51 BP: +1 to crit rate. Move BP < 26 BP: +1 priority too.
  FULL: Attacks with 50 BP or less raise their critical hit ratio by one stage, and attacks with 25 BP or lower also gain +1 priority.
  CODE: CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"maxBasePower":50}} | PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"maxBasePower":25},condition={"kind":"always"}}

### 289 Growing Tooth  [bespoke] pkrg=5027
  ABBR: Raises Attack by one stage after using a biting move.
  FULL: Growing Tooth boosts the user's Attack by one stage whenever they successfully hit with a biting move.
  CODE: StatBoostOnFlagAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,flag=32,stat=1,stages=1}

### 290 Inflatable  [stat-trigger-on-event] pkrg=5028
  ABBR: Ups Def and Sp. Def by one stage if hit by Flying or Fire moves.
  FULL: When hit by any Fire or Flying moves, boost Defense and Special Defense by one stage each. Activates on each hit of a multihit move. The boost applies after the hit lands.
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":2,"stages":1},{"stat":4,"stages":1}],filter={"types":[2,9]}}

### 291 Aurora Borealis  [bespoke] pkrg=5029
  ABBR: Ice-type moves gain STAB. Moves always benefit from hail.
  FULL: Aurora Borealis grants STAB to all Ice-type moves regardless of the Pokemon's typing. Weather Ball becomes Ice-type with doubled power, Aurora Veil works without hail, and weather-based Ice moves like Blizzard to never miss.
  CODE: StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=14,multiplier=1.5}

### 292 Avenger  [bespoke] pkrg=5030
  ABBR: If a party Pokémon fainted last turn, next move gets 1.5x boost.
  FULL: Avenger boosts the power of all moves by 50% for one turn after any party Pokemon faints.
  CODE: AllyFaintPowerBoostTriggerAbAttr{showAbility=true,extraCondition=undefined} | AllyFaintPowerBoostAbAttr{showAbility=true,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5} | AllyFaintPowerBoostExpireAbAttr{showAbility=true,extraCondition=undefined}

### 293 Let's Roll  [bespoke] pkrg=5031
  ABBR: Casts Defense Curl on entry.
  FULL: Let's Roll automatically raises Defense by one stage and applies the Defense Curl status upon entering battle, doubling the power of Rollout and other rolling moves.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":111}}

### 294 Aquatic  [entry-effect] pkrg=5032
  ABBR: Adds Water type on entry.
  FULL: Upon entering battle, adds Water to the user's current typing. Retains Water typing even upon losing the ability, going away only when switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":10},once=false}

### 295 Loud Bang  [chance-status-on-hit] pkrg=5033
  ABBR: Sound-based moves have 50% chance to confuse the foe.
  FULL: Sound-based attacks have a 50% chance to confuse the target upon a successful hit.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=50,tags=["CONFUSED"],contactRequired=false,turns=undefined,filter={"flag":4},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 296 Lead Coat  [damage-reduction-generic] pkrg=5034
  ABBR: Takes 40% less from Phys. moves. This Pokémon's Speed is 0.9x.
  FULL: Lead Coat reduces physical damage by 40% but decreases Speed by 10%. Also triples the user's weight. The damage reduction is multiplicative with other sources.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.6,reductionAmount=0.4,filterSpec={"kind":"category","category":0}}

### 297 Amphibious  [bespoke] pkrg=5035
  ABBR: Water moves gain STAB. Can't become drenched.
  FULL: Grants STAB to Water-type moves regardless of the user's typing. Also provides immunity to being drenched.
  CODE: StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=10,multiplier=1.5}

### 298 Grounded  [entry-effect] pkrg=5036
  ABBR: Adds Ground type on entry.
  FULL: Grounded adds Ground type to the Pokemon upon entry. Retains Ground typing even upon losing the ability, going away only when switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":4},once=false}

### 299 Earthbound  [bespoke] pkrg=5037
  ABBR: Boosts Ground-type moves by 1.2x, or 1.5x when under 1/3 HP.
  FULL: Boosts the power of Ground-type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25}

### 300 Fighting Spirit  [type-conversion] pkrg=5038
  ABBR: Normal moves become Fighting. Fighting moves are empowered.
  FULL: Changes the user's Normal-type moves to Fighting-type. If the user is Fighting-type its Fighting-type moves break screens, otherwise it gains Fighting STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=1,condition=<fn>,source={"kind":"type","type":0},configuredNewType=1} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 301 Cryptic Power  [bespoke] pkrg=5039
  ABBR: Doubles own Sp. Atk stat. Boosts raw stat, not base stat.
  FULL: Feline Prowess increases the user's Special Attack stat by 2x. Multiplicative with other damage boosts.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=2,condition=undefined}

### 302 Coil Up  [bespoke] pkrg=5040
  ABBR: On entry, gives +1 priority once to the first biting move used.
  FULL: On entry, gives +1 priority to the first biting move used. Priority boost is consumed after landing any biting move.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"flag":32},condition={"kind":"always"}}

### 303 Fossilized  [bespoke] pkrg=5041
  ABBR: Halves dmg taken by Rock moves. Boosts own Rock moves by 1.2x.
  FULL: Fossilized reduces Rock-type damage by 50% and boosts the user's Rock moves by 20%. Damage reduction is multiplicative with other sources, while the damage boost is additive with other sources.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=5,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":5}}

### 304 Magical Dust  [bespoke] pkrg=5042
  ABBR: Makes foe Psychic-type on contact. Also works on offense.
  FULL: If the user makes contact with another Pokemon, offensively or defensively, the other Pokemon's type is changed to pure Psychic. This happens immediately for multihit or priority moves and can remove STAB in the middle of an enemy's multihit move.
  CODE: PostDefendChangeAttackerTypeAbAttr{showAbility=false,extraCondition=undefined,type=13,contactOnly=true,requireFlag=null,side="attacker"}

### 305 Dreamcatcher  [conditional-damage] pkrg=5043
  ABBR: Doubles damage if an opponent is sleeping. Pursues sleeping foes.
  FULL: Dreamcatcher doubles the power of the user's moves when any opponent on the field is asleep. This includes the user, allies, or opponents. Attacks hit sleeping foes who are switching out for 1x power instead, damaging them before leaving. Does not activate against Comatose.
  CODE: ConditionalDamageAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2,damageCondition={"kind":"target-statused","statuses":[4]},damageMultiplier=2}

### 306 Nocturnal  [type-damage-boost] pkrg=5044
  ABBR: Boosts own Dark moves by 1.25x. Takes -25% dmg from Dark/Fairy.
  FULL: Dark-type moves receive a 25% boost, and the user takes 25% less damage from Dark and Fairy moves. The damage reduction is multiplicative with other sources.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25,type=16,highHpMultiplier=1.25,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 307 Self Sufficient  [passive-recovery] pkrg=5045
  ABBR: Recovers 1/16 of max HP at the end of each turn.
  FULL: Recovers 1/16 of max HP at the end of each turn.
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.0625,conditionSpec={"kind":"always"}}

### 308 Tectonize  [type-conversion] pkrg=5046
  ABBR: Normal moves becomes Ground. Might ignore hazards.
  FULL: Changes the user's Normal-type moves to Ground-type. If the user is Ground-type it is immune to Stealth Rocks and Spikes, otherwise it gains Ground STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=4,condition=<fn>,source={"kind":"type","type":0},configuredNewType=4} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 309 Ice Age  [entry-effect] pkrg=5047
  ABBR: Adds Ice type on entry.
  FULL: Upon entering battle, adds Ice to the user's current typing. Retains Ice typing even upon losing the ability, going away only when switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":14},once=false}

### 310 Half Drake  [entry-effect] pkrg=5048
  ABBR: Adds Dragon type on entry.
  FULL: Upon entering battle, adds Dragon to the user's current typing. Retains Dragon typing even upon losing the ability, going away only when switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":15},once=false}

### 311 Liquified  [damage-reduction-generic] pkrg=5049
  ABBR: Takes 1/2 dmg from contact moves but Water moves hurt it 2x more.
  FULL: Liquified reduces contact move damage by 50% but doubles Water- type move damage taken. Multiplicative with other damage reduction sources.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"contact"}}

### 312 Dragonfly  [entry-effect] pkrg=5050
  ABBR: Adds Dragon type on entry. Avoids Ground attacks.
  FULL: Upon entering battle, adds Dragon to the user's current typing. Retains Dragon typing even upon losing the ability, going away only when switching out. Also gives the user immunity to Ground-type attacks and field effects that require you to be grounded.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":15},once=false}

### 313 Dragonslayer  [bespoke] pkrg=5051
  ABBR: Deals 1.5x damage to Dragons. Takes 0.5x damage from Dragons.
  FULL: Deals 1.5x damage to Dragon-type Pokemon and takes 0.5x damage when attacked by Dragon-type Pokemon. Based on attacker/defender Pokemon types, not move types. The damage reduction is multiplicative with other sources.
  CODE: OffensiveTypeMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetDefenderType=15,multiplier=1.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 314 Mountaineer  [bespoke] pkrg=5052
  ABBR: Immune to Rock-type attacks and Stealth Rock damage.
  FULL: Mountaineer grants immunity to all Rock-type moves and Stealth Rock entry hazard damage.
  CODE: AttackTypeImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneType=5,condition=null}

### 315 Hydrate  [type-conversion] pkrg=5053
  ABBR: Normal moves become Water. Water moves are empowered.
  FULL: Changes the user's Normal-type moves to Water-type. If the user is Water-type its Water-type moves have a 10% chance to drench, otherwise it gains Water STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=10,condition=<fn>,source={"kind":"type","type":0},configuredNewType=10} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 316 Metallic  [entry-effect] pkrg=5054
  ABBR: Adds Steel type on entry.
  FULL: Upon entering battle, adds Steel to the user's current typing. Retains Steel typing even upon losing the ability, going away only when switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":8},once=false}

### 317 Permafrost  [damage-reduction-generic] pkrg=5055
  ABBR: Takes 35% less damage from Super-effective moves.
  FULL: Reduces damage from super- effective attacks by 35%. Multiplicative with other sources of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65,reductionAmount=0.35,filterSpec={"kind":"super-effective"}}

### 318 Primal Armor  [damage-reduction-generic] pkrg=5056
  ABBR: Takes 50% less damage from Super-effective moves.
  FULL: Reduces damage from super- effective attacks by 50%. Multiplicative with other sources of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"super-effective"}}

### 319 Raging Boxer  [multi-hit-override] pkrg=5057
  ABBR: Punching moves hit twice. 1st hit at 100% power, 2nd hit at 40%.
  FULL: Raging Boxer causes punching moves to hit twice, with the first hit at 100% power and second hit at 40% power. Both attacks independently roll secondary effect chances (except flinch).
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={"flag":128}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.4,condition=<fn>,powerMultiplier=0.4,powerFilter={"flag":128}}

### 320 Air Blower  [bespoke] pkrg=5058
  ABBR: Casts a 3-turn Tailwind on entry.
  FULL: Air Blower automatically sets up a 3-turn Tailwind upon entering battle, doubling the Speed of all Pokemon on the user's side. Also activates Wind Rider.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":366}}

### 321 Juggernaut  [bespoke] pkrg=5059
  ABBR: Contact moves add 20% Def to attack. Paralysis-immune.
  FULL: Juggernaut boosts contact moves by adding 20% of the user's Defense stat to attack calculations. Prevents paralysis and immediately cures the status if inflicted on the user.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={"contact":"only"},sourceStat=2} | StatusEffectImmunityAbAttrEr{showAbility=true,extraCondition=undefined,immuneEffects=[3],configuredStatuses=[3]}

### 322 Short Circuit  [type-damage-boost] pkrg=5060
  ABBR: Boosts Elec.-type moves by 1.2x, or 1.5x when below 1/3 HP.
  FULL: Boosts the power of Electric- type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=12,highHpMultiplier=1.2,lowHpMultiplier=1.5,lowHpThreshold=0.3333333333333333,weathers=null}

### 323 Majestic Bird  [bespoke] pkrg=5061
  ABBR: Boosts own Sp. Atk by 1.5x. Boosts raw stat, not base stat.
  FULL: Majestic Bird boosts the user's Special Attack stat by 50%. Multiplicative with other damage boosts.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.5,condition=undefined}

### 324 Phantom  [entry-effect] pkrg=5062
  ABBR: Adds Ghost type on entry.
  FULL: Upon entering battle, adds Ghost to user's current typing. Retains Ghost typing even upon losing the ability, going away only when switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":7},once=false}

### 325 Intoxicate  [type-conversion] pkrg=5063
  ABBR: Normal moves become Poison. Poison moves are empowered.
  FULL: Changes the user's Normal-type moves to Poison-type. If the user is Poison-type its Poison- type moves have a 10% chance to badly poison, otherwise it gains Poison STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=3,condition=<fn>,source={"kind":"type","type":0},configuredNewType=3} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 326 Impenetrable  [bespoke] pkrg=5064
  ABBR: Only damaged by attacks.
  FULL: Impenetrable grants immunity to all non-attack damage sources including entry hazards, weather damage, status conditions, and recoil.
  CODE: BlockNonDirectDamageAbAttr{showAbility=false,extraCondition=undefined}

### 327 Hypnotist  [bespoke] pkrg=5065
  ABBR: Hypnosis accuracy is 90% when used by this Pokémon.
  FULL: Boosts Hypnosis' accuracy to 90%. Does not lock to accuracy to 90%, the move still gets affected by accuracy/evasiveness changes.
  CODE: ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"moveIds":[95]}}

### 328 Overwhelm  [status-immunity] pkrg=5066
  ABBR: Hits Fairies with Dragon moves. Immune to Intimidate and Scare.
  FULL: Allows Dragon-type moves to hit Fairy-type Pokemon for normal damage instead of having no effect. Additionally, the user is immune to Intimidate and Scare.
  CODE: IntimidateImmunityAbAttrEr{showAbility=false,extraCondition=undefined}

### 329 Scare  [bespoke] pkrg=5067
  ABBR: Lowers foes' Sp. Atk by one stage on entry.
  FULL: Upon entering battle, the user drops the Special Attack stat of all opposing Pokemon by one stage.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[3],stages=-1,selfTarget=false,intimidate=true}

### 330 Majestic Moth  [bespoke] pkrg=5068
  ABBR: On entry, raises highest calculated stat by one stage.
  FULL: Majestic Moth raises the user's highest calculated base stat by 1 stage when it enters battle.
  CODE: SelfHighestStatBoostOnSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,candidates=[1,2,3,4,5],stages=1,weathers=undefined,terrains=undefined}

### 331 Soul Eater  [lifesteal] pkrg=5069
  ABBR: Dealing a KO heals 1/4 of this Pokémon's max HP.
  FULL: When the user knocks out an opponent with a direct hit, it immediately recovers 25% of its maximum HP.
  CODE: LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25}

### 332 Soul Linker  [bespoke] pkrg=5070
  ABBR: Enemies take all the damage they deal, same for this Pokémon.
  FULL: When the user takes a direct hit, the opponent takes identical damage. When landing a direct hit, the user also takes the same damage it inflicts. Does not activate when either Pokemon is knocked out, taking damage from Pain Split, or against another Soul Linker.
  CODE: ReflectDamageOnDefendAbAttr{showAbility=true,extraCondition=undefined} | SelfDamageOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,basis="damageDealt",fraction=1}

### 333 Sweet Dreams  [bespoke] pkrg=5071
  ABBR: Heals 1/8 of max HP every turn if asleep. Immune to Bad Dreams.
  FULL: Sweet Dreams restores 1/8 of maximum HP at the end of each turn when the user is asleep or has the Comatose ability. Additionally, it grants immunity to Bad Dreams damage.
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.125,conditionSpec={"kind":"status","status":4}}

### 334 Bad Luck  [bespoke] pkrg=5072
  ABBR: Foes can't crit, deal min damage, 5% less acc, & no effect chance.
  FULL: Foes can not land critical hits, always roll minimum damage (85% instead of 85-100%), fail to inflict secondary effects that are not guaranteed, and have a 5% chance to miss a move.
  CODE: CritImmunityAbAttr{showAbility=false,extraCondition=undefined} | IgnoreMoveEffectsAbAttr{showAbility=false,extraCondition=undefined} | IncomingAccuracyMultiplierAbAttr{showAbility=false,extraCondition=undefined,multiplier=0.95,singleTargetOnly=false}

### 335 Haunted Spirit  [bespoke] pkrg=5073
  ABBR: When this Pokémon is KO'd, casts a Curse on the attacker.
  FULL: Curses the attacker when knocked out by a direct hit. The curse inflicts 25% max HP damage per turn until the cursed Pokemon switches out or faints. Ghost-type attackers are immune to the curse.
  CODE: OnFaintEffectAbAttr{showAbility=true,extraCondition=undefined,effect={"kind":"attacker-battler-tag","tagType":"CURSED"}}

### 336 Electric Burst  [type-damage-boost] pkrg=5074
  ABBR: Electric-type moves deal 1.35x damage but have 10% recoil.
  FULL: Electric Burst boosts Electric- type moves by 35% but causes 10% recoil damage based on damage dealt (minimum 1 HP). The recoil damage will not knock out the user.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.35,type=12,highHpMultiplier=1.35,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeRecoilAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,type=12,recoilPct=0.1}

### 337 Raw Wood  [bespoke] pkrg=5075
  ABBR: Halves dmg taken by Grass moves. Boosts own Grass moves by 1.2x.
  FULL: Reduces damage from Grass-type attacks by 50% while boosting the power of the user's own Grass-type moves by 20%. Damage reduction is multiplicative with other sources.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=11,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":11}}

### 338 Solenoglyphs  [chance-status-on-hit] pkrg=5076
  ABBR: Biting moves have a 50% chance to badly poison the target.
  FULL: Solenoglyphs gives all biting moves a 50% chance to badly poison the target when landing.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=50,effects=[2],contactRequired=false,contactExcluded=false,filter={"flag":32},firstTurnChance=undefined}

### 339 Spider Lair  [entry-effect] pkrg=5077
  ABBR: Casts Sticky Web on entry. Lasts 5 turns.
  FULL: Sets Sticky Web on opponent's field when the user enters battle. Lasts 5 turns and lowers Speed by 1 stage for any grounded Pokemon switching in. Cannot activate if Sticky Web is already present on opponent's field.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-hazard","hazard":"STICKY_WEB","layers":1},once=false}

### 340 Fatal Precision  [bespoke] pkrg=5078
  ABBR: Super-effective moves never miss and always crit.
  FULL: Super-effective damaging moves never miss and always land critical hits.
  CODE: ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"superEffective":true}} | ConditionalCritAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>}

### 341 Fort Knox  [bespoke] pkrg=5079
  ABBR: Blocks most damage boosting and multihit abilities.
  FULL: Immune to all damage boosting ability effects from opponents, other than Parental Bond and Multi-Headed.
  CODE: PostDefendSuppressOpponentDamageBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.77}

### 342 Seaweed  [bespoke] pkrg=5080
  ABBR: Takes 1/2 dmg from Fire if Grass. Grass deals x2 dmg to Fire.
  FULL: If user is Grass-type, they take half damage from Fire-type attacks and deals 2x damage to Fire-type Pokemon with Grass- type moves. Multiplicative with other sources of damage reduction.
  CODE: OffensiveTypeMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2,targetDefenderType=9,multiplier=2} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 343 Psychic Mind  [type-damage-boost] pkrg=5081
  ABBR: Boosts Psychic-type moves by 1.2x, or 1.5x when under 1/3 HP.
  FULL: Boosts the power of Psychic- type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=13,highHpMultiplier=1.2,lowHpMultiplier=1.5,lowHpThreshold=0.3333333333333333,weathers=null}

### 344 Poison Absorb  [type-resist-or-absorb] pkrg=5082
  ABBR: Redirects Poison moves. Absorbs them, healing 25% HP.
  FULL: The user draws in Poison-type moves and gains immunity to them, healing for 1/4th of max HP instead. Additionally, heals 1/8th of max HP per turn on Toxic Terrain.
  CODE: TypeAbsorbHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=3,condition=null,healFraction=0.25}

### 345 Scavenger  [bespoke] pkrg=5083
  ABBR: Dealing a KO heals 1/4 of this Pokémon's max HP.
  FULL: When this Pokemon defeats an opponent with a direct hit, it immediately regains 25% of its maximum HP and has a 50% chance to scavenge (steal) one of the defeated Pokemon's held items.
  CODE: LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25} | ScavengerLootAbAttr{showAbility=true,extraCondition=undefined,lootChance=0.5,lootItem=undefined}

### 346 Twist. Dimension  [entry-effect] pkrg=5084
  ABBR: Sets up Trick Room on entry, lasts 3 turns.
  FULL: Sets up Trick Room on entry, lasts 3 turns.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-screen-or-room","tag":"TRICK_ROOM","turns":3},once=false}

### 347 Multi-Headed  [bespoke] pkrg=5085
  ABBR: Hits as many times, as it has heads.
  FULL: Attack 2-3 times per move based on number of heads. Two-headed Pokemon strike twice (1st hit does 100%, 2nd does 25%), three- headed hit thrice (1st hit does 100%, 2nd does 20%, 3rd does 15%). Each hit rolls secondary effects independently (except flinch). Bypasses Fort Knox/Wonder Skin.
  CODE: AddSecondStrikeAbAttr{showAbility=false,extraCondition=undefined} | AddSecondStrikeAbAttr{showAbility=false,extraCondition=undefined}

### 348 North Wind  [bespoke] pkrg=5086
  ABBR: 3 turns Aurora Veil on entry. Immune to Hail damage.
  FULL: Sets up Aurora Veil upon entering battle, cutting physical and special damage recieved by half for your entire team. Aurora Veil lasts 3 turns, or 5 turns with Light Clay. The user is also immune to Hail damage. Cannot trigger again if Aurora Veil is already active.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-screen-or-room","tag":"AURORA_VEIL","turns":3},once=false} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[4]}

### 349 Overcharge  [bespoke] pkrg=5087
  ABBR: Electric is super effective vs Electric. Can paralyze Electric.
  FULL: The user's Electric-type moves become effective against Electric-type Pokemon, dealing 2x damage instead of 0.5x. Also allows the user to paralyze Electric-types.
  CODE: OffensiveTypeChartOverrideAbAttr{showAbility=false,extraCondition=undefined,rules=[{"attackType":12,"defenderType":12,"newMultiplier":2}]}

### 350 Violent Rush  [bespoke] pkrg=5088
  ABBR: Boosts Speed by 50% + Attack by 20% on first turn.
  FULL: The user gains a 50% Speed boost and 20% Attack boost on their first turn after switching in.
  CODE: FirstTurnStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 351 Flaming Soul  [priority-modifier] pkrg=5089
  ABBR: Fire-type moves get +1 priority at max HP.
  FULL: Grants +1 priority to Fire-type moves when at full HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"type":9},condition={"kind":"full-hp"}}

### 352 Sage Power  [bespoke] pkrg=5090
  ABBR: Ups Special Attack by 50% and locks move.
  FULL: Boosts Special Attack by 50% but locks the user into using the first move selected until they switch out.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.5,condition=undefined} | GorillaTacticsAbAttr{showAbility=false,extraCondition=undefined}

### 353 Bone Zone  [bespoke] pkrg=5091
  ABBR: Bone moves ignore immunities and deal 2x on not very effective.
  FULL: Bone moves bypass immunities and hit for normal damage, while resisted moves do 2x damage. Neutral/super effective moves remain unchanged.
  CODE: BoneMoveTypeChartAbAttr{showAbility=false,extraCondition=undefined}

### 354 Weather Control  [bespoke] pkrg=5092
  ABBR: Negates all weather based moves from enemies.
  FULL: Grants immunity to weather- based moves: Thunder, Solar Beam/Blade, Hurricane, Blizzard, Silver Wind, Weather Ball, all Storm moves (not including Magma, Leaf, or Diamond), Sheer Cold, and Pledge moves. Does not stop weather setup or damage.
  CODE: WeatherBasedMoveBlockAbAttr{showAbility=true,extraCondition=undefined}

### 355 Speed Force  [bespoke] pkrg=5093
  ABBR: Contact moves use 20% of its Speed stat additionally.
  FULL: Adds 20% of the user's Speed stat to damage when using contact moves. Choice Scarf does not affect this ability.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={"contact":"only"},sourceStat=5} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,bonusStat=3,speedFraction=0.2,bonusFilter={"contact":"only"},sourceStat=5}

### 356 Sea Guardian  [bespoke] pkrg=5094
  ABBR: Ups highest stat by +1 on entry when it rains.
  FULL: When entering battle during rain, Sea Guardian boosts your highest stat by one stage. Works with any rain type. Triggers once per switch-in.
  CODE: SelfHighestStatBoostOnSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,candidates=[1,2,3,4,5],stages=1,weathers=[2,7],terrains=undefined}

### 357 Molten Down  [bespoke] pkrg=5095
  ABBR: Fire-type is super effective against Rock-type.
  FULL: Molten Down makes Fire-type moves super effective against Rock-types instead of resisted.
  CODE: OffensiveTypeChartOverrideAbAttr{showAbility=false,extraCondition=undefined,rules=[{"attackType":9,"defenderType":5,"newMultiplier":2}]}

### 358 Hyper Aggressive  [multi-hit-override] pkrg=5096
  ABBR: Moves hit twice. Second hit does 25% damage.
  FULL: Makes all attacks hit twice in succession. The first hit deals 100%, while the second hit deals 25%. Each hit rolls secondary effects independently (except flinch).
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.25,condition=<fn>,powerMultiplier=0.25,powerFilter={}}

### 359 Flock  [type-damage-boost] pkrg=5097
  ABBR: Boosts Flying-type moves by 1.2x, or 1.5x when below 1/3 HP.
  FULL: Boosts the power of Flying-type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=2,highHpMultiplier=1.2,lowHpMultiplier=1.5,lowHpThreshold=0.3333333333333333,weathers=null}

### 360 Field Explorer  [bespoke] pkrg=5098
  ABBR: Boosts field moves by 50%. Cut, Surf, Strength etc.
  FULL: Boosts the power of moves that can be used in the overworld by 50%. Includes all HM moves, (Zen) Headbutt, Ice Spinner, Hidden/Secret Power, and Dig.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,flag=16777216,highHpMultiplier=1.5,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 361 Striker  [flag-damage-boost] pkrg=5099
  ABBR: Boosts the power of kicking moves by 1.3x.
  FULL: Striker increases the power of all kicking moves by 30%. Includes Pyro Ball.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=134217728,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 362 Frozen Soul  [priority-modifier] pkrg=5100
  ABBR: Ice-type moves get +1 priority at max HP.
  FULL: Frozen Soul grants +1 priority to all Ice-type moves when the user is at maximum HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"type":14},condition={"kind":"full-hp"}}

### 363 Predator  [lifesteal] pkrg=5101
  ABBR: Dealing a KO heals 1/4 of this Pokémon's max HP.
  FULL: When the user knocks out an opponent with a direct hit, it immediately recovers 25% of its maximum HP.
  CODE: LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25}

### 364 Looter  [lifesteal] pkrg=5102
  ABBR: Dealing a KO heals 1/4 of this Pokémon's max HP.
  FULL: When the user knocks out an opponent with a direct hit, it immediately recovers 25% of its maximum HP.
  CODE: LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25}

### 365 Lunar Eclipse  [bespoke] pkrg=5103
  ABBR: Fairy & Dark gains STAB. Hypnosis has 1.5x accuracy.
  FULL: Lunar Eclipse grants STAB bonus to both Fairy and Dark-type moves regardless of the user's typing. Improves Hypnosis accuracy to 90%.
  CODE: StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=17,multiplier=1.5} | StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=16,multiplier=1.5}

### 366 Solar Flare  [composite-vanilla-mashup] pkrg=5104
  ABBR: Chloroplast + Immolate.
  FULL: Converts Normal-type moves to Fire-type and grants Fire-type STAB. If the user is Fire-type their Fire-type moves get 10% burn chance. Additionally activates any Sun related effects for the user's moves.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=9,condition=<fn>,source={"kind":"type","type":0},configuredNewType=9} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 367 Power Core  [bespoke] pkrg=5105
  ABBR: The Pokémon uses +20% of its Defense or SpDef during moves.
  FULL: Adds 20% of Defense stat to physical attacks and 20% of Special Defense stat to special attacks when calculating damage.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={},sourceStat=2} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,bonusStat=3,speedFraction=0.2,bonusFilter={},sourceStat=4}

### 368 Sighting System  [bespoke] pkrg=5106
  ABBR: Moves always hit. Moves last for moves less than 80% accuracy.
  FULL: Sighting System guarantees all moves hit regardless of accuracy checks. Moves with less than 80% base accuracy receive -3 priority.
  CODE: AlwaysHitAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 369 Bad Company  [bespoke] pkrg=5107
  ABBR: Not implemented right now. Has no effect.
  FULL: Not implemented.
  CODE: 

### 370 Opportunist  [(vanilla-map)] pkrg=290
  ABBR: +1 priority vs foes below 1/2 max HP.
  FULL: Grants +1 priority to all moves when targeting opponents with 50% HP or less.
  CODE: ChangeMovePriorityAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1}

### 371 Giant Wings  [flag-damage-boost] pkrg=5108
  ABBR: Boosts the power of wing, wind or air-based moves by 1.3x.
  FULL: Giant Wings boosts the power of all wing, wind, and air-based moves by 30%.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=1048576,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 372 Momentum  [bespoke] pkrg=5109
  ABBR: Contact moves use the Speed stat for damage calculation.
  FULL: Contact moves use Speed stat for damage instead of Attack/Special Attack. Choice Scarf does not affect this ability.
  CODE: AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=5,specialStat=5,contactOnly=true,flag=undefined,useHigherOffense=false}

### 373 Grip Pincer  [bespoke] pkrg=5110
  ABBR: 50% chance to trap. Then ignores Defense & accuracy checks.
  FULL: Contact moves have a 50% chance to trap the target (like Wrap), preventing escape or switching. Against trapped targets, the user's moves ignore defensive stats changes and always hit. Trapped targets take 1/8 max HP damage each turn. Trap lasts 4-5 turns (7 with Grip Claw).
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=50,tags=["TRAPPED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 374 Big Leaves  [composite-vanilla-mashup] pkrg=5111
  ABBR: Chloroplast + Chlorophyll + Leaf Guard + Harvest + Solar Power.
  FULL: Activates any sun related effects for the user's moves. Boosts Speed stat by 50% in sun. Cures status in sun. 50% chance to restore berry on turn end, 100% in sun. Raises highest attacking stat by 50% in sun.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | PostTurnResetStatusAbAttr{showAbility=true,extraCondition=undefined,allyTarget=true,target=undefined} | PostTurnRestoreBerryAbAttr{showAbility=true,extraCondition=undefined,berriesUnderCap=undefined,procChance=<fn>} | PostWeatherLapseDamageAbAttr{showAbility=true,extraCondition=undefined,weatherTypes=[1,8],damageFactor=2} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.5,condition=undefined}

### 375 Precise Fist  [bespoke] pkrg=5112
  ABBR: Punching moves get +1 crit and 5x effect chance.
  FULL: Punching moves gain +1 critical hit stage and 5x their normal secondary effect chance.
  CODE: CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"flag":128}} | EffectChanceModifierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,configuredMultiplier=5,flag=128}

### 376 Deadeye  [bespoke] pkrg=5113
  ABBR: Arrow & cannon moves never miss. Crits hit weakest defense.
  FULL: The user is unable to miss arrow- based attacks and cannon moves (different from Mega Launcher moves, includes moves blocked by Bulletproof). Additionally, when landing critical hits, the attack targets the opponent's weaker defensive stat.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=null,condition=<fn>} | CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"flag":2097152}} | CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"flag":1024}}

### 377 Artillery  [bespoke] pkrg=5114
  ABBR: Mega Launcher moves always hit and hit both foes.
  FULL: Mega Launcher moves always hit and strike both opposing Pokemon simultaneously. Unable to miss with pulse, beam, ball, aura, and other blast related moves.
  CODE: ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"flag":64}}

### 378 Amplifier  [bespoke] pkrg=5115
  ABBR: Ups sound moves by 30% and makes them hit both foes.
  FULL: Amplifier boosts sound-based moves by 30% damage. Single- target sound moves gain spread targeting to hit both opposing Pokemon. Does not spread with multihit moves.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=4,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 379 Ice Dew  [type-resist-or-absorb] pkrg=5116
  ABBR: Redirects Ice moves. Absorbs them, ups highest Atk.
  FULL: Redirects all Ice-type moves to this Pokemon and absorbs them. Upon absorbing an Ice move, boosts either Attack or Special Attack (whichever is higher) by one stage.
  CODE: TypeAbsorbStatBoostAbAttr{showAbility=true,extraCondition=undefined,immuneType=14,condition=null,stat=1,stages=1}

### 380 Sun Worship  [bespoke] pkrg=5117
  ABBR: Ups highest stat by +1 on entry when sunny.
  FULL: When entering battle during Sun, boosts the user's highest stat by one stage.
  CODE: SelfHighestStatBoostOnSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,candidates=[1,2,3,4,5],stages=1,weathers=[1,8],terrains=undefined}

### 381 Pollinate  [type-conversion] pkrg=5118
  ABBR: Normal moves becomes Bug. Immune to powder if Bug-type.
  FULL: Changes the user's Normal-type moves to Bug-type. If the user is Bug-type it is immune to powder moves, otherwise it gains Bug STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=6,condition=<fn>,source={"kind":"type","type":0},configuredNewType=6} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 382 Volcano Rage  [bespoke] pkrg=5119
  ABBR: Triggers 50 BP Eruption after using a Fire-type move.
  FULL: After using any Fire-type move, Volcano Rage triggers a followup Eruption attack with 50 base power. Damage scales with the user's current HP percentage, having 50 BP at full health.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":284,"typeFilter":[9]}}

### 383 Cold Rebound  [bespoke] pkrg=5120
  ABBR: Attacks with Icy Wind when hit by a contact move.
  FULL: When struck by any contact move, Cold Rebound retaliates with Icy Wind (60 BP), lowering the attacker's Speed by one stage.
  CODE: CounterAttackOnHitAbAttr{showAbility=false,extraCondition=undefined,moveId=196,power=undefined,chance=100,filter={"contactRequired":true}}

### 384 Low Blow  [bespoke] pkrg=5121
  ABBR: Attacks with 40BP Feint Attack on switch-in.
  FULL: Low Blow uses a 40 BP Feint Attack when switching in, targeting a random opponent. Feint Attack is a Dark-type physical attack that never misses.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":185,"power":40}}

### 385 Nosferatu  [lifesteal] pkrg=5122
  ABBR: Contact moves do +20% damage and heal 1/2 of damage dealt.
  FULL: Moves that make contact deal an additional 20% damage and heal the user to heal for 1/2 of the damage dealt. This healing applies after all hits of multi- hit moves and after recoil is applied.
  CODE: LifestealOnHitAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,hitHealFraction=0.5,hitFilter={}}

### 386 Spectralize  [type-conversion] pkrg=5124
  ABBR: Normal moves become Ghost. Ghost moves are empowered.
  FULL: Changes the user's Normal-type moves to Ghost-type. If the user is Ghost-type its Ghost-type moves have a 10% fear chance, otherwise it gains Ghost STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=7,condition=<fn>,source={"kind":"type","type":0},configuredNewType=7} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 387 Spectral Shroud  [chance-status-on-hit] pkrg=5125
  ABBR: Spectralize + 30% chance to badly poison the foe.
  FULL: Changes the user's Normal-type moves to Ghost-type. If the user is Ghost-type its Ghost-type moves have a 10% fear chance, otherwise it gains Ghost STAB. Its moves, including status moves, have a 30% chance to badly poison the target.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=30,effects=[2],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined}

### 388 Discipline  [status-immunity] pkrg=5126
  ABBR: Can switch while rampaging. Can't be confused or intimidated.
  FULL: After using any Electric-type move, Thundercall automatically triggers a follow-up Smite attack at 20% power (24 base power). This physical Electric attack has an 80% accuracy, can paralyze targets (20% chance), and applies the Smack Down effect - grounding Flying-types.
  CODE: IntimidateImmunityAbAttrEr{showAbility=false,extraCondition=undefined}

### 389 Thundercall  [bespoke] pkrg=5127
  ABBR: Triggers Smite at 20% power when using an Electric move.
  FULL: Deal 1.5x damage to Water-type Pokemon and bypass defensive screens (Light Screen, Reflect, Aurora Veil)/Substitutes.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":84,"power":24,"typeFilter":[12]}}

### 390 Marine Apex  [composite-vanilla-mashup] pkrg=5128
  ABBR: 50% more damage to Water-types + Infiltrator.
  FULL: Mighty Horn boosts the power of horn and drill-based attacks by 30%.
  CODE: InfiltratorAbAttr{showAbility=false,extraCondition=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 391 Mighty Horn  [flag-damage-boost] pkrg=5129
  ABBR: Boosts the power of horn and drill-based by 1.3x.
  FULL: Every successful horn-based attack raises Attack by one stage after it lands.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=67108864,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 392 Hardened Sheath  [bespoke] pkrg=5130
  ABBR: Ups Attack by +1 when using horn moves.
  FULL: Reduces both physical and special damage by 35%. Multiplicative with other sources of damage reduction.
  CODE: StatBoostOnFlagAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,flag=67108864,stat=1,stages=1}

### 393 Arctic Fur  [damage-reduction-generic] pkrg=5123
  ABBR: Weakens incoming physical and special moves by 35%.
  FULL: Converts all Normal-type moves to Ghost-type and grants STAB for Ghost moves, regardless of the user's typing.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65,reductionAmount=0.35,filterSpec={"kind":"all"}}

### 394 Lethargy  [bespoke] pkrg=5131
  ABBR: Damage drops 20% each turn to 20%. Resets on switch-in.
  FULL: Reduces the user's total damage by 20% at the start of each turn, capping at -80%. Resets after switching.
  CODE: TurnDecayDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1,startMul=1,dropMul=0.2,floorMul=0.2}

### 395 Iron Barrage  [composite-vanilla-mashup] pkrg=5132
  ABBR: Mega Launcher + Sighting System.
  FULL: Boosts pulse, beam, ball, and aura moves by 30%. Guarantees all moves hit regardless of accuracy checks. Moves with less than 80% base accuracy receive - 3 priority.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | AlwaysHitAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 396 Steel Barrel  [bespoke] pkrg=5133
  ABBR: Immune to recoil damage, but not immune to Explosion/crash dmg.
  FULL: Prevents all recoil damage from the user's moves and abilities. Also grants immunity to enrage recoil damage. Does not prevent crash damage or Explosion/Self- Destruct damage.
  CODE: BlockRecoilDamageAttr{showAbility=false,extraCondition=undefined}

### 397 Pyro Shells  [bespoke] pkrg=5134
  ABBR: Triggers 50 BP Outburst after using a Mega Launcher move.
  FULL: Pyro Shells triggers a 50 BP Normal-type Outburst after any Mega Launcher-boosted move. Outburst has no secondary effects and hits all surrounding Pokemon on the field.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":200,"flagFilter":64}}

### 398 Fungal Infection  [bespoke] pkrg=5135
  ABBR: Contact moves inflict Leech Seed on the target.
  FULL: Spreads Leech Seed when using a contact move, draining 1/8th of the target's max HP at the end of each turn.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=100,tags=["SEEDED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 399 Parry  [damage-reduction-generic] pkrg=5136
  ABBR: Counters contact with Mach Punch. Takes 20% less damage.
  FULL: Reduces all damage by 20%. Multiplicative with other damage reduction sources. Counters contact moves with Mach Punch at 20 BP.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8,reductionAmount=0.2,filterSpec={"kind":"all"}}

### 400 Scrapyard  [bespoke] pkrg=5137
  ABBR: Sets a layer of Spikes when hit (contact move).
  FULL: Sets a layer of Spikes on the opponent's side when the user is successfully hit by a contact move. Each layer damages switching grounded Pokemon by 12.5%, 16.7%, or 25% of max HP for 1-3 layers respectively. Each hit of a multihitting attack sets a layer.
  CODE: SetArenaTagOnHitAbAttr{showAbility=true,extraCondition=undefined,tagType="SPIKES",turns=0,side="attacker",contactRequired=true}

### 401 Loose Quills  [bespoke] pkrg=5138
  ABBR: Sets a layer of Spikes when hit (contact move).
  FULL: Sets a layer of Spikes on the opponent's side when the user is successfully hit by a contact move. Each layer damages switching grounded Pokemon by 12.5%, 16.7%, or 25% of max HP for 1-3 layers respectively. Each hit of a multihitting attack sets a layer.
  CODE: SetArenaTagOnHitAbAttr{showAbility=true,extraCondition=undefined,tagType="SPIKES",turns=0,side="attacker",contactRequired=true}

### 402 Toxic Debris  [(vanilla-map)] pkrg=295
  ABBR: Sets a layer of Toxic Spikes when hit by contact moves.
  FULL: Toxic Debris automatically sets a layer of Toxic Spikes on the opponent's side when hit by a contact move. Each layer poisons switching grounded Pokemon: one layer causes regular poison, two layers cause badly poisoned. Each hit of a multihitting attack sets a layer.
  CODE: PostDefendApplyArenaTrapTagAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,arenaTagType="TOXIC_SPIKES"}

### 403 Roundhouse  [bespoke] pkrg=5139
  ABBR: Kicks always hit. Damages foes' weaker defenses.
  FULL: Roundhouse makes all kicking moves never miss and target the opponent's weaker defense stat.
  CODE: ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"flag":134217728}}

### 404 Mineralize  [type-conversion] pkrg=5140
  ABBR: Normal moves become Rock. Rock moves are empowered.
  FULL: Changes the user's Normal-type moves to Rock-type. If the user is Rock-type its Rock-type moves have a 10% bleed chance, otherwise it gains Rock STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=5,condition=<fn>,source={"kind":"type","type":0},configuredNewType=5} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 405 Loose Rocks  [bespoke] pkrg=5141
  ABBR: Deploys Stealth Rocks when hit by contact.
  FULL: Set Stealth Rock on the opponent's side when the user is hit by any contact move. Stealth Rock deals 1/8th of the opponent's max HP when switching. Considered Rock-type damage and is modified by type effectiveness.
  CODE: SetArenaTagOnHitAbAttr{showAbility=true,extraCondition=undefined,tagType="STEALTH_ROCK",turns=0,side="attacker",contactRequired=true}

### 406 Spinning Top  [bespoke] pkrg=5142
  ABBR: Fighting moves up speed +1 and clear hazards.
  FULL: Spinning Top grants +1 Speed and removes all entry hazards from the user's side when using Fighting-type moves.
  CODE: TypeGatedStatTriggerOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"type":1,"stats":[{"stat":5,"stages":1}],"clearHazards":true}}

### 407 Retribution Blow  [bespoke] pkrg=5143
  ABBR: Uses Hyper Beam if any foe uses an stat boosting move.
  FULL: Automatically uses 150 BP Hyper Beam against opponents that boost stats. The triggered Hyper Beam has no recharge period, allowing normal actions next turn.
  CODE: OnOpponentStatRaiseAbAttr{showAbility=true,extraCondition=undefined,stats=[{"stat":1,"stages":1}]}

### 408 Fearmonger  [chance-status-on-hit] pkrg=5144
  ABBR: Intimidate + Scare; 10% chance to fear with contact moves.
  FULL: Fearmonger lowers both Attack and Special Attack of opposing Pokemon upon entry by one stage. Additionally provides a 10% chance to inflict fear when landing contact moves.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,tags=["ER_FEAR"],contactRequired=false,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 409 King's Wrath  [stat-trigger-on-event] pkrg=5145
  ABBR: Lowering any stats on its side raises Atk and Def.
  FULL: King's Wrath triggers when the user or their ally has their stats lowered, immediately boosting the user's Attack and Defense by one stage. Does not activate from self drops.
  CODE: StatTriggerOnStatLoweredAbAttr{showAbility=true,extraCondition=undefined,event="on-stat-lowered",stats=[{"stat":1,"stages":1},{"stat":2,"stages":1}]}

### 410 Queen's Mourning  [stat-trigger-on-event] pkrg=5146
  ABBR: Lowering any stats on its side raises SpAtk and SpDef.
  FULL: Queen's Mourning triggers when the user or their ally has their stats lowered, immediately boosting the user's Special Attack and Special Defense by one stage. Does not activate from self drops.
  CODE: StatTriggerOnStatLoweredAbAttr{showAbility=true,extraCondition=undefined,event="on-stat-lowered",stats=[{"stat":3,"stages":1},{"stat":4,"stages":1}]}

### 411 Toxic Spill  [bespoke] pkrg=5147
  ABBR: Non-Poison-types take 1/8 dmg every turn when on field.
  FULL: Toxic Spill damages all non- Poison-type Pokemon by 1/8 HP each turn. Pokemon with Poison Heal recover instead. Disappears when the user leaves.
  CODE: PostTurnHurtNonTypedAbAttr{showAbility=true,extraCondition=undefined,safeTypes=[3],damageFraction=0.125,requiredWeathers=null}

### 412 Desert Cloak  [bespoke] pkrg=5148
  ABBR: Protects its side from status and secondary effects in sand.
  FULL: All allies become immune to status conditions and secondary effects from enemy moves while sand is active.
  CODE: SandStatusImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[],condition=<fn>} | SandSecondaryEffectImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 413 Draconize  [type-conversion] pkrg=5149
  ABBR: Normal moves become Dragon. Dragon moves are empowered.
  FULL: Changes the user's Normal-type moves to Dragon-type. If the user is Dragon-type its Dragon- type moves deal neutal damage vs Fairy, otherwise it gains Dragon STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=15,condition=<fn>,source={"kind":"type","type":0},configuredNewType=15} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 414 Pretty Princess  [conditional-damage] pkrg=5150
  ABBR: Does 50% more damage if the target has any lowered stat.
  FULL: Pretty Princess increases the user's damage by 50% against targets with any negative stat stage.
  CODE: ConditionalDamageAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,damageCondition={"kind":"target-has-lowered-stat"},damageMultiplier=1.5}

### 415 Self Repair  [composite-vanilla-mashup] pkrg=5151
  ABBR: Self Sufficient + Natural Cure.
  FULL: Recovers 1/16th of max HP at the end of the turn and cures all status conditions when switching out of battle.
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.0625,conditionSpec={"kind":"always"}} | PreSwitchOutResetStatusAbAttr{showAbility=false,extraCondition=undefined}

### 416 Atomic Burst  [composite-vanilla-mashup] pkrg=5152
  ABBR: Electromorphosis + Galvanize.
  FULL: When hit by any move, the user becomes charged up, doubling the power of the next Electric-type move used. Converts all Normal- type moves into Electric-type moves and grants STAB for Electric-type moves. If they are Electric-type their Electric moves have a 10% paralysis chance.
  CODE: PostDefendApplyBattlerTagAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,tagType="CHARGED"} | MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=12,condition=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=12,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 417 Hellblaze  [type-damage-boost] pkrg=5153
  ABBR: Boosts Fire-type moves by 1.3x, or 1.8x when below 1/3 HP.
  FULL: Boosts the power of Fire-type moves by 30%, or by 80% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=9,highHpMultiplier=1.3,lowHpMultiplier=1.8,lowHpThreshold=0.3333333333333333,weathers=null}

### 418 Riptide  [type-damage-boost] pkrg=5154
  ABBR: Boosts Water-type moves by 1.3x, or 1.8x when below 1/3 HP.
  FULL: Boosts the power of Water-type moves by 30%, or by 80% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=10,highHpMultiplier=1.3,lowHpMultiplier=1.8,lowHpThreshold=0.3333333333333333,weathers=null}

### 419 Forest Rage  [type-damage-boost] pkrg=5155
  ABBR: Boosts Grass-type moves by 1.3x, or 1.8x when below 1/3 HP.
  FULL: Boosts the power of Grass-type moves by 30%, or by 80% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=11,highHpMultiplier=1.3,lowHpMultiplier=1.8,lowHpThreshold=0.3333333333333333,weathers=null}

### 420 Primal Maw  [multi-hit-override] pkrg=5156
  ABBR: Biting moves hit twice. 2nd hit does 0.4x damage.
  FULL: Primal Maw causes all biting moves to hit twice. The first hit deals 100% damage while the second hit deals 40% damage. Independently rolls secondary effects of attacks on each hit (except flinch).
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={"flag":32}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.4,condition=<fn>,powerMultiplier=0.4,powerFilter={"flag":32}}

### 421 Sweeping Edge  [bespoke] pkrg=5157
  ABBR: Keen Edge moves always hit and hit both foes.
  FULL: Sweeping Edge makes all Keen Edge moves never miss and hit both opposing Pokemon in double battles. Multihit moves will only hit each target one time.
  CODE: ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"flag":256}}

### 422 Gifted Mind  [bespoke] pkrg=5158
  ABBR: Nulls Psychic weakness; status moves always hit.
  FULL: Gifted Mind grants immunity to Dark, Ghost, and Bug-type moves while making all status moves used by this Pokemon never miss. This immunity ignores Inverse Room.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":13}} | ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"categories":[2]}}

### 423 Hydro Circuit  [bespoke] pkrg=5159
  ABBR: Electric moves +50%; Water moves siphon 25% damage.
  FULL: Hydro Circuit boosts Electric- type moves by 50% and heals the user for 25% of damage dealt when using Water-type moves.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,type=12,highHpMultiplier=1.5,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 424 Equinox  [bespoke] pkrg=5160
  ABBR: Boosts Atk or SpAtk to match the higher value.
  FULL: Equinox chooses the higher offensive stat for each attack. If Attack is higher, physical and special moves use your Attack stat. If Special Attack is higher, physical and special moves use your Special Attack stat.
  CODE: AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=undefined,specialStat=undefined,contactOnly=false,flag=undefined,useHigherOffense=true}

### 425 Absorbant  [bespoke] pkrg=5161
  ABBR: Drain moves recover +50% HP & apply Leech Seed.
  FULL: Absorbant boosts HP recovery from drain moves by 50% and applies Leech Seed to the target on hit, draining the target for 1/8th of their max HP at the end of each turn.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=100,tags=["SEEDED"],contactRequired=false,turns=undefined,filter={"flag":16384},firstTurnChance=undefined}

### 426 Clueless  [bespoke] pkrg=5162
  ABBR: Negates Weather, Rooms and Terrains.
  FULL: Clueless negates all weather, terrain, and room effects while active on the field.
  CODE: SuppressWeatherEffectAbAttr{showAbility=true,extraCondition=undefined,affectsImmutable=false} | PostSummonClearTerrainAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,onCleared=[],byTerrain=[]}

### 427 Cheating Death  [bespoke] pkrg=5163
  ABBR: Gets no damage for the first two hits.
  FULL: Negates the first two instances of damage received. Moves still connect and secondary effects apply, but damage becomes 0.
  CODE: NullifyFirstNHitsAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0,n=2}

### 428 Cheap Tactics  [bespoke] pkrg=5164
  ABBR: Attacks with Scratch on switch-in.
  FULL: Cheap Tactics uses Scratch (40 BP Normal physical move) targeting a random opponent when switching into battle.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":10}}

### 429 Coward  [bespoke] pkrg=5165
  ABBR: Sets up Protect on switch-in. Only works once.
  FULL: Coward automatically activates Protect on entry. Works once per battle.
  CODE: CowardOnceProtectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true}

### 430 Volt Rush  [priority-modifier] pkrg=5166
  ABBR: At full HP, gives +1 priority to its Electric-type moves.
  FULL: Volt Rush grants +1 priority to all Electric-type moves when the Pokemon is at full HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"type":12},condition={"kind":"full-hp"}}

### 431 Dune Terror  [bespoke] pkrg=5167
  ABBR: Sand reduces damage by 35%. Boosts Ground moves by 20%.
  FULL: Dune Terror reduces damage taken by 35% during a sandstorm and boosts Ground-type moves by 20%. Damage reduction is multiplicative with other sources.
  CODE: WeatherDamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65,weathers=[3],reductionMultiplier=0.65} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=4,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 432 Infernal Rage  [type-damage-boost] pkrg=5168
  ABBR: Fire-type moves are boosted by 35% with 5% recoil.
  FULL: Infernal Rage boosts Fire-type moves by 35% but inflicts 5% recoil damage after using them. Recoil is calculated from damage dealt with minimum of 1 HP lost. This recoil cannot knock the user out.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.35,type=9,highHpMultiplier=1.35,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeRecoilAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,type=9,recoilPct=0.05}

### 433 Dual Wield  [multi-hit-override] pkrg=5169
  ABBR: Mega Launcher and Keen Edge moves hit twice for 70% damage.
  FULL: Mega Launcher and Keen Edge moves that hit one time normally now hit twice, with each hit dealing 70% of the move's normal damage. Secondary effects roll independently for each hit (except flinch).
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={"flag":256}}

### 434 Elemental Charge  [bespoke] pkrg=5170
  ABBR: 20% chance to BRN/FRZ/PARA with respective types.
  FULL: Elemental Charge gives attacking moves a 20% chance to inflict status conditions based on move type: Electric moves cause paralysis, Fire moves cause burn, and Ice moves cause frostbite.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=20,effects=[6],contactRequired=false,contactExcluded=false,filter={"type":9},firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=20,tags=["ER_FROSTBITE"],contactRequired=false,turns=undefined,filter={"type":14},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=20,effects=[3],contactRequired=false,contactExcluded=false,filter={"type":12},firstTurnChance=undefined}

### 435 Ambush  [bespoke] pkrg=5171
  ABBR: Guaranteed critical hit on first turn.
  FULL: Ambush guarantees a critical hit on the user's first turn after switching in or at the start of battle.
  CODE: CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={}}

### 436 Atlas  [entry-effect] pkrg=5172
  ABBR: Sets Gravity on entry for 8 turns.
  FULL: Atlas sets Gravity upon entering battle for 8 turns. Gravity prevents levitating moves like Fly; grounds all Pokemon making them vulnerable to Ground moves, Arena Trap, and hazards; boosts Grav Apple's damage by 50%; and boosts move accuracy by 66%.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-screen-or-room","tag":"GRAVITY","turns":8},once=false}

### 437 Radiance  [bespoke] pkrg=5173
  ABBR: +20% accuracy; Dark moves fail when user is present.
  FULL: Radiance increases the user's accuracy by 20% for all moves and causes Dark moves to fail.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=undefined}

### 438 Jaws of Carnage  [bespoke] pkrg=5174
  ABBR: Devours 1/2 of the foe when defeating it.
  FULL: Restores 50% max HP when defeating foes with biting moves or 25% with other moves. Only activates when knocking out a target with a direct hit.
  CODE: LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.5}

### 439 Angel's Wrath  [bespoke] pkrg=5175
  ABBR: Drastically alters all of the users moves.
  FULL: Tackle Encores+Disables, String Shot sets all hazards, Harden omniboosts by one stage, Iron Defense becomes a King's Shield that drops all stats, Electroweb traps, Bug Bite heals damage dealt, Poison Sting badly poisons+is super-effective on Steel. All enhanced attacks get a large damage boost.
  CODE: ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"moveIds":[33,40,527,450]}}

### 440 Prismatic Fur  [composite-vanilla-mashup] pkrg=5176
  ABBR: Color Change + Protean + Fur Coat + Ice Scales.
  FULL: Changes type to resist attacks before getting hit, changes type to match moves before landing a hit, halves physical damage, and halves special damage. Damage reduction is multiplicative with other sources.
  CODE: PostDefendTypeChangeAbAttr{showAbility=true,extraCondition=undefined,type=undefined} | PokemonTypeChangeAbAttr{showAbility=true,extraCondition=undefined,moveType=-1} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 441 Shocking Jaws  [chance-status-on-hit] pkrg=5177
  ABBR: Biting moves have 50% chance to paralyze the target.
  FULL: Shocking Jaws gives all biting moves a 50% chance to paralyze the target on hit. Multihits roll the activation chance on each hit.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=50,effects=[3],contactRequired=false,contactExcluded=false,filter={"flag":32},firstTurnChance=undefined}

### 442 Fae Hunter  [bespoke] pkrg=5178
  ABBR: Deals 1.5x damage to Fairy. Takes 0.5x damage from Fairy.
  FULL: Deals 1.5x damage to Fairy-type Pokemon and takes 0.5x damage when attacked by Fairy-type Pokemon. Based on attacker/defender Pokemon types, not move types. The damage reduction is multiplicative with other sources.
  CODE: OffensiveTypeMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetDefenderType=17,multiplier=1.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 443 Gravity Well  [entry-effect] pkrg=5179
  ABBR: Sets Gravity on entry for 5 turns.
  FULL: Sets Gravity upon entering battle for 5 turns. Gravity prevents levitating moves like Fly; grounds all Pokemon making them vulnerable to Ground moves, Arena Trap, and hazards; boosts Grav Apple's damage by 50%; and boosts move accuracy by 66%.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-screen-or-room","tag":"GRAVITY","turns":5},once=false}

### 444 Evaporate  [bespoke] pkrg=5180
  ABBR: Takes no damage and sets Mist if hit by water.
  FULL: Evaporate negates all damage from Water-type moves and sets Mist for 5 turns on the user's side when hit by Water moves. Mist protects the entire team from stat reductions, including self drops.
  CODE: TypedImmunityWithArenaTagAbAttr{showAbility=true,extraCondition=undefined,opts={"immuneType":10,"arenaTag":"MIST","turns":5}}

### 445 Lumberjack  [bespoke] pkrg=5181
  ABBR: Deals 1.5x damage to Grass. Takes 0.5x damage from Grass.
  FULL: Deals 1.5x damage to Grass-type Pokemon and takes 0.5x damage when attacked by Grass-type Pokemon. Based on attacker/defender Pokemon types, not move types. The damage reduction is multiplicative with other sources.
  CODE: OffensiveTypeMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetDefenderType=11,multiplier=1.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 446 Well Baked Body  [(vanilla-map)] pkrg=273
  ABBR: Boosts Defense sharply instead of being hit by Fire-type moves.
  FULL: Well Baked Body grants immunity to Fire-type moves and boosts Defense by 2 stages when hit by Fire attacks.
  CODE: TypeImmunityStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,immuneType=9,condition=null,stat=2,stages=2}

### 447 Furnace  [bespoke] pkrg=5182
  ABBR: User gains +2 Speed when when hit by rocks.
  FULL: Furnace boosts Speed by +2 stages when hit by Rock-type moves or when switching in with Stealth Rock present.
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":5,"stages":2}],filter={"types":[5]}}

### 448 Electromorphosis  [(vanilla-map)] pkrg=280
  ABBR: Charges up when getting hit.
  FULL: When hit by any move, the user becomes charged up, doubling the power of the next Electric-type move used. Charged status is consumed after one Electric move use.
  CODE: PostDefendApplyBattlerTagAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,tagType="CHARGED"}

### 449 Rocky Payload  [(vanilla-map)] pkrg=276
  ABBR: Boosts the power of Rock-type and throwing moves by 1.5x.
  FULL: Rocky Payload boosts Rock-type and throwing-based moves by 50%. Throwing moves include Rock Throw, Egg Bomb, Rock Slide, Rock Tomb, Fling, Rock Wrecker, Grav Apple, and Astral Barrage.
  CODE: MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 450 Earth Eater  [(vanilla-map)] pkrg=297
  ABBR: Heals 25% of max HP when hit by a Ground move.
  FULL: Earth Eater heals the Pokemon for 25% of its maximum HP when hit by Ground-type moves.
  CODE: TypeImmunityHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=4,condition=null}

### 451 Lingering Aroma  [(vanilla-map)] pkrg=268
  ABBR: If hit, makes the attacker's ability Lingering Aroma.
  FULL: Lingering Aroma changes the attacker's ability (not innates) to Lingering Aroma when the user is hit by a contact move.
  CODE: PostDefendAbilityGiveAbAttr{showAbility=true,extraCondition=undefined,ability=268}

### 452 Fairy Tale  [entry-effect] pkrg=5183
  ABBR: Adds Fairy type on entry.
  FULL: Upon entering battle, adds Fairy to the user's current typing. Retains Fairy typing even upon losing the ability, going away only when switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":17},once=false}

### 453 Raging Moth  [multi-hit-override] pkrg=5184
  ABBR: Fire moves hits twice, both hits at 70% power.
  FULL: Fire moves to hit twice, with each hit dealing 70% of the move's normal damage. Secondary effects roll independently for each hit (except flinch).
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={"type":9}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.7,condition=<fn>,powerMultiplier=0.7,powerFilter={"type":9}}

### 454 Adrenaline Rush  [stat-trigger-on-event] pkrg=5185
  ABBR: KOs raise Speed by one stage.
  FULL: Boosts the user's Speed by one stage whenever it knocks out an opponent with a direct hit.
  CODE: StatTriggerOnKoAbAttr{showAbility=true,extraCondition=undefined,event="on-ko",stats=[{"stat":5,"stages":1}]}

### 455 Archmage  [bespoke] pkrg=5186
  ABBR: 30% chance of adding a type related effect to each move.
  FULL: 30% chance to add type-based effects: Poison=Toxic, Ice=Frostbite, Water=Confusion, Fire=Burn, Electric/Psychic/Fairy/Grass set terrain, Normal=Encore, Rock=Stealth Rock, Ghost=Disable, Dark=Bleed, Fighting=+SpAtk, Flying=+Speed, Dragon=-Atk, Ground=Trap, Steel=+Def.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=30,effects=[6],contactRequired=false,contactExcluded=false,filter={"type":9},firstTurnChance=undefined} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=30,effects=[3],contactRequired=false,contactExcluded=false,filter={"type":12},firstTurnChance=undefined} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=30,effects=[1],contactRequired=false,contactExcluded=false,filter={"type":3},firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["ER_FROSTBITE"],contactRequired=false,turns=undefined,filter={"type":14},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["ER_FEAR"],contactRequired=false,turns=undefined,filter={"type":7},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["CONFUSED"],contactRequired=false,turns=undefined,filter={"type":13},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["FLINCHED"],contactRequired=false,turns=undefined,filter={"type":16},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["SEEDED"],contactRequired=false,turns=undefined,filter={"type":11},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 456 Cryomancy  [bespoke] pkrg=5187
  ABBR: Moves inflict frostbite 5x as often.
  FULL: Cryomancy multiplies the chance of inflicting frostbite by 5x on all moves.  Does not interact with Freezing Point.
  CODE: StatusChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,status=5}

### 457 Phantom Pain  [bespoke] pkrg=5188
  ABBR: Ghost-type moves deal normal damage to Normal.
  FULL: Phantom Pain removes Normal- type immunity to Ghost-type moves, allowing Ghost attacks to hit Normal-type Pokemon for 1x effectiveness.
  CODE: IgnoreTypeImmunityAbAttr{showAbility=false,extraCondition=undefined,defenderType=0,allowedMoveTypes=[7]}

### 458 Purgatory  [type-damage-boost] pkrg=5189
  ABBR: Boosts Ghost-type moves by 1.3x, or 1.8x when below 1/3 HP.
  FULL: Boosts the power of Ghost-type moves by 30%, or by 80% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=7,highHpMultiplier=1.3,lowHpMultiplier=1.8,lowHpThreshold=0.3333333333333333,weathers=null}

### 459 Emanate  [type-conversion] pkrg=5190
  ABBR: Normal moves become Psychic. Psychic moves are empowered.
  FULL: Changes the user's Normal-type moves to Psychic-type. If the user is Psychic-type its Psychic-type moves have a 10% confusion chance, otherwise it gains Psychic STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=13,condition=<fn>,source={"kind":"type","type":0},configuredNewType=13} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 460 Kunoichi's Blade  [composite-vanilla-mashup] pkrg=5191
  ABBR: Technician + Skill Link.
  FULL: Boosts moves with 60 BP or less by 1.5x. Does not boost moves with 60 BP or less if they potentially can have more than 60 BP, such as Revenge or Venoshock. Multihit moves to always hit 5 times. For moves that only hit 3 times or Population Bomb, there will be one accuracy check for all hits.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5} | MaxMultiHitAbAttr{showAbility=false,extraCondition=undefined} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 461 Monkey Business  [bespoke] pkrg=5192
  ABBR: Uses Tickle on entry.
  FULL: Monkey Business automatically uses Tickle upon switching into battle, lowering the opposing Pokemon's Attack and Defense stats by one stage each.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":321}}

### 462 Combat Specialist  [flag-damage-boost] pkrg=5193
  ABBR: Boosts the power of punching and kicking moves by 1.3x.
  FULL: Combat Specialist boosts the power of punching and kicking moves by 30%.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=128,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 463 Jungle's Guard  [bespoke] pkrg=5194
  ABBR: Protects Grass-type allies from status and stat drops.
  FULL: Jungle's Guard shields the user+Grass-type allies from status conditions and stat drops while healing the user's status at the end of each turn during sun.
  CODE: UserFieldStatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[]}

### 464 Hunter's Horn  [bespoke] pkrg=5195
  ABBR: Boost horn moves and heals 1/4 HP when defeating an enemy.
  FULL: Boosts the power of horn and drill-based attacks by 30%. When the user knocks out an opponent with a direct hit, it immediately recovers 25% of its maximum HP.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=67108864,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25}

### 465 Pixie Power  [type-damage-boost] pkrg=5196
  ABBR: 1.2x accuracy. Boosts Fairy moves by 1.33x for all.
  FULL: All Fairy-type moves for the user, their allies, and the opponent get a 1.33x boost. Boost is reversed by Aura Break. 1.2x accuracy on all moves.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.33,type=17,highHpMultiplier=1.33,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 466 Plasma Lamp  [bespoke] pkrg=5197
  ABBR: Boost accuracy & power of Fire & Electric type moves by 1.2x.
  FULL: Plasma Lamp boosts both power and accuracy of Fire and Electric-type moves by 20% each.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=9,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=12,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=<fn>}

### 467 Magma Eater  [composite-vanilla-mashup] pkrg=5198
  ABBR: Predator + Molten Down.
  FULL: When the user knocks out an opponent with a direct hit, it immediately recovers 25% of its maximum HP. Fire-type are moves super effective against Rock- types instead of resisted.
  CODE: LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25} | OffensiveTypeChartOverrideAbAttr{showAbility=false,extraCondition=undefined,rules=[{"attackType":9,"defenderType":5,"newMultiplier":2}]}

### 468 Super Hot Goo  [bespoke] pkrg=5199
  ABBR: Inflicts burn and lowers Speed on contact.
  FULL: Contact moves have a 30% chance to inflict burn and the user lowers the attacker's Speed by one stage when receiving a contact move.
  CODE: ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[6],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined} | StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":5,"stages":-1}],filter=null}

### 469 Nika  [composite-vanilla-mashup] pkrg=5200
  ABBR: Iron fist + Water moves function normally under sun.
  FULL: Punching moves are boosted by 30%. Water moves receive no penalty when sun is on the field.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2}

### 470 Archer  [flag-damage-boost] pkrg=5201
  ABBR: Boosts the power of arrow moves by 1.3x.
  FULL: Archer boosts the power of arrow-based moves by 30%.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=2097152,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 471 Cold Plasma  [bespoke] pkrg=5202
  ABBR: Electric type moves now inflict burn instead of paralysis.
  FULL: Causes Electric-type moves to inflict burn instead of paralysis.
  CODE: PostAttackApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=10,effects=[6]}

### 472 Super Slammer  [flag-damage-boost] pkrg=5203
  ABBR: Boosts the power of hammer and slamming moves by 1.3x.
  FULL: Super Slammer boosts the power of hammer-based moves by 30%.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=33554432,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 473 Inversion  [bespoke] pkrg=5204
  ABBR: Sets up Inverse Room on entry, lasts 3 turns.
  FULL: Sets up Inverse Room on entry, lasts 3 turns.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-screen-or-room","tag":"INVERSE_ROOM","turns":3},once=false}

### 474 Accelerate  [bespoke] pkrg=5205
  ABBR: Moves that need a charge turn are now used instantly.
  FULL: Accelerate eliminates the charging turn requirement for two-turn moves, allowing them to be used instantly.
  CODE: SkipChargeTurnAbAttr{showAbility=false,extraCondition=undefined}

### 475 Frost Burn  [bespoke] pkrg=5206
  ABBR: Triggers 40BP Ice Beam after using a Fire-type move.
  FULL: Triggers a 40 BP Ice Beam immediately after using any Fire-type move.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":58,"power":40,"typeFilter":[9]}}

### 476 Itchy Defense  [bespoke] pkrg=5207
  ABBR: Causes infestation when hit by a contact move.
  FULL: Itchy Defense traps attackers with Infestation when the user is successfully hit by a contact move. The trapped opponent loses 1/8th of their maximum HP damage each turn for 4-5 turns and cannot switch out.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=100,tags=["INFESTATION"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 477 Generator  [bespoke] pkrg=5208
  ABBR: Charges up once on entry or when electric terrain is active.
  FULL: Generator charges up the user once upon switching in, doubling Electric-type move power for the next Electric attack. Recharge when Electric Terrain becomes active during battle. The charged state is lost upon switching out or after using an Electric move.
  CODE: PostSummonAddBattlerTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,tagType="CHARGED",turnCount=0}

### 478 Moon Spirit  [bespoke] pkrg=5209
  ABBR: Fairy & Dark gains STAB. Moonlight recovers 75% HP.
  FULL: Moon Spirit grants STAB to all Fairy and Dark-type moves regardless of the user's typing. When using Moonlight, recovery increases to 75% max HP instead of normal 50% or weather- modified amounts.
  CODE: StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=17,multiplier=1.5} | StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=16,multiplier=1.5}

### 479 Dust Cloud  [bespoke] pkrg=5210
  ABBR: Attacks with Sand Attack on switch-in.
  FULL: Uses Sand Attack on the opponent upon switching into battle, reducing the target's accuracy by one stage.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":28}}

### 480 Berserker Rage  [composite-vanilla-mashup] pkrg=5211
  ABBR: Tipping Point + Rampage.
  FULL: When hit, raises the user's Special Attack by 1 stage or maximizes it on critical hits. When the user knocks out an opponent, it instantly recovers from recharge status, allowing immediate use of moves like Hyper Beam without waiting.
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":3,"stages":1}],filter=null} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=3,stages=12} | PostVictoryClearTagAbAttr{showAbility=true,extraCondition=undefined,tags=["RECHARGING"]}

### 481 Trickster  [bespoke] pkrg=5212
  ABBR: Uses Disable on switch-in.
  FULL: Uses Disable on switch-in. Disable prevents the target from using their last-used move for 4 turns. Fails if the target has not moved yet.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":50}}

### 482 Sand Guard  [bespoke] pkrg=5213
  ABBR: Blocks priority and reduces special damage by 1/2 in sand.
  FULL: Sand Guard blocks priority moves and reduces Special Attack damage by 50% during a sandstorm. Multiplicative with other sources of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"category-in-weather","category":1,"weather":3}}

### 483 Natural Recovery  [composite-vanilla-mashup] pkrg=5214
  ABBR: Natural Cure + Regenerator.
  FULL: Cures all status conditions when switching out. Also restores 33% of maximum HP when switching out.
  CODE: PreSwitchOutResetStatusAbAttr{showAbility=false,extraCondition=undefined} | PreSwitchOutHealAbAttr{showAbility=false,extraCondition=undefined}

### 484 Wind Rider  [(vanilla-map)] pkrg=274
  ABBR: Increases attack in tailwind or when hit by wind move.
  FULL: Boosts the user's highest attacking stat when entering battle under Tailwind. When hit by wind-based moves, absorbs the attack and raises the highest attacking stat by one stage.
  CODE: MoveImmunityStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,immuneCondition=<fn>,stat=1,stages=1} | PostSummonStatStageChangeOnArenaAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[1],stages=1,selfTarget=true,intimidate=false,arenaTagType="TAILWIND"}

### 485 Soothing Aroma  [bespoke] pkrg=5215
  ABBR: Cures party status on entry.
  FULL: On entry, heals all status conditions from every Pokemon in the user's party, including both active and benched Pokemon.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":215}}

### 486 Prim and Proper  [composite-vanilla-mashup] pkrg=5216
  ABBR: Wonder Skin + Cute Charm.
  FULL: When hit by making contact (offensively or defensively), has a 50% chance to infatuate the attacker (cuts their Attack and Special Attack in half). Only works on Pokemon of the opposite gender. Immune to all damage boosting ability effects from opponents, other than Parental Bond and Multi-Headed.
  CODE: WonderSkinAbAttr{showAbility=false,extraCondition=undefined} | PostDefendSuppressOpponentDamageBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.77} | PostDefendContactApplyTagChanceAbAttr{showAbility=true,extraCondition=undefined,chance=50,tagType="INFATUATED",turnCount=undefined} | PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=<fn>,effects=["INFATUATED"]}

### 487 Super Strain  [bespoke] pkrg=5217
  ABBR: KOs lower Attack by +1. Take 25% recoil damage.
  FULL: The user's moves deal 25% of the damage done to the user as recoil. When the user knocks out the opponent with a direct attack, user's Attack stat drops by 1 stage.
  CODE: StatTriggerOnKoAbAttr{showAbility=true,extraCondition=undefined,event="on-ko",stats=[{"stat":1,"stages":-1}]} | SelfDamageOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,basis="damageDealt",fraction=0.25}

### 488 Tipping Point  [bespoke] pkrg=5218
  ABBR: Getting hit raises SpAtk. Critical hits maximize SpAtk.
  FULL: When hit, raises the user's Special Attack by 1 stage or maximizes it on critical hits. Activates on each hit of a multihit move.
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":3,"stages":1}],filter=null} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=3,stages=12}

### 489 Enlightened  [composite-vanilla-mashup] pkrg=5219
  ABBR: Emanate + Inner Focus.
  FULL: Converts all Normal-type moves to Psychic-type and grants STAB for Psychic moves, regardless of the user's type. Focus Blast never misses. Unaffected by flinch, Intimidate, or Scare.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=13,condition=<fn>,source={"kind":"type","type":0},configuredNewType=13} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2} | BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["FLINCHED","ER_FEAR"]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 490 Peaceful Slumber  [composite-vanilla-mashup] pkrg=5220
  ABBR: Sweet Dreams + Self Sufficient.
  FULL: Sweet Dreams restores 1/8 of maximum HP at the end of each turn when the user is asleep or has the Comatose ability. Additionally, it grants immunity to Bad Dreams damage. Restores 1/16 of the Pokemon's maximum HP at the end of each turn.
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.125,conditionSpec={"kind":"status","status":4}} | PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.0625,conditionSpec={"kind":"always"}}

### 491 Aftershock  [bespoke] pkrg=5221
  ABBR: Triggers Magnitude 4-7 after using a damaging move.
  FULL: After landing a damaging move, the user follows up with Magnitude at 10, 30, 50, or 70 power. Hits all adjacent Pokemon.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":222}}

### 492 Freezing Point  [bespoke] pkrg=5222
  ABBR: 20% chance to get frostbitten on contact and 30% non-contact.
  FULL: Contact with this Pokemon has a 20% chance to inflict frostbite. Non-contact has a 30% chance. Works offensively and defensively. Frostbitten Pokemon lose 1/8th of their max HP each turn and have their Special Attack halved.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=20,tags=["ER_FROSTBITE"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined} | ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=30,tags=["ER_FROSTBITE"],contactRequired=false,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 493 Cryo Proficiency  [composite-vanilla-mashup] pkrg=5223
  ABBR: Freezing Point + triggers hail when hit.
  FULL: Contact with this Pokemon has a 30% chance to inflict frostbite. Non-contact has a 20% chance. Works offensively and defensively. Frostbitten Pokemon lose 1/8th of their max HP each turn and have their Special Attack halved.  Sets hail after receiving a hit. Immune to hail damage.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=20,tags=["ER_FROSTBITE"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined} | ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=30,tags=["ER_FROSTBITE"],contactRequired=false,turns=undefined,filter=undefined,firstTurnChance=undefined} | PostDefendWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,weatherType=4,condition=undefined}

### 494 Arcane Force  [bespoke] pkrg=5224
  ABBR: All moves gain STAB. Ups “supereffective” by 10%.
  FULL: Grants the 1.5x STAB damage bonus to all moves regardless of type matching. Does not boost moves that already receive a STAB bonus. Additionally, boosts the power of super effective moves by 10%.
  CODE: StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=null,multiplier=1.5} | SuperEffectiveMultiplierBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.1}

### 495 Doombringer  [bespoke] pkrg=5225
  ABBR: Uses Doom Desire on switch-in.
  FULL: Uses Doom Desire on entry. Doom Desire is a Steel-type 140 base power and strikes the target two turns later, bypassing substitutes and other protections. The attack cannot miss once initiated and ignores accuracy checks. This cannot target the same Pokemon twice.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":353}}

### 496 Wishmaker  [bespoke] pkrg=5226
  ABBR: Uses Wish on switch-in. Three uses per battle.
  FULL: Uses Wish on entry, setting up delayed healing that restores half of the current ally's max HP on the following turn. Activates 3 times per battle.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":273}}

### 497 Yuki Onna  [chance-status-on-hit] pkrg=5227
  ABBR: Scare + Intimidate. 30% chance to infatuate on hit.
  FULL: Lowers both Attack and Special Attack of opposing Pokemon upon entry by one stage. Additionally provides a 30% chance to infatuate (cuts their Attack and Special Attack in half) the target on contact. Works offensively and defensively. This only works on the opposite gender.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["INFATUATED"],contactRequired=true,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 498 Suppress  [bespoke] pkrg=5228
  ABBR: Casts Torment on entry.
  FULL: Uses Torment on entry, preventing the opponent from using the same move consecutively.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":259}}

### 499 Refrigerator  [composite-vanilla-mashup] pkrg=5229
  ABBR: Filter + Illuminate.
  FULL: Reduces damage from super effective attacks by 35%. Multiplicative with other damage reduction sources. Boosts the user's accuracy by 1.2x. Removes Ghost-typing on target when landing an attack.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=undefined}

### 500 Heaven Asunder  [bespoke] pkrg=5230
  ABBR: Spacial Rend always crits. Ups crit level by +1.
  FULL: Guarantees Spacial Rend always lands critical hits and increases critical hit ratio by one stage for all other moves.
  CODE: CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={}}

### 501 Purifying Waters  [composite-vanilla-mashup] pkrg=5231
  ABBR: Hydration + Water Veil.
  FULL: Uses Aqua Ring on entry, which restores 1/16 HP each turn. Grants immunity to burn status and removes burn on switching in. During rain, cures all status conditions at the end of the turn.
  CODE: PostTurnResetStatusAbAttr{showAbility=true,extraCondition=undefined,allyTarget=false,target=undefined} | StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[6]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[6],statusHealed=undefined} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"scripted-move","move":392},once=false}

### 502 Seaborne  [composite-vanilla-mashup] pkrg=5232
  ABBR: Drizzle + Swift Swim.
  FULL: Upon entry, sets rain weather for 8 turns. During rain, the user's Speed is boosted by 50%.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=2,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=2,erTurns=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined}

### 503 High Tide  [bespoke] pkrg=5233
  ABBR: Triggers 50 BP Surf after using a Water-type move.
  FULL: Triggers a 50 BP Surf after the user lands a Water-type attack, including status moves like Soak. Surf hits all adjacent Pokemon.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":57,"power":50,"typeFilter":[10]}}

### 504 Change of Heart  [bespoke] pkrg=5234
  ABBR: Uses Heart Swap on switch-in.
  FULL: Uses Heart Swap on entry. Swaps stat stages with the Pokemon directly across from the user. Ignores accuracy checks.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":391}}

### 505 Mystic Blades  [bespoke] pkrg=5235
  ABBR: Keen edge moves become special and deal 30% more damage.
  FULL: Keen Edge moves become Special (deal Special damage and use the Special Attack stat) and deal 30% more damage.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=3,specialStat=undefined,contactOnly=false,flag=256,useHigherOffense=false}

### 506 Determination  [bespoke] pkrg=5236
  ABBR: Ups Special Attack by 50% if suffering.
  FULL: Boosts Special Attack stat by 50% when the Pokemon has any status condition. Also prevents the frostbite status from reducing Special Attack.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.5,condition=<fn>}

### 507 Fertilize  [type-conversion] pkrg=5237
  ABBR: Normal moves become Grass. Grass moves are empowered.
  FULL: Changes the user's Normal-type moves to Grass-type. If the user is Grass-type its Grass-type moves heal for 10% of damage dealt, otherwise it gains Grass STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=11,condition=<fn>,source={"kind":"type","type":0},configuredNewType=11} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 508 Pure Love  [composite-vanilla-mashup] pkrg=5238
  ABBR: Cute Charm + heal 25% damage vs infatuated.
  FULL: 50% to infatuate on contact (cuts their Attack and Special Attack in half). Heals 25% of damage dealt when attacking infatuated targets.
  CODE: PostDefendContactApplyTagChanceAbAttr{showAbility=true,extraCondition=undefined,chance=50,tagType="INFATUATED",turnCount=undefined} | PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=<fn>,effects=["INFATUATED"]} | LifestealOnHitAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,hitHealFraction=0.25,hitFilter={"targetTag":"INFATUATED"}}

### 509 Fighter  [type-damage-boost] pkrg=5239
  ABBR: Boosts Fight.-type moves by 1.2x, or 1.5x when below 1/3 HP.
  FULL: Boosts the power of Fighting- type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=1,highHpMultiplier=1.2,lowHpMultiplier=1.5,lowHpThreshold=0.3333333333333333,weathers=null}

### 510 Mycelium Might  [(vanilla-map)] pkrg=298
  ABBR: Status moves ignore immunities but go last.
  FULL: Allows status moves to bypass all immunities and type resistances, but forces them to move last in their priority bracket.
  CODE: ChangeMovePriorityInBracketAbAttr{showAbility=false,extraCondition=undefined,newModifier=0,moveFunc=<fn>} | PreventBypassSpeedChanceAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>}

### 511 Telekinetic  [bespoke] pkrg=5240
  ABBR: Casts Telekinesis on entry.
  FULL: Casts Telekinesis on entry. All moves against the target cannot miss, but they become immune to Ground-type moves and other Grounded effects. Cannot affect Rooted Pokemon or if they hold Iron Ball. Wears off under Gravity or if they are hit by Smack Down. Lasts 3 turns.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":477}}

### 512 Combustion  [type-damage-boost] pkrg=5241
  ABBR: Boosts the power of Fire-type moves by 1.5x.
  FULL: Combustion increases the power of all Fire-type moves by 50%.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,type=9,highHpMultiplier=1.5,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 513 Blade's Essence  [composite-vanilla-mashup] pkrg=5242
  ABBR: Keen Edge + Mystic Blades.
  FULL: Keen Edge moves become Special (deal Special damage and use the Special Attack stat) and deal 30% more damage. Also gives another 30% to Keen Edge moves.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=3,specialStat=undefined,contactOnly=false,flag=256,useHigherOffense=false}

### 514 Powder Burst  [bespoke] pkrg=5243
  ABBR: Casts Powder on entry.
  FULL: Uses Powder on entry, coating the target with explosive powder for the remainder of the turn. If the target uses any Fire-type move while coated, they lose 25% of their max HP and the powder is consumed.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":600}}

### 515 Retriever  [bespoke] pkrg=5244
  ABBR: Retrieves item on switch-out.
  FULL: Retrieves original held item when switching out if not holding one. Must not be knocked out to activate.
  CODE: PreSwitchOutItemRestoreAbAttr{showAbility=true,extraCondition=undefined}

### 516 Monster Mash  [bespoke] pkrg=5245
  ABBR: Casts Trick-or-Treat on entry.
  FULL: Casts Trick-or-Treat on entry, adding Ghost type to the target. They do not benefit from the effects of fog. The effect persists until the target switches out.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":567}}

### 517 Two Step  [bespoke] pkrg=5246
  ABBR: Triggers 50BP Revelation Dance after using a Dance move.
  FULL: After using a dance move, automatically follows up with a 50 BP Revelation Dance. The follow-up move matches the user's primary type.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":686,"power":50,"flagFilter":4096}}

### 518 Spiteful  [bespoke] pkrg=5247
  ABBR: Reduces attacker's PP on contact.
  FULL: Spiteful reduces the attacker's PP by 4 when hit by contact moves. Targets the last move used by the attacker. Fails if the attacker has no remaining PP or hasn't used any moves yet.
  CODE: PpReductionOnContactAbAttr{showAbility=true,extraCondition=undefined,reduction=4,contactRequired=true}

### 519 Fortitude  [bespoke] pkrg=5248
  ABBR: Boosts SpDef +1 when hit. Maxes SpDef on crit.
  FULL: When hit, raises the user's Special Defense by 1 stage or maximizes it on critical hits. Activates on each hit of a multihit move.
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":4,"stages":1}],filter=null} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=4,stages=12}

### 520 Devourer  [composite-vanilla-mashup] pkrg=5249
  ABBR: Strong Jaw + Primal Maw.
  FULL: Boosts biting moves by 30%. All biting moves to hit twice. The first hit deals 100% damage while the second hit deals 40% damage. Independently rolls secondary effects of attacks on each hit.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={"flag":32}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.4,condition=<fn>,powerMultiplier=0.4,powerFilter={"flag":32}}

### 521 Phantom Thief  [bespoke] pkrg=5250
  ABBR: Attacks with 40BP Spectral Thief on switch-in.
  FULL: Uses a 40 BP Spectral Thief (a Ghost-type move) when switching in, targeting the opponent across from the user. Steals all positive stat boosts (before dealing damage) from the target and applies them to the user. Cannot miss and ignores Substitute.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":712,"power":40}}

### 522 Early Grave  [priority-modifier] pkrg=5251
  ABBR: Ghost-type moves get +1 priority at max HP.
  FULL: Ghost-type moves gain +1 priority when at full HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"type":7},condition={"kind":"full-hp"}}

### 523 Grappler  [bespoke] pkrg=5252
  ABBR: Trapping moves last 6 turns. Trapping deals 1/6 HP.
  FULL: Trapping moves last 6 turns instead of 4-5 turns and increases their damage at the end of the turn to 1/6 max HP per turn.
  CODE: TrapDurationModifierAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"turns":6,"damageFraction":0.16666666666666666}}

### 524 Bass Boosted  [composite-vanilla-mashup] pkrg=5253
  ABBR: Amplifier + Punk Rock.
  FULL: Boosts sound-based moves by 30%. Single-target sound moves gain spread targeting to hit both opposing Pokemon. Does not spread with multihit moves. Also boosts the user's sound moves by another 30% and reduces incoming sound move damage by 50%. Damage reduction is multiplicative with other sources.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=4,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 525 Flaming Jaws  [chance-status-on-hit] pkrg=5254
  ABBR: Biting moves have 50% chance to burn the target.
  FULL: Biting moves a 50% chance to burn the target on hit. Multihits roll the activation chance on each hit.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=50,effects=[6],contactRequired=false,contactExcluded=false,filter={"flag":32},firstTurnChance=undefined}

### 526 Monster Hunter  [bespoke] pkrg=5255
  ABBR: Deals 1.5x damage to Dark. Takes 0.5x damage from Dark.
  FULL: Deals 1.5x damage to Dark-type Pokemon and takes 0.5x damage when attacked by Dark-type Pokemon. Based on attacker/defender Pokemon types, not move types. The damage reduction is multiplicative with other sources.
  CODE: OffensiveTypeMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetDefenderType=16,multiplier=1.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 527 Crowned Sword  [composite-vanilla-mashup] pkrg=5256
  ABBR: Intrepid Sword + Anger Point.
  FULL: Raises Attack by 1 stage upon switching in. When hit, raises the user's Attack by 1 stage or maximizes it on critical hits. Activates on each hit of a multihit move.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[1],stages=1,selfTarget=true,intimidate=false} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=1,stages=12} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=1,selfTarget=true,allOthers=false}

### 528 Crowned Shield  [composite-vanilla-mashup] pkrg=5257
  ABBR: Dauntless Shield + Stamina.
  FULL: Raises Defense by 1 stage upon switching in. When hit, raises the user's Defense by 1 stage or maximizes it on critical hits. Activates on each hit of a multihit move.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[2],stages=1,selfTarget=true,intimidate=false} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=2,stages=1,selfTarget=true,allOthers=false} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=2,stages=12}

### 529 Berserk DNA  [bespoke] pkrg=5258
  ABBR: Sharply ups highest attacking stat but enrages on entry.
  FULL: Raises the user's highest attacking stat by 2 stages when it enters, but becomes enraged, adding 33% recoil to all attacks. Boost applies even if it can't become enraged.
  CODE: SelfHighestStatBoostOnSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,candidates=[1,3],stages=2,weathers=undefined,terrains=undefined}

### 530 Crowned King  [composite-vanilla-mashup] pkrg=5259
  ABBR: Unnerve + Grim Neigh + Chilling Neigh.
  FULL: Prevents all opposing Pokemon from consuming held items. Raise Attack and Special Attack by one stage when the user knocks out an opponent with a direct attack.
  CODE: PreventBerryUseAbAttr{showAbility=true,extraCondition=undefined} | PostVictoryStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=3,stages=1} | PostVictoryStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=1,stages=1}

### 531 Clap Trap  [bespoke] pkrg=5260
  ABBR: Counters contact with 50BP Snap Trap.
  FULL: When the user receives a contact move, counters with a 50 BP Snap Trap. This Steel-type move traps opponents for 4-5 turns while dealing 1/8 max HP damage.
  CODE: CounterAttackOnHitAbAttr{showAbility=false,extraCondition=undefined,moveId=779,power=50,chance=100,filter={"contactRequired":true}}

### 532 Permanence  [bespoke] pkrg=5261
  ABBR: Foes can't heal in any way.
  FULL: Prevents all opposing Pokemon from healing through any means. Blocks healing moves like Recover, absorbing moves like Drain Punch, passive healing from Leftovers and abilities like Regenerator, and prevents health recovery from berries and other items.
  CODE: PostSummonApplyTagOnFoesAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,opts={"tag":"HEAL_BLOCK","turns":5}} | PostTurnApplyTagOnFoesAbAttr{showAbility=true,extraCondition=undefined,tag="HEAL_BLOCK",turns=2}

### 533 Hubris  [stat-trigger-on-event] pkrg=5262
  ABBR: KOs raise SpAtk by one stage.
  FULL: Boosts the user's Special Attack by one stage whenever it knocks out an opponent with a direct hit.
  CODE: StatTriggerOnKoAbAttr{showAbility=true,extraCondition=undefined,event="on-ko",stats=[{"stat":3,"stages":1}]}

### 534 Cosmic Daze  [conditional-damage] pkrg=5263
  ABBR: Deals 2x damage vs confused and enraged foes.
  FULL: Attacks against confused and enraged targets deal double damage. Additionally, confused and enraged enemies take twice as much damage when they hurt themselves from those statuses.
  CODE: ConditionalDamageAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2,damageCondition={"kind":"target-confused"},damageMultiplier=2}

### 535 Mind's Eye  [(vanilla-map)] pkrg=299
  ABBR: Hits Ghost-type Pokémon. Accuracy can't be lowered.
  FULL: Mind's Eye allows Normal and Fighting-type moves to hit Ghost-type Pokemon with normal effectiveness. Additionally, this ability prevents the user's accuracy stat from being lowered by opposing moves or abilities.
  CODE: IgnoreTypeImmunityAbAttr{showAbility=false,extraCondition=undefined,defenderType=7,allowedMoveTypes=[0,1]} | ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=6} | IgnoreOpponentStatStagesAbAttr{showAbility=false,extraCondition=undefined,stats=[7]}

### 536 Blood Price  [bespoke] pkrg=5264
  ABBR: Does 30% more damage but lose 10% HP when attacking.
  FULL: Blood Price boosts all attacking moves by 30%, but the user loses 10% of their max hp when landing an attack.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | SelfDamageOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,basis="maxHp",fraction=0.1}

### 537 Spike Armor  [chance-status-on-hit] pkrg=5265
  ABBR: 30% chance to bleed on contact or offense.
  FULL: Spike Armor has a 30% chance to inflict bleeding on contact moves, both when attacking and being attacked. Bleeding causes 1/16 max HP damage per turn, prevents healing, and negates the effects of stat stages. Rock and Ghost types are immune to bleeding.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=30,tags=["ER_BLEED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["ER_BLEED"],contactRequired=true,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 538 Voodoo Power  [chance-status-on-hit] pkrg=5266
  ABBR: 30% chance to bleed when hit by special attacks.
  FULL: 30% chance to bleed when hit by special attacks.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=30,tags=["ER_BLEED"],contactRequired=false,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 539 Chrome Coat  [damage-reduction-generic] pkrg=5267
  ABBR: Reduces special damage taken by 40%, but decreases Speed by 10%.
  FULL: Chrome Coat reduces special damage by 40% but decreases Speed by 10%. Also triples the user's weight. The damage reduction is multiplicative with other sources.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.6,reductionAmount=0.4,filterSpec={"kind":"category","category":1}}

### 540 Banshee  [type-conversion] pkrg=5268
  ABBR: Sound moves get a 1.2x boost and become Ghost if Normal.
  FULL: Boosts the power of all sound- based moves by 20% and converts Normal-type sound moves to Ghost-type.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=7,condition=<fn>,source={"kind":"flag","flag":4,"requireType":0},configuredNewType=7} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"flag","flag":4,"requireType":0},multiplier=1.2}

### 541 Web Spinner  [bespoke] pkrg=5269
  ABBR: Uses String Shot on switch-in.
  FULL: Uses String Shot on switch in, harshly lowering the Speed of all opponents by 2 stages.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":81}}

### 542 Showdown Mode  [composite-vanilla-mashup] pkrg=5270
  ABBR: Ambush + Violent Rush.
  FULL: Guarantees a critical hit while also boosting the user's Attack by 20% and their Speed by 50% after switching in. Lasts one turn.
  CODE: CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={}} | FirstTurnStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 543 Seed Sower  [(vanilla-map)] pkrg=269
  ABBR: Sets Grassy Terrain when hit. Heals party status when it does.
  FULL: Activates Grassy Terrain when the Pokemon takes damage from a direct attack, lasting 5 turns (8 with Terrain Extender). Also heals all party Pokemon's status conditions.
  CODE: PostDefendTerrainChangeAbAttr{showAbility=true,extraCondition=undefined,terrainType=3}

### 544 Airborne  [bespoke] pkrg=5271
  ABBR: Boosts own & ally's Flying-type moves by 1.3x.
  FULL: Increases the power of Flying- type moves by 30% for both the user and its allies in battle.
  CODE: UserFieldMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,powerMultiplier=1.3}

### 545 Parroting  [bespoke] pkrg=5272
  ABBR: Copies sound moves used by others.
  FULL: When any Pokemon on the field uses a sound move, this Pokemon immediately uses the same move after. Triggers once per move.
  CODE: CopyMoveByFilterAbAttr{showAbility=true,extraCondition=undefined,flag=4,moveIds=undefined}

### 546 Salt Circle  [bespoke] pkrg=5273
  ABBR: Prevents opposing pokemon from fleeing on entry.
  FULL: Prevents all opposing Pokemon from fleeing or switching when user enters battle. Effect lasts until user leaves field. Forced switches and pivot moves like Flip Turn still work.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":212}}

### 547 Purifying Salt  [(vanilla-map)] pkrg=272
  ABBR: Immune to status conditions. Take 1/2 damage from Ghost.
  FULL: Immune to all status conditions. Additionally reduces all Ghost- type damage by 50%. If afflicted with status when gaining this ability, conditions are immediately cured.
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[]} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 548 Protosynthesis  [(vanilla-map)] pkrg=281
  ABBR: Boosts highest stat in Sun or with Booster Energy.
  FULL: Boosts the user's highest stat by 50% for Speed or 30% for other stats during sun. When sun ends, Booster Energy activates if held. This is considered a raw stat boost and not a stat raise. Cannot be copied, suppressed, or replaced unless by Simple Beam or Worry Seed.
  CODE: PostSummonAddBattlerTagAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,tagType="PROTOSYNTHESIS",turnCount=0} | PostWeatherChangeAddBattlerTagAbAttr{showAbility=true,extraCondition=undefined,tagType="PROTOSYNTHESIS",turnCount=0,weatherTypes=[1,8]} | NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 549 Quark Drive  [(vanilla-map)] pkrg=282
  ABBR: Boosts highest stat in Electric Terrain or with Booster Energy.
  FULL: Boosts the user's highest stat by 50% for Speed or 30% for other stats during electric terrain. When terrain ends, Booster Energy activates if held. This is considered a raw stat boost and not a stat raise. Cannot be copied, suppressed, or replaced unless by Simple Beam or Worry Seed.
  CODE: PostSummonAddBattlerTagAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,tagType="QUARK_DRIVE",turnCount=0} | PostTerrainChangeAddBattlerTagAttr{showAbility=true,extraCondition=undefined,tagType="QUARK_DRIVE",turnCount=0,terrainTypes=[2]} | NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined}

### 550 Wind Power  [(vanilla-map)] pkrg=277
  ABBR: Charges up when hit by wind moves or Tailwind starts.
  FULL: Gain Charged status when hit by wind-based moves or entering in during Tailwind. The Charged status doubles the power of Electric-type moves until used.
  CODE: PostDefendApplyBattlerTagAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,tagType="CHARGED"}

### 551 Impulse  [bespoke] pkrg=5274
  ABBR: Non-contact moves use the Speed stat for damage.
  FULL: Non-contact moves use Speed stat for damage instead of Attack/Special Attack. Choice Scarf does not affect this ability.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=1,bonusFilter={"contact":"non"},sourceStat=5} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,bonusStat=3,speedFraction=1,bonusFilter={"contact":"non"},sourceStat=5}

### 552 Terminal Velocity  [bespoke] pkrg=5275
  ABBR: Special moves use 20% of its Speed stat additionally.
  FULL: Adds 20% of the user's Speed stat to damage when using non- contact moves. Choice Scarf does not affect this ability.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,bonusStat=3,speedFraction=0.2,bonusFilter={"category":"special"},sourceStat=5}

### 553 Guard Dog  [(vanilla-map)] pkrg=275
  ABBR: Can't be forced out. Inverts Intimidate effects.
  FULL: Guard Dog prevents forced switching from moves and Red Card. When affected by Intimidate or Scare, it raises the stat by one stage instead of lowering it.
  CODE: PostIntimidateStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=[1],stages=1,overwrites=true} | ForceSwitchOutImmunityAbAttr{showAbility=true,extraCondition=undefined}

### 554 Anger Shell  [(vanilla-map)] pkrg=271
  ABBR: Applies Shell Smash when reduced below 1/2 HP.
  FULL: When dropping to below 50% HP, the user triggers Shell Smash effects: raising Attack, Special Attack, and Speed by 2 stages each while lowering Defense and Special Defense by 1 stage each. Only activates once per battle. Activates at the last hit of multihit moves.
  CODE: PostDefendHpGatedStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,hpGate=0.5,stats=[1,3,5],stages=1,selfTarget=true} | PostDefendHpGatedStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,hpGate=0.5,stats=[2,4],stages=-1,selfTarget=true}

### 555 Egoist  [bespoke] pkrg=5276
  ABBR: Raises its own stats when foes raise theirs.
  FULL: Egoist copies stat boosts that enemy Pokemon receive and applies them to itself. Does not copy other Egoist boosts.
  CODE: OnOpponentStatRaiseAbAttr{showAbility=true,extraCondition=undefined,stats=[{"stat":1,"stages":1},{"stat":3,"stages":1},{"stat":5,"stages":1}]}

### 556 Subdue  [bespoke] pkrg=5277
  ABBR: Doubles stat drop effects used by this pokemon.
  FULL: Doubles the effectiveness of stat drops from moves. Does not affect self-inflicted stat drops or enemy abilities.
  CODE: OutgoingStatDropMultiplierAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,factor=2}

### 557 Readied Action  [bespoke] pkrg=5278
  ABBR: Doubles attack on first turn.
  FULL: Increases the user's Attack stat by 2x for one turn. Multiplicative with other damage boosts. Reapplies after switching in.
  CODE: FirstTurnStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=2,condition=undefined}

### 558 Stygian Rush  [priority-modifier] pkrg=5279
  ABBR: Dark-type moves get +1 priority at max HP.
  FULL: Grants +1 priority to Dark-type moves when at full HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"type":16},condition={"kind":"full-hp"}}

### 559 Guilt Trip  [bespoke] pkrg=5280
  ABBR: Sharply lowers attacker's Attack and SpAtk when fainting.
  FULL: The attacker that delivers the final blow on the user drops their Attack and Special Attack by 2 stages. Only works when fainting from direct damage.
  CODE: OnFaintEffectAbAttr{showAbility=true,extraCondition=undefined,effect={"kind":"attacker-stat-change","stats":[{"stat":1,"stages":-2},{"stat":3,"stages":-2}]}}

### 560 Tidal Rush  [priority-modifier] pkrg=5281
  ABBR: Water-type moves get +1 priority at max HP.
  FULL: Grants +1 priority to Water- type moves when at full HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"type":10},condition={"kind":"full-hp"}}

### 561 Zero To Hero  [(vanilla-map)] pkrg=278
  ABBR: Changes forms after switching out.
  FULL: After switching out, transforms user into Hero Form on entry. Lasts until the end of battle. Cannot be suppressed, swapped, copied, or overridden.
  CODE: NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined} | PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=undefined,formFunc=<fn>} | PreSwitchOutFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>} | PostSummonMessageAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,messageFunc=<fn>}

### 562 Costar  [(vanilla-map)] pkrg=294
  ABBR: Copies its ally's stat changes on switch-in.
  FULL: Costar copies all stat stage changes (positive and negative) from the ally when switching in during doubles battles.
  CODE: PostSummonCopyAllyStatsAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,ally=undefined}

### 563 Commander  [(vanilla-map)] pkrg=279
  ABBR: Hops inside an allied Dondozo. Boosts its ally but can't act.
  FULL: Allows Tatsugiri to enter an allied Dondozo and become untargetable. Dondozo receives +2 to all stats, cannot switch or be forced out and Tatsugiri becomes unusable. If Dondozo faints, Tatsugiri reappears and can act normally again. Cannot be swapped, copied, or suppressed.
  CODE: CommanderAbAttr{showAbility=true,extraCondition=undefined} | DoubleBattleChanceAbAttr{showAbility=false,extraCondition=undefined}

### 564 Tactical Retreat  [bespoke] pkrg=5282
  ABBR: Flees when stats are lowered.
  FULL: Automatically switches the user out when any of its stats are lowered, including self drops. Triggers once per battle.
  CODE: SelfSwitchOnStatLowerAbAttr{showAbility=true,extraCondition=undefined,helper={"switchType":1}}

### 565 Vengeful Spirit  [composite-vanilla-mashup] pkrg=5283
  ABBR: Haunted Spirit + Vengeance.
  FULL: Curses the attacker when knocked out by a direct hit. The curse inflicts 25% max HP damage per turn until the cursed Pokemon switches out or faints. Ghost-type attackers are immune to the curse. Boosts the power of Ghost-type moves by 30%, or by 50% at 1/3 HP or lower.
  CODE: OnFaintEffectAbAttr{showAbility=true,extraCondition=undefined,effect={"kind":"attacker-battler-tag","tagType":"CURSED"}} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25}

### 566 Cud Chew  [(vanilla-map)] pkrg=291
  ABBR: Eats berries again at the end of the next turn.
  FULL: When consuming a berry, the user re-consumes it at the end of the following turn.
  CODE: CudChewConsumeBerryAbAttr{showAbility=true,extraCondition=undefined} | CudChewRecordBerryAbAttr{showAbility=false,extraCondition=undefined}

### 567 Armor Tail  [(vanilla-map)] pkrg=296
  ABBR: Protects itself and ally from priority moves.
  FULL: Prevents the user and its ally from being targeted by priority moves with priority higher than 0.
  CODE: FieldPriorityMoveImmunityAbAttr{showAbility=true,extraCondition=undefined}

### 568 Mind Crunch  [bespoke] pkrg=5284
  ABBR: Biting moves use SpAtk and deal 30% more damage.
  FULL: Biting moves use the Special Attack (still targets enemy's Defense unless stated otherwise) and deal 30% more damage.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=32,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=3,specialStat=undefined,contactOnly=false,flag=32,useHigherOffense=false}

### 569 Supreme Overlord  [(vanilla-map)] pkrg=293
  ABBR: Each fainted ally increases Attack and SpAtk by 10%.
  FULL: Boosts Attack and Special Attack by 10% for each fainted ally on your side, capped at 5 allies maximum for a 50% boost to both stats. Stacks additively with other damage boosts.
  CODE: PostSummonAddBattlerTagAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,tagType="SUPREME_OVERLORD",turnCount=0}

### 570 Ill Will  [bespoke] pkrg=5285
  ABBR: Deletes the PP of the move that faints this Pokemon.
  FULL: Ill Will drains the PP of the move that defeats the user. Has to be a direct hit.
  CODE: PostDefendMoveDisableAbAttr{showAbility=true,extraCondition=undefined,chance=100}

### 571 Fire Scales  [damage-reduction-generic] pkrg=5286
  ABBR: Halves damage taken by Special moves. Does NOT double SpDef.
  FULL: Halves all incoming special attack damage. Multiplicative with other sources of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"category","category":1}}

### 572 Watch Your Step  [entry-effect] pkrg=5287
  ABBR: Spreads two layers of Spikes on switch-in.
  FULL: Spreads two layers of Spikes on switch-in.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-hazard","hazard":"SPIKES","layers":2},once=false}

### 573 Rapid Response  [bespoke] pkrg=5288
  ABBR: Boosts Speed by 50% + SpAtk by 20% on first turn.
  FULL: The user gains a 50% Speed boost and 20% Special Attack boost on their first turn after switching in.
  CODE: FirstTurnStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | FirstTurnStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.2,condition=undefined}

### 574 Sharp Edges  [bespoke] pkrg=5289
  ABBR: 1/6 HP damage when touched.
  FULL: Damages attackers using contact moves for 1/6 of their max HP. Activates on every hit for multihitting moves.
  CODE: PostDefendContactDamageAbAttr{showAbility=true,extraCondition=undefined,damageRatio=6}

### 575 Thermal Exchange  [(vanilla-map)] pkrg=270
  ABBR: Ups Attack when hit by Fire. Immune to burn.
  FULL: Boosts Attack by one stage when hit by Fire-type moves and grants immunity to burn status. The Attack boost applies immediately after taking damage from any Fire attack. Activates on each hit of a multihit move.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=1,selfTarget=true,allOthers=false} | StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[6]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[6],statusHealed=undefined}

### 576 Good As Gold  [(vanilla-map)] pkrg=283
  ABBR: Immune to all Status moves, unless whole field is affected.
  FULL: Good As Gold grants immunity to all status moves that directly target this Pokemon. Remains vulnerable to status moves that affect the entire field, such as Haze.
  CODE: MoveImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneCondition=<fn>}

### 577 Sharing Is Caring  [bespoke] pkrg=5290
  ABBR: Stat changes are shared between all battlers.
  FULL: All stat changes are shared between all battlers on the field, both positive and negative.
  CODE: FieldStatShareAbAttr{showAbility=true,extraCondition=undefined}

### 578 Tablets Of Ruin  [(vanilla-map)] pkrg=286
  ABBR: Lowers the Attack of other Pokemon by 25%.
  FULL: Reduces the Attack stat of every other Pokemon by 25% while the user is out. Multiples of the same Ruin ability do not stack together. Stacks multiplicatively with Attack drops.
  CODE: FieldMultiplyStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=0.75,canStack=false} | PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>}

### 579 Sword Of Ruin  [(vanilla-map)] pkrg=285
  ABBR: Lowers the Defense of other Pokemon by 25%.
  FULL: Reduces the Defense stat of every other Pokemon by 25% while the user is out. Multiples of the same Ruin ability do not stack together. Stacks multiplicatively with Defense drops.
  CODE: FieldMultiplyStatAbAttr{showAbility=false,extraCondition=undefined,stat=2,multiplier=0.75,canStack=false} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>}

### 580 Vessel Of Ruin  [(vanilla-map)] pkrg=284
  ABBR: Lowers the Special Attack of other Pokemon by 25%.
  FULL: Reduces the Special Attack stat of every other Pokemon by 25% while the user is out. Multiples of the same Ruin ability do not stack together. Stacks multiplicatively with Special Attack drops.
  CODE: FieldMultiplyStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=0.75,canStack=false} | PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>}

### 581 Beads Of Ruin  [(vanilla-map)] pkrg=287
  ABBR: Lowers the Special Defense of other Pokemon by 25%.
  FULL: Reduces the Special Defense stat of every other Pokemon by 25% while the user is out. Multiples of the same Ruin ability do not stack together. Stacks multiplicatively with Special Defense drops.
  CODE: FieldMultiplyStatAbAttr{showAbility=false,extraCondition=undefined,stat=4,multiplier=0.75,canStack=false} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>}

### 582 Thick Skin  [damage-reduction-generic] pkrg=5291
  ABBR: Takes 35% less damage from Super-effective moves.
  FULL: Reduces damage from super- effective attacks by 35%. Multiplicative with other sources of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65,reductionAmount=0.35,filterSpec={"kind":"super-effective"}}

### 583 Gallantry  [bespoke] pkrg=5292
  ABBR: Gets no damage for first hit.
  FULL: Negates the first instance of damage received. Moves still connect and secondary effects apply, but damage becomes 0.
  CODE: PreFaintReviveAbAttr{showAbility=true,extraCondition=undefined,gate={"kind":"hp-threshold","threshold":0},usage={"kind":"first-n-hits","n":1}}

### 584 Orichalcum Pulse  [(vanilla-map)] pkrg=288
  ABBR: Summons sun on entry. Raises Atk by 1.33x in sun.
  FULL: Sets sun on entry for 8 turns (12 with Heat Rock). While sun is active, boosts the user's Attack by 33%.
  CODE: PostSummonWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=1} | PostBiomeChangeWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,weatherType=1} | StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=1,multiplier=1.3333333333333333,condition=undefined} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 585 Sun Basking  [bespoke] pkrg=5293
  ABBR: Blocks priority and reduces physical damage by 1/2 in sun.
  FULL: Blocks priority moves and reduces physical attack damage by 50% in sun. Multiplicative with other sources of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"category-in-weather","category":0,"weather":1}}

### 586 Winged King  [bespoke] pkrg=5294
  ABBR: Ups “supereffective” by 33%.
  FULL: Super effective attacks are boosted by 33%.
  CODE: SuperEffectiveMultiplierBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.33}

### 587 Hadron Engine  [(vanilla-map)] pkrg=289
  ABBR: Field becomes Electric. +33% SpAtk in Electric Terrain.
  FULL: Sets electric terrain on entry for 8 turns (12 with Terrain Extender). While terrain is active, boosts the user's Special Attack by 33%.
  CODE: PostSummonTerrainChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,terrainType=2} | PostBiomeChangeTerrainChangeAbAttr{showAbility=true,extraCondition=undefined,terrainType=2} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=3,multiplier=1.3333333333333333,condition=undefined}

### 588 Iron Serpent  [bespoke] pkrg=5295
  ABBR: Ups “supereffective” by 33%.
  FULL: Super effective attacks are boosted by 33%.
  CODE: SuperEffectiveMultiplierBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.33}

### 589 Catastrophe  [bespoke] pkrg=5296
  ABBR: Sun boosts Water. Rain boosts Fire.
  FULL: In Sun, Water moves gain the damage boost they receive from rain. In Rain, Fire moves gain the damage boost they receive from sun.
  CODE: WeatherStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.3,condition=undefined,weathers=[1,2]}

### 590 Blademaster  [composite-vanilla-mashup] pkrg=5297
  ABBR: Sweeping Edge + Keen Edge.
  FULL: Makes all Keen Edge moves never miss and hit both opposing Pokemon in double battles. Multihit moves will only hit each target one time. Also boosts Keen Edge moves by 30%.
  CODE: ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"flag":256}} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 591 Celestial Blessing  [bespoke] pkrg=5298
  ABBR: Recovers 1/12 of its health each turn under Misty Terrain.
  FULL: Restores 1/12 of the user's maximum HP at the end of each turn while under Misty Terrain.
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.08333333333333333,conditionSpec={"kind":"terrain","terrains":[1]}}

### 592 Minion Control  [bespoke] pkrg=5299
  ABBR: Moves hit an extra time for each healthy party member.
  FULL: Moves hit an additional time for every healthy party member (max 6 hits). Members that are knocked out or have a status effect will not be counted. The first hit deals full damage while each additional hit deals 10% damage. Each hit rolls secondary effects independently.
  CODE: PartyCountMultiHitAbAttr{showAbility=true,extraCondition=undefined,maxHits=6}

### 593 Molten Blades  [chance-status-on-hit] pkrg=5300
  ABBR: Keen Edge + Keen Edge moves have a 20% chance to burn.
  FULL: Keen Edge moves are boosted by 30% and have a 20% chance to burn on hit.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=20,effects=[6],contactRequired=false,contactExcluded=false,filter={"flag":256},firstTurnChance=undefined}

### 594 Haunting Frenzy  [chance-status-on-hit] pkrg=5301
  ABBR: 20% chance to flinch the opponent. +1 speed on kill.
  FULL: Attacks have a 20% chance to flinch. Upon defeating an enemy with a direct hit, the user gains +1 Speed.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=20,tags=["FLINCHED"],contactRequired=true,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 595 Noise Cancel  [bespoke] pkrg=5302
  ABBR: Protects the party from sound-based moves.
  FULL: Prevents the user and its ally from being targeted by sound moves.
  CODE: UserFieldFlagImmunityAbAttr{showAbility=true,extraCondition=undefined,opts={"flag":4}}

### 596 Radio Jam  [chance-status-on-hit] pkrg=5303
  ABBR: Sound-based moves have a 20% chance to inflict disable.
  FULL: 20% chance to disable the last move used by the target after landing a sound move. Lasts 4 turns.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=20,tags=["DISABLED"],contactRequired=false,turns=undefined,filter={"flag":4},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 597 Olé!  [bespoke] pkrg=5304
  ABBR: 20% chance to evade single-target moves.
  FULL: Reduces the accuracy of all single-target moves aimed at the user by 20%. Spread moves such as Heat Wave retain normal accuracy.
  CODE: ChanceDodgeAbAttr{showAbility=true,extraCondition=undefined,chance=20,singleTargetOnly=true}

### 598 Malicious  [bespoke] pkrg=5305
  ABBR: Lowers the foe's highest Attack and Defense stat.
  FULL: On switch-in, lowers all opposing Pokemon's highest offensive stat (Attack or Special Attack) and highest defensive stat (Defense or Special Defense) by 1 stage each.
  CODE: TargetHighestStatDropAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,rules=[{"candidates":[1,3],"stages":-1},{"candidates":[2,4],"stages":-1}]}

### 599 Dead Power  [bespoke] pkrg=5306
  ABBR: 1.5x Attack boost. 20% chance to curse on contact moves.
  FULL: Boosts the user's Attack stat by 50% and 20% chance to inflict curse on contact moves. Curse inflicts 25% max HP damage per turn until the cursed Pokemon switches out or faints. The Attack boost is multiplicative with other damage boosts.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1.5,condition=undefined} | ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=20,tags=["CURSED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 600 Brawling Wyvern  [composite-vanilla-mashup] pkrg=5307
  ABBR: No guard + Dragon type moves become punching moves.
  FULL: Guarantees hits for all moves used by and against the user. Dragon-type moves are treated as punching moves.
  CODE: AlwaysHitAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | DoubleBattleChanceAbAttr{showAbility=false,extraCondition=undefined} | AddMoveFlagAbAttr{showAbility=false,extraCondition=undefined,filter=<fn>,grantedFlags=[128]}

### 601 Mythical Arrows  [bespoke] pkrg=5308
  ABBR: Arrow moves become special and deal 30% more damage.
  FULL: Arrow moves moves become Special (deal Special damage and use the Special Attack stat) and deal 30% more damage.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=2097152,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=3,specialStat=undefined,contactOnly=false,flag=2097152,useHigherOffense=false}

### 602 Lawnmower  [bespoke] pkrg=5309
  ABBR: Removes terrain on switch-in. Stat up if terrain removed.
  FULL: On switch-in, removes any active terrain and gains a stat boost: Defense +1 when removing Grassy or Electric Terrain, Special Defense +1 when removing Misty, Psychic, or Toxic Terrain.
  CODE: PostSummonClearTerrainAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,onCleared=[],byTerrain=[{"terrain":3,"stat":2,"stages":1},{"terrain":2,"stat":2,"stages":1},{"terrain":1,"stat":4,"stages":1},{"terrain":4,"stat":4,"stages":1},{"terrain":5,"stat":4,"stages":1}]}

### 603 Flourish  [bespoke] pkrg=5310
  ABBR: Boosts Grass moves by 50% in grassy terrain.
  FULL: Boosts Grass-type moves by 50% when Grassy Terrain is active.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 604 Desert Spirit  [bespoke] pkrg=5311
  ABBR: Summons sand on entry. Ground moves hit airborne in sand.
  FULL: Summons sandstorm on entry, lasting 8 turns (12 with Smooth Stone). During sandstorm, the user's Ground-type moves bypass immunity and hit airborne Pokemon with normal effectiveness. The user is immune to sandstorm damage.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-weather","weather":3,"turns":8},once=false} | WeatherGroundAirborneAbAttr{showAbility=false,extraCondition=undefined,weathers=[3]}

### 605 Contempt  [composite-vanilla-mashup] pkrg=5312
  ABBR: Unaware + Defiant.
  FULL: Ignores all the foes' stat stage changes during damage calculations. When the user has their stats lowered by another Pokemon, they raise their Attack by 2 stages.
  CODE: IgnoreOpponentStatStagesAbAttr{showAbility=false,extraCondition=undefined,stats=[1,2,3,4,6,7]} | PostStatStageChangeStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,statsToChange=[1],stages=2}

### 606 Aerialist  [composite-vanilla-mashup] pkrg=5313
  ABBR: Levitate + Flock.
  FULL: The user is immune to Ground- type moves and other ground effects such as Spikes and terrains. Boosts the damage of Flying-type moves by 25%. Additionally, boosts the power of Flying-type moves by another 20%, or by 50% at 1/3 HP or lower.
  CODE: AttackTypeImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneType=4,condition=<fn>} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=2,highHpMultiplier=1.2,lowHpMultiplier=1.5,lowHpThreshold=0.3333333333333333,weathers=null}

### 607 Tera Shell  [(vanilla-map)] pkrg=308
  ABBR: All hits will be not very effective while at full HP.
  FULL: At full HP, all attacks towards the user deal not very effective damage regardless of type effectiveness. Activates on each hit of a multihit attack unlike other similar abilities.
  CODE: FullHpResistTypeAbAttr{showAbility=true,extraCondition=undefined}

### 608 Toxic Chain  [(vanilla-map)] pkrg=302
  ABBR: Moves have a 30% chance to badly poison the foe.
  FULL: The user has a 30% to badly poison the target after landing any move. Multihits roll the activation chance on each hit.
  CODE: PostAttackApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=30,effects=[2]}

### 609 Parasitic Spores  [bespoke] pkrg=5314
  ABBR: Deals 1/8 HP damage to non-Ghost. Spreads on contact.
  FULL: Gain parasitic spores on entry. Each turn, affected Pokemon lose 1/8 max HP (Ghost types immune). When using contact moves, spread spores to the target. Spores persist until switch-out.
  CODE: PostTurnHurtNonTypedAbAttr{showAbility=true,extraCondition=undefined,safeTypes=[7],damageFraction=0.125,requiredWeathers=null}

### 610 Poison Puppeteer  [(vanilla-map)] pkrg=310
  ABBR: Poison also inflicts confusion.
  FULL: When the user applies poison, they also apply confusion. Does not activate from Toxic Spikes.
  CODE: ConfusionOnStatusEffectAbAttr{showAbility=true,extraCondition=undefined,effects={}}

### 611 Entrance  [bespoke] pkrg=5315
  ABBR: Confusion also inflicts infatuation.
  FULL: When the user confuses an opponent, it also infatuates them (cuts their Attack and Special Attack in half) if they are the opposite gender.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["INFATUATED"],contactRequired=false,turns=undefined,filter=undefined,targetHasTag="CONFUSED",targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 612 Rejection  [bespoke] pkrg=5316
  ABBR: Applies Quash on switch-in.
  FULL: Casts Quash on entry. Quash nullifies most Speed altering effects, including Tailwind, Trick Room, positive priority, Speed stat raises, etc. Negative priority works as normal. Lasts 5 turns.
  CODE: PostSummonQuashFoesAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stages=-6}

### 613 Apple Enlightenment  [composite-vanilla-mashup] pkrg=5317
  ABBR: Fur coat + Magic Guard.
  FULL: Halves all incoming physical attack damage. Multiplicative with other sources of damage reduction. Also grants immunity to all non-attack damage sources including entry hazards, weather damage, status conditions, and recoil.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | BlockNonDirectDamageAbAttr{showAbility=false,extraCondition=undefined}

### 614 Balloon Bomb  [composite-vanilla-mashup] pkrg=5318
  ABBR: Aftermath + Inflatable
  FULL: Uses a 100 BP Explosion or Outburst (whichever is higher) when knocked out. Using explosion moves will always Flinch the target. When hit by any Fire or Flying moves, boost Defense and Special Defense by one stage each. Activates on each hit of a multihit move. Boost applies after the hit lands.
  CODE: PostFaintDetonateAbAttr{showAbility=true,extraCondition=undefined,power=100,flinch=true,type=0} | StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":2,"stages":1},{"stat":4,"stages":1}],filter={"types":[2,9]}}

### 615 Flaming Maw  [composite-vanilla-mashup] pkrg=5319
  ABBR: Strong Jaw + Flaming Jaws
  FULL: Biting moves moves are boosted by 30% and have a 50% chance to burn the target on hit. Multihits roll the activation chance on each hit.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=50,effects=[6],contactRequired=false,contactExcluded=false,filter={"flag":32},firstTurnChance=undefined}

### 616 Demolitionist  [bespoke] pkrg=5320
  ABBR: Readied Action + Ignores Protect + screens break on readied turn
  FULL: Increases the user's Attack stat by 2x, breaks screens, and ignores Protection effects for one turn. Multiplicative with other damage boosts. Reapplies after switching in.
  CODE: FirstTurnStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=2,condition=undefined} | IgnoreProtectOnContactAbAttr{showAbility=true,extraCondition=undefined}

### 617 Rockhard Will  [type-damage-boost] pkrg=5321
  ABBR: Boosts Rock-type moves by 1.2x, or 1.5x when under 1/3 HP.
  FULL: Boosts the power of Rock-type moves by 20%, or by 50% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=5,highHpMultiplier=1.2,lowHpMultiplier=1.5,lowHpThreshold=0.3333333333333333,weathers=null}

### 618 Fragrant Daze  [chance-status-on-hit] pkrg=5322
  ABBR: 30% chance to confuse on contact.
  FULL: 30% chance to inflict confusion on contact moves, both when attacking and being attacked.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=30,tags=["CONFUSED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 619 Low Visibility  [bespoke] pkrg=5323
  ABBR: Summons Eerie Fog on entry.
  FULL: Summons Eerie Fog upon entry, lasting 8 turns (12 with Smoke Ball). Fog reduces stat buffs from non-Ghost/Psychic-types by 1 each turn, halves weather- based recovery, grants Ghost/Psychic-types +20% damage reduction from moves, and turns all Curses into the Ghost- type Curse.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-weather","weather":6,"turns":8},once=false}

### 620 Old Mariner  [composite-vanilla-mashup] pkrg=5324
  ABBR: Seaweed + Water STAB.
  FULL: If user is Grass-type, they take half damage from Fire-type attacks and deals 2x damage to Fire-type Pokemon with Grass- type moves. Multiplicative with other sources of damage reduction. Grants STAB to Water- type moves regardless of the user's typing. Also provides immunity to being drenched.
  CODE: OffensiveTypeMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2,targetDefenderType=9,multiplier=2} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=10,multiplier=1.5}

### 621 Ectoplasm  [bespoke] pkrg=5325
  ABBR: Ups highest attacking stat by 1.5x in fog.
  FULL: Boosts the Pokemon's highest attacking stat by 50% during fog.
  CODE: SelfHighestStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1.5,condition=undefined,candidates=[1,3],mult=1.5,weathers=[6]}

### 622 Beautiful Music  [chance-status-on-hit] pkrg=5326
  ABBR: Sound moves have 50% chance to infatuate, ignoring gender.
  FULL: Sound moves gain 50% chance to infatuate targets on hit (cuts their Attack and Special Attack in half).
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=50,tags=["INFATUATED"],contactRequired=false,turns=undefined,filter={"flag":4},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 623 Surprise!  [bespoke] pkrg=5327
  ABBR: Astonishes enemy priority users in fog.
  FULL: In fog, counters priority moves with Astonish, a 40 BP Ghost- type attack with +3 priority and always flinches. This ability will activate before the opponent's priority move comes out.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=100,tags=["FLINCHED"],contactRequired=false,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 624 Snow Song  [type-conversion] pkrg=5328
  ABBR: Sound moves get a 1.2x boost and become Ice if Normal.
  FULL: Boosts the power of all sound- based moves by 20% and converts Normal-type sound moves to Ice- type.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=14,condition=<fn>,source={"kind":"flag","flag":4,"requireType":0},configuredNewType=14} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"flag","flag":4,"requireType":0},multiplier=1.2}

### 625 Greater Spirit  [bespoke] pkrg=5329
  ABBR: Ups highest stat by +1 on entry in fog.
  FULL: When entering battle during fog, boosts the user's highest stat by one stage.
  CODE: SelfHighestStatBoostOnSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,candidates=[1,2,3,4,5],stages=1,weathers=[6],terrains=undefined}

### 626 Resonance  [chance-status-on-hit] pkrg=5330
  ABBR: Sound moves have a 30% chance to cause bleeding.
  FULL: Sound moves have a 50% chance to inflict bleeding on the target when landing a hit. Bleeding causes 1/16 max HP damage per turn, prevents healing, and negates the effects of stat stages. Rock and Ghost types are immune to bleeding.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["ER_BLEED"],contactRequired=false,turns=undefined,filter={"flag":4},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 627 Ethereal Rush  [bespoke] pkrg=5331
  ABBR: This Pokémon's Speed gets a 1.5x boost in fog.
  FULL: Boosts the Pokemon's Speed stat by 50% during fog.
  CODE: WeatherStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined,weathers=[6]}

### 628 Pretty Privilege  [priority-modifier] pkrg=5332
  ABBR: At full HP, gives +1 priority to its Fairy-type moves.
  FULL: Grants +1 priority to Fairy-type moves when at full HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"type":17},condition={"kind":"full-hp"}}

### 629 Shallow Grave  [bespoke] pkrg=5333
  ABBR: Revives at 25% HP once after fainting in fog.
  FULL: After fainting while fog is active, the user revives at 25% max Hp when sending out your next party member. This still activates when the user faints on the last turn of fog being active.
  CODE: PostFaintReviveAbAttr{showAbility=true,extraCondition=undefined,hpFraction=0.25,requireTerrain=null,requireWeather=[6]}

### 630 Menacing Situation  [chance-status-on-hit] pkrg=5334
  ABBR: 30% chance to Fear on contact. Also works on offense.
  FULL: Has a 30% chance to inflict Fear on contact moves, both when attacking and being attacked. Fear traps the target for 2 turns and they take 50% more damage. If forced out by moves like Whirlwind, the target loses Fear.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=30,tags=["ER_FEAR"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["ER_FEAR"],contactRequired=true,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 631 Shiny Lightning  [bespoke] pkrg=5335
  ABBR: Grants a 1.2x accuracy boost. Thunder never misses.
  FULL: Boosts the user's accuracy by 1.2x, and Thunder never misses.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=undefined} | ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"moveIds":[87]}}

### 632 Terrify  [bespoke] pkrg=5336
  ABBR: Lowers foes' Sp. Atk by two stages on entry.
  FULL: Upon entering battle, the user drops the Special Attack stat of all opposing Pokemon by two stages.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[3],stages=-2,selfTarget=false,intimidate=true}

### 633 Ice Downfall  [bespoke] pkrg=5337
  ABBR: Counters contact with 60BP Icicle Crash.
  FULL: When hit by a contact move, the user retaliates with Icicle Crash at 60 base power. Icicle Crash has a 20% chance to flinch.
  CODE: CounterAttackOnHitAbAttr{showAbility=false,extraCondition=undefined,moveId=556,power=60,chance=100,filter={"contactRequired":true}}

### 634 Last Stand  [bespoke] pkrg=5338
  ABBR: Def and SpDef increase as HP drops. Max 1.6x.
  FULL: Defense and Special Defense increase linearly as HP decreases. Multiplier scales from 1.0x at full HP to 1.6x at 0% HP. At 50% HP provides 1.3x boost, at 25% HP provides 1.45x boost.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=2,multiplier=1.6,condition=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=4,multiplier=1.6,condition=<fn>}

### 635 Pyroclastic Flow  [composite-vanilla-mashup] pkrg=5339
  ABBR: Molten Down + Corrosion.
  FULL: Makes Fire-type moves super effective against Rock-types instead of resisted. Poison-type moves become super effective against Steel-type Pokemon. Additionally, this Pokemon can inflict poison status on any type.
  CODE: OffensiveTypeChartOverrideAbAttr{showAbility=false,extraCondition=undefined,rules=[{"attackType":9,"defenderType":5,"newMultiplier":2}]} | IgnoreTypeStatusEffectImmunityAbAttr{showAbility=false,extraCondition=undefined,statusEffect=[1,2],defenderType=[8,3]}

### 636 Blood Bath  [bespoke] pkrg=5340
  ABBR: Immune to bleed. Inflict fear when inflicting bleed.
  FULL: Immunity to the bleeding. When this Pokemon successfully inflicts bleeding on an opponent, it also gains Fear. Fear traps the target for 2 turns and they take 50% more damage. If forced out by moves like Whirlwind, the target loses Fear.
  CODE: BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["ER_BLEED"]} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["ER_FEAR"],contactRequired=false,turns=undefined,filter=undefined,targetHasTag="ER_BLEED",targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 637 Battle Aura  [bespoke] pkrg=5341
  ABBR: Boosts each battler's crit rate by +2.
  FULL: Increases each Pokemon's critical hit stage by +2. Includes both allies and opponents.
  CODE: FieldCritBoostAbAttr{showAbility=false,extraCondition=undefined,bonus=2}

### 638 Bloodlust  [composite-vanilla-mashup] pkrg=5342
  ABBR: Blood Bath + Soul Eater.
  FULL: Immunity to the bleeding. When this Pokemon successfully inflicts bleeding on an opponent, it also gains Fear. Fear traps the target for 2 turns and they take 50% more damage. If forced out by moves like Whirlwind, the target loses Fear. Also recovers 25% of max HP when scoring a direct KO.
  CODE: BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["ER_BLEED"]} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["ER_FEAR"],contactRequired=false,turns=undefined,filter=undefined,targetHasTag="ER_BLEED",targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined} | LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25}

### 639 Piercing Solo  [bespoke] pkrg=5343
  ABBR: Sound moves cause bleeding.
  FULL: When landing a sound move, the user inflicts bleeding. Bleeding causes 1/16 max HP damage per turn, prevents healing, and negates the effects of stat stages. Rock and Ghost types are immune to bleeding.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["ER_BLEED"],contactRequired=false,turns=undefined,filter={"flag":4},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 640 Rhythmic  [bespoke] pkrg=5344
  ABBR: Deals 10% more damage for each repeated move use.
  FULL: Each consecutive use of the same move increases damage by 10%. No maximum cap. Resets when switching moves or when moves fail.
  CODE: RepeatMovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1,bonus=0.1,cap=2}

### 641 Chunky Bass Line  [bespoke] pkrg=5345
  ABBR: Triggers a 40BP Earthquake after using a sound move.
  FULL: After landing any sound move, the user follows up with a 40 BP Earthquake that hits all adjacent Pokemon.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":89,"power":40,"flagFilter":4}}

### 642 Jackhammer  [multi-hit-override] pkrg=5346
  ABBR: Super Slammer moves hit twice for 70% damage.
  FULL: Hammer moves to hit twice, with each hit dealing 70% of the move's normal damage. Secondary effects roll independently for each hit (except flinch).
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={}}

### 643 Denting Blows  [bespoke] pkrg=5347
  ABBR: Hammer moves lower Defense.
  FULL: Lowers the target's Defense by one stage when hitting with Hammer attacks. Each target can only be affected once per turn. The Defense drop occurs after damage.
  CODE: StatDebuffOnFlagAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,flag=33554432,stat=2,stages=-1}

### 644 Ice Cold Hunter  [multi-hit-override] pkrg=5348
  ABBR: Ice-type moves hit twice in hail.
  FULL: Ice-type moves hit twice in hail for full damage on both hits. User is immune to hail damage. Both hits apply secondary effects independently (except flinch).
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={}}

### 645 Soul Crusher  [bespoke] pkrg=5349
  ABBR: Hammer moves hit SpDef and get a 1.1x power boost.
  FULL: Hammer moves gain a 10% damage boost and target Special Defense instead of Defense.
  CODE: DefenseStatSwapOnFlagAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1,opts={"flag":33554432,"swap":"target-spdef-instead-of-def"}}

### 646 Arc Flash  [chance-status-on-hit] pkrg=5350
  ABBR: 50% chance to burn when hit or paralyze when dealing damage.
  FULL: When the user attacks, it has a 50% chance to paralyze the target upon contact. When receiving damage, it has a 50% chance to burn the attacker.
  CODE: ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=50,effects=[6],contactRequired=false,contactExcluded=false,filter=undefined,firstTurnChance=undefined}

### 647 Unicorn  [composite-vanilla-mashup] pkrg=5351
  ABBR: Mighty Horn + Pixilate.
  FULL: Boosts the power of horn and drill-based attacks by 30%. Converts Normal-type moves to Fairy-type and Fairy STAB. If the user is Fairy-type its Fairy moves have a 10% infatuate chance.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=67108864,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=17,condition=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=17,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 648 On the Prowl  [bespoke] pkrg=5352
  ABBR: +1 priority for the first turn. Negative priority becomes +0.
  FULL: All moves with priority 0 or higher gain +1 priority on the user's first turn. Negative priority moves become priority 0 instead of adding +1 priority.
  CODE: ChangeMovePriorityAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1}

### 649 Pretentious  [bespoke] pkrg=5353
  ABBR: Dealing a KO raises Crit by one stage.
  FULL: Boosts the user's critical hit ratio by one stage whenever it knocks out an opponent with a direct hit.
  CODE: CritStackOnKoAbAttr{showAbility=true,extraCondition=undefined,perKo=1,cap=6}

### 650 Venoblaze Pincers  [chance-status-on-hit] pkrg=5354
  ABBR: 1.2x boost to physical moves and 20% chance to Burn or Poison.
  FULL: Boosts all physical moves by 20% damage and they have a 20% chance to either inflict Burn or Poison on contact.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=20,effects=[6],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined}

### 651 Eternal Blessing  [composite-vanilla-mashup] pkrg=5355
  ABBR: Celestial Blessing + Regenerator.
  FULL: Restores 1/12 of the user's maximum HP at the end of each turn while under Misty Terrain. Also restores 33% of maximum HP when switching out. This heal is not blocked by Heal Block.
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.08333333333333333,conditionSpec={"kind":"terrain","terrains":[1]}} | PreSwitchOutHealAbAttr{showAbility=false,extraCondition=undefined}

### 652 Sugar Rush  [composite-vanilla-mashup] pkrg=5356
  ABBR: Unburden + Ripen
  FULL: When consuming or losing a held item, the user's base Speed stat is multiplied by x2. Boost goes away when switching out, gaining a new item, or upon losing the ability. Doubles all beneficial berry effects.
  CODE: PostItemLostApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,tagType="UNBURDEN"} | DoubleBerryEffectAbAttr{showAbility=true,extraCondition=undefined}

### 653 Rest in Peace  [bespoke] pkrg=5357
  ABBR: Heals 1/8 of max HP every turn in fog.
  FULL: Restores 1/8 of the user's maximum HP at the end of each turn while in fog.
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.125,conditionSpec={"kind":"weather","weathers":[6]}}

### 654 White Noise  [composite-vanilla-mashup] pkrg=5358
  ABBR: Static + Rest in Peace.
  FULL: Has a chance to paralyze when attacking or when hit by a move. Has a 10% chance to paralyze on non-contact attacks and a 30% chance to paralyze on contact attacks. Restores 1/8 of the user's maximum HP at the end of each turn while in fog.
  CODE: PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[3]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[3],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.125,conditionSpec={"kind":"weather","weathers":[6]}}

### 655 Smokey Maneuvers  [bespoke] pkrg=5359
  ABBR: Evasion is boosted by 1.25x in fog.
  FULL: Fog reduces incoming move accuracy targeting the user by 25%.
  CODE: WeatherStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=7,multiplier=1.25,condition=undefined,weathers=[6]}

### 656 Tag  [bespoke] pkrg=5360
  ABBR: Attacks switching opponents with a 20BP Pursuit.
  FULL: When an enemy attempts to switch out, automatically trigger a 20 BP Pursuit to prevent them from leaving.
  CODE: OnOpponentSwitchOutAbAttr{showAbility=false,extraCondition=undefined,opts={"moveId":228}}

### 657 Power Metal  [type-conversion] pkrg=5361
  ABBR: Sound moves get a 1.2x boost and become Steel if Normal.
  FULL: Boosts the power of all sound- based moves by 20% and converts Normal-type sound moves to Steel-type.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=8,condition=<fn>,source={"kind":"flag","flag":4,"requireType":0},configuredNewType=8} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"flag","flag":4,"requireType":0},multiplier=1.2}

### 658 Power Edge  [bespoke] pkrg=5362
  ABBR: Keen Edge moves target Special Defense and get a 1.3x boost.
  FULL: Keen Edge moves gain a 30% damage boost and target Special Defense instead of Defense.
  CODE: DefenseStatSwapOnFlagAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1,opts={"flag":256,"swap":"target-spdef-instead-of-def"}} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 659 Superconductor  [type-conversion] pkrg=5363
  ABBR: Steel-type moves become Electric and get a 1.1x boost.
  FULL: All Steel-type moves become Electric-type instead and receive a 10% power boost.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=12,condition=<fn>,source={"kind":"type","type":8},configuredNewType=12} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.1,source={"kind":"type","type":8},multiplier=1.1}

### 660 Ultra Instinct  [bespoke] pkrg=5364
  ABBR: Counters contact with 20BP Vacuum Wave. Takes .8x damage.
  FULL: Reduces all damage by 20%. Multiplicative with other damage reduction sources. Counters contact moves with Vacuum Wave at 20 BP.
  CODE: CounterAttackOnHitAbAttr{showAbility=false,extraCondition=undefined,moveId=410,power=20,chance=100,filter={"contactRequired":true}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8,reductionAmount=0.2,filterSpec={"kind":"all"}}

### 661 Unlocked Potential  [composite-vanilla-mashup] pkrg=5365
  ABBR: Inner Focus + Berserk.
  FULL: Focus Blast never misses. Unaffected by flinch, Intimidate, or Scare. When the user drops to half HP or below from an opposing attack, boosting its highest attacking stat by one stage. Triggers only once per battle. Other damage sources that bring you to half HP or below will not activate it.
  CODE: BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["FLINCHED","ER_FEAR"]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined} | PostDefendHpGatedStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,hpGate=0.5,stats=[3],stages=1,selfTarget=true} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=1,selfTarget=true,allOthers=false}

### 662 Higher Rank  [bespoke] pkrg=5366
  ABBR: Priority moves get a 1.2x boost.
  FULL: Moves with increased priority (+1 or higher) receive a 20% damage boost.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 663 Funeral Pyre  [bespoke] pkrg=5367
  ABBR: Non-Ghost and Dark-types take 1/4 damage every turn.
  FULL: Non-Ghost and Dark-types take 1/4 damage every turn.
  CODE: PostTurnHurtNonTypedAbAttr{showAbility=true,extraCondition=undefined,safeTypes=[7,16],damageFraction=0.25,requiredWeathers=null}

### 664 Flame Bubble  [composite-vanilla-mashup] pkrg=5368
  ABBR: Water Bubble + Flaming Soul.
  FULL: Water Bubble + Flaming Soul.
  CODE: ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2} | StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[6]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[6],statusHealed=undefined} | PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"type":9},condition={"kind":"full-hp"}}

### 665 Elemental Vortex  [composite-vanilla-mashup] pkrg=5369
  ABBR: Flash Fire + Water Absorb.
  FULL: Immune to Fire and Water-type moves. When hit by a Fire move, boosts the power of those moves my 50% until switching out. When hit by a Water move, restores 25% of the user's max HP.
  CODE: TypeImmunityAddBattlerTagAbAttr{showAbility=true,extraCondition=undefined,immuneType=9,condition=null,tagType="FIRE_BOOST",turnCount=1} | TypeImmunityHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=10,condition=null}

### 666 Snowy Wrath  [composite-vanilla-mashup] pkrg=5370
  ABBR: Snow Warning + Cryomancy.
  FULL: Summons hail for 8 turns (12 with Icy Rock) when entering battle. Hail damages non-Ice types by 1/16 HP per turn and boosts the Defense stat of Ice-types on the field by 50%. Multiplies the chance of inflicting frostbite by 5x on all moves. Does not interact with Freezing Point.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=4,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=4,erTurns=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | StatusChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,status=5}

### 667 Pattern Change  [composite-vanilla-mashup] pkrg=5371
  ABBR: Protean + Shed Skin
  FULL: Before each attack, the user overrides their type to match their move's type. At the end of each turn, there's a 30% chance for the user to cure status conditions afflicted on them.
  CODE: PokemonTypeChangeAbAttr{showAbility=true,extraCondition=undefined,moveType=-1} | PostTurnResetStatusAbAttr{showAbility=true,extraCondition=<fn>,allyTarget=false,target=undefined}

### 668 No Turning Back  [bespoke] pkrg=5372
  ABBR: Boosts all stats but can't retreat when below 1/2 max HP.
  FULL: When HP drops to half or below for the first time, all stats increase by one stage and the user becomes unable to switch out or flee. Normal ways to bypass this effects such as Eject Button or Shed Shell still allow switching out.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1.2,condition=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=2,multiplier=1.2,condition=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.2,condition=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=4,multiplier=1.2,condition=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.2,condition=<fn>}

### 669 Flammable Coat  [bespoke] pkrg=5373
  ABBR: Changes forms when using or hit by a Fire-type move.
  FULL: Transforms Lumbering Sloth into its Engulfed form when hit by Fire-type moves or when using Fire-type moves. Cannot be copied or suppressed.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":9}}

### 670 Draco Morale  [bespoke] pkrg=5374
  ABBR: Uses Dragon Cheer on switch-in.
  FULL: Upon entering battle, automatically uses Dragon Cheer, boosting critical hit rate by one stage for you and your ally. Dragon-type Pokemon receive two stages instead.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":913}}

### 671 Bad Omen  [bespoke] pkrg=5375
  ABBR: Foes min roll. Takes 1/4 damage from crits.
  FULL: Opponents deal minimum damage rolls when attacking, forcing 85% damage instead of 85-100% variance. Critical hits against this Pokemon deal only 25% of their normal damage instead of 150-200%.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.25,reductionAmount=0.75,filterSpec={"kind":"crit"}}

### 672 Mosh Pit  [bespoke] pkrg=5376
  ABBR: Ally's attacks get a 1.25x boost. 1.5x if attack causes recoil.
  FULL: Boosts ally attacks by 25%, or by 50% if it is a recoil move. The user receives no boost.
  CODE: AllyAttackPowerBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,powerMultiplier=1.25,baseMultiplier=1.25,recoilMultiplier=1.5}

### 673 Blood Stain  [bespoke] pkrg=5377
  ABBR: Is always bleeding if not immune. Spreads on contact.
  FULL: Pokemon with this ability gain an unremovable bleed status condition. When the user makes contact offensively or defensively with another Pokemon who does not have this ability, it replaces their current ability and causes bleeding.
  CODE: PostSummonAddBattlerTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,tagType="ER_BLEED",turnCount=99} | SelfPersistentBleedAbAttr{showAbility=true,extraCondition=undefined} | ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=100,tags=["ER_BLEED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["ER_BLEED"],contactRequired=true,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 674 Blood Stigma  [bespoke] pkrg=5378
  ABBR: Immune to status. Gets a 2x boost vs bleeding foes.
  FULL: Deal double damage to targets inflicted with bleeding and the user is immune to status effects.
  CODE: StatusEffectImmunityAbAttrEr{showAbility=true,extraCondition=undefined,immuneEffects=[],configuredStatuses=[]} | ConditionalDamageAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2,damageCondition={"kind":"target-has-tag","tag":"ER_BLEED"},damageMultiplier=2}

### 675 Max Acceleration  [composite-vanilla-mashup] pkrg=5379
  ABBR: Speed Boost + Slipstream.
  FULL: User's Speed increases by one stage at end of each full turn they remain on the field. Doesn't activate on the turn the user is switched in. Adds 20% of the user's Speed stat to damage when using attacks. Choice Scarf does not affect this ability.
  CODE: SpeedBoostAbAttr{showAbility=true,extraCondition=undefined} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={},sourceStat=5} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,bonusStat=3,speedFraction=0.2,bonusFilter={},sourceStat=5}

### 676 Sidewinder  [bespoke] pkrg=5380
  ABBR: First biting move each entry gets +1 priority. Resets on KO.
  FULL: On entry, gives +1 priority to the first biting move used. Priority boost is consumed after landing any biting move. Upon scoring a direct KO, regains priority buff.
  CODE: ChangeMovePriorityAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1}

### 677 Petrify  [bespoke] pkrg=5381
  ABBR: Clears stat buffs then lowers speed by one stage on entry.
  FULL: Removes stat raises from opposing Pokemon, then drops their Speed by 1 stage.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":114}} | PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[5],stages=-1,selfTarget=false,intimidate=true}

### 678 Fluffiest  [damage-reduction-generic] pkrg=5382
  ABBR: Quarters contact damage taken. 4x weak to fire.
  FULL: Reduces damage from contact moves by 75%. Fire-type moves to deal x4 damage to the user. Multiplicative with other forms of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.25,reductionAmount=0.75,filterSpec={"kind":"contact"}}

### 679 Way of Precision  [composite-vanilla-mashup] pkrg=5383
  ABBR: Inner Focus + Precise Fist.
  FULL: Focus Blast never misses. Unaffected by flinch, Intimidate, or Scare. Punching moves gain +1 critical hit stage and 5x their normal secondary effect chance.
  CODE: BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["FLINCHED","ER_FEAR"]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined} | CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"flag":128}} | EffectChanceModifierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,configuredMultiplier=5,flag=128}

### 680 Way of Swiftness  [composite-vanilla-mashup] pkrg=5384
  ABBR: Pretentious + Swift Swim.
  FULL: Boosts the user's critical hit ratio by one stage whenever it knocks out an opponent with a direct hit. Boosts the Pokemon's Speed by 50% during rain.
  CODE: CritStackOnKoAbAttr{showAbility=true,extraCondition=undefined,perKo=1,cap=6} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined}

### 681 Atomic Punch  [composite-vanilla-mashup] pkrg=5385
  ABBR: Iron Fist + 30% Steel type damage.
  FULL: Iron Fist + 30% Steel type damage.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=8,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 682 Iron Giant  [composite-vanilla-mashup] pkrg=5386
  ABBR: Heatproof + Juggernaut.
  FULL: Halves damage from Fire-type moves. Immune to burn damage and Attack drops from burn status. Boosts contact moves by adding 20% of the user's Defense stat to attack calculations. Prevents paralysis and immediately cures the status if inflicted on the user.
  CODE: ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReduceBurnDamageAbAttr{showAbility=false,extraCondition=undefined,multiplier=0.5} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={"contact":"only"},sourceStat=2} | StatusEffectImmunityAbAttrEr{showAbility=true,extraCondition=undefined,immuneEffects=[3],configuredStatuses=[3]}

### 683 Master Hand  [composite-vanilla-mashup] pkrg=5387
  ABBR: Mega Launcher + Rampage.
  FULL: Boosts pulse, beam, ball, and aura moves by 30%. Eliminates recharge turns when the user successfully KOs an opponent with a direct attack.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | PostVictoryClearTagAbAttr{showAbility=true,extraCondition=undefined,tags=["RECHARGING"]}

### 684 Final Blow  [composite-vanilla-mashup] pkrg=5388
  ABBR: Unseen Fist + Fatal Precision.
  FULL: Allows all contact moves to bypass protection moves and ignore any secondary effects associated with them. Super- effective damaging moves never miss and always land critical hits.
  CODE: IgnoreProtectOnContactAbAttr{showAbility=true,extraCondition=undefined} | ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"superEffective":true}} | ConditionalCritAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>}

### 685 Hospitality  [(vanilla-map)] pkrg=301
  ABBR: Heals partner for 25% of its max HP on switch-in.
  FULL: When this Pokemon switches into battle, it heals its ally for 25% of their max HP.
  CODE: PostSummonAllyHealAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,healRatio=4,showAnim=true}

### 686 Butter Up  [composite-vanilla-mashup] pkrg=5389
  ABBR: Hospitality + Soothing Aroma
  FULL: On entry, heals all status conditions from every Pokemon in the user's party, including both active and benched Pokemon; and heals its ally for 25% of their max HP.
  CODE: PostSummonAllyHealAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,healRatio=4,showAnim=true} | PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":215}}

### 687 Vitality Strike  [bespoke] pkrg=5390
  ABBR: Heals for 10% of the damage dealt by punching moves.
  FULL: When dealing damage with punching moves, recover HP equal to 10% of damage dealt.
  CODE: LifestealOnHitAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,hitHealFraction=0.1,hitFilter={"flag":128}}

### 688 Imposing Wings  [composite-vanilla-mashup] pkrg=5391
  ABBR: Giant Wings + Levitate.
  FULL: Boosts the power of all wing, wind, and air-based moves by 30%. The user is immune to Ground- type moves and other ground effects such as Spikes or terrains, and boosts the power of Flying-type moves by 25%.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=1048576,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackTypeImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneType=4,condition=<fn>} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25}

### 689 Sword of Damnation  [composite-vanilla-mashup] pkrg=5392
  ABBR: Unaware + Sword of Ruin.
  FULL: Reduces the Defense stat of every other Pokemon by 25% while the user is out. Multiples of the same Ruin ability do not stack together. Ignores all the foes' stat stage changes during damage calculations.
  CODE: IgnoreOpponentStatStagesAbAttr{showAbility=false,extraCondition=undefined,stats=[1,2,3,4,6,7]} | FieldMultiplyStatAbAttr{showAbility=false,extraCondition=undefined,stat=2,multiplier=0.75,canStack=false} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>}

### 690 Restraining Order  [bespoke] pkrg=5393
  ABBR: Forces the attacker out when hit, once each switch-in.
  FULL: When the user is hit by a contact move, they force the attacker to switch out to a random ally. Once per switch in.
  CODE: PostDamageForceSwitchAbAttr{showAbility=true,extraCondition=undefined,helper={"switchType":1},hpRatio=1}

### 691 Assassin's Tools  [bespoke] pkrg=5394
  ABBR: Contact moves have a 30% chance to PSN, PRLZ, or BLD.
  FULL: When the user lands contact moves, there's a 30% chance of inflicting poison, paralysis, or bleeding on the target, chosen randomly. Multihits roll the activation chance on each hit.
  CODE: PostAttackApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[1,3]} | PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=<fn>,effects=["ER_BLEED"]}

### 692 Frostmaw  [bespoke] pkrg=5395
  ABBR: Biting moves have a 50% chance to inflict frostbite.
  FULL: Biting moves a 50% chance to burn the target on hit. Multihits roll the activation chance on each hit.
  CODE: PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["ER_FROSTBITE"]}

### 693 Patchwork  [composite-vanilla-mashup] pkrg=5396
  ABBR: Disguise + curses the opponent when its Disguise breaks.
  FULL: Blocks the first damaging move that hits the Pokemon and changes its form after. Only non-status moves are blocked. In fog, the disguise is restored immediately once per switch in, or when fog is set again. When the disguise breaks, the attacker becomes cursed.
  CODE: NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined} | FormBlockDamageAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0,formIndex=0,recoil=0.125,i18nKey="abilityTriggers:disguiseAvoidedDamage"} | PostBattleInitFormChangeAbAttr{showAbility=false,extraCondition=undefined,formFunc=<fn>} | PostFaintFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>}

### 694 Blind Rage  [composite-vanilla-mashup] pkrg=5397
  ABBR: Scrappy + Mold Breaker.
  FULL: The user can land Normal and Fighting-type moves on Ghost- types for neutral damage. Grants immunity to Intimidate and Scare. Allows moves to ignore the target's abilities and innates that interfere with effects or reduce damage. Does not bypass abilities that modify base stats such as Grass Pelt.
  CODE: IgnoreTypeImmunityAbAttr{showAbility=false,extraCondition=undefined,defenderType=7,allowedMoveTypes=[0,1]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined} | PostSummonMessageAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,messageFunc=<fn>} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>}

### 695 Slipstream  [bespoke] pkrg=5398
  ABBR: Moves use 20% of its Speed stat additionally.
  FULL: Adds 20% of the user's Speed stat to damage when using attacks. Choice Scarf does not affect this ability.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={},sourceStat=5} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,bonusStat=3,speedFraction=0.2,bonusFilter={},sourceStat=5}

### 696 Apex Predator  [composite-vanilla-mashup] pkrg=5399
  ABBR: Tough Claws + Predator.
  FULL: Contact moves are boosted by 30%. When the user knocks out an opponent with a direct hit, it immediately recovers 25% of its maximum HP.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25}

### 697 Dragon's Ritual  [bespoke] pkrg=5400
  ABBR: Dealing a KO raises Attack and Speed by one stage.
  FULL: Boosts the user's Attack and Speed by one stage each whenever it knocks out an opponent with a direct hit.
  CODE: StatTriggerOnKoAbAttr{showAbility=true,extraCondition=undefined,event="on-ko",stats=[{"stat":1,"stages":1},{"stat":5,"stages":1}]}

### 698 Pinnacle Blade  [bespoke] pkrg=5401
  ABBR: Slashing moves always hit and break protection and barriers.
  FULL: All Keen Edge moves can never miss, and they bypass protection moves and ignore any secondary effects associated with them.
  CODE: ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"flag":256}}

### 699 Energized  [bespoke] pkrg=5402
  ABBR: Generator + charges up on KO with an Electric-type move.
  FULL: Charges up the user once upon switching in, doubling Electric- type move power for the next Electric attack. Recharge when Electric Terrain becomes active during battle. Charged state is lost upon switching out or after using an Electric move. Recharges when scoring a direct KO with an Electric move.
  CODE: PostSummonAddBattlerTagAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,tagType="CHARGED",turnCount=0}

### 700 Color Spectrum  [bespoke] pkrg=5403
  ABBR: Same-type attacks get a 1.2x boost. Changes type each turn.
  FULL: STAB moves are boosted by 20%. The user changes to a random Pure type at the start of every turn.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 701 Steel Beetle  [composite-vanilla-mashup] pkrg=5404
  ABBR: Raging Boxer + Pollinate.
  FULL: Causes punching moves to hit twice, with the first hit at 100% power and second hit at 40% power. Normal-type moves become Bug-type and gain STAB. If the user is Bug-type it is immune to powder moves.
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={"flag":128}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.4,condition=<fn>,powerMultiplier=0.4,powerFilter={"flag":128}} | TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=6,condition=<fn>,source={"kind":"type","type":0},configuredNewType=6} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 702 From the Shadows  [bespoke] pkrg=5405
  ABBR: Attacks trap and have a 20% flinch chance when moving first.
  FULL: When the user moves first in a turn, attacks gain a 20% chance to flinch and trap the target on hit. The trap effect applies regardless of flinch success. Flinch chance only works on the first hit of multihit moves.
  CODE: MovingFirstTrapFlinchAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,flinchChance=20,trapTurns=4}

### 703 Rage Point  [bespoke] pkrg=5406
  ABBR: Gets a 1.5x boost while statused. Raises offenses when crit.
  FULL: Boosts offensive moves by 50% while the user has any status condition. When the Pokemon takes a critical hit, both Attack and Special Attack are raised by one stage. Also negates burn's Attack drop and freeze's Special Attack drop.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1.5,condition=<fn>} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.5,condition=<fn>} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=1,stages=1} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=3,stages=1}

### 704 Hot Coals  [bespoke] pkrg=5407
  ABBR: Sets a trap that burns the next foe that switches in.
  FULL: Sets a burning trap on the opponent's side when the user switches in. The next opposing Pokemon that switches in will be burned if they are grounded and can be burned. Consumed when triggered. Does not stack multiple traps.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-hazard","hazard":"TOXIC_SPIKES","layers":1},once=false}

### 705 Terastal Treasure  [bespoke] pkrg=5408
  ABBR: Reduces damage taken by 40%, but lowers speed by 20%.
  FULL: Reduces incoming damage by 40% while lowering the Pokemon's Speed by 20%. Multiplicative with other sources of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.6,reductionAmount=0.4,filterSpec={"kind":"all"}} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=0.8,condition=undefined}

### 706 Shocking Maw  [composite-vanilla-mashup] pkrg=5409
  ABBR: Strong Jaw + Bite moves have 50% paralysis chance.
  FULL: Boosts the power of biting and fang moves by 30% and they have a 50% chance to paralyze the target on hit.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=50,effects=[3],contactRequired=false,contactExcluded=false,filter={"flag":32},firstTurnChance=undefined}

### 707 Gleam Eyes  [composite-vanilla-mashup] pkrg=5410
  ABBR: Frisk + Scare.
  FULL: Upon entering battle, reveals the opponents' items and prevents them from working for 2 turns; and the user drops the Special Attack stat of all opposing Pokemon by one stage. Does not prevent Mega Stones and other similar items from working.
  CODE: FriskAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true} | DisableFoeItemsOnEntryAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true} | PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[3],stages=-1,selfTarget=false,intimidate=true}

### 708 Megabite  [bespoke] pkrg=5411
  ABBR: Biting moves use SpAtk and deal 30% more damage.
  FULL: Biting moves use the Special Attack (still targets enemy's Defense unless stated otherwise) and deal 30% more damage.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=32,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 709 Dream State  [crit-mod] pkrg=5412
  ABBR: Immune to critical hits. Takes 20% less damage from attacks.
  FULL: Incoming damage is reduced by 20% (x0.8), multiplicative with other damage reduction. Additionally, critical hits are blocked, functioning as regular hits and not activating on-crit effects like To The Bone's bleed.
  CODE: CritImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 710 Dream Whimsy  [bespoke] pkrg=5413
  ABBR: Uses Yawn on switch-in.
  FULL: Uses Yawn on switch in, targeting the opposing Pokemon. Yawn causes drowsiness that makes the target fall asleep at the end of the next turn. The sleep effect can be prevented by switching out.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":281}}

### 711 Lunar Affinity  [bespoke] pkrg=5414
  ABBR: Copies lunar moves used by others.
  FULL: Copies lunar moves when other Pokemon use them in battle. Includes Moonlight, Moonblast, Lunar Dance, and Lunar Blessing. Triggers once per move.
  CODE: CopyMoveByFilterAbAttr{showAbility=true,extraCondition=undefined,flag=undefined,moveIds=[236,585,461,849]}

### 712 Flame Shield  [damage-reduction-generic] pkrg=5415
  ABBR: Takes 35% less damage from Super-effective moves.
  FULL: Reduces damage from super- effective attacks by 35%. Multiplicative with other sources of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65,reductionAmount=0.35,filterSpec={"kind":"super-effective"}}

### 713 Aquatic Dweller  [type-damage-boost] pkrg=5416
  ABBR: Aquatic + Boosts the power of Water-type moves by 1.5x.
  FULL: Upon entering battle, adds Water to the user's current typing. Retains Water typing even upon losing the ability, going away only when switching out. Also boosts the power of Water-type moves by 50%.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,type=10,highHpMultiplier=1.5,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 714 Apple Pie  [composite-vanilla-mashup] pkrg=5417
  ABBR: Self Sufficient + Ripen.
  FULL: Restores 1/16 of the Pokemon's maximum HP at the end of each turn. Ripen doubles all beneficial berry effects. Healing berries restore twice as much HP, stat-boosting berries raise stats by 2 stages, resist berries reduce super-effective damage by 75%, and PP-restoring berries restore 20 PP.
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.0625,conditionSpec={"kind":"always"}} | DoubleBerryEffectAbAttr{showAbility=true,extraCondition=undefined}

### 715 Hover  [bespoke] pkrg=5418
  ABBR: Adds Psychic type to itself. Avoids Ground attacks.
  FULL: Upon entering battle, adds Psychic to the user's current typing. Retains Psychic typing even upon losing the ability, going away only when switching out. The user is immune to Ground-type moves and other ground effects such as Spikes and terrains.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":13},once=false} | AttackTypeImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneType=4,condition=null}

### 716 Depravity  [composite-vanilla-mashup] pkrg=5419
  ABBR: Merciless + Overcharge.
  FULL: Guarantees critical hits against targets who are poisoned, paralyzed, bleeding, or have their speed lowered. The user's Electric-type moves become effective against Electric-type Pokemon, dealing 2x damage instead of 0.5x. Also allows the user to paralyze Electric-types.
  CODE: ConditionalCritAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>} | OffensiveTypeChartOverrideAbAttr{showAbility=false,extraCondition=undefined,rules=[{"attackType":12,"defenderType":12,"newMultiplier":2}]}

### 717 Wildfire  [bespoke] pkrg=5420
  ABBR: Attacks with Fire Spin on entry.
  FULL: Uses Fire Spin upon switching into battle, a 50 BP Fire-type Special move that traps the opponent for 4-5 turns. The target takes 1/8 max HP damage each turn and cannot switch out until the trap ends.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":83}}

### 718 Jumpscare  [bespoke] pkrg=5421
  ABBR: Attacks with Astonish on first switch-in.
  FULL: Uses Astonish on switch in, a 40 BP Ghost-type Physical move with +3 priority that always causes flinching. Once per battle.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":310}}

### 719 Tar Toss  [bespoke] pkrg=5422
  ABBR: Uses Tar Shot on switch-in.
  FULL: Uses Tar Shot on switch in, lowering the target's Speed by one stage and making them take double damage from Fire-type moves. Does not stack the Fire- type damage debuff on successive uses.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":749}}

### 720 Stun Shock  [chance-status-on-hit] pkrg=5423
  ABBR: Attacks have a 60% chance to Paralyze or Poison.
  FULL: When the user lands an attack, there's a 60% chance of inflicting poison or paralysis, chosen randomly. Multihits roll the activation chance on each hit.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=60,effects=[3],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined}

### 721 Raging Goddess  [composite-vanilla-mashup] pkrg=5424
  ABBR: Rampage + Hyper Aggressive.
  FULL: Eliminates recharge turns when the user successfully KOs an opponent with a direct attack. Makes all attacks hit twice in succession. The first hit deals 100%, while the second hit deals 25%. Each hit rolls secondary effects independently (except flinch).
  CODE: PostVictoryClearTagAbAttr{showAbility=true,extraCondition=undefined,tags=["RECHARGING"]} | HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.25,condition=<fn>,powerMultiplier=0.25,powerFilter={}}

### 722 Whiplash  [bespoke] pkrg=5425
  ABBR: Physical attacks lower defense.
  FULL: Lowers the target's Defense by one stage when hitting with physical attacks. Each target can only be affected once per turn. The Defense drop occurs after damage.
  CODE: StatChangeOnCategoryAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,category=0,stat=2,stages=-1,target="opponent"}

### 723 Supersweet Syrup  [(vanilla-map)] pkrg=300
  ABBR: Sticky Hold + Disables foe's item for 2 turns on contact.
  FULL: The user's item cannot be forcibly removed or stolen. When making contact, the opponent's item is disabled for 2 turns.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[7],stages=-1,selfTarget=false,intimidate=false}

### 724 Lucky Halo  [bespoke] pkrg=5426
  ABBR: Negates self stat drops. Endures the a single KO.
  FULL: Prevents self-inflicted stat drops on the user and allows them to survive an attack that would KO them one time, leaving them with 1 HP.
  CODE: ProtectStatAbAttr{showAbility=true,extraCondition=undefined,protectedStat=undefined} | PreFaintReviveAbAttr{showAbility=true,extraCondition=undefined,gate={"kind":"hp-threshold","threshold":0},usage={"kind":"first-n-hits","n":1}}

### 725 Trash Heap  [composite-vanilla-mashup] pkrg=5427
  ABBR: Corrosion + Toxic Spill.
  FULL: Poison-type moves become super effective against Steel-type Pokemon. Additionally, this Pokemon can inflict poison status on any type. Damages all non-Poison-type Pokemon by 1/8 HP each turn. Pokemon with Poison Heal recover instead. Disappears when the user leaves.
  CODE: IgnoreTypeStatusEffectImmunityAbAttr{showAbility=false,extraCondition=undefined,statusEffect=[1,2],defenderType=[8,3]} | PostTurnHurtNonTypedAbAttr{showAbility=true,extraCondition=undefined,safeTypes=[3],damageFraction=0.125,requiredWeathers=null}

### 726 Sludgy Mix  [composite-vanilla-mashup] pkrg=5428
  ABBR: Intoxicate + Punk Rock.
  FULL: Converts all Normal-type moves into Poison-type moves and grants STAB for Poison-type moves. If the user is Poison-type their Poison moves have 10% toxic chance. Amplifies the user's sound moves by 30% and reduces incoming sound move damage by 50%. Damage reduction is multiplicative with other sources.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=3,condition=<fn>,source={"kind":"type","type":0},configuredNewType=3} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 727 Overwatch  [composite-vanilla-mashup] pkrg=5429
  ABBR: On the Prowl + Stakeout.
  FULL: All moves with priority 0 or higher gain +1 priority on the user's first turn. Negative priority moves become priority 0 instead of adding +1 priority. Deals double damage to opponents that just switched in. Only works right after they switch in for 1 turn.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2} | ChangeMovePriorityAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1}

### 728 Wind Rage  [bespoke] pkrg=5430
  ABBR: Uses Defog on switch-in. Air-based moves get a 1.3x boost.
  FULL: Uses Defog on switch in. Lowers the opponent's evasion by one stage and clears all entry hazards, screens, Safeguard, and Mist. Additionally, all air-based moves receive a 1.3x damage boost.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":432}} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=1048576,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 729 Victory Bomb  [bespoke] pkrg=5431
  ABBR: Attacks with a 100BP Fire-type Explosion on fainting.
  FULL: When fainting, retaliate with a 100 BP Fire-type Explosion targeting all adjacent Pokemon. Cannot miss. Works regardless of how the user. was KOed.
  CODE: PostFaintDetonateAbAttr{showAbility=true,extraCondition=undefined,power=100,flinch=false,type=9}

### 730 Razor Sharp  [bespoke] pkrg=5432
  ABBR: Critical hits also inflict bleeding.
  FULL: Inflict bleed when landing a critical hit. Bleeding causes 1/16 max HP damage per turn, prevents healing, and negates the effects of stat stages. Rock and Ghost types are immune to bleeding.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["ER_BLEED"],contactRequired=false,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=undefined,critRequired=true,firstTurnChance=undefined}

### 731 To The Bone  [bespoke] pkrg=5433
  ABBR: Critical hits get a 1.5x boost and inflict bleeding.
  FULL: Critical hits get a 1.5x boost and inflict bleeding.
  CODE: CritDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,multAmount=1.5,configuredMultiplier=1.5} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["ER_BLEED"],contactRequired=false,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=undefined,critRequired=true,firstTurnChance=undefined}

### 732 Blade Dance  [bespoke] pkrg=5434
  ABBR: Triggers 50 BP Leaf Blade after using a dance move.
  FULL: Triggers a 50 BP Leaf Blade (Grass-type, Physical) follow-up attack immediately after using any dance move.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":348,"power":50,"flagFilter":4096}}

### 733 Taekkyeon  [bespoke] pkrg=5435
  ABBR: All attacks are dances.
  FULL: Makes all non-status moves count as dance moves, triggering abilities like Dancer and interactions with dance-based effects.
  CODE: MoveFlagInjectionAbAttr{showAbility=false,extraCondition=undefined,injectFlag=4096,scope="all-attacks"}

### 734 Ape Shift  [bespoke] pkrg=5436
  ABBR: Transforms below 50% HP, curing status and always critting.
  FULL: Transforms the Pokemon when HP drops to 50% or below, automatically curing all status conditions after transformation. After transforming, all attacks become critical hits. Activates on entry, during battle, and at turn end.
  CODE: HpThresholdFormChangeAbAttr{showAbility=false,extraCondition=undefined,hpThreshold=0.5,targetFormKey="transformed",cureStatus=true} | ConditionalCritAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>}

### 735 Know Your Place  [bespoke] pkrg=5437
  ABBR: Contact attacks make foes move last for 5 turns.
  FULL: Landing contact moves causes the target to always move last regardless of priority, speed, or other effects for 5 turns. Effect does not stack or refresh on already afflicted targets.
  CODE: ContactQuashAbAttr{showAbility=false,extraCondition=undefined,stages=-6}

### 736 Deep Cuts  [bespoke] pkrg=5438
  ABBR: Slashing moves have a 50% chance to inflict bleeding.
  FULL: Keen Edge have a 50% chance to inflict bleeding on hit. Bleeding causes 1/16 max HP damage per turn, prevents healing, and negates the effects of stat stages. Rock and Ghost types are immune to bleeding.immune to bleeding. Multihits roll the activation chance on each hit.
  CODE: PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["ER_BLEED"]}

### 737 Life Steal  [bespoke] pkrg=5439
  ABBR: Steals 1/10 HP from foes each turn.
  FULL: Drains 1/10 of each active opponent's max HP at the end of every turn and restores that amount to the user. Ignores Substitute.
  CODE: PostTurnDrainAbAttr{showAbility=true,extraCondition=undefined,fraction=0.1,weather=null}

### 738 Rude Awakening  [status-immunity] pkrg=5440
  ABBR: Raises all stats becomes immune to sleep after waking up.
  FULL: Upon awakening, the user permanently gains immunity to sleep status and boosts all stats by one stage. Once per battle.
  CODE: StatusEffectImmunityAbAttrEr{showAbility=true,extraCondition=undefined,immuneEffects=[4],configuredStatuses=[4]}

### 739 Teraform Zero  [(vanilla-map)] pkrg=309
  ABBR: Tera Shell + clears weather and terrain on first entry.
  FULL: At full HP, all attacks towards the user deal not very effective damage regardless of type effectiveness. Activates on each hit of a multihit attack unlike other similar abilities. On entry, clears normal weathers and terrains.
  CODE: PostSummonWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=0} | PostSummonTerrainChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,terrainType=0}

### 740 Set Ablaze  [bespoke] pkrg=5441
  ABBR: Inflicting burn also inflicts fear.
  FULL: When the user applies burn, they also apply fear. Fear traps the target for 2 turns and they take 50% more damage. If forced out by moves like Whirlwind, the target loses Fear.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["ER_FEAR"],contactRequired=false,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=6,critRequired=false,firstTurnChance=undefined}

### 741 Breakwater  [composite-vanilla-mashup] pkrg=5442
  ABBR: Swift Swim + Stall.
  FULL: Boosts Speed by 50% during rain. Reduces damage by 30% when moving before the opponent. Works when the user switches in mid-turn.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.7}

### 742 Magical Fists  [bespoke] pkrg=5443
  ABBR: Punching moves use Special Attack and get a 1.3x boost.
  FULL: Punching moves use the Special Attack (still targets enemy's Defense unless stated otherwise) and deal 30% more damage.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=128,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 743 Cutthroat  [priority-modifier] pkrg=5444
  ABBR: The first slicing move used on each entry in gets +1 priority.
  FULL: On entry, gives +1 priority to the first Keen Edge move used. Priority boost is consumed after landing any Keen Edge move. Resets ability if Sharpen is used.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={},condition={"kind":"always"}}

### 744 Sand Bender  [composite-vanilla-mashup] pkrg=5445
  ABBR: Sand Stream + Sand Force.
  FULL: Summons sandstorm on entry, lasting 8 turns (12 with Smooth Stone). Boosts the Pokemon's highest attacking stat by 50% during sandstorm. Also grants immunity to sandstorm damage.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=3,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=3,erTurns=8} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[3]}

### 745 Sand Pit  [bespoke] pkrg=5446
  ABBR: Attacks with 20BP Sand Tomb on switch-in.
  FULL: Uses Sand Tomb with 20 BP on switch in. Hits all opposing Pokemon and traps them for 4-5 turns, making them lose 1/8 max HP each turn. Cannot miss and ignores accuracy checks.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":328,"power":20}}

### 746 Desolate Sun  [composite-vanilla-mashup] pkrg=5447
  ABBR: Desolate Land + Earth Eater.
  FULL: Creates extremely harsh sunlight that lasts until the user switches out. Has the standard sun effects and nullifies all Water-type moves. Additionally, the user heals 25% of their max HP when hit by Ground-type moves instead of taking damage.
  CODE: PostSummonWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=8} | PostBiomeChangeWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,weatherType=8} | PreLeaveFieldClearWeatherAbAttr{showAbility=false,extraCondition=undefined,weatherType=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | TypeImmunityHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=4,condition=null}

### 747 Daybreak  [chance-status-on-hit] pkrg=5448
  ABBR: Burns the foe on contact. Also works on offense.
  FULL: The user burns the foe on contact. Works on offense and defense.
  CODE: ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=100,effects=[6],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=100,effects=[6],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined}

### 748 Energy Siphon  [lifesteal] pkrg=5449
  ABBR: Heals the user for 1/4 of the damage they deal.
  FULL: Heals the user for 25% of all damage they deal to opponents. Healing occurs immediately after damage is dealt. Minimum healing of 1 HP.
  CODE: LifestealOnHitAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,hitHealFraction=0.25,hitFilter={}}

### 749 Reservoir  [composite-vanilla-mashup] pkrg=5450
  ABBR: Water Absorb + Storm Drain.
  FULL: The user is draws in Water-type moves and gain immunity to them. Additionally, Water-type moves boost the highest attacking stat of the user by one stage and heal for 25% of their max HP when absorbing them.
  CODE: TypeImmunityHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=10,condition=null} | RedirectTypeMoveAbAttr{showAbility=true,extraCondition=undefined,type=10} | TypeImmunityHighestAttackStatStageAbAttr{showAbility=true,extraCondition=undefined,immuneType=10,condition=null,stages=1}

### 750 Neurotoxin  [bespoke] pkrg=5451
  ABBR: Inflicting poison also lowers Attack, SpAtk, and Speed.
  FULL: When inflicting poison on an opponent, drop their Attack, Special Attack, and Speed by one stage immediately after it applies.
  CODE: StatusCascadeAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,trigger=1,stats=[{"stat":1,"stages":-1},{"stat":3,"stages":-1},{"stat":5,"stages":-1}]}

### 751 Energy Horns  [bespoke] pkrg=5452
  ABBR: Mighty horn moves become special and deal 30% more damage.
  FULL: Horn moves become Special (deal Special damage and use the Special Attack stat) and deal 30% more damage.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=67108864,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 752 Rising Dough  [entry-effect] pkrg=5453
  ABBR: Casts Sticky Web on entry. Lasts 7 turns.
  FULL: Sets Sticky Web on opponent's field when the user enters battle. Lasts 7 turns and lowers Speed by 1 stage for any grounded Pokemon switching in. Cannot activate if Sticky Web is already present on opponent's field.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-hazard","hazard":"STICKY_WEB","layers":1},once=false}

### 753 Crust Coat  [crit-mod] pkrg=5454
  ABBR: Immune to critical hits. Takes 20% less damage from attacks.
  FULL: Incoming damage is reduced by 20% (x0.8), multiplicative with other damage reduction. Additionally, critical hits are blocked, functioning as regular hits and not activating on-crit effects like To The Bone's bleed.
  CODE: CritImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 754 Puffy  [damage-reduction-generic] pkrg=5455
  ABBR: Takes 1/2 dmg from contact moves but Fire moves hurt it 2x more.
  FULL: Reduces damage from contact moves by 50%. Fire-type moves to deal double damage to the user. Multiplicative with other forms of damage reduction.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"contact"}}

### 755 Balloon Blitz  [composite-vanilla-mashup] pkrg=5456
  ABBR: Inflatable + Hyper Aggressive.
  FULL: When hit by any Fire or Flying moves, boost Defense and Special Defense by one stage. Activates on each hit of a multihit move. Boost applies after the hit lands. All attacks hit twice. First hit deals 100%, while the second deals 25%. Each hit rolls secondary effects independently (except flinch).
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":2,"stages":1},{"stat":4,"stages":1}],filter={"types":[2,9]}} | HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.25,condition=<fn>,powerMultiplier=0.25,powerFilter={}}

### 756 Twinkle Toes  [flag-damage-boost] pkrg=5457
  ABBR: Boosts the power of kicking moves by 1.3x + Pixilate.
  FULL: Increases the power of all kicking moves by 30%. Normal- type moves become Fairy-type and the user gains Fairy STAB. If the user is Fairy-type their Fairy-type moves get 10% infatuate chance.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=134217728,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 757 Doom Blast  [type-damage-boost] pkrg=5458
  ABBR: Dark-type moves deal 1.35x damage but have 10% recoil.
  FULL: Boosts Dark-type moves by 35% but causes 10% recoil damage based on damage dealt (minimum 1 HP). The recoil damage will not knock out the user.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.35,type=16,highHpMultiplier=1.35,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeRecoilAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,type=16,recoilPct=0.1}

### 758 Brute Force  [composite-vanilla-mashup] pkrg=5459
  ABBR: Rock Head + Reckless
  FULL: Increases the damage of moves that cause recoil by 20%. While enraged, this boost applies to all moves. Prevents all recoil damage from the user's moves and abilities. Also grants immunity to enrage recoil damage. Does not prevent crash damage or Explosion/Self-Destruct damage.
  CODE: BlockRecoilDamageAttr{showAbility=false,extraCondition=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 759 Faraday Cage  [composite-vanilla-mashup] pkrg=5460
  ABBR: Shell Armor + 50BP Thunder Cage when hit by contact.
  FULL: Incoming damage is reduced by 20%, multiplicative with other damage reduction. Critical hits are blocked. Uses Thunder Cage when hit by contact moves, a 50 BP Electric-type Special move that traps the opponent for 4-5 turns. The target takes 1/8 max HP damage each turn and cannot switch out.
  CODE: BlockCritAbAttr{showAbility=false,extraCondition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8} | CounterAttackOnHitAbAttr{showAbility=false,extraCondition=undefined,moveId=819,power=undefined,chance=100,filter={"contactRequired":true}}

### 760 Acidic Slime  [composite-vanilla-mashup] pkrg=5461
  ABBR: Corrosion + Poison STAB.
  FULL: Poison-type moves become super effective against Steel-type Pokemon. Additionally, this Pokemon can inflict poison status on any type. Also gives STAB to Poison-type moves.
  CODE: IgnoreTypeStatusEffectImmunityAbAttr{showAbility=false,extraCondition=undefined,statusEffect=[1,2],defenderType=[8,3]} | StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=3,multiplier=1.5}

### 761 Rose Garden  [entry-effect] pkrg=5462
  ABBR: Spreads two layers of Toxic Spikes on switch-in.
  FULL: Spreads two layers of Toxic Spikes on the opponent's side on entry. Any non-Poison or Steel- type grounded enemy that switches in will be badly poisoned.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-hazard","hazard":"TOXIC_SPIKES","layers":2},once=false}

### 762 Qigong  [composite-vanilla-mashup] pkrg=5463
  ABBR: Always hits. Fighting Spirit + Rampage.
  FULL: The user always lands their moves. Converts all Normal-type moves into Fighting-type moves and grants STAB on Fighting-type attacks. If the user is Fighting- type their Fighting-type moves break screens. Eliminates recharge turns when the user successfully KOs an opponent with a direct attack.
  CODE: PostVictoryClearTagAbAttr{showAbility=true,extraCondition=undefined,tags=["RECHARGING"]} | AlwaysHitAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 763 Conjurer Of Deceit  [composite-vanilla-mashup] pkrg=5464
  ABBR: Magic Guard + Magic Bounce
  FULL: Grants immunity to all non- attack damage sources including entry hazards, weather damage, status conditions, and recoil. Reflects most status moves back to the user before they can take effect. Reflected moves target the original user. Does not reflect moves that were already reflected.
  CODE: BlockNonDirectDamageAbAttr{showAbility=false,extraCondition=undefined} | ReflectStatusMoveAbAttr{showAbility=true,extraCondition=undefined}

### 764 Deep Freeze  [bespoke] pkrg=5465
  ABBR: Boosts Water and Ice by 1.25x. Halves Fire damage taken.
  FULL: Boosts the damage of Water and Ice-type moves by 25%. Halves damage received from Fire-type moves. Multiplicative with other damage reduction sources.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25,type=10,highHpMultiplier=1.25,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25,type=14,highHpMultiplier=1.25,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":9}}

### 765 Soul Devourer  [composite-vanilla-mashup] pkrg=5466
  ABBR: Soul Eater + Phantom Pain
  FULL: When the user knocks out an opponent with a direct hit, it immediately recovers 25% of its maximum HP. Removes Normal-type immunity to Ghost-type moves, allowing Ghost attacks to hit Normal-type Pokemon for 1x effectiveness.
  CODE: LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25} | IgnoreTypeImmunityAbAttr{showAbility=false,extraCondition=undefined,defenderType=0,allowedMoveTypes=[7]}

### 766 Champion's Entrance  [composite-vanilla-mashup] pkrg=5467
  ABBR: Intimidate + Violent Rush
  FULL: Upon entering battle, the user drops the Attack stat of all opposing Pokemon by one stage. The user gains a 50% Speed boost and 20% Attack boost on their first turn after switching in.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[1],stages=-1,selfTarget=false,intimidate=true} | FirstTurnStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 767 Presto  [priority-modifier] pkrg=5468
  ABBR: Sound moves get +1 priority at full HP.
  FULL: Grants +1 priority to sound moves when at full HP.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"flag":4},condition={"kind":"always"}}

### 768 Samba  [composite-vanilla-mashup] pkrg=5469
  ABBR: Striker + Dancer
  FULL: Increases the power of all kicking moves by 30%. Includes Pyro Ball. When any Pokemon on the field uses a dance move, this Pokemon immediately uses the same move after. Triggers once per move.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=134217728,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | PostDancingMoveAbAttr{showAbility=true,extraCondition=undefined}

### 769 JunshiSanda  [bespoke] pkrg=5470
  ABBR: Punches and Kicks are both Punches and Kicks.
  FULL: Punching moves are also treated as kicking moves, benefiting from Striker-type abilities. Kicking moves are also treated as punching moves, benefiting from Iron Fist-type abilities.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.15,flag=128,highHpMultiplier=1.15,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.15,flag=134217728,highHpMultiplier=1.15,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 770 Gladiator  [type-damage-boost] pkrg=5471
  ABBR: Boosts Fighting-type moves by 1.3x, or 1.8x when below 1/3 HP.
  FULL: Boosts the power of Fighting- type moves by 30%, or by 80% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=1,highHpMultiplier=1.3,lowHpMultiplier=1.8,lowHpThreshold=0.3333333333333333,weathers=null}

### 771 Forsaken Heart  [bespoke] pkrg=5472
  ABBR: KOs dealt anywhere on the field raise Attack by one stage.
  FULL: Raises Attack by one stage when any Pokemon faints on the battlefield, including allies and enemies.
  CODE: StatTriggerOnKoAbAttr{showAbility=true,extraCondition=undefined,event="on-ko",stats=[{"stat":1,"stages":1}]}

### 772 Relentless  [composite-vanilla-mashup] pkrg=5473
  ABBR: Exploit Weakness + Merciless
  FULL: When attacking a statused opponent, deals 1.25x damage and automatically targets their lower defensive stat. Guarantees critical hits against targets who are poisoned, paralyzed, bleeding, or have their speed lowered.
  CODE: DefenseStatSwapOnStatusedFoeAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1} | ConditionalCritAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>}

### 773 Soothsayer  [bespoke] pkrg=5474
  ABBR: Resists all attacks for three turns on first entry.
  FULL: On entry, all attacks received by the user are considered not very effective for 3 turns. Deactivates when switching out.
  CODE: TimeLimitedDamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,turns=3}

### 774 Corrupted Mind  [bespoke] pkrg=5475
  ABBR: Psychic moves ignore resists and get 1.4x effect chance.
  FULL: Psychic-type moves bypass type resistances and immunities, hitting for at least neutral damage regardless of the target's typing. Additionally, all secondary effects of Psychic moves have their activation chance increased by 40%.
  CODE: OffensiveTypeChartOverrideAbAttr{showAbility=false,extraCondition=undefined,rules=[{"attackType":13,"defenderType":8,"newMultiplier":1},{"attackType":13,"defenderType":13,"newMultiplier":1},{"attackType":13,"defenderType":16,"newMultiplier":1}]}

### 775 Flame Coat  [bespoke] pkrg=5476
  ABBR: Non-Fire-types take 1/8 dmg every turn when on field.
  FULL: Non-Fire-types take 1/8 dmg every turn when on field.
  CODE: PostTurnHurtNonTypedAbAttr{showAbility=true,extraCondition=undefined,safeTypes=[9],damageFraction=0.125,requiredWeathers=null}

### 776 Unown Power  [composite-vanilla-mashup] pkrg=5477
  ABBR: Mystic Power + Hidden and Secret Power hit Super-effectively.
  FULL: Grants the 1.5x STAB damage bonus to all moves regardless of type matching. Does not boost moves that already receive a STAB bonus. Hidden/Secret Power is always super effective (x2).  Detailed Mechanical Explanation
  CODE: StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=null,multiplier=1.5}

### 777 Super Scope  [composite-vanilla-mashup] pkrg=5478
  ABBR: Mega Launcher + Artillery.
  FULL: Boosts pulse, beam, ball, and aura moves by 30%. Mega Launcher moves always hit and strike both opposing Pokemon simultaneously. Unable to miss with pulse, beam, ball, aura, and other blast related moves.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"flag":64}}

### 778 Venom Crown  [composite-vanilla-mashup] pkrg=5479
  ABBR: Poison Point + Mighty Horn.
  FULL: Has a 30% chance to inflict poison on contact moves, both when attacking and being attacked. Boosts the power of horn and drill-based attacks by 30%.
  CODE: PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[1]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[1],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[1]} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=67108864,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 779 Blight Scale  [composite-vanilla-mashup] pkrg=5480
  ABBR: Multiscale + Poison Point
  FULL: Reduces all incoming damage by 50% when the Pokemon is at max HP. Multiplicative with other sources of damage reduction. Has a 30% chance to inflict poison on contact moves, both when attacking and being attacked.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[1]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[1],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[1]}

### 780 Gunman  [composite-vanilla-mashup] pkrg=5481
  ABBR: Mega Launcher + Status moves are Mega Launcher moves.
  FULL: Boosts the power of pulse, aura, and projectile moves by 30%. Additionally, all status moves are treated as Mega Launcher moves, receiving boosts from abilities related to them.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | AddMoveFlagAbAttr{showAbility=false,extraCondition=undefined,filter=<fn>,grantedFlags=[64]}

### 781 Hunter's Mark  [composite-vanilla-mashup] pkrg=5482
  ABBR: Ambush + Deadeye.
  FULL: Guarantees a critical hit on the user's first turn after switching in or at the start of battle. The user is unable to miss arrow-based attacks and cannon moves (only moves blocked by Bulletproof). Additionally, when landing critical hits, the attack targets the opponent's weaker defensive stat.
  CODE: CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={}} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=null,condition=<fn>} | CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"flag":2097152}} | CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"flag":1024}}

### 782 Hemolysis  [bespoke] pkrg=5483
  ABBR: Poisoned foes lose all stat buffs and can't heal.
  FULL: When the user poisons a Pokemon, the poisoned target is cleared of all stat raises and they are unable to heal through any means.
  CODE: PoisonedFoePurgeAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>}

### 783 Caretaker  [composite-vanilla-mashup] pkrg=5484
  ABBR: Healer + Friend Guard.
  FULL: Gives a 30% chance to cure status conditions at the end of each turn for both the user and their ally if they are out in a double battle. Makes 2 separate checks for each Pokemon. In a double battle, the user's ally receives 50% less damage. Multiplicative with other damage reduction sources.
  CODE: PostTurnResetStatusAbAttr{showAbility=true,extraCondition=<fn>,allyTarget=true,target=undefined} | AlliedFieldDamageReductionAbAttr{showAbility=true,extraCondition=undefined,damageMultiplier=0.5}

### 784 Poseidon's Dominion  [bespoke] pkrg=5485
  ABBR: Attacks with Whirlpool on entry.
  FULL: Uses Whirlpool upon switching into battle, a 50 BP Water-type Special move that traps the opponent for 4-5 turns. The target takes 1/8 max HP damage each turn and cannot switch out until the trap ends.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":250}}

### 785 Two-Faced  [composite-vanilla-mashup] pkrg=5486
  ABBR: Hunger Switch + Elec and Dark deal 1.35x with 10% recoil.
  FULL: Automatically switches between Full and Hangry forms at the end of each turn. Boosts Electric and Dark-type moves by 35% but causes 10% recoil damage based on damage dealt (minimum 1 HP). The recoil damage will not knock out the user. Cannot be overridden, suppressed, swapped, or copied in any way.
  CODE: PostTurnFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>} | PostTurnFormChangeAbAttr{showAbility=true,extraCondition=undefined,formFunc=<fn>} | NoTransformAbilityAbAttr{showAbility=false,extraCondition=undefined} | NoFusionAbilityAbAttr{showAbility=false,extraCondition=undefined} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.35,type=12,highHpMultiplier=1.35,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.35,type=16,highHpMultiplier=1.35,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeRecoilAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,type=12,recoilPct=0.1} | TypeRecoilAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,type=16,recoilPct=0.1}

### 786 Lullaby  [bespoke] pkrg=5487
  ABBR: Sing accuracy is 90% when used by this Pokémon.
  FULL: Boosts Sing's accuracy to 90%. Does not lock to accuracy to 90%, the move still gets affected by accuracy/evasiveness changes.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.5,condition=undefined}

### 787 Cryo Architect  [bespoke] pkrg=5488
  ABBR: Boosts Attack and Def when hit by Water or Ice.
  FULL: When hit by a Water-type attack, raises the user's Attack by one stage, and Defense by one stage on the turn after. If it's hit by an Ice-type attack, it will raise both in the first turn. each. Activates on each hit of a multihit move.
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":1,"stages":1},{"stat":2,"stages":1}],filter={"types":[10,14]}}

### 788 Glacial Rage  [bespoke] pkrg=5489
  ABBR: Triggers 50 BP Blizzard after using a Ice-type move.
  FULL: After using an Ice-type move, the user follows up with a 50 BP Blizzard (Ice, 85% accuracy, hits both opponents, 20% frostbite chance. Weather-based).
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":59,"power":50,"typeFilter":[14]}}

### 789 Immovable Object  [composite-vanilla-mashup] pkrg=5490
  ABBR: Impenetrable + Sturdy.
  FULL: Grants immunity to all non- attack damage sources including entry hazards, weather damage, status conditions, and recoil. When at full HP, this Pokemon will survive any single attack with at least 1 HP remaining.
  CODE: BlockNonDirectDamageAbAttr{showAbility=false,extraCondition=undefined} | PreDefendFullHpEndureAbAttr{showAbility=true,extraCondition=undefined} | BlockOneHitKOAbAttr{showAbility=true,extraCondition=undefined}

### 790 Frenzied Phantom  [composite-vanilla-mashup] pkrg=5491
  ABBR: Hyper Aggressive + Shadow Tag.
  FULL: Makes all attacks hit twice in succession. First hit deals 100%, second hit deals 25%. Each hit rolls secondary effects independently (except flinch). Prevents all non-Shadow Tag or Ghost-type foes from switching out. Pivot moves such as Volt Switch still allows them to switch
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.25,condition=<fn>,powerMultiplier=0.25,powerFilter={}} | ArenaTrapAbAttr{showAbility=false,extraCondition=undefined,arenaTrapCondition=<fn>}

### 791 DNA Scramble  [bespoke] pkrg=5492
  ABBR: Changes forms based on the the move used.
  FULL: Transforms Deoxys between forms based on the move used. Damaging moves trigger Attack form, Recover triggers Defense form, other status moves trigger Speed form. Form changes occur before attack.
  CODE: 

### 792 Metallic Jaws  [composite-vanilla-mashup] pkrg=5493
  ABBR: Metallic + Primal Maw.
  FULL: Upon entering battle, adds Steel to the user's current typing. Retains Steel typing even upon losing the ability, going away only when switching out. all biting moves to hit twice. First hit deals 100% damage, second hit deals 40%. Each hit rolls secondary effects independently (except flinch).
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":8},once=false} | HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={"flag":32}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.4,condition=<fn>,powerMultiplier=0.4,powerFilter={"flag":32}}

### 793 Calculative  [composite-vanilla-mashup] pkrg=5494
  ABBR: Analytic + Neuroforce.
  FULL: When the user moves after the target, boosts attack power by 30%. Super effective attacks are boosted by 35%.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.35}

### 794 Deadly Precision  [bespoke] pkrg=5495
  ABBR: Super-effective moves never miss and ignore abilities.
  FULL: Always land super effective attacks on the opponent. Allows super effective attacks to ignore the target's abilities and innates that interfere with effects or reduce damage.
  CODE: AlwaysHitAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>}

### 795 Embody Aspect  [entry-effect] pkrg=5496
  ABBR: +1 Speed on Entry.
  FULL: Raises the Pokemon's Speed stat by one stage when switching into battle.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"self-stat-boost","stat":5,"stages":1},once=false}

### 795 Embody Aspect  [entry-effect] pkrg=5496
  ABBR: +1 Attack on Entry.
  FULL: Raises the Pokemon's Speed stat by one stage when switching into battle.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"self-stat-boost","stat":5,"stages":1},once=false}

### 795 Embody Aspect  [entry-effect] pkrg=5496
  ABBR: +1 Defense on Entry.
  FULL: Raises the Pokemon's Speed stat by one stage when switching into battle.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"self-stat-boost","stat":5,"stages":1},once=false}

### 795 Embody Aspect  [entry-effect] pkrg=5496
  ABBR: +1 Spdef on Entry.
  FULL: Raises the Pokemon's Speed stat by one stage when switching into battle.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"self-stat-boost","stat":5,"stages":1},once=false}

### 799 We Will Rock You  [type-damage-boost] pkrg=5500
  ABBR: Boosts Rock-type moves by 1.3x, or 1.8x when below 1/3 HP.
  FULL: Boosts the power of Rock-type moves by 30%, or by 80% at 1/3 HP or lower.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=5,highHpMultiplier=1.3,lowHpMultiplier=1.8,lowHpThreshold=0.3333333333333333,weathers=null}

### 800 Deviate  [type-conversion] pkrg=5501
  ABBR: Normal moves become Dark. Dark moves are empowered.
  FULL: Changes the user's Normal-type moves to Dark-type. If the user is Dark-type its Dark-type moves have a 10% enrage chance, otherwise it gains Dark STAB.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=16,condition=<fn>,source={"kind":"type","type":0},configuredNewType=16} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 801 Sun's Bounty  [composite-vanilla-mashup] pkrg=5502
  ABBR: Leaf Guard + Harvest.
  FULL: During sun, cures all status conditions at at the end of the turn; and 50% chance to restore berry on turn end, 100% in sun. Includes berries that were used for Fling, Natural Gift, or eaten.
  CODE: PostTurnResetStatusAbAttr{showAbility=true,extraCondition=undefined,allyTarget=true,target=undefined} | PostTurnRestoreBerryAbAttr{showAbility=true,extraCondition=undefined,berriesUnderCap=undefined,procChance=<fn>}

### 802 Rite Of Spring  [composite-vanilla-mashup] pkrg=5503
  ABBR: Chlorophyll + Solar Power.
  FULL: Boosts the user's Speed and highest attacking stat by 50% when sun is active.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | PostWeatherLapseDamageAbAttr{showAbility=true,extraCondition=undefined,weatherTypes=[1,8],damageFactor=2} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.5,condition=undefined}

### 803 Headstrong  [entry-effect] pkrg=5504
  ABBR: +1 Spdef on entry.
  FULL: Raises the Pokemon's Special Defense stat by one stage when switching into battle.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"self-stat-boost","stat":4,"stages":1},once=false}

### 804 Firefighter  [bespoke] pkrg=5505
  ABBR: Deals 1.5x damage to Fire. Takes 0.5x damage from Fire.
  FULL: Deals 1.5x damage to Fire-type Pokemon and takes 0.5x damage when attacked by Fire-type Pokemon. Based on attacker/defender Pokemon types, not move types. The damage reduction is multiplicative with other sources.
  CODE: OffensiveTypeMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetDefenderType=9,multiplier=1.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 805 Sepia Lens  [composite-vanilla-mashup] pkrg=5506
  ABBR: Tinted Lens + Sand Guard.
  FULL: Combines Tinted Lens and Sand Guard. Doubles damage when attacking with not very effective moves. During sandstorm, blocks priority moves from opponents and halves damage from special attacks. Also grants immunity to sandstorm damage like other Ground-types.
  CODE: MoveDamageBoostAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=2,condition=<fn>} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"category-in-weather","category":1,"weather":3}}

### 806 Super Sniper  [composite-vanilla-mashup] pkrg=5507
  ABBR: Sniper + Attacks hit switching foes with 1/2 Power.
  FULL: Boosts critical hit damage from 1.5x to 2.25x by applying an additional 50% multiplier. Attacks strike foes before they finish switching out for 50% power, damaging them before leaving.
  CODE: MultCritAbAttr{showAbility=false,extraCondition=undefined,multAmount=1.5} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 807 Woodland Curse  [bespoke] pkrg=5508
  ABBR: Uses Forest's Curse on Entry. Adds Grass type on contact.
  FULL: Upon entering battle, uses Forest's Curse on a random opponent, adding Grass typing. When opponents make contact with the user, they also gain Grass as an extra type. Only affects non-Grass types. Persists until switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"scripted-move","move":571},once=false} | AddTypeToAttackerOnContactAbAttr{showAbility=true,extraCondition=undefined,addedType=11}

### 808 Malodor  [bespoke] pkrg=5509
  ABBR: Suppresses attacker's abilities on contact.
  FULL: When hit by a contact move, the user suppresses the attacker's ability and innates until they switch out.
  CODE: SuppressAttackerAbilityAbAttr{showAbility=false,extraCondition=undefined,contactOnly=true,requireAttackerStatus=null,weathers=null}

### 809 Blur  [bespoke] pkrg=5510
  ABBR: Uses Speed as defense stat when hit by contact.
  FULL: When hit by contact moves, the Pokemon uses its Speed stat instead of Defense or Special Defense for damage calculations. Choice Scarf does not affect this ability.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=2,multiplier=1,condition=undefined,bonusStat=2,speedFraction=1,bonusFilter={},sourceStat=5}

### 810 Elude  [bespoke] pkrg=5511
  ABBR: Uses Speed as defense stat when hit by non-contact.
  FULL: When hit by non-contact moves, the Pokemon uses its Speed stat instead of Defense or Special Defense for damage calculations. Choice Scarf does not affect this ability.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=2,multiplier=1,condition=undefined,bonusStat=2,speedFraction=1,bonusFilter={},sourceStat=5}

### 811 Drake Of Rage  [composite-vanilla-mashup] pkrg=5512
  ABBR: Tinted Lens + Rampage
  FULL: Doubles damage when attacking into resistances. If a move would be resisted (0.5x damage or less), the damage is multiplied by 2x. Eliminates recharge turns when the user successfully KOs an opponent with a direct attack.
  CODE: MoveDamageBoostAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=2,condition=<fn>} | PostVictoryClearTagAbAttr{showAbility=true,extraCondition=undefined,tags=["RECHARGING"]}

### 812 Reverberate  [bespoke] pkrg=5513
  ABBR: Normal moves are Sound moves.
  FULL: Converts all Normal-type moves into Sound moves, enabling them to benefit from sound-based abilities and interactions.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 813 Mixed Martial Arts  [bespoke] pkrg=5514
  ABBR: Normal moves are flagged as Punch + Kick moves.
  FULL: Converts all Normal-type moves into Iron Fist and Striker moves, enabling them to benefit from related abilities and interactions.
  CODE: AddMoveFlagAbAttr{showAbility=false,extraCondition=undefined,filter=<fn>,grantedFlags=[128,134217728]}

### 814 Strategic Pause  [crit-mod] pkrg=5515
  ABBR: +2 crit rate when moving last + Analytic.
  FULL: When the user moves after the target, boosts critical hit ratio by 2 stages and attack power by 30%.
  CODE: CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=2,bonusFilter={}}

### 815 Overrule  [crit-mod] pkrg=5516
  ABBR: Crits bypass abilities and do 2x damage vs resists.
  FULL: When this Pokemon's moves land critical hits, they ignore defensive abilities that would normally reduce damage and their attacks deal double damage if they are resisted. For multi-hit attacks abilities are either ignored for all hits if the first is a crit or no hits otherwise.
  CODE: CritDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,multAmount=2,configuredMultiplier=2}

### 816 Mental Pollution  [bespoke] pkrg=5517
  ABBR: Suppresses others' abilities when it becomes enraged.
  FULL: Applies ability suppression to other Pokemon when the user becomes enraged. Suppression lasts while those Pokemon remain on the field. Pokemon with Mental Pollution are unaffected.
  CODE: SuppressAttackerAbilityAbAttr{showAbility=false,extraCondition=undefined,contactOnly=false,requireAttackerStatus=null,weathers=[6]}

### 817 Madness Enhancement  [bespoke] pkrg=5518
  ABBR: Enrages in fog, halves damage when enraged.
  FULL: Becomes enraged when entering fog. All incoming damage is reduced by 50% when the user is enraged and it takes no damage from enrage.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 818 Tentalock  [composite-vanilla-mashup] pkrg=5519
  ABBR: Grappler + Serpent Bind.
  FULL: Trapping moves last 6 turns instead of 4-5 turns and increases their damage at the end of the turn to 1/6 max HP per turn. Gives attacks a 50% chance to trap the target for 6 turns, preventing escape or switching. Once trapped, their speed drops by one stage each turn they remain on the field.
  CODE: TrapDurationModifierAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"turns":6,"damageFraction":0.16666666666666666}} | ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=50,tags=["TRAPPED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 819 Serpent Bind  [bespoke] pkrg=5520
  ABBR: 50% chance to trap, then drop the their speed by -1 each turn.
  FULL: Gives attacks a 50% chance to trap the target for 4-5 turns, preventing escape or switching. Once trapped, their speed drops by one stage each turn they remain on the field.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=50,tags=["TRAPPED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 820 Soul Tap  [bespoke] pkrg=5521
  ABBR: Drain 10% HP from foes at the end of each turn in fog.
  FULL: While fog is active, drains 1/10 of each active opponent's max HP at the end of every turn and restores that amount to the user. Ignores Substitute.
  CODE: PostTurnDrainAbAttr{showAbility=true,extraCondition=undefined,fraction=0.1,weather=[6]}

### 821 Scarecrow  [composite-vanilla-mashup] pkrg=5522
  ABBR: Scare + Bad Luck.
  FULL: Upon entering battle, the user drops the Special Attack stat of all opposing Pokemon by one stage. Foes can not land critical hits, always roll minimum damage (85% instead of 85-100%), fail to inflict secondary effects that are not guaranteed, and have a 5% chance to miss a move.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[3],stages=-1,selfTarget=false,intimidate=true} | CritImmunityAbAttr{showAbility=false,extraCondition=undefined} | IgnoreMoveEffectsAbAttr{showAbility=false,extraCondition=undefined} | IncomingAccuracyMultiplierAbAttr{showAbility=false,extraCondition=undefined,multiplier=0.95,singleTargetOnly=false}

### 822 Ominous Shroud  [composite-vanilla-mashup] pkrg=5523
  ABBR: Phantom + Shadow Shield.
  FULL: Upon entering battle, adds Ghost to user's current typing. Retains Ghost typing even upon losing the ability, going away only when switching out. Halves damage from all attacks when at full HP. Multiplicative with other damage reduction sources.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":7},once=false} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 823 Chilling Presence  [bespoke] pkrg=5524
  ABBR: 10BP Icy Wind on entry.
  FULL: Uses a 10 BP Icy Wind (Ice, Special, Air-based) on entry, hitting all opponents and lowering their Speed by 1 stage.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":196,"power":10}}

### 824 Frostbind  [bespoke] pkrg=5525
  ABBR: Inflicting Frostbite also inflicts Disable.
  FULL: When inflicting frostbite, the user also inflicts disable. Disable prevents the target from using their last-used move for 4 turns. Fails if the target has not moved yet.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["DISABLED"],contactRequired=false,turns=undefined,filter=undefined,targetHasTag="ER_FROSTBITE",targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 825 Glacial Ghost  [composite-vanilla-mashup] pkrg=5526
  ABBR: Slush Rush + Snow Cloak.
  FULL: Boosts the Pokemon's Speed by 50% and reduces opponent accuracy by 25% during hail. Immune to hail damage.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=7,multiplier=1.2,condition=undefined} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[4]}

### 826 Tender Affection  [composite-vanilla-mashup] pkrg=5527
  ABBR: Cute Charm + Fairy STAB
  FULL: When hit by contact moves, has a 50% chance to infatuate the attacker (cuts their Attack and Special Attack in half). Also gives STAB to Fairy-type moves.
  CODE: PostDefendContactApplyTagChanceAbAttr{showAbility=true,extraCondition=undefined,chance=50,tagType="INFATUATED",turnCount=undefined} | PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=<fn>,effects=["INFATUATED"]} | StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=17,multiplier=1.5}

### 827 Wonder Scale  [composite-vanilla-mashup] pkrg=5528
  ABBR: Shed Skin + Wonder Skin
  FULL: At the end of each turn, there's a 30% chance for the user to cure status conditions afflicted on them. Immune to all damage boosting ability effects from opponents, other than Parental Bond and Multi-Headed.
  CODE: PostTurnResetStatusAbAttr{showAbility=true,extraCondition=<fn>,allyTarget=false,target=undefined} | WonderSkinAbAttr{showAbility=false,extraCondition=undefined} | PostDefendSuppressOpponentDamageBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.77}

### 828 Overzealous (N)  [bespoke] pkrg=5529
  ABBR: User's super-effective moves have +1 prio.
  FULL: Will not be implemented.
  CODE: SePriorityBonusAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1}

### 829 Stainless Steel  [composite-vanilla-mashup] pkrg=5530
  ABBR: Fort Knox + Steelworker.
  FULL: The user ignores most abilities that increase damage or hit additional times. Changes the user's Normal-type moves to Steel-type. If the user is Steel- type it resists Ghost and Steel, otherwise it gains Steel STAB.
  CODE: PostDefendSuppressOpponentDamageBoostAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.77} | MoveTypeChangeAbAttr{showAbility=false,extraCondition=undefined,newType=8,condition=<fn>} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 830 Temporal Rupture  [bespoke] pkrg=5531
  ABBR: Roar of Time is altered drastically.
  FULL: Roar of Time becomes a 100 BP +0 Priority attack that changes the target's Ability to Slow Start (halves attacking stats and speed for 5 turns) but no longer forces the target to switch.
  CODE: SetTargetAbilityOnMoveAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,moveId=459,abilityId=112}

### 831 Grass Flute  [bespoke] pkrg=5532
  ABBR: Sound moves inflict Fear.
  FULL: Sound moves inflict Fear on hit. Fear traps the target for 2 turns and they take 50% more damage. If forced out by moves like Whirlwind, the target loses Fear.
  CODE: ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["ER_FEAR"],contactRequired=false,turns=undefined,filter={"flag":4},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 832 Hemotoxin  [bespoke] pkrg=5533
  ABBR: Supresses abilities of the target when they're poisoned.
  FULL: Negates the opponent's ability and innates when the user successfully poisons them. Suppression wears off after they switch out.
  CODE: PostAttackContactSuppressTargetAbilityAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,requireTargetStatus=[1,2],contactOnly=true}

### 833 Harukaze  [bespoke] pkrg=5534
  ABBR: Setting Grassy Terrain sets Tailwind and vice versa.
  FULL: Sets Grassy Terrain when setting Tailwind, and sets Tailwind when setting Grassy Terrain. Does not refresh the duration in either case if one is already active.
  CODE: PostSummonStackSetEffectsAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,opts={"terrain":3,"tags":[{"type":"TAILWIND","turns":4,"side":0}]}}

### 834 Toxic Surge  [bespoke] pkrg=5535
  ABBR: sets Toxic Terrain on entry.
  FULL: Sets Toxic Terrain on switch-in for 8 turns (12 with Terrain Extender). While active, grounded Pokemon that aren't Poison or Steel-type take 1/16 max HP damage each turn, Poison- type moves deal 30% more damage, and Spikes are converted to Toxic Spikes.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-terrain","terrain":5,"turns":8},once=false}

### 835 Atlantic Ruler  [composite-vanilla-mashup] pkrg=5536
  ABBR: Aquatic Dweller + Swift Swim.
  FULL: Upon entering battle, adds Water to the user's current typing. Retains Water typing even upon losing the ability, going away only when switching out. Also boosts the power of Water-type moves by 50%. Boosts Speed by 50% during rain.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,type=10,highHpMultiplier=1.5,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined}

### 836 Biofilm  [bespoke] pkrg=5537
  ABBR: 50% spdef boost under Toxic Terrain.
  FULL: Boosts the user's Special Defense stat by 50% when in Toxic Terrain.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=4,multiplier=1.5,condition=undefined}

### 837 Chokehold  [bespoke] pkrg=5538
  ABBR: Binding moves lower speed and paralyze.
  FULL: When the user traps a target, they inflict paralysis and drop their speed by one stage once every turn while trapped.
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":5,"stages":-1}],filter=null}

### 838 Guardian Coat  [bespoke] pkrg=5539
  ABBR: Blocks weather dmg and powders. Takes -20% physical damage.
  FULL: Provides immunity to weather damage from Sandstorm and Hail, and blocks all powder moves including Sleep Powder, Stun Spore, Poison Powder, Spore, Cotton Spore, Rage Powder, Powder, and Magic Powder. Also reduces incoming physical  damage by 20%. Multiplicative with other damage reduction sources.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8,reductionAmount=0.2,filterSpec={"kind":"category","category":0}}

### 839 Neutralizing Fog  [bespoke] pkrg=5540
  ABBR: Uses Defog on entry.
  FULL: Uses Defog on switch in, clearing all entry hazards, screens, Safeguard, and Mist. Also lowers the opponent's evasion by one stage.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":432}}

### 840 Poison Quills  [composite-vanilla-mashup] pkrg=5541
  ABBR: Rough Skin + Poison Point.
  FULL: Damages attackers using contact moves for 1/8 of their max HP. Also has a 30% chance to inflict poison on contact moves, both when attacking and being attacked. Activates on every hit for multihitting moves.
  CODE: PostDefendContactDamageAbAttr{showAbility=true,extraCondition=undefined,damageRatio=8} | PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[1]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[1],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[1]}

### 841 Draconic Might  [composite-vanilla-mashup] pkrg=5542
  ABBR: Draconize + Half Drake.
  FULL: Converts all Normal-type moves into Dragon-type moves and grants STAB for Dragon-type moves. If the user is Dragon- type their Dragon moves deal neutral damage vs Fairy. On entry, adds Dragon to the user's current typing. Retains Dragon typing even upon losing the ability, going away only when switching out.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=15,condition=<fn>,source={"kind":"type","type":0},configuredNewType=15} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":15},once=false}

### 842 Festivities  [bespoke] pkrg=5543
  ABBR: Sound moves become dance moves and vice versa.
  FULL: Sound moves are also treated as dance moves, benefiting from Dancer-type abilities. Dancer moves are also treated as sound moves, benefiting from sound- based abilities.
  CODE: MoveFlagInjectionAbAttr{showAbility=false,extraCondition=undefined,injectFlag=4096,scope="sound-moves"} | PostDancingMoveAbAttr{showAbility=true,extraCondition=undefined}

### 843 Fey Flight  [bespoke] pkrg=5544
  ABBR: Adds Fairy-type and levitates.
  FULL: Upon entering battle, adds Fairy to the user's current typing. Retains Fairy typing even upon losing the ability, going away only when switching out. The user is immune to Ground-type moves and other ground effects such as Spikes and terrains. Boosts the damage of Flying-type moves by 25%.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":17},once=false} | AttackTypeImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneType=4,condition=null}

### 844 Best Offense  [composite-vanilla-mashup] pkrg=5545
  ABBR: Mystic blades + use 20% of spdef during moves.
  FULL: Keen Edge moves become Special (deal Special damage and use the Special Attack stat) and use 20% of the user's Special Defense stat for attack calculations.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=3,specialStat=undefined,contactOnly=false,flag=256,useHigherOffense=false} | StatBlendAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,appliesTo=[1,3],sourceStat=4,fraction=0.2}

### 845 Impaler  [composite-vanilla-mashup] pkrg=5546
  ABBR: Mighty Horn + 30% Bleed chance on horn moves.
  FULL: Boosts the power of horn and drill-based attacks by 30% and they have a 30% chance to inflict Bleed on the target. Bleeding causes 1/16 max HP damage per turn, prevents healing, and negates the effects of stat stages. Rock and Ghost types are immune to bleeding.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=67108864,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=30,tags=["ER_BLEED"],contactRequired=false,turns=undefined,filter={"flag":67108864},targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 846 Magus Blades  [composite-vanilla-mashup] pkrg=5547
  ABBR: Dual Wield + Best Offense.
  FULL: Keen Edge moves become Special (deal Special damage and use the Special Attack stat) and use 20% of the user's Special Defense stat for attack calculations. Also, Keen Edge moves hit twice, dealing 70% of the move's normal damage. Secondary effects roll independently for each hit (except flinch).
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={"flag":256}} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=3,specialStat=undefined,contactOnly=false,flag=256,useHigherOffense=false} | StatBlendAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,appliesTo=[1,3],sourceStat=4,fraction=0.2}

### 847 Lightning Born  [entry-effect] pkrg=5548
  ABBR: Adds Electric-type on entry.
  FULL: Upon entering battle, adds Electric to the user's current typing. Retains Electric typing even upon losing the ability, going away only when switching out.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":12},once=false}

### 848 Superheavy  [composite-vanilla-mashup] pkrg=5549
  ABBR: Steadfast + blocks phasing moves.
  FULL: Getting flinched raises Speed by one stage. Prevents forced switching from moves and Red Card.
  CODE: FlinchStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stats=[5],stages=1} | ForceSwitchOutImmunityAbAttr{showAbility=true,extraCondition=undefined}

### 849 World Serpent  [composite-vanilla-mashup] pkrg=5550
  ABBR: Long Reach + Grip Pincer.
  FULL: Physical non-contact moves deal 20% more damage. Contact moves have a 50% chance to trap the target for 4-5 turns.
  CODE: IgnoreContactAbAttr{showAbility=true,extraCondition=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=50,tags=["TRAPPED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 850 Lucky Wings  [composite-vanilla-mashup] pkrg=5551
  ABBR: Serene Grace + Giant Wings.
  FULL: Doubles the activation chance of the user's secondary effects on their attacks. Boosts the power of all wing, wind, and air-based moves by 30%.
  CODE: MoveEffectChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=2} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=1048576,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 851 Komodo  [bespoke] pkrg=5552
  ABBR: Adds Dragon-type + moves have 30% Bad Poison chance.
  FULL: Upon entering battle, adds Dragon to the user's current typing. Retains Dragon typing even upon losing the ability, going away only when switching out. The user has a 30% to badly poison the target after landing any move. Multihits roll the activation chance on each hit.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":15},once=false} | PostAttackApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=30,effects=[2]}

### 852 Envenom  [chance-status-on-hit] pkrg=5553
  ABBR: Moves have a 30% chance to poison the target.
  FULL: The user has a 30% to poison the target after landing any move. Multihits roll the activation chance on each hit.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=30,effects=[1],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined}

### 853 Purple Haze  [bespoke] pkrg=5554
  ABBR: Triggers a 20BP Poison Gas after using a move.
  FULL: After using a move, follow up with a 20 BP Poison Gas (Poison, Special, 20% chance to poison, super effective on Flying- types).
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":139}}

### 854 Gnashing Cannon  [composite-vanilla-mashup] pkrg=5555
  ABBR: Mega Launcher + Mind Crunch.
  FULL: Boosts pulse, beam, ball, and aura moves by 30%. Biting moves use the Special Attack (still targets enemy's Defense unless stated otherwise) and deal 30% more damage.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=32,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=3,specialStat=undefined,contactOnly=false,flag=32,useHigherOffense=false}

### 855 Hyper Cleanse  [bespoke] pkrg=5556
  ABBR: Immune to status. Halves poison damage taken.
  FULL: Immune to status. Halves poison damage taken.
  CODE: StatusEffectImmunityAbAttrEr{showAbility=true,extraCondition=undefined,immuneEffects=[],configuredStatuses=[]} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":3}}

### 856 Molten Coat  [composite-vanilla-mashup] pkrg=5557
  ABBR: Mineralize + Rock moves have 50% burn chance.
  FULL: Mineralize + Rock moves have 50% burn chance.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=5,condition=<fn>,source={"kind":"type","type":0},configuredNewType=5} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=50,effects=[6],contactRequired=false,contactExcluded=false,filter={"type":5},firstTurnChance=undefined}

### 857 Royal Decree  [composite-vanilla-mashup] pkrg=5558
  ABBR: Queenly Majesty + Glare on entry once per battle.
  FULL: Prevents the user and its ally from being targeted by priority moves with priority higher than 0. Use Glare on entry, paralyzing the target. Once per battle.
  CODE: FieldPriorityMoveImmunityAbAttr{showAbility=true,extraCondition=undefined} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"scripted-move","move":137},once=true}

### 858 Breezy Neigh  [stat-trigger-on-event] pkrg=5559
  ABBR: KOs raise Speed by one stage.
  FULL: Boosts the Pokemon's Speed by one stage when it causes an opponent to faint with a direct attack.
  CODE: StatTriggerOnKoAbAttr{showAbility=true,extraCondition=undefined,event="on-ko",stats=[{"stat":5,"stages":1}]}

### 859 Dreamscape  [composite-vanilla-mashup] pkrg=5560
  ABBR: Comatose + Dreamcatcher + Deal 20% more damage.
  FULL: Considers the user as asleep for moves and statuses. User can act normally and gains immunity to status conditions. Doubles the power of moves when any active Pokemon is asleep. Attacks hit sleeping foes who are switching out for 1x power instead, damaging them before leaving. Boosts damage by 20%.
  CODE: StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[1,2,3,4,5,6]} | BattlerTagImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneTagTypes=["DROWSY"]} | ConditionalDamageAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2,damageCondition={"kind":"target-statused","statuses":[4]},damageMultiplier=2} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2}

### 860 Haste Makes Waste  [composite-vanilla-mashup] pkrg=5561
  ABBR: Stall + Analytic.
  FULL: Reduces damage by 30% if the user has not moved yet. Multiplicative with other damage reduction sources. Works when the user switches in mid-turn. Boosts damage by 30% if the target has already moved this turn.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.7} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>}

### 861 Hungry Maws  [composite-vanilla-mashup] pkrg=5562
  ABBR: Strong Jaw + Jaws of Carnage.
  FULL: Bite and jaw moves are boosted by 30%. Restores 50% max HP when defeating foes with biting moves or 25% with other moves. Only activates when knocking out a target with a direct hit.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.5}

### 862 Thermal Slide  [bespoke] pkrg=5563
  ABBR: Ups speed by 50% in sun or hail.
  FULL: Boosts the Pokemon's Speed by 50% during hail or sun. Also grants immunity to hail damage.
  CODE: WeatherStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined,weathers=[1,8,4,5]}

### 863 Thermomancy  [composite-vanilla-mashup] pkrg=5564
  ABBR: Pyromancy + Cryomancy.
  FULL: Multiplies the chance of inflicting burn or frostbite by 5x on all moves. Does not interact with Flame Body or Freezing Point.
  CODE: StatusChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,status=6} | StatusChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,status=5}

### 864 Chuckster  [bespoke] pkrg=5565
  ABBR: Once per entry, take 1/2 damage and force-switch the target.
  FULL: Once per entry when receiving a contact move, gain 50% damage reduction and force out the attacker. Multiplicative with other sources of damage reduction.
  CODE: PostDamageForceSwitchAbAttr{showAbility=true,extraCondition=undefined,helper={"switchType":1},hpRatio=1}

### 865 Heat Sink  [type-resist-or-absorb] pkrg=5566
  ABBR: Redirects Fire moves. Absorbs them, ups highest Atk.
  FULL: Draws in Fire-type moves and gain immunity to them. Additionally, Fire-type moves boost the highest attacking stat of the user by one stage.
  CODE: TypeAbsorbStatBoostAbAttr{showAbility=true,extraCondition=undefined,immuneType=9,condition=null,stat=1,stages=1}

### 866 Relic Stone  [bespoke] pkrg=5567
  ABBR: Other battlers don't benefit from STAB.
  FULL: While the user is on field, every other Pokemon does not receive a STAB bonus from typing or abilities.
  CODE: StabSuppressAuraAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1}

### 867 Supercell  [composite-vanilla-mashup] pkrg=5568
  ABBR: Drizzle + Electro Surge.
  FULL: Summons rain and Electric Terrain upon entry, lasting 8 turns (12 with Damp Rock/Terrain Extender). Boosts Water moves by 50% and cuts Fire damage by 50%. Grounded Pokemon cannot fall asleep and Electric moves gain 30% power boost.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=2,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=2,erTurns=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-terrain","terrain":2,"turns":8},once=false}

### 868 Lightning Aspect  [bespoke] pkrg=5569
  ABBR: Absorbs electric moves then ups highest stat by +1.
  FULL: Absorbs Electric moves for immunity and boosts higher attacking stat by +1. Compares Attack vs Special Attack to determine boost target. Excellent for setup against Electric attacks while providing defensive immunity and offensive gains
  CODE: TypeImmunityStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,immuneType=12,condition=null,stat=3,stages=1}

### 869 Fire Aspect  [bespoke] pkrg=5572
  ABBR: Absorbs fire moves and always burns with fire.
  FULL: Creates Extremely Harsh Sunlight lasting until user switches. Nullifies all damaging Water moves. Fire moves gain 50% boost. Cannot be overridden except by other primal weather. Activates extra effects on sun related moves. Sets up a 3-turn Tailwind on entry. Doubles the Speed of all allies.
  CODE: TypeAbsorbHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=9,condition=null,healFraction=0.25}

### 870 Ice Plumes  [damage-reduction-generic] pkrg=5573
  ABBR: Halves damage taken by Special moves. Does NOT double SpDef.
  FULL: Boosts Speed by +2 stages when hit by Rock-type moves or when switching in with Stealth Rock present. Also, absorbs any Rock- type or Stealth Rock damage and heals for 25% of their max HP.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"category","category":1}}

### 871 Blistering Sun  [composite-vanilla-mashup] pkrg=5570
  ABBR: Desolate Land + Air Blower.
  FULL: The user gains immunity to Fire- type moves and they heal for 25% of their max HP when hit by them. Always burn with moves that can activate them.
  CODE: PostSummonWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=8} | PostBiomeChangeWeatherChangeAbAttr{showAbility=true,extraCondition=undefined,weatherType=8} | PreLeaveFieldClearWeatherAbAttr{showAbility=false,extraCondition=undefined,weatherType=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":366}}

### 872 Molten Core  [composite-vanilla-mashup] pkrg=5574
  ABBR: Furnace + Absorbs Rock-moves/Stealth Rocks.
  FULL: Boosts the user's Special Attack stat by 50%. Multiplicative with other damage boosts. Sets up Aurora Veil on entry, cutting physical and special damage recieved by half for your allies. Lasts 5 turns, or 8 turns with Light Clay. Immune to Hail damage.
  CODE: StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":5,"stages":2}],filter={"types":[5]}} | TypeAbsorbHealAbAttr{showAbility=true,extraCondition=undefined,immuneType=5,condition=null,healFraction=0.25}

### 873 Aurora's Gale  [composite-vanilla-mashup] pkrg=5571
  ABBR: Majestic Bird + North Wind.
  FULL: Halves all incoming Special Attack damage. Multiplicative with other sources of damage reduction.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1.5,condition=undefined} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-screen-or-room","tag":"AURORA_VEIL","turns":3},once=false} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[4]}

### 874 Winter Throne  [bespoke] pkrg=5575
  ABBR: 1/8 Damage each turn to non-ice. Heals Ice 1/8 each turn.
  FULL: All non-Ice-types lose 1/8 of their max HP at the end of each turn. Restores 1/8 max HP to Ice- types at the end of each turn.
  CODE: PostTurnHurtNonTypedAbAttr{showAbility=true,extraCondition=undefined,safeTypes=[14],damageFraction=0.125,requiredWeathers=null} | PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.125,conditionSpec={"kind":"self-type","type":14}}

### 875 Energy Tap  [lifesteal] pkrg=5576
  ABBR: Heals the user for 1/8 of the damage they deal.
  FULL: Heals the user for 1/8 of all damage they deal to opponents. Healing occurs immediately after damage is dealt. Minimum healing of 1 HP.
  CODE: LifestealOnHitAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,hitHealFraction=0.125,hitFilter={}}

### 876 Sludge Spit  [bespoke] pkrg=5577
  ABBR: follows up with 35BP Venom Bolt after using an attack.
  FULL: follows up with 35BP Venom Bolt after using an attack.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":124,"power":35}}

### 877 Swamp Thing  [bespoke] pkrg=5578
  ABBR: Sets the Swamp Pledge effect on entry.
  FULL: Sets the Swamp Pledge effect on entry.
  CODE: EntryArenaTagOnFoeSideAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,tag="GRASS_WATER_PLEDGE",turns=4}

### 878 Frosty Prescence  [bespoke] pkrg=5579
  ABBR: Uses Mist on entry.
  FULL: Uses Mist on entry.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":54}}

### 879 Chilling Pellets  [bespoke] pkrg=5580
  ABBR: Uses 13BP Icicle Spear when hit by contact.
  FULL: Uses 13BP Icicle Spear when hit by contact.
  CODE: CounterAttackOnHitAbAttr{showAbility=false,extraCondition=undefined,moveId=333,power=undefined,chance=100,filter={"contactRequired":true}}

### 880 Paint Shot  [bespoke] pkrg=5581
  ABBR: Mega launcher moves change the target's type to the move used.
  FULL: Mega launcher moves change the target's type to the move used.
  CODE: PostDefendChangeAttackerTypeAbAttr{showAbility=false,extraCondition=undefined,type="moveType",contactOnly=false,requireFlag=64,side="self"}

### 881 Stonecutter  [composite-vanilla-mashup] pkrg=5582
  ABBR: Fossilized + Rock moves ignore abilities.
  FULL: Fossilized + Rock moves ignore abilities.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=5,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":5}} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>}

### 882 Edgelord  [priority-modifier] pkrg=5583
  ABBR: First Keen Edge move each entry gets +1 priority. Resets on KO.
  FULL: First Keen Edge move each entry gets +1 priority. Resets on KO.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={},condition={"kind":"always"}}

### 883 Warmonger  [bespoke] pkrg=5584
  ABBR: Boosts the user's rock, steel, and fighting moves by 30%.
  FULL: Boosts the user's rock, steel, and fighting moves by 30%.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=5,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=8,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=1,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null}

### 884 Locust Swarm  [bespoke] pkrg=5585
  ABBR: Changes into Hivemind form until 1/4 HP or less.
  FULL: Changes into Hivemind form until 1/4 HP or less.
  CODE: HpThresholdFormChangeAbAttr{showAbility=false,extraCondition=undefined,hpThreshold=0.25,targetFormKey="hivemind",cureStatus=false}

### 885 Revelation  [bespoke] pkrg=5586
  ABBR: Changes into Revelation form until 1/4 HP or less.
  FULL: Changes into Revelation form until 1/4 HP or less.
  CODE: HpThresholdFormChangeAbAttr{showAbility=false,extraCondition=undefined,hpThreshold=0.25,targetFormKey="revelation",cureStatus=false}

### 886 Curse of Famine  [bespoke] pkrg=5587
  ABBR: Eats terrain, restores hp, and boosts a defense.
  FULL: Eats terrain, restores hp, and boosts a defense.
  CODE: PostSummonClearTerrainAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,onCleared=[{"stat":2,"stages":1}],byTerrain=[]}

### 887 Crystalline Armor  [crit-mod] pkrg=5588
  ABBR: Reflects stat drops and immune to critical hits.
  FULL: Reflects stat drops and immune to critical hits.
  CODE: CritImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 888 Soul Harvest  [bespoke] pkrg=5589
  ABBR: Fainted Pokemon increase your offenses and spdef by 5%.
  FULL: Fainted Pokemon increase your offenses and spdef by 5%.
  CODE: FaintCountTriggerAbAttr{showAbility=true,extraCondition=undefined} | PerFaintStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,perFaint=0.05} | PerFaintStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,perFaint=0.05} | PerFaintStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=4,multiplier=1,condition=undefined,perFaint=0.05}

### 889 Thick Blubber  [bespoke] pkrg=5590
  ABBR: Take 1/4 damage from fire and ice in return for having 1/2 speed.
  FULL: Take 1/4 damage from fire and ice in return for having 1/2 speed.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.25,reductionAmount=0.75,filterSpec={"kind":"move-type","type":9}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.25,reductionAmount=0.75,filterSpec={"kind":"move-type","type":14}} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=0.5,condition=undefined}

### 890 Craving  [bespoke] pkrg=5591
  ABBR: Eat a random berry at the end of the turn.
  FULL: Eats one of the following berries at end of turn: Sitrus, Liechi, Ganlon, Salac, Petaya, Apicot, Lansat, Starf, or a random pinch healing berry.
  CODE: PostTurnRestoreBerryAbAttr{showAbility=true,extraCondition=undefined,berriesUnderCap=undefined,procChance=<fn>}

### 891 Rat King  [bespoke] pkrg=5592
  ABBR: Allies with a BST below 400 get their stats boosted by 50%.
  FULL: Allies with a BST below 400 get their stats boosted by 50%.
  CODE: PersistentFieldAuraAbAttr{showAbility=false,extraCondition=undefined,stats=[1,2,3,4,5],multiplier=1.5,predicate=<fn>,includeSelf=false}

### 892 Crispy Cream  [bespoke] pkrg=5593
  ABBR: 30% to inflict burn/frostbite when hit by contact.
  FULL: 30% to inflict burn/frostbite when hit by contact.
  CODE: ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=15,effects=[6],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined} | ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=15,tags=["ER_FROSTBITE"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=undefined}

### 893 Deep Fried  [bespoke] pkrg=5594
  ABBR: Summons a sea of fire on entry.
  FULL: Summons a sea of fire on entry.
  CODE: EntryArenaTagOnFoeSideAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,tag="FIRE_GRASS_PLEDGE",turns=4}

### 894 Food Lovers  [composite-vanilla-mashup] pkrg=5595
  ABBR: Hospitality + Friend Guard.
  FULL: Hospitality + Friend Guard.
  CODE: PostSummonAllyHealAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,healRatio=4,showAnim=true} | AlliedFieldDamageReductionAbAttr{showAbility=true,extraCondition=undefined,damageMultiplier=0.5}

### 895 Lunar Wrath  [bespoke] pkrg=5596
  ABBR: After using a Ghost move, follow up with a 50BP Moongeist Beam.
  FULL: After using a Ghost move, follow up with a 50BP Moongeist Beam.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":714,"power":50,"typeFilter":[7]}}

### 896 Spyware  [bespoke] pkrg=5597
  ABBR: Sharply raises a stat based on foe's strong point.
  FULL: Sharply raises a stat based on foe's strong point.
  CODE: FoeStrongestStatSelfBoostAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,opts={"stages":2,"physicalCounter":2,"specialCounter":4}}

### 897 Virus  [chance-status-on-hit] pkrg=5598
  ABBR: Electric moves have 30% chance to poison as well.
  FULL: Electric moves have 30% chance to poison as well.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=30,effects=[1],contactRequired=false,contactExcluded=false,filter={"type":12},firstTurnChance=undefined}

### 898 Power Leak  [bespoke] pkrg=5599
  ABBR: When hit, set up Electric Terrain.
  FULL: When hit, set up Electric Terrain.
  CODE: SetTerrainOnHitAbAttr{showAbility=true,extraCondition=undefined,terrain=2,contactRequired=false}

### 899 Backup Power  [bespoke] pkrg=5600
  ABBR: Revives at 25% HP once after fainting in Electric Terrain.
  FULL: Revives at 25% HP once after fainting in Electric Terrain.
  CODE: PostFaintReviveAbAttr{showAbility=true,extraCondition=undefined,hpFraction=0.25,requireTerrain=[2],requireWeather=null}

### 900 Sand Fiend  [composite-vanilla-mashup] pkrg=5601
  ABBR: Sand Force + Sand Guard.
  FULL: Sand Force + Sand Guard.
  CODE: MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.3} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[3]} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"category-in-weather","category":1,"weather":3}}

### 901 Moustache  [composite-vanilla-mashup] pkrg=5602
  ABBR: Tangling Hair + Stamina.
  FULL: Tangling Hair + Stamina.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=-1,selfTarget=false,allOthers=false} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=2,stages=1,selfTarget=true,allOthers=false} | PostReceiveCritStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,stat=2,stages=12}

### 902 Depth Explorer  [composite-vanilla-mashup] pkrg=5603
  ABBR: Field Explorer + Illuminate.
  FULL: Field Explorer + Illuminate.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,flag=16777216,highHpMultiplier=1.5,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=undefined}

### 903 Dune Veil  [composite-vanilla-mashup] pkrg=5604
  ABBR: Desert Cloak + Self Sufficient.
  FULL: All allies become immune to status conditions and secondary effects from enemy moves while sand is active. Restores 1/16 of the Pokemon's maximum HP at the end of each turn.
  CODE: SandStatusImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[],condition=<fn>} | SandSecondaryEffectImmunityAbAttr{showAbility=false,extraCondition=undefined} | PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.0625,conditionSpec={"kind":"always"}}

### 904 Strong Foundation  [bespoke] pkrg=5605
  ABBR: Takes 1/2 Water and Ground dmg and can't be forced out.
  FULL: Takes 1/2 Water and Ground dmg and can't be forced out.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":10}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":4}} | ForceSwitchOutImmunityAbAttr{showAbility=true,extraCondition=undefined}

### 905 Fog Machine  [bespoke] pkrg=5606
  ABBR: When hit, Set up Eerie Fog.
  FULL: When hit, Set up Eerie Fog.
  CODE: SetFogOnHitAbAttr{showAbility=false,extraCondition=undefined}

### 906 Drop Blocks  [bespoke] pkrg=5607
  ABBR: When hit, set up spikes.
  FULL: When hit, set up spikes.
  CODE: SetArenaTagOnHitAbAttr{showAbility=true,extraCondition=undefined,tagType="SPIKES",turns=0,side="attacker",contactRequired=false}

### 907 Turf War  [bespoke] pkrg=5613
  ABBR: Destroys terrain and boosts highest stat on entry.
  FULL: Destroys terrain and boosts highest stat on entry.
  CODE: PostSummonClearTerrainAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,onCleared=[],byTerrain=[]} | SelfHighestStatBoostOnSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,candidates=[1,2,3,4,5],stages=1,weathers=undefined,terrains=undefined}

### 908 Greedy  [bespoke] pkrg=5610
  ABBR: Uses Thief when it loses an item.
  FULL: Uses Thief when it loses an item.
  CODE: PostItemLostScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,opts={"moveId":168}}

### 909 Lightsaber  [bespoke] pkrg=5611
  ABBR: Adds Fire-type. Keen Edge moves have 25% burn or paralysis.
  FULL: Adds Fire-type. Keen Edge moves have 25% burn or paralysis.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":9},once=false} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=25,effects=[6],contactRequired=false,contactExcluded=false,filter={"flag":256},firstTurnChance=undefined}

### 910 Loose Thorns  [bespoke] pkrg=5608
  ABBR: Sets Creeping Thorns when hit by contact.
  FULL: Sets Creeping Thorns when hit by contact.
  CODE: SetArenaTagOnHitAbAttr{showAbility=true,extraCondition=undefined,tagType="SPIKES",turns=0,side="attacker",contactRequired=true}

### 911 Musical Notes  [bespoke] pkrg=5609
  ABBR: Status moves become sound-based.
  FULL: Status moves become sound- based.
  CODE: MoveFlagInjectionAbAttr{showAbility=false,extraCondition=undefined,injectFlag=4,scope="status-moves"}

### 912 Laser Drill  [chance-status-on-hit] pkrg=5612
  ABBR: Horn moves have a 50% burn chance.
  FULL: Horn moves have a 50% burn chance.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=50,effects=[6],contactRequired=false,contactExcluded=false,filter={"flag":67108864},firstTurnChance=undefined}

### 913 Strikeout  [bespoke] pkrg=5614
  ABBR: Forces the foe out if they don't attack for 3 turns.
  FULL: Forces the foe out if they don't attack for 3 turns.
  CODE: ForceFoeOutOnInactivityAbAttr{showAbility=true,extraCondition=undefined,turns=3,helper={"switchType":1}}

### 914 Home Run  [bespoke] pkrg=5615
  ABBR: Landing a crit boosts your 3 lowest stats once per turn.
  FULL: Landing a crit boosts your 3 lowest stats once per turn.
  CODE: OnCritStatBoostLowestAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"n":3,"stages":1}}

### 915 Bruiser  [entry-effect] pkrg=5616
  ABBR: Adds Fighting type on entry.
  FULL: Adds Fighting type on entry.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":1},once=false}

### 916 Narcissist  [bespoke] pkrg=5617
  ABBR: When a stat is lowered, sharply raise both offenses.
  FULL: When a stat is lowered, sharply raise both offenses.
  CODE: PostStatStageChangeStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,statsToChange=[1,3],stages=2}

### 917 Let's Dance  [bespoke] pkrg=5618
  ABBR: Uses Teeter Dance on entry, Confusing the field.
  FULL: Uses Teeter Dance on entry, Confusing the field.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":298}}

### 918 Dragonfruit  [composite-vanilla-mashup] pkrg=5619
  ABBR: Half Drake + Rough Skin.
  FULL: Half Drake + Rough Skin.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":15},once=false} | PostDefendContactDamageAbAttr{showAbility=true,extraCondition=undefined,damageRatio=8}

### 919 Rocky Exterior  [entry-effect] pkrg=5621
  ABBR: Adds Rock type on entry.
  FULL: Adds Rock type on entry.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":5},once=false}

### 920 Lead Claws  [composite-vanilla-mashup] pkrg=5620
  ABBR: Tough Claws + Mineralize.
  FULL: Tough Claws + Mineralize.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=5,condition=<fn>,source={"kind":"type","type":0},configuredNewType=5} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 921 Flawless Precision  [bespoke] pkrg=5622
  ABBR: Fatal + Deadly Precision.
  FULL: Fatal + Deadly Precision.
  CODE: AlwaysHitAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>}

### 922 Chainsaw  [bespoke] pkrg=5625
  ABBR: Keen edge attacks lower defense by -1.
  FULL: Keen edge attacks lower defense by -1.
  CODE: StatDebuffOnFlagAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,flag=256,stat=2,stages=-1}

### 923 Galeforce Wings  [priority-modifier] pkrg=5626
  ABBR: Flying moves get +1 Priority.
  FULL: Flying moves get +1 Priority.
  CODE: PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={},condition={"kind":"always"}}

### 924 Empress  [composite-vanilla-mashup] pkrg=5628
  ABBR: Queenly Majesty + Rivalry.
  FULL: Queenly Majesty + Rivalry.
  CODE: FieldPriorityMoveImmunityAbAttr{showAbility=true,extraCondition=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=0.75}

### 925 Mashed Potato  [bespoke] pkrg=5627
  ABBR: Syrup Bomb effect on the foe for 3 turns.
  FULL: Syrup Bomb effect on the foe for 3 turns.
  CODE: PostSummonApplyTagOnFoesAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,opts={"tag":"SYRUP_BOMB","turns":3}}

### 926 Rainbow Scales  [composite-vanilla-mashup] pkrg=5629
  ABBR: Fire Scales + Taste the Rainbow.
  FULL: Fire Scales + Taste the Rainbow.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"category","category":1}} | PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={}}

### 927 Taste the Rainbow  [bespoke] pkrg=5631
  ABBR: Summons the Rainbow Pledge effect on entry.
  FULL: Summons the Rainbow Pledge effect on entry.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={}}

### 928 Hypnotic Touch  [chance-status-on-hit] pkrg=5630
  ABBR: 20% chance to sleep on contact. Also works on offense.
  FULL: 20% chance to sleep on contact. Also works on offense.
  CODE: ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=20,effects=[4],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined} | ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=20,effects=[4],contactRequired=true,contactExcluded=false,filter=undefined,firstTurnChance=undefined}

### 929 Hydra  [composite-vanilla-mashup] pkrg=5632
  ABBR: Multi-Headed + Hubris.
  FULL: Boosts the user's Special Attack by one stage whenever it knocks out an opponent with a direct hit. Attack 2-3 times per move based on number of heads. 1.25x total for 2 heads, 1.35x total for 3 heads.
  CODE: AddSecondStrikeAbAttr{showAbility=false,extraCondition=undefined} | AddSecondStrikeAbAttr{showAbility=false,extraCondition=undefined} | StatTriggerOnKoAbAttr{showAbility=true,extraCondition=undefined,event="on-ko",stats=[{"stat":3,"stages":1}]}

### 930 Wings of Pestilence  [bespoke] pkrg=5633
  ABBR: Every attack has a 20% Bleed chance and 10% Curse chance.
  FULL: Every attack has a 20% Bleed chance and 10% Curse chance.
  CODE: PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["ER_BLEED"]} | PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["CURSED"]}

### 931 Sundae  [composite-vanilla-mashup] pkrg=5634
  ABBR: Snow Warning + Ice Body.
  FULL: Snow Warning + Ice Body.
  CODE: ErWeatherSummonAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,weatherType=4,erTurns=8} | ErBiomeChangeWeatherAbAttr{showAbility=true,extraCondition=undefined,weatherType=4,erTurns=8} | AiMovegenMoveStatsAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | BlockWeatherDamageAttr{showAbility=false,extraCondition=undefined,weatherTypes=[4]} | PostWeatherLapseHealAbAttr{showAbility=true,extraCondition=undefined,weatherTypes=[4,5],healFactor=2}

### 932 Ice Picks  [composite-vanilla-mashup] pkrg=5690
  ABBR: Tough Claws + Slush Rush.
  FULL: Tough Claws + Slush Rush.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=undefined}

### 933 Hammer Fist  [bespoke] pkrg=5691
  ABBR: Boosts punch and hammer moves by 25%.
  FULL: Boosts punch and hammer moves by 25%.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25,flag=128,highHpMultiplier=1.25,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.25,flag=33554432,highHpMultiplier=1.25,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 934 Mach 3  [composite-vanilla-mashup] pkrg=5635
  ABBR: Deadly Precision + Slipstream.
  FULL: Deadly Precision + Slipstream.
  CODE: AlwaysHitAbAttr{showAbility=false,extraCondition=undefined,effect=<fn>} | MoveAbilityBypassAbAttr{showAbility=false,extraCondition=undefined,moveIgnoreFunc=<fn>} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={},sourceStat=5} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,bonusStat=3,speedFraction=0.2,bonusFilter={},sourceStat=5}

### 935 Raging Storm  [bespoke] pkrg=5636
  ABBR: Ups highest attacking stat by 1.5x in rain.
  FULL: Ups highest attacking stat by 1.5x in rain.
  CODE: SelfHighestStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1.5,condition=undefined,candidates=[1,3],mult=1.5,weathers=[2,7]}

### 936 Sumo Guard  [composite-vanilla-mashup] pkrg=5637
  ABBR: Juggernaut + Thick Fat.
  FULL: Juggernaut + Thick Fat.
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={"contact":"only"},sourceStat=2} | StatusEffectImmunityAbAttrEr{showAbility=true,extraCondition=undefined,immuneEffects=[3],configuredStatuses=[3]} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5}

### 937 Sumo Wrestler  [bespoke] pkrg=5638
  ABBR: Uses 20BP Circle Throw at the end of each 2nd turn.
  FULL: Uses 20BP Circle Throw at the end of each 2nd turn.
  CODE: PostTurnScriptedMoveAbAttr{showAbility=true,extraCondition=undefined,moveId=509,power=20,everyNTurns=2}

### 938 Cosmic Wings  [bespoke] pkrg=5639
  ABBR: Flying moves become Fairy-type.
  FULL: Flying moves become Fairy-type.
  CODE: TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=17,condition=<fn>,source={"kind":"type","type":2},configuredNewType=17}

### 939 Cosmic Dust  [composite-vanilla-mashup] pkrg=5640
  ABBR: Magic Guard + Cosmic Daze.
  FULL: Magic Guard + Cosmic Daze.
  CODE: BlockNonDirectDamageAbAttr{showAbility=false,extraCondition=undefined} | ConditionalDamageAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2,damageCondition={"kind":"target-confused"},damageMultiplier=2}

### 940 Cool Exit  [bespoke] pkrg=5641
  ABBR: Uses Chilly Reception at the end of your 2nd turn.
  FULL: Uses Chilly Reception at the end of your 2nd turn.
  CODE: PostTurnScriptedMoveAbAttr{showAbility=true,extraCondition=undefined,moveId=881,power=undefined,everyNTurns=2}

### 941 Devious Present  [bespoke] pkrg=5642
  ABBR: Boosts Ice and throwing moves by 50%.
  FULL: Boosts Ice and throwing moves by 50%.
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,type=14,highHpMultiplier=1.5,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,flag=536870912,highHpMultiplier=1.5,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 942 Christmas Nightmare  [bespoke] pkrg=5643
  ABBR: Enemies take 1/8 damage when in hail.
  FULL: Enemies take 1/8 damage when in hail.
  CODE: PostTurnHurtNonTypedAbAttr{showAbility=true,extraCondition=undefined,safeTypes=[],damageFraction=0.125,requiredWeathers=[4,5]}

### 943 Sap Trap  [bespoke] pkrg=5644
  ABBR: Lowers foe's speed at the end of turns. At -3 they get trapped.
  FULL: Lowers foe's speed at the end of turns. At -3 they get trapped.
  CODE: PostTurnFoeStatDropAbAttr{showAbility=true,extraCondition=undefined,opts={"stat":5,"stages":-1,"trapAtStage":-3}}

### 944 Dead Bark  [bespoke] pkrg=5645
  ABBR: Adds Ghost type. Takes 15% less damage. 30% less damage if SE.
  FULL: Adds Ghost type. Takes 15% less damage. 30% less damage if SE.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":7},once=false} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.85,reductionAmount=0.15,filterSpec={"kind":"all"}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8240000000000001,reductionAmount=0.176,filterSpec={"kind":"super-effective"}}

### 945 Echolocation  [bespoke] pkrg=5623
  ABBR: In fog, deal 20% more damage and never miss.
  FULL: In fog, deal 20% more damage and never miss.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | ConditionalAlwaysHitAbAttr{showAbility=false,extraCondition=undefined,opts={"weather":[6]}}

### 946 Massive Pelt  [composite-vanilla-mashup] pkrg=5624
  ABBR: Tangling Hair + Fluffy.
  FULL: Tangling Hair + Fluffy.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=-1,selfTarget=false,allOthers=false} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=2}

### 947 I Am Steve  [bespoke] pkrg=5646
  ABBR: Uses No Retreat on entry.
  FULL: Uses No Retreat on entry.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":748}}

### 948 Tangled Tails  [composite-vanilla-mashup] pkrg=5647
  ABBR: Know Your Place + Grappler.
  FULL: Landing contact moves causes the target to always move last regardless of priority, speed, or other effects for 5 turns. Effect does not stack or refresh on already afflicted targets. Trapping moves last 6 turns instead of 4-5 turns and increases their damage at the end of the turn to 1/6 max HP per turn.
  CODE: ContactQuashAbAttr{showAbility=false,extraCondition=undefined,stages=-6} | TrapDurationModifierAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"turns":6,"damageFraction":0.16666666666666666}}

### 949 Foamy Web  [bespoke] pkrg=5648
  ABBR: Casts an unremovable Sticky Web on entry. Lasts 5 turns.
  FULL: Sets Sticky Web on opponent's field when the user enters battle. Lasts 5 turns and lowers Speed by 1 stage for any grounded Pokemon switching in. Cannot activate if Sticky Web is already present on opponent's field.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":564}}

### 950 Sharp Talons  [bespoke] pkrg=5649
  ABBR: Kicking moves have a 50% Bleed chance.
  FULL: Kicking moves have a 50% Bleed chance.
  CODE: PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["ER_BLEED"]}

### 951 Zen Garden  [bespoke] pkrg=5650
  ABBR: Sets up Grassy or Psychic Terrain at random.
  FULL: Sets either Grassy or Psychic Terrain on entry with a 50% chance for either. Holding a Grassy Seed will guarantee Grassy Terrain while holding a Psychic Seed will guarantee Psychic Terrain.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-terrain-random","terrains":[3,4],"turns":8},once=false}

### 952 Tummyache  [composite-vanilla-mashup] pkrg=5651
  ABBR: Thick Fat + Corrosion.
  FULL: Thick Fat + Corrosion.
  CODE: ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | IgnoreTypeStatusEffectImmunityAbAttr{showAbility=false,extraCondition=undefined,statusEffect=[1,2],defenderType=[8,3]}

### 953 Hypnotic Trance  [bespoke] pkrg=5652
  ABBR: Hypnosis never misses and also causes Confusion.
  FULL: Hypnosis never misses and also causes Confusion.
  CODE: PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["CONFUSED"]}

### 954 Brain Overload  [bespoke] pkrg=5653
  ABBR: When hit, sets up Psychic Terrain.
  FULL: When hit, sets up Psychic Terrain.
  CODE: SetTerrainOnHitAbAttr{showAbility=true,extraCondition=undefined,terrain=4,contactRequired=false}

### 955 Brain Mass  [bespoke] pkrg=5654
  ABBR: Halves damage taken while at full HP.
  FULL: Halves damage taken while at full HP.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"full-hp"}}

### 956 Chestnut Shield  [composite-vanilla-mashup] pkrg=5655
  ABBR: Impenetrable + Bulletproof
  FULL: Impenetrable + Bulletproof
  CODE: BlockNonDirectDamageAbAttr{showAbility=false,extraCondition=undefined} | MoveImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneCondition=<fn>}

### 957 Chestnut Axe  [composite-vanilla-mashup] pkrg=5656
  ABBR: Keen edge + Grass moves become Keen Edge boosted.
  FULL: Keen edge + Grass moves become Keen Edge boosted.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 958 Giant Shuriken  [bespoke] pkrg=5657
  ABBR: Water Shuriken hits once with 100BP and +1 crit.
  FULL: Water Shuriken hits once with 100BP and +1 crit.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=6.67} | CritStageBonusAbAttr{showAbility=false,extraCondition=undefined,bonusAmount=1,bonusFilter={"moveIds":[594]}}

### 959 Rain Shroud  [bespoke] pkrg=5658
  ABBR: Ups evasion by 30% in rain.
  FULL: Ups evasion by 30% in rain.
  CODE: WeatherStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=7,multiplier=1.3,condition=undefined,weathers=[2,7]}

### 960 Witch Broom  [composite-vanilla-mashup] pkrg=5659
  ABBR: Hyper Aggressive + Hover.
  FULL: Hyper Aggressive + Hover.
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.25,condition=<fn>,powerMultiplier=0.25,powerFilter={}} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":13},once=false} | AttackTypeImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneType=4,condition=null}

### 961 Angelic Wings  [composite-vanilla-mashup] pkrg=5661
  ABBR: Prism Scales + Huge Wings.
  FULL: Prism Scales + Huge Wings.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.7,reductionAmount=0.3,filterSpec={"kind":"category","category":1}}

### 962 Wrestle Showman  [bespoke] pkrg=5662
  ABBR: Flying Press gains +10BP and causes Taunt.
  FULL: Flying Press gains +10BP and causes Taunt.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.1} | PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["TAUNT"]}

### 963 Fire Ruler  [composite-vanilla-mashup] pkrg=5663
  ABBR: King's Wrath + Flame Shield
  FULL: Boosts Attack and Defense when the user or their ally's stats are lowered. Reduces damage from super-effective attacks by 35%. Multiplicative with other sources of damage reduction.
  CODE: StatTriggerOnStatLoweredAbAttr{showAbility=true,extraCondition=undefined,event="on-stat-lowered",stats=[{"stat":1,"stages":1},{"stat":2,"stages":1}]} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65,reductionAmount=0.35,filterSpec={"kind":"super-effective"}}

### 964 Chandelier  [composite-vanilla-mashup] pkrg=5686
  ABBR: Illuminate + Pyromancy.
  FULL: Illuminate + Pyromancy.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=6,multiplier=1.2,condition=undefined} | StatusChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,status=6}

### 965 Foggy Eye  [bespoke] pkrg=5664
  ABBR: While in Fog, boost Ghost moves by 50% and resist Ghost moves.
  FULL: While in Fog, boost Ghost moves by 50% and resist Ghost moves.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":7}}

### 966 Toxic Shell  [composite-vanilla-mashup] pkrg=5665
  ABBR: Shell Armor + Poison Point.
  FULL: Shell Armor + Poison Point.
  CODE: BlockCritAbAttr{showAbility=false,extraCondition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8} | PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[1]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=10,effects=[1],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[1]}

### 967 Hand Barnacles  [composite-vanilla-mashup] pkrg=5666
  ABBR: Multi-Headed + Water STAB.
  FULL: Multi-Headed + Water STAB.
  CODE: AddSecondStrikeAbAttr{showAbility=false,extraCondition=undefined} | AddSecondStrikeAbAttr{showAbility=false,extraCondition=undefined} | StabAddAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetType=10,multiplier=1.5}

### 968 Voltron  [composite-vanilla-mashup] pkrg=5667
  ABBR: Metallic + Battle Armor.
  FULL: Metallic + Battle Armor.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":8},once=false} | BlockCritAbAttr{showAbility=false,extraCondition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8}

### 969 Fire's Wrath  [composite-vanilla-mashup] pkrg=5668
  ABBR: Intimidate + Scare; 10% burn chance on non contact moves.
  FULL: Intimidate + Scare; 10% burn chance on non contact moves.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[1],stages=-1,selfTarget=false,intimidate=true} | PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[3],stages=-1,selfTarget=false,intimidate=true}

### 970 Emperor's Wrath  [composite-vanilla-mashup] pkrg=5669
  ABBR: King's Wrath + Queen's Mourning.
  FULL: King's Wrath + Queen's Mourning.
  CODE: StatTriggerOnStatLoweredAbAttr{showAbility=true,extraCondition=undefined,event="on-stat-lowered",stats=[{"stat":1,"stages":1},{"stat":2,"stages":1}]} | StatTriggerOnStatLoweredAbAttr{showAbility=true,extraCondition=undefined,event="on-stat-lowered",stats=[{"stat":3,"stages":1},{"stat":4,"stages":1}]}

### 971 Lepidopteran  [composite-vanilla-mashup] pkrg=5670
  ABBR: Swarm + Unaware.
  FULL: Swarm + Unaware.
  CODE: LowHpMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=true,condition=<fn>,powerMultiplier=1.5} | MoveTypePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2} | IgnoreOpponentStatStagesAbAttr{showAbility=false,extraCondition=undefined,stats=[1,2,3,4,6,7]}

### 972 Break it Down  [bespoke] pkrg=5671
  ABBR: After using an attack, follow up with a 20BP Rapid Spin.
  FULL: After using an attack, follow up with a 20BP Rapid Spin.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":229,"power":20}}

### 973 Talon Trap  [bespoke] pkrg=5672
  ABBR: 50% chance to trap on contact. 100% if entered this turn.
  FULL: Has a 50% chance to trap the foe when making contact, on either offense or defense, as if by the move Snap Trap. If the user is switching in or gained the ability this turn, such as by mega evolving, the chance is increased to 100%.
  CODE: ChanceBattlerTagOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=50,tags=["TRAPPED"],contactRequired=true,turns=undefined,filter=undefined,firstTurnChance=100} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=50,tags=["TRAPPED"],contactRequired=true,turns=undefined,filter=undefined,targetHasTag=undefined,targetHasStatus=undefined,critRequired=false,firstTurnChance=100}

### 974 Backstreet Boy  [composite-vanilla-mashup] pkrg=5673
  ABBR: Striker + Kicking moves are Dance moves and vise-versa.
  FULL: Striker + Kicking moves are Dance moves and vise-versa.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=134217728,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 975 Backflip  [bespoke] pkrg=5674
  ABBR: After using a Dance move, follow up with a 50BP Chip Away.
  FULL: After using a Dance move, follow up with a 50BP Chip Away.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":498,"power":50,"flagFilter":4096}}

### 976 Crushing Jaw  [composite-vanilla-mashup] pkrg=5675
  ABBR: Strong Jaw + Biting moves have a 50% chance to lower defense.
  FULL: Strong Jaw + Biting moves have a 50% chance to lower defense.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 977 Eternal Flower  [bespoke] pkrg=5676
  ABBR: Reduces the stats of other Megas by 20%.
  FULL: Reduces the stats of other Megas by 20%.
  CODE: PersistentFieldAuraAbAttr{showAbility=false,extraCondition=undefined,stats=[1,2,3,4,5],multiplier=0.8,predicate=<fn>,includeSelf=false}

### 978 Nihil Blaster  [composite-vanilla-mashup] pkrg=5677
  ABBR: Aura Break + Mega Launcher.
  FULL: Aura Break + Mega Launcher.
  CODE: FieldMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=<fn>,condition=<fn>,powerMultiplier=0.5625} | FieldMoveTypePowerBoostAbAttr{showAbility=false,extraCondition=<fn>,condition=<fn>,powerMultiplier=0.5625} | PostSummonMessageAbAttr{showAbility=true,extraCondition=<fn>,activateOnGain=true,messageFunc=<fn>} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 979 Hollow Ice Zone  [bespoke] pkrg=5678
  ABBR: Ice-type moves apply Ice Statue and then make the user switch.
  FULL: The user's Ice-type moves apply the Ice Statue status to the target, making them Ice-type with no resistances or frostbite immunity. If Ice Statue is applied the user switches.
  CODE: PostAttackApplyBattlerTagAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,contactRequired=false,chance=<fn>,effects=["ER_FROSTBITE"]} | SelfSwitchOnMoveTypeAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,moveType=14,helper={"switchType":1}}

### 980 Overcast  [bespoke] pkrg=5679
  ABBR: Low Visibility + Sets Mist on entry.
  FULL: Low Visibility + Sets Mist on entry.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-weather","weather":6,"turns":8},once=false} | PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":54}}

### 981 Cryostasis  [composite-vanilla-mashup] pkrg=5680
  ABBR: Cryomancy + Frostbite causes flinching.
  FULL: Cryomancy + Frostbite causes flinching.
  CODE: StatusChanceMultiplierAbAttr{showAbility=false,extraCondition=undefined,chanceMultiplier=5,status=5} | ChanceBattlerTagOnAttackAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,chance=100,tags=["FLINCHED"],contactRequired=false,turns=undefined,filter=undefined,targetHasTag="ER_FROSTBITE",targetHasStatus=undefined,critRequired=false,firstTurnChance=undefined}

### 982 Flower Necklace  [bespoke] pkrg=5682
  ABBR: This Pokémon's SpDef gets a 1.5x boost in Grassy Terrain.
  FULL: This Pokémon's SpDef gets a 1.5x boost in Grassy Terrain.
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=<fn>,stat=4,multiplier=1.5,condition=undefined}

### 983 Mega Drill  [composite-vanilla-mashup] pkrg=5681
  ABBR: Mighty Horn + all Drill moves are 30% stronger.
  FULL: Mighty Horn + all Drill moves are 30% stronger.
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=67108864,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333}

### 984 Mucus Membrane  [composite-vanilla-mashup] pkrg=5683
  ABBR: Takes 30% less damage from attacks + Gooey
  FULL: Takes 30% less damage from attacks + Gooey
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=-1,selfTarget=false,allOthers=false} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.7,reductionAmount=0.3,filterSpec={"kind":"all"}}

### 985 Lucha Libre  [composite-vanilla-mashup] pkrg=5684
  ABBR: Dazzling + Defiant.
  FULL: Dazzling + Defiant.
  CODE: FieldPriorityMoveImmunityAbAttr{showAbility=true,extraCondition=undefined} | PostStatStageChangeStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,statsToChange=[1],stages=2}

### 986 Curlipede  [composite-vanilla-mashup] pkrg=5685
  ABBR: Let's Roll + Coil Up
  FULL: Let's Roll + Coil Up
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":111}} | PriorityModifierAbAttr{showAbility=false,extraCondition=undefined,moveFunc=<fn>,changeAmount=1,priorityDelta=1,filter={"flag":32},condition={"kind":"always"}}

### 987 Storm Cloud  [bespoke] pkrg=5660
  ABBR: Summon rain on entry for 8 turns. Gain Electric-type STAB.
  FULL: Summon rain on entry for 8 turns. Gain Electric-type STAB.
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"set-weather","weather":2,"turns":8},once=false} | EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":12},once=false}

### 988 Waterborne  [composite-vanilla-mashup] pkrg=5687
  ABBR: Aquatic + Adaptability
  FULL: Aquatic + Adaptability
  CODE: EntryEffectAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,effect={"kind":"add-self-type","type":10},once=false} | StabBoostAbAttr{showAbility=false,extraCondition=undefined}

### 989 Drakelp Head  [bespoke] pkrg=5688
  ABBR: Weakens first move taken and drops opponent's attack.
  FULL: Weakens first move taken and drops opponent's attack.
  CODE: TimeLimitedDamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,turns=1} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=-1,selfTarget=false,allOthers=false}

### 990 Polarity  [bespoke] pkrg=5689
  ABBR: Increases the party's highest stat by 30%
  FULL: Increases the party's highest stat by 30%
  CODE: PersistentFieldAuraAbAttr{showAbility=false,extraCondition=undefined,stats=[1,3,2,4,5],multiplier=1.3,predicate=<fn>,includeSelf=true}

### 991 Resilience  [bespoke] pkrg=5692
  ABBR: Heal 1/4 of max HP whenever below 1/2 health
  FULL: Heal 1/4 of max HP whenever below 1/2 health
  CODE: PassiveRecoveryAbAttr{showAbility=true,extraCondition=undefined,healFractionValue=0.25,conditionSpec={"kind":"hp-below-fraction","fraction":0.5}}

### 992 Going Berserk  [composite-vanilla-mashup] pkrg=5693
  ABBR: Berserk + Rampage
  FULL: Berserk + Rampage
  CODE: PostDefendHpGatedStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,hpGate=0.5,stats=[3],stages=1,selfTarget=true} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=1,selfTarget=true,allOthers=false} | PostVictoryClearTagAbAttr{showAbility=true,extraCondition=undefined,tags=["RECHARGING"]}

### 993 Thunder Clouds  [bespoke] pkrg=5694
  ABBR: After using a special move, launch a 35 BP Thunderbolt
  FULL: After using a special move, launch a 35 BP Thunderbolt
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":85,"categoryFilter":1}}

### 994 Unrelenting  [bespoke] pkrg=5695
  ABBR: All attacking moves can hit 2-5 times
  FULL: All attacking moves can hit 2-5 times
  CODE: MaxMultiHitAbAttr{showAbility=false,extraCondition=undefined}

### 995 Elemental Aegis  [bespoke] pkrg=5696
  ABBR: Takes 1/2 damage from Fire, Electric and Water-type attacks.
  FULL: Takes 1/2 damage from Fire, Electric and Water-type attacks.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":9}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":12}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":10}}

### 996 Aegis Ward  [bespoke] pkrg=5697
  ABBR: Takes 1/2 damage from Dark, Ghost and Psychic-type attacks.
  FULL: Takes 1/2 damage from Dark, Ghost and Psychic-type attacks.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":16}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":7}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":13}}

### 997 Shattered Armor  [composite-vanilla-mashup] pkrg=5698
  ABBR: Battle Armor + Scrapyard.
  FULL: Battle Armor + Scrapyard.
  CODE: BlockCritAbAttr{showAbility=false,extraCondition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8} | SetArenaTagOnHitAbAttr{showAbility=true,extraCondition=undefined,tagType="SPIKES",turns=0,side="attacker",contactRequired=true}

### 998 Acid Reflux  [bespoke] pkrg=5699
  ABBR: Uses 20BP Acid when it takes damage.
  FULL: Uses 20BP Acid when it takes damage.
  CODE: CounterAttackOnHitAbAttr{showAbility=false,extraCondition=undefined,moveId=51,power=undefined,chance=100,filter={}}

### 999 Ghost Frenzy  [composite-vanilla-mashup] pkrg=5700
  ABBR: Hyper Aggressive + Soul Eater.
  FULL: Hyper Aggressive + Soul Eater.
  CODE: HitMultiplierAbAttr{showAbility=true,extraCondition=undefined,extraStrikes=1,filter={}} | HitMultiplierPowerAbAttr{showAbility=false,extraCondition=undefined,damageMultiplier=0.25,condition=<fn>,powerMultiplier=0.25,powerFilter={}} | LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25}

### 1000 Survivor Bias  [bespoke] pkrg=5701
  ABBR: Not very effective moves can't cause fainting.
  FULL: Not very effective moves can't cause fainting.
  CODE: DamageCapOnResistAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=1}

### 1001 Bandit  [composite-vanilla-mashup] pkrg=5702
  ABBR: Scavenger + Technician.
  FULL: Scavenger + Technician.
  CODE: LifestealOnKoAbAttr{showAbility=true,extraCondition=undefined,koHealFraction=0.25} | ScavengerLootAbAttr{showAbility=true,extraCondition=undefined,lootChance=0.5,lootItem=undefined} | MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5}

### 1002 Fortress  [composite-vanilla-mashup] pkrg=5703
  ABBR: Filter + Shell Armor.
  FULL: Filter + Shell Armor.
  CODE: ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65} | BlockCritAbAttr{showAbility=false,extraCondition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8}

### 1003 Bird of Prey  [composite-vanilla-mashup] pkrg=5704
  ABBR: Big Pecks + Scrappy.
  FULL: Big Pecks + Scrappy.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | IgnoreTypeImmunityAbAttr{showAbility=false,extraCondition=undefined,defenderType=7,allowedMoveTypes=[0,1]} | IntimidateImmunityAbAttr{showAbility=false,extraCondition=undefined}

### 1004 Feathercoat  [bespoke] pkrg=5705
  ABBR: Takes 10% less damage from attacks, 20% if resisted.
  FULL: Takes 10% less damage from all attacks. Takes 20% less damage from resisted attacks.
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.9,reductionAmount=0.1,filterSpec={"kind":"all"}} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8889,reductionAmount=0.1111,filterSpec={"kind":"resisted"}}

### 1005 Power Outage  [bespoke] pkrg=5706
  ABBR: Boosts first Electric attack by 2x then loses Electric type.
  FULL: The first Electric Move will double in damage, but once used will lose its Electric typing.
  CODE: OneShotTypeBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=2,opts={"type":12,"factor":2}} | OneShotTypeBoostFollowupAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"type":12,"factor":2}}

### 1006 Electro Booster  [bespoke] pkrg=5707
  ABBR: Uses Magnet Rise on entry.
  FULL: Uses Magnet Rise on entry.
  CODE: PostSummonScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,activateOnGain=true,opts={"moveId":393}}

### 1007 Current Crash  [composite-vanilla-mashup] pkrg=5708
  ABBR: Reckless + Thundercall.
  FULL: Reckless + Thundercall.
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":84,"power":24,"typeFilter":[12]}}

### 1008 Daredevil  [bespoke] pkrg=5709
  ABBR: +1 Atk after using recoil move. 1/2 recoil damage.
  FULL: Boosts Attack stat by +1 after using a move that causes recoil damage. Takes 1/2 recoil damage.
  CODE: BlockRecoilDamageAttr{showAbility=false,extraCondition=undefined} | StatBoostOnFlagAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,flag=512,stat=1,stages=1}

### 1009 Frost Dragon  [bespoke] pkrg=5710
  ABBR: Triggers 50 BP Blizzard after using a Dragon or Ice-type move.
  FULL: Triggers 50 BP Blizzard after using a Dragon or Ice-type move.
  CODE: PostAttackScriptedMoveAbAttr{showAbility=false,extraCondition=undefined,attackCondition=<fn>,opts={"moveId":59,"power":50,"typeFilter":[15,14]}}

### 1010 Thermal Entropy  [composite-vanilla-mashup] pkrg=5711
  ABBR: Thermal Exchange + Heatproof.
  FULL: Thermal Exchange + Heatproof.
  CODE: PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=1,stages=1,selfTarget=true,allOthers=false} | StatusEffectImmunityAbAttr{showAbility=true,extraCondition=undefined,immuneEffects=[6]} | PostSummonHealStatusAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,immuneEffects=[6],statusHealed=undefined} | ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReduceBurnDamageAbAttr{showAbility=false,extraCondition=undefined,multiplier=0.5}

### 1011 Sinister Claws  [composite-vanilla-mashup] pkrg=5712
  ABBR: Mystic Blades + Keen Edge moves lower SpDef.
  FULL: Keen Edge attacks deal 1.3x damage and become special moves, using Special Attack and hitting Special Defense. They also lower the target's Special Defense by 1 stage (max once per turn per target).
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=256,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | AttackStatSubstituteAbAttr{showAbility=false,extraCondition=undefined,physicalStat=3,specialStat=undefined,contactOnly=false,flag=256,useHigherOffense=false} | StatChangeOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,stats=[4],stages=-1,selfTarget=false,flag=256,chance=100}

### 1012 Petal Shield  [bespoke] pkrg=5713
  ABBR: Maxes Def on entry. -1 Def when hit.
  FULL: Sets Defense to +6 when it enters. After it is hit lowers its Defense by 1 stage. Multi-hit attacks lower Defense multiple times.
  CODE: StatTriggerOnEntryAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,event="on-entry",stats=[{"stat":2,"stages":12}]} | StatTriggerOnHitAbAttr{showAbility=true,extraCondition=undefined,event="on-hit",stats=[{"stat":2,"stages":-1}],filter=null}

### 1013 Mob Boss  [composite-vanilla-mashup] pkrg=5714
  ABBR: Terrify + Deviate.
  FULL: Lowers the SpAtk of foes by 2 stages on entry. Changes the user's Normal-type moves to Dark-type. If the user is Dark- type its Dark-type moves have a 10% enrage chance, otherwise it gains Dark STAB.
  CODE: PostSummonStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,activateOnGain=true,stats=[3],stages=-2,selfTarget=false,intimidate=true} | TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=16,condition=<fn>,source={"kind":"type","type":0},configuredNewType=16} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 1014 Ghost Pepper  [chance-status-on-hit] pkrg=5715
  ABBR: Grass moves have a 30% to cause burn.
  FULL: Grass moves have a 30% to cause burn.
  CODE: ChanceStatusOnAttackAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,chance=30,effects=[6],contactRequired=false,contactExcluded=false,filter={"type":11},firstTurnChance=undefined}

### 1015 Droideka  [composite-vanilla-mashup] pkrg=5716
  ABBR: Heatproof + Shell Armor.
  FULL: Heatproof + Shell Armor.
  CODE: ReceivedTypeDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5} | ReduceBurnDamageAbAttr{showAbility=false,extraCondition=undefined,multiplier=0.5} | BlockCritAbAttr{showAbility=false,extraCondition=undefined} | ReceivedMoveDamageMultiplierAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8}

### 1016 3 > 1  [composite-vanilla-mashup] pkrg=5717
  ABBR: Multi-Headed + Riptide
  FULL: 
  CODE: AddSecondStrikeAbAttr{showAbility=false,extraCondition=undefined} | AddSecondStrikeAbAttr{showAbility=false,extraCondition=undefined} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=10,highHpMultiplier=1.3,lowHpMultiplier=1.8,lowHpThreshold=0.3333333333333333,weathers=null}

### 1017 Icicle Fist  [composite-vanilla-mashup] pkrg=5718
  ABBR: Iron Fist + 30% chance to cause frostbite with punches.
  FULL: 
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3}

### 1018 Abominable Monster  [bespoke] pkrg=5719
  ABBR: Ups SpDef by 1.5x in hail.
  FULL: 
  CODE: WeatherStatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=4,multiplier=1.5,condition=undefined,weathers=[4,5]}

### 1019 Wind Chimes  [composite-vanilla-mashup] pkrg=5720
  ABBR: Amplifier + attacks with 30 BP Hyper Voice when hit.
  FULL: 
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=4,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | CounterAttackOnHitAbAttr{showAbility=false,extraCondition=undefined,moveId=304,power=undefined,chance=100,filter={}}

### 1020 Unstable Core  [composite-vanilla-mashup] pkrg=5721
  ABBR: Power Core + Aftermath.
  FULL: 
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=1,multiplier=1,condition=undefined,bonusStat=1,speedFraction=0.2,bonusFilter={},sourceStat=2} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=3,multiplier=1,condition=undefined,bonusStat=3,speedFraction=0.2,bonusFilter={},sourceStat=4} | PostFaintDetonateAbAttr{showAbility=true,extraCondition=undefined,power=100,flinch=true,type=0}

### 1021 Aura Armor  [damage-reduction-generic] pkrg=5722
  ABBR: Takes 35% reduced damage.
  FULL: 
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.65,reductionAmount=0.35,filterSpec={"kind":"all"}}

### 1022 Deflect  [damage-reduction-generic] pkrg=5723
  ABBR: Counters with 20 BP Vacuum Wave when hit. Takes 20% less damage.
  FULL: 
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.8,reductionAmount=0.2,filterSpec={"kind":"all"}}

### 1023 Overwhelming Mind  [type-damage-boost] pkrg=5724
  ABBR: Boosts Psychic-type moves by 1.3x, or 1.8x when below 1/3 HP.
  FULL: 
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,type=13,highHpMultiplier=1.3,lowHpMultiplier=1.8,lowHpThreshold=0.3333333333333333,weathers=null}

### 1024 Duality  [composite-vanilla-mashup] pkrg=5725
  ABBR: Infiltrator + Competitive.
  FULL: 
  CODE: InfiltratorAbAttr{showAbility=false,extraCondition=undefined} | PostStatStageChangeStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,statsToChange=[3],stages=2}

### 1025 Reaper's Embarce  [composite-vanilla-mashup] pkrg=5727
  ABBR: Tough Claws + Foul Energy.
  FULL: 
  CODE: MovePowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3} | TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=16,highHpMultiplier=1.2,lowHpMultiplier=1.5,lowHpThreshold=0.3333333333333333,weathers=null}

### 1026 Foul Energy  [type-damage-boost] pkrg=5726
  ABBR: Boosts Dark-type moves by 1.2x, or 1.5x when under 1/3 HP.
  FULL: 
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=16,highHpMultiplier=1.2,lowHpMultiplier=1.5,lowHpThreshold=0.3333333333333333,weathers=null}

### 1027 Jungle Fever  [bespoke] pkrg=5728
  ABBR: If Grassy Terrain is active, gets a 1.5x Speed boost.
  FULL: 
  CODE: StatMultiplierAbAttr{showAbility=false,extraCondition=undefined,stat=5,multiplier=1.5,condition=<fn>}

### 1028 King of the Jungle  [bespoke] pkrg=5729
  ABBR: Infiltrator + deals 1.5x more damage to Grass-types.
  FULL: 
  CODE: InfiltratorAbAttr{showAbility=false,extraCondition=undefined} | OffensiveTypeMultiplierAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.5,targetDefenderType=11,multiplier=1.5}

### 1029 Warrior's Spear  [composite-vanilla-mashup] pkrg=5730
  ABBR: Mighty Horn + Fighting Spirit
  FULL: 
  CODE: FlagDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.3,flag=67108864,highHpMultiplier=1.3,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333} | TypeConversionAbAttr{showAbility=false,extraCondition=undefined,newType=1,condition=<fn>,source={"kind":"type","type":0},configuredNewType=1} | TypeConversionPowerBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,source={"kind":"type","type":0},multiplier=1.2}

### 1030 Sleek Scales  [bespoke] pkrg=5731
  ABBR: The Pokémon uses +15% of its Speed when defending.
  FULL: 
  CODE: SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=2,multiplier=1,condition=undefined,bonusStat=2,speedFraction=0.15,bonusFilter={},sourceStat=5} | SpeedBonusToStatAbAttr{showAbility=false,extraCondition=undefined,stat=4,multiplier=1,condition=undefined,bonusStat=4,speedFraction=0.15,bonusFilter={},sourceStat=5}

### 1031 Rock Armor  [damage-reduction-generic] pkrg=5732
  ABBR: Rocky Exterior + takes 10% less damage from attacks.
  FULL: 
  CODE: DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.9,reductionAmount=0.1,filterSpec={"kind":"all"}}

### 1032 Smoldering Wood  [composite-vanilla-mashup] pkrg=5733
  ABBR: Raw Wood + Flame Body.
  FULL: 
  CODE: TypeDamageBoostAbAttr{showAbility=false,extraCondition=undefined,skipDuringMovesetGen=false,condition=<fn>,powerMultiplier=1.2,type=11,highHpMultiplier=1.2,lowHpMultiplier=null,lowHpThreshold=0.3333333333333333,weathers=null} | DamageReductionAbAttr{showAbility=false,extraCondition=undefined,condition=<fn>,damageMultiplier=0.5,reductionAmount=0.5,filterSpec={"kind":"move-type","type":11}} | PostDefendContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,chance=30,effects=[6]} | ChanceStatusOnHitAbAttr{showAbility=true,extraCondition=undefined,chance=20,effects=[6],contactRequired=false,contactExcluded=true,filter=undefined,firstTurnChance=undefined} | PostAttackContactApplyStatusEffectAbAttr{showAbility=true,extraCondition=undefined,attackCondition=<fn>,contactRequired=true,chance=30,effects=[6]}

### 1033 Slime Mold  [composite-vanilla-mashup] pkrg=5734
  ABBR: Sticky Hold + Gooey.
  FULL: 
  CODE: BlockItemTheftAbAttr{showAbility=true,extraCondition=undefined} | PostDefendStatStageChangeAbAttr{showAbility=true,extraCondition=undefined,condition=<fn>,stat=5,stages=-1,selfTarget=false,allOthers=false}
