# M7.1 Agent-First Developer Plane API

## Mission

M7.1 wraps the immutable M7 game with deterministic inspection, evidence, checkpoint, fork, reproduction, minimization, agent, impact, batch, model-boundary, and render-boundary APIs. It must not change canonical state transitions, RNG draws, Authority material bytes, save bytes, controls, or terminal outcomes.

## Dependency boundary

Developer-plane crates are downstream only:

```text
er-types -> er-dev-types
             |-- er-model
             |-- er-render-model
             `-- er-impact

er-env + er-sim + er-dev-types + er-render-model -> er-devplane
er-devplane -> er-repro -> er-agent-protocol
er-devplane -> er-batch -> er-agent-protocol
```

`er-state`, `er-battle`, `er-run`, `er-game`, `er-kernel`, `er-protocol`, and `er-mechanics` must never depend on any M7.1 crate. Additive observational methods in core crates use core-owned types only.

## Execution identity

```rust
pub struct ExecutionIdentityV1 {
    pub mechanical: MechanicalCompatibilityIdentityV1,
    pub build: BuildDiagnosticIdentityV1,
    pub adapters: AdapterStackIdentityV1,
}

pub struct MechanicalCompatibilityIdentityV1 {
    pub game_content: GameContentIdentity,
    pub protocol_version: String,
    pub game_state_schema: u32,
    pub material_schema: u32,
    pub save_schema: u32,
    pub canonical_model_slots: Vec<CanonicalModelIdentityV1>,
}

pub struct BuildDiagnosticIdentityV1 {
    pub kernel_commit: KnownOrUnknownV1<String>,
    pub cargo_lock_hash: KnownOrUnknownV1<String>,
    pub rust_toolchain: KnownOrUnknownV1<String>,
    pub target_triple: KnownOrUnknownV1<String>,
    pub build_profile: KnownOrUnknownV1<String>,
    pub feature_flags: Vec<String>,
}

pub struct AdapterStackIdentityV1 {
    pub platform: Option<PlatformAdapterIdentityV1>,
    pub renderer: Option<RendererIdentityV1>,
    pub asset_pack: Option<AssetPackIdentityV1>,
    pub model_backends: Vec<ModelBackendIdentityV1>,
}
```

Only `mechanical` controls compatibility. Features and model backends are sorted. Missing build data is `Unknown`, never an empty string. Build-time generation may read CI environment or build-script inputs; runtime code never executes Git.

## Sessions

```rust
pub enum SessionTopologyV1 { Solo, Pair }
pub enum SessionMachineV1 { Solo(Box<SoloSessionMachineV1>), Pair(Box<PairSessionMachineV1>) }

pub struct DeveloperSession {
    pub identity: ExecutionIdentityV1,
    pub topology: SessionTopologyV1,
    machine: SessionMachineV1,
    evidence: EvidenceRecorderV1,
    checkpoints: CheckpointStoreV1,
    lineage: SessionLineageV1,
    telemetry: TelemetryRingV1,
    policy: DeveloperSessionPolicyV1,
}
```

A pair owns two `GameEnvironment`s plus virtual clock, simulated network, transport generations, presenter, storage, and fault schedule. Immutable prepared content is shared through `Arc`; mutable state is never shared.

Public operations:

```text
create / from_snapshot / from_capsule / close
observe / state_delta
raw_input / advance_time / deliver_network_frame
settle_presentation / provide_storage_result / change_transport
suspend / resume
checkpoint / restore / seek / fork
compare / explain / run_invariants
export_capsule
```

Forbidden operations include `choose_move`, `select_reward`, `apply_damage`, `force_capture`, `capture`, and `resolve_turn`.

Every request is atomic. One external event drains deterministic internal work to quiescence under the inherited 4096-event limit.

## Session policy

```rust
pub struct DeveloperSessionPolicyV1 {
    pub maximum_observation_profile: ObservationProfile,
    pub evidence_profile: EvidenceProfile,
    pub maximum_checkpoint_bytes: usize,
    pub maximum_evidence_bytes: usize,
    pub maximum_telemetry_bytes: usize,
    pub allow_capsule_export: bool,
    pub allow_hidden_state: bool,
}
```

Every maximum is mandatory and positive. Policy cannot be escalated after session creation.

## Observations

```rust
pub enum ObservationProfile { Player, Agent, Debug, Forensic }
pub enum EvidenceProfile { None, Causal, Full }
```

Profiles are monotonic: `Player ⊆ Agent ⊆ Debug ⊆ Forensic`.

Player contains only seat-visible state, control, and presentation. Agent adds exact stable option identities, directional navigation edges, accepted physical input patterns, actionable owner, and state delta, but no hidden state or semantic action endpoint. Debug adds canonical hidden state, protocol, timers, RNG, pending materials, and resources. Forensic adds causal graph, digest tree, retained events, performance evidence, and provenance.

Observation is pure. Lower profiles omit hidden leaf digests and stable hidden IDs so they cannot become side channels.

## Evidence invariance

For equal initial snapshot, prepared content, and external trace, `None`, `Causal`, and `Full` must produce byte-identical:

```text
mechanical digests
Authority materials
save bytes
RNG draws
control sequence
terminal result
```

Profiles control retention only. Every deterministic causal ID exists independently of retention.

## Causal graph

Causal IDs are BLAKE3 of canonical deterministic addresses:

```text
session lineage root
external event sequence
operation ID or material digest
evidence kind
local ordinal path
```

No random UUID and no evidence-mode counter is permitted.

Closed node kinds:

```text
ExternalEvent InternalEvent Query RngDraw Mutation Material
ControlInstallation Presentation Timer NetworkFrame Storage
ModelRequest ModelResponse Terminal
```

Closed edge kinds:

```text
Caused Derived Scheduled Applied Presented Installed Transmitted Settled
```

Sources are mechanics behavior/program/hook/ordinal, run behavior/program/ordinal, closed core rule, or Authority material operation/revision. Existing M7 material evidence is adapted; mechanics are never recomputed in the developer plane.

## Diagnostic digest tree

The M7 mechanical digest remains unchanged. M7.1 computes a separate diagnostic tree over typed paths. Major paths include profile, run, party, Pokémon, storage, inventory, modifier, world, scenario, progression, battle, field, mechanics, RNG, protocol, UI, input, scheduler, and presentation.

Causal evidence retains major nodes. Full evidence may retain leaves. A diff descends from the diagnostic root to the smallest mismatching subtree and reports truncation under a caller-provided bound.

## Snapshot and trace V7

```rust
pub struct RestorableKernelSnapshotV7 {
    pub schema_version: u32,
    pub identity: ExecutionIdentityV1,
    pub kernel: RestorableKernelSnapshotV6,
    pub developer: DeveloperSnapshotStateV1,
}

