#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [
  inputPath,
  outputPath,
  teamCountRaw = "100",
  capturedDate = new Date().toISOString().slice(0, 10),
  trainingOutputPath,
] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error(
    "usage: node scripts/ai/build-ghost-anchor.mjs RAW_D1.json EVAL.json [TEAM_COUNT] [YYYY-MM-DD] [TRAINING.json]",
  );
  process.exit(2);
}

const requestedTeamCount = Number(teamCountRaw);
if (!Number.isSafeInteger(requestedTeamCount) || requestedTeamCount < 2 || requestedTeamCount % 2 !== 0) {
  throw new Error("TEAM_COUNT must be an even integer of at least 2");
}

const hash = value => createHash("sha256").update(value).digest("hex");
const integer = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback);

// Historical snapshots only retained the registry id and stack count. These ids
// are generators whose subtype was not serialized, so invoking them now would
// silently roll a different item. The list is audited against initModifierTypes():
// every retained id constructs a concrete PokemonHeldItemModifierType directly.
const NON_RESTORABLE_HELD_ITEM_IDS = new Set([
  "ATTACK_TYPE_BOOSTER",
  "BASE_STAT_BOOSTER",
  "BERRY",
  "ER_RESIST_BERRY_BUG",
  "ER_RESIST_BERRY_DARK",
  "ER_RESIST_BERRY_DRAGON",
  "ER_RESIST_BERRY_ELECTRIC",
  "ER_RESIST_BERRY_FIGHTING",
  "ER_RESIST_BERRY_FIRE",
  "ER_RESIST_BERRY_FLYING",
  "ER_RESIST_BERRY_GHOST",
  "ER_RESIST_BERRY_GRASS",
  "ER_RESIST_BERRY_GROUND",
  "ER_RESIST_BERRY_ICE",
  "ER_RESIST_BERRY_POISON",
  "ER_RESIST_BERRY_PSYCHIC",
  "ER_RESIST_BERRY_ROCK",
  "ER_RESIST_BERRY_STEEL",
  "ER_RESIST_BERRY_WATER",
  "ER_WARD_STONE_GREATER",
  "ER_WARD_STONE_MINOR",
  "ER_WARD_STONE_PRIME",
  "FORM_CHANGE_ITEM",
  "RARE_FORM_CHANGE_ITEM",
  "SPECIES_STAT_BOOSTER",
]);

function normalizeHeldItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      row =>
        Array.isArray(row)
        && typeof row[0] === "string"
        && row[0].trim()
        && !NON_RESTORABLE_HELD_ITEM_IDS.has(row[0].trim()),
    )
    .map(([name, count]) => [name.trim(), Math.max(1, integer(count, 1))])
    .sort(([nameA, countA], [nameB, countB]) => nameA.localeCompare(nameB) || countA - countB);
}

function normalizeMember(member) {
  if (!member || typeof member !== "object" || !Number.isSafeInteger(member.speciesId) || member.speciesId <= 0) {
    throw new Error("invalid species");
  }
  if (!Array.isArray(member.ivs) || member.ivs.length !== 6) {
    throw new Error("invalid IVs");
  }
  const moves = Array.isArray(member.moves)
    ? member.moves.filter(move => Number.isSafeInteger(move) && move > 0).slice(0, 4)
    : [];
  if (moves.length === 0) {
    throw new Error("member has no usable moves");
  }
  const normalized = {
    species: member.speciesId,
    formIndex: Math.max(0, integer(member.formIndex)),
    abilitySlot: Math.max(0, integer(member.abilityIndex)),
    ivs: member.ivs.map(iv => Math.max(0, Math.min(31, integer(iv)))),
    nature: Math.max(0, integer(member.nature)),
    gender: integer(member.gender, -1),
    shiny: member.shiny === true,
    variant: Math.max(0, integer(member.variant)),
    passive: member.passive === true,
    moves,
  };
  const heldItems = normalizeHeldItems(member.heldItems);
  return heldItems.length > 0 ? { ...normalized, heldItems } : normalized;
}

function resultRows(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("Wrangler JSON must be an array");
  }
  return raw.flatMap(batch => (Array.isArray(batch?.results) ? batch.results : []));
}

const candidates = [];
const rosterFingerprints = new Set();
for (const row of resultRows(JSON.parse(readFileSync(inputPath, "utf8")))) {
  const sourceKey = String(row?.user_id ?? "");
  if (!sourceKey || typeof row?.player_team !== "string") {
    continue;
  }
  try {
    const parsed = JSON.parse(row.player_team);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 6) {
      continue;
    }
    const members = parsed.map(normalizeMember);
    const fingerprint = hash(JSON.stringify(members));
    if (rosterFingerprints.has(fingerprint)) {
      continue;
    }
    rosterFingerprints.add(fingerprint);
    candidates.push({ sourceKey, fingerprint, members });
  } catch {
    // A malformed historical snapshot is ineligible, but cannot block the anchor.
  }
}

const groups = new Map();
for (const candidate of candidates) {
  const group = groups.get(candidate.sourceKey) ?? [];
  group.push(candidate);
  groups.set(candidate.sourceKey, group);
}
const sourceGroups = [...groups.values()]
  .map(group => group.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)))
  .sort((a, b) =>
    hash(a.map(row => row.fingerprint).join("|")).localeCompare(hash(b.map(row => row.fingerprint).join("|"))),
  );

