# Co-op protocol 38 contract (P33 authority architecture)

Status: **frozen for implementation**. Wire version: `er-coop-38`.

This contract reconciles the two incompatible protocol-32 development lines and closes the identity model
that made invitation direction, authority, gameplay ownership, and transport setup all look like one
`host | guest` flag. No P33 implementation branch may invent a private wire arm or reinterpret one of these
axes. Schema changes require an integration-owner update to this document and compatibility fixtures.

## Safety invariant

Either every required renderer has applied the same addressed state and opened the same addressed
continuation surface, or every member enters one bounded shared recovery/terminal state. No member silently
advances, falls back to local gameplay, or waits forever.

Consequences:

1. The authority is the only gameplay reducer.
2. Gameplay ownership is an immutable run seat, not the current invitation direction.
3. Every authoritative commit binds session, epoch, seat map, membership revision, sender seat, connection
   generation, surface, and revision.
4. Receipt, material application, presentation readiness, and continuation readiness are distinct evidence.
5. A retained commit retires only after the frozen required-seat quorum reaches `continuationReady`, or after
   a peer-acknowledged shared terminal transaction supersedes it.
6. Recovery starts from an immutable committed boundary and atomically replaces material plus executable
   control state.

## Identity and role axes

```ts
export type CoopTransportRole = "offerer" | "answerer";
export type CoopAuthorityRole = "authority" | "replica";
export type CoopSeatId = number;
export type CoopAccountId = string;

export interface CoopAccountIdentityV1 {
  version: 1;
  /** Opaque, immutable, server-issued ID. Never a username. */
  accountId: CoopAccountId;
  /** Mutable presentation only. */
  displayName: string;
  /** Migration aid only. Never authorizes a native P33 action. */
  canonicalUsername: string;
}

export interface CoopSeatBindingV1 {
  seatId: CoopSeatId;
  accountId: CoopAccountId;
}

export interface CoopRunSeatMapV1 {
  version: 1;
  revision: 1;
  /** SHA-256 of canonical {version, revision, seats}; display names excluded. */
  seatMapId: string;
  /** Sorted by seatId; seat IDs and account IDs are unique. */
  seats: CoopSeatBindingV1[];
}

export interface CoopSessionBindingV1 {
  version: 1;
  bindingId: string;
  sessionId: string;
  /** Required for persisted co-op; absent for ephemeral Showdown. */
  runId?: string;
  sessionEpoch: number;
  checkpointRevision: number;
  seatMap: CoopRunSeatMapV1;
  /** May be any active seat. It is never implicitly seat 0. */
  authoritySeatId: CoopSeatId;
  membershipRevision: number;
  source: "fresh" | "resume" | "showdown";
}

export interface CoopFrameContextV1 {
  sessionId: string;
  sessionEpoch: number;
  seatMapId: string;
  membershipRevision: number;
  fromSeatId: CoopSeatId;
  connectionGeneration: number;
}
```

The controller exposes `transportRole`, `authorityRole`, `account`, `localSeatId`, `authoritySeatId`, and
`isAuthority`. P33 removes ambiguous gameplay uses of `controller.role`, `partnerRoleId`, and `seat = role`.
Transport role never selects a Pokémon, assigns a roster half, chooses a winner, or authorizes a mutation.

Fresh seats are the lexicographic ordering of opaque account IDs. A reversed invitation produces the same
seat map. On cold resume the current authority may be either saved seat; authority can change only with a new
epoch. Hot rejoin preserves authority, epoch, run, and seats and changes only the replaced connection's
generation.

## Authenticated account binding

The save/account service already authenticates an immutable numeric user ID. P33 exposes it as an opaque
string account ID (for example, `er-account:<uid>`; consumers must treat the format as opaque) in
`/account/info` and provides an authenticated, short-lived co-op identity ticket.

The ticket payload is:

```ts
interface CoopIdentityTicketV1 {
  v: 1;
  sub: CoopAccountId;
  displayName: string;
  canonicalUsername: string;
  exp: number;
  nonce: string;
}
```

It is HMAC-signed with a secret shared only by the account and signaling Workers. The signaling Worker
verifies expiry/signature and binds the nonce to one lobby identity. It returns a random bearer pairing token;
all lobby, signal, heartbeat, rejoin, and leave calls require that token. D1 stores `account_id` separately from
`display_name`. User-supplied names never authorize a seat. The browser peer hello must match the authenticated
pairing record returned by the Worker.

