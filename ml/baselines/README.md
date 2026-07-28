# ER combat AI baseline pilot

This non-production lane records legal combat-command candidates from the real
headless engine and measures how well inexpensive CPU models rank the command
chosen by the source policy. The initial source policy is the scenario harness's
`smart-default-v1` policy.

Top-1, Top-3, MRR, and candidate NLL are therefore **imitation metrics**, not
battle strength. They answer whether a model learned the recorded policy. A
model is not better than the game's AI until its exported inference policy wins
more often on a fixed-seed, held-out real-engine gauntlet.

The first tree is exported to a neutral JSON format and executed by the same
TypeScript feature extractor used to record training rows. A second data pass
runs that tree with deterministic 15% legal-action exploration. Retraining keeps
the expert rows plus exploratory trajectories that reached their requested wave
horizon. This is a small cross-entropy-style policy iteration against the game's
trainer AI. It is not symmetric model self-play yet.

The fixed gauntlet uses 100 sanitized rosters from actual winning Hell ghost
runs, drawn from 73 anonymous accounts. Every pair is played twice: A as the
player against B, then B as the player against A. The selected tree and the
`smart-default-v1` control each play all 100 legs. Original 1-6 member party
sizes, forms, moves, ability slots, IVs, natures, shiny tiers, saved passive
flags, and exactly reconstructable per-Pokemon held-item stacks are preserved at
level 200. Historical generic item-generator ids whose subtype was not saved are
excluded rather than rerolled. Run-global relics, challenges, and generated
trainer modifiers are excluded from both sides.

The resulting real-engine completed-leg rate is a battle win rate. The training
leaderboard's Top-1/Top-3/MRR values remain offline action-imitation metrics. For
example, 69.8% Top-1 means the held-out action matched 69.8% of the time; it does
not mean a 69.8% battle win rate.

The workflow is artifact-only. It has no deployment job, production environment,
Cloudflare credential, or repository write permission. Every run uploads its
versioned JSONL shards, neutral model artifacts, and both leaderboards so results
can be compared by commit and GitHub Actions run. The workflow caps every matrix
at six concurrent runners and has no production or staging deployment step.
