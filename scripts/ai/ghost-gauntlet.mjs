import { readFileSync } from "node:fs";

const GHOST_DIFFICULTIES = ["youngster", "ace", "elite", "hell"];

export function readGhostFixture(path) {
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  validateGhostFixture(fixture);
  return fixture;
}

function validateGhostMember(member, teamId) {
  if (
    !Number.isInteger(member.species)
    || member.species <= 0
    || !Array.isArray(member.moves)
    || member.moves.length === 0
    || member.moves.length > 4
  ) {
    throw new Error(`invalid member in ${teamId}`);
  }
  if (!Array.isArray(member.ivs) || member.ivs.length !== 6 || member.ivs.some(iv => iv < 0 || iv > 31)) {
    throw new Error(`invalid IVs in ${teamId}`);
  }
  const invalidHeldItems =
    member.heldItems !== undefined
    && (!Array.isArray(member.heldItems)
      || member.heldItems.some(
        row => !Array.isArray(row) || typeof row[0] !== "string" || !Number.isInteger(row[1]) || row[1] < 1,
      ));
  if (invalidHeldItems) {
    throw new Error(`invalid held items in ${teamId}`);
  }
}

function validateGhostTeam(team, ids) {
  const invalidTeam =
    typeof team.id !== "string"
    || ids.has(team.id)
    || !Array.isArray(team.members)
    || team.members.length === 0
    || team.members.length > 6;
  if (invalidTeam) {
    throw new Error(`invalid or duplicate ghost team ${String(team?.id)}`);
  }
  ids.add(team.id);
  if (team.difficulty !== undefined && !GHOST_DIFFICULTIES.includes(team.difficulty)) {
    throw new Error(`invalid difficulty in ${team.id}`);
  }
  team.members.forEach(member => validateGhostMember(member, team.id));
}

export function validateGhostFixture(fixture) {
  if (![2, 3].includes(fixture?.schemaVersion) || !Array.isArray(fixture.teams) || fixture.teams.length < 2) {
    throw new Error("ghost fixture must contain at least two schema-v2 or schema-v3 teams");
  }
  const ids = new Set();
  for (const team of fixture.teams) {
    validateGhostTeam(team, ids);
  }
}

function scenarioMember(member, enemy) {
  return {
    species: member.species,
    formIndex: member.formIndex,
    abilitySlot: member.abilitySlot,
    ivs: member.ivs,
    nature: member.nature,
    moves: member.moves,
    shiny: member.shiny,
    variant: member.variant,
    passive: member.passive,
    ...(member.heldItems?.length > 0 ? { heldItems: member.heldItems.map(([name, count]) => ({ name, count })) } : {}),
    ...(member.gender < 0 ? {} : { female: member.gender === 1 }),
    ...(enemy ? { level: 200 } : {}),
  };
}

export function buildGhostPair(fixture, pairIndex, fixedSeed = 0) {
  validateGhostFixture(fixture);
  if (fixture.teams.length % 2 !== 0) {
    throw new Error("evaluation fixture team count must be even so every matchup has an inverse leg");
  }
  const pairCount = fixture.teams.length / 2;
  if (!Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= pairCount) {
    throw new Error(`pair index must be from 0 through ${pairCount - 1}`);
  }
  const teamA = fixture.teams[pairIndex * 2];
  const teamB = fixture.teams[pairIndex * 2 + 1];
  const difficulty = teamA.difficulty ?? "hell";
  if ((teamB.difficulty ?? "hell") !== difficulty) {
    throw new Error(`evaluation pair ${pairIndex} crosses difficulties`);
  }
  const pairId = `${difficulty}-pair-${String(pairIndex + 1).padStart(3, "0")}-seed-${fixedSeed}`;
  const seed = `er-ai-ghost-v3-${difficulty}-${pairIndex}-${fixedSeed}`;
  const buildLeg = (leg, player, enemy) => ({
    v: 1,
    name: `Ghost gauntlet ${pairId} leg ${leg.toUpperCase()}: ${player.id} vs ${enemy.id}`,
    notes: `Sanitized winning ${difficulty} rosters with per-Pokemon held items. Strict mirrored leg required; no player identity.`,
    run: { wave: 199, level: 200, seed, difficulty: "hell", enemyAi: "hardest", double: true },
    party: player.members.map(member => scenarioMember(member, false)),
    enemy: { kind: "party", party: enemy.members.map(member => scenarioMember(member, true)) },
    eggs: "skip",
  });
  return {
    manifest: {
      schemaVersion: 3,
      pairId,
      seed,
      fixedSeed,
      difficulty,
      playerControllers: ["smart-default-v1", "engine-hardest-v1"],
      controllerB: "engine-trainer-ai",
      legs: [
        { leg: "a", playerTeamId: teamA.id, enemyTeamId: teamB.id },
        { leg: "b", playerTeamId: teamB.id, enemyTeamId: teamA.id },
      ],
    },
    legA: buildLeg("a", teamA, teamB),
    legB: buildLeg("b", teamB, teamA),
  };
}

