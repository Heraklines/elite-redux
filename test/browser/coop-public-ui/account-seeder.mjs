/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// DIRTY-ACCOUNT SEEDER (harness post-mortem, 2026-07-17).
//
// Every CI campaign registers PRISTINE accounts, so the whole account-state bug
// class - full save slots, divergent/unparseable co-op remnants, reclaim
// ranking, guest checkpoint no-safe-slot - was structurally invisible to every
// lane while it broke live pairs four times in one evening. This module seeds
// REAL registered accounts with the live failure shape BEFORE the browsers log
// in (ordering is load-bearing: the browser login must be the LAST login so its
// clientSessionId is the active one and the run never sees "session out of
// date"):
//   slots 0-3: valid solo sessions with STAGGERED timestamps (slot 0 oldest)
//   slot 4:    an unparseable cloud blob - the quarantined/divergent remnant
//              class, which the reclaim ranking must consume FIRST.
//
// CLI (used by the dirty-account campaign profile):
//   node account-seeder.mjs --api-origin <url> --emit-env
// registers host+guest accounts, seeds both, and prints GITHUB_ENV lines
// (COOP_UI_HOST_USERNAME/... + COOP_UI_ACCOUNT_MODE=login).
// =============================================================================

import { randomBytes } from "node:crypto";

/** One minimal-but-parseable SOLO session (the game's parseSessionData reviver is tolerant). */
export function soloSessionJson({ seed, timestamp, waveIndex }) {
  return JSON.stringify({
    seed,
    playTime: 60,
    gameMode: 0,
    gameVersion: "1.9.0",
    timestamp,
    waveIndex,
    money: 1000,
    score: 0,
    party: [
      {
        id: 1000 + waveIndex,
        player: true,
        species: 1,
        formIndex: 0,
        abilityIndex: 0,
        passive: false,
        shiny: false,
        variant: 0,
        pokeball: 0,
        level: 5,
        exp: 125,
        levelExp: 0,
        gender: 0,
        hp: 19,
        stats: [19, 9, 9, 11, 11, 9],
        ivs: [10, 10, 10, 10, 10, 10],
        nature: 0,
        moveset: [{ moveId: 33, ppUsed: 0, ppUp: 0 }],
        status: null,
        friendship: 70,
        metLevel: 5,
        metBiome: 0,
        metSpecies: 1,
        metWave: 1,
        luck: 0,
        pauseEvolutions: false,
        pokerus: false,
        usedTMs: [],
        evoCounter: 0,
        teraType: 0,
        isTerastallized: false,
        stellarTypesBoosted: [],
        fusionSpecies: null,
        boss: false,
        bossSegments: 0,
        summonData: null,
        battleData: null,
        customPokemonData: null,
        fusionCustomPokemonData: null,
        nickname: null,
      },
    ],
    enemyParty: [],
    modifiers: [],
    enemyModifiers: [],
    arena: { biome: 0, weather: null, terrain: null, tags: [], playerTerasUsed: 0 },
    pokeballCounts: { 0: 5, 1: 0, 2: 0, 3: 0, 4: 0 },
    battleType: 0,
    trainer: null,
    mysteryEncounterType: -1,
    mysteryEncounterSaveData: null,
    challenges: [],
  });
}

/** The unparseable divergent-remnant blob for slot 4 (quarantine + garbage-first reclaim class). */
export function divergentRemnantBlob() {
  return "not-json{{divergent-coop-remnant##";
}

async function apiPost(apiOrigin, path, { token = null, form = null, body = null } = {}) {
  const headers = {};
  if (token != null) {
    headers.authorization = token;
  }
  let payload = body;
  if (form != null) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  }
  const response = await fetch(`${apiOrigin}${path}`, { method: "POST", headers, body: payload });
  return response;
}

export async function registerAccount(apiOrigin, username, password) {
  const response = await apiPost(apiOrigin, "/account/register", { form: { username, password } });
  if (!response.ok) {
    throw new Error(`register ${username} failed: ${response.status} ${await response.text()}`);
  }
}

