# M4 Market and Pricing Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

Read-only oracle extraction for `m4-market-oracle.md` at the assigned TypeScript oracle SHA `45c89493e7edec9c4da247a98cd7858b1f015c09`. The regular shop is a fixed, wave-unlocked catalog with unlimited successful rebuys and no stock RNG; the biome market is a separately scheduled, at-most-16-cell seeded market with per-slot quantities and no player reroll/lock controls. Exact price, money, RNG, action-coordinate, co-op ordinal/identity, targeted-purchase, sold-state, leave, and grid contracts are detailed below, with callback-driven boundaries explicitly deferred.

## Source evidence

### `src/battle-scene.ts`

`BattleScene.getWaveMoneyAmount`, `executeWithSeedOffset`, `addModifier`, and `applyModifier`: wave-unit formula, literal-seed save/restore behavior, modifier acceptance, and first-matching HealShopCostModifier application.

### `src/modifier/modifier-type.ts`

`getPlayerShopModifierTypeOptionsForWave`, `modifierTypeInitObj`, `PokemonHpRestoreModifierType`: exact regular catalog/unlock groups, biome resolution/gate/price construction, string modifier identities, concrete heal/ball content, and target filters.

### `src/data/elite-redux/er-biome-economy.ts`

`ER_BIOME_ECONOMY`, `ER_SHOP_CATEGORY_POOL`, `rollErBiomeShopStock`, `erBiomeTierPrice`, `erBiomeCategoryPriceMod`, `erBiomeStockCount`: market candidates, RNG draw order, pricing, stock, and no-shop behavior.

### `src/phases/select-modifier-phase.ts`

`SelectModifierPhase.start`, selection callback, `selectShopModifierOption`, `applyChosenModifier`, `openModifierMenu`, `buildPokemonModifier`, `applyModifier`, `rerollModifiers`, `toggleRerollLock`, `getRerollCost`: regular action ordering, targeted purchases, economic mutation order, reroll/lock, co-op action codes and payloads.

### `src/phases/biome-shop-phase.ts`

`BiomeShopPhase.start`, `buildStock`, `onSelect`, `confirmLeave`, `copy`, co-op watch/apply methods, and override `applyModifier`: stock lifetime, purchase/sold semantics, continuation reuse, owner rules, market payload, validation, atomic retained-result behavior.

### `src/ui/handlers/modifier-select-ui-handler.ts`

`SHOP_OPTIONS_ROW_LIMIT`, `show`, `processInput`, `setRowCursor`: regular UI row/cursor coordinates, two-row inversion, affordability rendering, and fixed catalog construction.

### `src/ui/handlers/biome-shop-ui-handler.ts`

`GRID_COLS`, layout constants, `buildGrid`, `restyleCells`, `processInput`: exact 4-column row-major layout, sold/affordability presentation, movement boundaries, buy and leave callbacks.

### `src/phases/victory-phase.ts`

Victory-tail biome-market scheduling and phase order: non-Daily x0, after reward presentation, before biome selection; Abyss routes to the Bargain.

### `src/modifier/modifier.ts`

`HealShopCostModifier.apply`: `floor(cost * shopMultiplier)`; stack maximum one. Also defines persistent reroll-lock modifier.

### `src/data/elite-redux/er-balance-knobs.ts`

Shipped reroll and biome category defaults: reroll base 250, locked tier values `[50,125,300,750,2000]`, cheap 0.7, dear 1.4.

### `src/data/elite-redux/coop/coop-interaction-relay.ts`

Legacy market identity and sentinels: leave `-1`, reroll `-2`, biome stock namespace `777`, `coopBiomeShopSeq`.

### `src/data/elite-redux/coop/coop-seq-registry.ts`

Concrete legacy biome-shop sequence base `7_000_000`.

### `src/data/elite-redux/coop/coop-reward-operation.ts`

Per-stream action ordinal minting, market/reward operation kinds, operation action-slot math, and owner-intent ordering.

### `src/data/elite-redux/coop/coop-operation-address.ts`

Reward/market operation stride `100_000`.

