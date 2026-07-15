/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** Deterministic delivery controls used by production-transition journeys. */
export interface ScheduledCoopPair {
  host: CoopTransport;
  guest: CoopTransport;
  /** Number of queued frames waiting to be delivered to this role. */
  pending(role: CoopRole): number;
  /** Deliver up to `limit` FIFO frames to one client. Call while that client's scene context is active. */
  flush(role: CoopRole, limit?: number): number;
  /** Drop the next matching inbound frame once, for declared recovery scenarios. */
  dropNext(role: CoopRole, predicate?: (message: CoopMessage) => boolean): void;
  /** Duplicate the next matching inbound frame once, for idempotency scenarios. */
  duplicateNext(role: CoopRole, predicate?: (message: CoopMessage) => boolean): void;
  /** Deliver the next matching inbound frame after the frame that follows it, once. */
  reorderNext(role: CoopRole, predicate?: (message: CoopMessage) => boolean): void;
  /** Temporarily disconnect both endpoints without discarding retained queued evidence. */
  disconnect(): void;
  /** Reconnect the same endpoints; state listeners observe a production-like generation change. */
  reconnect(): void;
  /** Use ordinary microtask delivery during reusable harness boot; switch off before a timed journey. */
  setAutomaticDelivery(automatic: boolean): void;
}

interface DeliveryFault {
  predicate: (message: CoopMessage) => boolean;
  remaining: number;
}

interface QueuedFrame {
  message: CoopMessage;
  generation: number;
}

class ScheduledEndpoint implements CoopTransport {
  public readonly role: CoopRole;
  private readonly enqueue: (role: CoopRole, message: CoopMessage) => void;
  private connectionState: CoopConnectionState = "connected";
  private peer: ScheduledEndpoint | null = null;
  private readonly messageHandlers = new Set<(message: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();
  private lastRxAt = 0;

  constructor(role: CoopRole, enqueue: (role: CoopRole, message: CoopMessage) => void) {
    this.role = role;
    this.enqueue = enqueue;
  }

  get state(): CoopConnectionState {
    return this.connectionState;
  }

  connectPeer(peer: ScheduledEndpoint): void {
    this.peer = peer;
  }

  setState(state: CoopConnectionState): void {
    if (state === this.connectionState) {
      return;
    }
    this.connectionState = state;
    for (const handler of [...this.stateHandlers]) {
      handler(state);
    }
  }

  send(message: CoopMessage): void {
    if (this.connectionState !== "connected" || this.peer?.state !== "connected") {
      return;
    }
    this.enqueue(this.peer.role, message);
  }

  deliver(message: CoopMessage): void {
    if (this.connectionState !== "connected") {
      return;
    }
    this.lastRxAt = Date.now();
    for (const handler of [...this.messageHandlers]) {
      handler(message);
    }
  }

  lastRxMs(): number | undefined {
    return this.lastRxAt === 0 ? undefined : Date.now() - this.lastRxAt;
  }

  onMessage(handler: (message: CoopMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  close(): void {
    this.setState("closed");
    this.messageHandlers.clear();
    this.stateHandlers.clear();
  }
}

/**
 * A two-client transport whose delivery is explicitly pumped per destination client. Unlike the ordinary
 * microtask loopback, it never resumes a guest await while the host's `globalScene` is installed (or vice
 * versa). That makes real concurrent phase/UI journeys possible in the two-engine harness while preserving
 * FIFO ordering. Timing variations are expressed by choosing which role to flush and how many frames.
 */
export function createScheduledCoopPair(options: { automatic?: boolean } = {}): ScheduledCoopPair {
  const queues: Record<CoopRole, QueuedFrame[]> = { host: [], guest: [] };
  const drops: Record<CoopRole, DeliveryFault[]> = { host: [], guest: [] };
  const duplicates: Record<CoopRole, DeliveryFault[]> = { host: [], guest: [] };
  const reorders: Record<CoopRole, DeliveryFault[]> = { host: [], guest: [] };
  let generation = 1;
  let automaticDelivery = options.automatic ?? false;
  let flushRole: ((role: CoopRole, limit?: number) => number) | null = null;

  const enqueue = (role: CoopRole, message: CoopMessage): void => {
    // A real DataChannel serializes at send time. Snapshot here so sender-side engine mutation after
    // `send()` cannot rewrite a queued frame while the other client is waiting for its scheduled turn.
    queues[role].push({ message: structuredClone(message), generation });
    if (automaticDelivery) {
      queueMicrotask(() => flushRole?.(role));
    }
  };
  const host = new ScheduledEndpoint("host", enqueue);
  const guest = new ScheduledEndpoint("guest", enqueue);
  host.connectPeer(guest);
  guest.connectPeer(host);
  const endpoints: Record<CoopRole, ScheduledEndpoint> = { host, guest };

  const consumeFault = (faults: DeliveryFault[], message: CoopMessage): boolean => {
    const fault = faults.find(candidate => candidate.remaining > 0 && candidate.predicate(message));
    if (fault == null) {
      return false;
    }
    fault.remaining--;
    return true;
  };

  const pair: ScheduledCoopPair = {
    host,
    guest,
    pending: role => queues[role].length,
    flush(role, limit = Number.POSITIVE_INFINITY): number {
      let delivered = 0;
      while (queues[role].length > 0 && delivered < limit) {
        // A reconnect invalidates every queued frame from the previous transport generation. Retire that
        // stale head before a reorder fault considers waiting for a follower, or one lone stale frame could
        // keep the destination queue artificially non-empty forever.
        if (queues[role][0].generation !== generation) {
          queues[role].shift();
          continue;
        }
        const reorder = reorders[role].find(
          candidate => candidate.remaining > 0 && candidate.predicate(queues[role][0].message),
        );
        if (reorder != null) {
          // Keep the selected frame queued until one later frame exists, then invert exactly this pair.
          // This models a bounded out-of-order network without manufacturing or mutating either payload.
          if (queues[role].length < 2) {
            break;
          }
          const selected = queues[role].shift()!;
          queues[role].splice(1, 0, selected);
          reorder.remaining--;
        }
        const frame = queues[role].shift()!;
        if (consumeFault(drops[role], frame.message)) {
          continue;
        }
        const duplicate = consumeFault(duplicates[role], frame.message);
        endpoints[role].deliver(structuredClone(frame.message));
        delivered++;
        if (duplicate) {
          // Two network deliveries are two independently parsed values. A receiver mutating its first
          // working copy must not corrupt the deliberate duplicate used to prove idempotency.
          endpoints[role].deliver(structuredClone(frame.message));
          delivered++;
        }
      }
      return delivered;
    },
    dropNext(role, predicate = () => true): void {
      drops[role].push({ predicate, remaining: 1 });
    },
    duplicateNext(role, predicate = () => true): void {
      duplicates[role].push({ predicate, remaining: 1 });
    },
    reorderNext(role, predicate = () => true): void {
      reorders[role].push({ predicate, remaining: 1 });
    },
    disconnect(): void {
      host.setState("disconnected");
      guest.setState("disconnected");
    },
    reconnect(): void {
      generation++;
      host.setState("connected");
      guest.setState("connected");
    },
    setAutomaticDelivery(automatic: boolean): void {
      automaticDelivery = automatic;
      if (automatic) {
        queueMicrotask(() => {
          flushRole?.("host");
          flushRole?.("guest");
        });
      }
    },
  };
  flushRole = pair.flush.bind(pair);
  return pair;
}
