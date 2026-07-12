# Co-op authority and production-fidelity audit

Date: 2026-07-12

Audited branch: `heraklines/feat/elite-redux-port`

Audited source SHA: `cf714363a15927e84521b69d1b00c5a186e88480`

Latest staging source checkpoint: `9585dacdd`

Status: stop-ship architecture audit and remediation contract. This document records what is proven,
what remains transitional, why long green soaks did not predict ordinary player failures, and the target
architecture/tests required before co-op can be described as authoritative or six-player-ready.

## Executive verdict

The recent work is meaningful and directionally correct, but co-op is not yet a single authoritative
state machine. It currently combines:

1. a host-authoritative battle data snapshot,
2. raw one-shot battle/wave carriers,
3. a durable operation journal,
4. legacy dual-run UI relays that still mutate both clients,
5. a guest-local phase queue that derives important transitions, and
6. recovery snapshots captured from whatever mutable host phase happens to be running.

Those mechanisms can each be locally correct while disagreeing about which transaction is current. The
live wave-4 report proves that this is still happening. A guest accepted a snapshot captured after the
host incremented to turn 2 but before the faint replacement had materialized, failed to reconstruct a
malformed trainer vitamin, and then held its phase queue forever while the completed replacement
checkpoint waited behind it.

The green soaks did not contradict the player. They exercised a materially different system. They copied
or repaired wave state, installed a test-only command responder, directly invoked phases/handlers, and
often ran host and guest under one process-global scene. The newest attempt to remove only two of those
shortcuts is red because it found the guest still sitting on `TitlePhase`. That red is valuable evidence
that earlier green results overstated lifecycle fidelity.

The branch must not be called deployable at `cf714363a`. Full gate run `29204456430` is red in Lane B2.
The previous exact SHA `4f6e786ad` passed the full sharded gate and six-profile Nightly, but the newly
added real-queue journey proves those green results did not cover the production guest lifecycle.

## Evidence checkpoint

### Current CI/deployment state

| Evidence | Result | Meaning |
| --- | --- | --- |
| Full gate, `29204456430`, SHA `cf714363a` | RED | Guest journey hangs on `TitlePhase`; latest source is not a green checkpoint. |
| Full gate, `29204101398`, SHA `4f6e786ad` | GREEN | All then-classified tests passed, but before the real queue-crossing assertion. |
| Six-profile Nightly, `29204108055`, SHA `4f6e786ad` | GREEN | Long harness campaigns passed; this did not prove production UI/phase lifecycle. |
| Staging deploy, `29202804876`, SHA `9585dacdd` | GREEN deploy | This is the code testers exercised in the latest reports. |

Commits after `9585dacdd` through `cf714363a` primarily change tests/harness behavior. They do not remove
the production recovery/transaction defects demonstrated by the newest tester logs.

### Live wave-4 transaction timeline

Paired reports:

- host dev-log commit `7195b1628`, comment `pokemon fainted and we got a desync`
- guest dev-log commit `ccd9e40fa`
- guest visual report `1766d70a4`
- host paired visual report `eb675e4ff`

All four reports are build `mri3cnwh-jxru`, seed `dRRd0fxcwPQVPfTQ2fVfKb16`, wave 4, trainer double,
session epoch `1826695209974432`.

| Time | Host | Guest |
| --- | --- | --- |
| 18:51:15 | Guest-owned Vulpix faints. | Renders faint and opens the real guest replacement picker. |
| 18:51:19-22 | Receives repeated `switch` choice for Venonat, `seq=90001`. | Retains/retries the owner intent. |
| 18:51:22.601 | Publishes turn-1 resolution, checksum `3f6f073a5b1d6fab`. | Applies tick 17 state but computes `5dae4fc857d47dd3`. |
| 18:51:22.629 | Host preimage says `heldItems.0=[2,null,1]`. | Guest has no such held item and requests `stateSync`. |
| 18:51:22.633-651 | Captures and sends a live snapshot while replacement `SwitchPhase` is still queued. The battle turn is already 2, but Vulpix is still the active guest slot. | Queues `CoopApplyResyncPhase`. |
| 18:51:22.813-23.175 | Applies guest switch, summons Venonat, sends durable operation and replacement checkpoint `7403ff42c01f952e`. | Receives/ACKs the operation and buffers the newer replacement checkpoint. |
| 18:51:23.178 | Enters turn-2 CommandPhase and waits at `cmd:4:2`. | Starts the older resync apply first. |
| 18:51:23.354 onward | Waits for guest command boundary. | Resync cannot rebuild the malformed held item, deliberately returns without ending, and blocks the newer checkpoint forever. |

