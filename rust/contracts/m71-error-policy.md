# M7.1 Error Policy

All developer-plane operations are fail-atomic. A rejected request leaves the game machine, virtual time, evidence, checkpoint store, lineage, telemetry, artifact store, and external effects unchanged unless the error itself is an explicitly retained bounded diagnostic event.

| Failure | Required result |
|---|---|
| Mechanical compatibility mismatch | Reject load/restore/replay before owner reconstruction |
| Diagnostic build/adaptor mismatch only | Permit execution; record mismatch in diagnostics |
| Unknown build field | Preserve explicit `Unknown`; never infer compatibility failure |
| Requested observation above policy | Reject without observation or mutation |
| Hidden-state request without permission | Reject; do not return hidden digests or IDs |
| Raw input wrong seat/focus/menu instance | Delegate to M7 rejection; no mutation |
| Semantic-action method name | `METHOD_FORBIDDEN`; no kernel call |
| Unknown JSONL method | `METHOD_NOT_FOUND`; server continues |
| Malformed/oversized JSONL line | Bounded error response when request ID recoverable; server continues |
| Duplicate request ID in flight | Reject duplicate; preserve first request |
| Artifact exceeds inline threshold | Return `ArtifactRefV1` or bounded error |
| Artifact quota exceeded | Reject creation; retain existing artifacts |
| Checkpoint quota exceeded | Evict oldest unpinned entries; reject if no legal eviction |
| Restore invalid snapshot | Reject before replacing live session |
| Seek digest divergence | Stop at first divergent event and return localized evidence |
| Fork allocation failure | Original session unchanged |
| Causal ID collision | Session invariant failure and capsule-eligible terminal diagnostic |
| Duplicate/dangling causal edge | Evidence invariant failure; mechanics remain committed |
| Evidence recorder quota | Evict under policy or stop retaining; never alter mechanics |
| Digest-tree quota | Return truncated tree with explicit flag |
| Capsule corrupt magic/version/table | Reject before blob allocation |
| Capsule duplicate/unknown blob | Reject capsule |
| Capsule decompression limit | Abort decompression and reject capsule |
| Thin capsule content unavailable | `CONTENT_UNAVAILABLE`; no replay attempt |
| Capsule identity mismatch | Reject replay before restoring session |
| Failure oracle not reproduced | Minimization/replay failure, not success |
| Minimizer candidate invalid | Reject candidate and continue within budget |
| Minimizer produces different failure | Reject candidate |
| Minimization budget exhausted | Return best confirmed capsule plus exhaustive report |
| Model request on replica | Reject as protocol violation |
| Model hash mismatch while active | Mechanical compatibility rejection |
| Model output not in legal actions | Reject output before canonical decision |
| Model backend missing | Explicit external-result wait or failure; no fallback decision |
| Renderer/platform diagnostic failure | Record diagnostic; never roll back mechanical state |
| Blocking presentation failure | Preserve M7 renderer-recovery/shared-terminal policy |
| Render snapshot references unknown semantic node | Reject render snapshot only |
| Impact graph unknown source | Select broader mandatory gates |
| Batch entry failure | Return per-environment error; other entries retain deterministic order |
| Mutable-state alias across batch | Invariant failure |
| Reload ABI/content mismatch | Incompatible preflight report; live session untouched |
| Reload migration/replay divergence | Incompatible preflight report at first mismatch |
| Telemetry quota | Evict oldest unpinned events |
| Teardown called repeatedly | Idempotent success |
| Post-teardown request | `SESSION_CLOSED` |

Panic is never a gameplay fallback. A caught normalized panic signature may be a failure oracle; arbitrary panics must not cross the JSONL server boundary or terminate unrelated sessions.
