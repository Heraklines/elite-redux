# ER Ability Faithfulness — ACCURATE remaining-work list (current dispatcher)
# Rebuilt from EFFECTIVE (last) case blocks containing approximate/defer/SKIP/partial.
## PRIMITIVES BUILT/EXTENDED THIS AUDIT (reuse before building new):
##  - AllyAttackPowerBoostAbAttr (ally move-power aura, recoil variant)
##  - SelfDamageOnAttackAbAttr (recoil = fraction of damage-dealt OR maxHp; once-per-move for maxHp)
##  - OffensiveTypeChartOverrideAbAttr (holder's moveType vs defenderType -> set effectiveness; pierces immunity)
##  - AttackStatSubstituteAbAttr (use Def/SpDef/Spd etc. AS the attack stat; contactOnly option) <- reuse for any "uses X stat instead of Atk"
##  - ConditionalAlwaysHit: added `weather` gate
##  - CritStageBonus: added `moveIds` filter
##  - ChanceBattlerTagOnAttack: added `critRequired` gate
##  - EntryEffect: added `set-terrain-random` kind
##  - PostSummonClearTerrain: added `byTerrain` conditional stat
##  - PostFaintRevive already supports requireTerrain/requireWeather (Backup Power/Shallow Grave faithful)
##  - Status tags ER_BLEED/ER_FEAR now faithful; AttackTypeImmunityAbAttr = Levitate-style (Hover/Fey Flight)
## NEXT QUEUED: Bone Zone mis-wire (bone-move-id immunity-bypass + 2x NVE); then continue 82; then silent-approx semantic sweep.

# CAVEAT-SILENT: keyword-extraction (approximate/defer/SKIP/partial) MISSES silent approximations whose comment is descriptive (e.g. Lawnmower flat-ATK vs dex conditional Def/SpDef - now fixed). After clearing the 88, do a semantic wiredAttrs-vs-dex pass over remaining customs to catch silent ones.
# Everything NOT here is faithful. Mark [x] when fixed. Use detailed (#120) as spec where it lines up with dex.

## [x] Chloroplast (pkrg 5006 / er 268)
- dex : Weather Ball, Solar Beam/Blade, Growth act as if used in sun.
- det : Weather Ball doubles power and becomes Fire-type. Solar moves charge instantly. Growth boosts Attack and Special Attack by 2 stages. Moonlight, Morning Sun, and Synthesis recover 2
- wired: move-layer userActsInSun(user) hook (move.ts); ability is a pure marker (ok([]))
- FIXED: replaced the SpAtk×1.2 approx with the REAL per-move sun behaviors. New shared helper userActsInSun(user) (true for a Chloroplast holder in any weather) threaded into: WeatherInstantChargeAttr (Solar instant charge), GrowthStatStageChangeAttr (+2), WeatherBallTypeAttr (→Fire), PlantHealAttr (Moonlight/Synthesis/Morning Sun 2/3). Integration test er-chloroplast (2/2; control confirms non-holders unaffected). (Weather Ball power-doubling isn't modeled by this engine's Weather Ball even in real weather, so matching its type-only behavior is faithful here.)

## [x] Pyromancy (pkrg 5008 / er 270)  [APPROX (flat 30% burn). Real: multiply each move secondary burn chance x5. Needs effect-chance-multiplier hook.]
- dex : Moves inflict burn 5x as often.
- det : Pyromancy multiplies the burn chance of all moves by 5x. Does not interact with Flame Body.
- wired: PostAttackApplyStatusEffectAbAttr
- code : case 270: return ok([new PostAttackApplyStatusEffectAbAttr(false, 30, StatusEffect.BURN)]);

## [x] Sand Song (pkrg 5012 / er 274)
- dex : Sound moves get a 1.2x boost and become Ground if Normal.
- det : Sand Song boosts the power of all sound-based moves by 20% and converts Normal-type sound moves to Ground-type.
- wired: TypeConversionAbAttr,TypeConversionPowerBoostAbAttr (via type-conversion archetype dispatch; bespoke case correctly UNREACHABLE)
- VERIFIED: audit TSV confirms both attrs attached (sound→Ground if Normal + 1.2x all sound). Test er-sand-song (5/5). Already faithful — no rewire needed.

## [x] Ancient Idol (pkrg 5024 / er 286)  [APPROX: adds Def to Atk (over-stat) instead of REPLACING Atk with Def. Needs stat-substitution primitive.]
- dex : Uses Def and Sp. Def instead of Atk and Sp. Atk when attacking.
- det : Physical moves use the Defense stat of the user instead of Attack for damage, while special moves use the Special Defense stat of the user instead of Special Attack.
- wired: SpeedBonusToStatAbAttr,SpeedBonusToStatAbAttr
- code : case 286: return ok([ new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 1, sourceStat: Stat.DEF }), new SpeedBonusToStatAbAttr({ stat: Stat.SPATK, spe

## [x] Avenger (pkrg 5030 / er 292)
- dex : If a party Pokémon fainted last turn, next move gets 1.5x boost.
- det : Avenger boosts the power of all moves by 50% for one turn after any party Pokemon faints.
- wired: AllyFaintPowerBoostTrigger + AllyFaintPowerBoost(1.5) + AllyFaintPowerBoostExpire
- FIXED: replaced persistent +1 ATK/SPATK approx with faithful one-turn ×1.5 move-power boost (new primitive power-boost-on-ally-faint.ts: PostKnockOut arms 2-tick timer, MovePowerBoost reads it, PostTurn expires it). Test er-avenger (2/2). Engine note: PostKnockOut only sees on-field holders (reliable in doubles / faint-while-out).

## [x] Amphibious (pkrg 5035 / er 297)  [MAIN FAITHFUL (Water STAB). Secondary "cant be drenched" = ER DRENCHED tag not in pokerogue (engine-blocked).]
- dex : Water moves gain STAB. Can't become drenched.
- det : Grants STAB to Water-type moves regardless of the user's typing. Also provides immunity to being drenched.
- wired: StabAddAbAttr
- code : case 297: return ok([new StabAddAbAttr({ targetType: PokemonType.WATER })]);

## [x] Mountaineer (pkrg 5052 / er 314)  [MAIN FAITHFUL (Rock-move immunity). Secondary Stealth-Rock-damage immunity needs hazard-immunity hook.]
- dex : Immune to Rock-type attacks and Stealth Rock damage.
- det : Mountaineer grants immunity to all Rock-type moves and Stealth Rock entry hazard damage.
- wired: AttackTypeImmunityAbAttr
- code : case 314: return ok([new AttackTypeImmunityAbAttr(PokemonType.ROCK)]);

## [x] Juggernaut (pkrg 5059 / er 321)
- dex : Contact moves add 20% Def to attack. Paralysis-immune.
- det : Juggernaut boosts contact moves by adding 20% of the user's Defense stat to attack calculations. Prevents paralysis and immediately cures the status if inflicted on the user.
- wired: SpeedBonusToStatAbAttr
- code : case 321: return ok([ new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 0.2, sourceStat: Stat.DEF, filter: { contact: "only" }, }), ]);

