import type {
  BrowserEffectBatchV2,
  BrowserEffectV2,
  BrowserRequestV2,
  BrowserStorageRequestV2Wire,
  GameControlPlanV2Wire,
  GamePresentationEffectV2Wire,
  PresentationAssetIdentityV1,
  PresentationAudioCueV1,
} from "../contracts/browser-contracts-v2";

export interface BrowserEffectAdaptersV2 {
  /** Enqueue capture delivery without awaiting nested effect routing. */
  completeExternalRequest?(request: BrowserRequestV2): void;
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
  publishCurrentRepro(capsuleBytes: Uint8Array): void | Promise<void>;
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
      case "UTC_CLOCK_REQUEST": {
        if (this.adapters.completeExternalRequest == null) throw new Error("UTC clock input adapter is unavailable");
        if (!Number.isSafeInteger(effect.request_id) || effect.request_id <= 0) throw new Error("invalid UTC request identity");
        this.adapters.completeExternalRequest({ kind: "UTC_CLOCK_RESULT", request_id: effect.request_id, utc_milliseconds: Date.now() });
        return;
      }
      case "FLASH_EGG_INPUTS_REQUEST": {
        if (this.adapters.completeExternalRequest == null) throw new Error("Flash Egg input adapter is unavailable");
        const { request, pending } = effect.request;
        if (!Number.isSafeInteger(request) || request <= 0 || !Number.isSafeInteger(pending) || pending <= 0) throw new Error("invalid Flash Egg request identity");
        const draw = () => {
          const value = Math.random();
          if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("invalid external random unit");
          const bytes = new ArrayBuffer(8);
          new DataView(bytes).setFloat64(0, value, false);
          return { ieee754_bits: Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("") };
        };
        const seed_draws = Array.from({ length: 24 }, draw);
        const id_draw = draw();
        const egg_utc_milliseconds = Date.now();
        this.adapters.completeExternalRequest({ kind: "FLASH_EGG_INPUTS", input: { request, pending, seed_draws, id_draw, egg_utc_milliseconds } });
        return;
      }
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
      case "CURRENT_REPRO_READY":
        await this.adapters.publishCurrentRepro(Uint8Array.from(effect.capsule_bytes));
        return;
      default:
        effect satisfies never;
    }
  }
}
