#!/usr/bin/env node
// =============================================================================
// Deep ER-state screenshot driver — captures specific UI surfaces where ER's
// changes are visible:
//
//   - er-01-title.png       — title splash
//   - er-02-welcome.png     — welcome message
//   - er-03-starter-init.png — starter UI initial Bulbasaur (Chloroplast)
//   - er-04-starter-cycled.png — cycled to another starter
//   - er-05-pokedex.png     — pokedex page (3-passive list)
//
// Uses puppeteer with proper keyboard event timing (each key release/press
// pair separated by 50ms — pokerogue's input layer requires this).
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
  await snap(page, "er-01-title.png");

  // Press Space MANY times to drain the full welcome dialogue chain.
  for (let i = 0; i < 25; i++) {
    await pressKey(page, "Space", 350);
  }
  await settle(2000);
  await snap(page, "er-02-after-welcomes.png");

  // Now we should be at main menu — Enter "New Game" / "Play".
  for (let i = 0; i < 3; i++) {
    await pressKey(page, "Space", 800);
  }
  await settle(2500);
  await snap(page, "er-03-game-mode.png");

  // Pick first mode (Classic).
  await pressKey(page, "Space", 800);
  await settle(2500);
  await snap(page, "er-04-starter.png");

  // More Space presses to dismiss in-starter explanatory prompts ONLY.
  // The starter tutorial usually takes ~4-5 advances.
  for (let i = 0; i < 5; i++) {
    await pressKey(page, "Space", 400);
  }
  await settle(1500);
  await snap(page, "er-05-starter-clean.png");

  // Cycle right WITHOUT pressing Space (which opens context menu).
  await pressKey(page, "ArrowRight", 350);
  await settle(600);
  await snap(page, "er-06-glumanda.png"); // Charmander

  await pressKey(page, "ArrowRight", 350);
  await settle(600);
  await snap(page, "er-07-schiggy.png"); // Squirtle

  // Go ALL the way right + down to reach later-gen pokemon (ER customs
  // live above id 10000 in the dex grid).
  for (let i = 0; i < 9; i++) {
    await pressKey(page, "ArrowRight", 80);
  }
  await pressKey(page, "ArrowDown", 250);
  await settle(600);
  await snap(page, "er-08-gen2.png");

  for (let i = 0; i < 9; i++) {
    await pressKey(page, "ArrowRight", 80);
  }
  await settle(600);
  await snap(page, "er-09-gen3.png");

  // Now press Space ONCE to open context menu, then navigate to Pokédex.
  await pressKey(page, "Space", 400);
  await settle(600);
  await snap(page, "er-10-menu.png");

  // Navigate down to "Pokédex" — varies by build, try 5 downs.
  await pressKey(page, "ArrowDown", 200);
  await pressKey(page, "ArrowDown", 200);
  await pressKey(page, "ArrowDown", 200);
  await pressKey(page, "ArrowDown", 200);
  await pressKey(page, "ArrowDown", 200);
  await settle(400);
  await snap(page, "er-11-menu-nav.png");

  // Confirm to open the pokedex page.
  await pressKey(page, "Space", 1200);
  await settle(2500);
  await snap(page, "er-12-pokedex.png");
} finally {
  await browser.close();
}
