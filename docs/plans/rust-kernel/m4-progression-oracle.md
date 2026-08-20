# M4 Participation and EXP Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

Read-only M4-00 oracle extraction at TypeScript oracle SHA `45c89493e7edec9c4da247a98cd7858b1f015c09`. Participation is a battle-lifetime `Set` of runtime `PlayerPokemon.id` values, accumulated at TurnInit and pruned only when a player faint finishes. Each enemy FaintPhase appends an ordered live-object faint record before status/field teardown, then queues one VictoryPhase; that Victory computes one EXP award from that defeated enemy. The deterministic EXP rail is fully traceable through trainer/mystery scaling, participant/share multipliers, Pokerus/override, held/global boosters, ability multiplier, floors, and cap clamping. BattleEnd runs only after the immediate EXP/level chain, snapshots battle-end money ability state, invokes post-battle callbacks, collects scattered money, resets scatter to zero, and then seals the authoritative co-op state. Exact no-callback fixtures are provided below for species IDs 10/25 and move ID 6.

## Source evidence

### `src/battle.ts`

`Battle.playerParticipantIds`, `enemyFaints`, `playerFaintsHistory`, `enemyFaintsHistory`, `addParticipant`, `removeFaintedParticipant`, `moneyScattered`, `pickUpScatteredMoney`; runtime-ID identity and money pickup mutation order.

### `src/phases/turn-init-phase.ts`

`TurnInitPhase.start` records every active player field Pokémon as a participant before commands (`223-227`).

### `src/phases/faint-phase.ts`

`FaintPhase.start` participant safeguard and instant-revive early return (`64-110`); `doFaint` ordered faint counters/history, abilities, Victory enqueue, status/field teardown, participant removal, enemy score and loot (`119-374`).

### `src/phases/victory-phase.ts`

`VictoryPhase.start` increments defeated statistics, makes the host/solo per-enemy `getExpValue`/`applyPartyExp` call, skips authoritative-guest computation, detects wave victory, and pushes BattleEnd (`78-200`).

### `src/battle-scene.ts`

`getMaxExpLevel` (`3209-3219`), `getWaveMoneyAmount` (`3772-3782`), modifier iteration (`4374-4431`), and complete `applyPartyExp` recipient/multiplier/rounding/phase-enqueue algorithm (`4721-4843`).

### `src/field/pokemon.ts`

`PlayerPokemon.addExp` cap loop and excess clamp (`4756-4772`), enemy `getExpValue` (`7540-7543`), and friendship/candy side effects (`8367-8408`).

### `src/phases/exp-phase.ts`

Active-recipient phase: global EXP boosters, ability meta multiplier, final floor, UI callback, `addExp`, LevelUp enqueue.

### `src/phases/show-party-exp-bar-phase.ts`

Bench-recipient equivalent: same booster/ability/floor arithmetic, synchronous `addExp`, LevelUp and hide-bar enqueue.

### `src/phases/party-exp-phase.ts`

One-off Mystery Encounter EXP entry point; calls `applyPartyExp(..., pokemonDefeated=false)` with an optional explicit participant set.

### `src/modifier/modifier.ts`

Exact `MultipleParticipantExpBonusModifier`, `ExpBoosterModifier`, `PokemonExpBoosterModifier`, `ExpShareModifier`, `ExpBalanceModifier`, and `MoneyMultiplierModifier` formulas/stack limits (`3043-3233`, `3528-3550`).

### `src/data/elite-redux/archetypes/ability-meta-consumers.ts`

Recipient-local EXP ability multiplier product and active-field battle-end money multiplier snapshot (`90-139`).

### `src/phases/battle-end-phase.ts`

Post-battle causal settlement, guest authority gates, local statistics, score/streak/item callbacks, money pickup, modifier lapse, enemy teardown and authoritative capture (`172-367`).

### `src/data/elite-redux/coop/coop-transport.ts`

`CoopAuthoritativeBattleStateV1` settled observable schema: ordered party PokemonData, field seats/runtime IDs, money, score, balls, modifiers and ER progression fields (`984-1053`).

### `src/data/elite-redux/coop/coop-runtime.ts`

