/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

function oppositeSeat(seat) {
  return seat === "host-seat" ? "guest-seat" : "host-seat";
}

async function freshThroughWave2(rig) {
  await rig.loginBoth();
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun();
  await rig.driveWaveToReward();
  await rig.leaveRewardsAndReachWave2();
}

async function probe(rig) {
  await rig.loginBoth();
}

async function freshWave2(rig) {
  await freshThroughWave2(rig);
}

async function freshResume(rig) {
  await freshThroughWave2(rig);
  await rig.coldReopenAndPair(rig.config.requesterSeat);
  await rig.resumeRun({ expectedWave: 2 });
}

async function reverseResume(rig) {
  await freshThroughWave2(rig);
  await rig.coldReopenAndPair(oppositeSeat(rig.config.requesterSeat));
  await rig.resumeRun({ expectedWave: 2 });
}

async function faintReplacement(rig) {
  await rig.loginBoth();
  await rig.pair(rig.config.requesterSeat);
  await rig.resumeRun();
  await rig.driveWaveToReward({ allowFaint: true });
  if (rig.replacementCount === 0) {
    throw new Error(
      "Prepared faint journey reached rewards without a faint; seed the two staging accounts at the documented low-HP boundary",
    );
  }
}

const journeys = {
  probe,
  "fresh-wave2": freshWave2,
  "fresh-resume": freshResume,
  "reverse-resume": reverseResume,
  "faint-replacement": faintReplacement,
};

export async function runJourney(rig, name) {
  const journey = journeys[name];
  if (!journey) {
    throw new Error(`No public-UI journey named ${name}`);
  }
  await journey(rig);
}
