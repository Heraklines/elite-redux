# Co-op sync-gap + soak-coverage audit - post-c18da4fb7 (full-state replication)

Date: 2026-07-06. Read-only audit extending the prior docs
(`2026-07-05-coop-full-state-phase-0-design.md`, `coop-structural-gaps.md`,
`2026-07-02-coop-situation-matrix.md`) into the world where the host streams
`CoopAuthoritativeBattleStateV1` every turn.

Ground truth of the new payload: capture `captureCoopAuthoritativeBattleState`
(`coop-battle-engine.ts:2065-2103`), streamed on `turnResolution.authoritativeState`
(`turn-end-phase.ts:237-245`) and `battleCheckpoint.authoritativeState`. Guest apply:
`applyAuthoritativeMonData` (`:2137-2212`) + `reconcileAuthoritativeParty`
(`:2226-2273`) + `reconcileAuthoritativeField`, keyed by `Pokemon.id`, tick-gated.
Two systemic upgrades landed alongside: (1) the checksum now carries `saveDataDigest`
(hash of normalized `getSessionSaveData()`, `coop-battle-engine.ts:1863`) making the
module-let/modifier-internal-arg blind-spot class DETECTABLE; (2) the payload directly
carries `erMoneyStreaks`, `biomeOverstayAnchor`, `erRelicBattleState` + full modifier
blobs (held-item internal state incl. charge counters).

Classification: [A] carried by the per-turn payload; [B] dedicated relay; [C] healed
only by checksum-mismatch resync (fragile); [D] not synced.

## Deliverable 1 - sync-gap inventory

### Battle state: CLOSED ([A] across the board)

Every per-mon field verified as captured + applied (`applyAuthoritativeMonData` cites):
fusion state (:2170-2177), gender/nature/luck/friendship (:2151-2154), IVs (:2165),
pauseEvolutions (:2159), nickname (:2142), tera (:2162-2164), ability-capsule
abilityIndex (:2144), black-shiny 5th slot + shiny-lab FX via customPokemonData
(:2178-2179), moveset + PP ppUsed/ppUp (:2128-2134, closes the known PP desync BY
CONSTRUCTION), status/summonData (stages, tags-with-data, transform, encore/disable,
move queue)/battleData (:2167-2181), boss segments (:2190-2191 + seat), hp/stats/
level/exp/coopOwner. Item charge counters (Ward Stone, Power Herb, Stormglass
chosenWeather) ride the full ModifierData blobs -> closes coop-structural-gaps Part 1
#4/#5/#6. VERIFY (follow-up): the modifier heal must reconcile instance-keyed (set
stackCount), never clear-and-re-add (re-fires onAdd/lapse).

Arena/run meta: weather/terrain/tags, money/score/pokeballs, streaks/overstay/relic,
biomeId/seed/waveSeed all [A].

### Remaining gaps (the actual list)

1. **erMapState (map/node/fragment/crossroads reveal)** - [C]/[D]. Detected by
   saveDataDigest but NOT carried by the payload and NOT in the resync heal
   (`healErModuleLetSubstrates` restores only streaks/overstay/relic, :3145-3158).
   Latent (host-authoritative), but a divergence would loop-detect with no heal path.
2. **Biome travel / crossroads / map-node PICK ownership** - [D] UNVERIFIED.
   `UiMode.ER_MAP_PICKER` is classed `local-only + REVIEW` (`coop-ui-registry.ts:180-183`);
   situation-matrix row 5 says "host decides - VERIFY live intent". If it opens
   unmirrored on both clients, the two clients can travel to different biomes.
   -> tracked #841.
