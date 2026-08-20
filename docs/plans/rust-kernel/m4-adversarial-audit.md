# M4 Migration and Adversarial Audit

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

Read-only M4-00 migration audit at the assigned fixed oracle/base SHA. The current Rust graph is M3 V1 state: `GameState` is the only state object with an on-wire `schema_version` (`1`); `BattleState` has a `BATTLE_STATE_SCHEMA_VERSION = 1` constant but no serialized version field and no check against that constant; `PokemonState` has neither a version field nor a version constant. `BattleState` owns both parties today. A V2 player-party cutover therefore cannot be a field move in isolation: it changes state validation, every player-side mechanic/menu accessor, mutation replay, battle start, materials, mechanical/kernel/pair digests, restoration snapshots, traces, fixtures, and the opaque protocol admission boundary.

Observed V1 shape and behavior:
- `er-state/src/snapshot.rs:12-87` defines `GAME_STATE_SCHEMA_VERSION = 1`, `GameState { schema_version, content_hash, mode, wave, next_battle_id, run_rng, battle }`, a validating constructor, and a custom `Deserialize` that rejects unknown fields then calls `validate_game_state`. Canonical decode at `:109-119` rejects noncanonical bytes; there is no repair/default path.
- `er-state/src/battle.rs:11-61` defines the otherwise-unused battle version constant and unversioned `BattleState`; `player_party` and `enemy_party` are adjacent fields at `:48-49`.
- `er-state/src/pokemon.rs:148-162` defines unversioned `PokemonState { id, owner_seat, species_id, form_index, level, effective types/stats, hp/max_hp, status, stat_stages, moves, abilities, fainted }`; local invariant checks begin at `:165`. It lacks exp, IVs, base/effective nature, growth rate, and a persistent roster slot.
- `er-state/src/validation.rs:194-242` validates the GameState allocator/wave/battle relationship; `:262-311` validates battle topology; `:314-363` validates both party sizes, Pokemon records, global ID uniqueness, player owners, and ownerless enemies; `:370-389` binds field slot owner to Pokemon owner; `:635-687` treats `PartyIndex` as the current vector index; `:705-865` binds faint/replacement/outcome state to those same vectors.

Required V2 ownership contract (proposed Rust contract, not observed current Rust):
1. `GameStateV2` must be the sole owner of `player_party: Vec<PokemonStateV2>` so the party survives `battle: None` and wave replacement. `BattleStateV2` retains only encounter-scoped `enemy_party`; never retain a second player-party copy or an equality shim.
2. All player-side lookup/mutation must start from `GameStateV2`; enemy-side lookup remains under the active battle. Use one private split-borrow helper/context if needed, but do not expose a second public convention. Pure readers may take `&GameStateV2`; stateful mechanics must stage/commit the complete `GameStateV2`, not just `BattleStateV2`.
3. `BattleStartV1` currently duplicates player state (`er-game/src/runtime.rs:92-114`). V2 must remove `start.player_party`; `player_leads` must address `run_state.player_party`, while the start DTO supplies enemy party/leads and battle topology. Keeping both inputs creates an unresolvable source-of-truth race.
4. Freeze whether nested types carry their own `schema_version`. This is an implementation stop condition: today standalone `BattleState`/`PokemonState` bytes cannot identify V1 versus V2. If the milestone names these wire contracts V2, add and validate discriminants (or explicitly state that only the enclosing GameState version identifies them); do not leave the current unused battle constant.
5. Preserve stable `PokemonId`, owner, and party identity. Do not infer owner from local endpoint, authority seat, field position, or parity except at the explicit interaction-owner operation boundary. `PartyIndex` is currently positional and is embedded in offers/replacements, so party reordering and stable roster identity must be specified separately.

