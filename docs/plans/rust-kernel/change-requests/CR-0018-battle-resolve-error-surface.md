# CR-0018: freeze the battle resolver error surface

Status: approved by the integration owner before M3 oracle publication and
before any M3B mechanics branch is based.

## Problem

The frozen M3 API named `BattleResolveError` and the three public invariant
classes, but did not define their closed Rust nesting. Independent M3B lanes
would otherwise be free to classify the same state, capability, or candidate
failure differently, weakening clone-and-swap rejection and making later
atomic-transition mapping ambiguous.

In particular, command legality already exposes state, content, and unsupported
capability errors. Treating every legality error uniformly would misclassify
invalid input state and reachable unsupported effects, while flattening the
source errors would discard actionable deterministic diagnostics.

## Decision

`er-battle` owns one public, closed error module:

```rust
pub enum BattleAfterStateFailure {
    State(StateValidationError),
    MutationEvidenceMismatch { index: usize },
    PresentationSequenceOverflow { index: usize },
}

pub enum BattleInvariantError {
    InvalidBeforeState { source: StateValidationError },
    UnsupportedEffectReached { subject: CapabilitySubject },
    InvalidAfterState { source: BattleAfterStateFailure },
}

pub enum BattleResolveError {
    Invariant(BattleInvariantError),
    Legality(CommandLegalityError),
    Content(ContentPackError),
    Rng(RngError),
    Digest(MechanicalDigestError),
    Canonical(CanonicalError),
}
```

The conversion from `CommandLegalityError` is explicit:

- `State` becomes `InvalidBeforeState`;
- `UnsupportedCapability` becomes `UnsupportedEffectReached`;
- `Content` becomes the resolver's `Content` variant; and
- every other legality failure remains `Legality`.

Candidate state validation and post-resolution evidence failures are created
with context-specific constructors and become `InvalidAfterState`. A blanket
`From<StateValidationError>` is intentionally absent because before/after
context cannot be inferred from the source type. `NoLegalReplacement` remains
a valid `BattleNextDecision`, not an error.

## Compatibility and ownership

This freezes an implementation surface before any M3B resolver is integrated.
No wire DTO or serialized schema changes, so schema versions remain unchanged.
The integration owner owns the shared error module, crate export, contracts,
ownership manifest, and contract-freeze assertion. M3B lanes consume this
surface and may add private context only behind these variants.

## Acceptance evidence

- hosted native and wasm builds compile the public module;
- command-side state, unsupported capability, and content failures retain the
  exact classification above;
- candidate state, mutation evidence, and presentation overflow retain their
  exact nested after-state reason;
- ordinary legality failures remain ordinary legality failures;
- `NoLegalReplacement` is returned as a successful next decision; and
- the full hosted Rust Kernel Gate is green at the exact integration SHA.
