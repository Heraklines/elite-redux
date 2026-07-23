import { beforeEach, describe, expect, it } from "vitest";
// P1.5 auto-close-at-cap + ghost-icon plumbing + presence ping — route-boundary tests for the
// tournament worker. A richer in-memory D1 than tournament-routes.test.ts's (it carries the additive
// ghost_json + last_seen columns) exercises the register -> AUTO-CLOSE -> board-view path end to end.
//
// RED-PROOF (documented for the reviewer): the "4th registration flips to in_progress + bracket
// present" assertion is the guard on the auto-close block in handleRegister. Delete that block and
// the 4th register leaves state="registration" / bracket=null, so `expect(state).toBe("in_progress")`
// and `expect(bracket).not.toBeNull()` both FAIL at their named lines. The "5th -> tournament is full"
// assertion additionally guards the registerEntrant cap-before-state guard order.
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

/** In-memory D1 that recognizes the route module's statements by SQL substring (incl. P1.5 columns). */
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
        .sort((a, b) => a.registered_at - b.registered_at)
        .map(e => ({
          participant: e.participant,
          name: e.name,
          preset_name: e.preset_name,
          seed: e.seed,
          registered_at: e.registered_at,
          ghost_json: e.ghost_json,
          last_seen: e.last_seen,
          waitlisted: e.waitlisted,
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
    if (s.startsWith("CREATE") || s.startsWith("ALTER")) {
      return; // schema statements are no-ops for the fake (columns modeled directly)
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
    if (s.startsWith("INSERT INTO tournament_entrants")) {
      this.db.entrants.push({
        tournament_id: String(a[0]),
        participant: String(a[1]),
        name: String(a[2]),
        preset_name: String(a[3]),
        seed: a[4] as number | null,
        registered_at: Number(a[5]),
        ghost_json: (a[6] as string | null) ?? null,
        last_seen: (a[7] as number | null) ?? null,
        waitlisted: (a[8] as number | null) ?? null,
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
    if (s.startsWith("DELETE FROM tournaments WHERE id")) {
      this.db.tournaments.delete(String(a[0]));
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
  return new Request("https://x/", { method, ...(body ? { body: JSON.stringify(body) } : {}) });
}

let env: TournamentEnv;
let db: FakeD1;
beforeEach(() => {
  db = new FakeD1();
  env = { DB: db, TOURNAMENT_ADMIN_UIDS: "1" };
});

async function call(path: string, method: string, caller: Caller | null, body?: unknown) {
  const url = new URL(`https://x${path}`);
  return (await handleTournamentRoute(url, req(method, body), caller, env, cors)) as Response;
}

/** Create a cap-4 tournament (the Sample Cup shape) in registration. */
async function createCap4(): Promise<string> {
  const res = await call("/tournament/create", "POST", ADMIN, { id: "cup", name: "Sample Cup", maxEntrants: 4 });
  expect(res.status).toBe(200);
  return "cup";
}

describe("tournament auto-close at cap (P1.5)", () => {
  it("the 4th registration auto-closes: state -> in_progress + bracket generated (no organizer step)", async () => {
    const id = await createCap4();
    for (const p of ["alice", "bob", "carol"]) {
      const r = await call("/tournament/register", "POST", player(p), { id, presetName: `${p}-team` });
      expect(r.status).toBe(200);
      expect(((await r.json()) as any).autoClosed).toBe(false);
    }
    // still open after 3/4
    const mid = (await (await call("/tournament/bracket?id=cup", "GET", player("alice"))).json()) as any;
    expect(mid.tournament.state).toBe("registration");
    expect(mid.tournament.bracket).toBeNull();

    // the 4th fills the cap -> AUTO-CLOSE
    const fourth = await call("/tournament/register", "POST", player("dave"), { id, presetName: "dave-team" });
    expect(fourth.status).toBe(200);
    expect(((await fourth.json()) as any).autoClosed).toBe(true);

    const view = (await (await call("/tournament/bracket?id=cup", "GET", player("alice"))).json()) as any;
    expect(view.tournament.state).toBe("in_progress"); // RED-PROOF anchor
    expect(view.tournament.bracket).not.toBeNull(); // RED-PROOF anchor
    expect(view.tournament.bracket.size).toBe(4);
    // exact cap -> no byes; every round-0 slot is a real player
    for (const m of view.tournament.bracket.rounds[0]) {
      expect(m.a).not.toBeNull();
      expect(m.b).not.toBeNull();
    }
    // seeds were assigned back onto the rows
    expect(view.tournament.entrants.every((e: any) => typeof e.seed === "number")).toBe(true);
  });

  it("a 5th registration after auto-close is WAITLISTED (P3: entries beyond cap queue)", async () => {
    const id = await createCap4();
    for (const p of ["alice", "bob", "carol", "dave"]) {
      await call("/tournament/register", "POST", player(p), { id, presetName: `${p}-team` });
    }
    // P3 supersedes the old "tournament is full" reject: the field auto-closed at cap but nothing
    // has been played, so a 5th join queues on the waitlist (auto-promoted on a later kick).
    const fifth = await call("/tournament/register", "POST", player("eve"), { id, presetName: "eve-team" });
    expect(fifth.status).toBe(200);
    expect(((await fifth.json()) as any).waitlisted).toBe(true);
    const view = (await (await call("/tournament/bracket?id=cup", "GET", player("alice"))).json()) as any;
    expect(view.tournament.waitlist.map((e: any) => e.participant)).toEqual(["eve"]);
    // ...but once a match is PLAYED, further joins are rejected outright.
    const m0 = view.tournament.bracket.rounds[0][0];
    await call("/tournament/result", "POST", player(m0.a), { tournamentId: id, matchId: m0.id, winner: m0.a });
    await call("/tournament/result", "POST", player(m0.b), { tournamentId: id, matchId: m0.id, winner: m0.a });
    const late = await call("/tournament/register", "POST", player("frank"), { id, presetName: "frank-team" });
    expect(late.status).toBe(422);
  });
});

describe("ghost-icon plumbing (register -> store -> board view)", () => {
  it("carries + sanitizes the entrant's ghost-trainer appearance summary", async () => {
    const id = await createCap4();
    await call("/tournament/register", "POST", player("alice"), {
      id,
      presetName: "alice-team",
      ghost: { spriteKey: "Ace_Trainer_F!!", name: "  Aria  ", title: "The Bold", junk: "dropped" },
    });
    const view = (await (await call("/tournament/bracket?id=cup", "GET", player("alice"))).json()) as any;
    const alice = view.tournament.entrants.find((e: any) => e.participant === "alice");
    expect(alice.ghost).toEqual({ spriteKey: "ace_trainer_f", name: "Aria", title: "The Bold" });
  });

  it("an old registration with no ghost summary yields ghost:null (fallback icon client-side)", async () => {
    const id = await createCap4();
    await call("/tournament/register", "POST", player("bob"), { id, presetName: "bob-team" });
    const view = (await (await call("/tournament/bracket?id=cup", "GET", player("bob"))).json()) as any;
    expect(view.tournament.entrants.find((e: any) => e.participant === "bob").ghost).toBeNull();
  });
});

describe("presence ping (P1.5 display-only last-seen)", () => {
  it("stamps last_seen for an entrant and surfaces it in the board view", async () => {
    const id = await createCap4();
    await call("/tournament/register", "POST", player("alice"), { id, presetName: "alice-team" });
    const before = (await (await call("/tournament/bracket?id=cup", "GET", player("alice"))).json()) as any;
    const seenAtRegister = before.tournament.entrants.find((e: any) => e.participant === "alice").lastSeen;
    expect(typeof seenAtRegister).toBe("number");

    const ping = await call("/tournament/ping", "POST", player("alice"), { id });
    expect(ping.status).toBe(200);
    const after = (await (await call("/tournament/bracket?id=cup", "GET", player("alice"))).json()) as any;
    const seenAfterPing = after.tournament.entrants.find((e: any) => e.participant === "alice").lastSeen;
    expect(typeof seenAfterPing).toBe("number");
    expect(seenAfterPing).toBeGreaterThanOrEqual(seenAtRegister);
  });

  it("a ping from a non-entrant is a harmless 200 no-op", async () => {
    const id = await createCap4();
    const ping = await call("/tournament/ping", "POST", player("stranger"), { id });
    expect(ping.status).toBe(200);
  });
});
