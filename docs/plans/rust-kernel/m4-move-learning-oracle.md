# M4 Move Learning Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

M4-00 move-learning oracle extraction (read-only, exact production TypeScript at the supplied HEAD): select the ordinary, non-fusion, non-Omniform base-species level-up path and a fixed four-slot cap. Smallest concrete content subset: Bulbasaur `SpeciesId=1`, actual `pokemon.level=17`, `LevelUpPhase(lastLevel=16, level=17)`. Production ER initialization overwrites the base table from `ER_SPECIES` while preserving source order; Bulbasaur's exact level-17 candidates are `[34 BODY_SLAM, 447 GRASS_KNOT, 520 GRASS_PLEDGE, 72 MEGA_DRAIN, 124 SLUDGE, 230 SWEET_SCENT]`. The normal level-up path opens one batch panel, not six sequential prompts. Candidate order is deterministic and RNG-free: stable ascending level sort, range filter, then first-occurrence move-ID uniqueness, followed by order-preserving removal of `NONE=0`, already-known IDs, repeated IDs, and unresolved `allMoves` IDs. Important semantic distinction: on the batch path, an empty slot does not learn without player input; ACTION on a candidate places it directly into the lowest append slot without opening the slot submenu. True no-input empty-slot auto-learn occurs only in the legacy/per-move `LearnMovePhase` (including fallback and non-level-up teaching). For a full set, the batch panel enters `pickSlot`, starts at slot 0, and ACTION replaces exactly that slot with a fresh `PokemonMove(moveId, ppUsed=0, ppUp=0)`. No learning RNG, draws, or rounding occur in the supported segment. Co-op control follows the persistent mon `coopOwner` tag (missing tag defaults to host), while authoritative mutation is performed by the host; operation IDs are `${epoch}:${ownerSeat}:${kind}:${pinnedSeq}`, decision ID is the exact same-owner/same-kind immediate successor `pinnedSeq+1`. Deferred as unsupported: Omniform per-form learning/seeded moveset roll, fusion/evolution sources, TM/Memory/Shroom/TM Case/extra-slot item sources, mystery-encounter tutors, Sketch's legacy exception, arbitrary callback effects (achievement stamping, move-learned form change, animation loading, replay recording), and callback/panel failure fallbacks.

## Source evidence

### `src/phases/level-up-phase.ts`

`LevelUpPhase.end` lines 82-108 discovers candidates from `pokemon.getLevelMoves(lastLevel+1)` (or solo Omniform union), maps IDs in returned order, and FIFO-unshifts one `LearnMoveBatchPhase`; lines 109-142 then queues evolution after it. Inputs are party index, `lastLevel`, constructor `level`, and the live Pokémon whose own `level` is the discovery upper bound.

### `src/field/pokemon.ts`

`Pokemon.getLevelMoves` lines 4205-4349: ordinary/base-form source, fusion branches, stable ascending-level sort, upper/range filtering, and `getUniqueMoves` first-occurrence de-duplication. `Pokemon.setMove` lines 4360-4375 constructs a fresh `PokemonMove`, writes persistent `moveset[index]`, and writes the same object into `summonData.moveset[index]` when present. `Pokemon.getMaxMoveCount` lines 2489-2491 is `4 + bonusMoveSlots`. `PlayerPokemon.coopOwner` is declared at lines 8186-8242.

### `src/data/elite-redux/init-elite-redux-movesets.ts`

`initEliteReduxMovesets` lines 1-158 is the actual production mutability boundary: iterates `ER_SPECIES`, translates through `ER_ID_MAP.moves`, drops missing/unregistered moves, preserves ER order, and overwrites `pokemonSpeciesLevelMoves[pokerogueSpeciesId]`. Therefore the vanilla balance table is not the final Bulbasaur oracle.

### `src/data/elite-redux/er-species.ts`

Bulbasaur record lines 109-210: ER species ID 1 and exact source-level level-up entries. At level 17 the ordered raw ER IDs are `34,447,520,72,124,230`; its preceding level-1 entries can supply fixture moves `331,45,74,77`.

