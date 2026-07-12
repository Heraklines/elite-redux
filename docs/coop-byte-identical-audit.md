# Co-op byte-identical audit (task #819)

Static code trace of every deliberate degrade/fallback decision in the co-op
netcode, plus a per-encounter matrix of every interactive mystery-encounter (ME)
surface. Read-only audit; no src was changed producing it.

Requirement being audited against (maintainer's standing rule):

- In co-op, both screens must be byte-identical in all situations.
- The encounter OWNER controls; the watcher only mirrors.
- Silent divergence is never acceptable.
- Anti-hang backstops are acceptable ONLY if LOUD (a visible on-screen notice,
  not just a console log).

Method: grep + read across `src/data/elite-redux/coop/`, `src/phases/`,
`src/ui/`, and `src/data/mystery-encounters/`. Every claim below cites the file
and line it was read from. Where a path could not be fully resolved statically it
is marked UNKNOWN with what blocks verification.

Scope of the ME registry: `initMysteryEncounters()` in
`src/data/mystery-encounters/mystery-encounters.ts` currently registers **91**
encounters into `allMysteryEncounters`. In addition `ER_THE_BARGAIN` exists as a
type (`src/enums/mystery-encounter-type.ts:231`) and is reachable ONLY through the
Mystery Gauntlet (`src/data/elite-redux/er-mystery-gauntlet.ts:65`), not the biome
pools, so the reachable interactive-encounter total is **92**. This count increased
when the previously orphaned `ER_LOST_WANDERER` definition was registered and added
to the Plains pool. `FIELD_TRIP` and
`AN_OFFER_YOU_CANT_REFUSE` are registered but biome-disabled
(`mystery-encounters.ts:204,212`); they remain gauntlet-forceable. The Mystery
Gauntlet can force ANY registered entry, so all 92 are in scope. The structural
`coop-me-registry-completeness.test.ts` gate now derives this count from the enum and
registry, preventing a future definition from being silently omitted again.

---

## Part 1 - Degrade / fallback sweep

For each: trigger (happy-path vs only-after-timeout/disconnect), what each player
SEES, silent-divergence / wrong-player risk, and a verdict.

Verdict key: FIX = violates intent on the happy path; KEEP+LOUD = legitimate
disaster backstop but currently has NO on-screen notice and must gain one;
KEEP = invisible-by-nature (a retry / an identical-on-both no-op).

| # | Finding | File:line | Trigger | What each player SEES | Divergence / wrong-player | Verdict |
|---|---------|-----------|---------|-----------------------|---------------------------|---------|
| 1 | Old bespoke ME "safe-degrade" (discard guest pick + force-leave) is GONE, replaced | `coop-me-pin-state.ts:56-70`; `mystery-encounter-phases.ts:404-432` | (was) guest-owned bespoke-sub-UI ME | n/a (removed) | Removed; see #2 for its replacement's residue | KEEP (removal is correct) |
| 2 | Bespoke sub-UI host-drives on a guest-owned ME (#823 stopgap) | `mystery-encounter-phases.ts:418-424`; `coop-me-pin-state.ts:60-70` | guest-owned `CLOWNING_AROUND` (only remaining non-quiz bespoke) | Host sees the yes/no prompt and answers it; guest sees a message box | WRONG-PLAYER: the HOST answers a prompt the GUEST owns | FIX (P1). Being addressed by the yes/no mirroring in parallel |
| 3 | ME reward-owner override forces host=owner for the embedded shop | `mystery-encounter-phases.ts:929-948` | happy path, every co-op ME with a reward shop | guest runs a watcher shop mirroring the host's streamed items | none by itself (host streams exact items) | KEEP. Noted: being fixed in parallel |
| 4 | Watcher reward reconstruct fallback -> own roll | `coop-reward-options.ts:82-107`; consumed at `biome-shop-phase.ts:263-265` and `coop-interaction-relay.ts:361-407` | reconstruct failure (unknown modifier id / factory null / generator null) OR stock-stream timeout | watcher shop shows a DIFFERENT item pool; only a `coopWarn` in the console | SILENT divergence of the shared shop pool | KEEP+LOUD (add an on-screen notice; happy-path reconstruct succeeds) |
| 5 | Guest self-generates its own enemy party on adopt timeout | `coop-battle-stream.ts:534-541,566-570` (`awaitEnemyParty`), `:706-716,742-746` (`awaitMeBattleEnemyParty`), `coop-runtime.ts:1262-1274`; `coop-enemy-builder.ts:46-58` (no speciesId -> guest rolls own) | only-after-timeout / malformed host blob | guest fields DIFFERENT wild/boss mons; only a `coopWarn` | SILENT divergence of the whole enemy field | KEEP+LOUD (disconnect backstop; needs on-screen notice) |
| 6 | AI command fallback for the partner slot | `coop-battle-sync.ts:53-56,168-178` (timeout->null->AI), `:305-312` (DECLINE->AI); `command-phase.ts:287-329`; `coop-partner-ai.ts:196-219` (relayed move not in local moveset -> AI) | partner command timeout / decline / move-not-found | partner's mon visibly performs a DIFFERENT move than the human picked; console log only | SILENT divergence of a turn's action (the file itself calls this "the single biggest live desync source", `coop-battle-sync.ts:53`) | KEEP+LOUD (bounded by the 20-min ceiling; needs on-screen notice) |
| 7 | Defensive-leave paths (watcher leaves / host safe-leaves) | `coop-interaction-relay.ts:261-262,329-333` ("watcher leaves"); `coop-interaction.ts:63-64,117`; `coop-replay-me-phase.ts:772-838` (`leaveDefensive`); `mystery-encounter-phases.ts:379-402` (`coopHostAwaitGuestIndex` null/out-of-range -> `leaveEncounterWithoutBattle`) | only-after-timeout (20-min disconnect ceiling) or an out-of-range relayed index | the encounter simply ends for that client; console log only | can strand the OTHER client one interaction-counter apart if only one side leaves | KEEP+LOUD (needs on-screen "partner disconnected" notice) |
| 8 | Checksum-mismatch auto-resync | `coop-battle-engine.ts:1490-1526` (read-failure sentinel -> comparison skipped), `coop-battle-stream.ts:990-1045` (`requestStateSync`), `coop-runtime.ts:415-422,668-678,760-766` | per-turn / per-ME checksum mismatch (a real divergence already happened) | nothing (state is silently snapped to the host's) | the resync HIDES that a divergence occurred; a firing resync is a symptom (see the known PP desync in CLAUDE.md) | KEEP (heal is invisible-by-nature); but frequent firing = an upstream bug to hunt |
| 9 | Boss-bar `suppressResummon` degrade | `coop-battle-engine.ts:1679-1688,1806-1819,2112-2138` | only after a boss divergence fails to heal TWICE on the same dimensions | guest shows a STATIC WRONG boss bar (segment count / hp) instead of a re-summon flicker | SILENT visual divergence of the boss bar | KEEP+LOUD (post-double-failure backstop; needs a notice) |
| 10 | `#821` embedded-ME-reward-shop handoff hook is debug-gated AND in the wrong branch | `coop-interaction-relay.ts:455-460,587-612`; consumer `coop-replay-me-phase.ts:177-197,676-700` | any co-op ME whose OWNER opens an embedded reward shop while the watcher is parked in the ME await | if the hook does not fire: the watcher NEVER opens its shop and strands after the ME | POTENTIAL STRAND: `onRewardOptionsBuffered` is invoked only inside `if (isCoopDebug())` and only on the HAS-waiter branch (`:590-599`), yet the guest has no rewardOptions waiter then, so the message hits the no-waiter buffer branch (`:604-605`) where the hook is never called. `COOP_DEBUG_DEFAULT = true` (`coop-debug.ts:28`) masks it today; the file's own comment says set it false for a prod ship (`coop-debug.ts:12`) | FIX (P0-latent). Blocks full verification: whether any other trigger opens the watcher shop, and whether duo tests run with debug off |
| 11 | Trainer victory-dialogue ALWAYS-SKIP in co-op | `coop-trainer-victory.ts:30-51` | happy path, every co-op trainer victory | both clients skip the victory line identically | none (identical on both; done for lockstep await-count parity) | KEEP (byte-identical) |
| 12 | Host message-recording suppression (#691) | `coop-turn-recorder.ts:42-65,114-127` | happy path | each client shows its OWN localized narration line | not a content divergence (same event, per-client i18n) | KEEP (by design) |

Known suspects the task named, and their CURRENT working-tree state:

- The bespoke safe-degrade: GONE (row 1). It was replaced by host-drives-locally
  for `CLOWNING_AROUND` (row 2) and by full quiz MIRRORING for the 8 quiz MEs
  (`mystery-encounter-phases.ts:426-431`, `coop-replay-me-phase.ts:408-416`).
- The ME reward-owner override: present, being fixed in parallel (row 3).
- The watcher reward reconstruct fallback: present (row 4).
- Guest self-generated enemies on adopt timeout: present (row 5).
- The AI command fallback: present (row 6).
- Defensive-leave paths: present (row 7).
- Checksum-mismatch auto-resync: present (row 8).

---

## Part 2 - Per-encounter matrix (grouped by interactive class)

Interactive-surface classes (from the task): (a) plain option select, (b) quiz
`ErQuizPhase`, (c) spawns a battle, (d) embedded reward shop, (e) party-pick
sub-prompt, (f) secondary-label sub-prompt, (g) yes/no `displayYesNoOptions`,
(h) REPEATED option-select loop, (i) custom UI mode.

### Baseline: what "OK" means (verified against the mirroring code)

The guest never runs the ME engine. `MysteryEncounterPhase.start` diverts the
authoritative guest into `CoopReplayMePhase`
(`mystery-encounter-phases.ts:239-269`). The host is the sole engine and streams:

- (a) the option presentation `mePresent` (tokens / per-option enablement /
  labels) on seq `8_000_000 + counter`, streamed FRESH on every
  `MysteryEncounterPhase.start` (`mystery-encounter-phases.ts:312-351`); the guest
  renders off it (`coop-replay-me-phase.ts:206-264`).
- (e) party-pick and (f) secondary-menu sub-prompts, streamed as a `subPrompt`
  descriptor from `selectPokemonForOption`
  (`encounter-phase-utils.ts:701-772`) and captured locally by the guest
  (`coop-replay-me-phase.ts:465-525`).
- (b) the quiz session as a `subPrompt` of kind `quiz`, both clients run
  `ErQuizPhase` off it, guest owner drives its own answers (#818,
  `coop-replay-me-phase.ts:401-416,714-762`).
- (c) a battle via the `COOP_ME_BATTLE_HANDOFF` sentinel; the spawned battle then
  runs host-authoritatively through the normal battle relay
  (`coop-me-pump.ts:124-152`, `coop-replay-me-phase.ts:582-667`).
- (d) the embedded reward shop; the guest opens its own watcher
  `SelectModifierPhase` (`coop-replay-me-phase.ts:676-700`,
  `select-modifier-phase.ts:355-378`).

So classes (a)(c)(d)(e)(f) and quiz (b) are MIRRORED and the shared screens match
(subject to degrade rows 4-10 above). Any ME built only from those surfaces is OK.

### GROUP OK-STANDARD - classes (a)(c)(d)(e)(f) only (verdict: OK)

The large majority of the 90 registered MEs use only standard option-select,
optional battle (`initBattleWithEnemyConfig`, 49 files), optional reward shop
(`setEncounterRewards`, 57 files), party-pick (`selectPokemonForOption`, 17
files), and secondary menus. All are mirrored. This includes every "custom UI"
name in the task brief that turned out to use STANDARD surfaces (verified: none of
them opens a bespoke `UiMode` in the encounter file; grep for
`setMode(UiMode.` across `src/data/mystery-encounters/encounters/` returns ONLY
`clowning-around`):

- Great Forge (feeding = `selectPokemonForOption`), Fabricator/Smelter, Fortune
  Teller (dialogue + `registerFortuneTellerLookups`, no bespoke UI), Innate
  Shrine, Mountain Sage (moveset = party-pick + secondary), Still Waters,
  Unfinished Business (ghost await = a battle), Scavenger's Pact, High Noon, Fight
  Club, Frozen in Time, Reactor Meltdown, Regional Emissary, Sinking Mire, Bog
  Witch, Cleansing Font (`PartyHealPhase`), Picnic, The Mirage, Hot Spring, Town
  Raffle, Dragon's Hoard, Wishing Crystal, Graves of the Fallen, plus all the
  vanilla PokeRogue MEs not called out below.
- Verdict: OK.

### GROUP QUIZ - class (b), MIRRORED (#818) (verdict: OK)

8 MEs whose option unshifts `ErQuizPhase`
(`grep ErQuizPhase src/.../encounters` -> 8 files):
`ER_TRACKS_IN_THE_SNOW`, `ER_GUESSING_BOOTH`, `ER_SCRAMBLED_POKEDEX`,
`ER_SEALED_DOOR`, `ER_SALVAGE_YARD`, `ER_LAKE_SPIRIT`, `ER_FROZEN_SHAPES`,
`ER_DORMANT_GUARDIAN`.

- Mirrored: the host streams the question set as a `quiz` subPrompt and BOTH
  clients run `ErQuizPhase`, the guest owner self-relaying its answers
  (`coop-replay-me-phase.ts:401-416,714-762`). The host input gate stays UP for
  these so the host cannot hijack the guest's answers
  (`mystery-encounter-phases.ts:426-431`).
- Verdict: OK. (Reward shop that FOLLOWS a quiz, e.g. Dormant Guardian's relic
  screen, is handled by `coop-replay-me-phase.ts:178-196` - subject to row 10.)

### GROUP REPEAT - class (h), REPEATED OPTION-SELECT (verdict: FIX-CLASS-h, P0)

9 MEs that re-fire `MysteryEncounterPhase(optionSelectSettings)` mid-encounter:

- 8 press-your-luck delves (`grep er-press-your-luck` -> 8 files):
  `ER_INTO_THE_CALDERA`, `ER_ABYSSAL_VENT`, `ER_TIDE_POOLS`, `ER_BURIED_CITY`,
  `ER_GLITTERING_VEIN`, `ER_OVERCHARGE_CORE`, `ER_OVERGROWN_TEMPLE`,
  `ER_WOODLAND_FORAGER`. The loop re-prompts via `initSubsequentOptionSelect`
  (`er-press-your-luck.ts:155-161`).
- `SAFARI_ZONE` calls `initSubsequentOptionSelect` directly for its ball-throw
  loop (`safari-zone-encounter.ts`).

`initSubsequentOptionSelect` pushes a NEW `MysteryEncounterPhase(optionSelectSettings)`
(`encounter-phase-utils.ts:1032-1034`). On the host this re-runs
`coopHostStreamPresentation` (a FRESH top-level `mePresent` with NO `subPrompt`)
and `coopHostAwaitGuestIndex` on the SAME `8_000_000+counter` seq
(`mystery-encounter-phases.ts:290-302`).

Failure mode (traced, not guessed): the guest handles exactly ONE top-level
`mePresent`. After the first pick, the guest is in `awaitOutcomeThenTerminal`,
which only re-opens the selector for an outcome carrying a `subPrompt`
(`coop-replay-me-phase.ts:401-427`). A re-fired top-level `mePresent` has NO
`subPrompt`, so it falls to the stray branch (`:445-456`) and resolves toward the
terminal instead of rendering round 2.

- Guest-owned delve: the guest never re-renders the push/bank prompt and never
  relays a round-2 index; the host's `coopHostAwaitGuestIndex` blocks for the full
  20-min ceiling, then safe-leaves. Effective softlock. P0.
- Host-owned delve: the guest's screen freezes on round 1 while the host clicks
  through the delve, and the guest also drops the comprehensive `meResync`
  (`raceDone`), diverging money/HP/rewards until a later checksum heals. P2.
- Verdict: FIX-CLASS-h. `awaitOutcomeThenTerminal` must treat a no-subPrompt
  `mePresent` as a fresh option-select round (re-render + relay the pick).

### GROUP SHOP-BIOME - class (i), bespoke `UiMode.BIOME_SHOP` (verdict: FIX-CLASS-i)

3 MEs that push a `BiomeShopPhase` subclass:
`ER_EXOTIC_TRADER` -> `ExoticShopPhase` (`exotic-trader-encounter.ts:77-80`),
`ER_BLACK_MARKET` -> `BlackMarketShopPhase` (`black-market-encounter.ts:64`),
`ER_IMPORT_BAZAAR` -> `ImportBazaarShopPhase` (`import-bazaar-encounter.ts:61`).
(`ER_IMPORT_BAZAAR` was reworked into Regional Emissary per #526 but is still
registered, `mystery-encounters.ts:420`.)

`BiomeShopPhase` HAS its own co-op owner/watcher path (`biome-shop-phase.ts:82-134,
254-307`), keyed on `coopBiomeShopSeq = 7_000_000+counter` and a stock stream
under reroll namespace `COOP_BIOME_STOCK_REROLL = 777`
(`coop-interaction-relay.ts:46-56`). But two asymmetries break it for the ME case:

1. `doEncounterRewards` (which unshifts `ExoticShopPhase`) is assigned INSIDE the
   host's `withOptionPhase` (`exotic-trader-encounter.ts:77-80`), which the guest
   never runs, so the guest's `MysteryEncounterRewardsPhase` guest branch
   (`mystery-encounter-phases.ts:936`) finds `doEncounterRewards` undefined and
   never queues the watcher `ExoticShopPhase`.
2. The host's `ExoticShopPhase` streams stock on reroll `777`
   (`biome-shop-phase.ts:120-126`), but the generic ME embedded-shop watcher path
   (`coop-replay-me-phase.ts` -> `SelectModifierPhase` -> `startCoopWatch`) awaits
   the ME reward key (reroll = `rerollCount` = 0), so even if the `#821` hook fired
   (row 10) the keys would not match. In addition the host's
   `coopBiomeTerminal` runs `advanceCoopInteractionForContinuation`
   (`biome-shop-phase.ts:234-246`) with no guest counterpart.

- Failure mode: the guest does not mirror the biome-grid shop (misses it or renders
  a divergent pool), and the extra host-only interaction-counter advance risks a
  counter desync. P1/P2.
- Verdict: FIX-CLASS-i. Residual runtime outcome (silent-miss vs strand vs
  counter-desync) needs the two-engine duo harness; the code asymmetry above is
  verified.

### GROUP COLOSSEUM - class (i)+(h), bespoke `UiMode.COLOSSEUM` board (verdict: FIX-CLASS-i, P0/P1)

`COLOSSEUM` (registered, METROPOLIS + DOJO, `mystery-encounters.ts:279,327`).

The gauntlet is a multi-battle continuous encounter. The between-round CONTINUE /
CASH-OUT board is a dedicated `ColosseumChoicePhase` opening
`UiMode.COLOSSEUM` (`colosseum-choice-phase.ts:42-108`), unshifted from the
encounter's `doContinueEncounter` after each won battle
(`colosseum-encounter.ts:258-272`). Rounds 2+ spawn via `startNextColosseumBattle`
(`colosseum-encounter.ts:301-314`).

- `colosseum-encounter.ts` and `colosseum-choice-phase.ts` contain ZERO co-op
  handling (grep for any `coop`/`isCoopAuthoritativeGuest`/`getCoopController`
  marker returns nothing). The board opens on the HOST only; it is never streamed
  or mirrored, and the guest has no phase for it. After round 1 (which handed off
  through the ME-battle path and ended the guest's `CoopReplayMePhase` via
  `finishWithoutLeaving`), the guest has no driver for the board or for rounds 2+.
- Failure mode: the guest cannot see or control the CONTINUE / CASH-OUT choice
  (wrong-player), and the multi-round continuation is not wired for the guest
  (strand). P0/P1.
- Verdict: FIX-CLASS-i. Exact guest post-round-1 behavior needs the duo harness;
  the total absence of co-op handling is verified.

### GROUP YES/NO - class (g), `displayYesNoOptions` (verdict: FIX-CLASS-g, P1)

`CLOWNING_AROUND` is the only ME using `displayYesNoOptions`
(`clowning-around-encounter.ts:441,446,485`; grep across src returns only this
file). It is in `COOP_AUTHORITATIVE_BESPOKE_SUB_ME`
(`encounter-phase-utils.ts:94-104`).

- On a guest-owned `CLOWNING_AROUND`, the host stands its input gate down and
  drives the yes/no locally (`mystery-encounter-phases.ts:418-424`,
  `setCoopMeBespokeHostDrives`), so the HOST answers a prompt the GUEST owns.
  Wrong-player. P1.
- Verdict: FIX-CLASS-g. Being addressed by the yes/no mirroring in parallel.

### GROUP BARGAIN - class (i), gauntlet-only `UiMode.ER_BARGAIN` (verdict: OK, #795)

`ER_THE_BARGAIN` (Giratina) is gauntlet-only (`er-mystery-gauntlet.ts:65`), driven
by `TheBargainPhase` (`the-bargain-phase.ts`), not `MysteryEncounterPhase`.

- Co-op handled (#795): owner/watcher decision at
  `the-bargain-phase.ts:84-101`; the owner drives `ErBargainUiHandler` locally and
  the watcher adopts ONE comprehensive outcome blob on
  `COOP_BARGAIN_SEQ_BASE + counter` (`the-bargain-phase.ts:110-157`). Choice is
  forwarded via the outcome, not per-Sin serialization.
- Verdict: OK for correctness / no strand / no wrong-player. NOTE the watcher does
  NOT see the bargain screen; it shows "Your partner is bargaining with
  Giratina..." (`the-bargain-phase.ts:131`). This is the same owner-controls-
  watcher-waits pattern as the biome market (`biome-shop-phase.ts:260`). It is a
  LOUD (explained) but NOT byte-identical presentation. See P3 below.

### GROUP VERIFY - richer vanilla interactions not fully traced (verdict: UNKNOWN)

- `THE_WINSTRATE_CHALLENGE`: multi-battle continuous (5 back-to-back trainer
  battles) via `doContinueEncounter`, no between-round board. Same round-2+
  continuation question as Colosseum for the guest. UNKNOWN: whether the guest
  adopts rounds 2+ after its `CoopReplayMePhase` ends at the first battle handoff.
  Blocks: needs the duo harness.
- `FUN_AND_GAMES` (Wobbuffet minigame) and `GLOBAL_TRADE_SYSTEM`: richer vanilla
  interaction loops. Neither appears in the `continuousEncounter`,
  `initSubsequentOptionSelect`, `displayYesNoOptions`, or bespoke-phase greps, so
  they are LIKELY standard option-select + secondary menu, but their multi-step
  flows were not traced end-to-end. UNKNOWN. Blocks: full read of each encounter's
  option loop.

---

## Part 3 - Prioritized fix list

Priority key: P0 = strand / softlock possible on the happy path; P1 = wrong-player
control; P2 = silent visual divergence; P3 = backstop needs loudness.

### P0 - strand / softlock on the happy path

1. Repeated option-select loops not mirrored (GROUP REPEAT: the 8 press-your-luck
   delves + `SAFARI_ZONE`).
   - Root cause: `coop-replay-me-phase.ts:401-456` - a re-fired top-level
     `mePresent` (no `subPrompt`) is treated as a stray and never re-opens the
     selector; the host meanwhile blocks in `coopHostAwaitGuestIndex`
     (`mystery-encounter-phases.ts:379-402`) for the 20-min ceiling.
   - Fix pointer: in `awaitOutcomeThenTerminal`, a `mePresent` with no `subPrompt`
     must re-render `UiMode.MYSTERY_ENCOUNTER` and (guest-owned) re-arm the pick
     relay, i.e. loop back to the same path `CoopReplayMePhase.start` uses at
     `:252-264`. The re-fire origin is `er-press-your-luck.ts:155-161` /
     `encounter-phase-utils.ts:1032-1034`.

2. Colosseum between-round board is host-only and rounds 2+ are unwired for the
   guest (GROUP COLOSSEUM).
   - Root cause: `colosseum-choice-phase.ts:42-108` opens `UiMode.COLOSSEUM` with
     no co-op owner/watcher path; `colosseum-encounter.ts:258-314` has none either.
   - Fix pointer: give `ColosseumChoicePhase` an owner/watcher relay like
     `TheBargainPhase` (`the-bargain-phase.ts:84-157`), and route
     `startNextColosseumBattle` (`colosseum-encounter.ts:301`) through the ME
     battle handoff (`coop-me-pump.ts:132-152`) so the guest adopts each round.

3. `#821` embedded-ME-reward-shop handoff hook is debug-gated and in the wrong
   branch (latent; masked only because `COOP_DEBUG_DEFAULT = true` today).
   - Root cause: `coop-interaction-relay.ts:590-612` calls
     `onRewardOptionsBuffered` inside `if (isCoopDebug())` on the HAS-waiter branch;
     the intended scenario (guest parked in the ME await, no rewardOptions waiter)
     lands on the no-waiter buffer branch `:604-605` where it is never called.
     Consumer: `coop-replay-me-phase.ts:177-197`.
   - Fix pointer: move the `onRewardOptionsBuffered?.(key)` call to the no-waiter
     buffer branch (`:604-605`) and out of the `isCoopDebug()` guard.
   - Blocks full confirmation: whether any other path opens the watcher shop, and
     whether the co-op duo tests exercise a debug-off build.

### P1 - wrong-player control

4. `CLOWNING_AROUND` yes/no is answered by the HOST on a guest-owned ME (GROUP
   YES/NO). Root cause `mystery-encounter-phases.ts:418-424`. Being addressed by
   the parallel yes/no mirroring; the fix is to stream the yes/no as a `subPrompt`
   and let the guest owner answer, exactly like the party/secondary sub-prompts
   (`coop-replay-me-phase.ts:465-525`).

5. Biome-shop-family MEs: host-only `doEncounterRewards` + a 777-vs-0 reward key
   mismatch (GROUP SHOP-BIOME: `ER_EXOTIC_TRADER`, `ER_BLACK_MARKET`,
   `ER_IMPORT_BAZAAR`). Root causes `exotic-trader-encounter.ts:77-80`,
   `biome-shop-phase.ts:120-126,234-246`, `mystery-encounter-phases.ts:936`. Fix
   pointer: assign `doEncounterRewards` where the guest also sees it (e.g. in
   `onInit`/the builder, not host-only `withOptionPhase`), and unify the shop relay
   key so the guest opens the `BiomeShopPhase` watcher (`coopBiomeWatch`,
   `biome-shop-phase.ts:254-307`) rather than a generic `SelectModifierPhase`.
   (Also has a counter-advance asymmetry that can push P0.)

### P2 - silent visual divergence

6. Host-owned press-your-luck delves: the guest freezes on round 1 and drops the
   terminal `meResync` (same root cause as P0 item 1, host-owned branch;
   `coop-replay-me-phase.ts:445-456`). Fixed by the same change.

7. Watcher reward reconstruct fallback rolls a divergent pool
   (`coop-reward-options.ts:82-107`) - see also P3 (needs loudness).

8. Boss-bar `suppressResummon` leaves a static wrong boss bar
   (`coop-battle-engine.ts:1679-1688`) - see also P3.

### P3 - backstop needs on-screen loudness (currently console-only)

9. All disconnect/degrade backstops that currently emit only a `coopWarn` must gain
   a visible on-screen notice per the maintainer's LOUD rule: watcher reward
   fallback (`coop-reward-options.ts:84-107`), guest self-generated enemies
   (`coop-battle-stream.ts:566-570,742-746`; `coop-enemy-builder.ts:51-58`), AI
   command fallback (`coop-battle-sync.ts:168-178,305-312`), defensive leaves
   (`coop-interaction-relay.ts:261-262,329-333`; `coop-replay-me-phase.ts:772-838`),
   and the boss-bar degrade (`coop-battle-engine.ts:1679-1688`).

10. Owner-controls-watcher-waits screens are LOUD but NOT byte-identical: the biome
    market (`biome-shop-phase.ts:260`) and the Giratina bargain
    (`the-bargain-phase.ts:131`) show the watcher a "your partner is..." message
    instead of the real screen. If strict byte-identical is required, these need
    real mirroring; if the message pattern is accepted, document it as the
    sanctioned exception.

---

## Enumeration summary

- Current ME registry: 91 registered in `initMysteryEncounters`, +
  `ER_THE_BARGAIN` gauntlet-only = 92 reachable. The group counts below describe the
  original audit snapshot; the executable completeness gate is the current authority.
- OK (standard mirrored surfaces): ~67 registered MEs (GROUP OK-STANDARD) + GROUP
  QUIZ (8) + GROUP BARGAIN (1, with a P3 note).
- Flagged: GROUP REPEAT (9, P0), GROUP COLOSSEUM (1, P0/P1), GROUP SHOP-BIOME (3,
  P1/P2), GROUP YES/NO (1, P1), plus GROUP VERIFY (`THE_WINSTRATE_CHALLENGE`,
  `FUN_AND_GAMES`, `GLOBAL_TRADE_SYSTEM` = UNKNOWN).
- Degrade sweep: 12 decisions catalogued; the only happy-path intent violations are
  rows 2 (wrong-player) and 10 (latent strand); rows 4-9 are disaster backstops
  that need on-screen loudness; rows 1, 3, 8, 11, 12 are KEEP.
