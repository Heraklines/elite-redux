import { BrowserExecutionModeV1 } from "../contracts/browser-contracts";

const ALLOWED_DEV_RUNTIME: Partial<Record<string, BrowserExecutionModeV1>> = {
  "rust-local": BrowserExecutionModeV1.RUST_LOCAL_AUTHORITY,
  "rust-shadow": BrowserExecutionModeV1.TYPESCRIPT_WITH_RUST_SHADOW,
};

export function selectBrowserExecutionMode(): BrowserExecutionModeV1 {
  if (!import.meta.env.DEV) {
    return BrowserExecutionModeV1.RUST_PRODUCTION_AUTHORITY;
  }
  const requested = new URLSearchParams(globalThis.location?.search ?? "").get("runtime");
  return requested == null
    ? BrowserExecutionModeV1.LEGACY_TYPESCRIPT
    : (ALLOWED_DEV_RUNTIME[requested] ?? BrowserExecutionModeV1.LEGACY_TYPESCRIPT);
}