### `src/data/elite-redux/er-id-map.ts`

Species mapping begins lines 17-20 with `1 -> 1`; move mapping begins lines 2963 onward and is identity for the selected standard IDs (including shown identity ranges through IDs 520). This grounds the concrete TS IDs after production translation.

### `src/enums/species-id.ts`

`SpeciesId.BULBASAUR = 1` at lines 2-3.

### `src/enums/move-id.ts`

Grounds selected numeric enum identities/names: BODY_SLAM 34, MEGA_DRAIN 72, SLUDGE 124, SWEET_SCENT 230, GRASS_KNOT 447, GRASS_PLEDGE 520; fixture-known IDs include BULLET_SEED 331, GROWL 45, GROWTH 74, POISON_POWDER 77. `NONE=0`; `SKETCH=166` is relevant to the legacy duplicate exception.

### `src/phases/learn-move-batch-phase.ts`

Core level-up phase contract. `filterLearnableMoves` lines 73-95 drops NONE/known/repeats in order. `LearnMoveBatchPhase.start` lines 151-281 uses the real moveset (`getMoveset(true)`), drops unresolved moves, skips an empty offer, snapshots exact move objects, defines assign/revert/done/fallback callbacks, records terminal results, and opens `UiMode.LEARN_MOVE_BATCH`. Co-op lines 291-583 define FIFO per-move fallback, owner selection, authoritative host drive/watch, ordered assignment terminal encoding, timeouts, callbacks, and post-mutation operation commit.

### `src/ui/handlers/learn-move-batch-ui-handler.ts`

Exact raw menu graph. State/setup lines 54-216; row/render/scroll behavior lines 337-534; input state machine lines 536-632; candidate/slot commits lines 645-739; cancel/undo/finish lines 743-794. States are `pickNew`, `pickSlot`, `confirmCancel`; five visible rows; bounded UP/DOWN (no wrap); ACTION and CANCEL semantics described in the architecture field.

### `src/phases/learn-move-phase.ts`

Legacy/per-move behavior and exact full-set prompt flow. `start` lines 103-168 skips an already-known non-Sketch move; empty set auto-learns immediately at append index; full set opens replacement flow. Lines 889-1078 give CONFIRM -> SUMMARY -> replacement, new-move-row decline sentinel `maxMoveCount`, second stop-teaching confirmation, mutation/bookkeeping order, and message/form-change callbacks. Lines 323-800 give co-op owner/watcher and host/guest forwarding behavior.

### `src/data/moves/pokemon-move.ts`

`PokemonMove` constructor lines 29-46 confirms a learned/replacement move initializes `ppUsed=0`, `ppUp=0`, optional max PP override absent; no RNG.

### `src/phase-manager.ts`

`unshiftPhase` lines 425-445 explicitly guarantees FIFO ordering for multiple unshifted phases during one phase execution. Thus normal batch is queued before evolution, and per-move fallback candidates execute in candidate order rather than reverse order.

### `src/data/elite-redux/coop/coop-learn-move-operation.ts`

Typed operation stream. Lines 50-246 define per-runtime ordinal state, host-only commit, owner seat, `TURN_RESOLVE` context, and kind (`LEARN_MOVE` vs `LEARN_MOVE_BATCH`). Lines 270-356 define exact successor decision identity and prompt forwarding. Lines 424-476 show permissive payload validation and rejection/duplicate behavior.

### `src/data/elite-redux/coop/coop-operation-envelope.ts`

Payload schemas lines 315-339: per-move prompt/decision and batch prompt/decision. `makeCoopOperationId`/`parseCoopOperationId` lines 596-630 encode four fields as `${epoch}:${owner}:${kind}:${pinnedSeq}`.

### `src/data/elite-redux/coop/coop-seq-registry.ts`

Exact raw relay bands: per-move forward `9_100_000 + partySlot` (line 77), batch forward/terminal `9_150_000 + partySlot` (line 84), shared per-move mirrored cursor/result seq `9_500_000` (line 134).