The final headers confirm the deadlock: host is in `CommandPhase` awaiting `cmd:4:2`; guest is in
`CoopApplyResyncPhase` with no runnable queue tail.

### Proven held-item root cause

The malformed tuple was not caused only by skipping the legacy `fullField` fallback. The trainer vitamin
catch-up created `BaseStatModifier` from `new BaseStatBoosterModifierType(stat)` without assigning the
registry ID `BASE_STAT_BOOSTER`. The modifier worked in the host process, but JSON encoded its type ID as
`null`. Every reconstruction path calls `ModifierData.toModifier`, which rejects an unknown/missing type
ID. Enemy-party sync, modern authoritative-state apply, legacy full-field apply, and full snapshot recovery
would all fail to reconstruct the same blob.

The producer and authority-boundary canonicalization must both be fixed:

- Producers must construct generated modifier types with their registry ID.
- Authority serialization/checksum capture must canonicalize the known legacy unkeyed vitamin shape so
  an in-progress older fight/save can still converge.
- Unknown unkeyed modifiers must remain invalid and loud rather than being guessed.

### Earlier same-day player pattern

The July 12 reports show successive first-minute failures moving one boundary at a time:

| Build/report | Human result | Distributed state |
| --- | --- | --- |
| `mrhl3isy-6407`, wave 1 | Both chose a move, game stuck. | Guest parked in `CoopReplayTurnPhase`; host `CommandPhase` still held a pending guest offer. |
| `mrhwrpfq-3oj4`, wave 2 | Guest never entered next battle. | Guest parked in `NextEncounterPhase`; host already at next `CommandPhase` barrier. |
| `mrhxsygt-7gys`, wave 2 | Same next-wave failure after another fix. | Same host/guest boundary split. |
| `mri3cnwh-jxru`, wave 4 | Faint replacement causes desync/softlock. | Mid-transition resync blocks a newer completed replacement. |

This is the expected signature of testing isolated helpers instead of one continuous production journey:
the locally repaired boundary passes, then the first unmodeled boundary fails for the player.

## What the recent agent did well

The following changes are worth keeping:

- One global operation revision and journal ordering replaced independent per-surface clocks.
- Operation application now gates ACK on live materialization rather than journal receipt alone.
- Encounter carriers were made complete and retained, and every next-wave encounter is published.
- Stable command addresses include epoch, wave, owner, and host Pokemon identity.
- Host command offers validate moves, targets, switches, balls, run, and Tera before applying.
- Inbound protocol observers are isolated so one diagnostic handler cannot suppress later consumers.
- Enemy calculated stats, fainted move backing state, PP, field composition, and replacement checkpoints
  received several correct targeted repairs.
- The renderer gate is default-deny at phase construction, which is safer than the old six-phase denylist.
- The causal ledger and submitted control-plane snapshot materially improved live diagnosis.
- Scheduled transport delivery now restores the destination client's scene/runtime/RNG context.
- Public reward UI and real queued phase crossing began replacing direct test handler calls.
- The sharded CI redesign reduced full-gate wall time by roughly 36-38 percent, and six Nightly profiles
  now run concurrently.
- Most importantly, `cf714363a` did not paper over the next failure. It exposed the stale `TitlePhase` and
  turned the newest gate red.

## Stop-ship architecture findings

### P0. Recovery snapshots are not stable transactions

`wireCoopResyncResponder` calls `captureCoopFullSnapshot()` immediately inside the inbound request handler.
It does not require the host to be at a committed safe boundary and does not lock phase/control state while
capturing. `captureCoopActiveControl` records a phase name, waiters, barriers, and pending commands, but that
metadata does not make the material snapshot coherent.

The live report proves the result can mix:

- a turn-2 control marker,
- turn-1/pre-replacement party/field material,
- a checksum from that transient state, and
- journal/control high-water captured before the replacement commit.

Required target: recovery may serve only an immutable committed boundary snapshot plus the journal tail
after that boundary. Never serialize the mutable live scene as the recovery source of truth.

### P0. A failed recovery phase can starve newer authority

`CoopApplyResyncPhase` intentionally holds when its snapshot does not converge. That is safer than
continuing divergent simulation, but the normal replacement checkpoint is only buffered for a later replay
pump. The pump cannot run because the held recovery phase owns the queue.

Immediate safety correction: while held at a safe boundary, observe a strictly newer complete checkpoint,
consume it only when it matches the same epoch/wave/logical turn, apply both numeric and id-keyed state,
require zero structured apply failures and an exact checksum, then release the hold. This is a live rescue,
not the final architecture. The final architecture needs a recovery supervisor outside the gameplay queue.