`broadcastCoopWaveEndState`: host-only authoritative WAVE_ADVANCE state capture/seal and failure behavior (`10922-10985`).

### `src/data/moves/move.ts`

`MoneyAttr`: first-hit-only scatter mutation; registrations on Pay Day, Celebrate and Make It Rain (`10472-10480`, `11056-11058`, `13214-13218`, `14257-14260`).

### `src/data/abilities/ab-attrs.ts`

PostBattle ability callback surface: Pickup seeded loot selection and Honey Gather money scatter (`6042-6069`, `6662-6671`).

### `src/utils/common.ts`

`randSeedItem`: zero draw for a singleton, otherwise `Phaser.Math.RND.pick` (`140-142`).

### `src/data/exp.ts`

Growth-rate total-EXP tables/formulas; Medium Fast levels 5/6/9/10 are 125/216/729/1000 (`1-103`).

### `src/data/balance/pokemon-species.ts`

Concrete content: Caterpie species ID 10 has base EXP 39 and Medium Fast growth; Pikachu species ID 25 has base EXP 112 and Medium Fast growth (`34`, `58-60`).

### `src/enums/species-id.ts`

Sequential numeric species IDs establish Caterpie=10 and Pikachu=25 (`1-52`).

### `src/enums/move-id.ts`

Sequential move IDs from NONE=0 establish Pay Day=6 (`1-18`).

### `src/enums/battle-type.ts`

Concrete battle type IDs: WILD=0, TRAINER=1, CLEAR=2, MYSTERY_ENCOUNTER=3.

## Architecture and contract guidance

## Observed TypeScript contract

### 1. Participation identity and lifetime

- `Battle.playerParticipantIds` is initialized as an empty `Set<number>` for every new `Battle` (`battle.ts:88`). Its elements are **runtime Pokémon IDs**, not species IDs, party indices, battler indices, player-seat IDs, or owner IDs. `addParticipant` inserts `playerPokemon.id`; `removeFaintedParticipant` deletes the same (`battle.ts:301-306`). Set insertion is idempotent.
- At each `TurnInitPhase`, the field is iterated in canonical field-array order. Every `pokemon?.isActive()` player actor is inserted before its `CommandPhase` is pushed (`turn-init-phase.ts:223-240`). Therefore a switched-in Pokémon begins participating when it survives to a TurnInit; the set otherwise persists across enemy replacements for the whole Battle.
- `FaintPhase.start` has a safeguard before `doFaint`: every player-field Pokémon for which `isActive() || isFainted()` is true is inserted (`faint-phase.ts:95-105`). This also makes a just-switched/just-fainted field occupant visible to the battle ledger before faint processing.
- Instant revive is a hard early return before that safeguard and before all faint records (`faint-phase.ts:79-92`): it consumes the revive item, updates modifiers, ends the phase, and produces no defeated/participation/faint settlement from that FaintPhase.
- A player participant is deleted only in the faint-cry tween completion, after `doSetStatus(FAINT)` and before `leaveField`/phase end (`faint-phase.ts:334-359`). Thus fainted party members normally do not remain EXP participants when a later VictoryPhase executes. The Set's denominator is not independently sanitized by `applyPartyExp`.
- Exact recipient membership is `participantIds.has(partyMember.id)`. Let `N = participantIds.size`; **N includes stale, missing, fainted, capped, or non-party IDs if supplied**, even though only living below-cap party members can receive EXP. Empty `N=0` silently skips the entire EXP block, including friendship/Macho Brace effects and phase enqueue (`battle-scene.ts:4749-4843`).

### 2. Defeated-enemy records and causal order

For a non-revived enemy faint, `FaintPhase.doFaint` performs this observed order:

