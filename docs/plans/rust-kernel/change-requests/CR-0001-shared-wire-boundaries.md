# CR-0001: layered string IDs and JavaScript number boundaries

Status: approved for the immediate M2 contract revision

Owner: integration owner

Base: `c477388d2c857350c7a9657338a82e33056e337d`

## Request

Make the shared Rust DTO boundary accept the same opaque-string and numeric
domain as the pinned Authority V2 JavaScript boundary, while retaining the
narrower operation-token and digest rules only where the oracle applies them.

## Current frozen contract

`rust/contracts/m1-api.md` assigns the AuthorityLog-specific 256-byte/control
rule to the global `OperationId` newtype. `OperationId`, `SessionId`, `RunId`,
`OwnerId`, and `MenuOptionId` consequently all reject more data than their
source layers. `SafeU53` and `SafeI53` deserialize only integer JSON tokens.
`TimerOwner` independently adds the same 256-byte/control restriction to each
of its fields.

## Why implementation cannot satisfy it

The frozen types reject inputs before the raw-first validator or owning state
machine can apply the source layer's actual rule:

- frame context, successor controls, proposal admission, proposal leases, and
  recovery bodies require only non-empty opaque strings;
- `Number.isSafeInteger` accepts integral JSON number forms such as `1.0`,
  `1e0`, and `-0.0`;
- AuthorityLog entry/receipt operation IDs alone use the bounded wire-token
  guard; and
- a proposal timer owner is composed as
  `authority-v2:proposal:${operationId}`, so a globally valid operation ID can
  legitimately produce an owner string longer than 256 bytes.

The stricter shared type therefore changes classification and prevents exact
oracle parity.

## Source evidence

- `frame-context.ts:isNonEmptyString` and
  `protocol-validator.ts` use non-empty-only strings for context and known raw
  frame bodies.
- `next-control.ts:isNonEmptyString` uses non-empty-only strings for successor
  operation IDs and control identities.
- `proposal-admission.ts` and `proposal-lease.ts:validLease` require non-empty
  operation IDs and fingerprints without the AuthorityLog token bound.
- `authority-entry.ts:isValidOperationId` requires a non-empty value of at most
  256 JavaScript UTF-16 code units and rejects C0 plus DEL.
- `authority-entry.ts:hasValidDigest` requires a non-empty digest of at most 256
  JavaScript UTF-16 code units; it does not reject control characters.
- `frame-context.ts:isNonNegSafeInt`, `next-control.ts`, and
  `authority-entry.ts:isValidRevision` use `Number.isSafeInteger`.
- `scheduler.ts` stores opaque owner/address/reason strings and does not impose
  the Rust-only byte/control restriction.

## Proposed minimal change

1. `OperationId`, `SessionId`, `RunId`, `OwnerId`, and `MenuOptionId` validate
   only that the Rust string is non-empty. They remain distinct opaque
   newtypes. No trimming or normalization is permitted.
2. Add shared semantic helpers in `er-types::ids`:
   - an Authority operation-token predicate/error that measures
     `value.encode_utf16().count() <= 256` and rejects Unicode scalar values
     U+0000..U+001F plus U+007F;
   - a material-digest predicate/error that measures the same UTF-16 bound but
     permits controls.
   AuthorityLog applies these helpers to committed entries and receipts.
   Other layers retain their own non-empty-only rules.
3. Enable `serde_json`'s `float_roundtrip` parser and implement `SafeU53` and
   `SafeI53` deserialization with visitors that accept integer tokens and finite
   `f64` values for which JavaScript `Number.isSafeInteger` is true. The default
   best-effort decimal parser is insufficient at the safe-integer boundary: it
   parses `9007199254740991.0` one unit low. Precise float parsing also preserves
   JavaScript rounding before the predicate is applied. `-0.0` normalizes to
   integer zero. Non-finite, non-integral after binary64 parsing, out-of-range,
   string, boolean, and null values remain rejected. Serialization remains a
   normalized integer JSON token.
4. `TimerOwner::new` validates each field as non-empty only. Owner, address, and
   reason remain opaque and are never parsed as identities.
5. Rust `String` deliberately remains a Unicode-scalar/UTF-8 carrier. A lone
   UTF-16 surrogate accepted by a JavaScript string cannot be represented as a
   Rust `String` and is rejected at JSON decoding. This follows the migration's
   explicit UTF-8 contract; valid supplementary characters are counted as two
   UTF-16 code units for the Authority-specific bound.

## Affected workers

M2-02 validation, M2-03 authority log, M2-05 proposal, M2-06 successor,
M2-07 recovery, M2-11 contract map, M2-12 properties, and M2B integration and
parity lanes.

## Serialization impact

No field, tag, omission/null rule, or normalized output changes. Deserialization
accepts additional JavaScript-valid lexical number forms and opaque strings at
the layers that already accept them in the oracle.

## Fixture impact

Add boundary fixtures/tests for `1.0`, `1e0`, `-0.0`, safe maxima/minima,
non-ASCII UTF-16 length boundaries, C0/DEL operation tokens, control-bearing
digests, and long composed timer owners. Existing fixture bytes remain valid.

## Migration impact

This is an immediate contract correction before G4. Affected M2A branches must
be replayed on the revised integration SHA or amended against the exact shared
API before integration.

## Alternative rejected

Keeping the strict global `OperationId` and compensating in raw validators was
rejected: typed DTO reconstruction would still fail after a structurally valid
classification. Introducing separate private wire IDs per lane was rejected
because it would fragment one public schema.
