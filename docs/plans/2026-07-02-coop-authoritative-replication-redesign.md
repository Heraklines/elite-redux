# Co-op (#633) — authoritative session replication redesign

Date: 2026-07-02. Status: DESIGN (approved direction). Supersedes the model in
`2026-06-24-coop-host-authoritative-streaming-design.md` and the tactical fixes in
`2026-06-25-coop-desync-audit-and-redesign.md`; the open-issues snapshot
`2026-06-29-coop-status-and-open-issues.md` is the "before" state this replaces.

Author: Heraklines + Claude (collaborative design session).

---

## TL;DR

Co-op has been a whack-a-mole of desyncs (#680–#719, ~40 separate fixes) because the
guest still runs the whole battle engine and ~10 scattered gates try to muzzle it. This
redesign makes desync **impossible by construction** and **generalizable to any future
content** (triple battles, 3-way co-op, faction screens, domains, new combat formats):

1. **Default-deny renderer.** The guest (renderer) runs *nothing* by default. One check at
   the single phase-construction chokepoint neutralizes every combat phase. New phases you
   add later are safe by default — you never touch co-op.
2. **Two channels, cleanly split.** Correctness rides a *generic, content-agnostic* state
   snapshot (the existing save serializer). Presentation rides a *disposable* live cue
   stream. A dropped/late/missing cue can never desync — only make one animation plainer.
3. **Authority + N renderers.** One authority is the sole engine; every other player is a
   renderer. Ownership is data (`PlayerId`), not a binary. 2 players now, 3-way (triples)
   later is a data change, not a refactor.
4. **One interaction primitive.** Owner drives the UI → authority applies → state
   replicates to all. Non-owners apply nothing. This deletes the "identical pool/state"
   assumption behind desyncs #2/#718 and the entire ME pump.

The result: the guest computes nothing, the authority is the only mutator, and the harness
*proves* convergence (including under fault injection) instead of us patching after reports.

---

## 1. Why the current model fails (diagnosis)

The `2026-06-24` design stated the win condition correctly: *"there is nothing left to
desync because the guest computes nothing."* The implementation never delivered it. Instead
of replacing lockstep, it kept **both** engines and made them a runtime toggle
(`CoopNetcodeMode = "lockstep" | "authoritative"`). In "authoritative" mode the guest still
constructs and runs every battle phase, then each is individually patched to no-op:

- `command-phase.ts:238` — guest writes a fake skipped command and bails.
- `turn-start-phase.ts:86` — guest diverts to `CoopReplayTurnPhase`, but only after
  `CommandPhase`/`EnemyCommandPhase` already ran and had to be muzzled.
- Ten more gates: `enemy-command-phase.ts:47`, `switch-phase.ts:92`, `learn-move-phase.ts:87`,
  `select-modifier-phase.ts:145`, `mystery-encounter-phases.ts` (×4), `encounter-phase.ts:158`,
  `turn-end-phase.ts:215`, `ui.ts:331`.

The real invariant is therefore *"the guest computes everything, and ~10 gates try to stop
it applying what it computed, backed by 9 one-shot side-channels that patch the gaps."* In
an ER fork, any path that rolls RNG, reads per-account candy/passive state, or mutates the
shared party is a new leak — hundreds exist. **You cannot gate your way to correctness.**

Root cause of the process trap: making the netcode *selectable (A/B)* meant lockstep could
never be deleted → the guest engine could never be removed → "guest computes nothing" could
only ever be approximated, never enforced.

Secondary findings (see the 06-29 snapshot for detail):
- The 50-file test suite exercises a *different code path than production* (mirrors the
  guest battle instead of launching it; live streaming off; real launch handshake never
  driven). Green CI + broken live is guaranteed.
- Launch is a 5s poll (`requestEnemyParty`) against a 120s ceiling → the "30s stall."
- Everything the guest can't reconstruct is a separate racy channel (`waveResolved`,
  `expResolved`, `captureParty`, `capturePresentation`, `meBattleHandoffKey`,
  `learnMoveForward`, cheap checkpoint, ghost-pool, live-events), each with its own
  double-apply guard and merge logic.

---

## 2. Principles

1. **Fail-safe by default.** The renderer's default for anything unknown is "do nothing and
   render the authority." Safety is the default, not something we remember to add.
2. **Correctness is generic; presentation is disposable.** Convergence must not depend on
   enumerating content. Animation fidelity may.
