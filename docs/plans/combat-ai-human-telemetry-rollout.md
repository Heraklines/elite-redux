# Combat AI human telemetry baseline and contract-v3 rollout

Date: 2026-08-01. Status: legacy baseline evaluated; contract-v3 production rollout awaiting explicit
approval. Production deployment is not approved by this document.

## Verified production snapshot

A GET-only R2 import completed while the bucket was still growing. The benchmark training snapshot from
Actions run `30761540906` contained:

- Source: production bucket `er-telemetry`.
- 137,371 events in 4,111 immutable batches.
- 77,784 human battle decisions and 59,587 turn-outcome snapshots.
- 1,550 sessions from 1,061 pseudonymous source partitions.
- Every batch is solo and schema v1. There are zero contract-v3 decisions and zero terminal records.
- Session modes are 1,335 Classic, 3 Endless, and 212 Challenge. Difficulty coverage is 801 Youngster,
  308 Ace, 168 Elite, and 273 Hell. Co-op, Showdown, and tournament sessions are absent.

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

The benchmark snapshot contains 71,468 usable move choices. It excludes 3,601 switches, 2,550 ball
throws, 30 run attempts, and 135 move records that cannot be matched safely. Legacy v1 captured active
battlers but not the bench or the complete legal-candidate set. Therefore:

- The behavior-cloning forest ranks moves only. It does not fabricate switch destinations or target-set
  labels. Its neutral artifact declares `candidateScope=move-only` and uses runtime feature schema 2.
- 71,468 move decisions materialized: 52,308 train, 11,769 validation, and 7,391 untouched test decisions.
- The selected random forest scored 53.6% validation Top-1 and 48.5% test Top-1. These are human
  move-imitation diagnostics, not battle win rates.
- The transition baseline joined 39,992 turn outcomes to a preceding human decision state. On the test
  split, player/enemy any-faint ROC-AUC is 0.827/0.929. It predicts immediate turn outcomes only and has
  no terminal-value target.

The manual `ai-human-legacy-baseline.yml` workflow imports and trains on one runner, uploads no raw player
telemetry, then uses at most four runners for the frozen benchmark.

## Completed online benchmark

The human tree plays the frozen `ghost-winner-teams.v3.json` benchmark: 100 source-account-held-out roster
pairs, 50 teams per difficulty, three fixed seeds, and both team orientations. Compare its report with the
already frozen results for smart-default, the selected tree, and hardest AI. Report actual win rates,
Wilson 95% intervals, draws, timeouts, illegal actions, unresolved battles, per-difficulty rates, and the
macro-average. No offline metric can promote a policy.

The complete 600-leg result from Actions runs `30761540906` and `30765780509` is:

| Controller | Wins | Losses | Win rate (95% Wilson CI) | Illegal | Timeouts | Draws |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Human legacy tree | 147 | 453 | 24.5% (21.2%-28.1%) | 0 | 0 | 0 |
| Hardest AI | 119 | 481 | 19.8% (16.8%-23.2%) | 0 | 0 | 0 |
| Selected tree | 85 | 515 | 14.2% (11.6%-17.2%) | 0 | 0 | 0 |
| Smart-default | 73 | 527 | 12.2% (9.8%-15.0%) | 0 | 0 | 0 |
| Transformer checkpoint | 23 | 577 | 3.8% (2.6%-5.7%) | 0 | 0 | 0 |

The human tree's per-difficulty rates are 24.7% Youngster, 18.7% Ace, 28.0% Elite, and 26.7% Hell.
It is the strongest tested aggregate baseline, improving 4.7 percentage points over hardest AI and 10.3
points over the prior selected tree. The individual aggregate confidence intervals overlap, and hardest AI
remains 2.0 points ahead on Hell, so this result qualifies the human tree as the next research initializer,
not as a production policy. Hardest AI is evaluation and sparring only; its actions are never policy targets.

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
4. Initialize checkpoint-league self-play from a terminal-labelled human policy. The legacy human tree has
   cleared the mirrored-improvement prerequisite, but its missing switch labels and unknown outcomes make it
   a baseline rather than the final initializer.
5. Promote checkpoints only on held-out mirrored battle improvement and consistent performance against
   hardest AI. Never use hardest-AI actions as policy supervision.
