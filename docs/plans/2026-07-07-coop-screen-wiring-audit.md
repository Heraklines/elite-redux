# Co-op screen / prompt wiring audit (the systematic version of #855)

Date: 2026-07-07. Branch: `feat/elite-redux-port` (base `f935c5141`).

## Why

#855 was an ME-granted mon meeting a FULL party: it opened a replace-or-skip picker
that **neither** player could drive because the surface was never wired/registered for
co-op. This document is the systematic sweep of **every** interactive screen/prompt that
can pop up MID-RUN in a two-client co-op session, each cross-checked against
`coop-ui-registry.ts` AND the actual owner/relay drive path, then classified.

The point fix for #855 itself (the ME-grant picker) and the lobby-resume UI are owned by
other agents; those are **noted and skipped** here.

## Classification legend

- **WIRED-VERIFIED** - has an owner-drives + relay + watcher-adopt + anti-hang path AND a
  test that exercises it (test cited).
- **WIRED-UNTESTED** - the drive path exists in code, no dedicated duo test.
- **UNWIRED-BLOCKING** - the #855 class: can open with no owner/arbitration, so it either
  hard-hangs on a non-driving client, or opens on BOTH clients unmirrored and diverges a
  run-checksummed value (a resync storm). **THE DELIVERABLE.**
- **UNWIRED-BENIGN** - local-only / per-account / read-only; cannot block progression or
  diverge the shared run (justified per row).
- **UNREACHABLE-IN-COOP** - gated off in co-op (gate cited).

## Wiring anchors (how "wired" is defined)

- `coop-ui-registry.ts` - `Record<UiMode, CoopUiClass>` is EXHAUSTIVE (a new UiMode is a
  compile error). `mirrored` = has co-op wiring; `local-only` = per-client. Feeds the
  `ui.ts` unmirrored-screen tripwire (DEV/staging warn, never blocks).
- `coop-seq-registry.ts` - every relay `seq` band + every relay `kind` string; the
  collision test proves bands pairwise-disjoint, the kind test proves every sent kind is
  registered and rides a consumed band.
- `coop-interaction-relay.ts` - the owner→watcher channel: `sendInteractionChoice` /
  `awaitInteractionChoice` (+ `Outcome`), FIFO-per-seq, **timeout→null→watcher leaves**
  (the universal anti-hang).
- `coop-wiring-completeness.test.ts` - every runtime hook installed by BOTH factories;
  every wire type has a receiver.
- `coop-renderer-gate.ts` - the authoritative GUEST is a pure renderer; the denied set
  (`MovePhase`, `FaintPhase`, `AttemptCapturePhase`, ...) is neutralized on the guest, so
  those phases' prompts never open on the renderer.

---

## Master inventory

### Battle command surfaces
| Surface (UiMode / sub) | Class | Owner / relay / anti-hang | Evidence |
|---|---|---|---|
| COMMAND / FIGHT / BALL / TARGET_SELECT | WIRED-VERIFIED | each client drives its OWN mons; command relayed host-authoritative via battle sync | `coop-battle-sync`, `coop-duo-*` suite |
| PARTY / SWITCH (battle-menu voluntary switch) | WIRED-VERIFIED | `switch-phase.ts` owner/watcher, faintSwitch band | `coop-duo-voluntary-switch-transposition.test.ts` |
| PARTY / FAINT_SWITCH, POST_BATTLE_SWITCH | WIRED-VERIFIED | `switch-phase.ts` + `coop-guest-faint-switch-phase.ts`, `awaitInteractionChoice` w/ timeout auto-pick | `coop-duo-faint-switch`, `coop-duo-double-faint`, `coop-duo-heavy-faint-seating` |
| PARTY / REVIVAL_BLESSING | WIRED-VERIFIED | `revival-blessing-phase.ts` partner-pick guard + `coop-guest-revival-phase.ts`, revival band | `coop-duo-revival-blessing-ownerpick`, `coop-duo-revive-sync` |

