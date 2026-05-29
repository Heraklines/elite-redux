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
p.on("pageerror", e => console.log("[pageerror]", e.message));
const press = async (k, d = 300) => {
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
const setSearch = (row, val) =>
  p.evaluate(
    (row, val) => {
      const h = window.dev.scene.ui.getHandler();
      h.filterText.setValue(row, val);
      return {
        n: h.filteredStarterContainers.length,
        first: h.filteredStarterContainers.slice(0, 8).map(c => c.species.name),
      };
    },
    row,
    val,
  );
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
  const base = await p.evaluate(() => window.dev.scene.ui.getHandler().filteredStarterContainers.length);
  console.log("base count:", base);
  // ABILITY_TEXT = 5
  console.log("ability 'drought':", JSON.stringify(await setSearch(5, "drought")));
  console.log("ability 'sun':", JSON.stringify(await setSearch(5, "sun")));
  console.log("reset:", JSON.stringify(await setSearch(5, "---")));
  // NAME = 0
  console.log("name 'char':", JSON.stringify(await setSearch(0, "char")));
  console.log("reset name:", (await setSearch(0, "---")).n);
  // verify the matched abilities actually contain the term
  const detail = await p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    h.filterText.setValue(0, "---");
    h.filterText.setValue(5, "drought");
    const out = [];
    for (const c of h.filteredStarterContainers.slice(0, 5)) {
      out.push(c.species.name);
    }
    return out;
  });
  console.log("drought matches:", JSON.stringify(detail));
  // screenshot the text panel: STATS, STATS
  await p.evaluate(() => window.dev.scene.ui.getHandler().filterText.setValsToDefault());
  await press("c", 400);
  await press("c", 500);
  writeFileSync("docs/screenshots/search-panel.png", await p.screenshot());
  console.log("[snap] search-panel.png");
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
