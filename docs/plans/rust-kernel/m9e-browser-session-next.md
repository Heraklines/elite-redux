# A1b: browser adapter delegates to the current session

Status: FOCUSED_REMOTE_PASS at `b7e2266cfbe774664a7737160c90727a71e4a030`, run
`33926691832`. The design below
records the reviewed boundary. `CurrentGameSession::apply_with` is committed;
BrowserKernelHostV2 delegation and four focused browser regressions are implemented.
All compilation, formatting, tests and browser execution remain remote-only.

Reviewed local base: `a887f7831179c7a6548a6dfc34fa7ef554307f17`, including
`er-env/src/current.rs`, `er-web/src/host_v2.rs`, and `contracts_v2.rs`.
`er-web` already depends on `er-env`; no dependency or browser wire schema
change is required.

## Exact boundary and transaction ownership

`BrowserKernelHostV2` owns `Option<GameKernelV7>` and calls mutators directly.
`process_bytes` clones the entire host, including retained response bytes,
before every request. The clone currently provides a necessary property:
kernel changes are rejected if later effect conversion, repro update,
canonical response encoding, response-size validation, or sequence increment
fails. Replacing those calls with `CurrentGameSession::apply` alone would
commit gameplay before those fallible browser operations complete.

`CurrentGameSession::apply` already clones only its kernel, executes one
typed event, validates, and commits. Extract that body into one shared
transaction helper with a fallible adapter completion closure. Conceptually:

```text
apply_with(event, finish(candidate_read_view, owned_step) -> Result<R, E>)
    -> Result<R, E>, where E: From<CurrentSessionError>
```

The helper stages one kernel, executes via the same private event reducer,
validates, invokes `finish`, then replaces the live kernel only on success.
The ordinary native `apply` calls this helper and returns the owned step.
The adapter cannot obtain mutable kernel access. Do not fork a session and
then call `apply` on the fork: that clones the same kernel twice.

`finish` performs effect conversion, prepares the repro delta, encodes the
complete response, and checks its byte limit. Compute the next accepted
sequence and possible cache eviction before entering the transaction. After
success, commit only infallible assignments: session result, generation,
repro delta, next sequence, and one retained response entry. Keep the retained
map outside the staged transaction. Its rolling retry behavior remains the
same; changing response bytes to shared storage is optional separate work.

Represent repro updates as `Keep`, `Append(input)`, `Replace(snapshot)`, or
`Clear`. Prepare a replacement snapshot before committing, then mutate the
existing tail after success. No full historical input/response copy is
necessary. This preserves the existing incomplete raw-input repro contract;
complete non-key repro is a subsequent contract task.

Read-only `Snapshot` and `ExportRepro` read the live session and encode before
updating request bookkeeping; they do not stage or clone gameplay. Fix the
existing eager `unwrap_or(snapshot()?)` fallback while touching ExportRepro:
an existing base should avoid calculating a fresh snapshot.

Initialization constructs an unpublished session, validates/project/encodes,
then installs it. Disposal encodes its response before disposing the session
and clearing host repro state. Neither needs a clone of existing history.

## Shared API additions and request mapping

- Store `Option<CurrentGameSession>` instead of `Option<GameKernelV7>`.
- Delegate raw input, time, network, transport, presentation, and storage to
  their existing `CurrentExternalEvent` variants. Keep browser generation
  rejection in the adapter; use the proposed generation when converting a
  transport request's effects, and install it only after success.
- Add `ProposalFrame { bytes }` and `AuthorityMaterial { bytes }` to the
  current event enum/reducer. Browser V2 exposes these separately and they
  have no generation field. Do not synthesize a generation or route them
  through `NetworkFrame`, which would add previously absent validation.
- Add `natural_start_with_scheduler` to preserve the supplied browser
  scheduler exactly. Existing native `natural_start` delegates to it with
  its new-scheduler defaults. Never rewrite an exhausted restored allocator.
- Add session-owned `from_active` matching the existing kernel constructor
  for ExistingSave. Preserve current save identity validation and revision
  semantics during this connection; any revision bug is separate work.
- Use existing session `from_snapshot` for Snapshot/Scenario/ReproCapsule.
  Scenario identity remains an initialization precondition. Replay capsule
  inputs use session `apply`; publish the session only if all succeed.
- Preserve current Lifecycle-to-WindowBlurred/WindowFocused translation as
  raw input. This change does not claim complete suspend timer semantics.
- Add a read-only kernel diagnostic accessor for existing public host
  `kernel_ref` and scenario inspection. Normal observation remains the
  structured session API. Remove the host's mutable kernel accessor.

Browser response `Effects`, effect ordering, `external_sequence`, canonical
envelopes, protocol version 2, and retry conflict behavior remain unchanged.
The shared current enum gains typed events; inspect its native consumers for
exhaustive matches when implementing.

## Error conversion

Implement `From<CurrentSessionError> for BrowserWebErrorV2` at the adapter:
`Kernel(error)` retains existing `BrowserWebErrorV2::Kernel(error.to_string())`;
`Disposed` maps to `Invalid`; `Digest(message)` maps to `Canonical(message)`
if observation is used. Browser-only validation remains `Invalid`/`Conflict`
and canonical encoder failures remain `Canonical`. Preserve the existing
`JsValue` boundary; do not stringify then reparse errors or change wire
responses into `Fault` as part of this refactor.

## Ownership and focused witnesses

Owned implementation: `er-env/src/current.rs`, `er-web/src/host_v2.rs`.
Coordinate exclusive `current.rs` ownership after A1 lands. Existing browser
contracts and Cargo dependencies should need no edits. Tests belong in a new
`er-env/tests/current_transaction.rs` and existing/new browser host integration
test source after the integrator materializes exact required paths.

Positive: feed the same raw-input/time/presentation/storage/transport events
through CurrentGameSession and canonical BrowserKernelHostV2 envelopes;
compare V7 snapshots, control, game effects after browser projection, and
content identity. Include direct ProposalFrame/AuthorityMaterial and all
existing initialization forms. Existing shipping browser host tests remain
mandatory.

Negative: deliberately fail the transaction completion closure after a valid
game mutation; complete session snapshot must remain byte-identical. At the
host boundary reject a late response/sequence failure, then retry the valid
request at the original sequence; compare with a fresh successful execution.
Assert retained responses remain available byte-for-byte after rejection.
Wrong-generation frames and conflicting duplicate requests remain rejected.
An isolated remote mutant that commits before `finish` must fail rollback.

F: remote `er-env` transaction target and `er-web --test m9e_host_v2`, plus
the focused dependency map's mandatory V7 material/snapshot/co-op/eventwise
checks. I: current native/Wasm trace and the existing shipping browser witness
because this changes the browser adapter. Source-only review does not prove
cross-target compilation or the real Worker/transport topology.

Handoff implementation commit and remote report artifact: pending.
