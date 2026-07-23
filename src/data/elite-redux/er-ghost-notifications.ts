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

import { loggedInUser } from "#app/account";
import { bypassLogin } from "#constants/app-constants";
import { SpeciesId } from "#enums/species-id";
import { type ErNotification, notificationManager } from "#system/notifications/notification-manager";
import type { RichNotificationContent } from "#ui/rich-notification-viewer";
import { sessionIdKey } from "#utils/common";
import { getCookie } from "#utils/cookies";

const GHOST_TYPE = "ghost-battle";
const SYSTEM_TYPE = "system";
const REWARD_TYPE = "reward";
export const PATCH_NOTES_TYPE = "patch-notes";
const MAX_PATCH_NOTES_LENGTH = 60_000;
/** Settings key gating ghost-battle notifications (registered in settings.ts). */
export const GHOST_NOTIF_SETTING_KEY = "ghostNotifications";

interface GhostNotifData {
  victim: string;
  beaten: number;
  endedRun: boolean;
  victimTeam: unknown;
  ghostTeam: unknown;
}

interface PatchNotesPayload {
  markdown?: unknown;
  actionLabel?: unknown;
  actionUrl?: unknown;
}

/** Return the rich content carried by a patch-notes notification, if valid. */
export function patchNotesContentOf(notification: ErNotification): RichNotificationContent | null {
  const data = notification.data as { title?: unknown; body?: unknown; payload?: unknown } | null;
  const payload = data?.payload as PatchNotesPayload | null;
  // Production clients that fetched the launch announcement before updating to
  // the rich-notification build persisted the unknown kind as `system`. The
  // server cursor and stable row id then correctly prevent a duplicate fetch,
  // so recognize that legacy entry by the rich Markdown payload it retained.
  const legacyRichSystemNotification =
    notification.type === SYSTEM_TYPE && typeof payload?.markdown === "string" && payload.markdown.trim().length > 0;
  if (notification.type !== PATCH_NOTES_TYPE && !legacyRichSystemNotification) {
    return null;
  }
  const markdownSource = typeof payload?.markdown === "string" ? payload.markdown : data?.body;
  const markdown = typeof markdownSource === "string" ? markdownSource.slice(0, MAX_PATCH_NOTES_LENGTH) : "";
  if (!markdown.trim()) {
    return null;
  }

  const content: RichNotificationContent = {
    title: typeof data?.title === "string" && data.title.trim() ? data.title : "Patch notes",
    markdown,
  };
  if (typeof payload?.actionLabel === "string" && payload.actionLabel.trim()) {
    content.actionLabel = payload.actionLabel;
  }
  if (typeof payload?.actionUrl === "string" && payload.actionUrl.trim()) {
    content.actionUrl = payload.actionUrl;
  }
  return content;
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
 * Login pull source for server-pushed rewards + system announcements (e.g. a
 * black-shiny grant). Mirrors {@linkcode fetchGhostNotifications}: same base/token
 * guards, fetch `${base}/savedata/notifications?since=${since}`, parse `{items}`.
 * Known rich kinds keep their own renderer; unknown kinds safely fall back to
 * the text-only SYSTEM_TYPE.
 */
async function fetchSystemNotifications(since: number): Promise<ErNotification[]> {
  const base = serverBase();
  const token = getCookie(sessionIdKey);
  if (bypassLogin || !base || !token || typeof fetch !== "function") {
    return [];
  }
  const res = await fetch(`${base}/savedata/notifications?since=${since}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as { items?: unknown };
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .filter(
      (x): x is { id: unknown; kind?: unknown; title?: unknown; body?: unknown; payload?: unknown; when?: number } =>
        !!x && typeof x === "object" && (x as { id?: unknown }).id != null,
    )
    .map(it => {
      const when = typeof it.when === "number" ? it.when : Date.now();
      return {
        id: String(it.id),
        type: it.kind === "reward" ? REWARD_TYPE : it.kind === PATCH_NOTES_TYPE ? PATCH_NOTES_TYPE : SYSTEM_TYPE,
        timestamp: when,
        read: false,
        data: {
          title: typeof it.title === "string" ? it.title : "",
          body: typeof it.body === "string" ? it.body : "",
          payload: it.payload,
        },
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
      // customView tells the inbox UI to render the team comparison as Pokemon
      // icons (6 vs 6); body stays as a text fallback for any text-only context.
      return {
        title: `Your ghost ${d.endedRun ? "beat" : "fought"} ${d.victim}`,
        body: `Downed ${d.beaten} of their Pokemon.\n\nYour ghost:\n${teamNames(d.ghostTeam)}\n\nTheir team:\n${teamNames(d.victimTeam)}`,
        customView: "ghost-battle",
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
  notificationManager.registerType({
    type: REWARD_TYPE,
    summary(n) {
      return (n.data as { title?: string })?.title ?? "Reward";
    },
    detail(n) {
      const d = n.data as { title?: string; body?: string };
      // customView tells the inbox UI to render the granted mon's icon (single
      // large sprite) from data.payload; body stays as a text fallback.
      return { title: d?.title ?? "Reward", body: d?.body ?? "", customView: "reward" };
    },
  });
  notificationManager.registerType({
    type: PATCH_NOTES_TYPE,
    summary(n) {
      return (n.data as { title?: string })?.title ?? "Patch notes";
    },
    detail(n) {
      const d = n.data as { title?: string; body?: string };
      return { title: d?.title ?? "Patch notes", body: d?.body ?? "", customView: PATCH_NOTES_TYPE };
    },
  });
  notificationManager.registerSource(GHOST_TYPE, fetchGhostNotifications, GHOST_NOTIF_SETTING_KEY);
  // Server-pushed rewards + announcements: no setting gate, pulled on every title load.
  notificationManager.registerSource(REWARD_TYPE, fetchSystemNotifications, undefined);

  // Retire sample notifications from earlier builds so players who already loaded a
  // staging/demo build start clean. The inbox MUST be empty for players on first
  // use - the only seeded entry now is the staging-only demo below.
  notificationManager.remove("ghost-battle:demo-v1");
  notificationManager.remove("system:welcome-v1");

  // Seed the staging demo ONCE per user. Without this guard it would re-appear on
  // every title visit and "Clear all" could never stick. Per-user key (this runs
  // once logged in) so each account is seeded independently.
  const user = loggedInUser?.username ?? "guest";
  const seededKey = `er-notif-seeded-v4_${user}`;
  let seeded = false;
  try {
    seeded = typeof localStorage !== "undefined" && localStorage.getItem(seededKey) === "1";
  } catch {
    seeded = false;
  }
  if (seeded) {
    return;
  }

  // Staging/dev ONLY: a SAMPLE ghost-battle notification so the team can see
  // exactly how a real one looks (summary + team comparison) before live data
  // exists. Gated like the dev test suite, so production never shows fake alerts.
  // endedRun:false => "fought" (not "beat") since the ghost downed only some of
  // their team, which is the common case.
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  if (env?.DEV === true || env?.VITE_DEV_TOOLS === "1") {
    notificationManager.push({
      id: "ghost-battle:demo-v2",
      type: GHOST_TYPE,
      timestamp: Date.now(),
      read: false,
      data: {
        victim: "Sample Trainer",
        beaten: 3,
        endedRun: false,
        ghostTeam: [
          { speciesId: SpeciesId.TYRANITAR, name: "Tyranitar" },
          { speciesId: SpeciesId.GENGAR, name: "Gengar" },
          { speciesId: SpeciesId.DRAGONITE, name: "Dragonite" },
          { speciesId: SpeciesId.GARCHOMP, name: "Garchomp" },
          { speciesId: SpeciesId.VOLCARONA, name: "Volcarona" },
          { speciesId: SpeciesId.AZUMARILL, name: "Azumarill" },
        ],
        victimTeam: [
          { speciesId: SpeciesId.CHARIZARD, name: "Charizard" },
          { speciesId: SpeciesId.BLASTOISE, name: "Blastoise" },
          { speciesId: SpeciesId.VENUSAUR, name: "Venusaur" },
          { speciesId: SpeciesId.SNORLAX, name: "Snorlax" },
          { speciesId: SpeciesId.ALAKAZAM, name: "Alakazam" },
          { speciesId: SpeciesId.LAPRAS, name: "Lapras" },
        ],
      } satisfies GhostNotifData,
    });
  }

  try {
    localStorage.setItem(seededKey, "1");
  } catch {
    // localStorage unavailable - non-fatal; notifications just won't persist.
  }
}