## [x] Soul Linker (pkrg 5070 / er 332)  [APPROX (50% maxHP contact reflect). Real: reflect 100% of damage dealt/taken on direct hits both ways. Needs damage-reflect primitive.]
- dex : Enemies take all the damage they deal, same for this Pokémon.
- det : When the user takes a direct hit, the opponent takes identical damage. When landing a direct hit, the user also takes the same damage it inflicts. Does not activate when either Pok
- wired: PostDefendContactDamageAbAttr
- code : case 332: return ok([new PostDefendContactDamageAbAttr(2)]);

## [x] Sweet Dreams (pkrg 5071 / er 333)  [MAIN FAITHFUL (heal 1/8 asleep). Secondary Bad-Dreams immunity = edge hook.]
- dex : Heals 1/8 of max HP every turn if asleep. Immune to Bad Dreams.
- det : Sweet Dreams restores 1/8 of maximum HP at the end of each turn when the user is asleep or has the Comatose ability. Additionally, it grants immunity to Bad Dreams damage.
- wired: PassiveRecoveryAbAttr
- code : case 333: return ok([ new PassiveRecoveryAbAttr({ healFraction: 1 / 8, condition: { kind: "status", status: StatusEffect.SLEEP }, }), ]);

## [x] Fatal Precision (pkrg 5078 / er 340)
- dex : Super-effective moves never miss and always crit.
- det : Super-effective damaging moves never miss and always land critical hits.
- wired: ConditionalAlwaysHit({superEffective}) + ConditionalCrit(eff>1)
- FIXED: replaced ACC×2 + crit+1 approx with true SE gate — added superEffective option to conditional-always-hit (reads target.getMoveEffectiveness > 1) + Merciless-style ConditionalCrit gated on SE. Test er-fatal-precision (2/2).

## [x] Seaweed (pkrg 5080 / er 342)
- dex : Takes 1/2 dmg from Fire if Grass. Grass deals x2 dmg to Fire.
- det : If user is Grass-type, they take half damage from Fire-type attacks and deals 2x damage to Fire-type Pokemon with Grass- type moves. Multiplicative with other sources of damage red
- wired: OffensiveTypeMultiplierAbAttr,ReceivedTypeDamageMultiplierAbAttr
- code : case 342: return ok([ ...buildTypeEffectivenessModAttrs({ type: PokemonType.FIRE, offensiveMultiplier: 2.0, defensiveMultiplier: 0.5, }), ]);

## [x] Overcharge (pkrg 5087 / er 349)
- dex : Electric is super effective vs Electric. Can paralyze Electric.
- det : The user's Electric-type moves become effective against Electric-type Pokemon, dealing 2x damage instead of 0.5x. Also allows the user to paralyze Electric-types.
- wired: TypeChartOverrideAbAttr
- code : case 349: return ok([ new TypeChartOverrideAbAttr({ rules: [{ attackType: PokemonType.ELECTRIC, defenderType: PokemonType.ELECTRIC, newMultiplier: 2 }], }), ]);

## [x] Sage Power (pkrg 5090 / er 352)
- dex : Ups Special Attack by 50% and locks move.
- det : Boosts Special Attack by 50% but locks the user into using the first move selected until they switch out.
- wired: StatMultiplierAbAttr,GorillaTacticsAbAttr
- code : case 352: return ok([new StatMultiplierAbAttr(Stat.SPATK, 1.5), new GorillaTacticsAbAttr()]);

## [x] Bone Zone (pkrg 5091 / er 353)
- dex : Bone moves ignore immunities and deal 2x on not very effective.
- det : Bone moves bypass immunities and hit for normal damage, while resisted moves do 2x damage. Neutral/super effective moves remain unchanged.
- wired: BoneMoveTypeChartAbAttr
- FIXED: replaced the Ghost-only Scrappy-like wire with a BONE_BASED-flag type-chart override (new primitive bone-move-type-chart.ts + scan in getAttackTypeEffectiveness): 0x→1x (bypass any immunity), <1x→×2 (resisted doubled), neutral/SE unchanged. Test er-bone-zone (4/4).

## [x] Field Explorer (pkrg 5098 / er 360)
- dex : Boosts field moves by 50%. Cut, Surf, Strength etc.
- det : Boosts the power of moves that can be used in the overworld by 50%. Includes all HM moves, (Zen) Headbutt, Ice Spinner, Hidden/Secret Power, and Dig.
- wired: FlagDamageBoostAbAttr
- code : case 360: return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.FIELD_BASED, multiplier: 1.5 })]);

## [x] Momentum (pkrg 5109 / er 372)  [APPROX: adds Spd to Atk instead of using Spd as attack stat. Needs stat-substitution primitive.]
- dex : Contact moves use the Speed stat for damage calculation.
- det : Contact moves use Speed stat for damage instead of Attack/Special Attack. Choice Scarf does not affect this ability.
- wired: SpeedBonusToStatAbAttr
- code : case 372: return ok([ new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 1, filter: { contact: "only" }, }), ]);

