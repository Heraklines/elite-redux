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

// Dump handler + Phaser-loader internals to classify a stuck state.
const grabDiag = () =>
  p.evaluate(() => {
    const h = window.dev.scene.ui.getHandler();
    const sp = h.lastSpecies;
    const props = window.dev.scene.gameData.getSpeciesDexAttrProps(sp, h.getCurrentDexProps(sp.speciesId));
    const exp = sp.getSpriteKey(props.female, props.formIndex, props.shiny, props.variant);
    return {
      exp,
      texExists: window.dev.scene.textures.exists(exp),
      animExists: window.dev.scene.anims.exists(exp),
      spriteLoadInFlight: h.spriteLoadInFlight,
      hasReconcileTimer: !!h.spriteReconcileTimer,
      loaderIsLoading: window.dev.scene.load.isLoading(),
      loaderTotalToLoad: window.dev.scene.load.totalToLoad,
      loaderTotalComplete: window.dev.scene.load.totalComplete,
      loaderTotalFailed: window.dev.scene.load.totalFailed,
      loaderInflight: window.dev.scene.load.inflight?.size ?? null,
    };
  });

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

  // PASS 2: FURIOUS sustained cycling — exactly the user's repro ("cycle back
  // and forth 10-20 times, you'll see it immediately"). Long oscillation runs
  // with no settle pauses, varying speed, then a TIGHT user-perceived
  // convergence window (2s). A failure here = the displayed sprite is still the
  // wrong Pokémon 2s after the player stopped — i.e. visibly stuck.
  let furiousFail = 0;
  let furiousStuck = 0;
  for (let round = 0; round < 16; round++) {
    const len = 12 + round * 2; // 12 → 42 oscillations
    const gap = 8 + (round % 5) * 8; // 8–40ms between taps (machine-gun → fast)
    for (let i = 0; i < len; i++) {
      await tap(i % 2 ? "ArrowLeft" : "ArrowRight");
      await sleep(gap);
    }
    // Occasionally jump rows mid-storm too (the user moves in all directions).
    if (round % 3 === 0) {
      await tap("ArrowDown");
      await sleep(gap);
      await tap("ArrowUp");
      await sleep(gap);
    }
    // User-perceived window: must show the right species within 2s of stopping.
    const quick = await settleVisual(2000);
    if (quick.ms < 0) {
      // Not converged in 2s — give it the full window to classify stuck-forever.
      const long = await settleVisual(15000);
      if (long.ms < 0) {
        furiousStuck++;
        bad.push(
          `furious ${round} (len=${len},gap=${gap}): STUCK exp=${long.v.expected} tex=${long.v.texKey} pipe=${long.v.pipelineKey} name=${long.v.name}`,
        );
        bad.push("DIAG " + JSON.stringify(await grabDiag()));
      } else {
        furiousFail++;
        bad.push(`furious ${round} (len=${len},gap=${gap}): slow ${long.ms}ms (converged late)`);
      }
    }
  }
  console.log(
    `FURIOUS: visiblyStuck(>2s)=${furiousFail + furiousStuck} stuckForever(>15s)=${furiousStuck} of 16 rounds`,
  );

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
        bad.push("DIAG " + JSON.stringify(await grabDiag()));
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
