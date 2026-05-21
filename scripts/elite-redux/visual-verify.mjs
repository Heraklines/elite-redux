/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux visual verification harness.
 *
 * Boots the dev server in a headless Puppeteer browser, drives the game through
 * its opening flow (gender prompt → title → new game → starter select), and
 * captures screenshots at each stage. Console errors are surfaced in the report.
 *
 * Screenshots land under docs/plans/screenshots/ and are .gitignored.
 *
 * Requires:
 *   - assets/ populated (junctioned/copied from upstream pokerogue-assets)
 *   - locales/<lang>/ populated (junctioned from pokerogue-locales)
 *   - dev server running on http://localhost:8000/
 *
 * Usage:
 *   pnpm run start:dev   # in another terminal
 *   node scripts/elite-redux/visual-verify.mjs
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, "../../docs/plans/screenshots");
const URL = process.env.ER_VV_URL ?? "http://localhost:8000/";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shoot(page, name) {
  const path = resolve(SCREENSHOTS_DIR, name);
  await page.screenshot({ path });
  console.log(`Captured: ${name}`);
}

async function main() {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 720 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    const consoleErrors = [];
    page.on("pageerror", err => consoleErrors.push(`pageerror: ${err.message}`));
    page.on("console", msg => {
      if (msg.type() === "error") {
        consoleErrors.push(`console.error: ${msg.text()}`);
      }
    });

    console.log(`Loading game from ${URL}...`);
    // Use US English so the game UI text is in English for screenshot review.
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "language", { get: () => "en-US" });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    });
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector("canvas", { timeout: 30_000 });

    // Initial scene load.
    await sleep(8_000);
    await shoot(page, "01-initial-load.png");

    // Mash Enter through the intro dialogue (~6 pages of text).
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Enter");
      await sleep(400);
    }
    await sleep(1_500);
    await shoot(page, "02-after-intro-mash.png");

    // We should now be at gender/title. Try selecting boy with Z.
    await page.keyboard.press("z");
    await sleep(1_500);
    await shoot(page, "03-after-gender-confirm.png");

    // More Enter to skip any remaining dialogue.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Enter");
      await sleep(400);
    }
    await sleep(1_500);
    await shoot(page, "04-title-or-menu.png");

    // Try newGame: press Z to confirm cursor on first option.
    await page.keyboard.press("z");
    await sleep(2_000);
    await shoot(page, "05-after-z-1.png");

    // selectGameMode: classic should be selected by default; confirm.
    await page.keyboard.press("z");
    await sleep(3_000);
    await shoot(page, "06-after-z-2.png");

    // Save slot pick: confirm slot 1.
    await page.keyboard.press("z");
    await sleep(4_000);
    await shoot(page, "07-after-z-3.png");

    // Possibly difficulty / starter select now. Wait for assets and screenshot.
    await sleep(3_000);
    await shoot(page, "08-after-wait.png");

    // Try navigating starter grid.
    await page.keyboard.press("ArrowRight");
    await sleep(500);
    await page.keyboard.press("ArrowRight");
    await sleep(500);
    await page.keyboard.press("ArrowDown");
    await sleep(800);
    await shoot(page, "09-starter-navigated.png");

    // Press 'p' (passive ability menu on pokerogue) to surface ER 3-passive panel.
    await page.keyboard.press("p");
    await sleep(1_500);
    await shoot(page, "10-passive-attempt.png");

    if (consoleErrors.length > 0) {
      console.log(`\n=== Browser console errors (${consoleErrors.length}) ===`);
      consoleErrors.slice(0, 30).forEach(e => console.log(`  ${e}`));
    } else {
      console.log("\nNo browser console errors.");
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