## [x] Big Leaves (pkrg 5111 / er 374)
- dex : Chloroplast + Chlorophyll + Leaf Guard + Harvest + Solar Power.
- det : Activates any sun related effects for the user's moves. Boosts Speed stat by 50% in sun. Cures status in sun. 50% chance to restore berry on turn end, 100% in sun. Raises highest a
- wired: WeatherStatMultiplierAbAttr,StatMultiplierAbAttr,StatusEffectImmunityAbAttr,PostTurnRestoreBerryAbAttr,PostWeatherLapseDamageAbAttr,StatMultiplierAbAttr
- code : case 374: return SKIP_BESPOKE;

## [x] Precise Fist (pkrg 5112 / er 375)
- dex : Punching moves get +1 crit and 5x effect chance.
- det : Punching moves gain +1 critical hit stage and 5x their normal secondary effect chance.
- wired: CritStageBonusAbAttr
- code : case 375: return ok([new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.PUNCHING_MOVE } })]);

## [x] Artillery (pkrg 5114 / er 377)
- dex : Mega Launcher moves always hit and hit both foes.
- det : Mega Launcher moves always hit and strike both opposing Pokemon simultaneously. Unable to miss with pulse, beam, ball, aura, and other blast related moves.
- wired: ConditionalAlwaysHitAbAttr
- code : case 377: return ok([new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.PULSE_MOVE })]);

## [x] Pyro Shells (pkrg 5134 / er 397)
- dex : Triggers 50 BP Outburst after using a Mega Launcher move.
- det : Pyro Shells triggers a 50 BP Normal-type Outburst after any Mega Launcher-boosted move. Outburst has no secondary effects and hits all surrounding Pokemon on the field.
- wired: PostAttackScriptedMoveAbAttr
- code : case 397: return ok([ new PostAttackScriptedMoveAbAttr({ moveId: MoveId.OUTRAGE, flagFilter: MoveFlags.PULSE_MOVE, }), ]);

## [x] Roundhouse (pkrg 5139 / er 403)
- dex : Kicks always hit. Damages foes' weaker defenses.
- det : Roundhouse makes all kicking moves never miss and target the opponent's weaker defense stat.
- wired: ConditionalAlwaysHitAbAttr
- code : case 403: return ok([new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.KICKING_MOVE })]);

## [x] Desert Cloak (pkrg 5148 / er 412)
- dex : Protects its side from status and secondary effects in sand.
- det : All allies become immune to status conditions and secondary effects from enemy moves while sand is active.
- wired: SandStatusImmunityAbAttr + SandSecondaryEffectImmunityAbAttr
- FIXED: was CONFUSED-tag-only, no sand gate. New primitive sand-cloak.ts: side-wide ALL-status immunity (Flower-Veil-style ConditionalUserField) + Shield-Dust-style secondary-effect immunity, both gated on active sandstorm. Integration test er-desert-cloak (2/2: sand blocks PARALYSIS, no-sand allows it).

## [x] Hydro Circuit (pkrg 5159 / er 423)
- dex : Electric moves +50%; Water moves siphon 25% damage.
- det : Hydro Circuit boosts Electric- type moves by 50% and heals the user for 25% of damage dealt when using Water-type moves.
- wired: TypeDamageBoostAbAttr
- code : case 423: return ok([new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.5 })]);

## [x] Equinox (pkrg 5160 / er 424)
- dex : Boosts Atk or SpAtk to match the higher value.
- det : Equinox chooses the higher offensive stat for each attack. If Attack is higher, physical and special moves use your Attack stat. If Special Attack is higher, physical and special m
- wired: StatTriggerOnEntryAbAttr
- code : case 424: return ok([ new StatTriggerOnEntryAbAttr({ stats: [ { stat: Stat.ATK, stages: 1 }, { stat: Stat.SPATK, stages: 1 }, ], }), ]);

## [x] Cheating Death (pkrg 5163 / er 427)
- dex : Gets no damage for the first two hits.
- det : Negates the first two instances of damage received. Moves still connect and secondary effects apply, but damage becomes 0.
- wired: NullifyFirstNHitsAbAttr(2)
- FIXED: was endure-only (clamped lethal KOs). New primitive nullify-first-n-hits.ts (PreDefend) sets the first 2 damaging instances to 0 — moves still connect + secondary effects still apply. Test er-cheating-death (3/3).

## [x] Radiance (pkrg 5173 / er 437)
- dex : +20% accuracy; Dark moves fail when user is present.
- det : Radiance increases the user's accuracy by 20% for all moves and causes Dark moves to fail.
- wired: StatMultiplierAbAttr
- code : case 437: return ok([new StatMultiplierAbAttr(Stat.ACC, 1.2)]);

## [x] Cryomancy (pkrg 5187 / er 456)
- dex : Moves inflict frostbite 5x as often.
- det : Cryomancy multiplies the chance of inflicting frostbite by 5x on all moves.  Does not interact with Freezing Point.
- wired: PostAttackApplyStatusEffectAbAttr
- code : case 456: return ok([new PostAttackApplyStatusEffectAbAttr(false, 30, StatusEffect.FREEZE)]);

## [x] Jungle's Guard (pkrg 5194 / er 463)
- dex : Protects Grass-type allies from status and stat drops.
- det : Jungle's Guard shields the user+Grass-type allies from status conditions and stat drops while healing the user's status at the end of each turn during sun.
- wired: UserFieldStatusEffectImmunityAbAttr
- code : case 463: return ok([new UserFieldStatusEffectImmunityAbAttr()]);

