// Focused headed (real Chrome) test of the preload fix: open starter-select,
// let the background preloader warm the visible grid, then cycle FURIOUSLY
// (down-heavy, the user's repro) and check the displayed sprite always matches
// the cursor's species. Logs warm progress + network so we can see exactly what
// happens. Run: node scripts/elite-redux/repro-sprite-warm.mjs
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";

const prsv = readFileSync("test/utils/saves/full_unlocks_sanitized.prsv", "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: false, args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
p.on("pageerror", e => console.log("[pageerror]", e.message));
const netPending = new Map();
let netDone = 0;
const isSprite = u => /\/images\/pokemon\/.*\.(png|json)(\?|$)/.test(u);
p.on("request", r => {
  if (isSprite(r.url())) {
    netPending.set(r.url(), Date.now());
  }
});
p.on("requestfinished", r => {
  if (netPending.delete(r.url())) {
    netDone++;
  }
});
p.on("requestfailed", r => netPending.delete(r.url()));
const tap = async k => {
  await p.keyboard.down(k);
  await sleep(10);
  await p.keyboard.up(k);
};
const press = async (k, d = 200) => {
  await p.keyboard.down(k);
  await sleep(40);
  await p.keyboard.up(k);
  await sleep(d);
};
const phase = () => p.evaluate(() => window.dev?.scene?.phaseManager?.getCurrentPhase?.()?.constructor?.name ?? null);
const speciesIdOf = k => {
  const m = k && String(k).match(/(\d+)(?:_\d+)?$/);
  return m ? m[1] : null;
};
const visual = () =>
  p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    const sp = h.lastSpecies;
    const spr = h.pokemonSprite;
    let exp = null;
    if (sp) {
      const pr = window.dev.scene.gameData.getSpeciesDexAttrProps(sp, h.getCurrentDexProps(sp.speciesId));
      exp = sp.getSpriteKey(pr.female, pr.formIndex, pr.shiny, pr.variant);
    }
    return { name: sp?.name, exp, tex: spr?.texture?.key ?? null };
  });
const okSpecies = v => !v.exp || speciesIdOf(v.tex) === speciesIdOf(v.exp);
// How many of the visible 81 grid sprites are warm (cached)?
const warmCount = () =>
  p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    const first = h.scrollCursor * 9;
    const last = Math.min(h.filteredStarterContainers.length - 1, first + 80);
    let warm = 0;
    let total = 0;
    for (let i = first; i <= last; i++) {
      const sp = h.filteredStarterContainers[i]?.species;
      if (!sp) {
        continue;
      }
      total++;
      const pr = window.dev.scene.gameData.getSpeciesDexAttrProps(sp, h.getCurrentDexProps(sp.speciesId));
      const key = sp.getSpriteKey(pr.female ?? false, pr.formIndex, false, 0);
      if (window.dev.scene.textures.exists(key)) {
        warm++;
      }
    }
    return { warm, total };
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

  // Let the background preloader warm the visible page; log progress.
  for (let s = 0; s < 30; s++) {
    await sleep(1000);
    const w = await warmCount();
    if (s % 3 === 0 || w.warm >= w.total) {
      console.log(`warm ${s}s: ${w.warm}/${w.total} visible cached, netDone=${netDone}, netPending=${netPending.size}`);
    }
    if (w.warm >= w.total) {
      console.log(`>>> grid fully warm after ~${s}s`);
      break;
    }
  }

  // Cycle down-heavy at a FAST-HUMAN rate (~8 presses/sec, 110-150ms gaps) — a
  // realistic frantic player, not the super-human 30-45/sec that just saturates
  // the browser's main thread regardless of any loading fix.
  let stuck = 0;
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 18; i++) {
      const dir =
        round % 2 ? (i % 2 ? "ArrowDown" : "ArrowUp") : ["ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft"][i % 4];
      await tap(dir);
      await sleep(110 + (i % 3) * 20);
    }
    // Convergence window — wait up to 6s and record HOW LONG it took to show the
    // right species (distinguishes "slow but resolves" from "permanently stuck").
    let ok = false;
    let tookMs = -1;
    for (let t = 0; t < 48; t++) {
      await sleep(125);
      if (okSpecies(await visual())) {
        ok = true;
        tookMs = (t + 1) * 125;
        break;
      }
    }
    if (ok && tookMs > 1500) {
      console.log(`round ${round}: slow converge ${tookMs}ms`);
    }
    if (!ok) {
      stuck++;
      const v = await visual();
      const diag = await p.evaluate(() => {
        const h = window.dev.scene.ui.getHandler();
        const sp = h.lastSpecies;
        const pr = window.dev.scene.gameData.getSpeciesDexAttrProps(sp, h.getCurrentDexProps(sp.speciesId));
        const baseKey = sp.getSpriteKey(pr.female ?? false, pr.formIndex, false, 0);
        return {
          baseKey,
          baseTex: window.dev.scene.textures.exists(baseKey),
          baseAnim: window.dev.scene.anims.exists(baseKey),
          pipe: h.pokemonSprite?.pipelineData?.spriteKey,
          cursorLoadKey: h.cursorLoadKey,
          preloading: h.preloadingKeys ? [...h.preloadingKeys].length : null,
        };
      });
      const pendingSample = [...netPending.keys()].slice(0, 6).map(u => u.split("/").slice(-2).join("/"));
      console.log(
        `STUCK round ${round}: name=${v.name} exp=${v.exp} tex=${v.tex} netPending=${netPending.size} ${JSON.stringify(diag)} pend=${JSON.stringify(pendingSample)}`,
      );
    }
  }
  console.log(`=== FURIOUS (warm) stuck=${stuck}/20 ===`);
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