1. Capture protocol identity at phase start as `{ wave: currentBattle.waveIndex, turn: currentBattle.turn, occurrence: consumeCoopRecordedFaintOccurrence(battlerIndex) ?? 0 }` (`faint-phase.ts:66-75`). This address is used by delayed replacement protocol work; it is not the EXP recipient identity.
2. Run Heartbreak, then increment `currentBattle.enemyFaints`, record achievement state, apply Momentum Engine, and append `{ pokemon, turn: currentBattle.turn }` to `enemyFaintsHistory` (`faint-phase.ts:119-176`). The entry stores the **live Pokémon object reference**, not an immutable data snapshot.
3. Queue faint narration/form/tera/PostFaint/PostKnockOut/PostVictory effects (`177-248`). These callback rails may mutate unrelated state before settlement.
4. For an enemy, immediately `unshiftNew("VictoryPhase", battlerIndex)`, then optionally push its trainer replacement (`faint-phase.ts:278-320`).
5. Only in the asynchronous faint animation completion: lapse FAINT tags, set status FAINT, add enemy score, apply Wasteland drop, move transferable items into `postBattleLoot`, leave the field, and end FaintPhase (`331-374`). Victory cannot start until this FaintPhase ends.
6. The queued Victory increments `gameStats.pokemonDefeated` once per enemy unless this is a Mystery Encounter whose mechanics/type suppresses the statistic, then computes EXP for exactly `this.getPokemon()` (`victory-phase.ts:78-125`). On a multi-enemy battle, each executed enemy FaintPhase therefore creates one history append and one per-enemy EXP computation.

`enemyFaintsHistory` ordering is exactly FaintPhase `doFaint` execution order. The code does not sort by turn, speed, battler slot, runtime ID, or species ID. Exact simultaneous-double-KO ordering depends on the upstream dynamic phase queue and is deliberately **not selected** without an explicit phase script. A single-enemy fixture avoids this ambiguity. `gameStats.pokemonDefeated` is per defeated mon/Victory; `gameStats.trainersDefeated` is once per victorious trainer BattleEnd (`battle-end-phase.ts:333-345`).

### 3. EXP recipient calculation and rounding

`EnemyPokemon.getExpValue()` returns the JavaScript number

`raw = speciesForm.baseExp * enemy.level / 5 + 1`

with no floor (`field/pokemon.ts:7540-7543`). `VictoryPhase` passes it to `applyPartyExp(raw, true)` on solo/host.

Inside `applyPartyExp`, exact order is:

1. Snapshot party and locate the first Exp Share, Exp Balance, and multi-participant bonus modifiers. Build `living = party.filter(p => p.hp)` using JS truthiness, then `eligible = living.filter(p => p.level < getMaxExpLevel())`, preserving party order (`battle-scene.ts:4735-4743`).
2. Optional one-off ME wave scaling first: `expValue = floor(expValue * waveIndex / 5 + 1)` (`4744-4747`). Normal Victory does not request it.
3. If `N>0`, battle scaling next: TRAINER (or ME trainer mode) uses `floor(expValue * 1.5)`; otherwise a battle ME uses `floor(expValue * encounter.expMultiplier)` (`4749-4757`). Wild battles do neither.
4. Iterate all living party members in party order. If the runtime ID participated and `pokemonDefeated=true`, call `addFriendship(3)` and increment the first held `PokemonIncrementingStatModifier` stack if below its cap, update modifiers, then update the Pokémon info (`4758-4771`; constant at `starters.ts:11`). **These mutations precede the level-cap eligibility check**, so a living participant already at cap gets friendship/Macho Brace but no EXP phase. `addFriendship` itself applies a friendship-booster callback, caps the field at 255, mutates account candy/ribbons/achievements, and consults timed-event/fusion rules (`pokemon.ts:8367-8408`); those account callbacks are outside the pure Rust subset.
5. Skip non-eligible living members. For each eligible member:
   - participating: `m = 1/N`; if `N>1` and multi-participant bonus exists, add `0.2 * bonusStacks` (the bonus is additive per recipient and is **not divided by N**);
   - nonparticipating with Exp Share: `m = 0.2 * shareStacks / N`;
   - nonparticipating without Exp Share: exact award 0;
   - if Pokerus, multiply `m *= 1.5`;
   - if `XP_MULTIPLIER_OVERRIDE !== null`, replace the entire accumulated `m` with the override value;
   - start `NumberHolder(expValue * m)`, apply every matching `PokemonExpBoosterModifier` in player-modifier array order, then push `floor(holder.value)` (`4773-4795`). Each held booster itself performs `floor(current * (1 + stacks*boostPercent/100))` (`modifier.ts:3143-3189`), so intermediate floors are observable.
