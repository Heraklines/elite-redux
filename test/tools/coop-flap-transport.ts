/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** Engine-free transport proxy whose wire can be toggled dark/open without replacing the endpoint. */
export class CoopFlapTransport implements CoopTransport {
  private connected = true;
  private closed = false;
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();

  constructor(private readonly inner: CoopTransport) {}

  get role(): CoopRole {
    return this.inner.role;
  }

  get state(): CoopConnectionState {
    return this.closed ? "closed" : this.connected ? "connected" : "disconnected";
  }

  setConnected(connected: boolean): void {
    if (this.closed || this.connected === connected) {
      return;
    }
    this.connected = connected;
    const state = connected ? "connected" : "disconnected";
    for (const handler of [...this.stateHandlers]) {
      handler(state);
    }
  }

  send(msg: CoopMessage): void {
    if (this.connected && !this.closed) {
      this.inner.send(msg);
    }
  }

  onMessage(handler: (msg: CoopMessage) => void): () => void {
    return this.inner.onMessage(msg => {
      if (this.connected && !this.closed) {
        handler(msg);
      }
    });
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const handler of [...this.stateHandlers]) {
      handler("closed");
    }
    this.stateHandlers.clear();
    this.inner.close();
  }
}