Companion data required before any fixture migration:
- Every player Pokemon needs observed `species_id`, `form_index`, `level`, total `exp`, ordered six `stats` (HP/ATK/DEF/SPATK/SPDEF/SPD), ordered six `ivs`, stored `nature`, `customPokemonData.nature`, and the effective nature (`custom == -1 ? nature : custom`). Existing fields remain required: current/max HP, moves/PP metadata, status, effective types/abilities, fainted, and explicit owner.
- Immutable content must add observed species `growth_rate` and whatever closed nature table/IDs V2 uses. Current content has base stats but no growth rate/nature table, so missing values cannot be reconstructed safely.
- Run-flow ownership needs explicit player-party owner seat/role, pinned interaction counter, pending remote counter if it is restorable, per-stream action ordinal, party slot/roster identity, operation ID, epoch/wave/turn, reward-surface ordinal/surface ID, terminal flag, and global revision. Learn-move/batch additionally needs the Pokemon owner and `ownerIsGuest` evidence where the TS payload uses it.
- Export exact run/battle companion state rather than reading mutable ambient state later: money, modifiers/enemyModifiers, seed/waveSeed, score, ball counts, mystery-encounter save state, last trainer/encounter, biome, battle type/trainer/enemy levels/party, format/arrangement, started/turn command arrays, participant IDs, battle score/loot, battle seed plus private RNG state, scattered money, ER battle-end multiplier/capture/faint histories, and mystery-encounter identity where the selected M4 run slice needs them.
- The 38 published M3 battle cases contain 102 initial Pokemon records; all 102 lack `exp`, `ivs`, and `nature`. These are exporter prerequisites, not values a Rust migrator may synthesize. `game-state-active-v1.json` lacks them too.

RNG and rounding contract:
- The structural V1→V2 migration consumes exactly zero RNG, performs no rounding, and copies `RunRngState`, `BattleRngState`, seed strings, substream state, audit frontier, HP/stats, IVs, nature, level, and exp bit/value-for-value.
- Never generate missing IVs/natures or rebuild stats from base data during migration; generation would require the exact prior seeded draw sequence. Stat recomputation has no RNG only after all callback/modifier inputs are closed.
- Observed TS growth math: `src/data/exp.ts:67-107` uses `Math.floor(levelExp * .325 + mediumFast * .675)` for non-medium growth and floors the >=100 formula; relative exp is total(level)-total(level-1). `src/game-mode.ts:173-178` rounds wave up by tens, computes difficulty/base level, then `Math.ceil(baseLevel / 2) * 2 + 2`. `src/field/pokemon.ts:621-623` derives levelExp; `:2136-2186` floors stat intermediates and invokes modifier/challenge callbacks; `:2217-2219` selects effective nature; `:4757-4771` mutates exp, increments level while below the cap, then clamps exp with `Math.max`. Modifier/challenge/fusion/special-case paths are explicit stop conditions, not defaults.
- Existing battle creation is separate from migration: `er-rng/src/battle.rs:145-201` computes wave offset `wave << 3`, shifts wave-seed character codes, then draws exactly 16 seed characters from the isolated seed-offset stream and restores the run stream. V2 battle start must preserve this order and must not accidentally initialize a battle while merely migrating/restoring state.

Operation identity and owner rules:
- Existing command/replacement/material identities remain battle ID + wave + turn/source occurrence; moving the party must not renumber IDs or change operation strings. `GameState.next_battle_id` allocation/checked increment is enforced at `validation.rs:205-240`; `runtime.rs:329-389` consumes it once at battle start.
- Current battle authority is the first human seat (`runtime.rs:323-360`; validation `:284-307`) and is distinct from Pokemon owner and endpoint local seat. Field ownership is derived from format then cross-checked against Pokemon owner (`validation.rs:370-389`).
- Observed TS co-op interaction ownership: `src/data/elite-redux/coop/coop-session.ts:239-243` maps the pinned counter round-robin (two players: even seat 0/host, odd seat 1/guest); `CoopInteractionTurn.ownerOf` at `:475-484` delegates to that mapping. `advance(fromCounter)` at `:500-535` increments only if the live counter still equals the pinned counter, otherwise returns an idempotent no-op, then folds a strictly-ahead `pendingRemote`; `mergeRemote` at `:550-568` only parks a monotonic remote value and leaves the live counter unchanged. `Pokemon.coopOwner` is explicit/persisted at `src/field/pokemon.ts:8187-8242`; absent owner currently fails open for switch gating (`coop-session.ts:259-276`), but V2 migration must choose/reject explicitly rather than silently defaulting host.
- Learn-move material explicitly includes owner seat and party slot (`src/data/elite-redux/coop/authority-v2/adapters/interactions-learn.ts:107-147`); batch prompt also carries `ownerIsGuest`. Live reward/market/biome operation IDs use the exact four-field grammar `${epoch}:${owner}:${kind}:${address}` and do **not** encode wave. Wave and turn belong to retained authority state/control coordinates. Adapter-only `IREW/IMKT/IBIO` IDs that include wave are not production wire identity. Deterministic biome selection and V2 WAVE/TERMINAL ownership are fixed to authority seat 0. A syntactically valid operation ID is insufficient unless it is the exact current retained control.

