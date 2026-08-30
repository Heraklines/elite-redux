import {
  type ProductionReleaseManifestV2,
  type ProductionSaveEnvelopeV2,
  RUST_PREVIEW_SAVE_NAMESPACE_V1,
  type SaveMigrationReceiptV1,
} from "./contracts";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/u;
const MAXIMUM_SAVE_BYTES = 268_435_456;

export async function validateProductionSaveEnvelopeV2(
  envelope: ProductionSaveEnvelopeV2,
  release: ProductionReleaseManifestV2,
  accountId: string,
  slot: string,
): Promise<ProductionSaveEnvelopeV2> {
  if (
    envelope.envelope_version !== 2
    || envelope.save_namespace !== RUST_PREVIEW_SAVE_NAMESPACE_V1
    || envelope.slot !== slot
    || envelope.pseudonymous_account_id !== accountId
    || !IDENTIFIER.test(envelope.slot)
    || !IDENTIFIER.test(envelope.pseudonymous_account_id)
    || envelope.release_id !== release.release_id
    || !safeInteger(envelope.cloud_generation)
    || !safePositive(envelope.kernel_generation)
    || envelope.authority_protocol !== release.authority_protocol
    || envelope.save_schema !== release.save_schema
    || envelope.content_hash !== release.mechanical_identity.content_hash
    || envelope.mechanical_identity.mechanics_sha256 !== release.mechanical_identity.mechanics_sha256
    || !SHA256.test(envelope.payload_hash)
    || envelope.payload.length === 0
    || envelope.payload.length > MAXIMUM_SAVE_BYTES
    || !byteArray(envelope.payload)
  ) {
    throw new Error("production save envelope identity is invalid");
  }
  const payload = Uint8Array.from(envelope.payload);
  try {
    if ((await sha256(payload)) !== envelope.payload_hash) {
      throw new Error("production save payload hash mismatch");
    }
  } finally {
    payload.fill(0);
  }
  if (envelope.migration != null) {
    validateMigrationReceipt(envelope.migration, envelope);
    if (envelope.legacy_backup == null || !IDENTIFIER.test(envelope.legacy_backup)) {
      throw new Error("migrated production save lacks immutable legacy backup");
    }
  }
  return envelope;
}

export function decodeProductionSaveEnvelopeV2(bytes: Uint8Array): ProductionSaveEnvelopeV2 {
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SAVE_BYTES) {
    throw new Error("production save envelope is empty or oversized");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as ProductionSaveEnvelopeV2;
}

function validateMigrationReceipt(receipt: SaveMigrationReceiptV1, envelope: ProductionSaveEnvelopeV2): void {
  if (
    receipt.schema_version !== 1
    || receipt.target_runtime !== "RUST"
    || receipt.target_schema !== envelope.save_schema
    || receipt.target_hash !== envelope.payload_hash
    || !SHA256.test(receipt.source_hash)
    || !SHA256.test(receipt.target_hash)
    || !SHA256.test(receipt.validation_digest)
    || !IDENTIFIER.test(receipt.migrator_id)
  ) {
    throw new Error("production save migration receipt is invalid");
  }
}

function byteArray(values: readonly number[]): boolean {
  return values.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 255);
}

function safeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function safePositive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
