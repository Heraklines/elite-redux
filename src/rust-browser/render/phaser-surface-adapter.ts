import type Phaser from "phaser";

interface SurfaceActorV1 {
  id: string;
  texture_key: string;
  frame?: string | number;
  x: number;
  y: number;
}

interface SurfaceProjectionV1 {
  scene_id: string;
  scene_kind: "TITLE" | "WORLD" | "SCENARIO" | "REWARD" | "MARKET" | "TERMINAL";
  background_texture: string | null;
  actors: SurfaceActorV1[];
  messages: string[];
}

function decodeSurface(bytes: Uint8Array): SurfaceProjectionV1 {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Partial<SurfaceProjectionV1>;
  if (
    typeof value.scene_id !== "string"
    || !["TITLE", "WORLD", "SCENARIO", "REWARD", "MARKET", "TERMINAL"].includes(value.scene_kind ?? "")
    || !Array.isArray(value.actors)
    || !Array.isArray(value.messages)
  ) {
    throw new Error("Rust scene projection is invalid");
  }
  return value as SurfaceProjectionV1;
}

export class PhaserSurfaceAdapterV1 {
  readonly #scene: Phaser.Scene;
  readonly #layer: Phaser.GameObjects.Container;
  #disposed = false;

  constructor(scene: Phaser.Scene, depth = 100) {
    this.#scene = scene;
    this.#layer = scene.add.container(0, 0).setDepth(depth).setName("rust-surface-v1");
  }

  render(bytes: Uint8Array): void {
    if (this.#disposed) {
      throw new Error("Phaser Rust surface adapter is disposed");
    }
    const projection = decodeSurface(bytes);
    this.#layer.removeAll(true);
    if (projection.background_texture != null && this.#scene.textures.exists(projection.background_texture)) {
      const background = this.#scene.add
        .image(this.#scene.scale.width / 2, this.#scene.scale.height / 2, projection.background_texture)
        .setDisplaySize(this.#scene.scale.width, this.#scene.scale.height);
      this.#layer.add(background);
    }
    for (const actor of projection.actors) {
      if (!this.#scene.textures.exists(actor.texture_key)) {
        continue;
      }
      this.#layer.add(
        this.#scene.add.sprite(actor.x, actor.y, actor.texture_key, actor.frame).setName(`rust-actor-${actor.id}`),
      );
    }
    projection.messages.forEach((message, index) => {
      this.#layer.add(
        this.#scene.add.text(16, 16 + index * 22, message, {
          color: "#ffffff",
          fontFamily: "monospace",
          fontSize: "16px",
          backgroundColor: "#000000aa",
        }),
      );
    });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#layer.destroy(true);
  }
}
