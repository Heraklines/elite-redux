import Phaser from "phaser";

const CacheManager = Phaser.Cache.CacheManager;

export class MockLoader {
  public cacheManager;
  constructor(scene) {
    this.cacheManager = new CacheManager(scene);
  }

  once(_event, callback) {
    callback();
  }

  // Event registration (e.g. ER's atlas-retry handler binds FILE_LOAD_ERROR).
  // No-op: the headless loader never errors, so the handler must NOT be invoked
  // (running it would execute the retry path against a fake file and crash).
  on(_event, _callback, _context) {
    return this;
  }

  off(_event, _callback, _context) {
    return this;
  }

  setBaseURL(_url) {
    return null;
  }

  video() {
    return null;
  }

  spritesheet(_key, _url, _frameConfig) {}

  audio(_key, _url) {}

  isLoading() {
    return false;
  }

  start() {}

  image() {}

  atlas(_key, _textureUrl, _atlasUrl) {}
}
