# M4 Reward Generation Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

M4 reward oracle extraction completed read-only against the assigned `pokerogue-redux-rust-kernel-m4` worktree. The regular non-x0 reward surface is `SelectModifierPhase`; it normally presents 3 free choices, resets the wave-seeded Phaser RNG only on the initial phase, rolls tier/luck/weighted candidate in a strict order, continues the same RNG stream across rerolls, and optionally retains the previous presented tiers. Reroll, lock, skip, free-choice, direct fixed reward, party-target, co-op owner, and operation-address behavior are all grounded below. Critical oracle gap: production TypeScript modifier identities are strings (`POKEBALL`, `RARE_CANDY`, etc.), not numeric modifier IDs. Numeric `ModifierTier`, `PokeballType`, and `PartyOption` values are observed; any Rust numeric modifier-ID assignment must be explicitly labeled migration-owned rather than oracle-derived.

## Source evidence

### `src/phases/victory-phase.ts`

Regular scheduling: non-x0 victories enqueue `SelectModifierPhase`; x0 waves enqueue fixed `ModifierRewardPhase` rewards and the biome market (`#L234-L325`).

### `src/phases/select-modifier-phase.ts`

Primary reward oracle: phase entry and generation (`#L439-L619`), free/skip/reroll (`#L636-L829`), lock (`#L930-L960`), apply/target order (`#L1062-L1345`), option count and costs (`#L1357-L1498`), party modifier construction (`#L1524-L1605`), option authority/adoption (`#L190-L250`, `#L2077-L2170`), and reward wire payloads (`#L2444-L2482`).

### `src/modifier/modifier-type.ts`

Stable string IDs and constructors (`#L159-L332`, `#L2175-L2200`, `#L2252-L2261`), filtering/threshold construction (`#L2969-L3050`), option generation/duplicate retry (`#L3115-L3238`), tier/luck/weight RNG (`#L3490-L3615`), and numeric tier metadata/luck odds (`#L3628-L3733`).

### `src/modifier/init-modifier-pools.ts`

Ordered player candidate declarations and weights: Common (`#L68-L142`), Great (`#L148-L365`), Ultra (`#L373-L681`), Rogue (`#L689-L745`), Master (`#L752-L793`); pool initialization order and callback helpers (`#L933-L1005`).

### `src/utils/common.ts`

Seeded integer primitive and inclusive range contract (`#L95-L115`) plus run-seed character shifting (`#L32-L44`).

### `src/battle-scene.ts`

Wave reward stream reset/sow and temporary offset behavior (`#L2931-L2954`); modifier application pipeline and return behavior (`#L3783-L3894`).

### `src/battle.ts`

Independent current-battle RNG stream used by Scrap Magnet, preserving/restoring the global RNG state (`#L608-L634`).

### `src/modifier/modifier.ts`

Ball reward mutation/cap (`#L305-L329`), party-target identity predicate (`#L2089-L2114`), Rare Candy mutation order (`#L2827-L2869`), and extra-option count modifiers (`#L4029-L4085`).

### `src/ui/handlers/modifier-select-ui-handler.ts`

Reward UI validity and lock availability (`#L270-L305`), input/skip dispatch (`#L500-L650`), and reroll/lock cost presentation (`#L789-L809`).

### `src/ui/handlers/party-ui-handler.ts`

Numeric party sub-option IDs (`#L185-L225`), target filter callback behavior (`#L887-L895`, `#L955-L976`), and modifier-mode options (`#L1761-L1839`).

### `src/data/elite-redux/coop/coop-reward-operation.ts`

Reward action-slot identity (`#L176-L239`), per-stream ordinal mutation (`#L690-L700`), owner intent IDs (`#L775-L829`), and presentation ownership/IDs (`#L1225-L1290`).

### `src/data/elite-redux/coop/coop-reward-options.ts`

Exact streamed option identity `{id,tier,upgradeCount,cost,pregenArgs?}` and all-or-nothing reconstruction (`#L34-L124`).

### `src/data/elite-redux/coop/coop-session.ts`

Interaction owner rule: two-player even pin -> seat 0/host, odd pin -> seat 1/guest (`#L232-L245`).