Version propagation plan:
- State: V2 Game/Battle/Pokemon wire contract and `game-state-active-v2.json`; reject V1/mixed nested shapes, never serde-default them.
- Battle start: `BattleStartV1`/`BATTLE_START_SCHEMA_VERSION=1` (`runtime.rs:89-102`) must cut over to V2 because player ownership changes.
- Mechanical digest: `er-state/src/digest.rs:11-12,101-118` hashes the complete GameState under `pokerogue-redux/m3/mechanical/v1`; the V2 state requires a new digest/version domain so a V1 digest cannot be misrepresented as V2.
- Materials: `BattleTurnMaterialV1` and `BattleReplacementMaterialV1` embed both complete states and both digests (`er-game/src/material.rs:59-117`). Their schema/type must become V2. Update both er-game constants and the independent protocol constants/manual version checks in `er-protocol/src/battle_material.rs:22-28,235-263` and `replacement_material.rs:287-309`, plus kernel builder constants/literals (`er-kernel/src/battle_authority.rs:1300-1408`). Mixed material/state versions must be terminal malformed/schema mismatch; no auto-upgrade inside authenticated admission.
- Game snapshot: `GameRuntimeSnapshotV2` embeds GameState but has no own schema field (`er-game/src/snapshot.rs:86-95`), so an incompatible state ownership change requires an explicitly frozen successor type (recommended V3) or an explicit contract decision that the nested state alone versions it.
- Kernel snapshot: `RestorableKernelSnapshotV2` schema 2 embeds the game snapshot and includes its complete graph in the kernel digest (`er-kernel/src/snapshot.rs:82-85,299-347,429-447`). Bump root snapshot/type (recommended V3) and kernel determinism domain/version; unchanged leaf V2 DTOs may remain V2.
- Pair snapshot/trace: `RestorablePairSnapshotV2` embeds host/guest kernel snapshots (`er-sim/src/snapshot.rs:389-403`); endpoint/pair trace V2 embeds those roots (`:558-625`) and validates schema 2 (`:1355-1363,1521-1529`). Bump pair snapshot and endpoint/pair trace roots (recommended V3), their recorder/replayer constructors, and pair determinism domain (`:73-75,1248-1300`). Trace entries contain old mechanical/kernel digest chains even when they do not repeat full states.
- Presentation digest can remain unchanged only if presentation events do not change; content pack must bump if growth-rate/nature content is added, and all content hashes/oracle SHA bindings then change.
- The assigned M4 oracle SHA `45c89493e7edec9c4da247a98cd7858b1f015c09` differs from all current hard-coded M3 identities. Cutover sites include `er-content/src/pack.rs:25`, `er-protocol/src/battle_material.rs:23`, `replacement_material.rs:29`, `er-rng/src/audit.rs:9-28`, `er-testkit/src/{fixture.rs,m3_fixture.rs}`, contracts, fixture provenance/manifests, and tests. Do not partially update these independently.

