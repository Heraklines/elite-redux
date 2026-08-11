import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(command, ["build:standalone"], {
  env: { ...process.env, VITE_TELEMETRY: "off" },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error != null) {
  throw result.error;
}
process.exit(result.status ?? 1);
