import { beforeEach, describe, expect, it } from "vitest";
// Route-boundary tests for the tournament worker (escrow-test discipline: prove the
// admin ALLOWLIST and the result ATTESTATION at the HTTP seam). The worker's D1 is
// stubbed with a minimal in-memory engine that answers only the exact statements the
// route module issues — enough to exercise the full create -> register -> close ->
// report -> resolve lifecycle (+ the P3 admin ops) without Cloudflare.
import {
  type Caller,
  handleTournamentRoute,
  type TournamentEnv,
} from "../../../../workers/er-telemetry/src/tournament-routes";

interface TourRow {
  id: string;
  name: string;
  organizer: string;
  state: string;
  round_window_ms: number;
  max_entrants: number;
  created_at: number;
  started_at: number | null;
  champion: string | null;
  bracket_json: string | null;
  battle_format: string | null;
  series_format: string | null;
  reward_pool_json: string | null;
  close_at: number | null;
  rewards_granted: number | null;
}
interface EntrantRow {
  tournament_id: string;
  participant: string;
  name: string;
  preset_name: string;
  seed: number | null;
  registered_at: number;
  ghost_json: string | null;
  last_seen: number | null;
  waitlisted: number | null;
}

/** A tiny in-memory D1 that recognizes the route module's statements by SQL substring. */
class FakeD1 {
  tournaments = new Map<string, TourRow>();
  entrants: EntrantRow[] = [];

  prepare(sql: string) {
    return new FakeStmt(this, sql, []);
  }
}

class FakeStmt {
  constructor(
    private db: FakeD1,
    private sql: string,
    private args: unknown[],
  ) {}
  bind(...args: unknown[]): FakeStmt {
    return new FakeStmt(this.db, this.sql, args);
  }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM tournaments WHERE id")) {
      return (this.db.tournaments.get(String(this.args[0])) as T) ?? null;
    }
    return null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    const s = this.sql;
    if (s.includes("FROM tournament_entrants WHERE tournament_id")) {
      const tid = String(this.args[0]);
      const rows = this.db.entrants
        .filter(e => e.tournament_id === tid)
        .sort((a, b) => a.registered_at - b.registered_at);
      return { results: rows as T[] };
    }
    if (s.includes("FROM tournaments WHERE state IN")) {
      return { results: [...this.db.tournaments.values()] as T[] };
    }
    return { results: [] };
  }
  async run(): Promise<void> {
    const s = this.sql;
    const a = this.args;
    if (s.startsWith("CREATE") || s.startsWith("ALTER")) {
      return;
    }
    if (s.startsWith("INSERT INTO tournaments")) {
      this.db.tournaments.set(String(a[0]), {
        id: String(a[0]),
        name: String(a[1]),
        organizer: String(a[2]),
        state: String(a[3]),
        round_window_ms: Number(a[4]),
        max_entrants: Number(a[5]),
        created_at: Number(a[6]),
        started_at: a[7] as number | null,
        champion: a[8] as string | null,
        bracket_json: a[9] as string | null,
        battle_format: a[10] as string | null,
        series_format: a[11] as string | null,
        reward_pool_json: a[12] as string | null,
        close_at: a[13] as number | null,
        rewards_granted: a[14] as number | null,
      });
      return;
    }
    if (s.startsWith("UPDATE tournaments SET")) {
      const row = this.db.tournaments.get(String(a[0]));
      if (row) {
        row.name = String(a[1]);
        row.state = String(a[2]);
        row.started_at = a[3] as number | null;
        row.champion = a[4] as string | null;
        row.bracket_json = a[5] as string | null;
        row.round_window_ms = Number(a[6]);
        row.max_entrants = Number(a[7]);
        row.battle_format = a[8] as string | null;
        row.series_format = a[9] as string | null;
        row.reward_pool_json = a[10] as string | null;
        row.close_at = a[11] as number | null;
        row.rewards_granted = a[12] as number | null;
      }
      return;
    }
    if (s.startsWith("DELETE FROM tournaments WHERE id")) {
      this.db.tournaments.delete(String(a[0]));
      return;
    }
    if (s.startsWith("INSERT INTO tournament_entrants")) {
      this.db.entrants.push({
        tournament_id: String(a[0]),
        participant: String(a[1]),
        name: String(a[2]),
        preset_name: String(a[3]),
        seed: a[4] as number | null,
        registered_at: Number(a[5]),
        ghost_json: a[6] as string | null,
        last_seen: a[7] as number | null,
        waitlisted: a[8] as number | null,
      });
      return;
    }
    if (s.startsWith("UPDATE tournament_entrants SET seed=NULL WHERE tournament_id")) {
      for (const e of this.db.entrants) {
        if (e.tournament_id === String(a[0])) {
          e.seed = null;
        }
      }
      return;
    }
    if (s.startsWith("UPDATE tournament_entrants SET seed")) {
      const row = this.db.entrants.find(e => e.tournament_id === String(a[0]) && e.participant === String(a[1]));
      if (row) {
        row.seed = a[2] as number;
      }
      return;
    }
    if (s.startsWith("UPDATE tournament_entrants SET last_seen")) {
      const row = this.db.entrants.find(e => e.tournament_id === String(a[0]) && e.participant === String(a[1]));
      if (row) {
        row.last_seen = a[2] as number;
      }
      return;
    }
    if (s.startsWith("UPDATE tournament_entrants SET waitlisted")) {
      const row = this.db.entrants.find(e => e.tournament_id === String(a[0]) && e.participant === String(a[1]));
      if (row) {
        row.waitlisted = 0;
      }
      return;
    }
    if (s.startsWith("DELETE FROM tournament_entrants WHERE tournament_id=?1 AND participant")) {
      this.db.entrants = this.db.entrants.filter(
        e => !(e.tournament_id === String(a[0]) && e.participant === String(a[1])),
      );
      return;
    }
    if (s.startsWith("DELETE FROM tournament_entrants WHERE tournament_id")) {
      this.db.entrants = this.db.entrants.filter(e => e.tournament_id !== String(a[0]));
      return;
    }
  }
}