### `src/data/elite-redux/coop/coop-operation-envelope.ts`

Exact operation ID text `${epoch}:${owner}:${kind}:${pinnedSeq}` (`#L590-L620`).

### `src/data/elite-redux/er-relics.ts`

Scrap Magnet separate RNG/caching and Merchant's Seal slot/cost effects (`#L336-L361`, `#L699-L717`, `#L1112-L1129`).

### `src/data/elite-redux/er-balance-knobs.ts`

Exact HEAD default reroll parameters: base 250 and locked tier values `[50,125,300,750,2000]` (`#L265-L289`).

### `src/enums/modifier-tier.ts`

Observed numeric tier IDs: Common 0, Great 1, Ultra 2, Rogue 3, Master 4, Luxury 5.

### `src/enums/pokeball.ts`

Observed numeric ball content IDs: Poké 0, Great 1, Ultra 2, Rogue 3, Master 4, Luxury 5.

### `src/data/pokeball.ts`

Per-ball count cap is 99 (`#L7`).

## Architecture and contract guidance

## 1. Observed regular-reward entry and option count

`VictoryPhase` enqueues `SelectModifierPhase(undefined, undefined, waveModifierRewardSettings, false, {kind:"wave-boundary"})` only when `waveIndex % 10 !== 0` (`victory-phase.ts#L314-L323`). Thus wave 9 is a regular selectable reward; wave 10 is not—it uses direct fixed rewards plus the biome market.

`SelectModifierPhase.getModifierCount` starts at 3, then mutates the count in this exact order (`select-modifier-phase.ts#L1357-L1399`):
1. apply every `ExtraModifierModifier` stack (`+stackCount`, max stack 3; `modifier.ts#L4029-L4050`);
2. apply every `TempExtraModifierModifier` stack (`+stackCount`; `modifier.ts#L4057-L4085`);
3. on a trainer battle only, add cached Scrap Magnet result 0/1;
4. add Merchant's Seal stacks × 1;
5. add current biome `extraRewardSlots` (or 0);
6. compute `earnedExtraRewards = max(0,count-3)`;
7. with custom settings, `newItemCount` is the sum of guaranteed tier/option/function array lengths. If `fillRemaining`, final count is `max(currentCount,newItemCount)`; otherwise it is `newItemCount + earnedExtraRewards`.

`getPlayerModifierTypeOptions` then fills until exactly `count`, including in the custom-settings branch even when `fillRemaining` is false (`modifier-type.ts#L3115-L3194`). Therefore `fillRemaining` changes count selection, not the final fill loop once count is known. Clean regular fixture precondition—no Extra/TempExtra, no Merchant's Seal, no Scrap Magnet, and biome extra 0—gives exactly 3 options.

Scrap Magnet is a separate RNG domain: if held and the wave differs from its cache, `currentBattle.randSeedInt(100) < 25`; the Boolean is cached by wave so rerolls/copies reuse it (`er-relics.ts#L699-L717`). `Battle.randSeedInt` restores the battle's saved RNG state, draws, saves it, then restores global RNG (`battle.ts#L616-L634`). It does not advance the regular reward stream.

## 2. Observed regular-reward RNG source, domains, ranges, and draw order

### Primitive and seed

`randSeedInt(range,min=0)` returns `min` without a draw when `range <= 1`; otherwise it calls `Phaser.Math.RND.integerInRange(min,min+range-1)`, inclusive (`common.ts#L95-L105`). TypeScript performs no explicit floor/round in this wrapper. Initial non-copy/non-reroll reward start calls `resetSeed()`, deriving `waveSeed = shiftCharCodes(runSeed,wave)` and `Phaser.Math.RND.sow([waveSeed])` (`select-modifier-phase.ts#L466-L475`; `battle-scene.ts#L2931-L2937`). `shiftCharCodes` adds the wave to every UTF-16 code unit and rebuilds via `String.fromCharCode` (`common.ts#L32-L44`).

Reroll phases do **not** reset/sow: on `rerollCount > 0`, start only clears `globalScene.reroll`; the new pool therefore continues the prior reward RNG cursor (`select-modifier-phase.ts#L466-L475`). Continuation copies neither reset the seed nor regenerate thresholds.

