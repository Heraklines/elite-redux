#!/usr/bin/env node

import { runCombatTelemetryImport } from "./combat-telemetry-import.mjs";

await runCombatTelemetryImport("production");
