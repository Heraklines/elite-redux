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
await p.evaluate(() => {
  globalThis.dev.scene.enableTutorials = false;
  globalThis.dev.battle({ player: ["BOUFFALANT"], enemy: "ABOMASNOW", enemyLevel: 50, level: 50 });
});
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
// Press the REAL 'c' key (Stats binding) — should open Battle Info, not the vanilla stat boxes.
await p.keyboard.press("c");
await new Promise(r => setTimeout(r, 600));
const opened = await p.evaluate(() => !!globalThis.dev.scene.ui.getHandler()?.battleInfo?.isOpen);
await p.screenshot({ path: "scripts/info-key-open.png" });
console.log("battleInfo open after 'c':", opened);
// Press 'c' again — should close.
await p.keyboard.press("c");
await new Promise(r => setTimeout(r, 400));
const closed = await p.evaluate(() => !globalThis.dev.scene.ui.getHandler()?.battleInfo?.isOpen);
console.log("battleInfo closed after second 'c':", closed);
console.log(`pageerrors: ${errors.length}`);
errors.slice(0, 3).forEach(e => console.log(e));
await b.close();
