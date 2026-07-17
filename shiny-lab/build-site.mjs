import { execSync } from "node:child_process";
import fs from "node:fs";

const DIR = "shiny-lab";
const ERA = "../er-assets";

const css = fs.readFileSync(`${DIR}/site/style.css`, "utf8");
const fxSrc = fs.readFileSync(`${DIR}/fx.mjs`, "utf8").replace(/^export /gm, "");
const exoticSrc = fs.readFileSync(`${DIR}/site/exotic.mjs`, "utf8").replace(/^export .*$/gm, "");
const appJs = fs.readFileSync(`${DIR}/site/app.js`, "utf8");
const effectsSrc = fs.readFileSync(`${DIR}/site/effects.mjs`, "utf8").replace(/^export /gm, "");

// pin the er-assets sha (jsDelivr serves cold files reliably only when pinned)
const sha = execSync(`git -C ${ERA} rev-parse HEAD`).toString().trim();
const CDN = `https://cdn.jsdelivr.net/gh/Heraklines/er-assets@${sha}/images/pokemon`;

// which base sprites exist (numeric <id>.png), national-dex range
const pokemonFiles = fs.readdirSync(`${ERA}/images/pokemon`);
const present = new Set(pokemonFiles.filter(f => /^\d+\.png$/.test(f)).map(f => +f.slice(0, -4)));

// form-only species: no numeric <id>.png, but <id>-<form>.png form sprites exist
// (Vivillon #666, the Deoxys/Rotom/Oricorio/... families). Collect the form stems
// so the picker can still list the species EXACTLY ONCE with a representative form
// sprite - without this the prev/next walk skips straight past them (665 -> 667).
const presentForms = {};
for (const f of pokemonFiles) {
  const m = /^(\d+)-(.+)\.png$/.exec(f);
  if (m) {
    (presentForms[+m[1]] ??= []).push(f.slice(0, -4));
  }
}

