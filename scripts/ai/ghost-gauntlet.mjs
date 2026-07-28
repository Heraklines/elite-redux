import { readFileSync } from "node:fs";

export function readGhostFixture(path) {
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  validateGhostFixture(fixture);
  return fixture;
}

export function validateGhostFixture(fixture) {
  if (fixture?.schemaVersion !== 1 || !Array.isArray(fixture.teams) || fixture.teams.length < 2) {
    throw new Error("ghost fixture must contain at least two schema-v1 teams");
  }
  if (fixture.teams.length % 2 !== 0) {
    throw new Error("ghost fixture team count must be even so every matchup has an inverse leg");
  }
  const ids = new Set();
  for (const team of fixture.teams) {
    if (typeof team.id !== "string" || ids.has(team.id) || !Array.isArray(team.members) || team.members.length !== 6) {
      throw new Error(`invalid or duplicate ghost team ${String(team?.id)}`);
    }
    ids.add(team.id);
    for (const member of team.members) {
      if (!Number.isInteger(member.species) || member.species <= 0 || member.moves?.length !== 4) {
        throw new Error(`invalid member in ${team.id}`);
      }
      if (!Array.isArray(member.ivs) || member.ivs.length !== 6 || member.ivs.some(iv => iv < 0 || iv > 31)) {
        throw new Error(`invalid IVs in ${team.id}`);
      }
    }
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
    ...(member.gender < 0 ? {} : { female: member.gender === 1 }),
    ...(enemy ? { level: 200 } : {}),
  };
}

export function buildGhostPair(fixture, pairIndex) {
  validateGhostFixture(fixture);
  const pairCount = fixture.teams.length / 2;
  if (!Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= pairCount) {
    throw new Error(`pair index must be from 0 through ${pairCount - 1}`);
  }
  const teamA = fixture.teams[pairIndex * 2];
  const teamB = fixture.teams[pairIndex * 2 + 1];
  const pairId = `pair-${String(pairIndex + 1).padStart(2, "0")}`;
  const seed = `er-ai-ghost-v1-${pairId}`;
  const buildLeg = (leg, player, enemy) => ({
    v: 1,
    name: `Ghost gauntlet ${pairId} leg ${leg.toUpperCase()}: ${player.id} vs ${enemy.id}`,
    notes: "Sanitized winning Hell rosters. Mirrored leg required; no held-item stacks or player identity.",
    run: { wave: 199, level: 200, seed, difficulty: "hell", double: true },
    party: player.members.map(member => scenarioMember(member, false)),
    enemy: { kind: "party", party: enemy.members.map(member => scenarioMember(member, true)) },
    eggs: "skip",
  });
  return {
    manifest: {
      schemaVersion: 1,
      pairId,
      seed,
      controllerA: "smart-default-v1",
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

export function assertInversePair(pair) {
  const [a, b] = pair.manifest.legs;
  if (a.playerTeamId !== b.enemyTeamId || a.enemyTeamId !== b.playerTeamId) {
    throw new Error(`${pair.manifest.pairId} is not a strict inverse matchup`);
  }
  const playerA = pair.legA.party.map(member => member.species);
  const enemyB = pair.legB.enemy.party.map(member => member.species);
  const enemyA = pair.legA.enemy.party.map(member => member.species);
  const playerB = pair.legB.party.map(member => member.species);
  if (JSON.stringify(playerA) !== JSON.stringify(enemyB) || JSON.stringify(enemyA) !== JSON.stringify(playerB)) {
    throw new Error(`${pair.manifest.pairId} changed a roster between mirrored legs`);
  }
}
