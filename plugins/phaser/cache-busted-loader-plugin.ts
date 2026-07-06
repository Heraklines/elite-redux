import { globalManifest } from "#app/global-manifest";
import { coerceArray } from "#utils/array";
import { getCachedUrl } from "#utils/fetch-utils";

/**
 * Keys whose load-error retry is owned by a DEDICATED mechanism elsewhere (the
 * pokemon battle atlases handled by `BattleScene.installErAtlasRetry`). The
 * generic retry below skips these so the two mechanisms never double-issue a
 * retry for the same key. `battle-scene.ts` registers each pokemon-atlas key
 * here as it loads it. See the "unification" note at the bottom of this file.
 */
export const dedicatedRetryKeys = new Set<string>();

/** Number of automatic retries per key before it is declared permanently failed. */
const MAX_RETRIES = 2;

/** The er-assets repo the deploy serves every custom asset from (see `deploy/cloudflare/_redirects`). */
const ASSET_REPO = "Heraklines/er-assets";

/**
 * jsDelivr's Fastly-only edge (a DIFFERENT CDN network than the multi-CDN
 * `cdn.jsdelivr.net`). Used unpinned only as a last resort when the exact pin
 * could not be discovered from an already-loaded asset (see `discoverPinnedBase`).
 */
const UNPINNED_FASTLY_BASE = `https://fastly.jsdelivr.net/gh/${ASSET_REPO}`;

/**
 * Relative asset paths the deploy 302-redirects to jsDelivr (see
 * `deploy/cloudflare/_redirects`). Only these are worth rewriting to the Fastly
 * edge on the final retry; anything else keeps the plain cache-buster retry.
 */
const CDN_PATH_RE = /^\/?(images|audio|battle-anims|battle-anims-er|fonts)\//;

/** Everything needed to RE-ISSUE a load as the correct file type after an error. */
type LoadRecord =
  | { kind: "image"; key: string; url: string }
  | { kind: "spritesheet"; key: string; url: string; frameConfig: Phaser.Types.Loader.FileTypes.ImageFrameConfig }
  | { kind: "audio"; key: string; url: string }
  | { kind: "atlas"; key: string; pngUrl: string; jsonUrl: string }
  | { kind: "json"; key: string; url: string };

function primaryUrl(record: LoadRecord): string {
  return record.kind === "atlas" ? record.pngUrl : record.url;
}

/**
 * Rewrites every asset URL through the cached manifest (`getCachedUrl`) AND adds
 * client-side resilience for a load that FAILS.
 *
 * Why: a jsDelivr per-SHA pin is cold right after a deploy, and a jsDelivr edge
 * can cache a failure regionally; Phaser's own retry re-requests the SAME URL, so
 * a failed atlas never recovers and the game silently runs on the `__MISSING`
 * placeholder for every icon (#844). On a `FILE_LOAD_ERROR` this re-issues the
 * WHOLE load (correctly handling atlas MultiFiles) up to {@link MAX_RETRIES}
 * times:
 *   1. a unique cache-buster query param (busts a poisoned BROWSER/SW cache;
 *      jsDelivr ignores query strings for its own cache, which is fine - the
 *      param only needs to bust the browser cache),
 *   2. additionally the Fastly edge host (a DIFFERENT CDN network, bypassing a
 *      regionally poisoned jsDelivr edge).
 * A file that still fails after both retries logs a single loud marker so it
 * lands in the bug-report console ring buffer instead of failing silently.
 *
 * The happy path is unchanged: the only added work per file is the small
 * bookkeeping in {@link recordFile}; no retry code runs unless a load errors.
 */
export class CacheBustedLoaderPlugin extends Phaser.Loader.LoaderPlugin {
  /** key -> how to re-issue its load (populated at `addFile` time). */
  private readonly retryRecords = new Map<string, LoadRecord>();
  /** key -> number of retries already issued (reset when the key is freshly re-added). */
  private readonly retryCount = new Map<string, number>();
  /** Which retry round a re-issued file belongs to, so duplicate sub-file errors from a superseded round are ignored. */
  private readonly fileRetryRound = new WeakMap<Phaser.Loader.File, number>();
  /** Keys already logged as permanently failed (so the loud marker prints once). */
  private readonly permanentlyFailed = new Set<string>();
  /** Set while WE re-issue a load, so `addFile` tags the round and skips rewrite/bookkeeping. */
  private pendingRetryRound: number | undefined;
  /** The pinned Fastly base (`https://fastly.jsdelivr.net/gh/<repo>@<sha>`) once discovered from a loaded asset. */
  private pinnedFastlyBase?: string;

