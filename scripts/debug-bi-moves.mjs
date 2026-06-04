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
// CRITICAL: do NOT send input until currentBattle is set. Pressing Enter ends
// TitlePhase early, which can jump into the queued EncounterPhase before
// initBattle's async newBattle() runs (currentBattle null → waveIndex crash).
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

// 0) clean command menu (no overlay) — for Info-hint placement planning
await p.screenshot({ path: "scripts/bi-cmd-clean.png" });

// dump player + enemy movesets to confirm what should render
const sets = await p.evaluate(() => {
  const s = globalThis.dev.scene;
  const fmt = m => (m?.getMoveset?.() ?? []).filter(Boolean).map(mv => mv.getName?.() ?? mv.moveId);
  return {
    player: s.getPlayerField?.().map(fmt),
    enemy: s.getEnemyField?.().map(fmt),
  };
});
console.log("movesets:", JSON.stringify(sets));

// open overlay (STATS=8) → lands on the Party VS panel
await press(8);
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: "scripts/bi-party.png" });
// RIGHT(3) → stats, then DOWN(1) to enemy target, RIGHT twice to reach moves panel
await press(3);
await press(1);
await new Promise(r => setTimeout(r, 200));
await press(3); // abilities
await press(3); // moves
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: "scripts/bi-enemy-moves.png" });

console.log(`pageerrors: ${errors.length}`);
errors.slice(0, 3).forEach(e => console.log(e.slice(0, 800)));
await b.close();
