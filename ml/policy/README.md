# ER candidate-transformer policy

This directory contains the non-production neural combat baseline. It consumes
the exact legal candidate rows recorded by combat contract v2, learns a
listwise policy over each candidate set, and learns a terminal battle-value
auxiliary target.

Each default network has 4,273,602 parameters. The workflow trains three seeds
and averages their policy and value logits. Candidate order has no positional
encoding, so permuting legal actions only permutes their policy scores. Inverse
matchup legs share a split group and cannot cross the train/validation boundary.
Failed exploratory tree trajectories are removed with `--elite-rollouts`; loss
episodes retained from the source policy receive reduced policy weight.

Artifacts are a versioned `config.json`, `model.safetensors`, and `report.json`.
The headless harness loads them through `serve_candidate_transformer.py`, a
persistent JSONL sidecar. This path exists only for training and evaluation:
production, staging, Showdown, tournaments, and the browser game do not load the
checkpoint or Torch.

The model is currently an ER-native numerical candidate transformer, not an LLM
and not a global SOTA claim. Promotion depends on the fixed 100-leg,
player-held-out ghost gauntlet against the game's hardest Hell trainer AI.
Offline Top-1 and NLL measure action imitation only.

Run the local tests with:

```sh
python -m unittest discover -s ml/policy -p 'test_*.py' -v
```
