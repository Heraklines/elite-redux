# Elite Redux — Co-op Mode design

Status: DESIGN (decisions locked 2026-06-24). Not yet implemented.

A 2-player cooperative run mode, distinct from Classic/Challenge, where two
players share one run: a low-budget, 3-mon-each, doubles-only format. Each player
controls only their own Pokemon. Real-time connection is peer-to-peer so it costs
effectively nothing on Cloudflare.

---

## 1. Mode rules (maintainer spec)

- **Distinct mode.** Co-op sits alongside Classic / Challenge on the mode select.
  Inside co-op you can ALSO pick challenges (reuses the existing challenge menu) -
  a "co-op challenge" run.
- **Roster.** Each player has a **5-cost budget** in starter-select and may take a
  **maximum of 3** Pokemon. (Uses the existing tier-based starter cost system, so
  5 cost is deliberately tight.)
- **3-slot cap, all run.** A player may never hold more than 3; **catching is
  disabled for a player already at 3.**
- **Doubles only.** Every wild battle is a double battle.
- **Lures off.** Lure modifiers are deactivated / hidden from pools (useless here).
- **Each controls one mon.** In the doubles field, **slot 0 = Player 1's active
  mon, slot 1 = Player 2's active mon.** Each player issues commands and forced
  switches ONLY for their own slot, choosing replacements from their own ≤3 half.
- **Turn timer.** Per-player **30 s**, simultaneous (no waiting on each other). On
  expiry the existing enemy-AI move picker (`getNextMove`) chooses for that player.

The party is effectively two ≤3-mon halves occupying the two player doubles slots.
This maps directly onto the existing doubles engine (we already ship a Doubles Only
challenge); co-op is "a doubles battle whose two player slots are owned by two
humans." **The combat engine barely changes** - the new work is the network
transport and ownership-aware command/switch routing.

---

## 2. Networking architecture

The mode is **turn-based with a 20-30 s decision window**, so latency is a
non-issue - this removes any need for rollback/prediction/low-latency tech.

### 2.1 Transport: WebRTC DataChannel, peer-to-peer
All gameplay traffic flows browser-to-browser over a reliable/ordered WebRTC
DataChannel. **Gameplay never touches Cloudflare → zero CF cost during play.**

### 2.2 Authority: host-authoritative (NOT lockstep)
One client (the **host**, = room creator) runs the real PokeRogue game loop and is
the single source of truth. The other (**guest**) is a thin client: it sends its
inputs and renders the state the host sends back.

- Chosen over lockstep deterministic sync because lockstep desyncs on ANY
  non-determinism (un-guarded `Date.now`/`Math.random`, async phase ordering, float
  diffs). Host-authoritative **eliminates the entire desync-bug class** - only one
  machine simulates.
