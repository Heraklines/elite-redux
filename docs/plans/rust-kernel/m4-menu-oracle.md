# M4 Raw-Key Menu Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

M4-00 menu-oracle extraction for the exact TypeScript oracle is complete. The stable raw-key layer is `KeyboardEvent -> InputsController Button -> UiInputs -> active UiHandler`; default QWERTY is Arrows/WASD, Action=Space/Z (Enter falls through SUBMIT to ACTION on these menus), Cancel=Backspace/X, Menu=Esc/M, Stats=C/Shift, Cycle Form=F/T. Every accepted keydown is emitted immediately and then re-emitted every 250 ms until keyup; repeats are not scoped to the handler that received the first down, so a held Action/Cancel can cross a mode replacement and operate the next menu. None of the target navigation handlers consumes RNG; reward/market stocks and biome nodes are inputs already rolled before the handler opens. The only navigation rounding is reward row projection via `Math.round(oldColumn/(oldCount-1)*(newCount-1))`. Omniform batch setup is the exception: opening it may seeded-roll and persist missing form movesets, so it is explicitly outside the clean M4 subset.

Recommended M4-supported oracle subset: solo/non-coop; default QWERTY; discrete key down+up taps (held-key behavior tested separately); non-Omniform move learning; full single-move replacement with move cap 4 or 5; reward/shop with a frozen `ModifierTypeOption[]`; ordinary non-transfer party targeting; biome market with frozen stock of at most 16; Crossroads after its 500-delay gate; ER World Map selection with 2–5 unique revealed nodes. Concrete observed content IDs usable in examples: `MoveId.NONE=0`, `POUND=1`, `TACKLE=33` (sequential enum), and `BiomeId.PLAINS=1`, `FOREST=5`, `CAVE=13`, `MEADOW=16`, `JUNGLE=27`, `ISLAND=40`, `END=50`.

Stable-identity audit: ConfirmUiHandler already supplies canonical `semanticId: yes/no` (and `summary/pokedex` for full-party confirm), and AbstractOptionSelectUiHandler already supports optional locale-independent semantic IDs. Every target gap is therefore concrete: (1) single move-forget Summary rows expose only moveset cursor/slot and a max-move-count decline sentinel; (2) batch learn rows are text plus internal cursor, including custom Undo/Cancel/Yes/No; (3) reward free/paid options expose only row+column even though an exact existing canonical tuple is available as `{id,tier,upgradeCount,cost,pregenArgs}`; bottom reward actions have only partial/inconsistent Phaser names (`reroll-brn` typo, no lock container identity), not semantic IDs; (4) party slots expose slot ordinal, not Pokémon ID, and dynamically rendered option rows expose no semantic ID (remember-move options are merely ordinals into a recomputed move list); (5) biome-market cells expose only stock index although the same reward tuple exists; (6) every solo/owner/watcher Crossroads OptionSelect list omits semanticId despite using the semantic-capable base class; (7) ER_MAP onward tiles expose only callback `BiomeId`, with no named/data-bearing option object; co-op later recovers node index with `findIndex`; (8) the vanilla biome-link OptionSelect fallback also omits semanticId; (9) registered but currently uncalled ER_MAP_PICKER also has index/BiomeId only. These are all current Phaser identity deficiencies found on the named surfaces.

## Source evidence

### `src/configs/inputs/cfg-keyboard-qwerty.ts`

Default physical bindings, lines 187–238 and 248–315: Arrows/WASD, Space/Z Action, Backspace/X Cancel, Enter Submit, Esc/M Menu, F/T Cycle Form.

### `src/inputs-controller.ts`

Raw down/up and repeat oracle, lines 29, 112–142, 350–430, 450–510: immediate `input_down`, 250-ms interval until release, physical-key locking, DOM-text suppression.

### `src/ui-inputs.ts`

Button dispatch, lines 80–180 and 180–300: SUBMIT then ACTION fallback; menu whitelist; Stats/Cycle routing; target modes where Esc is inert versus MODIFIER_SELECT where it opens Menu.

### `src/ui/ui.ts`

Mode replacement/stack semantics, lines 850–910 and 992–1115: `setMode` clears, `setModeWithoutClear` preserves but does not chain, `setOverlayMode` pushes the old mode, `revertMode` clears current and pops.

### `src/ui/handlers/abstract-option-select-ui-handler.ts`

Canonical semanticId capability and generic vertical graph, lines 20–35, 200–238, 240–322, 396–451: skipped-option filtering, initial cursor, delay, Up/Down wrap, Cancel selects last option.

