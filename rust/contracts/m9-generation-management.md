# M9 production generation management

`SessionRuntimePinV1` is persisted before the first canonical mutation and binds session/run, release, complete M8.1 kernel generation identity, mechanical identity, authority, and sequence frontier. Reload, reconnect, recovery, save, and telemetry use this exact identity.

`ProductionGenerationRegistryV1` holds complete signed releases in `BUILT`, `QUALIFIED`, `INTERNAL`, `CANARY`, `STABLE`, `DRAINING`, `ROLLBACK`, or `REVOKED` state with assignment counts, active pin counts, and health. State transitions are monotonic except explicit signed rollback/revocation operations.

Public sessions do not hot swap in M9. New sessions may receive N+1 while active sessions remain on N. Candidate release prefetch is inert. N and N-1 remain cached; pinned older releases remain until their reference count reaches zero. At most three unpinned complete releases are retained.

M8.1 transactional reload remains in native laboratory, development, staging, internal QA, and coordinated simulation. Production bundles do not import or expose build, preflight, reload, rollback, or generation-disposal RPCs. Stale responses are fenced by session, release, kernel generation, request, and protocol connection generation.
