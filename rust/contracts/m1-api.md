# PokéRogue Redux Rust kernel M1 contract

Status: frozen for Milestone 1 implementation.

Source baseline:

- G1 commit: `7c034639823ed8d57bc0e36882014167c3e976fe`
- game oracle: `3b534099919efae827019d4a3f3c4ab0ecd6d67b`
- protocol compatibility identifier: `er-coop-47`
- frame protocol: `2`
- schema version: `1`

`elite-redux` remains in legacy source paths and compatibility identifiers only. The product and kernel are PokéRogue Redux.

## Change control

The public items committed with this document are frozen until G3. A lane may change function bodies, private fields, private helpers, and its own tests. It may not rename, remove, or change the type of a public item. A needed public change is a written request to the integration owner and must be resolved centrally before another lane consumes it.

All JSON-facing enums have explicit serde tags or renames. Arrays preserve order. Optional fields use omission only where the TypeScript contract uses `undefined`; explicit `null` remains represented by a required `Option<T>`. No floating-point type is part of the M1 public API.

## Dependency direction

The production dependency graph is acyclic:

```text
er-types       -> serde, serde_json, thiserror
er-canonical   -> serde, serde_json, blake3, thiserror
er-kernel      -> er-types, er-canonical
er-protocol    -> er-types, er-canonical       (M2 implementation surface)
er-testkit     -> er-types, er-canonical, er-kernel
er-wasm        -> er-types, er-canonical, er-kernel, wasm-bindgen
er-sim         -> er-types, er-canonical, er-kernel, er-protocol (M2)
```

At the G3 boundary `er-kernel` did not depend on `er-protocol`. The approved M2
composition revision adds that one-way dependency so the production InputRouter
and protocol owners share one `KernelScheduler`. JSON boundary DTOs required by
both trace and kernel remain in `er-types::protocol`; `er-kernel::kernel`
re-exports the kernel-facing names. Production crates never depend on
`er-testkit`, `er-sim`, or `er-wasm`.

## IDs and safe integers

`SafeU53` accepts only `0..=9_007_199_254_740_991` and validates on construction and deserialization. JSON integer tokens and finite integral number forms such as `1.0`, `1e0`, and `-0.0` follow JavaScript `Number.isSafeInteger`; deserialization normalizes them to the stored integer and serialization emits an integer token. JSON-facing counters use it directly or through numeric newtypes.

Numeric newtypes:

- `Revision`
- `SeatId`
- `MembershipRevision`
- `ConnectionGeneration`
- `TimerId`
- `MenuGeneration`
- `PresentationEventId`

Opaque string newtypes:

- `OperationId`
- `SessionId`
- `RunId`
- `OwnerId`
- `MenuOptionId`

These five are non-empty opaque UTF-8 string newtypes. They do not trim,
normalize, parse, length-bound, or reject control characters globally. A source
layer applies any narrower semantic rule it owns. AuthorityLog entry/receipt
operation IDs are non-empty, at most 256 JavaScript UTF-16 code units, and
contain neither C0 nor DEL. Material digests are non-empty and at most 256
UTF-16 units but may contain controls. JavaScript lone surrogates are not UTF-8
strings and are rejected at Rust JSON decoding.

Every newtype exposes checked `new`, a borrowed/value accessor, and `into_inner`. `Revision::ZERO` is representable for frontier snapshots even though committed authority entries start at one.

## Raw input

`er-types::input` freezes:

- `PhysicalKey`: ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Enter, Space, Escape, Backspace, KeyA, KeyB, KeyC, KeyD, KeyE, KeyF, KeyN, KeyR, KeyT, Unknown(String).
- `InputFocus`: Game or TextEntry.
- `RawInputEvent`: KeyDown, KeyUp, GamepadDown, GamepadUp, FocusChanged, WindowBlurred, WindowFocused.
- `GameButton`: Up, Down, Left, Right, Submit, Action, Cancel, Menu, Stats, CycleShiny, CycleForm, CycleGender, CycleAbility, CycleNature, CycleTera, SpeedUp, SlowDown, DevCustom.
- `InputMap`, `KeyBinding`, `GamepadBinding`, `ButtonEvent`, `InputTimerCommand`, and `InputRouterOutput`.

`InputRouter` owns mapping, logical-button locks, the physical keys whose printable keydown was suppressed, repeat intent/state, keyup symmetry, and blur cleanup. At M2 its production transitions use the owning `GameKernel`'s sole scheduler for allocation, rescheduling, and cancellation; it has no private timer-ID counter. `handle` processes raw events and `timer_fired` processes only exact router-owned scheduled timers. Browser repeat flags never create a second canonical press. Initial repeat delay and interval are both 250 ms. Blur cancels locks/timers and does not synthesize releases, matching the oracle cleanup boundary.

## Logical UI

`UiState` is exactly the canonical menu stack plus generation, optional numeric owner seat, and actionability. `MenuState` has the frozen variants None, Waiting, Message, Confirm, ChoiceList, Command, Replacement, Interaction, and Terminal.