function chooseEvaluationGroups(allGroups, teamCount) {
  const total = allGroups.reduce((sum, group) => sum + group.length, 0);
  const targetSourceCount = Math.round((allGroups.length * teamCount) / total);
  const choices = Array.from({ length: total + 1 }, () => new Map());
  choices[0].set(0, []);
  for (let groupIndex = 0; groupIndex < allGroups.length; groupIndex++) {
    const size = allGroups[groupIndex].length;
    for (let sum = total - size; sum >= 0; sum--) {
      for (const [sourceCount, existing] of [...choices[sum]]) {
        const nextSum = sum + size;
        const nextSourceCount = sourceCount + 1;
        if (!choices[nextSum].has(nextSourceCount)) {
          choices[nextSum].set(nextSourceCount, [...existing, groupIndex]);
        }
      }
    }
  }
  for (let sum = teamCount; sum < choices.length; sum++) {
    const sourceChoices = [...choices[sum]];
    if (sourceChoices.length > 0) {
      sourceChoices.sort(
        ([countA], [countB]) =>
          Math.abs(countA - targetSourceCount) - Math.abs(countB - targetSourceCount) || countB - countA,
      );
      return new Set(sourceChoices[0][1]);
    }
  }
  throw new Error(`only ${total} distinct valid winning rosters are available; requested ${teamCount}`);
}

function selectSourceDiverse(allGroups, teamCount) {
  const selected = [];
  for (let pass = 0; selected.length < teamCount; pass++) {
    let added = 0;
    for (const group of allGroups) {
      if (group[pass] && selected.length < teamCount) {
        selected.push(group[pass]);
        added++;
      }
    }
    if (added === 0) {
      break;
    }
  }
  if (selected.length < teamCount) {
    throw new Error(`only ${selected.length} eligible rosters are available; requested ${teamCount}`);
  }
  return selected;
}

function pairSourceDistinct(selectedCandidates) {
  const remaining = [...selectedCandidates].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const paired = [];
  while (remaining.length > 0) {
    const first = remaining.shift();
    const partnerIndex = remaining.findIndex(candidate => candidate.sourceKey !== first.sourceKey);
    if (partnerIndex < 0) {
      throw new Error("could not create source-distinct inverse pairs");
    }
    paired.push(first, remaining.splice(partnerIndex, 1)[0]);
  }
  return paired;
}

const evaluationGroupIndexes = chooseEvaluationGroups(sourceGroups, requestedTeamCount);
const evaluationGroups = sourceGroups.filter((_, index) => evaluationGroupIndexes.has(index));
const trainingGroups = sourceGroups.filter((_, index) => !evaluationGroupIndexes.has(index));
const selected = selectSourceDiverse(evaluationGroups, requestedTeamCount);
const paired = pairSourceDistinct(selected);
const sourceAccountCount = new Set(paired.map(candidate => candidate.sourceKey)).size;
const fixture = {
  schemaVersion: 2,
  capturedDate,
  teamCount: paired.length,
  sourceAccountCount,
  source:
    "Sanitized read-only snapshot of distinct winning Hell ghost runs; no run, account, player, seed, or timestamp identifiers retained.",
  selection:
    "Deterministic player-level holdout: every source account represented here is excluded from the self-play fixture. One roster per held-out source is selected before a second; inverse pairs never share a source account.",
  normalization:
    "Original 1-6 member party size, species, form, ability slot, IVs, nature, gender, shiny tier, passive flag, first four moves, and exactly reconstructable per-Pokemon held-item stacks are preserved. Historical generic item-generator ids whose subtype was not saved are excluded instead of rerolled. Both sides run at level 200. Run-global relics, challenges, and trainer modifiers are excluded.",
  teams: paired.map((candidate, index) => ({
    id: `hell-anchor-${String(index + 1).padStart(3, "0")}`,
    members: candidate.members,
  })),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
const result = {
  evaluationTeams: fixture.teamCount,
  evaluationSources: fixture.sourceAccountCount,
  inversePairs: fixture.teamCount / 2,
};

if (trainingOutputPath) {
  const trainingCandidates = trainingGroups.flat().sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  if (trainingCandidates.length < 2) {
    throw new Error("the player-level holdout left fewer than two self-play rosters");
  }
  const trainingFixture = {
    schemaVersion: 2,
    capturedDate,
    teamCount: trainingCandidates.length,
    sourceAccountCount: trainingGroups.length,
    source:
      "Sanitized read-only snapshot of distinct winning Hell ghost runs; no run, account, player, seed, or timestamp identifiers retained.",
    selection:
      "Every roster comes from a source account excluded from the evaluation fixture. No evaluation player or roster is used for self-play or model fitting.",
    normalization: fixture.normalization,
    teams: trainingCandidates.map((candidate, index) => ({
      id: `hell-selfplay-${String(index + 1).padStart(3, "0")}`,
      members: candidate.members,
    })),
  };
  mkdirSync(dirname(trainingOutputPath), { recursive: true });
  writeFileSync(trainingOutputPath, `${JSON.stringify(trainingFixture, null, 2)}\n`);
  result.trainingTeams = trainingFixture.teamCount;
  result.trainingSources = trainingFixture.sourceAccountCount;
}

console.log(JSON.stringify(result));