### `src/data/elite-redux/coop/coop-operation-envelope.ts`

Operation ID encoding `${epoch}:${owner}:${kind}:${actionSlot}`.

### `src/data/elite-redux/coop/coop-session.ts`

Pinned owner-seat rule; two-player even pin is host seat 0, odd pin guest seat 1.

### `src/utils/common.ts`

`shiftCharCodes`, `randSeedInt`, and `formatMoney`: exact seed transformation, inclusive seeded integer selection/no-draw range<=1 behavior, and non-integer display behavior.

### `src/enums/biome-id.ts`

Concrete numeric biome IDs, including Town 0, Plains 1, Desert 14, Wasteland 23, Abyss 24, Construction Site 26, Laboratory 41.

### `src/enums/modifier-tier.ts`

Numeric tier ordinals Common 0, Great 1, Ultra 2, Rogue 3, Master 4, Luxury 5.

### `src/enums/pokeball.ts`

Concrete ball payload ordinals Poke 0, Great 1, Ultra 2, Rogue 3, Master 4, Luxury 5.

## Architecture and contract guidance

## Oracle boundary

All statements below are **observed TypeScript behavior** unless marked **Proposed M4 contract** or **Gap/deferred**. Production modifier identity on this surface is a string: `ModifierType.withIdFromFunc` assigns the registry key (`"POTION"`, `"POKEBALL"`, etc.); there is no observed numeric modifier-type ID to invent. Numeric content IDs are reported where the production types expose them (BiomeId, ModifierTier, PokeballType, restore quantities).

## 1. Shared wave-income unit

`BattleScene.getWaveMoneyAmount(1)` (`src/battle-scene.ts:3769-3780`) defines the input used by both catalogs. For positive wave `w`, let `q = ceil(w/10)-1`, and let `P = erTeamMoneyBonusPercent()` (observed party-wide 0–60 input). Then:

`raw = ((q + 1 + 0.75 + ((((w-1) % 10)+1)/10)) * 100) ** (1 + 0.005*q)`

`W = floor((raw * (1 + P/100))/10) * 10`.

Thus `W` is an integer multiple of 10. The price contract must take the actual runtime `P`; assuming zero changes real stock prices.

## 2. Regular shop: fixed stock and exact pricing

`getPlayerShopModifierTypeOptionsForWave(w, baseCost, false)` (`src/modifier/modifier-type.ts:3264-3393`) returns no shop on `w % 10 === 0`, and no shop when the current biome rule has `shopNoHeal` (Wasteland is the documented case). Otherwise it exposes the first `ceil(max(w+10,0)/30)` catalog groups and applies `ChallengeType.SHOP_ITEM` to filter individual entries. Challenge-free positive-wave unlock ranges are:

- waves 1–20: group 1;
- 21–50: groups 1–2;
- 51–80: 1–3;
- 81–110: 1–4;
- 111–140: 1–5;
- 141–170: 1–6;
- 171–199 non-x0: 1–7.

Groups in exact order:

1. `POTION`, `ETHER`, `REVIVE`, `FULL_HEAL`;
2. `SUPER_POTION`;
3. `ELIXIR`, `MAX_ETHER`;
4. `HYPER_POTION`, `MAX_REVIVE`, `MEMORY_MUSHROOM`;
5. `MAX_POTION`, `MAX_ELIXIR`;
6. `FULL_RESTORE`;
7. `SACRED_ASH`.

There is **no stock quantity and no sold state** in the regular shop. Every selection reconstructs the fixed list; an accepted item can be bought repeatedly. Rejection by `addModifier` prevents the economic deduction.

Raw no-Black-Sludge coefficient table, relative to the supplied base:

- Potion `0.2*0.7 = 0.14`;
- Ether `0.4`;
- Revive `2*0.7 = 1.4`;
- Full Heal `0.8*0.7 = 0.56`;
- Super Potion `0.45*0.7 = 0.315`;
- Elixir `1`;
- Max Ether `1`;
- Hyper Potion `0.8*0.7 = 0.56`;
- Max Revive `2.75*0.7 = 1.925`;
- Memory Mushroom `4`;
- Max Potion `1.5*0.7 = 1.05`;
- Max Elixir `2.5`;
- Full Restore `2.25*0.7 = 1.575`;
- Sacred Ash `10*0.7 = 7`.

