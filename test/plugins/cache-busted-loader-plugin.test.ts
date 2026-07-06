import { CacheBustedLoaderPlugin, dedicatedRetryKeys } from "#plugins/cache-busted-loader-plugin";
import Phaser from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the generic client-side asset-load retry (#844). These construct
 * the REAL `CacheBustedLoaderPlugin` against a minimal fake scene, then simulate a
 * `FILE_LOAD_ERROR` and assert the re-enqueue sequence:
 *   round 1 -> same URL + cache-buster,
 *   round 2 -> Fastly edge host + cache-buster,
 *   final   -> a single loud `[asset-retry] PERMANENT` marker.
 */

function makeLoader(): CacheBustedLoaderPlugin {
  const events = new Phaser.Events.EventEmitter();
  const scene = {
    sys: {
      game: {
        config: { audio: {} },
        // Enough of Device.Audio for the `audio` file type to build a file.
        device: { audio: { webAudio: true, mp3: true, ogg: true, m4a: true } },
        sound: { context: {} },
        scene: {},
      },
      settings: { loader: {} },
      cache: {},
      textures: { exists: () => false, list: {} },
      events,
    },
  } as unknown as Phaser.Scene;
  const loader = new CacheBustedLoaderPlugin(scene);
  // Never actually kick off a real network load in a unit test.
  loader.isLoading = () => false;
  loader.start = vi.fn();
  return loader;
}

/** The most recently queued file for a key+type. */
function latestFile(loader: CacheBustedLoaderPlugin, key: string, type: string): Phaser.Loader.File {
  const file = loader.list
    .getArray()
    .filter(f => f.key === key && f.type === type)
    .at(-1);
  if (!file) {
    throw new Error(`no ${type} file queued for key ${key}`);
  }
  return file;
}

/**
 * Fail the latest queued file for key+type. Mirrors production: a file that errors
 * has ALREADY left `loader.list` (list -> inflight -> removed), so drop it before
 * emitting or Phaser's own key-conflict guard would block the re-issue.
 */
function failLatest(loader: CacheBustedLoaderPlugin, key: string, type: string): void {
  const file = latestFile(loader, key, type);
  loader.list.delete(file);
  loader.emit(Phaser.Loader.Events.FILE_LOAD_ERROR, file);
}

describe("CacheBustedLoaderPlugin - asset-load retry (#844)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries a failed ATLAS as a whole MultiFile: cache-buster, then Fastly host, then a loud permanent marker", () => {
    const loader = makeLoader();
    const atlasSpy = vi.spyOn(loader, "atlas");

    // Initial load (records the atlas as { png, json }).
    loader.atlas("types", "images/types.png", "images/types.json");
    expect(atlasSpy).toHaveBeenCalledTimes(1);

    // Round 1: the png sub-file 404s -> the WHOLE atlas is re-issued with a
    // cache-buster (SAME host, no Fastly yet).
    failLatest(loader, "types", "image");
    expect(atlasSpy).toHaveBeenCalledTimes(2);
    const [, png1, json1] = atlasSpy.mock.calls[1] as [string, string, string];
    expect(png1).toMatch(/^images\/types\.png\?.*cb=/);
    expect(json1).toMatch(/^images\/types\.json\?.*cb=/);
    expect(png1).not.toContain("jsdelivr.net");

    // A duplicate error for the JSON sub-file of the SAME (superseded) round must be
    // coalesced - it must NOT trigger another retry.
    const json0 = loader.list.getArray().find(f => f.key === "types" && f.type === "json");
    if (json0) {
      loader.emit(Phaser.Loader.Events.FILE_LOAD_ERROR, json0);
    }
    expect(atlasSpy).toHaveBeenCalledTimes(2);

    // Round 2: re-issued png fails again -> the whole atlas is re-issued on the
    // Fastly edge (a DIFFERENT CDN network) + a fresh cache-buster.
    failLatest(loader, "types", "image");
    expect(atlasSpy).toHaveBeenCalledTimes(3);
    const [, png2, json2] = atlasSpy.mock.calls[2] as [string, string, string];
    expect(png2).toContain("https://fastly.jsdelivr.net/gh/Heraklines/er-assets/images/types.png");
    expect(png2).toMatch(/cb=/);
    expect(json2).toContain("https://fastly.jsdelivr.net/gh/Heraklines/er-assets/images/types.json");

    // Final failure: no more retries, exactly one loud permanent marker.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    failLatest(loader, "types", "image");
    expect(atlasSpy).toHaveBeenCalledTimes(3); // no 4th re-issue
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(
      /^\[asset-retry\] PERMANENT load failure key=types url=images\/types\.png$/,
    );
  });

  it("retries a failed IMAGE with a cache-buster then the Fastly host", () => {
    const loader = makeLoader();
    const imageSpy = vi.spyOn(loader, "image");

    loader.image("logo", "images/logo.png");
    expect(imageSpy).toHaveBeenCalledTimes(1);

    failLatest(loader, "logo", "image");
    const url1 = imageSpy.mock.calls[1][1] as string;
    expect(url1).toMatch(/^images\/logo\.png\?.*cb=/);
    expect(url1).not.toContain("jsdelivr.net");

    failLatest(loader, "logo", "image");
    const url2 = imageSpy.mock.calls[2][1] as string;
    expect(url2).toContain("https://fastly.jsdelivr.net/gh/Heraklines/er-assets/images/logo.png");
  });

  it("retries a failed AUDIO (bgm) file, escalating to the Fastly host", () => {
    const loader = makeLoader();
    const audioSpy = vi.spyOn(loader, "audio");

    loader.audio("menu", "audio/bgm/menu.mp3");
    expect(audioSpy).toHaveBeenCalledTimes(1);

    failLatest(loader, "menu", "audio");
    const a1 = audioSpy.mock.calls[1][1] as string;
    expect(a1).toMatch(/^audio\/bgm\/menu\.mp3\?.*cb=/);
    expect(a1).not.toContain("jsdelivr.net");

    failLatest(loader, "menu", "audio");
    const a2 = audioSpy.mock.calls[2][1] as string;
    expect(a2).toContain("https://fastly.jsdelivr.net/gh/Heraklines/er-assets/audio/bgm/menu.mp3");
  });

  it("only cache-busts (never Fastly-swaps) a non-CDN path", () => {
    const loader = makeLoader();
    const jsonSpy = vi.spyOn(loader, "json");

    // A path OUTSIDE the CDN-redirected dirs must never be rewritten to Fastly.
    loader.json("cfg", "config/local.json");
    failLatest(loader, "cfg", "json"); // round 1
    failLatest(loader, "cfg", "json"); // round 2 (would be Fastly for a CDN path)
    const u2 = jsonSpy.mock.calls[2][1] as string;
    expect(u2).not.toContain("jsdelivr.net");
    expect(u2).toMatch(/^config\/local\.json\?.*cb=/);
  });

  it("never retries a key owned by the dedicated pokemon-atlas mechanism", () => {
    const loader = makeLoader();
    const atlasSpy = vi.spyOn(loader, "atlas");

    dedicatedRetryKeys.add("pkmn_battle_atlas");
    try {
      loader.atlas("pkmn_battle_atlas", "images/pokemon/6.png", "images/pokemon/6.json");
      failLatest(loader, "pkmn_battle_atlas", "image");
      // Only the initial load - the generic mechanism left it entirely alone.
      expect(atlasSpy).toHaveBeenCalledTimes(1);
    } finally {
      dedicatedRetryKeys.delete("pkmn_battle_atlas");
    }
  });
});
