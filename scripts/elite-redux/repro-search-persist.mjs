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
const press = async (k, d = 300) => {
  await p.keyboard.down(k);
  await sleep(50);
  await p.keyboard.up(k);
  await sleep(d);
};
const phase = () => p.evaluate(() => window.dev?.scene?.phaseManager?.getCurrentPhase?.()?.constructor?.name ?? null);
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

  // Open the search panel, set ABILITY_TEXT (row 5, cursor 1) to "hail", then
  // simulate pressing Cancel (Button.CANCEL = 6) to leave the search menu.
  const result = await p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    const base = h.filteredStarterContainers.length;
    h.setFilterTextMode(true);
    h.filterTextCursor = 1; // ABILITY_TEXT (NAME=0, ABILITY_TEXT=1 in add order)
    h.filterText.setValue(5, "hail"); // FilterTextRow.ABILITY_TEXT = 5
    const filtered = h.filteredStarterContainers.length;
    // Press Cancel to leave the search menu.
    h.processInput(6); // Button.CANCEL
    return {
      base,
      filtered,
      afterExitCount: h.filteredStarterContainers.length,
      stillInSearch: h.filterTextMode,
      valueAfter: h.filterText.getValue(1),
      sample: h.filteredStarterContainers.slice(0, 6).map(c => c.species.name),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  const ok =
    result.filtered < result.base
    && result.afterExitCount === result.filtered
    && result.stillInSearch === false
    && result.valueAfter === "hail";
  console.log(ok ? "PASS: filter persists after leaving search" : "FAIL: filter reset on exit");
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
