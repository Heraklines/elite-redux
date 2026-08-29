# M7.2 error policy

All lab operations are fail-atomic. Rejection leaves sessions, virtual time, prepared content, caches, presets, artifacts, experiments, corpus, and external effects unchanged except for an explicitly bounded diagnostic event.

| Failure | Required result |
|---|---|
| Wrong bootstrap seat | Reject raw input; no mutation |
| Stale bootstrap menu instance | Reject; no mutation |
| Hidden or disabled bootstrap option | Reject; retain menu |
| Held key crosses bootstrap menu | Suppress until keyup |
| Unsupported startup mode | `UNSUPPORTED_MODE`; no fallback |
| Invalid starter cost/challenge/form/ability | Typed legality evidence; no selection |
| Duplicate confirmation | Idempotent identical material; conflicting bytes fail |
| New-run material digest mismatch | Reject before state replacement |
| Replica new-run material failure | Recovery or shared terminal; never local construction |
| Scenario unknown field/schema | Reject before construction |
| Scenario exceeds bound | Reject before allocation |
| Unsupported scenario family/content | Explicit unsupported error |
| Invalid-negative scenario in normal session | Reject session creation |
| Synthetic scenario used for parity claim | Reject report classification |
| Mid-flight scenario synthesis | `REPLAY_REQUIRED` |
| Constructor or validation failure | Discard candidate completely |
| Host/guest scenario mismatch | Reject shared scenario before session creation |
| Preset duplicate identity | Reject duplicate |
| Preset content drift | Reject before cache insertion |
| Artifact absolute/traversal/escape path | Reject without filesystem access outside root |
| Artifact digest/size mismatch | Reject artifact |
| Artifact or cache quota | Evict deterministic unpinned oldest or reject |
| Search empty/oversized query | Bounded validation error |
| Search unknown kind | Explicit method/parameter error |
| State query exceeds visibility | `ACCESS_DENIED` |
| Unknown control option | Typed unknown-option evidence |
| Navigation stale instance | Reject plan |
| Navigation hidden/disabled target | Typed unreachable error |
| Navigation graph has no path | `NO_NAVIGATION_PATH` |
| Warm daemon duplicate session | Reject duplicate; retain original |
| Warm daemon post-close request | `SESSION_CLOSED` |
| One session fails | Other sessions unchanged |
| Experiment cartesian overflow | Reject plan before expansion |
| Experiment budget exhausted | Return completed deterministic prefix and report |
| Explorer budget exhausted | Return coverage reached and best retained traces |
| Failure fingerprint malformed | Reject cluster insertion |
| Fingerprint collision with differing canonical fields | Invariant failure |
| Counterfactual undeclared dimension | Reject candidate |
| Counterfactual objective not reproduced | Reject candidate |
| Bisect revision outside allowlist | Reject before Git/build operation |
| Bisect schema incompatibility | `INCOMPATIBLE`, never GOOD |
| Bisect build failure | Explicit BUILD_FAILED; do not classify gameplay |
| Regression missing capsule | Gate failure unless active waiver |
| Regression waiver expired | Gate failure |
| Unknown mutation operator | Reject mutation plan |
| Mutation candidate invalid | Reject candidate; continue bounded plan |
| Surviving linked mutation | Mutation gate failure |
| Incremental fragment invalid | Reject candidate pack |
| Candidate content identity mismatch | Reject reload |
| Reload migration/replay divergence | Incompatible at first event/path |
| Live-session content replacement without proof | Reject |
| Native code hotpatch request | `METHOD_FORBIDDEN` |
| Architecture manifest duplicate current owner | Gate failure |
| Production legacy/fixture/lab import | Gate failure |
| Decompression limit | Abort and reject before further allocation |
| JSONL malformed/oversized | Bounded error; daemon continues |
| Arbitrary command/script/callback request | `METHOD_FORBIDDEN` |
| Internal event/time budget | Stop with capsule-eligible diagnostic |
| Teardown repeated | Idempotent success |

Panics are never gameplay fallback. A normalized caught panic may be fingerprint evidence; it must not terminate unrelated warm sessions.
