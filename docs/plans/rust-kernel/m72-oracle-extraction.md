# M7.2 oracle and boundary extraction

Base: `rust-kernel-m7-devplane-final` at `79e3544029e422deb8389a12f8b75e7f0febfb3e`.
TypeScript oracle remains `399d5d368f0b5642ebf8f45bd8a5e73350fa4de7`.

## Startup oracle

Observed production flow:

1. `src/phases/title-phase.ts::TitlePhase.start/showOptions` owns the title. The title menu is non-cancellable and exposes Continue, New Game, Load Game, Profile, Settings, and gated developer/community entries.
2. New Game opens a mode chooser. Classic launches immediately. Challenge opens a challenge-type chooser. Co-op opens the lobby. Showdown opens its team/pairing flow. Daily/load paths are separate.
3. `TitlePhase.end` pushes `SelectChallengePhase` for Challenge and the co-op host, then `SelectStarterPhase`. A co-op guest skips challenge selection. Showdown bypasses this normal challenge path.
4. `SelectStarterPhase.start` opens `UiMode.STARTER_SELECT`. Solo confirmation then opens save-slot selection; co-op host owns the merged-party launch and the guest follows the authority snapshot.
5. `StarterSelectUiHandler.tryStart` requires a nonempty valid party, opens a confirmation, then offers Youngster, Ace, Elite, and Hell. Mystery is developer-gated. A forced community difficulty and a co-op guest skip local difficulty selection. Showdown defers launch until wager commitment.
6. Normal solo launch therefore follows `Title -> ModeSelect -> optional ChallengeSelect -> StarterSelect -> Confirmation -> DifficultySelect -> SaveSelect -> Complete`.

There is no separate persistent Main Menu stage and no general sprint/cadence screen in the pinned source. M7.2 must not invent them. Setup choices remain an extensible typed map for future oracle screens.

Cancellation:

- Title has no cancel.
- Mode/challenge overlays unwind to title.
- Starter cancel first closes transient search/filter/editor state, otherwise removes the latest pick, then exits to title when empty.
- Confirmation cancel returns to the same starter menu with a fresh menu instance.
- Difficulty cancel returns to starter selection.
- Save cancel returns to title and does not create a run.

Raw-input menu-instance fencing follows `rust/crates/er-kernel/src/input_router.rs` and `rust/crates/er-types/src/ui_menu.rs`; held input may not cross any bootstrap menu replacement.

## Stable scenario boundaries

Constructible foundry boundaries are the actionable `GameControlKindV2` frontiers in `rust/crates/er-types/src/m7.rs`: Title, ModeSelect, StarterSelect, battle command/move/target/switch/replacement, Capture, FullParty, Progression, MoveLearn, Evolution, Fusion, Reward, Market, Scenario, Quest, Faction, Biome, Route, Save, Waiting, and Complete.

Foundry construction is allowed only when the state is quiescent: no prepared transaction, callback in flight, partially applied material, recovery fence, delayed network packet, or partially settled presentation. Those states require `RestorableKernelSnapshotV7`, `ReproCapsuleV1`, or capsule replay.

## Canonical constructors and validators

- `GameStateV5::validate` and `RunStateV3` validation: `rust/crates/er-state/src/m7_state.rs`.
- `PreparedGameContentV1::prepare` and bundle identity: `rust/crates/er-game/src/m7_content.rs`.
- Battle resolution/material application: `rust/crates/er-game/src/m7_runtime.rs` and `m7_material.rs`.
- Run hooks and typed mutations: `rust/crates/er-game/src/m7_run_executor.rs`.
- Progression: `rust/crates/er-progression` and `er-game/src/m7_progression_control.rs`.
- World/biome construction and validation: `rust/crates/er-world`.
- Scenario construction/runtime: `rust/crates/er-scenario`.
- Environment/snapshot restoration: `rust/crates/er-env` and `er-kernel/src/snapshot_v6.rs`.

Missing fallible constructors are added to their owning core crate using core-owned types. Core crates never depend on `er-lab`. `er-lab` may orchestrate constructors but may not duplicate their formulas or deserialize arbitrary state as a successful scenario.

## Control and navigation

`GameControlPlanV2`, `GameMenuV2`, `LogicalMenu`, `MenuInstanceId`, and explicit directional edges are canonical. Hidden options are absent. Disabled options remain visible and cannot activate. Planning uses breadth-first traversal with deterministic direction ordering and returns raw keydown/keyup pairs. It never executes input.

## Search surfaces

Search indexes are derived from prepared content, semantic catalogs, behavior manifests, current state, controls, preset manifests, and regression corpus metadata. Results use stable typed IDs plus human-readable names; callers never need numeric IDs from memory. Indexes are sorted, content-identity pinned, bounded, and invalidated on content replacement.

## Legality evidence

Existing typed sources include `er-battle/src/legality.rs`, command/move/party menu builders, run/progression validators, reward/market/capture/world control projectors, and starter cost/challenge rules. M7.2 normalizes these into closed reason codes while retaining source behavior IDs and structured current/required values. A boolean alone is insufficient.

## Experiment and coverage

Experiments reuse `DeveloperSession`, `BatchEnvironmentV1`, raw `ExternalTraceInputV7`, fault plans, exact assertions, evidence profiles, and deterministic budgets. Coverage identities are behavior unit, mechanic hook, control kind, menu edge, material kind, scenario node, AI branch, protocol transition, and typed state predicate. Disabled coverage records no extra evidence unless its profile requests it.

## Failure fingerprints

Fingerprint inputs are `FailureOracleV1`, the first `StatePathV1` divergence, causal source, terminal reason, normalized panic, behavior dependencies, and content dependencies. Canonical fingerprints exclude seed frequency, timestamps, backend latency, and adapter identity. Clusters retain first, smallest, fastest, count, and sorted seed distribution.

## Content reload

Compilation remains content-only. Candidate fragments are prepared into a complete identity, compared by semantic group, loaded into an isolated fork, migrated through supported schemas, and replayed against the recent tail. Existing sessions stay pinned. Native code hotpatching is forbidden.

## Architecture simplification

The current production owners remain `GameStateV5`, `GameRuntimeV5`, `GameKernelV6`, `GameEnvironment`, the V5 material applier, one input router, one scheduler, one logical menu model, one V6 snapshot writer, and one V7 trace wrapper. Historical versions remain migration-only and may not be imported by current runtime modules. `er-compat` is created only if moving compatibility code produces a measured dependency or compile benefit.

## Security boundary

Scenario files, presets, capsules, JSONL, build/bisect requests, and content fragments are untrusted. Every parser has byte/count/decompression/event/time limits; paths are registry-relative and normalized; arbitrary commands, callbacks, scripts, absolute paths, traversal, symlinks escaping roots, unknown kinds, and unpinned builds fail closed.