const roundRobinCache = new Map();

function roundRobinPairs(teamCount) {
  const cached = roundRobinCache.get(teamCount);
  if (cached) {
    return cached;
  }
  const participants = Array.from({ length: teamCount }, (_, index) => index);
  if (participants.length % 2 !== 0) {
    participants.push(null);
  }
  const pairs = [];
  for (let round = 0; round < participants.length - 1; round++) {
    for (let slot = 0; slot < participants.length / 2; slot++) {
      const first = participants[slot];
      const second = participants.at(-slot - 1);
      if (first != null && second != null) {
        pairs.push([first, second]);
      }
    }
    participants.splice(1, 0, participants.pop());
  }
  roundRobinCache.set(teamCount, pairs);
  return pairs;
}

export function buildGhostSelfPlayScenario(fixture, episodeIndex) {
  validateGhostFixture(fixture);
  if (!Number.isInteger(episodeIndex) || episodeIndex < 0) {
    throw new Error(`episode index must be a non-negative integer: ${episodeIndex}`);
  }
  const pairCount = (fixture.teams.length * (fixture.teams.length - 1)) / 2;
  const inversePairIndex = Math.floor(episodeIndex / 2);
  const pairIndex = inversePairIndex % pairCount;
  const cycle = Math.floor(inversePairIndex / pairCount);
  const [firstIndex, secondIndex] = roundRobinPairs(fixture.teams.length)[pairIndex];
  const reverse = episodeIndex % 2 === 1;
  const player = fixture.teams[reverse ? secondIndex : firstIndex];
  const enemy = fixture.teams[reverse ? firstIndex : secondIndex];
  const difficulty = [player.difficulty ?? "hell", enemy.difficulty ?? "hell"].sort(
    (a, b) => GHOST_DIFFICULTIES.indexOf(b) - GHOST_DIFFICULTIES.indexOf(a),
  )[0];
  const format = ["single", "double", "triple"][(pairIndex + cycle) % 3];
  const seed = `er-ai-selfplay-v1-${pairIndex}-${cycle}`;
  return {
    v: 1,
    name: `Ghost self-play ${player.id} vs ${enemy.id}`,
    notes:
      "Combat-only training episode from source-disjoint sanitized winning ghosts. Difficulty metadata, saved movesets, and reconstructable per-Pokemon held items are preserved.",
    run: {
      wave: 199,
      level: 200,
      seed,
      difficulty,
      enemyAi: "hardest",
      ...(format === "single" ? { double: false } : {}),
      ...(format === "double" ? { double: true } : {}),
      ...(format === "triple" ? { triple: true } : {}),
    },
    party: player.members.map(member => scenarioMember(member, false)),
    enemy: { kind: "party", party: enemy.members.map(member => scenarioMember(member, true)) },
  };
}

export function assertInversePair(pair) {
  const [a, b] = pair.manifest.legs;
  if (a.playerTeamId !== b.enemyTeamId || a.enemyTeamId !== b.playerTeamId) {
    throw new Error(`${pair.manifest.pairId} is not a strict inverse matchup`);
  }
  const withoutEnemyLevel = member => {
    const { level: _level, ...rest } = member;
    return rest;
  };
  const playerA = pair.legA.party;
  const enemyB = pair.legB.enemy.party.map(withoutEnemyLevel);
  const enemyA = pair.legA.enemy.party.map(withoutEnemyLevel);
  const playerB = pair.legB.party;
  if (JSON.stringify(playerA) !== JSON.stringify(enemyB) || JSON.stringify(enemyA) !== JSON.stringify(playerB)) {
    throw new Error(`${pair.manifest.pairId} changed a roster between mirrored legs`);
  }
}
