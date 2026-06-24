# Co-op alternating interactions (reward shop / biome shop / mystery encounters) — design (#633)

## Goal (maintainer spec)

Reward shops, biome shops, and mystery encounters take **alternating full control**
between host and guest: interaction #1 is the host's (the host drives the whole
screen, makes every pick), interaction #2 is the guest's, #3 host, etc. The partner
WATCHES the owner's screen and does not pick. After each completed interaction the
ownership flips.

## Key principle — determinism means we relay CHOICES, not CONTENTS

PokeRogue is deterministic per seed, and co-op already pins both clients to the
host's run seed (verified live: identical enemies, identical battle seed, identical
wave seeds). Therefore **both clients independently generate the EXACT same**:
- per-wave reward options (`getPlayerModifierTypeOptions...`),
- biome-shop stock (`getPlayerShopModifierTypeOptionsForWave`),
- mystery encounter + its option list.

So we do NOT serialize/stream the pool. We relay only the **owner's choice** (an
index into the identical pool, plus reroll/leave actions). The watcher applies the
SAME index to its OWN identically-generated pool → identical outcome (same item,
same money spent, same ME branch + rewards). This is the same lockstep-input model
that fixed the battle command relay: deterministic state + relayed human input.

### Why we still must relay the choice (not "no sync at all")

The POOL is deterministic; the CHOICE is a free human decision made by ONE player
(the owner). The watcher cannot guess it. And the choice mutates SHARED run state
(party items, money, HP, dex) + consumes seeded RNG (e.g. a purchase, a reroll, an
ME branch roll). If the watcher doesn't apply the IDENTICAL choice at the same point,
its RNG stream + state diverge for everything after. So: relay the choice index;
both apply it; stay in lockstep.

## Ownership model

- `CoopInteractionTurn` (already in `coop-session-controller.ts`) is the counter:
  `current()` = "host" on even counts, "guest" on odd; `advance()` flips; persisted
  with the run so a resume continues the order. THIS ALREADY EXISTS and is unit-tested
  — it is currently dead code (nothing calls it). This work wires it in.
- Host is authoritative for the counter: only the host calls `advanceInteraction()`
  (which broadcasts the new counter via the existing `interaction` message); the guest
  mirrors. Each interaction screen advances the counter exactly ONCE on completion.

## Protocol — one new message

`CoopMessage` gains:

    { t: "interactionChoice"; seq: number; kind: string; choice: number; data?: number[] }

- `seq` = the interaction counter value this choice belongs to (so a late/stale choice
  for a past interaction is ignored).
- `kind` = "reward" | "biomeShop" | "me" (for logging / routing only).
- `choice` = the option index the owner picked (or a sentinel: -1 = leave/skip,
  -2 = reroll, etc., per screen).
- `data` = optional extra indices (e.g. the party-target slot for a held-item buy,
  the ME sub-option). Kept minimal; everything else is re-derived deterministically.

A small transport-riding relay (mirror `CoopBattleStreamer.awaitTurn`: buffer +
timeout + supersede) exposes:
- owner: `sendInteractionChoice(seq, kind, choice, data?)`
- watcher: `awaitInteractionChoice(seq, timeoutMs): Promise<{choice,data}|null>`
  (null on timeout → watcher falls back to "leave/skip" so it can never hang).

## Per-screen wiring (all guarded by isCoop + live controller; solo byte-identical)

For each of `SelectModifierPhase` (per-wave reward), `BiomeShopPhase`, and the ME
option handler:

1. Build the (deterministic) options exactly as today — BOTH clients do this.
2. `const owner = controller.interactionOwner();`
3. **Owner** (`isLocalInteractionTurn()`): open the screen normally. On each pick,
   `relay.sendInteractionChoice(seq, kind, idx, data)`. On leave, send the leave
   sentinel. Then `controller.advanceInteraction()` and end.
4. **Watcher**: do NOT open the interactive UI. Show a "Partner is shopping…" /
   "Partner is choosing…" notice. Loop `awaitInteractionChoice(seq)` and apply each
   relayed pick through the SAME apply path the owner used (e.g. the shared
   `applyChosenModifier` / ME option handler) against its identical pool, until the
   leave sentinel. Then end (the guest mirrors the counter via the host's broadcast).

Multi-pick screens (shop: buy several, then leave) stream a SEQUENCE of choices ending
in the leave sentinel — the watcher applies each in order. Single-pick screens (per-
wave reward, ME option) stream one choice then leave.

## Determinism guardrails (must hold or it desyncs)

- Both clients MUST generate the option pool from the SAME seed at the SAME point
  (already true — the pools are rolled under the wave seed). Verify in the harness.
- The watcher must apply the choice through the SAME function the owner's UI calls,
  so the same RNG (if any) is consumed identically.
- Re-enable `BiomeShopPhase` in co-op (currently skipped) once it is owner/watcher
  gated.

## Verification (headless)

- Unit: the interaction relay (buffer / await / timeout-null / stale-seq-ignored),
  over LoopbackTransport — like the battle-stream tests.
- Engine: extend the co-op harness so a wave's reward + a forced ME are driven by the
  OWNER, and assert the WATCHER (a second resolve over the same seed + relayed choice)
  ends with the identical party items / money / outcome. A true two-client compare
  isn't possible (single globalScene), so assert: owner applies choice N → resulting
  state; a fresh apply of choice N from the same-seed pool → identical state.

## Build order (each a commit, verified green, solo untouched)

1. Protocol: `interactionChoice` on `CoopMessage` + the relay (send/await) + unit tests.
2. Wire the per-wave reward (`SelectModifierPhase`) owner/watcher + advance.
3. Wire `BiomeShopPhase` (re-enable in co-op) owner/watcher (multi-pick sequence).
4. Wire mystery-encounter option handling owner/watcher.
5. Harness: owner-drives-reward + watcher-applies assertion; re-run the 10-wave run.

## Out of scope (note, don't silently skip)

- Cross-machine UI rendering of the owner's screen on the watcher (the watcher sees a
  notice, not a live mirror of the owner's cursor) — acceptable v1; the OUTCOME is
  identical, which is what matters for run integrity.