`ModifierTypeOption` stores `Math.min(Math.round(cost), Number.MAX_SAFE_INTEGER)`. Every regular-shop option cost is therefore an integer safe-number after JavaScript `Math.round`; neither the displayed option nor charged money retains a fractional coefficient product.

### Black Sludge display-versus-charge order

Let `H(x)=floor(x*s)` when the first matching `HealShopCostModifier` exists with multiplier `s`, otherwise `H(x)=x` (`src/modifier/modifier.ts:3717-3748`; `BattleScene.applyModifier` stops after the first successful match at `src/battle-scene.ts:4409-4430`). Option construction stores `round(coefficient*H(W))` for the display path. Selection reconstructs from unmodified `W`, rounds the option's `coefficient*W`, and then applies `H` at the observed charge boundary. These are not algebraically interchangeable because of `round` and `floor`; the oracle fixture must capture both exact integers.

### Concrete regular item payloads

Observed registrations (`modifier-type.ts:2309-2345`) include: Potion 20 points/10%, Super Potion 50/25%, Hyper Potion 200/50%, Max Potion 0/100%, Full Restore 0/100% plus status; Revive 50%, Max Revive 100%; Ether 10 PP, Max Ether full (`-1`); Elixir 10 all-move PP, Max Elixir full (`-1`). These are target/effect content, not numeric modifier IDs.

## 3. Biome market stock generation

Scheduling (`victory-phase.ts:270-340`): every non-Daily global x0 victory queues the biome market after post-victory reward presentation and before `SelectBiomePhase`; Abyss (BiomeId 24) queues `TheBargainPhase` instead. `BiomeShopPhase.buildStock` calls the biome branch using the current wave/biome. That branch returns empty for `wave >= 200` or missing `currentBattle` (`modifier-type.ts:3269-3340`). A missing economy row or `noShop` returns empty before seeded execution.

The rolled key list is at most 16 entries and deduplicated by registry key (`rollErBiomeShopStock`, `er-biome-economy.ts:343-435`):

1. Add economy `signature` keys in table order, no RNG, tagged category `HELD`.
2. For each `eco.cheap` category in table order, skip `HEAL` and `PP`; filter already-seen keys, then make up to two draws without replacement from that category pool. Each draw picks `idx=randSeedInt(pool.length)`, adds the key if unseen, and splices that index.
3. Build a bag in exact append order:
   - every cheap category at weight 3 (again skipping HEAL/PP),
   - HELD weight 4 in Desert (BiomeId 14), otherwise 2,
   - BALLS weight 2,
   - EVO, TM, BATTLE, CANDY, MINT, VITAMIN each weight 1 in that order.
   Every weight repeats every category key as a separate bag occurrence.
4. While stock <16, bag nonempty, and fewer than 500 attempts: draw `idx=randSeedInt(bag.length)`, splice that occurrence, and add only if its key remains unseen. Duplicate occurrences still consume a draw and an attempt. `randSeedInt(range<=1)` returns 0 without calling Phaser RNG; otherwise it calls `Phaser.Math.RND.integerInRange(0, range-1)` (`common.ts:101-106`).

### RNG source and cursor behavior

The entire key roll is wrapped by `executeWithSeedOffset(callback, waveIndex, "er-biome-shop")`. This saves ambient `Phaser.Math.RND.state()`, sows from `[shiftCharCodes("er-biome-shop", waveIndex)]`, performs the ordered draws above, and restores the exact ambient state (`battle-scene.ts:2939-2956`). `shiftCharCodes` adds `waveIndex` to every UTF-16 code unit (`common.ts:32-44`). Consequently stock-key generation consumes **zero ambient RNG** and is independent of the run seed; it is wave-index deterministic under Phaser’s RandomDataGenerator.

