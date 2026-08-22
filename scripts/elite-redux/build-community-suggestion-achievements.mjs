import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const sourcePath = "src/system/achv.ts";
const vanillaPath = "scripts/elite-redux/vanilla-achievement-ids.json";
const outputPath = "src/data/elite-redux/er-community-suggestion-achievements.json";

const sourceText = await readFile(sourcePath, "utf8");
const vanillaIds = new Set(JSON.parse(await readFile(vanillaPath, "utf8")));
const source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

let achievementsObject;
function visit(node) {
  if (
    ts.isVariableDeclaration(node)
    && node.name.getText(source) === "achvs"
    && node.initializer
    && ts.isObjectLiteralExpression(node.initializer)
  ) {
    achievementsObject = node.initializer;
  }
  ts.forEachChild(node, visit);
}
visit(source);

if (!achievementsObject) {
  throw new Error(`Could not find the achvs object in ${sourcePath}`);
}

const allAchievementIds = [];
for (const property of achievementsObject.properties) {
  if (!ts.isPropertyAssignment(property)) {
    continue;
  }
  const id = property.name.getText(source).replaceAll(/["']/g, "");
  allAchievementIds.push(id);
}

const sourceIds = new Set(allAchievementIds);
const missingVanillaIds = [...vanillaIds].filter(id => !sourceIds.has(id));
if (missingVanillaIds.length > 0) {
  console.warn(`Vanilla achievement ids not present in ${sourcePath}: ${missingVanillaIds.join(", ")}`);
}
const vanillaAchievementsExcluded = [...vanillaIds].filter(id => sourceIds.has(id)).length;

const achievements = allAchievementIds
  .filter(id => !vanillaIds.has(id))
  .sort((a, b) => a.localeCompare(b))
  .map(id => ({ id }));
const totalAchievements = achievements.length;
const catalog = {
  schemaVersion: 2,
  sourceAchievementCount: allAchievementIds.length,
  vanillaCatalogSize: vanillaIds.size,
  vanillaAchievementsExcluded,
  totalAchievements,
  requiredAchievements: Math.ceil(totalAchievements / 2),
  achievements,
};

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(
  `Wrote ${totalAchievements} Redux-only achievements; ${catalog.requiredAchievements} are required for community suggestions.`,
);
