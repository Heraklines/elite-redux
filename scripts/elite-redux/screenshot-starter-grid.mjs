#!/usr/bin/env node
// Repro harness for the starter-select grid (green-square icon bug #134).
// Boots, reaches a clean title, opens dev.starterSelect(), screenshots while
// paging through the grid. Usage: node scripts/elite-redux/screenshot-starter-grid.mjs
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
const snap = async n => {
  writeFileSync(join(outDir, n), await page.screenshot());
  console.log("[snap]", n);
};
const press = async (k, d = 250) => {
  await page.keyboard.down(k);
  await sleep(60);
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

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction("typeof window.dev !== 'undefined' && !!window.dev.scene", { timeout: 90000 });
  // drive to gameData ready + title
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(() => window.dev?.scene?.gameData?.trainerId != null)) {
      break;
    }
    await press("Space", 800);
  }
  for (let i = 0; i < 60; i++) {
    if ((await phaseName()) === "TitlePhase") {
      break;
    }
    await press("Space", 350);
  }
  console.log("phase:", await phaseName());
  await sleep(800);
  await page.evaluate(() => window.dev.starterSelect());
  await sleep(2500);
  await snap("grid-00.png");
  // Page down through the grid a few times.
  for (let i = 1; i <= 8; i++) {
    await press("PageDown", 600);
    await snap(`grid-0${i}.png`);
  }
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
  await snap("grid-99-error.png");
} finally {
  await browser.close();
}
