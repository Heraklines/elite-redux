import { DexAttr } from "#enums/dex-attr";

export type ErShinyLabCategory = "palette" | "surface" | "around";
export type ErShinyLabRarity = "common" | "rare" | "epic" | "legendary";
export type ErShinyLabEffectState =
  | "equipped"
  | "owned"
  | "buyable"
  | "locked-tier"
  | "locked-achv"
  | "locked-candy";

export interface ErShinyLabEffect {
  id: string;
  label: string;
  category: ErShinyLabCategory;
  rarity: ErShinyLabRarity;
  minTier: number;
  cost: number;
  accent: string;
  lockHint?: string;
}

export interface ErShinyLabEffectDefinition extends Omit<ErShinyLabEffect, "cost"> {
  index: number;
  baseCost: number;
  stepCost: number;
}

export interface ErShinyLabLoadout {
  palette: string | null;
  surface: string | null;
  around: string | null;
}

export interface ErShinyLabParams {
  palAmt: number;
  surfAmt: number;
  aroAmt: number;
  scale: number;
  seed: number;
  tintMode: number;
}

export interface ErShinyLabPreset {
  loadout: ErShinyLabLoadout;
  params: ErShinyLabParams;
}

export interface ErShinyLabConfig {
  speciesId: number;
  speciesName: string;
  earnedTier: number;
  candy: number;
  effects: Record<ErShinyLabCategory, ErShinyLabEffect[]>;
  owned: Record<ErShinyLabCategory, Set<string>>;
  available: Set<string>;
  equipped: ErShinyLabLoadout;
  params: ErShinyLabParams;
  presets: (ErShinyLabPreset | null)[];
  onChange?: (loadout: ErShinyLabLoadout, params: ErShinyLabParams) => void;
  onBuy?: (category: ErShinyLabCategory, effect: ErShinyLabEffect) => void;
  onExit?: () => void;
}

export type ErShinyLabSavedLoadout = [number, number, number];
export type ErShinyLabSavedParams = [number, number, number, number, number, number];
export type ErShinyLabSavedPreset = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type ErShinyLabSavedLook = ErShinyLabSavedPreset;

export interface ErShinyLabOwnedBitsets {
  p?: number[];
  s?: number[];
  a?: number[];
}

export interface ErShinyLabSaveData {
  /** Owned effect bitsets keyed by p/s/a. */
  o?: ErShinyLabOwnedBitsets;
  /** Equipped effect indexes, 0 means none and N means registry index N - 1. */
  l?: ErShinyLabSavedLoadout;
  /** Byte-quantized params: pal, surface, aura, scale, seed, tintMode. */
  q?: ErShinyLabSavedParams;
  /** Five preset slots: loadout indexes followed by six quantized params. */
  r?: (ErShinyLabSavedPreset | null)[];
}

export const ER_SHINY_LAB_CATEGORIES = ["palette", "surface", "around"] as const;

export const ER_SHINY_LAB_CATEGORY_MIN_TIER: Record<ErShinyLabCategory, number> = {
  palette: 1,
  surface: 3,
  around: 4,
};

export const ER_SHINY_LAB_CATEGORY_BASE_COST: Record<ErShinyLabCategory, number> = {
  palette: 100,
  surface: 500,
  around: 1000,
};

export const ER_SHINY_LAB_CATEGORY_STEP_COST: Record<ErShinyLabCategory, number> = {
  palette: 40,
  surface: 120,
  around: 200,
};

export const ER_SHINY_LAB_DEFAULT_PARAMS: ErShinyLabParams = {
  palAmt: 1,
  surfAmt: 1,
  aroAmt: 1,
  scale: 1,
  seed: 0,
  tintMode: 0,
};

const CATEGORY_SAVE_KEY: Record<ErShinyLabCategory, keyof ErShinyLabOwnedBitsets> = {
  palette: "p",
  surface: "s",
  around: "a",
};

const PALETTE_IDS = [
  "glacier",
  "aurum",
  "obsidian",
  "chrome",
  "amethyst",
  "inferno",
  "toxic",
  "rosequartz",
  "verdigris",
  "spectral",
  "negative",
  "void",
  "shadowflame",
  "iridescent",
  "thermal",
  "sepia",
  "copper",
  "emerald",
  "sapphire",
  "comic",
  "synthwave",
  "onyxgold",
  "ultraviolet",
  "acid",
  "bubblegum",
  "blood",
  "abyss",
  "antique",
  "frostfire",
  "camo",
  "jade",
  "rosegold",
  "mono",
  "prismarine",
  "nebula",
  "venom",
  "solarflare",
  "royal",
  "deepsea",
  "sakura",
  "mythril",
  "cursed",
  "pearl",
  "rust",
  "moonstone",
  "oilspill",
  "plasmatic",
  "duoink",
  "duoneon",
  "duomono",
  "duoblood",
  "duomint",
  "duosunset",
  "duomecha",
  "trisunset",
  "triforest",
  "quadvapor",
  "pentacandy",
  "pentajewel",
  "synthwavesun",
  "sunset",
  "gameboy",
  "retro",
] as const;

