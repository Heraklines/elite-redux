import { beforeEach, describe, expect, it } from "vitest";
// Route-boundary tests for the tournament worker (escrow-test discipline: prove the
// admin ALLOWLIST and the result ATTESTATION at the HTTP seam). The worker's D1 is
// stubbed with a minimal in-memory engine that answers only the exact statements the
// route module issues — enough to exercise the full create -> register -> close ->
// report -> resolve lifecycle without Cloudflare.
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
}
interface EntrantRow {
  tournament_id: string;
  participant: string;
  name: string;
  preset_name: string;
  seed: number | null;
  registered_at: number;
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
    const s = this.sql;
    if (s.includes("FROM tournaments WHERE id")) {
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
        .sort((a, b) => a.registered_at - b.registered_at)
        .map(e => ({
          participant: e.participant,
          name: e.name,
          preset_name: e.preset_name,
          seed: e.seed,
          registered_at: e.registered_at,
        }));
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
    if (s.startsWith("CREATE")) {
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
      });
      return;
    }
    if (s.startsWith("UPDATE tournaments SET")) {
      const row = this.db.tournaments.get(String(a[0]));
      if (row) {
        row.state = String(a[1]);
        row.started_at = a[2] as number | null;
        row.champion = a[3] as string | null;
        row.bracket_json = a[4] as string | null;
      }
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
      });
      return;
    }
    if (s.startsWith("UPDATE tournament_entrants SET seed")) {
      const row = this.db.entrants.find(e => e.tournament_id === String(a[0]) && e.participant === String(a[1]));
      if (row) {
        row.seed = a[2] as number;
      }
      return;
    }
    if (s.startsWith("DELETE FROM tournament_entrants")) {
      this.db.entrants = this.db.entrants.filter(
        e => !(e.tournament_id === String(a[0]) && e.participant === String(a[1])),
      );
      return;
    }
  }
}

const cors = {};
const ADMIN: Caller = { uid: 1, u: "admin" };
function player(u: string, uid = 100): Caller {
  return { uid, u };
}

function req(method: string, body?: unknown): Request {
  return new Request("https://x/", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

let env: TournamentEnv;
beforeEach(() => {
  env = { DB: new FakeD1(), TOURNAMENT_ADMIN_UIDS: "1,7" };
});

async function call(path: string, method: string, caller: Caller | null, body?: unknown) {
  const url = new URL(`https://x${path}`);
  const res = await handleTournamentRoute(url, req(method, body), caller, env, cors);
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

describe("tournament routes — lifecycle + attestation", () => {
  async function createTour(): Promise<string> {
    const res = await call("/tournament/create", "POST", ADMIN, { id: "cup", name: "Cup" });
    expect(res.status).toBe(200);
    return "cup";
  }

  it("registers, rejects dup + missing preset, closes, reports with attestation", async () => {
    const id = await createTour();
    // register 4 players
    for (const p of ["alice", "bob", "carol", "dave"]) {
      const r = await call("/tournament/register", "POST", player(p), { id, presetName: `${p}-team` });
      expect(r.status).toBe(200);
    }
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

    // GET bracket
    const got = await call("/tournament/bracket?id=cup", "GET", player("alice"));
    const gbody = (await got.json()) as any;
    const bracket = gbody.tournament.bracket;
    // find a playable round-0 match (4 entrants, no byes)
    const m0 = bracket.rounds[0][0];
    const [pa, pb] = [m0.a, m0.b];

    // a THIRD party cannot report
    const bad = await call("/tournament/result", "POST", player("carol"), {
      tournamentId: id,
      matchId: m0.id,
      winner: pa,
    });
    expect(((await bad.json()) as any).resolution).toBe("pending");

    // lone report from player a -> pending
    const lone = await call("/tournament/result", "POST", player(pa), { tournamentId: id, matchId: m0.id, winner: pa });
    expect(((await lone.json()) as any).resolution).toBe("pending");

    // agreeing report from player b -> settled
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
    for (const p of ["alice", "bob", "carol", "dave"]) {
      await call("/tournament/register", "POST", player(p), { id, presetName: `${p}-team` });
    }
    await call("/tournament/close-registration", "POST", ADMIN, { id });
    const got = await call("/tournament/bracket?id=cup", "GET", player("alice"));
    const m0 = ((await got.json()) as any).tournament.bracket.rounds[0][0];
    const [pa, pb] = [m0.a, m0.b];
    // conflicting reports
    await call("/tournament/result", "POST", player(pa), { tournamentId: id, matchId: m0.id, winner: pa });
    const conflict = await call("/tournament/result", "POST", player(pb), {
      tournamentId: id,
      matchId: m0.id,
      winner: pb,
    });
    expect(((await conflict.json()) as any).resolution).toBe("disputed");
    // a random player cannot resolve
    expect(
      (await call("/tournament/resolve", "POST", player("carol"), { tournamentId: id, matchId: m0.id, winner: pa }))
        .status,
    ).toBe(403);
    // organizer (admin) resolves
    const resolved = await call("/tournament/resolve", "POST", ADMIN, {
      tournamentId: id,
      matchId: m0.id,
      winner: pb,
    });
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
});
