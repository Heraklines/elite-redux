export type ErRunPacing = "normal" | "sprint";

export interface ErRunPacingProfile {
  readonly finalWave: number;
  readonly progressionScale: number;
  readonly checkpointInterval: number;
  readonly majorCheckpointInterval: number;
  readonly mysteryEncounterMaxWave: number;
  readonly mysteryEncounterTarget: number;
  readonly finaleRoutingStartWave: number;
}

const PROFILES: Readonly<Record<ErRunPacing, ErRunPacingProfile>> = {
  normal: {
    finalWave: 200,
    progressionScale: 1,
    checkpointInterval: 10,
    majorCheckpointInterval: 50,
    mysteryEncounterMaxWave: 180,
    mysteryEncounterTarget: 24,
    finaleRoutingStartWave: 170,
  },
  sprint: {
    finalWave: 100,
    progressionScale: 2,
    checkpointInterval: 5,
    majorCheckpointInterval: 25,
    mysteryEncounterMaxWave: 90,
    mysteryEncounterTarget: 16,
    finaleRoutingStartWave: 85,
  },
};

let currentPacing: ErRunPacing = "normal";
let sprintVoucherCredit = 0;

export function getErRunPacing(): ErRunPacing {
  return currentPacing;
}

export function setErRunPacing(pacing: ErRunPacing): void {
  currentPacing = pacing === "sprint" ? "sprint" : "normal";
}

export function resetErRunPacing(): void {
  currentPacing = "normal";
  sprintVoucherCredit = 0;
}

export function resetErSprintVoucherCredit(): void {
  sprintVoucherCredit = 0;
}

export function getErSprintVoucherCredit(): number {
  return sprintVoucherCredit;
}

export function restoreErSprintVoucherCredit(credit?: number): void {
  sprintVoucherCredit = Number.isFinite(credit) ? Math.max(0, Math.min(0.999, credit!)) : 0;
}

export function addErSprintTrainerVoucherCredit(
  difficulty: "youngster" | "ace" | "elite" | "hell" | "mystery",
): number {
  const rate = { youngster: 0, ace: 0.5, elite: 1, hell: 1.5, mystery: 1.5 }[difficulty];
  sprintVoucherCredit += rate;
  const awards = Math.floor(sprintVoucherCredit);
  sprintVoucherCredit -= awards;
  return awards;
}

export function isErSprintRun(): boolean {
  return currentPacing === "sprint";
}

export function getErRunPacingProfile(pacing: ErRunPacing = currentPacing): ErRunPacingProfile {
  return PROFILES[pacing];
}

export function getErFinalWave(): number {
  return getErRunPacingProfile().finalWave;
}

export function getErProgressionWave(runWave: number): number {
  return Math.max(1, Math.floor(runWave)) * getErRunPacingProfile().progressionScale;
}

export function getErCheckpointInterval(): number {
  return getErRunPacingProfile().checkpointInterval;
}

export function isErCheckpointWave(runWave: number): boolean {
  return runWave > 0 && runWave % getErCheckpointInterval() === 0;
}

export function isErChapterStartWave(runWave: number): boolean {
  return runWave > 0 && (runWave - 1) % getErCheckpointInterval() === 0;
}

export function getErChapterSlot(runWave: number): number {
  return ((Math.max(1, runWave) - 1) % getErCheckpointInterval()) + 1;
}

export function isErMajorCheckpointWave(runWave: number): boolean {
  return runWave > 0 && runWave % getErRunPacingProfile().majorCheckpointInterval === 0;
}

export function getErMysteryEncounterTarget(): number {
  return getErRunPacingProfile().mysteryEncounterTarget;
}

export function getErMysteryEncounterLegalWaves(): [number, number] {
  return [1, getErRunPacingProfile().mysteryEncounterMaxWave];
}

export function getErFinaleRoutingStartWave(): number {
  return getErRunPacingProfile().finaleRoutingStartWave;
}

export function getErGymInterval(): number {
  return isErSprintRun() ? 15 : 30;
}

const SPRINT_STORY_SOURCE_WAVES: Readonly<Record<number, number>> = {
  3: 5, 4: 8, 13: 25, 18: 35, 28: 55, 31: 62, 32: 64, 33: 66,
  48: 95, 56: 112, 57: 114, 58: 115, 73: 145, 82: 164, 83: 165,
  91: 182, 92: 184, 93: 186, 94: 188, 95: 190, 98: 195,
};

/** Return the original Classic story-wave identity for authored reward/seed data. */
export function getErStorySourceWave(runWave: number): number {
  return isErSprintRun() ? (SPRINT_STORY_SOURCE_WAVES[runWave] ?? runWave) : runWave;
}