### P0. Turn resolution is one-shot and under-addressed

`CoopTurnResolution`, live events, waits, and inboxes are keyed by `turn` alone. They do not use
`{epoch,wave,turn}`. The host sends the result once without an application ACK/retention contract. Reconnect
re-requests launch/enemy/ME parties but not the unresolved turn. The guest can wait for the 20-minute default
and eventually take a local fallback path.

Required target:

- address every turn transaction by `{epoch,wave,turn,revision}`;
- retain until every active renderer ACKs successful material application;
- re-request/replay on reconnect and bounded stall;
- never advance mechanics through local AI or timeout when authority is missing.

Presentation cues may be lossy. The authoritative turn commit may not be lossy.

### P0. Wave advancement and post-battle progression are split across racy carriers

The host sends raw `waveResolved` before committing the durable `WAVE_ADVANCE` operation. The guest can
consume the raw frame and advance `lastResolvedWave`; operation adoption can then wait for the envelope, but
the late envelope sees the wave as already resolved and becomes a no-op. The victory/new-battle tail can be
lost permanently under that interleaving.

`waveEndState` is also raw, one-shot, and non-blocking on the guest. A fast guest skips local EXP and can
reach `BattleEndPhase` before the host's EXP/level/evolution chain produces the payload. It proceeds when the
payload is absent. In addition, the host captures that state at the start of `BattleEndPhase`, before later
post-battle money/charge/ability/lapse mutations complete.

Required target: one retained `WaveCommit` after all host BattleEnd mutations, containing final material
state, final checksum, transition, next logical surface, and revision. The guest parks until that exact
commit applies and ACKs.

### P0. The interaction migration is still dual-run

`runCoopInteraction` describes the correct owner-drives, authority-applies, renderers-project lifecycle,
but it has zero production call sites. Its only calls are unit tests.

The live reward, biome, market, and Mystery Event code is explicitly marked `DUAL-RUN`. Examples include:

- reward watcher `applyRelayedRewardAction` applying modifiers/transfers/check-team operations locally;
- biome watcher calling `setNextBiomeAndEnd` and running heal/interest/phase mutations locally;
- biome market watcher reconstructing a modifier and calling `applyModifier` locally;
- deterministic timeout fallback rolling a biome locally;
- legacy raw relay remaining active beside the operation journal.

The operation gate currently improves identity/order, but it does not make the host the sole mutator. A
guest-owned choice can mutate the guest first, then be independently validated/applied on the host. That is
still lockstep with repair, not authoritative replication.

Required target: guest UI emits a typed intent only. The host validates/reduces once. Every renderer applies
the committed projection/state, never the original gameplay handler.

### P0 release gate. The continuous journey is not yet a production client

The newest B2 failure is:

```text
client phase drive to SelectModifierPhase HANG on TitlePhase;
queued=[VictoryPhase], ui=TITLE
```

`buildGuestScene` constructs `BattleScene` directly. `buildDuo` mirrors battle data but never boots the
guest through the production launch/encounter phase lifecycle. Older helpers started detached replay phases
or manually created `SelectModifierPhase`, allowing useful state tests to pass beside the stale real queue.

The correct fix is not to skip `TitlePhase` in `driveClientPhaseQueueTo`. A production-transition rig must
boot the guest with the same launch snapshot, phase queue, UI, and transport callbacks as a browser client,
then preserve that one queue for the entire journey.

Even after the Title issue, the current multiwave test still uses test-only `onCommandRequest`, directly
selects both moves through the host manager, and starts detached replay logic. Those shortcuts must leave
the production-transition lane.

## P1 correctness and completeness findings

### Renderer phase allowlisting does not prove mutation safety

The allowlist labels whole phase classes as `INPUT-INTENT`, but the type system/runtime does not prevent an
allowlisted callback from mutating shared state. The dual-run watcher code proves that allowlisted phases
still call gameplay mutation functions. A class-name allowlist is a useful tripwire, not a capability
boundary.

Target: renderer code receives a read-only projection and an `emitIntent` capability. Host reducers receive
the mutation capability. A renderer build should not be able to import/call shared mutation reducers.

### Active control snapshots are diagnostic, not executable

Snapshot capture records `phaseName`, awaited interactions, barriers, and pending commands. Successful
apply restores membership, interaction counter, and high-water only. It ignores the captured phase, waits,
barriers, and commands. Every new screen therefore needs bespoke resend/re-entry wiring, which is the source
of repeated omissions.

