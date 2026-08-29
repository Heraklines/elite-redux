# Authority V2 oracle map

Project: **PokéRogue Redux**.

This is the Wave 0 M0-0C inventory for the pinned production checkout.

| item | value |
| --- | --- |
| oracle game SHA | `3b534099919efae827019d4a3f3c4ab0ecd6d67b` |
| oracle branch label | `ci/coop/v2-showdown-command-coordinate-20260720` |
| frozen protocol version | `er-coop-47` |
| frame protocol version | `v: 2` (`frame-codec.ts:39`) |
| production Authority V2 modules | 37 |
| Authority V2 node tests | 29 |
| machine-readable artifact | [`authority-v2-map-v1.json`](../../../schemas/kernel/source/authority-v2-map-v1.json) |

The JSON is the frozen inventory. Its `source_files` array is exhaustive for
`src/data/elite-redux/coop/authority-v2/**/*.ts` and
`test/node/authority-v2-*.test.ts` at this SHA; every entry is marked as
production, node-pure test, or simulator test. Its `schemas` records carry the
field-level optional/nullable distinction, producer, consumer, validation,
canonicalization/digest, timer owner, cleanup, and target layer required by the
Rust-kernel port.

## Mechanical contract

The contract declares one global revision order and one retained
`CoopAuthorityLog`; every mechanical progression is one frozen
`CoopAuthorityEntry` (`contract.ts:8-55`, `contract.ts:156-167`). An entry has
mandatory frame context, positive revision, opaque operation ID, one of six
entry kinds, digest-bearing material, a non-null successor control, and an
explicit `subsumes` list. The adapter owns the concrete material shape; the log
owns revision assignment, retention, delivery, receipt quorum, and retirement.

The wire envelope is always `{ v: 2, t, ctx, body }`. Entry and receipt bodies
omit context because the envelope carries the one authenticated context
(`frame-codec.ts:39-61`, `frame-codec.ts:72-129`). The eight context fields are
all mandatory: session/run, epoch, seat map, membership revision, sender and
authority seats, and connection generation (`frame-context.ts:49-87`). Context
compatibility intentionally ignores sender, authority, and connection
generation for shared-game comparison, while exact equality includes all eight
fields (`frame-context.ts:118-149`). The second connection binding supplies
`seatMapId` and `connectionGeneration`; it does not fabricate either value
(`frame-context.ts:155-200`).

The committed progression is:

```text
host adapter/cutover
  -> AuthorityLog.commit (revision, freeze, retention, delivery lease)
  -> authorityEntry delivery / replica admission
  -> admitted receipt
  -> material adapter verifies digest and applies image
  -> materialApplied receipt + material frontier
  -> stated nextControl is projected at its exact address
  -> controlInstalled receipt + control frontier
  -> optional presentationSettled receipt
  -> authority quorum retires the entry and stops redelivery
```

`presentationSettled` is deliberately not mechanical: the replica probes it
only after control installation and never lets it block liveness
(`replica.ts:99-196`, `replica.ts:202-237`). `controlId` is present only on
the `controlInstalled` receipt. A receipt must be signed by the receiving
non-authority peer, match the exact revision and operation ID, and advance
monotonically through the mechanical stages (`authority-log.ts:594-696`).

## Entry kinds and stated controls

The six production entry kinds are the union in `contract.ts:138-144` and are
mapped exhaustively in the JSON:

| entry kind | producer/material | stated successor |
| --- | --- | --- |
| `TURN_COMMIT` | `adapters/turn-command.ts:330`; turn resolution image and digest | command frontier, replacement, or ordered wait |
| `REPLACEMENT_COMMIT` | `adapters/faint-replacement.ts:502`; named proposal/image | resume command, next replacement, ordered wait, or terminal wait |
| `INTERACTION_COMMIT` | learn, mystery, reward/market/biome adapters and `cutover-interaction.ts:990` | shared interaction or ordered wait |
| `CONTROL_COMMIT` | explicit command-open or interaction-open chokepoint, `control-open.ts:227` | command frontier or shared interaction |
| `WAVE_ADVANCE` | `wave-terminal.ts:355`; complete between-wave transition | command frontier or ordered wait |
| `TERMINAL_COMMIT` | `wave-terminal.ts:437`; final/shared-fault terminal image | terminal freeze |

`CoopNextControl` has five variants (`contract.ts:272-377`):

