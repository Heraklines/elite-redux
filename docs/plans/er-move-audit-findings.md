# ER Move Audit — Findings Log

Per-move faithfulness audit driven by `docs/plans/er-move-audit-worktable.md`
(ABBR/FULL = in-game descriptions, the authoritative spec; ROM = decoded ER move
data; CODE = live runtime type/category/power/acc/flags/attrs). Verdict per move:
OK / BOTCH (missing or wrong effect) / PARTIAL.

Progress marker: **COMPLETE** — all 1031 moves (187 custom + 844 vanilla) read manually
and botches fixed. See the "AUDIT COMPLETE" section at the bottom for the full ledger.
(Chunk-1 notes below are retained for history.)

Note on the data: the **flag layer is consistently correct** across customs — boost
types (BITING/SLICING/PULSE/ARROW/HORN/PUNCHING/AIR), contact, etc. are all wired.
The gaps are almost entirely **missing secondary-effect attrs** on bespoke customs
(high-crit, status/stat chances, leech seed, conditional damage, multi-hit, type
overrides) — these moves fall through `dispatchBespokeMove` to SKIP_BESPOKE.

## Chunk 1 — ER custom move ids 755–820 (~62 moves)

FAITHFUL (attrs match description): 755 Deathroll, 757 Aqua Fang, 759 Smite, 760 Outburst,
761 Seismic Fist, 763 Shadow Fangs, 764 Lovely Bite, 766 Scorched Earth, 768 Plasma Pulse,
769 Primal Beam, 770 Draconic Fangs, 774 Mountain Chunk, 775 Archer Shot, 778 Glacier Crash
(spread via target), 781 Shocking Jab, 782 Shocking Edge, 785 Kinetic Barrage, 788 Jagged Punch,
789 Cutsie Slap, 793 Aqua Bash, 794 Tectonic Fangs, 795 Cupid Shot, 817 Starburst, 818 Cheap Shot,
820 Star Crash.

✅ FIXED THIS CHUNK (bespoke-move wiring added to `dispatchBespokeMove`):
- 765 Jagged Fangs — "10% raise user's Attack" → `StatStageChangeAttr([ATK],1,true)` (self, chance-gated).
- 772 Pixie Slash — "High crit ratio" → `HighCritAttr`.
- 773 Seismic Blade — "High crit ratio" → `HighCritAttr`.
- 783 Lightning Strike — "20% raise Speed" → `StatStageChangeAttr([SPD],1,true)`.
- 819 Torrent Fist — "20% drop foe's Speed" → `StatStageChangeAttr([SPD],-1)`.

🔧 REMAINING BOTCHES (chunk 1, next fix pass — grouped by needed mechanism):
- Self/foe stat chance (clean, same template): 771 Pixie Beam (20% self-SpAtk−1).
- High/always crit: 756 Excalibur (HighCrit + 2× vs Dragon), 779 Supersonic Shot (always crit).
- Frostbite chance: 776 Frost Brand (10%), 777 Frost Bolt (20%) → `AddBattlerTagAttr(ER_FROSTBITE)` chance-gated.
- Leech Seed chance: 786 Fertile Fangs (10%), 791 Bramble Blast (30%).
- Conditional 2× damage: 784 Volt Bolt (vs paralyzed).
- 2× / super-effective vs a type: 756 Excalibur (Dragon), 796 Clay Dart (Flying).
- Break screens: 762 Iron Fangs (Light Screen/Reflect).
- Multi-hit + hits-SpDef: 790 Fairy Spheres (2–5 hits, physical→SpDef).
- Crash-on-miss: 780 Zephyr Rush.
- Hazard interaction: 787 Scatter Blast (scatter Stealth Rock).
- "Cannot miss" (verify accuracy sentinel vs needs AlwaysHitAttr): 792 Asteroid Shot.

---

## AUDIT COMPLETE — all 1031 ER moves read + botches fixed

The full audit is done. Every move was read **manually** (ABBR + FULL descriptions +
ROM fields) against its live CODE wiring; the discrepancy scanner was used only to
surface candidates, which were then judged by reading. Breakdown: **187 ER-custom
moves** (pk ≥ 5000) + **844 ER-rebalanced vanilla moves** = 1031.

### Custom moves (187) — all read, botches fixed
- Chunk 1 (755–820): fixed via `dispatchBespokeMove` + the post-wire rider
  `applyErMoveBespokeRiders` in `init-elite-redux-custom-moves.ts`.
- Chunks 821–960: manual read caught ~12 botches the scanner missed — wired into the
  rider: 896 (clear weather+terrain), 926 (force-switch foe), 930 (Grassy Terrain),
  934 (clear hazards), 936 (break screens), 938 (Psycho Shift), 940 (drowsy), 942
  (Future-Sight delayed attack), 946 (2 hits), 959 (×1.5 vs bleeding). Plus earlier
  fixes (765/771/772/773/779/783/786/790/791/792/796/812/813/819/828/848/859/893/927/
  928/941/943/944/947/950/952/953/956/958/960/963/964/973/976/980/981/982/987/994/995/
  996/997/1000/1001/1002/1011/1013/1018/1031, …).