### Strict initial-start order

1. Reset the wave-seeded global Phaser stream (initial phase only).
2. `regenerateModifierPoolThresholds` traverses every tier and every candidate in declaration order. This is not RNG-pure: it calls `ModifierTypeGenerator.generateType(party)` for each generator before deciding its effective weight, and generator implementations may draw. Weight closures can also invoke arbitrary state/callback behavior (`modifier-type.ts#L2975-L3038`).
3. Compute option count. Scrap Magnet, if applicable, draws from the independent battle RNG described above.
4. For each option in row order:
   - If no tier is forced, draw `tierValue = randSeedInt(1024)`.
   - If player pool, `tierValue !== 0`, and luck upgrades are allowed, compute luck and execute a do/while: draw `randSeedInt(upgradeOdds)` at least once; values 0..3 upgrade and repeat, values >=4 stop (`modifier-type.ts#L3518-L3534`). `upgradeOdds = max(1,floor(512/(min(luck,14)+5 + max(0,luck-14)*2)))`; luck is clamped to 0..18 (`#L3650-L3715`).
   - Tier mapping is exact: 256..1023 -> Common(0), 61..255 -> Great(1), 13..60 -> Ultra(2), 1..12 -> Rogue(3), 0 -> Master(4). Frequencies are 768/1024, 195/1024, 48/1024, 12/1024, 1/1024.
   - Add `upgradeCount`, then decrement tier/upgradeCount until a nonempty tier exists.
   - Draw `randSeedInt(totalEffectiveWeight)` and select the first cumulative threshold strictly greater than the value (`#L3574-L3583`). Thus weight interval is `[previousThreshold,currentThreshold-1]`.
   - If selected type is a generator, run it now; null recursively retries same tier. At retryCount >=100, downgrade one tier. A form-change item then runs its separate mega/primal appearance gate; on miss it recursively retries (`#L3588-L3615`).
5. Duplicate/challenge retry: options duplicate when localized `name` matches or `group` matches. With `retryCount=min(count*5,50)`, a duplicate candidate is rerolled at its already-resolved tier and upgradeCount, so duplicate retries consume candidate/generator/gate draws but no tier/luck draws. For count 3, initial + at most 14 duplicate replacements means a duplicate may be accepted on attempt 15 (`#L3207-L3238`). `applyChallenges(WAVE_REWARD,...)` is callback-driven and outside the declarative subset.

Daily luck is an independent temporary offset stream: it executes with offset 0 and seed override `globalScene.seed`, draws `[0,14]` unless event luck supplies a value, then restores the prior global state (`modifier-type.ts#L3656-L3672`; `battle-scene.ts#L2939-L2954`).

### Tier lock

A lock button is visible only when a `LockModifierTiersModifier` exists (`modifier-select-ui-handler.ts#L280-L301`). The global Boolean can be toggled without cost and without checking available money; it is blocked only when rerolls are disabled (`rerollCost < 0`) (`select-modifier-phase.ts#L930-L960`). A reroll successor always captures the current presented `type.tier` vector, but generation consumes it only if the global lock remains true (`#L791-L799`, `#L1492-L1498`). A locked tier is a **forced starting tier**, not an exact final tier: normal luck-upgrade draws still occur because `allowLuckUpgrades` defaults true (`modifier-type.ts#L3548-L3566`). So a locked Common can become Great or higher; it cannot downgrade except when the target tier has no pool.

## 3. Observed filtering and weights

`regenerateModifierPoolThresholds` computes effective weight per candidate (`modifier-type.ts#L2995-L3038`):
- find existing modifiers with the same stable string `type.id`;
- generate a concrete type for generators;
- permit the configured weight if there is no existing instance, or the concrete type is a held item, or a form-change type, or some existing instance is below `getMaxStackCount(true)`; otherwise effective weight 0;
- if permitted, call a weight closure `(party,rerollCount)` or use the static number;
- zero-weight entries are omitted; positive integer weights form cumulative thresholds in declaration order.

