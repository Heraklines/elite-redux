# ER enemy BST curve report (#418)

Generated from the 1:1 encounter-sim harness (`test/tests/elite-redux/tools/dump-bst-curve.test.ts`),
2 full 200-wave simulated runs per difficulty, all enemies (wild + trainer) recorded.
Rerun any time with:

```
ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-bst-curve.test.ts
```

Columns: `n` = enemies sampled in the bucket, `final%` = share that are fully-evolved,
`legend-like` = legendary/sub-legendary/mythical count, `600+` = count with BST >= 600.

## ACE (pure vanilla) - healthy baseline

| waves | kind | n | meanBST | p90 | max | meanLvl | final% | legend-like | 600+ |
|---|---|---|---|---|---|---|---|---|---|
| 1-20 | WILD | 35 | 287 | 324 | 450 | 7 | 3% | 0 | 0 |
| 1-20 | TRAINER | 10 | 279 | 320 | 320 | 6 | 0% | 0 | 0 |
| 21-40 | WILD | 40 | 339 | 450 | 515 | 19 | 18% | 0 | 0 |
| 21-40 | TRAINER | 12 | 371 | 420 | 435 | 19 | 0% | 0 | 0 |
| 41-60 | WILD | 39 | 437 | 510 | 535 | 33 | 64% | 0 | 0 |
| 41-60 | TRAINER | 12 | 497 | 600 | 600 | 36 | 83% | 0 | 2 |
| 61-80 | WILD | 38 | 467 | 510 | 600 | 49 | 82% | 0 | 1 |
| 61-80 | TRAINER | 26 | 494 | 535 | 535 | 47 | 77% | 0 | 0 |
| 81-100 | WILD | 38 | 495 | 542 | 580 | 65 | 100% | 0 | 0 |
| 81-100 | TRAINER | 12 | 545 | 600 | 600 | 69 | 100% | 0 | 4 |
| 101-120 | WILD | 34 | 494 | 535 | 545 | 81 | 100% | 0 | 0 |
| 101-120 | TRAINER | 40 | 516 | 580 | 640 | 93 | 100% | 1 | 1 |
| 121-140 | WILD | 43 | 489 | 532 | 580 | 101 | 100% | 0 | 0 |
| 121-140 | TRAINER | 2 | 523 | 535 | 535 | 103 | 100% | 0 | 0 |
| 141-160 | WILD | 38 | 499 | 550 | 600 | 121 | 100% | 0 | 1 |
| 141-160 | TRAINER | 14 | 547 | 680 | 680 | 125 | 100% | 2 | 6 |
| 161-180 | WILD | 36 | 493 | 542 | 580 | 142 | 100% | 0 | 0 |
| 161-180 | TRAINER | 28 | 537 | 630 | 680 | 151 | 100% | 4 | 6 |
| 181-200 | WILD | 32 | 490 | 535 | 580 | 167 | 100% | 0 | 0 |
| 181-200 | TRAINER | 72 | 544 | 600 | 780 | 182 | 97% | 6 | 15 |

Trainer power tracks wild power closely; no legend-likes before wave 100; the only early
600 BST entries are wave-55 boss-trainer aces (Vikavolt/Arcanine, lvl 36+), which is
vanilla behavior. Nothing to tune here.

## ELITE - the early TRAINER curve is broken

| waves | kind | n | meanBST | p90 | max | meanLvl | final% | legend-like | 600+ |
|---|---|---|---|---|---|---|---|---|---|
| 1-20 | WILD | 29 | 277 | 311 | 450 | 7 | 3% | 0 | 0 |
| 1-20 | TRAINER | 24 | **456** | **580** | **670** | 7 | **67%** | **3** | 2 |
| 21-40 | WILD | 35 | 365 | 466 | 490 | 19 | 29% | 0 | 0 |
| 21-40 | TRAINER | 26 | 444 | 540 | 540 | 17 | 65% | 0 | 0 |
| 41-60 | WILD | 27 | 457 | 510 | 525 | 34 | 67% | 0 | 0 |
| 41-60 | TRAINER | 34 | **507** | 600 | **680** | 30 | 88% | 1 | 4 |
| 61-80 | WILD | 28 | 473 | 530 | 550 | 48 | 86% | 0 | 0 |
| 61-80 | TRAINER | 40 | 509 | 570 | 670 | 46 | 90% | 3 | 1 |
| 81-100 | WILD | 34 | 495 | 532 | 600 | 64 | 100% | 0 | 2 |
| 81-100 | TRAINER | 26 | 470 | 545 | 680 | 62 | 69% | 0 | 2 |
| 101-120 | WILD | 28 | 481 | 530 | 600 | 81 | 100% | 0 | 1 |
| 101-120 | TRAINER | 52 | 523 | 590 | 680 | 88 | 94% | 2 | 5 |
| 121-140 | WILD | 31 | 486 | 532 | 535 | 101 | 100% | 0 | 0 |
| 121-140 | TRAINER | 30 | 536 | 600 | 680 | 96 | 93% | 4 | 6 |
| 141-160 | WILD | 31 | 497 | 530 | 600 | 122 | 100% | 0 | 1 |
| 141-160 | TRAINER | 28 | 511 | 600 | 680 | 120 | 96% | 0 | 3 |
| 161-180 | WILD | 34 | 498 | 550 | 580 | 144 | 100% | 0 | 0 |
| 161-180 | TRAINER | 40 | 550 | 660 | 680 | 147 | 100% | 6 | 9 |
| 181-200 | WILD | 29 | 464 | 525 | 600 | 166 | 93% | 0 | 1 |
| 181-200 | TRAINER | 80 | 525 | 600 | 780 | 181 | 93% | 7 | 12 |