### `src/phases/coop-replay-learn-move-batch.ts`

Guest half of owner assignment and raw panel rendering lines 44-390. `ownerIsGuest=true` gives guest the interactive panel but host remains mutation authority; host-owned gives guest a read-only mirrored watcher. Guest terminal is the ordered assignment list; timeout closes watcher, convergence/checkpoint semantics are external.

### `src/data/elite-redux/coop/coop-session.ts`

`coopSeatOfRole` lines 195-198 maps host to seat 0 and guest to seat 1. `coopAttributeNewMon` lines 90-164 is upstream ownership attribution (thrower if room, otherwise emptier side, tie host); move-learning itself does not assign Pokémon ownership.

### `src/phases/party-member-pokemon-phase.ts`

`getPokemon` resolves the current party occupant by `partyMemberIndex` at access time. Move-learning operation payloads identify `partySlot`, not stable Pokémon ID/species; this is an explicit oracle identity gap if party membership can move while a prompt is outstanding.

### `src/data/elite-redux/omniform-movesets.ts`

Deferred bespoke path. `omniformUnionLevelMoves` pools family moves at minimum level; `getOrRollFormMoveset` persists non-base sets. Its separate mulberry32 uses seed `djb2("${mon.id}:${formKey}")`, one Fisher-Yates draw for each `i = eligible.length-1 .. 1`, with `floor(r*(i+1)) % (i+1)`; it does not touch live battle RNG. Excluded from the M4 supported subset.

### `src/modifier/modifier.ts`

Unsupported direct teaching sources: `PokemonAddMoveSlotModifier`, `TmModifier`, `ErLearnersShroomModifier`, `ErTmCaseModifier`, and `RememberMoveModifier` queue `LearnMovePhase` with bespoke pool/cost/bookkeeping semantics (lines 2395-2450 and 2870-2973).

### `src/phases/select-modifier-phase.ts`

`queueCoopProjectedModifierFollowUp` lines 985-1027 reproduces TM, Memory, Shroom, TM Case, and bonus-slot learning tails for co-op. These callback/item-sourced prompts remain outside the selected declarative level-up subset.

### `src/phases/evolution-phase.ts`

`postEvolve` lines 506-518 discovers only `EVOLVE_MOVE` entries using evolution/fusion `LearnMoveSituation` and FIFO-queues per-move `LearnMovePhase`s; explicitly deferred.

### `src/data/mystery-encounters/encounters/bug-type-superfan-encounter.ts`

Unsupported bespoke tutor `doBugTypeMoveTutor` lines 680-733 constructs callback/hover UI, awaits option+Pokémon selection, then queues the selected `moveOptions` move.

### `src/data/mystery-encounters/encounters/dancing-lessons-encounter.ts`

Unsupported bespoke callback `onPokemonSelected` lines 242-255 teaches fixed `MoveId.REVELATION_DANCE` and starts an encounter animation.

### `src/data/elite-redux/er-achievement-tracker.ts`

`erRecordAchievementLearnMove` lines 1237-1248 is an external callback invoked after every assignment: special achievements and a per-run `learnedMoveStamps[moveId]=currentWave`. Explicitly excluded from Rust core move-learning state; note Undo restores moves but does not undo this callback stamp.

### `src/data/pokemon-forms.ts`

The observed move-learned gameplay callback is Keldeo-only in the registry: Secret Sword known/forgotten triggers at lines 418-420. Selected Bulbasaur IDs do not invoke it; callback-driven form changes remain unsupported rather than generalized.

## Architecture and contract guidance

## Proposed M4 Rust contract versus observed TypeScript

