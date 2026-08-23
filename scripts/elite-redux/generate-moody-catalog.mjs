import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "docs", "moody-mode-spec.md");
const outputPath = path.join(root, "src", "data", "elite-redux", "moody", "moody-catalog.generated.ts");

const source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");

function slug(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function clean(value) {
  return value.replace(/^\s+|\s+$/g, "").replace(/\n{3,}/g, "\n\n");
}

function targetKind(scope) {
  const normalized = scope.toLowerCase();
  if (normalized.includes("exact move") || normalized.includes("sealed moves")) {
    return "move";
  }
  if (normalized.includes("pair") || normalized.includes("two pok")) {
    return "pokemon-pair";
  }
  if (normalized.includes("two slots")) {
    return "slots";
  }
  if (normalized.includes("slot")) {
    return "slot";
  }
  if (normalized.includes("item") || normalized.includes("consumable")) {
    return "item-stack";
  }
  if (normalized.includes("enemy type")) {
    return "enemy-type";
  }
  if (normalized.includes("elemental type")) {
    return "pokemon-type";
  }
  if (normalized.includes("pokémon") || normalized.includes("pokemon")) {
    return "pokemon";
  }
  if (normalized.includes("economy") || normalized.includes("market")) {
    return "economy";
  }
  if (normalized.includes("reward")) {
    return "reward";
  }
  if (normalized.includes("contract")) {
    return "contract";
  }
  if (normalized.includes("weather") || normalized.includes("field")) {
    return "field";
  }
  if (normalized.includes("rule")) {
    return "rule";
  }
  return "team";
}

const boonSection = source.slice(source.indexOf("# The 100 boon lines"), source.indexOf("# Thirty run curses"));
const boonHeading = /^### (\d{2,3})\. (.+?) — \*\*(Great|Ultra|Rogue|Master); (.+?)\*\*$/gm;
const boonMatches = [...boonSection.matchAll(boonHeading)];
const boons = boonMatches.map((match, index) => {
  const bodyStart = match.index + match[0].length;
  const bodyEnd = index + 1 < boonMatches.length ? boonMatches[index + 1].index : boonSection.length;
  const fullDescription = clean(boonSection.slice(bodyStart, bodyEnd).replace(/\n---[\s\S]*$/s, ""));
  const rankIndex = fullDescription.indexOf("**Rank II:**");
  const evolutionIndex = fullDescription.indexOf("**Evolution —");
  const base = clean(fullDescription.slice("**Base:**".length, rankIndex));
  const rankTwo = clean(fullDescription.slice(rankIndex + "**Rank II:**".length, evolutionIndex));
  const evolutionPattern = /\*\*Evolution — (.+?):\*\* ([\s\S]*?)(?=\n\n\*\*Evolution —|$)/g;
  const evolutions = [...fullDescription.matchAll(evolutionPattern)].slice(0, 2).map(evolution => ({
    id: slug(evolution[1]),
    name: evolution[1],
    description: clean(evolution[2]),
  }));
  if (evolutions.length === 0 || evolutions.length > 2) {
    throw new Error(`Expected one or two evolutions for ${match[2]}, found ${evolutions.length}`);
  }
  return {
    id: slug(match[2]),
    number: Number(match[1]),
    name: match[2],
    rarity: match[3].toLowerCase(),
    scope: match[4],
    targetKind: targetKind(match[4]),
    base,
    rankTwo,
    evolutions,
    fullDescription,
  };
});

if (boons.length !== 100) {
  throw new Error(`Expected 100 boon lines, found ${boons.length}`);
}

const curseSection = source.slice(source.indexOf("# Thirty run curses"), source.indexOf("# Removed, folded"));
const curseHeading = /^### (\d{2})\. (.+)$/gm;
const curseMatches = [...curseSection.matchAll(curseHeading)];
const curses = curseMatches.map((match, index) => {
  const bodyStart = match.index + match[0].length;
  const bodyEnd = index + 1 < curseMatches.length ? curseMatches[index + 1].index : curseSection.length;
  const preceding = curseSection.slice(0, match.index);
  const dreadMatches = [...preceding.matchAll(/^## Dread (I{1,3})$/gm)];
  const dreadToken = dreadMatches.at(-1)?.[1];
  const dread = dreadToken === "I" ? 1 : dreadToken === "II" ? 2 : 3;
  return {
    id: slug(match[2]),
    number: Number(match[1]),
    name: match[2],
    dread,
    description: clean(curseSection.slice(bodyStart, bodyEnd).replace(/\n---[\s\S]*$/s, "")),
  };
});

if (curses.length !== 30) {
  throw new Error(`Expected 30 curses, found ${curses.length}`);
}

const generated = `/* This file is generated from docs/moody-mode-spec.md. Do not edit by hand. */\n\nimport type { MoodyBoonDefinition, MoodyCurseDefinition } from "#data/elite-redux/moody/moody-types";\n\nexport const MOODY_BOONS = ${JSON.stringify(boons, null, 2)} as const satisfies readonly MoodyBoonDefinition[];\n\nexport const MOODY_CURSES = ${JSON.stringify(curses, null, 2)} as const satisfies readonly MoodyCurseDefinition[];\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, generated, "utf8");
const biomeCli = path.join(root, "node_modules", "@biomejs", "biome", "bin", "biome");
if (!fs.existsSync(biomeCli)) {
  throw new Error(`Biome CLI not found at ${biomeCli}; install workspace dependencies before generating.`);
}
execFileSync(process.execPath, [biomeCli, "format", "--write", outputPath], {
  stdio: "inherit",
});
console.log(`Generated ${boons.length} boons and ${curses.length} curses at ${path.relative(root, outputPath)}`);
