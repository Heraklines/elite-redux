# Current causal capsule integration

Status: IMPLEMENTED_PENDING_REMOTE_CHECKS. This is a source checkpoint, not
qualified execution evidence. The actual current CLI reload and
B2 replica presentation cuts passed their separate remote gates. Capsule candidate
`53332a3b8b837583ad8cb2f5c1d9ff432746b459` passed preflight and returned a remote
formatting repair before compilation.

## Current path

`er-repro::current` records typed `CurrentExternalEvent` attempts over the shared
V7 `CurrentGameSession` and V2 prepared content. Capsules contain a validated
pre-event checkpoint, actual local seat and role, content identity, absolute
positions, ordered attempts, typed outcomes and full snapshot digests. Applied
outcomes retain the full typed step and observation. Kernel rejection outcomes
retain bounded error information plus unchanged observation and state evidence.
Replay starts an isolated session and compares each outcome and final digest;
replayed effects are comparison data and are not delivered to external adapters.

Capture defaults to 256 events and 2 MiB, with explicit upper bounds. Rotation
uses the actual verified checkpoint before the retained suffix and preserves
absolute positions. Oversize attempts or unrecorded state changes make capture
unavailable; a later verified event may establish a new explicitly bounded suffix.
Appending does not clone retained history. Exact internal JSON byte accounting
serializes each new attempt and changed metadata; it recounts the checkpoint only
on creation, import or rotation. Independent full-encoding boundary witnesses
remain required. Explicit export returns an owned copy.
Import validates and replays once, preserving retained history and positions.

Optional browser transport context records actual base/final generations and
each attempt's before/after generations. Browser import requires that context;
it never guesses generation from a protocol peer or an origin label. This covers
hosts without protocol state and transport changes before a retained window.
Native capsules may omit browser transport context.

`BrowserKernelHostV2` exports canonical capsule bytes through the additive
`CurrentReproReady` effect and accepts `CurrentReproCapsule` initialization. It
records accepted typed events, including time, lifecycle, network, presentation
and platform completions, plus kernel rejections. Wrapper admission/adapter
failures mark capture unavailable rather than inventing successful kernel events.
Admitted Snapshot/ExportRepro requests preserve capture, including late response
size rejection. Malformed, wrong-version, wrong-sequence and conflicting request
attempts invalidate capture even when labelled Snapshot/ExportRepro: admission
fails before the read-only path is entered. Exact cached retries preserve capture.
Response projection and serialization remain bounded before game state commits.

The normal CLI `replay` command consumes current capsules with bounded file and
result sizes; the historical command is explicit `replay-v6`. Normal JSONL
`session.from_capsule` validates replay and its bounded result before publishing
the session ID. Optional worker adoption also completes before insertion. Failed
import leaves an unused ID reusable and existing sessions untouched. Continued
native or worker operation uses the shared current session semantics.

## Witnesses being connected

Nine shared recorder/replay tests cover natural held-navigation events, omission
and reordering, rejected attempts and retry, content mismatch, byte/count limits,
gaps, imported positions, rotation and actual browser generation context. Native
browser host tests cover export/import/continue, lifecycle origins, exact retries,
transactional initialization and response-budget failures. Two actual CLI process
tests use a capsule exported by the native Rust browser host and exercise current
replay plus native/worker import, tamper rejection, full state and continuation.

The actual Wasm/Chromium export-to-CLI bridge is included in this candidate. It must
use a source-bound non-test Cargo CLI artifact, compare the full browser snapshot,
and require an altered time event to fail causal replay. Native Rust browser-host
tests alone do not prove this boundary. All execution, generation, formatting,
linting and dependency installation remain remote.

## Limits

The TS effect router has a typed `publishCurrentRepro` callback with byte-exact
routing tests. No concrete production V2 downloader/uploader was found, so this
does not claim production download consent or storage integration. Captures do
not yet attest executable/build identity or reproduce every adapter failure.
Strict capsule/attempt wrappers do not strengthen all nested legacy serde fields.
The normal CLI imports game state but does not yet retain a recorder for continued
CLI capture. Such capture must preserve browser context or explicitly establish
a new native checkpoint; it must not silently rewrite the original context.
Minimization, full failure reproduction, final qualification and M9 completion
remain outstanding. No deployment, legacy save migration or final-tag move.

## Native capture continuation follow-up (source reviewed, not implemented)

Keep one recorder and bounded ingress diagnostics in a CLI session wrapper outside
CurrentBackend, so successful exact worker replacement retains capture history.
Create capture before publishing IDs; import via from_capsule to preserve original
attempts, absolute positions and origins. Capture successful full steps only after
response admission. A postcommit diagnostic failure marks a gap without rejecting
accepted gameplay. Read-only requests do not append game attempts. Fork capture
independently; exact reload does not duplicate quarantined replay events. Successful
restore declares a new capture boundary; failed restore/reload preserves history.
Worker executable generation changes are not game TransportChanged events.

Current worker faults lose the normalized reducer rejection identity: KernelFailure
merges session variants, observation/serialization failures may be reported through
other endpoint layers, and message truncation differs from recorder UTF-8 bounds.
Add typed normalized rejection evidence specifically at reducer failure, preserving
adapter/transport failures as explicit diagnostic gaps. Do not parse error strings
or treat every backend error as a replayable kernel rejection. Worker response
admission must receive the outer agent request-specific success allowance before
commit; fixed worker/result caps cannot cover an arbitrarily escaped JSONL ID.

AgentJsonlServerV1 rejects some ingress before dispatch. A default-no-op rejection
hook can capture bounded attributable session metadata; unidentifiable malformed
input stays in dispatcher diagnostics. Truncation must be explicit. Imported browser
transport context needs explicit continuation semantics; ordinary native record
currently rejects a recorder that requires browser context.

Required actual-process witnesses cover both backends: non-key time and platform/
network/presentation outcomes and rejection, normal export-to-CLI replay/full state,
large-ID success-envelope rejection with unchanged game state and corrected retry,
attributable versus unattributable malformed ingress, import/fork independent
continuation, reload then export without duplicate attempts, failed restore/reload
history preservation, explicit successful restore boundary and close/fencing.
These are future requirements, not qualification evidence for this capsule cut.
