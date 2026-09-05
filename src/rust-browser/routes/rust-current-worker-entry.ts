/** Opt-in current development entry. No production runtime selector imports it. */
import { CurrentRustBrowserHostV2 } from "../host/current-rust-browser-host";
import type { CurrentRustBrowserHostOptionsV2 } from "../host/current-rust-browser-host";

export { CurrentRustBrowserHostV2, CurrentWorkerRequestErrorV2 } from "../host/current-rust-browser-host";
export { BrowserEffectRouterV2 } from "./browser-effects-v2";

export function createCurrentDevelopmentWorkerTransportV2(): Worker {
  return new Worker(new URL("../worker/current-rust-kernel-worker.ts", import.meta.url), {
    type: "module", name: "er-current-development-v2",
  });
}

export function createCurrentDevelopmentWorkerV2(
  options: Omit<CurrentRustBrowserHostOptionsV2, "worker">,
): CurrentRustBrowserHostV2 {
  return new CurrentRustBrowserHostV2({ ...options, worker: createCurrentDevelopmentWorkerTransportV2() });
}
