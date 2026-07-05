# Co-op refactor - resume point + turn-pacing barrier class

Date: 2026-07-05 (evening). Author handoff for the NEXT session (maintainer is out of
credits tonight; resume here tomorrow).

This is the "where we are + what's next" doc. Read it first, then
`2026-07-05-coop-full-state-phase-0-design.md` (the state-replication design) for detail.

---

## 1. Where we are (shipped tonight)

Full-state turn replication **Phase 1 + guest-apply** is SHIPPED to staging as commit
`c18da4fb7` on `feat/elite-redux-port`.

- Host streams `CoopAuthoritativeBattleStateV1` each turn: both parties as
  `PokemonData[]` in authoritative order (per-mon live state rides
  `PokemonData.summonData`), plus a **seating-only** `field[]` (which `Pokemon.id` sits
  in which battle slot/side + boss index), arena, money, pokeballs, modifiers.
- Guest applies by **`Pokemon.id`**, mutating the matching live object in place
  (preserves the Phaser sprite), reloading the sprite only when `getBattleSpriteKey`
  changes (the resummon-gate).
- **Additive**: the old numeric checkpoint / `fullField` / checksum / `stateSync`-resync
  paths are still active as the safety net. They are deleted only in a LATE phase.
- Verified: full coop suite 94 files / 667 pass, tsc zero-new, biome clean; soak 25/25
  waves with `resyncHeals=0`.