6. Optional Exp Balance runs after those integer awards. It sums eligible levels and awards; its variable `medianLevel` is actually `floor(sum(levels)/eligible.length)`. Recipients are members at or below that value. `splitExp=floor(totalExp/recipientCount)`. Each eligible award is replaced with `Phaser.Math.Linear(old, recipient?splitExp:0, 0.2*balanceStacks)` (`battle-scene.ts:4797-4824`). There is no floor here.
7. For every nonzero award in eligible/party order, enqueue an active `ExpPhase` or bench `ShowPartyExpBarPhase` (`4826-4843`). `PhaseManager.unshiftPhase` explicitly preserves FIFO for multiple phases created during one phase (`phase-manager.ts:423-440`), so recipient mutation order is eligible party order.
8. Both recipient phases then apply every global `ExpBoosterModifier` in modifier-array order; each booster floors its own multiplication. Next multiply by the product of eligible recipient-local `experience-gain-multiplier` ability attributes, then perform the final `floor` (`exp-phase.ts:21-26`; `show-party-exp-bar-phase.ts:20-26`; `ability-meta-consumers.ts:90-96`).
9. Active recipients mutate only inside the `ui.showText` callback; bench recipients call `addExp` synchronously at phase start. Each records old/new level and unshifts LevelUp when increased. Rendering delay changes timing only, not arithmetic.
10. `addExp` first adds the integer award, increments levels while `level < cap` and thresholds are met, then if the resulting level reached the cap clamps EXP to `max(totalExpAtCurrentCapLevel, initialExp)` (`pokemon.ts:4761-4771`). Consequently excess from the awarding call is discarded at the cap, but pre-existing above-threshold EXP is never reduced. A Pokémon already at cap never reaches a recipient phase because step 1 excludes it.

Cap selection is: positive `LEVEL_CAP_OVERRIDE`; otherwise unlimited for `ignoreLevelCap` or negative override; otherwise `gameMode.getMaxExpLevelForWave(current wave or 1)` (`battle-scene.ts:3209-3219`). Normal EXP passes `ignoreLevelCap=false`.

### 4. Money scatter and pickup

- `MoneyAttr` is `firstHitOnly` and on each successful application adds `getWaveMoneyAmount(0.2)` and queues the scatter message (`moves/move.ts:10472-10480`). It is registered on Pay Day (numeric MoveId 6), Celebrate, and Make It Rain. Honey Gather's victorious `PostBattleAbAttr` adds the same wave amount during BattleEnd (`ab-attrs.ts:6662-6671`).
- `getWaveMoneyAmount(x)` computes `moneyValue = ((waveSet+1 + (0.75 + inSetWave/10))*100)^(1+0.005*waveSet) * x`, multiplies by `(1 + teamMoneyStreakPercent/100)`, then rounds **down to a multiple of 10** via `floor(value/10)*10` (`battle-scene.ts:3772-3782`). There is no RNG.
- At BattleEnd, the Good-as-Gold-style field multiplier is captured **before** post-battle abilities, using only non-fainted active player field holders and multiplying all eligible money meta attributes (`battle-end-phase.ts:213`; `ability-meta-consumers.ts:98-132`).
- PostBattle ability callbacks run next over `getPokemonAllowedInBattle()` in party order and can add Honey Gather scatter or consume seeded Pickup loot (`battle-end-phase.ts:235-237`). Then, if scatter is nonzero, pickup executes (`242-244`).
- Pickup arithmetic order is: start at aggregate `moneyScattered`; apply each `MoneyMultiplierModifier` in modifier-array order (`value += floor(value*0.2*stacks)`); if Happy Hour arena tag exists multiply by 2; multiply by captured battle-end money ability multiplier (or 1 if not captured) and floor; call `addMoney`; queue the locale-formatted message; set `currentBattle.moneyScattered=0` (`battle.ts:325-344`, `modifier.ts:3528-3550`).
- `addMoney` can then apply the ER Coin Purse positive-gain bonus and floors that multiplication, clamps total money at `Number.MAX_SAFE_INTEGER`, updates UI and achievements (`battle-scene.ts:3757-3770`). Thus Coin Purse is later than all pickup multipliers. Locale affects only the message, never the numeric state.
- Zero scatter skips pickup entirely. There is no message/callback and the already-zero field remains zero.