const SURFACE_IDS = [
  "rainbow",
  "aurora",
  "holofoil",
  "prismatic",
  "frostbite",
  "glitch",
  "hologram",
  "galaxy",
  "plasma",
  "molten",
  "electric",
  "dissolve",
  "mercury",
  "lavacracks",
  "frozenice",
  "crystalfacets",
  "stainedglass",
  "marble",
  "bioluminescent",
  "constellation",
  "aurorawings",
  "gildededges",
  "rimlight",
  "vaporwave",
  "halftone",
  "sparkle",
  "lightningveins",
  "dripgold",
  "spectrumsplit",
  "ripple",
  "circuit",
  "scales",
  "tvstatic",
  "scansweep",
  "poison",
  "kaleido",
  "fractalflow",
  "wormhole",
  "shatter",
  "heatshimmer",
  "caustics",
  "oilfilm",
  "pixelpulse",
  "neonwire",
  "starmap",
  "synthscan",
  "rainbowedge",
  "sunsetsun",
  "crosshatch",
  "tron",
] as const;

const AROUND_IDS = [
  "outline",
  "halo",
  "flame",
  "shadowfire",
  "frost",
  "efield",
  "rings",
  "orbit",
  "auroraveil",
  "holyrays",
  "cosmos",
  "smoke",
  "radiant",
  "embers",
  "snow",
  "bubbles",
  "wingflame",
  "footfrost",
  "crown",
  "underlight",
  "uprising",
  "topbeam",
  "sideaura",
  "magiccircle",
  "vortex",
  "galaxyspiral",
  "fireflies",
  "petals",
  "rain",
  "sparkstorm",
  "prismburst",
  "icespikes",
  "rainbowglitter",
  "luminous",
  "cursedaura",
  "goldenglow",
  "shadowaura",
  "rainbowoutline",
  "triangles",
  "hexagons",
  "hearts",
  "staticfield",
] as const;

const LABELS: Record<string, string> = {
  rosequartz: "Rose Quartz",
  shadowflame: "Shadowflame",
  onyxgold: "Onyx Gold",
  frostfire: "Frostfire",
  rosegold: "Rose Gold",
  solarflare: "Solar Flare",
  deepsea: "Deep Sea",
  oilspill: "Oil Spill",
  duoink: "Duo Ink",
  duoneon: "Duo Neon",
  duomono: "Duo Mono",
  duoblood: "Duo Blood",
  duomint: "Duo Mint",
  duosunset: "Duo Sunset",
  duomecha: "Duo Mecha",
  trisunset: "Tri Sunset",
  triforest: "Tri Forest",
  quadvapor: "Quad Vapor",
  pentacandy: "Penta Candy",
  pentajewel: "Penta Jewel",
  synthwavesun: "Synthwave Sun",
  holofoil: "Holo Foil",
  lavacracks: "Lava Cracks",
  frozenice: "Frozen Ice",
  crystalfacets: "Crystal Facets",
  stainedglass: "Stained Glass",
  aurorawings: "Aurora Wings",
  gildededges: "Gilded Edges",
  rimlight: "Rim Light",
  lightningveins: "Lightning Veins",
  dripgold: "Dripping Gold",
  spectrumsplit: "Prism Split",
  tvstatic: "TV Static",
  scansweep: "Scan Sweep",
  fractalflow: "Fractal Flow",
  heatshimmer: "Heat Shimmer",
  oilfilm: "Oil Film",
  pixelpulse: "Pixel Pulse",
  neonwire: "Neon Wire",
  starmap: "Star Map",
  synthscan: "Synth Scan",
  rainbowedge: "Rainbow Edge",
  sunsetsun: "Sunset Sun",
  crosshatch: "Crosshatch",
  shadowfire: "Shadow Fire",
  efield: "Electric Field",
  auroraveil: "Aurora Veil",
  holyrays: "Holy Light",
  wingflame: "Wing Flame",
  footfrost: "Foot Frost",
  underlight: "Underlight",
  topbeam: "Top Beam",
  sideaura: "Side Aura",
  magiccircle: "Magic Circle",
  galaxyspiral: "Galaxy Spiral",
  sparkstorm: "Spark Storm",
  prismburst: "Prism Burst",
  icespikes: "Ice Spikes",
  rainbowglitter: "Rainbow Glitter",
  cursedaura: "Cursed Aura",
  goldenglow: "Golden Glow",
  shadowaura: "Shadow Aura",
  rainbowoutline: "Rainbow Outline",
  staticfield: "Static Field",
  mono: "Monochrome",
  void: "Void Bloom",
  comic: "Cel Comic",
  poison: "Toxic Bubbles",
  orbit: "Orbiting Sparks",
  halo: "Soft Halo",
  outline: "Outline Glow",
  rings: "Energy Rings",
  cosmos: "Cosmic Backdrop",
  radiant: "Radiant Burst",
};

const LOCK_HINTS: Record<string, string> = {
  aurum: "clear Midas",
  toxic: "clear Going Nuclear",
  frostbite: "clear Cold Open",
  spectrumsplit: "clear Prism Break",
  poison: "clear Going Nuclear",
  flame: "clear Midas",
  frost: "clear Cold Open",
  cosmos: "clear Eclipse",
  goldenglow: "clear Midas",
  shadowaura: "clear Eclipse",
  rainbowoutline: "clear Untouchable",
};