- `COMMAND_FRONTIER` is the whole set of living human battler addresses. Each
  target has owner seat, stable Pokémon ID, and field index
  (`contract.ts:245-258`). `command-frontier.ts:95-129` omits AI,
  unpresented, and known-fainted actors and reports missing ownership as an
  unresolved issue rather than assigning a seat. Showdown enemy-side
  coordinates are normalized by `resolveCoopV2ShowdownCommandProof`
  (`command-frontier.ts:230-255`).
- `REPLACEMENT` exposes one executable head plus an immutable `remaining` tail.
  Its address is epoch/wave/turn/occurrence/field plus owner and operation ID
  (`contract.ts:260-270`). The tail is checked for same-boundary coordinates,
  increasing occurrences, and unique identities (`next-control.ts:649-702`).
- `SHARED_INTERACTION` names owner, coordinate, closed surface class,
  operation kind, and a successor kind set. `successor.operationIds: null` is
  an explicit wildcard; it is not an omitted field or local successor choice
  (`contract.ts:295-322`, `next-control.ts:745-802`).
- `AWAIT_SUCCESSOR` is an address-constrained park. Its required
  `afterOperationId`, coordinate, allowed entry kinds, boolean
  `allowNextWaveStart`, and nullable `expectedOperationId` are distinct from
  the optional interaction/control address allowlists
  (`contract.ts:324-370`). `successorWaitAllows` checks same-wave settlement,
  exact nested addresses, and the explicit N+1 rule
  (`next-control.ts:135-236`).
- `TERMINAL` carries only a non-empty shared terminal ID and is legal only on a
  `TERMINAL_COMMIT` (`contract.ts:371-377`, `authority-entry.ts:159-168`).

`controlIdOf` is a complete address encoding, not a display label. It includes
all variant fields, percent-encodes opaque IDs, and canonicalizes set-like
command and allow-list collections (`next-control.ts:58-106`). The same ID is
used by the control ledger, receipt proof, command lease, and projector.

## Frontiers, retention, admission, and supersession

`AuthorityLedger` has three independent monotonic cursors:

| cursor | advancement point | meaning |
| --- | --- | --- |
| received | `markReceived` (`authority-ledger.ts:100-110`) | in-order journal admission, before material application |
| material | `markMaterialApplied` (`authority-ledger.ts:112-122`) | canonical material has applied; it may advance control only for an entry with no required control |
| control | `markControlInstalled` (`authority-ledger.ts:124-130`) | exact stated control is installed |

The replica admits at most one incomplete revision and requests a missing tail
once (`authority-log.ts:794-893`). It never accepts a later revision while
the material/control frontier is blocked. `adoptFrontier` is monotonic and
recovery-specific; `adoptRecoveryMaterialFrontier` advances received/material
to the proven image while leaving control one revision behind until the
recovered control is installed (`authority-ledger.ts:132-159`).

The authority retains unresolved entries in a bounded revision window. Default
capacity is 512, and a new revision is refused at capacity rather than evicting
an unresolved oldest entry (`authority-ledger.ts:162-208`,
`authority-log.ts:139-156`). `subsumes` is explicit supersession: wave advance
retires stale same-wave turn/replacement entries, terminal retires final live
events, and interaction/ME results retire their obsolete waits. Subsumption is
performed when the entry first reaches admitted and is not a second journal
(`authority-log.ts:185-204`, `authority-log.ts:1032-1068`).

Recovery slices are reconstructed from the same log. At equal nonzero frontier
the latest entry is returned as a one-entry control reconstruction proof; at a
lower captured frontier the retained tail must be contiguous through the exact
frontier (`authority-log.ts:728-787`). No recovery path invents a successor.

## Producers and consumers

Production producers are deliberately separate from test/tools semantics:

1. Adapter builders validate a complete image and state the successor. The turn
   builder is barred while mutation tokens remain (`turn-command.ts:166-203`);
   the control-open builder captures the complete post-entry-effects image
   (`control-open.ts:145-216`); wave/terminal builders state the transition and
   supersession (`wave-terminal.ts:331-458`).
2. `cutover-turn`, `cutover-replacement`, `cutover-interaction`, `cutover-wave`,
   and `cutover-control` are browser integration wrappers. Their mode is
   `v2` only when build capability, negotiation, and the harness are all
   present (`cutover-turn.ts:74-137`, `cutover-interaction.ts:68-105`).
3. `shadow.ts` owns the runtime instance and guarded taps. In shadow mode it
   computes v2 entries/parity while legacy remains live; in a later flip the
   same taps are the host authority seam (`shadow.ts:535-678`,
   `shadow.ts:1497-1614`).

