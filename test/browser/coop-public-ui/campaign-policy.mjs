/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Campaign surface policy for the two-client public-UI harness.
 *
 * This is the console-evidence + keypress re-expression of the headless full-run
 * autopilot's between-wave surface policy (scripts/run-scenario.mjs `--to-end` and
 * test/tools/run-scenario.test.ts `dispatchMenu` / `isAutopilotMode` / auto-first).
 * The headless autopilot reads the live UI mode and drives the real handler; here we
 * can only OBSERVE the game's own console output (the `Start Phase <Name>` lines the
 * engine already logs, the sealed CI surface observer's `[coop-browser:surface]`
 * markers, and the `?coopdebug=1` owner/watcher decision lines) and REPLY with pure
 * keyboard input through the harness `press`/`sequence` methods.
 *
 * Nothing here imports game source, inspects a scene, injects a wire message, or
 * chooses on a player's behalf beyond pressing the visible menu keys a human would.
 */

// --- Progress / phase evidence (public console strings the engine already emits) ---

// Owned-slot command surface: command-phase.ts logs "... -> LOCAL UI" for a slot this
// client controls.
export const LOCAL_COMMAND = /CommandPhase .*-> LOCAL UI/u;
// The post-battle reward shop AND the every-10-waves biome market share this phase name
// (biome-shop-phase.ts keeps phaseName "SelectModifierPhase"); they are told apart by
// the surface observer's uiMode and by the coop role markers below.
export const REWARD_PHASE = /Start Phase SelectModifierPhase/u;
export const GUEST_FAINT_PICKER = /guest own-faint picker OPEN/u;
export const HOST_SWITCH_PHASE = /Start Phase SwitchPhase/u;
export const SHARED_SESSION_TERMINAL = /\[coop:runtime\] shared session stopped safely: /u;
export const LAUNCH_SNAPSHOT_ABORT = /launchSnapshotAbort wave=\d+ reason=/u;
export const GAME_OVER_PHASE = /Start Phase GameOverPhase/u;

// Between-wave interactive phases (each is a real `Start Phase <Name>` console line).
const BIOME_PICK_PHASE = /Start Phase SelectBiomePhase/u;
const CROSSROADS_PHASE = /Start Phase ErCrossroadsPhase/u;
const MYSTERY_PHASE = /Start Phase MysteryEncounterPhase/u;
const LEARN_MOVE_PHASE = /Start Phase (?:LearnMovePhase|LearnMoveBatchPhase)/u;
const EGG_LAPSE_PHASE = /Start Phase EggLapsePhase/u;
const ATTEMPT_CAPTURE_PHASE = /Start Phase AttemptCapturePhase/u;

// Per-client coop role markers (?coopdebug=1). The OWNER drives the real menu; the
// WATCHER renders a read-only mirror and must NOT be sent input.
const REWARD_OWNER = /OWNER drives reward screen/u;
const BIOME_SHOP_ROLES = /biome market roles: /u;
const BIOME_SHOP_OWNER = /biome market roles: .*pick=OWNER/u;
const BIOME_PICK_OWNER = /biome pick owner\/watcher decision: .*-> OWNER/u;
const CROSSROADS_OWNER = /crossroads owner\/watcher decision: .*-> OWNER/u;
const ME_HOST_OWNER = /ME owner streamed entry checksum|host streams ME presentation/u;
const LEARN_MOVE_GUEST_OWNER = /guest OWNS this full-moveset mon|guest relays owned-mon forget-pick/u;

// --- env helpers (config.mjs owns the base config; these are campaign-only knobs) ---

function envTrim(name) {
  return process.env[name]?.trim();
}

