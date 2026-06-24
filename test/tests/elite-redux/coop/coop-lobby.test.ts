/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op matchmaking lobby client (#633): the HTTP helpers + the controller's
// "announce -> poll -> auto-connect on pairing" state machine, over a mocked
// fetch (the live RTCPeerConnection leg is browser-only and stubbed here).

import { announceToLobby, CoopLobbyController, fetchLobby, pickPlayer } from "#data/elite-redux/coop/coop-lobby";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The controller's WebRTC connect is injected (not module-mocked), so this is
// robust to vitest module isolation across the coop suite. Keep coopServerBase
// real (the HTTP helpers build URLs from it) and intercept via a mocked fetch.
const connectMock = vi.fn();

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

let calls: FetchCall[] = [];
/** Queue of responses; each fetch consumes the matching handler. */
let responder: (call: FetchCall) => { status?: number; body: unknown };
let realFetch: typeof fetch;

function installFetch(): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { url, method, body };
    calls.push(call);
    const { status = 200, body: out } = responder(call);
    const text = JSON.stringify(out);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  connectMock.mockReset();
  realFetch = global.fetch;
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = realFetch;
});

describe("co-op lobby HTTP helpers (#633)", () => {
  it("announceToLobby posts the name and returns id + pairing", async () => {
    responder = () => ({ body: { id: "abc123id", pairing: null } });
    const res = await announceToLobby("Alice");
    expect(res).toEqual({ id: "abc123id", pairing: null });
    expect(calls[0].url).toContain("/coop/lobby/announce");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ name: "Alice" });
  });

  it("announceToLobby reuses a provided id and surfaces an existing pairing", async () => {
    responder = () => ({ body: { id: "keep-me", pairing: { code: "AB12CD", role: "host" } } });
    const res = await announceToLobby("Alice", "keep-me");
    expect(calls[0].body).toEqual({ name: "Alice", id: "keep-me" });
    expect(res.pairing).toEqual({ code: "AB12CD", role: "host" });
  });

  it("fetchLobby GETs with self= and parses players + pairing", async () => {
    responder = () => ({ body: { players: [{ id: "b", name: "Bob", age: 200 }], pairing: null } });
    const res = await fetchLobby("self-id");
    expect(calls[0].url).toContain("/coop/lobby?self=self-id");
    expect(res.players).toHaveLength(1);
    expect(res.players[0].name).toBe("Bob");
    expect(res.pairing).toBeNull();
  });

  it("pickPlayer returns the guest pairing on success", async () => {
    responder = () => ({ body: { code: "9DGDS6", role: "guest" } });
    const pairing = await pickPlayer("self", "target");
    expect(calls[0].url).toContain("/coop/lobby/pick");
    expect(calls[0].body).toEqual({ self: "self", target: "target" });
    expect(pairing).toEqual({ code: "9DGDS6", role: "guest" });
  });

  it("pickPlayer throws the worker error when the target was just matched", async () => {
    responder = () => ({ status: 409, body: { error: "that player was just matched - pick another" } });
    await expect(pickPlayer("self", "target")).rejects.toThrow(/just matched/);
  });
});

describe("CoopLobbyController state machine (#633)", () => {
  it("connects immediately when announce already returns a pairing", async () => {
    responder = () => ({ body: { id: "me", pairing: { code: "PAIR01", role: "guest" } } });
    connectMock.mockResolvedValue({ runtime: true });

    const onConnecting = vi.fn();
    const onConnected = vi.fn();
    const onError = vi.fn();
    const onPlayers = vi.fn();
    const c = new CoopLobbyController(
      "Alice",
      { onPlayers, onConnecting, onConnected, onError },
      { connect: connectMock },
    );
    await c.start();
    // let the connect() microtasks flush
    await Promise.resolve();
    await Promise.resolve();

    expect(onConnecting).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith("PAIR01", "guest", { username: "Alice" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onPlayers).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    c.cancel();
  });

  it("renders players when announce has no pairing, then connects on a polled pairing", async () => {
    vi.useFakeTimers();
    let phase = 0;
    responder = call => {
      if (call.url.includes("/announce")) {
        return { body: { id: "me", pairing: null } };
      }
      if (call.url.includes("/coop/lobby?self")) {
        phase++;
        // first poll: a waiting player; second poll: we got matched
        return phase === 1
          ? { body: { players: [{ id: "b", name: "Bob", age: 100 }], pairing: null } }
          : { body: { players: [], pairing: { code: "MATCH9", role: "host" } } };
      }
      if (call.url.includes("/leave")) {
        return { body: { ok: true } };
      }
      return { body: {} };
    };
    connectMock.mockResolvedValue({ runtime: true });

    const onPlayers = vi.fn();
    const onConnecting = vi.fn();
    const onConnected = vi.fn();
    const onError = vi.fn();
    const c = new CoopLobbyController(
      "Alice",
      { onPlayers, onConnecting, onConnected, onError },
      { connect: connectMock },
    );

    await c.start(); // announce (no pairing) -> schedules first poll at 0ms
    await vi.advanceTimersByTimeAsync(1); // run first poll -> onPlayers(Bob)
    expect(onPlayers).toHaveBeenCalledTimes(1);
    expect(onPlayers.mock.calls[0][0][0].name).toBe("Bob");

    await vi.advanceTimersByTimeAsync(1600); // next poll -> pairing -> connect
    expect(onConnecting).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith("MATCH9", "host", { username: "Alice" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    c.cancel();
  });
});