Serde/Value/callback escape hatches:
- Good typed boundary: GameState custom Deserialize validates; material typed decoders canonical-round-trip and deny unknown fields (`material.rs:130-223`).
- Opaque boundary: `er-types/src/protocol.rs:50-55` stores material `payload: serde_json::Value`; authority turns typed canonical bytes into Value then decodes/equality-checks (`er-kernel/src/battle_authority.rs:1292-1325`); replica serializes Value back and only then typed-decodes (`battle_kernel.rs:5186-5262`, `battle_replica.rs:78-139`). Manual protocol admission sees header/identity/digest, not nested state semantics. Both opaque protocol version parsers must reject V1 before semantic installation.
- Legacy `KernelSnapshot.state: Value` (`er-types/src/protocol.rs:640-653`) and `BattleMode::state_value` diagnostics are not restorable authoritative state. V2 must not route migration/restoration through them. `RawFrame::JsonValue`, fault-network `ReplaceField { value: Value }`, and fixture Value patchers are intentionally adversarial/untyped and must terminate at typed decode.
- `resolve_switch`/`apply_switch` publicly take `FnOnce(&BattleState, &SwitchEvidence) -> T` after installing occupancy (`er-battle/src/switch.rs:153-219`). A panic or external callback side effect is not rollbackable, and the callback cannot atomically mutate the new GameState-owned party. Replace this public callback seam with typed switch-in evidence evaluated inside the full-state staged transaction.
- `resolve_turn_trusted_with_finalizer` exposes a callback with `&mut GameState` and `&mut Vec<BattleMutation>` (`er-battle/src/turn.rs:119-166`). Current order is mechanics/RNG sync, finalizer, after-state validation, digest, presentation, mutation replay (`:230-290`). State mutation is safe because `after` is a clone, but external finalizer side effects are not rollbackable. Seal/remove it during V2 and make the game-owned finalization a typed phase.
- `DefensiveAbilityGate` (`er-battle/src/move_effect.rs:97-111`) is another arbitrary callback. `move_pipeline.rs:149-379` clones battle+RNG before it runs and discards those clones on `Err`, but cannot rollback external effects and would expose new Pokemon fields to caller-dependent branching. Use a closed content-owned gate in authoritative resolution; unsupported callback-driven behavior is a stop.

Atomicity/restoration evidence and required preservation:
- Turn/replacement resolution clones the complete before state (`turn.rs:186-290,336-414`) and validates digest/mutation equality before returning.
- Game reducers and installs clone/validate/swap (`er-game/src/runtime.rs:659-665`; `transaction.rs:31-125`).
- Material appliers are pure and return `MaterialApplyResult`; validation order is header/identity/state/digest/RNG/evidence/control/local frontier before cloning output (`material.rs:495-650`).
- Kernel external input uses a cloned `BattleTransaction` and swaps battle/scheduler/terminal only after FIFO quiescence validation (`er-kernel/src/battle_kernel.rs:374-415`).
- Game/kernel/pair restoration constructs fresh owners, validates, re-captures, and requires digest plus complete snapshot equality (`er-game/src/runtime.rs:2873-2968`; `er-kernel/src/kernel.rs:623-699`; `er-sim/src/pair.rs:697-753`). A failed V1→V2 restore must leave the live owner untouched. Never migrate one endpoint of a pair in place.

Adversarial failure classes to require in `m4-adversarial-audit.md`:
- V1 body labeled V2; V2 body labeled V1; missing/unknown nested fields; standalone unversioned Battle/Pokemon payload; mixed V1/V2 before/after material; old digest under new schema; noncanonical JSON; wrong oracle/content hash.
- Player party present in both GameState and BattleState with differing HP/PP/status/order/owner; missing party with active player field occupants; duplicate player/enemy IDs; owner `None`, wrong seat, authority/local-seat substitution, owner drift after transfer; field/faint/control owner mismatch.
- Party reorder while an offer, replacement, learn-move prompt, or material still holds `PartyIndex`; stale party slot identifying another Pokemon; compaction after faint; legacy PID reused as Rust ID; final identity map contradicting array position.
- Mutation replay updates only battle enemy party and silently misses GameState player party; player HP/PP mutation not represented; partial battle-field commit followed by player mutation failure; cloned BattleState but live GameState party mutation; callback error/panic/side effect; forged mutation vector accepted after arbitrary finalizer edit.
- Restore only host or only state while control/history/protocol retains V1 identities; recapture digest mismatch; snapshot nested version accepted under old root; trace replay starts from V2 state with V1 digest chain; pair endpoints on different versions.
- Opaque Value contains extra state fields, reordered/noncanonical bytes, unsafe integers/floats, malicious schema header, or valid digest over semantically invalid state; diagnostic Value accidentally used as authority; old persisted material/snapshot silently repaired.
- Missing exp/IV/nature filled with zero/default/random; stat recomputation under callbacks/modifiers; exp arithmetic wrong floor/ceil order; migration consumes RNG or changes audit sequence; battle-start seed initialization accidentally repeated.
- Stale `currentBattle` read after NewBattle replaces the source-wave identity; more than one unresolved wave transaction; syntactically valid but not-current operation ID; missing/contradictory retained operation/material; duplicate terminal advances interaction counter; early remote counter changes live owner.