### Post-battle reward shop
| Surface | Class | Owner / relay / anti-hang | Evidence |
|---|---|---|---|
| MODIFIER_SELECT (reward shop) | WIRED-VERIFIED | owner/watcher relay + streamed option pool; watcher starts empty pool, adopts | `coop-duo-reward-items`, `coop-duo-reward-reroll`, `coop-reward-options.test.ts` |
| PARTY / CHECK (Check Team) | WIRED-VERIFIED | watcher short-circuit; `COOP_ACT_CHECK` on reward band | `coop-shop-check-ops.test.ts` |
| PARTY / MODIFIER_TRANSFER (item transfer) | WIRED-VERIFIED | `COOP_ACT_TRANSFER` relayed; watcher applies directly | `coop-shop-check-ops.test.ts` |
| PARTY / SPLICE (DNA splicer) | WIRED-UNTESTED | `openFusionMenu` watcher applies relayed `[from,splice]` pair; owner relays via `coopFlushPending` | code: `select-modifier-phase.ts:764-793` (no dedicated duo test) |
| PARTY / MODIFIER, MOVE_MODIFIER, TM_MODIFIER, REMEMBER_MOVE_MODIFIER, ER_LEARNERS_SHROOM_MODIFIER, ER_TM_CASE_MODIFIER | WIRED-UNTESTED | `openModifierMenu` watcher applies relayed `[slot,option]` directly; owner relays via `coopFlushPending` | code: `select-modifier-phase.ts:832-863` |
| PARTY / ABILITY_MODIFIER (ability capsules/randomizer) | WIRED-VERIFIED | `coop-ability-picker-relay`, abilityPicker band, owner/watcher | `coop-ability-picker-relay.test.ts` |
| CONFIRM (skip-item confirm) | WIRED-VERIFIED | owner relays `COOP_INTERACTION_LEAVE`, `coopEndMirror` | reward suite |
| SUMMARY / LEARN_MOVE_BATCH (level-up move learn) | WIRED-VERIFIED | shared owner-drives/watcher-mirrors panel, learnMoveBatch band | `coop-duo-learn-move`, `coop-learn-move-forward.test.ts` |

### Between-wave / world map
| Surface | Class | Owner / relay / anti-hang | Evidence |
|---|---|---|---|
| ER_MAP (biome route pick) | WIRED-VERIFIED | owner drives + cursor mirror; watcher adopts relayed biome, biomePick band; auto-resolve+timeout | `coop-duo-biome-choice.test.ts` |
| OPTION_SELECT crossroads Stay/Leave | WIRED-VERIFIED | owner/watcher, crossroads band, anti-hang fallback | `coop-duo-biome-choice.test.ts` |
| BIOME_SHOP (every-10-wave market) | WIRED-VERIFIED | owner/watcher, streamed stock, biomeShop band | `coop-biome-shop-me.test.ts` |
| ER_MAP_PICKER | UNREACHABLE-IN-COOP | the branching node picker is superseded by the ER_MAP owner/watcher pick flow (`select-biome-phase.ts` co-op branch); the OPTION_SELECT fallback is `coopController == null` only | `select-biome-phase.ts:163` |
| CONFIRM biome-market leave | WIRED-VERIFIED | `coopBiomeTerminal()` relays LEAVE first | `coop-biome-shop-me.test.ts` |