3. **One authority mutates; everyone else converges.** No client but the authority changes
   authoritative state. Ever.
4. **Co-op is session-state replication, not battle sync.** The battle is one *view*.
   Factions, domains, shops, MEs, and future formats are other views of the same replicated
   state.
5. **Provable, not hopeful.** Every step is verified in the two-engine harness by asserting
   convergence, including under dropped/reordered cues and unknown phases.

---

## 3. Architecture

### 3.1 The default-deny renderer (the structural choke)

Every phase in the game is constructed through **one** factory: `PhaseManager.create()`
(`phase-manager.ts:568`). `pushNew`, `unshiftNew`, `queueFaintPhase`, `queueDeferred`,
`queueTurnEndPhases` all route through it. That is the choke point.

On a **renderer**, `create()` returns an inert no-op phase for anything **not** on a tiny
explicit allowlist. The allowlist is exactly:

- the renderer's own-slot input collection (its `CommandPhase` for slots it owns),
- the single replay/render phase (`CoopReplayTurnPhase` and its screen-render kin),
- a short set of provably-cosmetic phases (message/animation/UI-only).

Everything else — `EnemyCommandPhase`, `MovePhase`, `MoveEffectPhase`, `FaintPhase`,
`AttemptCapturePhase`, `StatStageChangePhase`, weather/terrain apply, the exp/level/evolution
chain, and **every phase you add in the future** — is neutralized automatically, no matter
who queued it or when (mid-turn `queueFaintPhase`, ability-queued `MoveEffectPhase`, all of
it). The renderer physically cannot run enemy AI, roll battle RNG, or apply damage.

This is an **allowlist, not a denylist**: a new phase is *safe by default*. It replaces all
~10 scattered gates with one factory check + one small list.

The renderer's battle loop becomes exactly: `own input → CoopReplayTurnPhase (render + apply)
→ own input`. Everything between is the authority's, arriving over the wire.

### 3.2 Presentation: the live cue stream (disposable)

The authority is a real animated client; it plays every animation at normal speed. The
moment each visible thing happens, it emits a tiny ordered cue with a per-turn monotonic
`seq`:

```
CoopCue =
  | { k: "message"; text }                       // already localized by authority
  | { k: "moveUsed"; userBi; moveId; targets }
  | { k: "anim"; userBi; targetBi; moveId }
  | { k: "hp"; bi; hp; max }                      // tween to this hp
  | { k: "faint"; bi }
  | { k: "statStage"; bi; stat; value }           // absolute stage
  | { k: "status"; bi; status }
  | { k: "weather"; weather; turnsLeft }
  | { k: "terrain"; terrain; turnsLeft }
  | { k: "switch"; bi; partySlot }
  | ...                                           // extend freely; unknown kinds are ignored