const ACCENTS: Record<string, string> = {
  glacier: "#7fd8ff",
  aurum: "#ffcf52",
  obsidian: "#2a2a3a",
  chrome: "#d7e2f0",
  amethyst: "#b06cff",
  inferno: "#ff6a24",
  toxic: "#9bff4a",
  rosequartz: "#ff9ac8",
  verdigris: "#72d0a8",
  spectral: "#9fefff",
  negative: "#e6e6f2",
  void: "#ff6ad5",
  shadowflame: "#ff52d9",
  iridescent: "#a0e0ff",
  thermal: "#ff7a3a",
  emerald: "#3affa0",
  sapphire: "#4a8dff",
  synthwave: "#ff2a8a",
  onyxgold: "#ffdc72",
  ultraviolet: "#ba6cff",
  acid: "#caff3a",
  bubblegum: "#ff8ad0",
  blood: "#e8404a",
  abyss: "#1f9ad0",
  frostfire: "#ff8a2a",
  prismarine: "#5fe0c0",
  nebula: "#d04ad0",
  venom: "#6ad020",
  solarflare: "#ffd040",
  royal: "#d0a030",
  deepsea: "#1fb0d0",
  sakura: "#ffd0e0",
  mythril: "#c0d8f0",
  cursed: "#9aff3a",
  pearl: "#f0f8ff",
  rust: "#b56a2a",
  moonstone: "#dbe8ff",
  oilspill: "#70d0ff",
  plasmatic: "#ff8a00",
  rainbow: "#ff7ad9",
  aurora: "#5affc0",
  holofoil: "#7fe0ff",
  prismatic: "#d0e8ff",
  glitch: "#36e6ff",
  hologram: "#74c8ff",
  galaxy: "#9b6cff",
  plasma: "#ff6ad9",
  molten: "#ff7a3a",
  electric: "#ffe85a",
  mercury: "#dfe6f2",
  frost: "#a6f0ff",
  flame: "#ff7a3a",
  shadowfire: "#9b6cff",
  goldenglow: "#ffcf52",
  shadowaura: "#9b6cff",
  rainbowoutline: "#a0e0ff",
};

function labelFor(id: string): string {
  return LABELS[id] ?? `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`;
}

function rarityFor(index: number, count: number, locked: boolean): ErShinyLabRarity {
  if (locked) {
    return index > count * 0.75 ? "legendary" : "epic";
  }
  const t = (index + 1) / count;
  if (t > 0.9) {
    return "legendary";
  }
  if (t > 0.7) {
    return "epic";
  }
  if (t > 0.45) {
    return "rare";
  }
  return "common";
}

function makeDefinitions(ids: readonly string[], category: ErShinyLabCategory): ErShinyLabEffectDefinition[] {
  return ids.map((id, index) => {
    const lockHint = LOCK_HINTS[id];
    return {
      id,
      label: labelFor(id),
      category,
      rarity: rarityFor(index, ids.length, !!lockHint),
      minTier: ER_SHINY_LAB_CATEGORY_MIN_TIER[category],
      baseCost: ER_SHINY_LAB_CATEGORY_BASE_COST[category],
      stepCost: ER_SHINY_LAB_CATEGORY_STEP_COST[category],
      accent: ACCENTS[id] ?? (category === "palette" ? "#5ad1ff" : category === "surface" ? "#ff7ad9" : "#ffd27a"),
      index,
      ...(lockHint ? { lockHint } : {}),
    };
  });
}

export const ER_SHINY_LAB_EFFECT_DEFS: ErShinyLabEffectDefinition[] = [
  ...makeDefinitions(PALETTE_IDS, "palette"),
  ...makeDefinitions(SURFACE_IDS, "surface"),
  ...makeDefinitions(AROUND_IDS, "around"),
];

export const ER_SHINY_LAB_EFFECTS_BY_CATEGORY: Record<ErShinyLabCategory, ErShinyLabEffectDefinition[]> = {
  palette: ER_SHINY_LAB_EFFECT_DEFS.filter(e => e.category === "palette"),
  surface: ER_SHINY_LAB_EFFECT_DEFS.filter(e => e.category === "surface"),
  around: ER_SHINY_LAB_EFFECT_DEFS.filter(e => e.category === "around"),
};

export const ER_SHINY_LAB_EFFECT_INDEX = new Map(ER_SHINY_LAB_EFFECT_DEFS.map(e => [e.id, e]));

export function getErShinyLabDefinition(category: ErShinyLabCategory, id: string | null): ErShinyLabEffectDefinition | null {
  if (!id) {
    return null;
  }
  const def = ER_SHINY_LAB_EFFECT_INDEX.get(id);
  return def?.category === category ? def : null;
}

