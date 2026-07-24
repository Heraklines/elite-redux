/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { loggedInUser } from "#app/account";
import { globalScene } from "#app/global-scene";
import { CoopLobbyController, type LobbyPlayer } from "#data/elite-redux/coop/coop-lobby";
import { type CoopRuntime, clearCoopRuntime, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { UiMode } from "#enums/ui-mode";

const STORAGE_KEY = "er-showdown-matchmaking-v1";
const MATCH_ROOM = "showdown-matchmaking-v1";
export const SHOWDOWN_MATCH_ACCEPT_MS = 60_000;

interface StoredQueue {
  username: string;
  presetName: string;
  mons: ShowdownMonManifest[];
  active: boolean;
}

interface MatchOffer {
  player: LobbyPlayer;
  accepted: boolean;
  requestSent: boolean;
  incoming: boolean;
  deadline: number;
}

export interface ShowdownMatchLaunch {
  runtime: CoopRuntime;
  presetName: string;
  mons: ShowdownMonManifest[];
}

type LaunchHandler = (launch: ShowdownMatchLaunch) => void;

let stored: StoredQueue | null = null;
let controller: CoopLobbyController | null = null;
let offer: MatchOffer | null = null;
let launchHandler: LaunchHandler | null = null;
let pendingLaunch: ShowdownMatchLaunch | null = null;
let returnSlot: number | null = null;
let restoreReady = false;
let queuedMatchInProgress = false;
let lastPlayers: LobbyPlayer[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let offerTimer: ReturnType<typeof setTimeout> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let toast: HTMLDivElement | null = null;

function readStoredQueue(): StoredQueue | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredQueue> | null;
    if (
      value == null
      || typeof value.username !== "string"
      || typeof value.presetName !== "string"
      || !Array.isArray(value.mons)
      || typeof value.active !== "boolean"
    ) {
      return null;
    }
    return {
      username: value.username,
      presetName: value.presetName,
      mons: value.mons as ShowdownMonManifest[],
      active: value.active,
    };
  } catch {
    return null;
  }
}

function persist(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  if (stored == null) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }
}