## Negotiation and binding wire

```ts
type CoopHelloV2 = {
  t: "hello";
  version: "er-coop-38";
  pairingId: string;
  account: CoopAccountIdentityV1;
  transportRole: CoopTransportRole;
  authorityClaim: CoopAuthorityRole;
  /** Local/manual loopback only; never overrides an authenticated public pairing. */
  tiebreak?: number;
  capabilities: string[];
  existingBinding?: {
    sessionId: string;
    runId?: string;
    sessionEpoch: number;
    seatMapId: string;
    authoritySeatId: CoopSeatId;
    membershipRevision: number;
  };
};

type CoopBindingMessage =
  | { t: "sessionBinding"; binding: CoopSessionBindingV1 }
  | {
      t: "sessionBindingAck";
      bindingId: string;
      seatId: CoopSeatId;
      accountId: CoopAccountId;
      accepted: boolean;
      reason?: "identity" | "seat-map" | "authority" | "stale" | "unsupported";
    };
```

After binding, every gameplay/control message carries `ctx: CoopFrameContextV1`. The channel-bound account,
not the claimed `fromSeatId`, authorizes the sender. A binding mismatch is terminal; there is no mixed P32
fallback.

## Membership and ACK quorum

```ts
export interface CoopMemberSnapshotV2 {
  seatId: CoopSeatId;
  accountId: CoopAccountId;
  displayName: string;
  state: "present" | "recovering" | "removed";
  connectionGeneration: number;
}

export interface CoopMembershipSnapshotV2 {
  version: 2;
  revision: number;
  authoritySeatId: CoopSeatId;
  state: "active" | "recovering" | "terminated";
  members: CoopMemberSnapshotV2[];
  requiredAckSeats: CoopSeatId[];
}
```

- Initial accepted channels are generation 0.
- Disconnect marks the seat `recovering`, increments membership revision, and freezes gameplay.
- Accepted hot rejoin requires the same account, binding, seat map, authority, run, and epoch. It increments
  only that seat's connection generation and then membership revision.
- ACKs carry seat ID, connection generation, and membership revision. Stale-generation/wrong-seat ACKs do not
  count.
- Each commit freezes `requiredAckSeats` and membership revision. Disconnect never waives an outstanding ACK;
  recovery replays the retained commit.
- Two-player co-op terminates coherently after rejoin grace expiry. It never continues solo or elects a new
  authority mid-epoch.
- Future removal is an authority-authored membership commit ACKed by all remaining active seats before the
  removed seat leaves later quorums.

The generic durability ACK high-water is tracked per seat and operation class. Turn, replacement, phase-route,
recovery, wave, surface, and terminal ACKs use the same quorum fields.

## Commit lifecycle and continuation readiness

Every material/control transaction follows:

```text
unseen
  -> received
  -> journalAdmitted
  -> materialApplying
  -> materialApplied
  -> presentationReady
  -> continuationReady
  -> committed
```

`journalAdmitted` proves the exact canonical durable-operation envelope entered the receiver ledger. It stops
delivery retransmission only; it cannot resolve a material barrier or retire authority. `materialApplied`
proves detached reconstruction, atomic commit, and checksum. `presentationReady` proves the
required sprite/UI projection exists. `continuationReady` proves the next registered public input or terminal
surface is open with the correct owner seat and operation address. The authority retains the transaction until
every frozen required seat ACKs `continuationReady`. Admission/material-only ACKs cannot clear retention or let
the authority cross the next shared boundary. Retained `WAVE_ADVANCE` republishes exact admission on an
incomplete duplicate, then publishes `materialApplied -> presentationReady -> continuationReady` only after
its immutable DATA image and addressed destination surface are proven.

### Retained Mystery battle settlement (protocol 37)