Target: the pending shared surface is a registered serializable state machine with an executable `restore`
or `reenter` function. Recovery reconstructs it from the authoritative journal rather than guessing from a
phase name.

### Checksum/apply coverage has deliberate blind spots

The replication contract explicitly excludes wave, turn, weather duration, terrain duration, score, full
enemy bench/modifier identity, and RNG cursor fields. Some exclusions avoid transient false positives, but
they also mean checksum equality is not a complete proof of mechanical/control convergence.

Target: distinguish:

- committed mechanical state that must be replicated and hashed,
- control state that must be revision-checked,
- presentation state with explicit postconditions, and
- local-only account/cosmetic state.

Do not exclude an authoritative mechanic merely because clients currently advance it at different times.
Remove the independent guest advancement instead.

### Command ownership still has a field-index race

The pre-responder ownership probe decides whether to buffer/decline using the sender's field index before a
cached command exists. During half-wipe/recenter skew, host field 0 can identify the guest-owned survivor
while the guest still sees it at field 1. The probe can decline a legitimate guest command and force host AI.

Target: validate owner seat and stable Pokemon ID from the command address, never remote field geometry.

### A turn is marked finalized before finalization applies

Replay marks a turn finalized when `CoopFinalizeTurnPhase` is queued, not after its checkpoint/checksum
successfully applies. If queue replacement removes the finalizer, the recovery replay is rejected as a
duplicate even though no commit landed.

Target state machine: `unseen -> replaying -> finalizeQueued -> materialApplied -> committed`. Duplicate
rejection may use only the final committed state.

### Wire decoding is structurally permissive

The WebRTC receiver checks only that JSON is an object with a string `t`, then casts it to `CoopMessage`.
Nested payloads are trusted to downstream handlers. Handler isolation prevents one crash from suppressing
the rest, but it does not validate protocol semantics.

Target: a versioned runtime schema per message, size/depth bounds, integer/range checks, exact discriminants,
and fail-closed unknown durable messages. Validate before fan-out.

### Visual state has no authoritative postcondition contract

In the visual report the guest blocks structural `ReturnPhase` and `SummonPhase`. Encounter setup can hide
already-seated enemy containers; the authoritative field apply sees `isOnField()` and previously only
repositioned them. Thus mechanics can be correct while Pokemon remain invisible. The player trainer can also
remain visible while the guest waits in `NextEncounterPhase` because its matching structural summon cleanup
was neutralized.

A blanket `setVisible(true)` is not safe: Substitute, Fly/Dig-style semi-invulnerability, Commander, and
other mechanics can intentionally hide a battler. The immediate repair therefore needs an explicit marker
for Pokemon hidden by trainer encounter setup whose SummonPhase was blocked. The durable design must carry
or purely derive presentation state for those mechanics; `isOnField()` cannot distinguish a missed summon
from legitimate invisibility.

Target: every committed logical surface defines presentation postconditions, for example:

- required active Pokemon IDs are seated and their container/sprite/info are visible;
- non-active Pokemon and both trainer containers are hidden at command input;
- current shared UI mode and owner/watcher affordances match the commit;
- no stale overlay/mirror session remains;
- triple positions match the declared topology.

Presentation repair may never seat/change mechanics. It should only project committed state.

## Why the soaks missed ordinary human failures

### They do not use the production entry points

The current soak/harness still uses several forbidden shortcuts:

- `remirrorWave` or direct party/field copying between clients;
- `healGuestFromHost` at setup;
- test-only `onCommandRequest` instead of guest public command UI;
- host-side selection of both player moves;
- direct phase creation/start outside the real phase manager queue;
- direct reward/ME/shop handler calls;
- queue clearing for special legs;
- restored PP/healed state that a browser player never receives.

`SOAK_FIDELITY=production` removes some healing, but does not change these control-path substitutions into
public client behavior.

### One process is not two browsers

`globalScene`, Phaser RNG, module-level cursors, ghost/ME state, and many registries are process globals. The
context wrapper improved scheduled continuations, but shared module instances still allow accidental state
citizenship. Lane A even runs `--no-isolate` because tests chain a shared scene across files. A production
race between two browser event loops cannot be faithfully represented by synchronous object delivery and
shared globals alone.

### Random depth is not transition coverage

Two hundred waves can repeatedly exercise the same shallow battle/reward loop and miss one guest-owned faint
replacement, cancel/re-enter picker, trainer transition, or reconnect timing. Coverage currently tracks
phases, relay kinds, sequence bands, operation classes, and broad situations. It does not prove every exact
public UI action reached:

