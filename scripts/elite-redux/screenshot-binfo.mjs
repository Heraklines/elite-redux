#!/usr/bin/env node
// =============================================================================
// Battle-Info overlay screenshot driver.
//
// Boots pokerogue, waits for the dev-tools bridge (window.dev — installed in
// dev builds ~20s after load, once the heavy ER data registration finishes),
// jumps straight into a battle via dev.battle(), opens the in-battle Info
// screen (Stats key = "C"), and captures every page by cycling Right.
//
// The boot is slow and the page polls a local account server, so `networkidle`
// never fires — we use domcontentloaded + explicit polling for window.dev and
// for the live phase name (read through dev.scene.phaseManager).
//
// Usage:  node scripts/elite-redux/screenshot-binfo.mjs [url]
// =============================================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const baseUrl = process.argv[2] ?? "http://localhost:5173/";
const outDir = "docs/screenshots";
mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--no-sandbox",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on("pageerror", e => console.log("[pageerror]", e.message));
page.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !t.includes("404") && !t.includes("ERR_CONNECTION")) {
    console.log("[console.error]", t.slice(0, 200));
  }
});

const snap = async name => {
  const buf = await page.screenshot({ type: "png" });
  writeFileSync(join(outDir, name), buf);
  console.log(`[snap] ${name} (${buf.length} bytes)`);
};
const press = async (key, delay = 250) => {
  await page.keyboard.down(key);
  await sleep(60);
  await page.keyboard.up(key);
  await sleep(delay);
};
const phaseName = () =>
  page.evaluate(() => {
    try {
      return window.dev?.scene?.phaseManager?.getCurrentPhase?.()?.constructor?.name ?? null;
    } catch {
      return null;
    }
  });

/** Advance with Space until the named phase appears (or timeout). */
async function waitForPhase(target, { timeout = 45000, pressSpace = false } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = await phaseName();
    if (p === target) {
      return true;
    }
    if (pressSpace) {
      await press("Space", 350);
    } else {
      await sleep(500);
    }
  }
  return false;
}

/**
 * Drive the battle to CommandPhase: nudge only message-like phases with Space
 * (the "wild X appeared" text), but wait PASSIVELY through summon/switch
 * animations so we don't overshoot into a submenu.
 */
async function reachCommand(timeout = 70000) {
  const t0 = Date.now();
  let lastPhase = null;
  while (Date.now() - t0 < timeout) {
    const p = await phaseName();
    if (p !== lastPhase) {
      console.log("  phase →", p);
      lastPhase = p;
    }
    if (p === "CommandPhase") {
      return true;
    }
    if (p === "CheckSwitchPhase") {
      // "Switch your Pokémon?" → answer No (Cancel = Backspace).
      await press("Backspace", 650);
    } else if (p === "EncounterPhase" || (p && p.includes("Message"))) {
      await press("Space", 650);
    } else {
      await sleep(650);
    }
  }
  return false;
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for the dev bridge (heavy ER registration → ~20s).
  await page.waitForFunction("typeof window.dev !== 'undefined' && !!window.dev.scene", { timeout: 90_000 });
  console.log("[boot] dev bridge ready, phase =", await phaseName());

  // NOTE: window.dev installs during the LoadingScene (it's ready well before the
  // game is). The loading screen streams ~800 ER icons → slow under swiftshader,
  // so gameData/phases only exist after it reaches 100%. dev.battle() builds
  // PlayerPokemon which reads gameData.trainerId, so wait for that (up to ~2min),
  // nudging Space to dismiss the splash/disclaimer/title once loaded.
  const gameDataReady = () => page.evaluate(() => window.dev?.scene?.gameData?.trainerId != null);
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) {
    ready = await gameDataReady();
    if (!ready) {
      await press("Space", 800);
    }
  }
  console.log("[boot] gameData ready:", ready, "phase =", await phaseName());
  if (!ready) {
    throw new Error("gameData never initialised (loading stalled?)");
  }

  // Reach a clean TitlePhase before dev.battle(). On a fresh save this passes
  // through the first-run SelectGenderPhase (Space confirms the default).
  const onTitle = await waitForPhase("TitlePhase", { timeout: 60_000, pressSpace: true });
  console.log("[boot] TitlePhase reached:", onTitle, "phase =", await phaseName());
  await sleep(800);

  // Jump into a Classic battle with a full, varied party + a chosen foe.
  await page.evaluate(() => {
    window.dev.battle({
      player: ["VENUSAUR", "CHARIZARD", "BLASTOISE", "PIKACHU", "GENGAR", "DRAGONITE"],
      enemy: "GYARADOS",
      enemyLevel: 50,
      level: 50,
    });
  });

  // CRITICAL: do NOT press any key until initBattle's async asset-load has set
  // currentBattle — pressing Space ends TitlePhase early and runs EncounterPhase
  // before the battle exists (→ "waveIndex of null" crash). Poll passively.
  const battleReady = await page.waitForFunction("!!window.dev?.scene?.currentBattle", { timeout: 60_000 }).then(
    () => true,
    () => false,
  );
  console.log("[battle] currentBattle ready:", battleReady);

  // dev.battle starters skip starter-select, so they have no moveset — generate
  // one so the Moves page shows real data (real gameplay mons always have moves).
  await page.evaluate(() => {
    for (const p of window.dev.scene.getPlayerParty()) {
      if (!p.getMoveset().some(Boolean)) {
        p.generateAndPopulateMoveset();
      }
    }
  });

  // Now gently advance encounter dialogs until the command menu is up.
  const reached = await reachCommand();
  console.log("[battle] CommandPhase reached:", reached, "phase =", await phaseName());
  await sleep(800);
  await snap("binfo-00-command.png");

  // Open the Info overlay (Stats key = C).
  await press("c", 900);
  await snap("binfo-01-stats.png");

  const pages = ["abilities", "moves", "field", "side-player", "side-enemy"];
  for (let i = 0; i < pages.length; i++) {
    await press("ArrowRight", 700);
    await snap(`binfo-0${i + 2}-${pages[i]}.png`);
  }

  // Verify icon switching: go back to stats, switch inspected mon (Down).
  await press("ArrowRight", 500);
  await press("ArrowDown", 700);
  await snap("binfo-08-stats-foe.png");
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
  await snap("binfo-99-error.png");
} finally {
  await browser.close();
}
