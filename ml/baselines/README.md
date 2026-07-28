# ER combat AI baseline pilot

This non-production lane records legal combat-command candidates from the real
headless engine and measures how well inexpensive CPU models rank the command
chosen by the source policy. The initial source policy is the scenario harness's
`smart-default-v1` policy.

Top-1, Top-3, MRR, and candidate NLL are therefore **imitation metrics**, not
battle strength. They answer whether a model learned the recorded policy. A
model is not better than the game's AI until its exported inference policy wins
more often on a fixed-seed, held-out real-engine gauntlet.

That gauntlet uses sanitized six-Pokemon rosters from actual winning Hell ghost
runs. Every pair is played twice: A as the player against B, then B as the player
against A. Species, forms, moves, ability slots, IVs, natures, shiny tiers, and
saved passive flags are preserved at a common level 200. Run-accumulated item
stacks and generated trainer modifiers are removed from both sides. The pilot
report is a side-balanced `smart-default-v1` versus engine-AI control benchmark;
trained policies must later run through the same inverse-pair contract.

The workflow is artifact-only. It has no deployment job, production environment,
Cloudflare credential, or repository write permission. Every run uploads its
versioned JSONL shards and leaderboard so results can be compared by commit and
GitHub Actions run.