  constructor(scene: Phaser.Scene) {
    super(scene);
    this.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.handleFileLoadError, this);
  }

  override addFile(files: Phaser.Loader.File | Phaser.Loader.File[]): void {
    const list = coerceArray(files);

    // Files re-issued by our own retry: the URL is already final (cache-buster /
    // Fastly host baked in), so do NOT rewrite it or re-record - just tag which
    // retry round each file belongs to.
    if (this.pendingRetryRound !== undefined) {
      for (const item of list) {
        this.fileRetryRound.set(item, this.pendingRetryRound);
      }
      super.addFile(list);
      return;
    }

    const manifest = globalManifest;
    if (manifest) {
      for (const item of list) {
        if (typeof item.url === "string") {
          item.url = getCachedUrl(item.url.replace(/\/\//g, "/"));
        }
      }
    }

    // Record AFTER the rewrite so an atlas captures both sub-file URLs post-rewrite.
    for (const item of list) {
      this.recordFile(item);
    }

    super.addFile(list);
  }

  /** Remember how to re-issue this file's load if it later errors. */
  private recordFile(file: Phaser.Loader.File): void {
    const key = file.key;
    if (dedicatedRetryKeys.has(key)) {
      return; // owned by BattleScene.installErAtlasRetry (pokemon battle atlases)
    }

    const mf = file.multiFile;
    if (mf && mf.type === "atlasjson") {
      if (this.retryRecords.has(key)) {
        return; // already recorded from the atlas's first sub-file
      }
      const png = mf.files.find(f => f.type === "image")?.url;
      const json = mf.files.find(f => f.type === "json")?.url;
      if (typeof png === "string" && typeof json === "string") {
        this.retryRecords.set(key, { kind: "atlas", key, pngUrl: png, jsonUrl: json });
        this.resetRetryState(key);
      }
      return;
    }

    if (typeof file.url !== "string") {
      return;
    }

    switch (file.type) {
      case "image":
        this.retryRecords.set(key, { kind: "image", key, url: file.url });
        break;
      case "spritesheet":
        this.retryRecords.set(key, { kind: "spritesheet", key, url: file.url, frameConfig: file.config });
        break;
      case "audio":
        this.retryRecords.set(key, { kind: "audio", key, url: file.url });
        break;
      case "json":
        this.retryRecords.set(key, { kind: "json", key, url: file.url });
        break;
      default:
        return; // other file types keep Phaser's default handling
    }
    this.resetRetryState(key);
  }

  /** A fresh (non-retry) load request for a key wipes any prior retry/permanent state. */
  private resetRetryState(key: string): void {
    this.retryCount.delete(key);
    this.permanentlyFailed.delete(key);
  }

  private handleFileLoadError(file: Phaser.Loader.File): void {
    const key = file.key;
    const record = this.retryRecords.get(key);
    if (!record) {
      return; // untracked: dedicated-retry pokemon atlas, non-string URL, or unsupported type
    }

    // A texture-backed key that already exists means an EXISTING asset is fine and
    // this was a redundant re-request that errored - don't churn (mirrors the
    // pokemon-atlas retry's guard).
    if (
      (record.kind === "atlas" || record.kind === "image" || record.kind === "spritesheet")
      && this.textureManager.exists(key)
    ) {
      return;
    }

    const round = this.fileRetryRound.get(file) ?? 0;
    const issued = this.retryCount.get(key) ?? 0;

    // A stale duplicate error from a round we already superseded - e.g. an atlas's
    // json sub-file erroring after we already re-issued on the png sub-file. The
    // whole atlas is re-issued once per round, so ignore the second sub-file.
    if (round < issued) {
      return;
    }

    if (issued >= MAX_RETRIES) {
      if (!this.permanentlyFailed.has(key)) {
        this.permanentlyFailed.add(key);
        console.error(`[asset-retry] PERMANENT load failure key=${key} url=${primaryUrl(record)}`);
      }
      return;
    }

    const nextRound = issued + 1;
    this.retryCount.set(key, nextRound);
    const useFastly = nextRound >= MAX_RETRIES;
    console.warn(
      `[asset-retry] load error key=${key} - retry ${nextRound}/${MAX_RETRIES}`
        + (useFastly ? " via fastly mirror + cache-buster" : " with cache-buster"),
    );
    this.reissue(record, nextRound, useFastly);

    // Re-adding files after the loader drained restarts the pass; without this the
    // COMPLETE event would already have fired and the retry would never load.
    if (!this.isLoading()) {
      this.start();
    }
  }

  private reissue(record: LoadRecord, round: number, useFastly: boolean): void {
    const t = (url: string): string => this.buildRetryUrl(url, useFastly);
    this.pendingRetryRound = round;
    try {
      switch (record.kind) {
        case "atlas":
          this.atlas(record.key, t(record.pngUrl), t(record.jsonUrl));
          break;
        case "image":
          this.image(record.key, t(record.url));
          break;
        case "spritesheet":
          this.spritesheet(record.key, t(record.url), record.frameConfig);
          break;
        case "audio":
          this.audio(record.key, t(record.url));
          break;
        case "json":
          this.json(record.key, t(record.url));
          break;
      }
    } finally {
      this.pendingRetryRound = undefined;
    }
  }

  private buildRetryUrl(url: string, useFastly: boolean): string {
    let out = url;
    if (useFastly) {
      const fastly = this.toFastly(url);
      if (fastly) {
        out = fastly;
      }
    }
    const sep = out.includes("?") ? "&" : "?";
    return `${out}${sep}cb=${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }

  /**
   * Rewrite an asset URL to hit jsDelivr's Fastly edge directly. Relative asset
   * paths would normally be 302'd to `cdn.jsdelivr.net` by `_redirects`; going
   * straight to the Fastly host bypasses a regionally poisoned cdn edge. Returns
   * `undefined` for paths that are not CDN-served (keep the cache-buster retry).
   */
  private toFastly(url: string): string | undefined {
    if (/jsdelivr\.net/i.test(url)) {
      // Already an absolute jsDelivr URL (defensive): just swap the edge host.
      return url.replace(/\/\/[a-z0-9.-]*jsdelivr\.net/i, "//fastly.jsdelivr.net");
    }
    if (!CDN_PATH_RE.test(url)) {
      return;
    }
    const base = this.discoverPinnedBase() ?? UNPINNED_FASTLY_BASE;
    return `${base}/${url.replace(/^\//, "")}`;
  }

  /**
   * Learn the exact pinned jsDelivr base (repo@sha) from an asset that ALREADY
   * loaded successfully, then rebase it onto the Fastly host. This keeps the
   * Fastly retry on the SAME immutable pin the deploy chose. Zero happy-path cost
   * (only scanned on the rare final retry); falls back to the unpinned base if no
   * jsDelivr-sourced texture is loaded yet.
   */
  private discoverPinnedBase(): string | undefined {
    if (this.pinnedFastlyBase) {
      return this.pinnedFastlyBase;
    }
    const list = this.textureManager.list;
    for (const texKey of Object.keys(list)) {
      const source = list[texKey]?.source?.[0]?.source;
      if (!(source instanceof HTMLImageElement)) {
        continue;
      }
      const resolved = source.currentSrc || source.src;
      const match = /^(https?:\/\/[a-z0-9.-]*jsdelivr\.net\/gh\/[^/]+\/[^/@]+@[0-9a-f]+)\//i.exec(resolved);
      if (match) {
        this.pinnedFastlyBase = match[1].replace(/\/\/[a-z0-9.-]*jsdelivr\.net/i, "//fastly.jsdelivr.net");
        return this.pinnedFastlyBase;
      }
    }
    return;
  }
}

// Unification note (#844): pokemon BATTLE atlases (loaded via
// `BattleScene.loadPokemonAtlas`) keep their DEDICATED one-shot retry
// (`installErAtlasRetry`) rather than delegating to the generic mechanism above.
// That path is hot (every mon/variant/form summon) and delicately coupled - it
// pairs with per-key rebind eviction (`erAtlasPathByKey`, #421) and a
// `filecomplete-atlas-<key>` chroma-key hook for er__ sprites - so re-homing its
// retry risks destabilizing every in-battle sprite load for no functional gain
// (the generic retry would do the SAME whole-atlas re-issue). Instead the two are
// kept from double-firing by the `dedicatedRetryKeys` handshake: `loadPokemonAtlas`
// registers each key it owns, and `recordFile` skips those keys. The generic
// mechanism owns everything else - the LoadingScene UI/types/items/icon atlases,
// images, spritesheets, audio and bgm - which is exactly the #844 failure surface.
