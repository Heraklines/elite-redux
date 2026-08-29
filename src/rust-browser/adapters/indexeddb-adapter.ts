import { BrowserStorageAdapter, type OpaqueStorageValueV1 } from "./storage-adapter";

export interface ProductionIndexedDbOptionsV1 {
  releaseIdentity: string;
  executionIdentity: string;
  contentIdentity: string;
  onExternalRevision?(key: string, revision: number): void;
}

interface RevisionNoticeV1 {
  release: string;
  key: string;
  revision: number;
}

export class ProductionIndexedDbAdapterV1 {
  readonly #release: string;
  readonly #storage: BrowserStorageAdapter;
  readonly #channel: BroadcastChannel;
  readonly #onExternalRevision?: (key: string, revision: number) => void;
  #disposed = false;

  constructor(options: ProductionIndexedDbOptionsV1) {
    if (options.releaseIdentity.length === 0 || options.releaseIdentity.length > 256) {
      throw new Error("IndexedDB release identity is invalid");
    }
    this.#release = options.releaseIdentity;
    this.#onExternalRevision = options.onExternalRevision;
    this.#storage = new BrowserStorageAdapter({
      databaseName: `er-rust-kernel-${options.releaseIdentity}`,
      executionIdentity: options.executionIdentity,
      contentIdentity: options.contentIdentity,
    });
    this.#channel = new BroadcastChannel(`er-rust-kernel-${options.releaseIdentity}`);
    this.#channel.addEventListener("message", this.#onMessage);
  }

  load(key: string): Promise<OpaqueStorageValueV1 | null> {
    this.#assertOpen();
    return this.#storage.read(this.#key(key));
  }

  async save(key: string, expectedRevision: number | null, bytes: Uint8Array): Promise<number> {
    this.#assertOpen();
    const revision = await this.#storage.compareAndSwap(this.#key(key), expectedRevision, bytes);
    this.#channel.postMessage({ release: this.#release, key, revision } satisfies RevisionNoticeV1);
    return revision;
  }

  async delete(key: string, expectedRevision: number): Promise<void> {
    this.#assertOpen();
    await this.#storage.delete(this.#key(key), expectedRevision);
    this.#channel.postMessage({
      release: this.#release,
      key,
      revision: expectedRevision + 1,
    } satisfies RevisionNoticeV1);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#channel.removeEventListener("message", this.#onMessage);
    this.#channel.close();
    await this.#storage.dispose();
  }

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    if (this.#disposed || typeof event.data !== "object" || event.data == null) {
      return;
    }
    const notice = event.data as Partial<RevisionNoticeV1>;
    if (
      notice.release === this.#release
      && typeof notice.key === "string"
      && Number.isSafeInteger(notice.revision)
      && (notice.revision ?? 0) > 0
    ) {
      this.#onExternalRevision?.(notice.key, notice.revision as number);
    }
  };

  #key(key: string): string {
    if (!/^[a-zA-Z0-9._/-]{1,256}$/u.test(key)) {
      throw new Error("IndexedDB key is invalid");
    }
    return `${this.#release}/${key}`;
  }

  #assertOpen(): void {
    if (this.#disposed) {
      throw new Error("production IndexedDB adapter is disposed");
    }
  }
}
