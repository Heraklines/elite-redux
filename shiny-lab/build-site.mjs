import { execSync } from "node:child_process";
import fs from "node:fs";

const DIR = "shiny-lab";
const ERA = "../er-assets";

const css = fs.readFileSync(`${DIR}/site/style.css`, "utf8");
const fxSrc = fs.readFileSync(`${DIR}/fx.mjs`, "utf8").replace(/^export /gm, "");
const appJs = fs.readFileSync(`${DIR}/site/app.js`, "utf8");

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

// dex -> name from the species enum
const enumSrc = fs.readFileSync("src/enums/species-id.ts", "utf8");
const names = {};
for (const m of enumSrc.matchAll(/^\s*([A-Z0-9_]+)\s*=\s*(\d+),/gm)) {
  const id = +m[2];
  if (id <= 1025 && !names[id]) {
    names[id] = m[1]
      .toLowerCase()
      .split("_")
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
}
const species = [];
for (let id = 1; id <= 1025; id++) {
  if (present.has(id)) {
    species.push({ i: id, n: names[id] || "No. " + id });
  }
}

const data = { cdn: CDN, species, def: present.has(144) ? 144 : species[0].i };
console.log(`species ${species.length} | sha ${sha.slice(0, 8)}`);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shiny Lab - Elite Redux</title>
<style>
${css}
</style>
</head>
<body>
<header>
  <div class="topbar">
    <h1><span class="ar">Shiny</span> Lab</h1>
    <div class="picker">
      <button id="monPrev" title="Previous">&#8592;</button>
      <input id="mon" list="monlist" placeholder="search any Pokemon..." autocomplete="off">
      <datalist id="monlist"></datalist>
      <button id="monNext" title="Next">&#8594;</button>
      <button id="monRand" title="Random">&#127922;</button>
    </div>
  </div>
  <div class="legend">
    <span><span class="dot pal"></span><b>Palette</b> - crossplay-safe recolor</span>
    <span><span class="dot aura"></span><b>Surface FX</b> - on-sprite aura</span>
    <span><span class="dot aro"></span><b>Around FX</b> - aura around the mon (some partial)</span>
    <span class="hint">mix one of each - click tiles or use the dropdowns</span>
  </div>
</header>

<section class="hero">
  <div id="stage" class="stage void">
    <div class="glow"></div>
    <canvas id="heroCanvas"></canvas>
    <div id="status" class="status"></div>
  </div>
  <div class="panel">
    <h2 id="heroName">Glacier</h2>
    <div class="controls">
      <div class="row"><label class="lp">Palette</label><select id="sel_palette" class="sel"></select></div>
      <div class="row"><label class="ls">Surface FX</label><select id="sel_surface" class="sel"></select></div>
      <div class="row"><label class="la">Around FX</label><select id="sel_around" class="sel"></select></div>
      <div class="row"><label>Speed</label><input id="speed" type="range" min="0.1" max="3" step="0.05" value="1"></div>
      <div class="row"><label class="lp">Pal amount</label><input id="int_palette" type="range" min="0" max="1" step="0.02" value="1"></div>
      <div class="row"><label class="ls">Surf amount</label><input id="int_surface" type="range" min="0" max="1" step="0.02" value="1"></div>
      <div class="row"><label class="la">Aura amount</label><input id="int_around" type="range" min="0" max="1" step="0.02" value="1"></div>
      <div class="row"><label>Seed</label><input id="seed" type="range" min="0" max="256" step="1" value="0"><button id="seedRand" class="mini" title="Randomize seed">&#127922;</button></div>
      <div class="row"><label>Texture</label><input id="texscale" type="range" min="0.4" max="2" step="0.05" value="1"></div>
      <div class="row"><label>FX color</label>
        <div class="seg" id="tintSeg"><button class="on" data-tint="default">Default</button><button data-tint="palette">Palette</button><button data-tint="custom">Custom</button></div>
        <input id="fxcolor" type="color" value="#ff66cc" class="colorin" style="display:none">
      </div>
      <div class="row"><label>Backdrop</label>
        <div class="seg" id="bgSeg">
          <button class="on" data-bg="void">Void</button><button data-bg="mid">Nebula</button>
          <button data-bg="snow">Snow</button><button data-bg="checker">Checker</button>
        </div>
      </div>
      <div class="actions"><button id="clear">Clear</button><button id="surprise" class="surprise">Surprise me</button></div>
    </div>
  </div>
</section>

<div class="section-title"><h3>Palette</h3><span class="cnt"><span id="palCount"></span></span><span>pure color - in-game = the 32-slot variant swap, crossplay-safe</span></div>
<div class="grid" id="palGrid"></div>
<div class="section-title"><h3>Surface FX</h3><span class="cnt"><span id="surfCount"></span></span><span>animated on-sprite shaders - local overlay</span></div>
<div class="grid" id="surfGrid"></div>
<div class="section-title"><h3>Around FX</h3><span class="cnt"><span id="aroCount"></span></span><span>auras around the mon - glow, flames, orbits, backdrops (some partial)</span></div>
<div class="grid" id="aroGrid"></div>

<footer>
  Prototype for the Elite Redux special-form shiny system. Sprites stream from the er-assets CDN (jsDelivr, pinned sha) like the game.
  <b>Palette</b> is a deterministic function of color, so in-game it is the same 32-slot variant palette swap the engine already runs
  - ~5 bytes in a ghost snapshot, identical on every client. <b>Surface FX</b> and <b>Around FX</b> are animated overlays (keyed to
  position / time / an edge or distance field), so they stay local cosmetics (or can be server-keyed). Rendered at each sprite's
  native resolution on a padded canvas and upscaled with nearest-neighbour.
</footer>

<script>window.LAB = ${JSON.stringify(data)};</script>
<script>
${fxSrc}
${appJs}
</script>
</body>
</html>`;

fs.mkdirSync(`${DIR}/dist`, { recursive: true });
fs.writeFileSync(`${DIR}/articuno-shiny-lab.html`, html);
fs.writeFileSync(`${DIR}/dist/index.html`, html);
console.log(`wrote articuno-shiny-lab.html + dist/index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