Each generator entry is separately resolved inside its own `executeWithSeedOffset(..., waveIndex, "er-biome-shop-gen")`; each invocation starts from the same literal seeded state and restores ambient state. Each form-change item then separately gates inside `executeWithSeedOffset(..., waveIndex, "er-biome-shop-mega-gate")`. A gate miss drops that resolved option. There is **no backfill after resolution**, so the displayed grid can contain fewer than the 16 rolled keys. Exact generator/gate callback draw counts are deferred below.

## 4. Biome pricing and stock quantities

Final displayed/charged biome cost ignores `entry.cost` and ignores the `baseCost` argument. Although `BiomeShopPhase.buildStock` applies `HealShopCostModifier` to a local base holder first (`biome-shop-phase.ts:391-399`), the biome branch later calls `erBiomeTierPrice`, which reads `getWaveMoneyAmount(1)` again. Therefore Black Sludge has **no effect** on biome-market prices.

Resolved tier precedence (`erBiomeShopResolveTier`, `er-biome-economy.ts:320-339`): explicit key tier, else `mt.getOrInferTier()`, else category default. Form-change stones instead use `erMegaStoneTier`. The tier is cached on `ModifierType` so price and quantity use the same value.

Let tier factor `F` be Common(0)=0.35, Great(1)=1.0, Ultra(2)=2.6, Rogue(3)=6, Master(4)=12, Luxury(5)=9. Let `M` start from the runtime `er.shop.biomePriceMod[BiomeId name]` override, else the shipped biome table value. If category is in `cheap`, multiply by runtime `er.shop.cheapMult` (shipped 0.7); **else if** in `dear`, multiply by runtime `er.shop.dearMult` (shipped 1.4). Cheap wins when a category appears in both lists (e.g. Cave BALLS). Then:

`price = max(10, floor(W * F[tier] * M / 10) * 10)`.

This uses hard-coded `ER_SHOP_ITEM_TIER_FACTOR`; the editor `er.shop.tierFactor` only computes discarded fallback `entry.cost` and is not the final resolved price.

Quantity by tier: Common 5, Great 3, Ultra 2, Rogue 1, Master 1, Luxury 1; unknown falls back to Great=3 (`er-biome-economy.ts:263-286`).

### Concrete M4-supported stock candidates

**Proposed M4 contract:** use Town (BiomeId 0) on wave 10 as the clean market oracle and support direct ball purchases end-to-end while treating the full rolled list as authoritative input. Town signatures are `BERRY`, `LURE`; cheap categories are BALLS then BERRY. Because BERRY is already seen, the cheap BALLS step guarantees two distinct draws from:

- modifier id `POKEBALL`, PokeballType 0, ModifierTier Common 0, qty 5, Town price `max(10, floor(W*0.35*0.7/10)*10)`;
- `GREAT_BALL`, PokeballType 1, Great 1, qty 3, price `max(10, floor(W*1.0*0.7/10)*10)`;
- `ULTRA_BALL`, PokeballType 2, Ultra 2, qty 2, price `max(10, floor(W*2.6*0.7/10)*10)`;
- `ROGUE_BALL`, PokeballType 3, Rogue 3, qty 1, price `max(10, floor(W*6*0.7/10)*10)`.

The two ball rolled entries are positions 2 and 3, but their **displayed indices must be located by resolved modifier identity**, because an earlier BERRY generator resolving null would compact the option list. Unsupported rolled keys must not be silently skipped before the TypeScript roll; doing so changes later bag draws and slot identity.

For the regular shop, the proposed supported kernel subset is the challenge-free fixed catalog plus market-level target intent. Potion/PP/status/revive effects remain external adapter results; the kernel commits payment only after adapter acceptance.

## 5. Purchase validation, mutation, sold state, and targeting

### Regular selection

`selectShopModifierOption` reconstructs the fixed list, guards missing cursor (watcher ignores; local plays error), applies Black Sludge to the selected raw cost, then checks `money < cost` unless `WAIVE_ROLL_FEE_OVERRIDE`. There is no `isFinite`, integer, or nonnegative validation on the local path. An unaffordable selection returns before target UI, modifier construction, economic mutation, or RNG.

