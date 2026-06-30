import { execSync } from "node:child_process";
import fs from "node:fs";

const DIR = "fusion-lab";
const ERA = "../er-assets";

const css = fs.readFileSync(`${DIR}/site/style.css`, "utf8");
const fusionSrc = fs.readFileSync(`${DIR}/fusion.mjs`, "utf8").replace(/^export /gm, "");
const appJs = fs.readFileSync(`${DIR}/site/app.js`, "utf8");

// Pluggable strategies: each fusion-lab/strategies/<id>.mjs is a standalone ESM
// module (real import/export so it is node-testable in isolation) that pushes
// itself into the shared STRATEGIES registry. At build time we inline every
// strategies/*.mjs (sorted, EXCLUDING *.test.mjs) AFTER fusion.mjs (so the
// primitives + the STRATEGIES global exist) and BEFORE app.js (which reads it),
// applying the same treatment fusion.mjs gets: drop the `import ... from ...`
// lines (the symbols are already globals once fusion.mjs is inlined) and strip
// the leading `export ` keyword.
const stratDir = `${DIR}/strategies`;
const stratFiles = fs.existsSync(stratDir)
  ? fs
      .readdirSync(stratDir)
      .filter(f => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
      .sort()
  : [];
const strategiesSrc = stratFiles
  .map(f =>
    fs
      .readFileSync(`${stratDir}/${f}`, "utf8")
      .replace(/^\s*import\b.*\bfrom\b.*;?\s*$/gm, "")
      .replace(/^export /gm, ""),
  )
  .join("\n");

// pin the er-assets sha (jsDelivr serves cold files reliably only when pinned)
const sha = execSync(`git -C ${ERA} rev-parse HEAD`).toString().trim();
const CDN = `https://cdn.jsdelivr.net/gh/Heraklines/er-assets@${sha}/images/pokemon`;

// which base sprites exist (numeric <id>.png), national-dex range
const present = new Set(
  fs
    .readdirSync(`${ERA}/images/pokemon`)
    .filter(f => /^\d+\.png$/.test(f))
    .map(f => +f.slice(0, -4)),
);

// dex -> slug from the species enum. The enum is `BULBASAUR = 1,` then AUTO-INCREMENTS
// (`IVYSAUR,` `VENUSAUR,` ...), so walk members in order tracking a running `cur`: an
// explicit `= N` sets it, otherwise it is the previous + 1. Record the FIRST slug seen
// for each national-dex id so base species win over later form members (Alola/Galar/etc).
const enumSrc = fs.readFileSync("src/enums/species-id.ts", "utf8");
const dexToSlug = {};
let cur = 0;
for (const m of enumSrc.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*(?:=\s*(\d+))?\s*,/gm)) {
  cur = m[2] === undefined ? cur + 1 : +m[2];
  if (cur <= 1025 && dexToSlug[cur] === undefined) {
    dexToSlug[cur] = m[1].toLowerCase();
  }
}

// dex -> display name: prefer the i18n table, else a title-cased slug, else "No. <dex>"
const loc = JSON.parse(fs.readFileSync("locales/en/pokemon.json", "utf8"));
const nameOf = dex => {
  const slug = dexToSlug[dex];
  if (slug && loc[slug]) {
    return loc[slug];
  }
  if (slug) {
    return slug
      .split("_")
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return "No. " + dex;
};
const species = [];
for (let id = 1; id <= 1025; id++) {
  if (present.has(id)) {
    species.push({ i: id, n: nameOf(id) });
  }
}

const data = { cdn: CDN, species, def: present.has(144) ? 144 : species[0].i };
console.log(`species ${species.length} | sha ${sha.slice(0, 8)} | strategies/ ${stratFiles.length}`);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fusion Lab - Elite Redux</title>
<style>
${css}
</style>
</head>
<body>
<header>
  <div class="topbar">
    <h1><span class="ar">Fusion</span> Lab</h1>
    <div class="pickers">
      <div class="picker">
        <span class="picker-label">A &middot; head</span>
        <button id="monPrevA" title="Previous">&#8592;</button>
        <input id="monA" list="monlistA" placeholder="head donor..." autocomplete="off">
        <datalist id="monlistA"></datalist>
        <button id="monNextA" title="Next">&#8594;</button>
        <button id="monRandA" title="Random">&#127922;</button>
      </div>
      <div class="picker">
        <span class="picker-label">B &middot; body</span>
        <button id="monPrevB" title="Previous">&#8592;</button>
        <input id="monB" list="monlistB" placeholder="body donor..." autocomplete="off">
        <datalist id="monlistB"></datalist>
        <button id="monNextB" title="Next">&#8594;</button>
        <button id="monRandB" title="Random">&#127922;</button>
      </div>
    </div>
  </div>
  <div class="toolbar">
    <label class="tb-label" for="strategy">Strategy</label>
    <select id="strategy"></select>
    <button id="fuseBtn">Fuse</button>
    <button id="randPair">Random pair</button>
  </div>
</header>

<section class="hero">
  <div id="stage" class="stage">
    <figure class="canvas-wrap a">
      <div class="canvas-frame"><canvas id="canvasA"></canvas></div>
      <figcaption>A &middot; head donor</figcaption>
    </figure>
    <figure class="canvas-wrap b">
      <div class="canvas-frame"><canvas id="canvasB"></canvas></div>
      <figcaption>B &middot; body donor</figcaption>
    </figure>
    <figure class="canvas-wrap res">
      <div class="canvas-frame"><canvas id="canvasResult"></canvas></div>
      <figcaption>Fused result</figcaption>
    </figure>
  </div>
  <div id="params" class="params"></div>
</section>

<section id="debug" class="debug"></section>
<section id="compare" class="compare"></section>

<footer>
  Prototype testbed for the Elite Redux sprite-fusion algorithm. Pick a head donor (A) and a body
  donor (B); each strategy in <b>fusion.mjs</b> fuses them and emits named debug layers for A/B
  comparison. Sprites stream from the er-assets CDN (jsDelivr, pinned sha) like the game - no
  bundled assets. Rendered at native resolution and upscaled with nearest-neighbour.
</footer>

<script>window.LAB = ${JSON.stringify(data)};</script>
<script>
${fusionSrc}
${strategiesSrc}
${appJs}
</script>
</body>
</html>`;

fs.mkdirSync(`${DIR}/dist`, { recursive: true });
fs.writeFileSync(`${DIR}/dist/index.html`, html);
console.log(`wrote dist/index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
