# M3-00A RNG oracle

This is a static extraction of the RNG behavior visible at the pinned
TypeScript oracle. It freezes observations and identifies contracts that still
need an explicit decision; it does not implement the RNG, battle mechanics,
fixtures, or shared Rust types.

## Authority and evidence convention

- M2 base: `7357166c19bdb5cf0e32c84b0f74f22e79d80798`.
- TypeScript oracle authority: commit
  `3b534099919efae827019d4a3f3c4ab0ecd6d67b`.
- The oracle declares `phaser: ^3.90.0` in `package.json`, while its lockfile
  realizes exactly `phaser@3.90.0` with the recorded integrity hash:
  `3b534099919efae827019d4a3f3c4ab0ecd6d67b:package.json:86` and
  `3b534099919efae827019d4a3f3c4ab0ecd6d67b:pnpm-lock.yaml:1885-1886,3977-3979`.
- `P` below means the external dependency source at the pinned tag
  [Phaser v3.90.0 RandomDataGenerator.js](https://github.com/phaserjs/phaser/blob/v3.90.0/src/math/random-data-generator/RandomDataGenerator.js).
  Oracle citations use the form
  `3b534099919efae827019d4a3f3c4ab0ecd6d67b:path:line-range`.
- **Observed** means directly present in the cited source. **Inference** means
  the consequence of composing cited source paths. **Gap** means static source
  does not establish the required parity fact.

The M3 specification requires exact Phaser 3.90 behavior, string seeding,
state parsing/serialization, battle substreams, per-turn restoration, draw
order, integer ranges, damage variance, speed ties, accuracy, critical hits,
and secondary effects
(`C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:362-385`).

## 1. Phaser 3.90 RandomDataGenerator

### State and transition

**Observed:** Phaser's generator stores `c`, `s0`, `s1`, `s2`, and an internal
`n` counter. Initialization accepts either a state string or a seed array. The
state transition is exactly:

```text
t  = 2091639 * s0 + c * 2.3283064365386963e-10
c  = t | 0
s0 = s1
s1 = s2
s2 = t - c
return s2
```

The constructor/initialization path and state fields are in
`P:30-99`; the transition is in `P:109-119`. The hash used by seeding is the
source's string-coercion, UTF-16 `charCodeAt`, and fixed-constant hash at
`P:121-152`.

**Observed:** `init(seeds)` treats a JavaScript string as a state string and
otherwise calls `sow(seeds)`. `sow` resets the state, hashes a space into each
of `s0`, `s1`, and `s2`, sets `c = 1`, then folds each supplied seed in order;
each seed is string-coerced before hashing. The exact branches and constants
are in `P:154-207`.

### Number and integer semantics

Phaser's separate `n` field is the seed-hash accumulator. `sow()` resets it,
`hash()` updates it for each seed code unit, and `rnd()` neither reads nor
mutates it (`P:116-218`).

**Observed:** Phaser's primitive consumption is:

| API | Observable operation | Core `rnd()` calls |
| --- | --- | ---: |
| `integer()` | `rnd() * 0x100000000` with no source-level integer coercion | 1 |
| `frac()` | `rnd() + (rnd() * 0x200000 | 0) * 1.1102230246251565e-16` | 2 |
| `realInRange(min,max)` | `frac() * (max - min) + min` | 2 |
| `integerInRange(min,max)` | `Math.floor(realInRange(0, max - min + 1) + min)` | 2 |
| `pick(array)` | `array[integerInRange(0, array.length - 1)]` | 2 when length > 1 |

These are the exact implementations at `P:208-291` and `P:324-340`.
Therefore Phaser's inclusive integer API is not an ordinary one-sample
multiply-and-floor operation.

The oracle wrapper preserves that behavior: `randSeedInt(range, min)` returns
`min` without touching Phaser state when `range <= 1`; otherwise it calls
`Phaser.Math.RND.integerInRange(min, range - 1 + min)`. Its range helper
converts an inclusive `[min,max]` interval to cardinality `max - min + 1`.
Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:96-115`.

**Contract consequence:** a battle call written as `randBattleSeedInt(100)`
returns an integer in `[0,99]` and consumes Phaser's two-core-draw integer
operation; `randBattleSeedIntRange(85,100)` returns `[85,100]` and has
cardinality 16. The call-site evidence is
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:8006-8017`;
the variance use is
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:5539-5562`.

### State parser and serializer

**Observed:** Phaser's public state string is `!rnd,c,s0,s1,s2`. When a setter
argument begins with `!rnd`, Phaser splits on commas and `parseFloat`s fields 1
through 4 into `c`, `s0`, `s1`, and `s2`; it then returns the canonical joined
string. The serializer does not include `n`. A non-`!rnd` setter argument is
ignored and the current state is returned. Evidence: `P:411-442`.

**Inference:** because the parser performs no validation before `parseFloat`, a
matching-prefix malformed string can install `NaN` fields. This is an observed
parser consequence, not a recommendation for canonical Rust state validation.

The M3 state contract separately requires exact hexadecimal IEEE-754 bit
patterns for the floating fields and forbids JSON numbers
(`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:401-423`).
That bit representation is an M3 serialization decision; it is not Phaser's
decimal `state()` string.

**Proposed field mapping:** M3's `carry` is Phaser's integer `c`, while
`s0_bits`, `s1_bits`, and `s2_bits` are the exact IEEE-754 bit patterns of
Phaser's three floating state fields; retain Phaser's `!rnd,c,s0,s1,s2` as
`state_string` for oracle diagnostics. The mapping follows the required M3
shape and Phaser's parser/serializer, not an alternative generator
representation (`P:411-442` and
`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:401-423`).

### Shuffle semantics

**Observed:** Phaser's own `shuffle` uses descending Fisher-Yates indices and
`Math.floor(frac() * (i + 1))`, so it consumes two core draws per swap. The
oracle's `randSeedShuffle` uses the equivalent inclusive integer call for each
`i`, with the same two-core-draw cost per swap. Evidence: `P:444-468` and
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:149-155`.

## 2. Oracle seed and stream layers

### String construction

**Observed:** `randomString(length, true)` chooses from the exact 62-character
alphabet `A-Z`, `a-z`, `0-9` using `randSeedInt(characters.length)`; the
unseeded branch uses `Math.random`. `shiftCharCodes` adds the supplied integer
to each UTF-16 code unit and reconstructs a string. Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:20-45`.

**Observed:** each `Battle` has `turn = 0`, initializes `battleSeed` with
`randomString(16, true)`, and starts `battleSeedState` as `null`. Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:68-97`. Thus
battle-seed string generation itself uses the process-global Phaser stream
through the seeded string helper.

### Run/wave and offset state

The required M3 split is a run state containing the process-global RDG and a
battle state containing `battle_seed`, `turn`, and an optional saved
substream (`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:412-420`).
The oracle's process-global `Phaser.Math.RND` plus `seed`/`waveSeed` paths are
the run-side evidence; `Battle.battleSeed`/`turn`/`battleSeedState` are the
battle-side evidence cited below.

**Observed:** `BattleScene.resetSeed(waveIndex)` computes
`waveSeed = shiftCharCodes(seed, wave)` and sows the process-global Phaser
generator with `[waveSeed]`. Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:2931-2937`.

**Observed:** `BattleScene.executeWithSeedOffset` saves `rngOffset`,
`rngSeedOverride`, and `Phaser.Math.RND.state()`, sows
`[shiftCharCodes(seedOverride || this.seed, offset)]`, sets the two metadata
fields, runs the callback, then restores the saved Phaser state and metadata.
Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:2939-2953`.

**Gap:** the callback is not enclosed in `try/finally`; source statically shows
that an exception can skip restoration. The same structural caveat applies to
the battle draw swap because its save/draw/restore sequence is also not a
`try/finally`. Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:2939-2953` and
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:616-633`.

### Battle substream swap

**Observed:** `Battle.randSeedInt(range,min)` has this exact normal-path
sequence:

1. If `range <= 1`, return `min` immediately; no draw, no state swap, and no
   `battleSeedState` update.
2. Save `globalScene.rngSeedOverride` and the process-global
   `Phaser.Math.RND.state()`.
3. If `battleSeedState` exists, install it. Otherwise sow one seed,
   `shiftCharCodes(battleSeed, turn << 6)`.
4. Set `globalScene.rngSeedOverride = battleSeed` and call the shared
   `randSeedInt(range,min)` helper.
5. Save the resulting Phaser state into `battleSeedState`.
6. Restore the previously saved process-global state and `rngSeedOverride`,
   then return the result.

Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:610-634`.

`BattleScene.randBattleSeedInt` delegates to the current battle, and
`Pokemon.randBattleSeedInt` delegates through that path when a current battle
exists; without one it calls the global helper directly. Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:1484-1502` and
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:7994-8018`.

**Inference:** ordinary battle draws leave the process-global run state as it
was before the draw, while advancing only the cached battle substream. This
does not mean battle construction is free: the `battleSeed` field initializer
uses the global seeded string helper, and construction is performed inside a
`waveIndex << 3` seed-offset callback. Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:1739-1750`,
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:68-97`, and
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:20-29`.

### Per-turn reset

**Observed:** `incrementTurn()` increments `turn` and sets
`battleSeedState = null`. Battle creation calls `incrementTurn()` after the
seed-offset construction callback, and `TurnEndPhase.start()` calls it at the
start of turn-end processing. Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:281-289`,
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:1739-1750`, and
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/turn-end-phase.ts:32-49`.

**Inference:** the first battle-stream draw of the first active turn uses
`shiftCharCodes(battleSeed, 1 << 6)` because construction leaves `turn` at 0
and then increments it to 1. Each later turn starts a fresh sow with its own
`turn << 6` offset; subsequent draws in that turn resume the saved state. The
inference follows from the cited paths and the swap algorithm at
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:616-633`.

## 3. Battle-facing RNG seams

The table freezes the observable core seams. “Range” is the wrapper's
cardinality argument; the returned integer interval is stated separately when
`min` is nonzero.

| Seam | Draw condition and result | Stream and source evidence |
| --- | --- | --- |
| Accuracy | After target/type/protection/invulnerability gates, and unless accuracy is bypassed or a later multi-hit is guaranteed, call `user.randBattleSeedInt(100)`; hit iff `rand < moveAccuracy * accuracyMultiplier`. | Battle substream, `[0,99]`; `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:444-569`. Target checks iterate in target-array order at `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:323-359`. |
| Critical hit | After fixed-damage/signature exclusions and conditional guaranteed-crit checks, use `critChance = [24,8,2,1][Clamp(stage,0,3)]`; if not already guaranteed and no override supplies a value, call `globalScene.randBattleSeedInt(critChance)` and crit on result `0`. | Battle substream; cardinality is the selected `critChance`; `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:5856-5893`. |
| Damage variance | For non-simulated damage without a forced multiplier, call `this.randBattleSeedIntRange(85,100) / 100`; the result is an inclusive integer in `[85,100]`. | Battle substream; one cardinality-16 draw; `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:5539-5562`. |
| Speed tie | `sortInSpeedOrder` groups entries, then invokes a seed-offset Fisher-Yates shuffle before speed sorting. Each group swap calls `Phaser.Math.RND.integerInRange(0,i)`. | Isolated `executeWithSeedOffset` stream seeded from `waveSeed` with `currentBattle.turn * 1000 + pokemonList.length`; no draw when there are fewer than two groups. Evidence: `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/speed-order.ts:13-41`, `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:149-155`, and `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:2939-2953`. |
| Secondary status chance | `StatusEffectAttr` and the immunity-bypass variant draw `user.randBattleSeedInt(100)` only when `moveChance` is neither negative nor 100; success is `result < moveChance`. | Battle substream; `[0,99]`; `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3491-3549`. |
| Multi-status selection | `MultiStatusEffectAttr` first chooses one effect with `randSeedItem`, then runs ordinary status chance. | The effect choice uses process-global `Phaser.Math.RND.pick`, not the battle cache; the following chance is battle-substream. Evidence: `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3552-3577` and `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:128-142`. |
| Stat-stage chance | After base/condition checks, `StatStageChangeAttr` uses the conditional `user.randBattleSeedInt(100) < moveChance`. | Battle substream; `[0,99]`; `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:4880-4948`. |
| Paralysis activation | A paralyzed user calls `user.randBattleSeedInt(4) === 0` unless `STATUS_ACTIVATION_OVERRIDE` supplies the result. | Battle substream; `[0,3]`; `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-phase.ts:535-553`. |
| Sleep duration | If `doSetStatus` receives sleep without a supplied duration, its default evaluates `randBattleSeedIntRange(2,4)`. Burn, poison, and paralysis use the default `0` path. | Battle substream; inclusive `[2,4]` only for sleep; `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:7246-7290`. This is outside the M3 minimum status list unless sleep is selected (`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:30-42`). |

Status feasibility and queuing are not themselves extra core draws in the
shown paths: `canSetStatus` performs status/type/terrain/ability checks and
`trySetStatus` queues `ObtainStatusEffectPhase`; dynamic ability hooks can
still draw. Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:7007-7153,7171-7243`
and
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/obtain-status-effect-phase.ts:51-78`.
Burn, poison, and toxic post-turn damage contain no direct RNG call in the
shown phase; ability modifiers invoked there remain content-dependent.
Evidence:
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/post-turn-status-effect-phase.ts:19-61`.

### Additional content-conditioned seams

These are observable in the pinned battle/move source and must not be silently
treated as part of the core table. Their reachability depends on selected M3
content, which is not established by this RNG extraction.

| Seam | Exact source evidence | Required handling |
| --- | --- | --- |
| Random target | `RANDOM_NEAR_ENEMY` indexes `opponents` with `user.randBattleSeedInt(opponents.length)`: `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move-utils.ts:132`. | If selected, record before accuracy checks in actual target-resolution order; otherwise fail closed rather than consume a speculative draw. |
| Multi-hit count | The `TWO_TO_FIVE` branch calls `user.randBattleSeedInt(20)`, and the move-effect phase resolves hit count before conducting hit checks: `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3368-3382` and `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:222-259`. | `MultiHitCount`, before target accuracy, only for selected multi-hit content. |
| Random damage attribute | `RandomLevelDamageAttr` uses `user.randBattleSeedIntRange(50,150)`: `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:2400-2410`. | Separate from standard 85–100 damage variance; selected-content contract required. |
| Random effect/item choices | Battle-substream choices include item/berry/stat/target/move-pool selections at `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3660-3664,3858-3864,3940-3948,4187-4193,4364-4370,5178-5184`; the same file has additional content-dependent battle choices at `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:6673,7614,7687-7690,7888,8040,8132,8217,8651,8780,8878,9366,9416,9469,10739`. | Inventory every reachable call site for selected content and map it to a closed reason; do not infer from a stack trace. |
| Direct global effect rolls | `StealHeldItemChanceAttr` first calls global `randSeedFloat`, and Fickle Beam/Magnitude/Present use direct global `randSeedInt` calls, sometimes inside `executeWithSeedOffset`: `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3631-3668,5577-5621,5871-5920,6058-6087`. | These do not advance the cached battle substream unless their own wrapper says so. Exclude/fail closed or explicitly assign a stream before parity fixtures. |
| Reactive/ability effects | `applyOnTargetEffects` invokes held-item and ability hooks after target damage, while the ability file contains battle draws such as effect choice/chance: `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:972-1017` and `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/abilities/ab-attrs.ts:1116-1120,1160,1373,2244-2256,2293-2300,3861`. | The selected ability/effect definition and trigger order must be frozen by the content/oracle lane; this worker cannot claim a complete draw sequence for unspecified hooks. |

The direct helper inventory also shows `randBattleSeedInt` at
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:563`,
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-phase.ts:415,546,879`, and
`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:9202,9608-9621,9732`. These include retargeting and
AI/content decisions, so they are classified as reachable only after the M3
content slice is known, not silently folded into Accuracy/CriticalHit.

## 4. Observable draw order

This is the strongest order statically established for a supported ordinary
move. It is deliberately conditional: selected ability, item, multi-hit,
random-target, and custom-effect hooks can add draws at the cited trigger
points.

1. **Turn ordering.** `TurnStartPhase` first builds command priority with
   non-FIGHT commands before FIGHT, then invokes `inSpeedOrder` for pre-turn
   commands and again for FIGHT commands. The priority and invocation loops are
   at
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/turn-start-phase.ts:53-78,255-315`.
   `inSpeedOrder` fills a priority queue, whose reorder calls
   `sortInSpeedOrder`; each reorder performs the wave-seeded speed shuffle
   before speed comparison. Evidence:
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/speed-order-generator.ts:14-35`,
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/queues/pokemon-priority-queue.ts:5-9`, and
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/speed-order.ts:13-87`.
2. **Pre-move failure.** The move phase performs sleep/freeze/PP/validity and
   other failure checks in source order; paralysis is checked near the end of
   that list, before the move is used. Evidence:
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-phase.ts:264-310`.
   The paralysis draw, when not overridden, is therefore before target accuracy
   for that move (`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-phase.ts:535-553`).
3. **Target resolution and hit count.** A selected random target is drawn while
   resolving `RANDOM_NEAR_ENEMY` (`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move-utils.ts:132`); a
   selected multi-hit count is resolved before hit checks
   (`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:222-259`). The exact placement of
   target resolution relative to a particular command setup is not exposed by
   this document and must be measured in the oracle.
4. **All hit checks first.** `conductHitChecks` iterates the resolved target
   array and calls `hitCheck` for each target before `applyToTargets` resolves
   any successful target. Eligible accuracy draws therefore precede the first
   target's critical, variance, and secondary-effect draws. Evidence:
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:323-359,400-442,444-569`.
5. **Each successful target.** For each target in array order,
   `applyMoveEffects` triggers PRE_APPLY, applies the move, then triggers
   POST_APPLY user effects and target effects. For damaging moves,
   `applyMoveDamage` calls the critical result before `getAttackDamage`, where
   the standard variance draw occurs; default POST_APPLY status/stat effects
   are after the damage call, while an explicitly configured PRE_APPLY effect
   can precede it. Evidence:
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:686-812`
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:968-1017`
   and the default/override trigger definition at
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:1863-1900`.
6. **Last-hit effects.** POST_TARGET effects are triggered only when
   `lastHit` is true, after target application, at
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:355-393`.
   The default move-effect trigger is POST_APPLY, while PRE_APPLY and
   POST_TARGET are explicit options at
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:1863-1900`.
7. **Turn end.** `TurnEndPhase` increments the battle turn and thereby clears
   the cached battle substream before subsequent turn-end work
   (`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/turn-end-phase.ts:32-49`).
   Burn/poison/toxic damage has no direct RNG in its shown phase
   (`3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/post-turn-status-effect-phase.ts:19-61`); dynamic ability and
   item hooks remain conditional seams.

## 5. First-divergence audit

The required audit is draw-level, not final-state-only. The M3 schema requires
`sequence`, `stream`, closed `reason`, optional `range`, integer `result`, and
before/after fingerprints
(`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:425-451`).
The oracle exporter requirements are to wrap `Battle.randSeedInt` and
`BattleScene.randBattleSeedInt`, inventory direct battle-affecting seams, capture
`Phaser.Math.RND.state()` before/after, and record requested range/result; an
unmatched Phaser state change fails fixture generation
(`C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:988-1000`).

Freeze these evidence rules:

- Sequence numbers are assigned in actual execution order. Record one audit
  entry per exposed game-level draw (each integer choice in a shuffle is one
  entry), while the before/after fingerprints prove the two-core-draw Phaser
  consumption. This is a proposed audit granularity; Phaser itself exposes
  only the state transition and helper calls, not an oracle reason.
- `Accuracy`, `CriticalHit`, `DamageVariance`, `SpeedTie`, `SecondaryEffect`,
  `MultiHitCount`, and `AbilityChance` are the initial closed reason mapping
  proposed by the M3 specification
  (`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:441-451`).
  The exporter may retain call-site diagnostics, but a stack trace is not
  canonical reason data
  (`C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:988-1000`).
- A range-only audit record cannot reconstruct a nonzero minimum: the observed
  variance call is cardinality 16 with minimum 85, while `RngDraw` has no
  `min` field. Proposed decision: add `min` (or an equivalent canonical
  interval) to the audit record; do not encode `[85,100]` as if its range were
  100. Evidence:
  `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:101-115`,
  `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:5539-5562`, and the required schema at
  `C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:425-438`.
- A fractional `randSeedFloat()` result does not fit the required `SafeU53`
  `result` field. Proposed decision: add an exact float/bit-pattern result
  field for supported float seams, or classify those direct global seams as
  unsupported and fail closed. Do not coerce a float to an invented integer.
  Evidence:
  `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:128-142`,
  `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3631-3648`, and the schema at
  `C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:425-438`.
- Fingerprints must preserve exact floating state, not decimal JSON numbers;
  use the M3 bit-pattern representation at the contract boundary and retain
  the Phaser state-string form for oracle diagnostics. The difference between
  those representations is explicit in `P:411-442` and
  `C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:401-423`.
- Invalid commands must consume no RNG and the mismatch report must identify
  the first divergent sequence/reason/range/expected/actual/before/after, not
  merely compare final state. These are required parity gates, not observed
  guarantees of current source
  (`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:969-981` and
  `C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:420-436`).
- Generate each oracle case twice in fresh processes and require byte-identical
  initial/final RNG, draw, action, mutation, presentation, and control output;
  this is a fixture-generation requirement, not evidence available from static
  source
  (`C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:973-1020,1282-1297`).

## 6. Explicit gaps and proposed contract decisions

| ID | Classification | Evidence | Proposed decision |
| --- | --- | --- | --- |
| G1 | **Gap:** selected M3 move/ability IDs and all reachable dynamic hooks are not frozen by this lane. | M3 requires selected content to be fully observable and classified: `C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:547-579`; the pinned oracle has ability draw call sites, e.g. `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/abilities/ab-attrs.ts:1116-1120,2244-2256,3861`. | Keep the core table conditional. Require a content manifest and one closed reason mapping for every reachable selected hook before parity. Unsupported content fails closed and consumes no draw. |
| G2 | **Gap:** direct global RNG seams are not battle-cache draws. | Multi-status choice, theft chance, and direct move rolls use `randSeedItem`/`randSeedFloat`/`randSeedInt` at `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3552-3577,3631-3668,5577-5621,5871-5920,6058-6087`. | Add an explicit offset/global stream classification or exclude those moves from M3 until measured; never silently redirect them into the battle cache. |
| G3 | **Gap:** current public co-op material carries `seed` and `waveSeed`, but not `battleSeed` or `battleSeedState`. | Authoritative material contains `seed`/`waveSeed` but no private battle fields at `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/elite-redux/coop/coop-battle-engine.ts:2782-2830`; apply paths re-sow only `waveSeed` at `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/elite-redux/coop/coop-battle-engine.ts:3921-3928,4824-4839`. | Before mid-turn restore/guest parity is claimed, snapshot `battleSeed`, `turn`, and cached Phaser state or define a canonical re-derivation proven by oracle traces. Do not fabricate continuity from `waveSeed` alone. |
| G4 | **Gap:** offset and battle swap restoration is not exception-safe in the shown source. | Neither normal-path restoration is protected by `try/finally`: `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:2939-2953` and `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:616-633`. | Treat exceptional restoration as an explicit negative test and decide whether the production port must guarantee restoration. |
| G5 | **Gap:** Phaser's public serializer omits `n`, while M3 requires bit-preserving state fields. | Phaser parser/serializer: `P:411-442`; M3 state shape: `C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:401-423`. | Preserve the four canonical generator floats plus carry exactly as required; document whether `n` is intentionally noncanonical. |
| G6 | **Not generated here:** first-1,000-draw vectors and runtime state-swap traces require executing the oracle, which this worker was not authorized to run. | Required vector/state layers are listed at `C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:969-981`. | Generate vectors in the dedicated oracle/fixture lane from fresh processes, then attach exact first-divergence evidence; this document fabricates none. |

### Frozen decisions for the next implementation lane

1. Port the pinned Phaser 3.90 algorithm and wrapper cardinality semantics
   exactly; do not substitute another PRNG or simplify `integerInRange`. This
   is a contract requirement, not an implementation in this file
   (`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:455-463`).
2. Model ordinary `Battle.randSeedInt` draws as a battle-cache transaction
   that saves/restores process-global state, with a per-turn cache reset; keep
   `executeWithSeedOffset` as a distinct seeded scope. This is observed at
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:610-634`,
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle.ts:281-289`, and `3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/battle-scene.ts:2939-2953`.
3. Audit every underlying exposed integer choice in execution order, including
   speed-shuffle swaps, and record exact before/after fingerprints. Resolve the
   `min`, fractional-result, and offset-stream schema gaps before fixtures are
   authoritative.
4. Do not claim complete M3 draw-order parity for dynamic abilities, unselected
   move attributes, direct global float rolls, or mid-turn co-op restoration
   until G1-G6 are closed with oracle evidence.