3. **Game-over/run-over teardown** - [D]. `game-over-phase.ts` broadcasts gameOver but
   does not clearCoopRuntime; clearCoopRuntime does not reset the ME pins
   (coop-structural-gaps Part 2(b), P1 fix #1 still open). A mid-ME game-over leaks
   stale pins into the next run. -> tracked #842.
4. **Save/resume MID-interaction** - [C]/[D]. ME pins are module state absent from
   SessionSaveData; `restoreInteractionCounter` still production-dead
   (`coop-session-controller.ts:481`). Bounded (saves at wave start).
5. **Ghost-pool submission at run end** - [C]/[D]. Fetch is host-broadcast +
   role-gated; SUBMISSION is per-engine - confirm only one client publishes or the
   pool double-counts. -> tracked #841 (verify batch).
6. **Per-account by design (do NOT re-branch):** eggs/egg-pulls (verify the
   "eggs are deterministic" claim under two-client RNG), vouchers (repeat-win voucher
   phase deliberately fenced, `coop-trainer-victory.ts:58-84`), achievements
   (deliberately not in dexSync), run stats/history (cosmetic divergence).
7. **Pacing/counter class** - [B]-but-unbounded-delta: the payload makes the guest
   correct once caught up; it does nothing about progress delta. The reciprocal
   barriers (#839) + party-item counter (#837) are the live killers - in flight.

Interaction outcomes (reward/shop/ME/bargain/learn-move/CHECK ops/give-to-partner/
DexNav) are all [B] via the seq registry bands - correct, but pacing-exposed.
Catches/candies/shiny looks ride the dexSync merge-union [B].

## Deliverable 2 - soak coverage gaps

The completeness backstop (`coop-soak-coverage.ts`) derives EXPECTED surfaces from the
registries and partitions GUARANTEED / PROBABILISTIC / KNOWN_UNDRIVABLE; unclassified
auto-reds; full enforcement >= 60 waves. The gaps below are the DECLARED undrivable
set - honest, but cold.

**Never driven:** player faints/wipes (PROBABILISTIC only - god party rarely faints;
revival fully undrivable), mega/tera events (god mons spawn into mega), give-to-partner,
CHECK-team ops, TM case/Learner's Shroom/level-up learns (declined), ability
capsule/randomizer, fusion (not even a tracked situation - invisible to the backstop),
DexNav/catch/BALL (headless move.select bypasses), egg hatch, biome market buys +
biome boundary, ALL MEs incl. quiz/colosseum/bargain (mysteryEncounterChance 0 - the
single biggest gap), save/resume, hot rejoin, asymmetric host-half-exhausted
continuation (#848 terminal only classified), wave-140+ final-boss strand.

**Top-10 priority (live-likelihood x severity), each with recipe:**
1. Mid-run ME continuation driver (turn MEs on; port buildDuoForMe's pump inline).
2. Level-party faint/wipe/revive profile (#832) - promotes 8 PROBABILISTIC surfaces
   to GUARANTEED; the faint channel is where #845-#848 were found.
3. Asymmetric continuation (#828) - after hostHalfExhausted, keep driving the guest solo.
4. Biome market buy + biome-boundary pick (also verifies gap #2 above).
5. Catch flow (doThrowPokeball -> dexSync -> both accounts credited).
6. Learn-move accept-with-forget (stop declining).
7. Mega/tera in-battle events (stone-carrier mon, not pre-formed).
8. Save/resume round-trip mid-run (serialize at wave N, re-boot guest, assert parity).
9. Ability capsule/randomizer picker drive.
10. Give-to-partner + CHECK ops mid-shop.

**Structural warning (apply-under-live-phase):** the guest apply swaps
summonData/moveset/stats in place and reconcileAuthoritativeParty can destroy() extras
mid-stream. Any phase holding a stale mon ref (SwitchSummonPhase, revival, pivot
switches, ME battle-handoff) is a null-deref candidate - exactly the shape of the
2026-07-06 CI soak failure (seed 20260706, #840). The faint/switch surfaces being only
PROBABILISTIC means the soak can miss the very phase that crashed. This is the
strongest argument for priorities #2 and #3.

## Action state (as of this commit)

- #839 pacing barriers + #837 counter: agent in flight.
- #840 SwitchSummonPhase null crash: agent in flight (deterministic seed).
- #832 level-party soak profile: dispatching next (audit priority #2, guards the
  apply-under-live-phase class).
- #841 verify batch (map-pick ownership, ghost double-submission, egg determinism,
  modifier-heal reconcile mode): tracked.
- #842 game-over teardown + ME-pin reset: tracked.
- ME continuation driver (audit priority #1): queue after the fix agents land.
