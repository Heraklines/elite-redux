# CR-0008: Validation typed-boundary compatibility

Status: Approved / Resolved
Resolved: 2026-08-08
Related lane: M2-02 validation semantic correction
Exact green base: `f6db3605418c6bc7ce62b7249c9c171c0d4764b8`
Scope: raw-first `er-protocol` validation and typed reconstruction

## Resolution

The exact green base resolves the shared typed-boundary blockers. Validation
therefore follows the shared policy instead of adding a private coercion layer:

1. Shared opaque string IDs are nonempty-only. Authority-specific control,
   length, and identity policy remains at the Authority owner; this validator
   reports the frozen wire-level nonempty-string checks.
2. Shared `SafeU53`/`SafeI53` visitors accept the JavaScript
   `Number.isSafeInteger` domain, including integral JSON float and exponent
   forms such as `1.0`, `1e0`, and `-0.0`, at their typed boundary. The exact
   safe-integer endpoints remain checked after JavaScript-number rounding.
3. The workspace `serde_json` policy is `float_roundtrip` only. The manifest is
   not changed. `arbitrary_precision` is explicitly forbidden: it changes
   `serde_json::Value`/`Number` representation and `deserialize_any` visitor
   semantics, which would change the typed-boundary contract and is not
   permitted for this lane.

Omission versus explicit `null`, unknown-property acceptance, duplicate-key
last-value behavior, and the frozen issue order remain part of the wire
contract.

## Raw-first validation behavior

`validation.rs` decodes and structurally checks the raw value before it
reconstructs `FrameContext` and the concrete `ValidatedFrameBody`. Integral
float/exponent values are passed through the shared visitors, so every
JavaScript-valid checked boundary field retains its concrete typed value.
Checked overflow and non-finite values fail closed at their structural issue
path in deterministic order.

The text path uses a total, deterministic scanner that skips JSON strings,
honors JSON whitespace and number boundaries, and lets `serde_json` apply
JSON.parse-compatible duplicate-key last-value semantics. When the default
`Value` parser rejects a syntactically valid number that becomes JavaScript
`Infinity`, validation carries it through a per-parse object marker. The
marker key is escaped JSON and its suffix is advanced when an escaped user
key already occupies that value, so user strings and keys cannot collide with
the carrier.

Unknown cosmetic frame types remain cosmetic drops even when their text
contains overflowing numbers. Unknown extension properties on a known frame
remain non-validating. A checked field containing the carrier is still an
issue, and an opaque `material.payload` containing it fails closed rather than
becoming semantic JSON.

## Residual representation limit

With the required default `serde_json::Value` policy, an unknown non-finite
extension number cannot be retained as its original numeric token. Such a
value may remain represented in `NetworkFrame.body` as the private per-parse
marker object while the frame is accepted as an unknown extension. This is the
only remaining representational limitation; it does not affect checked-field
classification or typed boundary values.
