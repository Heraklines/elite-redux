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
const LEARN_MOVE_CONFIRM_PHASE = /Start Phase LearnMovePhase/u;
const LEARN_MOVE_BATCH_PHASE = /Start Phase LearnMoveBatchPhase/u;
const EGG_LAPSE_PHASE = /Start Phase EggLapsePhase/u;
const ATTEMPT_CAPTURE_PHASE = /Start Phase AttemptCapturePhase/u;
const REVIVAL_PHASE = /Start Phase (?:RevivalBlessingPhase|CoopGuestRevivalPhase)/u;
const STORMGLASS_PHASE = /Start Phase ErStormglassPickerPhase/u;
const SCAN_IVS_PHASE = /Start Phase ScanIvsPhase/u;

/**
 * Every registered Authority V2 ability workflow and each human-input shape it can expose.
 * The watcher intentionally renders a MESSAGE shell while the owner moves through these surfaces;
 * campaign.mjs proves that asymmetric projection before sending any public key.
 */
export const ABILITY_INTERACTION_SURFACES = Object.freeze([
  { phase: "ErAbilityCapsulePhase", kinds: ["option", "party", "message"] },
  { phase: "ErGreaterAbilityCapsulePhase", kinds: ["option", "party", "message"] },
  { phase: "ErGreaterAbilityRandomizerPhase", kinds: ["party", "choice", "message"] },
  { phase: "ErDexNavPhase", kinds: ["option", "message"] },
]);

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
const allowedMarketModes = new Set(["leave", "target-held"]);
const allowedModes = new Set(["gating", "shakedown", "nightly"]);
const allowedRenderProfiles = new Set(["animations-on-surface", "animations-skipped-depth", "mystery-gauntlet"]);
const allowedGameSpeeds = new Set([2, 3, 4, 5, 7, 10]);
const allowedPartyRewardIds = new Set([
  "TM_CASE",
  "ER_LEARNERS_SHROOM",
  "MEMORY_MUSHROOM",
  "TM_COMMON",
  "TM_GREAT",
  "TM_ULTRA",
  "ER_ABILITY_CAPSULE",
  "ER_GREATER_ABILITY_CAPSULE",
  "ER_GREATER_ABILITY_RANDOMIZER",
  "ABILITY_RANDOMIZER",
  "MOVE_SLOT_EXPANDER",
  "PP_UP",
  "PP_MAX",
  "ETHER",
  "MAX_ETHER",
  "ELIXIR",
  "MAX_ELIXIR",
  "MINT",
  "TERA_SHARD",
  "RARE_CANDY",
  "RARER_CANDY",
  "POTION",
  "SUPER_POTION",
  "HYPER_POTION",
  "MAX_POTION",
  "FULL_RESTORE",
  "REVIVE",
  "MAX_REVIVE",
  "FULL_HEAL",
  "SACRED_ASH",
  "EVOLUTION_ITEM",
  "RARE_EVOLUTION_ITEM",
  "FORM_CHANGE_ITEM",
  "RARE_FORM_CHANGE_ITEM",
  "DNA_SPLICERS",
  "ER_DEX_NAV",
]);
const partyRewardLearnMoveIds = new Set([
  "TM_CASE",
  "ER_LEARNERS_SHROOM",
  "MEMORY_MUSHROOM",
  "TM_COMMON",
  "TM_GREAT",
  "TM_ULTRA",
]);
const directPartyRewardIds = new Set(["RARER_CANDY", "SACRED_ASH"]);
const nestedDirectRewardIds = new Set(["ER_DEX_NAV"]);

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
  const marketMode = envTrim("COOP_UI_MARKET_MODE") || "leave";
  if (!allowedMarketModes.has(marketMode)) {
    throw new Error(`COOP_UI_MARKET_MODE must be one of ${[...allowedMarketModes].join(", ")}`);
  }
  const marketTargetId = envTrim("COOP_UI_MARKET_TARGET_ID") || "WIDE_LENS";
  if (!/^[A-Z0-9_]+$/u.test(marketTargetId)) {
    throw new Error("COOP_UI_MARKET_TARGET_ID must be a stable uppercase modifier id");
  }
  const targetWaves = envInteger("COOP_UI_CAMPAIGN_WAVES", 30);
  const mysteryRequired = envBoolean("COOP_UI_REQUIRE_MYSTERY_GAUNTLET", false);
  const registeredInteractionsRequired = envBoolean("COOP_UI_REQUIRE_REGISTERED_INTERACTIONS", false);
  const abilityCapsuleRequired = envBoolean("COOP_UI_REQUIRE_ABILITY_CAPSULE", false);
  const partyRewardId = envTrim("COOP_UI_PARTY_REWARD_ID") || null;
  if (partyRewardId != null && !allowedPartyRewardIds.has(partyRewardId)) {
    throw new Error(`COOP_UI_PARTY_REWARD_ID must be one of ${[...allowedPartyRewardIds].join(", ")}`);
  }
  const navigationRequired = envBoolean("COOP_UI_REQUIRE_NAVIGATION_DEPTH", false);
  const crossroadsRoute = envKeys("COOP_UI_CROSSROADS_ROUTE", ["stay", "leave", "stay", "leave"]);
  if (crossroadsRoute.length === 0 || crossroadsRoute.some(choice => choice !== "stay" && choice !== "leave")) {
    throw new Error("COOP_UI_CROSSROADS_ROUTE must be a non-empty JSON array containing only stay or leave");
  }
  const gameSpeed = envInteger("COOP_UI_GAME_SPEED", 10);
  if (!allowedGameSpeeds.has(gameSpeed)) {
    throw new Error(`COOP_UI_GAME_SPEED must be one of ${[...allowedGameSpeeds].join(", ")}`);
  }
  return {
    mode,
    targetWaves,
    // A Mystery option may insert a battle without advancing its game-wave address. Keep actual
    // wave coverage separate from this finite runaway guard so ten waves are not capped at ten battles.
    maxBattleLoops: envInteger(
      "COOP_UI_MAX_BATTLE_LOOPS",
      mysteryRequired ? Math.max(30, targetWaves * 3) : targetWaves,
    ),
    mysteryGauntlet: {
      required: mysteryRequired,
      minSurfaces: envInteger("COOP_UI_MYSTERY_MIN_SURFACES", 6),
    },
    registeredInteractions: {
      required: registeredInteractionsRequired,
      // The exact registered-interaction fixture uses this to choose Revival Blessing as soon as
      // its user replaces the deterministic self-faint. Zero keeps ordinary campaign move policy.
      preferredMoveId: envInteger("COOP_UI_PREFERRED_MOVE_ID", 0) || null,
    },
    abilityCapsule: {
      required: abilityCapsuleRequired,
      inspectSummary: envBoolean("COOP_UI_REWARD_INSPECT_SUMMARY", false),
    },
    partyMutatingReward: {
      required: partyRewardId != null,
      rewardId: partyRewardId,
      // The Greater Ability Randomizer live report entered Check Team from this exact reward
      // and reordered an active mon. Make that UI -> relay -> party -> field-presentation path
      // mandatory in its real two-browser journey instead of proving only the reward itself.
      checkTeamReorder: partyRewardId === "ER_GREATER_ABILITY_RANDOMIZER",
      acceptLearnMove: partyRewardId != null && partyRewardLearnMoveIds.has(partyRewardId),
      direct:
        partyRewardId != null && (directPartyRewardIds.has(partyRewardId) || nestedDirectRewardIds.has(partyRewardId)),
      nestedDirect: partyRewardId != null && nestedDirectRewardIds.has(partyRewardId),
    },
    navigation: {
      required: navigationRequired,
      crossroadsRoute,
    },
    // Press-through of an UNKNOWN interactive surface, mirroring the headless `--auto-first`.
    // Gated to shakedown mode above; a gating/nightly run always loud-fails on the unknown.
    autoFirst: autoFirstRequested && mode === "shakedown",
    stallMs: envInteger("COOP_UI_CAMPAIGN_STALL_MS", 8_000),
    rewardMode,
    rewardTargetSlot: envInteger("COOP_UI_REWARD_PARTY_SLOT", 0),
    market: {
      mode: marketMode,
      targetId: marketTargetId,
      partySlot: envInteger("COOP_UI_MARKET_PARTY_SLOT", 0),
      secondPurchase: envBoolean("COOP_UI_MARKET_SECOND_PURCHASE", true),
      requiredPurchases: envInteger("COOP_UI_MARKET_REQUIRED_PURCHASES", 0),
      requireBothOwnerSeats: envBoolean("COOP_UI_MARKET_REQUIRE_BOTH_OWNER_SEATS", false),
    },
    renderProfile,
    moveAnimationsExpected: renderProfile === "animations-on-surface",
    raiseSpeed: envBoolean("COOP_UI_RAISE_SPEED", true),
    gameSpeed,
    keys: {
      // Drive the in-game Game Speed setting through the REAL Settings UI once, early in the
      // run. The default remains the player-representative 10x, while COOP_UI_GAME_SPEED lets
      // remote benchmarks measure whether a lower value completes sooner under SwiftShader.
      // Derived from the live menu
      // structure: Title menu is New Game(0)/Load Game(1)/Profile(2)/Settings(3); Game Speed
      // is the first settings row and WRAPS (clamp:false) over values [2,3,4,5,7,10] from the
      // fresh-account default index 1, so exactly 4 RIGHT presses land on index 5 = 10x.
      //   ArrowDown x3 -> Settings ; Space -> open ; ArrowRight x4 -> 10x ; Backspace -> close
      //   ; ArrowUp x3 -> reset the Title cursor to New Game for pairing.
      // Override with COOP_UI_SPEED_KEYS (e.g. "[]" to keep the account's speed unchanged).
      // NB: when the env is UNSET the campaign now navigates observation-gated (each press
      // verified against the surface observer with bounded retries) and this default list
      // is only the key VOCABULARY reference; a NON-EMPTY env override replays that exact
      // sequence blind (maintainer escape hatch), "[]" still skips the speed raise.
      speedKeysFromEnv: (process.env.COOP_UI_SPEED_KEYS ?? "").trim().length > 0,
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
      // The default close only leaves Display Settings. `configureRenderProfile` then
      // observes the freshly installed Title surface and navigates to New Game by stable
      // option id. Blind trailing arrows could still be draining when lobby navigation
      // began, moving the cursor from New Game to Load Game on a CPU-dilated runner.
      // A non-empty override remains an exact diagnostic/reproduction sequence.
      renderProfileCloseKeysFromEnv: (process.env.COOP_UI_RENDER_PROFILE_CLOSE_KEYS ?? "").trim().length > 0,
      renderProfileClose: envKeys("COOP_UI_RENDER_PROFILE_CLOSE_KEYS", ["Backspace"]),
      // A non-empty override preserves exact diagnostic/reproduction sequences. Without one,
      // the campaign opens FIGHT, reads the visible usable moves, and navigates to the strongest
      // damaging option through public keys; the array remains the explicit-override payload.
      battleKeysFromEnv: (process.env.COOP_UI_BATTLE_KEYS ?? "").trim().length > 0,
      battle: envKeys("COOP_UI_BATTLE_KEYS", ["Space", "Space", "Space"]),
      // Fallback when the first move does not resolve the turn (no PP / disabled): reopen
      // FIGHT and cycle to the next move.
      battleFallback: envKeys("COOP_UI_BATTLE_FALLBACK_KEYS", ["Space", "ArrowRight", "Space", "Space"]),
      // Reward shop: CANCEL opens the skip/leave confirm, ACTION confirms it.
      rewardLeave: envKeys("COOP_UI_REWARD_LEAVE_KEYS", ["Backspace", "Space"]),
      // Historical mode name retained for workflow compatibility. The campaign driver semantically
      // chooses the best visible survival option; this key submits it when it is already selected.
      rewardPickFirst: envKeys("COOP_UI_REWARD_PICK_FIRST_KEYS", ["Space"]),
      biomeShopLeave: envKeys("COOP_UI_BIOME_SHOP_LEAVE_KEYS", ["Backspace", "Space"]),
      // Biome pick: travel the leftmost/default revealed node (ACTION = travel).
      biomePick: envKeys("COOP_UI_BIOME_PICK_KEYS", ["Space"]),
      // Crossroads: take the first (leftmost) option.
      crossroads: envKeys("COOP_UI_CROSSROADS_KEYS", ["Space"]),
      // Mystery encounter: normal campaigns take the first enabled option. The dedicated
      // coverage gauntlet takes the last enabled option, which is the explicit leave/bank path
      // on press-your-luck events; otherwise a fresh-account test can die to optional combat
      // before reaching the later trainer, boss, bargain, and terminal surfaces it exists to prove.
      mystery: envKeys("COOP_UI_MYSTERY_KEYS", ["Space"]),
      // The ten-wave continuity profile proves Bargain ownership + terminal convergence by visibly
      // declining the offer. Accepting a Sin opens deeper party/ability surfaces covered elsewhere.
      bargainLeave: envKeys("COOP_UI_BARGAIN_LEAVE_KEYS", ["Backspace"]),
      // Learn-move prompt: decline (keep the current moveset).
      learnMove: envKeys("COOP_UI_LEARN_MOVE_KEYS", ["Backspace"]),
      // Egg hatch: let it run / dismiss the summary.
      egg: envKeys("COOP_UI_EGG_KEYS", ["Space"]),
      // Authority V2 ability pickers are state-aware below. This is only the normal public submit key;
      // party/option navigation is derived from the semantic observer rather than a blind macro.
      ability: envKeys("COOP_UI_ABILITY_KEYS", ["Space"]),
      // Revival is a two-level PARTY picker (fainted slot, then REVIVE). The state-aware
      // campaign driver uses this only as the final public submit key.
      revival: envKeys("COOP_UI_REVIVAL_KEYS", ["Space"]),
      // Stormglass first advances its owner-only prompt, then submits one visible weather.
      stormglass: envKeys("COOP_UI_STORMGLASS_KEYS", ["Space"]),
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
  const abilityDrivers = ABILITY_INTERACTION_SURFACES.flatMap(({ phase, kinds }) =>
    kinds.map(kind => ({
      name: `ability-${phase
        .replace(/^Er|Phase$/gu, "")
        .replaceAll(/([a-z])([A-Z])/gu, "$1-$2")
        .toLowerCase()}-${kind}`,
      phase: new RegExp(`Start Phase ${phase}`, "u"),
      present: new RegExp(`Start Phase ${phase}`, "u"),
      v2SurfaceId: `ability:${phase}:${kind}`,
      semanticOnly: true,
      abilitySurface: true,
      abilitySurfaceKind: kind,
      abilityPhase: phase,
      owner: { role: "host" },
      keys: policy.keys.ability,
    })),
  );
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
      confirmSurfaceId: policy.rewardMode === "pick-first" ? null : "reward:confirm",
    },
    {
      name: "reward-target",
      phase: REWARD_PHASE,
      present: REWARD_PHASE,
      v2SurfaceId: "party:reward-target",
      semanticOnly: true,
      owner: { marker: REWARD_OWNER },
      keys: [],
      partySlot: policy.rewardTargetSlot,
      forcePartySlot: policy.partyMutatingReward.required,
      inspectSummary: policy.abilityCapsule.inspectSummary,
    },
    {
      name: "biome-shop",
      phase: BIOME_SHOP_ROLES,
      present: BIOME_SHOP_ROLES,
      v2SurfaceId: "biome-market",
      owner: { marker: BIOME_SHOP_OWNER },
      keys: policy.keys.biomeShopLeave,
      market: policy.market,
      confirmSurfaceId: policy.market?.mode === "target-held" ? null : "confirm:BiomeShopPhase",
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
      v2SurfaceId: "world-map",
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
      // The long-running depth lane is proving progression/survivability, not press-your-luck
      // Mystery combat. Prefer the final enabled option there (as the Mystery gauntlet already
      // does), which is ordinarily the lower-risk leave/support branch. Keep the animation-surface
      // lane on option zero so embedded Mystery battles remain covered by a distinct profile.
      preferLastEnabledOption: policy.mysteryGauntlet.required || policy.renderProfile === "animations-skipped-depth",
    },
    {
      name: "mystery-subprompt",
      phase: MYSTERY_PHASE,
      present: MYSTERY_PHASE,
      v2SurfaceId: "mystery-encounter:prompt",
      semanticOnly: true,
      owner: { marker: ME_HOST_OWNER },
      keys: policy.keys.mystery,
    },
    {
      name: "mystery-quiz",
      phase: MYSTERY_PHASE,
      present: MYSTERY_PHASE,
      v2SurfaceId: "quiz",
      semanticOnly: true,
      owner: { marker: ME_HOST_OWNER },
      keys: policy.keys.mystery,
    },
    {
      name: "mystery-bargain",
      phase: MYSTERY_PHASE,
      present: MYSTERY_PHASE,
      v2SurfaceId: "bargain",
      semanticOnly: true,
      owner: { marker: ME_HOST_OWNER },
      keys: policy.keys.bargainLeave,
    },
    {
      name: "mystery-colosseum",
      phase: MYSTERY_PHASE,
      present: MYSTERY_PHASE,
      v2SurfaceId: "colosseum",
      semanticOnly: true,
      owner: { marker: ME_HOST_OWNER },
      keys: policy.keys.mystery,
    },
    {
      // A `selectPokemonForOption` ME (e.g. PART_TIMER, ME type 21) opens a PARTY sub-prompt on the
      // OWNER client only (the watcher never renders it). It projects as the plain `party` surface
      // with ownerModel "local" / ownerSeat null, so the generic v2 semantic-owner path can never
      // resolve it; the `mysteryParty` path owns it (findOwnedActionableMysteryPartySurface +
      // driveMysteryPartyPicker), picking a legal slot via the same semantic-surface + generation-
      // keyed navigation the faint picker uses. Owner-seat only; inert outside an ME context
      // (the finder gates on mysteryEncounterType). v2SurfaceId keys the post-drive suppression by
      // semantic identity so a driven pick is not re-driven. (Track R cycle-11: a guest-owned
      // PART_TIMER party sub-prompt had no driver and stalled the mystery lane, run 29654429335.)
      name: "mystery-party",
      phase: MYSTERY_PHASE,
      present: MYSTERY_PHASE,
      mysteryParty: true,
      v2SurfaceId: "party",
      owner: { marker: ME_HOST_OWNER },
      keys: policy.keys.mystery,
    },
    {
      // Renderer-only: each browser dismisses its own IV scanner prompt. This is deliberately not
      // routed through the alternating interaction-owner model and never commits shared mechanics.
      name: "iv-scanner",
      phase: SCAN_IVS_PHASE,
      present: SCAN_IVS_PHASE,
      v2SurfaceId: "confirm:ScanIvsPhase",
      semanticOnly: true,
      localPerClientSurface: true,
      owner: { role: "host" },
      keys: [],
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
      name: "revival",
      phase: REVIVAL_PHASE,
      present: REVIVAL_PHASE,
      v2SurfaceId: "revival:party",
      semanticOnly: true,
      asymmetricSurface: "revival",
      watcherSurfaceId: "revival:party",
      owner: { role: "host" },
      keys: policy.keys.revival,
    },
    {
      name: "stormglass-message",
      phase: STORMGLASS_PHASE,
      present: STORMGLASS_PHASE,
      v2SurfaceId: "stormglass:message",
      semanticOnly: true,
      asymmetricSurface: "stormglass",
      watcherSurfaceId: "stormglass:message",
      stormglassSurfaceKind: "message",
      owner: { role: "host" },
      keys: policy.keys.stormglass,
    },
    {
      name: "stormglass-option",
      phase: STORMGLASS_PHASE,
      present: STORMGLASS_PHASE,
      v2SurfaceId: "stormglass:option",
      semanticOnly: true,
      asymmetricSurface: "stormglass",
      watcherSurfaceId: "stormglass:message",
      stormglassSurfaceKind: "option",
      owner: { role: "host" },
      keys: policy.keys.stormglass,
    },
    ...abilityDrivers,
    {
      name: "learn-move-confirm",
      phase: LEARN_MOVE_CONFIRM_PHASE,
      present: LEARN_MOVE_CONFIRM_PHASE,
      v2SurfaceId: "learn-move:confirm",
      owner: { guestMarker: LEARN_MOVE_GUEST_OWNER, role: "host" },
      keys: policy.keys.learnMove,
    },
    {
      name: "learn-move-batch",
      phase: LEARN_MOVE_BATCH_PHASE,
      present: LEARN_MOVE_BATCH_PHASE,
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
