# M3-00F content oracle: ranked candidates

This is an extraction and ranking note, not the M3 manifest and not a final
selection.  It is limited to the pinned TypeScript oracle object
`3b534099919efae827019d4a3f3c4ab0ecd6d67b` and the assigned M2 base
`7357166c19bdb5cf0e32c84b0f74f22e79d80798`.  No Rust, fixture, workflow, or
production-TypeScript changes are proposed here.

The required manifest roles are treated as slots to be filled by the contract
steward: `player_physical`, `player_special`, `player_status`,
`enemy_neutral`, `enemy_weak`, `enemy_resistant`, `enemy_immune`, and the ten
move/ability slots named by the M3 specification.  The ranks below are
candidate order only; they do not assign manifest values.

## Evidence and tuple conventions

`[O]` means directly declared by the pinned source.  `[I]` means a static
inference from source order or from an enum's zero-based member order.  `[G]`
means an explicit gap or source conflict.  A positive or edge observation
below is a proposed oracle observation to capture in a fixture; it is not a
claim that a fixture was executed.

For move rows, the tuple is
`(category, type, power, accuracy, PP, effectChance, priority, target)`.  The
move constructor stores those values in that order, makes user-targeted moves
ignore Protect, and makes physical moves contact moves by default.  The
category constructors use `NEAR_OTHER` for attack/status moves and `USER` for
self-status moves.  [O] [oracle: `src/data/moves/move.ts`:L288-L318,L1586-L1690 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

The runtime category IDs are `PHYSICAL=0`, `SPECIAL=1`, and `STATUS=2`; the
target enum includes `USER`, `NEAR_OTHER`, `ALL_NEAR_OTHERS`, and
`ALL_NEAR_ENEMIES`.  [O] [oracle: `src/enums/move-category.ts`:L1-L3; `src/enums/move-target.ts`:L1-L17 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

The final-static tuples below are [I], not raw ER JSON.  Initialization runs
the vanilla rebalance before the C-source corrections.  The rebalance copies
positive power/accuracy/PP fields, finite priorities, and only positive
effect chances; target overrides are applied separately.  The C corrections
therefore win for such fields as POUND PP, EMBER power/chance, and Poison Gas
chance.  [O] [oracle: `src/init/init.ts`:L230-L246; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L2025-L2091; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L7-L24 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

`-1` is retained where the factory uses the sentinel for no power, no chance,
or always-hit accuracy.  The relevant runtime chance gate treats a negative
chance or 100 as guaranteed, and otherwise performs the chance roll.  [O]
[oracle: `src/data/moves/move.ts`:L3491-L3511,L1960-L1977 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## Species candidates

ER species records carry an explicit numeric `id`, ER type numbers, three
ability references, and three innate references.  Initialization maps the ER
species ID to the runtime species ID, maps ER type numbers to Pokerogue types,
and installs the ability slots; it is therefore unsafe to use only the base
vanilla species declaration as the final runtime record.  [O] [oracle: `src/data/elite-redux/init-elite-redux-species.ts`:L202-L258; `src/data/elite-redux/init-elite-redux-species.ts`:L671-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

The ER type mapping used in these rows maps ER `0` to NORMAL, `2` to FIRE,
`8` to GRASS, `9` to GROUND, `10` to POISON, and `12` to WATER.  [O] [oracle: `src/data/elite-redux/init-elite-redux-species.ts`:L47-L78 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

The pinned species map contains identity entries for the vanilla candidate IDs
`1`, `4`, `7`, `19`, `23`, `24`, `37`, `50`, and `52`, so these are concrete
runtime-ID candidates rather than only ER-draft labels.  [O] [oracle: `src/data/elite-redux/er-id-map.ts`:L19-L71 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

| Manifest slot | Rank | Candidate | Exact record and runtime type candidate | Positive / edge observability |
|---|---:|---|---|---|
| `player_physical` | 1 | Rattata `19` | ER record `id=19`, types `[0,null]` → NORMAL; the record also carries ability refs `[55,96,364]` and innates `[62,95,50]`. [O] [oracle: `src/data/elite-redux/er-species.ts`:L3089-L3112 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: a clean NORMAL physical baseline can use POUND or SCRATCH. Edge: the ability/innate refs are part of the reachable record and must be explicitly classified before this is a closed player. [O/G] [oracle: `src/data/elite-redux/er-species.ts`:L3089-L3112; `src/data/elite-redux/init-elite-redux-species.ts`:L244-L258,L671-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `player_physical` | 2 | Meowth `52` | ER record `id=52`, types `[0,null]` → NORMAL; ability refs are `[97,7,158]` and innates `[288,101,370]`. [O] [oracle: `src/data/elite-redux/er-species.ts`:L9533-L9556 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: same neutral-type physical baseline as Rattata. Edge: its separate ability/innate payload means it is not interchangeable with Rattata without an explicit loadout decision. [I/G] [oracle: `src/data/elite-redux/er-species.ts`:L9533-L9556; `src/data/elite-redux/init-elite-redux-species.ts`:L244-L258 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `player_special` | 1 | Squirtle `7` | ER record `id=7`, types `[12,null]` → WATER; ability refs `[192,144,804]`, innates `[67,75,41]`. [O] [oracle: `src/data/elite-redux/er-species.ts`:L1300-L1323 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: WATER is a concrete special-attacker type candidate. Edge: the ER ability/innate refs can add behavior not represented by the move tuple and must be pinned or rejected. [I/G] [oracle: `src/data/elite-redux/er-species.ts`:L1300-L1323; `src/data/elite-redux/init-elite-redux-species.ts`:L244-L258,L671-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `player_special` | 2 | Charmander `4` | ER record `id=4`, types `[2,null]` → FIRE; ability refs `[49,270,310]`, innates `[66,18,94]`. [O] [oracle: `src/data/elite-redux/er-species.ts`:L732-L755 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: FIRE provides an alternate special-attacker type. Edge: Fire moves can also thaw an existing FREEZE through the generic Fire `AttackMove` constructor path, so an initial/reachable FREEZE state must be excluded or supported. [O/G] [oracle: `src/data/moves/move.ts`:L1607-L1611; `src/data/elite-redux/er-species.ts`:L732-L755 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `player_status` | 1 | Bulbasaur `1` | ER record `id=1`, types `[8,10]` → GRASS/POISON; ability refs `[268,257,34]`, innates `[65,47,344]`. [O] [oracle: `src/data/elite-redux/er-species.ts`:L109-L132 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: it supplies a concrete status-user type and a useful Grass/Poison immunity edge. Edge: GRASS blocks powder moves and POISON blocks poison/toxic status, so it is not a generic status target. [O] [oracle: `src/data/moves/move.ts`:L11264-L11272; `src/field/pokemon.ts`:L7048-L7073 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `enemy_neutral` | 1 | Meowth `52` | NORMAL from ER `types=[0,null]`; the type-chart default is `1` for unmatched NORMAL matchups. [O/I] [oracle: `src/data/elite-redux/er-species.ts`:L9533-L9556; `src/data/type.ts`:L14-L50 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: a NORMAL defender is a neutral baseline for POUND and SHOCK WAVE because the type chart returns `1` for those unmatched attack types. Edge: a later field inversion or ability can change the effective result, so the fixture must keep those out of scope or classify them. [O/G] [oracle: `src/data/type.ts`:L14-L50; `src/data/elite-redux/er-species.ts`:L9533-L9556 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `enemy_weak` | 1 | Squirtle `7` | WATER from ER `types=[12,null]`. ELECTRIC and GRASS both have `2x` entries against WATER. [O] [oracle: `src/data/elite-redux/er-species.ts`:L1300-L1323; `src/data/type.ts`:L177-L205 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: SHOCK WAVE → WATER proves a weak special matchup. Edge: WATER immunity abilities can cancel the hit and heal instead, so the selected enemy’s ability loadout must be explicit. [O/G] [oracle: `src/data/type.ts`:L177-L205; `src/data/abilities/ab-attrs.ts`:L483-L506 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `enemy_resistant` | 1 | Bulbasaur `1` | GRASS/POISON from ER `types=[8,10]`; ELECTRIC is `0.5x` against GRASS and WATER is `0.5x` against GRASS. [O] [oracle: `src/data/elite-redux/er-species.ts`:L109-L132; `src/data/type.ts`:L206-L231 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: SHOCK WAVE → GRASS is a resistant special matchup. Edge: the second POISON type and any ability multiplier must be included in the product; do not hard-code a single-type result. [O/G] [oracle: `src/data/type.ts`:L14-L50,L206-L231; `src/data/elite-redux/er-species.ts`:L109-L132 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `enemy_immune` | 1 | Diglett `50` | ER record `id=50`, types `[9,null]` → GROUND; ability refs `[146,71,159]`, innates `[360,299,355]`. [O] [oracle: `src/data/elite-redux/er-species.ts`:L9182-L9205 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: ELECTRIC → GROUND is `0`, so Diglett is the direct SHOCK WAVE immunity candidate. Edge: `RespectAttackTypeImmunityAttr` makes type immunity relevant to status moves such as THUNDER WAVE, while ordinary status application has separate Electric immunity rules. [O] [oracle: `src/data/type.ts`:L98-L110; `src/data/moves/move.ts`:L2171-L2171; `src/field/pokemon.ts`:L7075-L7080 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b` |
| `switch-in carrier` | 1 | Ekans `23` | ER record `id=23`, types `[10,null]` → POISON and ability refs `[196,523,22]`; raw ability ref `22` maps to the Intimidate runtime ID under the identity section of the pinned ability map. [O/I] [oracle: `src/data/elite-redux/er-species.ts`:L3828-L3851; `src/data/elite-redux/er-id-map.ts`:L1927-L1955; `src/enums/ability-id.ts`:L47-L47 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: concrete carrier candidate for INTIMIDATE `22`. Edge: the record has multiple ability slots; using the third reference as active is a loadout decision, not an inference this note finalizes. [O/G] [oracle: `src/data/elite-redux/er-species.ts`:L3828-L3851; `src/data/elite-redux/init-elite-redux-species.ts`:L244-L258; `src/data/elite-redux/er-ability-position-map.ts`:L8-L57 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b` |
| `switch-in carrier` | 2 | Arbok `24` | ER record `id=24`, types `[10,11]` → POISON/DARK; ability refs are `[196,435,22]`. [O/I] [oracle: `src/data/elite-redux/er-species.ts`:L4021-L4044; `src/data/elite-redux/init-elite-redux-species.ts`:L47-L78 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: alternate species carrying the same raw Intimidate ref `22`. Edge: its second DARK type changes the type-product edge cases, so the steward must not substitute it for Ekans without a separate fixture. [O/G] [oracle: `src/data/elite-redux/er-species.ts`:L4021-L4044; `src/data/elite-redux/init-elite-redux-species.ts`:L47-L78 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| `type-immunity carrier` | 1 | Vulpix `37` | ER record `id=37`, types `[2,null]` → FIRE and ability refs `[18,270,70]`; raw ability ref `18` maps to FLASH FIRE. [O/I] [oracle: `src/data/elite-redux/er-species.ts`:L6592-L6615; `src/data/elite-redux/er-id-map.ts`:L1927-L1955; `src/enums/ability-id.ts`:L39-L39 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: candidate carrier for FIRE immunity plus the FIRE_BOOST tag. Edge: this carrier adds a battler tag and therefore is not as small as assigning WONDER GUARD directly. [O] [oracle: `src/data/abilities/init-abilities.ts`:L368-L370; `src/data/abilities/ab-attrs.ts`:L536-L554 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |

The species rows are candidates, not an assertion that the ER active and
innate payloads are supported.  The runtime mapper has an explicit unmapped
ability-to-NONE fallback; the M3 rule requires the steward to reject an
unsupported active or bench ability before that fallback can hide it.  [O/G]
[oracle: `src/data/elite-redux/init-elite-redux-species.ts`:L244-L258,L671-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## Move candidates: baseline, accuracy, priority

The move IDs below are the zero-based runtime `MoveId` values, corroborated by
the explicit ER record IDs where an ER record is used.  The enum member order
is the source of the numeric inference.  [I] [oracle: `src/enums/move-id.ts`:L1-L6,L24-L24,L70-L70,L108-L122,L158-L160,L176-L182,L196-L200,L706-L706,L820-L820,L1182-L1182 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

| Rank | Candidate | Final-static tuple and declared effects | Positive / edge observability |
|---:|---|---|---|
| 1 | POUND `1` | `(PHYSICAL,NORMAL,40,100,35,-1,0,NEAR_OTHER)`. Factory is a bare physical attack; the C correction preserves PP `35`; no move attr is attached, but the physical constructor gives it contact. [O/I] [oracle: `src/data/moves/move.ts`:L11046-L11046; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L57-L57; `src/data/moves/move.ts`:L288-L316 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: a successful direct physical HP change. Edge: contact-dependent defender effects and accuracy/RNG still remain reachable even though the move has no bespoke attr. [O/G] [oracle: `src/data/moves/move.ts`:L288-L316 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | SCRATCH `10` | `(PHYSICAL,NORMAL,40,100,35,-1,0,NEAR_OTHER)`, with the same bare factory shape and default contact as POUND. [O/I] [oracle: `src/data/moves/move.ts`:L11068-L11068; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L65-L65; `src/data/moves/move.ts`:L288-L316 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: interchangeable clean physical baseline candidate. Edge: do not merge its numeric ID with POUND when reporting move events or PP. [I/G] [oracle: `src/enums/move-id.ts`:L24-L24; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L57-L65 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 2 | TACKLE `33` | `(PHYSICAL,NORMAL,40,100,35,-1,0,NEAR_OTHER)`. The factory adds `AngelsWrathTackleAttr`; the C correction sets PP `35`. [O/I] [oracle: `src/data/moves/move.ts`:L11126-L11128; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L80-L80; `src/data/moves/move.ts`:L8283-L8294 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: direct physical hit. Edge: the Angel's Wrath condition can lock the target when the user has that ability, so TACKLE is not closed unless the ability is excluded or classified. [O/G] [oracle: `src/data/moves/move.ts`:L8283-L8294 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | SHOCK WAVE `351` | `(SPECIAL,ELECTRIC,40,-1,15,-1,2,NEAR_OTHER)`. The factory is special Electric power `60`, accuracy `-1`, PP `20`, priority `0`; the ER record supplies power `40`, PP `15`, and priority `2`, while its non-positive accuracy `0` does not replace the factory sentinel. The ER flags/effect fields are empty. [O/I] [oracle: `src/data/moves/move.ts`:L12270-L12270; `src/data/elite-redux/er-moves.ts`:L8522-L8543; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L2025-L2076 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: clean special damage and an observable priority bracket. Edge: accuracy is always-hit at the factory sentinel, but Electric type effectiveness still reaches WATER `2x`, GRASS `0.5x`, and GROUND `0`; each is visible without a custom move attr. [O/G] [oracle: `src/data/type.ts`:L98-L110,L177-L231; `src/data/moves/move.ts`:L12270-L12270 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 2 | POWER GEM `408` | `(SPECIAL,ROCK,90,100,15,-1,0,NEAR_OTHER)`. The factory is special Rock `80/100/20`; ER final-static data raises power to `90` and PP to `15`, with no ER flags or effects. [O/I] [oracle: `src/data/moves/move.ts`:L12475-L12475; `src/data/elite-redux/er-moves.ts`:L9894-L9915; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L2025-L2076 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: clean alternate special baseline. Edge: Rock type weaknesses/resistances still come from the type chart, not from the move record. [O] [oracle: `src/data/type.ts`:L115-L128 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | QUICK ATTACK `98` | `(PHYSICAL,NORMAL,40,100,30,-1,2,NEAR_OTHER)`. The factory is physical Normal power `40`, accuracy `100`, PP `30`, priority `1`; the ER record finalizes priority `2`, and the C correction preserves PP `30`. [O/I] [oracle: `src/data/moves/move.ts`:L11341-L11341; `src/data/elite-redux/er-moves.ts`:L2442-L2465; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L131-L131; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L2025-L2076 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: physical priority ordering separate from SHOCK WAVE. Edge: it is contact by default, so a contact reaction is an observable unsupported branch if such a defender is reachable. [O/G] [oracle: `src/data/moves/move.ts`:L288-L316 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | POISON POWDER `77` | `(STATUS,POISON,-1,75,35,-1,0,NEAR_OTHER)`. It applies `StatusEffectAttr(POISON)`, sets the POWDER flag, and is reflectable; the C correction sets PP `35`. [O/I] [oracle: `src/data/moves/move.ts`:L11264-L11267; `src/data/elite-redux/er-moves.ts`:L1949-L1970; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L114-L114; `src/data/moves/move.ts`:L3491-L3511,L829-L829,L917-L917 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: a clean, successful roll on a non-status target applies POISON. Edge: existing status, POISON/STEEL type immunity, GRASS powder immunity, and other powder blockers can prevent application; those checks are observable and must not be ignored. [O] [oracle: `src/field/pokemon.ts`:L7019-L7073,L7116-L7195; `src/data/moves/move.ts`:L501-L514,L11264-L11267 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | HYDRO PUMP `56` | `(SPECIAL,WATER,110,85,5,0,0,NEAR_OTHER)`. ER data changes factory accuracy `80` to `85`; the C correction sets effect chance `0`; the ER patch adds `ErDrenchAttr(30)`. [O/I] [oracle: `src/data/moves/move.ts`:L11208-L11208; `src/data/elite-redux/er-moves.ts`:L1433-L1454; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L96-L96; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L1273-L1285 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 2 | BLIZZARD `59` | `(SPECIAL,ICE,110,85,5,10,0,ALL_NEAR_ENEMIES)`. The factory includes FREEZE, wind, spread, and `BlizzardAccuracyAttr`; ER data supplies accuracy `85`, and the C correction leaves chance `10`. [O/I] [oracle: `src/data/moves/move.ts`:L11215-L11219; `src/data/elite-redux/er-moves.ts`:L1504-L1528; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L98-L98; `src/data/moves/move.ts`:L6535-L6547 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: spread damage and an ICE-status roll. Edge: Hail/Snow can make accuracy always hit, and FREEZE is intercepted as ER_FROSTBITE rather than remaining vanilla FREEZE. [O/G] [oracle: `src/data/moves/move.ts`:L6535-L6547; `src/field/pokemon.ts`:L7188-L7195 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |

The HYDRO PUMP and BLIZZARD rows are ranked below SHOCK WAVE for a strict
closed slice because Drench and weather/Frostbite are extra mechanics.  The
source proves those callbacks; it does not prove M3 support for them.  [O/G]
[oracle: `src/data/moves/move.ts`:L7775-L7792; `src/data/moves/move.ts`:L6535-L6547; `src/field/pokemon.ts`:L7188-L7195 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## Move candidates: spread and stat stages

The generic stat-stage attr records the affected stats, stage delta, and
self-target mode, then queues the corresponding stage phase.  [O]
[oracle: `src/data/moves/move.ts`:L4888-L4948 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

| Rank | Candidate | Final-static tuple and declared effects | Positive / edge observability |
|---:|---|---|---|
| 1 | PLAY NICE `589` | `(STATUS,NORMAL,-1,-1,20,-1,0,ALL_NEAR_ENEMIES)`. The factory applies ATK `-1`, ignores Substitute, and is reflectable; the ER record is explicit `id=589` with always-hit accuracy `0`; the ER patch widens the target to all near enemies. [O/I] [oracle: `src/data/moves/move.ts`:L13143-L13147; `src/data/elite-redux/er-moves.ts`:L14268-L14288; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L834-L834; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L2025-L2091 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: one move covers the required ATK-stage-down and spread slots, lowering each eligible adjacent foe. Edge: spread geometry, Substitute bypass, reflection, and the `-6` stage floor are all observable; the floor rule is not extracted here. [O/G] [oracle: `src/data/moves/move.ts`:L4888-L4948; `src/data/moves/move.ts`:L13143-L13147 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 2 | TAIL WHIP `39` | `(STATUS,NORMAL,-1,100,30,-1,0,ALL_NEAR_ENEMIES)`. It lowers DEF `-1`, targets all near enemies, and is reflectable; the C correction sets PP `30`. [O/I] [oracle: `src/data/moves/move.ts`:L11146-L11149; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L83-L83 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: clean status spread with a DEF-stage event for each eligible target. Edge: it does not satisfy the ATK-stage-down slot and still reaches spread/reflect/substitute/stage-limit branches. [O/G] [oracle: `src/data/moves/move.ts`:L4888-L4948; `src/enums/move-target.ts`:L1-L17 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 3 | GROWL `45` | `(SPECIAL,NORMAL,60,100,15,100,0,ALL_NEAR_ENEMIES)`. The factory originally declares a status move with ATK `-1`, sound, and spread; ER rewrites it to SPECIAL while retaining the stat attr and adding the sound flag; C sets chance `100`. [O/I] [oracle: `src/data/moves/move.ts`:L11169-L11173; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L273-L281; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L91-L91; `src/data/elite-redux/er-moves.ts`:L1168-L1191 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: damaging spread plus ATK-stage-down. Edge: Sound-based protections and the category rewrite are reachable, so the factory-only status tuple is incorrect. [O/G] [oracle: `src/data/moves/move.ts`:L739-L739; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L273-L281 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | SAND ATTACK `28` | `(STATUS,GROUND,-1,100,15,-1,0,NEAR_OTHER)`. It lowers ACC `-1` and is reflectable. [O] [oracle: `src/data/moves/move.ts`:L11115-L11117; `src/data/elite-redux/er-moves.ts`:L742-L763 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: a single-target accuracy-stage event. Edge: it is not the required ATK-stage-down move, and the accuracy-stage formula/limits remain a separate contract. [O/G] [oracle: `src/data/moves/move.ts`:L4888-L4948; `src/enums/stat.ts`:L5-L15 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | MEDITATE `96` | `(STATUS,PSYCHIC,-1,-1,40,-1,0,USER)`. The factory raises ATK `+1`; the ER patch adds SPDEF `+1`; C sets PP `40`. [O/I] [oracle: `src/data/moves/move.ts`:L11337-L11338; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L1469-L1472; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L129-L129; `src/data/elite-redux/er-moves.ts`:L2396-L2417 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: two self-stage events from one use. Edge: the ER-added SPDEF boost means a base-only extractor undercounts the observed event stream. [O/G] [oracle: `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L1469-L1472 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | AGILITY `97` | `(STATUS,PSYCHIC,-1,-1,30,-1,0,USER)`, self SPD `+2`, with C PP `30`. [O/I] [oracle: `src/data/moves/move.ts`:L11339-L11340; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L130-L130; `src/data/elite-redux/er-moves.ts`:L2419-L2440 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: self SPD-stage event. Edge: speed-stage recalculation and any action-order tie break are outside this content extraction. [O/G] [oracle: `src/data/moves/move.ts`:L4888-L4948; `src/enums/stat.ts`:L5-L15 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | DOUBLE TEAM `104` | `(STATUS,NORMAL,-1,-1,15,-1,0,USER)`, self EVA `+1`. [O] [oracle: `src/data/moves/move.ts`:L11357-L11358; `src/data/elite-redux/er-moves.ts`:L2586-L2607 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: self evasion-stage event. Edge: accuracy/evasion interaction is not the same as a miss-only boolean and is not closed by this row alone. [G] [oracle: `src/enums/stat.ts`:L5-L15; `src/data/moves/move.ts`:L4888-L4948 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 2 | HARDEN `106` | `(STATUS,NORMAL,-1,-1,30,-1,0,USER)`, self DEF `+1`; it additionally has a conditional Angel's Wrath omniboost attr. [O/I] [oracle: `src/data/moves/move.ts`:L11362-L11368; `src/data/elite-redux/er-moves.ts`:L2632-L2653; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L134-L134 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: DEF-stage event for ordinary users. Edge: an Angel's Wrath user can receive conditional ATK/SPATK/SPDEF/SPD boosts, so HARDEN is not a smallest closed candidate. [O/G] [oracle: `src/data/moves/move.ts`:L11362-L11368 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |

## Move candidates: Burn, Poison, Paralysis

`StatusEffectAttr` attempts the requested status only after its chance gate and
delegates the actual status admission to `trySetStatus`.  Existing status,
type immunity, ability immunity, and field protections are therefore edge
observations rather than “no effect” cases to erase.  [O] [oracle: `src/data/moves/move.ts`:L3491-L3511; `src/field/pokemon.ts`:L7019-L7073,L7075-L7113,L7116-L7195 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

| Rank | Candidate | Final-static tuple and declared effects | Positive / edge observability |
|---:|---|---|---|
| 1 | EMBER `52` | `(SPECIAL,FIRE,20,100,20,100,0,NEAR_OTHER)`. The factory is FIRE special power `40/100/25` with BURN chance `10`; the C correction changes power to `20`, PP to `20`, and chance to `100`. Fire `AttackMove` construction also adds the generic thaw-from-FREEZE attr. [O/I] [oracle: `src/data/moves/move.ts`:L11200-L11201,L1607-L1611; `src/data/elite-redux/er-moves.ts`:L1339-L1360; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L93-L93 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: direct special damage plus guaranteed BURN attempt after a hit. Edge: FIRE targets reject burn unless the source bypasses immunity; a pre-existing FREEZE is also reachable through the Fire thaw attr. [O/G] [oracle: `src/field/pokemon.ts`:L7092-L7113; `src/data/moves/move.ts`:L1607-L1611 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | WILL-O-WISP `261` | `(STATUS,FIRE,-1,90,10,-1,0,NEAR_OTHER)`, BURN plus reflectable. ER conditional-always-hit logic makes it always hit for a FIRE user. [O/I] [oracle: `src/data/moves/move.ts`:L11918-L11920; `src/data/elite-redux/er-moves.ts`:L6350-L6371; `src/data/elite-redux/archetypes/conditional-always-hit.ts`:L128-L138,L163-L176 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: pure status burn candidate. Edge: the FIRE target immunity and user-type conditional accuracy are observable; the latter is a hidden callback that must be supported or excluded. [O/G] [oracle: `src/field/pokemon.ts`:L7092-L7113; `src/data/elite-redux/archetypes/conditional-always-hit.ts`:L128-L176 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | POISON POWDER `77` | `(STATUS,POISON,-1,75,35,-1,0,NEAR_OTHER)`, POISON + POWDER + reflectable. [O/I] [oracle: `src/data/moves/move.ts`:L11264-L11267; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L114-L114 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: low-accuracy poison status on a clean target. Edge: POISON/STEEL, existing status, GRASS/powder, Safeguard, and ability immunities reject or alter the outcome. [O] [oracle: `src/field/pokemon.ts`:L7019-L7073,L7116-L7195; `src/data/moves/move.ts`:L829-L829 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 3 | TOXIC `92` | `(STATUS,POISON,-1,90,10,100,0,NEAR_OTHER)`, TOXIC + reflectable, with `ToxicAccuracyAttr` giving a POISON user an always-hit condition. The ER record explicitly gives effect chance `100`. [O/I] [oracle: `src/data/moves/move.ts`:L11326-L11329,L6523-L6532; `src/data/elite-redux/er-moves.ts`:L2303-L2326; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L2025-L2076 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: toxic status candidate. Edge: the custom accuracy path and toxic-vs-poison status lifecycle are outside the smallest slice. [O/G] [oracle: `src/data/moves/move.ts`:L6523-L6532; `src/field/pokemon.ts`:L7048-L7073 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 2 | POISON GAS `139` | `(SPECIAL,POISON,65,100,15,0,0,ALL_NEAR_ENEMIES)`. The factory is a POISON status move with POISON attr and spread; ER rewrites category to SPECIAL, target to all near enemies, and supplies positive power/accuracy/PP; C then sets chance `0`. [O/I] [oracle: `src/data/moves/move.ts`:L11461-L11464; `src/data/elite-redux/er-moves.ts`:L3415-L3438; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L283-L291; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L147-L147 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: spread POISON damage. Edge: the source proves no positive poison application at final chance `0`; treating POISON GAS as a poison-status fixture would be fabricated parity. [O/G] [oracle: `src/data/moves/move.ts`:L3491-L3511; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L147-L147 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | STUN SPORE `78` | `(STATUS,GRASS,-1,100,20,-1,0,NEAR_OTHER)`, PARALYSIS + POWDER + reflectable. ER data changes factory PP `30` to `20` and accuracy `75` to `100`; no runtime patch in the inspected move-patch source adds Electric-immunity bypass. [O/I/G] [oracle: `src/data/moves/move.ts`:L11268-L11271; `src/data/elite-redux/er-moves.ts`:L1972-L1993; `src/data/moves/move.ts`:L829-L829 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: clean-target paralysis attempt. Edge: ELECTRIC targets remain subject to the ordinary status type-immunity check unless a separate bypass is proven; the ER description/runtime discrepancy is unresolved. [O/G] [oracle: `src/field/pokemon.ts`:L7075-L7080; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L1479-L1487 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | GLARE `137` | `(STATUS,NORMAL,-1,100,30,-1,0,NEAR_OTHER)`, PARALYSIS + reflectable; the C correction sets PP `30`; the ER patch replaces the ordinary status attr with `ErStatusEffectIgnoreImmunityAttr(PARALYSIS)`. [O/I] [oracle: `src/data/moves/move.ts`:L11454-L11456; `src/data/elite-redux/er-moves.ts`:L3369-L3390; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L146-L146; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L1479-L1487 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: paralysis on a clean target, including the Electric-immunity edge if the ER attr is supported. Edge: this is a custom ER status callback, so it is not the smallest no-bespoke candidate. [O/G] [oracle: `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L1479-L1487 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 2 | THUNDER WAVE `86` | `(STATUS,ELECTRIC,-1,90,10,-1,0,NEAR_OTHER)`, PARALYSIS + `RespectAttackTypeImmunityAttr` + reflectable. ER conditional-always-hit makes it always hit for an ELECTRIC user. [O/I] [oracle: `src/data/moves/move.ts`:L11301-L11304,L2171-L2171; `src/data/elite-redux/er-moves.ts`:L2159-L2180; `src/data/elite-redux/archetypes/conditional-always-hit.ts`:L128-L138,L163-L176 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: paralysis on a non-immune target. Edge: GROUND prevents the type-based status attempt, and the user-type always-hit branch is additional callback behavior. [O/G] [oracle: `src/field/pokemon.ts`:L7075-L7080; `src/data/type.ts`:L98-L110 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |

## Ability candidates and NONE

Ability IDs are the zero-based `AbilityId` member values; the selected values
are also present in the identity range of the pinned ER ability map.  [I]
[oracle: `src/enums/ability-id.ts`:L3-L3,L23-L25,L37-L39,L47-L55; `src/data/elite-redux/er-id-map.ts`:L1927-L1955 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

| Rank | Candidate | Definition/effect and hidden callback | Positive / edge observability |
|---:|---|---|---|
| 1 | `NONE` ability `0` | The builder creates `AbilityId.NONE` without attrs; its name and description are empty. [O] [oracle: `src/data/abilities/init-abilities.ts`:L269-L271; `src/data/abilities/ability.ts`:L39-L52,L76-L80 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: no ability event or defensive modification. Edge: this is a deliberate no-op ID only; it must not be the mapper's silent answer for an unsupported ability. [G] [oracle: `src/data/elite-redux/init-elite-redux-species.ts`:L671-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | INTIMIDATE `22` | Builder attaches `PostSummonStatStageChangeAbAttr([ATK],-1,false,true)`. On a real summon it queues opponent stage changes, skips nonadjacent triple targets, and checks Intimidate immunity/Substitute; simulated application returns without mutation. [O] [oracle: `src/data/abilities/init-abilities.ts`:L386-L388; `src/data/abilities/ab-attrs.ts`:L2886-L2974 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: switch-in ATK `-1` event for each eligible adjacent opponent. Edge: simulation, triple nonadjacency, Substitute, and Intimidate immunity are distinct outcomes and must remain observable. [O] [oracle: `src/data/abilities/ab-attrs.ts`:L2909-L2957 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 1 | WONDER GUARD `25` | Builder attaches `NonSuperEffectiveImmunityAbAttr`. It applies only when the move is an `AttackMove` and the current type multiplier is below `2`, then sets the multiplier to `0` and cancels the result. [O] [oracle: `src/data/abilities/init-abilities.ts`:L396-L400; `src/data/abilities/ab-attrs.ts`:L557-L569 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: a non-super-effective attack is nullified. Edge: status moves are excluded by the `AttackMove` check, and super-effective attacks are not stopped; the ability must be evaluated after type modifiers. [O] [oracle: `src/data/abilities/ab-attrs.ts`:L557-L569 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 2 | FLASH FIRE `18` | Builder attaches `TypeImmunityAddBattlerTagAbAttr(FIRE,FIRE_BOOST,1)` and makes it ignorable. The generic type-immunity attr sets the multiplier to `0`; the tag callback adds FIRE_BOOST to a non-simulated defender. [O] [oracle: `src/data/abilities/init-abilities.ts`:L368-L370; `src/data/abilities/ab-attrs.ts`:L433-L465,L536-L554 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: FIRE attack is immune and the boost tag is observable. Edge: side-target moves, self-targeting, simulation, suppression, and a second trigger require separate paths. [O/G] [oracle: `src/data/abilities/ab-attrs.ts`:L433-L465,L536-L554 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 3 | VOLT ABSORB `10` | Builder attaches `TypeImmunityHealAbAttr(ELECTRIC)`. On a non-full-HP, non-simulated target, the attr queues a max-HP-quarter heal and cancels the ordinary result. [O] [oracle: `src/data/abilities/init-abilities.ts`:L321-L327; `src/data/abilities/ab-attrs.ts`:L483-L506 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: ELECTRIC hit becomes immunity plus heal. Edge: full HP and simulation do not queue the heal; the heal amount and phase ordering are additional contract data. [O/G] [oracle: `src/data/abilities/ab-attrs.ts`:L483-L506 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 3 | WATER ABSORB `11` | Same heal attr shape as VOLT ABSORB but immune type WATER. [O] [oracle: `src/data/abilities/init-abilities.ts`:L325-L327; `src/data/abilities/ab-attrs.ts`:L483-L506 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: WATER hit becomes immunity plus heal. Edge: full HP/simulation and side-target checks remain reachable. [O/G] [oracle: `src/data/abilities/ab-attrs.ts`:L433-L465,L483-L506 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 3 | LEVITATE `26` | Builder attaches conditional GROUND `AttackTypeImmunityAbAttr`; the condition is not Grounded and no active Gravity. ER adds a separate FLYING `1.25x` power rider. [O] [oracle: `src/data/abilities/init-abilities.ts`:L401-L408; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L1788-L1794 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: a non-grounded, non-Gravity defender is immune to GROUND attacks. Edge: Grounded and Gravity states bypass the immunity; the ER Flying rider makes this larger than a pure type-immunity candidate. [O/G] [oracle: `src/data/abilities/init-abilities.ts`:L401-L408; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L1788-L1794 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |
| 4 | IMMUNITY `17` | Builder supplies POISON/TOXIC status immunity and post-summon status healing; ER additionally gives `ReceivedTypeDamageMultiplierAbAttr(POISON,0.5)`. [O] [oracle: `src/data/abilities/init-abilities.ts`:L363-L366; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L730-L735 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] | Positive: poison status is rejected and Poison damage is reduced. Edge: this is broader than one type-immunity event because it has status-heal and damage-reduction behavior. [O/G] [oracle: `src/data/abilities/init-abilities.ts`:L363-L366; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L730-L735 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`] |

## Recommended smallest closed candidate slice

The smallest candidate set that covers every required move slot without
introducing the explicitly bespoke ER move callbacks is:

* physical baseline: POUND `1`;
* special baseline and priority: SHOCK WAVE `351`;
* low accuracy and poison: POISON POWDER `77`;
* spread and ATK-stage-down: PLAY NICE `589`;
* burn: EMBER `52`;
* paralysis: STUN SPORE `78`;
* ability `NONE`: `0`;
* switch-in stat change: INTIMIDATE `22`;
* defensive/type immunity: WONDER GUARD `25`.

This is a recommendation for the steward, not a final manifest.  It is
“closed” only under the following proposed contract decisions: standard
status/stage/target/type processing is admitted; POWDER, REFLECTABLE, and
IGNORE_SUBSTITUTE are represented as standard flags; no selected species is
allowed to carry an unclassified ER active or innate; Ember is never applied
to a reachable FREEZE state; and a status/accuracy roll is represented by the
normal deterministic RNG contract.  The source proves each declaration but
does not prove that these policies have already been implemented.  [O/G]
[oracle: `src/data/moves/move.ts`:L4888-L4948,L11264-L11267,L13143-L13147; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L834-L834; `src/data/abilities/init-abilities.ts`:L269-L271,L386-L388,L396-L400; `src/data/moves/move.ts`:L1607-L1611 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

The proposed species role candidates for that slice are Rattata `19` as
physical player, Squirtle `7` as special player, Bulbasaur `1` as status
player/resistant enemy, Meowth `52` as neutral enemy, Squirtle `7` as weak
enemy, and Diglett `50` as Electric-immune enemy.  Ekans `23` is the concrete
Intimidate carrier candidate; Wonder Guard should be assigned explicitly until
a species carrier is proven.  These are role recommendations only, and all
ER ability/innate payloads remain subject to the capability gate.  [O/G]
[oracle: `src/data/elite-redux/er-species.ts`:L109-L132,L1300-L1323,L3089-L3112,L3828-L3851,L9182-L9205,L9533-L9556; `src/data/elite-redux/init-elite-redux-species.ts`:L244-L258,L671-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

If “low accuracy” must be a damaging move rather than a status move, the
smallest replacement is HYDRO PUMP `56`, but its Drench callback is then
reachable.  If “spread” must be damaging, the clean Play Nice option is no
longer sufficient; the nearest alternatives are Hyper Voice `304` (sound),
Surf `57` (Drench/Gulp Missile), Rock Slide `157` (flinch/throw), Earthquake
`89` (underground/terrain), or the Poison Gas `139` source-conflict row.  [O/G]
[oracle: `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L1273-L1290,L876-L879; `src/data/moves/move.ts`:L12093-L12095,L7833-L7857; `src/data/elite-redux/er-moves.ts`:L7379-L7402,L1456-L1479,L3852-L3875,L3415-L3438 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## Reachable unsupported mechanics and fail-closed requirements

The following are the known reachable branches for the recommended candidate
set or its ranked alternatives.  A capability manifest should classify each
before a battle is initialized; none should be silently converted to NONE,
ignored, or treated as a successful no-op.  [O/G] [oracle: `src/data/elite-redux/init-elite-redux-species.ts`:L671-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

1. **Accuracy, chance, RNG, PP, damage, and ordering.**  POUND, SHOCK WAVE,
   POISON POWDER, PLAY NICE, EMBER, and STUN SPORE still pass through accuracy,
   effect-chance, PP, damage, and priority phases; this note extracts their
   inputs but does not establish numeric HP or RNG outcomes.  [G] [oracle: `src/data/moves/move.ts`:L186-L207,L288-L318,L3491-L3511,L1960-L1977; `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`:L2025-L2076 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
2. **Contact reactions.**  POUND, SCRATCH, TACKLE, and QUICK ATTACK are
   physical and therefore contact by default; any reachable contact-punish or
   contact-ignore ability is outside this content note.  [O/G] [oracle: `src/data/moves/move.ts`:L288-L316; `src/data/moves/move.ts`:L917-L917 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
3. **Target geometry and spread.**  PLAY NICE's all-near-enemy target and
   INTIMIDATE's adjacent-opponent loop require SINGLE/COOP_DOUBLE geometry;
   triple nonadjacency is an explicit branch in the same summon attr.  [O/G]
   [oracle: `src/enums/move-target.ts`:L1-L17; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L834-L834; `src/data/abilities/ab-attrs.ts`:L2927-L2939 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
4. **Stat-stage boundaries and protections.**  PLAY NICE can be reflected and
   ignores Substitute; stage application has target/self and chance branches,
   and the exact `-6/+6` clamp is not extracted here.  [G] [oracle: `src/data/moves/move.ts`:L4888-L4948,L13143-L13147 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
5. **Status admission and lifecycle.**  POISON POWDER, EMBER, and STUN SPORE
   can encounter existing status, Safeguard, type immunities, ability
   immunities, and the status-specific Fire/Poison/Electric checks.  Turn-end
   burn damage, poison damage, and paralysis speed consequences remain
   unsupported by this extraction and require fail-closed classification.  [G]
   [oracle: `src/field/pokemon.ts`:L7019-L7073,L7075-L7113,L7116-L7195; `src/enums/status-effect.ts`:L3-L11 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
6. **Powder protection.**  POISON POWDER and STUN SPORE set POWDER; Grass
   immunity and ER powder blockers are reachable if the target or loadout
   supplies them.  [O/G] [oracle: `src/data/moves/move.ts`:L501-L514,L829-L830; `src/field/pokemon.ts`:L7048-L7073 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
7. **Type chart and immunity ordering.**  Weak, resistant, and immune species
   require the complete type multiplier, dual-type product, and ability
   modifiers.  WONDER GUARD is evaluated only for AttackMove and
   non-super-effective results; Flash Fire/Volt Absorb/Water Absorb add their
   own post-immunity behavior.  [O/G] [oracle: `src/data/type.ts`:L14-L50,L98-L110,L177-L231; `src/data/abilities/ab-attrs.ts`:L433-L569 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
8. **Switch-in stat events.**  INTIMIDATE requires real-vs-simulated summon
   distinction, adjacency, Substitute, Intimidate immunity, and event queue
   order.  [O/G] [oracle: `src/data/abilities/ab-attrs.ts`:L2886-L2974 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
9. **ER active/bench content.**  Every selected ER species carries ability and
   innate refs, and the mapper has custom-ID and unmapped-to-NONE branches;
   unsupported active or bench content must fail before battle start rather
   than use that fallback.  [O/G] [oracle: `src/data/elite-redux/er-species.ts`:L109-L132,L1300-L1323,L3089-L3112,L3828-L3851,L9182-L9205,L9533-L9556; `src/data/elite-redux/init-elite-redux-species.ts`:L244-L258,L647-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
10. **Fire thaw.**  EMBER carries the generic Fire thaw attr even though the
    selected status list does not include FREEZE; a pre-existing or future
    Freeze path therefore requires either an invariant or a capability.  [O/G]
    [oracle: `src/data/moves/move.ts`:L1607-L1611; `src/field/pokemon.ts`:L7188-L7195 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
11. **Alternatives with bespoke callbacks.**  HYDRO PUMP/Drench, BLIZZARD
    weather accuracy/Frostbite, WILL-O-WISP and THUNDER WAVE conditional
    always-hit, GLARE Electric-bypass, GROWL category/sound rewrite, TACKLE
    Angel's Wrath, HARDEN Angel's Wrath omniboost, SURF Gulp Missile/Drench,
    ROCK SLIDE flinch/throw, and EARTHQUAKE underground/terrain are all proven
    source paths and must be unsupported unless explicitly admitted.  [O/G]
    [oracle: `src/data/moves/move.ts`:L7775-L7792,L7833-L7857,L8283-L8310,L8383-L8399; `src/data/elite-redux/archetypes/conditional-always-hit.ts`:L128-L176; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L273-L291,L876-L879,L1273-L1290,L1469-L1487; `src/data/moves/move.ts`:L6535-L6547,L8103-L8103 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
12. **Poison Gas conflict.**  ER data contains a positive effect chance, but
    C corrections run after rebalance and explicitly set `MOVE_POISON_GAS`
    chance to `0`; the final source-backed observation is spread damage with
    no positive poison application.  [O/G] [oracle: `src/data/elite-redux/er-moves.ts`:L3415-L3438; `src/data/elite-redux/init-elite-redux-c-source-corrections.ts`:L147-L147; `src/init/init.ts`:L230-L246 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
13. **Stun Spore description/runtime gap.**  The ER record description is not
    enough to establish an Electric-immunity bypass; the inspected runtime
    patch replaces GLARE's attr but does not provide an equivalent STUN SPORE
    patch.  Treat the discrepancy as unsupported until a pinned runtime path
    is proven.  [G] [oracle: `src/data/elite-redux/er-moves.ts`:L1972-L1993; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L1479-L1487; `src/field/pokemon.ts`:L7075-L7080 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## Proposed contract decisions for the steward

1. Keep this as a ranked candidate note; fill the manifest only after the
   steward chooses one row per role and records the selected loadouts.  [G]
2. Use PLAY NICE `589` rather than GROWL for the combined spread and
   ATK-stage-down slots unless the contract intentionally wants a damaging
   sound move.  [I] [oracle: `src/data/moves/move.ts`:L13143-L13147; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L834-L834; `src/data/elite-redux/init-elite-redux-vanilla-move-patches.ts`:L273-L281 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
3. Use POISON POWDER `77` for the low-accuracy slot only if standard POWDER
   blocking is part of the supported status vocabulary; otherwise the source
   proves no callback-free low-accuracy candidate in this ranked subset. [G]
4. Use EMBER `52` for Burn only with a no-FREEZE state invariant, or classify
   the generic Fire thaw attr.  Do not use WILL-O-WISP as the smallest slice
   unless its conditional always-hit callback is explicitly supported. [O/G]
   [oracle: `src/data/moves/move.ts`:L11200-L11201,L1607-L1611; `src/data/elite-redux/archetypes/conditional-always-hit.ts`:L128-L176 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
5. Prefer WONDER GUARD `25` as the smallest defensive candidate; prefer
   FLASH FIRE `18` only when a concrete Vulpix carrier and FIRE_BOOST tag event
   are required.  [I] [oracle: `src/data/abilities/init-abilities.ts`:L368-L370,L396-L400; `src/data/elite-redux/er-species.ts`:L6592-L6615 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
6. Reject any unsupported active/bench ability or effect at initialization;
   never turn it into AbilityId.NONE or an ignored move effect.  [G] [oracle: `src/data/elite-redux/init-elite-redux-species.ts`:L671-L687 @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
