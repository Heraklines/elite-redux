# CR-0011: full recovered-entry staging boundary

Status: approved by the integration owner before the complete G4 checkpoint.

## Problem

`RecoveredFrontierTerminal` contains only an operation identity and successor
control. It does not contain the recovered entry's material, kind, subsumption
set, or authenticated frame context. A fresh positive
`AuthorityReplica::adopt_frontier` therefore cannot establish a complete entry
identity. Accepting a later material-bearing entry against that partial proof
would allow conflicting recovered material to become the first bound identity
after frontier mutation.

The pinned TypeScript recovery path does not create that gap. For every
positive frontier it passes the final full authority entry from
`requiredTail` to `stageRecoveredFrontier` before control projection. The
terminal-only adoption path is used only when there is no positive terminal
entry.

## Decision

- A fresh positive replica recovery is adopted and staged atomically through
  `AuthorityReplica::stage_recovered_frontier(AuthorityEntry)`.
- That transition validates the complete entry and authenticated context before
  mutation, then publishes received/material at `R`, control at `R - 1`, and
  the exact full entry as the material-applied pending entry in one step.
- A terminal-only `adopt_frontier` call may not establish a fresh positive
  recovery identity. Revision zero remains the empty-frontier no-op. An exact
  positive terminal-only call is idempotent only when received/material are
  exactly `R`, control is exactly `R - 1`, and the replica holds the complete
  matching entry in its material-applied pending stage; otherwise it fails
  without mutation.
- Duplicate recovered-entry staging compares the complete identity: revision,
  all eight frame-context dimensions, operation, kind, material, successor,
  and subsumption set.
- M2B-01 production `GameKernel` dispatch must pass the validated bundle's
  final full entry to `stage_recovered_frontier` after material application and
  before reporting `RecoveryFrontierStagingOutcome::Staged` to the recovery
  transaction. This M2-04 lane's callable-boundary test proves the literal
  material-success-before-full-entry-staging ordering; M2B-01 must separately
  prove that the production dispatch implements it.

No Authority V2 wire body, serialized DTO, frame type, or public function
signature changes. This change fixes sequencing and state ownership only.

## Required evidence

- fresh gap recovery stages a full entry without a prior partial adoption;
- terminal-only fresh positive adoption is rejected atomically;
- material, context, control, kind, operation, and subsumption conflicts reject
  before any frontier or pending-state mutation;
- exact duplicate staging is idempotent and preserves the full pending entry;
- zero and equal-frontier cases retain their documented behavior;
- the M2-04 callable seam records literal material-success, full-entry
  staging, and `Staged` ordering without claiming that the production
  `GameKernel` is implemented;
- M2B-01 production integration proves that its dispatch uses that same
  full-entry-first call order.
