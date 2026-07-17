/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Solo classic-run journey that validates the state-aware navigation primitive
 * (`selectOptionById`) end to end against the read-only v2 semantic mirror, with NO
 * co-op pairing. A single browser context needs no lobby, so this proves the primitive
 * independent of co-op signaling - it is the foundation the co-op journey matrix reuses.
 */

import {
  confirmDefaultStarterTeam,
  selectFirstEmptySaveSlot,
  selectOptionById,
  waitForSemanticSurface,
} from "./campaign-nav.mjs";
import { delay } from "./evidence.mjs";

const TITLE_PHASE = /Start Phase TitlePhase/u;
const STARTER_PHASE = /Start Phase SelectStarterPhase/u;
const CHALLENGE_PHASE = /Start Phase SelectChallengePhase/u;
const GAME_MODE_SURFACE = "option-select:TitlePhase";
const COMMAND_SURFACE = "command:command";
const FIGHT_SURFACE = "command:fight";
const CHECK_SWITCH_SURFACE = "check-switch";

async function waitForSemantic(client, surfaceId, timeoutMs, from = 0) {
  return client.evidence.waitForCondition(sink => sink.findLastSemanticSurface(from, surfaceId), {
    timeoutMs,
    description: `v2 semantic surface ${surfaceId}`,
  });
}

/** Assert a single nav keypress changes the v2 selectedOptionId (proves the mirror is live). */
async function assertMirrorReactsToInput(client) {
  const before = client.evidence.findLastSemanticSurface(0, COMMAND_SURFACE);
  const beforeId = before?.observation.selectedOptionId ?? null;
  const beforeIndex = before?.index ?? -1;
  await client.press("ArrowRight", "solo-mirror-probe");
  const deadline = Date.now() + client.config.timeoutMs;
  while (Date.now() < deadline) {
    const now = client.evidence.findLastSemanticSurface(0, COMMAND_SURFACE);
    if (now && now.index > beforeIndex && now.observation.selectedOptionId !== beforeId) {
      client.evidence.record("solo-mirror-live", { before: beforeId, after: now.observation.selectedOptionId });
      return;
    }
    await delay(80);
  }
  throw new Error(`${client.label}: v2 command mirror did not react to a nav keypress (was ${beforeId})`);
}

/**
 * A multi-starter solo party opens the ordinary "Will you switch?" prompt before its
 * first command. The one-starter campaign used to bypass this real public surface and
 * falsely made the navigation probe look complete. Decline every visible initial prompt
 * by semantic option id, then return only from the live command surface.
 */
async function reachFirstCommand(client, from) {
  // Animations-on startup can legitimately spend more than the ordinary interaction timeout walking
  // summon/ability/stat narration on a heavily contended browser runner. Run 29556668290 reached the exact
  // healthy wave-1 CommandPhase at 123s, three seconds after the old 120s deadline. Keep this bounded, but
  // give the initial engine setup its own honest budget instead of reporting a real late command as a lock.
  const setupTimeoutMs = Math.max(client.config.timeoutMs, 180_000);
  for (let prompts = 0; prompts < 3; prompts++) {
    const surface = await client.evidence.waitForCondition(
      sink => {
        const latest = sink.findLastSemanticSurface(from);
        if (latest?.observation.surfaceId === COMMAND_SURFACE) {
          return latest;
        }
        if (
          latest?.observation.surfaceId === CHECK_SWITCH_SURFACE
          && latest.observation.ready?.handlerActive === true
          && latest.observation.optionIds?.includes("no")
        ) {
          return latest;
        }
        return null;
      },
      {
        timeoutMs: setupTimeoutMs,
        description: "first command or initial check-switch surface",
      },
    );
    if (surface.observation.surfaceId === COMMAND_SURFACE) {
      return surface;
    }
    await selectOptionById(client, {
      surfaceId: CHECK_SWITCH_SURFACE,
      targetId: "no",
      navKeys: ["ArrowUp", "ArrowDown"],
      timeoutMs: client.config.timeoutMs,
    });
  }
  return waitForSemantic(client, COMMAND_SURFACE, setupTimeoutMs, from);
}

