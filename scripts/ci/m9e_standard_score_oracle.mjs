import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";

const source = fs.readFileSync("src/data/elite-redux/er-enemy-ai.ts");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
if (hash(source) !== "93fb0c3e6a87b380596194bd391963f5b202abfd687db72bbc373700bfa92a0b") {
  throw new Error("Exact pinned TypeScript source required");
}
const text = source.toString("utf8");
const signature = "export function damageToScore(damage: number, maxHp: number, hp: number, accuracy: number): number {";
const start = text.indexOf(signature);
if (start < 0 || text.indexOf(signature, start + 1) !== -1) throw new Error("Unique source function required");
const end = text.indexOf("\n}", start) + 2;
if (end <= start || end - start > 2048) throw new Error("Bounded entire source function required");
const original = text.slice(start, end);
const numeric = name => {
  const pattern = new RegExp(`^export const ${name} = ([0-9]+);$`, "gm");
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error("Unique source constant required");
  return Number(matches[0][1]);
};
const executable = original.replace(/^export /, "").replaceAll(": number", "");
const score = vm.runInNewContext(`(${executable})`, {
  ER_DAMAGE_SCORE_SCALE: numeric("ER_DAMAGE_SCORE_SCALE"),
  ER_KO_BONUS: numeric("ER_KO_BONUS"),
}, { timeout: 1000 });
const rows = [];
for (const damage of [0, 1, 13, 46, 49, 50, 60, 4294967295]) {
  for (const maxHp of [0, 1, 3, 7, 100, 400, 65535, 4294967295]) {
    for (const hp of [0, 1, 50, 4294967295]) {
      for (const accuracy of [-1, 0, 1, 50, 101]) {
        const result = score(damage, maxHp, hp, accuracy);
        if (!Number.isFinite(result)) throw new Error("Finite ordinary source domain required");
        const buffer = Buffer.alloc(8);
        buffer.writeDoubleBE(result);
        rows.push([damage, maxHp, hp, accuracy, buffer.toString("hex")].join("\t"));
      }
    }
  }
}
if (rows.length !== 1280) throw new Error("Complete independent input product required");
const output = Buffer.from(rows.join("\n") + "\n");
fs.writeFileSync(process.argv[2], output, { flag: "wx" });
console.log(JSON.stringify({ source_sha256: hash(source), function_sha256: hash(original),
  function_bytes: Buffer.byteLength(original), cases: rows.length, output_sha256: hash(output),
  output_bytes: output.length, runtime: process.version, scale: numeric("ER_DAMAGE_SCORE_SCALE"),
  knockout_bonus: numeric("ER_KO_BONUS"), scope: "ordinary integer inputs; numeric helper only" }));