For a `PokemonModifierType`, `applyChosenModifier` opens PARTY; no money is deducted yet. Cancel/invalid UI result (`slotIndex >= 6`) calls `resetModifierSelect`, reusing existing reward options and reconstructing the fixed shop; it spends no money and consumes no stock/RNG. A valid callback first restores the shop mode, records nested option, creates the modifier, then calls `applyModifier`. Construction mapping (`select-modifier-phase.ts:1574-1611`): move option subtracts `PartyOption.MOVE_1`; fusion uses target slot plus partner slot; ability subtracts `ABILITY_SLOT_0`; remember/add-slot/shroom/TM-case pass the nested option; ordinary held/heal uses target only.

For non-target items, construction/application is immediate. `SelectModifierPhase.applyModifier` calls `globalScene.addModifier` first. If accepted and paid, it then subtracts cost (unless waive), updates money UI, animates, sounds, and keeps the regular shop open. If rejected, it plays error and does not deduct. Regular shop has no stock mutation.

### Biome selection and sold state

`BiomeShopPhase.onSelect` exact guard order (`biome-shop-phase.ts:435-466`): negative index -> leave confirmation; missing option -> `false` silently; quantity <=0 -> error/false; insufficient money -> error/false; then set `pendingIndex`, zero nested-option state, and enter the shared target/application flow. No failed precheck draws RNG.

On accepted application, causal economic order (`biome-shop-phase.ts:1454-1630`) is: modifier engine mutation via `super.applyModifier`; base phase money deduction/UI/sound; then `qty[pendingIndex]=max(0,qty-1)`, handler stock refresh, and `pendingIndex=-1`. Thus payment precedes sold-count decrement. Target cancel never reaches `applyModifier`, so neither payment nor stock changes. A rejected `addModifier` produces no payment/quantity decrement, although callback/achievement/queued-continuation side effects inside the modifier engine are not safe to model generically (deferred).

Sold slots stay in place. UI prints `xN` when positive and `SOLD` at zero; non-hovered sold/unaffordable cells dim, while the hovered cell remains fully lit. ACTION on SOLD still calls the phase and receives the phase error. `setStock` clamps to >=0. Stock persists only through this live market/continuation/authoritative projection; it is not a post-leave inventory or save-state catalog.

Biome continuation `copy()` carries the same `shopOptions` and `qtys` array references and marks the copy as continuation (`biome-shop-phase.ts:230-254`); `start()` reopens without rolling or re-streaming. Regular continuation similarly preserves the current reward options, while the fixed regular shop is reconstructed deterministically.

## 6. Reroll and lock semantics

These controls exist only on `MODIFIER_SELECT` (regular reward/shop screen), **not** the biome-market grid. `COOP_BIOME_STOCK_REROLL=777` is a stock-stream namespace, not a player reroll.

Reroll cost (`select-modifier-phase.ts:1448-1481`):

- waive override returns 0 immediately;
- unlocked base `b = runtime vanilla.shop.rerollBase` (shipped 250);
- locked base `b = sum(tierValues[option.tier])` across current free reward options; shipped `[50,125,300,750,2000]`; undefined tier uses index 0, and out-of-range/Luxury falls back to the last value;
- custom negative reroll multiplier returns `-1`; otherwise multiplier `m` defaults 1;
- pre-modifier `x = min(ceil(w/10) * b * 2**rerollCount * m, Number.MAX_SAFE_INTEGER)`;
- apply first HealShopCostModifier: `floor(x*s)` if present;
- Merchant’s Seal multiplier is 0.5 when held, else 1; final return is `floor(modified*seal)`.

