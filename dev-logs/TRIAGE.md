# Tester-log triage ledger

Persistent record of which reported bugs are RESOLVED, DISMISSED (not a bug /
by-design), or WON'T-FIX, so already-handled reports are not re-surfaced when
re-reading `dev-logs/remote/`. Append-only-ish; update status as things change.

Force-tracked (the `dev-logs/` dir is gitignored): committed with `git add -f`.

Legend: ✅ fixed (commit) · 🟢 already-fixed/by-design (no change needed) ·
🚫 won't-fix (maintainer call) · 🔎 open/under investigation.

## Resolved / closed — do NOT re-raise

| Report | Status | Notes |
|---|---|---|
| Item from Deal disappeared after rejoin (relics not persisted) | ✅ `1f9dff5a4` | ER relic save persistence; live on prod. |
| Save froze on Save & Quit / "saved locally not cloud" (MDR) | ✅ `c37b554f2` | localStorage QuotaExceededError (egg bloat); staging. Follow-up: egg-size cap (open). |
| Redux Scyther "ineligible for the challenge" (fainted lead) | ✅ `c6001af9b` | Challenge-worded message gated to real challenge fails; staging. |
| Beach didn't trigger harsh sunlight / new-biome weather missing | ✅ `4ff5640ea` | World Map transitions queued NextEncounterPhase, skipping weather/terrain; staging. |
| Double Itempool (crossroads/biome 2nd shop) | 🟢 `52c991262` | Already fixed (gated heal/shop to %10===1); live. Stale build report. |
| Learner's Shroom consumed on move-select back-out (#25) | ✅ `<pending>` | Added Shroom to the TM/Memory return-to-shop copy; staging. |
| Blast Burn made me rest a turn | 🟢 `52451c2e7` | Already fixed; live. |
| Decorate works wrong | 🟢 `52451c2e7` | Already fixed; live. |
| Steel Roller works without terrain | 🟢 `660a05868` | Already fixed; live. |
| Mimikyu Apex disguise not working | 🟢 `1d7c201f5` | Already fixed; needs re-test on current build. |
| Terapagos Primal "no primary type" / mega not registering | 🟢 `95121086b` | Stellar type mapping; live. |
| Rewards: graveyard tombstone / training / ghost give no reward (#22) | 🟢 — | NOT a current bug. Ghost battles = normal trainer rewards (verified). Graves PAY RESPECTS = 1 fallen item, DISTURB = 2 items (`grantDisturbMementos`); Training Session rewards on battle branches, "leave" branch is by-design no-reward. Ghost held-item recording landed `6b4743a72` (6-15), graves memento `d941106da` (6-16), direct-2-item rework `b0538f482` (6-18) - all deployed. Report predates these. Legacy itemless ghosts fall back to Ultra-tier / solid held items. |

## Dismissed — not a bug

| Report | Notes |
|---|---|
| Shiny Pentadug Alolan weird sprite | Maintainer: fine, not a bug. |
| Fluffiest "doesn't calculate fire weakness" | Verified dex-correct: contact x0.25 + Fire x4, multiplicative (a Fire CONTACT move nets x1). Bewarden's Fluffiest is an INNATE (candy/level gated). Not a code bug. |

## Won't-fix (maintainer call)

| Report | Notes |
|---|---|
| Hitmonlee didn't steal item from Jellicent / "Pickpocket should work offensively too" / Thievul Low Blow only on being hit | 🚫 Kicked off the list per maintainer (2026-06-20). Pickpocket/Low-Blow family - working as the maintainer intends. Do not re-raise. |

## Open / under investigation

| Report | Notes |
|---|---|
| Black shinies show as RED in egg-summary icons (hover shows black sparkles) | Egg-summary icon variant tint. Display-only. |
| Egg-bloat root cause (save size) | Freeze fixed; underlying save can still exceed quota. Decide: cap eggs / compress / leave. |
| Dev Scenarios scroll freeze (dustyvachon) | Scrolling the picker + backing out hard-freezes. Dev-tool only. |
| Mega abilities bugged (Ice Picks + Sundae on Mega Hydreigon) / Mega Excadrill lacks Mega Drill / Mega Hydreigon | Mega ability/move assignment - needs dex check. |
| Festivities doesn't work | wave 80 youngster. Needs repro. |
| Aqua Grunts with full Fire-type team | wave 112 - trainer team theme mismatch. |
| Enemy used Recover before my priority Gem Missile | Priority ordering vs Gem Missile - needs check. |
| Doubles bug ended my run | wave null youngster - needs repro. |
