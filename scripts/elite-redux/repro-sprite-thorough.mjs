import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";

const prsv = readFileSync("test/utils/saves/full_unlocks_sanitized.prsv", "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({
  headless: "new",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
  ],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
p.on("pageerror", e => console.log("[pageerror]", e.message));
const press = async (k, d = 120) => {
  await p.keyboard.down(k);
  await sleep(40);
  await p.keyboard.up(k);
  await sleep(d);
};
const tap = async k => {
  await p.keyboard.down(k);
  await sleep(15);
  await p.keyboard.up(k);
};
const phase = () =>
  p.evaluate(() => {
    try {
      return window.dev?.scene?.phaseManager?.getCurrentPhase?.()?.constructor?.name ?? null;
    } catch {
      return null;
    }
  });
const cur = () =>
  p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    return { id: h.lastSpecies?.speciesId, have: h.pokemonSprite?.pipelineData?.spriteKey };
  });
// EXACT match: the displayed sprite key must equal the key the current cursor
// species+props resolve to (substring matching gives false positives, e.g.
// "pkmn__140" contains "4", masking a stuck Charmander on Kabuto).
const match = () =>
  p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    const sp = h.lastSpecies;
    if (!sp) {
      return false;
    }
    const props = window.dev.scene.gameData.getSpeciesDexAttrProps(sp, h.getCurrentDexProps(sp.speciesId));
    const expected = sp.getSpriteKey(props.female, props.formIndex, props.shiny, props.variant);
    return h.pokemonSprite?.pipelineData?.spriteKey === expected;
  });
async function settle(timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await match()) {
      return Date.now() - t0;
    }
    await sleep(30);
  }
  return -1;
}
try {
  await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForFunction("typeof window.dev!=='undefined' && !!window.dev.scene", { timeout: 90000 });
  for (let i = 0; i < 150; i++) {
    if (await p.evaluate(() => window.dev?.scene?.gameData?.trainerId != null)) {
      break;
    }
    await press("Space", 700);
  }
  for (let i = 0; i < 60; i++) {
    if ((await phase()) === "TitlePhase") {
      break;
    }
    await press("Space", 300);
  }
  await p.evaluate(async s => window.dev.loadSave(s), prsv);
  await sleep(1200);
  await p.evaluate(() => window.dev.starterSelect());
  await sleep(2500);
  await press("ArrowDown", 500);
  // PASS 1: 40 single cycles through uncached species, record each load time
  const times = [];
  let slow = 0;
  for (let i = 0; i < 40; i++) {
    await tap("ArrowRight");
    await sleep(30);
    const ms = await settle();
    times.push(ms);
    if (ms < 0 || ms > 1000) {
      slow++;
    }
  }
  const valid = times.filter(t => t >= 0);
  const max = Math.max(...valid);
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  console.log(
    `PASS1 single x40: avg=${avg}ms max=${max}ms slow(>1s or stuck)=${slow} timedout=${times.filter(t => t < 0).length}`,
  );
  console.log(
    "  slow ones:",
    times
      .map((t, i) => (t < 0 || t > 1000 ? `#${i}:${t}` : null))
      .filter(Boolean)
      .join(", ") || "none",
  );
  // PASS 2: 5 rapid bursts of 20, measure settle after each
  console.log("PASS2 rapid bursts:");
  for (let burst = 0; burst < 5; burst++) {
    for (let i = 0; i < 20; i++) {
      await tap("ArrowRight");
      await sleep(35);
    }
    const ms = await settle(15000);
    console.log(`  burst ${burst}: settle=${ms}ms`, JSON.stringify(await cur()));
  }
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