- Chunk 961–1033: fixed 968 Astral Hand + 992 Fire Glaive (`IgnoreOpponentStatStagesAttr`
  — "ignores stat boosts"), 986 Dragon Jab (30% `ER_BLEED`), 1005 Incite (added the
  TAUNT/"enrage" half), 1020 Dragon Dash (removed a spurious HighCrit not in the
  description), 1024 Godspeed (ABBR "Super effective vs Steel" → ×2 vs Steel; the FULL
  alone had hidden the clause). All others verified faithful.
- Systemic dispatcher fix carried over: `resolveStatusName` now maps FROSTBITE→ER_FROSTBITE,
  BLEED→ER_BLEED, FEAR→ER_FEAR (repaired every chance-status custom at once).
- 957 Bravado: faithful (×2 power when statused). The conditional-damage test was
  re-calibrated (Snorlax→Snorlax dealt ~30 dmg where the formula's +2/floor terms make
  ×2 power read as ~3.6× damage; switched to Mewtwo→Wobbuffet so the ratio is ~1.98×).

### Vanilla moves (844) — ER effect-changes wired
Numeric retunes already came from `init-elite-redux-vanilla-rebalance.ts`. ER's
**mechanic** changes (which that file never applied) are now in
`init-elite-redux-vanilla-move-patches.ts`:
- **Systemic crit pass** — reads each ER move's ROM `flags[]`: "High Crit Rate" →
  `HighCritAttr`, "Always Crits" → `CritOnlyAttr` (dropping a redundant HighCrit). Fixed
  21 vanilla moves at once (Cut/Slash/Aerial Ace/Flower Trick always-crit; Vise Grip/Horn
  Attack/Drill Peck/Fury Attack/Fury Swipes/Arm Thrust/Dragon Claw/Aqua Tail/X-Scissor/
  Double Hit/Dual Chop/Razor Shell/Spirit Shackle/Kowtow Cleave/Psyblade/Extrasensory
  high-crit).
- **Flinch swaps** (ER replaced the vanilla paralyze-on-hit with a 30% flinch): Thunder
  Shock (84), Lick (122).
- **Absolute never-miss** (authored desc "Never misses"/"Can't miss" → accuracy −1):
  Extrasensory (326), Kowtow Cleave (868), Tachyon Cutter (905), Flower Trick (869).
- **Conditional never-miss** via a move-intrinsic registry consulted in
  `MoveEffectPhase.checkBypassAccAndInvuln` (`conditional-always-hit.ts`):
  - "never misses if user is <Type>-type": Leech Seed/Grass (73), Thunder Wave/Electric
    (86), Will-O-Wisp/Fire (261), Flash Freeze/Ice (811c). (Toxic already had
    `ToxicAccuracyAttr`.)
  - "never misses in fog": Eerie Spell (754), Vexing Void (974c).
- **Super-effective vs <Type>** (×2 power vs that type, the same convention the custom
  SE-vs-type moves use): Razor Wind/Rock (13), Acid/Steel (51), Sludge/Water (124),
  Poison Gas/Flying (139), Sheer Cold/Water (329), Magnet Bomb/Steel (443), Gigaton
  Hammer/Steel (859), Godspeed/Steel (1024c). (Sonic Boom excluded — fixed damage; a
  power multiplier is a no-op there.)
- **Kinesis (134)** rewrite — vanilla accuracy-drop status move → ER item-removal
  (`RemoveHeldItemAttr`) + flinch.
- **Bitter Malice (814)** rework — vanilla 100%-Atk-drop → 30% frostbite + ×1.5 vs a
  statused target.

### #151 id-map collisions — RESOLVED
A scrambled gen8/9 block (35 vanilla moves, er ids 825–894) was mapped to the WRONG
pokerogue move by the beta-JSON build (e.g. Kowtow Cleave → Blood Moon, Axe Kick →
Trailblaze, Flower Trick → Matcha Gotcha), so those moves silently received another
move's rebalance + effects. Fixed by `remapEliteReduxMoveIdsByName()` (in
`init-elite-redux-c-source-corrections.ts`), now run from `init.ts` BEFORE the rebalance
+ move-patches consume the map. It repoints every vanilla ER move to the pokerogue
`MoveId` whose name matches the ER draft (covering both empty-slot holes and the
wrong-built-move landings the old hole-only remap skipped). Locked in by
`test/data/elite-redux/er-move-id-map-consistency.test.ts` (moveConst↔MoveId for all 844
vanilla moves + clean bijection). All previously "misrouted" moves (Kowtow Cleave, Flower
Trick, Axe Kick, Tachyon Cutter, Gigaton Hammer, Bitter Malice, …) now route correctly
and carry their audited effects.

### Notes
- 1018 Block Dropper: ABBR "20% flinch" is vestigial ROM short text — ROM `chance=0`
  encodes no flinch, and the FULL + name ("Drops 2–5 blocks") confirm multi-hit. Kept
  multi-hit only.
- Pre-existing, out-of-scope failures (confirmed present on the pristine tree via stash):
  the 3 #127 composite-rider **ability** tests (Dreamscape 859, Marine Apex 389, Nika 469).