```

The renderer renders each cue the instant it arrives (plays that move's animation on those
battler indices, tweens that HP bar, shows that faint). It never waits for the turn to
"finish." Over a **reliable-ordered** WebRTC channel the renderer is ~one network hop behind
the authority: both watch the same fight together, live. This is the lockstep *feel* without
the divergence, because the renderer animates the authority's facts, not its own computation.

**Cues are cosmetic and cannot affect correctness.** A dropped, late, reordered, or
not-yet-authored cue can only make one animation plainer — never desync (see §3.3 + §5
invariant). New content gets pretty animations as you author cues; until then it stays
perfectly correct, just plainer.

The infra half-exists: `setCoopLiveEmitter` / `coop-turn-recorder.ts` already emit each event
"the INSTANT it is recorded." We make that the *primary, complete* path and demote the
snapshot from "the thing you watch" to "the seatbelt."

### 3.3 Correctness: the snapshot *is* the session save (generic)

`getSessionSaveData()` (`game-data.ts:1353`) already serializes the **entire** authoritative
session into `SessionSaveData` (`save-data.ts:72`): `party`, `enemyParty`, `modifiers`,
`arena`, `money`, `waveIndex`, `battleType`, `trainer`, `challenges`,
`mysteryEncounterSaveData`, and every ER extension (`erDifficulty`, `erMoneyStreaks`,
`erResistBerries`, …). `ReloadSessionPhase` + `loadSession` restore it perfectly. It is a
complete, content-agnostic, production-hardened serializer (cloud-save and resume ride on it).

That gives the bulletproof property via a **forcing function**: anything that matters to a
run must already live in the save (or a reload loses it). The save schema is therefore a
*superset* of everything co-op must replicate, **including content not yet invented**. The
rule: **if it's in the save, it's replicated; and everything meaningful is in the save.** Add
a faction system, a domain, a triple format — the moment you make it persist (which you
must), it flows through co-op with **zero co-op code**.

- **Authoritative snapshot** = the session-save structure (or its battle-relevant subset at
  turn frequency). Complete by construction.
- **Renderer apply** = a *generic reconciler* that walks the serialized structure and updates
  matching live entities in place — no per-content logic, no scene rebuild in the common
  case. (Exists in embryo as `applyCoopFullSnapshot` in `coop-battle-engine.ts`; we make it
  the real, complete path.) A full `ReloadSessionPhase` is the heavy fallback: initial join /
  resume / a detected hard divergence only. Rare.
- **Boundary cadence:** the authority emits a full snapshot at each resolution boundary (turn
  end, screen transition). Cues (§3.2) animate the transitions *between* snapshots so it
  looks live. If per-turn full snapshots ever prove heavy, optimize to deltas later — start
  simple and bulletproof.

**The two-channel invariant (the core safety property):**

> A renderer's authoritative state is a pure function of the snapshots it has applied. Cues
> only drive the animation layer. Therefore no cue — dropped, late, reordered, unknown — can
> change authoritative state; at worst it degrades one animation, and the next snapshot
> reconciles the visuals.

This invariant is what the harness proves in M7.

### 3.4 Authority + N renderers: ownership + input routing

Identity (replaces `"host"|"guest"` and `COOP_GUEST_FIELD_INDEX`):

```
type PlayerId = number;              // 0..N-1, stable per seat
authorityId: PlayerId                // the SOLE engine (conventionally seat 0)
role = (localId === authorityId) ? "authority" : "renderer"
```

Ownership is data, not a constant. Each mon already carries `coopOwner`; generalize it to
`PlayerId` and make it the only source of slot control:

```
ownerOfFieldSlot(slot) := coopOwner(monInSlot(slot))   // no fixed guest slot
```

One player may own several field slots (triples, asymmetric formats) — falls out for free.
Enemy slots are authority-only.

Command routing (generalizes `requestPartnerCommand` to N) at each player `CommandPhase` for
slot S:

- **Owner of S** collects the human command locally → sends `{interactionSeq, slot, cmd}` to
  the authority.
- **Authority** awaits every non-self slot from its owner (per-slot timeout → AI fallback),
  resolves the whole turn once, then streams cues (§3.2) + the boundary snapshot (§3.3).
- **Any renderer that does not own S** writes an inert skipped command and waits for the
  stream. It never awaits, never AI-resolves, never rolls.

"The partner's move" stops being special-cased — it is just "slot S's command, produced by
`ownerOf(S)`, consumed by the authority." 2 players or 3, same code.

### 3.5 The one interaction primitive

Today's three overlapping mechanisms — `CoopInteractionRelay` (owner→watcher choice),
`CoopMePump` (replays the owner's whole button stream into the *watcher's own engine*),
`CoopUiMirror` (cosmetic cursor) — collapse into **one** contract any interactive screen
implements:

```
interface CoopInteraction<TOutcome> {
  id: number;                          // monotonic; both sides agree which interaction
  ownerId: PlayerId;                   // who drives it
  driveLocally(): Promise<TOutcome>;   // OWNER ONLY: real UI, collect choice
}                                      // serializable TOutcome
```

One lifecycle for reward shop, ME, move-learn, evolution branch, **and every future
faction/domain/format screen**:

```
onInteraction(i):
  if local === i.ownerId:  outcome = await i.driveLocally(); sendToAuthority(i.id, outcome)
  else:                    showSpectatorView(i)          // read-only + mirror owner's cursor
  if role === authority:
     outcome = local===i.ownerId ? outcome : await recvFromOwner(i.id)   // timeout -> default
     applyToAuthoritativeState(outcome)                  // ONLY the authority mutates anything
     streamSnapshotAndCues()                             // §3.2 + §3.3 -> everyone converges
  advanceOnAuthoritativeSignal(i.id)                     // closes on all clients, keeps lockstep