export function resolveErShinyLabEffectState(args: {
  effect: ErShinyLabEffect;
  category: ErShinyLabCategory;
  earnedTier: number;
  candy: number;
  owned: Record<ErShinyLabCategory, Set<string>>;
  available: Set<string>;
  equipped: ErShinyLabLoadout;
}): ErShinyLabEffectState {
  const { effect, category, earnedTier, candy, owned, available, equipped } = args;
  if (equipped[category] === effect.id) {
    return "equipped";
  }
  if (owned[category].has(effect.id)) {
    return "owned";
  }
  if (earnedTier < effect.minTier) {
    return "locked-tier";
  }
  if (effect.lockHint && !available.has(effect.id)) {
    return "locked-achv";
  }
  return candy >= effect.cost ? "buyable" : "locked-candy";
}

export function getErShinyLabEarnedTier(caughtAttr: bigint, hasBlackShiny: boolean): number {
  if (hasBlackShiny) {
    return 4;
  }
  if (!(caughtAttr & DexAttr.SHINY)) {
    return 0;
  }
  if (caughtAttr & DexAttr.VARIANT_3) {
    return 3;
  }
  if (caughtAttr & DexAttr.VARIANT_2) {
    return 2;
  }
  return 1;
}

function hashText(seed: number, text: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function getErShinyLabDiscountedEffects(speciesId: number, category: ErShinyLabCategory): Set<string> {
  const candidates = ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category].filter(e => !e.lockHint);
  return new Set(
    candidates
      .map(e => ({ id: e.id, score: hashText(speciesId, `${category}:${e.id}`) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, Math.min(3, candidates.length))
      .map(e => e.id),
  );
}

export function getErShinyLabEffectCost(args: {
  definition: ErShinyLabEffectDefinition;
  ownedCount: number;
  globallyAvailable: boolean;
  speciesDiscounted: boolean;
}): number {
  const { definition, ownedCount, globallyAvailable, speciesDiscounted } = args;
  const rampPrice = definition.baseCost + ownedCount * definition.stepCost;
  if (definition.lockHint && globallyAvailable) {
    return Math.max(1, Math.floor(rampPrice * 0.5));
  }
  if (speciesDiscounted) {
    return Math.max(1, Math.floor(rampPrice * 0.6));
  }
  return rampPrice;
}

function byte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function normalizeErShinyLabBitset(bits: readonly number[] | undefined): number[] {
  return (bits ?? []).map(byte);
}

export function hasErShinyLabBit(bits: readonly number[] | undefined, index: number): boolean {
  if (index < 0) {
    return false;
  }
  const bytes = bits ?? [];
  const byteIndex = Math.floor(index / 8);
  const mask = 1 << index % 8;
  return ((bytes[byteIndex] ?? 0) & mask) !== 0;
}

export function setErShinyLabBit(bits: number[] | undefined, index: number): number[] {
  const next = normalizeErShinyLabBitset(bits);
  const byteIndex = Math.floor(index / 8);
  while (next.length <= byteIndex) {
    next.push(0);
  }
  next[byteIndex] = byte(next[byteIndex] | (1 << index % 8));
  return next;
}

export function getErShinyLabOwnedBitset(save: ErShinyLabSaveData | undefined, category: ErShinyLabCategory): number[] {
  return normalizeErShinyLabBitset(save?.o?.[CATEGORY_SAVE_KEY[category]]);
}

export function setErShinyLabOwnedBit(
  save: ErShinyLabSaveData,
  category: ErShinyLabCategory,
  index: number,
): void {
  const key = CATEGORY_SAVE_KEY[category];
  save.o ??= {};
  save.o[key] = setErShinyLabBit(save.o[key], index);
}

export function getErShinyLabOwnedSet(
  save: ErShinyLabSaveData | undefined,
  category: ErShinyLabCategory,
): Set<string> {
  const set = new Set<string>();
  const bits = getErShinyLabOwnedBitset(save, category);
  for (const def of ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category]) {
    if (hasErShinyLabBit(bits, def.index)) {
      set.add(def.id);
    }
  }
  return set;
}

export function bitsetToErShinyLabAvailableSet(bits: readonly number[] | undefined): Set<string> {
  const set = new Set<string>();
  const bytes = normalizeErShinyLabBitset(bits);
  for (const def of ER_SHINY_LAB_EFFECT_DEFS) {
    if (def.lockHint && hasErShinyLabBit(bytes, def.index)) {
      set.add(def.id);
    }
  }
  return set;
}

export function erShinyLabAvailableSetToBitset(set: ReadonlySet<string>): number[] {
  let bits: number[] = [];
  for (const id of set) {
    const def = ER_SHINY_LAB_EFFECT_INDEX.get(id);
    if (def?.lockHint) {
      bits = setErShinyLabBit(bits, def.index);
    }
  }
  return bits;
}

function encodeEffectIndex(category: ErShinyLabCategory, id: string | null): number {
  const def = getErShinyLabDefinition(category, id);
  return def ? def.index + 1 : 0;
}

function decodeEffectIndex(category: ErShinyLabCategory, value: number | undefined): string | null {
  if (!value) {
    return null;
  }
  return ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category][value - 1]?.id ?? null;
}

export function encodeErShinyLabLoadout(loadout: ErShinyLabLoadout): ErShinyLabSavedLoadout {
  return [
    encodeEffectIndex("palette", loadout.palette),
    encodeEffectIndex("surface", loadout.surface),
    encodeEffectIndex("around", loadout.around),
  ];
}