Fixture migration inventory:
- Direct state vector: `rust/fixtures/m3/schema/game-state-active-v1.json` plus `schema/manifest-v1.json` (currently advertises battle-state v1 and names the V1 vector).
- Oracle states: every file under `rust/fixtures/m3/oracle/battle-cases/*.json` (38 named in `er-testkit/src/m3_fixture.rs:25-71`) has both `initial_state.canonical` and `expected_final_state.canonical` and must migrate both, preserve both legacy identity maps, and gain observed companions.
- Three cases expose a current unresolved ordering contract: `mixed-side-simultaneous-faint` changes source order `[1,2] -> [2,1]`; `forced-replacement` and `voluntary-switch` change `[1,2,3] -> [3,2,1]`, while the legacy identity maps still retain original party indexes. Rust tests intentionally normalize those back to stable typed order (`er-battle/tests/m3_oracle_differential.rs:9221-9336`). This is a hard stop: M4 must choose source-current array order versus stable roster order and define PartyIndex/roster-slot semantics before fixtures are transformed.
- Publication companions that must be regenerated, never hand-patched: `m3-oracle-manifest.json` (per-file SHA256/publication provenance), `m3-slice-manifest.json`, `m3-coverage-map.json`, `m3-capability-manifest.json`, `m3-benchmark-manifest.json`, and supporting content pack/hash if content changes. `er-testkit/src/m3_fixture.rs:628-810,990-1080` requires exactly 38 ordered cases, two artifacts, exact paths, gap-free axes, shared provenance, hashes, and exact content-pack keys.
- Existing selected numeric content observed across M3 fixtures: species `1, 7, 19, 23, 50, 52`; moves `1, 52, 77, 78, 351, 589`; owners `1, 2, null`. Current immutable ability pack supports IDs `0, 22, 25`; fixtures also preserve effective/passive IDs `41, 50, 61, 62, 67, 75, 95, 101, 290, 5026, 5040, 5076`, which are not authority to declare new mechanics supported. The proposed M4 clean run segment is Classic solo wave 9 completion → wave 10 completion → wave 11 encounter, Town biome ID `0` → Plains ID `1`; any further species/move/item IDs need fresh oracle evidence.

Explicit stop conditions:
- No implementation until V2 nested versioning, persistent-vs-battle-transient Pokemon fields, party order/PartyIndex/roster-slot semantics, and BattleStartV2 source of truth are frozen.
- No fixture migration until exp/IV/nature/custom nature/growth-rate and ownership companions are exported at both initial and final boundaries; zero/default/reconstruction is forbidden.
- Stop on private `enemyModifiers` or `battleSeedState` without an explicit oracle adapter; stop on Phaser/Trainer/MysteryEncounter objects, UI/tween/save Promise continuations, modifier/challenge/fusion/Shedinja/cursed/spliced stat paths, or any callback whose result/order is not closed and observable.
- Stop on missing `Pokemon.coopOwner`, ambiguous unresolved wave transaction, stale currentBattle, missing retained operation/material, or a control that is valid-shaped but not exactly current.
- Do not provide an in-band compatibility shim. If old persisted artifacts must be retained, require a separately versioned, pure offline translator taking typed V1 plus explicit companion data and producing a fully validated V2 owner graph; otherwise fail closed.

## Source evidence

### `rust/crates/er-state/src/{snapshot.rs,battle.rs,pokemon.rs,validation.rs,digest.rs}`

