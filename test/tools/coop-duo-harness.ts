/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op harness (#633). Boots a HOST BattleScene (the sole authoritative
// engine) AND a GUEST BattleScene (a pure renderer) in ONE vitest process, paired over
// an in-process LoopbackTransport (createLoopbackPair - the SAME framing the real WebRTC
// path uses). Unlike every prior co-op test (which is single-engine: one globalScene, the
// local client plays the GUEST and the HOST is FAKED with hand-authored turnResolution
// messages), here BOTH sides are REAL engines, so a real host-vs-guest divergence surfaces
// organically in the logs.
//
// The hard part is that the engine has PROCESS-GLOBAL state that is NOT per-scene
// (see test/.../duo_harness_inventory.md). The scheduler swaps a 4-part ClientCtx
// atomically before pumping each client:
//   1. globalScene            (src/global-scene.ts, set via initGlobalScene)
//   2. the coop `active` runtime (setCoopRuntime / getCoopRuntime)
//   3. Phaser.Math.RND.state() (process-global seeded RNG)
//   4. the er-ghost-teams per-run cache quartet (resetErGhostRunState boundary)
//
// Each CoopRuntime is assembled ONCE (host via startLocalCoopSession-style wiring on
// the loopback `host` end; guest via connectCoopSession-style wiring on the `guest`
// end) and thereafter the live one is selected with setCoopRuntime - NEVER re-wired
// (clearCoopRuntime / startLocalCoopSession destroy the first session).
//
// -----------------------------------------------------------------------------
// HOW TO RUN (the duo tests are gated behind ER_SCENARIO=1, like every ER engine test):
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-engine.test.ts
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-multiwave.test.ts
//
// (Windows PowerShell: `$env:ER_SCENARIO="1"; npx vitest run <path>`.) Both clients'
// coop:* + phase lines stream to dev-logs/coop-duo/<run>/{host,guest}.log (gitignored)
// for post-mortem eyeballing; the harness flushes them even when a test fails.
//
// -----------------------------------------------------------------------------
// WHAT THE MULTI-WAVE HARNESS ADDS over the spike (coop-duo-multiwave.test.ts):
//   - buildDuo + remirrorWave + driveGuestReplayTurn: a per-wave pump (host plays the wave to
//     a win + emits its turnResolution/checkpoint; the guest replays it + applies the
//     checkpoint), re-mirroring the host's freshly-rolled next-wave battle onto the guest each
//     wave (the spike's mirror, applied per wave) so a >=3-wave run runs end-to-end.
//   - driveHostRewardShopOwner (OWNER) + driveGuestRewardWatch (WATCHER): the host opens its
//     REAL SelectModifierPhase, takes a reward, leaves; the guest runs its REAL startCoopWatch
//     loop, adopts the owner's relayed picks over the loopback, and leaves - both ending on the
//     SAME interaction counter (no hang, no resync storm). The owner/watcher ROLES ALTERNATE by
//     the interaction-counter parity (even = host owns, odd = guest owns), so the test drives
//     either client as owner. Sequential (owner-then-watcher) because the relay FIFO-buffers the
//     owner's picks - a cross-ctx await continuation can't run against the wrong globalScene.
//   - driveGuestTmCaseRegression: the #698 TM-Case continuation-orphan reproduction over the real
//     guest engine (the side that softlocked) + a real relayed pick over the loopback.
//   - forceNextMysteryEncounter / forceItemRewards: thin knobs over the override helpers so a
//     repro can FORCE a MysteryEncounterType or a chosen reward (e.g. a TM Case) on purpose.
//
// HOW TO ADD A NEW CO-OP REPRO WITH THIS HARNESS (3-line recipe):
//   1. In a fresh `it(...)`, boot the host (game.classicMode.startBattle) + buildDuo() to stand
//      up the guest engine + both runtimes over one loopback pair (host owns even interaction
//      counters, guest owns odd). Stage with forceItemRewards([...]) / forceNextMysteryEncounter.
//   2. Per wave: hostPlayWave (move.select both slots -> TurnEndPhase) -> driveGuestReplayTurn ->
//      driveHostRewardShopOwner + driveGuestRewardWatch (picking owner/watcher by counter parity)
//      -> phaseInterceptor.to("CommandPhase") for the host's next wave; remirrorWave before each.
//   3. Assert convergence (guest enemies fainted / counters equal / resyncs bounded) and that BOTH
//      reach the next wave; a no-progress stall THROWS (driveGuestReplayTurn) so a regression hangs loudly.
// =============================================================================

import { Battle } from "#app/battle";
import { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import {
  assembleCoopRuntime,
  type CoopRuntime,
  getCoopRuntime,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { resetErGhostRunState } from "#data/elite-redux/er-ghost-teams";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { EnemyPokemon, PlayerPokemon, type Pokemon } from "#field/pokemon";
import type { ModifierOverride } from "#modifiers/modifier-type";
import { PokemonModifierType } from "#modifiers/modifier-type";
import { PokemonData } from "#system/pokemon-data";
import type { GameManager } from "#test/framework/game-manager";
import type { GameWrapper } from "#test/framework/game-wrapper";
import { TextInterceptor } from "#test/framework/text-interceptor";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";

/**
 * The 4-part PROCESS-GLOBAL context that must be swapped atomically before pumping a
 * given client. Snapshotted per client; {@linkcode withClient} installs one + restores
 * the previous on exit so the two engines never read each other's globals.
 */
export interface ClientCtx {
  label: "host" | "guest";
  scene: BattleScene;
  runtime: CoopRuntime;
  /** Phaser.Math.RND.state() string for THIS client's last pump (process-global RNG cursor). */
  rndState: string;
  /** The er-ghost per-run cache for this client (save/restore around the swap). */
  ghost: ReturnType<typeof snapshotGhostState>;
}

// ---------------------------------------------------------------------------
// er-ghost per-run cache save/restore. clearCoopRuntime does NOT reset this; the only
// reset is resetErGhostRunState (which wipes it). We can't read the module lets directly
// (they aren't exported), so we partition by RESETTING to a clean slate per client - in
// the spike the opening wave is a wild battle that takes no ghost, so an empty cache for
// both clients is correct + benign. The snapshot type is a placeholder for the real
// save/restore the production harness would need at ghost waves.
// ---------------------------------------------------------------------------
function snapshotGhostState(): { reset: boolean } {
  // Reset to a clean per-client slate. Benign for the opening wild wave (no ghost taken).
  resetErGhostRunState();
  return { reset: true };
}

function restoreGhostState(_snap: { reset: boolean }): void {
  // Symmetric placeholder: re-clean so neither client inherits the other's ghost picks.
  resetErGhostRunState();
}

/** Capture the live process-global context (so withClient can restore it). */
function captureLiveCtx(): { scene: BattleScene; runtime: CoopRuntime | null; rndState: string } {
  return {
    scene: globalScene,
    runtime: getCoopRuntime(),
    rndState: Phaser.Math.RND.state(),
  };
}

/**
 * ATOMICALLY install `ctx`'s 4-part process-global context, run `fn`, then restore the
 * previous context. Re-entrant-safe (saves/restores around the body). The RND state is
 * the load-bearing one: the shared Phaser.Math.RND cursor would otherwise bleed between
 * the two engines and desync their rolls.
 */
/** The label of the client currently being pumped (so the log sink routes lines to its bucket). */
export let activeClientLabel: "host" | "guest" | "none" = "none";

/**
 * SYNCHRONOUS sibling of {@linkcode withClient}: install `ctx`'s 4-part process-global context, run a
 * SYNC `fn`, then restore the previous context - all before returning. Use this when the body is purely
 * synchronous and the previous context MUST be restored before the next statement (e.g. constructing a
 * guest-scene phase whose ctor reads globalScene - withClient's async finally would leave globalScene
 * pointed at the guest until the next microtask). Do NOT pass an async fn (its awaited work would run
 * after the restore); use {@linkcode withClient} for that.
 */
export function withClientSync<T>(ctx: ClientCtx, fn: () => T): T {
  const prev = captureLiveCtx();
  const prevLabel = activeClientLabel;
  activeClientLabel = ctx.label;
  initGlobalScene(ctx.scene);
  setCoopRuntime(ctx.runtime);
  Phaser.Math.RND.state(ctx.rndState);
  restoreGhostState(ctx.ghost);
  try {
    return fn();
  } finally {
    ctx.rndState = Phaser.Math.RND.state();
    initGlobalScene(prev.scene);
    if (prev.runtime != null) {
      setCoopRuntime(prev.runtime);
    }
    Phaser.Math.RND.state(prev.rndState);
    activeClientLabel = prevLabel;
  }
}

export async function withClient<T>(ctx: ClientCtx, fn: () => T | Promise<T>): Promise<T> {
  const prev = captureLiveCtx();
  const prevLabel = activeClientLabel;
  activeClientLabel = ctx.label;
  // 1. globalScene
  initGlobalScene(ctx.scene);
  // 2. coop active runtime (also installs the authoritative-guest predicate)
  setCoopRuntime(ctx.runtime);
  // 3. process-global RND cursor
  Phaser.Math.RND.state(ctx.rndState);
  // 4. er-ghost per-run cache
  restoreGhostState(ctx.ghost);
  try {
    return await fn();
  } finally {
    // Persist THIS client's mutated RND cursor back into its ctx, then restore the prev.
    ctx.rndState = Phaser.Math.RND.state();
    initGlobalScene(prev.scene);
    if (prev.runtime != null) {
      setCoopRuntime(prev.runtime);
    }
    Phaser.Math.RND.state(prev.rndState);
    activeClientLabel = prevLabel;
  }
}

// ---------------------------------------------------------------------------
// dev-log capture (gitignored). Both clients' coop:* console lines stream to
// dev-logs/coop-duo/<run>/{host,guest}.log for eyeballing.
// ---------------------------------------------------------------------------
export interface DuoLogs {
  dir: string;
  host: string[];
  guest: string[];
  /** Where the currently-pumping client's console lines are routed. */
  active: "host" | "guest" | "none";
  flush(): void;
  dispose(): void;
}

/**
 * Capture both clients' coop:* / phase console lines to dev-logs/ for eyeballing, WITHOUT
 * disturbing the test framework's {@linkcode MockConsole}. We wrap the LIVE `globalThis.console`
 * object's `log`/`warn` (which by the time we are called is the MockConsole instance the test
 * setup installed) and delegate to the original - so MockConsole's own formatting still runs and
 * we never break its construction-time `this.console = console` capture. Lines are routed to the
 * currently-pumping client's bucket (`logs.active`).
 *
 * IMPORTANT: call this AFTER `new GameManager(...)` so the MockConsole is already the global.
 */
export function installDuoLogCapture(runName: string): DuoLogs {
  const dir = path.resolve(process.cwd(), "dev-logs", "coop-duo", runName);
  fs.mkdirSync(dir, { recursive: true });
  // The live console (MockConsole instance under the test harness).
  const liveConsole = globalThis.console;
  const origLog = liveConsole.log.bind(liveConsole);
  const origWarn = liveConsole.warn.bind(liveConsole);
  const logs: DuoLogs = {
    dir,
    host: [],
    guest: [],
    active: "none",
    flush() {
      fs.writeFileSync(path.join(dir, "host.log"), this.host.join("\n"), "utf8");
      fs.writeFileSync(path.join(dir, "guest.log"), this.guest.join("\n"), "utf8");
    },
    dispose() {
      this.flush();
      liveConsole.log = origLog;
      liveConsole.warn = origWarn;
    },
  };
  const sink = (level: string, args: unknown[]) => {
    let line: string;
    try {
      line = `[${level}] ${args.map(a => (typeof a === "string" ? a : safeStr(a))).join(" ")}`;
    } catch {
      return;
    }
    const bucket = activeClientLabel === "guest" ? logs.guest : logs.host;
    if (/coop|\[coop|Start Phase|turnResolution|checkpoint|MISMATCH|desync/i.test(line)) {
      bucket.push(line);
    }
  };
  liveConsole.log = (...args: unknown[]) => {
    sink("log", args);
    return origLog(...args);
  };
  liveConsole.warn = (...args: unknown[]) => {
    sink("warn", args);
    return origWarn(...args);
  };
  return logs;
}

function safeStr(a: unknown): string {
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

// ---------------------------------------------------------------------------
// Engine construction.
// ---------------------------------------------------------------------------

/**
 * Build the GUEST {@linkcode BattleScene} DIRECTLY (NOT a 2nd GameManager - that reuses
 * globalScene). Reuses the host GameManager's {@linkcode GameWrapper} to inject the mock
 * factories WITHOUT going through the GameWrapper ctor (which re-sows Phaser.Math.RND.sow).
 * The new BattleScene ctor steals globalScene (last-write-wins) - the caller re-points it.
 */
export function buildGuestScene(hostGame: GameManager): BattleScene {
  const savedRnd = Phaser.Math.RND.state();
  const guestScene = new BattleScene(); // ctor calls initGlobalScene(this) - steals globalScene.
  // Re-run the SAME mock injection the host wrapper did, but on the guest scene, WITHOUT
  // re-seeding the RND (GameWrapper's ctor sow is the only re-seed; setScene/injectMandatory
  // does not sow). We call the private injectMandatory + preload + create via setScene.
  const wrapper: GameWrapper = hostGame.gameWrapper;
  const prevWrapperScene = wrapper.scene;
  // setScene runs injectMandatory(); it does NOT sow - safe. (sow only happens in the ctor.) It is
  // typed async (preload/create) but every step resolves synchronously under the headless mocks, so
  // the scene is fully built when this returns; the unawaited promise carries no pending work.
  // biome-ignore lint/complexity/noVoid: intentional fire-and-forget of a synchronously-resolving promise
  void wrapper.setScene(guestScene);
  wrapper.scene = prevWrapperScene;
  // Give the guest scene a TextInterceptor (sets scene.messageWrapper) so the replayed turn's
  // MessagePhase / showText path does not crash the headless guest.
  new TextInterceptor(guestScene);
  // Restore the RND cursor the ctor/injection may have touched.
  Phaser.Math.RND.state(savedRnd);
  // Make the guest scene's phase pump MANUAL (the cooperative scheduler drives it). Without
  // this, phase.end() -> shiftPhase() -> startCurrentPhase() would auto-run the whole queue.
  guestScene.phaseManager["startCurrentPhase"] = () => {
    /* inert: the cooperative scheduler calls phase.start() explicitly */
  };
  return guestScene;
}

/**
 * Bring the GUEST scene into the SAME live battle the host is in, by reconstructing the host's
 * field under the guest scene (PokemonData round-trip) + assembling a matching {@linkcode Battle}.
 * In production the guest reaches its battle through the full launch + `enemyPartySync` adopt; for
 * the spike we mirror the host's resolved field directly so the guest's REAL phase pipeline
 * (TurnStartPhase -> CoopReplayTurnPhase -> CoopFinalizeTurnPhase -> applyCoopCheckpoint) can run
 * against the host's streamed turns. MUST be called inside `withClient(guestCtx, ...)` so globalScene
 * is the guest scene (PokemonData.toPokemon / addPlayerPokemon build under the live globalScene).
 *
 * Returns nothing; mutates the guest scene's party / currentBattle / arena / field.
 */
export function mirrorHostBattleToGuest(hostScene: BattleScene, guestScene: BattleScene): void {
  // 1. Same game mode + arena/biome as the host.
  guestScene.gameMode = hostScene.gameMode;
  guestScene.newArena(hostScene.arena.biomeId);

  // `party` is private on BattleScene; the harness writes it through an unknown cast (test-only).
  const guestSceneInternal = guestScene as unknown as { party: PlayerPokemon[] };

  // 2. Rebuild the player party under the guest scene from the host's PokemonData. We construct the
  //    mon DIRECTLY (not scene.addPlayerPokemon, whose init() builds the battle-info UI / sprites the
  //    headless guest scene can't fully back) - the ctor does the logical build; we skip init().
  guestSceneInternal.party = [];
  for (const hostMon of hostScene.getPlayerParty()) {
    const data = new PokemonData(hostMon);
    const mon = new PlayerPokemon(
      getPokemonSpecies(hostMon.species.speciesId),
      hostMon.level,
      hostMon.abilityIndex,
      hostMon.formIndex,
      hostMon.gender,
      hostMon.shiny,
      hostMon.variant,
      hostMon.ivs,
      hostMon.nature,
      data,
    );
    mon.coopOwner = hostMon.coopOwner ?? "host";
    mon.calculateStats();
    guestSceneInternal.party.push(mon);
  }

  // 3. Assemble a matching Battle with the enemy party rebuilt under the guest scene.
  const hostBattle = hostScene.currentBattle;
  guestScene.currentBattle = new Battle(hostScene.gameMode, {
    waveIndex: hostBattle.waveIndex,
    battleType: hostBattle.battleType as never,
    trainer: hostBattle.trainer ?? undefined,
    double: hostBattle.double,
  });
  guestScene.currentBattle.turn = hostBattle.turn;
  const enemyParty: EnemyPokemon[] = [];
  for (const hostEnemy of hostScene.getEnemyParty()) {
    const data = new PokemonData(hostEnemy);
    const enemy = new EnemyPokemon(
      getPokemonSpecies(hostEnemy.species.speciesId),
      hostEnemy.level,
      TrainerSlot.NONE,
      false,
      false,
      data,
    );
    // coopOwner lives on PlayerPokemon in the types but is set per-mon at runtime; write via cast.
    (enemy as unknown as { coopOwner?: string | undefined }).coopOwner = (
      hostEnemy as unknown as { coopOwner?: string | undefined }
    ).coopOwner;
    enemyParty.push(enemy);
  }
  guestScene.currentBattle.enemyParty = enemyParty;
  guestScene.currentBattle.double = hostBattle.double;

  // 4. Put both leads of each side ON the guest field (isActive() reads field membership via
  //    globalScene.field.getIndex). The Pokemon is itself a Phaser Container, so field.add works.
  //    Give each a no-op battleInfo stub (we skipped init(), so the real one was never built) - the
  //    checkpoint apply / updateInfo paths touch it, and headless they need no real UI.
  for (const mon of [...guestSceneInternal.party, ...enemyParty]) {
    stubBattleInfo(mon);
  }
  for (const mon of [...guestScene.getPlayerField(), ...guestScene.getEnemyField()]) {
    guestScene.field.add(mon);
  }
  // The mons were cloned from the host's via a PokemonData round-trip, so their hp / status / stats /
  // moves already match the host exactly. The first replayed turn's CoopFinalizeTurnPhase checkpoint
  // re-asserts the host's authoritative end-of-turn state on top, so no pre-turn full resync is needed
  // (and applyCoopFullSnapshot's updateModifiers UI work would crash the stubbed headless guest mons).
}

/** Minimal no-op battleInfo so the headless guest mon's updateInfo/initBattleInfo calls don't crash. */
function stubBattleInfo(mon: Pokemon): void {
  // The real PlayerBattleInfo/EnemyBattleInfo was never built (we skipped init()); a tiny async-resolving
  // stub satisfies updateInfo / setHpNumbers / initInfo / setMini etc. on the headless render path.
  const noop = () => Promise.resolve();
  const handler = {
    get(_t: object, _p: string | symbol) {
      return noop;
    },
  };
  (mon as unknown as { battleInfo: unknown }).battleInfo = new Proxy({}, handler);
}

/**
 * Build a CoopRuntime for one loopback endpoint (host or guest) via the production wiring, WITHOUT
 * tearing down any other live session. Uses {@linkcode assembleCoopRuntime} (the additive seam) so
 * standing up the SECOND client does NOT close the FIRST's loopback transport (connectCoopSession's
 * leading clearCoopRuntime would). The caller registers the live one with setCoopRuntime per pump and
 * drives connect() once on each.
 */
export function buildRuntime(endpoint: CoopTransport, username: string, netcodeMode: "authoritative"): CoopRuntime {
  return assembleCoopRuntime(endpoint, { username, netcodeMode });
}

// ---------------------------------------------------------------------------
// Cooperative scheduler.
// ---------------------------------------------------------------------------

/** Drain the loopback microtask queue (LoopbackTransport delivers on queueMicrotask). */
export async function drainLoopback(): Promise<void> {
  // A few macrotask hops flush nested microtask -> microtask deliveries deterministically.
  for (let i = 0; i < 4; i++) {
    await new Promise<void>(r => setTimeout(r, 0));
  }
}

export type { Pokemon };

// =============================================================================
// MULTI-WAVE EXTENSION (#633). Standing up BOTH runtimes + the guest engine once, then a
// per-wave pump that re-mirrors the host's freshly-rolled battle onto the guest each wave
// (the spike mirrored only wave 1), plus a REAL owner/watcher reward-shop drive over the
// loopback. Everything below builds on the spike primitives above (withClient / drainLoopback
// / mirrorHostBattleToGuest / buildGuestScene / buildRuntime) - it does NOT rewrite them.
// =============================================================================

/** The standing two-engine rig: both runtimes assembled over ONE loopback pair, both ctxs ready. */
export interface DuoRig {
  hostScene: BattleScene;
  guestScene: BattleScene;
  hostRuntime: CoopRuntime;
  guestRuntime: CoopRuntime;
  hostCtx: ClientCtx;
  guestCtx: ClientCtx;
  /** The loopback pair both runtimes ride (raw endpoints exposed for assertion taps). */
  pair: { host: CoopTransport; guest: CoopTransport };
}

/**
 * Stand up the full two-engine rig over ONE {@linkcode createLoopbackPair}: assemble BOTH runtimes
 * (via {@linkcode assembleCoopRuntime}, so neither close the other's transport), build the GUEST
 * {@linkcode BattleScene}, mirror the host's CURRENT battle onto it, tag co-op field ownership on
 * both, connect both controllers, and drain the handshake. After this the host OWNS even interaction
 * counters (the first reward shop, counter 0) and the guest OWNS odd ones - the production parity rule.
 *
 * MUST be called with the HOST GameManager already in a live battle (game.classicMode.startBattle).
 * Returns the {@linkcode DuoRig}; the caller pumps it wave by wave with the drive* helpers below.
 */
export async function buildDuo(
  hostGame: GameManager,
  pair: { host: CoopTransport; guest: CoopTransport },
  setCoopRuntimeFn: (r: CoopRuntime) => void,
  toCoopGameMode: (scene: BattleScene) => void,
): Promise<DuoRig> {
  const hostScene = hostGame.scene;
  const hostRuntime = buildRuntime(pair.host, "Host", "authoritative");
  const guestRuntime = buildRuntime(pair.guest, "Guest", "authoritative");
  hostRuntime.controller.role = "host";
  guestRuntime.controller.role = "guest";

  // Flip the host engine into co-op + tag the field leads host/guest.
  toCoopGameMode(hostScene);
  const hostField = hostScene.getPlayerField();
  hostField[0].coopOwner = "host";
  hostField[1].coopOwner = "guest";

  const hostCtx: ClientCtx = {
    label: "host",
    scene: hostScene,
    runtime: hostRuntime,
    rndState: Phaser.Math.RND.state(),
    ghost: { reset: true },
  };

  // The 2nd real BattleScene (steals globalScene; withClient re-points it per pump).
  const guestScene = buildGuestScene(hostGame);
  const guestCtx: ClientCtx = {
    label: "guest",
    scene: guestScene,
    runtime: guestRuntime,
    rndState: Phaser.Math.RND.state(),
    ghost: { reset: true },
  };
  await withClient(guestCtx, () => {
    toCoopGameMode(guestScene);
    mirrorHostBattleToGuest(hostScene, guestScene);
    const gf = guestScene.getPlayerField();
    gf[0].coopOwner = "host";
    gf[1].coopOwner = "guest";
  });

  // Connect both controllers over the live loopback (exchange hello / runConfig).
  setCoopRuntimeFn(hostRuntime);
  hostRuntime.controller.connect();
  setCoopRuntimeFn(guestRuntime);
  guestRuntime.controller.connect();
  await drainLoopback();

  return { hostScene, guestScene, hostRuntime, guestRuntime, hostCtx, guestCtx, pair };
}

/**
 * Re-mirror the host's CURRENT (freshly-rolled, post-shop) battle onto the guest scene for the next
 * wave. In production the guest reaches wave N+1 through its own NewBattlePhase -> EncounterPhase ->
 * adoptCoopHostEnemyParty; the duo harness instead re-applies {@linkcode mirrorHostBattleToGuest}
 * per wave (the spike's wave-1 technique, looped) so the guest's REAL replay pipeline runs against
 * each wave's host-authoritative field without driving the full launch handshake. Runs inside
 * withClient(guestCtx) so globalScene is the guest while the clone is built.
 */
export async function remirrorWave(rig: DuoRig): Promise<void> {
  await withClient(rig.guestCtx, () => {
    mirrorHostBattleToGuest(rig.hostScene, rig.guestScene);
    const gf = rig.guestScene.getPlayerField();
    gf[0].coopOwner = "host";
    gf[1].coopOwner = "guest";
  });
}

// ---------------------------------------------------------------------------
// Guest replay pump (the spike's driveGuestReplayTurn, promoted to the harness so the
// multi-wave loop can reuse it). Starts a real CoopReplayTurnPhase + drains the presentation
// phases it unshifts PLUS the deferred CoopFinalizeTurnPhase (applies the host checkpoint,
// verifies the checksum, queues the turn-end + wave-advance tail). THROWS on a no-progress
// stall so a regression fails loudly with both clients' logs already captured.
// ---------------------------------------------------------------------------

/** The presentation phases CoopReplayTurnPhase unshifts + the deferred finalize, drained each turn. */
const REPLAY_DRAIN_PHASES = new Set([
  "MessagePhase",
  "CoopMoveAnimReplayPhase",
  "CoopHpDrainReplayPhase",
  "CoopStatStageReplayPhase",
  "CoopStatusReplayPhase",
  "CoopFaintReplayPhase",
  "CoopFinalizeTurnPhase",
]);

/** Minimal phase-manager surface the guest replay pump needs (the guest scene satisfies it). */
interface ReplayPumpScene {
  phaseManager: { create: (n: "CoopReplayTurnPhase", t: number) => Phase; getCurrentPhase(): Phase };
}

/**
 * Start a guest {@linkcode CoopReplayTurnPhase} for `turn` and drain the presentation phases it
 * unshifts PLUS the deferred {@linkcode CoopFinalizeTurnPhase}. MUST be called inside
 * withClient(guestCtx, ...). Throws on a >16-iter no-progress stall (the hang-detection the duo
 * harness exists to surface). Returns when the finalize has run (checkpoint applied, tail queued).
 */
export async function driveGuestReplayTurn(guestScene: ReplayPumpScene, turn: number): Promise<void> {
  const replay = guestScene.phaseManager.create("CoopReplayTurnPhase", turn);
  replay.start();
  await drainLoopback();
  let lastName = "";
  let stall = 0;
  for (let i = 0; i < 64; i++) {
    const cur = guestScene.phaseManager.getCurrentPhase();
    if (cur == null || !REPLAY_DRAIN_PHASES.has(cur.phaseName)) {
      return;
    }
    if (cur.phaseName === lastName) {
      if (++stall > 16) {
        throw new Error(`guest replay HANG: stuck on ${cur.phaseName} - see dev-logs/coop-duo/`);
      }
    } else {
      stall = 0;
    }
    lastName = cur.phaseName;
    const wasFinalize = cur.phaseName === "CoopFinalizeTurnPhase";
    cur.start();
    await drainLoopback();
    if (wasFinalize) {
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Host reward-shop OWNER drive + guest WATCHER drive (real SelectModifierPhase, real
// CoopInteractionRelay over the loopback). At interaction counter 0 the HOST owns the
// shop and the GUEST watches (the production parity rule); buildDuo wires that. The owner
// streams its rolled option list + relays each pick; the watcher adopts the list and
// replays the picks against its identical pool. We drive the phases' REAL public/logical
// methods directly (the headless guest scene has no human picker) - the RELAY path is
// fully real, exactly the channel that softlocked the TM-Case shop in the field.
// ---------------------------------------------------------------------------

/** The private SelectModifierPhase seam the harness drives (mirrors the phase's own members). */
export interface ShopPhaseSeam {
  phaseName: string;
  start(): boolean | undefined;
  end(): void;
  coopWatcher: boolean;
  coopInteractionStart: number;
  typeOptions: unknown[];
  selectRewardModifierOption(cursor: number, cb: () => boolean): boolean;
  coopRelaySend(choice: number, data: number[] | undefined, label: string): void;
  coopEndMirror(): void;
  coopAdvanceInteraction(): void;
}

/**
 * Drive the HOST's REAL owner reward shop for one interaction: start the phase (it streams its rolled
 * option list to the watcher + opens the owner screen), TAKE reward index 0 (a free reward; relayed),
 * then LEAVE (the terminal that advances the alternating-interaction counter). MUST be called inside
 * withClient(hostCtx). `phase` is the host's live SelectModifierPhase (from the phase queue) or a fresh
 * one; the relay sends ride the loopback to the guest watcher. Returns the interaction counter the shop
 * was pinned to (for the convergence assert).
 */
export async function driveHostRewardShopOwner(
  hostPhase: ShopPhaseSeam,
  opts: { takeReward?: boolean } = {},
): Promise<number> {
  // start() resolves owner/watcher from the pinned counter, streams the rolled options to the watcher,
  // and opens the owner screen (the prompt handler would drive the UI; here we drive the logic directly).
  hostPhase.start();
  await drainLoopback();
  const pinned = hostPhase.coopInteractionStart;
  const noop = () => false;
  let tookTerminalReward = false;
  if (opts.takeReward) {
    // Find the first NON-party reward (a PokemonModifierType opens a party menu the headless autopilot
    // can't drive; a non-party item resolves immediately, relaying a REWARD pick + applying it). The
    // caller forces a deterministic non-party reward (e.g. a LURE) via forceItemRewards.
    const idx = (hostPhase.typeOptions as { type?: unknown }[]).findIndex(
      o => !(o?.type instanceof PokemonModifierType),
    );
    if (idx >= 0) {
      // A free, non-continuation reward is ITSELF terminal: its applyModifier calls super.end() +
      // coopAdvanceInteraction(). So after taking it the shop has already left + advanced - we must NOT
      // issue a second leave (that would double-end + consume the post-shop NewBattlePhase off the queue).
      hostPhase.selectRewardModifierOption(idx, noop);
      tookTerminalReward = true;
      await drainLoopback();
    }
  }
  if (!tookTerminalReward) {
    // LEAVE: relay the skip + advance the interaction counter (the watcher mirrors this terminal).
    hostPhase.coopEndMirror();
    hostPhase.coopRelaySend(/* COOP_INTERACTION_LEAVE */ -1, undefined, "skip");
    hostPhase.end();
    hostPhase.coopAdvanceInteraction();
  }
  await drainLoopback();
  return pinned;
}

/**
 * Drive the GUEST's REAL watcher reward shop: start the phase (it detects watcher from the pinned
 * counter+role, adopts the owner's streamed option list, and runs startCoopWatch's relay loop),
 * draining the loopback so the relayed owner picks + the terminal LEAVE arrive and are applied.
 * MUST be called inside withClient(guestCtx). Throws on a no-progress stall (the watcher should
 * always converge + leave once the owner's terminal arrives). Returns when the watcher has left.
 */
export async function driveGuestRewardWatch(guestPhase: ShopPhaseSeam): Promise<void> {
  // start() (watcher branch) is async-ish: it awaits the owner's options, opens the cosmetic screen,
  // then loops on awaitInteractionChoice. We kick it off, then drain the loopback repeatedly so each
  // buffered/relayed owner pick is delivered + applied until the LEAVE terminal ends the phase.
  guestPhase.start();
  for (let i = 0; i < 32; i++) {
    await drainLoopback();
    // The watcher leaves by calling end() -> the harness's inert startCurrentPhase keeps the queue
    // put; we detect "left" by the phase no longer being the current phase. The relay loop resolves
    // its awaits as the owner's choices + terminal arrive over the drained loopback.
    if (!(guestPhase as unknown as { coopWatcher: boolean }).coopWatcher) {
      // start() short-circuited (no controller/relay) - it already left.
      return;
    }
  }
}

/**
 * REGRESSION DRIVER (#698 TM-Case orphan): drive the GUEST's REAL watcher shop through a relayed
 * TM_CASE reward pick end-to-end and return its phase-queue observations, so a test can assert the
 * guest's continuation SelectModifierPhase copy is REMOVED (it would have ORPHANED + hung pre-#698).
 *
 * The host owner's party-target menu can't be driven headlessly, so the owner's REWARD pick (the
 * resolved party slot + TM move index) is RELAYED directly over the real loopback - the GUEST side
 * (the side that softlocked) is fully real: it applies the relayed pick against its identical pool,
 * which queues a continuation copy + a no-op guest LearnMovePhase; driving that LearnMovePhase must
 * remove the continuation copy (the host's real learnMove() does on the host). MUST be called inside
 * withClient(guestCtx). `ownerEnd` is the OWNER (host) transport endpoint that relays the pick.
 *
 * Returns: { continuationRemoved } - whether tryRemovePhase("SelectModifierPhase") removed the copy.
 */
export async function driveGuestTmCaseRegression(
  guestPhase: ShopPhaseSeam,
  ownerEnd: CoopTransport,
  pick: { slot: number; moveIndex: number },
): Promise<{ queuedContinuation: boolean; queuedLearnMove: boolean; continuationRemoved: boolean }> {
  const gs = globalScene;
  // Track the guest phase queue: did the watcher's apply queue a continuation copy + a LearnMovePhase,
  // and did the LearnMovePhase then remove the copy. We spy unshiftPhase (continuation copy) +
  // tryRemovePhase (the orphan removal) on the LIVE guest phaseManager.
  const queued: string[] = [];
  const removed: string[] = [];
  const pm = gs.phaseManager as unknown as {
    unshiftPhase(p: { phaseName?: string }): void;
    tryRemovePhase(n: string): boolean;
  };
  const origUnshift = pm.unshiftPhase.bind(pm);
  const origTryRemove = pm.tryRemovePhase.bind(pm);
  pm.unshiftPhase = (p: { phaseName?: string }) => {
    queued.push(p?.phaseName ?? "?");
    return origUnshift(p);
  };
  pm.tryRemovePhase = (n: string) => {
    removed.push(n);
    return origTryRemove(n);
  };
  try {
    // Start the watcher (adopts the owner's options - the caller pre-buffered them), then relay the
    // TM_CASE REWARD pick: data = [COOP_ACT_REWARD=0, slot, moveIndex]. The watcher applies it directly.
    guestPhase.start();
    await drainLoopback();
    ownerEnd.send({
      t: "interactionChoice",
      seq: guestPhase.coopInteractionStart,
      kind: "reward",
      choice: 0,
      data: [0 /* COOP_ACT_REWARD */, pick.slot, pick.moveIndex],
    });
    // Drain so the watcher receives + applies the pick (queues continuation copy + LearnMovePhase).
    for (let i = 0; i < 16; i++) {
      await drainLoopback();
      if (queued.includes("LearnMovePhase")) {
        break;
      }
    }
    // Drive the queued no-op guest LearnMovePhase: it must tryRemovePhase("SelectModifierPhase").
    const cur = gs.phaseManager.getCurrentPhase();
    if (cur?.phaseName === "LearnMovePhase") {
      cur.start();
      await drainLoopback();
    }
  } finally {
    pm.unshiftPhase = origUnshift;
    pm.tryRemovePhase = origTryRemove;
  }
  return {
    queuedContinuation: queued.includes("SelectModifierPhase"),
    queuedLearnMove: queued.includes("LearnMovePhase"),
    continuationRemoved: removed.includes("SelectModifierPhase"),
  };
}

// ---------------------------------------------------------------------------
// Forcing knobs: thin wrappers over the test override helpers so a repro can FORCE the next
// encounter to a chosen MysteryEncounterType, or FORCE a reward (e.g. a TM Case) into the shop,
// to exercise interaction-alternation + watcher mirroring on purpose. These set the SAME
// Overrides the override-helper sets; both engines read them, so neither client diverges.
// ---------------------------------------------------------------------------

/** The override-helper surface these knobs use (the host GameManager's `override`, structurally). */
export interface OverrideKnobs {
  mysteryEncounter(type: MysteryEncounterType): unknown;
  itemRewards(items: ModifierOverride[]): unknown;
}

/** FORCE the next wave to roll the given MysteryEncounterType on BOTH engines (override-backed). */
export function forceNextMysteryEncounter(override: OverrideKnobs, type: MysteryEncounterType): void {
  override.mysteryEncounter(type);
}

/** FORCE the reward shop to offer the given modifier(s) (e.g. a TM Case) on BOTH engines. */
export function forceItemRewards(override: OverrideKnobs, items: ModifierOverride[]): void {
  override.itemRewards(items);
}
