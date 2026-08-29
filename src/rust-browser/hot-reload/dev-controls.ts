import type { BrowserGenerationArtifactManifestV1, BrowserReloadPlanV1 } from "./contracts";
import type { BrowserSnapshotMigrationRegistryV1 } from "./migration-registry";
import type { BrowserGenerationFactoryV1, TransactionalBrowserReloadV1 } from "./transactional-reload";

const MAXIMUM_DEVELOPER_MESSAGE_BYTES_V1 = 65_536;

interface ReloadCommandV1 {
  kind: "RELOAD";
  authorization: string;
  manifest: BrowserGenerationArtifactManifestV1;
  plan: BrowserReloadPlanV1;
}

interface RollbackCommandV1 {
  kind: "ROLLBACK";
  authorization: string;
  reason: string;
}

type DeveloperReloadCommandV1 = ReloadCommandV1 | RollbackCommandV1;

export function attachBrowserReloadDeveloperPortV1(
  port: MessagePort,
  supervisor: TransactionalBrowserReloadV1,
  migrations: BrowserSnapshotMigrationRegistryV1,
  factory: BrowserGenerationFactoryV1,
  authorize: (token: string) => boolean,
): () => void {
  let disposed = false;
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (disposed) {
      return;
    }
    handleCommand(event.data).then(
      value => port.postMessage({ ok: true, value }),
      error => port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  };
  const handleCommand = async (value: unknown): Promise<unknown> => {
    const encoded = JSON.stringify(value);
    if (encoded.length === 0 || encoded.length > MAXIMUM_DEVELOPER_MESSAGE_BYTES_V1) {
      throw new Error("developer reload command is empty or oversized");
    }
    const command = value as Partial<DeveloperReloadCommandV1>;
    if (typeof command.authorization !== "string" || !authorize(command.authorization)) {
      throw new Error("developer reload command is unauthorized");
    }
    if (command.kind === "RELOAD" && command.manifest != null && command.plan != null) {
      return supervisor.reload(command.manifest, command.plan, migrations, factory);
    }
    if (command.kind === "ROLLBACK" && typeof command.reason === "string") {
      await supervisor.rollback(command.reason);
      return { rolled_back: true };
    }
    throw new Error("developer reload command is malformed");
  };
  port.addEventListener("message", onMessage);
  port.start();
  return () => {
    if (!disposed) {
      disposed = true;
      port.removeEventListener("message", onMessage);
      port.close();
    }
  };
}
