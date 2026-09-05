# Current V7 retention and recovery: next bounded repair

Source investigation only; no product change or local execution. The handoff's retention criterion requires multiple material/proposal/request windows, old/conflicting retries, lost responses, and no lifetime action cap.

## Observed current path

| Location | Concrete behavior |
| --- | --- |
| `rust/crates/er-game/src/m9e_material_v6.rs:28,180,283,333` | Applied ledger stores operation ID, material fingerprint, authority revision and after-state digest. Maximum is 4,096 records. Exact retained duplicates return `DuplicateApplied`; conflicts reject. A new record at capacity returns `Ledger` before revision/frontier validation. Nothing retires records here. |
| `rust/crates/er-game/src/m9e_runtime_v6.rs:319,350` | Both authority execution and replica application call that material apply function. The cap therefore affects ordinary continued gameplay, not just a diagnostic store. |
| `rust/crates/er-kernel/src/game_kernel_v7.rs:1065,2716` | V7 admission checks canonical proposal bytes and current peer generation; searches fingerprints by operation ID; exact duplicate returns an empty step. New rooted proposals reject at configured capacity. Successful admissions append and sort by operation ID, with no retirement age/revision metadata. |
| `rust/crates/er-protocol/src/snapshot.rs:453,460,981` | Shared proposal snapshot stores only operation ID/fingerprint, capacity and disposed state. Validation enforces sorted unique IDs and the capacity. Lexical order is not admission age. |
| `rust/crates/er-protocol/src/proposal.rs:789,817` | Generic ledger likewise stops at capacity; `reset` clears everything. Reset is not a proven V7 retirement mechanism. |
| `rust/crates/er-kernel/src/game_kernel_v7.rs:806,1611,2273` | V7 network ingress directly chooses proposal admission or material apply. Replica action emits canonical proposal bytes; authority transaction emits canonical material plus local presentation/platform effects. Duplicate proposal's empty response does not resend a lost material response. |
| `rust/crates/er-protocol/src/authority_log.rs:753,1165` | Older protocol log has retained-tail recovery and retirement with archived proof and bounded retired stages. V7's direct path above does not establish that these handlers carry current V7 material. Reuse requires actual integration, not an assumption based on names. |

Current rooted proposal checks at `game_kernel_v7.rs:2649,2735` bind authority revision, operation and owner/control context. The current BattleCommandRetention path already prepares and applies ordinary material, advances the authority revision, and emits its canonical bytes. Its immediate material can be retained as the reply even while the accepted command remains unresolved; live command ownership must be preserved independently from recent reply evidence.

## Smallest coherent repair

Treat this as one current-path retirement/recovery cut, with independently testable material and admission helpers. Raising limits or periodically clearing both vectors does not repair lost-response behavior.

1. Make applied-material evidence a deterministic bounded suffix. Validate a candidate transition completely, including checked next revision, before pruning/committing. Retained exact retries stay no-ops; retained conflicting bytes reject. Material older than the retained floor must be classified as stale/unverifiable and never reapplied. Keep the monotonic frontier across retirement, snapshot restore and reload. Existing `next_authority_revision` fences old revisions; explicitly represent or derive the retained floor and validate its meaning. Do not promise conflict identification once its fingerprint was deliberately retired.
2. Give current proposal evidence an explicit retirement basis: authenticated sender/context, admitted authority revision, and whether the operation remains unresolved. Keep all live command-window admissions and a bounded recent completed suffix. Only retire completed contexts that cannot be admitted by either current rooted-control predicate. If all capacity is genuinely live, preserve backpressure with no partial mutation. Do not select oldest entries by operation-ID sorting or reset a live battle's fingerprints.
3. Retain bounded canonical response evidence for accepted proposals. On a matching retry, resend only the original material/recovery response; do not execute the action or emit authority storage, presentation, audio or telemetry again. Recheck current authenticated sender/generation before cached replay. Retain the immediate canonical BattleCommandRetention material for an accepted command awaiting another seat; replaying that reply must not resolve the eventual turn twice.
4. Make falling outside the response window an explicit, correlated recovery outcome. Add the missing V7 request/response/receipt handling inside the current boundary. Recover with a validated retained suffix when available; otherwise use a current authority checkpoint/frontier exchange. Installation must preserve or deliberately reconcile replica-owned input, scheduler, private submenu and unsettled presentation ownership, not copy an authority's entire private kernel snapshot. Bind session/run/content/seat/generation/frontier and reject rollback or mismatched recovery. Advance peer retirement evidence only after successful installation/receipt. A disconnected peer must be able to recover after several windows without keeping every past material forever.

All pruning, action application, response retention and recovery installation must share the existing staged-session commit boundary. Serialization, validation, overflow or capacity failure leaves the full snapshot and retry eligibility unchanged. Bounded recovery responses need byte limits as well as entry limits.

## Required remote regression scenarios