`Ui.processInput -> intent send -> host validation -> one commit -> watcher material apply -> visual apply -> ACK`.

Most authoritative UI modes are explicitly `KNOWN_UNDRIVABLE`. That honesty is good, but a green soak must not
be presented as covering those chains.

### Existing evidence can accept recovery or timeout as success

Some tests manually heal the guest, accept a long loud timeout as the expected terminal, fail to assert that
their intended packet drop fired, or scope a known divergence report-only. A green result can therefore mean
"the safety net eventually continued" rather than "the protocol was correct and no recovery occurred."

For production journeys, the default must be:

- checksum assertions = 0;
- stateSync heals = 0 unless recovery is the scenario under test;
- timeout fallbacks = 0;
- AI substitutions for a human-owned command = 0;
- unexpected renderer blocks = 0;
- parked waits/queues = 0 at every declared boundary.

### Browser coverage stops before gameplay

The browser job proves SDP, fingerprint/identity negotiation, RTCDataChannel establishment, and hot rejoin.
It does not drive the lobby UI, start a run, choose a move, resolve a turn, cross a reward, or inspect
rendered Pokemon/trainers.

### Record/replay does not record the race schedule

Replay trace v2 records seed, roster/checkpoint, battle commands, and interaction choices. The co-op loader
then:

- remirrors each wave,
- installs `onCommandRequest`,
- feeds both moves through the host manager,
- constructs a guest shop phase directly, and
- does not replay transport delivery order, retry timers, phase milestones, connection generation, or
  authoritative frames.

The live trace contains the semantic choices but cannot reproduce the stateSync-before-switch/checkpoint
interleaving. It must not be described as a 1:1 distributed replay.

## Target authoritative architecture

### One durable commit stream

Every shared mutation and control transition becomes one globally ordered commit:

```ts
interface CoopCommitV2 {
  session: {
    epoch: string;
    revision: number;
    membershipRevision: number;
  };
  boundary: {
    wave: number;
    turn: number;
    logicalState: string;
    formatId: string;
  };
  cause: {
    intentId: string | null;
    surfaceId: string;
    ownerSeat: number | null;
    expectedRevision: number | null;
  };
  control: {
    pendingInteraction: unknown | null;
    legalOffers: unknown[];
    continuation: unknown;
  };
  material: {
    stateOrDelta: unknown;
    checksum: string;
    contentHash: string;
  };
  presentation: {
    recipeId: string;
    cues: unknown[];
  };
}
```

The exact schema may differ, but these invariants may not:

1. One epoch/revision orders battle, wave, reward, shop, ME, biome, and recovery state.
2. The host is the only gameplay reducer.
3. An input intent names the exact expected surface/revision and is idempotent by `intentId`.
4. The commit atomically states both material and next control state.
5. The guest never derives a shared transition from an outcome bit or local phase queue.
6. Durable commits are retained and replayed until successful material ACK from every active member.
7. Receipt ACK, material ACK, and optional presentation-ready ACK are distinct.
8. Cosmetic cues can drop without changing material/control correctness.
9. Recovery serves the last immutable committed boundary plus journal tail.
10. Unknown schema/surface/phase fails closed at a recoverable supervisor, not inside the gameplay queue.

### Shared-surface contract registry

Every interactive/shared surface must register one executable contract, not only a label:

```ts
interface CoopSurfaceContract {
  surfaceId: string;
  uiModes: readonly UiMode[];
  intentSchema: RuntimeSchema;
  ownerPolicy: OwnerPolicy;
  validate(authorityState: ReadonlyState, intent: unknown): ValidatedIntent;
  reduce(authorityState: MutableState, intent: ValidatedIntent): CommitMaterial;
  project(renderer: RendererState, commit: CoopCommitV2): ApplyResult;
  restore(renderer: RendererState, pending: PendingInteraction): RestoreResult;
  presentationPostconditions(renderer: RendererState, commit: CoopCommitV2): Finding[];
  scenarioFactory: ProductionJourneyFactory;
  faultSchedules: readonly FaultSchedule[];
  replayCodec: ReplayCodec;
}
```

Adding a shop, screen, minigame, nested picker, or operation without every field must fail compilation or a
static completeness gate. The registry should be keyed at semantic action granularity. `op:reward` alone is
too coarse because take, leave, reroll, lock, transfer, check-team, party-target, and nested move selection
have different call chains and continuations.

### Recovery supervisor

Recovery must not be a normal phase queued behind the thing it needs to repair. Introduce a session-level
supervisor that can:

