# Co-op task ownership manifests

Every parallel `ci/coop/**` writer declares the exact integration train it forked from and the files it owns in
`.github/coop-task-ownership/<task>.json`. The focused workflow resolves the manifest whose `branch` exactly
matches `github.ref_name`, fetches its declared `trainRef`, and proves the task's `baseSha` remains in that train's
unrebased lineage. A task remains valid when the train advances normally; a rebase, force-push, or unrelated base
fails before test selection.

```json
{
  "version": 1,
  "taskId": "p33-example-surface",
  "branch": "ci/coop/p33-example-surface",
  "trainRef": "ci/coop/p33-mystery-public-transition",
  "baseSha": "0123456789abcdef0123456789abcdef01234567",
  "allowedFiles": [
    ".github/coop-task-ownership/p33-example-surface.json",
    "src/data/elite-redux/coop/coop-example.ts",
    "test/tests/elite-redux/coop/coop-example.test.ts"
  ]
}
```

`allowedFiles` accepts exact repository-relative paths and directory prefixes ending in `/**`. Entries must use
forward slashes, must be unique and lexically sorted, and must include the manifest itself. Renames are evaluated
as a deletion plus an addition, so both paths must be owned.

The focused guard fails closed when:

- no single manifest matches the pushed branch;
- `baseSha` is missing, malformed, not an ancestor of `HEAD`, or absent from the declared train's current lineage;
- `baseSha..HEAD` changes a path outside `allowedFiles`;
- the task changes a frozen P33 schema file, even if that file was placed in `allowedFiles`.

The integration train is a special case only in how its expected base is resolved: because its declared
`trainRef` equals its own branch, the workflow uses the push event's exact `before` SHA. The integration owner
must update that branch's manifest for each intentional merge batch. This keeps the integration diff reviewable
without comparing it to the stale release branch.

The guard writes `coop-task-ownership-resolution.json` and `coop-task-ownership-evidence.json`. These records are
uploaded with the focused plan so every selected shard is tied to the exact train base and allowed-file contract.

The frozen schema list lives in `scripts/guard-coop-task-ownership.mjs`. A deliberate wire-schema change must not
be smuggled through a surface task; it requires the integration owner's separate schema-freeze workflow and
compatibility fixtures.
