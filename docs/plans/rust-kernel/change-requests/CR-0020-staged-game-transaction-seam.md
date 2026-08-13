# CR-0020: stage game mutations inside the kernel transaction

Status: approved by the integration owner during final M3 hosted benchmark
calibration.

## Problem

The frozen public `GameRuntime` reducers are individually atomic: each clones
the complete runtime, applies one operation, validates it, and swaps it back.
The production Battle kernel already owns a larger clone/drain/validate/swap
transaction around the same operations. Calling the individually atomic
reducers from that private candidate duplicated both the runtime clone and the
full transactional validation several times during one external input. Hosted
measurement of the required 10,000-turn workload exceeded its normative
ceiling even after benchmark setup, checksums, and teardown were kept outside
the measured transition interval.

The kernel cannot call `er-game` private reducer bodies directly because the
crate graph intentionally places `er-game` below `er-kernel`. A narrow
cross-crate staging capability was therefore missing from the frozen contract.

## Decision

Add doc-hidden `GameRuntime` methods whose names end in
`_in_kernel_transaction` for the seven game-owned mutations used by
`BattleTransaction`: UI reduction, exact UI-selection synchronization,
authority game reduction, replica command retention, replica replacement
retention, common material installation, and pending no-legal-replacement
consumption.

These methods may be called only on the private game candidate owned by
`BattleTransaction`. They invoke the existing private reducer bodies without
performing a second clone or an intermediate full validation. Any error poisons
that candidate and requires the enclosing transaction to discard it. The
kernel drains the complete typed FIFO and performs one full
`GameRuntime::validate_transactional` before publishing any state or effect.

`BattleMode` stores its already-validated game owner in `Arc<GameRuntime>`.
Protocol-only, presentation-only, timer, and key-release inputs share it. The
first game mutation in an external input uses `Arc::make_mut`, preserving the
same fail-atomic clone-and-swap boundary while avoiding an eager game clone for
inputs that cannot change game state. A transaction-local dirty flag is set by
that sole mutable accessor and is cleared before the candidate becomes live.

The original public atomic reducers remain unchanged in behavior and continue
to clone, validate, and swap for callers that do not own the enclosing kernel
transaction.

## Compatibility and ownership

This correction adds no dependency, wire message, serialized field, schema
version, operation grammar, digest domain, semantic campaign helper, or failure
outcome. Snapshots contain the same owned `GameRuntime` value rather than the
process-local `Arc` or dirty flag. Only the integration owner may call or change
the doc-hidden staged seam from `er-kernel`; campaign, simulator, benchmark,
and Wasm adapters remain behind `GameKernel`.

## Acceptance evidence

- source-negative audit enumerates all seven staged calls and rejects direct
  use of the individually atomic UI/game reducers from `BattleMode`;
- every mutable game access sets the transaction-local dirty flag;
- unchanged game owners skip redundant validation, while every changed owner
  receives one quiescent validation before publication;
- public `GameRuntime` reducer tests retain their atomic rollback behavior;
- the required hosted benchmark measures the unchanged production workload
  below its ceiling; and
- the exact-SHA hosted Rust Kernel Gate is green.
