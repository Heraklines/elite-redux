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

const achievements = [];
for (const property of achievementsObject.properties) {
  if (!ts.isPropertyAssignment(property)) {
    continue;
  }
  const id = property.name.getText(source).replaceAll(/["']/g, "");
  if (vanillaIds.has(id)) {
    continue;
  }
  let expression = property.initializer;
  while (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    expression = expression.expression.expression;
  }
  if (!ts.isNewExpression(expression)) {
    throw new Error(`Achievement ${id} is not constructed with new`);
  }
  const score = expression.arguments?.[3];
  if (!score || !ts.isNumericLiteral(score)) {
    throw new Error(`Achievement ${id} does not have a literal score in constructor argument 4`);
  }
  achievements.push({ id, points: Number(score.text) });
}

achievements.sort((a, b) => a.id.localeCompare(b.id));
const totalPoints = achievements.reduce((total, achievement) => total + achievement.points, 0);
const catalog = {
  schemaVersion: 1,
  totalPoints,
  requiredPoints: Math.ceil(totalPoints / 2),
  achievements,
};

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${achievements.length} Redux-only achievements (${totalPoints} total points) to ${outputPath}.`);