Duplicate suppression is by **localized name or group**, not ID. Challenge filtering is applied after candidate creation. Overrides replace options only after all natural generation.

Concrete clean-Common fixture (Classic wave <199, ball count <99, all party members full/nonfainted/no status/no PP loss, no active lure, no preexisting max-stack candidates, no challenge rejection): effective thresholds are exactly:
- values 0..5 -> `POKEBALL` (weight 6);
- 6..7 -> `RARE_CANDY` (2);
- 8..9 -> `LURE` (2);
- 10..13 -> `TEMP_STAT_STAGE_BOOSTER` (4);
- 14..15 -> `BERRY` (2);
- 16..17 -> `TM_CASE` (2).
Total is 18. Potion/Super Potion/Ether/Max Ether are zero in this state (`init-modifier-pools.ts#L68-L142`). This is a draw-tape fixture only: threshold regeneration's generator prepass still advances the real Phaser stream before the tier/weight draw.

## 4. Observed reroll cost and atomic causal order

Default balance values at exact HEAD are unlocked base 250 and locked tier bases `[50,125,300,750,2000]` for tiers 0..4 (`er-balance-knobs.ts#L265-L289`). Runtime balance settings may override them.

Cost (`select-modifier-phase.ts#L1448-L1485`):
- waived override -> 0 immediately;
- unlocked baseValue = configured `rerollBase`;
- locked baseValue = sum of configured values for every currently presented tier (missing tier index falls back to final array value);
- negative custom multiplier -> -1 (disabled); otherwise multiplier defaults 1;
- `baseMultiplier = min(ceil(wave/10) * baseValue * 2^rerollCount * customMultiplier, Number.MAX_SAFE_INTEGER)`;
- pass through `HealShopCostModifier` callbacks;
- multiply by Merchant's Seal factor (0.5 if held, else 1) and `Math.floor` the final value.

Successful reroll causal order (`select-modifier-phase.ts#L760-L829`):
1. compute cost; if negative or money insufficient, play error and return false—no relay, money, flag, queue, count, or RNG mutation;
2. compute authoritative post-money and publish co-op intent **before** mutation; a guest owner returns/parks here and does not execute locally;
3. set `globalScene.reroll = true`;
4. unless waived, set watcher money from authoritative relay or subtract cost locally; refresh/animate money;
5. enqueue successor `SelectModifierPhase(rerollCount+1,currentPresentedTiers,...)` at queue front;
6. clear text;
7. commit/end old operation at the appropriate UI-message seam;
8. record reroll and play `se/buy`;
9. successor start clears `globalScene.reroll`, regenerates thresholds with the incremented rerollCount, computes count, and rolls/adopts options.

Default numeric fixtures with no cost modifiers/relics/custom multiplier:
- wave 9, unlocked, rerollCount 0 -> 250; count 1 -> 500;
- wave 11, unlocked, count 0 -> 500;
- wave 9, locked tiers `[0,0,0]`, count 0 -> 150; count 1 -> 300;
- wave 9, locked tiers `[0,1,4]`, count 0 -> 2175;
- money 149 against locked-common cost 150 -> rejection with all state unchanged.
Lock toggle at money 0 is allowed if the lock marker exists and rerolls are enabled.

## 5. Observed free choice, skip, direct free reward, and party targeting

### Selectable free reward

Reward row is `rowCursor=1`; selection uses `typeOptions[cursor]`, records cursor, and applies with cost `-1` (`select-modifier-phase.ts#L636-L677`). Non-party type: co-op wire flush happens first, then `newModifier`, then `globalScene.addModifier`; party type opens a party mode first (`#L739-L757`). `cost=-1` never subtracts money and closes the reward phase after commit. Notably, the free branch closes even if `globalScene.addModifier` returns false (`#L1062-L1177`). There is no explicit bounds check for a nonempty reward row before `typeOptions[cursor].type`; UI is trusted. Empty options are treated as leave/skip.

### Skip

