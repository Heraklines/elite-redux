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
const press = async (k, d = 350) => {
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
const st = () =>
  p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    return {
      mode: window.dev.scene.ui.getMode(),
      n: h.filteredStarterContainers?.length,
      fbCursor: h.filterBarCursor,
      ftMode: h.filterTextMode,
      abil: h.filterText?.getValue?.(5),
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
  await press("c", 500); // enter filter bar (cursor 0, GEN dropdown open)
  console.log("filter bar:", JSON.stringify(await st()));
  // navigate RIGHT to the Search tab (last). 7 tabs: GEN,TYPE,CAUGHT,UNLOCKS,MISC,SORT,SEARCH = cursor 6. Press LEFT once to wrap to last.
  await press("ArrowLeft", 500);
  console.log("after Left (to last tab):", JSON.stringify(await st()));
  writeFileSync("docs/screenshots/searchtab-01.png", await p.screenshot());
  await press("Space", 800); // ACTION on Search tab → open panel
  console.log("after Action:", JSON.stringify(await st()));
  await press("ArrowDown", 400); // to Ability Text
  await press("Space", 900); // open scan
  await p.keyboard.type("sun", { delay: 80 });
  await sleep(500);
  await press("Enter", 1200);
  console.log("after search:", JSON.stringify(await st()));
  writeFileSync("docs/screenshots/searchtab-02.png", await p.screenshot());
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
