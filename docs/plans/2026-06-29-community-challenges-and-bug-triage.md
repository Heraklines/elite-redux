# 2026-06-29 — Bug triage + Community Challenge System design

## A. Bug reports captured (this batch)

| # | Report | Type | Notes / first read | Status |
|---|--------|------|--------------------|--------|
| 1 | SE berries (Chople etc.) fully RESIST instead of halving SE damage | combat/damage | resist-berry should be x0.5 on a SE hit, not a full resist. | **BY-DESIGN** (2026-06-29). Berry IS x0.5 (measured 612->306). ~25% = boss teras into mono-Rock (sheds Dark weakness 4x->2x) THEN berry halves (2x->1x). Maintainer: leave as-is. |
| 2 | SE berries not counted as berries in the Delibirdy mystery event | data/ME | ER SE berries aren't in the berry set Delibirdy checks. | **FIXED** dec3056b4 — ErResistBerryModifier in allow/disallow lists + Candy Jar reward. Test + scenario. |
| 3 | Mystical Rock doesn't +2 turns to weather (Drought; unsure about Fog) | item | extender not applying to ER weathers. | **FIXED** dec3056b4 — erFieldTurnsWithItems (ability weather) + trySetWeather turnsOverride (entry-effect). FOG=8+ext, Drought=8+ext. |
| 4 | Razor Wind should be +1 priority while Tailwind is up | move mechanic | ER priority rider. | **FIXED** dec3056b4 — IncrementMovePriorityAttr on user-side Tailwind. In-battle verified. |
| 5 | Mega Scrafty can evolve (shouldn't) | evolution gating | block mega form evolving. | **FIXED** dec3056b4 — getValidEvolutions()=[] for mega/primal/max. |
| 6 | Terapagos Stellar form not implemented | form/data | Complex form-change wiring. | TODO (big) |
| 7 | Fainted Pokemon on the battlefield (hell doubles, the big log) | switch resolution | getNextSummonIndex slice breaks after a mid-turn reorder. | TODO (next) |
| 8 | Event won't allow doubles — challenge mode + Doubles only spawns singles | challenge/encounter | Doubles toggle not honored in (some) encounters. | TODO |
| 9 | Graves of the Fallen: itempool selection skipped, lost the run | ME flow | Reward/itempool selection bypassed. | TODO |

Request (mechanic, not a strict bug): abilities that set Tailwind/Aurora Veil/Trick Room on switch-in like terrain/weather; if speed still matters, give the on-entry cast +6 priority so the holder isn't flinched on switch-in. — TODO

Severity order: 1>3>5>4>2 (ALL DONE) > 7/8/9 (flow/switch, next) > 6 (Terapagos, big).

## B. Community Challenge System — design (the deep one)

Goal: players author custom challenges (allowed species + difficulty + modifiers like Doubles/Ghost Trainers), others browse + play. Creator must CLEAR it first with non-hacked mons (proof). No rewards now; later algorithmic by clearance rate. Entry: Challenge Mode -> submenu {Vanilla Challenges, Community Challenges}.

### Data model (D1, er-save-api)
`community_challenges`:
- id (slug), creator_user_id, creator_username
- name, description (custom text, moderated later)
- difficulty (youngster|ace|elite|hell)
- challenges (JSON [[challengeId,value],...] — reuses the existing Challenges enum: Doubles, GhostTrainers, FreshStart, Nuzlocke, ...)
- allowed_species (JSON number[] root speciesIds; null = all)
- constraints (JSON, extensible: levelCap, item bans, ...)
- status (pending | live | hidden)
- verified (bool), verification_run_id (the clearing run, audit trail)
- clear_count, attempt_count, created_at

`community_challenge_clears`: (challenge_id, user_id, run_id, cleared_at) — clearance rate + dedupe.

### Anti-cheat / verification (critical)
A challenge goes live only after the creator uploads a VICTORY run that:
1. config-matches the challenge (same difficulty + challenges + within allowed_species), AND
2. passes the hacked-mon checks we already built: IVs <= 31 (the upload IV clamp), plausible levels, no banned/legendary-egg-line abuse, species in the allow-list.
Reuses the existing run-upload pipeline + the new IV validation. Gold-standard later: attach a ReplayTrace (the record->replay infra) and re-run it server-side to confirm the clear is real. v1 = config-match + hacked-mon checks.

### Client UI
- Challenge Mode -> submenu: Vanilla vs Community.
- Community browser: filterable list (difficulty, modifiers, creator, clearance rate, new/popular), each card = name + description + difficulty + modifier chips + allowed-mon preview + clearance %. Must look good.
- Detail -> Play: launches a run with the saved difficulty + challenges + species restriction (a new "allowed-species" challenge check gating starter-select, mirroring the usage-tier legality gate).
- Create flow: name/description/difficulty/modifier toggles/species picker -> "clear it to publish" -> launches the configured run; on victory, uploads the verification run + flips the challenge live.

### Worker endpoints
- POST /community/challenge (create, status=pending)
- POST /community/challenge/:id/verify (attach clearing run; validate; -> live)
- GET /community/challenges?filter=... (browse, paginated)
- GET /community/challenge/:id (detail)
- POST /community/challenge/:id/clear (record a clear for the rate)
- moderation: status=hidden + report (later)

### Reuse
- Challenge config == existing Challenges enum values + an allow-list. Species restriction == a new challenge-type check at starter-select (like isErLineLegalForUsageTier).
- D1 + worker pattern == the ghost-pool sample/upload template.
- Anti-cheat == the IV clamp/validation + run-upload + (later) ReplayTrace re-run.

### Creator knobs (confirmed)
difficulty + existing challenge modifiers + allowed-species list + custom name/description, PLUS extra
economy/pacing tuners to design: gold gain multiplier, trainer-encounter frequency, and candidates to
consider — XP rate, shop/reward frequency, biome pool, starting level, ban specific items/abilities,
held-item allowance. Model these as a `constraints` JSON the run-launch reads (each maps to an override
or a challenge-type check), so the set is extensible without schema churn.

### Phasing
- P1 (MVP): D1 schema + CRUD endpoints; submenu + browser + create/verify flow; difficulty+modifiers+allowed-species+custom text; verify by config-match + hacked checks; no rewards. (Economy/pacing knobs land here if cheap, else P1.5.)
- P2: clearance-rate display + algorithmic rewards (golden tickets); moderation/reporting; ReplayTrace verification; richer constraints.

## C. Other patch-scale features (scoped separately)
- Achievement UI rework: infographic-style (requirement + REWARD shown, filtering/sorting). The reward mapping already exists (er-achievement rewards). Mostly a new/restyled handler + a reward-display column + filters.
- Custom ghost-trainer class: per-uploaded-ghost custom sprite + intro line + post-defeat line. Stored with the ghost snapshot (new optional fields) + rendered at ghost encounter/defeat. Shares the "creator content + moderation" infra with community challenges.