pub struct KernelTraceV7 {
    pub schema_version: u32,
    pub identity: ExecutionIdentityV1,
    pub initial: RestorableKernelSnapshotV7,
    pub events: Vec<KernelTraceEventV7>,
}
```

V7 wraps V6; it does not alter V6 bytes. V6→V7 migration is lossless and uses explicit developer defaults. Trace inputs include every V6 input plus model completion, platform lifecycle, renderer fault, and asset result. Expected evidence separates mechanical, kernel, UI, protocol, scheduler, presentation, RNG, save, diagnostic, causal, and resource digests.

## Repro capsule

A deterministic capsule contains identity, initial snapshot, trace, exact failure oracle, diagnostic checkpoints, optional causal/platform/render/content blobs, and redaction manifest.

Modes are `Thin` and `SelfContained`. The container has versioned magic, canonical manifest bytes, sorted BLAKE3 blob table, and bounded compressed blobs. Timestamps, credentials, cookies, account tokens, unknown blob types, duplicate digests, oversized allocations, and unbounded decompression are forbidden.

Failure oracles are closed: invariant violation, digest divergence, terminal reason, normalized panic signature, resource leak, or performance budget.

## Checkpoint, seek, fork

Checkpoints are created at session start, configured external-event cadence, material application, control replacement, recovery, terminal, and explicit request. Byte bounds evict oldest unpinned entries; session start and the most recent checkpoint are pinned.

Seek restores the nearest checkpoint not after the target, replays the exact trace tail, and verifies expected evidence at every event. Fork shares immutable content and trace prefix, records parent branch/sequence/snapshot digest, and owns a divergent mutable tail. Same future inputs must equal the original continuation.

## Minimization

Minimization confirms the exact failure, rebases to a checkpoint, ddmins external-event chunks, removes independent faults/outcomes, shrinks virtual time, simplifies raw-key sequences, applies validated state reducers, and slices reachable content. Every candidate validates and must preserve the exact `FailureOracleV1`.

Allowed reducers remove unreachable bench Pokémon, unreferenced inventory/modifiers, unused fault events, and completed history via checkpoint rebasing. Arbitrary JSON or field deletion and semantic action substitution are forbidden.

## Agent JSONL

`er-cli agent --protocol jsonl` accepts one bounded JSON request per line and emits one response per line. Requests execute in arrival order and atomically. Notifications use a separate event envelope. Large results use content-addressed `ArtifactRefV1`; inline multi-megabyte payloads are forbidden.

Required method families are protocol hello; session lifecycle/observe/external inputs/snapshot/checkpoint/seek/fork/diff/explain/invariants/performance/capsule/minimize; content/tests affected; and batch lifecycle/input/time/observe. Unknown or semantic-action method names fail explicitly without terminating the server.

## Model boundary

M7.1 defines battle policy, run policy, and difficulty request/response envelopes but no backend. Mechanically active model requests are authority-only. Output must be discrete or quantized, validate against the legal action set, and be recorded exactly. Replicas and replay consume the recorded response. Active model hash participates in mechanical compatibility; backend and latency remain diagnostic.

## Presentation and render boundaries

`PresentationSceneV1` is kernel-owned semantic data with deterministic generation, actors, semantic UI, and presentation envelopes whose IDs derive from material/operation plus ordinal. `SemanticRenderSnapshotV1`, `PlatformTraceV1`, and `RenderTraceV1` are adapter-owned diagnostics. Pixels, Phaser objects, WebGPU resources, shaders, and asset paths never enter mechanical state.

## Impact and batch

The impact graph links source path/symbol → catalog identity → behavior → semantic group → Rust symbol → proof test → fixture/capsule/campaign/benchmark. Central state/material/RNG/kernel/protocol changes always escalate to global gates. Unknown changes fail broad.

Batch execution shares immutable content, sorts by environment ID, isolates mutable state, and begins as a single-thread deterministic reference. Evidence sampling cannot affect mechanics.

## Reload preflight

Reload compatibility compares kernel ABI and mechanical content identity. Candidate content is loaded and prepared, an isolated current snapshot is migrated, recent trace is replayed, and invariants/control closure are compared. Live state is never mutated. Dynamic native/Wasm code replacement is outside M7.1.
