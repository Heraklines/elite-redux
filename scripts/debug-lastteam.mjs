import puppeteer from "puppeteer";

const b = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1280, height: 720 },
});
const p = await b.newPage();
const errors = [];
p.on("pageerror", e => errors.push(`[PAGEERROR] ${e.message}`));
await p.goto("http://localhost:8000/", { waitUntil: "domcontentloaded", timeout: 30000 });
await p.waitForFunction(() => document.querySelector("canvas")?.width > 0, { timeout: 60000 });
await p.waitForFunction(
  () => {
    const s = globalThis.dev?.scene;
    return s?.gameData != null && s?.ui?.getHandler?.() != null && s?.scene?.isActive?.();
  },
  { timeout: 300000, polling: 500 },
);
for (let i = 0; i < 30; i++) {
  const h = await p.evaluate(() => globalThis.dev.scene.ui.getHandler()?.constructor?.name);
  if (h === "TitleUiHandler") {
    break;
  }
  await p.keyboard.press("Enter");
  await new Promise(r => setTimeout(r, 400));
}
// Grant Bulbasaur (1) and Charmander (4) full caught so a restored team validates.
await p.evaluate(() => {
  const s = globalThis.dev.scene;
  const FULL = 0xffffffn;
  for (const id of [1, 4]) {
    s.gameData.dexData[id].seenAttr = FULL;
    s.gameData.dexData[id].caughtAttr = FULL;
    if (s.gameData.starterData[id]) {
      s.gameData.starterData[id].candyCount = 99;
    }
  }
});
// Seed a "last team" (Bulbasaur + Charmander) under all plausible username keys.
await p.evaluate(() => {
  const team = [
    {
      speciesId: 1,
      shiny: false,
      variant: 0,
      formIndex: 0,
      female: false,
      abilityIndex: 0,
      passive: false,
      nature: 0,
      pokerus: false,
      ivs: [31, 31, 31, 31, 31, 31],
    },
    {
      speciesId: 4,
      shiny: false,
      variant: 0,
      formIndex: 0,
      female: false,
      abilityIndex: 0,
      passive: false,
      nature: 0,
      pokerus: false,
      ivs: [31, 31, 31, 31, 31, 31],
    },
  ];
  const json = JSON.stringify(team);
  for (const u of ["Guest", "undefined", "guest"]) {
    localStorage.setItem(`lastTeam_${u}`, json);
  }
});
await p.evaluate(() => {
  globalThis.dev.scene.enableTutorials = false;
  globalThis.dev.starterSelect();
});
await new Promise(r => setTimeout(r, 1500));
for (let k = 0; k < 6; k++) {
  await p.keyboard.press("Backspace");
  await new Promise(r => setTimeout(r, 200));
}
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: "scripts/lt-panel.png" });

// Verify the Random<->LastTeam nav wiring deterministically: force the Random
// cursor, then UP must move to Last Team, and DOWN must move back to Random.
const nav = await p.evaluate(() => {
  const h = globalThis.dev.scene.ui.getHandler();
  const out = { filterMode: !!h.filterMode };
  h.randomCursorObj.setVisible(true);
  h.lastTeamCursorObj.setVisible(false);
  h.processInput(0); // Button.UP from Random
  out.upFromRandom_showsLastTeam = !!h.lastTeamCursorObj.visible && !h.randomCursorObj.visible;
  h.processInput(1); // Button.DOWN from Last Team
  out.downFromLastTeam_showsRandom = !!h.randomCursorObj.visible && !h.lastTeamCursorObj.visible;
  return out;
});
console.log("nav:", JSON.stringify(nav));

// Trigger restore directly on the handler, then verify the team populated.
const before = await p.evaluate(() => globalThis.dev.scene.ui.getHandler().starterSpecies?.length ?? -1);
const ret = await p.evaluate(() => globalThis.dev.scene.ui.getHandler().restoreLastTeam());
await new Promise(r => setTimeout(r, 1500));
const after = await p.evaluate(() => {
  const h = globalThis.dev.scene.ui.getHandler();
  return { len: h.starterSpecies?.length ?? -1, ids: (h.starterSpecies ?? []).map(s => s.speciesId) };
});
await p.screenshot({ path: "scripts/lt-restored.png" });
console.log("restore returned:", ret, "before:", before, "after:", JSON.stringify(after));
console.log(`pageerrors: ${errors.length}`);
errors.slice(0, 3).forEach(e => console.log(e));
await b.close();
