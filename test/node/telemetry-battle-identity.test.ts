import { TelemetryBattleIdentity } from "#data/elite-redux/telemetry/telemetry-battle-identity";
import { describe, expect, it } from "vitest";

describe("TelemetryBattleIdentity", () => {
  it("is stable within a battle and branches when an equivalent battle is recreated", () => {
    const ids = ["first", "second"];
    const identity = new TelemetryBattleIdentity(() => ids.shift()!);
    const firstBattle = { waveIndex: 12, battleSeed: "seed", turn: 3 };
    const recreatedBattle = { ...firstBattle };

    expect(identity.jointActionId("episode", firstBattle)).toBe("episode:12:seed~first:3");
    expect(identity.jointActionId("episode", firstBattle)).toBe("episode:12:seed~first:3");
    expect(identity.jointActionId("episode", recreatedBattle)).toBe("episode:12:seed~second:3");
    expect(identity.battleId("episode", recreatedBattle)).toBe("episode:12:seed~second");
  });

  it("allocates a new branch after a session reset", () => {
    const ids = ["before", "after"];
    const battle = { waveIndex: 1, battleSeed: 2, turn: 1 };
    const identity = new TelemetryBattleIdentity(() => ids.shift()!);

    expect(identity.battleId("episode-a", battle)).toBe("episode-a:1:2~before");
    identity.reset();
    expect(identity.battleId("episode-b", battle)).toBe("episode-b:1:2~after");
  });
});
