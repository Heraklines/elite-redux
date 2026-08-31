import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;

const html = `<!doctype html><html><body><script type="module">
import {
  M9_STARTUP_STAGES_V1,
  M9StartupJourneyRecorderV1,
  M9StartupPerformanceSuiteV1,
} from "/src/rust-browser/production/performance-stages.ts";

function completeJourney(journeyId, mode, startedAtMs, deltas) {
  const recorder = new M9StartupJourneyRecorderV1({ journeyId, mode, startedAtMs });
  let atMs = startedAtMs;
  M9_STARTUP_STAGES_V1.forEach((stage, index) => {
    atMs += deltas[index];
    recorder.record(stage, atMs);
  });
  return recorder.snapshot();
}

const suite = new M9StartupPerformanceSuiteV1();
const cold = completeJourney("cold-1", "COLD", 100, [50, 300, 100, 100, 700, 500, 300, 400, 300, 300, 148]);
const cold2 = completeJourney("cold-2", "COLD", 200, [50, 300, 100, 100, 700, 500, 300, 400, 300, 300, 149]);
const cold3 = completeJourney("cold-3", "COLD", 300, [50, 300, 100, 100, 700, 500, 300, 400, 300, 300, 150]);
const warm = completeJourney("warm-1", "WARM", 1000, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
const warm2 = completeJourney("warm-2", "WARM", 2000, [11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11]);
const warm3 = completeJourney("warm-3", "WARM", 3000, [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
for (const journey of [cold, cold2, cold3, warm, warm2, warm3]) {
  suite.add(journey);
}
const errors = [];
try {
  const outOfOrder = new M9StartupJourneyRecorderV1({ journeyId: "bad-order", mode: "COLD", startedAtMs: 0 });
  outOfOrder.record("PLATFORM_CONTEXT_READY", 1);
} catch (error) {
  errors.push(String(error));
}
try {
  const unbounded = new M9StartupJourneyRecorderV1({ journeyId: "bad-bound", mode: "COLD", startedAtMs: 0 });
  unbounded.record("AUTHENTICATION_READY", 600001);
} catch (error) {
  errors.push(String(error));
}
try {
  new M9StartupJourneyRecorderV1({ journeyId: "bad-mode", mode: "HOT", startedAtMs: 0 });
} catch (error) {
  errors.push(String(error));
}
try {
  suite.add(cold);
} catch (error) {
  errors.push(String(error));
}
globalThis.__m9Startup = { cold, warm, summary: suite.summary(), errors };
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m9-startup-performance",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url !== "/m9-startup-performance.html") {
              next();
              return;
            }
            response.setHeader("content-type", "text/html");
            response.end(html);
          });
        },
      },
    ],
  });
  await server.listen();
});

test.afterAll(async () => server.close());

test("startup stages produce bounded cold and warm distributions", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish the startup performance fixture");
  }
  await page.goto(new URL("m9-startup-performance.html", address).href);
  const result = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __m9Startup: {
            cold: { total_ms: number; stages: Array<{ stage: string }> };
            warm: { total_ms: number };
            summary: {
              total_samples: number;
              cold: { samples: number; total: { p50_ms: number; p95_ms: number } };
              warm: { samples: number; total: { p50_ms: number; p95_ms: number } };
            };
            errors: string[];
          };
        }
      ).__m9Startup,
  );

  expect(result.cold.total_ms).toBe(3198);
  expect(result.cold.stages).toHaveLength(11);
  expect(result.warm.total_ms).toBe(110);
  expect(result.summary).toMatchObject({
    total_samples: 6,
    cold: { samples: 3, total: { p50_ms: 3199, p95_ms: 3200 } },
    warm: { samples: 3, total: { p50_ms: 121, p95_ms: 132 } },
  });
  expect(result.errors).toHaveLength(4);
  expect(result.errors[0]).toContain("out of order");
  expect(result.errors[1]).toContain("invalid or unbounded");
  expect(result.errors[2]).toContain("identity or start time");
  expect(result.errors[3]).toContain("duplicated");
});
