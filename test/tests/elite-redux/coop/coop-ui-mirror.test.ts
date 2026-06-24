/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op LIVE-CURSOR mirror (#633) - engine-free unit tests over a LoopbackTransport.
// Proves the COSMETIC input stream is FIFO, dedup-safe, gap-tolerant, and bounded by
// the mode-resync barrier - and that it is a pure projector (the watcher only ever
// REPLAYS the owner's buttons; it never originates a choice). Mirrors the structure
// of coop-interaction-relay.test.ts. The LoopbackTransport delivers via queueMicrotask,
// so each batch of sends is followed by `await flush()`.
// =============================================================================

import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { CoopUiMirror, type CoopUiMirrorEngine } from "#data/elite-redux/coop/coop-ui-mirror";
import { describe, expect, it } from "vitest";

/** Flush the microtask queue so loopback deliveries land before we assert. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** A recording engine: captures replayed buttons and reports a (settable) mode. */
function makeEngine(mode = 1): CoopUiMirrorEngine & { applied: number[]; mode: number } {
  const e = {
    applied: [] as number[],
    mode,
    getMode() {
      return e.mode;
    },
    applyButton(button: number) {
      e.applied.push(button);
    },
  };
  return e;
}

const SEQ = 7;
const MODE = 3; // a shared-screen UiMode int

describe("co-op live-cursor mirror (#633)", () => {
  it("replays the owner's buttons on the watcher IN ORDER", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopUiMirror(host);
    const watcher = new CoopUiMirror(guest);
    const eng = makeEngine(MODE);
    watcher.attach(eng);

    owner.beginSession("owner", MODE, SEQ);
    watcher.beginSession("watcher", MODE, SEQ);

    owner.relayOwnerButton(10, MODE);
    owner.relayOwnerButton(11, MODE);
    owner.relayOwnerButton(12, MODE);
    await flush();

    expect(eng.applied).toEqual([10, 11, 12]);

    owner.dispose();
    watcher.dispose();
  });

  it("buffers buttons that arrive BEFORE the watcher opens, then drains them", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopUiMirror(host);
    const watcher = new CoopUiMirror(guest);
    const eng = makeEngine(MODE);
    watcher.attach(eng);

    // Owner races ahead and sends before the watcher's session begins.
    owner.beginSession("owner", MODE, SEQ);
    owner.relayOwnerButton(20, MODE);
    owner.relayOwnerButton(21, MODE);
    await flush();
    expect(eng.applied).toEqual([]); // nothing applied yet - watcher not open

    watcher.beginSession("watcher", MODE, SEQ);
    expect(eng.applied).toEqual([20, 21]); // adopted on open (already buffered)

    owner.dispose();
    watcher.dispose();
  });

  it("tolerates an out-of-order gap: waits for the missing index, then catches up", async () => {
    const { host, guest } = createLoopbackPair();
    const watcher = new CoopUiMirror(guest);
    const eng = makeEngine(MODE);
    watcher.attach(eng);
    watcher.beginSession("watcher", MODE, SEQ);

    // Deliver n=0, then n=2 (skip 1): only 0 applies, 2 waits.
    host.send({ t: "uiInput", seq: SEQ, n: 0, button: 30, mode: MODE });
    host.send({ t: "uiInput", seq: SEQ, n: 2, button: 32, mode: MODE });
    await flush();
    expect(eng.applied).toEqual([30]);

    // The missing n=1 arrives: 1 then the buffered 2 both flush.
    host.send({ t: "uiInput", seq: SEQ, n: 1, button: 31, mode: MODE });
    await flush();
    expect(eng.applied).toEqual([30, 31, 32]);

    watcher.dispose();
  });

  it("is dedup-safe: a re-sent index is never applied twice", async () => {
    const { host, guest } = createLoopbackPair();
    const watcher = new CoopUiMirror(guest);
    const eng = makeEngine(MODE);
    watcher.attach(eng);
    watcher.beginSession("watcher", MODE, SEQ);

    host.send({ t: "uiInput", seq: SEQ, n: 0, button: 40, mode: MODE });
    host.send({ t: "uiInput", seq: SEQ, n: 0, button: 40, mode: MODE }); // duplicate
    host.send({ t: "uiInput", seq: SEQ, n: 1, button: 41, mode: MODE });
    await flush();

    expect(eng.applied).toEqual([40, 41]);

    watcher.dispose();
  });

  it("the mode-resync barrier drops a button when the watcher's screen drifted", async () => {
    const { host, guest } = createLoopbackPair();
    const watcher = new CoopUiMirror(guest);
    const eng = makeEngine(MODE);
    watcher.attach(eng);
    watcher.beginSession("watcher", MODE, SEQ);

    host.send({ t: "uiInput", seq: SEQ, n: 0, button: 50, mode: MODE });
    await flush();
    expect(eng.applied).toEqual([50]);

    // Watcher's screen moved on; a button stamped for the OLD mode is dropped (cosmetic).
    eng.mode = 99;
    host.send({ t: "uiInput", seq: SEQ, n: 1, button: 51, mode: MODE });
    await flush();
    expect(eng.applied).toEqual([50]); // dropped, not mis-applied

    watcher.dispose();
  });

  it("ignores input for a DIFFERENT session seq and reports watcher/active state", async () => {
    const { host, guest } = createLoopbackPair();
    const watcher = new CoopUiMirror(guest);
    const eng = makeEngine(MODE);
    watcher.attach(eng);
    watcher.beginSession("watcher", MODE, SEQ);

    // A button for another shared-screen session (different seq) must not leak in.
    host.send({ t: "uiInput", seq: SEQ + 1, n: 0, button: 60, mode: MODE });
    await flush();
    expect(eng.applied).toEqual([]);

    expect(watcher.isWatcher()).toBe(true);
    expect(watcher.isActive(MODE)).toBe(true);
    expect(watcher.isActive(MODE + 1)).toBe(false); // inert once the UI leaves the bound mode
    watcher.endSession();
    expect(watcher.isActive(MODE)).toBe(false);

    watcher.dispose();
  });

  it("the OWNER never replays into its own engine (it only sends)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopUiMirror(host);
    const watcher = new CoopUiMirror(guest);
    const ownerEng = makeEngine(MODE);
    owner.attach(ownerEng);
    watcher.attach(makeEngine(MODE));

    owner.beginSession("owner", MODE, SEQ);
    watcher.beginSession("watcher", MODE, SEQ);
    owner.relayOwnerButton(70, MODE);
    await flush();

    expect(ownerEng.applied).toEqual([]); // owner drives its real handler directly, not via mirror

    owner.dispose();
    watcher.dispose();
  });
});
