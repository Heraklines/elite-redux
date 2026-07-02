# Co-op (#633) desync audit + redesign

Date: 2026-06-25. Source: 4 parallel Opus-4.8 audits (determinism, relay completeness,
enemy/AI determinism, architecture critique), cross-validated. This is the reference for
the co-op desync work; see also `2026-06-24-coop-host-authoritative-streaming-design.md`
(the LIVE-D design this concludes was the right target but never wired).

## TL;DR

What ships is **dual-engine lockstep** (both clients re-run the whole battle, only inputs
cross the wire) with a thin **numeric checkpoint** patched on top. The real
host-authoritative event stream that was designed (LIVE-D `emitTurn`/`awaitTurn`/
`turnResolution` + `CoopBattleEvent`) is **dead code - zero callers**. Every desync is the
same root: *a value lockstep assumed both engines would compute identically, that they
didn't.* That class is unbounded in a stochastic, per-account-stateful fork. The structural
answer is to **finish the host-authoritative stream** so the guest computes nothing; the
tactical answer is ~6 high-frequency offenders fixable now.

## Verified facts

- The wired per-turn checkpoint (`captureCoopCheckpoint` -> `readMonView`,
  `coop-battle-engine.ts:41-54`) carries **only** hp / status / 7 stat-stages / fainted
  (+ weather/terrain). It does **NOT** populate `abilityId` or `formIndex`. (A second,
  unused serializer `coop-battle-checkpoint.ts` can, but it is not the live path.)
  => **ability and form divergence is fully unmasked** - the checkpoint cannot repair
  innate-driven damage drift, evolution/form mismatches, or ability changes.
- Enemy verbatim-adopt is gated **WILD-only** (`encounter-phase.ts:211-213`); trainer
  parties are regenerated per client.
- The reward pool is rolled per-client and only the chosen index is relayed
  (`coop-interaction-relay.ts:11-15` assumes identical pools).

## Desync map (merged, prioritized)

| # | Desync | Where | Why it diverges | Sev |
|---|---|---|---|---|
| 1 | Trainer battles (live wave-4 bug) | `encounter-phase.ts:211-213` adopt gate WILD-only | Guest regenerates its own trainer party (unseeded gender/double `battle.ts:623/642`; #419 BST swap on un-aligned RNG); `applyCoopEnemies` bails on species mismatch | CRIT |
| 2 | Reward pool roll | `select-modifier-phase.ts:149-155`; `coop-interaction-relay.ts:11-15` | Each client rolls own pool from own party; luck changes the *number* of seeded upgrade draws (`modifier-type.ts:3286/3319`) -> shifts the whole shared RNG stream after the first shop | CRIT |
| 3 | Per-account innate/passive gating on merged mons | `pokemon.ts:2943` reads local `starterData.passiveAttr` | Same merged mon's active innates gated by each player's own candy unlocks; checkpoint omits ability (verified) | HIGH (most frequent) |
| 4 | Enemy AI picks different moves | `pokemon.ts:8176` scores vs live opposing field | Reads per-client field state; different scores -> different move + different seeded draw count -> RNG-cursor desync for the rest of the turn | HIGH |
| 5 | Terastallize not relayed | `Command.TERA`, `coop-transport.ts:44-57`, `command-phase.ts:544` | Wire has no tera field; broadcast hardcodes `Command.FIGHT` | HIGH |
| 6 | Level-up move-learn not relayed | `LearnMoveBatchPhase` (zero coop), `level-up-phase.ts:87` | Normal level-ups bypass the per-move relay; each picks which move to overwrite | HIGH |
| 7 | Evolution cancel + branched choice not relayed | `evolution-phase.ts:362`, `:98-129` | Divergent species on a shared mon; form unmasked by checkpoint | HIGH |
| 8 | Giratina Bargain unrelayed | `the-bargain-phase.ts`, `victory-phase.ts:152` | Runs outside any ME phase; both mutate shared party independently | HIGH |
| 9 | ER quiz answers unrelayed | `ErQuizPhase` missing from `coopMeInteractivePhase()` `ui.ts:333` | Each answers independently -> different rewards | HIGH (1-line) |
| 10 | Game-over "retry?" | `game-over-phase.ts:92-133` | No coop guard -> independent reset/reload -> hang (only if `enableRetries` on) | CRIT-if-on |
| 11 | ER bleed/frost/fear tags not in checkpoint | `coop-battle-checkpoint.ts:53-73` no tag field | BattlerTags, not StatusEffect; cannot be repaired once anything desyncs | MED |
| 12 | Give-to-partner ownership flip | `coop-party-ops.ts:42-50` | `coopOwner` flipped locally; verify it is broadcast | MED |
| 13 | Daily-run seed from local date | `title-phase.ts:459` | Two timezones -> different seed -> desync from wave 1 | MED |
| 14 | Baton Pass option dropped in switch relay | `switch-phase.ts:106-108` | Watcher applies plain switch, never BATON_PASS | MED |
| 15 | Fusion-form dex-gating; friendship/shiny-rate read local modifier counts | `pokemon-forms.ts:117`; `pokemon.ts:7440/3951` | Per-account state feeds form changes, Return/Frustration, shiny/HA | MED |

## Track 1 - fix-now (days; biggest live-impact / effort)

1. **Adopt host enemy party for TRAINER + ghost waves** (broaden the wild-only gate;
   guest reconstructs via `buildCoopEnemy`, skips its own gen + BST swap). Kills #1.
2. **Host-stream the rolled reward option list** (ids/tiers/upgrade count); watcher renders
   instead of re-rolling. Kills #2's catastrophic RNG-stream poisoning.
3. **Owner-snapshot per-account combat state** (per-slot `passiveAttr`, canonical luck)
   onto each merged mon. Kills #3.
4. **Relay the small unrelayed choices** (#5 tera field, #9 quiz allowlist 1-liner,
   #6 level-up move-learn, #7 evolution, #8 bargain skip/relay, #10 game-over guard,
   #11 tags, #12 verify, #14 baton) + seed `battle.ts:623/642` + `pokemon-utils.ts:22`
   + shared daily date (#13).

## Track 2 - redesign (makes desync impossible by construction)

1. **Per-turn state checksum + auto-resync FIRST** (~half day): hash the authoritative
   state each turn, verify on the guest, pull a full `stateSync` blob + adopt on mismatch.
   Turns silent desync into detected + self-healed; gives a headless test that fails the
   moment any field is unsynced. Do before everything else - makes the rest verifiable.
2. **Collapse the guest to a pure renderer** (~3-5 d): wire the dead `emitTurn`/`awaitTurn`;
   guest sends input, renders the host's resolved turn, computes nothing. Retires #1-4, #11
   and the RNG-cursor tail at once; mostly finishing code that already exists.
3. **Host-authoritative interactions/ME** (~1-2 d): owner sends the choice, host resolves
   against the host pool, streams the result. Deletes the "identical pool" assumption.
4. **Delete the lockstep band-aids** + add a **headless 2-client checksum harness** as the
   permanent regression gate (host+guest over LoopbackTransport, assert the checksum every
   turn, assert the guest's combat paths are not entered).

## Recommendation

Do Track-1 #1-3 + the Track-2 checksum first (the 80/20 on live desyncs + makes the rest
detectable), then schedule the guest-renderer collapse as the real fix.