### Mystery encounters
| Surface | Class | Owner / relay / anti-hang | Evidence |
|---|---|---|---|
| MYSTERY_ENCOUNTER option selector | WIRED-VERIFIED | host streams `mePresent`, guest renders+relays picks, mePump/meTerm bands | `coop-duo-mystery.test.ts`, `coop-me-pump.test.ts` |
| OPTION_SELECT ME secondary option | WIRED-VERIFIED | streamed as ME subPrompt | `coop-me-yesno-subprompt.test.ts` |
| PARTY / SELECT (ME party target) | WIRED-VERIFIED | `selectPokemonForOption` co-op guest guard "do NOT open local PARTY"; guest mirrors via `coop-replay-me-phase.ts` | `coop-me-yesno-subprompt`, `coop-duo-mystery` |
| ER_QUIZ (quiz/minigame) | WIRED-VERIFIED | host streams quiz session, meQuiz band | `coop-quiz-mirror` path, registry |
| COLOSSEUM (press-your-luck) | WIRED-VERIFIED | owner/watcher board+pick, colosseum band | `coop-colosseum-board.test.ts` |
| ER_BARGAIN (Giratina deal) + its PARTY/CHECK/SELECT/ABILITY sub-picks | WIRED-VERIFIED | owner drives whole screen, watcher adopts ONE outcome blob, bargain band | `the-bargain-phase.ts:78-157` (owner/watcher); registry |
| **PARTY / RELEASE (ME catch/obtain, full party)** | **UNWIRED-BLOCKING (= #855)** | `catchPokemon` `promptRelease`: CONFIRM "fullParty" → PARTY.RELEASE, NOT relayed. Runs on the client resolving the ME grant, which need not be the one that can drive it. | `encounter-pokemon-utils.ts:738-812` — **owned by the #855 point-fix agent; noted, not fixed here** |

### ER item / relic pop-ups
| Surface | Class | Owner / relay / anti-hang | Evidence |
|---|---|---|---|
| **OPTION_SELECT Stormglass weather pick** | **UNWIRED-BLOCKING → FIXED** | was unmirrored on both clients (run-checksummed weather → resync storm). Now HOST owns + relays weather index; guest adopts; timeout→checkpoint heal. stormglass band. | `er-stormglass-picker-phase.ts` (this change) + `coop-small-relays.test.ts` |
| OPTION_SELECT Dex Nav species pick | UNWIRED-BENIGN (REVIEW) | writes the PER-ACCOUNT pokedex (dex entry/starter unlock), NOT run-checksummed; each client has its own dex and its own human input, so no shared-run divergence and no hang. Applied by whoever consumes the (owner-driven) reward. | `er-dex-nav-phase.ts` — reported, see below |

### Level-up / evolution / eggs
| Surface | Class | Owner / relay / anti-hang | Evidence |
|---|---|---|---|
| CONFIRM "forget a move?" / "stop teaching?" | WIRED-VERIFIED | owner drives via SUMMARY session, `COOP_LEARN_MOVE_SEQ`, relayed result | `coop-duo-learn-move.test.ts` |
| EVOLUTION_SCENE branch OPTION_SELECT | UNREACHABLE-IN-COOP | co-op takes `evolutionChoices[0]` deterministically, never prompts | `evolution-phase.ts:290` |
| EVOLUTION_SCENE "B to pause" CONFIRM | UNREACHABLE-IN-COOP | `canCancel = canCancel && !isCoop` → pause prompt disabled | `evolution-phase.ts:373,579` |
| EGG_HATCH_SCENE / EGG_HATCH_SUMMARY + mid-run egg-skip CONFIRM | UNWIRED-BENIGN | deterministic hatch (`coop-egg-determinism`); non-interactive continue / per-client skip preference; not run-checksummed | `coop-egg-determinism.test.ts`; `egg-lapse-phase.ts:98` |
| FORM_CHANGE (mega/form) | UNWIRED-BENIGN | no interactive prompt (deterministic animation applied on both) | `form-change-phase.ts` |

### Catch (non-ME)
| Surface | Class | Owner / relay / anti-hang | Evidence |
|---|---|---|---|
| **PARTY / RELEASE (wild catch, full party)** | UNWIRED-BENIGN (ownership concern) | `AttemptCapturePhase` is in the renderer DENIED set, so this prompt opens **host-only**; the host human always has input → not a hang. It IS an unwired shared-party mutation (a guest-thrown catch asks the HOST to decide releases from the merged party) - same CLASS as #855 but not blocking. | `attempt-capture-phase.ts:387-471`; `coop-renderer-gate.ts:46` |
| catch keep/release CONFIRM (add-or-box) | UNWIRED-BENIGN | same host-only phase; host-drivable | `attempt-capture-phase.ts:315-479` |

### Chrome / menus / meta (tripwire-exempt or local-only)
| Surface | Class | Justification |
|---|---|---|
| MESSAGE, CONFIRM, OPTION_SELECT, MENU, MENU_OPTION_SELECT, AUTO_COMPLETE | UNWIRED-BENIGN | ubiquitous chrome; per-call-site co-op wiring lives in the owning phase; tripwire-exempt |
| SETTINGS*, GAMEPAD/KEYBOARD binding | UNWIRED-BENIGN | per-client preferences |
| ACHIEVEMENTS, GAME_STATS, EGG_LIST, EGG_GACHA, POKEDEX*, RUN_HISTORY, RUN_INFO, PROFILE, GHOST_TRAINER_EDITOR, ER_SHINY_LAB | UNWIRED-BENIGN | per-account personal views; not shared-run surfaces |
| RENAME_POKEMON | UNWIRED-BENIGN (REVIEW) | each client renames its own mon; a shared-mon nickname write is a cosmetic (non-checksummed) divergence |
| SAVE_SLOT (mid-run save) | UNWIRED-BENIGN (REVIEW) | guest boots from host session (`applyCoopLaunchSession`); a per-client slot pick does not diverge the shared run |
| RENAME_RUN, CHALLENGE_SELECT, COMMUNITY_CHALLENGE*, STARTER_SELECT | UNWIRED-BENIGN | pre-run / lobby-era; co-op roster assembled separately |
| GAME_OVER retry CONFIRM | UNREACHABLE-IN-COOP | `isCoop` routes straight to `handleGameOver`, prompt never opens | `game-over-phase.ts:101` |
| LLM_DIRECTOR_THEME_PICKER / llm-director beat OPTION_SELECT | UNWIRED-BENIGN (REVIEW) | narrative director surfaces; local-only classification; not run-checksummed. Confirm the director is per-account/off in co-op. |

---

## UNWIRED-BLOCKING findings (the deliverable)

### 1. Stormglass weather picker — FIXED (this change)
`ErStormglassPickerPhase` is unshifted from `EncounterPhase` (wave start) whenever the
Stormglass relic is held and no weather has been chosen yet. That block runs on BOTH the
host and the guest (`!this.loaded` branch, `encounter-phase.ts:651`), so BOTH clients
opened `UiMode.OPTION_SELECT` and each human picked independently. The chosen weather is
recorded on the relic's `chosenWeather`, which is **hashed into the per-turn battle
checksum** (`coop-battle-checksum.ts:171`, `coop-battle-engine.ts:1692/1810/1898`), so two
independent picks → a permanent digest mismatch → a resync every turn. It also blocked
each client's wave-start phase queue on a separate human input.

**Fix (house pattern):** the HOST OWNS the one-time pick (deterministic; no
interaction-counter alternation needed because it fires at most once per run). The host
drives the real picker and relays the chosen weather INDEX on the fixed
`COOP_STORMGLASS_SEQ`; the guest never opens the picker, awaits the relayed index and
adopts the identical weather, and on timeout leaves it unset so the per-turn checkpoint
converges it (never hangs). Registered in `coop-seq-registry.ts` (band `stormglass` +
kind `stormglass`), so the collision/kind guards now cover it.

- Files: `src/phases/er-stormglass-picker-phase.ts`, `src/data/elite-redux/coop/coop-seq-registry.ts`.
- Test: `test/tests/elite-redux/coop/coop-small-relays.test.ts` — the host-relays-index /
  guest-maps-back round-trip + the timeout-heals-never-hangs case.
- **fails-before/passes-after:** before the change there was no `stormglass` band/kind, so
  `coop-seq-registry.test.ts` + `coop-relay-kind-registry.test.ts` had no entry to assert
  and the phase had no relay; the new `coop-small-relays.test.ts` cases reference
  `COOP_STORMGLASS_SEQ` (did not exist) — they cannot compile/pass against the old tree.
  After the change all pass and the two registry guards stay green with the new band.

### 2. ME-grant party-full RELEASE picker — #855 itself (noted, NOT fixed)
`catchPokemon` (`encounter-pokemon-utils.ts:738`) `promptRelease`: `CONFIRM "fullParty"` →
`PARTY / RELEASE`, not relayed. This is the exact #855 surface and is owned by the point-fix
agent. **Skipped per directive.**

### 3. Wild-catch party-full RELEASE — same class, host-only (reported, NOT blocking)
`AttemptCapturePhase` (`attempt-capture-phase.ts:387`) opens the same `CONFIRM "fullParty"`
→ `PARTY / RELEASE`, but the phase is in the renderer DENIED set, so it only opens on the
HOST (always input-capable) → not a hang. It remains an **unwired shared-party mutation**
(a guest-thrown catch asks the host to choose releases from the merged party). Recommend
the #855 agent's relay be reused here once landed, since it is the identical prompt shape.

---

## Registry additions (so unregistered = red build going forward)

- `coop-seq-registry.ts`: `COOP_STORMGLASS_SEQ = 9_800_000` (fixed singleton, disjoint
  above every other band); added to `COOP_SEQ_BANDS` (key `stormglass`, maxOffset 0) and
  `COOP_RELAY_KINDS` (kind `stormglass`, transport `choice`, band `stormglass`). The
  existing `coop-seq-registry.test.ts` (disjointness) and `coop-relay-kind-registry.test.ts`
  (sent-⇔-registered) now guard it automatically.
- `coop-ui-registry.ts` classification is unchanged: the Stormglass prompt rides
  `OPTION_SELECT`, which is (correctly) `local-only` + tripwire-exempt; the co-op wiring
  lives in the phase, exactly like the crossroads/skip-confirm OPTION_SELECT surfaces.

## Residual REVIEW items (not blocking; recommend follow-up)
- **Dex Nav** (`er-dex-nav-phase.ts`): per-account dex write, benign, but the picker opens
  on the consuming client; if a consumable is applied on the watcher too it shows an
  unexpected (drivable) picker. Cheap follow-up: gate it to the reward OWNER.
- **SPLICE / TM / MOVE / REMEMBER_MOVE party-target rewards**: wiring exists
  (`select-modifier-phase.ts` watcher-applies-relayed-slot), but no dedicated duo test —
  add a `coop-duo` reward-splice / reward-tm case.
- **RENAME_POKEMON / SAVE_SLOT / llm-director**: confirm the REVIEW assumptions (per-mon
  rename ownership; host-authoritative save; director per-account/off).

## Verification
- Green-keepers: `coop-duo-mystery`, `coop-duo-multiwave`, `coop-duo-biome-choice` — green.
- Guards: `coop-seq-registry`, `coop-relay-kind-registry`, `coop-ui-registry`,
  `coop-wiring-completeness`, `coop-small-relays` — green (30/30 with the new cases).
- tsc: no new errors (stash-measured baseline). biome: clean on changed files.
