# Co-op bulletproof-architecture review — desyncs & softlocks

Date: 2026-07-16. Reviewed at HEAD of the local tree (post-`d8445eed8` P32 stack; no coop
code has landed after it except the showdown-tournament UI). Yardstick: the target
architecture and "definition of done" in
`docs/plans/2026-07-12-coop-authority-production-fidelity-audit.md`.
Method: six parallel read-only review agents, one per dimension, each verifying the
audit's claims against current code + hunting new risks — then **every load-bearing
claim was independently re-verified first-hand by the orchestrator** (direct reads of
all cited regions). All file:line refs confirmed against HEAD.

First-hand verification corrections (the agent reports were accurate except these
nuances, all in the *less-bad* direction):

1. The parked turn-commit path (`parkModernTurnCommit`, `coop-replay-phases.ts:1173-1218`)
   has its own 6-s deadline → `failModernTurnCommit`, so a non-converging turn commit is
   bounded at ~6 s, not 20 min. The 20-min band applies to the *waiter* primitives, not
   the commit-park.
2. The 6-s recovery deadline **does** `broadcastAuthorityFailure` before terminating
   (`coop-replay-phases.ts:1923-1935`) — a shared acknowledged terminal. The one-sided
   terminate concern applies only to the two direct `terminateCoopAuthoritySession`
   call sites.
3. Cross-wave inbox bleed (finding 6): a stale wave-W resolution consumed in wave W+1
   would still face the finalize gate (monotonic state-tick + exact checksum +
   structured failures), so the realistic outcome is a **bounded session terminal**,
   not a silent desync. Still a defect — it converts a survivable race into session
   death — but contained.
4. The dual-run reward watcher has real defensive hardening (#854 out-of-range relayed
   cursor is ignored loudly instead of crashing the watcher) — dual-run, but defended.

## Executive verdict

**Where we are: Checkpoint A (live wave-4 containment) is done; Checkpoints B–E are
essentially untouched.** Of the audit's 14-point definition of done, ~1.5 points are
met. The system today is *contained lockstep with detection and bounded terminals*, not
an authoritative replicated state machine:

- **Desyncs**: detection is now strong (structured apply failures, exact checksums,
  retained/retried P32 turn+replacement commits, idempotent same-tick reassert), but
  apply is still **mutate-then-detect, never transactional** — a failed apply leaves a
  torn live scene that is repaired by retry, not rolled back. The five money/ME surfaces
  are still dual-run (guest mutates locally). `waveEndState`/`meResync` are still raw
  one-shot carriers.
- **Softlocks**: the historically-fatal parks are all bounded now (20-min waiter
  timeouts → shared authority terminal; 6-s recovery deadline; replacement retry
  exhaustion → acknowledged terminal; disconnect reaction cancels waits). "Park forever"
  has largely become "park up to 20 minutes, then session death." Two genuinely
  unbounded park classes remain (rendezvous barriers, CoopPartnerSyncPhase), both
  invisible to the stall watchdog.

The pattern the audit prescribes **already ships and works** in three surfaces
(catch-full, revival, faint-switch guest-own-pick: relay-only renderer, host sole
mutator). The remaining migration is applying that proven pattern to the five
high-traffic dual-run surfaces — the debt is concentrated exactly where desync cost is
highest.

## Audit-claim scorecard (current HEAD)

