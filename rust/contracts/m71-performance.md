# M7.1 Performance and Resource Contract

## Evidence classes

Mechanical replay equality compares deterministic work evidence, never wall-clock timing.

```rust
pub struct DeterministicCostEvidenceV1 {
    pub internal_events: u64,
    pub hooks_collected: u64,
    pub conditions_evaluated: u64,
    pub selectors_resolved: u64,
    pub query_modifiers: u64,
    pub rng_draws: u64,
    pub mutations: u64,
    pub materials_encoded: u64,
    pub bytes_hashed: u64,
    pub ui_projections: u64,
}

pub struct WallClockPerformanceEvidenceV1 {
    pub total_nanos: u64,
    pub allocations: u64,
    pub bytes_allocated: u64,
}
```

Deterministic counters are hard regressions. Wall-clock gates use repeated same-runner medians and report setup/build/content-load separately.

## Hard ceilings

| Mode | Ceiling |
|---|---:|
| Developer plane disabled | no more than 5% slower than the accepted M7 G30 baseline |
| Causal evidence | no more than 25% slower than disabled M7.1 |
| Full forensic evidence | no more than 5× slower than disabled M7.1 |
| 10,000 JSONL RPCs | 2 seconds native after initialization |
| Typical snapshot fork | 20 ms |
| Thin capsule open/validate | 250 ms |
| Major-subsystem diagnostic digest | 10 ms typical |
| 1,000 idle batch environments | one shared content pack; no duplicated prepared content |

A wall-clock regression fails only against an accepted same-runner-class baseline. Missing measurement is explicit and cannot be treated as zero or green.

## Required attribution

Counters and timing samples name subsystem plus any available behavior unit, content ID, operation ID, transition ID, environment ID, and evidence profile. Unknown attribution is retained as explicit `CoreUnattributed` and is forbidden in selected full-attribution campaigns.

## Bounded resources

Every configured bound includes element and byte ceilings. Checked arithmetic precedes allocation. Required bounded stores:

* evidence recorder;
* causal graph;
* diagnostic digest nodes;
* checkpoint store;
* trace events;
* capsule blobs and decompression;
* telemetry ring;
* artifact registry and open handles;
* JSONL request/response queues;
* model requests and recorded responses;
* platform/render events;
* batch environment count.

Eviction is deterministic oldest-first, preserving pinned session start and newest valid checkpoint. A store with no legal eviction rejects the new entry atomically.

## Disabled-path rule

When evidence is disabled, the game still derives the same deterministic causal addresses where needed for canonical downstream identities, but retains no detailed evidence. The disabled path must not clone full state, serialize diagnostic trees, allocate per-event graph vectors, or compute leaf digests.

## Benchmarks

M7.1 benchmarks must include:

* solo raw-input throughput;
* pair raw-input/network/time throughput;
* causal/full evidence overhead;
* checkpoint creation, restore, seek, and fork;
* capsule thin/self-contained open and replay;
* minimization over a noisy 1,000-event trace;
* JSONL request throughput and artifact references;
* diagnostic major/leaf digest generation and localization;
* impact queries;
* 1,000-environment batch reset/input/observe;
* reload preflight;
* teardown.

Each produces deterministic checksums and work counters in addition to hosted timing/RSS/allocation evidence.

## Teardown

After close:

```text
zero sessions
zero checkpoints
zero retained capsule blobs
zero telemetry events
zero open artifact handles
zero model requests
zero trace writers
zero pair network packets
zero pending presenter/storage operations
```

Close is idempotent. Post-close operations fail without allocating or mutating.

## CI policy

G32 establishes initial M7.1 baselines while enforcing M7 byte parity. G33 adds capsule/minimization/JSONL measurements. G34 runs release-profile performance and resource gates on hosted Linux. Performance evidence artifacts include exact SHA, Cargo.lock hash, rustc, target, profile, features, runner class, workload count, checksum, median, dispersion, peak RSS, allocations, and deterministic counters.