## [x] Plasma Lamp (pkrg 5197 / er 466)
- dex : Boost accuracy & power of Fire & Electric type moves by 1.2x.
- det : Plasma Lamp boosts both power and accuracy of Fire and Electric-type moves by 20% each.
- wired: TypeDamageBoostAbAttr,TypeDamageBoostAbAttr
- code : case 466: return ok([ new TypeDamageBoostAbAttr({ type: PokemonType.FIRE, multiplier: 1.2 }), new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier

## [x] Generator (pkrg 5208 / er 477)
- dex : Charges up once on entry or when electric terrain is active.
- det : Generator charges up the user once upon switching in, doubling Electric-type move power for the next Electric attack. Recharge when Electric Terrain becomes active during battle. T
- wired: PostSummonAddBattlerTagAbAttr
- code : case 477: return ok([new PostSummonAddBattlerTagAbAttr(BattlerTagType.CHARGED, 0)]);

## [x] Moon Spirit (pkrg 5209 / er 478)
- dex : Fairy & Dark gains STAB. Moonlight recovers 75% HP.
- det : Moon Spirit grants STAB to all Fairy and Dark-type moves regardless of the user's typing. When using Moonlight, recovery increases to 75% max HP instead of normal 50% or weather- m
- wired: StabAddAbAttr,StabAddAbAttr
- code : case 478: return ok([ new StabAddAbAttr({ targetType: PokemonType.FAIRY }), new StabAddAbAttr({ targetType: PokemonType.DARK }), ]);

## [x] Sand Guard (pkrg 5213 / er 482)
- dex : Blocks priority and reduces special damage by 1/2 in sand.
- det : Sand Guard blocks priority moves and reduces Special Attack damage by 50% during a sandstorm. Multiplicative with other sources of damage reduction.
- wired: DamageReductionAbAttr
- code : case 482: return ok([ new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "category-in-weather", category: MoveCategory.SPECIAL, weather: WeatherType.SA

## [x] Arcane Force (pkrg 5224 / er 494)
- dex : All moves gain STAB. Ups “supereffective” by 10%.
- det : Grants the 1.5x STAB damage bonus to all moves regardless of type matching. Does not boost moves that already receive a STAB bonus. Additionally, boosts the power of super effectiv
- wired: StabAddAbAttr,SuperEffectiveMultiplierBoostAbAttr
- code : case 494: return ok([new StabAddAbAttr(), new SuperEffectiveMultiplierBoostAbAttr({ factor: 1.1 })]);

## [x] Permanence (pkrg 5261 / er 532)
- dex : Foes can't heal in any way.
- det : Prevents all opposing Pokemon from healing through any means. Blocks healing moves like Recover, absorbing moves like Drain Punch, passive healing from Leftovers and abilities like
- wired: ChanceBattlerTagOnHitAbAttr
- code : case 532: return ok([ new ChanceBattlerTagOnHitAbAttr({ chance: 100, tags: [BattlerTagType.HEAL_BLOCK], contactRequired: false, }), ]);

## [x] Parroting (pkrg 5272 / er 545)
- dex : Copies sound moves used by others.
- det : When any Pokemon on the field uses a sound move, this Pokemon immediately uses the same move after. Triggers once per move.
- wired: PostDancingMoveAbAttr
- code : case 545: return ok([new PostDancingMoveAbAttr()]);

## [x] Tactical Retreat (pkrg 5282 / er 564)
- dex : Flees when stats are lowered.
- det : Automatically switches the user out when any of its stats are lowered, including self drops. Triggers once per battle.
- wired: StatTriggerOnStatLoweredAbAttr
- code : case 564: return ok([ new StatTriggerOnStatLoweredAbAttr({ stats: [{ stat: Stat.SPD, stages: 2 }], }), ]);

## [x] Minion Control (pkrg 5299 / er 592)
- dex : Moves hit an extra time for each healthy party member.
- det : Moves hit an additional time for every healthy party member (max 6 hits). Members that are knocked out or have a status effect will not be counted. The first hit deals full damage 
- wired: AddSecondStrikeAbAttr
- code : case 592: return ok([new AddSecondStrikeAbAttr(false)]);

## [x] Desert Spirit (pkrg 5311 / er 604)
- dex : Summons sand on entry. Ground moves hit airborne in sand.
- det : Summons sandstorm on entry, lasting 8 turns (12 with Smooth Stone). During sandstorm, the user's Ground-type moves bypass immunity and hit airborne Pokemon with normal effectivenes
- wired: EntryEffect(SANDSTORM 8) + WeatherGroundAirborneAbAttr([SANDSTORM])
- FIXED: added the Ground-hits-airborne-in-sand half (new primitive weather-ground-airborne.ts + scan in getAttackTypeEffectiveness): Ground-vs-Flying 0x→1x while sand active. Integration test er-desert-spirit (2/2). (Levitate/Magnet-Rise airborne via the move-immunity path is a residual; type-chart Flying immunity is covered.)

## [x] Parasitic Spores (pkrg 5314 / er 609)
- dex : Deals 1/8 HP damage to non-Ghost. Spreads on contact.
- det : Gain parasitic spores on entry. Each turn, affected Pokemon lose 1/8 max HP (Ghost types immune). When using contact moves, spread spores to the target. Spores persist until switch
- wired: PostTurnHurtNonTypedAbAttr
- code : case 609: return ok([ new PostTurnHurtNonTypedAbAttr({ safeTypes: [PokemonType.GHOST], damageFraction: 1 / 8, }), ]);

## [x] Demolitionist (pkrg 5320 / er 616)
- dex : Readied Action + Ignores Protect + screens break on readied turn
- det : Increases the user's Attack stat by 2x, breaks screens, and ignores Protection effects for one turn. Multiplicative with other damage boosts. Reapplies after switching in.
- wired: FirstTurnStatMultiplierAbAttr,IgnoreProtectOnContactAbAttr
- code : case 616: return ok([ new FirstTurnStatMultiplierAbAttr({ stat: Stat.ATK, multiplier: 2.0 }), new IgnoreProtectOnContactAbAttr(), ]);

## [x] Battle Aura (pkrg 5341 / er 637)
- dex : Boosts each battler's crit rate by +2.
- det : Increases each Pokemon's critical hit stage by +2. Includes both allies and opponents.
- wired: CritStageBonusAbAttr
- code : case 637: return ok([new CritStageBonusAbAttr({ bonus: 2 })]);

## [x] On the Prowl (pkrg 5352 / er 648)
- dex : +1 priority for the first turn. Negative priority becomes +0.
- det : All moves with priority 0 or higher gain +1 priority on the user's first turn. Negative priority moves become priority 0 instead of adding +1 priority.
- wired: ChangeMovePriorityAbAttr
- code : case 648: return ok([new ChangeMovePriorityAbAttr(pokemon => pokemon.tempSummonData.waveTurnCount === 1, 1)]);

## [x] Pretentious (pkrg 5353 / er 649)
- dex : Dealing a KO raises Crit by one stage.
- det : Boosts the user's critical hit ratio by one stage whenever it knocks out an opponent with a direct hit.
- wired: StatTriggerOnKoAbAttr
- code : case 649: return ok([ new StatTriggerOnKoAbAttr({ stats: [ { stat: Stat.ATK, stages: 1 }, { stat: Stat.SPATK, stages: 1 }, ], }), ]);

## [x] Flammable Coat (pkrg 5373 / er 669)
- dex : Changes forms when using or hit by a Fire-type move.
- det : Transforms Lumbering Sloth into its Engulfed form when hit by Fire-type moves or when using Fire-type moves. Cannot be copied or suppressed.
- wired: DamageReductionAbAttr(Fire 0.5) + uncopiable/unsuppressable/unreplaceable builder flags
- DONE (engine-limited): "Cannot be copied or suppressed" implemented faithfully via builder flags (init-elite-redux-custom-abilities.ts, draft.id 669) + Fire damage halved in battle. FORM CHANGE is ENGINE-BLOCKED: ER's Engulfed is a SEPARATE species (SPECIES_LUMBERING_SLOTH_ENGULFED id 1847), not a form of Lumbering Sloth, and PokeRogue has no mid-battle species-swap mechanic (only intra-species form changes — cf. DNA Scramble which works because Deoxys forms exist). Test er-flammable-coat-mental-pollution (flags verified).

## [x] Blood Stain (pkrg 5377 / er 673)
- dex : Is always bleeding if not immune. Spreads on contact.
- det : Pokemon with this ability gain an unremovable bleed status condition. When the user makes contact offensively or defensively with another Pokemon who does not have this ability, it
- wired: PostSummonAddBattlerTag(ER_BLEED) + SelfPersistentBleed + ChanceBattlerTagOnHit + ChanceBattlerTagOnAttack
- FIXED: added (a) self-bleed on entry, (b) turn-end re-apply to stay bleeding (new primitive self-persistent-bleed.ts), (c) OFFENSIVE contact spread (was defensive-only). Test er-blood-stain (3/3).

## [x] Blood Stigma (pkrg 5378 / er 674)
- dex : Immune to status. Gets a 2x boost vs bleeding foes.
- det : Deal double damage to targets inflicted with bleeding and the user is immune to status effects.
- wired: StatusEffectImmunityAbAttrEr
- code : case 674: return ok([new StatusEffectImmunityAbAttrEr({ statuses: [] })]);

## [x] Sidewinder (pkrg 5380 / er 676)
- dex : First biting move each entry gets +1 priority. Resets on KO.
- det : On entry, gives +1 priority to the first biting move used. Priority boost is consumed after landing any biting move. Upon scoring a direct KO, regains priority buff.
- wired: ChangeMovePriorityAbAttr
- code : case 676: return ok([ new ChangeMovePriorityAbAttr( (pokemon, move) => pokemon.tempSummonData.waveTurnCount === 1 && move.hasFlag(MoveFlags.BITING_MOVE), 1, ), 

## [x] Restraining Order (pkrg 5393 / er 690)
- dex : Forces the attacker out when hit, once each switch-in.
- det : When the user is hit by a contact move, they force the attacker to switch out to a random ally. Once per switch in.
- wired: PostDamageForceSwitchAbAttr
- code : case 690: return ok([new PostDamageForceSwitchAbAttr(1.0)]);

## [x] Energized (pkrg 5402 / er 699)
- dex : Generator + charges up on KO with an Electric-type move.
- det : Charges up the user once upon switching in, doubling Electric- type move power for the next Electric attack. Recharge when Electric Terrain becomes active during battle. Charged st
- wired: PostSummonAddBattlerTagAbAttr
- code : case 699: return ok([new PostSummonAddBattlerTagAbAttr(BattlerTagType.CHARGED, 0)]);

## [x] From the Shadows (pkrg 5405 / er 702)
- dex : Attacks trap and have a 20% flinch chance when moving first.
- det : When the user moves first in a turn, attacks gain a 20% chance to flinch and trap the target on hit. The trap effect applies regardless of flinch success. Flinch chance only works 
- wired: MovingFirstTrapFlinchAbAttr(20)
- FIXED: was unconditional 20% flinch only. New primitive moving-first-trap-flinch.ts gates on moving-first (target.turnData.acted === false), traps the target on every such hit + rolls 20% flinch separately. Test er-from-the-shadows (4/4).

## [x] Lunar Affinity (pkrg 5414 / er 711)
- dex : Copies lunar moves used by others.
- det : Copies lunar moves when other Pokemon use them in battle. Includes Moonlight, Moonblast, Lunar Dance, and Lunar Blessing. Triggers once per move.
- wired: PostDancingMoveAbAttr
- code : case 711: return ok([new PostDancingMoveAbAttr()]);

## [x] Victory Bomb (pkrg 5431 / er 729)
- dex : Attacks with a 100BP Fire-type Explosion on fainting.
- det : When fainting, retaliate with a 100 BP Fire-type Explosion targeting all adjacent Pokemon. Cannot miss. Works regardless of how the user. was KOed.
- wired: OnFaintEffectAbAttr
- code : case 729: return ok([ new OnFaintEffectAbAttr({ effect: { kind: "attacker-damage-flat", maxHpFraction: 0.25 }, }), ]);

## [x] Life Steal (pkrg 5439 / er 737)
- dex : Steals 1/10 HP from foes each turn.
- det : Drains 1/10 of each active opponent's max HP at the end of every turn and restores that amount to the user. Ignores Substitute.
- wired: PostTurnScriptedMoveAbAttr
- code : case 737: return ok([new PostTurnScriptedMoveAbAttr({ moveId: MoveId.ABSORB, everyNTurns: 1 })]);

## [x] JunshiSanda (pkrg 5470 / er 769)
- dex : Punches and Kicks are both Punches and Kicks.
- det : Punching moves are also treated as kicking moves, benefiting from Striker-type abilities. Kicking moves are also treated as punching moves, benefiting from Iron Fist-type abilities
- wired: FlagDamageBoostAbAttr,FlagDamageBoostAbAttr
- code : case 769: return ok([ new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.15 }), new FlagDamageBoostAbAttr({ flag: MoveFlags.KICKING_MOVE, 

## [x] Corrupted Mind (pkrg 5475 / er 774)
- dex : Psychic moves ignore resists and get 1.4x effect chance.
- det : Psychic-type moves bypass type resistances and immunities, hitting for at least neutral damage regardless of the target's typing. Additionally, all secondary effects of Psychic mov
- wired: OffensiveTypeChartOverrideAbAttr
- code : case 774: return ok([ new OffensiveTypeChartOverrideAbAttr({ rules: [ { attackType: PokemonType.PSYCHIC, defenderType: PokemonType.STEEL, newMultiplier: 1 }, { 

## [x] Hemolysis (pkrg 5483 / er 782)
- dex : Poisoned foes lose all stat buffs and can't heal.
- det : When the user poisons a Pokemon, the poisoned target is cleared of all stat raises and they are unable to heal through any means.
- wired: PoisonedFoePurgeAbAttr
- FIXED: was a wrong defensive on-hit HEAL_BLOCK with no poison gate + no stat-clear. New primitive poisoned-foe-purge.ts (PostAttack): if target is POISON/TOXIC, zero all positive stat stages + apply HEAL_BLOCK. Test er-hemolysis (3/3).

## [x] Lullaby (pkrg 5487 / er 786)
- dex : Sing accuracy is 90% when used by this Pokémon.
- det : Boosts Sing's accuracy to 90%. Does not lock to accuracy to 90%, the move still gets affected by accuracy/evasiveness changes.
- wired: StatMultiplierAbAttr
- code : case 786: return ok([new StatMultiplierAbAttr(Stat.ACC, 1.5)]);

## [x] DNA Scramble (pkrg 5492 / er 791)
- dex : Changes forms based on the the move used.
- det : Transforms Deoxys between forms based on the move used. Damaging moves trigger Attack form, Recover triggers Defense form, other status moves trigger Speed form. Form changes occur
- wired: data-driven Deoxys form-change table (PreMove triggers gated on hasAbility), ability is a pure marker (ok([]))
- FIXED: replaced the 1.2x-all-moves approx with the REAL form change (Aegislash Stance-Change pattern): added 9 Deoxys SpeciesFormChange entries in pokemon-forms.ts — Damaging→Attack, Recover→Defense, other-status→Speed, gated on hasAbility(DNA_SCRAMBLE). Integration test er-dna-scramble (2/2: Tackle→attack form, Harden→speed form, real mid-battle form change).

## [x] Woodland Curse (pkrg 5508 / er 807)
- dex : Uses Forest's Curse on Entry. Adds Grass type on contact.
- det : Upon entering battle, uses Forest's Curse on a random opponent, adding Grass typing. When opponents make contact with the user, they also gain Grass as an extra type. Only affects 
- wired: EntryEffect(FORESTS_CURSE) + AddTypeToAttackerOnContact(GRASS)
- FIXED: added the add-Grass-on-contact half (new primitive add-type-to-attacker-on-contact.ts; sets attacker summonData.addedType via the Forest's-Curse mechanism, skips tera/already-Grass). Test er-woodland-curse (3/3).

## [x] Mental Pollution (pkrg 5517 / er 816)
- dex : Suppresses others' abilities when it becomes enraged.
- det : Applies ability suppression to other Pokemon when the user becomes enraged. Suppression lasts while those Pokemon remain on the field. Pokemon with Mental Pollution are unaffected.
- wired: SuppressAttackerAbilityAbAttr({ weathers: [FOG] })
- DONE (engine-limited): added a weather gate to the suppress primitive and gated on FOG — the established ER "enraged" proxy in this codebase (Madness Enhancement 817 uses the same fog=enrage convention). While fog is active, attacking foes have their ability suppressed for the battle. A true global "enraged" status doesn't exist in the engine; fog is the consistent stand-in. Test er-flammable-coat-mental-pollution (canApply true in fog / false otherwise).

## [x] Soul Tap (pkrg 5521 / er 820)
- dex : Drain 10% HP from foes at the end of each turn in fog.
- det : While fog is active, drains 1/10 of each active opponent's max HP at the end of every turn and restores that amount to the user. Ignores Substitute.
- wired: PostTurnScriptedMoveAbAttr
- code : case 820: return ok([new PostTurnScriptedMoveAbAttr({ moveId: MoveId.ABSORB, everyNTurns: 1 })]);

## [x] Temporal Rupture (pkrg 5531 / er 830)
- dex : Roar of Time is altered drastically.
- det : Roar of Time becomes a 100 BP +0 Priority attack that changes the target's Ability to Slow Start (halves attacking stats and speed for 5 turns) but no longer forces the target to s
- wired: SetTargetAbilityOnMoveAbAttr(ROAR_OF_TIME → SLOW_START)
- FIXED: replaced the 1.5x-boost approx with the signature rider — on hitting with Roar of Time, set the target's ability to Slow Start (new primitive set-target-ability-on-move.ts via setTempAbility). Test er-temporal-rupture (4/4). (BP/priority/no-recharge stat tweaks are Roar-of-Time move-data, separate from the ability.)

## [x] Chokehold (pkrg 5538 / er 837)
- dex : Binding moves lower speed and paralyze.
- det : When the user traps a target, they inflict paralysis and drop their speed by one stage once every turn while trapped.
- wired: StatTriggerOnHitAbAttr
- code : case 837: return ok([new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.SPD, stages: -1 }] })]);

## [x] Guardian Coat (pkrg 5539 / er 838)
- dex : Blocks weather dmg and powders. Takes -20% physical damage.
- det : Provides immunity to weather damage from Sandstorm and Hail, and blocks all powder moves including Sleep Powder, Stun Spore, Poison Powder, Spore, Cotton Spore, Rage Powder, Powder
- wired: DamageReductionAbAttr
- code : case 838: return ok([ new DamageReductionAbAttr({ reduction: 0.2, filter: { kind: "category", category: MoveCategory.PHYSICAL }, }), ]);

## [x] Festivities (pkrg 5543 / er 842)
- dex : Sound moves become dance moves and vice versa.
- det : Sound moves are also treated as dance moves, benefiting from Dancer-type abilities. Dancer moves are also treated as sound moves, benefiting from sound- based abilities.
- wired: MoveFlagInjection(DANCE_MOVE, "sound-moves") + PostDancingMoveAbAttr
- FIXED (Sound→Dance half): added "sound-moves" injection scope so the holder's sound moves carry DANCE_MOVE (trigger Dancer via doesFlagEffectApply) + holder dances. Test er-festivities (3/3). Dance→Sound half ENGINE-BLOCKED: sound consumers (Soundproof/Punk Rock) read the static hasFlag, which AbAttr injection cannot reach (same limitation as Reverberate).

## [x] Chuckster (pkrg 5565 / er 864)
- dex : Once per entry, take 1/2 damage and force-switch the target.
- det : Once per entry when receiving a contact move, gain 50% damage reduction and force out the attacker. Multiplicative with other sources of damage reduction.
- wired: PostDamageForceSwitchAbAttr
- code : case 864: return ok([new PostDamageForceSwitchAbAttr(1.0)]);

## [x] Molten Core (pkrg 5574 / er 872)
- dex : Furnace + Absorbs Rock-moves/Stealth Rocks.
- det : Boosts the user's Special Attack stat by 50%. Multiplicative with other damage boosts. Sets up Aurora Veil on entry, cutting physical and special damage recieved by half for your a
- wired: StatTriggerOnHitAbAttr,TypeAbsorbHealAbAttr
- code : case 872: // Molten Core: "Absorbs Rock-moves/Stealth Rocks" — Rock-move absorb return [new TypeAbsorbHealAbAttr({ type: PokemonType.ROCK })];

## [x] Winter Throne (pkrg 5575 / er 874)
- dex : 1/8 Damage each turn to non-ice. Heals Ice 1/8 each turn.
- det : All non-Ice-types lose 1/8 of their max HP at the end of each turn. Restores 1/8 max HP to Ice- types at the end of each turn.
- wired: PostTurnHurtNonTypedAbAttr,PassiveRecoveryAbAttr
- code : case 874: return ok([ new PostTurnHurtNonTypedAbAttr({ safeTypes: [PokemonType.ICE], damageFraction: 1 / 8, }), new PassiveRecoveryAbAttr({ healFraction: 1 / 8,

## [x] Swamp Thing (pkrg 5578 / er 877)
- dex : Sets the Swamp Pledge effect on entry.
- det : Sets the Swamp Pledge effect on entry.
- wired: EntryArenaTagOnFoeSide(GRASS_WATER_PLEDGE)
- FIXED: was a wrong GRASSY_TERRAIN scripted move. New primitive entry-arena-tag-on-foe-side.ts drops the real Grass+Water pledge (swamp, quarters Speed) on the foes' side. Integration test er-pledge-entry (verified tag on enemy side).

## [x] Soul Harvest (pkrg 5589 / er 888)
- dex : Fainted Pokemon increase your offenses and spdef by 5%.
- det : Fainted Pokemon increase your offenses and spdef by 5%.
- wired: FaintCountTrigger + PerFaintStatMultiplier(ATK/SPATK/SPDEF, 0.05)
- FIXED: replaced +1-stage approx with faithful per-faint ×1.05 stat multiplier on ATK/SPATK/SPDEF (new primitive stat-multiplier-per-faint.ts; counts every faint via PostKnockOut). Test er-soul-harvest (3/3). Removed now-orphaned PostAllyFaintStatChange import.

## [x] Deep Fried (pkrg 5594 / er 893)
- dex : Summons a sea of fire on entry.
- det : Summons a sea of fire on entry.
- wired: EntryArenaTagOnFoeSide(FIRE_GRASS_PLEDGE)
- FIXED: was a wrong SUNNY-weather approx. New primitive drops the real Fire+Grass pledge sea-of-fire (damages non-Fire each turn) on the foes' side. Integration test er-pledge-entry (verified tag on enemy side).

## [x] Turf War (pkrg 5613 / er 907)
- dex : Destroys terrain and boosts highest stat on entry.
- det : Destroys terrain and boosts highest stat on entry.
- wired: SelfHighestStatBoostOnSummonAbAttr
- code : case 907: return ok([ new SelfHighestStatBoostOnSummonAbAttr({ candidates: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD], stages: 1, }), ]);

## [x] Lightsaber (pkrg 5611 / er 909)
- dex : Adds Fire-type. Keen Edge moves have 25% burn or paralysis.
- det : Adds Fire-type. Keen Edge moves have 25% burn or paralysis.
- wired: EntryEffectAbAttr,ChanceStatusOnAttackAbAttr
- code : case 909: // Lightsaber: "Adds Fire-type. Keen Edge moves 25% burn or paralysis." return [ new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FIRE

## [x] Musical Notes (pkrg 5609 / er 911)
- dex : Status moves become sound-based.
- det : Status moves become sound- based.
- wired: MoveFlagInjectionAbAttr(SOUND_BASED, "status-moves")
- FIXED: was a wrong 1.3x status-power approx. Generalized doesFlagEffectApply's injection scan to SOUND_BASED + routed Move.hitsSubstitute's sound check through that user-aware path, then inject SOUND on the holder's status moves (new "status-moves" scope). The holder's status moves now hit through Substitute like native sound moves. Test er-musical-notes (2/2). (Soundproof/Punk Rock still read static hasFlag — native-sound-only — but the substitute-bypass mechanic is now faithful.)

## [x] Strikeout (pkrg 5614 / er 913)
- dex : Forces the foe out if they don't attack for 3 turns.
- det : Forces the foe out if they don't attack for 3 turns.
- wired: ForceFoeOutOnInactivityAbAttr(3)
- FIXED: was mis-wired to a SPD-drop approx. New primitive force-foe-out-on-inactivity.ts tracks each foe's consecutive idle (no damaging move) turns via move-history snapshots; force-switches at 3. Test er-strikeout (3/3).

## [x] Hydra (pkrg 5632 / er 929)
- dex : Multi-Headed + Hubris.
- det : Boosts the user's Special Attack by one stage whenever it knocks out an opponent with a direct hit. Attack 2-3 times per move based on number of heads. 1.25x total for 2 heads, 1.3
- wired: AddSecondStrikeAbAttr,AddSecondStrikeAbAttr,StatTriggerOnKoAbAttr
- code : case 929: return SKIP_BESPOKE;

## [x] Zen Garden (pkrg 5650 / er 951)
- dex : Sets up Grassy or Psychic Terrain at random.
- det : Sets either Grassy or Psychic Terrain on entry with a 50% chance for either. Holding a Grassy Seed will guarantee Grassy Terrain while holding a Psychic Seed will guarantee Psychic
- wired: EntryEffectAbAttr
- code : case 951: return ok([new EntryEffectAbAttr({ kind: "set-terrain", terrain: TerrainType.GRASSY, turns: 8 })]);

## [x] Hypnotic Trance (pkrg 5652 / er 953)
- dex : Hypnosis never misses and also causes Confusion.
- det : Hypnosis never misses and also causes Confusion.
- wired: PostAttackApplyBattlerTagAbAttr
- code : case 953: return ok([new PostAttackApplyBattlerTagAbAttr(false, () => 30, BattlerTagType.CONFUSED)]);

## [x] Chestnut Axe (pkrg 5656 / er 957)
- dex : Keen edge + Grass moves become Keen Edge boosted.
- det : Keen edge + Grass moves become Keen Edge boosted.
- wired: FlagDamageBoostAbAttr,MoveTypePowerBoostAbAttr
- code : case 957: // Chestnut Axe: "Keen edge + Grass moves become Keen Edge boosted" return [new MoveTypePowerBoostAbAttr(PokemonType.GRASS, 1.5)]; default: return [];

## [x] Talon Trap (pkrg 5672 / er 973)
- dex : 50% chance to trap on contact. 100% if entered this turn.
- det : Has a 50% chance to trap the foe when making contact, on either offense or defense, as if by the move Snap Trap. If the user is switching in or gained the ability this turn, such a
- wired: ChanceBattlerTagOnHitAbAttr
- code : case 973: return ok([ new ChanceBattlerTagOnHitAbAttr({ chance: 50, tags: [BattlerTagType.TRAPPED], contactRequired: true, }), ]);

## [x] Hollow Ice Zone (pkrg 5678 / er 979)
- dex : Ice-type moves apply Ice Statue and then make the user switch.
- det : The user's Ice-type moves apply the Ice Statue status to the target, making them Ice-type with no resistances or frostbite immunity. If Ice Statue is applied the user switches.
- wired: PostAttackApplyBattlerTagAbAttr + SelfSwitchOnMoveTypeAbAttr(ICE)
- FIXED: added self-switch-on-Ice-move (new primitive self-switch-on-move-type.ts, U-turn via ForceSwitchOutHelper); frostbite tag = Ice Statue analog. Test er-hollow-ice-zone (4/4).

## [x] Drakelp Head (pkrg 5688 / er 989)
- dex : Weakens first move taken and drops opponent's attack.
- det : Weakens first move taken and drops opponent's attack.
- wired: TimeLimitedDamageReductionAbAttr,PostDefendStatStageChangeAbAttr
- code : case 989: return ok([ new TimeLimitedDamageReductionAbAttr({ factor: 0.5, turns: 1 }), new PostDefendStatStageChangeAbAttr( (_target, _user, move) => move.categ

## [x] Unrelenting (pkrg 5695 / er 994)
- dex : All attacking moves can hit 2-5 times
- det : All attacking moves can hit 2-5 times
- wired: MaxMultiHitAbAttr
- code : case 994: return ok([new MaxMultiHitAbAttr()]);

## [x] Feathercoat (pkrg 5705 / er 1004)
- dex : Takes 10% less damage from attacks, 20% if resisted.
- det : Takes 10% less damage from all attacks. Takes 20% less damage from resisted attacks.
- wired: DamageReductionAbAttr
- code : case 1004: return ok([new DamageReductionAbAttr({ reduction: 0.1, filter: { kind: "all" } })]);

## [x] Daredevil (pkrg 5709 / er 1008)
- dex : +1 Atk after using recoil move. 1/2 recoil damage.
- det : Boosts Attack stat by +1 after using a move that causes recoil damage. Takes 1/2 recoil damage.
- wired: BlockRecoilDamageAttr,StatBoostOnFlagAttackAbAttr
- code : case 1008: return ok([ new BlockRecoilDamageAttr(), new StatBoostOnFlagAttackAbAttr({ flag: MoveFlags.RECKLESS_MOVE, stat: Stat.ATK, stages: 1, }), ]);

## [x] Overwhelming Mind (pkrg 5724 / er 1023)
- dex : Boosts Psychic-type moves by 1.3x, or 1.8x when below 1/3 HP.
- det : 
- wired: TypeDamageBoostAbAttr
- code : case 1023: return ok([ new TypeDamageBoostAbAttr({ type: PokemonType.PSYCHIC, multiplier: 1.3, lowHpMultiplier: 1.8, lowHpThreshold: 1 / 3, }), ]);

## [x] King of the Jungle (pkrg 5729 / er 1028)
- dex : Infiltrator + deals 1.5x more damage to Grass-types.
- det : 
- wired: InfiltratorAbAttr,OffensiveTypeMultiplierAbAttr
- code : case 1028: { const infiltrator = allAbilities[151]; const infiltratorAttrs = infiltrator?.attrs ?? []; return ok([ ...infiltratorAttrs, ...buildTypeEffectivenes
