# CR-0022: retain immutable-content validation across kernel transactions

Status: approved by the integration owner during final M3 hosted benchmark
calibration.

## Problem

Every public mechanics, admission, and material boundary correctly validates
its supplied `ContentPack`, including recomputing the canonical content hash.
The production Battle kernel retains one already-validated
`Arc<ContentPack>` from construction or snapshot restore, but its private
authority transaction composed several of those public boundaries. One simple
turn consequently revalidated and rehashed the same immutable pack many times
while resolving, rebuilding offers, admitting the authority frontier, applying
the canonical material, and installing its result. Hosted measurement of the
unchanged 10,000-turn production workload exceeded the normative ceiling.

The repeated checks did not protect separate trust boundaries: all calls used
the same retained pack and remained inside one enclosing clone/drain/validate/
swap transaction. Removing state, evidence, material, digest, projection, or
rollback checks would be unacceptable, and weakening the public functions
would allow mutable standalone callers to bypass content validation.

## Decision

Add doc-hidden `*_trusted` variants for the mechanics, offer, admission, and
common-material operations composed by the production kernel. A trusted
variant may be called only with the exact immutable `ContentPack` retained by a
`GameRuntime` that validated it at construction or restore. It skips only
`ContentPack::validate()` and its canonical hash recomputation. It continues to
validate complete game state, state/content identity and membership,
capability closure, commands, mutation and RNG evidence, material digests,
canonical control projection, menu allocators, and endpoint reconciliation.

Public functions keep their existing full validation. Their implementations
may perform that full pack validation once and then share the same trusted
inner logic, rather than recursively rehashing the pack. Authority and replica
kernel adapters alias the trusted variants to the existing role-neutral
applier names; both roles still decode and apply the same canonical material
through one implementation.

The staged `install_material_in_kernel_transaction` path may omit after-state
digest and control-projection recomputation only after the common material
applier has already proved those exact values in the same private transaction.
It still checks coordinate progression, current operation binding, next
decision, scripted-policy advancement, and performs the final complete runtime
validation before swap. The independently callable `install_material` path
retains every original recomputation.

Mechanical-state digest computation validates the `GameState` directly and
encodes the frozen domain-separated canonical preimage once. The prior
implementation first encoded and discarded a standalone canonical snapshot,
then encoded the same state again inside the digest preimage. Removing that
discarded encoding does not change the digest bytes or validation result.

## Compatibility and ownership

This correction adds no dependency, wire message, serialized field, schema
version, operation grammar, material byte, digest domain, campaign helper, or
failure outcome. The trusted functions are doc-hidden cross-crate integration
seams owned by the integration owner. Benchmarks, simulators, Wasm adapters,
and campaign code remain behind `GameKernel` and cannot supply a private
runtime content owner.

## Acceptance evidence

- public invalid-content and material-tamper tests retain their fail-closed
  behavior;
- authority and replica continue to use the same typed material applier and
  produce exact native/Wasm continuation parity;
- source audits enumerate the trusted seams and reject their use from public
  benchmark or campaign adapters;
- the required hosted benchmark measures the unchanged raw-input and
  presentation-settlement workload below its ceiling; and
- the exact-SHA hosted Rust Kernel Gate is green.
