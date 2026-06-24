# Co-op battle: host-authoritative state streaming (#633, LIVE-D)

Status: DESIGN. Supersedes the lockstep battle-sync model (LIVE-C).

## Why we are replacing lockstep

LIVE-C ran the FULL engine on both clients from a shared seed + merged party, and
relayed each player's command. Two live-test logs (2026-06-24, builds identical,
seed/Wave-Seed/Battle-Seed/enemy-IVs all identical) proved the model cannot hold:

- The partner mon was rebuilt with a DIFFERENT moveset on each client (move-legality
  validation strips moves on the host's rebuild; guest's Bulbasaur had Malignant
  Chain, host's had Vine Whip). Move-by-ID relay then can't match -> AI fallback.
- The SAME wild Hoothoot rolled a DIFFERENT ability (Download vs Tinted Lens) from
  identical IVs -> enemy generation is not bit-identical even with a shared seed.
- Net: completely different turn outcomes (a player mon faints on one client; the
  enemy faints turn 1 on the other).

Cross-machine bit-determinism is not achievable for this codebase: hundreds of
custom ER abilities/moves/forms/items consume the battle RNG in subtly different
orders, clients run different locales, and Cloudflare can serve a stale cached
build to one side. Every one of those is a fresh desync. We stop chasing it.

## The model: one engine, streamed outcomes

The HOST runs the ONLY battle-resolution engine and is the single source of truth.
The GUEST never rolls RNG, never generates enemies, never resolves a turn. It:
1. Inputs ONLY its own field slot's command and sends it to the host.
2. Renders a per-turn stream of outcomes the host computes.
3. Applies an authoritative post-turn state checkpoint so it can never drift.

There is nothing left to desync because the guest computes nothing.

### Field layout (unchanged)
Forced double. Merged interleaved party: field slot 0 = host's lead, field slot 1 =
guest's lead, fields 2/3 = enemies (host AI). Both clients still build the same
6-slot party at launch (we keep the rosterSync starter-blob path) and the guest
still adopts the host's seed — not for determinism now, but so sprites/levels/party
identity line up for rendering. Battle OUTCOMES no longer depend on it.

## Integration seams (confirmed in code)

- `TurnStartPhase.start()` (src/phases/turn-start-phase.ts) is the single place a
  turn's resolution is queued: it reads `globalScene.currentBattle.turnCommands[bi]`,
  computes move order, and for each FIGHT calls `phaseManager.pushNew("MovePhase", ...)`,
  then `phaseManager.queueTurnEndPhases()`. THIS IS THE GUEST SEAM.
- Commands are stored in `currentBattle.turnCommands[battlerIndex]`; `CommandPhase`
  fills the player slots, `EnemyCommandPhase` fills enemy slots (rolls AI).
- Phases are constructed by NAME from the frozen `PHASES` map in
  src/phase-manager.ts (~line 139). A new `CoopReplayTurnPhase` is registered there.
- Phase manager API: `pushNew(name,...args)`, `unshiftNew(...)`, `queueTurnEndPhases()`,
  `shiftPhase()`.
- Existing co-op battle hooks are isolated to: `command-phase.ts` (the LIVE-C relay,
  to be reworked), `select-starter-phase.ts` (party build, keep), `attempt-capture-phase.ts`
  (catch gate, keep).
- `CoopMessage` (coop-transport.ts) variants today: hello, ping, pong, commandRequest,
  command, switchChoice, rosterSync, runConfig, interaction, stateSync (declared,
  UNIMPLEMENTED), lifecycle.
- Enemy generation rolls ability/IVs in the encounter path (EncounterPhase) — the host
  will serialize the generated enemy party and the guest will adopt it verbatim
  (no regeneration). [Exact roll site to confirm during D3.]

## Protocol additions (LIVE-D2)

Add to `CoopMessage`:

- `{ t: "enemyPartySync"; wave: number; enemies: SerializedEnemyMon[] }`
  Host -> guest at encounter. The guest replaces its (regenerated) enemy field with
  these EXACT mons (species/form/level/ability/IVs/moves/hp). Guest does not roll.
- `{ t: "turnResolution"; turn: number; events: SerializedBattleEvent[]; checkpoint: BattleCheckpoint }`
  Host -> guest after a turn fully resolves. `events` is the ordered visible log to
  narrate/animate; `checkpoint` is the authoritative post-turn state.
- `{ t: "battleCheckpoint"; reason: string; checkpoint: BattleCheckpoint }`
  Host -> guest for non-turn syncs (after switch/capture/faint-driven sends, on
  encounter start, on resume).

Reuse the existing `command` variant for guest->host (the guest's own slot pick) —
the LIVE-C `broadcastLocalCommand` path stays as the command channel.

### Shapes

```
SerializedBattleEvent =
  | { k: "message"; text: string }              // a battle-log line (already localized by host)
  | { k: "moveUsed"; bi: number; moveId: number; targets: number[] }
  | { k: "hp"; bi: number; hp: number; max: number }   // set + tween to this hp
  | { k: "faint"; bi: number }
  | { k: "statStage"; bi: number; stat: number; value: number }  // absolute stage
  | { k: "status"; bi: number; status: number }
  | { k: "weather"; weather: number; turnsLeft: number }
  | { k: "terrain"; terrain: number; turnsLeft: number }
  | { k: "switch"; bi: number; partySlot: number }
  | { k: "anim"; bi: number; targetBi: number; moveId: number }  // optional move anim cue

SerializedMonState = { hp; statuses; statStages: number[]; fainted: boolean;
                       formIndex?; abilityId?; moveset?: {moveId; ppUsed}[] }
BattleCheckpoint = { field: Record<bi, SerializedMonState>; weather; terrain;
                     arenaTags?: ... }   // field mons by battler index
SerializedEnemyMon = full enough to construct the EXACT enemy (reuse PokemonData-ish)
```

## MVP scope vs. polish

Correctness (what the user actually asked for: "same moves, same damage, same mon
faints") is delivered by the CHECKPOINT + the MESSAGE events alone:
- Guest narrates the host's ordered messages, then applies the checkpoint (tween each
  field mon's HP to the authoritative value, set status/stages, faint the 0-HP mons,
  set weather/terrain). Identical outcomes, readable narration. Ship this FIRST.

Per-move animation fidelity (moveUsed/anim/per-hit hp steps) is a clean follow-on
that consumes the richer events without changing the correctness model. Layer it
after the MVP is proven live.

## Host side (LIVE-D3)

1. At encounter: after enemies are generated, serialize them and send `enemyPartySync`.
2. Keep collecting the guest's slot command via the relay (await it in the host's
   CommandPhase for field 1, with the 30s->AI fallback retained for disconnects).
3. Wrap the turn so the host RECORDS events as they happen. Simplest recorder: tap the
   battle-message pipeline (MessagePhase / queueMessage) for `message` events and read
   the post-turn field for the checkpoint. Richer recorder (later): hook the
   damage/faint/stat/status/weather apply points for ordered animation events.
4. At turn end (TurnEndPhase or a host tap right after resolution), send `turnResolution`.
   Also send `battleCheckpoint` after any out-of-turn state change (switch/capture).
All host code guarded by `isCoop && role === "host"`.

## Guest side (LIVE-D4)

1. At encounter: on `enemyPartySync`, replace the guest's enemy field with the host's
   mons (suppress/override the guest's own enemy generation for co-op).
2. CommandPhase: field 1 (own slot) interactive -> send `command` to host. Field 0
   (host's slot) and enemy slots: auto-fill a placeholder/skip command (the guest does
   NOT await or AI-resolve them — the host is authoritative).
3. EnemyCommandPhase: no-op on the guest (don't roll AI).
4. TurnStartPhase: in co-op-guest mode, DO NOT queue the normal resolution. Instead
   `pushNew("CoopReplayTurnPhase")`.
5. `CoopReplayTurnPhase`: await the host's `turnResolution` for this turn (buffer like
   the LIVE-C inbox handles races), play `events` via existing animation/message helpers,
   apply the `checkpoint`, then `end()` -> normal TurnEnd/next CommandPhase flow.
6. On `battleCheckpoint`: apply it (out-of-turn sync).

## Disconnect / fallback
If the guest's command does not arrive within 30s, the host AI-resolves field 1 (keep
the LIVE-C timeout). If the host stream stalls on the guest, the guest shows "waiting
for host..." and applies the next checkpoint when it arrives (it never desyncs because
it never computes). Lifecycle/disconnect grace from P5 is unchanged.

## Out of scope for this pass (tracked separately)
- Switches / captures mid-battle stream their own events + a checkpoint (D3/D4 cover
  the hooks; full polish later).
- Mystery encounters / shops / rewards already use interaction alternation (P4); they
  are not battle turns and are unaffected by this change.
- Gating the guest's own challenge-select screen (known open issue) — separate fix.

## Build order
- D2: protocol shapes + LoopbackTransport roundtrip tests.
- D3: host enemy serialize + turn recorder + emit.
- D4: guest enemy adopt + resolution suppression + CoopReplayTurnPhase + checkpoint apply.
- D5: tsc/biome/vitest green, dev-scenario note, deploy staging, two-human live re-test.

## Risk / effort
Multi-day. The bounded-but-real surface is the guest-side suppression (3 phases) +
the recorder/replayer. It is robust by construction (guest computes nothing), unlike
lockstep. The MVP (checkpoint + messages) is the smallest correct slice and is what
we build and ship first.
