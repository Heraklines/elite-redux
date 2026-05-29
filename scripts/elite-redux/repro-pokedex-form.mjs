#!/usr/bin/env node
// Reproduce the Pokédex form-cycle softlock (#138). Opens the Pokédex page for
// a species and presses F (cycle form) repeatedly; if the game thread hangs in
// the CYCLE_FORM do/while loop, a heartbeat evaluate will time out.
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";

const species = process.argv[2] ?? "Snorlax Redux";
const baseUrl = process.argv[3] ?? "http://localhost:5173/";
const prsv = readFileSync("test/utils/saves/full_unlocks_sanitized.prsv", "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on("pageerror", e => console.log("[pageerror]", e.message));
const press = async (k, d = 250) => {
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
const heartbeat = async () => {
  try {
    return await Promise.race([
      page.evaluate(() => {
        const h = window.dev?.scene?.ui?.getHandler?.();
        return { form: h?.formIndex, mode: window.dev?.scene?.ui?.getMode?.() };
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("HANG")), 4000)),
    ]);
  } catch (e) {
    return { err: e.message };
  }
};

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
  await page.evaluate(async s => window.dev.loadSave(s), prsv);
  await sleep(1200);
  const opened = await page.evaluate(s => {
    try {
      window.dev.pokedex(s);
      return true;
    } catch (e) {
      return String(e);
    }
  }, species);
  console.log("pokedex open:", opened);
  await sleep(2500);
  console.log("initial:", JSON.stringify(await heartbeat()));
  for (let i = 1; i <= 10; i++) {
    await press("f", 400);
    const hb = await heartbeat();
    console.log(`after F #${i}:`, JSON.stringify(hb));
    if (hb.err === "HANG") {
      console.log(">>> SOFTLOCK reproduced on F #" + i);
      break;
    }
  }
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await browser.close();
}
