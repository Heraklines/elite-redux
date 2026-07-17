/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Minimal structural stand-ins for the Cloudflare Workers runtime globals this
// worker binds against (@cloudflare/workers-types is not a dependency of this repo).
// Only the surface the save/rank API actually calls is modeled; the runtime bindings
// are the real Cloudflare implementations. Mirrors the D1 shape already used by
// workers/er-coop-api/src/p33-signaling.ts. This file is ambient (no import/export),
// so these are global declarations and `interface CacheStorage` merges with the lib.

interface D1Meta {
  changes?: number;
  last_row_id?: number | bigint;
  duration?: number;
}
interface D1Result<T = Record<string, unknown>> {
  success?: boolean;
  results: T[];
  meta: D1Meta;
  error?: string;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  // D1 batch rows are dynamically shaped; callers assert the concrete row type at the call site.
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

interface ScheduledEvent {
  readonly scheduledTime: number;
  readonly cron: string;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Cloudflare exposes the default edge cache as `caches.default` (not in the DOM lib).
interface CacheStorage {
  readonly default: Cache;
}
