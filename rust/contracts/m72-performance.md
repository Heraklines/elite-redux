# M7.2 performance and retention

## Hard warm-path ceilings

Measured after content preparation on the hosted Linux runner class:

| Operation | Ceiling |
|---|---:|
| Named preset session creation | 20 ms |
| Snapshot restore | 20 ms |
| Stable scenario construction | 250 ms |
| Navigation planning | 2 ms |
| State/control query | 5 ms |
| 10,000 JSONL queries | 2 s |
| 1,000 session forks | 10 s |

Content preparation, Rust compilation, cross-version builds, and daemon startup are measured separately. Missing measurement is never zero or green.

## Deterministic counters

Every timed workload also reports deterministic counts and checksum: specifications, constructor calls, validation passes, sessions, raw events, external events, forks, search nodes, navigation edges, experiment cases, coverage targets, fingerprints, minimizer attempts, builds, mutations, content fragments, replay events, bytes hashed, artifacts retained, and owned resources.

## Sharing and allocation

Prepared content is held once through `Arc`. Scenario and preset caches retain canonical bytes or snapshots, not duplicate prepared packs. Mutable session, RNG, scheduler, protocol, telemetry, and trace state never alias. Search and graph traversal preallocate only after checked bounds.

## Disabled path

With lab evidence disabled, production mechanics perform no lab calls, graph construction, search indexing, fingerprinting, semantic rendering, mutation bookkeeping, or content-diff work. Natural bootstrap performs only production bootstrap work. High-throughput exploration defaults to minimal coverage evidence.

## Retention

All stores are byte- and count-bounded:

- prepared content versions;
- scenario specifications and snapshots;
- preset manifests;
- artifact blobs and open handles;
- session snapshots and traces;
- search indexes and results;
- experiment cases and results;
- coverage-novel traces;
- fingerprint clusters and seed samples;
- counterfactual candidates;
- build/bisect artifacts;
- regression capsules;
- mutation candidates;
- content fragments and reload reports;
- semantic viewer output.

Eviction is deterministic oldest-unpinned-first. Pinned current content, active session sources, corpus entries, and the newest valid checkpoint are never silently evicted. No legal eviction means atomic rejection.

## Teardown

Final resource evidence requires zero sessions, mutable scenario builders, cached snapshots, unpinned content versions, artifact handles, experiment cases, explorer forks, pending fingerprints, bisect worktrees/processes, counterfactual candidates, mutation worktrees, reload candidates, trace writers, and queued JSONL requests. Immutable prepared content may remain only while the warm daemon itself remains intentionally open; daemon close releases it.
