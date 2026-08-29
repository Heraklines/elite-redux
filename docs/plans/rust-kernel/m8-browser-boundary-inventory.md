# M8 browser boundary inventory

Browser base: `b2ed1a6eb050a18d5f335ec826e01b7b425ce311`.
Rust base: `ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273`.

## Build and entry

- Production entry: `index.html -> src/main.ts` through `vite.config.ts`.
- Vite 8 uses the existing MPA/OXC/Rolldown build. No Wasm/PWA plugin is present.
- Existing public browser harnesses use alternate sealed entries under `scripts/coop-browser-*.ts`.
- Runtime currently unregisters service workers; deployment workers only clear caches and do not intercept fetches.
- M8 adds a standard worker URL and Wasm loader without changing the default `src/main.ts` authority path.

## Input

`src/inputs-controller.ts`, `src/touch-controls.ts`, and `src/ui-inputs.ts` currently normalize keyboard/gamepad/touch into semantic button callbacks. M8 captures keyboard `code`, keydown/up, gamepad, touch/pointer, focus, text-entry focus, blur, visibility, and lifecycle before semantic dispatch. Browser repeat is noncanonical. Touch/pointer selection uses Rust navigation plans, never option IDs.

## UI and presentation

`src/ui/ui.ts`, `src/enums/ui-mode.ts`, and handlers under `src/ui/handlers/` own Phaser objects, layout, transitions, input callbacks, and overlays. Rust-specific presenters consume `UiViewModel` and never reuse callback arrays as authority.

Presentation flows through Rust presentation envelopes and explicit outcomes. Existing Phaser seams are `src/battle-scene.ts`, `src/data/battle-anims.ts`, `src/animations.ts`, and message handlers. Tween/timer callbacks are generation-fenced so stale animation cannot settle a new event.

## Storage

Current browser saves are localStorage/cloud JSON through `src/system/game-data.ts` and `src/api/*savedata-api.ts`. Rust storage uses a new IndexedDB opaque-byte adapter plus existing authenticated cloud CAS endpoints. TypeScript never decodes Rust state. Reads, writes, deletes, conflicts, quota, corruption, timeout, and generation are typed results.

## Transport

WebRTC seams are `coop-webrtc-connect.ts` and `coop-webrtc-transport.ts`; P33 signaling is in `workers/er-coop-api/src/p33-signaling.ts`. Rust frames remain opaque. Direct frames are size-bounded before string/JSON parsing. Rust authority uses P33 bearer/account/generation binding only; legacy code-and-role routes are forbidden. Mixed TypeScript/Rust authority peers fail the compatibility handshake.

## Lifecycle and cache

`init-update-checker.ts`, `visibilitychange`, `pageshow`, `focus`, `online`, and the Authority V2 scheduler define the current lifecycle. M8 uses `performance.now()` and sends lifecycle/wakeup events; Rust decides due timers. The browser release manifest makes JS, Wasm, content, assets, adapters, and protocol one atomic cache unit. Incomplete/mixed units never execute.

## Shadow boundaries

Existing capture/projector seams under `src/data/elite-redux/coop/authority-v2/` provide control, turn, replacement, interaction, wave, terminal, save, and presentation projections. M8 captures one normalized external stream and compares common projections at bootstrap, control, settled turn/replacement/interaction/progression/wave/capture/scenario/save/terminal boundaries. Rust shadow effects are quarantined.

## Browser tests

The current browser harness is Puppeteer plus Vitest/Node, not Playwright. Reusable sealed preview and two-seat journeys live in `test/browser/coop-public-ui/`. M8 adds Playwright for Chromium/Firefox/WebKit local Rust/shadow/staging routes while retaining the sealed current-browser harness for legacy/co-op regression.
