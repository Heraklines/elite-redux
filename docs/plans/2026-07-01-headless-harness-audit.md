# Headless harness audit — gaps & fidelity defects (2026-07-01)

Consolidated findings from the three-way audit (battlefield composition, screen/event
coverage, combat-runner fidelity). This is the work list for the harness extension.

## A. Combat scenario runner (`test/tools/run-scenario.test.ts`) — fidelity defects

Undocumented, found by code trace (file:line refs in each item):

1. **Scripted moves destroy the moveset every turn.** `applyAction` always routes
   through `game.move.use`, which does `moveset.splice(0)` + `setMove(0, id)` at full PP
   (`move-helper.ts:174-197`). Player PP never depletes (breaks PP-out/Struggle/Pressure/
   Spite/Leppa), the other 3 moves vanish (breaks Assist/Encore/Disable/Choice interplay),
   and it silently disables `MOVESET_OVERRIDE`. → route through `game.move.select` when the
   move is in the mon's real moveset.
2. **Battle RNG is clamped to MAX roll.** `GameManager` ctor overrides
   `BattleScene.prototype.randBattleSeedInt = (range, min) => min + range - 1`
   (`game-manager.ts:83-84`). Damage is always max, sub-100% procs never fire, `run.seed`
   does not govern battle rolls. → opt-out flag for probabilistic repros.
3. **Player faint with a living bench = 20 s cryptic hang.** `FaintPhase` pushes a
   `SwitchPhase` that opens the PARTY UI (`switch-phase.ts:138-150`); the runner feeds no
   party input. Any realistic multi-mon scenario dies to "Timed out in waitUntil".
   `player-wiped` outcome is effectively untested (GameOverPhase preempts TurnEnd).
4. **Not scriptable at all:** switching, bag items, ball throw/capture, run/flee, tera
   (plumbed in MoveHelper but not exposed), z/mega toggle, per-turn enemy move/target
   forcing (`selectEnemyMove`/`forceEnemyMove` exist, unused), multi-wave progression
   (victory breaks before the shop; `items.shop` is dead headlessly; level-up move-learn
   and evolution unreachable).
5. **2-mon `kind:"party"` runs as a SINGLE battle** unless `run.double:true` — the
   launcher's battle-style getter mock (`run-scenario.test.ts:535`) shadows the auto-double
   in `buildDevScenario` (`scenario-spec.ts:436-438`).
6. **Trainer/boss intro dialogue can hang** — `shouldSkipDialogue` never mocked (contrast
   `runToFinalBossEncounter`, `game-manager.ts:221`).
7. **Custom enemy party drops per-mon fields** (`scenario-spec.ts:412-452`): only
   speciesId/level/moves/abilitySlot/formIndex/isBoss/shiny survive; `status`,
   `bossSegments`, `heldItems`, `ability`, `nature`, `female`, `variant` ignored per-mon;
   ability/passive/items read from `party[0]` and applied side-wide.
8. **Normalization bypassed** — the runner skips `classicMode.startBattle`, so
   disableShinies/normalizeIVs/normalizeNatures/removeEnemyStartingItems never apply;
   enemy IVs/natures/wave items are generation-random.
9. **MEs globally disabled** (`mysteryEncounterChance(0)`, `game-manager.ts:140-143`).
10. **Expect surface is final-lead-state only** + slot stat-stages + whole-run
    log/maxHits. No per-slot HP/status/fainted, no per-turn asserts, no "which move did
    the enemy use", no item-consumption/ability-count asserts. Ability match is substring
    (false-positive prone). Bad enum names throw at module load, not per-test.

## B. Render harness (`test/tools/render-harness.ts`) — the combat gap

The harness renders only a freshly-constructed UiHandler container inside the ×6 UI
nesting. The battle FIELD is scene-level and mock-built: `field` container (arena bases,
pokemon, trainer) + `fieldUI` (BattleInfo HP bars) + scene-level `arenaBg`. Mock objects
hold live transforms/visibility (MockSprite delegates to an inner real `phaserSprite`;
MockContainer stores x/y/visible) but texture keys are stale (mock `setTexture`/`play`
no-op). → Field renderer must MIRROR transforms/visibility from the live scene graph
(so lingering-trainer / fainted-mon-on-field bugs reproduce) and RE-DERIVE texture keys
from game state (`getBattleSpriteKey`/`getBattleSpriteAtlasPath`, `arena.getBgTextureKey()`,
`getBiomeKey()_a/_b`, `trainer.getKey()`), and build fresh `PlayerBattleInfo`/
`EnemyBattleInfo` + `initInfo(mon)` for HP bars.

Key geometry (verified): logical canvas 320×180 ×6; `field` container (0,0) scale 6;
`fieldUI` (0,1080) scale 6; arenaPlayer (300,0), arenaEnemy (−280,0); player mon base
(106,148), enemy (236,84) + `fieldSpriteOffset` slot offsets (double: L[−32,−8] R[32,0];
triple: L[−58,10] R[58,10] C[0,−8]); PlayerBattleInfo base (310,−72), EnemyBattleInfo
(140,−141); trainer back sprite (406,186) origin (0.5,1).

Known residuals to document: no fusion second-sprite, no weather/fog overlays, field
scale fixed at 6 (mock `setScale` is a no-op stub so `updateFieldScale` state is lost),
substitute doll not distinguished.

## C. Coverage gaps (screens & events)