- Exercise at least three material windows, including the real 4,096 boundary, with distinct valid causal transitions. Continue after each rollover; assert monotonic revision, bounded ledger, independent final state and effects. A small-window helper test supplements, not replaces, the real boundary witness.
- Cross three proposal windows using actual rooted actions. Include a battle with one accepted human command waiting for its partner while unrelated completed evidence retires; duplicate stays a no-op and conflicting retry rejects.
- Drop the first authority material response. Resend the exact proposal while retained; recover identical canonical material, apply once, and observe one authority storage/presentation consequence. Drop its receipt too, retry again, and settle presentations before/after duplicates.
- Delay exact and conflicting old proposals/materials past retirement. Neither may apply gameplay or erase private control/pending presentation state. Distinguish provable retained conflict from old evidence requiring recovery.
- Disconnect beyond several windows, reconnect with a newer authenticated generation, recover and continue real gameplay. Reject old-generation traffic, wrong content/session/seat, rollback checkpoints and gaps. Duplicate recovery responses and lost recovery receipts remain idempotent.
- Snapshot/restore and current worker reload at rollover with held timers, pending presentation and unresolved commands. Compare full per-seat state and continuation. Force late response-budget rejection and ensure no pruning or frontier change commits.
- Cross browser request-cache windows separately; do not confuse cached browser request retries with peer proposal/material recovery.

## Remaining implementation questions

The current proposal snapshot lacks age and response ownership; choose an explicitly compatible current extension or versioned shape and audit historical consumers. Prove operation IDs cannot be reintroduced as fresh accepted operations after retirement; current root revision checks alone do not establish lifetime ID uniqueness. Define which acknowledgement protects unresolved ownership versus merely confirms transport delivery. The existing authority-log recovery format may not represent V7 game material/private ownership directly. These are source design and implementation tasks, not external blockers. No existing tests or inspected handlers establish the complete repair yet.

## Canonical control prerequisite and narrowed first cut

The canonical-control prerequisite is implemented in the working tree, pending
separate remote qualification. V7 snapshots optionally retain the exact canonical
BattleCommand control, the exact locally selected return control, and the local
navigation owner. The canonical owner may differ from that local owner. Capture
starts before root navigation or opening Fight/Party; Escape restores the retained
return control without allocating a guessed parent. Material apply and authority
dispatch restore the exact canonical control on a staged candidate. Duplicate
material discards that candidate and preserves the entire private snapshot.

Validation binds revision, battle/turn operation, canonical and local actors,
return-menu structure and legal leaf actions. Where applied material exists, its
latest after-state digest must match the state with the retained canonical control.
An unchanged root/quiescent snapshot needs no new metadata. A root without
ownership is rejected at restore if the latest material proves its state differs;
fresh constructed roots without contrary ledger evidence remain accepted. Old synthetic private
leaves without canonical ownership still decode as GameSaveV2 data but cannot be
restored into V7 by guessing; genuine V7 private snapshots roundtrip with ownership.

The extended `coop_waits_for_all_human_commands` witness covers repeated Fight
reopen/cancel on both endpoints, guest-private navigation while the shared root
still belongs to the host, snapshot continuation, missing/wrong ownership/context
rejection, duplicates before/after settlement, and late presentation-collision
rollback. `private_party_reopens_restore_exact_root_and_apply_canonical_material`
adds controlled legal reserves to a naturally created co-op run, exercises repeated
Party navigation on both seats, and checks the material's full canonical before
digest and replica convergence. This is controlled Party coverage, not a claim of
natural acquisition of reserves. Long-session retention and lost-reply recovery
below remain unimplemented.

Qualification must include the four current coop tests, four snapshot tests and
the existing domain journeys (with explicit rejection of the three synthetic old
leaf-only save states). Run the existing current kernel, shared session, worker,
CLI replay, native/Wasm parity and Chromium witnesses because the optional snapshot
metadata participates in exact digests. Existing frozen parity digests may change
for private-menu events; obtain remote evidence and document the specific change
before updating any golden. No local workloads have been run.

Further source review found that `normalize_local_battle_leaf` and
`collect_battle_action` infer a parent from `leaf.menu_instance - 1`. Reopening
Fight or Party allocates another ID; reconstructing `command_root_control`
also resets selection. A saved parent ID alone cannot establish the state
against which material digests and rooted proposal contexts must be checked.
The current kernel needs the exact canonical control from the last material,
captured before local navigation. Validate its revision, owner and action/state
context in V7 snapshots. Private state from an older snapshot may be impossible
to reconstruct reliably; restoration must not guess. Exact duplicate delivery
must preserve local control, input and timers.

The first implementation should separate bounded duplicate reply recovery from
the later checkpoint exchange. Thread an explicit current material-retention
policy through both GameActionDispatcherV1 proof application and GameRuntimeV6
actual application, preserving historical default behavior. Store current proposal
reply evidence in a V7-owned structure with sender, revision/context, fingerprint
and canonical bytes; bound both count and bytes. Recheck connection generation
before replay. Stage admission, reply capture, eviction and final validation
atomically, including the current non-battle path. Retained matches return only
the original AuthorityMaterial, retained conflicts reject, older unretained
requests return a correlated recovery-required outcome, and future revisions
reject. The actual peer checkpoint exchange remains subsequent required work.

Generic operation IDs are arbitrary and may recur after save/load. Bounded
memory cannot prove lifetime string uniqueness. Declare a session, revision,
operation and sender deduplication scope, or first establish a nonreused production
identity rule. Do not claim detection of conflicting bytes after deliberately
retiring their evidence. A controlled rooted-menu loop can prove multiple real
retention windows; it is not uninterrupted natural campaign evidence.
