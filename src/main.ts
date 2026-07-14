import "#app/polyfills"; // All polyfills MUST be loaded first for side effects
import "#utils/console-ring-buffer"; // installs the console ring buffer ASAP so the bug reporter can capture early logs
import "#init/init-manifest"; // initializes the manifest, must be done *before* i18n is initialized due to being used for caching
import "#app/i18n"; // Initializes i18n on import

import { InvertPostFX } from "#app/pipelines/invert";
import { isBeta, isDev } from "#constants/app-constants";
import { version } from "#package.json";
import Phaser from "phaser";
import BBCodeTextPlugin from "phaser3-rex-plugins/plugins/bbcodetext-plugin";
import InputTextPlugin from "phaser3-rex-plugins/plugins/inputtext-plugin";
import TransitionImagePackPlugin from "phaser3-rex-plugins/templates/transitionimagepack/transitionimagepack-plugin";
import UIPlugin from "phaser3-rex-plugins/templates/ui/ui-plugin";

if (isBeta || isDev) {
  document.title += " (Beta)";
}

async function startGame(): Promise<void> {
  const LoadingScene = (await import("./loading-scene")).LoadingScene;
  const BattleScene = (await import("./battle-scene")).BattleScene;
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: "app",
    scale: {
      width: 1920,
      height: 1080,
      mode: Phaser.Scale.FIT,
    },
    plugins: {
      global: [
        {
          key: "rexInputTextPlugin",
          plugin: InputTextPlugin,
          start: true,
        },
        {
          key: "rexBBCodeTextPlugin",
          plugin: BBCodeTextPlugin,
          start: true,
        },
        {
          key: "rexTransitionImagePackPlugin",
          plugin: TransitionImagePackPlugin,
          start: true,
        },
      ],
      scene: [
        {
          key: "rexUI",
          plugin: UIPlugin,
          mapping: "rexUI",
        },
      ],
    },
    input: {
      mouse: {
        target: "app",
      },
      touch: {
        target: "app",
      },
      gamepad: true,
    },
    dom: {
      createContainer: true,
    },
    loader: {
      // ER: bound every individual asset XHR. A stalled CDN request (a jsDelivr
      // hiccup on a sprite atlas that otherwise exists) would otherwise leave the
      // loader pending forever and hang the summon / wave transition that awaits
      // it. 15s is generous for any single file, so a real stall fails fast and
      // Phaser's onError fallback runs instead of freezing the run.
      timeout: 15000,
    },
    antialias: false,
    pipeline: [InvertPostFX] as unknown as Phaser.Types.Core.PipelineConfig,
    scene: [LoadingScene, BattleScene],
    version,
  });
  game.sound.pauseOnBlur = false;
}

try {
  await Promise.all([document.fonts.load("16px emerald"), document.fonts.load("10px pkmnems")]);
} catch (err) {
  console.error("Error loading fonts:", err);
} finally {
  await startGame();
  // Poll for new deploys so long-open tabs auto-reload onto the latest build
  // (no-op in dev/test/app). Saves live in localStorage, so reloads are safe.
  (await import("#init/init-update-checker")).startUpdateChecker();
  // Local-only dev tools (test-scenario harness + console-log button). No-op in
  // production builds and on clean checkouts (gitignored local modules absent).
  void (await import("#app/dev-tools/registry")).loadDevTools();
  // Player-telemetry ML pipeline (#player-telemetry). Hard no-op unless the build-time flag
  // VITE_TELEMETRY is set (staging build) AND an ingest endpoint is configured.
  void (await import("#data/elite-redux/telemetry/telemetry-hooks")).initTelemetry();
}