// dex -> name from the species enum (auto-incrementing: only anchors carry "= N")
const enumSrc = fs.readFileSync("src/enums/species-id.ts", "utf8");
const names = {};
const nameToId = {};
let enumVal = 0;
for (const line of enumSrc.split("\n")) {
  const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*(?:=\s*(\d+)\s*)?,/);
  if (!m) {
    continue;
  }
  enumVal = m[2] !== undefined ? +m[2] : enumVal + 1;
  if (!(m[1] in nameToId)) {
    nameToId[m[1]] = enumVal;
  }
  if (enumVal <= 1025 && !names[enumVal]) {
    names[enumVal] = m[1]
      .toLowerCase()
      .split("_")
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
}
// formIndex-0 form key per species (Vivillon -> "meadow"), so a form-only species
// defaults to its canonical form sprite rather than an arbitrary one.
const firstFormKey = {};
for (const chunk of fs.readFileSync("src/data/balance/pokemon-species.ts", "utf8").split("new PokemonSpecies(").slice(1)) {
  const idm = /^\s*SpeciesId\.([A-Z0-9_]+)/.exec(chunk);
  const id = idm && nameToId[idm[1]];
  if (!id || id in firstFormKey) {
    continue;
  }
  const fm = /new PokemonForm\(\s*"[^"]*",\s*"([^"]*)"/.exec(chunk);
  if (fm && fm[1]) {
    firstFormKey[id] = fm[1];
  }
}

const species = [];
for (let id = 1; id <= 1025; id++) {
  if (present.has(id)) {
    species.push({ i: id, n: names[id] || "No. " + id });
  } else if (presentForms[id]?.length) {
    // No base sprite, but form sprites exist: list once, defaulting to the
    // formIndex-0 form's sprite when published, else the first available form.
    const forms = presentForms[id];
    const preferred = firstFormKey[id] ? `${id}-${firstFormKey[id]}` : null;
    const stem = preferred && forms.includes(preferred) ? preferred : forms.slice().sort()[0];
    species.push({ i: id, n: names[id] || "No. " + id, f: stem });
  }
}

// evolution-line map (for the lineage exotic effects): { id: { p: prevId, n: [nextIds] } }
const evoSrc = fs.readFileSync("src/data/balance/pokemon-evolutions.ts", "utf8");
const evoBody = evoSrc.slice(evoSrc.indexOf("export const pokemonEvolutions"));
const evo = {};
for (const m of evoBody.matchAll(/\[SpeciesId\.([A-Z0-9_]+)\]:\s*\[([^]*?)\n  \]/g)) {
  const from = nameToId[m[1]];
  if (!from || from > 1025 || !present.has(from)) {
    continue;
  }
  const tos = [];
  for (const em of m[2].matchAll(/new Species(?:Form)?Evolution\(\s*SpeciesId\.([A-Z0-9_]+)/g)) {
    const to = nameToId[em[1]];
    if (to && to <= 1025 && to !== from && present.has(to) && !tos.includes(to)) {
      tos.push(to);
    }
  }
  if (tos.length > 0) {
    evo[from] = { ...(evo[from] || {}), n: tos };
  }
}
for (const [f, e] of Object.entries(evo)) {
  for (const t of e.n || []) {
    evo[t] = { ...(evo[t] || {}), p: +f };
  }
}

// species typing (for the type-derived exotic effects)
const speciesSrc = fs.readFileSync("src/data/balance/pokemon-species.ts", "utf8");
const types = {};
for (const m of speciesSrc.matchAll(
  /new PokemonSpecies\(\s*SpeciesId\.([A-Z0-9_]+),[^,]*,[^,]*,[^,]*,[^,]*,\s*"[^"]*",\s*PokemonType\.([A-Z]+),\s*(?:PokemonType\.([A-Z]+)|null)/g,
)) {
  const id = nameToId[m[1]];
  if (id && id <= 1025 && present.has(id) && !types[id]) {
    types[id] = m[3] ? [m[2], m[3]] : [m[2]];
  }
}

const data = { cdn: CDN, species, def: present.has(144) ? 144 : species[0].i, evo, types };
console.log(
  `species ${species.length} | evo ${Object.keys(evo).length} | types ${Object.keys(types).length} | sha ${sha.slice(0, 8)}`,
);

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
    <span><span class="dot exo"></span><b>Exotic</b> - multi-sprite layers around the mon</span>
    <span><span class="dot rig"></span><b>Form</b> - the body itself transforms</span>
    <span><span class="dot mom"></span><b>Moment</b> - auto-looping event sequences</span>
    <span class="hint">mix one of each - click tiles or use the dropdowns</span>
  </div>
</header>

<div class="labnav">
  <button id="openEffects" class="labnav-btn">&#9889;&nbsp; Effects</button>
  <span class="labnav-hint">preview the in-game effect bursts (transform, and more to come) on the partner Eeveelutions</span>
</div>

<div id="shinyView">
<section class="hero">
  <div id="stage" class="stage void">
    <div class="glow"></div>
    <canvas id="heroCanvas"></canvas>
    <canvas id="fxCanvas"></canvas>
    <div id="status" class="status"></div>
  </div>
  <div class="panel">
    <h2 id="heroName">Glacier</h2>
    <div class="controls">
      <div class="row"><label class="lp">Palette</label><select id="sel_palette" class="sel"></select></div>
      <div class="row"><label class="ls">Surface FX</label><select id="sel_surface" class="sel"></select></div>
      <div class="row"><label class="la">Around FX</label><select id="sel_around" class="sel"></select></div>
      <div class="row"><label class="lx">Exotic</label><select id="sel_exotic" class="sel"></select></div>
      <div class="row"><label class="lr">Form</label><select id="sel_rig" class="sel"></select></div>
      <div class="row"><label class="lm">Moment</label><select id="sel_moment" class="sel"></select></div>
      <div class="row"><label class="lp">Clustering</label><select id="sel_cluster" class="sel" title="How the cluster palettes segment the sprite's colors"></select></div>
      <div class="row"><label>Speed (master)</label><input id="speed" type="range" min="0.1" max="3" step="0.05" value="1"></div>
      <div class="row"><label class="lp">Pal amount</label><input id="int_palette" type="range" min="0" max="1" step="0.02" value="1"></div>
      <div class="row"><label class="ls">Surf amount</label><input id="int_surface" type="range" min="0" max="1" step="0.02" value="1"></div>
      <div class="row"><label class="la">Aura amount</label><input id="int_around" type="range" min="0" max="1" step="0.02" value="1"></div>
      <div class="row"><label>Protect</label>
        <label class="check"><input id="protectBlack" class="chk" type="checkbox">Black</label>
        <label class="check"><input id="protectWhite" class="chk" type="checkbox">White</label>
      </div>
      <div class="row"><label>GBC colors</label>
        <label class="check"><input id="gbcSnap" class="chk" type="checkbox">snap FX to the GBC gamut (RGB555)</label>
      </div>
      <div class="subhead ls">Surface FX params</div>
      <div class="row"><label class="ls">Speed</label><input id="surf_speed" type="range" min="0" max="3" step="0.05" value="1"></div>
      <div class="row"><label class="ls">Seed</label><input id="surf_seed" type="range" min="0" max="256" step="1" value="0"><button id="surf_seedRand" class="mini" title="Randomize seed">&#127922;</button></div>
      <div class="row"><label class="ls">Texture noise</label><input id="surf_tex" type="range" min="0.4" max="2" step="0.05" value="1"></div>
      <div class="row"><label class="ls">Color</label>
        <div class="seg" id="tintSeg_surf"><button class="on" data-tint="default">Default</button><button data-tint="palette">Palette</button><button data-tint="custom">Custom</button></div>
        <input id="fxcolor_surf" type="color" value="#ff66cc" class="colorin" style="display:none">
      </div>
      <div class="subhead la">Around FX params</div>
      <div class="row"><label class="la">Speed</label><input id="aro_speed" type="range" min="0" max="3" step="0.05" value="1"></div>
      <div class="row"><label class="la">Seed</label><input id="aro_seed" type="range" min="0" max="256" step="1" value="0"><button id="aro_seedRand" class="mini" title="Randomize seed">&#127922;</button></div>
      <div class="row"><label class="la">Texture noise</label><input id="aro_tex" type="range" min="0.4" max="2" step="0.05" value="1"></div>
      <div class="row"><label class="la">Color</label>
        <div class="seg" id="tintSeg_aro"><button class="on" data-tint="default">Default</button><button data-tint="palette">Palette</button><button data-tint="custom">Custom</button></div>
        <input id="fxcolor_aro" type="color" value="#66ccff" class="colorin" style="display:none">
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
<div class="section-title"><h3>Exotic (multi-sprite)</h3><span class="cnt"><span id="exoCount"></span></span><span>layered copies of the full look around the mon - depth orbits, time echoes, companions</span></div>
<div class="grid" id="exoGrid"></div>
<div class="section-title"><h3>Form</h3><span class="cnt"><span id="rigCount"></span></span><span>the body itself transforms - fake 3D, materials, lineage recolors (one at a time, stacks with everything else)</span></div>
<div class="grid" id="rigGrid"></div>
<div class="section-title"><h3>Moments</h3><span class="cnt"><span id="momCount"></span></span><span>finite event sequences that loop automatically - watch a few seconds</span></div>
<div class="grid" id="momGrid"></div>
</div>

<section id="effectsLab" class="effects-lab" style="display:none">
  <div class="fx-head">
    <button id="fxBack" class="fxback">&#8592;&nbsp; Back to Shiny Tools</button>
    <h2><span class="ar">Effects</span> Lab</h2>
    <p class="fx-sub">Category based previews of the in-game effects. First category: <b>Transformation Effects</b> -
      the full transform sequence between partner Eeveelutions (fill, silhouette shape morph, then the per-type
      burst on reveal), front and back. More categories (ability effects, move effects) plug in here later.</p>
  </div>
  <div class="fx-cats" id="fxCats"></div>
  <div class="fx-body" id="fxBody"></div>
</section>

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
${exoticSrc}
${appJs}
${effectsSrc}
</script>
</body>
</html>`;

fs.mkdirSync(`${DIR}/dist`, { recursive: true });
fs.writeFileSync(`${DIR}/articuno-shiny-lab.html`, html);
fs.writeFileSync(`${DIR}/dist/index.html`, html);
console.log(`wrote articuno-shiny-lab.html + dist/index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