- pause public input;
- compare local applied revision with host committed revision;
- request a stable checkpoint/tail;
- atomically replace material and pending control projection;
- cancel only waits superseded by the adopted revision;
- re-enter the registered surface;
- verify material checksum, control revision, and presentation postconditions;
- resume or explicitly terminate/rejoin.

No recovery path may continue mechanics after a failed apply. No recovery path may become un-wakeable by a
newer valid commit.

## Production-equivalent verification design

### Layer 0: pure protocol/model tests

Run in a minimal Node Vitest project without Phaser/jsdom/globalScene. Generate operation, membership,
command, reconnect, and ACK histories from the same runtime schemas. Inject duplicate, drop, delay,
reorder, disconnect, process restart, and stale epoch. Assert model invariants and compare the real reducer
against the reference model.

This is the fastest loop and should catch sequencing/durability defects in seconds.

### Layer 1: generated UI/adapter contracts

For every registered semantic action, instantiate the real UI handler and call public `Ui.processInput`.
The test must prove:

1. watcher input cannot mutate/send;
2. owner input emits exactly one typed intent with a causal ID;
3. guest-owner intent crosses the real transport;
4. host validates and commits exactly once;
5. both renderers apply the same commit;
6. gameplay state did not change on the guest before commit apply;
7. ACK occurs only after material checksum/control revision match;
8. visual/UI postconditions match;
9. duplicate/late intent and duplicate commit are idempotent;
10. reconnect restores the pending surface and completes it once.

The current UI-to-relay trace is a useful first tripwire, but its synchronous scope cannot prove an async
guest UI to host commit to guest apply chain. Carry the causal ID on the wire/commit and assert the complete
distributed ancestry.

### Layer 2: continuous two-client production journeys

Boot two independent clients through the production launch path and retain one real phase/UI queue for the
whole scenario. No remirror, direct handler, detached phase, test responder, or manual heal is allowed after
the declared setup milestone.

The first deploy-blocking journeys should be:

1. fresh lobby -> wave-1 command from each public UI -> turn -> public reward leave -> real wave-2 encounter;
2. the same with guest-owned reward take and party subpicker;
3. trainer double -> guest faint -> public replacement picker -> next turn command;
4. wild -> trainer transition with sprite/trainer presentation assertions;
5. save resume -> same four boundaries;
6. boss -> biome shop -> crossroads/map -> next biome;
7. representative battle ME and nested-UI ME.

Run each under balanced, owner-fast, watcher-fast, deterministic burst delay, reconnect-before-apply, and
duplicate-retained-commit schedules.

### Layer 3: browser gameplay gate

Use two isolated browser contexts, production connector/RTCDataChannel, real lobby/start UI, and public key
inputs. The gate must cross at least wave 1 -> reward -> wave 2 and one guest faint replacement. Inspect:

- UI mode/phase milestone sequence;
- applied revision/checksum;
- console invariant counters;
- DOM/canvas presentation probe;
- screenshots at command, reward, transition, and post-replacement boundaries.

Keep a smaller transport-only browser smoke for fast feedback. Do not call it gameplay coverage.

### Layer 4: coverage-guided campaigns

Use a transition graph derived from the surface registry. Bias generation toward uncovered edges, nested
pickers, ownership parity, faint geometries, battle formats, and reconnect boundaries. Track exact semantic
action chains, not only waves/phases/classes. A campaign is green only if every expected commit converges
without unsolicited recovery.

Random long runs remain useful after the short production journeys are correct. They are not the substitute
for those journeys.

### Mutation assurance

Regularly run protocol/test mutations that remove or corrupt one send, validator, apply, ACK, renderer
postcondition, or registry entry. At least one fast gate must fail for every mutation. This directly answers
the concern that gates exist but cannot detect missing wiring.

## Replay and submitted-log upgrade

Replay v3 needs two coordinated tracks:

### Semantic replay

Keep seed, roster/checkpoint, and public human actions. Drive them through the new continuous production rig,
not the old remirror/test-responder loader.

### Distributed schedule replay

For the last bounded wave window, record:

- client/seat, monotonic timestamp, logical event-loop step;
- public input and UI mode;
- phase start/end and queue head;
- timer/retry firing;
- transport generation and state change;
- each durable frame's type, epoch, revision, address, payload/content hash, and bounded payload;
- receipt/material/presentation ACK;
- checksum preimage hash and structured apply failures;
- committed boundary IDs and recovery requests/replies.

The loader must reproduce the recorded delivery order and timer schedule across two isolated client
contexts. A trace without schedule data should be labeled semantic-only, not `REPLAYED 1:1`.

