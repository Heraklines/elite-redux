/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — ghost-battle notification TYPE (the first concrete type wired
// into the general `notificationManager`). All ghost specifics live here; the
// manager + the inbox UI stay type-agnostic. Also registers a generic "system"
// type used for one-off announcements (e.g. the welcome notice).
// =============================================================================

import { bypassLogin } from "#constants/app-constants";
import { type ErNotification, notificationManager } from "#system/notifications/notification-manager";
import { sessionIdKey } from "#utils/common";
import { getCookie } from "#utils/cookies";

const GHOST_TYPE = "ghost-battle";
const SYSTEM_TYPE = "system";
/** Settings key gating ghost-battle notifications (registered in settings.ts). */
export const GHOST_NOTIF_SETTING_KEY = "ghostNotifications";

interface GhostNotifData {
  victim: string;
  beaten: number;
  endedRun: boolean;
  victimTeam: unknown;
  ghostTeam: unknown;
}

function serverBase(): string {
  return import.meta.env.VITE_SERVER_URL ?? "";
}

/** Compact "Mon, Mon, Mon" from a serialised team (best-effort; never throws). */
function teamNames(team: unknown): string {
  if (!Array.isArray(team) || team.length === 0) {
    return "(unknown)";
  }
  return team
    .slice(0, 6)
    .map(m => {
      const o = m as { name?: unknown; species?: unknown } | null;
      if (typeof o?.name === "string" && o.name.length > 0) {
        return o.name;
      }
      return o?.species != null ? String(o.species) : "?";
    })
    .join(", ");
}

/** Login pull source: battles where THIS player's ghost fought someone since `since`. */
async function fetchGhostNotifications(since: number): Promise<ErNotification[]> {
  const base = serverBase();
  const token = getCookie(sessionIdKey);
  if (bypassLogin || !base || !token || typeof fetch !== "function") {
    return [];
  }
  const res = await fetch(`${base}/savedata/run/ghost-notifications?since=${since}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as { items?: unknown };
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .filter(
      (x): x is { victim: string; beaten?: number; endedRun?: boolean; when?: number; victimTeam?: unknown; ghostTeam?: unknown } =>
        !!x && typeof x === "object" && typeof (x as { victim?: unknown }).victim === "string",
    )
    .map(it => {
      const when = typeof it.when === "number" ? it.when : Date.now();
      return {
        id: `${GHOST_TYPE}:${it.victim}:${when}`,
        type: GHOST_TYPE,
        timestamp: when,
        read: false,
        data: {
          victim: it.victim,
          beaten: typeof it.beaten === "number" ? it.beaten : 0,
          endedRun: it.endedRun === true,
          victimTeam: it.victimTeam ?? null,
          ghostTeam: it.ghostTeam ?? null,
        } satisfies GhostNotifData,
      };
    });
}

/**
 * Register the notification TYPES + the ghost source on the shared manager.
 * Idempotent (safe to call on every title load). Also drops a one-time welcome
 * note so the inbox is visibly non-empty on first use.
 */
export function initErNotifications(): void {
  notificationManager.registerType({
    type: GHOST_TYPE,
    settingKey: GHOST_NOTIF_SETTING_KEY,
    summary(n) {
      const d = n.data as GhostNotifData;
      return `Your ghost ${d.endedRun ? "beat" : "fought"} ${d.victim} (${d.beaten} downed)`;
    },
    detail(n) {
      const d = n.data as GhostNotifData;
      return {
        title: `Your ghost ${d.endedRun ? "BEAT" : "fought"} ${d.victim}`,
        body: `Downed ${d.beaten} of their Pokemon.\n\nYour ghost:\n${teamNames(d.ghostTeam)}\n\nTheir team:\n${teamNames(d.victimTeam)}`,
      };
    },
  });
  notificationManager.registerType({
    type: SYSTEM_TYPE,
    summary(n) {
      return (n.data as { title?: string })?.title ?? "Notice";
    },
    detail(n) {
      const d = n.data as { title?: string; body?: string };
      return { title: d?.title ?? "Notice", body: d?.body ?? "" };
    },
  });
  notificationManager.registerSource(GHOST_TYPE, fetchGhostNotifications, GHOST_NOTIF_SETTING_KEY);

  // Welcome note. push() dedupes by id and persists per user, so this is
  // effectively one-time without a separate flag (and lands in the right per-user
  // bucket because this runs once the player is logged in).
  notificationManager.push({
    id: "system:welcome-v1",
    type: SYSTEM_TYPE,
    timestamp: Date.now(),
    read: false,
    data: {
      title: "Notifications are here",
      body: "Your ghost's battle results show up here, plus other news. You can toggle ghost alerts in Settings.",
    },
  });

  // Staging/dev ONLY: a SAMPLE ghost-battle notification so the team can see
  // exactly how a real one looks (summary + team comparison) before live data
  // exists. Gated like the dev test suite, so production never shows fake alerts.
  // endedRun:false => "fought" (not "beat") since the ghost downed only some of
  // their team, which is the common case.
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  if (env?.DEV === true || env?.VITE_DEV_TOOLS === "1") {
    notificationManager.push({
      id: "ghost-battle:demo-v1",
      type: GHOST_TYPE,
      timestamp: Date.now(),
      read: false,
      data: {
        victim: "Sample Trainer",
        beaten: 3,
        endedRun: false,
        ghostTeam: [
          { name: "Tyranitar" },
          { name: "Gengar" },
          { name: "Dragonite" },
          { name: "Garchomp" },
          { name: "Volcarona" },
          { name: "Azumarill" },
        ],
        victimTeam: [
          { name: "Charizard" },
          { name: "Blastoise" },
          { name: "Venusaur" },
          { name: "Snorlax" },
          { name: "Alakazam" },
          { name: "Lapras" },
        ],
      } satisfies GhostNotifData,
    });
  }
}
