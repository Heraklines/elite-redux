# Combat AI human telemetry baseline and contract-v3 rollout

Date: 2026-08-01. Status: implementation and non-production evaluation in progress. Production deployment
is not approved by this document.

## Verified production snapshot

A GET-only R2 import completed while the bucket was still growing:

- Source: production bucket `er-telemetry`.
- 112,292 events in 3,284 immutable batches (10,317,945 compressed bytes).
- 63,393 human battle decisions and 48,899 turn-outcome snapshots.
- 1,229 sessions from 832 pseudonymous source partitions.
- Every batch is solo and schema v1. There are zero contract-v3 decisions and zero terminal records.
- Session modes are 1,052 Classic, 2 Endless, and 175 Challenge. Difficulty coverage is 667 Youngster,
  240 Ace, 115 Elite, and 207 Hell. Co-op, Showdown, and tournament sessions are absent.

This supersedes the earlier lower bound observed during inspection (94,083 events, 53,147 decisions,
40,936 outcomes, 1,098 sessions, and 735 sources). Counts are snapshots, not a fixed corpus size.

## Read-only import and split contract

- `scripts/ai/download-production-combat-telemetry.mjs` is hard-bound to `er-telemetry` and exposes only
  Cloudflare GET requests. The staging wrapper remains hard-bound to `er-telemetry-staging`.
- Outputs carry a `SOURCE.json` marker naming environment, bucket, prefix, and `readOnly: true`.
- Every record is assigned deterministically to train (70%), validation (15%), or test (15%) by hashing
  `playerIdHash`. `sourcePartitionId` and `splitGroupId` are both the pseudonymous account partition.
- Legacy decisions and turn outcomes are written separately. Every legacy record states
  `terminalOutcomeKnown=false` and `terminalOutcome=unknown`. No victory, defeat, terminal value, or
  winner-only label is inferred.

## First human baselines

The first snapshot contains 58,216 move choices, 2,961 switches, 2,187 ball throws, and 29 run attempts.
Legacy v1 captured active battlers but not the bench or the complete legal-candidate set. Therefore:

- The behavior-cloning forest ranks moves only. It does not fabricate switch destinations or target-set
  labels. Its neutral artifact declares `candidateScope=move-only` and uses runtime feature schema 2.
- 58,105 move decisions materialized: 43,351 train, 9,118 validation, and 5,636 untouched test decisions.
- The selected random forest scored 51.0% validation Top-1 and 48.7% test Top-1. These are human
  move-imitation diagnostics, not battle win rates.
- The transition baseline joined 32,915 turn outcomes to a preceding human decision state. On the test
  split, player/enemy any-faint ROC-AUC is 0.829/0.927. It predicts immediate turn outcomes only and has
  no terminal-value target.

The manual `ai-human-legacy-baseline.yml` workflow imports and trains on one runner, uploads no raw player
telemetry, then uses at most four runners for the frozen benchmark.

## Required online benchmark

The human tree plays the frozen `ghost-winner-teams.v3.json` benchmark: 100 source-account-held-out roster
pairs, 50 teams per difficulty, three fixed seeds, and both team orientations. Compare its report with the
already frozen results for smart-default, the selected tree, and hardest AI. Report actual win rates,
Wilson 95% intervals, draws, timeouts, illegal actions, unresolved battles, per-difficulty rates, and the
macro-average. No offline metric can promote a policy.

Current frozen reference rates are hardest AI 19.8%, selected tree 14.2%, smart-default 12.2%, and the
transformer checkpoint 3.8%. Hardest AI is evaluation and sparring only; its actions are never policy
targets.

## Contract-v3 production gate

The branch implementation records committed human actions with `policySource=human-v1` and
`policyTarget=true`, stable decision/episode/source-partition identities, build/dex/dictionary hashes,
the expanded public-information combat state, and genuine victory/player-wiped terminal records. Capture
reads the already committed command and never invokes a chooser.

Before production approval, all of the following must pass:

1. Solo headless capture proves one semantic decision per committed actor command and correct terminal.
2. Co-op, Showdown, and tournament headless cases prove zero player-policy records.
3. Capture-on versus capture-off neutrality proves identical commands, RNG, damage, terminal, rewards,
   saves, and progression.
4. Contract/dictionary/build hashes validate and mixed identities fail closed.
5. The production importer accepts schema-v3 records without mixing staging output or legacy terminal
   assumptions.

Do not flip a production build flag or deploy a Worker/Pages change without explicit maintainer approval.
Do not serve an experimental policy in production.

## Training order after rollout

1. Accumulate terminal-labelled contract-v3 human sessions.
2. Train policy primarily from completed human wins; retain all completed outcomes for value learning.
3. Add engine-search or advantage-relabelled actions when available.
4. Initialize checkpoint-league self-play from the strongest human policy only after it improves the
   mirrored benchmark.
5. Promote checkpoints only on held-out mirrored battle improvement and consistent performance against
   hardest AI. Never use hardest-AI actions as policy supervision.