### 5. Post-battle phase/ownership settlement

- A final Victory pushes `BattleEndPhase(true)` after it has unshifted recipient EXP phases. Immediate EXP/LevelUp children drain before the pushed BattleEnd; the production comment states the host capture occurs after EXP/level/evolution/move-learning settlement (`battle-end-phase.ts:348-356`).
- BattleEnd first ORs victory across duplicate queued BattleEnds and removes duplicates. Retained authoritative guests may park and apply the immutable WAVE_ADVANCE image instead of executing shared mutations (`battle-end-phase.ts:172-211`). A missing retained runtime binding fail-closes the shared session; invalid retained Victory source turn throws in `VictoryPhase` constructor, and a lost retained transition fail-closes (`victory-phase.ts:57-80`).
- Normal host/solo order after legacy guest progression adoption: snapshot money ability multiplier; increment local `battles`/endless high-water/once-per-trainer `trainersDefeated`; on victory add battle score and advance money streak/ward/community/tactical charges; run PostBattle abilities; recover balls on non-authoritative-guest; collect scatter; clear enemy held modifiers; lapse/remove lapsing modifiers; update modifiers; capture/broadcast settled state; destroy enemy presentation (`battle-end-phase.ts:213-296`).
- Co-op EXP owner rule is explicit: authoritative **host** alone computes each per-enemy EXP award; authoritative **guest** skips `applyPartyExp` and later adopts the host's full settled party state at its BattleEnd (`victory-phase.ts:97-125`, `battle-end-phase.ts:348-368`). Host settlement is one ordered WAVE_ADVANCE capture keyed to source wave/turn/operation ledger; `broadcastCoopWaveEndState` is hard host-only and fail-closes when a retained transition/state cannot be captured (`coop-runtime.ts:10922-10985`).
- The settled co-op observable image includes `version,tick,wave,turn,double`, ordered full `playerParty`/`enemyParty` PokemonData, field seats with runtime `pokemonId` and owner seat, weather/terrain/tags, `money`, optional `score`, balls, full player/enemy modifiers, biome/seed/waveSeed, money streaks, relic and map state (`coop-transport.ts:1003-1053`). Party PokemonData is the source for settled species/form, level, EXP, moves and ownership. `playerParticipantIds`, faint histories, `enemyFaints`, and `moneyScattered` are not fields of that settled schema; they are battle-local oracle observations whose **effects**, not ledgers, cross the wave boundary.

### 6. Exact selected M4 fixtures (proposed Rust-supported subset)

All fixtures explicitly use: solo/host computation; one enemy faint; no ME/final boss/instant revive; valid unique runtime IDs; cap=10; no XP override, Pokerus, Exp Balance, held/global EXP boosters, EXP meta abilities, friendship booster, timed friendship boost, fusion, post-battle abilities/loot, money/relic modifiers, streak bonus, or Happy Hour unless stated. This separates observed TypeScript behavior from the proposed bounded Rust contract.