const cors = {};
const ADMIN: Caller = { uid: 1, u: "admin" };
function player(u: string, uid = 100): Caller {
  return { uid, u };
}

function req(method: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request("https://x/", {
    method,
    ...(headers ? { headers } : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

let env: TournamentEnv;
// Records every reward delivery the grant route pushes (the server-to-server settlement sink stub).
let deliveries: { tournamentId: string; settlements: unknown[] }[];
let sinkFails: boolean;
beforeEach(() => {
  deliveries = [];
  sinkFails = false;
  env = {
    DB: new FakeD1(),
    TOURNAMENT_ADMIN_UIDS: "1,7",
    EDITOR_PASSWORD: "team-secret",
    grantSink: async (tournamentId, settlements) => {
      if (sinkFails) {
        return { ok: false, delivered: 0, error: "stub failure" };
      }
      deliveries.push({ tournamentId, settlements });
      return { ok: true, delivered: settlements.length };
    },
  };
});

async function call(
  path: string,
  method: string,
  caller: Caller | null,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const url = new URL(`https://x${path}`);
  const res = await handleTournamentRoute(url, req(method, body, headers), caller, env, cors);
  return res as Response;
}

describe("tournament routes — auth + admin allowlist", () => {
  it("401s an unauthenticated caller", async () => {
    const res = await call("/tournament/list", "GET", null);
    expect(res.status).toBe(401);
  });
  it("403s a non-admin trying to create", async () => {
    const res = await call("/tournament/create", "POST", player("bob"), { name: "Cup" });
    expect(res.status).toBe(403);
  });
  it("lets an allowlisted admin create", async () => {
    const res = await call("/tournament/create", "POST", ADMIN, { name: "Cup", roundWindowMs: 8 * 3600_000 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tournament.state).toBe("registration");
    expect(body.tournament.roundWindowMs).toBe(8 * 3600_000);
  });
});

describe("tournament routes — editor-password auth (team credential)", () => {
  const EDITOR_HDR = { "X-Editor-Auth": "team-secret" };

  it("lets an editor-password-only caller (no token) create — synthetic editor admin", async () => {
    const res = await call("/tournament/create", "POST", null, { id: "ec", name: "Editor Cup" }, EDITOR_HDR);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tournament.state).toBe("registration");
    // organizer is the synthetic editor identity
    expect(body.tournament.organizer).toBe("editor");
  });

  it("rejects a WRONG editor password with no token (401 — unauthorized)", async () => {
    const res = await call("/tournament/create", "POST", null, { name: "Cup" }, { "X-Editor-Auth": "nope" });
    expect(res.status).toBe(401);
  });

  it("a NON-admin token PLUS a valid editor password is granted admin", async () => {
    const res = await call("/tournament/create", "POST", player("bob"), { id: "bc", name: "Bob Cup" }, EDITOR_HDR);
    expect(res.status).toBe(200);
    // organizer is the real token identity (bob), but admin came from the editor password
    expect(((await res.json()) as any).tournament.organizer).toBe("bob");
  });

  it("a non-admin token WITHOUT the editor password is still rejected (403)", async () => {
    const res = await call("/tournament/create", "POST", player("bob"), { name: "Cup" });
    expect(res.status).toBe(403);
  });

  it("editor password does nothing when the secret is unset on the worker", async () => {
    env.EDITOR_PASSWORD = undefined;
    const res = await call("/tournament/create", "POST", null, { name: "Cup" }, EDITOR_HDR);
    expect(res.status).toBe(401);
  });

  it("the uid allowlist path still works alongside editor auth", async () => {
    const res = await call("/tournament/create", "POST", ADMIN, { id: "uc", name: "Uid Cup" });
    expect(res.status).toBe(200);
  });
});

describe("tournament routes — lifecycle + attestation", () => {
  async function createTour(extra: Record<string, unknown> = {}): Promise<string> {
    const res = await call("/tournament/create", "POST", ADMIN, { id: "cup", name: "Cup", ...extra });
    expect(res.status).toBe(200);
    return "cup";
  }
  async function register(id: string, names: string[]) {
    for (const p of names) {
      const r = await call("/tournament/register", "POST", player(p), { id, presetName: `${p}-team` });
      expect(r.status).toBe(200);
    }
  }
  async function bracketOf(id: string, as = "alice") {
    const got = await call(`/tournament/bracket?id=${id}`, "GET", player(as));
    return ((await got.json()) as any).tournament;
  }

  it("registers, rejects dup + missing preset, closes, reports with attestation", async () => {
    const id = await createTour();
    await register(id, ["alice", "bob", "carol", "dave"]);
    // missing preset -> 422
    expect((await call("/tournament/register", "POST", player("eve"), { id })).status).toBe(422);
    // dup -> 422
    expect((await call("/tournament/register", "POST", player("alice"), { id, presetName: "again" })).status).toBe(422);

    // non-admin cannot close
    expect((await call("/tournament/close-registration", "POST", player("bob"), { id })).status).toBe(403);
    // admin closes -> bracket generates
    const closed = await call("/tournament/close-registration", "POST", ADMIN, { id });
    expect(closed.status).toBe(200);
    const cbody = (await closed.json()) as any;
    expect(cbody.tournament.state).toBe("in_progress");
    expect(cbody.tournament.bracket.size).toBe(4);

    const bracket = (await bracketOf(id)).bracket;
    const m0 = bracket.rounds[0][0];
    const [pa, pb] = [m0.a, m0.b];

    // a THIRD party cannot report
    const bad = await call("/tournament/result", "POST", player("carol"), {
      tournamentId: id,
      matchId: m0.id,
      winner: pa,
    });
    expect(((await bad.json()) as any).resolution).toBe("pending");
    // lone report -> pending
    const lone = await call("/tournament/result", "POST", player(pa), { tournamentId: id, matchId: m0.id, winner: pa });
    expect(((await lone.json()) as any).resolution).toBe("pending");
    // agreeing report -> settled
    const settle = await call("/tournament/result", "POST", player(pb), {
      tournamentId: id,
      matchId: m0.id,
      winner: pa,
    });
    const sbody = (await settle.json()) as any;
    expect(sbody.resolution).toBe("settled");
    expect(sbody.match.winner).toBe(pa);
  });

  it("disputed reports need an organizer resolve", async () => {
    const id = await createTour();
    await register(id, ["alice", "bob", "carol", "dave"]);
    await call("/tournament/close-registration", "POST", ADMIN, { id });
    const m0 = (await bracketOf(id)).bracket.rounds[0][0];
    const [pa, pb] = [m0.a, m0.b];
    await call("/tournament/result", "POST", player(pa), { tournamentId: id, matchId: m0.id, winner: pa });
    const conflict = await call("/tournament/result", "POST", player(pb), {
      tournamentId: id,
      matchId: m0.id,
      winner: pb,
    });
    expect(((await conflict.json()) as any).resolution).toBe("disputed");
    expect(
      (await call("/tournament/resolve", "POST", player("carol"), { tournamentId: id, matchId: m0.id, winner: pa }))
        .status,
    ).toBe(403);
    const resolved = await call("/tournament/resolve", "POST", ADMIN, { tournamentId: id, matchId: m0.id, winner: pb });
    const rbody = (await resolved.json()) as any;
    expect(rbody.resolution).toBe("settled");
    expect(rbody.match.winner).toBe(pb);
    expect(rbody.match.resolution).toBe("manual");
  });

  it("cancel is admin-gated", async () => {
    const id = await createTour();
    expect((await call("/tournament/cancel", "POST", player("bob"), { id })).status).toBe(403);
    expect((await call("/tournament/cancel", "POST", ADMIN, { id })).status).toBe(200);
  });

  // ---- P3 admin ops ----

  it("CREATE stores + exposes battle/series format + reward pool + closeAt", async () => {
    const id = await createTour({
      maxEntrants: 32,
      battleFormat: "doubles",
      seriesFormat: "bo3",
      closeAt: 5_000_000_000_000,
      rewardPool: [{ place: "champion", mutations: [{ kind: "grantCurrency", amount: 5000 }] }],
    });
    const t = await bracketOf(id);
    expect(t.maxEntrants).toBe(32);
    expect(t.battleFormat).toBe("doubles");
    expect(t.seriesFormat).toBe("bo3");
    expect(t.closeAt).toBe(5_000_000_000_000);
    expect(t.rewardPool).toEqual([{ place: "champion", mutations: [{ kind: "grantCurrency", amount: 5000 }] }]);
  });

  it("clamps a > 64 cap down to 64", async () => {
    const id = await createTour({ maxEntrants: 999 });
    expect((await bracketOf(id)).maxEntrants).toBe(64);
  });

  it("EDIT changes rewards/cap/window in registration, locks after close", async () => {
    const id = await createTour({ maxEntrants: 8 });
    await register(id, ["alice", "bob"]);
    const edited = await call("/tournament/edit", "POST", ADMIN, {
      id,
      maxEntrants: 16,
      roundWindowMs: 12 * 3600_000,
      rewardPool: [{ place: "runnerUp", mutations: [{ kind: "grantCandy", speciesId: 25, candy: 50 }] }],
    });
    expect(edited.status).toBe(200);
    const t = await bracketOf(id);
    expect(t.maxEntrants).toBe(16);
    expect(t.roundWindowMs).toBe(12 * 3600_000);
    expect(t.rewardPool[0].place).toBe("runnerUp");
    // non-admin cannot edit
    expect((await call("/tournament/edit", "POST", player("bob"), { id, name: "Hax" })).status).toBe(403);
    // after close -> 422
    await call("/tournament/close-registration", "POST", ADMIN, { id });
    expect((await call("/tournament/edit", "POST", ADMIN, { id, maxEntrants: 32 })).status).toBe(422);
  });

  it("WAITLIST beyond cap + auto-promote on a registration kick (scenario 8)", async () => {
    const id = await createTour({ maxEntrants: 4 });
    // 4 fill the field and auto-close; the 5th and 6th queue on the waitlist.
    await register(id, ["a", "b", "c", "d"]);
    // field is now in_progress (auto-closed at cap) but nothing played -> new joins waitlist
    const w1 = await call("/tournament/register", "POST", player("e"), { id, presetName: "e-team" });
    expect(((await w1.json()) as any).waitlisted).toBe(true);
    const w2 = await call("/tournament/register", "POST", player("f"), { id, presetName: "f-team" });
    expect(((await w2.json()) as any).waitlisted).toBe(true);
    let t = await bracketOf(id);
    expect(t.waitlist.map((x: any) => x.participant)).toEqual(["e", "f"]);
    // kick 'a' (mid pre-play) -> REOPEN + promote the FIRST waitlisted ('e'); field refills to cap -> re-close
    const kicked = await call("/tournament/kick", "POST", ADMIN, { id, participant: "a" });
    expect(kicked.status).toBe(200);
    const kbody = (await kicked.json()) as any;
    expect(kbody.promoted).toBe("e");
    t = await bracketOf(id);
    const active = t.entrants.map((x: any) => x.participant).sort();
    expect(active).toEqual(["b", "c", "d", "e"]);
    expect(t.waitlist.map((x: any) => x.participant)).toEqual(["f"]);
    expect(t.state).toBe("in_progress"); // refilled to cap -> auto-closed again
  });

  it("KICK during registration (under cap, no waitlist) just frees the slot (scenario 2)", async () => {
    const id = await createTour({ maxEntrants: 8 });
    await register(id, ["a", "b", "c"]);
    const kicked = await call("/tournament/kick", "POST", ADMIN, { id, participant: "b" });
    expect(kicked.status).toBe(200);
    expect(((await kicked.json()) as any).promoted).toBe(null);
    const t = await bracketOf(id);
    expect(t.entrants.map((x: any) => x.participant).sort()).toEqual(["a", "c"]);
    expect(t.state).toBe("registration");
  });

  it("KICK mid-tournament is a WALKOVER — opponent advances, board shows kicked (scenario 3)", async () => {
    const id = await createTour({ maxEntrants: 4 });
    await register(id, ["a", "b", "c", "d"]); // auto-closes to a 4-bracket
    let t = await bracketOf(id);
    // play ONE match to create progress
    const m0 = t.bracket.rounds[0][0];
    await call("/tournament/result", "POST", player(m0.a), { tournamentId: id, matchId: m0.id, winner: m0.a });
    await call("/tournament/result", "POST", player(m0.b), { tournamentId: id, matchId: m0.id, winner: m0.a });
    // now kick a player in the OTHER, unplayed match -> walkover
    t = await bracketOf(id);
    const m1 = t.bracket.rounds[0][1];
    const victim = m1.a;
    const survivor = m1.b;
    const kicked = await call("/tournament/kick", "POST", ADMIN, { id, participant: victim });
    expect(kicked.status).toBe(200);
    expect(((await kicked.json()) as any).kind).toBe("walkover");
    t = await bracketOf(id);
    const m1b = t.bracket.rounds[0][1];
    expect(m1b.winner).toBe(survivor);
    expect(m1b.resolution).toBe("walkover");
    expect(t.bracket.kicked).toContain(victim);
  });

  it("RESEED regenerates while zero played, rejects after a match (scenario 7)", async () => {
    const id = await createTour({ maxEntrants: 4 });
    await register(id, ["a", "b", "c", "d"]);
    // reseed while zero played -> ok
    const re = await call("/tournament/reseed", "POST", ADMIN, { id });
    expect(re.status).toBe(200);
    // play a match, then reseed -> 422
    const t = await bracketOf(id);
    const m0 = t.bracket.rounds[0][0];
    await call("/tournament/result", "POST", player(m0.a), { tournamentId: id, matchId: m0.id, winner: m0.a });
    await call("/tournament/result", "POST", player(m0.b), { tournamentId: id, matchId: m0.id, winner: m0.a });
    expect((await call("/tournament/reseed", "POST", ADMIN, { id })).status).toBe(422);
  });

  it("DELETE removes a tournament in any state (scenario 4)", async () => {
    const id = await createTour();
    await register(id, ["a", "b"]);
    const del = await call("/tournament/delete", "POST", ADMIN, { id });
    expect(del.status).toBe(200);
    expect((await call(`/tournament/bracket?id=${id}`, "GET", player("a"))).status).toBe(404);
  });

  async function playOutSampleCup(extra: Record<string, unknown>): Promise<{ id: string; champion: string }> {
    const id = await createTour({ maxEntrants: 4, ...extra });
    await register(id, ["a", "b", "c", "d"]);
    const play = async (mid: string, winner: string) => {
      const t = await bracketOf(id);
      const m = t.bracket.rounds.flat().find((x: any) => x.id === mid);
      await call("/tournament/result", "POST", player(m.a), { tournamentId: id, matchId: mid, winner });
      await call("/tournament/result", "POST", player(m.b), { tournamentId: id, matchId: mid, winner });
    };
    let t = await bracketOf(id);
    const [r0m0, r0m1] = [t.bracket.rounds[0][0], t.bracket.rounds[0][1]];
    await play(r0m0.id, r0m0.a);
    await play(r0m1.id, r0m1.a);
    t = await bracketOf(id);
    await play(t.bracket.rounds[1][0].id, t.bracket.rounds[1][0].a);
    t = await bracketOf(id);
    expect(t.state).toBe("complete");
    return { id, champion: t.champion };
  }

  it("GRANT-REWARDS computes per-place grants at completion (scenario 10)", async () => {
    const { id, champion } = await playOutSampleCup({
      rewardPool: [
        { place: "champion", mutations: [{ kind: "grantCurrency", amount: 10000 }] },
        { place: "semifinalist", mutations: [{ kind: "grantCandy", speciesId: 1, candy: 20 }] },
      ],
    });
    const g = await call("/tournament/grant-rewards", "POST", ADMIN, { id });
    expect(g.status).toBe(200);
    const gbody = (await g.json()) as any;
    const champGrant = gbody.granted.find((x: any) => x.place === "champion");
    expect(champGrant.participant).toBe(champion);
    expect(gbody.granted.filter((x: any) => x.place === "semifinalist").length).toBe(2);
    // double-grant guarded
    expect((await call("/tournament/grant-rewards", "POST", ADMIN, { id })).status).toBe(422);
  });

  it("GRANT-REWARDS DELIVERS chosen-shiny + candy settlements through the sink, once", async () => {
    const { id, champion } = await playOutSampleCup({
      rewardPool: [
        {
          place: "champion",
          mutations: [
            { kind: "grantShinyChosen", speciesId: 6, tier: 4 },
            { kind: "grantCandy", speciesId: 1, candy: 25 },
          ],
        },
        {
          place: "semifinalist",
          mutations: [{ kind: "grantShinyRandom", tier: 2, unownedOnly: true, speciesPool: [151] }],
        },
      ],
    });
    const g = await call("/tournament/grant-rewards", "POST", ADMIN, { id });
    expect(g.status).toBe(200);
    const gbody = (await g.json()) as any;
    // Delivered exactly once
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].tournamentId).toBe(id);
    const sent = deliveries[0].settlements as any[];
    // champion gets a black-shiny grantUnlock + a candy grant; two semifinalists each get a shiny-151.
    const champSettlements = sent.filter(s => s.uid === champion);
    expect(champSettlements).toContainEqual({
      uid: champion,
      mutation: { kind: "grantUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: true, cost: 0 },
    });
    expect(champSettlements).toContainEqual({
      uid: champion,
      mutation: { kind: "grantCandy", speciesId: 1, candy: 25 },
    });
    const semiShinies = sent.filter(s => s.mutation.kind === "grantUnlock" && s.mutation.speciesId === 151);
    expect(semiShinies).toHaveLength(2);
    expect(gbody.delivered).toBe(sent.length);

    // Idempotent: a second grant is refused (rewardsGranted) and NEVER delivers again.
    expect((await call("/tournament/grant-rewards", "POST", ADMIN, { id })).status).toBe(422);
    expect(deliveries).toHaveLength(1);
  });

  it("GRANT-REWARDS leaves rewardsGranted FALSE on a delivery failure (retryable)", async () => {
    const { id } = await playOutSampleCup({
      rewardPool: [{ place: "champion", mutations: [{ kind: "grantShinyChosen", speciesId: 6, tier: 1 }] }],
    });
    sinkFails = true;
    const fail = await call("/tournament/grant-rewards", "POST", ADMIN, { id });
    expect(fail.status).toBe(502);
    // rewards NOT marked granted -> a retry (now succeeding) delivers.
    sinkFails = false;
    const retry = await call("/tournament/grant-rewards", "POST", ADMIN, { id });
    expect(retry.status).toBe(200);
    expect(deliveries).toHaveLength(1);
  });
});
