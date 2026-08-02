# ER combat AI baseline pilot

This non-production lane records contract-v3 legal combat-command candidates
from the real headless engine and measures how well inexpensive CPU models rank
eligible committed actions. Every row has an explicit policy source and target
flag. Smart-default, hardest engine AI, scripted actions, and diagnostic trees
can provide value/evaluation state coverage but are excluded from policy fitting.

Top-1, Top-3, MRR, and candidate NLL are therefore **imitation metrics**, not
battle strength. They answer whether a model learned the recorded policy. A
model is not better than the game's AI until its exported inference policy wins
more often on a fixed-seed, held-out real-engine gauntlet.

Runtime-suitable HGB and LightGBM trees are exported to a neutral JSON format
and executed by the same TypeScript feature extractor used to record training
rows. Random Forest and Extra Trees remain measured CPU baselines, but their
literal neutral exports are deliberately omitted because they are hundreds of
megabytes and are not selected runtime candidates. A second data pass runs the
selected tree with deterministic 15% legal-action exploration. Retraining keeps
the expert rows plus successful exploratory trajectories.

The legacy production-telemetry lane is a separate compatibility baseline.
`scripts/ai/download-production-combat-telemetry.mjs` performs a read-only import
from the explicitly named production bucket and partitions records strictly by
`playerIdHash`. Because schema v1 has no bench snapshot or legal switch
candidates, `ml/baselines/train_legacy_human_tree.py` fits a move-only Random
Forest and exports it with `candidateScope: "move-only"`. This approximately
29 MiB artifact is intentionally allowed for the frozen headless benchmark; it
is not a production-serving candidate. Legacy turn outcomes train only
immediate transition models. They never imply terminal victory, defeat, value,
or winner-only policy labels.

The tree lane exports separate diagnostic and policy artifacts.
`selected-model.json` optimizes held-out action imitation over all episodes and
is never treated as strength evidence. `outcome-selected-model.json` is fitted
only on winning episodes by default and can be selected only when the held-out
split also contains winning decisions. If that condition is absent, the report
marks the policy unavailable instead of falling back to loss imitation.
`stacked_tree_ensemble.json` and
`winner_only_stacked_tree_ensemble.json` combine compact tree artifacts using
roster-partitioned out-of-fold logistic stacking. Only the real-engine gauntlet
determines which is stronger. Exploratory rollouts use the winner-trained
selector, never the all-episode imitation selector.
The pre-firewall smart-default tree is retained only as a diagnostic benchmark.
New tree policy artifacts require human wins, winning promoted-checkpoint
trajectories, or search/advantage relabels. Hardest Hell AI is an opponent and
promotion floor, never a policy teacher.

The neural lane trains three independently seeded, permutation-equivariant
candidate-set transformers with policy and terminal-value heads, then averages
their logits at inference. The model consumes learned permutation-invariant
identity/state token sets for the actor, targets, switch destination, field, and
action in addition to dense candidate features, plus a causal history of the
last eight selected actions. It is an ER-native numerical
policy baseline, not an LLM and not a claim of global SOTA. A persistent test-only
Python sidecar loads the `safetensors` checkpoints once; the game and production
bundles do not import Torch.

The fixed gauntlet uses 200 sanitized rosters from actual winning ghost runs:
50 each from Youngster, Ace, Elite, and Hell. Source accounts are partitioned
before roster selection, so no evaluation account or roster enters fitting.
Training rosters are assigned to five disjoint source folds before matchups are
generated; offline train/test and stacking folds therefore never share a roster.
Matchups use balanced round-robin orders within each fold, and consecutive
episodes are strict inverse legs. The 100 evaluation pairs run three fixed seeds
in both orientations, producing 600 real-engine legs per controller. The
random-init transformer, Showdown-transfer transformer, diagnostic tree
ensemble, `smart-default-v1`, and `engine-hardest-v1` all play the same legs. Evaluation
batches preserve both A-vs-B and B-vs-A while reusing one warm engine process per
shard.

Original 1-6 member party sizes, saved movesets, forms, ability slots, IVs,
natures, shiny tiers, saved passive flags, and exactly reconstructable
per-Pokemon held-item stacks are preserved at level 200. Historical generic
item-generator ids whose subtype was not saved are excluded rather than
rerolled. Run-global relics, challenges, generated trainer modifiers, rewards,
shops, and next-wave progression are excluded.

The resulting real-engine completed-leg rate is a battle win rate. The training
leaderboard's Top-1/Top-3/MRR values remain offline action-imitation metrics. For
example, 69.8% Top-1 means the held-out action matched 69.8% of the time; it does
not mean a 69.8% battle win rate.

The workflow is artifact-only. It has no deployment job, production environment,
Cloudflare credential, or repository write permission. Every run uploads its
versioned JSONL shards, neutral model artifacts, both leaderboards, and a sealed
private-Kaggle training bundle so results
can be compared by commit and GitHub Actions run. The workflow caps every matrix
at six concurrent runners and has no production or staging deployment step. A
generation runner boots the Vitest/Phaser engine once and executes 24 isolated
battles in that warm process. Evaluation is split into six warm batches rather
than one cold process per matchup. Every episode records its own terminal outcome
and the worker fails if it enters a reward or run-progression phase.

Branch pushes run only contract, identity, and recorder-neutrality checks. Fresh
generation, eligible tree training, rollout, and Kaggle packaging require a
manual dispatch. Transformer training is a separate private Kaggle GPU action.
The dedicated mirrored benchmark is also manual-only and caps execution at six
GitHub runners. Neither workflow contains a deploy job or game-environment binding.
