# M8.1 transactional reload policy

A reload is `discover -> verify artifact -> spawn candidate -> capture boundary -> migrate -> restore -> replay tail -> evaluate policy -> freeze route -> replay final tail -> atomic route swap -> bounded acceptance -> retire predecessor`. Failure before swap destroys only the candidate. Failure during the acceptance window atomically routes back to the retained predecessor.

## Generation identity

`KernelGenerationIdentityV1` contains session-local monotonic generation, artifact SHA-256, executable/Wasm SHA-256, source Git SHA, worker ABI, snapshot schema range, content identity, build target, and build profile. Equality requires every field. Generation numbers fence routing; hashes establish immutable provenance.

## Safe boundaries

Capture occurs after one external input reaches internal quiescence. No internal event or prepared transaction may be live. A request/response may not be split. Held keys, repeat timers, protocol leases, queued network packets, pending storage, terminal teardown, and presentation barriers are legal only when fully represented by the restorable snapshot. Presentation settlement itself and pair reconnect generation changes are fenced operations and cannot be split.

## Four policy variants

1. `EXACT_PRESERVATION`: every replayed mechanical, kernel, presentation, effect, and observation digest equals the active generation.
2. `DECLARED_SEMANTIC_CHANGE`: divergence is allowed only for declared behavior-unit IDs and digest classes; state invariants, protocol identity, resource ownership, and all undeclared outputs remain equal.
3. `MIGRATED_COMPATIBLE`: a registered bounded migration path may change snapshot schema; post-migration restore and replay must satisfy either exact or declared-change comparison selected by the plan.
4. `INCOMPATIBLE_REJECT`: candidate is diagnostic-only and can never become active. This is the mandatory result for missing migration paths, undeclared divergence, unsupported ABI/content, unsafe boundaries, or failed validation.

No restart/reset fallback is a successful hot reload. Candidate crashes never terminate the active generation. At most one predecessor is retained, and only until the bounded acceptance deadline or next accepted reload.
