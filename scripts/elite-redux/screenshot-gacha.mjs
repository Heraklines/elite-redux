#!/usr/bin/env node
// Capture the egg-gacha screen to verify the voucher click button works.
// Boots, drains welcome, gets to main menu, navigates to gacha.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173/";
mkdirSync("docs/screenshots", { recursive: true });

const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
  ],
});

async function snap(page, name) {
  const buf = await page.screenshot({ type: "png" });
  writeFileSync(join("docs/screenshots", name), buf);
  console.log(`[snap] ${name} (${buf.length} bytes)`);
}
async function press(page, key, n = 1, d = 300) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down(key);
    await new Promise(r => setTimeout(r, 50));
    await page.keyboard.up(key);
    await new Promise(r => setTimeout(r, d));
  }
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60_000 });
  await new Promise(r => setTimeout(r, 7000));

  // Drain welcome dialog.
  await press(page, "Space", 25, 350);
  await new Promise(r => setTimeout(r, 1500));
  await snap(page, "gacha-01-menu.png");

  // Navigate menu: ArrowDown to "Egg Gacha" then Space to confirm.
  // The main menu order is: Continue / New Game / Options / ... / Egg Gacha
  // Try down + confirms.
  for (let i = 0; i < 5; i++) {
    await press(page, "ArrowDown", 1, 300);
    await snap(page, `gacha-02-menu-step${i}.png`);
  }
  await press(page, "Space", 1, 1500);
  await new Promise(r => setTimeout(r, 2500));
  await snap(page, "gacha-03-after-confirm.png");
} finally {
  await browser.close();
}