This closes (or should close) the **battle-state** desync class: party-order
transposition (#836), EXP-a-level-behind, enemy held-item drift. The maintainer is
testing it live.

---

## 2. NEW finding (PRIORITY for next session): turn-pacing / advancement-barrier class

The maintainer identified a **distinct** bug class that the state-replication refactor
does NOT fix. State replication makes the guest's state *correct once it catches up*;
it does NOT stop one player from racing arbitrarily far ahead of the other into a
position the two can't reconcile. The co-op advancement barriers are **asymmetric** -
one direction is guarded, the reciprocal direction is not.

### 2a. The reward-shop asymmetry (the clearest statement of the class)

- **Guard that EXISTS and works:** when it is NOT your turn to pick (the OTHER player
  owns the reward-shop pick), you are correctly BLOCKED from advancing to the shop
  until the owner gets there.
- **Guard that is MISSING (the bug):** when it IS your turn to pick (you own the shop
  pick), you can advance **arbitrarily forward** - finish the current fight, walk into
  the NEXT fight - while the partner is still loading / finishing animations for the
  PREVIOUS fight. That progress delta is too large.
- **What SHOULD happen:** the shop owner may advance all the way TO the shop, but
  **before committing the pick they must WAIT until the partner has also reached the
  shop.** i.e. the pick is a sync barrier for BOTH players, not just the watcher.

Maintainer's own words: "if it's not your turn you are stopped from continuing to get
to the shop until the other player gets there... but the opposite is not the case
where it's your turn - you can advance arbitrarily forward even though what should
happen is you get all the way to the shop but before you pick you need to wait for the
other player to get to the shop." Both guards are individually fine; the problem is
only ONE of them exists. Add the reciprocal one.

### 2b. The faint-replacement lock (same class, battle side)

- When your mon faints and you are choosing a replacement, if the partner does not
  advance fast enough - or the partner has ALREADY started making a move - the system
  **locks the other player from advancing**. It does not sync; you stay locked.
- Root of the class: one player is allowed to reach the next move-choice while the
  other is still resolving the previous turn / summoning a replacement.
- **What SHOULD happen (the missing barrier):** you must NOT be able to pick your NEXT
  move until the other player has (a) finished their turn, (b) got their replacement
  mon OUT on the field, and (c) is also on the move-choosing (command) screen. The
  next command is a sync barrier: proceed only when BOTH players are at the same
  command point with their mons materialized.

### 2c. Unifying diagnosis

Co-op needs **reciprocal barriers at sync points**. Today the barriers are
one-directional (a slower watcher waits for the owner), but the FASTER player -
including the interaction OWNER - can run ahead arbitrarily. The fix is to add the
missing reciprocal barrier: before a **state-advancing COMMIT** (a reward-shop pick,
issuing the next battle command), the leading player must wait until the other player
has reached the SAME sync point (both at the shop; both on the command screen with
mons on the field). Neither player may cross a barrier until both have arrived.

This is adjacent to, but separate from, the interaction-counter bug (#837) and the
state-replication refactor. #837 is about a party-item apply advancing the counter
asymmetrically; this is about PROGRESS/pacing being allowed to diverge too far. Both
are "the delta between the two clients is allowed to grow unbounded" symptoms.

### 2d. Where to look (next session, before coding)

- Reward-shop owner/watcher gating: `select-modifier-phase.ts` co-op hooks
  (`coopAdoptOwnerRewardOptions`, the owner advance / `advanceCoopInteractionForContinuation`
  in `coop-runtime.ts`), and the interaction alternation counter (owner=even/guest=odd).
  Find where the WATCHER is blocked-until-owner-arrives and add the mirror: OWNER
  blocked-until-watcher-arrives before the pick commits.
- Faint / next-command barrier: `command-phase.ts` co-op path, `switch-phase.ts`,
  `coop-guest-faint-switch-phase.ts`, and the replay park/unpark
  (`coop-replay-turn-phase.ts`). The barrier is: do not present the next `CommandPhase`
  UI until a "both-ready-at-command" signal from the partner.
- Design the barrier as an explicit **rendezvous / two-sided ready handshake** at each
  sync point (both send "I reached point P", neither proceeds past P until both are
  seen), rather than one-sided waits. Keep it separate from the interaction counter.
- STANDING RULE still applies: reproduce in the two-engine duo harness first
  (`test/tools/coop-duo-harness.ts`) - drive one client ahead of the other (finish a
  fight on the owner while the watcher is still animating) and assert the leader
  BLOCKS at the barrier until the follower arrives. Fault-injection (delay one side)
  is the right tool.

Maintainer is sending LOGS for these situations - pull them via the dev-logs branch
next session (see CLAUDE.md "Reading REMOTE tester logs"): the two newest co-op commits
(host + guest, back-to-back) on `heraklines/dev-logs`.

---

## 3. State-replication refactor - remaining phases (from the Phase 0 design)

- **Phase 2 (finish):** prove host==guest parity across the full duo matrix (faints,
  switches, EXP, party-target items, enemy item consumption) with ZERO forced resyncs.
- **Phase 3:** full render differ - registry-derived (cheap refresh unconditionally on
  any per-mon change; expensive re-summon gated on the derived `getBattleSpriteKey`
  inputs, so a missed field degrades to a harmless refresh, never a stale visual). No
  P2/P3 flicker may reach staging.
- **Phase 4:** DELETE the reactive machinery (`expResolved` + `applyCoopExpDeltas`,
  `benchParty` heal, `adoptCoopHostPlayerPartyOrder`, exp-skip-on-species-mismatch,
  the party-order-transposition patches) - only AFTER Phase 5.
- **Phase 5:** flip the checksum to a LOUD non-healing assertion + `stateSync` to
  rare-fault-only. Gate the Phase-4 deletion on proven zero-resync **including the
  known PP desync** (verify the full-state payload closes PP by construction).
- **Blocked out of this project:** the party-item interaction-counter deletion depends
  on a single interaction-terminal protocol (see #837 + section 2). This refactor
  closes the BATTLE-state class; the SHOP/interaction + PACING classes are follow-ons.

---

## 4. Other open co-op bugs (tracked)

- **#837** - market party-target item apply advances the shared interaction counter on
  the applier only -> guest N-behind -> next-battle "partner lock" stall. (Same
  delta-too-large family as section 2; the refactor agent's SOAK_WAVES=150 stalled at
  wave 37 in `SelectModifierPhase` = this class, not battle-state.)
- **#828** - soak: drive asymmetric field (one player's half exhausted, partner
  continues).
- **#829** - production relay applies cross-owner switch cursor without owner
  validation (malicious-peer hardening).
- **#832** - level-party soak profile that faints/wipes/revives naturally (the real
  close for the soak faint-coverage hole).

---

## 5. Resume checklist (next session, in order)

1. Confirm Phase 1 (`c18da4fb7`) is healthy on staging + read any new dev-logs the
   maintainer sent (pull the newest 2 co-op captures off `heraklines/dev-logs`).
2. PRIORITY: the turn-pacing barrier class (section 2). Reproduce the leader-races-ahead
   case in the duo harness, then add the reciprocal barrier at the shop-pick and
   next-command sync points. This is likely the highest-impact remaining fix for live
   play.
3. Continue the state-replication phases 2-5 (section 3) as capacity allows.
4. Keep #837 (interaction counter) in the same design pass as section 2 - they are the
   same "unbounded client delta" problem and may share a rendezvous mechanism.
