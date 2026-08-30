import Phaser from "phaser";
import type { BrowserKernelGenerationV1 } from "../hot-reload/contracts";
import { type RustPhaserRouteSessionV1, startRustPhaserHostV1 } from "../routes/rust-phaser-entry";

export interface RustProductionViewV1 {
  route: RustPhaserRouteSessionV1;
  dispose(): Promise<void>;
}

export function startRustProductionViewV1(host: BrowserKernelGenerationV1): Promise<RustProductionViewV1> {
  return new Promise((resolve, reject) => {
    let route: RustPhaserRouteSessionV1 | null = null;
    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: "app",
      width: 1920,
      height: 1080,
      backgroundColor: "#101820",
      banner: false,
      render: {
        antialias: false,
        pixelArt: true,
        roundPixels: true,
        powerPreference: "low-power",
        failIfMajorPerformanceCaveat: false,
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 1920,
        height: 1080,
      },
      scene: {
        create() {
          startRustPhaserHostV1(host, this)
            .then(value => {
              route = value;
              resolve({
                route: value,
                async dispose() {
                  await route?.dispose();
                  route = null;
                  game.destroy(true);
                },
              });
            })
            .catch(error => {
              game.destroy(true);
              reject(error);
            });
        },
      },
    });
  });
}