Reroll action order (`select-modifier-phase.ts:761-833`): compute cost; if negative or money insufficient, error and return with no mutation/RNG; publish co-op intent before local mutation; set `globalScene.reroll=true`; deduct cost (or authoritative watcher adopts exact relayed post-money), update/animate money; enqueue successor `SelectModifierPhase(rerollCount+1, current reward tiers, ...)`; close old surface; record action; play buy sound. The successor rolls new **free reward options**; the regular fixed shop catalog does not reroll. If global lock is true, successor passes the saved tier vector to reward generation; if false it ignores that vector. Exact reward-pool RNG belongs to the modifier/reward oracle, not this market stock contract.

Lock toggle (`select-modifier-phase.ts:931-963`): disabled iff reroll cost is negative; otherwise send intent first, flip global `lockModifierTiers`, record, and recompute displayed reroll cost. It spends no money, draws no RNG, and does not reroll immediately. Lock availability in UI additionally requires a `LockModifierTiersModifier`; the boolean persists after leave and is part of co-op authoritative state. Waive mode makes reroll cost 0 before the custom-disabled check.

## 7. Exact UI action coordinates and layout

Regular `modifierSelectCallback` (`select-modifier-phase.ts:486-550`):

- callback row 0: cursor 0 REROLL, 1 TRANSFER, 2 CHECK TEAM, 3 LOCK;
- row 1: free reward index = cursor;
- rows >=2: paid shop.

The regular UI holds at most 7 shop items per visual row (`SHOP_OPTIONS_ROW_LIMIT=7`). With two visual shop rows, callback row 3 addresses catalog indices 0–6, while callback row 2 addresses catalog indices 7+; this inversion follows `shopOptionsRows.at(-(rowCursor-1))` and selection’s `rowCursor===2 ? cursor+7 : cursor`. With one visual row, row 2 addresses index `cursor`. `ShopCursorTarget` numeric ordinals are REROLL 0, REWARDS 1, SHOP 2, CHECK_TEAM 3; CHECK_TEAM is translated to callback row 0/cursor 2. Missing shop rows fall back to rewards.

Biome grid (`biome-shop-ui-handler.ts:51-59,449-495,551-590`): maximum 16 cells, exactly 4 columns, row-major index `row=floor(i/4)`, `col=i%4`. Logical centers are `x=124+52*col`, `y=50+26*row`; cursor is `(x,y+1)` with 44x26 rectangle. ACTION emits current index; CANCEL emits `-1`. Up/down change index by 4 only if in range; left/right never wrap rows and right also checks item count. A short final row is allowed after resolution drops.

## 8. Leave behavior

Regular CANCEL invokes callback `(-1,-1)` and opens the skip-item confirmation. Confirm closes the phase, records LEAVE, and advances co-op ownership; cancel restores the same reward surface. Biome CANCEL emits `-1`, hides the opaque shop, and asks `leaveShopQuestion`; confirm closes/ends (co-op sends terminal first), while No reopens the same already-rolled stock. Neither initial cancel, rejected confirmation, nor confirmed leave consumes market RNG or money/stock. Empty biome stock auto-finishes; in co-op the option owner still streams the empty authoritative list so the watcher can terminate exactly.

## 9. Co-op action identity, ordinals, and owners

Pinned interaction owner is `((trunc(pin)%2)+2)%2`: even -> seat 0/host, odd -> seat 1/guest (`coop-session.ts:233-243`). Spoof/hotseat makes the local human drive. For normal wave reward/shop and wave biome market, option owner (roll/stream) equals pick owner. Inside authoritative mystery encounters, **host is always option owner**, while pick owner remains pinned-parity owner; therefore a guest pick owner adopts host stock.

Biome legacy stream identity: `seq = 7_000_000 + max(0,pin)`; stock options key uses reroll namespace `777`; buy `choice` is the displayed streamed-stock slot (>=0); buy data is exactly `[partySlot, resultingMoney, nestedOption, validatedCost]`; terminal leave choice is `-1`. Stock is streamed before the empty check. Missing exact terminal is retried/reconnected and eventually fails the shared session; it is never inferred as leave.

Authority operation ordering: each `(operation kind + ordered reward surface, pin)` owner stream starts ordinal 0 and increments per prepared action. Ambient market `actionSlot = pin*100_000 + ordinal`; operation ID is `${epoch}:${ownerSeat}:SHOP_BUY:${actionSlot}`. A retained terminal retry reuses its retained ordinal/ID. Result stock vector must have exactly the local quantity-vector length and every value must be a nonnegative safe integer; otherwise shared session fails.