Cancel sends callback `(-1,-1)`, opening a confirmation prompt (`modifier-select-ui-handler.ts#L500-L542`; `select-modifier-phase.ts#L483-L524`). Confirmation changes UI to MESSAGE, relays/records LEAVE, ends phase, and advances co-op interaction; it mutates neither reward pool nor money. Rejecting confirmation resets the same `typeOptions` screen, consuming no RNG. Empty reward selection follows the same terminal leave path (`select-modifier-phase.ts#L636-L667`).

### Party-target reward

`PokemonModifierType` selects the UI mode from concrete type (plain, move, ability, TM, remember/shroom/TM-case). The configured `selectFilter` and optional move filter are passed directly to `PartyUiHandler` (`select-modifier-phase.ts#L1273-L1345`). Filter failure displays the returned message and does not invoke the callback (`party-ui-handler.ts#L887-L895`, `#L1042-L1047`). Cancellation/slot >=6 resets the same reward list with no mutation. On valid slot <6, causal order is:
1. asynchronously restore the modifier-select UI;
2. record the chosen sub-option;
3. relay `[rewardAct=0, slotIndex, option]` before local construction/application;
4. resolve `target = party[slotIndex]` and embed **target runtime Pokémon ID** in the modifier;
5. apply with cost -1 and sound enabled; `BattleScene.addModifier` loops the party and calls the consumable only where its `pokemonId` matches, then updates all party info (`select-modifier-phase.ts#L1318-L1345`, `#L1572-L1611`; `modifier.ts#L2089-L2114`; `battle-scene.ts#L3848-L3894`).

Plain modifier `PartyOption.APPLY` is numeric 3; move slots start at 3000; ability slots at 5000 (`party-ui-handler.ts#L185-L225`). Example Rare Candy reward at cursor 1 targeting slot 4 relays choice `1`, data `[0,4,3]`; local construction stores `party[4].id`. There is no reward-specific `coopOwner` filter: the interaction owner may target any party slot, including a partner-owned mon, and the watcher replays the exact slot/option.

Rare Candy itself is callback-heavy after targeting: apply level-increment modifiers, snapshot stats, increment level, conditionally set EXP, add configured friendship, recalculate stats, and unshift `LevelUpPhase` (`modifier.ts#L2827-L2869`). That mutation should remain deferred unless M4 explicitly imports those growth/stat/friendship contracts.

### Direct fixed free reward

`ModifierRewardPhase` constructs one modifier, calls `globalScene.addModifier`, plays `item_fanfare`, and displays reward text; it ignores the Boolean add result and ends only after text callback (`modifier-reward-phase.ts#L13-L50`). On an authoritative co-op guest it skips every shared modifier except account-local `AddVoucherModifierType`; shared mutation arrives through the host state carrier (`#L25-L39`). This is distinct from a selectable cost=-1 reward.

## 6. Observed co-op option authority, action owner, wire, and operation identity

The interaction pin is captured when the shop opens. Pick/input owner is round-robin `trunc(pin) mod playerCount`; with two players, even -> seat 0 host, odd -> seat 1 guest (`coop-session.ts#L232-L245`). Spoof/hotseat makes the local human drive all screens.

Option authority is a separate axis (`select-modifier-phase.ts#L190-L218`, `#L400-L445`):
- legacy normal wave: pinned pick owner rolls/streams, watcher adopts;
- retained-result mode: host rolls/streams every reward surface, guest adopts, even when guest owns input;
- authoritative Mystery reward: host rolls/streams; pinned ME owner drives input.
The option watcher starts with `typeOptions=[]` and consumes no local reward RNG. Timeout/null/unknown ID/reconstruction failure is fail-closed: it remains parked and never exposes/applies a local pool (`select-modifier-phase.ts#L2077-L2170`). Serialized option identity is `{id:string,tier:number,upgradeCount:number,cost:number,pregenArgs?:number[]}`; unknown ID or null generator makes reconstruction all-or-nothing fail (`coop-reward-options.ts#L34-L124`).

Legacy action constants: LEAVE choice `-1`, REROLL `-2`; reward action code 0; lock code 3 (`coop-interaction-relay.ts#L75-L76`, `#L253-L261`; `select-modifier-phase.ts#L122-L128`). Free non-party reward data is `[0]`; free party reward is `[0,slot,subOption]`; skip/reroll data is absent; lock uses choice 0/data `[3]`. Owner publishes before mutation. In retained mode, guest proposal parks; host validates/executes/commits.