The newest real visual reports contain no screenshot section even though a prior diagnostic smoke recorded
one. Treat screenshot attachment as best-effort evidence until staging proves it on real Send Logs. Always
record an explicit screenshot success/failure reason and dimensions/format. For menus, capture the game
canvas below overlays or temporarily exclude diagnostic chrome without advancing gameplay.

## Six-player roadmap

The current code is not N-player-ready despite the helper names and trio launch test:

- `CoopRole` is binary `host | guest`.
- `COOP_PLAYER_COUNT` is fixed at 2.
- every seat above 0 collapses to `guest`.
- party ownership uses two fixed halves and three slots per player.
- empty field ownership falls back to slot 0 host/slot 1 guest.
- turn state carries `double?: boolean`, not a topology/format description.
- command, Tera, switch, reward ownership, and interaction parity contain binary assumptions.
- the trio test's third renderer is not connected, is manually mirrored, and applies launch bytes directly.
  It proves that two objects can deserialize one snapshot, not that three networked seats can play.

Build protocol v2 around:

- stable `playerId` and `seatId` distinct from `authorityId`;
- membership revisions and per-seat connection generation;
- explicit battle topology: format ID, active slots, side, position, owner seat, Pokemon ID;
- command address `{epoch,wave,turn,seatId,pokemonId}`;
- per-seat legal command offer and intent;
- N-party/roster allocation without fixed halves;
- ACK sets/quorum over active membership;
- deterministic owner policy that handles absent/eliminated seats;
- rejoin/replacement seat semantics;
- one-mon-per-player triple/six-active presentation layout.

Before six-way gameplay, prove a real three-client browser journey through launch, one turn, one shared
interaction, reconnect of seat 2, and convergence. Then parameterize to six. Do not raise the constant first.

## CI speed and trust audit

### Good current results

- Grouped Vitest controllers reduced full gate wall time from about 441 seconds to 272-280 seconds.
- Six Nightly profiles complete concurrently in about 143 seconds on the last green run.
- Lane P is genuinely gating rather than evidence-only.

### Required CI corrections

1. Split `coop-duo-multiwave` and `coop-duo-reward-subpickers` into independent parallel jobs. They currently
   serialize behind B2 and dominate the critical path.
2. Give every Vitest invocation a unique blob path. A later green fresh-process test currently overwrites an
   earlier failed grouped/multiwave `.vitest-reports/blob.json`.
3. Add one `if: always()` aggregate job that validates every expected shard/artifact and exposes one stable
   exact-SHA status for staging.
4. Replace stale manual B weights with p90 timings generated from merged reports. Only 15 of 88 B files are
   measured; the rest receive a guessed 27 seconds.
5. Discover tracked co-op tests recursively and fail when any test lacks explicit classification. The current
   top-level `readdirSync` silently omits future `ui/`, `minigames/`, or six-player subtrees.
6. Replace filename/source heuristics with a committed test manifest: layer, setup project, isolation,
   estimated weight, affected surfaces, and required environment.
7. Expand workflow triggers to package/lock files, TS/Vite/Vitest config, setup action, asset submodule pointer,
   patches, and relevant workflows. Prefer broad triggers with safe `paths-ignore`.
8. Static validation must cover `last successful full gate SHA..HEAD`, not only `github.event.before..HEAD`.
   Cancelled/red intermediate commits otherwise escape the eventual green check.
9. Replace the TypeScript count ratchet with a normalized diagnostic fingerprint/multiset. Current baseline
   299 while green output reports 292 leaves seven errors of slack and permits same-count swaps.
10. Shallow checkout and fetch only the last-green/base commit. The static job currently spends substantial
    time on full history and recursive assets it does not use.
11. Cache Vite dependency optimization for the browser job. Current full-app prebundle costs roughly 125
    seconds before a transport-only test begins.
12. Fix remote workflow wiring. The focused workflow cannot dispatch because it is not registered on the
    default branch. Scheduled workflows load their definition from the default branch, so feat's six-profile
    YAML does not automatically control cron. Resolve this explicitly without changing production code.
13. Move pure protocol/model/registry tests into a minimal Node project. Remove Lane A's cross-file
    `globalScene` dependence and run those tests in seconds.
14. Build the staging artifact once after the exact-SHA aggregate gate and deploy that immutable artifact;
    do not rebuild source into an unverified artifact.

Recommended feedback tiers:

| Tier | Target | Contents |
| --- | --- | --- |
| Focused | 45-90 seconds | Changed static checks, affected pure/adapter tests, one exact production journey/fault schedule. |
| Full checkpoint | 2-4 minutes | All tests, T1-T5 journeys, static/build, browser transport/gameplay aggregate. |
| Release confidence | 2-4 minutes plus full build | Parallel coverage-guided campaigns, six Nightly profiles, immutable artifact. |