Canonical V1 declarations, missing nested version discriminants, player-party owner, cross-field/owner validation, canonical codec, and complete-state mechanical digest.

### `rust/crates/er-battle/src/{ability_pipeline.rs,action_order.rs,faint.rs,legality.rs,move_effect.rs,move_pipeline.rs,outcome.rs,replacement.rs,resolver.rs,switch.rs,turn.rs}`

Every stateful/read-only battle callsite affected by moving player_party. Includes positional PartyIndex logic, mutation replay, complete transition clones, switch/finalizer callbacks, and defensive-gate escape.

### `rust/crates/er-game/src/{runtime.rs,authority_commands.rs,local_battle.rs,material.rs,party_menu.rs,party_option_menu.rs,replacement_menu.rs,snapshot.rs,transaction.rs}`

BattleStartV1 duplicate party input, battle construction, menus, authority staging, material V1 codecs/appliers, game snapshot V2, and clone/validate/swap owner boundary.

### `rust/crates/er-kernel/src/{battle_authority.rs,battle_kernel.rs,battle_replica.rs,kernel.rs,snapshot.rs}`

Typed-to-opaque material handoff, replica typed decode, full kernel transaction, restorable kernel V2 root, cross-owner validation, digest, and fresh reconstruction proof.

### `rust/crates/er-protocol/src/{battle_material.rs,replacement_material.rs}`

Independent opaque Value admission parsers with frozen oracle SHA/material version constants and manual identity/version checks that must cut over atomically.

### `rust/crates/er-types/src/protocol.rs`

`Material.payload`, network bodies, and legacy KernelSnapshot state are serde_json::Value escape hatches; only the material payload is allowed to cross into typed V2 decode.

### `rust/crates/er-sim/src/{snapshot.rs,pair.rs}`

Restorable pair snapshot V2, endpoint/pair trace V2, pair digest, replay/record roots, and fail-atomic fresh pair restore.

### `rust/crates/er-wasm/src/{m3_parity.rs,m3_schema.rs}`

Public parity constructor and schema registry consume GameState/BattleState/PokemonState and the active V1 state fixture.

### `rust/crates/er-testkit/src/m3_fixture.rs`

Frozen 38-case catalogue, paths, SHA/provenance/publication rules, supporting artifact contract, and exact envelope/content-pack validation.

### `rust/fixtures/m3/schema/{game-state-active-v1.json,manifest-v1.json}`

Direct canonical state vector and schema/version registry requiring V2 successors.

### `rust/fixtures/m3/oracle/battle-cases/*.json`

All 38 initial/final canonical GameState fixtures; 102 initial Pokemon lack exp/IV/nature, and three cases expose source party reordering versus stable Rust order.

### `rust/fixtures/m3/{m3-oracle-manifest.json,m3-slice-manifest.json,m3-coverage-map.json,m3-capability-manifest.json,m3-benchmark-manifest.json}`

Derived publication hashes, provenance, coverage/support claims, and benchmark catalogue impacted by migrated fixture bytes/content identity.

### `rust/fixtures/m3/oracle/content-pack-v1.json`

Current selected content has base stats and IDs but lacks growth-rate/nature companion content needed to validate PokemonState V2 growth.

### `rust/crates/er-battle/tests/{m3_ability_pipeline.rs,m3_action_order.rs,m3_command_legality.rs,m3_faint_replacement.rs,m3_mechanics_properties.rs,m3_move_pipeline.rs,m3_oracle_differential.rs,m3_switch.rs,m3_turn_outcome.rs}`

Battle state constructors, direct party mutations, callback atomicity, positional party behavior, mutation evidence, and oracle adapters that must migrate.

### `rust/crates/er-game/tests/{m3_local_battle.rs,m3_party_menus.rs,m3_runtime.rs}; rust/crates/er-kernel/tests/{m3_authority_commands.rs,m3_material_apply.rs,m3_tail_proof_routing.rs}`

Game/kernel constructor, menu, authority, and material fixture consumers affected by V2 state and material cutover.