### `src/ui/handlers/confirm-ui-handler.ts`

Existing canonical exception, lines 30–117: `yes`, `no`, `summary`, `pokedex` semantic IDs; initial Yes; generic Cancel invokes No.

### `src/phases/learn-move-phase.ts`

Single-move causal flow and ownership, lines 130–168, 330–350, 880–1008: empty-slot auto-learn; owner-by-Pokémon `coopOwner`; Confirm -> Summary forget picker -> rejection Confirm; max-move-count decline sentinel.

### `src/ui/handlers/summary-ui-handler.ts`

Single-move raw graph, lines 559–779, 780–862, 1760–1840: entry on Moves/new-move row, cyclic Up/Down across slots plus decline row, Action/Cancel callbacks, Left detour to Stats.

### `src/phases/learn-move-batch-phase.ts`

Batch inputs and owner rules, especially lines 97–146, 188–279, 346–403, 480–580: candidate MoveIds; learning-mon owner drives; watcher renderer is callback-inert; host applies relayed assignments.

### `src/ui/handlers/learn-move-batch-ui-handler.ts`

Batch three-state graph and mutation order, lines 189–233, 230–390, 536–816: pickNew/pickSlot/confirmCancel, disabled Omniform offers, commit/thin, Undo snapshot restore, finish/fallback.

### `src/data/elite-redux/omniform-movesets.ts`

Excluded UI-open mutation, lines 287–330: `getOrRollFormMoveset` seeded-rolls and persists a missing non-base form moveset on first access.

### `src/ui/handlers/modifier-select-ui-handler.ts`

Reward/shop graph, lines 257–501 and 502–783: input animation gate, dynamic row ordering, conditional bottom buttons, horizontal wraps, Up/Down row projection and Math.round; partial Phaser names at lines 65–170; affordability coloring at 780–810 and 1176–1185.

### `src/phases/select-modifier-phase.ts`

Reward callback/failure/party replacement, lines 472–551, 635–829, 832–962, 1210–1360: skip overlay, action meanings, affordability rejection, targeted picker and return, owner/watcher rules.

### `src/modifier/modifier-type.ts`

Existing content identity, lines 161–345 and 3628–3637: stable `ModifierType.id`; generated-type behavior; option tier/upgrade/cost with cost `Math.round` and safe-integer clamp.

### `src/data/elite-redux/coop/coop-reward-options.ts`

Exact already-existing reward/market option projection, lines 30–69 and 78–124: `{id,tier,upgradeCount,cost,pregenArgs}` serialization/reconstruction; this should be the canonical logical option identity, plus occurrence/stock index.

### `src/ui/handlers/party-ui-handler.ts`

Party target/cancel graph and identity gaps, lines 120–227, 440–480, 850–955, 979–1210, 1216–1455, 1490–1525, 1670–1710, 1744–1935: slot/cancel geometry, dynamic suboptions, filters, callback indices, no per-row semantic IDs.

### `src/ui/handlers/biome-shop-ui-handler.ts`

4x4 market graph, lines 180–220, 300–548 and 540–660: index identity, hard directional edges, always-visible dimmed sold/unaffordable cells, Action/Cancel callbacks, overlay hiding.

### `src/phases/biome-shop-phase.ts`

Market callback/mutation and replacement order, lines 387–531, 1454–1651, 1720–1765: validate stock/money, target overlay, apply/deduct then decrement stock, confirmation leave, reopen on cancel; alternating co-op owner.

### `src/phases/er-crossroads-phase.ts`

Crossroads menu and terminal, lines 252–290, 469–520, 650–690, 1115–1145: static Stay/Leave order, 500 delay, no semantic IDs in solo/owner/watcher, Stay mutation versus Leave -> SelectBiome chaining.

### `src/ui/handlers/er-map-ui-handler.ts`

Current biome picker graph, lines 297–330, 430–520, 557–690: revealed-only onward list, render cap, nonwrapping Left/Right, Action commit, swallowed Cancel, MESSAGE replacement before callback.

### `src/phases/select-biome-phase.ts`

Selection policy/ownership, lines 270–495, 640–735, 1674–1761: ER_MAP only when >1 revealed route; deterministic otherwise; co-op owner drives/read-only watcher; vanilla OptionSelect fallback lacks semantic IDs; node index recovered from BiomeId.

### `src/data/elite-redux/er-biome-routing.ts`

