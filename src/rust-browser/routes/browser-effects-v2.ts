import type {
  BrowserEffectBatchV2,
  BrowserEffectV2,
  BrowserStorageRequestV2Wire,
  GameControlPlanV2Wire,
  GamePresentationEffectV2Wire,
  PresentationAssetIdentityV1,
  PresentationAudioCueV1,
} from "../contracts/browser-contracts-v2";

export interface BrowserEffectAdaptersV2 {
  renderUi(control: GameControlPlanV2Wire): void | Promise<void>;
  present(effect: GamePresentationEffectV2Wire): void | Promise<void>;
  changePresentationScene(semantic: unknown): void | Promise<void>;
  sendNetworkFrame(generation: number, bytes: Uint8Array): void | Promise<void>;
  handleStorageRequest(request: BrowserStorageRequestV2Wire): void | Promise<void>;
  requestAsset(asset: PresentationAssetIdentityV1): void | Promise<void>;
  playAudioCue(cue: PresentationAudioCueV1): void | Promise<void>;
  showTerminal(terminal: { terminal_id: string; reason: string }): void | Promise<void>;
  recordTelemetry(
    event: "RUN_STARTED" | "ACTION_APPLIED" | "SAVE_COMPLETED" | "TERMINAL_REACHED",
  ): void | Promise<void>;
  publishRepro(snapshot: unknown, inputs: readonly unknown[]): void | Promise<void>;
  dispose(): void | Promise<void>;
}

export class BrowserEffectRouterV2 {
  private disposed = false;
  private lastSequence = -1;
  private readonly adapters: BrowserEffectAdaptersV2;

  constructor(adapters: BrowserEffectAdaptersV2) {
    this.adapters = adapters;
  }
  async dispatch(batch: BrowserEffectBatchV2): Promise<void> {
    if (
      this.disposed
      || !Number.isSafeInteger(batch.external_sequence)
      || batch.external_sequence <= this.lastSequence
    ) {
      throw new Error("Browser effect batch is stale, duplicated, or routed after disposal");
    }
    for (const effect of batch.effects) {
      await this.dispatchEffect(effect);
    }
    this.lastSequence = batch.external_sequence;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.adapters.dispose();
  }

  private async dispatchEffect(effect: BrowserEffectV2): Promise<void> {
    switch (effect.kind) {
      case "UI_CHANGED":
        await this.adapters.renderUi(effect.control);
        return;
      case "PRESENTATION":
        await this.adapters.present(effect.effect);
        return;
      case "PRESENTATION_SCENE_CHANGED":
        await this.adapters.changePresentationScene(effect.semantic);
        return;
      case "SEND_NETWORK_FRAME":
        await this.adapters.sendNetworkFrame(effect.generation, Uint8Array.from(effect.bytes));
        return;
      case "STORAGE_REQUEST":
        await this.adapters.handleStorageRequest(effect.request);
        return;
      case "ASSET_REQUEST":
        await this.adapters.requestAsset(effect.asset);
        return;
      case "AUDIO_CUE":
        await this.adapters.playAudioCue(effect.cue);
        return;
      case "TERMINAL":
        await this.adapters.showTerminal(effect.terminal);
        return;
      case "TELEMETRY":
        await this.adapters.recordTelemetry(effect.event);
        return;
      case "REPRO_READY":
        await this.adapters.publishRepro(effect.snapshot, effect.inputs);
        return;
      default:
        effect satisfies never;
    }
  }
}
