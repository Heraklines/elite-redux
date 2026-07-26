import { readFileSync, writeFileSync } from "node:fs";

const DIR = new URL("./data/", import.meta.url);
const runsDump = JSON.parse(readFileSync(new URL("_runs.json", DIR), "utf8"));
const showdownDump = JSON.parse(readFileSync(new URL("_showdown.json", DIR), "utf8"));
const dex = JSON.parse(readFileSync(new URL("dex.json", DIR), "utf8"));
const detail = JSON.parse(readFileSync(new URL("dex-detail.json", DIR), "utf8"));
const extra = JSON.parse(readFileSync(new URL("species-extra.json", DIR), "utf8"));
const runs = Array.isArray(runsDump.rows) ? runsDump.rows : [];
const showdownRows = Array.isArray(showdownDump.rows) ? showdownDump.rows : [];

const SHOWN_DIFFS = ["ace", "elite", "hell"];
const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const MIN_INSIGHT_COUNT = 5;
const byId = new Map(dex.filter(mon => Number.isFinite(mon.id)).map(mon => [Number(mon.id), mon]));
const extraById = extra.species || {};
const round1 = value => Math.round(value * 10) / 10;
const round2 = value => Math.round(value * 100) / 100;
const usageBand = value => (value >= 2.25 ? 0 : value >= 1 ? 1 : value >= 0.5 ? 2 : value >= 0.25 ? 3 : 4);
const eggBand = value => (value === 3 ? 0 : value === 2 ? 1 : value === 1 ? 2 : 4);
const tierFor = (usage, egg) => TIERS[Math.min(usageBand(usage), eggBand(egg))];

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return value;
  }
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function humanize(value) {
  return String(value ?? "")
    .replace(/^.*\./, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function increment(map, key, amount = 1) {
  if (key !== null && key !== undefined && key !== "") {
    map.set(key, (map.get(key) ?? 0) + amount);
  }
}

function rootFor(speciesId, preferredRoot) {
  const candidates = [Number(preferredRoot), Number(extraById[speciesId]?.rootId), Number(speciesId)];
  return candidates.find(id => Number.isFinite(id) && byId.has(id)) ?? null;
}

function formFor(speciesId, formIndex) {
  const forms = extraById[speciesId]?.forms;
  return Array.isArray(forms) ? forms[formIndex] ?? forms[0] ?? null : null;
}

function moveIdOf(move) {
  if (Array.isArray(move)) {
    return Number(move[0]);
  }
  return Number(move?.moveId ?? move?.id ?? move);
}

function topCounter(counter, denominator, labelFor, limit = 8) {
  if (!denominator) {
    return [];
  }
  return [...counter.entries()]
    .filter(([, count]) => count >= MIN_INSIGHT_COUNT)
    .sort((a, b) => b[1] - a[1] || String(labelFor(a[0])).localeCompare(String(labelFor(b[0]))))
    .slice(0, limit)
    .map(([key, count]) => ({ name: labelFor(key), pct: round1((100 * count) / denominator), sample: count }));
}

function bucket(map, key) {
  let value = map.get(key);
  if (!value) {
    value = { runs: 0, wins: 0 };
    map.set(key, value);
  }
  return value;
}

function line(id) {
  let value = runLines.get(id);
  if (!value) {
    value = {
      runs: 0,
      wins: 0,
      waveSum: 0,
      waveCount: 0,
      players: new Set(),
      diff: {},
      mates: new Map(),
      finalMembers: 0,
      moves: new Map(),
      abilities: new Map(),
      forms: new Map(),
      relics: new Map(),
    };
    runLines.set(id, value);
  }
  return value;
}

function showdownLine(id) {
  let value = showdownLines.get(id);
  if (!value) {
    value = {
      appearances: 0,
      decisiveAppearances: 0,
      wins: 0,
      items: new Map(),
      forms: new Map(),
    };
    showdownLines.set(id, value);
  }
  return value;
}

const players = new Set();
const runLines = new Map();
const showdownLines = new Map();
const difficulties = new Map();
const modes = new Map();
const challenges = new Map();
const relics = new Map();
const ghostThreats = new Map();
let totalRuns = 0;
let totalWins = 0;
let ghostDefeats = 0;

for (const row of runs) {
  const starters = parseJson(row.starters, []);
  if (!Array.isArray(starters)) {
    continue;
  }
  const roots = [...new Set(starters.map(Number).filter(id => byId.has(id)))];
  if (roots.length === 0) {
    continue;
  }
  const win = row.outcome === "victory";
  const wave = Number(row.wave) || 0;
  const difficulty = String(row.difficulty || "unknown").toLowerCase();
  const mode = String(row.mode || "unknown").toLowerCase();
  totalRuns++;
  totalWins += win ? 1 : 0;
  if (row.playerKey) {
    players.add(row.playerKey);
  }
  const difficultyBucket = bucket(difficulties, difficulty);
  difficultyBucket.runs++;
  difficultyBucket.wins += win ? 1 : 0;
  const modeBucket = bucket(modes, mode);
  modeBucket.runs++;
  modeBucket.wins += win ? 1 : 0;

  const challengeRows = parseJson(row.challenges, []);
  if (Array.isArray(challengeRows)) {
    for (const challenge of challengeRows) {
      const id = Number(Array.isArray(challenge) ? challenge[0] : challenge?.id);
      const value = Number(Array.isArray(challenge) ? challenge[1] : challenge?.value);
      if (Number.isFinite(id) && value > 0) {
        increment(challenges, id);
      }
    }
  }

  const runRelics = [];
  const relicRows = parseJson(row.relics, []);
  if (Array.isArray(relicRows)) {
    for (const relic of relicRows) {
      const key = Array.isArray(relic) ? relic[0] : relic?.id ?? relic?.type;
      if (key !== null && key !== undefined && key !== "") {
        runRelics.push(String(key));
        increment(relics, String(key));
      }
    }
  }

  for (const id of roots) {
    const aggregate = line(id);
    aggregate.runs++;
    aggregate.wins += win ? 1 : 0;
    if (wave <= 200) {
      aggregate.waveSum += wave;
      aggregate.waveCount++;
    }
    if (row.playerKey) {
      aggregate.players.add(row.playerKey);
    }
    const diff = (aggregate.diff[difficulty] ??= { runs: 0, wins: 0 });
    diff.runs++;
    diff.wins += win ? 1 : 0;
    for (const other of roots) {
      if (other !== id) {
        increment(aggregate.mates, other);
      }
    }
    for (const relic of runRelics) {
      increment(aggregate.relics, relic);
    }
  }

  const finalTeam = parseJson(row.player_team, []);
  if (Array.isArray(finalTeam)) {
    for (const member of finalTeam) {
      const speciesId = Number(member?.speciesId ?? member?.species);
      const formIndex = Number(member?.formIndex) || 0;
      const root = rootFor(speciesId, member?.rootSpeciesId);
      if (root === null || !roots.includes(root)) {
        continue;
      }
      const aggregate = line(root);
      aggregate.finalMembers++;
      const form = formFor(speciesId, formIndex);
      increment(aggregate.forms, `${speciesId}:${formIndex}`);
      const abilityIndex = Number(member?.abilityIndex);
      const abilityId = Number(form?.activeAbilityIds?.[abilityIndex]);
      if (Number.isFinite(abilityId) && detail.abilities?.[abilityId]) {
        increment(aggregate.abilities, abilityId);
      }
      if (Array.isArray(member?.moves)) {
        for (const move of member.moves) {
          const moveId = moveIdOf(move);
          if (Number.isFinite(moveId) && detail.moves?.[moveId]) {
            increment(aggregate.moves, moveId);
          }
        }
      }
    }
  }

  if (Number(row.killed_by_ghost) === 1) {
    ghostDefeats++;
    const opponents = parseJson(row.opponent_team, []);
    const seen = new Set();
    if (Array.isArray(opponents)) {
      for (const member of opponents) {
        const speciesId = Number(member?.speciesId ?? member?.species);
        const root = rootFor(speciesId, member?.rootSpeciesId);
        if (root !== null) {
          seen.add(root);
        }
      }
    }
    for (const root of seen) {
      increment(ghostThreats, root);
    }
  }
}

let showdownMatches = 0;
let decisiveMatches = 0;
let turnSum = 0;
let durationSum = 0;
const showdownReasons = new Map();

for (const row of showdownRows) {
  const summary = parseJson(row.summary_json, null);
  if (!summary || !Array.isArray(summary.hostTeam) || !Array.isArray(summary.guestTeam)) {
    continue;
  }
  showdownMatches++;
  increment(showdownReasons, String(row.reason || "unknown"));
  const decisive = row.winner === "host" || row.winner === "guest";
  if (decisive) {
    decisiveMatches++;
    turnSum += Math.max(0, Number(row.turns) || 0);
    durationSum += Math.max(0, Number(row.duration_ms) || 0);
  }
  for (const side of ["host", "guest"]) {
    const team = side === "host" ? summary.hostTeam : summary.guestTeam;
    for (const member of team) {
      const speciesId = Number(member?.speciesId);
      const formIndex = Number(member?.formIndex) || 0;
      const root = rootFor(speciesId, member?.rootSpeciesId);
      if (root === null) {
        continue;
      }
      const aggregate = showdownLine(root);
      aggregate.appearances++;
      if (decisive) {
        aggregate.decisiveAppearances++;
        aggregate.wins += row.winner === side ? 1 : 0;
      }
      increment(aggregate.items, String(member?.item || "None"));
      increment(aggregate.forms, `${speciesId}:${formIndex}`);
    }
  }
}

const baselineWin = totalRuns > 0 ? (100 * totalWins) / totalRuns : 0;
const abilityName = id => detail.abilities?.[id]?.name || `Ability #${id}`;
const moveName = id => detail.moves?.[id]?.name || `Move #${id}`;
const formName = key => {
  const [speciesId, formIndex] = String(key).split(":").map(Number);
  return formFor(speciesId, formIndex)?.name || extraById[speciesId]?.name || `Species #${speciesId}`;
};

const species = {};
let maxWin = 0;
for (const [id, aggregate] of runLines) {
  const mon = byId.get(id);
  if (!mon) {
    continue;
  }
  const winAll = aggregate.runs ? (100 * aggregate.wins) / aggregate.runs : 0;
  if (aggregate.runs >= 20) {
    maxWin = Math.max(maxWin, winAll);
  }
  const winPct = { all: round1(winAll) };
  for (const difficulty of SHOWN_DIFFS) {
    const slice = aggregate.diff[difficulty];
    winPct[difficulty] = slice?.runs ? round1((100 * slice.wins) / slice.runs) : 0;
  }
  const usagePct = players.size ? round2((100 * aggregate.players.size) / players.size) : 0;
  const showdown = showdownLines.get(id);
  species[mon.slug] = {
    usagePct,
    tier: tierFor(usagePct, mon.eggTier),
    pickPct: totalRuns ? round1((100 * aggregate.runs) / totalRuns) : 0,
    winPct,
    lift: round1(winAll - baselineWin),
    avgWave: aggregate.waveCount ? Math.round(aggregate.waveSum / aggregate.waveCount) : 0,
    sample: aggregate.runs,
    topAbilities: topCounter(aggregate.abilities, aggregate.finalMembers, abilityName),
    topMoves: topCounter(aggregate.moves, aggregate.finalMembers, moveName),
    topItems: showdown ? topCounter(showdown.items, showdown.appearances, humanize) : [],
    topForms: topCounter(aggregate.forms, aggregate.finalMembers, formName),
    topRelics: topCounter(aggregate.relics, aggregate.runs, humanize),
    topTeammates: [...aggregate.mates.entries()]
      .filter(([, count]) => count >= MIN_INSIGHT_COUNT)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([otherId, count]) => ({
        slug: byId.get(otherId).slug,
        name: byId.get(otherId).name,
        pct: round1((100 * count) / aggregate.runs),
        sample: count,
      })),
    showdown: showdown && showdown.decisiveAppearances >= MIN_INSIGHT_COUNT
      ? {
          appearances: showdown.appearances,
          sample: showdown.decisiveAppearances,
          wins: showdown.wins,
          winPct: round1((100 * showdown.wins) / showdown.decisiveAppearances),
        }
      : null,
  };
}

function aggregateRows(map, nameFor = humanize) {
  return [...map.entries()]
    .filter(([, value]) => (typeof value === "number" ? value : value.runs) >= MIN_INSIGHT_COUNT)
    .sort((a, b) => (typeof b[1] === "number" ? b[1] : b[1].runs) - (typeof a[1] === "number" ? a[1] : a[1].runs))
    .map(([key, value]) => {
      if (typeof value === "number") {
        return { name: nameFor(key), sample: value, pct: totalRuns ? round1((100 * value) / totalRuns) : 0 };
      }
      return {
        name: nameFor(key),
        runs: value.runs,
        wins: value.wins,
        winPct: value.runs ? round1((100 * value.wins) / value.runs) : 0,
      };
    });
}

const showdownSpecies = [...showdownLines.entries()]
  .filter(([, value]) => value.decisiveAppearances >= MIN_INSIGHT_COUNT)
  .sort((a, b) => b[1].appearances - a[1].appearances)
  .slice(0, 30)
  .map(([id, value]) => ({
    id,
    slug: byId.get(id)?.slug,
    name: byId.get(id)?.name,
    appearances: value.appearances,
    sample: value.decisiveAppearances,
    wins: value.wins,
    winPct: round1((100 * value.wins) / value.decisiveAppearances),
  }));

const payload = {
  _sample: false,
  source: "aggregated production telemetry",
  generatedAt: runsDump.generatedAt || new Date().toISOString(),
  sourceSha: process.env.STATS_SOURCE_SHA || detail.sourceSha || "local",
  window: {
    days: Number(runsDump.windowDays) || 30,
    from: new Date(Number(runsDump.since)).toISOString(),
    to: new Date(Number(runsDump.until)).toISOString(),
  },
  privacy: { minimumPublishedSample: MIN_INSIGHT_COUNT },
  totalRuns,
  totalWins,
  players: players.size,
  baselineWin: round2(baselineWin),
  meta: {
    winMid: round1(baselineWin),
    winMax: Math.max(round1(maxWin), round1(baselineWin * 2), 5),
  },
  aggregates: {
    runs: {
      difficulties: aggregateRows(difficulties),
      modes: aggregateRows(modes),
      challenges: aggregateRows(challenges, id => detail.challengeNames?.[id] || `Challenge #${id}`),
      relics: aggregateRows(relics),
      ghostDefeats,
      ghostThreats: [...ghostThreats.entries()]
        .filter(([, count]) => count >= MIN_INSIGHT_COUNT)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([id, count]) => ({ id, slug: byId.get(id)?.slug, name: byId.get(id)?.name, sample: count })),
    },
    showdown: {
      matches: showdownMatches,
      decisiveMatches,
      averageTurns: decisiveMatches ? round1(turnSum / decisiveMatches) : 0,
      averageDurationSeconds: decisiveMatches ? round1(durationSum / decisiveMatches / 1000) : 0,
      reasons: [...showdownReasons.entries()]
        .filter(([, count]) => count >= MIN_INSIGHT_COUNT)
        .sort((a, b) => b[1] - a[1])
        .map(([name, sample]) => ({ name: humanize(name), sample })),
      species: showdownSpecies,
    },
  },
  species,
};

writeFileSync(new URL("species-stats.json", DIR), `${JSON.stringify(payload)}\n`, "utf8");
console.log(
  `runs=${totalRuns} wins=${totalWins} players=${players.size} species=${Object.keys(species).length} showdown=${showdownMatches}`,
);
