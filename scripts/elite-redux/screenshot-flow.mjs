#!/usr/bin/env node
// =============================================================================
// Multi-screenshot driver — boots pokerogue, runs through a small input
// script to reach important screens, captures one PNG per stop:
//
//   - 01-title.png       — initial title splash
//   - 02-menu.png        — main menu after dismissing welcome
//   - 03-starter.png     — starter-select UI (where the 4-ability row lives)
//
// Inputs are sent via Puppeteer's keyboard API; pokerogue uses ENTER /
// SPACE for advance and arrow keys for nav.
//
// Usage:  node scripts/elite-redux/screenshot-flow.mjs [url]
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

async function press(page, key, times = 1, delay = 200) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await new Promise(r => setTimeout(r, delay));
  }
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on("pageerror", e => console.log(`[err]`, e.message));

  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60_000 });
  await settle(8000);
  await snap(page, "01-title.png");

  // Advance through title splash / welcome blocks.
  await press(page, "Enter", 5, 600);
  await settle(2000);
  await snap(page, "02-menu.png");

  // Try a "New Game" path — navigate to a menu option and confirm.
  await press(page, "ArrowDown", 1, 200);
  await press(page, "Enter", 1, 600);
  await settle(2000);
  await snap(page, "03-after-menu-enter.png");

  // Try further input — accepting any prompts.
  await press(page, "Enter", 3, 800);
  await settle(2000);
  await snap(page, "04-deeper.png");

  // Long-form: try to reach starter via more enters.
  await press(page, "Enter", 5, 600);
  await settle(2000);
  await snap(page, "05-final.png");

  // Dismiss the welcome prompt and capture clean starter view.
  await press(page, "KeyZ", 3, 400);
  await settle(1500);
  await snap(page, "06-starter-clean.png");

  // Hover the first starter (Bulbasaur) and capture detail panel.
  await press(page, "ArrowRight", 1, 300);
  await press(page, "ArrowLeft", 1, 300);
  await settle(1000);
  await snap(page, "07-starter-detail.png");

  // Cycle to an ER mon — press right several times.
  await press(page, "ArrowRight", 10, 100);
  await settle(800);
  await snap(page, "08-starter-cycled.png");
} finally {
  await browser.close();
}