The principal consumers are:

- `protocol-validator.ts:328-407` turns raw values into valid, cosmetic-drop,
  or protocol-violation classifications. Unknown frame types are cosmetic;
  malformed known mechanical frames are violations.
- `AuthorityLog.admit` (`authority-log.ts:794-868`) checks context, authority
  peer/generation, ordering, predecessor successor authorization, and gap
  behavior.
- `replica.applyEntry` (`replica.ts:99-196`) applies material before control
  and emits the stage receipts.
- `CoopV2ControlLedger` (`control-ledger.ts:125-199`, `control-ledger.ts:239-495`)
  binds the entry revision/material to an exact control claim and, for
  executable interactions, to an active exact phase/handler generation.
- `DefaultCoopControlProjector` (`control-projector.ts:138-257`) maps the
  already-stated control to an injected local surface. Its only outcomes are
  installed, already-installed, deferred for engine pacing, or rejected.
- `interaction-projection.ts:144-311` decodes closed immutable constructor
  capsules. A missing capsule returns `null`; it never reads an ambient Phaser
  queue to recover a surface.

## Canonicalization and digest evidence

The JSON artifact records every production digest scheme. The common rules are:

- `authority-entry.ts:80-148` is the structural wire-stability gate: plain
  JSON, no undefined, no array holes, no non-finite numbers, no cycles,
  bounded depth.
- `turn-command.ts:299-315` uses recursively sorted canonical JSON and
  FNV-1a64. `selectTurnCommitImage` omits optional companion keys whose value
  is `undefined` (`turn-command.ts:107-127`), while explicit `null` remains a
  payload value.
- `control-open.ts:219-225` uses sorted JSON plus FNV-1a32 with distinct
  `command-open:` and `interaction-open:` prefixes.
- Learn interactions use `ic1-<surface>-<FNV-1a64>`
  (`interactions-learn.ts:388-400`); mystery/catch/revival use
  `ix1-<kind>-<length>-<FNV-1a32>` (`interactions-mystery.ts:329-338`);
  reward/market/biome use kind-prefixed FNV-1a32
  (`interactions-reward.ts:137-145`); replacement uses its `rc1` length/hash
  form (`faint-replacement.ts:299-334`); wave/terminal uses kind-prefixed
  FNV-1a32 (`wave-terminal.ts:241-243`).
- `cutover-interaction.ts:489-514` uses
  `interaction-envelope-v1:<FNV-1a32>`. Its
  `freezeInteractionWireMaterial` performs an intentional JSON round trip
  before freezing/digesting (`cutover-interaction.ts:520-546`), so undefined
  object properties are removed in that one wire-material capsule. This is
  distinct from the generic entry stability validator and is recorded as an
  explicit canonicalization rule, not guessed behavior.

## Timers and cleanup

All production timers go through the injected scheduler and carry
`{ ownerId, address, reason }` (`contract.ts:82-104`, `scheduler.ts:119-199`).
`connected`, `recovery`, `renderer`, and `humanInput` classes pause/resume;
`absolute` does not (`scheduler.ts:8-28`, `scheduler.ts:201-282`). The
defaults and owners are enumerated in the JSON `timers` array. The important
mechanical cleanup rules are:

- Authority delivery starts at 250 ms, doubles to 5 s, and stops only when
  mechanical quorum, supersession, or disposal stops the lease
  (`authority-log.ts:131-142`, `authority-log.ts:1032-1141`).
- Command request leases are 500 ms, max eight attempts, connected-time, and
  reference-counted by exact control ID (`turn-command.ts:419-446`,
  `turn-command.ts:459-552`).
- Replacement/reward owner windows are 60 s human-input time
  (`faint-replacement.ts:542-577`, `interactions-reward.ts:711-745`).
- Proposal leases retry on connected time but have a 20-minute absolute
  ceiling; exact committed operation observation cancels them
  (`proposal-lease.ts:76-177`).
- Recovery uses a 300 s request timeout, 30 s control-install window, and 16 ms
  recovery pacing; every failure terminalizes the fence
  (`recovery.ts:108-110`, `recovery.ts:359-475`).
- `CoopLifecycle.disposeAll` cancels resources before aborting the context
  (`lifecycle.ts:151-198`); `AuthorityLog.dispose` stops leases and clears
  retained/pending state (`authority-log.ts:994-1008`); shadow disposal also
  unregisters its per-transport receiver and clears control/state maps
  (`shadow.ts:1433-1474`).

