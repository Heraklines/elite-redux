# CR-0002: successor shared-boundary compatibility

Status: resolved by CR-0001 integration; accepted legacy oracle collision
Owner: integration owner / M2 shared types
Raised by: M2-06 successor correction
Base: `c477388d2c857350c7a9657338a82e33056e337d`

## Scope

The M2-06 successor correction preserves the frozen TypeScript successor
oracle and does not introduce private Rust wire types. The shared `er-types`
boundary decision from CR-0001 is resolved on integration and is a dependency
of the exact checkpoint SHA, not a successor-semantic divergence.

CR-0001 integration resolves the two boundary cases recorded during the
correction:

- `SafeU53` accepts finite, integral JavaScript-safe JSON number forms such as
  `1.0`, `1e0`, and `-0.0`, normalizing them to the integer representation.
- The shared opaque `OperationId` boundary used by successor controls accepts
  non-empty strings without imposing the AuthorityEntry-only byte/control
  token policy. AuthorityEntry validation applies its own UTF-16 token rule
  separately.

The M2-06 raw-first validator therefore remains aligned with
`next-control.ts`; the integrated shared DTOs must be present at the
checkpoint so typed admission does not reintroduce the older classification
split.

## Accepted legacy wildcard collision

The pinned oracle deliberately renders nullable successor operation IDs as the
literal `*` sentinel:

- `SHARED_INTERACTION` uses `*` for `operationIds: null`;
- `AWAIT_SUCCESSOR` uses `*` for a null `expectedOperationId`; and
- an await control address uses `*` for a null `operationId`.

The oracle also leaves `*` unchanged through `encodeURIComponent`, and its
non-empty opaque-string predicate permits a literal operation ID of `*`.
Consequently, each nullable form collides with its corresponding literal
`*` form. This collision is accepted legacy behavior for wire compatibility:
M2-06 must not reserve `*` or change the encoding. The Rust implementation
mirrors the collision, and `m2_successor.rs` contains explicit regressions for
all three cases so it cannot be mistaken for a Rust-only divergence.

## UTF-8 carrier caveat

Rust `String` carries Unicode scalar values as UTF-8. A JavaScript lone UTF-16
surrogate cannot be represented by the Rust DTO; it is rejected at the JSON
boundary even though valid supplementary Unicode scalars retain the required
UTF-16 ordering and UTF-8 URI encoding behavior. This is the intentional
CR-0001 carrier exception, not a reason to alter `control_id_of`.

## Integration record

CR-0002 no longer blocks the successor correction. The integration owner must
keep the CR-0001 shared-type changes and the pinned oracle fixture at the same
checkpoint SHA; no `ids.rs` or private successor DTO change belongs in this
lane.