Every JSON-facing cursor, page, and field index is `SafeU53`; native pointer-sized integers are not part of the wire or trace surface.

Command, replacement, and interaction payloads carry both `OperationId` and their opaque `control_id`. Option identity is `MenuOptionId`; presentation labels are localization keys and are never identity.

`UiReducer::reduce(seat, event)` operates at the current generation. `reduce_at(seat, expected_generation, event)` is the queued/stale-safe entry point. Wrong seat, stale generation, non-actionable state, hidden/disabled option, or invalid cursor returns `UiRejectReason` without mutation.

`UiIntent` variants are CursorChanged, CancelRequested, CommandSubmitted, ReplacementSubmitted, InteractionSubmitted, MessageAdvanced, Confirmed, MenuOpened, and MenuClosed. Every intent carries the seat and menu generation; semantic submissions also carry the stable operation/control/option identity.

`UiViewModel` contains generation, owner, actionable, view kind, optional cursor, ordered option views, and optional prompt key. It is a cloned immutable projection; renderers receive no mutation handle.

## Protocol schema used by M1

The typed M1 schema preserves the exact Authority V2 representation needed by the fixtures:

- `FrameContext` has all eight mandatory camelCase fields.
- `AuthorityEntry` has context, revision, operationId, kind, material, nextControl, and subsumes.
- `AuthorityReceipt.controlId` is omitted when absent and never serialized as null.
- `NextControl` preserves all five uppercase discriminants and address fields.
- `InteractionSuccessor.operationIds` and `AwaitSuccessor.expectedOperationId` are required nullable fields; null is an explicit wildcard.
- optional allowed-address arrays are omitted when absent and reject explicit null.
- `Material.payload` is required and may itself be JSON null.
- `NetworkFrame` preserves `{v,t,ctx,body}` and all seven lower-camel frame tags while leaving M2-only body semantics as lossless JSON.

M1 does not reinterpret adapter material, recovery policy, retention, retries, quorum, or Phaser/browser behavior.

## Kernel and trace boundary

`GameKernel` exposes:

```rust
pub fn step(&mut self, input: KernelInput) -> Result<Vec<KernelEffect>, KernelError>;
pub fn snapshot(&self) -> KernelSnapshot;
pub fn state_digest(&self) -> String;
pub fn live_resources(&self) -> LiveResourceSnapshot;
```

It retains no callback. Future work is represented only by state plus `KernelEffect`.

`KernelTraceHeader`, `KernelTrace`, and `KernelTraceEvent` use the exact fields in the migration specification. Sequence and virtual time are `SafeU53`. `KernelTraceEvent.input` records every nondeterministic boundary and stores expected effect, state, UI, and live-resource evidence. Replay reports the first divergent sequence.

Input/menu-only M1 snapshots use a typed `UiState` plus a lossless JSON `state` extension. M2 may freeze additional typed state through its own central contract without changing M1 trace field names.

## Canonicalization

`er-canonical` exposes canonical value/string/byte functions, the TypeScript fixture SHA-256 digest, BLAKE3 content hashing, and digest verification. Its implementation must:

- sort object keys with the oracle's JavaScript-compatible lexical order;
- preserve arrays;
- reject every floating value and every integer outside the signed
  JavaScript-safe range
  `-9_007_199_254_740_991..=9_007_199_254_740_991` on the strict kernel
  canonical/content path; signed safe integers emit canonical decimal tokens,
  while `SafeU53` and coordinate/counter newtypes remain nonnegative;
- preserve UTF-8 strings and absent-versus-null semantics;
- emit compact JSON with no insignificant whitespace;
- use SHA-256 for existing TypeScript fixture/wire compatibility;
- use BLAKE3 only for new content/fixture hashes.

The TypeScript fixture SHA-256 path is a separate compatibility algorithm. It reproduces `JSON.stringify(stableValue(payload))`, including finite negative and fractional JSON numbers already present in the pinned checkpoint and input-map fixtures, JavaScript `-0` normalization, and the exporter's object-property enumeration. It must not be reused as the canonical identity for new kernel state.

## Representative driver and Wasm surface

`KeyboardDriver` exposes only `key_down`, `key_up`, `press`, `hold_for`, `blur`, and `focus`, plus read-only kernel access. It has no direct choice, cursor, command, replacement, shop, or menu mutation API.

`er-wasm` exports JSON-string boundary functions for canonicalization, compatible digesting, and kernel-trace round-trip. It reuses Rust DTOs and canonicalization; it does not define parallel schemas.

## G2/G3 acceptance

G2 first integrates lanes M1-01 through M1-06 and requires hosted fmt, clippy, fixture round-trip, and native/Wasm type/digest parity. G3 then integrates lanes M1-07 through M1-12 and requires every focus/repeat/keyup/blur/menu ownership/generation/disabled-option case, representative KeyboardDriver-only tests, trace replay, zero unsafe, and no production TypeScript changes.
