#!/usr/bin/env node
// =============================================================================
// Battle-screen screenshot driver — boots pokerogue, picks a starter, starts
// a battle, captures the in-battle UI to verify ER's ability flyout shows
// the active + 3 passives correctly during combat.
//
// Usage:  node scripts/elite-redux/screenshot-battle.mjs [url]
// =============================================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173/";
const outDir = "docs/screenshots";
mkdirSync(outDir, { recursive: true });

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

async function snap(page, name) {
  const path = join(outDir, name);
  const buf = await page.screenshot({ type: "png", fullPage: false });
  writeFileSync(path, buf);
  console.log(`[snap] ${path} (${buf.length} bytes)`);
}

async function settle(ms = 1500) {
  await new Promise(r => setTimeout(r, ms));
}

async function pressKey(page, key, delay = 80) {
  await page.keyboard.down(key);
  await new Promise(r => setTimeout(r, 50));
  await page.keyboard.up(key);
  await new Promise(r => setTimeout(r, delay));
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on("pageerror", e => console.log(`[err]`, e.message));

  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60_000 });
  await settle(7000);

  // Drain welcome (25 advances).
  for (let i = 0; i < 25; i++) {
    await pressKey(page, "Space", 350);
  }
  await settle(2000);

  // Main menu → New Game.
  for (let i = 0; i < 3; i++) {
    await pressKey(page, "Space", 800);
  }
  await settle(2500);

  // Game-mode → Classic.
  await pressKey(page, "Space", 800);
  await settle(2500);

  // Starter tutorial advances.
  for (let i = 0; i < 5; i++) {
    await pressKey(page, "Space", 400);
  }
  await settle(1500);
  await snap(page, "battle-01-starter.png");

  // Select Bulbasaur (cursor starts on it) — Press Space to open menu,
  // navigate down to "Zum Team hinzufügen" (Add to team), confirm.
  await pressKey(page, "Space", 600);
  await settle(800);
  await snap(page, "battle-02-context-menu.png");

  // First entry is "Zum Team hinzufügen" — press Space to confirm.
  await pressKey(page, "Space", 1200);
  await settle(1500);
  await snap(page, "battle-03-after-add.png");

  // Pick gender / nature dialogs etc. Keep advancing.
  for (let i = 0; i < 10; i++) {
    await pressKey(page, "Space", 600);
  }
  await settle(2000);
  await snap(page, "battle-04-confirm-team.png");

  // Press Space to confirm "Start Game" or whatever's next.
  for (let i = 0; i < 5; i++) {
    await pressKey(page, "Space", 800);
  }
  await settle(3000);
  await snap(page, "battle-05-start-attempt.png");

  // Continue advancing — opening cutscenes / dialogues.
  for (let i = 0; i < 10; i++) {
    await pressKey(page, "Space", 600);
  }
  await settle(2500);
  await snap(page, "battle-06-deeper.png");

  for (let i = 0; i < 10; i++) {
    await pressKey(page, "Space", 600);
  }
  await settle(2500);
  await snap(page, "battle-07-battle.png");
} finally {
  await browser.close();
}