1. **Wild one participant/nonparticipant** — BattleType WILD=0, wave 1. Party in order: runtime 1001 Caterpie species 10, level 5, EXP 125, HP>0, active; runtime 1002 Pikachu species 25, level 5, EXP 125, HP>0, bench. `participantIds={1001}`. Defeated runtime 2001 Caterpie species 10, level 5, baseExp 39, turn 3. Raw EXP=`39*5/5+1=40`; participant award=40; nonparticipant award=0. After recipient callback: 1001 EXP=165, level=5; 1002 EXP=125, level=5. Before EXP phase, 1001 friendship increases by exactly 3 (subject fixture precondition `<253`); 1002 does not. Records: `enemyFaints=1`, `enemyFaintsHistory=[{pokemon: runtime2001 live object,turn:3}]`, `gameStats.pokemonDefeated +=1`.
2. **Wild two participants, no multi bonus** — same content/levels, `participantIds={1001,1002}`. `N=2`; each award=`floor(40*0.5)=20`; both EXP become 145 and both gain base friendship 3. This pins division by the full runtime-ID Set size.
3. **Exp Share nonparticipant** — fixture 1 plus one `ExpShareModifier` stack and no other EXP modifier. 1001 gets 40. 1002 gets `floor(40*(0.2/1))=8`, ending EXP 133. Only 1001 receives battle friendship. This is selected deterministic modifier behavior, not a callback.
4. **Multi-participant bonus order** — fixture 2 plus one `MultipleParticipantExpBonusModifier` stack. Each multiplier is `1/2 + 0.2 = 0.7`; each award is `floor(40*0.7)=28`, ending EXP 153. It is intentionally not `40*(1.2)/2=24`.
5. **Trainer fractional/base rounding** — BattleType TRAINER=1; one participant runtime 1001 at Caterpie level 5/EXP125; defeated Caterpie species 10 at level 6. Raw=`39*6/5+1=47.8`; trainer scaling first gives `floor(47.8*1.5)=71`; final award=71; settled recipient EXP=196, level=5. A two-participant variant without bonus gives `floor(71/2)=35` each, demonstrating the trainer floor precedes splitting.
6. **Cap-crossing discard** — WILD defeated level-5 Caterpie gives 40 to runtime 1001 Caterpie level 9, initial EXP 990, cap 10. Temporary EXP=1030 reaches level 10, then clamps to Medium Fast total EXP at level 10=`1000`; settled result is level 10/EXP1000, an effective numeric delta of only 10 although the displayed/phase award is 40. A living participant already level 10 is excluded from EXP entirely but still gets the pre-cap friendship/Macho side effect.
7. **Money scatter at wave 10** — zero streak; starting money=1000; `moneyScattered=0`; Pay Day numeric MoveId 6 applies once. Wave unit is 275, `0.2*275=55`, rounded down to tens => scatter 50. With no pickup modifiers/abilities/tags/relic, BattleEnd settles money=1050 and `moneyScattered=0`. Selected path consumes zero RNG draws.

### 7. RNG and explicit gaps/unsupported callbacks

- Participation insertion/deletion, faint counters/history, base EXP, recipient arithmetic, level thresholds/cap, MoneyAttr, wave-money formula, and simple pickup use **no RNG**. Selected fixtures consume exactly zero seeded and zero unseeded draws.
- PostBattle Pickup is outside the selected subset: `PostBattleLootAbAttr.canApply` calls `randSeedItem(postBattleLoot)` before transfer validation. `randSeedItem` consumes **zero** draws for length 1 and otherwise calls `Phaser.Math.RND.pick` once; successful apply removes the chosen item. Exact ordering across multiple post-battle ability sources depends on `applyAbAttrs` source/attribute traversal and is a stop condition for this oracle section.
- Deferred/unsupported callback rails: Mystery Encounter `expMultiplier`, `doEncounterExp`, and victory continuation; `XP_MULTIPLIER_OVERRIDE`; friendship booster/account candy/ribbon/achievement/timed-event/fusion callbacks; arbitrary modifier `shouldApply/apply` inventories beyond the explicitly stated simple stacks; EXP/money meta-ability condition callbacks; PostFaint/PostKnockOut/PostVictory/PostBattle ability mutations; Wasteland drop/loot transfer; score IV/boss/item multipliers; streak/relic/community/tactical advances; UI timing/messages; level-up move/evolution decisions; simultaneous player+enemy or multiple-enemy faint queue ordering; retained ME settlement.
- Failure/edge behavior that should be preserved if later admitted: empty participant Set is a silent no-op; unknown/stale IDs still dilute `N`; a missing field Pokémon behind `PokemonPhase.getPokemon()` is asserted with non-null and may throw downstream rather than being ignored; lost/invalid retained co-op identity fail-closes; zero scatter skips pickup. No Rust fixture should invent fallback recipients, filter the denominator, reorder histories, pre-floor raw wild EXP, preserve cap overflow, or let the authoritative guest recompute EXP.
