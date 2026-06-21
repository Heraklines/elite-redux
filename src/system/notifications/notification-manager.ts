/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — GENERAL notification framework.
//
// Type-agnostic on purpose: the inbox UI and this manager know nothing about any
// specific notification. New kinds (ghost battles, egg hatches, patch notes,
// achievements, event announcements, ...) plug in as a `NotificationTypeDef` plus
// either a pull `source` (fetched on login) or a direct `push()` for locally
// emitted ones. Ghost-battle is simply the first registered type — see
// `er-ghost-notifications.ts`. Nothing ghost-specific lives here.
// =============================================================================

import { loggedInUser } from "#app/account";

/** A single notification. `data` is opaque here; the type's def renders it. */
export interface ErNotification {
  /** Stable unique id used for dedupe (e.g. `${type}:${sourceKey}`). */
  id: string;
  /** Registered {@linkcode NotificationTypeDef.type} key. */
  type: string;
  /** When the underlying event happened (ms epoch). */
  timestamp: number;
  read: boolean;
  /** Type-specific payload, rendered only by the type's def. */
  data: unknown;
}

/** Expanded view for one notification. `body` is always available; `customView`
 *  lets a type ask the UI to build a richer panel (e.g. a team comparison). */
export interface NotificationDetail {
  title?: string;
  body: string;
  /** Opaque key the inbox UI can branch on to build a custom panel. */
  customView?: string;
}

/** Registration describing how to render + gate a notification type. */
export interface NotificationTypeDef {
  /** Unique key (e.g. "ghost-battle"). */
  type: string;
  /** Optional inbox icon texture key. */
  iconKey?: string;
  /** One-line summary for the inbox list. */
  summary(n: ErNotification): string;
  /** Optional expanded view. */
  detail?(n: ErNotification): NotificationDetail;
  /** Optional settings key whose "off" value suppresses this type (fetch + show). */
  settingKey?: string;
}

/** A pull source: return notifications newer than `since` (ms epoch). */
export type NotificationSource = (since: number) => Promise<ErNotification[]>;

interface PersistShape {
  items: ErNotification[];
  /** sourceKey -> last-seen timestamp (so sources only fetch deltas). */
  cursors: Record<string, number>;
}

/** Predicate the caller supplies so the manager stays decoupled from settings. */
export type SettingEnabled = (settingKey: string) => boolean;

const MAX_STORED = 200;

class NotificationManager {
  private readonly types = new Map<string, NotificationTypeDef>();
  private readonly sources = new Map<string, { fetch: NotificationSource; settingKey?: string }>();
  private items: ErNotification[] = [];
  private cursors: Record<string, number> = {};
  /** The user the in-memory state was loaded for (reload on account switch). */
  private loadedFor: string | null = null;

  registerType(def: NotificationTypeDef): void {
    this.types.set(def.type, def);
  }

  getType(type: string): NotificationTypeDef | undefined {
    return this.types.get(type);
  }

  /** Register a login-pull source under a stable key (optionally setting-gated). */
  registerSource(key: string, fetch: NotificationSource, settingKey?: string): void {
    this.sources.set(key, settingKey ? { fetch, settingKey } : { fetch });
  }

  private storageKey(): string {
    return `er-notifications_${loggedInUser?.username ?? "guest"}`;
  }

  /** Lazily (re)load persisted state for the current user. Idempotent per user. */
  private load(): void {
    const user = loggedInUser?.username ?? "guest";
    if (this.loadedFor === user) {
      return;
    }
    this.loadedFor = user;
    this.items = [];
    this.cursors = {};
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistShape>;
        this.items = Array.isArray(parsed.items) ? parsed.items : [];
        this.cursors = parsed.cursors && typeof parsed.cursors === "object" ? parsed.cursors : {};
      }
    } catch {
      // Corrupt/absent store — start empty, never throw.
    }
  }

  private persist(): void {
    try {
      const shape: PersistShape = { items: this.items.slice(0, MAX_STORED), cursors: this.cursors };
      localStorage.setItem(this.storageKey(), JSON.stringify(shape));
    } catch {
      // localStorage full/unavailable — non-fatal (notifications are ephemeral).
    }
  }

  /** Add one notification (client-emitted or from a source). Dedupes by id. */
  push(n: ErNotification): void {
    this.load();
    if (this.items.some(x => x.id === n.id)) {
      return;
    }
    this.items.push(n);
    this.items.sort((a, b) => b.timestamp - a.timestamp);
    this.items = this.items.slice(0, MAX_STORED);
    this.persist();
  }

  /**
   * Run every enabled source and merge in new notifications. Each source is
   * isolated (a failure can't break the inbox), and advances its own cursor so
   * the next refresh only fetches deltas.
   */
  async refresh(isEnabled?: SettingEnabled): Promise<void> {
    this.load();
    for (const [key, src] of this.sources) {
      if (src.settingKey && isEnabled && !isEnabled(src.settingKey)) {
        continue;
      }
      try {
        const since = this.cursors[key] ?? 0;
        const fresh = await src.fetch(since);
        let maxTs = since;
        for (const n of fresh) {
          if (!this.items.some(x => x.id === n.id)) {
            this.items.push(n);
          }
          maxTs = Math.max(maxTs, n.timestamp);
        }
        this.cursors[key] = maxTs;
      } catch {
        // A single source failing must not break the others or the inbox.
      }
    }
    this.items.sort((a, b) => b.timestamp - a.timestamp);
    this.items = this.items.slice(0, MAX_STORED);
    this.persist();
  }

  /** All notifications, newest first. Pass `isEnabled` to hide setting-disabled types. */
  list(isEnabled?: SettingEnabled): ErNotification[] {
    this.load();
    if (!isEnabled) {
      return this.items.slice();
    }
    return this.items.filter(n => {
      const def = this.types.get(n.type);
      return !def?.settingKey || isEnabled(def.settingKey);
    });
  }

  unreadCount(isEnabled?: SettingEnabled): number {
    return this.list(isEnabled).filter(n => !n.read).length;
  }

  markRead(id: string): void {
    this.load();
    const n = this.items.find(x => x.id === id);
    if (n && !n.read) {
      n.read = true;
      this.persist();
    }
  }

  markAllRead(): void {
    this.load();
    let changed = false;
    for (const n of this.items) {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) {
      this.persist();
    }
  }

  clear(): void {
    this.load();
    if (this.items.length > 0) {
      this.items = [];
      this.persist();
    }
  }
}

/** The single shared notification manager. Register types/sources at init. */
export const notificationManager = new NotificationManager();
