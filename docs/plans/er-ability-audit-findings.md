# ER Ability Audit — Findings Log

Reading each ER ability + ER-altered vanilla ability's description (abbreviated + detailed)
against its actual resolved runtime attrs (see `er-ability-audit-worktable.md`).
Verdict per ability: OK / PARTIAL (missing clause) / BOTCH (wrong mechanic) / MINOR (value off).

Progress marker: audited through id **1033** — ✅ **AUDIT COMPLETE** (all ER abilities 1–1033 reviewed).

## Chunk 45 — ids 1015–1033 (audit + verdicts) — FINAL BATCH
FAITHFUL: 1015 Droideka (Heatproof + Shell Armor), 1016 3>1 (Multi-Headed + Riptide), 1018 Abominable
Monster (SpDef ×1.5 in hail), 1020 Unstable Core (Power Core + Aftermath), 1021 Aura Armor (−35% all),
1023 Overwhelming Mind (Psychic ×1.3/1.8), 1024 Duality (Infiltrator + Competitive), 1025 Reaper's Embrace
(Tough Claws + Foul Energy), 1026 Foul Energy (Dark ×1.2/1.5), 1027 Jungle Fever (Speed ×1.5 in Grassy
Terrain), 1028 King of the Jungle (Infiltrator + ×1.5 vs Grass), 1029 Warrior's Spear (Mighty Horn +
Fighting Spirit), 1030 Sleek Scales (+15% Speed to defenses), 1032 Smoldering Wood (Raw Wood + Flame
Body), 1033 Slime Mold (Sticky Hold + Gooey).
✅ FIXED THIS CHUNK:
- 1017 Icicle Fist: PARTIAL. "Iron Fist + 30% chance to cause frostbite with punches" wired only Iron
  Fist. Appended a PUNCHING_MOVE-gated 30% ER_FROSTBITE proc (same shape as Frostmaw 692).
- 1019 Wind Chimes: MINOR. "attacks with 30 BP Hyper Voice when hit" used Hyper Voice's natural 90BP; set
  power: 30 on the counter.
- 1022 Deflect: PARTIAL. "Counters with 20BP Vacuum Wave when hit. Takes 20% less damage" only emitted the
  20% reduction (damage-reduction-generic). Flipped to bespoke: 20% reduction + a 20BP Vacuum Wave counter.
- 1031 Rock Armor: PARTIAL. "Rocky Exterior + takes 10% less damage" only emitted the 10% reduction. Rocky
  Exterior (er-919) = add Rock type on entry; flipped to bespoke: add-Rock-type EntryEffect + 10% reduction.

## Chunk 44 — ids 995–1014 (audit + verdicts)
FAITHFUL: 995 Elemental Aegis (Fire/Electric/Water ×0.5), 996 Aegis Ward (Dark/Ghost/Psychic ×0.5), 997
Shattered Armor (Battle Armor + Scrapyard spikes-on-hit), 999 Ghost Frenzy (Hyper Aggressive + Soul
Eater), 1000 Survivor Bias (resisted moves can't KO), 1001 Bandit (Scavenger + Technician), 1002 Fortress
(Filter + Shell Armor), 1003 Bird of Prey (Big Pecks + Scrappy), 1004 Feathercoat (−10% all / −20%
resisted, multiplicative), 1005 Power Outage (first Electric move ×2 then loses Electric), 1006 Electro
Booster (Magnet Rise on entry), 1007 Current Crash (Reckless + Thundercall), 1009 Frost Dragon (Dragon/Ice
→ 50BP Blizzard), 1010 Thermal Entropy (Thermal Exchange + Heatproof), 1011 Sinister Claws (Mystic Blades
+ slicing SpDef drop), 1012 Petal Shield (max Def entry, −1 Def on hit), 1013 Mob Boss (Terrify + Deviate),
1014 Ghost Pepper (Grass → 30% burn).
✅ FIXED THIS CHUNK:
- 1008 Daredevil: BOTCH. "+1 Atk after recoil move. Takes 1/2 recoil damage" was wired with
  `BlockRecoilDamageAttr` (FULL recoil immunity) — stronger than the description. Swapped to
  `RecoilDamageMultiplierAbAttr({ factor: 0.5 })` (the existing half-recoil mechanism that RecoilAttr
  already scans for, used by Limber), keeping the RECKLESS_MOVE ATK+1 rider.
- 998 Acid Reflux: MINOR. "Uses 20BP Acid when it takes damage" left the counter's power at Acid's
  natural 40BP. Set `power: 20` on the CounterAttackOnHit so the counter matches the stated 20BP.

## Chunk 43 — ids 975–994 (audit + verdicts)
FAITHFUL: 975 Backflip (Dance → 50BP Chip Away), 977 Eternal Flower (−20% other Megas' stats), 978 Nihil
Blaster (Aura Break + Mega Launcher), 980 Overcast (fog weather + Mist on entry), 981 Cryostasis
(Cryomancy + frostbite→flinch), 982 Flower Necklace (SpDef ×1.5 in Grassy Terrain), 984 Mucus Membrane
(−30% all + Gooey), 985 Lucha Libre (Dazzling + Defiant), 986 Curlipede (Defense Curl on entry + rolling
priority), 987 Storm Cloud (rain 8t + Electric self-type), 988 Waterborne (Water self-type + Adaptability),
989 Drakelp Head (first-hit halve + ATK−1), 990 Polarity (party highest stat ×1.3), 991 Resilience (heal
1/4 below 1/2), 992 Going Berserk (Berserk + Rampage), 993 Thunder Clouds (special → 35BP Thunderbolt).
✅ FIXED THIS CHUNK:
- 994 Unrelenting: BOTCH. "All attacking moves can hit 2-5 times" was wired as MaxMultiHitAbAttr (Skill
  Link) — which only forces an ALREADY-multi-hit move to its max and does NOTHING to single-hit moves.
  Added `AllAttacksMultiHitAbAttr` (ab-attrs): turns an eligible single-hit damaging move into a 2-5-hit
  move using the canonical TWO_TO_FIVE distribution (+ Skill Link interaction), gated on hitCount===1 and
  `move.canBeMultiStrikeEnhanced`. Hooked into move-effect-phase right after AddSecondStrike. Battle test
  asserts Tackle lands 2-5× for an Unrelenting holder and exactly 1× without it.
- 976 Crushing Jaw: PARTIAL. "Strong Jaw + Biting moves have a 50% chance to lower defense" wired only
  Strong Jaw (×1.3 biting). Added a `chance` option to `StatDebuffOnFlagAttackAbAttr` and appended a
  BITING_MOVE-gated 50% DEF−1 on the target via composite-append.
- 983 Mega Drill: PARTIAL. "Mighty Horn + all Drill moves 30% stronger" wired only the HORN_BASED ×1.3
  boost (er-391). Appended a DRILL_BASED ×1.3 FlagDamageBoost.
✅ 979 Hollow Ice Zone — RESOLVED (was a documented approximation): built the real Ice Statue status as a
  new battler tag `BattlerTagType.ER_ICE_STATUE`. On apply, the target becomes pure Ice (type override),
  gains NO resistances (`getAttackTypeEffectiveness` clamps any sub-neutral multiplier up to 1 while the
  tag is present), and LOSES the Ice-type frostbite immunity (`ErFrostbiteTag.canAdd` allows it through).
  979's Ice-type moves now apply ER_ICE_STATUE (was ER_FROSTBITE) + the self-switch. Tests: er-ice-statue
  (type override, no-resist clamp, weaknesses kept, frostbite-able, 979 applies it in battle).

## Chunk 42 — ids 955–974 (audit + verdicts)
FAITHFUL: 955 Brain Mass (halve dmg at full HP), 956 Chestnut Shield (Impenetrable + Bulletproof), 957
Chestnut Axe (er-271: keen-edge slicing + grass boost), 959 Rain Shroud (+30% EVA in rain), 960 Witch
Broom (Hyper Aggressive + Hover, incl Float ground-immunity), 962 Wrestle Showman (Flying Press ×1.1 +
Taunt rider), 963 Fire Ruler (King's Wrath + Flame Shield 35% SE reduction), 964 Chandelier (Illuminate
+ Pyromancy ×5 burn), 965 Foggy Eye (fog: Ghost ×1.5 + resist Ghost), 966 Toxic Shell (Shell Armor +
Poison Point, multi-layer), 967 Hand Barnacles (Multi-Headed + Water STAB), 968 Voltron (Metallic +
Battle Armor), 970 Emperor's Wrath (King's + Queen's Wrath stat triggers), 971 Lepidopteran (Swarm +
Unaware), 972 Break it Down (20BP Rapid Spin follow-up), 973 Talon Trap (50%/100%-first-turn trap on
contact, offense + defense).
✅ FIXED THIS CHUNK:
- 958 Giant Shuriken: BOTCH (balance). "Water Shuriken hits once with 100BP and +1 crit" boosted power
  6.67× + added crit, but never forced single-hit — so the boosted move still rolled 2–5 hits at 100BP
  each (massively overpowered). Added `MultiHitType.ONE` (enum + getHitCount → 1) and gated
  `WaterShurikenMultiHitTypeAttr` to it when the user has Giant Shuriken; power stays handled by the
  ability's 6.67× MovePowerBoost. Battle test asserts hitCount===1; Battle Bond's 3-hit path regression-
  clean.
- 969 Fire's Wrath: PARTIAL. "Intimidate + Scare; 10% burn chance on non-contact moves" wired only the
  two intimidate-likes; the 10% non-contact burn was dropped. Appended
  `ChanceStatusOnAttack(chance:10, BURN, contactExcluded:true)` via composite-append.
- 974 Backstreet Boy: PARTIAL. "Striker + Kicking moves are Dance moves and vice-versa" wired only Striker
  (kicking ×1.3 via er-361). Added the bidirectional crossover: `FlagDamageBoost(DANCE_MOVE, 1.3)` so
  dance moves also get the Striker boost (FlagDamageBoost reads the static flag), and
  `MoveFlagInjection(DANCE_MOVE, "kicking-moves")` so kicking moves trigger Dancer (the Dancer trigger
  routes through `doesFlagEffectApply`, which honors injection). Added a `kicking-moves` scope to the
  injection primitive.
⚠️ UNRESOLVED-SPEC (left as-is, NOT fabricated):
- 961 Angelic Wings: "Prism Scales + Huge Wings." Prism Scales (−30% special damage) is correctly wired,
  but "Huge Wings" has NO available spec — no ER ability of that name exists, no ROM description, no
  C-source, and the extracted reference CODE for 961 itself emits only the Prism Scales DamageReduction.
  Wiring a guessed effect would be fabrication, so the known half stands and the gap is documented.

## Chunk 41 — ids 935–954 (audit + verdicts)
FAITHFUL: 935 Raging Storm (highest-attacking ×1.5 in rain), 936 Sumo Guard (Juggernaut + Thick Fat
composite), 937 Sumo Wrestler (20BP Circle Throw every 2nd turn), 938 Cosmic Wings (Flying→Fairy), 939
Cosmic Dust (Magic Guard + Cosmic Daze ×2 vs CONFUSED/TAUNT), 940 Cool Exit (Chilly Reception every 2nd
turn), 941 Devious Present (Ice + throwing-flag ×1.5), 942 Christmas Nightmare (1/8 hail damage), 943 Sap
Trap (SPD −1 each turn, trap at −3), 944 Dead Bark (add Ghost + 15% all / multiplicative ~30% SE
reduction — the two DamageReductions stack to 0.85×0.824≈0.70 for SE), 945 Echolocation (×1.2 + never-
miss in fog), 946 Massive Pelt (Tangling Hair + Fluffy), 947 I Am Steve (No Retreat on entry), 948
Tangled Tails (Know Your Place + Grappler), 950 Sharp Talons (kicking → 50% bleed), 951 Zen Garden
(50/50 Grassy/Psychic terrain on entry — the FULL's Grassy/Psychic Seed guarantee is moot: PokeRogue has
no terrain-seed held items, so there is nothing to read), 952 Tummyache (Thick Fat + Corrosion), 954
Brain Overload (Psychic Terrain when hit).
✅ FIXED THIS CHUNK:
- 953 Hypnotic Trance: BOTCH. "Hypnosis never misses and also causes Confusion" was wired as
  `PostAttackApplyBattlerTag(30%, CONFUSED)` with the DEFAULT PostAttack gate — which excludes status
  moves, so it NEVER fired for Hypnosis at all (it confused on damaging moves instead). Also discovered a
  correct-but-MISLABELED Hypnotic Trance block sitting under `case 951` (dead, shadowed by the R48 Zen
  Garden 951), and it too was buggy (defensive `ChanceBattlerTagOnHit` + `ACC×∞` which doesn't bypass
  evasion). Removed that dead block and rewired the live 953 to two Hypnosis-gated riders:
  `ConditionalAlwaysHit(moveIds:[HYPNOSIS])` (never miss) + `ChanceBattlerTagOnAttack(chance:100,
  moveIds:[HYPNOSIS], CONFUSED)`. Extended `ChanceBattlerTagOnAttackAbAttr` with a `moveIds` option whose
  presence overrides the default PostAttack attackCondition so by-name riders can fire on a status move.
- 949 Foamy Web: BOTCH (duration + removability). "Casts an unremovable Sticky Web on entry. Lasts 5
  turns" was a plain scripted Sticky Web (permanent + Defog/Rapid-Spin removable). Added a dedicated
  `FOAMY_WEB` EntryHazardTag (subclasses StickyWebTag, reuses its −1 SPD activateTrap, but sets
  turnCount=5 so `lapseTags` expires it after 5 turns) and laid it foe-side via the `set-hazard`
  EntryEffect. Because it's a distinct ArenaTagType, it is absent from the Rapid Spin (`arenaTrapTags`)
  and Defog removal lists → unremovable, satisfying both clauses. Registered in getArenaTag +
  ArenaTagTypeMap; turnCount serializes/reloads like any tag. Broadened the `comingFromStickyWeb`
  attribution lookup in stat-stage-change-phase to also recognize FOAMY_WEB (Mirror Armor source
  crediting). Tests: er-foamy-web (tag 5-turn lapse, −1 SPD on switch-in, foe-side entry) +
  er-hypnotic-trance (sleep + confusion both applied) + dispatch assertions. Vanilla Sticky Web + Hot
  Coals regression-clean.

## Chunk 40 — ids 915–934 (audit + verdicts)
FAITHFUL: 915 Bruiser, 916 Narcissist, 917 Let's Dance, 918 Dragonfruit, 919 Rocky Exterior, 920 Lead
Claws, 921 Flawless Precision, 922 Chainsaw, 923 Galeforce Wings, 924 Empress, 925 Mashed Potato, 928
Hypnotic Touch, 929 Hydra (Multi-Headed strikes + Hubris; the 1.25/1.35 multi-head scaling lives in
getAttackDamage), 930 Wings of Pestilence, 931 Sundae, 932 Ice Picks, 933 Hammer Fist, 934 Mach 3.
✅ FIXED THIS CHUNK:
- 927 Taste the Rainbow / 926 Rainbow Scales: "Summons the Rainbow Pledge effect on entry" was wired as a
  bogus PostSummonScriptedMove(RAINY_DAY) — rain weather, which does nothing rainbow-like. The rainbow is
  the Water+Fire pledge tag (WATER_FIRE_PLEDGE) on the holder's OWN side (doubles that side's secondary-
  effect proc rates). Extended `entry-arena-tag-on-foe-side` with a `side: "foe" | "self"` option and
  wired 927 to set WATER_FIRE_PLEDGE self-side. 926 inherits it via the composite (parts: Fire Scales +
  er-927).

