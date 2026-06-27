I'll synthesize this into one cohesive build spec. This is a documentation/synthesis task grounded in the findings already provided, so I'll produce the spec directly.

# Elite Redux — Special Form Shinies: Build Spec

**Status:** Authoritative build spec. Resolves all four design drafts + three stress-test critiques into one schema and one phased plan. `tsc` baseline stays 267; CI gates biome + vitest.

---

## 0. The contract (resolves the cross-draft contradictions)

The four drafts contradicted each other on schema, on seed-vs-reroll, and on what crosses to other players. Frozen decisions:

| Concern | Decision |
|---|---|
| **Seed model** | A reroll **mutates a separately-persisted seed** (`erFormSeed`), never `pokemon.id`. `pokemon.id` is immutable identity (drives IVs/gender/shiny — `pokemon.ts:461`); it is only the *initial* value of `erFormSeed`. The "recompute from id, don't store" wording from drafts 1–3 is **deleted** — it is incompatible with reroll and with reproducing a rerolled look on a viewer. |
| **Palette** | Pure deterministic function `buildSpecialFormPalette(baseHexList, kind, seed)` feeding the **existing variant palette-swap shader path** (no new atlas, no new shader loop in the cheap path). |
| **Crossplay-visible** | `erFormKind` + `erFormSeed` (the rare FORM and its derived palette) travel as 2 optional ints on `GhostMember`. |
| **Local-only** | Aura *selection*, manual 2-color *swaps*, and member/tribute *sprites* do **not** travel. A ghost shows the canonical seed-derived form, never the owner's private tuning. This reconciles drafts 1/2 (auras cross) with draft 4 (local-only) — **auras are local-only; the FORM crosses.** |
| **Manual 2-color swap** | **Deferred** (v1 is seed-only). When added it is an explicit `erFormSwaps` overlay, local-only. |
| **Member/tribute sprites** | **Separate project** (Phase 4). Severed from the algorithmic layer. |
| **Luck** | Stays derived `max(base,5)` in `getLuck()` (`pokemon.ts:2136-2150`). t5 sets `erBlackShiny=true`, so **zero code change**. |
| **Headline claim** | "Same FORM identity (kind+seed) on every client; static recolor is pixel-identical; time-animated aura phase is not synchronized." Not "pixel-identical" unqualified. |

---

## 1. Two-layer model + exact hooks

**Layer 1 — PALETTE (color identity).** Deterministic, crossplay-faithful, rides the existing variant swap. The shader (`sprite-frag-shader.frag:163-170`) already replaces any texel matching `baseVariantColors[i]` with `variantColors[i]`. We *generate* that replacement list on the CPU instead of fetching it from JSON.

**Layer 2 — AURA (motion/overlay).** Animated, local-only cosmetic, rides the `PokemonSpriteSparkleHandler` architecture (Layer-A overlay sprites). Composes *on top* of the palette by z-order — never replaces color identity.

### Exact hooks

| Step | Hook | File:line |
|---|---|---|
| Palette generation | NEW pure module `er-form-palette.ts` → `buildSpecialFormPalette(baseHexList, kind, seed)` | new file |
| Seed the cache | NEW `buildSpecialFormVariantColors(pokemon)` mirroring `populateVariantColors`, writes `variantColorCache[\`${battleSpriteKey}-erform${kind}\`]` | `src/sprites/variant.ts:69-90`, `src/sprites/pokemon-sprite.ts:58-78` |
| Call seeding | Beside the existing `populateVariantColors` call | `src/field/pokemon.ts:909-911` |
| Pipeline branch | In `onBatch`, BEFORE the `variantColorCache[textureKey][variant]` lookup: if parent mon `isErSpecialForm`, select the `-erform${kind}` key | `src/pipelines/sprite.ts:131` |
| Aura overlay handler | NEW `ErAuraHandler` cloning `PokemonSpriteSparkleHandler`; one global ticker + `Set<Pokemon>` | `src/field/pokemon-sprite-sparkle-handler.ts` (model) |
| Instantiate handler | Beside `spriteSparkleHandler.setup()` | `src/battle-scene.ts:753` |
| Register mon | Beside `spriteSparkleHandler.add(sprite)` | `src/battle-scene.ts:2551` |
| Attach aura child | `addFieldSprite` → `this.add(s)` (or `addAt(s,0)` behind), like `initShinySparkle` | `src/field/pokemon.ts:1481-1488` |
| Re-attach on re-summon | Same call sites as `initShinySparkle()` | `src/field/pokemon.ts:620,762,800,821,4023,4069` |

**No shader edit in v1.** The animated in-shader path (rainbow hue-cycle, aurora drift, WAVEY/GLITCH UV) is Phase 3, behind a `globalScene.auraEffects` flag, eyeball-verified only.

---

## 2. Data model (compact, crossplay-safe, quota-safe)

### `CustomPokemonData` (runtime, save-safe) — `src/data/pokemon/pokemon-data.ts:72-74` + ctor `:142-144`

```ts
erSpecialForm = false;        // 1 logical bit; implies erBlackShiny=true
erFormKind = 0;               // uint8, index into ER_FORM_KINDS (0=none)
erFormSeed = 0;               // uint32, INIT = pokemon.id, independently mutable
erFormRerolls = 0;            // uint16, candy/run-win reroll counter
erAuraEffect = 0;             // uint8, 0=none/opt-out, LOCAL-ONLY
```

