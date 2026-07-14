/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op UI CLASSIFICATION REGISTRY (#840). A TOTAL table classifying every
// `UiMode` as either "mirrored" (has explicit co-op wiring - both clients see the
// same screen, owner drives / watcher mirrors, or each client drives its own with
// the result relayed) or "local-only" (legitimately per-client - menus, settings,
// personal views, pre-run screens, message boxes).
//
// WHY THIS EXISTS (byte-identical audit): every NEW interactive screen silently
// defaults to HOST-ONLY in co-op. Each historical miss (the trader shop, the
// colosseum board, the quiz screens, the yes/no prompts) was discovered LIVE, in a
// two-client session, because nothing at build time forced a decision about whether
// a new screen participates in the shared run. This table forces that decision:
//   - `Record<UiMode, CoopUiClass>` is EXHAUSTIVE, so adding a UiMode without
//     classifying it is a COMPILE ERROR. "unclassified" is not representable.
//   - The runtime tripwire in ui.ts uses this table (plus a tiny exempt allowlist)
//     to log a staging-only warning when a NON-mirrored, non-exempt interactive
//     screen opens while the PARTNER owns a live interaction - the pattern of an
//     unmirrored screen leaking into one client. It is a tripwire, NOT a block:
//     zero behavior change.
//
// CLASSIFICATION RULE (from the maintainer's byte-identical requirement): when
// GENUINELY UNSURE whether a screen is mirrored, classify it "local-only" with a
// REVIEW comment rather than guessing "mirrored" - a false "mirrored" silences the
// tripwire on a real gap; a false "local-only" only produces a harmless staging log.
//
// This module imports ONLY the UiMode enum (a leaf), so it stays unit-testable and
// free of the coop runtime.
// =============================================================================

import { UiMode } from "#enums/ui-mode";

/** How a `UiMode` behaves in a co-op session. */
export type CoopUiClass = "mirrored" | "local-only";

/**
 * The TOTAL classification of every UiMode. Exhaustive by construction
 * (`Record<UiMode, ...>`): a new UiMode with no entry fails to compile.
 *
 * Each "mirrored" entry cites the machinery that mirrors it. Each "local-only" entry that could
 * plausibly be a shared-run surface carries a REVIEW note pointing at what to confirm.
 */
export const COOP_UI_REGISTRY: Record<UiMode, CoopUiClass> = {
  // ---- MIRRORED: explicit co-op wiring, both clients converge on the screen ----

  // Battle command surfaces: each client drives its OWN mons; the command (move / target / ball /
  // switch) is relayed and resolved host-authoritatively via the battle command relay
  // (coop-battle-sync.ts, command-phase.ts, coop-partner-ai.ts).
  [UiMode.COMMAND]: "mirrored",
  [UiMode.FIGHT]: "mirrored",
  [UiMode.BALL]: "mirrored",
  [UiMode.TARGET_SELECT]: "mirrored",

  // The post-battle reward shop: owner/watcher relay in select-modifier-phase.ts (coopRelaySend /
  // awaitInteractionChoice) + streamed option pool (coop-reward-options.ts).
  [UiMode.MODIFIER_SELECT]: "mirrored",

  // Party screen: carries the faint-replacement owner-pick relay (switch-phase.ts,
  // coop-guest-faint-switch-phase.ts) + ME party/secondary sub-prompt captures streamed as a
  // subPrompt (encounter-phase-utils.ts selectPokemonForOption) + the #855 ME catch-FULL replace-or-skip
  // sub-prompt (the guest drives PARTY/SELECT, the host applies the release+add - coopHostStreamCatchFullAwaitSlot
  // / coop-replay-me-phase openSubPickCapture) + party-target reward drive. Also used for plain local party
  // viewing, but the mirrored interactions make "mirrored" the safe class.
  [UiMode.PARTY]: "mirrored",

  // Summary: DUAL-USE. The move-learn ("which move to forget") cursor mirror rides UiMode.SUMMARY
  // (learn-move-phase.ts beginSession("watcher"/"owner", UiMode.SUMMARY, ...)). Also used for local
  // party-summary viewing; classified "mirrored" so the mirrored learn-move path never trips the
  // tripwire (the watcher legitimately opens SUMMARY it does not "own").
  [UiMode.SUMMARY]: "mirrored",

  // Mystery-encounter option selector: host streams `mePresent`, guest renders + relays picks
  // (coop-replay-me-phase.ts, mystery-encounter-phases.ts, encounter-phase-utils.ts).
  [UiMode.MYSTERY_ENCOUNTER]: "mirrored",

  // The bespoke every-10-waves biome market: owner/watcher path keyed on COOP_BIOME_SHOP_SEQ_BASE
  // with a streamed 16-slot stock (biome-shop-phase.ts, coop-biome-shop.ts).
  [UiMode.BIOME_SHOP]: "mirrored",

  // The Colosseum press-your-luck board: owner/watcher board present + pick relay on
  // COOP_COLOSSEUM_SEQ_BASE, guest round-loop (coop-colosseum.ts, #829/#818).
  [UiMode.COLOSSEUM]: "mirrored",

  // The Quiz / minigame panel: host streams the quiz session, both run ErQuizPhase, owner
  // self-relays answers (coop-quiz-mirror.ts, #818).
  [UiMode.ER_QUIZ]: "mirrored",

  // Giratina's Bargain deal screen: owner/watcher decision on COOP_BARGAIN_SEQ_BASE, watcher adopts
  // the outcome blob (the-bargain-phase.ts, #795).
  [UiMode.ER_BARGAIN]: "mirrored",

  // The ER batch level-up Move Learn panel is now the SHARED co-op level-up path (#848): the mon's OWNER
  // drives the real panel and the WATCHER opens the same panel + mirrors the owner's live cursor, both
  // closing together on the relayed terminal. Host streams `learnMoveBatchForward` (present) and the owner
  // relays the final assignment set as a `learnMoveBatch` choice on COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE +
  // partySlot (learn-move-batch-phase.ts, coop-replay-learn-move-batch.ts). Any panel error still falls
  // back to the relayed per-move LearnMovePhase, so it can never softlock.
  [UiMode.LEARN_MOVE_BATCH]: "mirrored",

  // ---- LOCAL-ONLY: legitimately per-client ----

  // Ubiquitous chrome / message boxes (exempt from the tripwire, see COOP_UI_TRIPWIRE_EXEMPT).
  [UiMode.MESSAGE]: "local-only",
  [UiMode.CONFIRM]: "local-only",
  [UiMode.OPTION_SELECT]: "local-only",
  [UiMode.MENU]: "local-only",
  [UiMode.MENU_OPTION_SELECT]: "local-only",
  [UiMode.AUTO_COMPLETE]: "local-only",

  // Non-interactive / transition states.
  [UiMode.TITLE]: "local-only",
  [UiMode.LOADING]: "local-only",
  [UiMode.SESSION_RELOAD]: "local-only",
  [UiMode.UNAVAILABLE]: "local-only",

  // Settings + input binding (per-client preferences).
  [UiMode.SETTINGS]: "local-only",
  [UiMode.SETTINGS_DISPLAY]: "local-only",
  [UiMode.SETTINGS_AUDIO]: "local-only",
  [UiMode.SETTINGS_GAMEPAD]: "local-only",
  [UiMode.GAMEPAD_BINDING]: "local-only",
  [UiMode.SETTINGS_KEYBOARD]: "local-only",
  [UiMode.KEYBOARD_BINDING]: "local-only",

  // Personal viewing / meta screens (each player looks at their own account data).
  [UiMode.ACHIEVEMENTS]: "local-only",
  [UiMode.GAME_STATS]: "local-only",
  [UiMode.EGG_LIST]: "local-only",
  [UiMode.EGG_GACHA]: "local-only",
  [UiMode.AUTO_EGG_RESTOCK]: "local-only",
  [UiMode.POKEDEX]: "local-only",
  [UiMode.POKEDEX_SCAN]: "local-only",
  [UiMode.POKEDEX_PAGE]: "local-only",
  [UiMode.RUN_HISTORY]: "local-only",
  [UiMode.RUN_INFO]: "local-only",
  [UiMode.PROFILE]: "local-only",
  [UiMode.GHOST_TRAINER_EDITOR]: "local-only",
  [UiMode.ER_SHINY_LAB]: "local-only",

  // Account / auth / forms (pre-run or per-client, never a shared-run surface).
  [UiMode.LOGIN_OR_REGISTER]: "local-only",
  [UiMode.LOGIN_FORM]: "local-only",
  [UiMode.REGISTRATION_FORM]: "local-only",
  [UiMode.CHANGE_PASSWORD_FORM]: "local-only",
  [UiMode.BUG_REPORT_FORM]: "local-only",
  [UiMode.RENAME_RUN]: "local-only",

  // Pre-run / lobby-era selection (the co-op roster is assembled separately, coop-roster.ts, and
  // the guest boots from the host's launch session, applyCoopLaunchSession).
  [UiMode.CHALLENGE_SELECT]: "local-only",
  [UiMode.COMMUNITY_CHALLENGES]: "local-only",
  [UiMode.COMMUNITY_CHALLENGE_CREATE]: "local-only",
  [UiMode.COMMUNITY_CHALLENGE_TEXT]: "local-only",

  // Animation scenes: the underlying event is host-authoritative + deterministic; the scene plays
  // per-client (evolutions applied on both, eggs are deterministic - coop-egg-determinism).
  [UiMode.EVOLUTION_SCENE]: "local-only",
  [UiMode.EGG_HATCH_SCENE]: "local-only",
  [UiMode.EGG_HATCH_SUMMARY]: "local-only",

  // Dev / experimental.
  [UiMode.TEST_DIALOGUE]: "local-only",
  [UiMode.ADMIN]: "local-only",
  [UiMode.LLM_DIRECTOR_THEME_PICKER]: "local-only",

  // ---- LOCAL-ONLY with REVIEW (conservative: verify these are host-authoritative / not a gap) ----

  // REVIEW: starter selection at run start. The co-op roster is assembled via coop-roster.ts and the
  // guest adopts the host's launch session; the full SelectStarter->launch handshake is not driven in
  // the harness (CLAUDE.md). Confirm both clients converge on the launched team.
  [UiMode.STARTER_SELECT]: "local-only",

  // REVIEW: save-slot select. The guest boots from the host's session (applyCoopLaunchSession); a
  // per-client save-slot pick should not diverge the shared run. Confirm co-op save/resume ownership.
  [UiMode.SAVE_SLOT]: "local-only",

  // REVIEW: the branching World-Map node PICKER shown when leaving a biome - a SHARED run decision
  // (which biome/node next). Confirm it is host-authoritative or mirrored in co-op; if it opens on
  // both clients unmirrored it is exactly the unmirrored-screen class this registry guards against.
  [UiMode.ER_MAP_PICKER]: "local-only",

  // The World Map (UiMode.ER_MAP): DUAL-USE. As the read-only J overlay it is a per-client view
  // (erMapState rides the launch/save snapshot so both clients render the same data). In PICK MODE
  // it is the every-biome-end route chooser, now owner-alternated + mirrored in co-op (#848): the
  // interaction OWNER drives the real picker and the WATCHER opens a read-only copy that mirrors the
  // owner's live cursor (coop-ui-mirror.ts) and adopts the owner's relayed biome on COOP_BIOME_PICK_SEQ_BASE
  // + interactionCounter (select-biome-phase.ts). Classified "mirrored" so the mirrored picker never trips
  // the unmirrored-screen tripwire (the watcher legitimately opens ER_MAP it does not "own").
  [UiMode.ER_MAP]: "mirrored",

  // REVIEW: renaming a pokemon in a MERGED co-op party. Confirm each client renames only its own mon
  // (a shared-mon nickname write would be a latent divergence; cosmetic, not run-affecting).
  [UiMode.RENAME_POKEMON]: "local-only",

  // Showdown 1v1 versus WAGER screen (D3): LOCAL-ONLY by construction - each player drives its OWN
  // copy (its own stake picker + lock), and only the resulting stake OFFER / lock crosses the wire
  // (showdownStakeOffer + the showdown-wager-commit rendezvous). The versus GUEST's command menu is
  // now the NORMAL player-side COMMAND menu (Task F1 data-level side swap), so it needs no bespoke
  // entry here. Never a co-op surface (versus is a distinct GameMode, not isCoop).
  [UiMode.SHOWDOWN_WAGER]: "local-only",

  // Showdown 1v1 versus SET EDITOR (Layer 3 teambuilder): LOCAL-ONLY by construction - each player
  // shapes its OWN team slot on its OWN screen; only the resulting validated team manifest crosses the
  // wire (the C2 team exchange), never the editor UI. Never a co-op surface (versus is a distinct
  // GameMode, not isCoop).
  [UiMode.SHOWDOWN_SET_EDITOR]: "local-only",

  // Showdown 1v1 TEAM PRESET MENU (the pre-pairing entry screen): LOCAL-ONLY by construction - it opens
  // at the TITLE before any session exists, so it can never be a partner-owned interaction. Only the
  // chosen preset's team manifests cross the wire later (the negotiate step), never this menu UI.
  [UiMode.SHOWDOWN_TEAM_MENU]: "local-only",

  // Showdown Tournament LIST + BRACKET: LOCAL-ONLY by construction - they open at the TITLE (from the
  // Team Menu) before any session exists, rendering the tournament WORKER's authoritative state. No
  // co-op/versus interaction rides these screens; entering a tournament match just launches the normal
  // constrained lobby afterward.
  [UiMode.TOURNAMENT_LIST]: "local-only",
  [UiMode.TOURNAMENT_BRACKET]: "local-only",
};

/**
 * The small allowlist of modes the tripwire NEVER warns on even when they open during a
 * partner-owned interaction: ubiquitous chrome that opens constantly and is not the
 * "unmirrored shared-run screen" concern (per the task: MESSAGE, CONFIRM, menus).
 */
export const COOP_UI_TRIPWIRE_EXEMPT: ReadonlySet<UiMode> = new Set<UiMode>([
  UiMode.MESSAGE,
  UiMode.CONFIRM,
  UiMode.OPTION_SELECT,
  UiMode.MENU,
  UiMode.MENU_OPTION_SELECT,
]);

/** The set of modes classified "mirrored" (snapshotted by the guard test so a reclassification diffs). */
export const COOP_UI_MIRRORED_MODES: ReadonlySet<UiMode> = new Set<UiMode>(
  (Object.keys(COOP_UI_REGISTRY) as unknown[])
    .map(k => Number(k) as UiMode)
    .filter(m => COOP_UI_REGISTRY[m] === "mirrored"),
);

/**
 * Modes whose owner can commit shared run state. Each needs a real public-UI-input -> authoritative carrier
 * journey; merely opening the mode or calling its handler/relay from a harness does not cover it.
 *
 * Most are mirrored semantic screens. CONFIRM and OPTION_SELECT are generic local chrome, but production
 * flows use their callbacks as the final authoritative boundary (for example reward skip and Stormglass),
 * so excluding them would leave real UI-to-relay call chains invisible. COMMAND and FIGHT also commit some
 * battle choices directly; they are not merely navigation screens.
 */
export const COOP_UI_AUTHORITATIVE_COMMIT_MODES: ReadonlySet<UiMode> = new Set<UiMode>([
  UiMode.COMMAND,
  UiMode.FIGHT,
  UiMode.BALL,
  UiMode.TARGET_SELECT,
  UiMode.MODIFIER_SELECT,
  UiMode.PARTY,
  UiMode.SUMMARY,
  UiMode.MYSTERY_ENCOUNTER,
  UiMode.BIOME_SHOP,
  UiMode.COLOSSEUM,
  UiMode.ER_QUIZ,
  UiMode.ER_BARGAIN,
  UiMode.LEARN_MOVE_BATCH,
  UiMode.ER_MAP,
  UiMode.CONFIRM,
  UiMode.OPTION_SELECT,
]);

/** Local-only chrome that can nevertheless be the final callback before an authoritative carrier send. */
export const COOP_UI_LOCAL_AUTHORITATIVE_COMMIT_MODES: ReadonlySet<UiMode> = new Set<UiMode>([
  UiMode.CONFIRM,
  UiMode.OPTION_SELECT,
]);

/** The classification of a mode, or `undefined` only if a runtime out-of-range mode is somehow passed. */
export function coopUiClassOf(mode: UiMode): CoopUiClass | undefined {
  return COOP_UI_REGISTRY[mode];
}

/**
 * The DECISION half of the ui.ts tripwire (pure, so it is unit-testable). Given the target mode and
 * whether the PARTNER currently owns a live shared interaction, returns a warning string when a
 * non-mirrored, non-exempt interactive screen is opening on this client during that partner-owned
 * interaction - the unmirrored-screen pattern - or `null` otherwise. Never blocks; the caller only
 * logs it (coopWarn) on a DEV/staging build.
 */
export function coopUnmirroredTripwireReason(mode: UiMode, partnerOwnsLiveInteraction: boolean): string | null {
  if (!partnerOwnsLiveInteraction) {
    return null;
  }
  if (coopUiClassOf(mode) !== "local-only") {
    return null; // mirrored (wired) modes handle themselves
  }
  if (COOP_UI_TRIPWIRE_EXEMPT.has(mode)) {
    return null; // ubiquitous chrome
  }
  return `possible unmirrored interactive screen during partner-owned interaction (mode=${UiMode[mode]})`;
}
