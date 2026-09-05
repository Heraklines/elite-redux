# Current CLI validation

Normal `validate-save --content <v2-content> --save <save>` decodes a canonical,
checksummed GameSaveV2, requires the selected prepared V2 content identity, and
validates the state against that content. Success reports
`CANONICAL_SAVE_AND_CURRENT_CONTENT_STATE`. This validates stored state; it does
not start a session or prove gameplay continuation. Save input is bounded at8MiB.

Normal `capsule-validate --content <v2-content> --capsule <capsule>` uses the same
isolated current replay implementation as `replay`. It reports
`ISOLATED_CURRENT_CAPSULE_REPLAY`, `schema_valid` and `replay_valid` only after
all retained typed attempts and final snapshot evidence agree. Capsule input and
replay output are bounded at4MiB; the existing recorder/replay limits also apply.
Replay quarantines platform effects and compares the complete checkpoint/effect/
observation evidence. It does not execute storage or network side effects.

The explicit `validate-save-v6` command retains the historical V1-content/save
validator. `capsule-validate-v1` retains the historical archive validator, including
its artifact-root confinement. Current commands reject historical formats rather
than infer a compatibility mode from their bytes.

Two actual CLI-process tests cover natural current fixtures, independently absent
content references with valid checksums, malformed/corrupt/wrong-content saves,
current full-snapshot replay, causal time tampering/omission, historical format
rejection, exact byte-limit errors and historical archive path confinement. The
historical archive witness proves container validation, not V6 gameplay. Each
process has a120-second polling deadline, sampled8MiB output guards and RAII
cleanup; these are not hard OS disk or cleanup-time quotas.

Qualification status and exact source/run identities are in m9e-recovery-ledger.md.
