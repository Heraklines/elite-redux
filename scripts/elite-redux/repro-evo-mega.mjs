import { readFileSync, writeFileSync } from "node:fs";
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
p.on("pageerror", e => console.log("[pageerror]", e.message, "\n", (e.stack || "").split("\n").slice(0, 8).join("\n")));
const press = async (k, d = 450) => {
  await p.keyboard.down(k);
  await sleep(50);
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
const info = () =>
  p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    return { mode: window.dev.scene.ui.getMode(), sp: h?.species?.name, prev: h?.previousSpecies?.length };
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
  await p.evaluate(() => window.dev.pokedex("Snorlax Redux"));
  await sleep(1800);
  // move menu cursor to EVOLUTIONS (8)
  await p.evaluate(() => window.dev.scene.ui.getHandler().setCursor(8));
  await sleep(300);
  console.log("before action:", JSON.stringify(await info()));
  await press("Space");
  await sleep(600); // open evolutions (may show text)
  await press("Space");
  await sleep(600); // advance text → OPTION_SELECT
  console.log("after open evolutions:", JSON.stringify(await info()));
  writeFileSync("docs/screenshots/evo-01-menu.png", await p.screenshot());
  // Option list: [Prevo header, Munchlax Redux, Forms header, regionalForm., Snorlax Redux Mega, Cancel].
  // From Munchlax Redux: down twice → Snorlax Redux Mega.
  await press("ArrowDown");
  await sleep(250);
  await press("ArrowDown");
  await sleep(250);
  await press("Space");
  await sleep(1800);
  console.log("after selecting mega:", JSON.stringify(await info()));
  writeFileSync("docs/screenshots/evo-02-mega.png", await p.screenshot());
  // try to leave
  await press("Backspace");
  await sleep(1200);
  console.log("after CANCEL:", JSON.stringify(await info()));
  await press("Backspace");
  await sleep(1000);
  console.log("after CANCEL2:", JSON.stringify(await info()));
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