Durable identity (`coop-reward-operation.ts#L176-L239`, `#L690-L700`, `#L775-L829`, `#L1225-L1290`):
- action stride = 100000;
- ambient surface offset 0; ordered ME surface offset `(ordinal+1)*5000`;
- `actionSlot = pin*100000 + surfaceOffset + actionOrdinal`, with actionOrdinal 0..4999;
- owner action ordinal increments independently per operation-kind/surface stream; retried terminal reuses its retained ordinal/ID;
- operation text is `${epoch}:${ownerSeat}:${kind}:${actionSlot}`;
- action kind is `REWARD`; presentation kind is `REWARD_PRESENT`;
- presentation uses `reroll` as its action ordinal and the **input owner seat**, although only host authors the immutable presentation.

Concrete ambient fixtures, epoch 7:
- pin 4 -> owner seat 0; initial presentation `7:0:REWARD_PRESENT:400000`; first action `7:0:REWARD:400000`; reroll-1 presentation `7:0:REWARD_PRESENT:400001`; second action `7:0:REWARD:400001`;
- pin 5 -> owner seat 1; initial presentation `7:1:REWARD_PRESENT:500000`; first action `7:1:REWARD:500000`.

## 7. Selected declarative M4 candidate subset and numeric IDs actually observed

Recommended minimum candidate metadata subset, all directly declared at exact HEAD:

| Oracle string ID | Numeric tier | Static/effective weight | Target | Concrete numeric content |
|---|---:|---:|---|---|
| `POKEBALL` | 0 | 6 when eligible | none | `PokeballType.POKEBALL=0`, grant 5 |
| `GREAT_BALL` | 1 | 6 when eligible | none | `PokeballType.GREAT_BALL=1`, grant 5 |
| `ULTRA_BALL` | 2 | 15 when eligible | none | `PokeballType.ULTRA_BALL=2`, grant 5 |
| `ROGUE_BALL` | 3 | 16 when eligible | none | `PokeballType.ROGUE_BALL=3`, grant 5 |
| `MASTER_BALL` | 4 | 24 when eligible | none | `PokeballType.MASTER_BALL=4`, grant 1 |
| `RARE_CANDY` | 0 | 2 | party | plain apply sub-option 3; target identity is Pokémon runtime ID |

Ball declarations are `modifier-type.ts#L2252-L2259`; weights are `init-modifier-pools.ts#L69-L71`, `#L149-L151`, `#L374-L375`, `#L690-L692`, `#L753-L755`. Ball eligibility is weight 0 only when Classic and current count >=99 (`init-modifier-pools.ts#L1003-L1005`); non-Classic remains eligible at cap. Apply sets `count=min(count+grant,99)` and returns true even if already capped (`modifier.ts#L305-L329`).

**Identity stop condition:** `ModifierType.id` is a string, and `WeightedModifierType` stamps it by reverse-looking up the registry key (`modifier-type.ts#L258-L260`, `#L2187-L2193`). No production numeric modifier ID exists. Do not report object insertion index as an ID. A Rust table may assign numeric IDs to these six candidates, but that mapping is a proposed Rust contract and must be recorded separately from oracle evidence. Numeric IDs actually observed and safe to fixture are tier 0..5, ball subtype 0..5, and party sub-option values.

## 8. Concrete oracle fixture cases