`opSurface.me.v2` extends each pinned `ME_TERMINAL` stream to the strict ordinal lifecycle
`battle -> battle-settled -> (battle | leave)`. `battle-settled` carries one comprehensive image through
BattleEnd proper plus the exact result, host turn, trainer-victory flag, reward/event/none continuation,
an ordered closed reward plan, and egg-lapse flag. Modifier projections carry a unique stable
canonical ASCII `surfaceId` and an explicit reroll multiplier (`-1` disables rerolls; otherwise finite and
non-negative). Egg projections carry the authority-materialized id, timestamp, registered species, tier,
hatch state, shiny/variant/move/ability flags, source, and bounded display descriptor; replay application is
account-write-gated and idempotent by exact egg identity. The plan is bounded to 16 surfaces, identifiers to 64 characters, and executable multipliers
to at most 1000. An omitted multiplier is normalized to `1` before serialization; an omitted plan, duplicate
identity, unknown surface kind, invalid multiplier, or reward surface on a non-reward continuation fails
closed. The renderer holds the exact BattleEnd until this DATA applies. It may then execute only the declared
tail; one retained `MysteryEncounterRewardsPhase` owns the ordered plan, and a reward continuation cannot
admit final `leave` until
`PostMysteryEncounterPhase`, while event continuation remains fenced at BattleEnd until the next retained
battle or leave. Repeated same-wave battles use increasing terminal steps and never reuse WAVE_ADVANCE.
Mutations performed later by a host-only `doContinueEncounter` callback are not part of that settlement
image; the following retained battle or leave carrier must apply the callback-complete state before opening
its public continuation.

Protocol 37 continues to disable Mystery encounters on a finite mode's final wave. The current destination
union has no retained `GameOver` arm, so admitting such an encounter would leave `none` unowned after
BattleEnd. Adding a typed retained GameOver destination plus renderer proof is a blocking prerequisite before
that spawn restriction may be removed.

### Shared terminal transaction

Every unrecoverable control boundary uses the same retained terminal transaction; surface code must not
clear a local runtime directly. The immutable commit is:

```ts
interface CoopSharedTerminalCommitV1 {
  version: 1;
  terminalId: string;
  terminalRevision: number;
  originSeatId: CoopSeatId;
  epoch: number;
  wave: number;
  turn: number;
  boundaryRevision: number;
  boundary: "authority" | "recovery" | "protocol" | "persistence" | "surface" | "disconnect";
  reasonCode:
    | "capture-failed"
    | "apply-failed"
    | "recovery-exhausted"
    | "peer-lost"
    | "binding-mismatch"
    | "persistence-failed"
    | "continuation-failed"
    | "invalid-authority";
  reason: string;
  quorum: CoopFrozenAckQuorumV1;
}

type CoopSharedTerminalWire =
  | { t: "sharedTerminal"; ctx: CoopFrameContextV1; commit: CoopSharedTerminalCommitV1 }
  | {
      t: "sharedTerminalAck";
      ctx: CoopFrameContextV1;
      terminalId: string;
      terminalRevision: number;
      targetMembershipRevision: number;
      stage: "terminalEntered";
    };
```

The receiver freezes gameplay and enters terminal membership before sending `terminalEntered`. The sender
retains and retries until the frozen seat quorum ACKs with each seat's current connection generation, or an
absolute deadline expires. A hot-rejoin retransmit refreshes only `ctx`; the commit and target membership
revision remain immutable. Simultaneous terminal origins deterministically select the lower origin seat,
then revision and terminal ID. Both sides finalize after quorum/receiver grace or their bounded deadline;
duplicates are re-ACKed without running preparation or finalization twice.

## Resume and persistence

```ts
type CoopResumeCommitmentV2 = {
  version: 2;
  digest: string;
  gameMode: number;
  wave: number;
  revision: number;
  runId: string;
  checkpointRevision: number;
  timestamp: number;
  seatMap: CoopRunSeatMapV1;
  checkpointAuthoritySeatId: CoopSeatId;
  controlRevision: number;
  migration?: { sourceVersion: 1; sourceDigest: string };
};
```

Resume offer/reply/accepted/applied/release/checkpoint messages are P33-frame-addressed and seat-targeted.
`resumeRelease` freezes its required ACK seats. Checkpoint replication is provisional until an addressed
`checkpointCommit` records the exact commitment and all persisted seat IDs; only then do browser/cloud markers
promote it as resumable. Failure leaves the previous fully committed checkpoint as the cold-resume head.

Cold resume order:

1. Discover by account pair and run ID, independent of invitation direction.
2. Classify and reconcile local/cloud replicas under the persistence lease.
3. Migrate old bytes in detached memory if necessary and freeze exact P33 bytes.
4. Bind the saved seat map, choose the current authority's stable seat, and mint a new epoch.
5. Materialize the authority engine, then replicas, from those exact bytes.
6. Persist/apply on the full quorum, commit the checkpoint, release, and ACK release.