- Bandwidth is a non-issue: we already serialize full session state for saves, and
  with #631 compression a per-turn delta is tiny over P2P. Start by sending a
  compact turn-result/state delta each turn; optimize to event diffs only if ever
  needed (it won't be for 2 players).

### 2.3 Matchmaking + signaling: lobby Durable Object on the existing worker
Primary flow is a **lobby**, not a raw room code. On entering co-op, a player joins
a lobby (a presence registry on a Durable Object on the `er-save-api` worker) and
appears to others **by username**; you pick an available partner from the list to
pair up. **Host/guest roles are auto-assigned** (e.g. the requester is guest, the
accepter is host - the player never chooses a role; it's not meaningful to them).
Once two players pair, the DO relays the WebRTC SDP/ICE handshake and then play
goes fully P2P (the lobby WS can drop).

- The DO holds a WS only while a player sits in the lobby (waiting) or during the
  brief handshake - **no gameplay traffic ever touches CF**, so cost is just
  "lobby idle time," which is modest.
- Keep an optional **"invite a friend" room code** path alongside the lobby for
  playing with a specific person directly (same DO, a private room instead of the
  open list).
- Requirements: usernames shown are the account usernames; lobby presence
  expires on disconnect; rate-limit join/pair requests; private codes are
  unguessable + expiring.
- For a persistent run, "resume" re-pairs the same two accounts (the run record
  names both), so the lobby/invite flow also drives reconnect.

### 2.4 NAT fallback: free TURN tier + graceful failure
~20-30 % of player pairs are behind NATs that block direct P2P and need a **TURN
relay** (the one place co-op uses real bandwidth). Plan: wire a **free TURN tier**
(e.g. metered.ca free) as fallback; if even that fails, show a friendly
"couldn't connect - try a different network / hotspot." (Short-lived TURN creds can
be minted by the worker if the free tier needs auth.)

### 2.5 Version gate
Both clients MUST be on the same game build (a host-authoritative state blob from a
different engine version could mis-deserialize). Gate at room join on a version
match; refuse + explain on mismatch.

---

## 3. In-battle ownership

- **Command routing.** The `CommandPhase` for slot 1 (the guest's mon) awaits the
  guest's command over the DataChannel instead of local UI; slot 0 awaits the host's
  local UI. A per-player 30 s deadline; on expiry the enemy-AI picker fills the
  missing command. The turn resolves once both commands are in (or the deadline
  passes). The host runs the deadline and resolves through the real phase engine.
- **Forced switches** (the #629 area): when a player's active mon faints, THAT
  player picks the replacement from THEIR half (ownership-aware `SwitchPhase`).
- **Battle Info / Check Team** shows both halves; Check Team gains a **"give held
  item to partner"** action (see 4.2).

---

## 4. Progression

### 4.1 EXP - merged party, normal EXP-Share distribution
Treat the combined party (P1's ≤3 + P2's ≤3, up to 6) as ONE party for EXP. The two
**active** doubles mons (one per player) get full participation EXP; the benched
mons get the EXP-Share trickle (~20 %+ depending on the EXP-Share modifier level).
This is exactly how PokeRogue already distributes EXP across a 6-mon party - the
host just runs the normal distribution over the merged party.

### 4.2 Items - by type
- **Run-wide / general-effect modifiers** (relics, Shiny Charm, Amulet Coin, EXP
  charms, etc.) → applied to **both** players' halves automatically.
- **Held items** (Leftovers, berries, type boosters…) → attach to a mon in the
  **picker's** half. Either player may **hand a held item to their partner** from
  the Check Team screen.

### 4.3 Money - shared pool
A single shared money pool both players spend from.

### 4.4 Interaction alternation
Reward screens, mystery encounters, AND between-wave shops **alternate ownership
per interaction**: P1 drives this interaction, P2 the next, etc. The driver makes
the picks (spending the shared pool) while the partner watches. A persisted
**alternation counter** in the run state tracks whose turn it is (so a resume
continues the correct order).

- **Multi-step mystery encounters count as ONE interaction:** whoever owns the ME
  keeps making all its choices ("keeps pressing") through the whole encounter;
  ownership passes to the other player only on the **next** screen after leaving it.

---

## 5. Persistent shared run

Runs are resumable. The co-op run lives in a new **`coop_runs`** table on the
`er-save-api` worker, written **only at wave boundaries** (the same cadence as a
normal save - NOT per turn), so quota stays safe. Gameplay stays P2P; only the
periodic save checkpoint touches the worker.

- **Authority + writes.** The host owns the canonical run and is the only writer at
  each wave boundary; the guest reads it on resume. (Avoid both-write conflicts.)
- **Resume requires BOTH players.** A cold resume always needs both in the room.
  Because the run is in shared D1, either player can be the host next time (no
  strict host-migration needed - whoever re-opens the room and loads the run hosts).
- **Mid-session disconnect → pause + grace period.** If a player drops mid-run, the
  run **pauses** and waits a few minutes for reconnect. If they don't return, the
  remaining player chooses **continue-with-AI** (AI runs the absent partner's mons)
  OR **save & quit**. (So: you can't cold-start/resume solo, but an in-session drop
  has a grace + solo-with-AI fallback.)

---

## 6. Cross-cutting

- **Ghost pool exclusion.** Co-op runs must NOT feed the ghost-trainer pool
  (mixed-ownership / P2P-trust teams). Flag/exclude at the capture point.
- **Anti-cheat.** P2P + host-authoritative means the host could tamper with state;
  cooperative play + ghost exclusion makes this low-stakes. No competitive
  leaderboard, so acceptable for v1.
- **Mystery-encounter audit.** Many MEs assume a single party / single
  decision-maker. Each ER ME (Bargain, delves, shops, Picnic, etc.) needs a pass to
  work with the "owner picks, merged party" model. This is a real chunk of work -
  not all MEs are trivially co-op-safe.

---

## 7. Phased implementation outline

0. **Transport plumbing.** Signaling Durable Object (room codes, rate-limit,
   expiry) + WebRTC DataChannel wrapper + TURN fallback + version gate + a co-op
   lobby (create/join by code).
1. **Mode + roster.** Co-op mode entry on mode select; two-player starter-select
   (5-cost budget, ≤3 mons) with synced start; lures off; per-player 3-cap +
   catch-disable-at-3.
2. **Host-authoritative battle.** Doubles with slot ownership; route guest commands
   into `CommandPhase`; per-player 30 s timer + AI fallback; ownership-aware forced
   switches; host→guest turn-state sync.
3. **Progression.** Merged-party EXP; run-wide vs held-item rules; Check Team
   "give to partner".
4. **Interaction alternation.** Alternation counter + shared money across reward /
   shop / ME screens; multi-step-ME ownership rule; co-op-aware ME audit.
5. **Persistence.** `coop_runs` D1 table; wave-boundary checkpoint; resume-requires-
   both; disconnect grace + continue-with-AI / save & quit.
6. **Challenges + polish.** Challenge layering inside co-op; ghost-pool exclusion;
   reconnect UX; failure/timeout messaging.

---

## 8. Open risks / to validate during implementation

- TURN reliability/cost at scale (free tier limits); fallback messaging.
- ME co-op-safety is the biggest unknown-size task (section 6).
- Host perf/connection affects both players (host = authority).
- Save-format/version coupling across the P2P state sync (version gate mitigates).
- Re-sync cost on reconnect after the grace period (send a fresh full state).