| Audit finding | Status | Key evidence |
|---|---|---|
| P0-1 Apply destructive before valid | **PARTIAL** — detection added (failures force non-ACK; same-tick retry now idempotent), atomicity absent. No shadow-apply anywhere. Tick admitted at `coop-battle-engine.ts:3185` before mutation; party destroy at `:2837-2853` precedes validation | agent 1 |
| P0-2 Recovery snapshots not stable transactions | **OPEN** — `wireCoopResyncResponder` (`coop-runtime.ts:327-356`) still serializes the mutable live scene inline; zero boundary gating on any `captureCoopFullSnapshot` site | agent 1 |
| P0-3 Held-recovery starvation | **PARTIAL** — P32 replacement wake intact + NEW 6-s `recoveryDeadline` → acknowledged shared terminal (`coop-replay-phases.ts:1899-1936`). Still non-atomic, still inside gameplay queue; non-replacement divergence can only resolve by killing the whole session | agent 1 |
| P0-4 Internally turn-keyed | **PARTIAL** — wire addressed, ingress checked; but `pending`/`inbox`/`liveEvents` bare-turn-keyed (`coop-battle-stream.ts:423/427/447`), consumption never re-validates address (`awaitTurn:1824`, `consumeCheckpoint:1613`), `finalizedMark` epoch-blind (`:460`) | agent 2 |
| Replacement causality by adjacency | **OPEN** — N/N+1 window at `coop-battle-stream.ts:2300-2306`; zero `parent*` addresses in repo | agent 2 |
| ACK before continuation readiness | **OPEN** — `completeModernTurnCommit` ACKs+finalizes then calls `finishTurn` (`coop-replay-phases.ts:1152-1164`); `finishTurn` swallows throw + `end()` (`:1434-1506`). No materialApplied/presentationReady/continuationReady stages exist (zero grep hits) | agent 2 |
| P0 waveEndState raw one-shot | **OPEN** — captured at START of BattleEndPhase (`battle-end-phase.ts:30/118`) before money/charge/ability/lapse mutations; fire-once no retention (`coop-battle-stream.ts:1130`); fast guest proceeds on absence (`battle-end-phase.ts:123-124`) | agent 2 |
| P0 ME terminal excludes material state | **OPEN** — `CoopMeTerminalPayload` = kind+hostTurn only (`coop-operation-envelope.ts:300-305`); terminal kind DERIVED from the legacy 9M sentinel (`coop-replay-me-phase.ts:806-817`); outcome still rides raw `meResync` | agent 3 |
| P0 interaction migration dual-run | **OPEN** — `runCoopInteraction` still zero production call sites; reward/biome/market/ME/shop-check watchers all mutate locally; all 12 op classes carry the all-zero `authoritativeState` placeholder | agent 3 |
| P0 journey not a production client | **OPEN** — `buildGuestScene` = `new BattleScene()` + manual pump (`coop-duo-harness.ts:585-611`); Lane P still installs test-only `onCommandRequest` (`coop-soak-driver.ts:1320`) + manual `rendezvous.reannounce` | agent 5 |
| P0 UI-operation debt ledger | **OPEN** — 24 edges declared, 24 still KNOWN_UNDRIVABLE, 0 promoted; no `intentId` anywhere in src/ | agent 5 |
| P0 topology hard-coded | **OPEN** — all five audit sites confirmed + two NEW ones (below) | agent 5 |
| P1 wire decode permissive | **OPEN** for raw carriers (`coop-webrtc-transport.ts:323-365`: object + string `t` → cast); fail-closed only in the operation journal (`coop-operation-runtime.ts:397-408`) | agent 4 |
| P1 command-ownership field-index race | **OPEN** — pre-responder probe keys `msg.fieldIndex`, ignores on-wire `msg.owner` (`coop-battle-sync.ts:833`) | agent 4 |
| Handoff #865 (erMapState derivation) | **CLOSED (root)** — revealed nodes/fragments now in saveDataDigest + restored on heal (`coop-battle-engine.ts:1921-1941, 3940-3953`) | agent 3 |
| Handoff #856 (guest catch-full release) | **CLOSED** — recipient-drives shipped (`coop-catch-full.ts`, `CoopGuestCatchFullPhase`, op:catchFull journal) | agent 3 |

## New findings (not in the 2026-07-12 audit), ranked

### P1 — desync/softlock

1. **Silent modifier-reconstruct drop = session-killing poison pill.**
   `coop-battle-engine.ts:3015-3017` and `:3788-3790` swallow a failed modifier
   reconstruction with bare `catch {}` and NO `recordCoopApplyFailure`. An
   unreconstructable host modifier → guest never converges → holds in
   `CoopApplyResyncPhase` → no replacement carrier matches → 6-s deadline
   **terminates the whole session**. One bad modifier kills the run. Fix: record a
   structured failure at both sites (mirror `applyAuthoritativeMonData:2782`).
2. **Rendezvous barriers park forever, invisible to the watchdog.**
   `coop-rendezvous.ts:281-307` retransmits on timeout and never resolves;
   `rendezvous.oldestNetworkWaitMs` (`:362`) exists but is never wired into
   `wireCoopStallWatchdog` (`coop-runtime.ts:1175` reads relay+battleStream only).
   Callers: `command-phase.ts:778`, `select-modifier-phase.ts:1377`,
   `select-biome-phase.ts:301`, `er-crossroads-phase.ts:205`. Alive-but-stuck partner ⇒
   indefinite park with UI held closed.
3. **`CoopPartnerSyncPhase` loops forever.** `awaitPartnerInteraction`
   (`coop-session-controller.ts:657-671`) retransmits on timeout and never returns
   false; not a relay/stream wait so the watchdog is blind. Only a hard transport
   disconnect frees it.
4. **Battle-stream buffers excluded from the #861 session-boundary purge.**
   `purgeCoopBufferedArrivals` (`coop-runtime.ts:2052`) purges relay+rendezvous only;
   the entire turn/wave-keyed `CoopBattleStreamer` buffer set survives resume/launch-adopt
   (only cleared on `dispose()`, `coop-battle-stream.ts:1945-1986`).
5. **Keepalive has no liveness round-trip.** `ping` only (`coop-webrtc-transport.ts:200`),
   `pong` is dead protocol, `lastRxMs()` diagnostic-only; watchdog trigger requires a live
   `peerBeat` (`coop-runtime.ts:1200`). A silently-dead-but-open peer is reaped only when
   ICE consent expires.
6. **Cross-wave frame bleed.** `inbox` rebuffer (`coop-battle-stream.ts:1785`) never
   cleared on wave advance; a wave-W turn-T resolution can be consumed as wave-(W+1)
   turn-T (`awaitTurn:1824` has no address re-check). Same class for
   `consumeCheckpoint:1613` and `liveEvents` pruning that can't span a wave (`:1669`).

### P2

