import type { TrustedBrowserReleaseKeyV1 } from "./signature-verifier";

export const PINNED_PRODUCTION_RELEASE_KEYS_V1: readonly TrustedBrowserReleaseKeyV1[] = Object.freeze([
  {
    key_id: "m9-prod-2026-01",
    public_key: [
      125, 204, 207, 198, 76, 152, 199, 166, 208, 56, 189, 10, 100, 113, 89, 240, 107, 149, 135, 191, 77, 117, 18, 75,
      237, 22, 120, 8, 213, 169, 37, 142,
    ],
    channels: ["INTERNAL", "PREVIEW", "CANARY", "STABLE", "ROLLBACK", "LEGACY_TRANSITION"],
    minimum_release_epoch: 1,
    revoked: false,
  },
]);
