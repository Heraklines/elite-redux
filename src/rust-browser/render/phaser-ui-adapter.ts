import type Phaser from "phaser";
import { decodeLogicalUiProjection } from "./dom-reference-view";

export class PhaserUiAdapterV1 {
  readonly #scene: Phaser.Scene;
  readonly #layer: Phaser.GameObjects.Container;
  #disposed = false;

  constructor(scene: Phaser.Scene, depth = 10_000) {
    this.#scene = scene;
    this.#layer = scene.add.container(0, 0).setDepth(depth).setName("rust-logical-ui-v1");
  }

  render(bytes: Uint8Array): void {
    if (this.#disposed) {
      throw new Error("Phaser Rust UI adapter is disposed");
    }
    const projection = decodeLogicalUiProjection(bytes);
    this.#layer.removeAll(true);
    const width = this.#scene.scale.width;
    const panel = this.#scene.add.rectangle(
      width / 2,
      this.#scene.scale.height - 92,
      Math.min(640, width - 24),
      160,
      0x101820,
      0.9,
    );
    panel.setStrokeStyle(2, 0xf8f8f8, 1);
    const title = this.#scene.add.text(
      panel.x - panel.width / 2 + 16,
      panel.y - panel.height / 2 + 12,
      projection.title,
      {
        color: "#ffffff",
        fontFamily: "monospace",
        fontSize: "18px",
      },
    );
    this.#layer.add([panel, title]);
    const visible = projection.options.filter(option => !option.hidden);
    for (const option of visible) {
      const x = panel.x - panel.width / 2 + 24 + option.column * 190;
      const y = panel.y - panel.height / 2 + 48 + option.row * 34;
      const label = this.#scene.add.text(x, y, `${option.selected ? ">" : " "} ${option.label}`, {
        color: option.disabled || !projection.actionable ? "#777777" : option.selected ? "#fff176" : "#ffffff",
        fontFamily: "monospace",
        fontSize: "16px",
      });
      label.setName(`rust-option-${option.option_id}`);
      this.#layer.add(label);
    }
    for (const [index, line] of projection.status_lines.entries()) {
      this.#layer.add(
        this.#scene.add.text(panel.x + panel.width / 2 - 220, panel.y - panel.height / 2 + 16 + index * 20, line, {
          color: "#b0bec5",
          fontFamily: "monospace",
          fontSize: "12px",
        }),
      );
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#layer.destroy(true);
  }
}