function envInteger(name, fallback) {
  const raw = envTrim(name);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function envBoolean(name, fallback) {
  const raw = envTrim(name)?.toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  throw new Error(`${name} must be a boolean`);
}

function envKeys(name, fallback) {
  const raw = envTrim(name);
  if (!raw) {
    return fallback;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be a JSON array of Puppeteer key names`, { cause: error });
  }
  if (!Array.isArray(value) || value.some(key => typeof key !== "string" || key.length === 0)) {
    throw new Error(`${name} must be a JSON array of non-empty strings`);
  }
  return value;
}

const allowedRewardModes = new Set(["leave", "pick-first"]);
const allowedModes = new Set(["gating", "shakedown", "nightly"]);
const allowedRenderProfiles = new Set(["animations-on-surface", "animations-skipped-depth"]);

/** Read every campaign-only knob (base gameplay config still comes from loadConfig). */
export function loadCampaignPolicy() {
  const rewardMode = envTrim("COOP_UI_REWARD_MODE") || "leave";
  if (!allowedRewardModes.has(rewardMode)) {
    throw new Error(`COOP_UI_REWARD_MODE must be one of ${[...allowedRewardModes].join(", ")}`);
  }
  const renderProfile = envTrim("COOP_UI_RENDER_PROFILE") || "animations-on-surface";
  if (!allowedRenderProfiles.has(renderProfile)) {
    throw new Error(`COOP_UI_RENDER_PROFILE must be one of ${[...allowedRenderProfiles].join(", ")}`);
  }
  // Run mode gates the loud-fail contract. autoFirst (press-through of an UNKNOWN surface) is
  // ONLY permitted under an explicitly-labelled "shakedown"; in any gating/nightly config an
  // unknown surface is an immediate loud failure and autoFirst is structurally forbidden.
  const mode = envTrim("COOP_UI_CAMPAIGN_MODE") || "gating";
  if (!allowedModes.has(mode)) {
    throw new Error(`COOP_UI_CAMPAIGN_MODE must be one of ${[...allowedModes].join(", ")}`);
  }
  const autoFirstRequested = envBoolean("COOP_UI_AUTO_FIRST", false);
  if (autoFirstRequested && mode !== "shakedown") {
    throw new Error(
      "COOP_UI_AUTO_FIRST is only allowed under COOP_UI_CAMPAIGN_MODE=shakedown; refusing to press through "
        + `unknown surfaces in a "${mode}" run (unknown surface = loud fail).`,
    );
  }
  return {
    mode,
    targetWaves: envInteger("COOP_UI_CAMPAIGN_WAVES", 30),
    // Press-through of an UNKNOWN interactive surface, mirroring the headless `--auto-first`.
    // Gated to shakedown mode above; a gating/nightly run always loud-fails on the unknown.
    autoFirst: autoFirstRequested && mode === "shakedown",
    stallMs: envInteger("COOP_UI_CAMPAIGN_STALL_MS", 8_000),
    rewardMode,
    renderProfile,
    moveAnimationsExpected: renderProfile === "animations-on-surface",
    raiseSpeed: envBoolean("COOP_UI_RAISE_SPEED", true),
    keys: {
      // Drive the in-game Game Speed setting to 10x (Ludicrous) through the REAL Settings
      // UI, once, early in the run - the maintainer's players overwhelmingly play at 10x, so
      // it is the MORE representative default (not an opt-in). Derived from the live menu
      // structure: Title menu is New Game(0)/Load Game(1)/Profile(2)/Settings(3); Game Speed
      // is the first settings row and WRAPS (clamp:false) over values [2,3,4,5,7,10] from the
      // fresh-account default index 1, so exactly 4 RIGHT presses land on index 5 = 10x.
      //   ArrowDown x3 -> Settings ; Space -> open ; ArrowRight x4 -> 10x ; Backspace -> close
      //   ; ArrowUp x3 -> reset the Title cursor to New Game for pairing.
      // Override with COOP_UI_SPEED_KEYS (e.g. "[]" to keep the account's speed unchanged).
      speed: envKeys("COOP_UI_SPEED_KEYS", [
        "ArrowDown",
        "ArrowDown",
        "ArrowDown",
        "Space",
        "ArrowRight",
        "ArrowRight",
        "ArrowRight",
        "ArrowRight",
        "Backspace",
        "ArrowUp",
        "ArrowUp",
        "ArrowUp",
      ]),
      // Re-open Settings after the speed pass, switch from General to Display with the
      // normal R/CYCLE_SHINY binding, and select the Move Animations row (index 5). The
      // campaign then reads the CI observer's actual value and toggles once through the
      // visible row only when it differs from the requested render profile.
      renderProfileOpen: envKeys("COOP_UI_RENDER_PROFILE_OPEN_KEYS", [
        "ArrowDown",
        "ArrowDown",
        "ArrowDown",
        "Space",
        "r",
        "ArrowDown",
        "ArrowDown",
        "ArrowDown",
        "ArrowDown",
        "ArrowDown",
      ]),
      renderProfileToggle: envKeys("COOP_UI_RENDER_PROFILE_TOGGLE_KEYS", ["ArrowRight"]),
      renderProfileClose: envKeys("COOP_UI_RENDER_PROFILE_CLOSE_KEYS", ["Backspace", "ArrowUp", "ArrowUp", "ArrowUp"]),
      // Attack-first: FIGHT -> first move -> confirm target. Same default as the harness.
      battle: envKeys("COOP_UI_BATTLE_KEYS", ["Space", "Space", "Space"]),
      // Fallback when the first move does not resolve the turn (no PP / disabled): reopen
      // FIGHT and cycle to the next move.
      battleFallback: envKeys("COOP_UI_BATTLE_FALLBACK_KEYS", ["Space", "ArrowRight", "Space", "Space"]),
      // Reward shop: CANCEL opens the skip/leave confirm, ACTION confirms it.
      rewardLeave: envKeys("COOP_UI_REWARD_LEAVE_KEYS", ["Backspace", "Space"]),
      // Reward pick-first: go to the rewards row and take the leftmost take-able option.
      rewardPickFirst: envKeys("COOP_UI_REWARD_PICK_FIRST_KEYS", ["Space"]),
      biomeShopLeave: envKeys("COOP_UI_BIOME_SHOP_LEAVE_KEYS", ["Backspace", "Space"]),
      // Biome pick: travel the leftmost/default revealed node (ACTION = travel).
      biomePick: envKeys("COOP_UI_BIOME_PICK_KEYS", ["Space"]),
      // Crossroads: take the first (leftmost) option.
      crossroads: envKeys("COOP_UI_CROSSROADS_KEYS", ["Space"]),
      // Mystery encounter: first safe option (top-left of the 2x2 grid), then advance.
      mystery: envKeys("COOP_UI_MYSTERY_KEYS", ["Space"]),
      // Learn-move prompt: decline (keep the current moveset).
      learnMove: envKeys("COOP_UI_LEARN_MOVE_KEYS", ["Backspace"]),
      // Egg hatch: let it run / dismiss the summary.
      egg: envKeys("COOP_UI_EGG_KEYS", ["Space"]),
      // Catch prompt (party full): skip / decline.
      catchSkip: envKeys("COOP_UI_CATCH_SKIP_KEYS", ["Backspace"]),
    },
  };
}

/**
 * The ordered between-wave surface dispatch table. Each entry names one interactive
 * surface, the public console marker that proves it is up, how to find the OWNER client
 * from console evidence (never parity math), and the keys the owner presses. Order
 * matters: reward is handled before the boundary surfaces it precedes.
 *
 * `v2SurfaceId` is the preferred, evidence-derived owner source: the driver reads the v2
 * semantic mirror (`[coop-browser:surface2]`) and picks the client whose own observation
 * reports it as owner (ownerSeat === its localSeat). `owner` is the fallback used only when
 * no v2 marker is present, one of:
 *   - `{ marker: RegExp }`  the client whose evidence shows this per-client OWNER line;
 *   - `{ role: "host" }`    last-resort role fallback (v2 ownerSeat is preferred over this);
 *   - `{ guestMarker, role }` guest if the guest-owns marker is present, else `role`.
 */
export function buildDispatchTable(policy) {
  return [
    {
      name: "reward",
      phase: REWARD_PHASE,
      // A true reward shop emits a `reward` surface observation; the biome market does
      // not (its uiMode is BIOME_SHOP), so require the reward owner marker to avoid
      // colliding with the biome market that shares the SelectModifierPhase name.
      present: REWARD_OWNER,
      v2SurfaceId: "reward-shop",
      owner: { marker: REWARD_OWNER },
      keys: policy.rewardMode === "pick-first" ? policy.keys.rewardPickFirst : policy.keys.rewardLeave,
    },
    {
      name: "biome-shop",
      phase: BIOME_SHOP_ROLES,
      present: BIOME_SHOP_ROLES,
      v2SurfaceId: "biome-market",
      owner: { marker: BIOME_SHOP_OWNER },
      keys: policy.keys.biomeShopLeave,
    },
    {
      name: "crossroads",
      phase: CROSSROADS_PHASE,
      present: CROSSROADS_OWNER,
      v2SurfaceId: "crossroads",
      owner: { marker: CROSSROADS_OWNER },
      keys: policy.keys.crossroads,
    },
    {
      name: "biome-pick",
      phase: BIOME_PICK_PHASE,
      present: BIOME_PICK_OWNER,
      v2SurfaceId: "biome-select",
      owner: { marker: BIOME_PICK_OWNER },
      keys: policy.keys.biomePick,
    },
    {
      name: "mystery-encounter",
      phase: MYSTERY_PHASE,
      present: MYSTERY_PHASE,
      // Owner derived from the v2 mirror's ownerSeat, never assumed from rig.host; the ME
      // host-owner console marker is the fallback when the v2 mirror is absent.
      v2SurfaceId: "mystery-encounter",
      owner: { marker: ME_HOST_OWNER },
      keys: policy.keys.mystery,
    },
    {
      name: "catch-full",
      phase: ATTEMPT_CAPTURE_PHASE,
      present: ATTEMPT_CAPTURE_PHASE,
      // Party-full catch prompt: skip / decline. Owner is the capturing client (v2 mirror).
      v2SurfaceId: "catch-full:confirm",
      owner: { role: "host" },
      keys: policy.keys.catchSkip,
    },
    {
      name: "learn-move",
      phase: LEARN_MOVE_PHASE,
      present: LEARN_MOVE_PHASE,
      v2SurfaceId: "learn-move-batch",
      owner: { guestMarker: LEARN_MOVE_GUEST_OWNER, role: "host" },
      keys: policy.keys.learnMove,
    },
    {
      name: "egg",
      phase: EGG_LAPSE_PHASE,
      present: EGG_LAPSE_PHASE,
      // Egg lapse renders on both clients; owner derived from the v2 mirror.
      v2SurfaceId: "egg:lapse",
      owner: { role: "host" },
      keys: policy.keys.egg,
    },
  ];
}

export { ME_HOST_OWNER };
