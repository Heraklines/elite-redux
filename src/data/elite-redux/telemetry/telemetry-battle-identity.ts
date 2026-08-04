export interface TelemetryBattleAnchor {
  waveIndex: number;
  battleSeed: string | number;
  turn: number;
}

export class TelemetryBattleIdentity {
  private owner: object | null = null;
  private instanceId = "";
  private readonly createInstanceId: () => string;

  constructor(createInstanceId: () => string) {
    this.createInstanceId = createInstanceId;
  }

  reset(): void {
    this.owner = null;
    this.instanceId = "";
  }

  battleId(sessionId: string, battle: TelemetryBattleAnchor & object): string {
    if (this.owner !== battle) {
      this.owner = battle;
      this.instanceId = this.createInstanceId();
    }
    return `${sessionId}:${battle.waveIndex}:${battle.battleSeed}~${this.instanceId}`;
  }

  jointActionId(sessionId: string, battle: TelemetryBattleAnchor & object): string {
    return `${this.battleId(sessionId, battle)}:${battle.turn}`;
  }
}