export async function loginForToken(apiOrigin, username, password) {
  const response = await apiPost(apiOrigin, "/account/login", { form: { username, password } });
  if (!response.ok) {
    throw new Error(`login ${username} failed: ${response.status} ${await response.text()}`);
  }
  const { token } = await response.json();
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`login ${username} returned no token`);
  }
  return token;
}

/** Seed the five-slot dirty layout onto one account. Returns the per-slot verdicts for evidence. */
export async function seedDirtySlots(apiOrigin, token, clientSessionId) {
  const now = Date.now();
  const seeded = [];
  for (let slot = 0; slot < 4; slot++) {
    // slot 0 is the OLDEST healthy save (the second-choice reclaim target); newer upward.
    const timestamp = now - (7 - slot) * 24 * 60 * 60 * 1000;
    const body = soloSessionJson({ seed: `dirty-seed-${slot}`, timestamp, waveIndex: 10 + slot });
    const response = await apiPost(
      apiOrigin,
      `/savedata/session/update?slot=${slot}&clientSessionId=${clientSessionId}`,
      { token, body },
    );
    if (!response.ok) {
      throw new Error(`seed slot ${slot} failed: ${response.status} ${await response.text()}`);
    }
    seeded.push({ slot, kind: "solo", timestamp });
  }
  const remnant = await apiPost(apiOrigin, `/savedata/session/update?slot=4&clientSessionId=${clientSessionId}`, {
    token,
    body: divergentRemnantBlob(),
  });
  if (!remnant.ok) {
    throw new Error(`seed remnant slot 4 failed: ${remnant.status} ${await remnant.text()}`);
  }
  seeded.push({ slot: 4, kind: "divergent-remnant" });
  return seeded;
}

export async function seedDirtyAccount(apiOrigin, { username, password }) {
  await registerAccount(apiOrigin, username, password);
  const token = await loginForToken(apiOrigin, username, password);
  const clientSessionId = randomBytes(16).toString("hex");
  return await seedDirtySlots(apiOrigin, token, clientSessionId);
}

const invokedDirectly = process.argv[1]?.endsWith("account-seeder.mjs") === true;
if (invokedDirectly) {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--")) {
      const next = process.argv[i + 1];
      if (next != null && !next.startsWith("--")) {
        args.set(arg.slice(2), next);
        i++;
      } else {
        args.set(arg.slice(2), "1");
      }
    }
  }
  const apiOrigin = args.get("api-origin");
  if (!apiOrigin) {
    console.error("usage: node account-seeder.mjs --api-origin <url> [--emit-env]");
    process.exit(2);
  }
  const stamp = Date.now().toString(36);
  const accounts = {
    host: { username: `dirtyh${stamp}${randomBytes(3).toString("hex")}`, password: randomBytes(12).toString("hex") },
    guest: { username: `dirtyg${stamp}${randomBytes(3).toString("hex")}`, password: randomBytes(12).toString("hex") },
  };
  try {
    const hostSeeded = await seedDirtyAccount(apiOrigin, accounts.host);
    const guestSeeded = await seedDirtyAccount(apiOrigin, accounts.guest);
    console.error(
      `[account-seeder] seeded host=${accounts.host.username} guest=${accounts.guest.username} `
        + `layout=${JSON.stringify(hostSeeded.map(s => `${s.slot}:${s.kind}`))} guestLayout=${JSON.stringify(guestSeeded.map(s => `${s.slot}:${s.kind}`))}`,
    );
    if (args.has("emit-env")) {
      console.log(`COOP_UI_HOST_USERNAME=${accounts.host.username}`);
      console.log(`COOP_UI_HOST_PASSWORD=${accounts.host.password}`);
      console.log(`COOP_UI_GUEST_USERNAME=${accounts.guest.username}`);
      console.log(`COOP_UI_GUEST_PASSWORD=${accounts.guest.password}`);
      console.log("COOP_UI_ACCOUNT_MODE=login");
      console.log("COOP_UI_EXPECT_RECLAIM=1");
    }
  } catch (error) {
    console.error(`[account-seeder] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