### Save migration

| Save shape | P33 disposition |
|---|---|
| Native P33 | Match opaque account IDs; either invitation direction is valid. |
| P31/P32 with `seats.host/guest` | Historical host becomes seat 0 and guest seat 1. Resolve both authenticated accounts, convert every role ownership tag to a seat tag, preserve operation high-water, then hash new exact bytes. Current authority may be either seat. |
| Unordered legacy players only | Visible `legacy-unmappable` block; never guess ownership. |
| Unverifiable renamed legacy account | Block migration. Native P33 remains rename-safe. |
| Solo | Unchanged. |
| Showdown | Ephemeral seat map/session; never persisted. |

## Gameplay ownership and command address

All `role`, `ownerRole`, `ownerIsGuest`, and Pokémon `coopOwner` gameplay fields become seat IDs. Persisted
Pokémon use `coopOwnerSeat`. Roster, reward, biome, Mystery, shop, switch, revive, learn, catch, gift,
Colosseum, Stormglass, ability picker, and UI ownership all route by seat.

```ts
interface CoopCommandAddressV2 {
  epoch: number;
  wave: number;
  turn: number;
  seatId: CoopSeatId;
  pokemonId: number;
}
```

`fieldIndex` remains presentation data only and cannot authorize a command. `showdownResult` carries
`winnerSeatId`.

## Battle topology

```ts
export interface CoopBattleTopologyV1 {
  version: 1;
  revision: number;
  formatId: string;
  sides: { side: "player" | "enemy"; capacity: number }[];
  slots: {
    battlerIndex: number;
    side: "player" | "enemy";
    sideSlot: number;
    partyIndex: number | null;
    controllerSeatId: CoopSeatId | null;
    pokemonId: number | null;
    occupancy: "vacant" | "active" | "fainted" | "pending-replacement";
  }[];
}
```

Turn, replacement, launch, resume, wave, and full-recovery states carry topology. P33 production remains capped
at two player accounts, but no decoder may reject valid current triple battler indices or infer side from
`bi >= 2`. Future six-player support raises membership capacity without another ownership rewrite.

## Required implementation order

1. Merge both P32 histories under the P33 compatibility stamp.
2. Convert battle receiver buffers/finalized/checkpoint state to full addresses.
3. Add authenticated account IDs/tickets and signaling pairing tokens.
4. Introduce explicit binding, stable seats, membership generation, and quorum primitives.
5. Migrate resume/save/Pokémon ownership and command routing to seats.
6. Split material/presentation/continuation ACKs and retain until continuation quorum.
7. Replace raw wave-end and Mystery terminal companions with complete retained transactions.
8. Restore executable recovery surfaces from immutable boundaries with shadow-atomic apply.
9. Replace remaining dual-run shared UI with typed intent -> authority result -> renderer projection.
10. Carry topology everywhere, then expand public-UI, fault, mutation, trace, and campaign evidence.

## Mandatory evidence

- Fresh public-UI run in both invitation directions produces one authority and the same stable seat map.
- A saves, B invites A, and cold resume flips authority without changing either account's Pokémon, command,
  faint-replacement, reward, biome, or Mystery ownership.
- P31/P32 role-tag migration works under reversed invitation; unordered/forged/third-account saves fail closed.
- Hot rejoin preserves binding/seat/authority/run/epoch and increments only connection generation.
- Two-, three-, and six-seat quorum model tests reject duplicate, stale-generation, and wrong-seat ACKs.
- Command spoof tests use seat plus Pokémon ID and survive field transposition/duplicate species.
- Topology covers every single/double/triple index, vacancy, faint, and replacement.
- Only fully quorum-committed checkpoints are offered for resume.
- Built two-browser journeys use public lobby/canvas inputs and assert sprites, UI ownership, continuation
  surfaces, and traces for wave 1 -> reward/shop -> wave 2, boss -> biome/crossroads, Mystery families, faint
  replacement, save/resume, delay/reorder/drop/reconnect, and terminal exhaustion.
- Mutation tests prove the gate fails when addressing, retention, ACK stage, rollback, registry wiring, or a
  renderer postcondition is deliberately removed.

This document freezes the target. A green component gate before all items above is an intermediate staging
checkpoint, not architecture-completion evidence.
