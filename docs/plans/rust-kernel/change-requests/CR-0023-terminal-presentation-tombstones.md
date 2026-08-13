# CR-0023: retain terminal presentation tombstones

Status: approved by the integration owner during final M3 hosted continuation
verification.

## Problem

At shared terminal, each Battle kernel releases live presentation plans and
barriers but intentionally retains settled outcomes as diagnostic tombstones.
The pair-level presenter previously released both its live requests and those
settled tombstones. A terminal restorable snapshot therefore contained exact
endpoint evidence that its presenter owner no longer matched, and the frozen
pair validator correctly rejected the divergent owner graph.

## Decision

Presenter disposal clears pending Battle events and every legacy pending or
settled value, but retains settled typed Battle outcomes and their exact
tombstones. Those values are inert diagnostic evidence: they cannot emit a
completion, block input, own a timer, or count as a live resource. The
restorable pair continues to require the presenter outcomes for each endpoint
to equal that endpoint's retained kernel outcomes exactly.

Both instant and fault-controlled presenters use this disposal rule so every
restorable `PresenterState` is reachable from its concrete owner. Disposed
presenter validation still rejects pending Battle state and all legacy outcome
state, and the existing outcome/tombstone identity invariant remains intact.

## Compatibility and acceptance

This correction adds no field, wire message, schema version, game mutation,
or renderer callback. Acceptance requires direct presenter disposal tests and
the production terminal continuation test to prove non-empty retained evidence,
canonical snapshot encoding, destroy/reconstruct equality, absorbing terminal
behavior, and zero live resources before explicit pair teardown.