Regular reward/shop legacy data action codes (`select-modifier-phase.ts:124-138`) are REWARD=0, SHOP=1, TRANSFER=2, LOCK=3, CHECK=4 (`coop-shop-check-relay.ts:37`); REROLL is choice `-2`, LEAVE `-1`. A shop choice uses `choice=cursor`, data `[1,rowCursor,...resolvedTarget,COST_TAG(0x434f),trunc(cost)]`, then optionally trailing `[MONEY_TAG(0x4d4f),trunc(ownerMoney-cost)]`. Because `ModifierTypeOption` already stores a rounded safe-integer cost, these carrier truncations preserve the selected regular-shop value; they do not expose a fractional-price seam.

Biome retained guest-owned buy host validation, before mutation (`biome-shop-phase.ts:1402-1420`): slot exists/in range, stock >0, cost finite and >=0, cost exactly equals authoritative option cost, and host money affords it unless waived. The host derives trusted post-money itself. Co-op paid execution snapshots material state and Phaser RNG, wraps phase-queue insertions, applies modifier/payment/stock, then retains the complete stock continuation; any exception rolls queue, stock, money, authoritative material, and RNG back, then fails the shared session.

## 10. Failure/no-RNG matrix

Observed market-level cases that return before RNG/economic mutation:

- regular missing shop cursor: local error/false; watcher ignores and keeps awaiting;
- regular/biome unaffordable: error/false;
- biome missing option: false, no error;
- biome sold out: error/false;
- reroll negative or unaffordable: error/false;
- disabled lock: solo error/false, watcher suppresses cosmetic error;
- target-menu cancel: reopen same surface;
- leave confirmation No: reopen same surface.

Regular fixed catalog construction itself uses no stock RNG. Biome failed selections occur after initial stock is already fixed and draw none. A successful reroll does cause reward-option RNG later when its successor starts. Successful modifier application may draw or queue callbacks depending on modifier type and is outside the generic no-RNG guarantee.

## 11. Explicit gaps / stop conditions

1. `ModifierTypeGenerator.generateType` callbacks (notably BERRY, MINT, evolution/form entries, vitamins/stat boosters and other generated categories) determine concrete resolved subtype, eligibility, and their internal seeded draw count. They run under the observed `er-biome-shop-gen` seed, but must be separately extracted; M4 must stop/mark unsupported rather than guess.
2. `erMegaStoneAppearsAtGate` and mega tier resolution are separate callback-driven behavior under `er-biome-shop-mega-gate`; form-change candidates are deferred.
3. `applyChallenges(ChallengeType.SHOP_ITEM)` can filter regular items. The selected subset assumes challenge-free Classic; challenge-specific callbacks require their own oracle.
4. Modifier target filters and `globalScene.addModifier` own gameplay acceptance and may validate achievements, mutate persistent stacks, or enqueue phases. Proposed Rust market boundary must receive an explicit `accepted` result and only then deduct/consume stock. Do not infer acceptance from item identity.
5. Continuation types (`RememberMove`, TM, Learner’s Shroom, TM Case, Ability Capsule variants, Greater Ability Randomizer) spread payment/consumption and back-out behavior across later phases. They are explicitly deferred from the simple direct/targeted M4 purchase subset.
6. Exact Phaser RandomDataGenerator bitstream is a dependency of the extracted seed/draw schedule. If Rust must reproduce bytes rather than consume oracle fixtures, its Phaser PRNG compatibility must be proven separately; do not substitute another PRNG.
7. Runtime balance overrides and live money-streak percentage are inputs. Shipped defaults are evidence, not permission to ignore editor/runtime values.
8. Regular-shop prices are integer values after `ModifierTypeOption` JavaScript rounding. M4 preserves the observed display-versus-charge `round`/`H` order and rejects values outside the validated safe-integer domain.
