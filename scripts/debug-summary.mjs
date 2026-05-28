#!/usr/bin/env node
// Repro/verify the summary ABILITIES page via the dev harness (window.dev).
import puppeteer from "puppeteer";

const URL_BASE = process.env.PR_URL ?? "http://localhost:8000/";

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", err => errors.push(`[PAGEERROR] ${err.message}\n${err.stack}`));

  await page.goto(URL_BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => document.querySelector("canvas")?.width > 0, { timeout: 60000 });
  await page.waitForFunction(
    () => {
      const s = globalThis.dev?.scene;
      return s?.gameData != null && s?.ui?.getHandler?.() != null && s?.scene?.isActive?.();
    },
    { timeout: 300000, polling: 500 },
  );
  console.log("scene ready");

  // Dismiss the pre-title welcome message to reach the title screen (clean
  // overlay base — avoids fade artifacts from overlaying the message box).
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 400));
    const h = await page.evaluate(() => globalThis.dev.scene.ui.getHandler()?.constructor?.name);
    if (h === "TitleUiHandler") break;
  }

  // Open summary at default page 0 (STATUS). passiveAttr 0b001011 =
  // slot0 unlocked+enabled, slot1 unlocked+disabled, slot2 locked → exercises
  // all three innate visual states at once.
  await page.evaluate(() => {
    globalThis.dev.summary("BOUFFALANT", { passive: true, passiveAttr: 0b001011 });
  });
  await new Promise(r => setTimeout(r, 1400));
  await page.screenshot({ path: "scripts/dbg-summary-status.png" });

  // RIGHT → ABILITIES page.
  await page.keyboard.press("ArrowRight");
  await new Promise(r => setTimeout(r, 1400));
  const st = await page.evaluate(() => {
    const h = globalThis.dev.scene.ui.getHandler();
    return { cursor: h?.cursor };
  });
  console.log("on ABILITIES, cursor =", JSON.stringify(st));
  await page.screenshot({ path: "scripts/dbg-summary-abilities.png" });

  // RIGHT → STATS, RIGHT → MOVES (verify downstream pages still fine).
  await page.keyboard.press("ArrowRight");
  await new Promise(r => setTimeout(r, 900));
  await page.screenshot({ path: "scripts/dbg-summary-stats.png" });
  await page.keyboard.press("ArrowRight");
  await new Promise(r => setTimeout(r, 900));
  await page.screenshot({ path: "scripts/dbg-summary-moves.png" });

  console.log(`\nTotal pageerrors: ${errors.length}`);
  errors.slice(0, 3).forEach(e => console.log("----\n" + e.slice(0, 1500)));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
