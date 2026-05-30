// Best-effort starter-select sprite harness: verifies the ACTUALLY RENDERED
// texture/animation matches the selected species — not just the intended
// pipelineData.spriteKey (which can lie if play() no-ops on a missing anim).
//
// Reports, per cursor move:
//   expected   = species.getSpriteKey(props)         (what SHOULD show)
//   pipelineKey = pokemonSprite.pipelineData.spriteKey (what the code claims)
//   texKey     = pokemonSprite.texture.key            (the real atlas on screen)
//   animKey    = pokemonSprite.anims.currentAnim.key  (the real anim on screen)
// A VISUAL MISMATCH = texKey/animKey != expected (the bug in the screenshot).
// A LIE = pipelineKey == expected but texKey != expected (why old tests passed).

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
const tap = async k => {
  await p.keyboard.down(k);
  await sleep(10);
  await p.keyboard.up(k);
};
const press = async (k, d = 120) => {
  await p.keyboard.down(k);
  await sleep(40);
  await p.keyboard.up(k);
  await sleep(d);
};
const phase = () => p.evaluate(() => window.dev?.scene?.phaseManager?.getCurrentPhase?.()?.constructor?.name ?? null);

// Read the true visual state of the preview sprite.
const visual = () =>
  p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    const sp = h.lastSpecies;
    const spr = h.pokemonSprite;
    let expected = null;
    if (sp) {
      const props = window.dev.scene.gameData.getSpeciesDexAttrProps(sp, h.getCurrentDexProps(sp.speciesId));
      expected = sp.getSpriteKey(props.female, props.formIndex, props.shiny, props.variant);
    }
    return {
      id: sp?.speciesId,
      name: sp?.name,
      expected,
      pipelineKey: spr?.pipelineData?.spriteKey ?? null,
      texKey: spr?.texture?.key ?? null,
      animKey: spr?.anims?.currentAnim?.key ?? null,
      visible: spr?.visible,
    };
  });

// Extract the numeric species id from a sprite key like pkmn__shiny__214 / pkmn__92_3.
function speciesIdOf(key) {
  if (!key) {
    return null;
  }
  const m = String(key).match(/(\d+)(?:_\d+)?$/);
  return m ? m[1] : null;
}
// The REAL bug is showing a DIFFERENT species. Showing the right species' base
// sprite while its shiny/variant still loads is acceptable (refines shortly).
function visualOk(v) {
  if (!v.expected) {
    return true;
  }
  return speciesIdOf(v.texKey) === speciesIdOf(v.expected);
}

async function settleVisual(timeout = 12000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await visual();
    if (visualOk(last)) {
      return { ms: Date.now() - t0, v: last };
    }
    await sleep(30);
  }
  return { ms: -1, v: last };
}

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
  await press("ArrowDown", 500);

  let visualMismatch = 0;
  let lies = 0;
  let stuck = 0;
  const bad = [];

  // PASS 1: 60 single right-steps, settle and check the REAL texture each time.
  for (let i = 0; i < 60; i++) {
    await tap("ArrowRight");
    await sleep(40);
    const { ms, v } = await settleVisual();
    if (ms < 0) {
      stuck++;
      bad.push(`#${i} STUCK exp=${v.expected} tex=${v.texKey} anim=${v.animKey} pipe=${v.pipelineKey} name=${v.name}`);
    }
    // Snapshot the instantaneous state too (pre-settle lie detection).
    if (v.pipelineKey === v.expected && v.texKey !== v.expected) {
      lies++;
    }
  }

  // PASS 2: rapid bursts (the reported repro), check the FINAL rendered texture.
  for (let burst = 0; burst < 8; burst++) {
    const n = 6 + (burst % 5);
    for (let i = 0; i < n; i++) {
      await tap(i % 2 ? "ArrowLeft" : "ArrowRight");
      await sleep(15 + (i % 3) * 12);
    }
    // mix in up/down too
    await tap("ArrowDown");
    await sleep(25);
    const { ms, v } = await settleVisual(15000);
    if (!visualOk(v)) {
      visualMismatch++;
      bad.push(
        `burst ${burst}: VISUAL MISMATCH exp=${v.expected} tex=${v.texKey} anim=${v.animKey} pipe=${v.pipelineKey} name=${v.name}`,
      );
    } else if (ms > 1500) {
      bad.push(`burst ${burst}: slow settle ${ms}ms`);
    }
  }

  // PASS 3: settle, then read the steady-state visual repeatedly (catch a sprite
  // that "looks" settled by pipeline but is visually wrong and never corrects).
  for (let i = 0; i < 20; i++) {
    await tap(i % 2 ? "ArrowRight" : "ArrowLeft");
    await sleep(400); // let the 150ms reconcile run a few times
    const v = await visual();
    if (!visualOk(v)) {
      visualMismatch++;
      bad.push(
        `steady #${i}: exp=${v.expected} tex=${v.texKey} anim=${v.animKey} pipe=${v.pipelineKey} name=${v.name}`,
      );
      if (!globalThis.__dumped) {
        globalThis.__dumped = true;
        // Dump the handler internals + asset state for the FIRST stuck case.
        const diag = await p.evaluate(() => {
          const h = window.dev.scene.ui.getHandler();
          const sp = h.lastSpecies;
          const props = window.dev.scene.gameData.getSpeciesDexAttrProps(sp, h.getCurrentDexProps(sp.speciesId));
          const exp = sp.getSpriteKey(props.female, props.formIndex, props.shiny, props.variant);
          return {
            exp,
            texExists: window.dev.scene.textures.exists(exp),
            animExists: window.dev.scene.anims.exists(exp),
            reconcileLoadKey: h.reconcileLoadKey,
            starterSpriteLoadActive: h.starterSpriteLoadActive,
            pendingStarterSpriteLoad: !!h.pendingStarterSpriteLoad,
            hasReconcileTimer: !!h.spriteReconcileTimer,
            // Phaser loader internals — is the shared loader wedged?
            loaderIsLoading: window.dev.scene.load.isLoading(),
            loaderTotalToLoad: window.dev.scene.load.totalToLoad,
            loaderTotalComplete: window.dev.scene.load.totalComplete,
            loaderTotalFailed: window.dev.scene.load.totalFailed,
            loaderInflight: window.dev.scene.load.inflight?.size ?? null,
            loaderQueueSize: window.dev.scene.load.queue?.size ?? null,
            loaderListSize: window.dev.scene.load.list?.size ?? null,
          };
        });
        bad.push("DIAG " + JSON.stringify(diag));
      }
    }
  }

  console.log(`=== visualMismatch=${visualMismatch} stuck=${stuck} pipeline-lies=${lies} ===`);
  console.log(bad.slice(0, 25).join("\n") || "no problems detected");
  console.log("[done]");
} catch (e) {
  console.log("[fatal]", e.message);
} finally {
  await b.close();
}