Route-node input contract and IDs, lines 249–343 and 333–395: `{biome,revealed,source}`, unique chosen biomes, seeded pre-roll, hidden/revealed policy, event-route append.

### `src/ui/handlers/er-map-picker-ui-handler.ts`

Registered alternate picker, lines 165–333 and 329–357: shows hidden `???`, selects only revealed indices, Up/Down no wrap, Action callback by BiomeId; no production phase callsite found.

### `src/enums/biome-id.ts`

Explicit numeric biome IDs, lines 1–44.

### `src/enums/move-id.ts`

Sequential numeric MoveId enum, lines 1–73 establish NONE=0, POUND=1, TACKLE=33.

## Architecture and contract guidance

## Observed raw-key graphs

### 1. Single move learning (`CONFIRM -> SUMMARY -> CONFIRM`)
- `LearnMovePhase.start`: if already known, end; if `moveset.length < maxMoveCount`, auto-learn into the next slot with no menu. The graph exists only for a full moveset.
- First Confirm options are `[yes, no]`, initial `yes`. Generic OptionSelect edges: Up/Down toggle/wrap; Action invokes current; Cancel forces last (`no`) then invokes it. `yes` replaces MESSAGE with SUMMARY; `no` enters the stop-teaching confirmation.
- SUMMARY canonical state observed is cursor `0..M`, where `M=getMaxMoveCount()`. Entry cursor is `M`, the extra new-move/decline row. Up: `0->M`, else `i->i-1`. Down: `M->0`, else `i->i+1`. Action on `i<M` calls `moveSelectFunction(i)` (forget that exact moveset slot); Action on `M` recursively behaves as Cancel. Cancel calls the callback with `M`. Left exits move-select to Stats without resolving; Right can return to Moves. Stats/C cycles display pages only.
- After decline sentinel `M`, second Confirm asks whether to stop teaching: initial Yes ends without learning; No re-enters the initial replacement question; Cancel invokes No.
- Representative taps: `Space, Down, Space` = accept replace prompt, wrap from decline row to forget slot 0, commit. `Space, Backspace, Space` = accept replace prompt, decline at Summary, accept stop teaching. Releases between taps are required.
- Stable proposed Rust identities: `replace_yes`, `replace_no`; `forget_slot:{i}`; `decline_move:{MoveId}`. Observed Phaser gap is the Summary rows/sentinel, not Confirm's Yes/No.

### 2. Batch move learning
State `pickNew` entry is `(cursor=0, learnedAny=false)`. Rows are `[MoveId candidates...] [Undo iff learnedAny] [Cancel]`; Up/Down are bounded, not wrapping. Action candidate: if a free slot exists, assign immediately; otherwise enter `pickSlot` with slot cursor 0. `pickSlot` has exact slot identities `0..M-1`, bounded Up/Down, Action overwrites, Cancel returns to `pickNew` without mutation. After a normal learn, the candidate is removed; if none remain, finish. After any learn, Cancel finishes immediately. Before any learn, Cancel enters custom `confirmCancel` with cursor 0=No, 1=Yes; Left/Right toggle; Action Yes finishes, No returns; Cancel returns.
- Undo restores the exact base moveset snapshot and original candidate list and remains open.
- Omniform candidates remain focusable when disabled/dimmed; Action errors. F/CYCLE_FORM changes target form and aborts an in-progress slot pick. Opening the Omniform panel can seeded-roll missing form stores; exclude it from M4 raw-key golden cases.
- Examples: with full moveset and candidates `[POUND(1), TACKLE(33)]`, `Space, Down, Space` assigns POUND to slot 1. `Backspace, Right, Space` exits without learning. Proposed row IDs: `learn_move:{MoveId}`, `undo_all`, `cancel_learning`, `replace_slot:{i}`, `confirm_cancel:no|yes`.

