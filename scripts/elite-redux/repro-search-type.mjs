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
  console.log("grid:", JSON.stringify(await st()));
  await press("c", 500); // filter bar
  await press("c", 700); // text panel
  console.log("text mode:", JSON.stringify(await st()));
  await press("ArrowDown", 400); // to Ability Text row
  await press("Space", 900); // open scan input
  console.log("scan mode:", JSON.stringify(await st()));
  // type into the HTML input
  await p.keyboard.type("sun", { delay: 80 });
  await sleep(600);
  writeFileSync("docs/screenshots/search-typed.png", await p.screenshot());
  await press("Enter", 1200); // submit
  console.log("after submit:", JSON.stringify(await st()));
  writeFileSync("docs/screenshots/search-result.png", await p.screenshot());
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
