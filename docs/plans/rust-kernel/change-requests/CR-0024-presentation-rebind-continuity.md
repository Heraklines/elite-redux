# CR-0024: preserve presentation ownership across transport rebind

Status: approved by the integration owner during final M3 hosted continuation
verification.

## Problem

The replica transport-generation rebind cleared its pending presentation IDs
and revision correlation without clearing the retained typed plans or the
pair-level presenter's matching requests. The live kernel state therefore had
plan events with neither a pending identity nor an outcome tombstone. The
closed snapshot validator correctly rejected that split owner graph.

Transport generation is not presentation ownership. A renderer request already
accepted by the local endpoint remains a causal part of the installed control
even while recovery fences input for a new authenticated generation.

## Decision

- Preserve the exact local presentation plans, pending identities, outcomes,
  presenter requests, and protocol revision correlation across disconnect,
  reconnect, and generation rebind.
- Let the recovery fence control UI actionability while reconciliation is live.
- Retire presentation work only through a typed settlement outcome or terminal
  disposal; do not invent an implicit transport-cancellation outcome.
- Enforce the exact-one pending/outcome invariant in the live presentation
  owner as well as in its closed snapshot DTO.

## Consequences

Continuation snapshots taken immediately after rebind retain one coherent
presentation owner graph and can restore without renderer-specific repair.
Settling a preserved request continues to advance its original causal revision
once recovery permits normal progress. Terminal disposal remains unchanged and
still releases live plans while retaining settled diagnostic tombstones under
CR-0023.