function clearOfferTimers(): void {
  if (offerTimer != null) {
    clearTimeout(offerTimer);
    offerTimer = null;
  }
  if (countdownTimer != null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function dismissToast(): void {
  clearOfferTimers();
  toast?.remove();
  toast = null;
}

function hideAcceptedToast(): void {
  if (countdownTimer != null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  toast?.remove();
  toast = null;
}

function expireOffer(): void {
  if (offer?.accepted) {
    // The local player accepted but the peer did not. Keep this player queued,
    // replace the stale request-bound presence, and derive a fresh opponent.
    offer = null;
    dismissToast();
    controller?.cancel();
    controller = null;
    scheduleReconnect();
    return;
  }
  pauseQueue();
}

function pauseQueue(): void {
  const active = offer;
  offer = null;
  dismissToast();
  if (active?.incoming) {
    void controller?.respond(false);
  }
  controller?.cancel();
  controller = null;
  if (stored != null) {
    stored.active = false;
    persist();
  }
}

function confirmPause(): void {
  const confirmed =
    typeof globalThis.confirm !== "function"
    || globalThis.confirm("Decline this match and pause Showdown matchmaking?");
  if (confirmed) {
    pauseQueue();
  }
}

function updateCountdown(button: HTMLButtonElement): void {
  const seconds = Math.max(0, Math.ceil(((offer?.deadline ?? 0) - Date.now()) / 1_000));
  button.textContent = `Accept (${seconds}s)`;
}

function showOfferToast(current: MatchOffer): void {
  if (typeof document === "undefined") {
    return;
  }
  dismissToast();
  const root = document.createElement("div");
  root.className = "er-tournament-match-toast er-showdown-match-toast";
  root.setAttribute("role", "alert");

  const copy = document.createElement("div");
  copy.className = "er-tournament-match-toast-copy";
  const title = document.createElement("strong");
  title.textContent = "Showdown match ready";
  const body = document.createElement("span");
  body.textContent = `${current.player.name} was matched with your ${stored?.presetName ?? "selected team"}.`;
  copy.append(title, body);

  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "er-tournament-match-toast-open";
  updateCountdown(accept);
  accept.addEventListener("click", () => acceptOffer());

  const close = document.createElement("button");
  close.type = "button";
  close.className = "er-tournament-match-toast-close";
  close.setAttribute("aria-label", "Decline match and pause matchmaking");
  close.textContent = "X";
  close.addEventListener("click", confirmPause);

  root.append(copy, accept, close);
  document.body.append(root);
  toast = root;
  countdownTimer = setInterval(() => updateCountdown(accept), 1_000);
  offerTimer = setTimeout(expireOffer, Math.max(0, current.deadline - Date.now()));
}

/** Pair adjacent authenticated presence ids so every client derives the same opponent. */
export function pairedShowdownOpponent(self: string, players: readonly LobbyPlayer[]): LobbyPlayer | null {
  const ordered = [{ id: self }, ...players].sort((a, b) => a.id.localeCompare(b.id));
  const index = ordered.findIndex(entry => entry.id === self);
  const peerId = index % 2 === 0 ? ordered[index + 1]?.id : ordered[index - 1]?.id;
  return peerId == null ? null : (players.find(player => player.id === peerId) ?? null);
}

function chooseOpponent(players: readonly LobbyPlayer[]): LobbyPlayer | null {
  const self = controller?.ownPresenceId();
  return self == null ? null : pairedShowdownOpponent(self, players);
}

function setOffer(player: LobbyPlayer, incoming = false): void {
  if (offer?.player.id === player.id) {
    if (incoming) {
      offer.incoming = true;
      if (offer.accepted) {
        void controller?.respond(true);
      }
    }
    return;
  }
  offer = {
    player,
    accepted: false,
    requestSent: false,
    incoming,
    deadline: Date.now() + SHOWDOWN_MATCH_ACCEPT_MS,
  };
  showOfferToast(offer);
}

function acceptOffer(): void {
  if (offer == null || controller == null) {
    return;
  }
  offer.accepted = true;
  hideAcceptedToast();
  if (offer.incoming) {
    void controller.respond(true);
    return;
  }
  const self = controller.ownPresenceId();
  if (self != null && self.localeCompare(offer.player.id) < 0 && !offer.requestSent) {
    offer.requestSent = true;
    void controller.request(offer.player.id, offer.player.name);
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer != null || stored?.active !== true) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startController();
  }, 2_000);
}

function deliverLaunch(launch: ShowdownMatchLaunch): void {
  pendingLaunch = launch;
  queuedMatchInProgress = true;
  const onTitle = globalScene.phaseManager.getCurrentPhase()?.phaseName === "TitlePhase";
  const inNormalRun =
    !onTitle && globalScene.currentBattle != null && !globalScene.gameMode.isShowdown && !globalScene.gameMode.isCoop;
  if (inNormalRun) {
    returnSlot = globalScene.sessionSlotId >= 0 ? globalScene.sessionSlotId : null;
    restoreReady = false;
    const finish = () => {
      globalScene.ui.setMode(UiMode.LOADING, {
        buttonActions: [],
        fadeOut: () => globalScene.reset(true),
      });
    };
    void globalScene.gameData.saveAll(true, true, true, true, true).then(finish, finish);
    return;
  }
  dispatchPendingLaunch();
}

function dispatchPendingLaunch(): boolean {
  if (launchHandler == null || pendingLaunch == null) {
    return false;
  }
  const launch = pendingLaunch;
  pendingLaunch = null;
  launchHandler(launch);
  return true;
}

function startController(): void {
  if (
    stored?.active !== true
    || controller != null
    || getCoopRuntime() != null
    || loggedInUser?.username !== stored.username
  ) {
    return;
  }
  offer = null;
  const username = stored.username;
  controller = new CoopLobbyController(
    username,
    {
      onPlayers: players => {
        lastPlayers = players;
        if (offer?.accepted) {
          return;
        }
        const player = chooseOpponent(players);
        if (player == null) {
          if (offer != null) {
            offer = null;
            dismissToast();
          }
          return;
        }
        setOffer(player);
      },
      onRequest: incoming => {
        const player: LobbyPlayer = {
          id: incoming.id,
          ...(incoming.accountId ? { accountId: incoming.accountId } : {}),
          name: incoming.name,
          age: 0,
        };
        const expected = offer?.player.id === incoming.id ? offer.player : chooseOpponent(lastPlayers);
        if (expected?.id !== incoming.id) {
          void controller?.respond(false);
          return;
        }
        setOffer(player, true);
      },
      onRequestGone: () => {
        if (offer?.incoming) {
          offer = null;
          dismissToast();
        }
      },
      onDeclined: () => {
        offer = null;
        dismissToast();
      },
      onConnecting: dismissToast,
      onConnected: runtime => {
        const selected = stored;
        controller = null;
        offer = null;
        if (selected == null || !selected.active) {
          clearCoopRuntime();
          return;
        }
        runtime.controller.setNetcodeMode("lockstep");
        runtime.controller.setSessionKind("versus");
        void runtime.controller
          .awaitPartnerCompatibility()
          .then(identity => {
            if (identity?.partnerName == null || getCoopRuntime() !== runtime) {
              throw new Error("Could not verify the matched Showdown opponent.");
            }
            deliverLaunch({
              runtime,
              presetName: selected.presetName,
              mons: selected.mons,
            });
          })
          .catch(() => {
            clearCoopRuntime();
            scheduleReconnect();
          });
      },
      onError: () => {
        controller = null;
        offer = null;
        dismissToast();
        scheduleReconnect();
      },
      onTransientError: () => {
        offer = null;
        dismissToast();
      },
    },
    { protocol: "p33", p33Dependencies: { room: MATCH_ROOM } },
  );
  void controller.start();
}

/** Queue (or re-queue) one saved team. Selecting a new team replaces the old queue entry. */
export function queueShowdownTeam(presetName: string, mons: readonly ShowdownMonManifest[]): boolean {
  const username = loggedInUser?.username;
  if (!username || mons.length === 0) {
    return false;
  }
  controller?.cancel();
  controller = null;
  offer = null;
  dismissToast();
  stored = { username, presetName, mons: mons.map(mon => structuredClone(mon)), active: true };
  persist();
  startController();
  return true;
}

/** Restore a persisted active queue after a page/title reload. */
export function restoreShowdownMatchmaking(): void {
  stored ??= readStoredQueue();
  if (stored?.username !== loggedInUser?.username) {
    return;
  }
  startController();
}

export function isShowdownQueueActive(): boolean {
  stored ??= readStoredQueue();
  return stored?.username === loggedInUser?.username && stored?.active === true;
}

export function getShowdownQueueStatus(): { presetName: string; active: boolean } | null {
  stored ??= readStoredQueue();
  if (stored?.username !== loggedInUser?.username) {
    return null;
  }
  return { presetName: stored.presetName, active: stored.active };
}

/** Register the title/run bridge. A pending connected match dispatches immediately. */
export function setShowdownMatchLaunchHandler(handler: LaunchHandler | null): boolean {
  launchHandler = handler;
  return dispatchPendingLaunch();
}

/** Called when a match result is terminal: requeue and make the prior run restorable. */
export function completeQueuedShowdownMatch(): void {
  if (!queuedMatchInProgress) {
    return;
  }
  queuedMatchInProgress = false;
  restoreReady = returnSlot != null;
  if (stored != null) {
    stored.active = true;
    persist();
  }
  controller = null;
  offer = null;
  dismissToast();
  scheduleReconnect();
}

export function isQueuedShowdownMatchInProgress(): boolean {
  return queuedMatchInProgress;
}

/** Consume the save slot that should be restored after the queued match. */
export function consumeQueuedShowdownReturnSlot(): number | null {
  if (!restoreReady) {
    return null;
  }
  restoreReady = false;
  queuedMatchInProgress = false;
  lastPlayers = [];
  const slot = returnSlot;
  returnSlot = null;
  return slot;
}

export function resetShowdownMatchmakingForTests(): void {
  controller?.cancel();
  controller = null;
  stored = null;
  offer = null;
  pendingLaunch = null;
  launchHandler = null;
  returnSlot = null;
  restoreReady = false;
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  dismissToast();
}
