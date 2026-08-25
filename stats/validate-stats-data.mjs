import { existsSync, readFileSync } from "node:fs";

const DIR = new URL("./data/", import.meta.url);
const dex = JSON.parse(readFileSync(new URL("dex.json", DIR), "utf8"));
const detail = JSON.parse(readFileSync(new URL("dex-detail.json", DIR), "utf8"));
const extra = JSON.parse(readFileSync(new URL("species-extra.json", DIR), "utf8"));
const stats = JSON.parse(readFileSync(new URL("species-stats.json", DIR), "utf8"));
const observations = JSON.parse(readFileSync(new URL("balance-observations.json", DIR), "utf8"));
const maxAgeHours = Number(process.env.STATS_MAX_AGE_HOURS || 12);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ageHours(value) {
  return (Date.now() - Date.parse(value)) / 3_600_000;
}

function walk(value, visit) {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit);
  }
}

assert(Array.isArray(dex) && dex.length >= 650, `starter catalog is unexpectedly small (${dex.length})`);
assert(detail.counts?.species >= 1900, `runtime species catalog is incomplete (${detail.counts?.species})`);
assert(detail.counts?.forms >= detail.counts.species, `runtime form catalog is incomplete (${detail.counts?.forms})`);
assert(detail.counts?.moves >= 1000, `runtime move catalog is incomplete (${detail.counts?.moves})`);
assert(detail.counts?.abilities >= 1000, `runtime ability catalog is incomplete (${detail.counts?.abilities})`);
assert(extra.count === detail.counts.species, "detail and species-extra counts disagree");
assert(extra.formCount === detail.counts.forms, "detail and species-extra form counts disagree");

const formSlugs = new Set(
  Object.values(extra.species || {}).flatMap(species =>
    (species.forms || []).flatMap(form => [form.slug, form.spriteSlug].filter(Boolean)),
  ),
);
for (const slug of [
  "jumpluff_mega",
  "yveltal_mega_z",
  "lucario_mega_z",
  "mega_kingdra_y",
  "fidough_partner",
  "fidough_partner_mega",
]) {
  assert(formSlugs.has(slug), `required runtime form is absent: ${slug}`);
}

const abilityNames = new Set(Object.values(detail.abilities || {}).map(ability => ability.name));
for (const name of ["Glycolysis", "Gale Bloom", "Eclipse Wing"]) {
  assert(abilityNames.has(name), `required runtime ability is absent: ${name}`);
}

assert(stats._sample === false, "production stats payload cannot be sample data");
assert(stats.totalRuns >= 1000, `run sample is unexpectedly small (${stats.totalRuns})`);
assert(stats.players >= 100, `player sample is unexpectedly small (${stats.players})`);
assert(Object.keys(stats.species || {}).length >= 500, "too few species have run aggregates");
assert(Number.isFinite(Date.parse(stats.generatedAt)), "stats generatedAt is invalid");
assert(ageHours(stats.generatedAt) >= -1 && ageHours(stats.generatedAt) <= maxAgeHours, `stats are stale (${ageHours(stats.generatedAt).toFixed(1)}h)`);
assert(detail.sourceSha === stats.sourceSha, "catalog and telemetry source SHAs disagree");
assert(observations.schemaVersion === 1, "balance observations schema is unsupported");
assert(observations.windows && typeof observations.windows === "object", "balance observations windows are missing");
assert(observations.patches && typeof observations.patches === "object", "balance observations patch history is missing");
assert(ageHours(observations.generatedAt) >= -1 && ageHours(observations.generatedAt) <= maxAgeHours, `balance observations are stale (${ageHours(observations.generatedAt).toFixed(1)}h)`);
if (process.env.STATS_SOURCE_SHA) {
  assert(stats.sourceSha === process.env.STATS_SOURCE_SHA, "generated data does not match STATS_SOURCE_SHA");
}

const forbiddenKeys = new Set([
  "user_id",
  "userId",
  "username",
  "playerKey",
  "host_uid",
  "guest_uid",
  "hostTeam",
  "guestTeam",
  "player_team",
  "opponent_team",
  "summary_json",
]);
walk(stats, key => assert(!forbiddenKeys.has(key), `public stats contain forbidden field: ${key}`));
walk(observations, key => assert(!forbiddenKeys.has(key), `public balance observations contain forbidden field: ${key}`));

for (const [slug, row] of Object.entries(stats.species || {})) {
  assert(dex.some(mon => mon.slug === slug), `stats contain an unknown starter slug: ${slug}`);
  for (const listName of ["topAbilities", "topMoves", "topItems", "topForms", "topRelics", "topTeammates"]) {
    for (const item of row[listName] || []) {
      assert(item.sample >= stats.privacy.minimumPublishedSample, `${slug}.${listName} exposes a low-sample aggregate`);
    }
  }
}

const deployArg = process.argv.find(argument => argument.startsWith("--deploy="));
if (deployArg) {
  const deployDir = new URL(`${deployArg.slice("--deploy=".length).replace(/\\/g, "/").replace(/\/$/, "")}/`, `file:///${process.cwd().replace(/\\/g, "/")}/`);
  for (const name of ["_runs.json", "_showdown.json", "_decisions.json"]) {
    const path = new URL(`data/${name}`, deployDir);
    assert(existsSync(path), `deploy placeholder is missing: ${name}`);
    const publicValue = JSON.parse(readFileSync(path, "utf8"));
    assert(publicValue?.note === "not public", `private telemetry dump would be deployed: ${name}`);
  }
}

console.log(
  `Validated ${dex.length} starters, ${detail.counts.species} species, ${detail.counts.forms} forms, ${stats.totalRuns} runs and ${stats.aggregates?.showdown?.matches ?? 0} Showdown matches`,
);
