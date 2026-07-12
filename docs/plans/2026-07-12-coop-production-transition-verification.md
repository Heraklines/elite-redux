# Co-op production-transition verification

Status: implementation plan and coverage contract. This supplements the authoritative-run-state
migration. It does not redefine authority or permit guest derivation.

## Why this lane exists

Long randomized campaigns and operation-level tests are necessary but insufficient. A harness can
reach wave 184 while the shipped game deadlocks at wave 2 if it manually re-mirrors a battle, invokes a
private shop terminal, or advances only one phase queue. The transition lane therefore tests short,
common journeys through the same public UI, phase queue, transport, operation journal, and authoritative
carrier paths used by production.

Every scenario must prove all of the following:

1. Both independent clients enter the expected public UI/phase milestones in order.
2. The designated owner acts through `Ui.processInput`; the watcher receives mirrored cursor/action
   traffic and cannot mutate the choice locally.
3. The host states the outcome and complete next-boundary carrier; the guest does not roll or remirror.
4. Both clients reach the same next logical phase, wave, biome, encounter type, interaction counter,
   operation revision, and authoritative checksum.
5. Neither client is parked on an old UI, unresolved waiter, stale queue tail, or recovery loop.
6. The trace contains the scenario id, action index, owner, phase, UI mode, wave, counter, revision,
   carrier id, and elapsed time so a failure is replayable from one artifact.

Forbidden shortcuts in a production-transition scenario:

- `remirrorWave`, `mirrorHost*`, `healGuestFromHost`, or direct field/party copying;
- calling a phase's private reward/biome/ME selection method;
- directly sending the expected terminal relay instead of pressing the public UI controls;
- constructing only the host tail while asserting guest state through a copied snapshot;
- shrinking a timeout and treating timeout fallback as a successful reciprocal barrier;
- clearing a legitimate queue to skip an inconvenient production phase.

Fault injection is allowed only at the transport/scheduler boundary and must be declared in the
scenario. Setup may force the starting wave, enemy, reward, biome, or Mystery Event so the intended
production branch is deterministic; after the first tested milestone, progression must use production
paths.

## Timing matrix

Each high-frequency transition runs at least these schedules:

| Schedule | Owner | Watcher | Transport | Purpose |
| --- | ---: | ---: | --- | --- |
| balanced | 1x | 1x | FIFO, immediate | baseline |
| owner-fast | 5x | 1x | owner messages delivered first | catches future-state publication and early terminal races |
| watcher-fast | 1x | 5x | watcher arrival delivered first | catches stale waiters and missing retained state |
| burst-delayed | 5x | 1x | 250-750 ms deterministic bursts | approximates tab throttling/jitter without packet reordering |
| reconnect-boundary | 1x | 1x | channel replaced after commit, before apply | proves retained carrier/journal replay |

Choice-bearing transitions also vary TAKE/LEAVE, first/last option, party-target subpicker,
confirm/cancel/re-enter, and host/guest ownership parity. Speed is a presentation variable and must never
change the committed outcome.

## Scenario inventory

### T1: ordinary battle and reward boundaries (highest frequency)

- Win wave 1, host-owned reward: leave, then both render wave 2.
- Win wave 1, host-owned reward: take a non-party item, then both render wave 2.
- Guest-owned reward on the next parity: leave and take.
- Party-target reward: open party UI, choose first/last legal mon, cancel once, re-enter, commit.
- TM/TM Case/Learner's Shroom: nested move picker, cancel/re-enter, no continuation orphan.
- Ability/greater-ability/randomizer/stormglass subpicker: nested owner choice mirrors and terminates once.
- Reroll once/multiple times, rarity lock, insufficient money, transfer/check-team round-trip.
- Capture victory -> reward -> next encounter; flee -> battle-end tail -> next encounter.
- One player fainted, both alive, one owner has no legal reserve, and both player slots replaced.
- Trainer battle and wild battle variants; single/double/triple arrangement changes.

### T2: milestone boss, biome shop, crossroads, and map

- Wave 10 boss victory -> boss reward tail -> biome shop -> crossroads LEAVE -> choose each available
  destination -> both clients enter the same biome and next encounter.
