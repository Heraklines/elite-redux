# CR-0021: align TURN successor coordinates with frozen M3 material

Status: approved by the integration owner during final M3 hosted continuation
verification.

## Problem

The generic Authority successor validator derived a `TURN_COMMIT` mechanical
address only from top-level `wave` and `turn` fields used by the legacy
Authority payload. The frozen `BattleTurnMaterialV1` schema instead names the
same coordinate `wave` and `resolved_turn`. The first M3 turn could commit
because an empty log has no predecessor; every later turn was then rejected by
the predecessor's valid `COMMAND_FRONTIER` even though the typed material,
operation ID, game state, and projected control all agreed.

Changing the frozen M3 material field back to `turn` would alter canonical
bytes and its digest domain. Treating every missing turn as zero would weaken
successor authorization. Neither is acceptable.

## Decision

For `TURN_COMMIT` mechanical-address extraction only, accept exactly one of the
top-level fields `turn` or `resolved_turn`. The former preserves the legacy
Authority envelope; the latter admits the frozen M3 battle material. Reject a
payload containing both fields, even when their values happen to match, and
reject a payload containing neither. Existing epoch and wave checks remain
unchanged, and the selected coordinate must still be a non-negative
`SafeU53` equal to the predecessor control's exact turn.

The complete M3 TURN validator continues to require `resolved_turn`, exact
operation grammar, schema/oracle/content identity, canonical bytes, and the
material digest. This correction changes only the generic opaque successor
address used before that full admission boundary.

## Compatibility and ownership

No public signature, dependency, serialized M3 field, schema version,
operation grammar, digest, or canonical byte changes. Legacy `turn` payloads
retain their existing result. Ambiguous dual-coordinate payloads fail closed.
The integration owner owns this compatibility correction because
`er-protocol` cannot import the typed `er-game` material without violating the
frozen crate graph.

## Acceptance evidence

- a local authority log accepts a second M3 `TURN_COMMIT` carrying
  `resolved_turn` under its predecessor `COMMAND_FRONTIER`;
- the same log rejects a payload carrying both coordinate spellings without
  consuming a revision;
- multi-turn native/Wasm continuation reaches terminal normally; and
- the exact-SHA hosted Rust Kernel Gate is green.