export function decodeErShinyLabLoadout(saved: readonly number[] | undefined): ErShinyLabLoadout {
  return {
    palette: decodeEffectIndex("palette", saved?.[0]),
    surface: decodeEffectIndex("surface", saved?.[1]),
    around: decodeEffectIndex("around", saved?.[2]),
  };
}

export function encodeErShinyLabParams(params: ErShinyLabParams): ErShinyLabSavedParams {
  return [
    byte(params.palAmt * 255),
    byte(params.surfAmt * 255),
    byte(params.aroAmt * 255),
    byte(((params.scale - 0.4) / 1.6) * 255),
    byte(params.seed),
    byte(params.tintMode),
  ];
}

export function decodeErShinyLabParams(saved: readonly number[] | undefined): ErShinyLabParams {
  if (!saved) {
    return { ...ER_SHINY_LAB_DEFAULT_PARAMS };
  }
  return {
    palAmt: byte(saved[0] ?? 255) / 255,
    surfAmt: byte(saved[1] ?? 255) / 255,
    aroAmt: byte(saved[2] ?? 255) / 255,
    scale: 0.4 + (byte(saved[3] ?? 96) / 255) * 1.6,
    seed: byte(saved[4] ?? 0),
    tintMode: byte(saved[5] ?? 0),
  };
}

export function encodeErShinyLabPreset(preset: ErShinyLabPreset): ErShinyLabSavedPreset {
  const loadout = encodeErShinyLabLoadout(preset.loadout);
  const params = encodeErShinyLabParams(preset.params);
  return [loadout[0], loadout[1], loadout[2], params[0], params[1], params[2], params[3], params[4], params[5]];
}

export function decodeErShinyLabPreset(saved: readonly number[] | null | undefined): ErShinyLabPreset | null {
  if (!saved) {
    return null;
  }
  return {
    loadout: decodeErShinyLabLoadout(saved.slice(0, 3)),
    params: decodeErShinyLabParams(saved.slice(3, 9)),
  };
}

export function normalizeErShinyLabSavedLook(
  saved: readonly number[] | null | undefined,
): ErShinyLabSavedLook | undefined {
  if (!saved) {
    return undefined;
  }
  const normalized: ErShinyLabSavedLook = [
    byte(saved[0] ?? 0),
    byte(saved[1] ?? 0),
    byte(saved[2] ?? 0),
    byte(saved[3] ?? 255),
    byte(saved[4] ?? 255),
    byte(saved[5] ?? 255),
    byte(saved[6] ?? 96),
    byte(saved[7] ?? 0),
    byte(saved[8] ?? 0),
  ];
  const loadout = decodeErShinyLabLoadout(normalized);
  return loadout.palette || loadout.surface || loadout.around ? normalized : undefined;
}

export function decodeErShinyLabSavedLook(saved: readonly number[] | null | undefined): ErShinyLabPreset | null {
  const normalized = normalizeErShinyLabSavedLook(saved);
  return normalized ? decodeErShinyLabPreset(normalized) : null;
}

export function normalizeErShinyLabPresets(
  presets: readonly (readonly number[] | null)[] | undefined,
): (ErShinyLabPreset | null)[] {
  const out: (ErShinyLabPreset | null)[] = [];
  for (let i = 0; i < 5; i++) {
    out.push(decodeErShinyLabPreset(presets?.[i]));
  }
  return out;
}

export function sanitizeErShinyLabLoadout(
  loadout: ErShinyLabLoadout,
  owned: Record<ErShinyLabCategory, Set<string>>,
): ErShinyLabLoadout {
  return {
    palette: loadout.palette && owned.palette.has(loadout.palette) ? loadout.palette : null,
    surface: loadout.surface && owned.surface.has(loadout.surface) ? loadout.surface : null,
    around: loadout.around && owned.around.has(loadout.around) ? loadout.around : null,
  };
}

function mergeBitsets(a: readonly number[] | undefined, b: readonly number[] | undefined): number[] | undefined {
  if (!a?.length && !b?.length) {
    return undefined;
  }
  const len = Math.max(a?.length ?? 0, b?.length ?? 0);
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    out.push(byte((a?.[i] ?? 0) | (b?.[i] ?? 0)));
  }
  return out;
}

export function mergeErShinyLabSaveData(
  target: ErShinyLabSaveData | undefined,
  source: ErShinyLabSaveData | undefined,
): ErShinyLabSaveData | undefined {
  if (!target) {
    return source;
  }
  if (!source) {
    return target;
  }
  target.o ??= {};
  const p = mergeBitsets(target.o.p, source.o?.p);
  const s = mergeBitsets(target.o.s, source.o?.s);
  const a = mergeBitsets(target.o.a, source.o?.a);
  if (p) {
    target.o.p = p;
  }
  if (s) {
    target.o.s = s;
  }
  if (a) {
    target.o.a = a;
  }
  if (!target.l && source.l) {
    target.l = source.l;
  }
  if (!target.q && source.q) {
    target.q = source.q;
  }
  const sourcePresets = source.r ?? [];
  if (sourcePresets.length) {
    target.r ??= [];
    for (let i = 0; i < 5; i++) {
      target.r[i] ??= sourcePresets[i] ?? null;
    }
  }
  return target;
}