Concrete early offenders captured by the sim:

- wave 20 (boss wave, lvl 11): **Kyogre (670), Suicune (580), Manaphy (600)** on one team
- wave 42 (lvl 28): Arcanine (600)
- wave 50 (boss wave, lvl 27): **Giratina (680)**
- wave 55 (lvl 38): Calyrex Ice Rider (680), Goodra (600)

Diagnosis: the early-game problem is almost entirely the TRAINER side, and within it the
BOSS waves (every 10th wave pulls from the marquee gym/E4/champion pool whose hand-built
teams carry box legendaries regardless of wave). The wild side is gated correctly
(ER_EARLY_HIGH_BST gate). Also, 65-67% of Elite trainer mons are already fully evolved
in waves 1-40 while the wild curve sits at 3-29%.

## HELL - spiky by design (exempt per maintainer)

| waves | kind | n | meanBST | p90 | max | meanLvl | final% | legend-like | 600+ |
|---|---|---|---|---|---|---|---|---|---|
| 1-20 | WILD | 23 | 270 | 312 | 450 | 7 | 4% | 0 | 0 |
| 1-20 | TRAINER | 38 | 466 | 580 | 680 | 6 | 74% | 3 | 3 |
| 21-40 | WILD | 19 | 353 | 460 | 489 | 20 | 11% | 0 | 0 |
| 21-40 | TRAINER | 44 | 493 | 570 | 680 | 17 | 75% | 4 | 1 |
| 41-60 | WILD | 20 | 460 | 520 | 535 | 34 | 70% | 0 | 0 |
| 41-60 | TRAINER | 46 | 497 | 600 | 680 | 30 | 87% | 2 | 5 |
| 61-80 | WILD | 25 | 482 | 525 | 535 | 49 | 96% | 0 | 0 |
| 61-80 | TRAINER | 50 | 525 | 600 | 680 | 47 | 98% | 4 | 6 |
| 81-100 | WILD | 23 | 493 | 600 | 600 | 65 | 96% | 0 | 3 |
| 81-100 | TRAINER | 44 | 530 | 600 | 680 | 60 | 93% | 1 | 8 |
| 101-120 | WILD | 24 | 485 | 535 | 600 | 82 | 100% | 0 | 1 |
| 101-120 | TRAINER | 64 | 531 | 600 | 720 | 85 | 100% | 3 | 8 |
| 121-140 | WILD | 27 | 500 | 542 | 600 | 102 | 100% | 0 | 1 |
| 121-140 | TRAINER | 40 | 522 | 600 | 680 | 96 | 93% | 1 | 4 |
| 141-160 | WILD | 22 | 491 | 542 | 550 | 123 | 100% | 0 | 0 |
| 141-160 | TRAINER | 46 | 537 | 600 | 600 | 118 | 98% | 9 | 10 |
| 161-180 | WILD | 21 | 496 | 518 | 580 | 143 | 100% | 0 | 0 |
| 161-180 | TRAINER | 56 | 579 | 680 | 690 | 145 | 100% | 18 | 19 |
| 181-200 | WILD | 22 | 462 | 525 | 542 | 165 | 91% | 0 | 0 |
| 181-200 | TRAINER | 88 | 537 | 635 | 780 | 180 | 91% | 10 | 17 |

Early spikes confirmed: Metagross (600) at wave 2, Lunala (680) at wave 12, Moltres at
wave 14, Giratina at wave 20, Kyogre at wave 50. This is Hell's identity - left alone.

## Proposed Elite tuning targets (#419) - for maintainer sign-off

A per-wave TRAINER BST ceiling derived from the wild curve plus a margin, plus a
legend-like ban window. When a roster/factory/boss team member violates the ceiling:
1. devolve to the previous evolution stage if one exists and fits;
2. otherwise swap for a wave-appropriate pick from the same roster pool.

| waves | trainer BST cap | legend-like allowed? |
|---|---|---|
| 1-20 | 420 | no |
| 21-40 | 480 | no |
| 41-60 | 540 | no |
| 61-80 | 580 | no |
| 81-100 | 600 | yes (sub-legendaries) |
| 101+ | uncapped | yes |

This keeps the early game honest (no wave-20 Kyogre at lvl 11), lets the mid game ramp,
and leaves the endgame untouched. Boss waves could run +40 BST headroom over the table so
gym leaders still feel like bosses without fielding box legendaries at wave 20.

After implementing, rerun the dump tool and regenerate this report to show before/after.