### 3. Reward + ordinary shop (`MODIFIER_SELECT`)
Logical rows: `r=0` actions; `r=1` free rewards (or a Continue terminal if empty); `r>=2` paid rows in reverse storage order (`r=2` is the bottom/second paid row when 2 rows exist; `r=3` is first/top). Action row identities are `c0=reroll`, `c1=manage items` (hidden unless transferable held item exists), `c2=check team`, `c3=lock rarities` (hidden unless Lock Capsule exists). Reroll/check are shown after animation; reroll may be disabled (`rerollCost<0`) or unaffordable but remains focusable and errors. Paid items remain focusable; unaffordable price is red and selection errors.
- Input is completely rejected until all reward/shop animations and tutorial complete.
- Horizontal item-row edges wrap first<->last; special empty reward row moves Right to action row. Action-row Left/Right is a conditional cycle skipping hidden transfer/lock. Up/Down changes rows and maps the column by `round(c/(oldN-1)*(newN-1))`, then applies hidden-button guards. Up from top wraps to action row; Down from action wraps to top paid row, except reroll->lock when lock is visible.
- Cancel on a player reward sends `(-1,-1)` to the phase, which opens an overlay Confirm. Yes ends/skips; No calls `resetModifierSelect`. The overlay has semantic Yes/No; the reward options do not.
- Exact option identity already exists outside the UI: serialized tuple `{id,tier,upgradeCount,cost,pregenArgs}`. Because duplicates are allowed, canonical menu identity must also include surface generation/reroll and occurrence or row+column; type ID alone is insufficient.
- Representative default entry (`ShopCursorTarget.REWARDS`, reward 0): `Space` selects reward 0. `Up, Space` selects paid stock 0 for a one-row shop. `Down, Space` invokes reroll. `Backspace`, wait for Confirm, `Space` confirms skip.

### 4. Party target/cancel overlay
For ordinary targeted reward/market modes (not item management), visible main nodes are party slots `0..P-1` and Cancel node `6`; missing party slots are absent. Entry is slot 0. Vertical edges are a cycle `0 -> 1 -> ... -> P-1 -> 6 -> 0` under Down, reverse under Up. With battler count `B`, Right from an active slot `<B` goes to remembered backup (default `B`) if `P>B`, else Cancel; Left from a backup goes to remembered active (default 0); Left from Cancel goes to active; other horizontal directions are no-ops.
- Action on a Pokémon does not commit directly: it opens a vertically wrapping option list. Ordinary modifier first option is `PartyOption.APPLY=3`; TM is `TEACH=4`; move slot options are `3000+i`; ability slots `5000+i`; remember-like move options are only ordinal `i` into a freshly obtained move list. Option Cancel only closes options. Action on the terminal option evaluates the filter: failure closes options and shows text, success callback is `(partySlot, PartyOption)`.
- Main Cancel/Action-on-node-6 invokes callback `(6,CANCEL=-1)`. SelectModifier detects slot>=6 and reopens MODIFIER_SELECT/BIOME_SHOP. No stock/reward/money is consumed. `setModeWithoutClear(PARTY)` preserves the underlying reward handler; returning with `setMode` clears Party. Biome market first explicitly hides/deactivates its opaque handler, then its no-args `show()` restores it.
- Representative target 1: `Down, Space, Space`. Cancel target overlay: `Backspace`. Stable gap: party slot is positional, not Pokémon runtime/save identity; no PartySlot or dynamic option semantic ID. Proposed canonical snapshot IDs: `party_slot:{slot}:pokemon:{id}` plus `party_cancel`; suboption by PartyOption, move slot, ability slot, or actual MoveId (never remember-list ordinal alone).

### 5. Biome market (`BIOME_SHOP`)
Nodes are stock indices `0..N-1`, laid row-major in 4 columns. Entry 0. Left/Right/Up/Down are hard bounded: `i±1` only within the same row and existing count; `i±4` only when existing. No wrapping. Action always reports success at the handler and calls `onSelect(i)`; phase then rejects missing, sold-out, or unaffordable stock with error. Sold/unaffordable nodes remain visible and focusable; non-hovered ones dim, hovered one is lit. Cancel calls `onSelect(-1)`.
- Phase purchase order: validate option/stock/money -> set `pendingIndex` -> apply targeted/non-targeted modifier -> base purchase applies modifier and money -> subclass decrements stock only after successful apply -> reopens/stays in market. Party cancellation never reaches apply/decrement. Leave Cancel hides market and opens Yes/No Confirm; Yes clears/reverts to MESSAGE and ends, No reopens same stock/cursor.
- Representative with `N>=6`: `Right, Down, Space` buys index 5. `Backspace`, wait for Confirm, `Space` leaves. Canonical identity should reuse reward tuple plus `stock_index`; current cells have neither semantic name nor data.

