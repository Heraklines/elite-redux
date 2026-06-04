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
  await sleep(2000);
  const probe = await p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    const want = ["Lapras", "Ledyba"];
    const res = {};
    const all = h.starterContainers ?? h.filteredStarterContainers ?? [];
    for (const c of all) {
      const sp = c.species;
      if (want.includes(sp.name) && !res[sp.name]) {
        // Resolve names by walking each ability id through the species' own
        // allAbilities (reachable via getAbility on a temp? no) — instead expose
        // the ids and the ability NAMES via the species form helpers if present.
        const ids = [sp.ability1, sp.ability2, sp.abilityHidden, ...sp.getPassiveAbilities(0)].filter(Boolean);
        res[sp.name] = { id: sp.speciesId, abilityIds: ids };
      }
    }
    return res;
  });
  console.log("RESULT " + JSON.stringify(probe));
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