### `rust/crates/er-sim/{benches/m3_benchmark.rs,tests/m3_fault_recovery.rs,tests/m3_pair_trace_live.rs,tests/m3_raw_key_coop.rs,tests/m3_raw_key_local.rs,tests/m3_resource_teardown.rs,tests/m3_snapshot_continuation.rs,tests/m3_trace_v2.rs}`

Fixture Value patchers, run_state extraction, party lead/index mapping, snapshot continuation, restore failure, and trace V2 consumers requiring new paths/types.

### `rust/crates/er-state/tests/{m3_battle_state.rs,m3_pokemon_state.rs,m3_validation.rs}; rust/crates/er-testkit/tests/m3_foundation_properties.rs; rust/crates/er-wasm/tests/m3_schema.rs; rust/crates/er-protocol/tests/m3_battle_material.rs`

Schema/serde/invariant/publication/material version tests that must reject mixed/downgraded V1/V2 artifacts.

### `src/data/exp.ts; src/field/pokemon.ts; src/game-mode.ts; src/battle-scene.ts`

Exact TS oracle symbols for growth formulas, effective nature/stat callback boundaries, level-cap rounding, and source run/battle ownership fields.

### `src/data/elite-redux/coop/coop-session.ts; src/data/elite-redux/coop/authority-v2/adapters/{interactions-learn.ts,interactions-reward.ts}`

Exact TS ownership/pinned-counter order, persisted Pokemon owner dependency, party-slot/owner learn material, and owner/ordinal operation identities.

## Architecture and contract guidance

Migration ownership plan and dependency order:

1. **State owner (`er-state`)** freezes and lands the V2 wire graph first: sole `GameStateV2.player_party`, encounter-only `BattleStateV2.enemy_party`, complete `PokemonStateV2` companions, explicit nested-version decision, validation/accessors, canonical codec, and new mechanical digest domain. Add adversarial serde/owner/order tests here. No downstream lane may invent a parallel party accessor.
2. **Mechanics owner (`er-battle`)** cuts every player-side API from `BattleState` to the complete state/context in one change. Centralize side lookup; update ability/order/faint/legality/move/outcome/replacement/switch/turn and mutation replay. Stage the whole GameState for any player mutation. Remove/seal generic callback escape hatches and preserve exact causal order, zero-RNG migration, and mutation evidence.
3. **Game owner (`er-game`)** introduces BattleStartV2 with no player-party duplicate, updates runtime construction and all menus to persistent party indexes, then cuts material DTOs/appliers to V2 and game snapshot to its successor. Preserve `reduce`/GameTransaction clone-validate-swap and exact current control/allocator checks.
4. **Protocol/kernel owners (`er-protocol`, `er-kernel`)** update independent material schema/oracle constants together, retain Value only as authenticated opaque transport, typed-decode before semantic use, update material builders/replica paths, bump kernel snapshot/determinism roots, and keep full BattleTransaction atomicity. There must be no interval where protocol admits V2 but game decodes V1 or vice versa.
5. **Simulation/restore owner (`er-sim`)** bumps pair snapshot, endpoint/pair traces, recorders/replayers, and pair digest root. Restore only by constructing both fresh endpoints/environment and recapturing exact equality.
6. **Oracle/fixture owner (`er-testkit`, exporter, WASM schema)** exports missing companions from the pinned TS oracle, resolves the three party-order cases, generates a new fixture namespace/state vector/content pack, and regenerates every manifest/hash/provenance record. M3 evidence remains immutable; do not patch published V1 files into pretending to be V2.
7. **Consumer/test migration** updates the enumerated battle/game/kernel/sim/WASM/protocol tests and benchmark in the same cutover. Contract tests must cover schema downgrade/mixing, dual-owner drift, positional stale references, callback failure, zero RNG draws during migration, material/snapshot/trace rejection, and restoration leaving live owners unchanged.

Causal install order is therefore `typed V2 state → mechanics → BattleStart/material → opaque protocol/kernel → snapshot/trace → generated fixtures/consumers`. The cutover is complete only when no production `battle.player_party`, `BattleStartV1`, material V1, or V2 snapshot/trace root containing old GameState remains, and no alias/shim/default path accepts old bytes.