## Chunk 39 — ids 895–914 (audit + verdicts)
FAITHFUL: 895 Lunar Wrath, 896 Spyware, 897 Virus, 898 Power Leak, 899 Backup Power, 900 Sand Fiend, 901
Moustache, 902 Depth Explorer, 903 Dune Veil, 904 Strong Foundation, 905 Fog Machine, 906 Drop Blocks,
907 Turf War, 908 Greedy, 910 Loose Thorns (Creeping Thorns → Spikes stand-in, documented), 911 Musical
Notes, 912 Laser Drill, 913 Strikeout, 914 Home Run.
✅ FIXED THIS CHUNK:
- 909 Lightsaber: the Keen-Edge 25% status proc was burn-only; the text is "25% burn OR paralysis."
  Added PARALYSIS to the ChanceStatusOnAttack effects array (rolled once at 25%, then a random member is
  picked — burn or paralysis).

## Chunk 38 — ids 875–894 (audit + verdicts)
FAITHFUL: 875 Energy Tap, 876 Sludge Spit, 877 Swamp Thing, 878 Frosty Presence, 881 Stonecutter, 882
Edgelord, 883 Warmonger, 884 Locust Swarm, 885 Revelation, 888 Soul Harvest, 889 Thick Blubber, 890
Craving, 891 Rat King, 892 Crispy Cream (15%+15% = 30% burn/frostbite split on contact), 893 Deep Fried,
894 Food Lovers.
✅ FIXED THIS CHUNK:
- 887 Crystalline Armor: crit-mod archetype only granted crit immunity; the "reflects stat drops" half
  was dropped. Flipped bespoke = CritImmunity + ReflectStatStageChange (Mirror Armor).
- 886 Curse of Famine: cleared terrain + boosted Def but the "restores HP" clause was missing. Added a
  `healFractionOnCleared` option to post-summon-clear-terrain and wired 1/4 max-HP restore on clear.
- 879 Chilling Pellets: the counter used Icicle Spear's full 25 BP; pinned it to the spec's 13 BP.
✅ ALSO FIXED: 880 Paint Shot — "Mega launcher moves change the target's type to the move used." Was wired
backwards as a DEFENSIVE self-type-change (PostDefendChangeAttackerType side:self, when HIT by a pulse
move). The name + "change the TARGET's type" is offensive — the holder's pulse moves repaint the FOE.
Re-wired to the offensive `PostAttackChangeTargetType` primitive (extended with a `requireFlag` option so
it gates on PULSE_MOVE, not contact — pulse moves are non-contact). Now: holder lands a pulse move →
target's type becomes the move's type.

## Chunk 37 — ids 855–874 (audit + verdicts)
NOTE: this batch's worktable FULL descriptions are heavily mis-extracted (869/870/872/873 FULL text
describes *other* abilities). Audited against the ABBR + extracted CODE (which agree); live wiring matched
CODE for every id.
FAITHFUL: 855 Hyper Cleanse, 856 Molten Coat, 857 Royal Decree, 858 Breezy Neigh, 859 Dreamscape (see
note), 860 Haste Makes Waste (Analytic = ER's 1.5×, see below), 863 Thermomancy, 866 Relic Stone, 867
Supercell, 868 Lightning Aspect, 869 Fire Aspect, 870 Ice Plumes, 871 Blistering Sun, 872 Molten Core,
873 Aurora's Gale, 874 Winter Throne.
✅ FIXED THIS CHUNK:
- 862 Thermal Slide: had the sun/hail Speed ×1.5 but dropped "also grants immunity to hail damage" —
  added BlockWeatherDamage(HAIL, SNOW).
- 865 Heat Sink: the `type-resist-or-absorb` archetype ignored the row's `redirect: true` flag (so the
  "Redirects Fire moves" / Storm-Drain draw-in was missing). Taught `buildTypeAbsorbAttrs` to emit a
  RedirectTypeMove per type when redirect is set — generic fix for any absorb+redirect ability.
- 814 Strategic Pause (carry-over correctness): its "Analytic" power boost was wired at 1.3× last batch;
  ER explicitly rebalances Analytic to 1.5× (init-elite-redux-vanilla-rebalance), so bumped 814 to 1.5×.
✅ ALSO FIXED (the previously-documented items — no longer deferred):
- 868 Lightning Aspect: swapped the hardcoded-SpAtk TypeImmunityStatStageChange for
  TypeImmunityHighestAttackStatStage — absorbs Electric + boosts max(Atk, SpAtk) by +1.