Round-trips automatically via `PokemonData → new CustomPokemonData(source.customPokemonData)` (`src/system/pokemon-data.ts:77,162`). No worker/D1 change.

### `StarterDataEntry` (per-line unlock) — `src/@types/save-data.ts:234` (mirror on Starter `:198`, StarterAttributes `:173`)

```ts
erSpecialForm?: boolean;
erFormUnlockedKinds?: number[];   // for menu sparkle + which kinds owned
```

Set in `setPokemonCaught` (`game-data.ts:2375-2376`) and `grantBlackShiny` (`er-achievement-rewards.ts:313-319`); re-granted at run start (`select-starter-phase.ts:286-289`).

### `GhostMember` (crossplay) — `src/data/elite-redux/er-ghost-teams.ts:56-73`

```ts
erFormKind?: number;   // uint8, optional
erFormSeed?: number;   // uint32, optional
// NOT: erAuraEffect, NOT swaps, NOT member-sprite — local-only
```

**Byte budget:** per special mon, ~2 ints over the wire (`erFormKind` 1 byte, `erFormSeed` 4 bytes) — emitted only when `erSpecialForm`. Rides `runs.player_team = JSON.stringify(party)` (worker `index.ts:869`, re-parsed `:1220/:1293`) with **zero schema change, zero migration**. Negligible vs `dexData`/`eggs[]`; sub-byte after GZ1 (server) / LZ1 (client). MAX_SAVE_BYTES=4_000_000 and the D1 500MB / 100k-writes-day caps are untouched.

