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
p.on("console", m => {
  const t = m.text();
  if (t.startsWith("[SPR]")) {
    console.log(t);
  }
});
const tap = async k => {
  await p.keyboard.down(k);
  await sleep(12);
  await p.keyboard.up(k);
};
const press = async (k, d = 120) => {
  await p.keyboard.down(k);
  await sleep(40);
  await p.keyboard.up(k);
  await sleep(d);
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
    const sp = h.lastSpecies;
    const have = h.pokemonSprite?.pipelineData?.spriteKey;
    return {
      id: sp?.speciesId,
      name: sp?.name,
      have,
      match: !!have && !!sp && have.includes(String(sp.speciesId)),
      active: h.starterSpriteLoadActive,
      pending: !!h.pendingStarterSpriteLoad,
    };
  });
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
  console.log("=== oscillate R L R L R L R L (12ms taps, ~50ms apart) ===");
  const seq = [
    "ArrowRight",
    "ArrowLeft",
    "ArrowRight",
    "ArrowLeft",
    "ArrowRight",
    "ArrowLeft",
    "ArrowRight",
    "ArrowLeft",
  ];
  for (const k of seq) {
    await tap(k);
    await sleep(50);
  }
  await sleep(300);
  console.log("right after oscillate:", JSON.stringify(await cur()));
  // wait up to 4s and check if it self-corrects
  for (let i = 0; i < 8; i++) {
    await sleep(500);
    const c = await cur();
    if (c.match) {
      console.log(`matched after ${(i + 1) * 500}ms`);
      break;
    }
    if (i === 7) {
      console.log("STILL STUCK after 4s:", JSON.stringify(c));
    }
  }
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
