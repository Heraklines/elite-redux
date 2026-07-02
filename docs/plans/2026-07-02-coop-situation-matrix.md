# Co-op Situation Matrix - every gameplay situation, its sync coverage, and how it is tested

Maintainer directive (2026-07-02): "brainstorm all situations that could happen during coop
gameplay and ways to cover it and test it". This is the LIVING CHECKLIST for the co-op sweep
(#792): every row is a situation two real players can produce; STATUS is the honest current
state; TEST names the proof (or the proof that must be written). Update rows as work lands.

Legend - STATUS: DONE (probe/test-verified) | LIVE-OK (shipped, live-confirmed, no dedicated
probe yet) | PARTIAL (works with a known edge) | OPEN (not covered) | N/A (excluded by design).
TEST: file names are under test/tests/elite-redux/coop/ unless noted.

## 1. Battle flow

| Situation | Status | Coverage / Test |
|---|---|---|
| Normal turn: both pick moves, host resolves, guest replays live | DONE | coop-duo-engine, coop-duo-multiwave, live pump (#782) |
| Guest picks a switch (voluntary) | DONE | #695 guest mirrors own switch; duo drives |
| HOST-owned mon faints, host picks replacement | DONE | vanilla SwitchPhase + checkpoint |
| GUEST-owned mon faints, guest picks own replacement | DONE | coop-duo-faint-switch (#786); OOB checkpoint wins the pump race (#788) |
| Replacement seats correctly (sprite + HP bar) | DONE | #791 canonical seating; live-confirmed |
| Guest has NO legal replacement (last mon down) | DONE | instant no-pick sentinel (#18:30 fix); host auto-pick / lone survivor |
| Partner mon REVIVED mid-combat (Revival Blessing) | PARTIAL | code-audited: refill via SwitchSummonPhase + checkpoint; no-bench state never latched. OPEN: duo probe; owner should pick the revive target for their own cast (#794 note) |
| Partner mons restored at wave heal / biome rest | LIVE-OK | wave-start summons by ownership; needs one live confirm |
| Double KO same turn (both player mons) | OPEN | probe: EARTHQUAKE double ally-kill, both pickers, both summons |
| Enemy trainer mid-battle switch | DONE | #790 field reconcile + stale-turn guard; live log verified heal |
| Both sides wipe (game over) | LIVE-OK | #309/#344 lost-run rails; needs a duo probe for the coop game-over tail |
| Catch attempt (ball throw) | DONE | #689 both-account credit + anim sync |
| Flee attempt | LIVE-OK | command relay carries run; no probe |
| Mega evolve / tera mid-battle | PARTIAL | host resolves; guest renders via checkpoint form fields. OPEN: probe asserting guest form/type convergence |
| Charge moves / semi-invulnerable (Fly/Dig) across turns | LIVE-OK | turn resolution replays; no dedicated probe |
| Weather/terrain/hazards set + expire | DONE | reconcileArenaTags + checkpoint weather/terrain; duo asserts checksum |
| PP desync (guest never decrements) | PARTIAL | KNOWN: checksum-forced resync each move turn heals it; fix path = [moveId, ppUsed] in checkpoint (harness doc) |
| Disconnect mid-battle + rejoin | PARTIAL | #652 lifecycle grace; OPEN: duo probe simulating transport death + resume |
| Checksum mismatch -> auto-resync heals | DONE | organic in every duo run; #718 spares live waits (market variant probe parked) |

## 2. Alternating interactions (shops, pickers)

| Situation | Status | Coverage / Test |
|---|---|---|
| Reward shop: owner picks/skips/leaves, watcher mirrors | DONE | coop-duo-multiwave + #682 streamed options |
| Rotation flips owner every interaction | DONE | #789-class: ALL commit paths advance both sides; multiwave counter lockstep |
| Lockstep gate: finisher waits on screen | DONE | #788 v2 ENABLED; 4 proof files green with gate on |
| Party-target reward (Rare Candy etc.) | DONE | coop-duo-reward-items (#719) |
| Ability Capsule (both tiers) on ANY mon | DONE | coop-duo-exploration PROBE #789 (unlock + counter both engines) |
| TM / TM Case / Learner's Shroom / Remember | DONE | commit advance + multiwave TM-case lockstep gate |
| Reroll | LIVE-OK | relayed + money tag (#698); OPEN: dedicated probe |
| Transfer / lock / check-team ops mid-shop | LIVE-OK | COOP_ACT_* relays; OPEN: probe |
| Biome market every 10 waves | DONE | #673 ENABLED; PROBE #673 (stock stream + verbatim buys + money + counters) |
| ME shops (Exotic Trader / Black Market) | PARTIAL | inherit market alternation; OPEN: probe vs the ME owner override |
| Giratina's Bargain (Abyss x0) | OPEN | #795: routed to market for now; design written |
| Item registry round-trip (all items, relics) | DONE | registry-sweep probe: 169 ids clean, 17 generators healthy |
| Resync fires during a LIVE shop wait | PARTIAL | #718 orphan-selector spares it; probe parked (cross-ctx fix needed) |
| Both clients disagree who owns (parity drift) | DONE | from-pinned advances + owner resolved from pinned counter |

## 3. Mystery encounters

| Situation | Status | Coverage / Test |
|---|---|---|
| Host-owned non-battle ME | DONE | coop-duo-mystery (3 paths across 2 engines) |
| Guest-owned non-battle ME | DONE | coop-duo-mystery (relayed pick index) |
| Battle-spawning ME (handoff, no meResync) | DONE | coop-duo-mystery (#693 softlock class) |
| ME with a party sub-pick (Reactor, Sinking Mire...) | PARTIAL | owner-alternated; OPEN: per-archetype probe for sub-pick relays |
| ME granting a MON (Picnic join, Emissary keep, Frozen catch) | OPEN | #794: audit both-account credit per grant site |
| ME granting a RELIC | LIVE-OK | rides reward relay + registry (sweep-proven ids) |
| Full choice-forwarding (guest never runs encounter engine) | OPEN | #693 epic - the deeper rework |

## 4. Acquisition + accounts (both players share)

| Situation | Status | Coverage / Test |
|---|---|---|
| Wild catch -> dex + starter unlock BOTH accounts | DONE | #689; OPEN: re-verify under authoritative-only via probe (#794) |
| Dex Nav grants | OPEN | #794 |
| Shiny-palette / effect availability unlocks on catch/appear | OPEN | #794 (needs unlock-event relay - guest is a renderer) |
| Shiny Lab looks synced both directions | DONE | #785 v3 own-mon stamp; lock-in diagnostics |
| Egg vouchers / achievements from shared play | PARTIAL | trackers fire on the computing engine only; fold into #794 relay |
| Give mon to partner (ownership transfer) | DONE | #649 |

## 5. Run structure

| Situation | Status | Coverage / Test |
|---|---|---|
| Launch: rosters, seed pin, snapshot boot | DONE | coop-duo-launch-sync (zero-resync wave start) |
| Wave advance (incl. single-turn win) | DONE | #704 finalize regression + #790 wave-scoped stale guard |
| Trainer / ghost waves (host party adopt) | DONE | #681; ghost sync duo test |
| Biome pick / crossroads / map travel | OPEN | probe: owner-alternated? currently host decides - VERIFY live intent |
| x0 rest heal + market | DONE | market probe; heal rides checkpoint/benchParty |
| Eggs hatching between waves | OPEN | per-account (own eggs) - verify no shared-state bleed |
| Save/resume (both required) | PARTIAL | #639/#652; OPEN: duo probe save -> resume -> convergence |
| 3-6 player (N-way) | OPEN | trio convergence proven (#777); interactions assume 2 - N-way alternation = ownerOf(counter, playerCount) ready, screens not |

## 6. Adversarial / stress (break-it-by-any-means backlog)

| Situation | Status | Coverage / Test |
|---|---|---|
| Transport drop / reorder / delay | OPEN | harness Layer A fault injection (designed, not built) |
| Duplicate phases racing resyncs | DONE | #790 guard + regression test |
| Non-converging heal loops | DONE (bounded) | #793 reclassified; watch for repeated identical heal WARNs in live logs |
| Both clients act simultaneously on the same seq | PARTIAL | from-pinned idempotence; OPEN: dedicated interleave probe |
| OOM / runaway allocation in guest phases | DONE (harness) | haltQueueAfterCurrent + stubBattleInfo re-stub |
| 20-min waits as freeze masks | PARTIAL | all waits injectable + sentinel fixes; audit remaining COOP_*_WAIT_MS sites for missing fast-fail sentinels |

## How to add coverage (the recipe)

1. Pick an OPEN/PARTIAL row. 2. Write a probe in coop-duo-exploration.test.ts (buildDuo,
withClient, haltQueueAfterCurrent for manual phase drives, stub setMode/setModeWithoutClear/
setOverlayMode as needed, always inside try/finally). 3. Classify failures: harness gap ->
extend test/tools/coop-duo-harness.ts; sync bug -> fix production + keep the probe as the
regression. 4. Full coop dir run before shipping (isolate:false citizenship). 5. Update this
matrix row.
