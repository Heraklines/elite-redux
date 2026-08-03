# ER candidate-transformer policy

This directory contains the non-production neural combat baseline. It consumes
the exact legal candidate rows recorded by combat contract v3/v4 and their
matching feature schema v2/v4, learns a listwise policy over each candidate set, and learns a terminal
battle-value auxiliary target. A causal trajectory encoder also conditions each
decision on the last eight actions actually chosen in the current battle; early
turns use an explicit pre-episode token rather than fabricated history.

Private Kaggle GPU profiles train three seeds and average their policy and value
logits. GitHub runners generate real-engine data, train CPU trees, and publish a
checksum-sealed Kaggle bundle; they do not train the transformer on CPU.
Candidate order has no positional encoding, so permuting legal actions only
permutes their policy scores. Every candidate also carries five learned token
sets (`actor`, `targets`, `destination`, `field`, `action`); mean pooling within
each role makes item, ability, innate, relic, tag, and modifier order irrelevant
without discarding their identities. The final parameter count depends on the
dictionary-bound token vocabulary. Source
rosters are assigned to disjoint folds before matchups are generated, and the
model splits on those folds; neither a roster nor its inverse leg can cross the
train/validation boundary.
Failed exploratory tree trajectories are removed with `--elite-rollouts`.
Winning human and promoted-checkpoint trajectories, plus engine-search or
advantage-relabelled actions, may train the policy head. Losing episodes and
actions from `smart-default-v1`, `engine-hardest-v1`, scripted controllers, or
diagnostic trees have zero policy weight but remain available to the value head
and dataset diagnostics.

Artifacts are a versioned `config.json`, `model.safetensors`, and `report.json`.
The headless harness loads them through `serve_candidate_transformer.py`, a
persistent JSONL sidecar. This path exists only for training and evaluation:
production, staging, Showdown, tournaments, and the browser game do not load the
checkpoint or Torch.

The sidecar rejects artifacts unless the contract/feature pair is v3/v2 or
v4/v4 and the artifact uses schema 4, all five token roles, both declared
domains, the dictionary hash, and the token
vocabulary hash match. Old dense-only checkpoints are intentionally
incompatible.

## Showdown transfer ablations

`convert_metamon_transfer.py` converts Metamon `UniversalState` replays into a
separate schema-v1 transfer contract. It never claims that Showdown contains ER
innates, relics, boss state, or other missing mechanics. Instead, every row is
tagged `domain=showdown`, uses the same identity-token namespaces where names
resolve through the ER dictionary, and marks unavailable numeric features as
absent. The model has a learned domain embedding and a separate projection of
the feature-presence mask, so an unavailable feature is distinguishable from a
known zero.

Transfer shards store only the shared feature columns (currently 85 of 4,326)
and are expanded to the full ER tensor by the batch collator. The sealed Kaggle
bundle accepts gzip-backed `.jsonl.gzpack` shards so Kaggle cannot transparently
decompress and invalidate their checksums. Validation and early stopping always
use source-partition-held-out ER rows; Showdown rows never enter ER validation.

The first controlled comparison uses identical data, vocabulary,
normalization, seed, and architecture. The control sets transfer pretraining to
zero epochs, while the challenger pretrains before resetting the optimizer and
fine-tuning on ER. Neither offline imitation accuracy nor a successful GPU run
is battle-strength evidence.

The model is currently an ER-native numerical candidate transformer, not an LLM
and not a global SOTA claim. Promotion depends on a source-account-held-out
gauntlet containing 200 winning ghost rosters: 50 each from Youngster, Ace,
Elite, and Hell. Its 100 pairs run three fixed seeds in both orientations, for
600 real-engine legs per controller. Reports include each difficulty and a
macro-average so the larger low-difficulty pools cannot hide poor Elite or Hell
performance. Ghost rosters provide matchup states, never action labels. Offline
Top-1 and NLL measure action imitation only.

The `large` Kaggle profile uses CUDA AMP and fast kernels. A checkpoint is not a
promotion candidate until its exact three-seed artifact completes the real
engine gauntlet; a successful GPU training run alone is only infrastructure
evidence.

Run the local tests with:

```sh
python -m unittest discover -s ml/policy -p 'test_*.py' -v
```

Convert a bounded replay sample and build a sealed transfer bundle with:

```sh
python ml/policy/convert_metamon_transfer.py \
  --input /path/to/metamon/replays \
  --dictionary ai-work/er-combat-data-dictionary.json \
  --output ai-work/metamon/transfer.jsonl.gzpack \
  --decision-limit 100000

node scripts/ai/prepare-kaggle-candidate-training.mjs \
  ai-work/er-data \
  ai-work/er-combat-data-dictionary.json \
  ai-work/kaggle/er-ai-training-bundle.zip \
  baseline 20260731 ai-work/metamon/transfer.jsonl.gzpack 4
```