export async function runSoloClassic(client) {
  await client.loginOrReuseSession();
  await client.evidence.waitFor(TITLE_PHASE, {
    from: client.pageCursor,
    timeoutMs: client.config.timeoutMs,
    description: "solo TitlePhase",
  });
  await client.checkpoint("solo-title");

  // Open New Game -> Classic (index 0; co-op sits one row BELOW classic in the same menu).
  await client.sequence(client.titleNewGameKeys, "solo-title-select-new-game");
  const gameModeCursor = client.evidence.cursor();
  await client.press("Space", "solo-open-new-game");
  await waitForSemantic(client, GAME_MODE_SURFACE, client.config.timeoutMs, gameModeCursor);
  await selectOptionById(client, {
    surfaceId: GAME_MODE_SURFACE,
    targetId: "classic",
    navKeys: ["ArrowUp", "ArrowDown"],
  });

  // Classic solo may show a challenge screen before starter select; take the default start.
  const entry = await client.evidence.waitForCondition(
    sink => sink.find(CHALLENGE_PHASE, client.pageCursor) ?? sink.find(STARTER_PHASE, client.pageCursor),
    { timeoutMs: client.config.timeoutMs, description: "solo challenge or starter surface" },
  );
  if (CHALLENGE_PHASE.test(entry.text ?? "")) {
    await client.checkpoint("solo-challenge");
    await client.sequence(client.config.keys.challenge, "solo-challenge-start");
  }
  await client.evidence.waitFor(STARTER_PHASE, {
    from: client.pageCursor,
    timeoutMs: client.config.timeoutMs,
    description: "solo SelectStarterPhase",
  });
  await client.checkpoint("solo-starter-select");
  const { launchCursor } = await confirmDefaultStarterTeam(client, { timeoutMs: client.config.timeoutMs });
  await waitForSemanticSurface(client, "option-select:SelectStarterPhase", {
    fromCursor: launchCursor,
    timeoutMs: client.config.timeoutMs,
  });
  await selectOptionById(client, {
    surfaceId: "option-select:SelectStarterPhase",
    targetId: "ace",
    navKeys: ["ArrowUp", "ArrowDown"],
    timeoutMs: client.config.timeoutMs,
  });
  await selectFirstEmptySaveSlot(client, {
    fromCursor: launchCursor,
    timeoutMs: client.config.timeoutMs,
  });
  await reachFirstCommand(client, launchCursor);
  await client.checkpoint("solo-wave1-command");

  // Validate the primitive against the LIVE mirror:
  //  1. a nav keypress changes the observed selection;
  //  2. selectOptionById navigates back to Fight (cursor:0), verifying each press moved the
  //     cursor, then submits - opening the real Fight move menu.
  await assertMirrorReactsToInput(client);
  await selectOptionById(client, {
    surfaceId: COMMAND_SURFACE,
    targetId: "cursor:0",
    navKeys: ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"],
    submit: true,
  });

  // The Fight move menu is a real option surface; pick the first move by id and submit.
  await waitForSemantic(client, FIGHT_SURFACE, client.config.timeoutMs);
  await client.checkpoint("solo-fight-menu");
  await selectOptionById(client, {
    surfaceId: FIGHT_SURFACE,
    targetId: "cursor:0",
    navKeys: ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"],
    submit: true,
  });

  // Best-effort: capture the next interactive surface (next command or reward) as evidence.
  // The primitive itself is already validated above, so this wait never fails the journey.
  const reachedNext = await client.evidence
    .waitForCondition(
      sink => sink.findLastSemanticSurface(0, COMMAND_SURFACE) ?? sink.findLastSemanticSurface(0, "reward-shop"),
      { timeoutMs: Math.min(client.config.timeoutMs, 30_000), description: "post-move interactive surface" },
    )
    .catch(() => null);
  await client.checkpoint(reachedNext ? "solo-post-move-surface" : "solo-final");
}