- ~17 of 64 UiModes have a render recipe; ~26/31 vanilla MEs have flow tests.
- **Zero coverage anywhere:** COLOSSEUM (handler + choice phase), ER_QUIZ, Black Market
  shop phase, Exotic Trader shop phase.
- **No render recipe:** MODIFIER_SELECT (post-battle reward shop!), EVOLUTION_SCENE,
  EGG_HATCH_SCENE, EGG_GACHA, EGG_LIST, POKEDEX list, FIGHT, BALL, TARGET_SELECT, TITLE,
  MENU, SAVE_SLOT, CHALLENGE_SELECT, RUN_HISTORY/RUN_INFO, GAME_STATS, SETTINGS×5,
  LEARN_MOVE_BATCH, ER_MAP_PICKER, LLM_DIRECTOR_THEME_PICKER, AUTO_EGG_RESTOCK.
- **~55 of 59 ER mystery encounters have no per-encounter flow test** (only 3 get an
  option-panel snapshot; 1 runs through the co-op duo harness). The T1 runner already
  accepts any `MysteryEncounterType` name — only the demo list is capped at 3.
- 5 vanilla MEs untested: MYSTERIOUS_CHEST, DARK_DEAL, SLUMBERING_SNORLAX,
  SHADY_VITAMIN_DEALER, TRAINING_SESSION.
- DOM-form modes (login/register/rename/bug-report/challenge-text) are not rasterizable
  headlessly — browser-only, by design.

## D. Tester-report cross-check (what actually gets reported)

Recent `dev-logs/remote` classes → harness fit:
- battlefield visual state ("trainer sprite remains", "fainted pokemon on battlefield") → B
- reward-loop cancel flows ("TM Case cancel duplicates reward slots", "capsule cancel
  forced next battle", "Rarer Candy black screen") → A4 (shop flow) + C (MODIFIER_SELECT)
- switch-timing ("switched out Rufflet but it switched after Roselia's turn") → A4 (switch scripting)
- enemy generation (ghost 2000-stat mons, lvl-4 Lokix w/ Bleakwind Storm, wave-1 Shedinja)
  → already expressible via wave specs; keep.

## E. Bug-category -> harness-capability matrix (target architecture)

Every bug class a player can report, and which harness tier must reproduce it:

| # | Bug category | Harness capability (tier) | State after this session |
|---|--------------|---------------------------|--------------------------|
| 1 | Combat mechanics (damage/abilities/moves/status/stages/weather/multi-hit/forms) | ScenarioSpec + expect{} (combat runner) | Extended: non-destructive move scripting, per-turn enemy forcing, real-RNG opt-in |
| 2 | In-battle player interactions (switch, bag item, ball, run, tera, targeting) | TurnAction script surface | NEW: switch/ball/run/tera/enemyMove actions; item-from-bag pending |
| 3 | Cross-phase flow (faint->switch, level-up->learn, evolution, reward pick/cancel, multi-wave, biome change) | Multi-wave runner + prompt handlers + rewards[] script | NEW: waves N + reward scripting + faint-switch handler + learn-move handler |
| 4 | Visual/layout (wrong/missing sprite, overlap, chrome, text) | Tier-2b golden render; Tier-1 key checks; render-sprite pixels | NEW: battlefield renders (field: true); injector fidelity fixed (hash atlases, trim, ui-priority, setTexture recording) |
| 5 | Input-driven UI crash/softlock (cursor/scroll/menu transitions) | steps: Button[] + expectThrow + universal setMode routing | Existed; now benefits from field+suspect diagnostics |
| 6 | Animation/timing/races | ER_FRAMES flipbook (partial) | Residual: tween-driven mid-states not steppable headlessly (framework tween mock fires onComplete only, never applies values) |
| 7 | Co-op sync (desync/softlock/checksum/ME handoff/reward alternation) | Two-engine duo harness + record->replay | Closing: real launch handshake (zero-resync assert), per-client ghost state, live event streaming, party-target rewards, loud stalls |
| 8 | Deterministic bug-report replay | ReplayTrace record->replay | Co-op done; single-player loader = thin add, still open |
| 9 | Enemy generation/balance (illegal moves, stat anomalies, BST) | Wave-spec scenarios + er-trainer-* suites | Existed |
| 10 | Data legality (egg moves, evolutions, dex text) | Data audits + vitest | Existed |
| 11 | Browser/prod-only (SW/CDN cache, audio, WebGL shader exactness, cross-device variance, DOM forms) | NOT headless - staging/browser tier | Documented out of scope |

## F. Residual gaps after this session (honest out-of-scope list)

1. Tween-final positions are lost headlessly (game-wrapper tween mock fires onComplete
   without applying values) - positional-drift visual bugs cannot reproduce. Candidate
   fix: opt-in ER_APPLY_TWEEN_FINALS in game-wrapper applying final numeric props.
2. WebGL-only output (palette-swap variant colours, shaders, glow/particle FX) is
   approximated by the 2D canvas rasterizer.
3. Single-player record->replay loader (recorder taps exist, not begun).
4. Per-encounter FLOW tests for ~55 ER MEs (options -> outcome assertions) - the render
   sweep covers the option panel only. Biggest remaining coverage hole.
5. Field render residuals: fusion second-sprite, weather/fog overlays, substitute doll,
   dynamic field scale (mock setScale no-op).
6. Mid-battle bag item use scripting (potions/x-items) in the combat runner.
7. Pre-existing red test: summary gift-cycle #349 (ability id does not advance) - fails
   on unmodified HEAD too; triage separately (possible real regression of the fix).
