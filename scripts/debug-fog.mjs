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
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const h = await p.evaluate(() => globalThis.dev.scene.ui.getHandler()?.constructor?.name);
  if (h === "CommandUiHandler") {
    break;
  }
  await p.keyboard.press("Enter");
}
// Screenshot BEFORE fog (baseline).
await p.screenshot({ path: "scripts/fog-before.png" });
// Set FOG weather and let the overlay ease in.
const set = await p.evaluate(() => {
  const s = globalThis.dev.scene;
  const ok = s.arena.trySetWeather(6 /* WeatherType.FOG */);
  return { ok, weatherType: s.arena.weatherType, overlayExists: s.erFogOverlay != null };
});
console.log("setWeather:", JSON.stringify(set));
await new Promise(r => setTimeout(r, 2500));
const after = await p.evaluate(() => {
  const s = globalThis.dev.scene;
  return { weatherType: s.arena.weatherType, overlayAlpha: s.erFogOverlay?.alpha, visible: s.erFogOverlay?.visible };
});
await p.screenshot({ path: "scripts/fog-after.png" });
console.log("after 2.5s:", JSON.stringify(after));
console.log(`pageerrors: ${errors.length}`);
errors.slice(0, 3).forEach(e => console.log(e));
await b.close();
