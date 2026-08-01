#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DIFFICULTIES = ["youngster", "ace", "elite", "hell"];
const TRAINING_SOURCE_PARTITION_COUNT = 5;
const [
  inputPath,
  outputPath,
  teamsPerDifficultyRaw = "50",
  capturedDate = new Date().toISOString().slice(0, 10),
  trainingOutputPath,
] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error(
    "usage: node scripts/ai/build-ghost-anchor.mjs RAW_D1.json EVAL.json [TEAMS_PER_DIFFICULTY] [YYYY-MM-DD] [TRAINING.json]",
  );
  process.exit(2);
}

const teamsPerDifficulty = Number(teamsPerDifficultyRaw);
if (!Number.isSafeInteger(teamsPerDifficulty) || teamsPerDifficulty < 2 || teamsPerDifficulty % 2 !== 0) {
  throw new Error("TEAMS_PER_DIFFICULTY must be an even integer of at least 2");
}

const hash = value => createHash("sha256").update(value).digest("hex");
const integer = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback);

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

function normalizeDifficulty(value) {
  const difficulty = String(value ?? "")
    .trim()
    .toLowerCase();
  return DIFFICULTIES.includes(difficulty) ? difficulty : null;
}

function parseCandidates(raw) {
  const parsed = [];
  const invalidByDifficulty = Object.fromEntries(DIFFICULTIES.map(difficulty => [difficulty, 0]));
  for (const row of resultRows(raw)) {
    const sourceKey = String(row?.user_id ?? "");
    const difficulty = normalizeDifficulty(row?.difficulty);
    if (!sourceKey || difficulty == null || typeof row?.player_team !== "string") {
      continue;
    }
    try {
      const team = JSON.parse(row.player_team);
      if (!Array.isArray(team) || team.length === 0 || team.length > 6) {
        throw new Error("invalid party size");
      }
      const members = team.map(normalizeMember);
      const fingerprint = hash(JSON.stringify(members));
      parsed.push({ sourceKey, difficulty, fingerprint, members });
    } catch {
      invalidByDifficulty[difficulty]++;
    }
  }

  // A roster duplicated by several saves/accounts is one matchup input in that tier.
  // The deterministic source tie-break happens before any account split.
  parsed.sort(
    (a, b) =>
      a.difficulty.localeCompare(b.difficulty)
      || a.fingerprint.localeCompare(b.fingerprint)
      || hash(a.sourceKey).localeCompare(hash(b.sourceKey)),
  );
  const deduplicated = [];
  const seen = new Set();
  for (const candidate of parsed) {
    const key = `${candidate.difficulty}:${candidate.fingerprint}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(candidate);
    }
  }
  return { candidates: deduplicated, invalidByDifficulty };
}

function groupByAccount(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const group = groups.get(candidate.sourceKey) ?? {
      sourceKey: candidate.sourceKey,
      sortKey: hash(candidate.sourceKey),
      byDifficulty: Object.fromEntries(DIFFICULTIES.map(difficulty => [difficulty, []])),
    };
    group.byDifficulty[candidate.difficulty].push(candidate);
    groups.set(candidate.sourceKey, group);
  }
  return [...groups.values()]
    .map(group => {
      for (const difficulty of DIFFICULTIES) {
        group.byDifficulty[difficulty].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
      }
      return group;
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function chooseEvaluationAccounts(groups) {
  const deficits = Object.fromEntries(DIFFICULTIES.map(difficulty => [difficulty, teamsPerDifficulty]));
  const remaining = new Set(groups);
  const selected = [];
  while (DIFFICULTIES.some(difficulty => deficits[difficulty] > 0)) {
    const ranked = [...remaining]
      .map(group => {
        const contributions = DIFFICULTIES.map(difficulty =>
          Math.min(deficits[difficulty], group.byDifficulty[difficulty].length),
        );
        const covered = contributions.filter(value => value > 0).length;
        const rareContribution = contributions[2] * 2 + contributions[3] * 3;
        const totalContribution = contributions.reduce((sum, value) => sum + value, 0);
        return { group, covered, rareContribution, totalContribution };
      })
      .filter(row => row.totalContribution > 0)
      .sort(
        (a, b) =>
          b.covered - a.covered
          || b.rareContribution - a.rareContribution
          || b.totalContribution - a.totalContribution
          || a.group.sortKey.localeCompare(b.group.sortKey),
      );
    const next = ranked[0]?.group;
    if (!next) {
      throw new Error(`account-first holdout cannot fill deficits: ${JSON.stringify(deficits)}`);
    }
    selected.push(next);
    remaining.delete(next);
    for (const difficulty of DIFFICULTIES) {
      deficits[difficulty] = Math.max(0, deficits[difficulty] - next.byDifficulty[difficulty].length);
    }
  }
  return { evaluationGroups: selected, trainingGroups: groups.filter(group => remaining.has(group)) };
}

function selectSourceDiverse(groups, difficulty) {
  const selected = [];
  for (let pass = 0; selected.length < teamsPerDifficulty; pass++) {
    let added = 0;
    for (const group of groups) {
      const candidate = group.byDifficulty[difficulty][pass];
      if (candidate && selected.length < teamsPerDifficulty) {
        selected.push(candidate);
        added++;
      }
    }
    if (added === 0) {
      break;
    }
  }
  if (selected.length !== teamsPerDifficulty) {
    throw new Error(`only ${selected.length} held-out ${difficulty} teams are available`);
  }
  return selected;
}

function pairSourceDistinct(candidates, difficulty) {
  const bySource = new Map();
  for (const candidate of candidates) {
    const group = bySource.get(candidate.sourceKey) ?? [];
    group.push(candidate);
    bySource.set(candidate.sourceKey, group);
  }
  for (const group of bySource.values()) {
    group.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  }
  const paired = [];
  while ([...bySource.values()].some(group => group.length > 0)) {
    const available = [...bySource.entries()]
      .filter(([, group]) => group.length > 0)
      .sort(
        ([sourceA, groupA], [sourceB, groupB]) =>
          groupB.length - groupA.length || hash(sourceA).localeCompare(hash(sourceB)),
      );
    if (available.length < 2) {
      throw new Error(`could not create source-distinct ${difficulty} inverse pairs`);
    }
    paired.push(available[0][1].shift(), available[1][1].shift());
  }
  return paired;
}

function difficultyCounts(candidates) {
  return Object.fromEntries(
    DIFFICULTIES.map(difficulty => [difficulty, candidates.filter(row => row.difficulty === difficulty).length]),
  );
}

const rawInput = readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const { candidates: allCandidates, invalidByDifficulty } = parseCandidates(JSON.parse(rawInput));
const sourceGroups = groupByAccount(allCandidates);
const { evaluationGroups, trainingGroups } = chooseEvaluationAccounts(sourceGroups);
const evaluationCandidates = DIFFICULTIES.flatMap(difficulty =>
  pairSourceDistinct(selectSourceDiverse(evaluationGroups, difficulty), difficulty),
);
const trainingCandidates = trainingGroups
  .flatMap(group => DIFFICULTIES.flatMap(difficulty => group.byDifficulty[difficulty]))
  .sort(
    (a, b) =>
      DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty)
      || a.fingerprint.localeCompare(b.fingerprint),
  );

const evaluationSources = new Set(evaluationGroups.map(group => group.sourceKey));
const trainingSources = new Set(trainingGroups.map(group => group.sourceKey));
const trainingPartitions = Array.from({ length: TRAINING_SOURCE_PARTITION_COUNT }, (_, index) => ({
  id: `training-source-fold-${index}`,
  rosterCount: 0,
}));
const trainingPartitionBySource = new Map();
for (const group of [...trainingGroups].sort((a, b) => {
  const countA = DIFFICULTIES.reduce((count, difficulty) => count + a.byDifficulty[difficulty].length, 0);
  const countB = DIFFICULTIES.reduce((count, difficulty) => count + b.byDifficulty[difficulty].length, 0);
  return countB - countA || hash(a.sourceKey).localeCompare(hash(b.sourceKey));
})) {
  const rosterCount = DIFFICULTIES.reduce((count, difficulty) => count + group.byDifficulty[difficulty].length, 0);
  const partition = trainingPartitions.toSorted((a, b) => a.rosterCount - b.rosterCount || a.id.localeCompare(b.id))[0];
  trainingPartitionBySource.set(group.sourceKey, partition.id);
  partition.rosterCount += rosterCount;
}
const sourceIntersection = [...evaluationSources].filter(source => trainingSources.has(source));
if (sourceIntersection.length > 0) {
  throw new Error(`account leakage across fixtures: ${sourceIntersection.length} sources`);
}

const normalization =
  "Original 1-6 member party size, species, form, ability slot, IVs, nature, gender, shiny tier, passive flag, four saved moves, and exactly reconstructable per-Pokemon held-item stacks are preserved. Historical generic item-generator ids whose subtype was not saved are excluded instead of rerolled. Run-global relics, challenges, and trainer modifiers are excluded.";
const fixture = {
  schemaVersion: 3,
  capturedDate,
  teamCount: evaluationCandidates.length,
  teamsPerDifficulty,
  difficultyCounts: difficultyCounts(evaluationCandidates),
  sourceAccountCount: evaluationSources.size,
  source:
    "Sanitized read-only snapshot of distinct winning ghost rosters across every difficulty; no run, account, player, seed, or timestamp identifiers retained.",
  selection:
    "Source accounts are partitioned before roster selection. The benchmark holds out exactly the requested number from each difficulty, selects source-diversely, and pairs only different accounts within a difficulty. Every held-out account is excluded from training.",
  normalization,
  teams: evaluationCandidates.map((candidate, index) => ({
    id: `${candidate.difficulty}-anchor-${String(index + 1).padStart(3, "0")}`,
    difficulty: candidate.difficulty,
    members: candidate.members,
  })),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
const result = {
  validDistinctRosters: difficultyCounts(allCandidates),
  invalidRosters: invalidByDifficulty,
  sourceAccounts: sourceGroups.length,
  evaluationTeams: fixture.teamCount,
  evaluationByDifficulty: fixture.difficultyCounts,
  evaluationSources: fixture.sourceAccountCount,
  inversePairs: fixture.teamCount / 2,
  sourceAccountIntersection: sourceIntersection.length,
};

if (trainingOutputPath) {
  if (trainingCandidates.length < 2) {
    throw new Error("the account-level holdout left fewer than two training rosters");
  }
  const trainingFixture = {
    schemaVersion: 3,
    capturedDate,
    teamCount: trainingCandidates.length,
    difficultyCounts: difficultyCounts(trainingCandidates),
    sourceAccountCount: trainingSources.size,
    source: fixture.source,
    selection:
      "Every roster comes from a source account excluded from the evaluation fixture. Accounts are assigned to opaque source folds before match scheduling, so one account cannot cross an offline train/evaluation split. Difficulty is retained as stratification metadata; Elite and Hell may be oversampled by self-play scheduling.",
    normalization,
    teams: trainingCandidates.map((candidate, index) => ({
      id: `${candidate.difficulty}-selfplay-${String(index + 1).padStart(4, "0")}`,
      difficulty: candidate.difficulty,
      sourcePartitionId: trainingPartitionBySource.get(candidate.sourceKey),
      members: candidate.members,
    })),
  };
  mkdirSync(dirname(trainingOutputPath), { recursive: true });
  writeFileSync(trainingOutputPath, `${JSON.stringify(trainingFixture, null, 2)}\n`);
  result.trainingTeams = trainingFixture.teamCount;
  result.trainingByDifficulty = trainingFixture.difficultyCounts;
  result.trainingSources = trainingFixture.sourceAccountCount;
}

console.log(JSON.stringify(result));