- The same path with crossroads STAY -> market remains usable -> later leave -> same biome.
- Host owns crossroads/guest watches and guest owns/host watches.
- Buy affordable item, reject unaffordable item, party-target purchase, cancel subpicker, then leave.
- Black market, exotic shop, import bazaar, and ordinary biome market exits.
- One-node map (implicit destination), multi-node map (explicit picker), and no-valid-node recovery.
- Wave 20 and later biome boundaries, repeated biome transitions, and map state restored from co-op save.
- Channel replacement at shop terminal, crossroads commit, and biome carrier receipt.

### T3: Mystery Events that enter battle

- Fight-or-flight and trainer-battle event: option -> battle handoff -> commands -> victory -> embedded
  reward -> post-ME terminal -> ordinary next wave.
- Multi-stage challenge/gauntlet events, including Winstrate and any event that schedules consecutive
  battles.
- Event battle with owner-fast/watcher-fast clients, one faint, forced switch, and reconnect after the
  battle outcome but before the ME terminal.
- Decline/flee alternatives where supported; verify the guest never constructs a phantom ordinary turn.

### T4: Mystery Events that open another UI or mutate progression

- Delve/exploration event: enter each depth, take reward/leave, party-target branch, and terminal.
- Quiz: correct/incorrect answers from both ownership parities.
- Bargain, colosseum, raffle/games, capsule picker, move-learning picker, and event-specific shop.
- Events that grant/remove/transform/swap a Pokemon; full-party release/catch-full subflow.
- Events that change money, held items, balls, map nodes, weather/terrain, ability/form/tera, or unlocks.
- No-reward event and auto-terminal event; repeated different events in one continuous run.
- Every registered Mystery Event is classified into battle, nested-UI, direct-mutation, or simple-terminal;
  each option has at least one scenario and every exit family has timing/fault variants.

### T5: lifecycle and recovery boundaries

- Fresh launch: both player sprites/info bars visible, wave 1 commands accepted.
- Cold resume with the same partner: resume offer -> team confirmation -> exact saved wave/UI.
- Hot rejoin at command, reward, biome shop, crossroads, ME option, ME battle, and nested picker.
- Duplicate retained terminal/carrier, delayed old epoch frame, reconnect generation change, and one dropped
  request/response; adoption remains idempotent.
- Background/throttled client catches up without local derivation; incompatible functional fingerprint
  blocks launch while presentation-only localization drift does not.
- Final boss stage transition and game-over/win end card on both clients.

## Execution and sharding

The transition lane is separate from the existing engine, soak, and browser-transport lanes. It uses five
GitHub-hosted runners so the full gate reaches the commonly available 20 concurrent jobs (the existing
workflow has demonstrated 15 simultaneous jobs). Each runner owns one family T1-T5. Scenario files are
split further only when measured green timings show a runner approaching the four-minute target.

Each scenario should stay short (usually one to three transitions) and reuse one engine boot for a table of
closely related action/timing variants. Expensive asset/module setup is amortized within a runner; scenarios
remain isolated through fresh client contexts and teardown assertions. `fail-fast: false` preserves evidence
from every family. The lane must upload a compact per-scenario timeline plus paired client logs.

The aggregate co-op gate remains deploy-blocking. The transition lane becomes deploy-blocking after its
first five representative journeys are green; expanding the inventory never removes or weakens an existing
assertion. Nightly campaigns remain the start-to-finish assurance layer and consume the same production
transition driver rather than a separate shortcut path.

## Implementation order

1. Add an explicitly scheduled two-client transport so asynchronous continuations are pumped only while
   their owning client context is active. This removes the single-process `globalScene` concurrency excuse.
   **Implemented foundation:** `ScheduledCoopPair` provides FIFO/fault/reconnect scheduling, and `buildDuo`
   now binds each scheduled inbox to its owning `ClientCtx`; every harness drain delivers only while that
   client's scene, runtime, RNG, ghost state, module state, and ME pins are installed. The first T1 journey
   remains the acceptance test before this item is considered complete.
2. Implement T1 battle -> public reward UI -> real next encounter first; it is the live wave-1 regression.
3. Implement T2 boss -> biome shop -> crossroads -> biome carrier.
4. Classify the complete Mystery Event registry and generate T3/T4 scenario tables with explicit options.
5. Add T5 launch/resume/rejoin journeys and browser-backed versions of the highest-risk T1/T2/T3 paths.
6. Route T1-T5 to five independent gate runners, then rebalance from green timing artifacts.
