#!/usr/bin/env node
// Reproduction harness for save-state-dependent UI bugs (starter-grid scroll
// #135, Pokédex form/mega softlock #138). Boots, reaches the title, loads a
// fully-unlocked .prsv via dev.loadSave(), opens starter-select, and walks the
// grid capturing screenshots.
//
// Usage: node scripts/elite-redux/repro-unlocked.mjs [save.prsv] [url]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const savePath = process.argv[2] ?? "test/utils/saves/full_unlocks_sanitized.prsv";
const baseUrl = process.argv[3] ?? "http://localhost:5173/";
const outDir = "docs/screenshots";
mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prsv = readFileSync(savePath, "utf8");

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
const snap = async n => {
  writeFileSync(join(outDir, n), await page.screenshot());
  console.log("[snap]", n);
};
const press = async (k, d = 220) => {
  await page.keyboard.down(k);
  await sleep(50);
  await page.keyboard.up(k);
  await sleep(d);
};
const phaseName = () =>
  page.evaluate(() => {
    try {
      return window.dev?.scene?.phaseManager?.getCurrentPhase?.()?.constructor?.name ?? null;
    } catch {
      return null;
    }
  });
const cursorInfo = () =>
  page.evaluate(() => {
    try {
      const h = window.dev?.scene?.ui?.getHandler?.();
      return { cursor: h?.cursor, scrollCursor: h?.scrollCursor, n: h?.filteredStarterContainers?.length };
    } catch (e) {
      return { err: String(e) };
    }
  });

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction("typeof window.dev !== 'undefined' && !!window.dev.scene", { timeout: 90000 });
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(() => window.dev?.scene?.gameData?.trainerId != null)) {
      break;
    }
    await press("Space", 700);
  }
  for (let i = 0; i < 60; i++) {
    if ((await phaseName()) === "TitlePhase") {
      break;
    }
    await press("Space", 300);
  }
  console.log("phase:", await phaseName());

  // Load the fully-unlocked save.
  const ok = await page.evaluate(async s => {
    try {
      await window.dev.loadSave(s);
      return true;
    } catch (e) {
      return String(e);
    }
  }, prsv);
  console.log("loadSave:", ok);
  await sleep(1500);

  // Open starter-select with everything unlocked.
  await page.evaluate(() => window.dev.starterSelect());
  await sleep(3000);
  await snap("repro-grid-00.png");
  console.log("grid:", JSON.stringify(await cursorInfo()));

  // Walk DOWN through ~14 rows, logging cursor/scroll each step to catch the
  // "view doesn't shift / cursor doesn't advance" bug.
  for (let i = 1; i <= 14; i++) {
    await press("ArrowDown", 350);
    const c = await cursorInfo();
    console.log(`down ${i}: cursor=${c.cursor} scroll=${c.scrollCursor}`);
    if (i % 3 === 0) {
      await snap(`repro-grid-${String(i).padStart(2, "0")}.png`);
    }
  }
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
  await snap("repro-error.png");
} finally {
  await browser.close();
}