- 861 Hungry Maws: extended LifestealOnKo with an optional `flagBonus`; wired 0.25 base / 0.5 on biting
  KOs (BITING_MOVE flag read from the victim's last-received attack) — matches "50% biting / 25% other".
- 864 Chuckster: added the once-per-entry contact 50% damage reduction (new
  `OncePerEntryContactDamageReductionAbAttr` + a `summonData.chuckusterReductionUsed` charge that resets
  each send-out and is spent on the first real contact hit) alongside the existing force-switch.
  Battle-verified (er-chuckster): a contact hit is halved while the charge is available, full once spent.
  (Remaining nuance: the force-switch itself isn't contact-gated — it rides the sealed Wimp-Out class;
  in practice the attacker is switched out after the reduced hit, so it fires once anyway.)

## Chunk 36 — ids 835–854 (audit + verdicts)
FAITHFUL: 835 Atlantic Ruler, 836 Biofilm, 839 Neutralizing Fog, 840 Poison Quills, 842 Festivities,
844 Best Offense, 845 Impaler, 846 Magus Blades, 847 Lightning Born, 848 Superheavy, 849 World Serpent,
850 Lucky Wings, 851 Komodo, 853 Purple Haze, 854 Gnashing Cannon.
✅ FIXED THIS CHUNK:
- 837 Chokehold: was an on-any-hit -1 SPD approximation. FULL is "when the user traps a target, inflict
  paralysis and drop Speed once every turn while trapped." Extended the post-turn-foe-stat-drop primitive
  with `inflictStatus`; wired per-turn -1 SPD + PARALYSIS against currently-TRAPPED foes (onlyIfTrapped).
  Battle-verified (er-chokehold): a trapped foe loses a Speed stage and is paralyzed at end of turn.
- 838 Guardian Coat: only the -20% physical reduction was wired; added the dropped weather-damage
  immunity (Sandstorm/Hail/Snow) + powder-move immunity (Overcoat-style MoveImmunity on POWDER_MOVE).
- 841 Draconic Might: Normal→Dragon + Dragon STAB + entry Dragon-add were wired, but Draconize's "if the
  user is Dragon-type, its Dragon moves hit Fairy neutrally" was dropped — appended
  OffensiveTypeChartOverride(DRAGON→FAIRY = 1) gated on the holder being Dragon-type.
- 843 Fey Flight: had Fairy-add + Ground immunity + Float but dropped "boosts Flying-type moves by 25%" —
  added TypeDamageBoost(FLYING, 1.25).
- 852 Envenom: the chance-status default gated the 30% poison to CONTACT moves; FULL is "after landing
  ANY move." Set onContactOnly:false.

## Chunk 35 — ids 815–834 (audit + verdicts)
FAITHFUL: 816 Mental Pollution (TAUNT-gated suppress — fixed in the enrage pass), 817 Madness Enhancement
(fixed in enrage pass), 820 Soul Tap (fog-gated 1/10 drain), 821 Scarecrow (Scare + Bad Luck full suite:
crit-immune + min-roll + no-secondary + 5% miss), 822 Ominous Shroud (Ghost-add + full-HP halve), 823
Chilling Presence (10BP Icy Wind entry), 824 Frostbind (frostbite→Disable), 825 Glacial Ghost (Slush
Rush + Snow Cloak — minor eva value note), 826 Tender Affection (Cute Charm both-ways + Fairy STAB), 827
Wonder Scale (Shed Skin + Wonder Skin + dmg-boost-immunity), 830 Temporal Rupture (Roar of Time → Slow
Start), 831 Grass Flute (sound → Fear), 832 Hemotoxin (suppress on poison), 833 Harukaze (Grassy↔Tailwind),
834 Toxic Surge (Toxic Terrain entry).
✅ FIXED THIS CHUNK:
- 819 Serpent Bind / 818 Tentalock: the 50% trap-on-contact was wired but "once trapped, their speed
  drops by one stage each turn" was unwired. Added `onlyIfTrapped` to the post-turn-foe-stat-drop
  primitive and wired a per-turn -1 SPD vs currently-TRAPPED foes (818 inherits it via the Serpent Bind
  composite part).
- 829 Stainless Steel: Normal→Steel + the Steel-type Ghost/Steel resists were wired but Steelworker's
  "otherwise gains Steel STAB" was dropped. Appended StabAdd(STEEL) (its built-in guard fires only for
  non-Steel users, matching the either/or text).
✅ ALSO FIXED (the previously-documented items — no longer approximations):
- 815 Overrule: was a flat crit-damage ×2 (CritDamageMultiplier), which is neither clause. Built a new
  `OverruleCritAbAttr` marker + two crit-gated checks in `Pokemon.getAttackDamage`, both guarded by
  `source.hasAbilityWithAttr("OverruleCritAbAttr")` (strict no-op for everyone else): (a) on a crit, skip
  the defender's damage-reducing abilities (Multiscale/Filter/Fur Coat/…); (b) on a crit, ×2 damage when
  the move is resisted (typeMultiplier < 1). Battle-verified via direct getAttackDamage calls
  (er-overrule): resisted crit ≈ ×3 of the non-crit; Multiscale ignored on crit. (The multi-hit "first
  hit decides all hits" nuance is left as per-hit — minor.)
- 825 Glacial Ghost: Snow Cloak was a +20% EVASION boost; the text is "25% accuracy reduction." Surgically
  swapped the EVA StatMultiplier for an `IncomingAccuracyMultiplier(0.75)`, preserving the original hail
  weather-gate condition.
- 828 Overzealous: ER's own text says "Will not be implemented", but the ability already carries a working
  `SePriorityBonus(+1 on super-effective)` (extends the real ChangeMovePriority hook) matching its ABBR —
  kept (a working +1-SE-priority is strictly better than a dead ability). No change needed.

## Chunk 34 — ids 795–814 (audit + verdicts)
FAITHFUL: 795–798 Embody Aspect (entry +1 SPD/ATK/DEF/SPDEF — worktable display dup'd id 795 but the
rows wire the correct per-mask stat), 799 We Will Rock You (Rock ×1.3/×1.8), 801 Sun's Bounty (Leaf
Guard + Harvest — see note), 802 Rite of Spring (Chlorophyll + Solar Power), 803 Headstrong (+1 SpDef
entry), 804 Firefighter (type-based ×1.5 dealt / ×0.5 taken vs Fire), 805 Sepia Lens (Tinted Lens +
Sand Guard), 806 Super Sniper (Sniper ×2.25 — switch-hit unmodeled, see note), 807 Woodland Curse
(Forest's Curse entry + Grass-on-contact), 808 Malodor (suppress ability on contact), 811 Drake of Rage
(Tinted Lens + recharge-clear), 813 Mixed Martial Arts (Normal moves gain Punch+Kick flags).
✅ FIXED THIS CHUNK:
- 809 Blur / 810 Elude: both wired an UNGATED `SpeedBonusToStat(DEF)` (identical, no contact filter) —
  809 now gated to CONTACT-only, 810 to NON-contact-only (per their descriptions).
- 812 Reverberate: was a flat 1.3× power boost on Normal moves — the description is "Normal moves become
  Sound moves" (a flag grant). Replaced with `AddMoveFlag(SOUND_BASED)` on the holder's Normal moves
  (mirrors 813's flag-grant approach).
- 814 Strategic Pause: crit-mod gave an UNCONDITIONAL +2 crit and dropped the Analytic half. Flipped
  bespoke: +2 crit AND +30% power, both gated on the holder moving after the target (Analytic's
  no-other-MovePhase-queued test).
- 800 Deviate (enrage): Normal→Dark conversion + ER-STAB were wired but the "if Dark-type, Dark moves get
  a 10% enrage chance" rider was missing — added `ChanceBattlerTagOnAttack(10, TAUNT, filter Dark)` gated
  on the holder being Dark-type (enrage === TAUNT).
✅ ALSO FIXED (the previously-documented items — no longer deferred):
- Leaf Guard (ER rebalance) + 801 Sun's Bounty: `patchLeafGuard` constructed `PostTurnResetStatus(true)`
  (allyTarget) so it cured the ALLY, never the holder. Flipped to `false` (self-cure) — fixes both Leaf
  Guard itself and 801, which composites it. Matches the text "cures all status conditions at end of turn."
- 783 Caretaker: the inherited Healer cure is ally-only; the text wants "BOTH the user and their ally,
  2 separate checks." Appended an independent 30% SELF-cure (`PostTurnResetStatus(false)` gated on a
  per-holder 30% roll) alongside the ally one.
- 806 Super Sniper: the "strike foes before they finish switching out" rider was only an AI hint. Wired
  the real switch-strike via `OnOpponentSwitchOut(Pursuit)` — the same engine hook 656 Tag already uses
  (the earlier "no hook" note was stale; the hook exists in switch-summon-phase.ts).

## Chunk 33 — ids 775–794 (audit + verdicts)
FAITHFUL: 775 Flame Coat, 777 Super Scope (boost + always-hit + spread), 778 Venom Crown, 779 Blight
Scale, 780 Gunman, 781 Hunter's Mark, 782 Hemolysis, 783 Caretaker, 784 Poseidon's Dominion, 785
Two-Faced, 786 Lullaby (SetMoveAccuracy 90), 788 Glacial Rage, 789 Immovable Object, 790 Frenzied
Phantom, 791 DNA Scramble (correct empty marker — Deoxys form-change handled out-of-band), 792 Metallic
Jaws, 794 Deadly Precision.
✅ FIXED: 776 Unown Power — Mystic Power STAB was wired but "Hidden/Secret Power always super-effective
(×2)" was dropped; appended a move-id-scoped ×2 power boost on HIDDEN_POWER/SECRET_POWER.
MINOR (documented, not changed): 787 Cryo Architect — applies both Atk+Def immediately on Water hit; the
"Def delayed to next turn for Water (immediate for Ice)" nuance isn't modeled (would need a delayed-stat
mechanism). 793 Calculative — composite copies vanilla Neuroforce (SE ×1.25) but ER text says +35%;
left at the vanilla value (matches the Analytic +30% half exactly, only the SE half is 10pp low).
Enrage-reading abilities in this/earlier batches handled in the "ER Enrage subsystem" section above.


## ER "Enrage" subsystem (cross-batch) — implemented as the vanilla TAUNT tag
Decision (user): ER's "enrage" status === pokerogue's `BattlerTagType.TAUNT`. Anchor: ER's TM12/Taunt
text reads "Enrages the foe so it can only use attack moves" — i.e. enrage IS Taunt (status-move lock).
The vendored ER C-source predates the status, so the ROM text is authoritative. A prior pass had modeled
"enrage" inconsistently (FOG-weather proxy for 816/817; self-damage-on-attack for 529); unified to TAUNT:
- 77 Tangled Feet: Spd-as-defensive-stat gated on `CONFUSED || TAUNT` (was confused/FOG-proxy).
- 529 Berserk DNA: +2 highest attacking stat on entry + **self-enrage** = `PostSummonAddBattlerTag(TAUNT)`
  (replaced the bogus self-damage-on-attack proxy).
- 534 Cosmic Daze: ×2 vs foes with `CONFUSED || TAUNT` (new reusable `target-has-any-tag` conditional-damage kind).
- 758 Brute Force: "while enraged, the +20% applies to ALL moves" → MovePowerBoost(1.2) gated on holder
  TAUNT, excluding RECKLESS_MOVE (already covered by the Reckless part) — net uniform +20% while enraged.
- 816 Mental Pollution: SuppressAttackerAbility gated on holder TAUNT (was FOG-weather proxy).
- 817 Madness Enhancement: halve incoming damage when `holder TAUNT || fog`; self-enrage (apply TAUNT) on
  entry while fog is active ("Enrages in fog").
Tests: bespoke-dispatch (529/534/758/816/817), er-rebalance (77), er-enrage battle test (Berserk DNA
self-enrage gains TAUNT + boost; Cosmic Daze ~2× vs TAUNT'd foe). Tradeoff (accepted): real Taunt also
reads as "enraged" by these abilities.

## Chunk 32 — ids 755–774 (audit + verdicts)
FAITHFUL (live matches FULL): 755 Balloon Blitz (Inflatable + Hyper Aggressive double-hit), 757 Doom
Blast (Dark ×1.35 + 10% recoil), 758 Brute Force (Rock Head + Reckless — see note), 759 Faraday Cage
(Shell Armor + 20% reduction + Thunder Cage counter), 761 Rose Garden (2-layer Toxic Spikes entry), 763
Conjurer of Deceit (Magic Guard + Magic Bounce), 764 Deep Freeze (Water/Ice ×1.25 + Fire ×0.5), 765 Soul
Devourer (Soul Eater KO-heal + Ghost-hits-Normal), 766 Champion's Entrance (Intimidate + Violent Rush),
767 Presto (sound +1 priority at full HP), 768 Samba (Striker + Dancer), 769 JunshiSanda (punch/kick
cross-boost — approximation noted), 770 Gladiator (Fighting ×1.3 / ×1.8 low HP), 771 Forsaken Heart
(Atk+1 on any faint), 773 Soothsayer (3-turn entry damage reduction).
✅ FIXED THIS CHUNK:
- 756 Twinkle Toes: had only the kicking ×1.3 boost — FULL is "kicking +30% + Pixilate (Normal→Fairy +
  Fairy STAB) + if Fairy-type, Fairy moves 10% infatuate." Flipped bespoke; added TypeConversion
  (Normal→Fairy) + StabAdd(Fairy) + ChanceBattlerTagOnAttack(10, INFATUATED, filter Fairy) gated on the
  holder being Fairy-type. Battle-verified (er-twinkle-toes): Tackle (Normal→Fairy) now damages a Ghost.
- 760 Acidic Slime: Corrosion + Poison STAB were wired but the headline "Poison moves super-effective vs
  Steel" was dropped — appended OffensiveTypeChartOverride(POISON→STEEL ×2) in dispatchComposite (mirrors 725).
- 762 Qigong: Always-hit + clear-RECHARGING-on-KO were wired but the "Fighting Spirit" piece
  (Normal→Fighting + Fighting STAB) was dropped — appended TypeConversion(Normal→Fighting) + StabAdd(Fighting).
- 772 Relentless: the "Exploit Weakness" half here is the 1.25×-damage variant ("deals 1.25x damage AND
  targets lower defensive stat"), but the shared DefenseStatSwap part (also used by plain 284 Exploit
  Weakness, which is 1.0×) only did the stat redirect — appended a MovePowerBoost ×1.25 gated on the foe
  being statused.
- 774 Corrupted Mind: had the Psychic type-chart override (bypass resist/immunity) but the "+40% secondary
  effect chance on Psychic moves" was deferred for lack of a primitive — built new
  `TypeFilteredEffectChanceMultiplierAbAttr` (extends MoveEffectChanceMultiplier, gated on move type) and
  wired PSYCHIC ×1.4.
NOTE: 758 Brute Force — its composite copies pokerogue Reckless (×1.2 = +20%), which MATCHES the FULL
"increases recoil-move damage by 20%" (the ROM CODE's ×1.3 contradicts its own text). The "while enraged,
applies to all moves" + "immunity to enrage recoil" clauses ride ER's enrage subsystem, which isn't
modeled in pokerogue — left unmodeled (consistent with prior niche-subsystem deferrals). 769 JunshiSanda
remains the documented flag-merge approximation (×1.15 to both punch+kick flags; true flag-injection
deferred).

## Chunk 31 — ids 735–754 (audit + verdicts)
FAITHFUL (live matches FULL): 735 Know Your Place (ContactQuash 5-turn), 736 Deep Cuts (50% bleed on
Keen Edge), 737 Life Steal (PostTurnDrain 1/10), 740 Set Ablaze (fear on burn — ChanceBattlerTag gated
on targetHasStatus burn), 741 Breakwater (Swift Swim + Stall), 743 Cutthroat (priority modifier), 745
Sand Pit (Sand Tomb 20BP entry), 746 Desolate Sun (Desolate Land + Earth Eater heal), 747 Daybreak
(burn on contact off+def), 748 Energy Siphon (Lifesteal 0.25), 749 Reservoir (Water Absorb + Storm Drain
+ highest-stat boost), 750 Neurotoxin (StatusCascade poison → -Atk/-SpAtk/-Spd), 752 Rising Dough
(Sticky Web entry).
✅ FIXED THIS CHUNK:
- 742 Magical Fists: had only PUNCHING ×1.3 boost — FULL is "punching moves USE Special Attack and deal
  30% more." Added flag-gated AttackStatSubstitute(SPATK, PUNCHING_MOVE) (same pattern as 708 Megabite).
- 751 Energy Horns: had only HORN_BASED ×1.3 — FULL is "horn moves become Special and deal 30% more."
  Added AttackStatSubstitute(SPATK, HORN_BASED).
- 753 Crust Coat: crit-mod archetype gave crit immunity only — FULL also "takes 20% less damage." Flipped
  bespoke = CritImmunity + DamageReduction(0.2 all) (identical to 709 Dream State).
- 754 Puffy: damage-reduction archetype gave contact ×0.5 only — FULL also "Fire moves deal double damage."
  Flipped bespoke = DamageReduction(0.5 contact) + ReceivedTypeDamageMultiplier(FIRE, 2).
- 739 Teraform Zero (vanilla-map 309): vanilla only cleared weather/terrain — FULL is "Tera Shell + clears."
  Added FullHpResistTypeAbAttr (Tera Shell) via rebalance patcher; clear preserved.
- 738 Rude Awakening: live wiring was sleep-immunity only, which was self-contradictory — an unconditional
  sleep immunity means the holder can never sleep, so its own "+1 all stats UPON AWAKENING" clause could
  never fire. (The C-source in vendor predates this ability — it's nowhere in the v2.65.3b source tree —
  so the ROM description is authoritative.) Built the wake-trigger infra: (a) new `PostWakeUpAbAttr`
  lifecycle marker fired from `MovePhase.checkSleep` right after the natural-wake cureStatus; (b) new
  `WakeStatBoostAbAttr` (extends it) that on first wake queues a +1 omniboost (5 core stats) and flips a
  `rudeAwakeningTriggered` battleData flag, once per battle; (c) the sleep immunity is now a
  `StatusEffectImmunityAbAttrEr([SLEEP])` whose `addCondition` is gated on that flag — so the holder is
  freely sleepable the first time and permanently immune after waking. Battle-verified end-to-end
  (er-rude-awakening): sleepable → wakes → +1 ATK/DEF/SpAtk/SpDef/Spd → sleep-immune; vanilla rest/
  sleep-talk regressions still green (the checkSleep hook is inert for non-holders).
NOTE (desc/CODE discrepancy, kept faithful to CODE): 744 Sand Bender — FULL text says "boosts highest
attacking stat by 50% during sandstorm," but both the ROM-extracted CODE and live wiring implement the
standard Sand Force (Rock/Ground/Steel move power ×1.3) + Sand Stream + sandstorm-damage immunity, and
the worktable labels it "Sand Stream + Sand Force." Kept the Sand Force wiring (matches the mashup label
and extracted attrs); the FULL "highest attacking stat" phrasing appears to be loose/aspirational text.

## Chunk 30 — ids 715–734 (audit + verdicts)
FAITHFUL (live matches FULL): 715 Hover (add Psychic + Ground-move immunity — see note), 716 Depravity
(crit-on-status + Electric-SE-vs-Electric + paralyze-Electric — already complete via Overcharge 349
composite; worktable CODE was stale), 717 Wildfire (Fire Spin entry), 718 Jumpscare (Astonish entry),
719 Tar Toss (Tar Shot entry), 721 Raging Goddess (clear RECHARGING on KO + double-hit), 722 Whiplash
(physical → -Def), 724 Lucky Halo (ProtectStat + endure-one-KO), 727 Overwatch (Stakeout 2x + priority),
728 Wind Rage (Defog entry + air ×1.3), 729 Victory Bomb (Fire Explosion on faint), 730 Razor Sharp
(crit → bleed), 731 To The Bone (crit ×1.5 + bleed), 732 Blade Dance (Leaf Blade after dance), 733
Taekkyeon (attacks are dances), 734 Ape Shift (HP-threshold transform + always-crit).
✅ FIXED THIS CHUNK:
- 720 Stun Shock: was paralysis-only — FULL is "60% to inflict POISON or PARALYSIS, chosen randomly."
  Reclassified bespoke = ChanceStatusOnAttack(60, effects:[PARALYSIS, POISON]) (random pick per proc).
- 725 Trash Heap: had status-immunity bypass + chip; missing "Poison moves super-effective vs Steel."
  Appended OffensiveTypeChartOverride(POISON→STEEL ×2) in dispatchComposite.
- 726 Sludgy Mix: had Normal→Poison + STAB + Punk Rock; missing Intoxicate's "if Poison-type, Poison
  moves get 10% bad-poison." Appended ChanceStatusOnAttack(10, TOXIC, filter type POISON), gated
  on the holder being Poison-type.
✅ ALSO FIXED (the two earlier-deferred):
- 715 Hover: + new `FloatAbAttr` marker consulted in `Pokemon.isGrounded()` (Levitate-style ungrounding)
  — now immune to Spikes / terrain / Arena Trap on top of the existing Ground-move immunity + Psychic
  type-add. Applied to Fey Flight 843 too (same gap). Battle-verified (er-hover): ungrounded + ignores
  Spikes + gains Psychic; grounded control still takes Spikes.
- 723 Supersweet Syrup: reworked to the v2.65.3b description via a rebalance patcher — strips the vanilla
  entry evasion-drop, adds BlockItemTheft (Sticky Hold: item can't be removed/stolen) + new
  `DisableTargetItemOnContactAbAttr` (disable the foe's item for 2 turns on a contact hit). Tests:
  er-rebalance-attr-patches. (Unlike Power of Alchemy 223, where the user chose to keep the C-source
  Receiver behavior, here the description was implemented per the explicit "fix it" instruction.)


## Chunk 29 — ids 695–714 (audit + verdicts)
FAITHFUL (live wiring matches FULL desc): 695 Slipstream (Speed→ATK/SpAtk +20%), 696 Apex Predator
(ToughClaws+Predator KO-heal), 697 Dragon's Ritual (KO→+1 ATK/SPD), 702 From the Shadows (moving-first
trap+flinch), 705 Terastal Treasure (0.6 dmg + 0.8 SPD), 706 Shocking Maw (1.3 bite + 50% para), 707
Gleam Eyes (Frisk+disable+SpAtk−1 foes), 710 Dream Whimsy (Yawn on entry), 711 Lunar Affinity (copy
lunar moves), 712 Flame Shield (0.65 vs SE), 714 Apple Pie (1/16 heal + double-berry).
✅ FIXED THIS CHUNK:
- 709 Dream State: was crit-mod (crit immunity ONLY) — FULL also grants ×0.8 all-damage reduction.
  Reclassified bespoke = CritImmunity + DamageReduction(0.2, all). Test: bespoke-dispatch.
- 713 Aquatic Dweller: was type-damage-boost (Water ×1.5 ONLY) — FULL also adds Water to typing on
  entry. Reclassified bespoke = TypeDamageBoost(Water,1.5) + EntryEffect(add-self-type Water). Test:
  bespoke-dispatch. (type-damage-boost archetype count guard updated 20→18; entry-effect 20→19 to clear
  the pre-existing drift.)
✅ DEFERRED PARTIALS — NOW RESOLVED (all tsc+lint+test-green):
- 698 Pinnacle Blade: + new `IgnoreProtectByFlagAbAttr(SLICING)` consulted in Move.doesFlagEffectApply
  → slicing moves bypass protection. (The "ignore secondary effects of protect" nuance is minor.)
- 699 Energized: + `RechargeChargedOnElectricTerrainAbAttr` (PostTerrainChange) re-charges on Electric
  Terrain, AND + `RechargeChargedOnElectricKoAbAttr` (rides PostVictoryAbAttr, gated on the KO'er's
  last-used move being Electric-type) re-charges on a direct Electric-move KO. All three triggers (entry
  / terrain / KO) now wired. Battle-verified (er-energized): entry charge, Electric-KO recharge fires,
  non-Electric KO does NOT recharge.
- 700 Color Spectrum: + new `PostTurnRandomPureTypeAbAttr` rotates the holder to a random single type
  each turn (end-of-turn → in effect next turn). (R48 case is live; main-switch one marked dead.)
- 701 Steel Beetle / 381 Pollinate: + new `BugPowderImmunityAbAttr` marker, checked in Move.isTypeImmune
  (BUG branch) → a Bug-type Pollinate/Steel-Beetle holder is immune to powder. 381 reuses
  dispatchTypeConversion + the marker; cascades to 701.
- 703 Rage Point: + `BypassBurnDamageReductionAbAttr`; the ER frostbite SpAtk halving in
  Pokemon.getAttackDamage now also consults that attr → negates both the burn ATK drop and the frostbite
  SpAtk drop.
- 704 Hot Coals: + NEW burn-hazard `HotCoalsTag` (ArenaTagType.HOT_COALS) — single-use foe-side trap
  that burns the next grounded, burnable switch-in and is consumed. Wired via EntryEffect set-hazard with
  a new `side: "foe"` option. Battle-verified (burns grounded RATTATA, spares Fire, consumed; ability lays
  it foe-side). Was completely UNWIRED before.
- 708 Megabite: + `AttackStatSubstituteAbAttr({physicalStat:SPATK, flag:BITING})` → biting moves use
  Special Attack (matches 568 Mind Crunch).


## Confirmed BOTCH (wrong mechanic — fix)
- **6 Damp** — code = vanilla `FieldPreventExplosiveMoves` (block explosions). ER spec (abbr+full agree): "Makes foe Water-type on contact, offense & defense." → FIXED (FULLY): patchDamp wires PostDefendChangeAttackerType(WATER, contact) for defense + PostAttackChangeTargetType(WATER, contact) for offense (new primitive `post-attack-change-target-type`). Both halves now wired.

## PARTIAL (core clause wired, secondary clause missing — deferred unless cheap)
- **1 Stench** — flinch ✓; "Toxic Terrain turns don't decrease while present" missing (needs terrain-persistence hook).
- **19 Shield Dust** — secondary-effect block ✓; entry-hazard immunity + powder-move immunity missing.

## MINOR (value discrepancy)
- **8 Sand Veil** — evasion multiplier 1.2 wired; spec says 1.25 (÷1.25 accuracy). Low impact.

## OK (verified faithful, ids 1–26 except above)
2 Drizzle, 3 Speed Boost, 4 Battle Armor, 5 Sturdy, 7 Limber, 9 Static, 10 Volt Absorb,
11 Water Absorb, 12 Oblivious, 13 Cloud Nine, 14 Compound Eyes, 15 Insomnia, 16 Color Change,
17 Immunity, 18 Flash Fire, 20 Own Tempo, 21 Suction Cups, 22 Intimidate, 23 Shadow Tag,
24 Rough Skin, 25 Wonder Guard, 26 Levitate.

## Chunk 2 — ids 27–60 (marker → 60)
CORRECTED (false alarm — verified OK, do NOT touch):
- 57 Plus / 58 Minus — ally-gate intact via vanilla `.conditionalAttr`; rebalance `mutateStatMultiplier` only bumps 1.5→2.0 in-place. Worktable "condition=undefined" = unused StatMultiplier param, not the gate. LESSON: worktable hides closure/conditionalAttr gates → verify condition-gated abilities vs source before flagging.
MINOR:
- 50 Run Away — Speed +1 wired; spec says +2.
PARTIAL:
- 35 Illuminate — 1.2 acc ✓; "removes Ghost-typing on target on hit" missing.
- 39 Inner Focus — flinch/intim/scare immunity ✓; "Focus Blast never misses" missing.
- 53 Pickup — hazard-clear ✓; carries leftover vanilla PostBattleLoot (item pickup) not in ER desc (harmless).
OK: 27 Effect Spore, 28 Synchronize, 29 Clear Body, 30 Natural Cure, 31 Lightning Rod, 32 Serene Grace, 33 Swift Swim, 34 Chlorophyll, 36 Trace, 37 Huge Power, 38 Poison Point, 40 Magma Armor, 41 Water Veil, 42 Magnet Pull, 43 Soundproof, 44 Rain Dish, 45 Sand Stream, 46 Pressure, 47 Thick Fat, 48 Early Bird, 49 Flame Body, 51 Keen Eye, 52 Hyper Cutter, 54 Truant, 55 Hustle, 56 Cute Charm, 59 Forecast.

## Chunk 3 — ids 61–90 (marker → 90)
BOTCH:
- 77 Tangled Feet — code = StatMultiplier(EVA,2) gated on confused/enraged; spec = "use Speed as the DEFENSIVE stat when confused/enraged" (defensive-stat substitution). Wrong mechanic. Needs new primitive (defense→Speed override gated on tag). DEFER.
APPROX/PARTIAL:
- 73 White Smoke — spec "Smokescreen 3t = +25% party evasion"; code uses MIST tag (stat-drop protect) + leftover vanilla ProtectStat. No evasion-screen tag exists; approximate.
MINOR:
- 81 Snow Cloak — evasion 1.2 vs spec 1.25 (same convention as Sand Veil 8).
OK: 61 Shed Skin, 62 Guts, 63 Marvel Scale, 64 Liquid Ooze, 65 Overgrow, 66 Blaze, 67 Torrent, 68 Swarm, 69 Rock Head, 70 Drought, 71 Arena Trap, 72 Vital Spirit, 74 Pure Power (abbr SpAtk×2), 75 Shell Armor, 76 Air Lock, 78 Motor Drive, 79 Rivalry, 80 Steadfast, 82 Gluttony, 83 Anger Point, 84 Unburden, 85 Heatproof, 86 Simple, 87 Dry Skin, 88 Download, 89 Iron Fist, 90 Poison Heal.

## Chunk 4 — ids 91–120 (marker → 120)
PARTIAL/MINOR:
- 96 Normalize — type-conversion ✓; boost is 1.2× on converted moves (vanilla) vs spec's uniform 1.1×; natively-Normal moves correctly 1.1× (no double-stack — base-type gated). "Normal bypasses resistances" clause UNWIRED (needs Normal-only resist-bypass primitive).
NOTES (verified OK, not botches):
- 120 Reckless — code 1.3× is an INTENTIONAL ER buff (rebalance comment "vanilla 1.2x → ER 1.3x"); ROM desc 1.2× is stale. Leave.
- 103 Klutz — `.unimplemented()` upstream in pokerogue (empty attrs expected); not an ER botch.
OK (standard vanilla / faithful): 91 Adaptability, 92 Skill Link, 93 Hydration, 94 Solar Power, 95 Quick Feet, 97 Sniper, 98 Magic Guard, 99 No Guard, 100 Stall, 101 Technician, 102 Leaf Guard, 104 Mold Breaker, 105 Super Luck, 106 Aftermath (FIXED earlier), 107 Anticipation, 108 Forewarn, 109 Unaware, 110 Tinted Lens, 111 Filter, 112 Slow Start, 113 Scrappy, 114 Storm Drain, 115 Ice Body, 116 Solid Rock, 117 Snow Warning, 118 Honey Gather, 119 Frisk.

## Chunk 5 — ids 121–159 (marker → 159)
PARTIAL:
- 138 Flare Boost — 1.5× SpAtk when burned ✓; "negate burn damage" (HP-chip block) + "ignite self in fog" missing.
- 149 Illusion — empty attrs; disguise-as-last-party + ER's "+1.3× until hit" not wired (illusion is complex/special-cased; ER boost missing).
- 147 Wonder Skin — ER piece (suppress foe damage-boost, ×0.77) ✓; leftover vanilla WonderSkinAbAttr (status-move acc→50%) is extra, not in ER desc.
NOTES (verified OK — stale ROM desc, intentional ER buffs per rebalance comments):
- 125 Sheer Force 1.5× (vanilla 1.3); 148 Analytic 1.5× (vanilla 1.3). Both documented ER buffs. LESSON: rom-descriptions values can be stale; rebalance "ER ups to X" comments are authoritative.
- 145 Big Pecks repurposed to contact 1.3× ✓; 135 Light Metal +1.3 speed ✓.
OK: 121 Multitype, 122 Flower Gift, 123 Bad Dreams, 124 Pickpocket, 126 Contrary, 127 Unnerve, 128 Defiant, 129 Defeatist, 130 Cursed Body, 131 Healer, 132 Friend Guard, 133 Weak Armor, 134 Heavy Metal, 136 Multiscale, 137 Toxic Boost, 139 Harvest, 140 Telepathy, 141 Moody, 142 Overcoat, 143 Poison Touch, 144 Regenerator, 146 Sand Rush, 150 Imposter, 151 Infiltrator, 152 Mummy, 153 Moxie, 154 Justified, 155 Rattled, 156 Magic Bounce, 157 Sap Sipper, 158 Prankster, 159 Sand Force.

## Chunk 6 — ids 160–199 (marker → 199)
UNIMPLEMENTED (likely upstream, not ER botch):
- 180 Symbiosis — empty attrs (ally-item-pass; complex, likely .unimplemented upstream).
OK (faithful): 160 Iron Barbs, 161 Zen Mode, 162 Victory Star, 163 Turboblaze(+Fire), 164 Teravolt(+Electric), 165 Aroma Veil, 166 Flower Veil, 167 Cheek Pouch (desc="no effect"→empty OK), 168 Protean, 169 Fur Coat, 170 Magician, 171 Bulletproof, 172 Competitive, 173 Strong Jaw, 174 Refrigerate, 175 Sweet Veil, 176 Stance Change, 177 Gale Wings, 178 Mega Launcher, 179 Grass Pelt, 181 Tough Claws, 182 Pixilate, 183 Gooey, 184 Aerilate, 185 Parental Bond, 186 Dark Aura, 187 Fairy Aura, 188 Aura Break, 189 Primordial Sea, 190 Desolate Land, 191 Delta Stream, 192 Stamina, 193 Wimp Out, 194 Emergency Exit, 195 Water Compaction, 196 Merciless, 197 Shields Down, 198 Stakeout, 199 Water Bubble.
NOTE: vanilla-map band (1–225) largely faithful; concentrate remaining audit on ER customs (226+) where botches cluster (already found Perfectionist/Coil Up/Thundercall/Tangled Feet there).

## Chunk 7 — ids 200–226 (marker → 226)
BOTCH:
- 223 Power of Alchemy — wired CopyFaintedAllyAbility (=Receiver vanilla); ER spec = transmute opposing berries→Black Sludge on entry + lost-items→Black Sludge. Wrong mechanic; needs item-transmute primitive. DEFER.
FIXED (rebalance patchers + test er-rebalance-attr-patches.test.ts, all green):
- 225 RKS System — added PokemonTypeChangeAbAttr (Protean) + StabBoostAbAttr (Adaptability) on top of NoFusion form-marker.
- 202 Slush Rush — added BlockWeatherDamageAttr(HAIL, SNOW) on top of 1.5× SPD.
- 50 Run Away (carried over from chunk 2 MINOR) — stat-lowered Speed rider bumped +1 → +2.
OK: 200 Steelworker, 201 Berserk, 203 Long Reach, 204 Liquid Voice, 205 Triage, 206 Galvanize, 207 Surge Surfer, 208 Schooling, 209 Disguise, 210 Battle Bond, 211 Power Construct, 212 Corrosion, 213 Comatose, 214 Queenly Majesty, 215 Innards Out, 216 Dancer, 217 Battery, 218 Fluffy, 219 Dazzling, 220 Soul-Heart, 221 Tangling Hair, 222 Receiver, 224 Beast Boost, 226 Electro Surge.

## Chunk 8 — ids 226–261 (marker → 261)
FIXED (rebalance patchers + er-rebalance-attr-patches.test.ts, all green):
- 239 Propeller Tail — code had only BlockRedirect; spec = "Swift Swim + Redirection Immunity". Added rain-gated StatMultiplier(SPD,1.5).
- 242 Stalwart — code had only BlockRedirect; spec adds crit + suppression immunity. Added BlockCritAbAttr (suppression-immunity is the builder's uncopiable/unsuppressable flags).
PARTIAL / NOTE (defer — upstream or needs new primitive / minor):
- 241 Gulp Missile — code only NoTransform+NoFusion form markers; the catch-prey-on-Surf/Dive + spit-on-hit mechanic is handled (if at all) by upstream form-change move hooks, not ability attrs. Complex; defer.
- 251 Screen Cleaner — removes AURORA_VEIL/LIGHT_SCREEN/REFLECT; FULL also lists Smokescreen (ER evasion-screen tag) — not removed. Minor.
- 261 Curious Medicine — uses scripted Haze (move 114) which clears the WHOLE field's stat changes; spec is "removes ally's stat changes". Over-broad approximation; acceptable absent an ally-only stat-reset primitive.
OK: 226 Electro Surge, 227 Psychic Surge, 228 Misty Surge, 229 Grassy Surge, 230 Full Metal Body, 231 Shadow Shield, 232 Prism Armor, 233 Neuroforce, 234 Intrepid Sword, 235 Dauntless Shield, 236 Libero, 237 Ball Fetch, 238 Cotton Down, 240 Mirror Armor, 243 Steam Engine, 244 Punk Rock, 245 Sand Spit, 246 Ice Scales, 247 Ripen, 248 Ice Face, 249 Power Spot, 250 Mimicry, 252 Steely Spirit, 253 Perish Body, 254 Wandering Spirit, 255 Gorilla Tactics, 256 Neutralizing Gas, 257 Pastel Veil (ER repurpose→Safeguard, abbr agrees), 258 Hunger Switch, 259 Quick Draw, 260 Unseen Fist.

## Chunk 9 — ids 262–296 (marker → 296)
FIXED (dispatcher + bespoke-dispatch.test.ts, all green):
- 269 Whiteout — added BlockWeatherDamageAttr(HAIL,SNOW) (hail immunity) alongside the highest-stat×1.5 boost.
- 296 Lead Coat — converted damage-reduction-generic→bespoke: DamageReduction(physical,0.4) + StatMultiplier(SPD,0.9). Speed penalty was previously dropped. (Weight-triple clause has no battle primitive — omitted.)
UNIMPLEMENTED (empty CODE — flag; needs large primitive):
- 268 Chloroplast — "Weather Ball/Solar moves/Growth act as if in sun + boosted recovery + Pledge interactions." Bespoke case present but returns no attrs; sun-move-emulation primitive absent. DEFER.
PARTIAL / NOTE (defer):
- 291 Aurora Borealis — Ice STAB ✓; niche clauses (Weather Ball→Ice, Aurora Veil w/o hail, Blizzard never-miss) missing.
- 266 As One — Glastrier (Chilling Neigh/ATK) wired; the Spectrier (Grim Neigh/SpAtk) form-variant may share the ATK wiring (single custom id 5004). NEEDS source check; low priority.
OK: 262 Transistor, 263 Dragon's Maw, 264 Chilling Neigh, 265 Grim Neigh (SpAtk), 270 Pyromancy, 271 Keen Edge, 272 Prism Scales, 273 Power Fists, 274 Sand Song, 275 Rampage, 276 Vengeance (1.2×ghost × 1.25 low-HP = 1.5), 277 Blitz Boxer, 278 Antarctic Bird, 279 Immolate, 280 Crystallize, 281 Electrocytes, 282 Aerodynamics, 283 Christmas Spirit, 284 Exploit Weakness, 285 Ground Shock, 286 Ancient Idol, 287 Mystic Power, 288 Perfectionist, 289 Growing Tooth, 290 Inflatable, 292 Avenger, 293 Let's Roll, 294 Aquatic, 295 Loud Bang.

## Chunk 10 — ids 297–320 (marker → 320)
FIXED (dispatcher composite conversions + bespoke-dispatch.test.ts, all green):
- 312 Dragonfly — was entry-effect (add-Dragon only); added AttackTypeImmunity(GROUND). "Avoids Ground attacks" was the missing half.
- 306 Nocturnal — was type-damage-boost (Dark +1.25x only); added ReceivedTypeDamageMultiplier(Dark 0.75)+(Fairy 0.75) for the "-25% from Dark/Fairy" half.
- 311 Liquified — was damage-reduction-generic (contact 0.5 only); added ReceivedTypeDamageMultiplier(Water 2.0) for the "Water hurts 2x" half.
PARTIAL / NOTE (defer — offense-side or niche clause, or needs primitive):
- 297 Amphibious — Water STAB ✓; "can't become drenched" immunity missing (no drench-immunity primitive).
- 302 Coil Up — worktable shows always-on +1 priority for biting; spec is "once on entry, consumed after landing". Verify vs current bespoke (summary notes 302 was rewired); a true one-shot/consumed needs a consumable-priority primitive.
- 304 Magical Dust — Psychic-on-contact (defensive side) ✓; offense-side type change missing (same limitation as Damp — no post-attack-add-type-to-target primitive).
- 314 Mountaineer — Rock move immunity ✓; Stealth Rock hazard immunity missing (needs hazard-immunity path).
- 320 Air Blower — 3-turn Tailwind ✓; "also activates Wind Rider" (wind-move immunity/boost) missing.
OK: 298 Grounded, 299 Earthbound, 300 Fighting Spirit, 301 Cryptic Power (SpAtk×2; FULL text mislabels as Feline Prowess but mechanic matches abbr), 303 Fossilized, 305 Dreamcatcher, 307 Self Sufficient, 308 Tectonize, 309 Ice Age, 310 Half Drake, 313 Dragonslayer, 315 Hydrate, 316 Metallic, 317 Permafrost, 318 Primal Armor, 319 Raging Boxer.

## Chunk 11 — ids 321–345 (marker → 345)
FIXED (dispatcher composite conversion + bespoke-dispatch.test.ts, green):
- 328 Overwhelm — was status-immunity (Intimidate/Scare only); added OffensiveTypeChartOverride(Dragon→Fairy 1x) for the "hits Fairies with Dragon moves" clause. (Note: case-285 Ground Shock's "primitive doesn't exist" comment is STALE — OffensiveTypeChartOverrideAbAttr exists and 285 is handled by R48.)
APPROX / PARTIAL (defer — needs primitive):
- 327 Hypnotist — wired ConditionalAlwaysHit(Hypnosis); spec is "accuracy 90%, still affected by evasion". Always-hit over-approximates; needs per-move accuracy-set primitive.
- 333 Sweet Dreams — 1/8 sleep heal ✓; Bad Dreams immunity missing.
- 334 Bad Luck — crit-immune + ignore-effects + 0.95 acc ✓; "foes always roll min damage (85%)" missing (needs damage-roll-floor primitive).
- 344 Poison Absorb — FIXED: absorb-heal ✓ + added terrain-gated PassiveRecovery (1/8 on Toxic Terrain). Now bespoke.
OK: 321 Juggernaut, 322 Short Circuit, 323 Majestic Bird, 324 Phantom, 325 Intoxicate, 326 Impenetrable, 329 Scare, 330 Majestic Moth, 331 Soul Eater, 332 Soul Linker, 335 Haunted Spirit, 336 Electric Burst, 337 Raw Wood, 338 Solenoglyphs, 339 Spider Lair, 340 Fatal Precision, 341 Fort Knox (0.77 suppress approximation), 342 Seaweed, 343 Psychic Mind, 345 Scavenger.

## Chunk 12 — ids 346–370 (marker → 370)
PARTIAL / NOTE (defer — needs primitive that doesn't exist):
- 349 Overcharge — Electric-vs-Electric 2x ✓; "can paralyze Electric-types" missing (status-immunity-override primitive).
- 365 Lunar Eclipse — Fairy+Dark STAB ✓; "Hypnosis 90% accuracy" missing (same accuracy-set gap as 327 Hypnotist).
- 366 Solar Flare (composite Chloroplast+Immolate) — Immolate half (Normal→Fire+boost) ✓; Chloroplast sun-emulation half empty (268 unimplemented).
- 368 Sighting System — always-hit ✓; "-3 priority for <80% acc moves" missing (no accuracy-based priority filter).
- 347 Multi-Headed — 2× AddSecondStrike approximates the per-head 25%/20%/15% scaling; not exact but reasonable.
OK: 346 Twisted Dimension, 348 North Wind (HAIL only — SNOW omittable), 350 Violent Rush, 351 Flaming Soul, 352 Sage Power, 353 Bone Zone, 354 Weather Control, 355 Speed Force, 356 Sea Guardian, 357 Molten Down, 358 Hyper Aggressive, 359 Flock, 360 Field Explorer, 361 Striker, 362 Frozen Soul, 363 Predator, 364 Looter (desc=heal only), 367 Power Core, 369 Bad Company (desc="not implemented"→empty OK), 370 Opportunist.

## Chunk 13 — ids 371–395 (marker → 395)
FIXED (dispatcher composite conversions + bespoke-dispatch.test.ts, green):
- 387 Spectral Shroud — was chance-status (poison only); restored Spectralize half (TypeConversion Normal→Ghost + 1.2x boost) alongside the 30% Toxic chance. Updated er-id-resync-wiring + init-custom-abilities tests.
- 385 Nosferatu — was lifesteal (heal-all-moves); now contact-gated heal (1/2) + contact MovePowerBoost(1.2) for the "+20% contact damage" half.
- (also corrected stale test pin: 909 Lightsaber archetype composite→bespoke, pre-existing red.)
NOTE (index-drift zone — FULL text stale/shifted for 388/390/391/392/393; judged vs ABBR+CODE):
OK: 371 Giant Wings, 372 Momentum, 374 Big Leaves (composite; sun-gating of Chlorophyll part NEEDS-VERIFY), 375 Precise Fist, 379 Ice Dew, 380 Sun Worship, 381 Pollinate, 382 Volcano Rage, 383 Cold Rebound, 384 Low Blow, 386 Spectralize, 389 Thundercall, 390 Marine Apex, 391 Mighty Horn, 392 Hardened Sheath, 393 Arctic Fur, 394 Lethargy, 395 Iron Barrage (composite; -3 priority deferred).

## DEFERRED — PRIMITIVES TO BUILD (per user: build, do not defer)
Backlog of clauses still missing because the primitive didn't exist. Each needs a new AbAttr + wiring + test:
1. ~~Offense-side type-change-on-contact (Damp 6 offense, Magical Dust 304 offense)~~ — DONE: built `PostAttackChangeTargetTypeAbAttr` (post-attack-change-target-type.ts), wired Damp + Magical Dust offense halves, unit + dispatch tests green.
2. Per-move accuracy-override / floor (Hypnotist 327, Lunar Eclipse 365) — set a named move's accuracy to N (still evasion-affected), NOT always-hit.
3. Status-immunity-override-on-target (Overcharge 349) — "can paralyze Electric-types" (bypass type-based status immunity for the holder's moves).
4. Damage-roll-floor for foes (Bad Luck 334) — foes always roll min (85%) damage.
5. ~~Terrain-conditional passive recovery (Poison Absorb 344)~~ — DONE: PassiveRecovery condition {kind:"terrain",terrains:[TOXIC]} (1/8 heal) added; Poison Absorb now bespoke (absorb-heal + Toxic-Terrain heal).
6. Spread-targeting override (Artillery 377, Amplifier 378) — single-target tagged moves hit both foes.
7. ~~Accuracy-based priority filter (Sighting System 368, Iron Barrage 395)~~ — DONE: added `maxAccuracy` to PriorityModifierFilter; wired Sighting System -3 priority for <80% acc moves; Iron Barrage (composite) inherits it via its er-368 part. Unit + dispatch tests green.
8. Bad-Dreams-damage immunity (Sweet Dreams 333).
9. Confusion immunity + act-while-rampaging (Discipline 388).
10. Trapped-target bonus (Grip Pincer 373) — vs trapped foe: ignore def stat changes + always hit; trap chip 1/8.
11. Sun-move-emulation (Chloroplast 268, Solar Flare 366, Big Leaves 374) — Weather Ball/Solar moves/Growth/recovery act as if in sun.
12. Item/berry-transmutation on entry & on-loss (Power of Alchemy 223) — berries→Black Sludge etc.
13. Drench-immunity (Amphibious 297).
14. Defensive-stat-substitution gated on tag (Tangled Feet 77) — use Speed as defense when confused/enraged.
15. Crit-targets-weaker-defensive-stat (Deadeye 376) — verify vs existing DefenseStatSwap primitive first.

## Chunk 14 — ids 396–415 (marker → 415)
FIXED (dispatcher composite conversions + bespoke-dispatch.test.ts, green):
- 399 Parry — was damage-reduction-generic (20% reduction only); added CounterAttackOnHit(Mach Punch, 20 BP, contact) for the counter half.
- 408 Fearmonger — was chance-status-on-hit (10% fear only); added PostSummonStatStageChange([ATK,SpAtk],-1,foes) for the on-entry Intimidate+Scare; fear chance now contact-gated.
BOTCH (needs new primitive — see backlog #16):
- 407 Retribution Blow — wired OnOpponentStatRaise{stats:[ATK+1]} (boosts holder ATK when foe raises); spec = "uses 150 BP Hyper Beam (no recharge) against foes that boost stats". Wrong mechanic; needs scripted-move-on-opponent-stat-raise primitive.
PARTIAL / NOTE (defer):
- 403 Roundhouse — FIXED: kicks always-hit ✓ + added DefenseStatSwapOnFlag "target-lower-defense" variant (kicking moves now route to the foe's weaker defense via the power-ratio approximation). Unit + dispatch tests green.
OK: 396 Steel Barrel, 397 Pyro Shells, 398 Fungal Infection, 400 Scrapyard, 401 Loose Quills, 402 Toxic Debris, 404 Mineralize, 405 Loose Rocks, 406 Spinning Top, 409 King's Wrath, 410 Queen's Mourning, 411 Toxic Spill, 412 Desert Cloak, 413 Draconize, 414 Pretty Princess, 415 Self Repair.

## DEFERRED — PRIMITIVES TO BUILD (additions)
16. Scripted-move-on-opponent-stat-raise (Retribution Blow 407) — when a foe raises a stat, holder uses a scripted move (150 BP Hyper Beam, no recharge). Like OnOpponentStatRaise but dispatches a scripted move instead of stat changes.
17. Target-weaker-defense swap — flag-gated DONE (Roundhouse 403 via DefenseStatSwapOnFlag "target-lower-defense"). Remaining: Deadeye 376 wants the same routing gated ON-CRIT (different trigger — needs an on-crit defense-swap variant).

## Chunk 15 — ids 416–435 (marker → 435)
BOTCH → FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 422 Gifted Mind — was reducing incoming PSYCHIC moves ×0.5 (wrong direction). Now 3× ReceivedTypeDamageMultiplier (DARK/GHOST/BUG ×0.5) via buildTypeEffectivenessModAttrs — nulls the user's Psychic weaknesses (2x→neutral). Status-always-hit half kept.
- 433 Dual Wield — was Keen-Edge-only HitMultiplier, no power cut. Now HitMultiplier + HitMultiplierPower(0.7) filtered on PULSE_MOVE|SLICING_MOVE (hasFlag is any-bit), so both Mega Launcher AND Keen Edge moves hit twice at 70%.
- 435 Ambush — was a permanent +1 crit-stage on all moves. Now ConditionalCrit gated to first turn out (tempSummonData.waveTurnCount === 1, the Fake Out signal) = guaranteed first-turn crit.
PARTIAL / NOTE:
- 423 Hydro Circuit — Electric +50% ✓; "Water moves siphon 25%" (lifesteal gated to Water-type) missing.
- 425 Absorbant — Leech Seed on drain moves ✓; "+50% drain recovery" missing.
- 421 Sweeping Edge — Keen Edge always-hit ✓; spread-to-both-foes missing (backlog #6).
- 426 Clueless — weather + terrain negation ✓; "rooms" (Trick/Magic/Wonder Room) negation missing.
OK: 416 Atomic Burst (composite), 417 Hellblaze, 418 Riptide, 419 Forest Rage, 420 Primal Maw, 424 Equinox, 427 Cheating Death, 428 Cheap Tactics, 429 Coward, 430 Volt Rush, 431 Dune Terror, 432 Infernal Rage, 434 Elemental Charge (fire→burn/ice→frostbite/electric→para).

## Chunk 16 — ids 436–455 (marker → 455)
PARTIAL / NOTE (need primitive or large/complex — defer):
- 437 Radiance — +20% accuracy ✓; "Dark moves fail when user present" missing (needs field-wide type-move-block primitive, like WeatherBasedMoveBlock but Dark-type).
- 438 Jaws of Carnage — flat 50% KO heal; spec is 50% with biting moves / 25% with others (biting-gated heal-fraction split missing).
- 439 Angel's Wrath — only 4 moves made always-hit; spec is a huge per-move transform suite (Tackle Encore+Disable, String Shot sets hazards, Harden omniboost, Iron Defense→King's Shield, Electroweb traps, Bug Bite heals, Poison Sting toxic+SE-on-Steel + damage boost). Massively under-implemented; needs many per-move bespoke transforms. DEFER (large).
- 447 Furnace — +2 Speed when hit by Rock ✓; "switch-in with Stealth Rock present" trigger missing.
- 455 Archmage — 8 chance-effects wired but several type→effect mappings diverge from spec (spec: Dark=Bleed [code Flinch], Grass=set-terrain [code Seeded], Psychic=set-terrain [code Confused], Water=Confusion [missing], Ghost=Disable [code Fear], + Normal=Encore/Rock=Stealth Rock/Fighting=+SpAtk/Flying=+Spd/Dragon=-Atk/Ground=Trap/Steel=+Def all missing). Very complex; needs terrain/encore/hazard/stat per-type effect dispatch. DEFER (large).
OK: 436 Atlas, 440 Prismatic Fur (composite), 441 Shocking Jaws, 442 Fae Hunter, 443 Gravity Well, 444 Evaporate, 445 Lumberjack, 446 Well Baked Body, 448 Electromorphosis, 449 Rocky Payload, 450 Earth Eater, 451 Lingering Aroma, 452 Fairy Tale, 453 Raging Moth, 454 Adrenaline Rush.

## Chunk 17 — ids 456–475 (marker → 475)
BOTCH → FIXED:
- 462 Combat Specialist — archetype row was flag-damage-boost (PUNCHING only); a correct bespoke case (punching + kicking FlagDamageBoost) already existed but was dead. Flipped row → bespoke to activate it. (Covered by existing round-12-wires test.)
PARTIAL / NOTE (defer — needs primitive or complex):
- 463 Jungle's Guard — UserFieldStatusEffectImmunity ✓; "stat-drop protection + sun status-heal + Grass-ally gating" missing.
- 465 Pixie Power — Fairy +1.33 (self) ✓; "1.2x accuracy" (clean StatMultiplier add) + field-wide aura (affects allies+opponent, Aura-Break-reversible) missing.
- 471 Cold Plasma — adds flat 10% burn on (electric) moves; spec "Electric moves inflict burn INSTEAD of paralysis" — the suppress-native-paralysis + per-move-chance match missing (needs per-move status-swap primitive).
OK: 456 Cryomancy, 457 Phantom Pain, 458 Purgatory, 459 Emanate, 460 Kunoichi's Blade (composite), 461 Monkey Business, 464 Hunter's Horn, 466 Plasma Lamp, 467 Magma Eater (composite), 468 Super Hot Goo, 469 Nika (composite; water-no-sun-penalty as 2x), 470 Archer, 472 Super Slammer, 473 Inversion, 474 Accelerate, 475 Frost Burn.

## Chunk 18 — ids 476–495 (marker → 495)
FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 492 Freezing Point — was defensive-only frostbite (2 OnHit procs); spec "works offensively AND defensively". Added 2 ChanceBattlerTagOnAttack procs (contact 20% / non-contact 30%).
- 493 Cryo Proficiency — inherits the 492 offensive fix via its composite part (er 492) + keeps its hail-on-hit rider.
PARTIAL / NOTE (defer — needs primitive or complex):
- 477 Generator — on-entry charge ✓; "recharge when Electric Terrain becomes active" missing (terrain-onset hook).
- 478 Moon Spirit — Fairy+Dark STAB ✓; "Moonlight recovers 75%" missing (move-specific heal override).
- 482 Sand Guard — special ×0.5 in sand ✓; "blocks priority moves" missing (sand-gated priority-immunity).
- 484 Wind Rider — boosts ATK; spec "highest attacking stat" (minor — should pick higher of ATK/SpAtk).
- 489 Enlightened (composite) — Emanate + flinch/intim immunity ✓; "Focus Blast never misses" missing (per-move accuracy, backlog #2).
- 490 Peaceful Slumber (composite) — sleep + always recovery ✓; "Bad Dreams immunity" missing (backlog #8).
OK: 476 Itchy Defense, 479 Dust Cloud, 480 Berserker Rage (composite), 481 Trickster, 483 Natural Recovery (composite), 485 Soothing Aroma, 486 Prim and Proper (composite), 487 Super Strain, 488 Tipping Point, 491 Aftershock, 494 Arcane Force, 495 Doombringer.

## Chunk 19 — ids 496–515 (marker → 515)
FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 497 Yuki Onna — was offensive-infatuate only; added on-entry Intimidate+Scare (ATK/SpAtk -1 to foes) + defensive infatuate (ChanceBattlerTagOnHit). All three clauses now wired.
PARTIAL / NOTE (defer — needs primitive or one-move/complex):
- 499 Refrigerator (composite) — Filter ✓ + accuracy ✓; "removes Ghost-typing on hit" (Illuminate ER clause) missing (same gap as 35 Illuminate).
- 500 Heaven Asunder — crit +1 all moves ✓; "Spacial Rend always crits" missing (per-move ConditionalCrit — minor, one move).
- 506 Determination — SpAtk ×1.5 when statused ✓; "frostbite doesn't reduce SpAtk" protection missing.
- 496 Wishmaker — Wish on entry ✓; "3 uses per battle" cap not enforced (on-entry naturally bounds per switch-in).
OK: 498 Suppress, 501 Purifying Waters (composite), 502 Seaborne (composite), 503 High Tide, 504 Change of Heart, 505 Mystic Blades, 507 Fertilize, 508 Pure Love (composite), 509 Fighter, 510 Mycelium Might, 511 Telekinetic, 512 Combustion, 513 Blade's Essence (composite), 514 Powder Burst, 515 Retriever.

## Chunk 20 — ids 516–535 (marker → 535)
FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 529 Berserk DNA — +2 highest-attack boost ✓; added SelfDamageOnAttack(0.33) for the "enraged → 33% recoil on all attacks" downside that was entirely missing.
PARTIAL / NOTE (defer):
- 524 Bass Boosted (composite) — sound boosts + reduction ✓; Amplifier's spread-to-both-foes missing (backlog #6).
- 534 Cosmic Daze — 2x vs confused ✓; "vs enraged" case + "enraged/confused foes take 2x self-hit" missing (conditional-damage needs a confused-or-enraged variant).
- 516 Monster Mash — Trick-or-Treat on entry ✓; "no fog benefit" clause missing (minor).
OK: 517 Two Step, 518 Spiteful, 519 Fortitude, 520 Devourer (composite), 521 Phantom Thief, 522 Early Grave, 523 Grappler, 525 Flaming Jaws, 526 Monster Hunter, 527 Crowned Sword (composite), 528 Crowned Shield (composite), 530 Crowned King (composite), 531 Clap Trap, 532 Permanence, 533 Hubris, 535 Mind's Eye.

## Chunk 21 — ids 536–555 (marker → 555)
FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 539 Chrome Coat — special-side twin of Lead Coat; was damage-reduction-generic (40% special only). Now bespoke: DamageReduction(special,0.4) + StatMultiplier(SPD,0.9).
VALUE BOTCH (flagged — fix needs care):
- 554 Anger Shell — code gives +1 ATK/SpAtk/Spd (-1 Def/SpDef); spec (abbr "applies Shell Smash" + full "by 2 stages each") = +2 offenses. vanilla-map (pkrg 271); fixing means a rebalance patch mutating the PostDefendHpGatedStatStageChange stages 1→2 (verify ER intent vs vanilla baseline first).
PARTIAL / NOTE (defer):
- 538 Voodoo Power — 30% bleed on any hit; spec "when hit by SPECIAL attacks" (category filter missing — minor over-trigger).
- 543 Seed Sower — Grassy Terrain on hit ✓; "heals party status" missing.
- 542 Showdown Mode (composite Ambush+Violent Rush) — VERIFIED: parts reference er-435 + er-350 directly, so it inherits the new first-turn ConditionalCrit from the Ambush (435) fix. Worktable showed the pre-fix snapshot. OK.
OK: 536 Blood Price, 537 Spike Armor, 540 Banshee, 541 Web Spinner, 544 Airborne, 545 Parroting, 546 Salt Circle, 547 Purifying Salt, 548 Protosynthesis, 549 Quark Drive, 550 Wind Power, 551 Impulse, 552 Terminal Velocity, 553 Guard Dog, 555 Egoist.

## Chunk 22 — ids 556–575 (marker → 575)
NEEDS-VERIFY / NOTE:
- 570 Ill Will — wired PostDefendMoveDisable(100%); spec "drains the PP of the move that FAINTS the user (direct hit)". PostDefend fires when hit-and-surviving, not on-faint — likely over-triggers (disables on every hit) and "disable" ≈ but ≠ "PP drain". Verify vs C-source; may need an on-faint-PP-drain variant.
OK: 556 Subdue, 557 Readied Action, 558 Stygian Rush, 559 Guilt Trip, 560 Tidal Rush, 561 Zero To Hero, 562 Costar, 563 Commander, 564 Tactical Retreat, 565 Vengeful Spirit (composite), 566 Cud Chew, 567 Armor Tail, 568 Mind Crunch, 569 Supreme Overlord, 571 Fire Scales, 572 Watch Your Step, 573 Rapid Response, 574 Sharp Edges, 575 Thermal Exchange.

## Chunk 23 — ids 576–595 (marker → 595)
FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 593 Molten Blades — was 20% burn only; added FlagDamageBoost(SLICING_MOVE, 1.3) for the missing Keen Edge +30% identity.
- 594 Haunting Frenzy — was 20% flinch only; added StatTriggerOnKo(SPD +1) for the missing "+1 Speed on KO".
PARTIAL / NOTE (defer — needs primitive or complex):
- 585 Sun Basking — physical ×0.5 in sun ✓; "blocks priority moves" missing (same weather-gated priority-block gap as Sand Guard 482).
- 589 Catastrophe — wired flat SpAtk ×1.3 in sun/rain; spec is "Water moves get rain's boost in sun / Fire moves get sun's boost in rain" (type+weather move-power, not a flat stat boost). Approximate; needs a type-gated weather power primitive.
- 590 Blademaster (composite) — Keen Edge always-hit + 30% ✓; Sweeping Edge spread-to-both-foes missing (backlog #6).
USEFUL: 591 Celestial Blessing proves PassiveRecovery supports conditionSpec {kind:"terrain", terrains:[...]} — unblocks backlog #5 (Poison Absorb 344 Toxic-Terrain heal).
OK: 576 Good As Gold, 577 Sharing Is Caring, 578 Tablets of Ruin, 579 Sword of Ruin, 580 Vessel of Ruin, 581 Beads of Ruin, 582 Thick Skin, 583 Gallantry, 584 Orichalcum Pulse, 586 Winged King, 587 Hadron Engine, 588 Iron Serpent, 591 Celestial Blessing, 592 Minion Control, 595 Noise Cancel.

## Chunk 24 — ids 596–614 (marker → 614)
NOTE (minor):
- 609 Parasitic Spores — PostTurnHurtNonTyped (field-wide 1/8 to non-Ghost) ✓; "spread on contact" clause not separately wired, but the field-wide turn damage already affects all non-Ghost foes so it's effectively redundant. Low impact.
OK: 596 Radio Jam, 597 Olé!, 598 Malicious, 599 Dead Power, 600 Brawling Wyvern (composite), 601 Mythical Arrows, 602 Lawnmower, 603 Flourish, 604 Desert Spirit, 605 Contempt (composite), 606 Aerialist (composite), 607 Tera Shell, 608 Toxic Chain, 610 Poison Puppeteer, 611 Entrance, 612 Rejection, 613 Apple Enlightenment (composite), 614 Balloon Bomb (composite, PostFaintDetonate).

## Chunk 25 — ids 615–634 (marker → 634)
FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 618 Fragrant Daze — was defensive-only confuse; added ChanceBattlerTagOnAttack (offensive confuse) for "both when attacking and being attacked".
PARTIAL / NOTE (defer):
- 616 Demolitionist — ATK×2 first turn + ignore-protect ✓; "breaks screens" missing (needs screen-break-on-attack primitive).
- 620 Old Mariner (composite) — Seaweed + Water STAB ✓; "immune to drench" missing (no drench-immunity primitive; same as Amphibious 297).
- 622 Beautiful Music — 50% infatuate on sound ✓; "ignoring gender" not honored (INFATUATED tag enforces opposite-gender; would need a gender-bypass infatuate). Minor.
- 623 Surprise! — wired flat 100% flinch-on-hit; spec is "in fog, counter priority moves with a +3-priority Astonish". Heavy approximation; needs a fog-gated priority-counter primitive. Defer.
OK: 615 Flaming Maw (composite), 617 Rockhard Will, 619 Low Visibility (fog sub-effects are weather-inherent), 621 Ectoplasm, 624 Snow Song, 625 Greater Spirit, 626 Resonance (30% per abbr; full says 50% — abbr wins), 627 Ethereal Rush, 628 Pretty Privilege, 629 Shallow Grave, 630 Menacing Situation, 631 Shiny Lightning, 632 Terrify, 633 Ice Downfall, 634 Last Stand.

## Chunk 26 — ids 635–654 (marker → 654)
FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 642 Jackhammer — was filter={} (ALL moves hit twice, full power); now HAMMER_BASED-gated HitMultiplier + HitMultiplierPower(0.7).
- 645 Soul Crusher — R48 case wired only the SpDef def-swap (a prior R50 pass wrongly dropped the 1.1x boost as "approximation"); restored FlagDamageBoost(HAMMER,1.1) alongside the swap. Updated its test.
- 646 Arc Flash — was defensive 50% burn only; added offensive 50% paralyze on contact.
PARTIAL / NOTE (defer — needs primitive):
- 644 Ice Cold Hunter — filter={} (ALL moves hit twice always); spec "Ice moves hit twice IN HAIL (full power) + hail immunity". Needs HitMultiplier with type-filter AND a weather gate (primitive lacks weather condition) + BlockWeatherDamage. Defer.
- 648 On the Prowl — ChangeMovePriority +1 always; spec "first-turn only + negative priority clamps to 0". Needs first-turn-gated priority + clamp. Defer.
- 650 Venoblaze Pincers — 20% burn on contact ✓; missing the 1.2x physical boost + the "or Poison" alternative (effects-array semantics). Defer.
- 640 Rhythmic — repeat-move boost capped at 2x; spec "no maximum cap" (intentional safety cap; minor).
OK: 635 Pyroclastic Flow (composite), 636 Blood Bath, 637 Battle Aura, 638 Bloodlust (composite), 639 Piercing Solo, 641 Chunky Bass Line, 643 Denting Blows, 647 Unicorn (composite), 649 Pretentious, 651 Eternal Blessing (composite), 652 Sugar Rush (composite), 653 Rest in Peace, 654 White Noise (composite).

## Chunk 27 — ids 655–674 (marker → 674)
PARTIAL / NOTE (defer — needs primitive):
- 661 Unlocked Potential (composite) — Inner Focus immunities + Berserk SpAtk ✓; "Focus Blast never misses" missing (accuracy-set, backlog #2).
- 668 No Turning Back — 5× StatMultiplier(1.2) when <½ HP ✓ (approximates +1 all stats); "can't switch/flee when low HP" (self-trap) missing.
- 669 Flammable Coat — wired a static Fire ×0.5 damage reduction; spec is a FORM-CHANGE (Lumbering Sloth→Engulfed on using/being-hit-by Fire). Form-change not wired; resist is a stand-in. Defer (form-change complex).
- 671 Bad Omen — crit ×0.25 reduction ✓; "foes always min-roll (85%) damage" missing (damage-roll-floor primitive, same as Bad Luck 334).
NOTE: 658 Power Edge is the CORRECT def-swap+boost pattern (def-swap + FlagDamageBoost 1.3) — confirms the Soul Crusher 645 fix shape.
OK: 655 Smokey Maneuvers, 656 Tag, 657 Power Metal, 658 Power Edge, 659 Superconductor, 660 Ultra Instinct, 662 Higher Rank, 663 Funeral Pyre, 664 Flame Bubble (composite), 665 Elemental Vortex (composite), 666 Snowy Wrath (composite), 667 Pattern Change (composite), 670 Draco Morale, 672 Mosh Pit, 673 Blood Stain, 674 Blood Stigma.

## Chunk 28 — ids 675–694 (marker → 694)
FIXED (dispatcher + bespoke-dispatch.test.ts, green):
- 678 Fluffiest — was ¼ contact reduction only; added ReceivedTypeDamageMultiplier(FIRE ×4) (Liquified pattern) for the "4x weak to Fire" half.

## ✅ SYSTEMIC BOTCH — FIXED: composite parts now preserve source CONDITIONS
ROOT CAUSE: resolveCompositePartAttrs (archetype-dispatcher.ts ~line 1417) copies a pokerogue
part's `ability.attrs` VERBATIM but NOT the source ability's ability-level `.conditions`. So any
composite embedding a CONDITION-GATED vanilla ability applies that part UNCONDITIONALLY.
Affected (weather/HP-gated vanilla parts in composites):
- Swift Swim (33, rain) → e.g. 680 Way of Swiftness, 502 Seaborne: +50% Speed ALWAYS, not rain-only.
- Chlorophyll (34, sun) → 374 Big Leaves: +50% Speed ALWAYS, not sun-only.
- Sand Rush / Slush Rush / Surge Surfer / Solar Power / etc. when used as composite parts — same.
IMPACT: these composites are stronger than intended (unconditional stat boosts).
FIX (needs care — architectural): when copying a pokerogue part whose source ability has
`.conditions`, gate the copied attrs by those conditions. Options: (a) per-attr condition wrapper
that re-checks the source ability's conditions in canApply; (b) for StatMultiplier parts, re-create
with the per-attr `condition` (PokemonAttackCondition) set to the source weather/HP gate. Do NOT
copy conditions to the whole composite ability (other parts would be wrongly gated). Verify by
listing every ER_COMPOSITE_PARTS entry whose pokerogue part id ∈ {weather/HP-gated abilities}.
PARTIAL / NOTE (defer): 676 Sidewinder (consumable first-move priority), 679 Way of Precision +
661/489 (Focus Blast accuracy, backlog #2), 693 Patchwork (curse-on-disguise-break).
OK: 675 Max Acceleration, 677 Petrify, 680 Way of Swiftness*, 681 Atomic Punch, 682 Iron Giant, 683 Master Hand, 684 Final Blow, 685 Hospitality, 686 Butter Up, 687 Vitality Strike, 688 Imposing Wings, 689 Sword of Damnation, 690 Restraining Order, 691 Assassin's Tools, 692 Frostmaw (frostbite per abbr; full "burn" stale), 694 Blind Rage. (*680 = correct except the systemic Swift-Swim-rain-gate issue above.)

### ✅ FIX LANDED (systemic composite-condition gate)
resolveCompositePartAttrs now, for a pokerogue part whose source ability has `.conditions`, clones
each copied attr (preserving prototype → instanceof intact) and attaches the source conditions as a
per-attr `extraCondition` (enforced generically by apply-ab-attrs `getCondition()`), WITHOUT mutating
the shared source instance. Test: composite-condition-gate.test.ts (Way of Swiftness Speed mult now
carries the rain gate; real Swift Swim attr stays ungated). Corrects ALL composites embedding
weather/HP/condition-gated vanilla parts (Swift Swim, Chlorophyll, Sand/Slush Rush, Surge Surfer,
Solar Power, Sand Veil, Snow Cloak, Quick Feet, Flower Gift, etc.) in one change. Green.

### FIX BATCH — "Focus Blast never misses" (Inner Focus + cascade)
Patched vanilla Inner Focus (39) to add ConditionalAlwaysHit({moveIds:[FOCUS_BLAST]}) — "never
misses" is the existing ConditionalAlwaysHit primitive. Cascades to composites embedding Inner
Focus: 489 Enlightened, 661 Unlocked Potential, 679 Way of Precision (they copy its attrs, now
that the composite-condition fix + attr-copy carry it). 4 abilities fixed by 1 patch. Green
(er-rebalance-attr-patches.test.ts incl. cascade assertion on 489).

## ============ SESSION TALLY (audit + fixes) ============
AUDITED: ids 1→694 (chunks 1-28), every ER + ER-altered-vanilla ability read desc-vs-code.
FIXED (~42 abilities + 1 systemic architectural fix), all green (tsc + biome + tests):
  Run Away, Slush Rush, RKS System, Propeller Tail, Stalwart, Whiteout, Lead Coat, Dragonfly,
  Nocturnal, Liquified, Overwhelm, Nosferatu, Spectral Shroud, Damp(offense), Magical Dust(offense),
  Sighting System, Iron Barrage, Parry, Fearmonger, Gifted Mind, Dual Wield, Ambush, Combat
  Specialist, Roundhouse, Freezing Point, Cryo Proficiency, Yuki Onna, Berserk DNA, Chrome Coat,
  Molten Blades, Haunting Frenzy, Poison Absorb, Fragrant Daze, Jackhammer, Soul Crusher, Arc Flash,
  Fluffiest, Inner Focus(+Enlightened/Unlocked Potential/Way of Precision cascade).
PRIMITIVES/EXTENSIONS BUILT: PostAttackChangeTargetType; PriorityModifier maxAccuracy; DefenseStatSwap
  target-lower-defense; terrain-gated PassiveRecovery reuse; **SYSTEMIC composite-condition gate**
  (preserves Swift Swim/Chlorophyll/etc. weather gates across ALL composites).

## ============ REMAINING — needs CORE-ENGINE work (dedicated sessions) ============
These each require modifying vanilla core files (damage formula / move-targeting / attr registry /
form-change system) + a battle-integration test to verify. NOT safe to batch at high context.
1. damage-roll-floor — Bad Luck 334, Bad Omen 671 ("foes always min-roll 85%"). Needs a hook at
   pokemon.ts getAttackDamage ~line 4240 (force randomMultiplier=0.85 when defender has a registered
   marker attr) + register attr in AbilityAttrs. Verify via battle integration test.
2. spread-targeting — Artillery 377, Amplifier 378, Sweeping Edge 421, Blademaster 590, Bass Boosted
   524 (single-target tagged move hits both foes). Engine move-targeting change.
3. per-move accuracy-SET (90%, evasion-affected) — Hypnotist 327, Lunar Eclipse 365 (distinct from
   "never miss" which is ConditionalAlwaysHit and already used). Needs a move-accuracy-override hook.
4. sun-move-emulation — Chloroplast 268, Solar Flare 366 Chloroplast-half, Big Leaves Chloroplast-half
   (Weather Ball/Solar moves/Growth/recovery act as if in sun). Large multi-move primitive.
5. item/berry-transmutation — Power of Alchemy 223 (berries/lost items → Black Sludge). Item-system hook.
6. self-trap-when-low-HP — No Turning Back 668. status-immunity-override — Overcharge 349 (paralyze
   Electric-types). confusion-immunity+rampage — Discipline 388. drench-immunity — Amphibious 297,
   Old Mariner 620. Bad-Dreams-immunity — Sweet Dreams 333, Peaceful Slumber 490.
7. scripted-move-on-opp-stat-raise — Retribution Blow 407 (Hyper Beam, no recharge).
8. weather-gated priority-block — Sand Guard 482, Sun Basking 585. weather-gated HitMultiplier —
   Ice Cold Hunter 644. first-turn-priority+clamp — On the Prowl 648, Sidewinder 676, Coil Up 302.
9. screen-break-on-attack — Demolitionist 616. crit-targets-weaker-def — Deadeye 376 (on-crit variant).
10. form-change abilities — Flammable Coat 669, Patchwork 693 curse-on-break. trap-bonus — Grip Pincer 373.
11. large multi-effect suites — Angel's Wrath 439 (8 per-move transforms), Archmage 455 (13 type→effect).
12. value/approx — Anger Shell 554 (+1→+2 if ER intent confirmed), Catastrophe 589 (type+weather boost),
    Tangled Feet 77 (defense=Speed when confused/enraged), item-transmute, Pixie Power 465 field aura.
STILL TO READ: ids 695→1033 (the remaining custom range).

### FIX BATCH — zero-core-edit via existing registered hooks (answering "no rewrite needed")
- 349 Overcharge — added IgnoreTypeStatusEffectImmunity([PARALYSIS],[ELECTRIC]) to the live R48 case
  (rides the same registered hook Corrosion uses → holder can paralyze Electric-types). No core edit.
- 388 Discipline — converted status-immunity→bespoke: IntimidateImmunity + BattlerTagImmunity(CONFUSED).
  (CONFUSION is a BattlerTag, not a vanilla StatusEffect, so the status-immunity archetype dropped it.)
  "Can switch while rampaging" still needs a locked-move-escape primitive.
KEY LESSON (re-triage): most "core-engine" items can ride EXISTING registered vanilla hooks by
constructing the right already-registered attr (instanceof dispatch catches it) — NO core edits.
Only items with NO hook at the needed point need a tiny additive `applyAbAttrs(...)` call (a no-op
for all other abilities). Remaining triage:
  RIDE-EXISTING-HOOK (cheap, no core edit) — drench-immunity (BattlerTag/StatusEffect immunity);
    Retribution Blow 407 (new ER attr extending PostStatStageChange parent → scripted move).
  TINY-ADDITIVE-HOOK (1 gated applyAbAttrs call) — damage-roll-floor 334/671; per-move accuracy-set
    327/365; weather-gated priority-block 482/585.
  LARGER BESPOKE/ENGINE — spread-targeting 377/378/421/590/524; sun-emulation 268/366; item-transmute
    223; self-trap 668; form-changes 669/693; Archmage 455 / Angel's Wrath 439 multi-effect suites.

### ✅ NEW ENGINE HOOK (battle-verified) — damage-roll-floor
Added `EnemyMinDamageRollAbAttr` (ab-attrs.ts, registered in AbilityAttrs) + ONE gated
`applyAbAttrs("EnemyMinDamageRollAbAttr", {pokemon: this/* defender */, rollMultiplier})` call in
Pokemon.getAttackDamage (right after the variance roll). No-op for every ability lacking the attr —
NOT a rewrite. Wired Bad Luck 334 + Bad Omen 671 ("foes always min-roll 85% damage"). Verified by
battle integration test (er-min-damage-roll.test.ts): two identical hits on a Bad Omen holder deal
IDENTICAL damage (variance removed). + 349 Overcharge (paralyze-Electric via IgnoreTypeStatusEffect-
Immunity, rode existing hook) + 388 Discipline (confusion immunity via BattlerTagImmunity). Session
now ~48 abilities + systemic composite fix. PROVEN: all 3 tiers (ride-hook / tiny-additive-hook /
architectural) work with NO vanilla rewrite.

## ⚠ LATENT BUG FOUND — OnOpponentStatRaiseAbAttr never fires
on-opponent-stat-raise.ts canApply: `return selfTarget && stages>0 && !pokemon.isPlayer ? true : false`.
`pokemon.isPlayer` is a METHOD reference (truthy) → `!pokemon.isPlayer` is always false → canApply
ALWAYS returns false. So Egoist (555) AND Retribution Blow (407, which reuses this attr) never
trigger. Fix needs: correct the holder-vs-subject detection (call isPlayer(), compare sides
properly) — the apply path's field-scan is also approximate. Retribution Blow additionally needs a
scripted-move sibling (Hyper Beam, no recharge) on this base once the base is corrected. TODO.

### ✅ FIXED — OnOpponentStatRaise base bug + Egoist 555 + Retribution Blow 407
on-opponent-stat-raise.ts rewritten to extend the registered StatStageChangeCopyAbAttr (Opportunist)
hook instead of PostStatStageChange — the old `!pokemon.isPlayer` (method-ref) canApply bug made it
ALWAYS false, so Egoist never fired. Now Egoist (555) reacts to foe boosts correctly. Added a sibling
OnOpponentStatRaiseScriptedMoveAbAttr that fires a scripted move; wired Retribution Blow 407 to
auto-cast a 150 BP Hyper Beam (always-hit, per "cannot miss") when a foe makes a copyable boost.
Extended scriptedPokemonMove with `{alwaysHit}` (accuracy -1) — backward compatible (aftermath/Cheap
Tactics scripted-move tests still green). Battle-verified: er-retribution-blow.test.ts (player Swords
Dance → enemy Hyper Beams back for damage). Note: Hyper Beam "no recharge" not separately enforced
(INDIRECT cast; minor). Session ~50 abilities + systemic fix + 2 engine hooks.

### ✅ FIXED — weather-gated via addCondition (zero new primitive)
- 482 Sand Guard / 585 Sun Basking — added FieldPriorityMoveImmunity gated to sand/sun via
  `.addCondition(getWeatherCondition(...))` (the per-attr extraCondition the apply path enforces).
- 644 Ice Cold Hunter — was all-moves-hit-twice-always; now Ice HitMultiplier gated to hail/snow via
  addCondition (full power both hits) + BlockWeatherDamage(hail/snow).
- 297 Amphibious "can't be drenched" — DRENCHED is neither a BattlerTag nor StatusEffect in this
  engine (no drench mechanic exists), so the immunity is a no-op; nothing to wire. Marked N/A.
KEY: `AbAttr.addCondition(cond)` gates ANY existing attr by an arbitrary predicate (weather, first-turn,
etc.), enforced generically by apply-ab-attrs.getCondition() — a powerful zero-new-code lever.

### ✅ FIXED batch (first-turn gating + regression)
- 302 Coil Up — biting +1 priority now gated to the entry turn (addCondition waveTurnCount===1);
  648 On the Prowl + 676 Sidewinder were ALREADY first-turn-gated (verified OK).
- Broad regression: 209 tests green across dispatch/composite/rebalance/custom-abilities/resync —
  confirms the core-file edits (ab-attrs EnemyMinDamageRoll + registry, pokemon.ts damage hook,
  scripted-move-util alwaysHit, composite-condition resolver) don't regress vanilla. Session ~54 abilities.

### ✅ FIXED — Pixie Power 465
Field-wide Fairy aura (FieldMoveTypePowerBoostAbAttr(FAIRY,4/3) — Fairy-Aura's hook, Aura-Break-aware)
+ StatMultiplier(ACC,1.2). Was a self-only TypeDamageBoost. Session ~55 abilities.

## REMAINING — precise approaches (each needs its own new attr/hook, all do-able w/o rewrite)
### ✅ DONE THIS SESSION (post-694 fixes, all tsc+lint+test-green)
- ✅ Anger Shell 554 (+1→+2 offenses): rebalance patcher bumps positive PostDefendHpGated stages.
  Test: er-rebalance-attr-patches.
- ✅ Tangled Feet 77: new `DefensiveStatSubstituteAbAttr` (ab-attrs) + gated applyAbAttrs in
  Pokemon.getAttackDamage defensive-stat read; rebalance patcher strips vanilla EVA×2, adds Speed
  substitute gated on CONFUSED tag / FOG (enrage proxy). Tests: er-rebalance-attr-patches.
- ✅ Deadeye 376 crit-targets-weaker-def: new `CritUseLowerDefensiveStatAbAttr` + source-side crit-only
  applyAbAttrs in getAttackDamage; case 376 now never-miss(ARROW/BALLBOMB)+crit-lower-def (dropped the
  wrong extra-crit-stage approximation). Tests: bespoke-dispatch.
- ✅ Bad Dreams immunity (333 Sweet Dreams → cascades to 490 Peaceful Slumber): new marker
  `BadDreamsImmunityAbAttr` consulted in PostTurnHurtIfSleepingAbAttr canApply+apply. Tests: bespoke-dispatch.
- ✅ Spread-targeting (377 Artillery, 378 Amplifier, 421 Sweeping Edge → cascade 524/590): new marker
  `SpreadTargetByFlagAbAttr(flag)` + `userGrantsSpreadTargeting` hook in getMoveTargets promoting
  NEAR_OTHER/NEAR_ENEMY → ALL_NEAR_ENEMIES (multihit excluded). Tests: bespoke-dispatch + er-spread-targeting
  (battle-verified doubles).
- ✅ per-move accuracy-SET 90% (327 Hypnotist, 365 Lunar Eclipse, 786 Lullaby): new
  `SetMoveAccuracyAbAttr(moveIds,acc)` + applyAbAttrs in Move.calculateBattleAccuracy (before evasion
  multiplier — NOT a never-miss). 327/365→Hypnosis 90, 786→Sing 90. Replaced ConditionalAlwaysHit(327) &
  StatMultiplier-ACC(786) botches. NOTE: ER C-source uses moveAcc=100 for Hypnosis; we follow the
  in-game description (90%) per audit directive. Tests: bespoke-dispatch + er-accuracy-set (battle-verified).
- ⚠ PRE-EXISTING (not mine): er-r56-final-wires "DNA Scramble (791) wire installed" fails — 791 is a
  CORRECT empty marker (form-change is data-driven in pokemon-forms.ts) but the test asserts attrs>0.
  Wrong test assumption, unrelated to these fixes.

- ✅ sun-emulation Solar Flare extension (268 Chloroplast already wired; 366 Solar Flare was NOT covered
  because it is a distinct ability id from Chloroplast): extended move.ts `userActsInSun` to also match
  SOLAR_FLARE, routed WeatherBallTypeAttr + Weather Ball power-double through `userActsInSun` (the
  power-double previously never fired for Chloroplast-in-no-weather either). Tests: er-chloroplast
  (Chloroplast + Solar Flare, battle-verified).
- ✅ Catastrophe 589: type×weather move-power. Two MovePowerBoostAbAttr (Water×1.5 in Sun/HarshSun,
  Fire×1.5 in Rain/HeavyRain) replacing the continuous SPATK×1.3 botch. Tests: bespoke-dispatch +
  er-catastrophe (battle-verified via calculateBattlePower).
- ✅ No Turning Back 668: passive No Retreat. PostDefendHpGatedStatStageChange(0.5, all 5 stats, +1) +
  new PostDefendHpGatedSelfTagAbAttr(0.5, NO_RETREAT). Replaced the continuous-1.2× boost + added the
  missing trap. Tests: bespoke-dispatch + er-no-turning-back (battle-verified).
- ✅/VERDICT Power of Alchemy 223: NO CHANGE — faithful already. ER C-source (battle_script_commands.c
  :8772-8789) implements POWER_OF_ALCHEMY as RECEIVER (copy fainted ally's ability) = current pokerogue
  CopyFaintedAllyAbilityAbAttr wiring. The v2.65.3b in-game description ("transmute berries/items →
  Black Sludge/Big Nugget") has NO backing logic anywhere in the C source (exhaustive grep: only the
  Receiver block + ability-flag lists). Description is stale/aspirational; code is authoritative.
  User confirmed: keep Receiver. (item-transmute NOT implemented — it isn't a real ER behavior.)

- ✅ Patchwork 693 curse-on-break: new `CurseAttackerOnFormBlockDamageAbAttr` (subclass of vanilla
  FormBlockDamageAbAttr — same block/recoil/busted-form change + CURSED on the attacker). Wired by
  swapping the Disguise FormBlock for the curse variant INSIDE `dispatchComposite` for id 693 (kept 693
  as a composite so it retains the post-init refresh that populates the copied Disguise attrs — a
  bespoke conversion broke that timing). Tests: er-patchwork (battle-verified: Shadow Ball breaks the
  disguise → attacker gains CURSED; Normal moves don't because Mimikyu is Ghost-immune). The ER
  fog-restore-disguise sub-effect is NOT wired (separate form mechanic).
- ⚠ Flammable Coat 669: form-change is ARCHITECTURE-BLOCKED. ER's Engulfed (SPECIES_LUMBERING_SLOTH_
  ENGULFED, er-species.ts) is a SEPARATE SPECIES, not a form of Lumbering Sloth, and pokerogue's
  form-change engine only swaps intra-species forms (no mid-battle species swap). Faithful wiring would
  require restructuring the ER species data (regression-risk to dex/evolution/sprites). Left as the
  prior halved-Fire-damage approximation + documented. NOT a safe minimal fix.
- ⚠ PRE-EXISTING (not mine): init-elite-redux-custom-abilities "ER ability count by archetype" asserts
  entry-effect wired count >=20 but it is 19 (a prior audit chunk reclassified an entry-effect row to
  bespoke). Stale sanity-bound, unrelated to this session's edits (no entry-effect rows touched).

- ✅ Archmage 455: per-type secondary suite, keyed to the MOVE'S TYPE (FULL desc). Replaced the prior
  looser "signature secondary" set (in dispatchBespokeR48 — Electric→paralysis, Dark→flinch, Grass→seed)
  with the description's mapping: Poison→Toxic, Fire→Burn (ChanceStatusOnAttack); Ice→Frostbite,
  Water→Confuse, Dark→Bleed, Ground→Trap, Normal→Encore, Ghost→Disable (ChanceBattlerTagOnAttack);
  Fighting→+SpAtk, Flying→+Spd, Steel→+Def (self), Dragon→-Atk (foe) (StatChangeOnAttack — extended with
  an optional `type` filter). All gated on move.type, 30% each. Deferred (need offense-side terrain/
  hazard-by-type primitives): Electric/Psychic/Fairy/Grass→set terrain, Rock→Stealth Rock. Tests: er-archmage.
- ✅ Angel's Wrath 439 (move-property changes, per user): extended ChanceStatusFilter with a `{moveId}`
  variant so on-attack procs can target specific moves. Wired: never-miss on the 4 enhanced attacks
  (kept), Tackle→Encore+Disable, Electroweb→Trap, Poison Sting→badly poison (Toxic), and a +50% power
  boost on all 4 enhanced attacks. Battle-verified: Poison Sting→Toxic + Tackle ×1.5 power.
- ✅ DEFERRED ITEMS NOW DONE:
  - Archmage 455 terrain/hazard: new `PostAttackSetTerrainByMoveTypeAbAttr` (Electric→Electric,
    Psychic→Psychic, Grass→Grassy, Fairy→Misty terrain) + `PostAttackSetHazardByMoveTypeAbAttr`
    (Rock→Stealth Rock on the foe's side), 30% each, wired into the Archmage R48 case. These are ABILITY
    attrs so they only apply to Archmage holders. Tests: er-archmage (count) — full 17-type suite now wired.
  - Angel's Wrath 439 status-move overhauls — implemented as MOVE-side attrs GATED on
    `user.hasAbility(ANGEL_S_WRATH)` so they NEVER fire for a non-holder (per user requirement). New
    move attrs in move.ts: `AngelsWrathDrainAttr` (Bug Bite → drain = damage dealt), `AngelsWrathHazardAttr`
    (String Shot → Spikes/Toxic Spikes/Sticky Web/Stealth Rock on the foe's side), `AngelsWrathKingsShieldAttr`
    (Iron Defense → King's Shield protect; the vanilla +2 Def is conditioned to NON-holders),
    `AngelsWrathSteelSuperEffectiveAttr` (Poison Sting → 2× vs Steel), and a condition-gated StatStageChange
    on Harden (omniboost +1 all stats). Battle-verified BOTH directions (holder gets it, non-holder does NOT)
    for Harden, Iron Defense, String Shot; plus Poison Sting SE-vs-Steel + Bug Bite drain. Tests: er-angels-wrath
    (10 cases). King's Shield uses the real KINGS_SHIELD tag (drops the contact attacker's Atk); the ER
    "drops all stats" flavor is the only remaining nuance (would need a custom protect tag).

### STILL TODO
- STILL TO READ: ids 695→1033.
