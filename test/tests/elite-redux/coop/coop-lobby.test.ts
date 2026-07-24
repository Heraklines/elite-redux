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

  it("installs Showdown lockstep axes before the connector creates its runtime", async () => {
    responder = () => ({ body: { id: "me", pairing: { code: "VERSUS", role: "host" } } });
    connectMock.mockResolvedValue({ runtime: true });

    const c = new CoopLobbyController(
      "Alice",
      { onPlayers: vi.fn(), onConnecting: vi.fn(), onConnected: vi.fn(), onError: vi.fn() },
      {
        connect: connectMock,
        netcodeMode: "lockstep",
        sessionKind: "versus",
      },
    );
    await c.start();

    expect(connectMock).toHaveBeenCalledWith("VERSUS", "host", {
      username: "Alice",
      netcodeMode: "lockstep",
      kind: "versus",
    });
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

describe("co-op lobby v2: join-with-confirmation (#633)", () => {
  it("requestPlayer posts self+target; respondToRequest accept returns the HOST pairing", async () => {
    responder = call => {
      if (call.url.includes("/coop/lobby/request")) {
        return { body: { ok: true, pending: true } };
      }
      if (call.url.includes("/coop/lobby/respond")) {
        return { body: { code: "HOSTME", role: "host" } };
      }
      return { body: {} };
    };
    const { requestPlayer, respondToRequest } = await import("#data/elite-redux/coop/coop-lobby");
    await requestPlayer("me", "them");
    expect(calls[0].url).toContain("/coop/lobby/request");
    expect(calls[0].body).toEqual({ self: "me", target: "them" });

    const pairing = await respondToRequest("me", "them", true);
    expect(calls[1].body).toEqual({ self: "me", from: "them", accept: true });
    expect(pairing).toEqual({ code: "HOSTME", role: "host" });
  });

  it("fetchLobby parses the v2 request + declined fields (and tolerates their absence)", async () => {
    responder = () => ({
      body: { players: [], pairing: null, request: { id: "r1", name: "Ash" }, declined: "Misty" },
    });
    const snap = await fetchLobby("me");
    expect(snap.request).toEqual({ id: "r1", name: "Ash" });
    expect(snap.declined).toBe("Misty");

    // OLD worker: v2 fields absent -> they parse to null (never undefined crashes).
    responder = () => ({ body: { players: [], pairing: null } });
    const legacy = await fetchLobby("me");
    expect(legacy.request).toBeNull();
    expect(legacy.declined).toBeNull();
  });

  it("controller: an INCOMING request fires onRequest ONCE, and respond(true) connects as HOST", async () => {
    vi.useFakeTimers();
    let respondCalls = 0;
    responder = call => {
      if (call.url.includes("/announce")) {
        return { body: { id: "me", pairing: null } };
      }
      if (call.url.includes("/coop/lobby?self")) {
        return { body: { players: [], pairing: null, request: { id: "asker", name: "Ash" }, declined: null } };
      }
      if (call.url.includes("/respond")) {
        respondCalls++;
        return { body: { code: "ACCEPT", role: "host" } };
      }
      if (call.url.includes("/leave")) {
        return { body: { ok: true } };
      }
      return { body: {} };
    };
    connectMock.mockResolvedValue({ runtime: true });

    const onRequest = vi.fn();
    const onConnected = vi.fn();
    const c = new CoopLobbyController(
      "Brock",
      { onPlayers: vi.fn(), onConnecting: vi.fn(), onConnected, onError: vi.fn(), onRequest },
      { connect: connectMock },
    );
    await c.start();
    await vi.advanceTimersByTimeAsync(1); // first poll -> incoming request surfaces
    await vi.advanceTimersByTimeAsync(1600); // second poll: SAME request -> no duplicate callback
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0][0]).toEqual({ id: "asker", name: "Ash" });

    await c.respond(true); // accept -> pairs as HOST -> connects
    expect(respondCalls).toBe(1);
    expect(connectMock).toHaveBeenCalledWith("ACCEPT", "host", { username: "Brock" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    c.cancel();
  });

  it("controller: request() parks pending; a DECLINE notice fires onDeclined and resumes browsing", async () => {
    vi.useFakeTimers();
    let polls = 0;
    responder = call => {
      if (call.url.includes("/announce")) {
        return { body: { id: "me", pairing: null } };
      }
      if (call.url.includes("/coop/lobby/request")) {
        return { body: { ok: true, pending: true } };
      }
      if (call.url.includes("/coop/lobby?self")) {
        polls++;
        // First poll: Bob is available. After the request: Bob declined (one-shot).
        return polls < 3
          ? { body: { players: [{ id: "bob", name: "Bob", age: 100 }], pairing: null, request: null, declined: null } }
          : { body: { players: [], pairing: null, request: null, declined: "Bob" } };
      }
      if (call.url.includes("/leave")) {
        return { body: { ok: true } };
      }
      return { body: {} };
    };
    const onDeclined = vi.fn();
    const onRequestPending = vi.fn();
    const c = new CoopLobbyController(
      "May",
      {
        onPlayers: vi.fn(),
        onConnecting: vi.fn(),
        onConnected: vi.fn(),
        onError: vi.fn(),
        onDeclined,
        onRequestPending,
      },
      { connect: connectMock },
    );
    await c.start();
    await vi.advanceTimersByTimeAsync(1); // poll 1: Bob listed
    await c.request("bob", "Bob");
    expect(onRequestPending).toHaveBeenCalledWith("Bob");
    expect(c.isRequestPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(1); // poll 2 (rescheduled at 0 by request)
    await vi.advanceTimersByTimeAsync(1600); // poll 3: the decline notice arrives
    expect(onDeclined).toHaveBeenCalledWith("Bob");
    expect(c.isRequestPending()).toBe(false);
    c.cancel();
  });

  it("controller: request() FALLS BACK to the instant pick against an OLD worker (404)", async () => {
    vi.useFakeTimers();
    responder = call => {
      if (call.url.includes("/announce")) {
        return { body: { id: "me", pairing: null } };
      }
      if (call.url.includes("/coop/lobby/request")) {
        return { status: 404, body: { error: "not found" } };
      }
      if (call.url.includes("/coop/lobby/pick")) {
        return { body: { code: "LEGACY", role: "guest" } };
      }
      if (call.url.includes("/leave")) {
        return { body: { ok: true } };
      }
      return { body: { players: [], pairing: null } };
    };
    connectMock.mockResolvedValue({ runtime: true });
    const onConnected = vi.fn();
    const c = new CoopLobbyController(
      "Dawn",
      { onPlayers: vi.fn(), onConnecting: vi.fn(), onConnected, onError: vi.fn() },
      { connect: connectMock },
    );
    await c.start();
    await c.request("bob", "Bob"); // 404 -> falls back to pick -> pairs as guest -> connects
    expect(connectMock).toHaveBeenCalledWith("LEGACY", "guest", { username: "Dawn" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    c.cancel();
  });
});