type Rgb = [number, number, number];
type PaletteContext = {
  K: number;
  clRank: (r: number, g: number, b: number) => number;
  clColor: (rank: number) => Rgb;
};
type PaletteFn = (r: number, g: number, b: number, ctx: PaletteContext | null) => Rgb;

const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const fract = (x: number): number => x - Math.floor(x);
const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

function hx(hex: string): Rgb {
  const h = hex.replace(/^#/, "").slice(0, 6).padEnd(6, "0");
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function rgb2hsv(r: number, g: number, b: number): Rgb {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) {
      h = ((g - b) / d) % 6;
    } else if (mx === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
    if (h < 0) {
      h += 1;
    }
  }
  return [h, mx <= 0 ? 0 : d / mx, mx];
}

function hsv2rgb(h: number, s: number, v: number): Rgb {
  const k = (n: number) => (n + h * 6) % 6;
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

function ramp(stops: Rgb[], t: number): Rgb {
  const x = clamp(t);
  const n = stops.length - 1;
  const i = Math.min(n - 1, Math.floor(x * n));
  const f = x * n - i;
  return mix3(stops[i], stops[i + 1], f);
}

function clusterTone(stops: Rgb[], rank: number, k: number, shade: number): Rgb {
  const t = k <= 1 ? 0 : rank / (k - 1);
  const base = ramp(stops, t);
  const s = 0.55 + 0.45 * smooth(0.05, 0.95, shade);
  return base.map(c => clamp(c * s + 0.08 * shade)) as Rgb;
}

function makeClusterContext(colors: Rgb[], k: number): PaletteContext {
  const sorted = colors.slice().sort((a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]));
  const centroids: Rgb[] = [];
  for (let i = 0; i < k; i++) {
    centroids.push(sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) / k) * sorted.length))] ?? [0.5, 0.5, 0.5]);
  }
  return {
    K: k,
    clRank: (r, g, b) => {
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < centroids.length; i++) {
        const c = centroids[i];
        const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    },
    clColor: rank => centroids[Math.max(0, Math.min(centroids.length - 1, rank))] ?? [0.5, 0.5, 0.5],
  };
}

const G = {
  gold: ["0c0700", "5a3410", "c98a2a", "ffd070", "fff6d8"].map(hx),
  obsidian: ["07070d", "141422", "262642", "4a4a78"].map(hx),
  chrome: ["0a0c12", "353d4d", "8b95a8", "eef2fb"].map(hx),
  inferno: ["000000", "350000", "a01200", "ff5a00", "ffd000", "fff6c0"].map(hx),
  toxic: ["03120a", "0c4f1c", "4fce24", "c8ff48", "f6ffd0"].map(hx),
  rose: ["341626", "8f4f6c", "f0a0c0", "ffe2ef"].map(hx),
  verdigris: ["0e1f19", "275446", "57a586", "bce8d2"].map(hx),
  shadowflame: ["08000f", "2e0038", "9a0f86", "ff3fc4", "ffc0f0"].map(hx),
  plasma: ["1a0040", "d0007a", "ff8a00", "fff0a0", "00e0ff"].map(hx),
  thermal: ["000018", "3a0a6a", "c01a6a", "ff6a00", "ffd000", "ffffff"].map(hx),
  copper: ["170a05", "5e2a16", "b5642e", "f0a85a", "ffe6b0"].map(hx),
};

