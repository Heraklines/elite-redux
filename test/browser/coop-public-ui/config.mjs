/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function integer(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function boolean(name, fallback) {
  const raw = process.env[name]?.trim().toLowerCase();
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

function keySequence(name, fallback) {
  const raw = process.env[name]?.trim();
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

function optionalIdentifier(name, maxLength) {
  const value = process.env[name]?.trim();
  if (!value) {
    return null;
  }
  if (value.length > maxLength || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`${name} must contain at most ${maxLength} ASCII letters, digits, underscores, or hyphens`);
  }
  return value;
}

const allowedJourneys = new Set([
  "probe",
  "fresh-wave2",
  "fresh-resume",
  "reverse-resume",
  "faint-replacement",
  "commander-skip",
  "game-over",
  "showdown-battle",
  "resume-scan-isolation",
  "save-mutations",
]);
const allowedSeats = new Set(["host-seat", "guest-seat"]);
const allowedAccountModes = new Set(["login", "register"]);
const allowedDifficulties = new Set(["youngster", "ace", "elite", "hell", "mystery"]);
// "mystery-test" retained for older dispatch inputs; the live picker's semantic id is "mystery".
const allowedDifficultyOptions = new Set(["youngster", "ace", "elite", "hell", "mystery", "mystery-test"]);
const allowedLocales = new Set([
  "en",
  "es-ES",
  "es-419",
  "fr",
  "it",
  "de",
  "zh-Hans",
  "zh-Hant",
  "pt-BR",
  "ko",
  "ja",
  "ca",
  "eu",
  "da",
  "th",
  "tr",
  "ro",
  "ru",
  "id",
  "hi",
  "tl",
  "nb-NO",
  "sv",
  "uk",
]);
const defaultCoopChallengeKeys = [...Array.from({ length: 10 }, () => "ArrowDown"), "ArrowRight", "Space", "Space"];

export function loadConfig() {
  const journey = process.env.COOP_UI_JOURNEY?.trim() || "probe";
  if (!allowedJourneys.has(journey)) {
    throw new Error(`Unknown COOP_UI_JOURNEY=${journey}; expected ${[...allowedJourneys].join(", ")}`);
  }

  const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${journey}`;
  const baseUrl = new URL(required("COOP_UI_BASE_URL"));
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "127.0.0.1" && baseUrl.hostname !== "localhost") {
    throw new Error("COOP_UI_BASE_URL must use HTTPS unless it targets localhost");
  }
  const requesterSeat = process.env.COOP_UI_REQUESTER_SEAT?.trim() || "guest-seat";
  const faintOwnerSeat = process.env.COOP_UI_FAINT_OWNER_SEAT?.trim() || "guest-seat";
  const commanderOwnerSeat = process.env.COOP_UI_COMMANDER_OWNER_SEAT?.trim() || "host-seat";
  const accountMode = process.env.COOP_UI_ACCOUNT_MODE?.trim() || "login";
  const difficultyId = process.env.COOP_UI_DIFFICULTY_ID?.trim() || "ace";
  const difficultyOptionId = process.env.COOP_UI_DIFFICULTY_OPTION_ID?.trim() || difficultyId;
  const hostLocale = process.env.COOP_UI_HOST_LOCALE?.trim() || "en";
  const guestLocale = process.env.COOP_UI_GUEST_LOCALE?.trim() || "en";
  if (!allowedSeats.has(requesterSeat)) {
    throw new Error(`COOP_UI_REQUESTER_SEAT must be one of ${[...allowedSeats].join(", ")}`);
  }
  if (!allowedSeats.has(faintOwnerSeat)) {
    throw new Error(`COOP_UI_FAINT_OWNER_SEAT must be one of ${[...allowedSeats].join(", ")}`);
  }
  if (!allowedSeats.has(commanderOwnerSeat)) {
    throw new Error(`COOP_UI_COMMANDER_OWNER_SEAT must be one of ${[...allowedSeats].join(", ")}`);
  }
  if (!allowedAccountModes.has(accountMode)) {
    throw new Error(`COOP_UI_ACCOUNT_MODE must be one of ${[...allowedAccountModes].join(", ")}`);
  }
  if (!allowedDifficulties.has(difficultyId)) {
    throw new Error(`COOP_UI_DIFFICULTY_ID must be one of ${[...allowedDifficulties].join(", ")}`);
  }
  if (!allowedDifficultyOptions.has(difficultyOptionId)) {
    throw new Error(`COOP_UI_DIFFICULTY_OPTION_ID must be one of ${[...allowedDifficultyOptions].join(", ")}`);
  }
  if (!allowedLocales.has(hostLocale) || !allowedLocales.has(guestLocale)) {
    throw new Error(`COOP_UI_HOST_LOCALE and COOP_UI_GUEST_LOCALE must be one of ${[...allowedLocales].join(", ")}`);
  }

  return {
    root: ROOT,
    runId,
    journey,
    baseUrl: baseUrl.href,
    browserDist: process.env.COOP_UI_BROWSER_DIST?.trim()
      ? resolve(ROOT, process.env.COOP_UI_BROWSER_DIST.trim())
      : null,
    assetDir: resolve(ROOT, process.env.COOP_UI_ASSET_DIR?.trim() || "assets"),
    expectedApiOrigin: process.env.COOP_UI_EXPECTED_API_ORIGIN?.trim() || null,
    expectedSignalOrigin: process.env.COOP_UI_EXPECTED_SIGNAL_ORIGIN?.trim() || null,
    entryContract: process.env.COOP_BROWSER_ENTRY_CONTRACT?.trim() || "public-ui-v1",
    lobbyRoom: optionalIdentifier("COOP_UI_LOBBY_ROOM", 64),
    artifactDir: resolve(ROOT, "dev-logs", "coop-public-ui", runId),
    headless: boolean("COOP_UI_HEADLESS", true),
    chromeTrace: boolean("COOP_UI_CHROME_TRACE", true),
    // Dirty-account fidelity lane: the accounts were pre-seeded full (4 solo saves + 1 divergent
    // remnant in slot 4), so the launch MUST visibly reclaim - and reclaim the remnant FIRST.
    expectReclaim: boolean("COOP_UI_EXPECT_RECLAIM", false),
    bootTimeoutMs: integer("COOP_UI_BOOT_TIMEOUT_MS", 300_000),
    timeoutMs: integer("COOP_UI_TIMEOUT_MS", 120_000),
    actionDelayMs: integer("COOP_UI_ACTION_DELAY_MS", 180),
    settleDelayMs: integer("COOP_UI_SETTLE_DELAY_MS", 750),
    // Optimization brief R1c: pace key input on the game's own input-echo acknowledgment
    // (uiMode/cursor/phase change) instead of the fixed actionDelayMs sleep. When no echo
    // arrives the press falls back to the fixed delay, so the legacy cadence is the floor
    // of robustness, not the ceiling of speed. COOP_UI_INPUT_ACKS=0 restores pure fixed
    // cadence for triage.
    inputAcks: boolean("COOP_UI_INPUT_ACKS", true),
    // Optimization brief R5: per-seat persistent Chromium profile base dir. When set, each
    // seat launches with its own userDataDir under this base (disk-backed HTTP cache that
    // survives page replacement within a job) and account/site storage is sanitized at
    // rig start WITHOUT clearing the HTTP cache. Empty = legacy per-launch temp profile.
    seatProfileBaseDir: process.env.COOP_UI_SEAT_PROFILE_DIR?.trim() || null,
    maxTurns: integer("COOP_UI_MAX_TURNS", 12),
    viewport: {
      width: integer("COOP_UI_VIEWPORT_WIDTH", 1440),
      height: integer("COOP_UI_VIEWPORT_HEIGHT", 900),
    },
    credentials: {
      hostSeat: {
        seat: "host-seat",
        username: required("COOP_UI_HOST_USERNAME"),
        password: required("COOP_UI_HOST_PASSWORD"),
      },
      guestSeat: {
        seat: "guest-seat",
        username: required("COOP_UI_GUEST_USERNAME"),
        password: required("COOP_UI_GUEST_PASSWORD"),
      },
    },
    keys: {
      titleNewGame: {
        hostSeat: keySequence("COOP_UI_HOST_TITLE_NEW_GAME_KEYS", []),
        guestSeat: keySequence("COOP_UI_GUEST_TITLE_NEW_GAME_KEYS", []),
      },
      // The co-op host alone visits challenge selection. Doubles Only is the eleventh row and is
      // mechanically redundant with co-op's mandatory double battles, so selecting it unlocks the
      // public Start bar without turning this baseline journey into a materially different campaign.
      challenge: keySequence("COOP_UI_CHALLENGE_KEYS", defaultCoopChallengeKeys),
      starter: keySequence("COOP_UI_STARTER_KEYS", ["Space", "Space", "Enter", "Space"]),
      // Team confirmation opens a host-only difficulty picker while the guest waits for runConfig.
      // Ace is the normal baseline and sits directly below the default Youngster option.
      difficulty: keySequence("COOP_UI_DIFFICULTY_KEYS", ["ArrowDown", "Space"]),
      battle: keySequence("COOP_UI_BATTLE_KEYS", ["Space", "Space", "Space"]),
      rewardLeave: keySequence("COOP_UI_REWARD_LEAVE_KEYS", ["Backspace", "Space"]),
      replacement: keySequence("COOP_UI_REPLACEMENT_KEYS", ["Space", "Space"]),
    },
    requesterSeat,
    faintOwnerSeat,
    commanderOwnerSeat,
    accountMode,
    difficultyId,
    difficultyOptionId,
    locales: {
      "host-seat": hostLocale,
      "guest-seat": guestLocale,
    },
    allowedConsoleErrors: (process.env.COOP_UI_ALLOWED_CONSOLE_ERRORS ?? "")
      .split("||")
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => new RegExp(value, "u")),
  };
}