### 6. Crossroads
Exact option order is index 0 Stay, index 1 Leave. Entry 0. A configured 500 delay blocks Action/Cancel (errors) but does not block Up/Down. Up and Down both toggle/wrap for two options. After the delay, Action commits current. Cancel forces/invokes the last option, therefore Cancel means Leave, never dismiss. Solo, co-op owner, and read-only watcher all construct options without semantic IDs.
- Mutation order: handler clears itself after accepted option; phase first sets UI MESSAGE. Leave sets `leaveBiomeNow`, unshifts SelectBiomePhase, ends; Stay calls `erMarkBiomeStay(sourceWave)`, ends. Co-op owner is shared-counter parity; watcher is mirrored/inert and authoritative result is relay. Crossroads Leave pins the same owner/counter into biome selection, making the chain one interaction.
- Representative: after actionable, `Space` Stay; `Down, Space` Leave; `Backspace` Leave. Held Backspace can emit at 0/250 ms while blocked and again around/after 500 ms, so the eventual repeat may Leave. Proposed semantic IDs are `crossroads_stay` and `crossroads_leave`; observed wire identity is `optionIndex 0|1` and `COOP_CROSSROADS_SEQ_BASE+pinned`.

### 7. Biome selection
Current production ER routing uses `UiMode.ER_MAP`, not registered ER_MAP_PICKER. Phase filters to `revealed`; zero revealed is fail/closed fallback, one revealed auto-resolves without a menu, >1 opens ER_MAP. ER_MAP again filters unrevealed nodes completely. It renders/selects only the first `min(5+CartographersLensExtraNodes, onward.length)` nodes. Thus hidden=false nodes are absent, while any revealed nodes beyond that cap are silently unreachable—an explicit current policy/gap.
- Entry node ordinal 0. Left/Right are nonwrapping bounded movement, but in pick mode return true even at a boundary. Up/Down return false. Action resolves current node; Cancel is swallowed and returns true (no backing out). Commit order: set `resolved`, deactivate handler, set UI MESSAGE, invoke callback with BiomeId; phase records/applies and queues SwitchBiomePhase.
- Co-op owner is parity-pinned (or inherited from Crossroads); watcher opens same handler with inert callback and applies relayed `{nodeIndex,biomeId}`. The UI returns only BiomeId; owner later derives nodeIndex via `revealed.findIndex(n.biome===chosen)`. Route construction de-duplicates biome IDs, so this is currently unique, but identity is not exposed by Phaser.
- Example supplied snapshot `[PLAINS(1), FOREST(5)]`: `Space` chooses biome 1; `Right, Space` chooses biome 5; `Backspace` has no effect. Proposed canonical node identity is both `node_index` and numeric `BiomeId`, with source/revealed as presentation metadata.
- Vanilla non-ER MapModifier link fallback is an OptionSelect with biome-label callbacks and a 1000 delay; it also omits semanticId. Registered ER_MAP_PICKER has a different Up/Down nonwrapping graph and shows unrevealed nodes as `???`, but no phase callsite was found; do not use it as the current production oracle.

## Held/repeat and failure boundaries
- Immediate first `input_down`, then wall-clock 250-ms repeats, until keyup. The physical lock suppresses browser repeat keydowns but not this interval. The interval addresses a Button, not a menu generation. Consequently held Space can select a reward, then 250 ms later open Party options, then 250 ms later commit APPLY; held Cancel can cross into a Confirm. Oracle sequences must model down/up, not only a stream of abstract presses.
- Esc is MENU, not Cancel. It opens pause only from whitelisted modes such as MODIFIER_SELECT; it is inert in PARTY, SUMMARY, LEARN_MOVE_BATCH, BIOME_SHOP, OPTION_SELECT, and ER_MAP. Backspace/X is the logical Cancel.
- Callback stop conditions: a raw-key oracle may assert cursor/mode/callback arguments. It must not assert modifier application, party filter result, learn mutation, or biome phase success unless the exact callback dependencies/state are supplied. Reward and market callbacks legitimately return false and leave/reopen input; party filters are runtime callbacks; co-op watcher handlers are intentionally cosmetic. Batch `show`/input catches exceptions and schedules per-move fallback. Biome/Crossroads co-op recovery and timeout deterministic fallback are not part of the clean raw-key subset.
- RNG: no target handler draws during ordinary key navigation. Freeze externally generated reward option arrays, market stock, and route nodes. Row interpolation uses `Math.round`; modifier option construction rounds cost with `Math.round` and clamps to `MAX_SAFE_INTEGER`. Omniform first-open rolls use `makeSeededRandInt(rollSeed(mon, formKey))` and mutate the persistent store; defer from M4 unless the form stores are preinitialized.
