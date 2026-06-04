import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { getTelemetrySnapshot } from "#system/llm-director/telemetry";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";

/**
 * Toggleable diagnostic overlay for the LLM Director. Off by default; F12
 * toggles visibility. Shows the last ~10 LLM calls (model, latency, tokens,
 * status) so a developer can see at a glance whether generation is healthy
 * during a run.
 *
 * Lives outside the regular UiMode/UiHandler stack — it's intentionally not
 * focusable, doesn't capture input, and doesn't pause the game. Render is
 * lazy: the overlay re-reads the telemetry buffer on each show.
 */
export class LlmDirectorDebugOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private titleText: Phaser.GameObjects.Text | null = null;
  private bodyText: Phaser.GameObjects.Text | null = null;
  private visible = false;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;

  private static readonly OVERLAY_X = 8;
  private static readonly OVERLAY_Y = 8;
  private static readonly WIDTH = 240;
  private static readonly HEIGHT = 130;
  private static readonly MAX_ENTRIES = 10;

  public mount(): void {
    if (this.keyHandler) {
      return;
    }
    this.keyHandler = (ev: KeyboardEvent) => {
      if (ev.key === "F12") {
        ev.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  public unmount(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    this.destroyContainer();
  }

  public toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  public show(): void {
    this.ensureContainer();
    this.refresh();
    this.container?.setVisible(true);
    this.visible = true;
  }

  public hide(): void {
    this.container?.setVisible(false);
    this.visible = false;
  }

  public isVisible(): boolean {
    return this.visible;
  }

  private ensureContainer(): void {
    if (this.container) {
      return;
    }
    if (!globalScene?.add) {
      // Scene not ready yet — defer until next show.
      return;
    }
    this.container = globalScene.add.container(LlmDirectorDebugOverlay.OVERLAY_X, LlmDirectorDebugOverlay.OVERLAY_Y);
    this.container.setName("llm-director-debug-overlay");
    this.container.setDepth(9999);
    const bg = addWindow(0, 0, LlmDirectorDebugOverlay.WIDTH, LlmDirectorDebugOverlay.HEIGHT);
    this.container.add(bg);
    this.titleText = addTextObject(6, 4, "LLM Director — debug", TextStyle.WINDOW);
    this.container.add(this.titleText);
    this.bodyText = addTextObject(6, 16, "", TextStyle.WINDOW, { fontSize: "44px" });
    this.container.add(this.bodyText);
    globalScene.uiContainer?.add(this.container);
  }

  private destroyContainer(): void {
    if (this.container) {
      this.container.destroy();
      this.container = null;
      this.titleText = null;
      this.bodyText = null;
    }
  }

  private refresh(): void {
    if (!this.bodyText) {
      return;
    }
    const entries = getTelemetrySnapshot().slice(-LlmDirectorDebugOverlay.MAX_ENTRIES).reverse();
    if (entries.length === 0) {
      this.bodyText.setText("(no LLM calls yet)");
      return;
    }
    const lines = entries.map(e => {
      const ms = Math.round(e.latencyMs);
      const tokens = `${e.inputTokens}/${e.outputTokens}`;
      const model = e.model.length > 20 ? `${e.model.slice(0, 19)}…` : e.model;
      return `${e.status.padEnd(8)} ${model.padEnd(22)} ${ms}ms tok=${tokens}`;
    });
    this.bodyText.setText(lines.join("\n"));
  }
}

let instance: LlmDirectorDebugOverlay | null = null;

/** Process-wide accessor; the BattleScene mounts this once at startup. */
export function getDebugOverlay(): LlmDirectorDebugOverlay {
  if (!instance) {
    instance = new LlmDirectorDebugOverlay();
  }
  return instance;
}
