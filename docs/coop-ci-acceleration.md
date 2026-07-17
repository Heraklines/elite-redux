# Co-op CI acceleration

The full checkpoint uses one immutable checkout SHA and an inventory-derived matrix. The configured everyday
target is 35 test/static/browser runners after the P33 integration adds the second production-fidelity file:

| Surface | Target runners |
| --- | ---: |
| Browser transport | 1 |
| Static gate | 1 |
| Lane A | 1 |
| Lane B | 13 |
| Lane C | 5 |
| Lane P | 2 |
| Lane S | 8 |
| Lane T | 4 |

The matrix caps each lane at its tracked file count. Therefore this branch, which contains one Lane-P file,
correctly emits P1; the integration branch containing `coop-transition-t2-biome.test.ts` emits P2 without a
workflow change. Empty required lanes still receive a runner and fail closed.

Every heavyweight lane uses deterministic largest-processing-time assignment. The committed
`scripts/coop-gate-timings.json` prefers measured p90 values, then historical values, then an equal weight of
one. Equal weights are an explicit stable fallback, not invented duration data. To update measurements:

1. Export reviewed observations as JSON:

   ```json
   {
     "source": "GitHub run 123456",
     "observations": [
       { "lane": "C", "file": "test/tests/elite-redux/coop/coop-soak.test.ts", "seconds": 83.4 }
     ]
   }
   ```

2. Run `node scripts/update-coop-gate-timings.mjs --input observations.json`.
3. Review and commit the timing manifest. Never infer per-file timing by dividing a grouped shard duration.

The browser checkpoint builds one production-mode CI bundle, seals every file into a SHA-256 manifest, uploads
it as an execution artifact, and serves that exact artifact with a minimal static server. Runtime assets come
only from the recursively checked-out immutable asset-submodule pin. The runner performs no Vite source
transforms and never serves repository source files. Its CI-only entry exposes only the transport connection seam
and is never imported by a staging or production build.

Green jobs retain compact assignment/status manifests. Failed jobs and manually dispatched release-confidence
runs retain logs, Vitest reports, and game diagnostics. A status manifest is written even when the test command
fails, so an artifact cannot look green merely because its diagnostic log is absent.

Pushes to `ci/coop/**` invoke the focused workflow automatically. It diffs against an explicitly fetched
`feat/elite-redux-port` SHA, maps directly changed tests to their exact full-gate shard, adds deterministic
representative shards for affected source surfaces, and runs at most five. Shared authority/transport/runtime
changes reach Showdown, topology, and long-campaign representatives; field changes reach topology; Mystery and
biome changes reach campaign and production-fidelity representatives. Focused feedback never replaces the
exhaustive integration gate.