## Prioritized remediation program

### Checkpoint A: live wave-4 containment

- Fix/canonicalize unkeyed BaseStat vitamins at producers and authority serialization.
- Let a held resync recover only from a strictly newer complete same-boundary checkpoint whose own checksum
  applies exactly.
- Restore presentation-only visibility/info/trainer postconditions after neutralized structural phases.
- Add regressions for malformed vitamin JSON roundtrip, held-resync wake, and hidden already-seated enemies.
- Run focused remote tests, then the full exact-SHA gate. Do not stage or deploy production from a red SHA.

### Checkpoint B: close the three transaction P0s

- Replace turn resolution with retained `{epoch,wave,turn,revision}` commit + apply ACK/re-request.
- Replace `waveResolved` + `WAVE_ADVANCE` + `waveEndState` with one final post-BattleEnd `WaveCommit`.
- Serve recovery from immutable committed boundaries only.
- Move recovery outside the gameplay phase queue.

### Checkpoint C: prove one real journey

- Build a production client bootstrap for the guest.
- Remove Title skipping, remirror, direct guest shop construction, direct dual-move host selection, and
  `onCommandRequest` from T1.
- Make fresh launch -> wave 1 -> reward -> wave 2 green under all timing schedules.
- Add the exact live trainer faint replacement sequence.
- Make this lane deploy-blocking.

### Checkpoint D: migrate shared surfaces off dual-run

- Introduce executable semantic surface contracts.
- Migrate reward/market first, then biome/crossroads/map, then ME/nested pickers.
- Delete legacy watcher mutation and deterministic local fallbacks per surface only after generated adapter +
  continuous journey + reconnect/fault tests pass.
- Wire or replace `runCoopInteraction`; do not leave an unused ideal primitive beside production adapters.

### Checkpoint E: production evidence and six-seat foundation

- Browser gameplay gate and visual baselines.
- Replay v3 schedule capture/loader.
- Coverage-guided registry campaigns and mutation testing.
- Protocol v2 seats/topology/ACK sets, followed by a real three-client journey.

## Definition of done

Co-op may be called bulletproof only when all of the following are true at the same exact SHA:

- no production shared surface has a guest mutation path;
- no raw one-shot carrier is required for material/control correctness;
- every commit has epoch/revision/address, retention, idempotent apply, and material ACK;
- recovery uses stable committed boundaries and can restore every registered pending surface;
- turn, wave, reward, shop, biome, ME, faint, resume, and reconnect journeys use public UI and one continuous
  client lifecycle without forbidden shortcuts;
- every semantic surface/action has generated owner/authority/watcher/reconnect/fault coverage;
- browser gameplay proves the first-minute flow and high-risk faint/transition visuals;
- screenshots/render probes confirm active Pokemon, trainers, UI, and triple layout postconditions;
- unsolicited checksum assertions, resync heals, timeouts, AI substitutions, blocked phases, and parked waits
  are all zero in ordinary journeys/campaigns;
- mutation tests demonstrate that removing any send/apply/ACK/restore/visual wire makes a gate red;
- full aggregate gate and release campaigns are green at the candidate SHA;
- the built artifact is the exact verified artifact;
- three real networked seats complete a journey before any six-player readiness claim.

## What to tell the implementation agent now

1. Do not make `cf714363a` green by skipping `TitlePhase`; replace the guest bootstrap.
2. Treat the live wave-4 logs as two independent bugs: malformed vitamin serialization and un-wakeable
   recovery ordering. Verify both with separate tests.
3. Stop calling dual-run surfaces authoritative. The journal is durable, but the guest still mutates.
4. Finish turn and wave transaction durability before adding more per-symptom relays.
5. Make the short public two-client journey the primary gate. Long soaks become secondary assurance.
6. Carry causal IDs through guest UI intent, host commit, renderer apply, and ACK. A synchronous local trace is
   not end-to-end coverage.
7. Require zero unsolicited recovery in ordinary paths. A heal is a finding, not a green success.
8. Keep each fix focused, run the smallest remote tests first, then one immutable full checkpoint. Do not
   spend a full gate on every harness edit.
9. Do not claim N-ready from the current trio snapshot test. Build protocol v2 identities/topology first.
10. Do not deploy production. Staging is allowed only after the exact-SHA full gate, and architecture/release
    claims additionally require the exact-SHA expanded campaign matrix.