const PALETTE_FUNCS: Record<string, PaletteFn> = {
  glacier: (r, g, b) => {
    let [h, s, v] = rgb2hsv(r, g, b);
    h = mix(h, 0.55, 0.6);
    s *= 0.7;
    v = Math.pow(v, 0.72);
    return mix3(hsv2rgb(h, s, v), [0.92, 0.98, 1.0], smooth(0.6, 1.0, v) * 0.5);
  },
  aurum: (r, g, b) => ramp(G.gold, Math.pow(luma(r, g, b), 0.9)),
  obsidian: (r, g, b) => ramp(G.obsidian, luma(r, g, b)),
  chrome: (r, g, b) => ramp(G.chrome, smooth(0.05, 0.95, luma(r, g, b))),
  amethyst: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(mix(h, 0.78, 0.85), clamp(s * 1.25 + 0.15), Math.pow(v, 0.85));
  },
  inferno: (r, g, b) => ramp(G.inferno, Math.pow(luma(r, g, b), 0.85)),
  toxic: (r, g, b) => ramp(G.toxic, luma(r, g, b)),
  rosequartz: (r, g, b) => ramp(G.rose, smooth(0, 1, Math.pow(luma(r, g, b), 0.8))),
  verdigris: (r, g, b) => ramp(G.verdigris, luma(r, g, b)),
  spectral: (r, g, b) => {
    const [, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(0.52, s * 0.35, Math.pow(v, 0.6) + 0.15);
  },
  negative: (r, g, b) => [1 - r, 1 - g, 1 - b],
  void: (r, g, b) => mix3(hx("160a2e"), hx("ff6ad5"), Math.pow(luma(r, g, b), 0.9)),
  shadowflame: (r, g, b) => ramp(G.shadowflame, Math.pow(luma(r, g, b), 0.85)),
  iridescent: (r, g, b) => {
    const l = luma(r, g, b);
    const c = hsv2rgb(fract(l * 2.2 + 0.05), 0.55, clamp(0.35 + l * 0.85));
    return mix3(c, [1, 1, 1], smooth(0.85, 1, l) * 0.5);
  },
  thermal: (r, g, b) => ramp(G.thermal, Math.pow(luma(r, g, b), 0.85)),
  sepia: (r, g, b) => {
    const l = luma(r, g, b);
    return [clamp(l * 1.08 + 0.05), clamp(l * 0.82 + 0.03), clamp(l * 0.58)];
  },
  copper: (r, g, b) => ramp(G.copper, Math.pow(luma(r, g, b), 0.9)),
  emerald: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(mix(h, 0.38, 0.85), clamp(s * 1.2 + 0.25), Math.pow(v, 0.82));
  },
  sapphire: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(mix(h, 0.62, 0.85), clamp(s * 1.25 + 0.25), Math.pow(v, 0.85));
  },
  comic: (r, g, b) => {
    const l = Math.round(smooth(0.05, 0.95, luma(r, g, b)) * 3) / 3;
    const [h, s] = rgb2hsv(r, g, b);
    return hsv2rgb(h, clamp(s * 1.1), 0.18 + l * 0.82);
  },
  synthwave: (r, g, b) => {
    const l = luma(r, g, b);
    return mix3(hx("2a0a4a"), mix3(hx("ff2a8a"), hx("20e0ff"), smooth(0.4, 0.95, l)), smooth(0.04, 0.6, l));
  },
  onyxgold: (r, g, b) =>
    ramp(["08080e", "14141f", "23233a", "c98a2a", "ffe08a"].map(hx), Math.pow(luma(r, g, b), 1.15)),
  ultraviolet: (r, g, b) => {
    const [, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(0.78, clamp(0.5 + s * 0.5), Math.pow(v, 1.4));
  },
  acid: (r, g, b) => ramp(["0a1400", "294d00", "7ad400", "d4ff3a", "f6ffd0"].map(hx), Math.pow(luma(r, g, b), 0.85)),
  bubblegum: (r, g, b) => mix3(hx("ff8ad0"), hx("7af0ff"), smooth(0.1, 0.9, luma(r, g, b))),
  blood: (r, g, b) => ramp(["0a0204", "4a0810", "a01525", "e8404a", "ffd0c0"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  abyss: (r, g, b) => ramp(["02030a", "07142e", "0e3a5e", "1f9ad0", "a0f0ff"].map(hx), Math.pow(luma(r, g, b), 1.1)),
  antique: (r, g, b) => {
    const l = luma(r, g, b);
    return [clamp(l + 0.12), clamp(l * 0.92 + 0.08), clamp(l * 0.7 + 0.03)];
  },
  frostfire: (r, g, b) => mix3(hx("1a3a6a"), hx("ff8a2a"), smooth(0.35, 0.75, luma(r, g, b))),
  camo: (r, g, b) => ramp(["232a18", "3f4a26", "6a7a3a", "aeb86a"].map(hx), Math.round(luma(r, g, b) * 3) / 3),
  jade: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(mix(h, 0.42, 0.85), clamp(s * 0.9 + 0.15), Math.pow(v, 0.9));
  },
  rosegold: (r, g, b) =>
    ramp(["2a1418", "7a4248", "d98a7a", "f5c0a0", "ffe8d8"].map(hx), Math.pow(luma(r, g, b), 0.92)),
  mono: (r, g, b) => {
    const l = smooth(0.05, 0.95, luma(r, g, b));
    return [l, l, l];
  },
  prismarine: (r, g, b) =>
    ramp(["041a1e", "0a4a4a", "1f9a8a", "5fe0c0", "d0fff0"].map(hx), Math.pow(luma(r, g, b), 0.95)),
  nebula: (r, g, b) => ramp(["08021a", "2a0a5a", "7a1a9a", "d04ad0", "7af0ff"].map(hx), luma(r, g, b)),
  venom: (r, g, b) => ramp(["07040a", "1a0a1a", "2a4a14", "6ad020", "d8ff60"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  solarflare: (r, g, b) =>
    ramp(["1a0600", "7a2a00", "e08000", "ffd040", "fffae0"].map(hx), Math.pow(luma(r, g, b), 0.8)),
  royal: (r, g, b) => ramp(["0e0420", "3a1060", "7a2a9a", "d0a030", "ffe890"].map(hx), luma(r, g, b)),
  deepsea: (r, g, b) => ramp(["01060f", "03204a", "0a5a8a", "1fb0d0", "a0f0e0"].map(hx), Math.pow(luma(r, g, b), 1.05)),
  sakura: (r, g, b) => ramp(["2a1420", "7a4a60", "e0a0c0", "ffd0e0", "fff0f6"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  mythril: (r, g, b) => ramp(["0a0e16", "2a3a52", "6a8ab0", "c0d8f0", "f0f8ff"].map(hx), luma(r, g, b)),
  cursed: (r, g, b) => ramp(["060a06", "17121a", "2a3a14", "4a6a1a", "9aff3a"].map(hx), Math.pow(luma(r, g, b), 0.95)),
  pearl: (r, g, b) => {
    const l = luma(r, g, b);
    return mix3(hsv2rgb(fract(l * 1.5 + 0.1), 0.18, clamp(0.6 + l * 0.4)), [1, 1, 1], 0.4);
  },
  rust: (r, g, b) => ramp(["140804", "3a1a0a", "7a3a1a", "b56a2a", "e0a85a"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  moonstone: (r, g, b) => {
    const l = luma(r, g, b);
    return mix3(hsv2rgb(fract(l + 0.55), 0.2, clamp(0.65 + l * 0.35)), [0.95, 0.97, 1], 0.45);
  },
  oilspill: (r, g, b) => {
    const l = luma(r, g, b);
    return hsv2rgb(fract(l * 3), 0.7, clamp(0.15 + l * 0.55));
  },
  plasmatic: (r, g, b) => ramp(G.plasma, luma(r, g, b)),
  duoink: (r, g, b, c) => (c ? clusterTone(["0e1a33", "e8c050"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b]),
  duoneon: (r, g, b, c) => (c ? clusterTone(["ff2a9a", "22e0ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b]),
  duomono: (r, g, b, c) => (c ? clusterTone(["0a0a12", "f4f6ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b]),
  duoblood: (r, g, b, c) => (c ? clusterTone(["0a0306", "e02438"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b]),
  duomint: (r, g, b, c) => (c ? clusterTone(["08231e", "7af0c0"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b]),
  duosunset: (r, g, b, c) => (c ? clusterTone(["241a4a", "ff8a3a"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b]),
  duomecha: (r, g, b, c) => (c ? clusterTone(["1c2230", "ff7a1a"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b]),
  trisunset: (r, g, b, c) =>
    c ? clusterTone(["1a0a3a", "d0407a", "ffd060"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  triforest: (r, g, b, c) =>
    c ? clusterTone(["10240f", "3f7a2a", "d8e070"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  quadvapor: (r, g, b, c) =>
    c ? clusterTone(["141a3a", "b03ad0", "22c0ff", "f0f8ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  pentacandy: (r, g, b, c) =>
    c
      ? clusterTone(["ff9ec4", "ffd59e", "b6f0a0", "9ed8ff", "d9b6ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  pentajewel: (r, g, b, c) =>
    c
      ? clusterTone(["8a1030", "103a8a", "0a6a3a", "5a1a8a", "c9a020"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  synthwavesun: (r, g, b) =>
    ramp(["2a0a4a", "7a1a8a", "ff3a7a", "ff8a2a", "ffe060"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  sunset: (r, g, b) =>
    ramp(["3a1060", "8a2a7a", "e0407a", "ff6a3a", "ffaa2a", "ffe85a"].map(hx), Math.pow(luma(r, g, b), 0.82)),
  gameboy: (r, g, b, c) =>
    c ? clusterTone(["0f380f", "306230", "8bac0f", "9bbc0f"].map(hx), c.clRank(r, g, b), c.K, 0.5) : [r, g, b],
  retro: (r, g, b, c) => {
    if (!c) {
      return [r, g, b];
    }
    const cen = c.clColor(c.clRank(r, g, b));
    const hsv = rgb2hsv(cen[0], cen[1], cen[2]);
    return hsv2rgb(hsv[0], clamp(hsv[1] * 1.25), Math.round(hsv[2] * 4) / 4);
  },
};

const CLUSTER_K: Record<string, number> = {
  duoink: 2,
  duoneon: 2,
  duomono: 2,
  duoblood: 2,
  duomint: 2,
  duosunset: 2,
  duomecha: 2,
  trisunset: 3,
  triforest: 3,
  quadvapor: 4,
  pentacandy: 5,
  pentajewel: 5,
  gameboy: 4,
  retro: 5,
};

function rgbToHex(rgb: Rgb): string {
  return rgb.map(c => byte(clamp(c) * 255).toString(16).padStart(2, "0")).join("");
}

export function buildErShinyLabPaletteMap(baseHexes: readonly string[], paletteId: string): Record<string, string> {
  const fn = PALETTE_FUNCS[paletteId];
  if (!fn) {
    return {};
  }
  const colors = baseHexes.map(hx);
  const ctx = CLUSTER_K[paletteId] ? makeClusterContext(colors, CLUSTER_K[paletteId]) : null;
  const out: Record<string, string> = {};
  for (const baseHex of baseHexes) {
    const [r, g, b] = hx(baseHex);
    out[baseHex] = rgbToHex(fn(r, g, b, ctx));
  }
  return out;
}

export function buildErShinyLabVariantPalette(
  variantColors: Record<number, Record<string, string>>,
  paletteId: string,
  variant: number,
): Record<number, Record<string, string>> {
  const firstMap = Object.values(variantColors)[0];
  const source = variantColors[variant] ?? variantColors[0] ?? firstMap;
  if (!source) {
    return {};
  }
  const mapped = buildErShinyLabPaletteMap(Object.keys(source), paletteId);
  return { 0: mapped, 1: mapped, 2: mapped };
}
