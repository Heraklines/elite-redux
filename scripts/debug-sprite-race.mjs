#!/usr/bin/env node
// Debug the sprite-race bug by driving the browser via Puppeteer.
// Launches Chromium, navigates to localhost:8000, captures console logs,
// and programmatically interacts with the game to reproduce the race.

import puppeteer from "puppeteer";

const URL_BASE = process.env.PR_URL ?? "http://localhost:8000/";
const HEADLESS = process.env.HEADLESS !== "0";

async function main() {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();

  const logs = [];
  page.on("console", msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (process.env.LIVE === "1") {
      console.log(`[${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", err => {
    logs.push(`[ERROR] ${err.message}\n${err.stack}`);
    console.error("[PAGE ERROR]", err.message);
  });

  console.log(`navigating to ${URL_BASE}...`);
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Enable sprite-debug logging the moment the page is ready.
  await page.evaluateOnNewDocument(() => {
    window.__SPRITE_DEBUG = true;
  });

  // Wait for Phaser to boot — canvas appears + globalScene assigned.
  console.log("waiting for Phaser canvas...");
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      return canvas != null && canvas.width > 0;
    },
    { timeout: 60000 },
  );

  // Wait until BattleScene is ACTIVE (loading-scene finished).
  // The BattleScene constructor runs early but the scene starts only
  // after LoadingScene's preload completes (loading-scene.ts:543
  // `this.scene.start("battle")`).
  console.log("waiting for BattleScene to become active (up to 300s)...");
  const loadStart = Date.now();
  await page.waitForFunction(
    () => {
      const g = globalThis.globalScene;
      if (!g) return false;
      return g.scene.isActive() === true;
    },
    { timeout: 300000, polling: 1000 },
  );
  console.log(`BattleScene active in ${((Date.now() - loadStart) / 1000).toFixed(1)}s`);
  await page.screenshot({ path: "scripts/debug-screenshot-1-loaded.png" });

  // Helper to read current UI state.
  const uiState = async () => {
    return await page.evaluate(() => {
      const g = globalThis.globalScene;
      if (!g) return { hasScene: false };
      return {
        hasScene: true,
        uiMode: g.ui?.getMode?.(),
        uiHandler: g.ui?.getHandler?.()?.constructor?.name,
      };
    });
  };
  const pressAndWait = async (key, ms = 350) => {
    await page.keyboard.press(key);
    await new Promise(r => setTimeout(r, ms));
  };

  // Mash Enter to skip welcome message bubbles + load-save-game prompt.
  console.log("skipping welcome messages...");
  for (let i = 0; i < 20; i++) {
    await pressAndWait("Enter", 350);
    const s = await uiState();
    if (i % 5 === 0) {
      console.log(`  step ${i}: handler=${s.uiHandler} mode=${s.uiMode}`);
    }
    if (s.uiHandler === "TitleUiHandler") {
      console.log(`  reached TitleUiHandler at step ${i}`);
      break;
    }
  }
  await page.screenshot({ path: "scripts/debug-screenshot-2-title.png" });

  // From the title we need to start a new run. Press Enter to begin → it
  // opens a menu where we pick the game mode (Classic Mode is default).
  console.log("starting new run...");
  await pressAndWait("Enter", 800);
  await pressAndWait("Enter", 800); // confirm game mode
  await page.screenshot({ path: "scripts/debug-screenshot-3-after-mode.png" });

  let s = await uiState();
  console.log(`after mode select: ${s.uiHandler} mode=${s.uiMode}`);

  // If we're on the StarterSelectUiHandler, great. Otherwise mash some
  // more keys.
  for (let i = 0; i < 10 && s.uiHandler !== "StarterSelectUiHandler"; i++) {
    await pressAndWait("Enter", 500);
    s = await uiState();
  }
  console.log(`final handler before cycling: ${s.uiHandler}`);
  await page.screenshot({ path: "scripts/debug-screenshot-4-starter-select.png" });

  if (s.uiHandler === "StarterSelectUiHandler") {
    // Use programmatic input via Phaser's input system rather than
    // synthetic browser key events — pokerogue uses Phaser's keyboard
    // input which doesn't always receive synthetic events cleanly.
    // We call setCursor directly to drive selection.
    console.log("driving cursor programmatically...");
    const startCursorState = await page.evaluate(() => {
      const h = globalThis.globalScene?.ui?.getHandler?.();
      return {
        filterMode: h?.filterMode,
        cursor: h?.cursor,
        filteredCount: h?.filteredStarterContainers?.length,
      };
    });
    console.log("start state:", JSON.stringify(startCursorState));

    // Exit filter mode and drop into the species grid.
    await page.evaluate(() => {
      const h = globalThis.globalScene?.ui?.getHandler?.();
      if (h && h.setFilterMode) {
        h.setFilterMode(false);
      }
    });
    await new Promise(r => setTimeout(r, 200));
    let pre = await page.evaluate(() => {
      const g = globalThis.globalScene;
      const h = g?.ui?.getHandler?.();
      return {
        cursor: h?.cursor,
        filterMode: h?.filterMode,
        lastSpeciesId: h?.lastSpecies?.speciesId,
        lastSpeciesName: h?.lastSpecies?.name,
      };
    });
    console.log(`cursor=${pre.cursor} filterMode=${pre.filterMode} lastSpecies=${pre.lastSpeciesName}(${pre.lastSpeciesId})`);
    await page.screenshot({ path: "scripts/debug-screenshot-5-cursor-grid.png" });

    console.log("=== STARTING RAPID CYCLE TEST ===");
    // Reset log buffer to isolate cycling logs.
    logs.length = 0;
    // Also re-set sprite debug flag for good measure.
    await page.evaluate(() => {
      window.__SPRITE_DEBUG = true;
    });

    const startSpriteAnim = await page.evaluate(() => {
      const h = globalThis.globalScene?.ui?.getHandler?.();
      return h?.pokemonSprite?.anims?.currentAnim?.key;
    });
    console.log(`sprite anim BEFORE cycling: ${startSpriteAnim}`);

    // Drive cursor across the full filtered list (27 species) rapidly,
    // then BACK, then forward, simulating a user holding arrow keys
    // back and forth. End on a NEW position so we can verify the
    // latest selection loads correctly.
    console.log("rapid forward...");
    for (let i = 1; i <= 26; i++) {
      await page.evaluate(idx => globalThis.globalScene?.ui?.getHandler?.()?.setCursor?.(idx), i);
      await new Promise(r => setTimeout(r, 50));
    }
    console.log("rapid backward...");
    for (let i = 25; i >= 0; i--) {
      await page.evaluate(idx => globalThis.globalScene?.ui?.getHandler?.()?.setCursor?.(idx), i);
      await new Promise(r => setTimeout(r, 50));
    }
    console.log("rapid forward to a middle-ish position...");
    for (let i = 1; i <= 12; i++) {
      await page.evaluate(idx => globalThis.globalScene?.ui?.getHandler?.()?.setCursor?.(idx), i);
      await new Promise(r => setTimeout(r, 50));
    }
    console.log("paused on cursor=12, waiting for latest load...");
    await new Promise(r => setTimeout(r, 2500));
    await page.screenshot({ path: "scripts/debug-screenshot-6-after-cycle.png" });

    const cycleState = await page.evaluate(() => {
      const g = globalThis.globalScene;
      const h = g?.ui?.getHandler?.();
      const sprite = h?.pokemonSprite;
      const anim = sprite?.anims?.currentAnim;
      const lastSpecies = h?.lastSpecies;
      const cursor = h?.cursor;
      const filtered = h?.filteredStarterContainers;
      const speciesAtCursor = filtered?.[cursor]?.species;
      return {
        cursor,
        currentDisplayedSpeciesId: h?.currentDisplayedSpeciesId,
        lastSpeciesId: lastSpecies?.speciesId,
        lastSpeciesName: lastSpecies?.name,
        speciesAtCursorId: speciesAtCursor?.speciesId,
        speciesAtCursorName: speciesAtCursor?.name,
        spriteVisible: sprite?.visible,
        spriteAnimKey: anim?.key,
        spriteFrameKey: sprite?.frame?.name,
        spriteAlpha: sprite?.alpha,
        // Check whether the texture for the species AT cursor is in cache
        speciesAtCursorTextureKey: speciesAtCursor?.getSpriteKey?.(false, 0, false, 0, false),
        speciesAtCursorTextureInCache: speciesAtCursor
          ? g.textures.exists(speciesAtCursor.getSpriteKey(false, 0, false, 0, false))
          : false,
      };
    });
    console.log("=== STATE AFTER RAPID CYCLE ===");
    console.log(JSON.stringify(cycleState, null, 2));
  }

  await page.screenshot({ path: "scripts/debug-screenshot-final.png" });

  // Write all logs to disk.
  const fs = await import("node:fs");
  fs.writeFileSync("scripts/debug-sprite-logs.txt", logs.join("\n"));
  console.log(`captured ${logs.length} log lines → scripts/debug-sprite-logs.txt`);

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