```

**The win that ends the desync class:** non-owners apply **nothing** — no re-rolled pool, no
re-run choice, no button replay. They spectate; the authority applies; the state replicates
back via §3.3. The "identical pool/state" assumption (desyncs #2/#718) and the entire pump
are *deleted*. Three mechanisms → one primitive + a cosmetic cursor mirror (`CoopUiMirror`,
kept).

Ownership assignment is a policy on `ownerId`:
- **Authority-owned** — forced/global events (a domain effect, an enemy prompt).
- **Player-owned** — alternating reward shop → round-robin over N by interaction counter; a
  mon's own move-learn/evolution → `ownerId = coopOwner(mon)`.
- **Parallel-collect** (the one exception) — starter select: each player drives their own
  team simultaneously; all outcomes go to the authority, which merges. Modeled explicitly as
  its own shape.

New interactive content picks an ownership policy, implements `driveLocally` + a serializable
outcome, and is co-op-safe by default; cursor-mirroring and convergence come for free.

### 3.6 Launch (and every hard transition) is the first snapshot

Launch is not special — it is the first application of the §3.3 snapshot. The poll is gone.

- **Authority** runs the real launch (starter merge → `EncounterPhase` → generates enemy +
  arena). The instant it has a coherent session, it serializes one full snapshot and
  **pushes** it to all renderers.
- **Each renderer** does not run its own `EncounterPhase` or roll an enemy. It boots from the
  snapshot via the heavy `ReloadSessionPhase` apply (once) and lands already synced.
- **Latency hiding:** the renderer knows the merged party from roster-select (§3.5
  parallel-collect), so it preloads its own party sprites during the authority's
  `EncounterPhase`. When the snapshot lands, only enemy assets remain. Start is event-driven
  (waits on the message, not a clock).

Because launch = "first full snapshot," the **same** mechanism covers every hard transition:
biome change, resume-from-save, ME-spawned battle, a new combat format booting. Zero
per-transition handshake code; triples/domains/factions get launch sync for free.

---

## 4. What dies / what's kept

**Deleted (the fragile surface):**
- The `netcodeMode` A/B toggle + the entire **lockstep** engine path. One mode only.
- `CoopMePump` (button-replay-into-watcher's-engine) — the single most fragile piece.
- The **9 side-channels** (`waveResolved`, `expResolved`, `captureParty`,
  `capturePresentation`, `meBattleHandoffKey`, `learnMoveForward`, cheap per-turn checkpoint,
  ghost-pool-as-special-case, live-events-as-secondary) — folded into one cue stream + one
  generic snapshot.
- The ~10 scattered `if (guest && authoritative)` phase gates + the dual command-relay path.
- The `requestEnemyParty` poll.

**Kept (consolidation, not rewrite):**
- Transport layer (`CoopTransport`, `LoopbackTransport`, `WebRtcTransport`) — generalized to
  broadcast/N.
- `CoopSessionController`, lobby, matchmaking, `coop_runs` D1 — role generalizes to
  authority/renderer + `PlayerId`.
- The serializers (`PokemonData`/`ModifierData`/`ArenaData`/`getSessionSaveData`) — promoted
  to the backbone.
- `CoopUiMirror` (cosmetic cursor), `coopOwner` tagging, the two-engine duo harness, the
  record→replay recorder.

---

## 5. Build order — 7 harness-verified steps (no big-bang)

Each step lands on staging independently and is green in the two-engine harness before the
next. You are never in a broken half-migrated state. The new spine is built **alongside**
behind the existing "authoritative" flag, then flipped and the old paths deleted.

| Step | Change | Harness assertion (the proof) |
|------|--------|-------------------------------|
| **M1** | Default-deny factory gate + allowlist (§3.1) | Spy on `create()`: driving a full turn on the renderer constructs **zero** denylisted phases; renderer field state changes **only** via snapshot apply. |
| **M2** | Full-session snapshot = correctness backbone (§3.3); make `applyCoopFullSnapshot` the complete generic reconciler | After **every** turn, `fullStateChecksum(authority) === fullStateChecksum(renderer)` across all fields (hp/status/stages/ability/form/moveset/items/arena). |
| **M3** | Route **all** interactions through the §3.5 primitive; delete pump + side-channels one at a time | Per interaction type (reward, ME, move-learn, evolution, give-to-partner): owner drives, renderer never enters the interaction engine, both converge to the authority outcome. Pump call sites gone. |
| **M4** | Push-snapshot launch (§3.6); delete the poll | Renderer reaches battle within one snapshot round-trip; **no** `requestEnemyParty` emitted; state converges at wave start. |
| **M5** | Generalize role/ownership to `PlayerId`/N (§3.4); wire 2, N-ready | Re-run M2/M3 convergence with **3** clients (authority + 2 renderers); all three converge. |
| **M6** | Delete lockstep + the toggle + dead code | No `netcodeMode` branches remain; single-mode co-op; full suite green. |
| **M7** | Harness **fault injection** | Drop N% of cues, reorder cues within a turn, inject an unknown phase/cue kind → final authoritative state **still** converges (snapshot heals). Proves cues cannot affect correctness (the §3.3 invariant). |

Harness fidelity fixes folded in along the way (from the 06-29 gaps): drive the **real**
launch handshake (M4), launch the guest battle rather than mirror it (M1/M2), exercise the
**live** cue stream not just a turn-end batch (M2/M7).

---

## 6. Risks / decisions / open questions

**Decisions made (this session):**
- Generic session-state replication over focused battle sync. (Pays forward to all content.)
- Authority + N renderers over strictly 2-player. (3-way co-op later = data, not refactor.)
- Correctness on the real session serializer, not a bespoke checkpoint.
- Cues purely cosmetic; a new visual effect renders **correctly but generically** on the
  renderer until its cue is authored. Accepted trade: correctness never waits on cue work.

**Risks / to validate during M-steps:**
- Full-session snapshot size/frequency over WebRTC. Mitigation: compressed (save compression
  already exists, #631); only at boundaries; deltas as a later optimization if needed.
- The generic reconciler must update entities **in place** (no scene rebuild) to avoid a
  visible flicker each turn; the heavy `ReloadSessionPhase` path is join/resume/divergence
  only. Validate the in-place reconciler covers form/ability/moveset/held-item.
- Renderer-owned interaction timeout policy (owner disconnects mid-choice): authority applies
  a safe default and advances. Reuse the existing 30s command timeout shape.
- Asset load on the authority still bounds launch latency (unavoidable; the poll was the
  fixable part). Renderer-side preload (§3.6) hides most of it.

**Open (decide during implementation):**
- Exact allowlist membership for "provably cosmetic" phases (audit each once).
- Whether biome-shop / reward-shop keep per-item cursor mirroring or a coarser spectator view.
- Round-robin ownership rule for N>2 alternating interactions (fairness vs simplicity).

---

## 7. Key files / anchors

- Phase construction chokepoint: `phase-manager.ts:568` (`create`), `:585` (`pushNew`),
  `:595` (`unshiftNew`), `:608` (`queueFaintPhase`), `:669` (`queueTurnEndPhases`).
- Session serializer (the snapshot backbone): `game-data.ts:1353` (`getSessionSaveData`);
  shape at `save-data.ts:72` (`SessionSaveData`); restore via `ReloadSessionPhase` /
  `loadSession` (`game-data.ts:1486`).
- Co-op runtime + the 9 side-channels to fold in: `data/elite-redux/coop/coop-runtime.ts`.
- Correctness apply (make it the generic reconciler): `coop-battle-engine.ts`
  (`applyCoopFullSnapshot`, `captureCoopFullSnapshot`).
- Live cue emitter (promote to primary): `coop-turn-recorder.ts` (`setCoopLiveEmitter`),
  `coop-battle-stream.ts`.
- Scattered gates to delete: `turn-start-phase.ts:86`, `command-phase.ts:238`,
  `enemy-command-phase.ts:47`, `switch-phase.ts:92`, `learn-move-phase.ts:87`,
  `select-modifier-phase.ts:145`, `mystery-encounter-phases.ts` (149/337/386/1040),
  `encounter-phase.ts:158`, `turn-end-phase.ts:215`, `ui.ts:331`.
- Interaction primitive: fold `coop-interaction-relay.ts` + delete `coop-me-pump.ts`; keep
  `coop-ui-mirror.ts`.
- Roles/ownership: `coop-session-controller.ts`, `coop-session.ts`
  (`coopOwnerOfFieldIndex`, `COOP_GUEST_FIELD_INDEX`).
- Transport (generalize to broadcast/N): `coop-transport.ts`, `coop-webrtc-transport.ts`.
- Two-engine harness (point at the real path): `test/tools/coop-duo-harness.ts`; suites in
  `test/tests/elite-redux/coop/`.

---

## 8. Relationship to existing tasks

Reframes #633 and its open children. Closes the intent of #693 (ME choice-forwarding) and
#698 (full-game desync audit) structurally. #672–#679 (interaction alternation) become the
single §3.5 primitive. The M-steps are the new task breakdown.