### Supported declarative inputs
Use a raw state object, not TypeScript callbacks:
- `party_slot` (integer, fixture 0), stable party snapshot/occupant supplied by caller;
- species/form: base Bulbasaur `species_id=1`, not fused, not Omniform;
- `pokemon_level=17`, `last_level=16`, phase display `level=17`;
- `max_move_count=4` (no `bonusMoveSlots`);
- ordered current move IDs and ordered declarative learnset rows;
- optional co-op `owner_role` explicitly normalized to host when TS `coopOwner` is absent;
- normalized raw menu inputs from `{UP,DOWN,ACTION,CANCEL,LEFT,RIGHT}`.
Return a pure terminal containing final ordered move IDs, ordered assignment occurrences `[move_id,slot]`, declined/reverted status, and the raw menu terminal. Do not execute arbitrary callbacks. Keep operation-envelope construction outside the pure reducer but use the identity/owner rules below.

### Discovery and ordering
Observed causal order:
1. Production initialization overwrites species 1's table from ER content, translating IDs and dropping missing/unregistered entries while retaining row order.
2. `LevelUpPhase.end` calls `pokemon.getLevelMoves(17)`; because `startingLevel=17` is truthy and the live mon is level 17, ordinary base-form collection retains positive rows, sorts ascending by learn level (equal-level comparator returns 0, preserving source order), removes rows above live level and below 17, then retains the first occurrence of each move ID.
3. Exact candidate output: `[34,447,520,72,124,230]`.
4. `LearnMoveBatchPhase.start` reads the real persistent moveset with overrides ignored, then order-preservingly drops `0`, known IDs, repeats, and IDs missing from `allMoves`.
5. Empty output ends with no UI. Non-empty output opens one batch panel. `unshiftPhase` is FIFO; the subsequently queued evolution phase comes after the batch.

Duplicate-known example: with current `[34,45,74,77]`, the exact offer becomes `[447,520,72,124,230]`. With all six known, no panel. In this batch route even known Sketch is filtered; only legacy `LearnMovePhase.start` exempts `SKETCH=166` from its already-known early exit. That divergence is unsupported, not normalized away.

### Exact raw-menu graph
Initial state is `pickNew`, `newCursor=0`, `newScroll=0`, `learnedAny=false`, `pendingMoveId=null`. Left rows are `[remaining learnable IDs in order, Undo iff learnedAny, Cancel]`. Right rows are exactly `maxMoveCount` current slot names, padded `(empty)`. Each column shows five rows; UP/DOWN are bounded and never wrap; scroll shifts only enough to keep the cursor in the five-row window.

Transitions:
- `pickNew + UP/DOWN`: move within left rows.
- `pickNew + ACTION` on candidate: if persistent moveset length `< cap`, commit directly to `slot=moveset.length`; there is no slot prompt. If full, set `pendingMoveId`, enter `pickSlot`, reset `slotCursor=slotScroll=0`.
- `pickSlot + UP/DOWN`: bounded over `0..cap-1`; ACTION commits replacement to exact selected slot; CANCEL discards only the pending selection and returns to `pickNew` with no mutation.
- A normal committed move sets `learnedAny=true`, removes that ID from the offer list, preserves survivor order, and automatically finishes only when no offers remain. Repeated use of the same slot is legal; ordered terminal assignments reproduce last-write-wins.
- `pickNew + ACTION` on Undo: invoke exact snapshot restore, restore original offer list, clear learned occurrences, set `learnedAny=false`, remain in panel. No confirmation.
- `pickNew + CANCEL`, or ACTION on Cancel, while `learnedAny=false`: enter `confirmCancel`, default `confirmCursor=0` (`No`). LEFT or RIGHT toggles 0/1. ACTION on No returns to list; ACTION on Yes finishes unchanged; CANCEL returns to list. Other buttons do nothing/return false.
- With `learnedAny=true`, CANCEL/Cancel-row finishes immediately and retains assignments; it does not ask to discard them. Undo is the only rollback.

Exact compact fixture A (auto-place, then full replacement, multiple offers): start moves `[331,45,74]`, offers `[34,447,520,72,124,230]`. Input ACTION produces assignment `[34,3]`, final-so-far `[331,45,74,34]`, offers `[447,520,72,124,230]`. A second ACTION enters `pickSlot` for 447; `DOWN,DOWN,ACTION` appends occurrence `[447,2]` and yields `[331,45,447,34]`. CANCEL now finishes immediately, terminal occurrences `[[34,3],[447,2]]`.