## Recovery and proposal admission

Recovery is a fenced transaction, not a second authority log. The fence is
acquired before the request and freezes command admission, control start,
progression, materialization, and authority-wait creation
(`recovery-fence.ts:7-39`, `recovery-fence.ts:99-187`). Only the narrow
`allowControlProjection` window permits the authority-stated control surface
and its dependent wait to start. A terminal fence never reopens.

The transaction sequence is:

```text
acquire fence
  -> capture received/material/control frontier
  -> correlated recoveryRequest
  -> validate request/frame/membership/frontier/tail
  -> apply material
  -> stage recovered material frontier
  -> allow and install exact stated control
  -> send recoveryApplied proof
  -> release fence
```

`validateRecoveryBundle` requires a nonzero frontier to have an operation ID,
non-null successor, and contiguous required tail; revision zero is the only
case with `frontierOperationId: null`, `nextControl: null`, and no tail
(`recovery-bundle.ts:118-241`). A bundle below the fence-captured frontier is
classified stale and never applied. `recovery-channel.ts:604-725` correlates
bundles and completion proofs and explicitly does not retire `AuthorityLog`
entries.

Proposal admission is separate from progression: the admission ledger maps an
opaque operation ID to a fingerprint and returns duplicate/conflict/invalid or
capacity-exhausted without assigning a revision
(`proposal-admission.ts:8-64`). The proposal lease retains the guest request
until the exact operation result is observed; it is not a material/control
lease (`proposal-lease.ts:8-24`).

## Browser adapter boundary and simulator separation

Mechanical truth is the Rust-port target: frame context, entry ordering,
material/control frontiers, receipt quorum, control IDs, successor validation,
retention, recovery, and scheduler ownership. The browser layer only executes
the stated plan. `control-projector.ts:259-353` contains the concrete
`BattleScene` adapter, but its `hasControl`/phase/UI checks occur after the
engine-free projector and control ledger have accepted the exact control.
`interaction-projection.ts:144-311` similarly requires a closed immutable
constructor capsule. Phaser may report pacing or prove that the addressed
surface exists; it does not decide which successor is correct.

The 28 ordinary node tests exercise production modules through fake seams,
loopback transport, deterministic clocks, or injected sinks. The one
`authority-v2-simulator.test.ts` file is explicitly test/tools semantics: its
randomized fault oracle and directed simulator scenarios are useful evidence,
but they are not producers, consumers, wire schemas, or replacement rules.
The JSON `tests` array records this distinction for every test file.

## Stop-condition audit and known gaps

No stop condition was reached in the pinned source. The following boundaries
are recorded so a Rust implementation does not silently collapse them:

1. **Required versus nullable:** `protocol-validator.ts:103-119` requires a
   `payload` key but permits `payload: null` at the generic boundary. Concrete
   adapters then reject incomplete/null images where their contract requires an
   object. This is layered validation, not permission to omit the key.
2. **Absent versus null:** replacement `selected: null` means no legal
   replacement (`faint-replacement.ts:112-123`); recovery frontier fields use
   null only at revision zero (`recovery-bundle.ts:175-214`); `expectedOperationId`
   and interaction wildcard IDs use null as an explicit wildcard. Optional
   `undefined` fields in turn/wave/interaction capsules have separate
   omission rules documented in the JSON canonicalization records.
3. **Receipt revision range:** the generic receipt body validator accepts a
   non-negative revision (`protocol-validator.ts:154-172`), while
   `AuthorityLog.acceptReceiptDetailed` requires that revision to identify an
   exact retained/known entry (`authority-log.ts:594-696`). The structural
   range and semantic lookup are separate layers; zero is not a committed
   entry revision.
4. **Phaser boundary:** the concrete scene adapter is intentionally present,
   but the mechanical decision remains in the entry/control ledger. Any port
   that lets a phase name or ambient queue choose a successor violates the
   closed projection contract (`control-projector.ts:71-129`,
   `interaction-projection.ts:144-155`).
5. **Bridge globals:** cutover/shadow active selectors are module-level browser
   compatibility bindings (`cutover-turn.ts:180-218`, `shadow.ts:1839-1895`).
   They are not revisions, retained state, or mechanical truth and must not be
   carried into the Rust kernel; disposal/clear paths are listed in the JSON.

These are explicit dependency/porting notes, not invented measurements or
fixtures. No local co-op Vitest file or co-op gate was run for this inventory.