7. **Ingress address check fails OPEN** when authority context is null/throws
   (`coop-battle-stream.ts:655-671`) — degrades to wave-0/turn-0 comparison between
   battles, accepts everything in harness seams.
8. **Direct `terminateCoopAuthoritySession` is one-sided** (no broadcast) from
   `coop-replay-turn-phase.ts:135` and `coop-replay-phases.ts:1039`; peer learns only via
   channel death — if the channel stays up, the peer rides out its own 20-min timeout.
9. **`awaitTurn` not cancelled on disconnect** (`coop-runtime.ts:1601-1603` cancels
   relay+battleSync only, not battleStream) — up to 20 min before the terminal.
10. **Shop-check (Check Team) has no durable op** — the only interactive surface with
    neither typed op nor fallback (`coop-shop-check-relay.ts`); its ops mutate exactly the
    checksum-hashed party fields; one dropped frame ⇒ divergence until per-turn resync.
11. **`finishTurn` blanket catch erases failure identity** (`coop-replay-phases.ts:1497-1503`)
    — a thrown continuation is indistinguishable from a normal terminal wave.
12. **Lane P never asserts `resyncHeals === 0`** (`coop-soak-fidelity-gate.test.ts:139`
    only logs it) — a journey that heals every wave passes the deploy gate. The audit's
    own "heals = 0" bullet is the one its gate doesn't implement.
13. **Two extra topology truncation sites** beyond the audit's five:
    `coop-runtime.ts:2570` (FAINT_SWITCH rejects `fieldIndex > 3`) and
    `coop-battle-engine.ts:2862` (enemy slot fallback offset = fixed `BattlerIndex.ENEMY`).
    Also: battle move/target/switch/ball/run/Tera are entirely absent from the 24-edge
    ledger (`coop-operation-surface-registry.ts:12-25`), so the debt ledger undercounts
    the real human surface.
14. **`constructAuthoritativePokemon` null unrecorded at its own site**
    (`coop-battle-engine.ts:2786-2795`) — the omission is only caught downstream by
    `reassertAuthoritativePartyOrder`'s length check; fragile by construction.
15. **Trainer battles skip the enemy-shape structural adopt**
    (`coop-enemy-builder.ts:239/252-256` — `wantDouble` fix is wild-only).

## What genuinely improved since the audit (keep)

- 6-s recovery deadline converts un-wakeable resync parks to acknowledged terminals.
- Idempotent same-tick reassert (`reapplyAcceptedCoopAuthoritativeBattleState`).
- Finalize gate requires checkpoint+state applied, zero structured failures, exact
  checksum before ACK — a dropped party member can't be silently ACKed.
- Reconnect stack: generation guards, zombie-pc reaping, 5-s keepalive, 120-s rejoin,
  durability re-send/request on redial, retained P32 commit maps with retry timers.
- Recipient-drives pattern proven in production (catch-full/revival/faint-switch).
- Handoff items #856 fixed and #865 root-closed (docs should be updated).
- `CoopInertPhase` can no longer hold the queue (self-ends) — the wave-51 strand shape
  is structurally impossible; residual is the `finishTurn` guard trio.
- Client-death terminal is deliberate fail-closed with save preserved.

## Distance to "bulletproof" (definition-of-done, 14 points)

Met: durable commits addressed+retained+idempotent for turn/replacement (partially —
internal keying still weak); recovery starvation bounded. **Not met**: no-guest-mutation
(5 surfaces dual-run), no-raw-carrier (waveEndState/meResync/shop-check), stable-boundary
recovery, public-UI journeys, causal-ID coverage, browser gameplay proof, render
postconditions, topology coverage, zero-unsolicited-recovery gates, mutation testing,
verified-artifact deploy, three-seat journey. **Rough score: ~2/14.**

## Recommended order of work (highest desync/softlock value per effort)

1. **Two one-line-class fixes first**: record structured failures at the two silent
   modifier catches (P1-1, kills the poison-pill session-death) and wire
   `rendezvous.oldestNetworkWaitMs` + partner-sync waits into the stall watchdog (P1-2/3).
2. **Extend `purgeCoopBufferedArrivals` to the battle-stream buffer set** (P1-4) and add
   address re-validation at the three consumption sites (finding 6) — cheap containment
   of the turn-keyed class without the full re-keying.
3. **Owner-seat/Pokemon-ID validation in the command ownership probe** (`msg.owner` is
   already on the wire — `coop-battle-sync.ts:833`).
4. **WaveCommit** (Checkpoint B): replace waveResolved/WAVE_ADVANCE/waveEndState with one
   retained post-BattleEnd commit — the largest remaining raw-carrier desync window.
5. **Put the ME outcome inside the retained ME_TERMINAL** (or a committed snapshot ref).
6. **Migrate reward/market onto the proven recipient-drives pattern** (Checkpoint D) —
   the pattern already ships in catch-full/revival/faint-switch; delete or wire
   `runCoopInteraction`.
7. Then the big rocks: shadow-apply transaction, committed-boundary recovery supervisor
   outside the phase queue, production two-client journey lane (Checkpoints B/C tails).