Exact compact fixture B (known filter and decline): start moves `[34,45,74,77]`; raw candidates above filter to five offers `[447,520,72,124,230]`. Input `CANCEL,RIGHT,ACTION` selects Yes in the default-No confirmation and terminates with no assignments and unchanged moves. `CANCEL,ACTION` instead chooses No and returns to the list; `CANCEL,CANCEL` also returns.

Undo fixture: after fixture A's first ACTION, left rows are five remaining moves then Undo then Cancel. From cursor 0, `DOWN` x5 then ACTION restores exact starting move-object references `[331,45,74]`, restores six offers, and stays open.

### Mutation and causal order
For each assignment, phase callback order is: `pokemon.setMove` (fresh PP state, persistent plus active summon mirror) -> achievement callback -> append assignment/replay bookkeeping -> start async animation initialization. UI `commitLearn` then marks learned, invokes optional teach hook, removes the normal offer, and renders/finishes. On `done`: if at least one assignment, request move-learned form change once; then record replay terminal(s); switch UI mode asynchronously; end phase. For co-op host-drive, form-change request precedes operation settlement/decision commit; commit precedes raw terminal relay and UI close. For guest-owned co-op, guest selection mutates its local presentation copy and sends ordered assignments; host restores its pre-panel snapshot, applies assignments sequentially, requests form change, then commits the decision.

Explicit observable quirk: Undo restores movesets and clears the local assignment list, but cannot reverse already-fired achievement stamps or already-started animation asset loads. Those callbacks are out of M4 core state. Snapshot restoration uses the original `PokemonMove` object references and `splice`, including the summon snapshot only if one existed.

### Legacy per-move path required for oracle comparison, not selected Rust menu
`LearnMovePhase.start` reads the real moveset. A known non-Sketch ID ends silently. If `length < cap`, it immediately learns at `index=length` with no human input (the true empty-slot auto-learn). If full, it shows two messages then CONFIRM. Yes shows the forget question and SUMMARY with existing slots plus a final new-move row at index `cap`; choosing `0..cap-1` replaces that slot. Choosing the row `cap` or saying No begins a second `Stop trying to teach?` CONFIRM: Yes declines and uses `cap` as the decision sentinel; No restarts the initial replace prompt. In fallback loops, one `LearnMovePhase` is FIFO-queued per candidate, so multiple candidates become sequential prompts/auto-learns in original order. This path is retained only as fallback/non-level-up oracle evidence; M4 raw batch reducer must not silently substitute it.

### Co-op identity and ownership
- Ownership of the learning decision follows `pokemon.coopOwner`; absent means host. Party position does not imply owner.
- Batch prompt payload is `{type:'prompt', partySlot, learnableIds, ownerIsGuest}`; decision is `{type:'decision', partySlot, assignments:[[moveId,slot],...], fallback}`.
- Per-move prompt adds `moveId,maxMoveCount`; decision adds `forgetSlot`, with out-of-range/cap meaning decline.
- Only local role host commits durable operations. Owner is seat 0 for host or seat 1 for guest. Logical context is current `(wave,turn,'TURN_RESOLVE')`.
- Presentation operation uses next ordinal; decision must be exact same epoch/seat/kind and `presentation.pinnedSeq+1`. A supplied mismatched address fails. Repeated presentations advance ordinal after the prior exact successor.
- Batch relay channel is `9_150_000+partySlot`; per-move forwarding is `9_100_000+partySlot`; legacy mirrored per-move cursor/result uses `9_500_000`.
- Host-owned: host interactive, guest watcher. Guest-owned: guest interactive, host watcher, but host restores snapshot/applies terminal authoritatively. The terminal encoding is `choice=assignment count`, flat `data=[move0,slot0,...]`; zero/empty means decline; `-1` is panel-fallback sentinel.
- Timeouts are 1,200,000 ms. Per-move null becomes decline/keep current moves. Batch guest-owner null keeps snapshot and commits fallback; watcher null closes. Missing durable prompt/decision, wrong V2 successor, failed terminal settlement, or missing bound runtime calls `failCoopSharedSession` rather than guessing ownership/outcome.