**Gift on ghosts:** keep carrying the **3 resolved gift ability ids** (~36 bytes) on the ghost UNTIL a parity vitest proves seed-only re-derivation is bit-identical (critique #1 holes 3–4: `executeWithSeedOffset` from `trainer.ts:352` is NOT in scope inside `applyErGhostOverride`, and `drawDistinctFromPool` draws against the global seed RNG). 36 bytes is below the noise floor; correctness first.

---

## 3. Phaser implementation per layer + 2D fallback

### Layer 1 — palette (shader path)

- `er-form-palette.ts` ports the shader's exact `rgb2hsv`/`hsv2rgb` math (`sprite-frag-shader.frag:154-158`) so CPU and GPU agree. Transforms operate in HSV on the **same ordered base-color key list** the variant JSON already ships — never expands count (respects the **32-pair hard cap**, `frag:163` / `onBatch c<32`).
- Five static kinds: **METALLIC** (s·0.12, v=pow(luma,0.85)), **GHOST** (h→0.78, v·0.55 + sprite/tintSprite `setAlpha(0.7)` at summon like `applyErBlackShinyInterimTint`, `er-black-shinies.ts:257-277`), **CELESTIAL** (value→seed-phased aurora band), **RAINBOW** (hue+seedPhase, static per seed), **OUTLINE-cool** (h→0.55, s+0.2 rim palette — data-only; true glowing outline needs quad expansion → Phase 3).
- **2D fallback:** WebGL pipeline doesn't run in the harness (`MockSprite.setPipeline` no-op `mock-sprite.ts:52`; `game-wrapper.ts:113-114`). Palette degrades to the **plain uncolored sprite** — mon still renders correctly. `buildSpecialFormPalette` is **pure + unit-testable** for determinism; that is the only CI-checkable proof of color fidelity.

### Layer 2 — aura (overlay)

- ONE global infinite counter-tween (`tweens.addCounter({duration:200, yoyo:true, repeat:-1})`), `Set<Pokemon>`, `onLapse`. Per-mon `repeat:-1` child sprite (NOT respawn-and-destroy — that churns GC). **Avoid** the sparkle handler's per-tick `texture.manager.getPixel` readback (`pokemon-sprite-sparkle-handler.ts:45`) — precompute opaque texels once. Phase/hue/drift seeded from `pokemon.id` via `executeWithSeedOffset`.
- Auras live on **container z-order**, drawn on **unit-0** (a `setTintFill`/unit-1 collision would discard the palette swap — critique #2).
- **2D fallback:** `MockSprite.play` is a no-op (`mock-sprite.ts:195`); overlay shows its **default frame** (static halo), never crashes. Force auras **off** in the harness so golden baselines don't churn.

### Local sprite layer (Phase 4) — cache-corruption-safe

Severed from v1, but the safety contract is fixed now so it can't poison textures later:
- Storage in **IndexedDB** (not localStorage — keeps the ~5MB save quota clean).
- **Versioned, content-hashed texture keys**: suffix `-ermod_<modId>_v<ver>_<sha8>` (extends the `-erblack` precedent at `pokemon.ts:1198-1216`). New upload → new sha → new key → Phaser cannot serve a stale texture. Call `globalScene.textures.remove(oldKey)` on re-upload (Phaser does not GC textures automatically — critique #2).
- **Integrity check on import**: sha256 match, dims/frame-count match the JSON map, **reject >32 palette colors**. Fail → drop the mod, fall back to bundled.
- **Wrong-class guard**: only consult the registry when `isErSpecialForm(pokemon) && sfTier===mod.tier && kind===mod.kind`.
- **Load at refresh before first summon** (like `initVariantData`, `battle-scene.ts:538/1491`); mid-session uploads take effect on next summon only.

---

## 4. Collector progression + UI

### Roll (Axis 1) — `maybeUpgradeToErBlackShiny` (`er-black-shinies.ts:110-143`)

Inside the existing function (inherits the one-per-team cap `playerHasErBlackShiny:63-69` and seeded context), **inside the try, AFTER `applyErBlackShinyKit` at :137**:

```ts
if (randSeedInt(erBalanceNum("er.shiny.specialFormDenominator")) === 0) {
  data.erSpecialForm = true;
  data.erFormKind = 1 + (hash(data.id) % (ER_FORM_KINDS.length - 1));
  data.erFormSeed = data.id;
}
```

- Knob `er.shiny.specialFormDenominator` default **7** (range 5–10) — `er-balance-knobs.ts:102-112` + `editor/data/balance-knobs.json`. Net t5 rate = P(epic)·1/50·1/7.
- **`resetErBlackShinyState` (`:151-158`) MUST also clear `erSpecialForm`/`erFormKind`/`erFormSeed`/`erFormRerolls`** — otherwise a discarded `EnemyPokemon` re-roll dangles a t5 flag on a non-shiny mon (critique #3, the exact bug that function exists to prevent).
- Add `isErSpecialForm()` reader (mirror `:58-60`) + `Overrides.ER_SPECIAL_FORM_PLAYER/ENEMY_OVERRIDE` (mirror `:116-124`).

### Luck — zero change. `getLuck()` already returns `max(base,5)` for `erBlackShiny`.

### Reroll — overwrites `erFormSeed` with `randSeedInt(2^32)`, bumps `erFormRerolls`. Free token on classic victory (`game-over-phase.ts` clear() victory branch `:234-255`, surviving `getPlayerParty().filter(p=>!p.isFainted())`) OR candy-spend (`persistentStarterData.candyCount -= cost`, precedent `starter-select-ui-handler.ts:2772/2810/2852`). Gated out-of-combat via `isErGiftCycleAllowed` (`:188-190`).

### Aura select + opt-out — `erAuraEffect=0` removes the overlay; run-win unlocks options; player cycles. Always reversible. Local-only.

### Crossplay apply — `applyErGhostOverride` (`er-ghost-teams.ts:999-1062`)

The function **never touches `enemy.customPokemonData` today** and is wrapped in a `try/catch → return null` (critique #1 holes 2,3,9). Required edits, **after `enemy.variant` (~:1047)**:

```ts
// clamp first — D1 blob is opaque/unvalidated (worker INSERT 855-878)
const kind = clampToRegistry(member.erFormKind);   // out-of-range → 0 → plain
if (kind) {
  enemy.shiny = true; enemy.variant = 2;
  enemy.customPokemonData.erBlackShiny = true;
  enemy.customPokemonData.erSpecialForm = true;
  enemy.customPokemonData.erFormKind = kind;
  enemy.customPokemonData.erFormSeed = toUint32(member.erFormSeed ?? member.id);
  buildSpecialFormVariantColors(enemy);   // EXPLICIT re-seed — do NOT rely on "normal summon path"; mon was built at :1036 before custom data existed
  applyErBlackShinyInterimTint(enemy);    // tint floor until atlases land
}
```

Bounds-clamp every new field **before indexing** so an out-of-range value degrades to plain instead of throwing → returning null → vanishing the mon.

### UI / name treatment

- **5th starter sparkle** for t5, distinct tint, gated on `starterDataEntry.erSpecialForm` — `starter-select-ui-handler.ts:4281-4286`, `pokedex-ui-handler.ts:2016-2021`.
- **Nameplate marker** — extend `promoteToErBlackShinyInBattle` (`er-black-shinies.ts:230-255`) with a t5 glyph/color; decorate the summary name at render (do not mutate stored nickname).
- **Collector controls** (reroll, aura select) on the summary Abilities page beside the black gift row + R-cycle (`summary-ui-handler.ts:729-746,1791-1802`), candy-gated, out-of-combat only.

---

## 5. Phased rollout (exact files per phase)

### Phase 1 — Minimum-Lovable v1 (~3–4 days): one rare form, one rerollable palette, visible to all

One t5 form, **METALLIC** kind only (cheapest recognizable look), seed-rerollable, crossplay-faithful. No aura, no swap, no member sprites, no shader edit.

- `src/data/elite-redux/er-form-palette.ts` *(new)* — pure `buildSpecialFormPalette` + METALLIC + rgb/hsv port + determinism-friendly.
- `src/data/pokemon/pokemon-data.ts` — `erSpecialForm/erFormKind/erFormSeed/erFormRerolls` (+ ctor).
- `src/data/elite-redux/er-black-shinies.ts` — t5 sub-roll, `resetErBlackShinyState` clears t5, `isErSpecialForm`, override.
- `src/data/elite-redux/er-balance-knobs.ts` + `editor/data/balance-knobs.json` — `specialFormDenominator`, `rerollCandyCost`.
- `src/sprites/variant.ts` (+ `pokemon-sprite.ts`) — `buildSpecialFormVariantColors`, called from `pokemon.ts:909-911`.
- `src/pipelines/sprite.ts:131` — `onBatch` special-form branch.
- `src/@types/save-data.ts` — `StarterDataEntry.erSpecialForm/erFormUnlockedKinds`.
- `src/system/game-data.ts`, `src/phases/select-starter-phase.ts`, `src/data/elite-redux/er-achievement-rewards.ts` — unlock + re-grant + run-win reroll token.
- `src/data/elite-redux/er-ghost-teams.ts` — `GhostMember.erFormKind?/erFormSeed?`, `serializeMember:411-431` emit, `applyErGhostOverride:1047` apply + **clamp** + explicit re-seed.
- `src/ui/handlers/starter-select-ui-handler.ts`, `pokedex-ui-handler.ts`, `summary-ui-handler.ts` — 5th sparkle, nameplate marker, reroll row.
- **Tests** `test/tests/elite-redux/`: (a) `buildSpecialFormPalette` determinism (same kind+seed → identical 32 hexes); (b) `GhostMember` round-trip serialize→parse with the new fields; (c) clamp test (out-of-range kind → plain). Plus an `ER_SPECIAL_FORM_*_OVERRIDE` dev-suite scenario for in-browser eyeballing (the **only** place the recolor truly renders — harness approximates it away).

### Phase 2 — Aura layer + remaining static kinds (~2–3 days)

- `src/field/er-aura-handler.ts` *(new)* — clone `PokemonSpriteSparkleHandler`; instantiate `battle-scene.ts:753`, register `:2551`, attach `pokemon.ts:1481` + re-attach sites.
- `CustomPokemonData.erAuraEffect` already declared; wire run-win grant (`game-over-phase.ts:234-255`) + select/opt-out UI (`summary-ui-handler.ts`).
- `er-form-palette.ts` — add GHOST/CELESTIAL/RAINBOW-static/OUTLINE-cool (free, data-only). GHOST `setAlpha` at summon spots.
- Gate aura behind `globalScene.auraEffects` settings flag (pattern `sprite.ts:88`). **Local-only — not added to GhostMember.**

### Phase 3 — Animated shader auras + manual swap (separate, flag-gated, in-browser-verified)

- `sprite-frag-shader.frag` uniforms `auraType/auraTime/auraSeed/auraColor`; push in `onBind` (`sprite.ts:37-86`, copy `teraTime` at `:68`); post-swap branch (RAINBOW hue-cycle, CELESTIAL drift, WAVEY/GLITCH UV — **clamp displaced UV to frame box**, critique #2). True glowing OUTLINE via `batchQuad` expansion (`sprite.ts:168-235`). Manual 2-color `erFormSwaps` overlay, local-only. Not CI-gateable — eyeball only.

### Phase 4 — Member/tribute community local-sprite hub (entirely separate project)

- `member-sprite-manifest.ts` (mirror `er-black-sprite-manifest.ts`), atlas redirect in `getSpriteAtlasPath/getBattleSpriteAtlasPath` (`pokemon.ts:1104-1158`), `-ermember`/content-hashed keys (`:1198-1215`), IndexedDB `ModRegistry` + integrity checks + `textures.remove` on re-upload. **Never added to `GhostMember`** (would 404 on viewers lacking the mod; bundled form is the graceful floor).

---

## 6. Verification (what CI can and cannot prove)

CI proves only: (1) `buildSpecialFormPalette` determinism; (2) gift parity (once seed-only re-derive is attempted — until then keep the 3 ids on the wire); (3) `GhostMember` field round-trip serialize→parse; (4) clamp/degrade-to-plain. **Rendered fidelity** (palette colors, aura particles, cross-client visual match) is **eyeball-only** in-browser per CLAUDE.md — the 2D/headless harness approximates palette-swap and glow FX away. Ship one `ER_SPECIAL_FORM_*_OVERRIDE` / `ER_AURA_OVERRIDE` dev-suite scenario per kind so testers field a ghost of each form and confirm visually. Any combat-observable change (the t5 gift/luck path) also needs the in-game dev-suite scenario + headless scenario-runner per standing rules. `tsc` baseline stays 267.

---

**Key files:** `src/data/elite-redux/er-form-palette.ts` (new), `src/data/pokemon/pokemon-data.ts`, `src/data/elite-redux/er-black-shinies.ts`, `src/sprites/variant.ts`, `src/sprites/pokemon-sprite.ts`, `src/pipelines/sprite.ts`, `src/field/pokemon.ts`, `src/data/elite-redux/er-ghost-teams.ts`, `src/@types/save-data.ts`, `src/field/er-aura-handler.ts` (Phase 2, new), `src/pipelines/glsl/sprite-frag-shader.frag` (Phase 3).

---

## Appendix: stress-test critiques (raw)

### Critique 1: PARTIALLY SUPPORTED — the crossplay mechanism is mechanically sound and the quota story holds, BUT there are concrete, unaddressed holes that break "a friend sees the real palette + aura" and that the proposals contradict each other on. Default-refuted items below are the ones I could not find proven in code.

Holes:
- CONTRADICTION between proposals on whether the special form reaches ghosts at all. Proposals #1 and #2 say to ADD erFormKind/erFormSeed (and auraId/auraSeed) to GhostMember + serializeMember + applyErGhostOverride so a friend sees it. Proposal #4 (the 'collector progression' block) EXPLICITLY says the opposite: 'We do NOT extend [GhostMember] for erSpecialForm/erSecretPalette/erAuraEffect/member-tribute' and that member/secret content is 'DELIBERATELY local-only'. Both cannot ship. As written, if #4's framing wins, the friend sees NOTHING special (variant-2 red ceiling persists) — the exact gap the task asks about. This must be resolved: which special-form attributes are crossplay vs local-only.
- applyErGhostOverride (er-ghost-teams.ts:999-1062) NEVER touches enemy.customPokemonData. It sets shiny/variant/passive/moves directly. Verified: lines 1046-1047 set enemy.shiny/enemy.variant and there is no customPokemonData write anywhere in the function. So even after extending GhostMember + serializeMember, the proposals' claim that 'the rebuilt EnemyPokemon renders the identical palette' is UNPROVEN unless this function is edited to (a) set enemy.customPokemonData.erFormKind/auraId, AND (b) re-trigger buildSpecialFormVariantColors / initAura. The proposals assert this happens 'through the normal summon path' but addEnemyPokemon(...) at line 1036 builds the mon BEFORE any custom data is set, and there is no later summon hook shown that would rebuild the variant cache. Risk: data lands on the mon but the recolor/aura is never re-seeded, so the friend still sees a plain mon.
- applyErGhostOverride is wrapped in a try/catch that returns null on ANY throw (lines 1004/1059-1061). Proposal #3's plan to re-derive the black-shiny gift via applyErBlackShinyKit 'under member.erGiftSeed wrapped in executeWithSeedOffset' adds RNG + ability-pool calls inside this catch. If that re-derivation throws (e.g. ER_ID_MAP miss, pool empty, seed-context not active because trainer.ts:352's executeWithSeedOffset is NOT in scope here — it is in genPartyMember, a DIFFERENT function), the WHOLE ghost mon silently returns null and the friend sees a missing/replaced enemy, not a special form. The seed-context claim ('executeWithSeedOffset already active') is unproven for applyErGhostOverride's call site.
- DETERMINISM of the gift re-derivation is asserted but unproven for the crossplay path. drawDistinctFromPool (er-black-shinies.ts:72-84) uses randSeedInt against the GLOBAL seed RNG, not a local seeded stream. The owner drew the 3 abilities during its run under its run-seed; the viewer must reproduce them under member.erGiftSeed. Nothing in applyErGhostOverride establishes that seed context. Carrying erGiftSeed only works if the re-derive is wrapped in executeWithSeedOffset(seed) AND drawDistinctFromPool is reachable — neither is wired today. Until a parity vitest (owner-vs-viewer same 3 ids) exists, treat 'identical gift on viewer' as REFUTED.
- COMMUNITY/MEMBER sprites are LOCAL-only by design (atlas under er-assets images/pokemon/member/, resolved at getSpriteAtlasPath). A viewer WITHOUT the mod falls back to the bundled black-shiny atlas via erBlackSpritePath — this IS graceful and still 'special' (black atlas + tint + gift), PROVIDED the bundled black atlas actually ships. But er-black-shinies.ts:54-55 shows the black sprite is STILL an interim TINT (ER_BLACK_SHINY_TINT 0x35323d) 'until the generated t4 assets land'. So today the graceful fallback for a black/special form a viewer lacks is a flat tint, not a real palette. The proposals' algorithmic-palette layer (#1) would fix this ONLY if erFormKind/erFormSeed travel AND buildSpecialFormVariantColors runs on the viewer — see hole #2. Net: 'graceful + still special' is true for the tint floor, but 'sees the real palette' is currently unmet.
- HARNESS BLIND SPOT makes crossplay fidelity UNVERIFIABLE in CI. CLAUDE.md states the 2D/headless harness cannot reproduce variant palette-swap colours, shaders, or glow/particle FX, and that real save/cloud round-trips can't reproduce headlessly. Both proposals acknowledge this but it means the central claim — 'pixel-identical on every client' — can only be asserted, never tested by the standing combat/UI runners. The only testable slice is the PURE buildSpecialFormPalette determinism unit test. Aura/animation/cross-client identity is eyeball-only in-browser. This is a verification hole, not a code bug, but it means 'a friend sees the real palette + aura' cannot be proven by the project's own gates.
- QUOTA: the per-mon wire cost claim (2-7 small ints) is CORRECT and rides runs.player_team = JSON.stringify(party) (worker index.ts:869) with ZERO schema change, ZERO new requests, opaque blob re-parsed at :1220/:1293. Verified. BUT one unproven sub-claim: proposal #3 says drop the 3 resolved gift ability ids from the ghost and carry only erGiftSeed (uint32) to save ~36 bytes. That trades bytes for the determinism RISK in holes #3/#4 — if the seed re-derive is not bit-identical, you save 36 bytes and corrupt the gift. The byte saving is real but the trade is only safe AFTER a parity test exists; today it is a net regression risk.
- ANIMATED aura (RAINBOW/CELESTIAL drift) crossplay: proposal #2 concedes 'time-driven animation need not be synchronized across clients to be the same form.' This is reasonable, but it means 'a friend sees the real aura' is only true up to PHASE, not frame-identical. Fine for cosmetics, but the 'pixel-identical on every client' headline is overstated for animated kinds — phase differs by wall-clock. Minor, but the claim should be scoped to 'same FORM/seed', not 'same pixels'.
- GHOST legality / clamp gap. Proposals say 'clamp auraId/erFormKind to registry length on apply (unknown id -> no aura/plain)'. Nothing in applyErGhostOverride does input validation today (it trusts member fields directly: variant at 1047, ivs at 1041). A malformed/hostile snapshot (D1 blob is opaque, worker never inspects it — confirmed, no validation in the INSERT path 855-878) could carry an out-of-range erFormKind/auraId. Without the clamp the viewer indexes ER_AURA_EFFECTS[bad] -> undefined -> potential throw -> whole mon returns null (the try/catch). So the 'degrades to plain' guarantee is NOT free; it requires explicit bounds checks the current apply path lacks.

Fixes: ["RESOLVE the cross-proposal contradiction explicitly: split special-form state into CROSSPLAY-faithful attributes (algorithmic palette kind+seed, aura id+seed, erBlackShiny+gift seed — these are pure functions of shipped data, so they reproduce on any client) vs LOCAL-ONLY attributes (community/member uploaded atlases, secret rerollable palettes that are owner-private). Add ONLY the former to GhostMember. Document that member-tribute art and secret palettes intentionally do NOT travel and degrade to the bundled algorithmic/black look — which is still 'special'. This reconciles #1/#2 with #4.","Edit applyErGhostOverride (er-ghost-teams.ts, after line 1047) to set enemy.customPokemonData.erFormKind/erFormSeed/auraId/auraSeed/erBlackShiny from the member, THEN explicitly call the re-seed hooks: buildSpecialFormVariantColors(enemy) and initAura(enemy) (or the updateSpritePipelineData path) so the variant cache + overlay are populated for the freshly-built EnemyPokemon. Do NOT rely on 'the normal summon path' — the mon is built at line 1036 before custom data exists. Add this as an explicit step.","Make the gift re-derivation crossplay-safe and self-contained: wrap it in globalScene.executeWithSeedOffset(member.erGiftSeed, ...) INSIDE applyErGhostOverride (do not assume an ambient seed context — trainer.ts:352's offset is not in scope here), guard every ER_ID_MAP lookup, and ensure a pool-empty/throw path leaves the mon as a plain epic shiny rather than returning null. Better: keep carrying the 3 resolved gift ability ids in the ghost (36 bytes is negligible per the quota math) UNTIL a vitest proves owner==viewer parity; only then switch to seed-only.","Add a determinism parity vitest under test/tests/elite-redux/ that: (a) runs buildSpecialFormPalette(baseHexList, kind, seed) twice and asserts identical output (pure-fn determinism), and (b) simulates owner-side gift draw vs viewer-side re-derive under the same seed offset and asserts the same 3 ability ids. This is the ONLY CI-checkable proof of crossplay fidelity given the harness cannot render the pixels.","Add explicit bounds/sanity clamps in applyErGhostOverride for every new member field: erFormKind/auraId clamped to registry length (out-of-range -> 0 -> plain), erFormSeed/auraSeed coerced to a valid uint, before any indexing. Since the D1 blob is opaque and unvalidated by the worker (confirmed at INSERT 855-878), the client is the only validation layer — make degrade-to-plain a guaranteed code path, not an assumption.","Land real generated black/special-form atlases (or commit to the algorithmic palette as the canonical look) so the 'graceful fallback' a viewer-without-mod sees is the intended palette, not the interim 0x35323d tint (er-black-shinies.ts:55). Until then, state honestly that the viewer-without-mod floor is a flat tint, which is 'special' but not 'the real palette'.","Scope the headline claim from 'pixel-identical on every client' to 'same FORM identity (kind+seed) on every client; static recolor is pixel-identical, time-animated phase is not synchronized'. This is the defensible, accurate version and avoids over-promising frame-sync that cosmetics neither need nor provide.","Verification plan must be explicit that CI can only prove (1) pure-palette determinism, (2) gift parity, (3) save/snapshot round-trip of the new optional fields (a vitest that serializes a member with the fields set and re-parses). Actual rendered fidelity (palette colors, aura particles, cross-client visual match) MUST be eyeballed in-browser per CLAUDE.md — add an ER_*_OVERRIDE dev-suite scenario per kind so testers can field a ghost of each form and visually confirm."]

### Critique 2: FEASIBLE with caveats.

Holes:
- SPARKLE getPixel readback stalls render
- WAVEY UV must clamp to frame box
- tera unit-1 collision
- setTintFill discards swap
- Phaser does not GC textures
- Layer A churns goldens
- MockSprite.setPipeline forwards not no-op

Fixes: Precompute sparkle texels; clamp UV; keep auras unit-0; ghost auraAlpha after tintEffect; textures.remove on re-upload; force auras off in harness; verify via render-sprite.mjs plus determinism vitest.

### Critique 3: PARTIAL — The core scaffold (t5 flag riding erBlackShiny, palette-via-variant-shader, aura-via-sparkle-handler, crossplay-as-2-ints) is coherent and implementable, and the rarity/luck math is sound. But the proposal as written has THREE product-coherence defects that must be fixed before build: (1) a hard seed-determinism vs reroll contradiction — `pokemon.id` is persisted and is the SAME seed used for IVs/shiny/ability, so "reroll regenerates from pokemon.id" is impossible without breaking the mon's identity; (2) the two-layer (palette+effect) + secret/reroll + member-shinies + t5 promotion is too large and conceptually muddy for v1 (collectors can't tell what's earned vs random vs modded vs cross-player-visible); (3) the four design documents disagree with each other on the data model (sfSeed/sfPaletteId/sfEffectId/sfTier vs auraId/auraSeed vs erFormKind/erFormSeed vs erSecretPalette[][]/erAuraEffect) — there is no single agreed schema, so "implementable" is not yet true. Recommend shipping a tightly-scoped Minimum-Lovable v1 and deferring the rest behind explicit phase gates.

Holes:
- RARITY MATH — CONSISTENT & IMPLEMENTABLE, with one caveat. The chain is: shiny (base) -> variant-2 EPIC (red) -> BLACK at 1/blackShinyDenominator (=50, er-black-shinies.ts:101,52) -> t5 SPECIAL FORM at 1/specialFormDenominator (7) of blacks. Net t5 rate = P(epic) * 1/50 * 1/7 = epic/350. That is internally consistent and the nesting inside maybeUpgradeToErBlackShiny (er-black-shinies.ts:110) correctly inherits the one-per-team cap (playerHasErBlackShiny :63) and the seeded RNG context. LUCK: getLuck (pokemon.ts:2149) keys off erBlackShiny, and t5 sets erBlackShiny=true too, so luck stays Math.max(base,5)=5 with ZERO code change — the doc's claim holds. CAVEAT/HOLE: the t5 sub-roll must be placed AFTER applyErBlackShinyKit at :137 AND inside the try so a throw can't leave a half-promoted mon; and resetErBlackShinyState (:151) currently clears only erBlackShiny/erGift* — it MUST also clear erSpecialForm or a discarded EnemyPokemon re-roll dangles a t5 flag on a non-shiny mon (the exact bug the reset function exists to prevent).
- SEED-DETERMINISM vs REROLL — DIRECT CONTRADICTION (the question's core concern is real). Verified: pokemon.id is randSeedInt(2^32) at pokemon.ts:461 AND is persisted (dataSource.id, pokemon.ts:420 / system/pokemon-data.ts:95) AND drives IVs (:462), gender (:778), shiny/ability. Design docs 1-3 say the secret palette/aura seed 'DEFAULTS to pokemon.id and is recomputed, not stored.' Design doc 4 says reroll 'regenerate from a fresh seed offset.' These cannot coexist: if the palette is a pure function of pokemon.id, a reroll has NOTHING to mutate (pokemon.id is immutable identity — changing it would re-roll the mon's IVs/gender). So a reroll CANNOT regenerate-from-id; it MUST mutate a SEPARATE persisted field. Doc 1's sfSeed-stored-separately path is the only correct one; doc 1/2's 'seed normally recomputed not stored' path is incompatible with reroll and with crossplay (a recomputed-from-id seed on the viewer would need the viewer to know pokemon.id, which GhostMember does carry as p.id — but a REROLLED palette would then NOT reproduce because the viewer recomputes from id, not from the rerolled seed).
- REROLL MUST MUTATE A PERSISTED SEED, NOT THE ALGORITHM — and the docs half-acknowledge this but the default-path wording undermines it. Correct model: store erSecretSeed?:number on CustomPokemonData, initialized = pokemon.id on first reveal, then a reroll OVERWRITES erSecretSeed (and bumps a rerolls counter), and the palette = buildSpecialFormPalette(baseHexList, kind, erSecretSeed). The 2-color SWAP is different again — it is a manual edit, NOT seed-derived, so it needs erSecretPalette overrides stored explicitly (doc 4's [number,number][] pairs) and the swap result is NOT reproducible from any seed. CONFLICT: doc 4 stores the full [number,number][] pair list (up to 32 pairs, ~persisted) while docs 1-3 store only a 16-bit seed. You cannot support manual 2-color swap with a seed-only model. Decision required: either (a) seed-only + reroll, NO manual swap (compact, crossplay-clean), or (b) store explicit pairs to allow swap (heavier, but swaps are exactly what the maintainer wants for 'tuning a tribute mon').
- TWO-LAYER COLLECT/SHOW-OFF — INTUITIVE in principle, CONFUSING as specified. The palette(color identity) + effect(aura) split is a sound mental model ('what color' x 'what motion') and composes cleanly in the shader (palette swap then aura modulation). BUT the proposal muddies it with FOUR overlapping concepts the collector must distinguish: (1) t5 SPECIAL FORM (rolled, rare), (2) SECRET PALETTE (per-save, random, rerollable), (3) AURA EFFECT (run-win granted, selectable), (4) MEMBER/TRIBUTE SHINY (local mod, not rolled). A player seeing a recolored mon cannot tell if it is t5, a secret-palette reroll, or a modded tribute — and three of those are invisible to other players (crossplay-stripped) while t5+aura are visible. That is the coherence failure: the SAME visual surface (recolored sprite) encodes 4 different acquisition stories with different visibility rules. Collectors need a single legible answer to 'is this rare, did I earn it, can others see it.'
- VISIBILITY/CROSSPLAY INCONSISTENCY is a product trap. Doc 1/2 push t5+aura ACROSS crossplay (kind+seed on GhostMember). Doc 4 deliberately keeps secret-palette + aura + member-shiny LOCAL-ONLY (never on GhostMember). So the design simultaneously says auras ARE and ARE NOT cross-player. A collector who spends candy rerolling a secret palette and assigns an aura, then fields it as a ghost, will have the aura show (doc1/2) OR not show (doc4) depending on which doc wins. This must be resolved to ONE rule. Recommended: t5 form (palette KIND) + its derived palette ARE cross-player (2 ints, reproducible); per-mon manual SWAPS and aura SELECTION are local-only cosmetic (the ghost shows the canonical t5 look, not the owner's custom tuning). That keeps 'rare form is visible to all, personal tuning is private' — a legible contract.
- MEMBER-SHINY / community local-mod hub is OUT OF SCOPE for any near-term cut and should be severed from this feature entirely. It introduces IndexedDB, content-hashed versioned texture keys, integrity checks, a ModRegistry, and atlas redirection (doc 3/4) — an entire sprite-modding subsystem. It shares almost nothing with the palette/aura algorithmic layer except the word 'shiny.' Bundling it inflates the effort estimate and the cache-safety risk surface. Cut it to its own future project.
- ANIMATED shader path (rainbow cycle, aurora drift, WAVEY/GLITCH UV displacement, true glowing OUTLINE via quad expansion) is correctly flagged by the docs as a separate larger increment, but it is listed alongside v1 kinds in a way that invites scope creep. The 2D/headless harness CANNOT verify any of it (CLAUDE.md), so it cannot be CI-gated and must be eyeballed in-browser — a real velocity tax. Keep it strictly behind a settings flag and a later phase.
- NO SINGLE DATA SCHEMA EXISTS across the four docs (sfSeed/sfPaletteId/sfEffectId/sfTier vs auraId/auraSeed vs erFormKind/erFormSeed vs erSecretPalette+erAuraEffect+erSpecialForm). Until one schema is chosen, 'implementable' is aspirational. The CustomPokemonData additions, GhostMember additions, and StarterDataEntry additions are all spec'd differently in each doc.

Fixes: ["RESOLVE THE SEED/REROLL CONTRADICTION (blocking). Adopt doc 1's stored-seed model and DELETE the 'seed recomputed from pokemon.id, not stored' wording from docs 1-3. Schema: CustomPokemonData += erSpecialForm:boolean, erFormSeed:number (uint32, INITIALIZED to pokemon.id at first reveal, then independently mutable), erFormKind:number (uint8). Palette = pure buildSpecialFormPalette(baseHexList, erFormKind, erFormSeed). A REROLL overwrites erFormSeed with randSeedInt(2^32) and bumps an erFormRerolls:uint16 counter — it mutates the persisted seed, never pokemon.id, never the algorithm. Crossplay carries (erFormKind, erFormSeed) so the rerolled look reproduces exactly on the viewer.", "PICK ONE OF: seed-only (no manual swap) OR explicit-pairs (manual swap). For v1, choose SEED-ONLY + REROLL — it is compact (2 ints), crossplay-clean, and the reroll button already gives collectors agency. DEFER the 2-color manual swap (and its [number,number][] persisted override list) to a later phase; if/when added, store it as erFormSwaps:[number,number][] applied ON TOP of the seed-derived palette, explicitly LOCAL-ONLY (not on GhostMember).", "FIX resetErBlackShinyState (er-black-shinies.ts:151) to also clear erSpecialForm/erFormSeed/erFormKind, and place the t5 sub-roll inside the try block AFTER applyErBlackShinyKit (:137). Add isErSpecialForm reader + Overrides.ER_SPECIAL_FORM_*_OVERRIDE mirroring the black precedent.", "DEFINE ONE CROSSPLAY VISIBILITY RULE: the t5 FORM (erFormKind + erFormSeed) IS cross-player (2 optional ints on GhostMember, serializeMember emits when set, applyErGhostOverride sets enemy.customPokemonData + rebuilds the variant cache). AURA SELECTION and any future manual SWAPS are LOCAL-ONLY (never on GhostMember). State this contract once in the spec so the four docs stop contradicting each other.", "MINIMUM-LOVABLE v1 (ship this, ~3-4 days): (a) t5 SPECIAL FORM flag + nested 1/7 sub-roll + inherited luck-5/one-per-team/gift — the rarity hook (Axis 1). (b) ONE algorithmic palette KIND per t5 mon, seed-derived via the EXISTING variant-shader swap path (onBatch branch, no shader edit) using buildSpecialFormPalette — the data-only METALLIC kind is the cheapest single recognizable look. (c) erFormSeed stored + a REROLL button (run-win-granted token OR candy) that overwrites the seed — gives collect/show-off agency. (d) Crossplay: (erFormKind, erFormSeed) as 2 optional ints on GhostMember so ghosts render the real form. (e) UI: 5th starter sparkle + nameplate marker (clone the black 4th sparkle). NO aura, NO manual swap, NO member-shinies, NO animated shader, NO multiple kinds. One rare form, one rerollable palette, visible to all. That is lovable and legible.", "PHASE 2 (after v1 proves out, ~2-3 days): add the AURA layer (Layer-A overlay-sprite handler cloning PokemonSpriteSparkleHandler) as the SECOND collectible axis, granted on run-win, selectable + opt-out, gated behind a settings flag, LOCAL-ONLY (not crossplay). Add the remaining static palette KINDS (GHOST/CELESTIAL/RAINBOW/OUTLINE-cool) since they are data-only and free once buildSpecialFormPalette exists. This is where the two-layer 'palette x effect' collector story actually lands — but only after v1 establishes the seed/reroll plumbing.", "PHASE 3 (separate project, gated): animated shader auras (rainbow cycle, aurora drift, WAVEY/GLITCH, true OUTLINE via quad expansion) behind globalScene.auraEffects, in-browser-verified only; and manual 2-color SWAP. PHASE 4 (entirely separate project): member/tribute community local-mod hub (IndexedDB ModRegistry, versioned content-hashed keys, integrity checks). Do NOT bundle 3 or 4 into the special-form feature.", "BEFORE WRITING CODE, freeze ONE schema doc that all four design areas reference: CustomPokemonData += {erSpecialForm, erFormKind, erFormSeed, erFormRerolls, erAuraEffect?}; GhostMember += {erFormKind?, erFormSeed?} only; StarterDataEntry += {erSpecialForm?, erFormUnlockedKinds?}. Add a determinism vitest (same kind+seed -> identical 32 hexes) and an owner-vs-viewer palette-parity test. Keep tsc baseline at 267."]