1. **Tier boundaries:** draw tape `[1023,256,255,61,60,13,12,1,0]` maps to `[0,0,1,1,2,2,3,3,4]` before luck.
2. **Luck upgrade:** luck 0 -> odds 102. `tierValue=256`, luck draws `3,4` yields Common base + one upgrade = Great, `upgradeCount=1`. `tierValue=0` yields Master and consumes no luck draw.
3. **Clean Common weight bins:** total 18 and intervals listed in section 3; assert strict `< threshold` boundary at 5/6, 7/8, 9/10, 13/14, 15/16, 17.
4. **Duplicate retry:** count 3 -> retry cap 15 attempts. First `RARE_CANDY`, next `RARE_CANDY` triggers same-tier weight-only reroll; attempt 15 may remain duplicate. Assert no tier/luck draw on duplicate retry.
5. **Base count:** no count modifiers/relic/biome callback -> 3 options. One Extra stack +2 and Merchant's Seal one stack -> 6 before custom settings.
6. **Unlocked reroll:** wave 9/default config/money 1000/count 0 -> cost 250, then money 750, successor count 1, same global reward RNG stream.
7. **Locked reroll:** wave 9/current tiers `[0,0,0]`/money 1000 -> cost 150, then money 850; successor receives `[0,0,0]`, but each forced Common remains luck-upgradable.
8. **Rejected reroll:** same locked case with money 149 -> error; money, RNG cursor, rerollCount, queue, lock, and options unchanged.
9. **Lock-only:** money 0, rerolls enabled, lock marker held -> toggle false→true, no money/RNG/option mutation; displayed reroll price changes from unlocked to tier sum.
10. **Free ball:** current Poké Ball count 97, choose `POKEBALL` -> 99, money unchanged, phase terminal. At 99 in non-Classic -> stays 99 but add reports success.
11. **Party target:** presented `RARE_CANDY` at cursor 1, choose party slot 4/plain APPLY(3) -> wire `(choice=1,data=[0,4,3])`; modifier identity embeds `party[4].id`; no `coopOwner` restriction.
12. **Party cancel/filter:** cancel or slot >=6 returns to identical options and consumes no RNG; a non-null select-filter message performs no callback/relay/mutation.
13. **Skip:** initial cancel then reject confirmation -> same list/no RNG; confirm -> LEAVE(-1), no reward/money mutation, terminal.
14. **Co-op IDs:** epoch/pin fixtures in section 6; assert presentation host-authored but owner field is pinned input owner.

## 9. Explicit deferred/unsupported callbacks and unanswered gaps

- Full production reward-pool parity is **not declarative**: threshold regeneration executes every weight closure and generator, and generators consume RNG before options are rolled. Porting only the visible tier/luck/weight draws would be wrong.
- Defer all `ModifierTypeGenerator` candidates (Berry, stat/type boosters, evolution/form items, mint/tera/TM-like generated types), `erMegaStoneAppearsAtGate`, and all dynamic weight closures until separately extracted.
- Defer `applyChallenges(WAVE_REWARD,...)`; its callback can reject candidates and its mutation/reset semantics are not defined locally. The retry condition has no challenge retry cap visible in this function.
- Defer custom/guaranteed reward callbacks from fixed battles, Mystery encounters, LLM victory bundles, developer overrides, and `Overrides.ITEM_REWARD_OVERRIDE` unless their exact factories are individually selected.
- Defer Extra/TempExtra callback application, Scrap Magnet, Merchant's Seal, biome extra slots, HealShopCostModifier/Black Sludge, and runtime balance-editor overrides from the minimal fixture; their observed hooks/formulas are documented above.
- Defer fusion, TM/move, memory/shroom/TM-case, ability randomizer/capsule, form-change, and other continuation pickers. They queue callback-driven phases and have additional back-out/commit rules.
- Exact Phaser 3.90 `RandomDataGenerator` internal PRNG/state transition and `integerInRange` implementation are external to production TypeScript and not vendored in the assigned worktree. The TS oracle proves sow/state calls and inclusive range only; seed-to-number golden vectors require a separately pinned Phaser implementation or observed executable fixture. This is a stop condition, not permission to substitute another PRNG.
- No numeric modifier IDs are observable. A concrete Rust numeric mapping is an unanswered migration-owned design input; preserve the string oracle key in fixtures for traceability.
- Invalid nonempty reward cursor has no local range guard; real UI guarantees it. Empty tier thresholds, null candidate after retries, and malformed party callback values rely on non-null assertions/UI invariants rather than defined recovery. Do not turn these into supported Rust behavior without a design decision.
- Direct `ModifierRewardPhase` ignores add failure and still announces the reward; selectable free reward also terminates on add failure. Preserve this only if included deliberately; otherwise reject such candidates at the declarative admission boundary.
