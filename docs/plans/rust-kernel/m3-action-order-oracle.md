# M3-00D action-order oracle

Status: contract extraction only. This document records observed behavior from the pinned TypeScript oracle; it does not implement Rust mechanics or select unobserved parity rules.

## Source and evidence convention

- Required M2 base: `7357166c19bdb5cf0e32c84b0f74f22e79d80798`.
- Pinned oracle: `3b534099919efae827019d4a3f3c4ab0ecd6d67b`. The repository source lock records this object at `rust/source-lock.toml:1-2`.
- Every `[Observed]` citation below is an exact path and line range read from that git object. `[Derived]` is a direct consequence of those operations. `[Gap]` identifies behavior that the source does not establish for an M3 fixture. `[Proposed]` is a contract decision for the Rust work and is not claimed as TypeScript behavior.

## Result

[Observed] The oracle does not use one flat comparator for switches and moves. It constructs a command order, inserts switch and move phases into different phase-tree positions, then lets dynamic queues reorder phases immediately before each pop. The exact command comparator, generic speed reorder, and move post-speed comparator are separate operations. [O: `src/phases/turn-start-phase.ts:53-78,255-315,341-402` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-manager.ts:423-452,578-607,827-839` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/dynamic-queue-manager.ts:31-38,63-82,164-166` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] A parity implementation must preserve the staged pipeline. An invented tuple such as `(switch-before-move, command priority, move priority, speed, actor id)` would lose the observed queue construction, repeated reordering, seeded tie shuffle, and phase-tree behavior. No such global tuple is source-proven. [O: `src/phases/turn-start-phase.ts:53-78,255-315,341-402` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/dynamic-queue-manager.ts:31-38,63-82` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/utils/speed-order.ts:21-42` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-tree.ts:64-71,111-129` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## 1. Command construction and initial order

### 1.1 Exact command comparator

[Observed] `TurnStartPhase.getCommandOrder()` builds `orderedTargets` by concatenating the active player battler indices with the active enemy battler indices. It sorts that array with the following exact logic: [O: `src/phases/turn-start-phase.ts:53-78` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

```text
playerField  = getPlayerField(true).map(getBattlerIndex)
enemyField   = getEnemyField(true).map(getBattlerIndex)
ordered      = playerField.concat(enemyField)

compare(a, b):
  if turnCommand[a]?.command != turnCommand[b]?.command:
    if turnCommand[a]?.command == FIGHT: return +1
    if turnCommand[b]?.command == FIGHT: return -1
  aIndex = ordered.indexOf(a)
  bIndex = ordered.indexOf(b)
  if aIndex < bIndex: return -1
  if aIndex > bIndex: return +1
  return 0
```

[Observed] Thus `FIGHT` is after every other command class that reaches this comparator. A `POKEMON` switch command is therefore before a `FIGHT` move command. The comparator does not numerically rank `POKEMON` against other non-`FIGHT` commands; those commands fall through to the original `ordered` field position. [O: `src/phases/turn-start-phase.ts:58-78` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/enums/command.ts:1-14` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] The source comment describes this as command priority and mentions move priority/speed bypasses, but the executable comparator only tests whether either command is `FIGHT`; it does not read move priority or a speed value. The executable code is authoritative for this extraction. [O: `src/phases/turn-start-phase.ts:49-60` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phases/turn-start-phase.ts:61-78` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 1.2 Doubles input order

[Observed] `getPlayerField(true)` and `getEnemyField(true)` select active entries from their respective party/field slices. `getField(true)` places the player field first and then the enemy field, applying the arrangement-dependent enemy offset. In doubles, the relevant capacity/offset path is therefore the active player slots followed by active enemy slots. [O: `src/battle-scene.ts:1021-1026,1048-1053,1066-1077` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] For a normal doubles command-order tie, the fallback order is the index order of that player-first/foe-second `orderedTargets` array. This is only the initial command construction order; later dynamic queues can reorder the resulting phases. [O: `src/battle-scene.ts:1021-1026,1048-1053,1066-1077` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phases/turn-start-phase.ts:53-78` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/dynamic-queue-manager.ts:31-38,63-82` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 1.3 Phase construction

[Observed] During `TurnStartPhase.start()`, the computed `moveOrder` is iterated. A `Command.POKEMON` command creates a `SwitchSummonPhase` through `unshiftNew`; a `Command.FIGHT` command creates a `MovePhase` through `pushNew`. A skipped or absent command is ignored. [O: `src/phases/turn-start-phase.ts:255-315,341-402` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] `unshiftPhase` places a dynamic phase in a dynamic queue marker, while `pushPhase` puts a pushed phase into the phase tree. The phase tree adds unshifted work at a deeper level and pops the deepest level first; entries at one level are shifted FIFO. [O: `src/phase-manager.ts:417-452` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-tree.ts:5-12,64-71,111-129` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] `SwitchSummonPhase` is dynamically eligible: it inherits `PartyMemberPokemonPhase`, whose `getPokemon()` resolves the party member, and `DynamicQueueManager.isDynamicPhase()` accepts phases having `getPokemon()` unless their phase name is in the non-dynamic list. `SwitchSummonPhase` is not in that list. [O: `src/phases/switch-summon-phase.ts:31-52` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phases/party-member-pokemon-phase.ts:5-24` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/dynamic-queue-manager.ts:11-29,63-72,164-166` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] Normal voluntary switches are inserted above the pushed move work, so their switch markers are selected before the move markers. That does not make switches FIFO by command order: the generic dynamic switch queue applies the speed reorder described in Section 2 before each switch phase is popped. This is the exact source-supported meaning of “switch before move” for the ordinary `Command.POKEMON` path. [O: `src/phases/turn-start-phase.ts:283-315,341-402` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-manager.ts:423-452,578-607` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-tree.ts:64-71,111-129` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/dynamic-queue-manager.ts:31-38,63-82,164-166` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 1.4 Explicit switch/move exceptions

[Observed] Pursuit-style interception can defer an ordinary switch. `TurnStartPhase` identifies pursued switchers, omits their normal switch handling, and later calls `queueDeferredSwitches`; those deferred switch phases are queued with `queueDeferred`. [O: `src/phases/turn-start-phase.ts:82-106,191-205,283-322` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] A self-switching move is handled inside move-effect processing rather than as a `Command.POKEMON` command, and the source separately forces/defers relevant pursuers around that move. [O: `src/phases/turn-start-phase.ts:155-189` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Gap] The M3 assignment does not identify whether its selected fixture includes Pursuit/Dreamcatcher-style interception or a self-switching move. Those cases must not be folded into the ordinary voluntary-switch rule without a fixture decision. [O: `src/phases/turn-start-phase.ts:82-106,155-205,283-322` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## 2. Dynamic speed queue and move ordering

### 2.1 Generic speed stage

[Observed] `DynamicQueueManager` documents that dynamic queues sort entries in speed order, and the generic `PokemonPhasePriorityQueue` invokes `sortInSpeedOrder()` on reorder. A priority queue calls `reorder()` before every `pop()`, not only when the phase list is initially built. [O: `src/dynamic-queue-manager.ts:31-38,63-82` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/pokemon-phase-priority-queue.ts:5-9` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/priority-queue.ts:7-16,18-39` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] `sortInSpeedOrder()` first groups consecutive phases belonging to the same Pokémon, then shuffles the groups, then sorts them by effective speed or by `TurnCommandManager.setOrder`, and finally reverses the entire list if the arena has `TRICK_ROOM`. [O: `src/utils/speed-order.ts:13-26,53-107` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] The grouping is consecutive-only: a phase is appended to the current group when its `getPokemon()` equals the current group Pokémon; otherwise a new group is created. The source comment says this preserves consecutive actions by the same Pokémon as one unit. [O: `src/utils/speed-order.ts:13-20,89-107` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 2.2 Effective Speed

[Observed] The speed comparator reads `pokemon.getEffectiveStat(Stat.SPD)`, then sorts descending with `bSpeed - aSpeed`. The effective-stat calculation starts from the current stat, applies the stat-stage multiplier and other held/field/ability modifiers, applies speed-specific modifiers, and returns `Math.max(Math.floor(ret), 1)`. [O: `src/utils/speed-order.ts:74-79` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/field/pokemon.ts:1964-2000,2000-2063,2102-2133` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] Stat stages are clamped to `-6..6`. The stage multiplier uses `max(2, 2 + stage) / max(2, 2 - stage)`, with the source's temporary-modifier and cap handling, before the speed-specific portion. [O: `src/field/pokemon.ts:1877-1900,2059-2063,4875-4942` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] In the speed-specific portion, paralysis halves `ret` with the JavaScript right shift `ret >>= 1` when the Unburden exemption does not apply; the final result is then floored and clamped to at least one. Slow Start and Grass/Water Pledge have neighboring speed operations, and held-item speed multipliers are also applied. [O: `src/field/pokemon.ts:2102-2133` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] Because queues reorder before every pop, effective speed is live at each pop. An earlier action that changes a stage, status, field effect, held-item state, or active eligibility can affect the remaining queue; the Rust contract must not snapshot all effective speeds at command construction unless a selected fixture proves that snapshot is equivalent. [O: `src/queues/priority-queue.ts:18-30` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/field/pokemon.ts:1964-2000,2000-2063,2102-2133` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 2.3 Trick Room and explicit order override

