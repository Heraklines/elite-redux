# M4 error policy

Every class is frozen. Workers may not add fallback behavior.

| Failure | Required behavior |
|---|---|
| Wrong-seat raw input | Reject; no state, RNG, timer, or UI mutation |
| Stale menu instance | Reject; no mutation |
| Disabled option | Reject; surface remains actionable |
| Stale action ordinal | Reject; no RNG draw |
| Duplicate identical proposal | Re-ack; no mutation |
| Same operation ID, different fingerprint | Protocol violation |
| Insufficient money | Reject; no RNG draw |
| Invalid or fainted target | Reject; no mutation |
| Unsupported modifier at load | Initialization failure |
| Unsupported encounter content | Initialization or generation failure |
| Unsupported growth rate or nature | Initialization failure |
| Evolution would trigger | Abort complete progression transaction |
| Invalid battle settlement | Abort wave advance |
| Material self-digest or mutation replay mismatch | Shared terminal `InvalidAuthorityMaterial` |
| Endpoint-local before-frontier mismatch after material self-validation | Correlated recovery `LocalFrontierMismatch` |
| Missing predecessor or revision gap | Correlated recovery `MissingAuthorityTail` |
| Battle/run content hash mismatch | Shared terminal `ContentIdentityMismatch` |
| Material kind/schema/oracle mismatch | Shared terminal `MaterialContractMismatch` |
| Malformed or noncanonical material | Shared terminal `InvalidAuthorityMaterial` |
| Duplicate completed material with identical identity | Re-emit existing receipt; no mutation |
| Duplicate revision or operation with different identity | Shared terminal `AuthorityIdentityConflict` |
| Replica state/control/allocator invariant failure after valid local frontier | Shared terminal `ReplicaInvariantFailure` |
| Encounter generation failure | Abort atomic transition |
| Internal event budget exceeded | Kernel invariant failure with replayable trace |
| Snapshot restoration mismatch | Snapshot error; live owner unchanged |
| Oracle mismatch | CI failure only |
| Presentation failure after canonical commit | Preserve canonical state; enter shared kernel terminal `RendererFailure`; never unlock input |
| Missing M3 migration companion | Migration error; no defaults |
| Mixed V1/V2 nested state | Schema error |
| Callback-driven selected content | Unsupported-content failure |

## Failure transaction boundary

An ordinary pre-commit failure discards the staged clone and leaves every live owner and external effect byte-equivalent to the pre-input state.

A failure classified as correlated recovery or shared terminal first discards the failed material/transition clone. Starting from the unchanged live pre-input snapshot, the kernel then applies only the frozen recovery or terminal transition on a fresh clone. That second atomic transition may change protocol recovery state, fences, timers, UI, and terminal state; it must not change canonical mechanics or RNG unless a later valid retained material is applied.

A presentation failure occurs after canonical material commit. It preserves the committed mechanical state and retained authority evidence, keeps human input blocked, and atomically installs `KernelTerminalState::RendererFailure`. It does not reopen the surface or claim the presentation settled.
