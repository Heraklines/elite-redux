import puppeteer from "puppeteer";

const b = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1280, height: 720 },
});
const p = await b.newPage();
const errors = [];
p.on("pageerror", e => errors.push(`[PAGEERROR] ${e.message}\n${e.stack}`));
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
await p.evaluate(() => {
  globalThis.dev.scene.enableTutorials = false;
  globalThis.dev.battle({ player: ["BOUFFALANT"], enemy: "ABOMASNOW", enemyLevel: 50, level: 50 });
});
// Wait for currentBattle before sending input (avoids the TitlePhase→EncounterPhase
// race where currentBattle is still null → waveIndex crash).
await p.waitForFunction(() => globalThis.dev.scene.currentBattle != null, { timeout: 60000, polling: 200 });
let ready = false;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const st = await p.evaluate(() => ({
    h: globalThis.dev.scene.ui.getHandler()?.constructor?.name,
    bi: globalThis.dev.scene.ui.getHandler()?.battleInfo != null,
  }));
  if (st.h === "CommandUiHandler" && st.bi) {
    ready = true;
    break;
  }
  await p.keyboard.press("Enter");
}
console.log("ready on command:", ready);
const press = btn => p.evaluate(b => globalThis.dev.scene.ui.getHandler().processInput(b), btn);
// Open (STATS=8) → stats panel.
console.log("open:", await press(8));
await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: "scripts/bi-stats.png" });
// RIGHT(3) → abilities
await press(3);
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: "scripts/bi-abilities.png" });
// RIGHT → moves
await press(3);
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: "scripts/bi-moves.png" });
// RIGHT → weather
await press(3);
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: "scripts/bi-weather.png" });
// RIGHT → sides
await press(3);
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: "scripts/bi-sides.png" });
// back to stats(RIGHT wraps), then DOWN to next mon (enemy), screenshot stats
await press(3);
await new Promise(r => setTimeout(r, 200));
await press(1);
await press(1);
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: "scripts/bi-stats2.png" });
const st = await p.evaluate(() => ({ open: globalThis.dev.scene.ui.getHandler().battleInfo?.isOpen }));
// close via ACTION(5)
await press(5);
await new Promise(r => setTimeout(r, 300));
const after = await p.evaluate(() => ({
  open: globalThis.dev.scene.ui.getHandler().battleInfo?.isOpen,
  h: globalThis.dev.scene.ui.getHandler()?.constructor?.name,
}));
console.log("during:", JSON.stringify(st), "after close:", JSON.stringify(after));
console.log(`pageerrors: ${errors.length}`);
errors.slice(0, 3).forEach(e => console.log(e.slice(0, 1000)));
await b.close();
