# CR-0019: supply the authority epoch to turn resolution

Status: approved by the integration owner before any M3B mechanics branch is
based.

## Problem

The frozen `resolve_turn` signature receives canonical game state, admitted
commands, a result operation ID, and immutable content, but none of those values
contains the authenticated Authority V2 session epoch. A turn that discovers a
faint must create `FaintSource`, whose frozen identity includes
`AuthorityEpoch`. Inventing zero, deriving an epoch from an operation string, or
copying an unrelated value would make replacement identity non-authoritative.

`resolve_replacement` does not have this gap because it consumes the stored
`FaintOccurrence` and therefore preserves its existing source epoch.

## Decision

Add one explicit argument to the pure turn resolver:

```rust
pub fn resolve_turn(
    before: &GameState,
    commands: &CommandSet,
    authority_epoch: AuthorityEpoch,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleTransition, BattleResolveError>;
```

`er-game` obtains this value from the authenticated current command frontier /
protocol frame context and passes it into `er-battle`. Every
`FaintOccurrence` first discovered during that call stores exactly this epoch.
The resolver must not default, synthesize, increment, or parse an epoch.

## Compatibility and ownership

This is a Rust call-surface correction only. It does not change canonical
battle state, snapshots, digests, fixture schemas, material schemas, operation
grammar, or wire bytes. The integration owner owns the contract and shared
resolver surface; mechanics lanes consume the amended signature without
altering it.

## Acceptance evidence

- every newly queued faint stores the exact supplied epoch;
- replacement resolution preserves the stored source epoch;
- no zero/default/string-derived epoch path exists;
- host and replica material retain identical faint source identity; and
- the full hosted Rust Kernel Gate is green at the exact integration SHA.