Identity gap: payloads bind a party slot and content, not Pokémon ID/species/owner tag. `PartyMemberPokemonPhase.getPokemon()` resolves the current slot occupant. The oracle cannot infer behavior across a party reorder/replacement while a prompt is outstanding; treat that as a stop condition or require an externally frozen party snapshot. Batch terminal validation checks safe integers but not move existence, learnability, assignment membership, duplicate assignments, or slot bounds before authoritative `setMove`; Rust must not invent validation and still claim TS parity. Keep malformed network terminals outside M4-supported inputs.

### RNG and rounding
Supported ordinary discovery/menu/mutation has zero RNG draws and zero numeric rounding. Ordering is array/map/set insertion plus ascending integer comparisons. `setMove` initializes integer PP counters to zero. The only nearby learning-specific RNG is deferred Omniform first-access moveset generation: private per-mon/per-form mulberry32, not battle RNG, with reverse Fisher-Yates draws. No selected fixture touches it.

### Failure behavior and explicit gaps
- Bad/unregistered candidate IDs are dropped before an ordinary panel. All-filtered means clean phase end.
- Handler show/input exceptions log and defer the `fallback` callback; phase fallback FIFO-queues per-move phases. Solo synchronous fallback uses the original unfiltered candidate list, while co-op fallback uses filtered learnables. There is no guaranteed transactional rollback of partial callback side effects. Callback exception/fallback parity is therefore unsupported.
- UI callbacks (`assign/revert/done/fallback/learnHook`) are arbitrary engine closures. Rust must model only the declarative reducer result; it must not pretend to execute them.
- External effects remain unsupported: `erRecordAchievementLearnMove` (including learned-wave stamps), async animation assets, audio/text/timing, replay recorder, and form-change dispatch. The selected Bulbasaur fixture avoids the only observed `SpeciesFormChangeMoveLearnedTrigger` registry case (Keldeo/Secret Sword), but the callback invocation still exists in causal evidence.
- Defer all non-base sources: Omniform family pooling/per-evolution storage; fused source merging and simulated evolution chains; `EVOLVE_MOVE`; relearn/Memory; TM; Learner's Shroom; TM Case; bonus fifth slot; fusion donor move transfer; Bug-Type Superfan and Dancing Lessons callbacks. Their content/pool legality and side effects are not interchangeable with level-up discovery.
- The TypeScript `LearnMoveSituation.LEVEL_UP` enum exists, but `LevelUpPhase` calls `getLevelMoves` without passing it (default MISC). Do not add situation-based behavior to M4.
- No runtime execution was performed because the assignment forbids tests/builds/fixture generation; all claims above are direct source observations. Remaining unanswered gap for a later executable oracle is only runtime initializer/adaptor serialization proof, not the production TS algorithm or selected concrete IDs.

## G12 parity-slice correction

The source extraction above proves the general batch path with Bulbasaur, but its six candidate moves would unnecessarily expand the reachable battle-content closure. The frozen parity slice instead uses Nacli `SpeciesId=932`, whose post-initialization ER record has Medium Slow growth, evolution threshold 23, and exactly one level-17 candidate: Body Slam `MoveId=34`. Production `BattleScene.getMaxExpLevel` first honors positive test/runtime `Overrides.LEVEL_CAP_OVERRIDE` (`src/battle-scene.ts:3209-3219`), so the composed wave-9 state sets override 17 and restores it after capture.

The explicit composed current loadout is the already supported M3 set `[1,52,77,78]`; it is not claimed as Nacli's natural learnset. Raw input selects the sole candidate and replaces slot 0. Expected result: `[34,52,77,78]`. The exporter must capture exact EXP, IV/nature/stats, UI graph, owner, operation identity, control/menu IDs, loadout provenance, and canonical before/after state.