[Observed] `TRICK_ROOM` is an arena tag, and `sortInSpeedOrder()` reverses the already shuffled/speed-sorted group list when the tag is present. The pinned Trick Room test constructs a faster Feebas and slower Magikarp, verifies normal order, then applies Trick Room and verifies the reverse order. [O: `src/enums/arena-tag-type.ts:11-23` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/utils/speed-order.ts:81-86` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `test/tests/moves/trick-room.test.ts:33-53` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] If `TurnCommandManager.setOrder` is present, `sortBySpeed()` uses the battler-index order supplied there instead of effective speed. The shuffle still occurs before that branch. [O: `src/utils/speed-order.ts:21-26,53-71` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/turn-command-manager.ts:3-17` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Gap] The pinned source proves both Trick Room and `setOrder` branches, but it does not identify which one is required by the M3 selected fixture set. Treat Trick Room as an implemented oracle branch, and treat `setOrder` as a fixture/test override, until the fixture manifest explicitly says otherwise. [O: `src/utils/speed-order.ts:53-86` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/turn-command-manager.ts:3-17` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 2.4 Move post-speed comparator

[Observed] `MovePhasePriorityQueue.reorder()` first performs the generic speed reorder, then `sortPostSpeed()` applies this exact descending comparator to the queue:

```text
timing = effectiveTimingModifier(movePhase)
if timing differs: larger timing first

priority = move.getPriority(pokemon, true)
if priority differs: larger priority first

bracket = move.getPriorityModifier(pokemon, true)
if bracket differs: larger bracket modifier first

otherwise: return 0
```

The implementation is `bTiming - aTiming`, then `bPriority - aPriority`, then `getPriorityModifiersForMP(b) - getPriorityModifiersForMP(a)`. [O: `src/queues/move-phase-priority-queue.ts:10-38,99-123` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] Timing values are `LAST = 0`, `NORMAL = 1`, and `FIRST = 2`; an `ER_QUASHED` tag maps timing to `LAST`. Move priority begins with the move's priority and applies priority-changing attributes/abilities. The bracket modifier can force `BYPASS_SPEED` to `FIRST` and otherwise applies bracket attributes, with `ER_DRENCHED` handling in the cited method. [O: `src/enums/move-phase-timing-modifier.ts:4-27` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/move-phase-priority-queue.ts:99-113` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/data/moves/move.ts:1377-1405` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] For a `MovePhase` queue, the strongest source-proven comparison statement is the staged operation:

```text
1. sortInSpeedOrder(queue)
2. stable Array.sort by
   (effectiveTimingModifier DESC,
    move.getPriority(user, true) DESC,
    move.getPriorityModifier(user, true) DESC)
3. pop the first entry
4. repeat from step 1 for the next pop
```

This is not a source-proven single tuple for the whole turn: timing/priority/bracket sorting happens after a speed sort, and the queue is rebuilt before each pop. [O: `src/queues/move-phase-priority-queue.ts:10-38,76-83` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/priority-queue.ts:18-30` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 2.5 Speed-tie RNG and stable final tie behavior

[Observed] Speed ordering does not call a pairwise speed-tie random comparator. It calls `randSeedShuffle(grouped)` inside `executeWithSeedOffset`, using offset `currentBattle.turn * 1000 + pokemonList.length` and `waveSeed`. [O: `src/utils/speed-order.ts:21-42` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] `randSeedShuffle()` is an in-place Fisher-Yates loop: for each `i` from `items.length - 1` down to `1`, it draws `Phaser.Math.RND.integerInRange(0, i)` and swaps `items[i]` with `items[j]`. Therefore a shuffle of `n` Pokémon groups makes `n - 1` bounded RNG draws when `n > 1`; the source exposes no separate “speed tie” RNG call. [O: `src/utils/common.ts:140-155` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] `executeWithSeedOffset()` saves the current RNG state, sows the RNG from the seed override and offset, runs the callback, restores the prior RNG state, and restores the prior seed-offset fields. [O: `src/battle-scene.ts:2931-2953` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] `sortBySpeed()` and `sortPostSpeed()` pass comparators that return `0` when their respective compared values are equal; neither comparator appends battler index, field slot, actor ID, or another explicit final key. The source uses native JavaScript `Array.sort()` on the shuffled groups and on the move queue. [O: `src/utils/speed-order.ts:21-25,57-87` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/move-phase-priority-queue.ts:24-38` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] The stable final tie behavior is: preserve the order supplied to the relevant native `Array.sort()` when its comparator returns `0`. For speed ties, that order is the seeded Fisher-Yates order of Pokémon groups; for equal move timing, move priority, and bracket modifier, that order is the preceding speed-sort result. Consecutive phases for one Pokémon remain grouped before those sorts. There is no oracle-proven stable actor-ID/field-index tie-break to port. [O: `src/utils/speed-order.ts:21-25,57-107` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/move-phase-priority-queue.ts:24-38` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## 3. Actor eligibility and earlier actions

[Observed] `MovePhase.start()` ends immediately if its user is no longer active on the field, before the move is counted as acted or its normal PP/failure/effect pipeline proceeds. `Pokemon.isActive(true)` requires the Pokémon to be allowed in battle and, when `onField` is true, to be on the field. [O: `src/phases/move-phase.ts:123-165,206-218` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/field/pokemon.ts:733-767` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] Paralysis is checked in the move failure sequence. When the status is paralysis, the source uses `Overrides.STATUS_ACTIVATION_OVERRIDE` when present; otherwise it cancels the move when `user.randBattleSeedInt(4) === 0`. [O: `src/phases/move-phase.ts:264-310,535-553` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] A queued actor that was fainted or removed by an earlier phase reaches the queue but cannot execute its move because the start-of-phase active check is evaluated then. A queued move can also fail later because of the live paralysis check; “ordered before” is not equivalent to “successfully performed.” [O: `src/phases/move-phase.ts:123-165,264-310,535-553` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/field/pokemon.ts:733-767` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] For a target that is no longer active, move-effect hit checking returns `TARGET_NOT_ON_FIELD` unless the move is field-targeted, and target application iterates the target list in its supplied order. [O: `src/phases/move-effect-phase.ts:401-442,478-480` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## 4. Faint, simultaneous damage, and replacement ordering

### 4.1 Faint event insertion

[Observed] Direct move damage is applied with `ignoreFaintPhase: true`; after damage, `onFaintTarget()` queues a faint phase for a target that fainted. Other damage paths can queue a faint phase from `damageAndUpdate()` when `ignoreFaintPhase` is false. [O: `src/phases/move-effect-phase.ts:762-780,789-848,936-963` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/field/pokemon.ts:5900-6014` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] `applyToTargets()` processes its target array in `targets.entries()`, so a multi-target effect queues target faint handling in that array iteration order. `queueFaintPhase()` adds each `FaintPhase` with the phase-tree deferred flag. [O: `src/phases/move-effect-phase.ts:401-442,936-951` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-manager.ts:858-860` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] The phase tree places deferred phases at the second-highest level and appends them in insertion order; the tree pops the deepest level and shifts its first entry. [O: `src/phase-tree.ts:52-71,111-129` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] The source-proven first ordering key for simultaneous faint events is causal queue insertion order: move/target iteration and the order in which damage reports a faint. It is not a separately defined “all player faints, then all enemy faints” comparator. Nested child phases can still affect the complete visible sequence, so insertion order alone is not a complete flattened replacement tuple. [O: `src/phases/move-effect-phase.ts:401-442,936-951` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/field/pokemon.ts:5900-6014` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-manager.ts:858-860` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-tree.ts:52-71,111-129` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 4.2 Replacement phase construction

[Observed] `FaintPhase` handles player and enemy replacement differently. On the player side, it pushes `SwitchPhase` when legal bench Pokémon remain; on the enemy side, it unshifts `VictoryPhase`, then for eligible trainer/mystery encounters pushes an automatic `SwitchSummonPhase`. In doubles/triples, enemy reserve eligibility includes the matching trainer-slot condition. [O: `src/phases/faint-phase.ts:237-305` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] A player `SwitchPhase` performs legality checks and may choose the replacement field index; the source includes special handling for double-KO and co-op fixed slots. [O: `src/phases/switch-phase.ts:46-91,93-133` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] Automatic `SwitchSummonPhase` resets the outgoing/incoming field state and performs the summon/party-slot work; it can end cleanly when no valid slot exists. [O: `src/phases/switch-summon-phase.ts:168-228,287-315,328-382` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Derived] Multiple replacement `SwitchSummonPhase` instances, once simultaneously available in a dynamic queue, use the same generic speed-stage ordering and seeded group tie behavior as other dynamic Pokémon phases. The source does not add a replacement-specific side/slot tie-break. [O: `src/phases/switch-summon-phase.ts:31-52` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/dynamic-queue-manager.ts:63-72,164-166` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/pokemon-priority-queue.ts:5-9` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Observed] Turn-end processing has a separate triple-only automatic-shift path and explicitly avoids transposing while legal reserves can refill; this is not a general doubles replacement comparator. [O: `src/phases/turn-end-phase.ts:203-250` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

### 4.3 What is and is not proven for simultaneous replacement

[Gap] The pinned source proves phase insertion and the generic dynamic queue, but it does not expose one global comparator for a mixed simultaneous double KO involving player choice, enemy automatic replacement, victory/game-over children, and nested phase-tree levels. Exact end-to-end ordering must be captured from a named fixture/replay; do not infer it from battler index or side. [O: `src/phases/faint-phase.ts:237-305` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phases/switch-phase.ts:93-133` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-manager.ts:423-452,578-607` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-tree.ts:52-71,111-129` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Gap] The pinned source contains a dedicated double-KO replacement test path, but this extraction does not establish a required M3 fixture identifier or an expected stable order for every replacement when both sides faint. The existence of that path is not evidence for an unobserved tie-break. [O: `test/tests/elite-redux/er-doubles-double-ko-replacement.test.ts:10-24,76-129` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## 5. Explicit comparison statements

The following are the only comparison statements this source supports without adding an invented key:

1. **Initial command order:** `orderedTargets = activePlayerBattlerIndices ++ activeEnemyBattlerIndices`; `FIGHT` loses to any non-`FIGHT` command; equal command class falls back to `orderedTargets.indexOf()` ascending. [O: `src/phases/turn-start-phase.ts:53-78` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
2. **Generic switch/dynamic speed order:** group consecutive phases by Pokémon; seeded Fisher-Yates shuffle groups; then effective Speed descending, or `setOrder` if supplied; then reverse the complete list under Trick Room. [O: `src/utils/speed-order.ts:21-107` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
3. **Move post-speed order:** after the generic speed stage, compare `(effective timing modifier DESC, move priority DESC, bracket priority modifier DESC)`; equal values return `0`. [O: `src/queues/move-phase-priority-queue.ts:10-38,99-123` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
4. **Final equal-key behavior:** preserve the prior array order through the oracle runtime's native `Array.sort()`; the prior order is the seeded group order for speed ties and the prior speed order for equal move post-speed keys. No actor-ID/field-slot final key is observed. [O: `src/utils/speed-order.ts:21-25,57-87` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/move-phase-priority-queue.ts:24-38` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

[Gap] There is no source-proven flattened tuple spanning command class, switch-vs-move phase-tree depth, effective speed, move priority, RNG outcome, actor eligibility, and replacement queue state. [O: `src/phases/turn-start-phase.ts:53-78,255-315,341-402` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/dynamic-queue-manager.ts:31-38,63-82` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/queues/move-phase-priority-queue.ts:10-38,76-83` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phases/move-phase.ts:123-165` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phases/faint-phase.ts:237-305` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## 6. Proposed M3 contract decisions

These are proposed decisions for the downstream Rust contract, not claims that the TypeScript source has a single corresponding record:

- Preserve the staged model as separate observable checkpoints: command construction, phase-tree insertion, dynamic queue reorder/pop, move post-speed reorder/pop, and faint/replacement queue insertion.
- Encode the exact command comparator and the exact move post-speed comparator above. Do not use the numeric `Command` enum ordering as a substitute for the executable `FIGHT`/non-`FIGHT` branch. [O: `src/phases/turn-start-phase.ts:58-78` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/enums/command.ts:1-14` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
- Recompute effective Speed before every dynamic-queue pop, preserving JavaScript operation order for stages, paralysis, flooring, and the minimum-one clamp. [O: `src/queues/priority-queue.ts:18-30` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/field/pokemon.ts:2059-2063,2102-2133` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
- Model speed ties as the exact seeded Fisher-Yates group shuffle with offset `turn * 1000 + group count`, followed by native stable-sort preservation. Do not add a random pairwise tie roll or a final actor ID. [O: `src/utils/speed-order.ts:21-42` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/utils/common.ts:140-155` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/battle-scene.ts:2931-2953` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
- Apply the active-actor guard when a move phase starts, and keep target-inactive behavior separate from actor ordering. [O: `src/phases/move-phase.ts:123-165` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phases/move-effect-phase.ts:401-442,478-480` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
- Preserve faint insertion order and phase-tree nesting for simultaneous outcomes. Require a named fixture for any claim about mixed-side replacement order; otherwise expose the result as unresolved rather than inventing a side/slot tie-break. [O: `src/phases/move-effect-phase.ts:401-442,936-951` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phase-tree.ts:52-71,111-129` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]
- Before freezing M3 fixtures, explicitly classify whether each selected case uses ordinary switches, Pursuit/self-switch deferral, Trick Room, `setOrder`, paralysis/stage changes before a later pop, or double-KO replacement. [O: `src/phases/turn-start-phase.ts:82-106,155-205,283-322` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/utils/speed-order.ts:53-86` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; O: `src/phases/faint-phase.ts:237-305` @ `3b534099919efae827019d4a3f3c4ab0ecd6d67b`]

## Unresolved gaps summary

- M3 fixture IDs/expected outputs for Trick Room, `setOrder`, Pursuit/self-switch deferral, and mixed-side simultaneous replacement are not specified by this extraction.
- No explicit actor-ID, field-slot, side, or battler-index final tie-break exists in the cited comparators.
- Full nested phase-tree ordering for a mixed simultaneous KO remains fixture-dependent; only causal insertion and the generic dynamic queue are source-proven.
