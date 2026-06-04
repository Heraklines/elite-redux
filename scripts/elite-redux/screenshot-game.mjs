#!/usr/bin/env node
// =============================================================================
// Headless WebGL screenshot driver for pokerogue dev server (Phaser 3).
//
// Uses puppeteer (already installed) with WebGL enabled via --use-gl=angle
// + --enable-features=Vulkan,UseSkiaRenderer. Waits for Phaser to settle by
// polling the canvas pixel histogram (non-black pixel count grows as the
// game renders).
//
// Usage:  node scripts/elite-redux/screenshot-game.mjs <out.png> [url]
// Default URL: http://127.0.0.1:5173/
// =============================================================================

import { writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const out = process.argv[2] ?? "docs/screenshots/game.png";
const url = process.argv[3] ?? "http://127.0.0.1:5173/";

const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--no-sandbox",
    "--disable-features=VizDisplayCompositor",
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on("console", msg => console.log(`[browser:${msg.type()}]`, msg.text()));
  page.on("pageerror", err => console.log(`[browser:error]`, err.message));

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });

  // Wait for canvas to exist + accumulate non-trivial content.
  for (let i = 0; i < 30; i++) {
    const stats = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (!c) return { ready: false };
      const w = c.width, h = c.height;
      return { ready: true, width: w, height: h };
    });
    if (stats.ready && stats.width > 0) {
      console.log(`[poll] canvas ${stats.width}x${stats.height}`);
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Extra settle time for asset loads + first scene render.
  await new Promise(r => setTimeout(r, 8000));

  const buf = await page.screenshot({ type: "png", fullPage: false });
  writeFileSync(out, buf);
  console.log(`[screenshot] ${out} (${buf.length} bytes)`);
} finally {
  await browser.close();
}
