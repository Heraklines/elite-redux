# M7.1 reproduction, minimization, impact, reload, and performance audit

## Reproduction and minimization

Existing snapshots, external traces, virtual time, fault network, presenter, storage, and first-digest-divergence APIs supply the real execution substrate. Missing pieces are a closed failure oracle, content-addressed capsule, checkpoint index, fork lineage, and deterministic reduction report.

Minimization stages are fixed:

1. confirm exact failure;
2. rebase to nearest checkpoint;
3. ddmin external-event chunks;
4. remove independent network faults;
5. remove presentation/storage/platform outcomes;
6. binary-shrink virtual-time intervals;
7. simplify raw-key sequences while preserving keydown/keyup/focus/repeat rules;
8. apply validated state reducers;
9. slice reachable content.

Candidates execute on isolated forks. Snapshot/state validates before replay. The exact failure-oracle variant and payload must remain equal. Different panic, terminal, digest path, leak, or performance budget is rejection. Attempts, acceptance, digests, elapsed deterministic work, and budget exhaustion are recorded.

Safe reducers remove unreachable bench Pokémon, unreferenced inventory/modifiers, unused faults, and completed history by checkpoint rebasing. Arbitrary field/JSON deletion and semantic-action replacement are forbidden.

## Impact graph

Committed inputs include M7 source catalog, behavior manifest, semantic groups, implementation/proof manifests, oracle/parity fixtures, campaign files, capsule corpus index, benchmark manifest, contracts, and workflow commands.

Edges:

```text
source path/symbol -> catalog identity -> behavior unit -> semantic group
-> Rust symbol -> proof test -> parity fixture -> capsule -> campaign -> benchmark
```

Central state, content identity, canonical encoding, RNG, material, kernel, protocol, save, snapshot, trace, or public API changes select global mandatory gates. Unknown files select broad M0–M7 regression plus all M7.1 contracts. Focused results never remove mandatory commands.

## Reload preflight

Compatibility compares mechanical identity and kernel ABI. Diagnostic build/adapter differences are reported, not mechanically rejected. Preflight loads and prepares candidate content, forks the current snapshot, applies a named migration when required, replays a bounded recent trace tail, validates invariants and control closure, and returns a compatibility report. Live state and artifacts are unchanged. Dynamic library/Wasm replacement is out of scope.

## Performance baseline

M7 G30 run 33191709410 is the immutable compatibility baseline. Older M3 manifests with absent measurements are not accepted timing baselines. G32 records first M7.1 hosted baselines. Hard ceilings follow `m71-performance.md` and use deterministic counters plus repeated same-runner medians.

## Agent protocol and artifacts

JSONL requests are bounded, ordered, atomic, and resilient to malformed input. Large results are local content-addressed artifacts. Artifact paths stay under an owned root; digests, sizes, media types, handle quotas, and close semantics validate before publication.

## Required tests

* noisy 1,000-event trace minimizes deterministically to the same exact failure;
* thin/self-contained capsules round-trip and reject corruption/zip-bomb-style expansion;
* process restart reproduces the failure;
* impact graph selects known tests and broadens unknown/central changes;
* historical regression changes have no false-negative selection;
* reload incompatible result leaves live snapshot byte-identical;
* batch equals independent execution and shares no mutable state;
* disabled/Causal/Full performance and byte-equality gates;
* teardown clears every developer-plane owner.
