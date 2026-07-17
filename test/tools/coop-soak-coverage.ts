/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP SOAK COMPLETENESS BACKSTOP (#849). The machine-enforced answer to the
// maintainer's "make sure that all in-game interactions are being tested": the soak
// must PROVE it exercises every registered co-op interactive surface it can drive, and
// LOUDLY skip-count every surface it deliberately cannot. The EXPECTED set is derived
// AT RUNTIME from the registries (never hardcoded), so NEW content (a newly-added
// mirrored UiMode, a new relay kind, a new seq band) auto-REDS until it is either
// driven by the soak or explicitly declared undrivable with a follow-up task.
//
// THE SURFACE MODEL. A co-op interactive "surface" is one (dimension, value) pair:
//   - mode:<UiMode name>   - a co-op-MIRRORED UiMode (from COOP_UI_MIRRORED_MODES)
//   - kind:<relay kind>    - a relay `kind` string (from COOP_RELAY_KINDS)
//   - band:<seq band key>  - a relay seq band (from COOP_SEQ_BANDS)
//   - uiRelay:<UiMode>     - a real public UI input reached an authoritative production carrier
//   - uiOperation:<mode->op> - that input synchronously reached a committed operation class; full
//                              cross-client causality remains debt until a journey proves watcher apply
//   - situation:<name>     - a battle-flow situation (from COOP_SOAK_SITUATIONS, the
//                            ONLY hand-listed dimension - no registry exists for it)
//
// THE PARTITION (asserted total + disjoint). EXPECTED (from the registries) splits as
//   EXPECTED = UNDRIVABLE  U  GUARANTEED  U  PROBABILISTIC
// where UNDRIVABLE is the hand-maintained registry of today's deliberate omissions
// (each naming its follow-up coverage task), and DRIVABLE = EXPECTED - UNDRIVABLE splits
// into GUARANTEED (hit every sufficiently-long run by construction) and PROBABILISTIC
// (hit only some runs; asserted against a cross-run UNION ledger). Any EXPECTED surface
// that is in NONE of the three is the ANTI-SILENT-DROP RED ("in a registry but neither
// driven nor declared undrivable - classify it") - this is what makes new content
// auto-red.
//
// GATING. The FULL depth-dependent enforcement (every GUARANTEED surface hit + the
// partition check) runs only when the run surveyed at least COMPLETENESS_ASSERT_MIN
// waves. Below that the cold-surface coverage is REPORT-ONLY so PRs stay green + fast.
// Registry contradictions observed by ANY run are always RED: an undeclared UI ->
// operation edge, or a supposedly-undrivable edge that the run actually drove.
//
// This module imports the registries + the UiMode enum (leaves) + node fs/path; it does
// NOT import the coop runtime, so it stays a pure test-side classifier.
// =============================================================================

import {
  COOP_OPERATION_SURFACES,
  COOP_OPERATION_UI_CONTRACTS,
  type CoopOperationSurfaceClass,
} from "#data/elite-redux/coop/coop-operation-surface-registry";
import { COOP_RELAY_KINDS, COOP_SEQ_BANDS, coopSeqBandRange } from "#data/elite-redux/coop/coop-seq-registry";
import { COOP_UI_AUTHORITATIVE_COMMIT_MODES, COOP_UI_MIRRORED_MODES } from "#data/elite-redux/coop/coop-ui-registry";
import { UiMode } from "#enums/ui-mode";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// The situation dimension (the only hand-listed one - no registry exists for
// battle-flow situations). Adding a value here without classifying it below is
// caught by the partition check exactly like a new registry entry.
// ---------------------------------------------------------------------------

/**
 * Every battle-flow SITUATION the soak tracks. A `const` object (not a TS `enum`) so the wire key is the
 * literal string value AND the identifier stays the design's `COOP_SOAK_SITUATIONS` name (a PascalCase
 * enum name / CONSTANT_CASE member rename would ripple through every tap). {@linkcode CoopSoakSituation}
 * is the value union.
 */
export const COOP_SOAK_SITUATIONS = {
  wildDouble: "wildDouble",
  single: "single",
  triple: "triple",
  trainerRandom: "trainerRandom",
  trainerFixed: "trainerFixed",
  boss: "boss",
  catch: "catch",
  flee: "flee",
  mega: "mega",
  tera: "tera",
  levelUpLearn: "levelUpLearn",
  evolution: "evolution",
  eggHatch: "eggHatch",
  biomeBoundary: "biomeBoundary",
  weather: "weather",
  terrain: "terrain",
  enemySwitch: "enemySwitch",
  forceSwitchMove: "forceSwitchMove",
  singleFaint: "singleFaint",
  doublePlayerFaint: "doublePlayerFaint",
  revivalBlessing: "revivalBlessing",
  giveToPartner: "giveToPartner",
  saveResume: "saveResume",
  hotRejoin: "hotRejoin",
  transportFault: "transportFault",
  trio: "trio",
  willYouSwitch: "willYouSwitch",
  hostHalfExhausted: "hostHalfExhausted",
} as const;

/** The value union of {@linkcode COOP_SOAK_SITUATIONS}. */
export type CoopSoakSituation = (typeof COOP_SOAK_SITUATIONS)[keyof typeof COOP_SOAK_SITUATIONS];

/**
 * The soak PARTY PROFILE (#832). "god" is today's level-300 legendary steamroller that reaches the deep
 * endgame but faints only occasionally (so the FAINT-replacement surfaces are PROBABILISTIC). "level" is
 * the wave-appropriate level-65 party that takes REAL damage and FAINTS reliably then wipes cleanly ~wave 48
 * (the faint channel where #845-#848 were found) - so under "level" those faint surfaces are PROMOTED to
 * GUARANTEED (see
 * {@linkcode guaranteedSurfaces} / {@linkcode probabilisticSurfaces}). The driver resolves the active
 * profile from the SOAK_PROFILE env (default "god"); it is threaded into the coverage report + assertion.
 */
export type SoakProfileName = "god" | "level";

// ---------------------------------------------------------------------------
// The hit-set threaded through the soak run.
// ---------------------------------------------------------------------------

/** Every co-op interactive surface the run OBSERVED, per dimension. Populated by the driver's taps. */
export interface SoakHitSet {
  /** Co-op-mirrored UiModes the run opened / issued (the guest ui.setMode recorder + the command tap). */
  modes: Set<UiMode>;
  /** Relay `kind` strings the run sent (the relay-send tap on both runtimes). */
  kinds: Set<string>;
  /** Relay seq BAND keys the run sent (derived from each send's seq via bandForSeq). */
  bands: Set<string>;
  /** Battle-flow situation values the run reached (the wave-start + per-turn situation taps). */
  situations: Set<string>;
  /** Authoritative operation classes committed by the host during the run. */
  operations: Set<string>;
  /** Modes where a real `Ui.processInput` synchronously reached an authoritative carrier. */
  uiRelays: Set<UiMode>;
  /** Public UI mode -> committed operation-class edges observed at production choke points. */
  uiOperations: Set<string>;
}

/** A fresh, empty hit-set. */
export function createSoakHitSet(): SoakHitSet {
  return {
    modes: new Set(),
    kinds: new Set(),
    bands: new Set(),
    situations: new Set(),
    operations: new Set(),
    uiRelays: new Set(),
    uiOperations: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Surface keys + the EXPECTED set (derived AT RUNTIME from the registries).
// ---------------------------------------------------------------------------

const modeKey = (m: UiMode): string => `mode:${UiMode[m]}`;
const kindKey = (k: string): string => `kind:${k}`;
const bandKey = (b: string): string => `band:${b}`;
const sitKey = (s: string): string => `situation:${s}`;
const operationKey = (cls: string): string => `operation:${cls}`;
const uiRelayKey = (m: UiMode): string => `uiRelay:${UiMode[m]}`;
const uiOperationKey = (mode: UiMode, cls: string): string => `uiOperation:${UiMode[mode]}->${cls}`;

/**
 * Reviewed UI -> operation coverage debt. This list is deliberately EXPLICIT and independent of
 * {@linkcode COOP_OPERATION_UI_CONTRACTS}: deriving the exemptions from that contract would make every new
 * contract edge exempt itself automatically, turning the anti-silent-drop check into a tautology. Adding a
 * tuple here is therefore a conscious review decision with the common follow-up attached in
 * {@linkcode KNOWN_UNDRIVABLE}; deleting one promotes the edge to enforced coverage.
 */
export const REVIEWED_UNDRIVABLE_UI_OPERATIONS = [
  [UiMode.OPTION_SELECT, "op:ability"],
  [UiMode.PARTY, "op:ability"],
  [UiMode.ER_BARGAIN, "op:ability"],
  [UiMode.ER_BARGAIN, "op:bargain"],
  [UiMode.PARTY, "op:bargain"],
  [UiMode.OPTION_SELECT, "op:bargain"],
  [UiMode.ER_MAP, "op:biome"],
  [UiMode.OPTION_SELECT, "op:biome"],
  [UiMode.PARTY, "op:catchFull"],
  [UiMode.COLOSSEUM, "op:colosseum"],
  [UiMode.PARTY, "op:faintSwitch"],
  [UiMode.SUMMARY, "op:learnMove"],
  [UiMode.CONFIRM, "op:learnMove"],
  [UiMode.LEARN_MOVE_BATCH, "op:learnMove"],
  [UiMode.MYSTERY_ENCOUNTER, "op:me"],
  [UiMode.ER_QUIZ, "op:me"],
  [UiMode.PARTY, "op:me"],
  [UiMode.OPTION_SELECT, "op:me"],
  [UiMode.PARTY, "op:revival"],
  [UiMode.MODIFIER_SELECT, "op:reward"],
  [UiMode.BIOME_SHOP, "op:reward"],
  [UiMode.PARTY, "op:reward"],
  [UiMode.OPTION_SELECT, "op:stormglass"],
] as const satisfies readonly (readonly [UiMode, CoopOperationSurfaceClass])[];

/** Coverage proved by a dedicated production-path scenario, outside the default soak collector. */
export interface CoopDedicatedScenarioCoverage {
  readonly testFile: string;
  readonly surfaces: ReadonlySet<string>;
  readonly residual: string;
  /** This registry is descriptive; the scenario's runtime assertions are the gate evidence. */
  readonly evidence: "documentation-only";
}

/**
 * Keep dedicated production-fidelity journeys explicit without falsely promoting the DEFAULT soak's
 * KNOWN_UNDRIVABLE partition. T2 drives these surfaces through real public UI and authoritative carriers;
 * the ordinary soak still auto-resolves its map boundary and therefore honestly keeps its omissions below.
 */
export const COOP_DEDICATED_SCENARIO_COVERAGE: ReadonlyMap<string, CoopDedicatedScenarioCoverage> = new Map([
  [
    "T2_WAVE10_BIOME_TRANSITION",
    {
      testFile: "test/tests/elite-redux/coop/coop-transition-t2-biome.test.ts",
      surfaces: new Set([
        modeKey(UiMode.BIOME_SHOP),
        modeKey(UiMode.ER_MAP),
        uiRelayKey(UiMode.BIOME_SHOP),
        uiRelayKey(UiMode.ER_MAP),
        kindKey("biomeShop"),
        kindKey("crossroads"),
        kindKey("biomePick"),
        bandKey("biomeShop"),
        bandKey("crossroads"),
        bandKey("biomePick"),
        bandKey("biomeTransition"),
        sitKey(COOP_SOAK_SITUATIONS.biomeBoundary),
        operationKey("op:biome"),
      ]),
      residual:
        "Dedicated T2 is a segmented production-path journey (real UI, but explicit phase seeking/starting), not an "
        + "untouched continuous queue proof. It covers Stay and guest-owned Leave/BIOME_PICK at the wave-10 market boundary. The default "
        + "soak still auto-resolves this boundary; a continuous host-owned map-pick parity remains separate "
        + "(focused owner-parity tests cover the operation/UI path but not the whole wave-10 journey).",
      evidence: "documentation-only",
    },
  ],
]);

/**
 * The EXPECTED surface set, derived AT RUNTIME from the registries (never hardcoded): every mirrored
 * UiMode, every relay kind, every seq band, plus every situation. A new registry entry lands here
 * automatically, so the partition check auto-reds it until it is classified.
 */
export function expectedSurfaces(): Set<string> {
  const out = new Set<string>();
  for (const m of COOP_UI_MIRRORED_MODES) {
    out.add(modeKey(m));
  }
  for (const k of COOP_RELAY_KINDS) {
    out.add(kindKey(k.kind));
  }
  for (const b of COOP_SEQ_BANDS) {
    out.add(bandKey(b.key));
  }
  for (const s of Object.values(COOP_SOAK_SITUATIONS)) {
    out.add(sitKey(s));
  }
  for (const cls of COOP_OPERATION_SURFACES) {
    out.add(operationKey(cls));
  }
  for (const mode of COOP_UI_AUTHORITATIVE_COMMIT_MODES) {
    out.add(uiRelayKey(mode));
  }
  for (const [cls, contract] of Object.entries(COOP_OPERATION_UI_CONTRACTS)) {
    for (const mode of contract.uiModes) {
      out.add(uiOperationKey(mode, cls));
    }
  }
  return out;
}

/** The set of surface keys the run actually HIT (from the threaded hit-set). */
export function hitSurfaces(hits: SoakHitSet): Set<string> {
  const out = new Set<string>();
  for (const m of hits.modes) {
    out.add(modeKey(m));
  }
  for (const k of hits.kinds) {
    out.add(kindKey(k));
  }
  for (const b of hits.bands) {
    out.add(bandKey(b));
  }
  for (const s of hits.situations) {
    out.add(sitKey(s));
  }
  for (const cls of hits.operations) {
    out.add(operationKey(cls));
  }
  for (const mode of hits.uiRelays) {
    out.add(uiRelayKey(mode));
  }
  for (const pair of hits.uiOperations) {
    out.add(`uiOperation:${pair}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// bandForSeq: scan COOP_SEQ_BANDS ranges (the relay-send tap uses this to derive
// the band from a sent seq, so ONE tap covers every band, present and future).
// ---------------------------------------------------------------------------

/** The COOP_SEQ_BANDS band key whose range contains `seq`, or undefined if none does. */
export function bandForSeq(seq: number): string | undefined {
  for (const band of COOP_SEQ_BANDS) {
    const { lo, hi } = coopSeqBandRange(band);
    if (seq >= lo && seq <= hi) {
      return band.key;
    }
  }
  return;
}

// ---------------------------------------------------------------------------
// The KNOWN-UNDRIVABLE registry: today's DELIBERATE omissions, each naming its
// follow-up coverage task. A surface here is loudly skip-counted, never a RED.
// When a follow-up lands, DELETE the entry (and move the surface to GUARANTEED /
// PROBABILISTIC) - the run then enforces it.
// ---------------------------------------------------------------------------

/** One undrivable surface: WHY it cannot be driven today + the coverage task that will close it. */
export interface UndrivableEntry {
  reason: string;
  followupTask: string;
}

/**
 * Follow-up shorthand for the mid-run mystery-encounter surface. #633 BUILD 1 LANDED the inline ME
 * continuation driver ({@linkcode coop-soak-driver}'s crossIntoMeWave + processMeWave, proven green by
 * coop-soak-me.test.ts): a designated ME wave is FORCED + driven INLINE across BOTH engines, so the CORE ME
 * SYNC surfaces (mePresent / meResync / meBtn / me + the MYSTERY_ENCOUNTER mode + the mePump/meTerm bands)
 * now FIRE for a DEPARTMENT_STORE_SALE host-owned ME. They stay listed here because the DEFAULT wave/shop
 * soak does NOT configure an ME leg (opts.meWaves unset) - they are exercised by the dedicated ME test, not
 * the default run - so the partition for the default profile is unchanged. LANDED since BUILD 1: the post-ME
 * CONTINUATION into subsequent waves (finding (a) - a harness pin leak, coopMeInteractionStart left set on the
 * guest, fixed in processMeWave; the ME test now surveys PAST the ME) and the GUEST-OWNED non-battle path
 * (driven inline at an odd-counter wild wave). REMAINING follow-up: the BATTLE-HANDOFF path + the other ME
 * types (bargain/colosseum/quiz) inline.
 */
const ME_CONTINUATION =
  "#633 BUILD 1 landed the inline ME leg (coop-soak-me.test.ts drives mePresent/meResync/meBtn/me + MYSTERY_ENCOUNTER); "
  + "post-ME survey + guest-owned paths now land too; follow-up: battle-handoff + bargain/colosseum/quiz inline";
/** Follow-up shorthand for the biome-heal work that lets the soak survive + drive biome boundaries. */
const BIOME_BOUNDARY =
  "drive the two-engine biome-boundary crossroads/World-Map owner pick for real (setCoopBiomePickerDrivenByTest "
  + "+ owner/watcher parity + biome pick), re-deriving the ME-leg counter parities the extra tick shifts (#848 follow-up)";
/** Follow-up shorthand for the one-time Stormglass relic weather pick (#130 co-op wiring). */
const STORMGLASS_LEG =
  "drive the Stormglass weather pick across both engines: stage the Stormglass relic on the duo rig, trigger the "
  + "one-time ErStormglassPickerPhase prompt, host OWNER picks + relays, guest WATCHER adopts (kind/band stormglass)";
/**
 * Follow-up shorthand for the mid-run CATCH surfaces. #843/#849 BUILD 1 LANDED the inline catch leg (the
 * coop-soak-driver `catchWaves` knob, proven green by coop-soak-catch.test.ts): on a designated WILD wave the
 * driver isolates one foe (a spread move faints the first, a DEF/SPDEF-bulked survivor absorbs it) and
 * HOST-throws a MASTER_BALL via the real game.doThrowPokeball -> AttemptCapturePhase -> capture ->
 * broadcastCoopWaveResolved("capture") + the dexSync broadcast, then reconciles the GUEST party
 * (applyCoopCaptureParty) + dex (the dexSync stream) + ball inventory, asserting BOTH accounts' dex credit +
 * ball convergence. So the BALL mode + the `catch` situation + the dexSync kind/band FIRE for that leg. They
 * stay listed here because the DEFAULT wave/shop soak does NOT configure a catch leg (opts.catchWaves unset) -
 * they are exercised by the dedicated catch test, not the default run - so the default-profile partition is
 * unchanged. REMAINING follow-up: the FULL-party box/release catch sub-flow + a GUEST-owned (relayed) throw.
 */
const CATCH_LEG =
  "#843/#849 BUILD 1 landed the inline catch leg (coop-soak-driver catchWaves + coop-soak-catch.test.ts drives "
  + "BALL + the `catch` situation + dexSync, asserting BOTH dex credits + ball convergence); the default "
  + "wave/shop soak configures no catch leg, so the default partition is unchanged; the full-party box/release "
  + "+ guest-owned (relayed) throw is now driven by the dedicated coop-duo-catch-full.test.ts (see catchFull)";
/**
 * Follow-up shorthand for the wild-catch FULL-PARTY keep/release owner-pick surfaces (#856). The
 * recipient-drives relay (a GUEST-thrown wild catch on a FULL merged party: the HOST streams a
 * `catchFullPrompt`, the GUEST catcher opens the real replace-or-skip picker + relays the slot, the host
 * applies the authoritative release+add) is proven over two real engines by the dedicated
 * coop-duo-catch-full.test.ts. The DEFAULT wave/shop soak (and the coop-soak-catch leg) uses a NON-full
 * party host-thrown catch, so the `catchFull` kind/band never fires there - undrivable in the default run
 * until a soak leg stages a full-party guest-thrown throw.
 */
const CATCH_FULL_LEG =
  "#856 the wild-catch full-party keep/release owner pick is driven over two real engines by "
  + "coop-duo-catch-full.test.ts (host streams catchFullPrompt, guest catcher relays the slot, host applies "
  + "the release+add); the default soak's catch leg uses a NON-full host-thrown party, so catchFull never "
  + "fires there - follow-up: stage a full-party GUEST-thrown catch in the soak driver (catchFullWaves knob)";
/**
 * Follow-up shorthand for the level-up move-learn BATCH surfaces. #848/#849 BUILD 2 LANDED the inline
 * learn-move leg (the coop-soak-driver `learnMoveWaves` knob, proven green by coop-soak-learn-move.test.ts):
 * on a designated wave the driver forces the real ER LearnMoveBatchPhase on a full-moveset GUEST-owned mon -
 * the host opens the WATCHER panel, the guest opens the OWNER panel + picks the replacement (accept, forget),
 * and the host applies it authoritatively (the #848 shared batch-panel path) - so the LEARN_MOVE_BATCH mode +
 * the learnMoveBatch/learnMoveBatchForward kinds + the learnMoveBatchFwd band + the `levelUpLearn` situation
 * FIRE, with BOTH movesets asserted converged. They stay listed here because the DEFAULT run declines level-up
 * learns (opts.learnMoveWaves unset) - they are exercised by the dedicated learn-move test, not the default
 * run - so the default-profile partition is unchanged.
 */
const LEARN_MOVE_BATCH_LEG =
  "#848/#849 BUILD 2 landed the inline learn-move leg (coop-soak-driver learnMoveWaves + "
  + "coop-soak-learn-move.test.ts drives the batch LearnMoveBatchPhase accept+forget across both engines, "
  + "asserting moveset convergence); the default run declines level-up learns, so the default partition is "
  + "unchanged";
/** Follow-up shorthand for the PER-MOVE (TM) learn-forward surfaces the batch level-up leg does NOT drive. */
const LEARN_MOVE_PERMOVE =
  "the per-move LearnMovePhase forward path (SUMMARY forget picker + learnMove/learnMoveForward) is the TM "
  + "learn path, NOT the level-up path (#848 routes level-up learns through the batch panel - landed, see "
  + "coop-soak-learn-move.test.ts); follow-up: drive a TM learn-forward in the soak (coop-duo-exploration "
  + "PROBE #800 covers it standalone)";

/**
 * Every surface the soak DELIBERATELY does not drive today, keyed by surface. DRIVABLE = EXPECTED minus
 * these keys. Each entry names the follow-up coverage task that will close it. Keeping this EXHAUSTIVE is
 * what lets the anti-silent-drop backstop distinguish "known omission" from "silently dropped surface".
 */
export const KNOWN_UNDRIVABLE: ReadonlyMap<string, UndrivableEntry> = new Map<string, UndrivableEntry>([
  // ---- MODES ----
  ...[
    UiMode.COMMAND,
    UiMode.FIGHT,
    UiMode.BALL,
    UiMode.MODIFIER_SELECT,
    UiMode.PARTY,
    UiMode.SUMMARY,
    UiMode.MYSTERY_ENCOUNTER,
    UiMode.BIOME_SHOP,
    UiMode.COLOSSEUM,
    UiMode.ER_QUIZ,
    UiMode.ER_BARGAIN,
    UiMode.LEARN_MOVE_BATCH,
    UiMode.ER_MAP,
    UiMode.CONFIRM,
    UiMode.OPTION_SELECT,
  ].map(
    mode =>
      [
        uiRelayKey(mode),
        {
          reason:
            `the soak does not yet prove ${UiMode[mode]} through public Ui.processInput into an authoritative carrier; `
            + "opening the mode, direct handler calls, and direct relay/commit injection do not count",
          followupTask: `replace the ${UiMode[mode]} headless shortcut with a real owner UI -> relay -> watcher journey`,
        },
      ] as const,
  ),
  ...REVIEWED_UNDRIVABLE_UI_OPERATIONS.map(
    ([mode, cls]) =>
      [
        uiOperationKey(mode, cls),
        {
          reason:
            `the soak does not yet prove the complete ${UiMode[mode]} owner-input -> ${cls} authority `
            + "commit -> watcher-apply chain; a synchronous local carrier hit cannot prove the later "
            + "cross-client commit/adoption for guest-owned input",
          followupTask:
            `add a continuous two-client ${UiMode[mode]} journey that carries one causal intent id through `
            + `${cls} commit, apply, visual acknowledgement, and state convergence`,
        },
      ] as const,
  ),
  [
    modeKey(UiMode.BALL),
    {
      reason:
        "the DEFAULT wave/shop soak never throws a ball (headless move.select bypasses the BALL menu); the "
        + "catch leg (coop-soak-catch.test.ts) DRIVES the real BALL menu via game.doThrowPokeball",
      followupTask: CATCH_LEG,
    },
  ],
  [
    modeKey(UiMode.SUMMARY),
    {
      reason:
        "the 'which move to forget' SUMMARY mirror is the PER-MOVE (TM) LearnMovePhase picker, not driven; the "
        + "level-up learn now uses the batch panel (LEARN_MOVE_BATCH), so SUMMARY is TM-only",
      followupTask: LEARN_MOVE_PERMOVE,
    },
  ],
  [
    modeKey(UiMode.LEARN_MOVE_BATCH),
    {
      reason:
        "the DEFAULT run declines level-up learns; the learn-move leg (coop-soak-learn-move.test.ts) DRIVES "
        + "ER's BATCH level-up Move Learn panel across both engines",
      followupTask: LEARN_MOVE_BATCH_LEG,
    },
  ],
  [
    modeKey(UiMode.MYSTERY_ENCOUNTER),
    {
      reason:
        "mystery encounters are OFF (mysteryEncounterChance 0); the duo harness drives MEs only from a parked buildDuoForMe rig",
      followupTask: ME_CONTINUATION,
    },
  ],
  [
    modeKey(UiMode.ER_QUIZ),
    { reason: "the quiz minigame is only reachable via an ER quiz ME, which is OFF", followupTask: ME_CONTINUATION },
  ],
  [
    modeKey(UiMode.COLOSSEUM),
    { reason: "the Colosseum board is only reachable via a Colosseum ME, which is OFF", followupTask: ME_CONTINUATION },
  ],
  [
    modeKey(UiMode.ER_BARGAIN),
    {
      reason: "Giratina's Bargain is only reachable via the ER_THE_BARGAIN ME, which is OFF",
      followupTask: ME_CONTINUATION,
    },
  ],
  [
    modeKey(UiMode.BIOME_SHOP),
    {
      reason:
        "the every-10-waves biome market is not driven (the re-mirror harness does not cross a biome boundary interaction)",
      followupTask: BIOME_BOUNDARY,
    },
  ],
  [
    // #848: the World-Map route chooser is now a MIRRORED mode (owner-alternated + mirrored biome pick). The
    // soak crosses biome boundaries via the vitest AUTO-RESOLVE (no picker opened, no counter tick), so the
    // ER_MAP mirror never opens - undrivable until the two-engine pick is driven for real (see BIOME_BOUNDARY).
    modeKey(UiMode.ER_MAP),
    {
      reason: "the #848 World-Map biome picker auto-resolves in vitest (no mirrored ER_MAP opened, no counter tick)",
      followupTask: BIOME_BOUNDARY,
    },
  ],

  // ---- KINDS ----
  [
    kindKey("shop"),
    {
      reason: "reward-shop BUY (paid shop item) is not driven (the soak only takes/leaves the free reward pool)",
      followupTask: "drive a reward-shop BUY in the soak shop",
    },
  ],
  [
    kindKey("reroll"),
    {
      reason: "reward-shop REROLL is not driven (seeded take/leave only)",
      followupTask: "drive a reward-shop reroll in the soak shop",
    },
  ],
  [
    kindKey("check"),
    { reason: "reward-shop transfer-CHECK is not driven", followupTask: "drive a reward-shop check in the soak shop" },
  ],
  [
    kindKey("transfer"),
    {
      reason: "reward-shop item TRANSFER is not driven",
      followupTask: "drive a reward-shop transfer in the soak shop",
    },
  ],
  [
    kindKey("lock"),
    { reason: "reward-shop rarity LOCK is not driven", followupTask: "drive a reward-shop lock in the soak shop" },
  ],
  [kindKey("biomeShop"), { reason: "the biome market buy/leave relay is not driven", followupTask: BIOME_BOUNDARY }],
  // #848: the crossroads Stay/Leave + World-Map biome-pick owner relays. The soak's vitest auto-resolve
  // bypasses both (no relay send), so neither kind fires - undrivable until the two-engine pick is driven
  // for real (see BIOME_BOUNDARY).
  [
    kindKey("crossroads"),
    { reason: "the #848 crossroads relay auto-resolves in vitest (no relay send)", followupTask: BIOME_BOUNDARY },
  ],
  [
    kindKey("biomePick"),
    {
      reason: "the #848 World-Map biome-pick relay auto-resolves in vitest (no relay send)",
      followupTask: BIOME_BOUNDARY,
    },
  ],
  // #130: the one-time Stormglass relic weather pick (er-stormglass-picker-phase.ts). The relay IS wired
  // (host OWNER commits + relays, watcher adopts with the COOP_BIOME_WAIT_MS heal), but the soak never
  // grants the Stormglass relic, so the prompt never fires - undrivable until a leg stages the relic.
  [
    kindKey("stormglass"),
    {
      reason: "the one-time Stormglass weather pick needs the Stormglass relic, which the soak never grants",
      followupTask: STORMGLASS_LEG,
    },
  ],
  [
    kindKey("catchFull"),
    {
      reason:
        "the wild-catch full-party keep/release owner pick needs a GUEST-thrown catch on a FULL merged party; "
        + "the default soak's catch leg uses a NON-full host-thrown party, so the catchFull relay never fires there",
      followupTask: CATCH_FULL_LEG,
    },
  ],
  [kindKey("bargain"), { reason: "the Bargain outcome relay is ME-gated", followupTask: ME_CONTINUATION }],
  [kindKey("coloBoard"), { reason: "the Colosseum board relay is ME-gated", followupTask: ME_CONTINUATION }],
  [kindKey("coloPick"), { reason: "the Colosseum pick relay is ME-gated", followupTask: ME_CONTINUATION }],
  [kindKey("mePresent"), { reason: "the ME present relay is ME-gated", followupTask: ME_CONTINUATION }],
  [kindKey("meResync"), { reason: "the ME resync relay is ME-gated", followupTask: ME_CONTINUATION }],
  [kindKey("me"), { reason: "the ME option-pick relay is ME-gated", followupTask: ME_CONTINUATION }],
  [kindKey("meSub"), { reason: "the ME sub-option relay is ME-gated", followupTask: ME_CONTINUATION }],
  [kindKey("meBtn"), { reason: "the ME button relay is ME-gated", followupTask: ME_CONTINUATION }],
  [kindKey("quizAns"), { reason: "the quiz-answer relay is ME-gated", followupTask: ME_CONTINUATION }],
  [
    kindKey("revival"),
    {
      reason: "the Revival Blessing owner-pick relay is not driven (no revival item is taken)",
      followupTask: "drive a Revival Blessing - the `revivalBlessing` situation",
    },
  ],
  [
    kindKey("abilityPicker"),
    {
      reason: "the ability-picker relay is only sent from ER ability-change phases the soak does not reach",
      followupTask: "drive an ER ability-picker phase in the soak",
    },
  ],
  [
    kindKey("learnMove"),
    {
      reason:
        "the lockstep move-forget relay rides the PER-MOVE (TM) LearnMovePhase forward, not the level-up "
        + "path (which now uses the batch panel); the TM path is not driven by the default run",
      followupTask: LEARN_MOVE_PERMOVE,
    },
  ],
  [
    kindKey("learnMoveForward"),
    {
      reason: "the host->guest per-slot move-learn forward relay is the PER-MOVE (TM) path, not driven",
      followupTask: LEARN_MOVE_PERMOVE,
    },
  ],
  [
    kindKey("learnMoveBatch"),
    {
      reason:
        "the DEFAULT run declines level-up learns; the learn-move leg DRIVES ER's BATCH level-up owner-terminal "
        + "relay (learnMoveBatch)",
      followupTask: LEARN_MOVE_BATCH_LEG,
    },
  ],
  [
    kindKey("learnMoveBatchForward"),
    {
      reason:
        "the DEFAULT run declines level-up learns; the learn-move leg DRIVES ER's BATCH host->guest forward "
        + "relay (learnMoveBatchForward)",
      followupTask: LEARN_MOVE_BATCH_LEG,
    },
  ],
  [
    kindKey("dexSync"),
    {
      reason:
        "the dex/starter sync broadcast is only sent on a catch, which the DEFAULT run does not drive; the "
        + "catch leg (coop-soak-catch.test.ts) DRIVES it (both accounts credited)",
      followupTask: CATCH_LEG,
    },
  ],

  // ---- BANDS ----
  [
    bandKey("revival"),
    {
      reason: "the revival seq band is only used by the Revival Blessing owner-pick, not driven",
      followupTask: "drive a Revival Blessing - the `revivalBlessing` situation",
    },
  ],
  [
    bandKey("abilityPicker"),
    {
      reason: "the ability-picker seq band is not driven",
      followupTask: "drive an ER ability-picker phase in the soak",
    },
  ],
  [bandKey("biomeShop"), { reason: "the biome-market seq band is not driven", followupTask: BIOME_BOUNDARY }],
  [
    bandKey("biomeTransition"),
    {
      reason:
        "the deterministic no-human-route biome transition band is outside the default soak's driven "
        + "crossroads/World-Map surface; the dedicated T2 biome transition journey owns its retained tail proof",
      followupTask: BIOME_BOUNDARY,
    },
  ],
  // #848: the crossroads (Stay/Leave) + World-Map biome-pick owner-alternated relays. The soak's vitest
  // auto-resolve bypasses both with no relay send, so their seq bands never fire (undrivable until the
  // two-engine pick is driven for real - see BIOME_BOUNDARY).
  [
    bandKey("crossroads"),
    { reason: "the #848 crossroads seq band auto-resolves in vitest (no relay send)", followupTask: BIOME_BOUNDARY },
  ],
  [
    bandKey("biomePick"),
    {
      reason: "the #848 World-Map biome-pick seq band auto-resolves in vitest (no relay send)",
      followupTask: BIOME_BOUNDARY,
    },
  ],
  [
    bandKey("stormglass"),
    {
      reason: "the Stormglass seq band needs the Stormglass relic, which the soak never grants (see kind:stormglass)",
      followupTask: STORMGLASS_LEG,
    },
  ],
  [
    bandKey("catchFull"),
    {
      reason:
        "the wild-catch full-party keep/release seq band needs a GUEST-thrown catch on a FULL merged party; "
        + "the default soak's catch leg uses a NON-full host-thrown party (see kind:catchFull)",
      followupTask: CATCH_FULL_LEG,
    },
  ],
  [bandKey("bargain"), { reason: "the Bargain seq band is ME-gated", followupTask: ME_CONTINUATION }],
  [bandKey("colosseum"), { reason: "the Colosseum seq band is ME-gated", followupTask: ME_CONTINUATION }],
  [bandKey("mePump"), { reason: "the ME pump seq band is ME-gated", followupTask: ME_CONTINUATION }],
  [bandKey("meQuiz"), { reason: "the ME quiz seq band is ME-gated", followupTask: ME_CONTINUATION }],
  [bandKey("meTerm"), { reason: "the ME terminal seq band is ME-gated", followupTask: ME_CONTINUATION }],
  [
    bandKey("learnMoveFwd"),
    {
      reason: "the move-learn forward seq band is the PER-MOVE (TM) path, not driven (level-up uses the batch band)",
      followupTask: LEARN_MOVE_PERMOVE,
    },
  ],
  [
    bandKey("learnMove"),
    {
      reason: "the move-forget seq band is the PER-MOVE (TM) path, not driven (level-up uses the batch band)",
      followupTask: LEARN_MOVE_PERMOVE,
    },
  ],
  [
    bandKey("learnMoveBatchFwd"),
    {
      reason: "the DEFAULT run declines level-up learns; the learn-move leg DRIVES ER's BATCH level-up seq band",
      followupTask: LEARN_MOVE_BATCH_LEG,
    },
  ],
  [
    bandKey("dexSync"),
    {
      reason: "the dex-sync seq band is not driven by the DEFAULT run (no catch); the catch leg drives it",
      followupTask: CATCH_LEG,
    },
  ],
  [
    bandKey("rejoinSync"),
    {
      reason: "the rejoin full-resync seq band is not driven (no hot-rejoin in the soak)",
      followupTask: "drive a mid-run hot-rejoin - the `hotRejoin` situation",
    },
  ],

  // ---- SITUATIONS ----
  [
    sitKey(COOP_SOAK_SITUATIONS.single),
    {
      reason: "the soak forces battleStyle 'double', so a single (1v1) wild wave never rolls",
      followupTask: "run a single-battle-style soak variant to cover the 1-slot command path",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.triple),
    { reason: "triple battles are not forced by the soak", followupTask: "run a triple-battle-style soak variant" },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.catch),
    {
      reason: "the DEFAULT soak never throws a ball (headless move.select bypass); the catch leg drives a catch",
      followupTask: CATCH_LEG,
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.flee),
    { reason: "the soak never flees a wild wave", followupTask: "drive a seeded flee attempt (game.doAttemptRun)" },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.mega),
    {
      reason:
        "god-party mons spawn straight into their mega FORM (permanent here), so no in-battle mega-evolution EVENT fires",
      followupTask: "drive an in-battle mega-evolution event (tera-style toggle)",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.tera),
    { reason: "the soak never terastallizes", followupTask: "drive a seeded terastallize (move.select tera flag)" },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.levelUpLearn),
    {
      reason:
        "the DEFAULT run declines level-up move-learn prompts; the learn-move leg (coop-soak-learn-move.test.ts) "
        + "DRIVES a level-up learn that ACCEPTS + forces a forget across both engines (moveset convergence asserted)",
      followupTask: LEARN_MOVE_BATCH_LEG,
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.evolution),
    {
      reason: "no evolution is driven (Rare Candy / level-evolve reward is not taken; god-party spawns pre-evolved)",
      followupTask: "drive an evolution in the soak",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.eggHatch),
    { reason: "no egg hatch is driven in the continuous soak", followupTask: "drive an egg hatch in the soak" },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.biomeBoundary),
    {
      // #848: the crossroads/World-Map pick is now a REAL owner-alternated + mirrored co-op interaction
      // (ErCrossroadsPhase / SelectBiomePhase). The authoritative soak does NOT drive it: it relies on the
      // vitest-scoped AUTO-RESOLVE (coopBiomePickerAutoResolvesInTest) which bypasses the picker
      // deterministically with NO counter tick, so the continuous run crosses biome boundaries without a
      // strand. Driving the two-engine pick FOR REAL (setCoopBiomePickerDrivenByTest + owner/watcher parity
      // + the biome pick) would ADD one interaction-counter tick per boundary, which shifts the ME-leg
      // counter parities the coop-soak-me tests depend on (wave-12 host-owned / wave-15 guest-owned) - so it
      // is a DEDICATED follow-up build, not folded into the ME-leg work (per the #848 handoff, declared here).
      reason:
        "the biome boundary crossroads/World-Map pick (#848) auto-resolves in vitest (no counter tick); "
        + "driving the two-engine owner/watcher pick for real is a dedicated follow-up (it ticks the counter, "
        + "shifting the ME-leg parities)",
      followupTask: BIOME_BOUNDARY,
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.forceSwitchMove),
    {
      reason:
        "the soak's fixed player moveset has no force-switch move (Roar/Whirlwind/Dragon Tail) and enemy-forced player switches are not tapped as a distinct situation",
      followupTask: "add a force-switch move to a soak variant / tap enemy-forced player switches",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.revivalBlessing),
    {
      reason: "no Revival Blessing reward is taken, so the owner-pick relay never fires",
      followupTask: "drive a Revival Blessing reward in the soak",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.giveToPartner),
    {
      reason: "the give-to-partner (party transfer) flow is not driven",
      followupTask: "drive a give-to-partner transfer in the soak",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.saveResume),
    {
      reason:
        "the DEFAULT soak is a single continuous process (no save/resume); the resume leg "
        + "(coop-soak-resume.test.ts) serializes the host session mid-run + reboots the guest from the snapshot",
      followupTask:
        "#807/#810/#849 BUILD 3 landed the inline save-resume leg (coop-soak-driver resumeWaves + "
        + "coop-soak-resume.test.ts serializes the host session, reboots the GUEST via applyCoopLaunchSession, "
        + "and asserts byte-equal convergence + a green continuation); the default run does no save/resume, so "
        + "the default partition is unchanged",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.hotRejoin),
    {
      reason: "no mid-run guest disconnect/rejoin is driven",
      followupTask: "drive a hot-rejoin (guest drop + full-resync) in the soak",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.transportFault),
    {
      reason: "transport fault injection is covered by the dedicated fault test (coop-transport-fault), not the soak",
      followupTask: "none - covered by the Layer-A transport-fault test",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.trio),
    {
      reason: "3-player co-op (trio seating) is not stood up by the two-engine harness",
      followupTask: "extend the harness to a three-engine trio rig",
    },
  ],
  [
    sitKey(COOP_SOAK_SITUATIONS.willYouSwitch),
    {
      reason: "the 'will you switch?' post-KO prompt is not driven",
      followupTask: "drive the will-you-switch prompt in the soak",
    },
  ],
  // NOTE (#828 BUILD 2): `situation:hostHalfExhausted` was PROMOTED out of KNOWN_UNDRIVABLE - the soak now
  // DRIVES the asymmetric continuation (the guest plays on solo after the host's half is out) instead of
  // terminating at it. It is PROBABILISTIC (fires only when one player's whole half dies before the other's
  // and before an every-10-wave heal), so it lives in {@linkcode PROBABILISTIC_BASE}, covered by the
  // cross-run union ledger. See coop-soak-driver.ts's guest-solo continuation + hostHalfExhausted predicate.
  // ---- AUTHORITATIVE OPERATIONS ----
  // These classes have dedicated real-engine operation suites, but the default wave/shop soak cannot stage
  // their content yet. Keeping them in the SAME partition makes every omission loud and task-linked.
  ...[
    "op:ability",
    "op:bargain",
    "op:biome",
    "op:catchFull",
    "op:colosseum",
    "op:learnMove",
    "op:me",
    "op:revival",
    "op:stormglass",
  ].map(
    cls =>
      [
        operationKey(cls),
        {
          reason: `the default wave/shop soak does not stage ${cls}; its dedicated two-engine operation suite does`,
          followupTask: `add a forced ${cls} leg to the continuous soak/fault campaign`,
        },
      ] as [string, UndrivableEntry],
  ),
]);

// ---------------------------------------------------------------------------
// The DRIVABLE classification: GUARANTEED (hit every 60+-wave run by construction)
// vs PROBABILISTIC (hit only some runs; asserted via the cross-run union ledger).
// These two sets PLUS the UNDRIVABLE registry must exactly partition EXPECTED (the
// partition check enforces it) - so a new surface added to a registry that is NOT
// placed in one of the three auto-reds as "unclassified".
// ---------------------------------------------------------------------------

/**
 * The FAINT-replacement co-op channel CORE (the RICHEST desync surface - #845-#848, the party-order
 * transposition #836, the heavy-faint cluster #834): a player mon FAINTS (singleFaint) AND a faint
 * REPLACEMENT is chosen + relayed (the `switch` relay kind). These two RELIABLY fire whenever the level-65
 * party enters its ~wave-40+ death spiral (a mon faints and is replaced), so they are PROFILE-DEPENDENT
 * (#832): PROBABILISTIC under "god" (the level-300 party rarely faints), PROMOTED to GUARANTEED under
 * "level". Verified GUARANTEED-hit across level seeds.
 */
const FAINT_PROMOTABLE: readonly string[] = [
  sitKey(COOP_SOAK_SITUATIONS.singleFaint),
  kindKey("switch"),
  operationKey("op:faintSwitch"),
];

/**
 * Faint-channel surfaces that fire only under HEAVIER / more specific conditions, so they stay PROBABILISTIC
 * under BOTH profiles (covered by the cross-run UNION ledger, not guaranteed):
 *   - `faintSwitch` seq BAND: the switch relay's CHOICE rides this band, but the tap ALSO records the switch
 *     `kind` from a follow-up OUTCOME send that can carry a different seq, so the band does not co-fire with
 *     `kind:switch` every run (a heavier death spiral hits it - seed 12345's 80-wave level-85 run did - but a
 *     light spiral capped below the ceiling may not). Guaranteeing it would make the level test flaky.
 *   - `doublePlayerFaint`: a SAME-TURN two-slot KO (#847) is damage-roll-dependent even at the ceiling
 *     (empirically not every level run KOs both field slots in one turn).
 * Both are still exercised across runs; promoting them would red a legitimate damage-roll / seq miss.
 */
const FAINT_ALWAYS_PROBABILISTIC: readonly string[] = [
  bandKey("faintSwitch"),
  sitKey(COOP_SOAK_SITUATIONS.doublePlayerFaint),
];

/** Surfaces hit by CONSTRUCTION in every sufficiently-long run REGARDLESS of profile (the cadence spine). */
const GUARANTEED_BASE: readonly string[] = [
  // Modes: the headless command path issues these every wave; the reward shop opens every non-boss wave.
  modeKey(UiMode.COMMAND),
  modeKey(UiMode.FIGHT),
  modeKey(UiMode.TARGET_SELECT),
  // Unlike the legacy mode tap above, this can only be earned by public Ui.processInput reaching the command carrier.
  uiRelayKey(UiMode.TARGET_SELECT),
  modeKey(UiMode.PARTY),
  modeKey(UiMode.MODIFIER_SELECT),
  // Kinds: the reward shop take -> "reward", leave -> "skip". (The "switch" kind rides the FAINT-replacement
  // interaction relay, NOT a voluntary switch - a voluntary switch is a battle-COMMAND-relay event on a
  // separate channel - so it is faint-driven: GUARANTEED under "level", PROBABILISTIC under "god".)
  kindKey("reward"),
  kindKey("skip"),
  // Bands: the reward channel.
  bandKey("reward"),
  // Situations: doubles wild waves, the fixed rival/evil-team gauntlet, and the every-10 boss cadence.
  sitKey(COOP_SOAK_SITUATIONS.wildDouble),
  sitKey(COOP_SOAK_SITUATIONS.trainerFixed),
  sitKey(COOP_SOAK_SITUATIONS.boss),
  // Every continuous run commits wave advancement and reward-shop choices through the operation journal.
  operationKey("op:wave"),
  operationKey("op:reward"),
  // Every deep run crosses an every-ten-wave market, leaves through its real CONFIRM handler, commits
  // the retained reward terminal, and proves watcher apply before both market phases can exit.
  uiOperationKey(UiMode.CONFIRM, "op:reward"),
];

/** PROBABILISTIC base: seed/content-dependent surfaces that are probabilistic under EVERY profile. */
const PROBABILISTIC_BASE: readonly string[] = [
  sitKey(COOP_SOAK_SITUATIONS.trainerRandom),
  sitKey(COOP_SOAK_SITUATIONS.weather),
  sitKey(COOP_SOAK_SITUATIONS.terrain),
  sitKey(COOP_SOAK_SITUATIONS.enemySwitch),
  // #828 BUILD 2: the ASYMMETRIC host-half-exhaustion continuation (guest plays on solo) is now DRIVEN, but
  // it fires only when one player's whole half dies before the other's (and before an every-10-wave heal),
  // so it is PROBABILISTIC under BOTH profiles - covered by the cross-run union ledger, never guaranteed.
  sitKey(COOP_SOAK_SITUATIONS.hostHalfExhausted),
];

/**
 * Surfaces hit by CONSTRUCTION in every run of at least the profile's assert gate. All must be hit.
 *
 * PROFILE SPLIT (#832): the base cadence spine is GUARANTEED under every profile. The single-faint channel
 * ({@linkcode FAINT_PROMOTABLE}) is PROMOTED into GUARANTEED under "level" (the level-65 party faints
 * reliably in its death spiral - that channel is the profile's whole reason to exist) and stays
 * PROBABILISTIC under "god". The heavier faint surfaces ({@linkcode FAINT_ALWAYS_PROBABILISTIC}) stay
 * probabilistic under BOTH.
 */
export function guaranteedSurfaces(profile: SoakProfileName): ReadonlySet<string> {
  return profile === "level" ? new Set([...GUARANTEED_BASE, ...FAINT_PROMOTABLE]) : new Set(GUARANTEED_BASE);
}

/**
 * Surfaces the run hits only SOMETIMES (seed / content dependent). Asserted against the cross-run UNION
 * ledger: the union across the last COMPLETENESS_LEDGER_WINDOW deep runs must cover each, else (once the
 * ledger is mature) a RED for a probabilistic surface gone permanently cold. Before the ledger is mature
 * a miss is a loud WARN, so a fresh checkout is never false-red.
 *
 * 🔴 #832 PROFILE SPLIT: under "god" the single-faint channel ({@linkcode FAINT_PROMOTABLE}) is
 * PROBABILISTIC (the level-300 party deliberately AVOIDS wipes to reach the endgame, so it faints only
 * OCCASIONALLY - the cross-run ledger union covers them); under "level" it is PROMOTED to GUARANTEED (see
 * {@linkcode guaranteedSurfaces}) and leaves this set. The same-turn double faint
 * ({@linkcode FAINT_ALWAYS_PROBABILISTIC}) is probabilistic under BOTH profiles (a simultaneous two-slot KO
 * is damage-roll-dependent even at the ceiling), so it is here regardless of profile.
 */
export function probabilisticSurfaces(profile: SoakProfileName): ReadonlySet<string> {
  return profile === "level"
    ? new Set([...PROBABILISTIC_BASE, ...FAINT_ALWAYS_PROBABILISTIC])
    : new Set([...PROBABILISTIC_BASE, ...FAINT_PROMOTABLE, ...FAINT_ALWAYS_PROBABILISTIC]);
}

// ---------------------------------------------------------------------------
// Gating + ledger constants.
// ---------------------------------------------------------------------------

/**
 * The GOD profile's full-enforcement wave gate. Set to 60, DELIBERATELY below the god party's achievable
 * depth (a level-300 party reaches the deep endgame) and above any PR run (the 25-wave default). Below 60
 * the coverage is report-only. DOC: when the party clears 120+ reliably, RAISE this toward the full run
 * length and MOVE more situations from UNDRIVABLE to DRIVABLE (mega at every god-mon form, biomeBoundary
 * every 10, more trainer classes) - the endgame lights up far more surfaces than a shallow survey does.
 */
export const COMPLETENESS_ASSERT_MIN = 60;

/**
 * The LEVEL profile's assert gate (#832). The level-65 party faints through its ~wave-40-48 death spiral and
 * terminates (a clean wipe / #848 host-half-exhaustion) around wave ~48-55, so its full-enforcement gate is
 * DELIBERATELY lower than the god profile's 60: set to 30, the proven-survivable floor the soak test already
 * asserts a level run must cross (a run that ends below 30 is a regression, red by the coverage-floor check).
 * At >= 30 waves a level run has crossed the fixed rival (wave 8), several bosses (10/20/30), and by ~55 its
 * death spiral, so it guarantees the cadence spine AND the single-faint channel. The faint channel is ALSO
 * enforced independent of this gate (see {@linkcode assertSoakCompleteness}) - the profile exists to
 * guarantee it, so a level run that ends without faints is a red at ANY depth.
 */
export const COMPLETENESS_ASSERT_MIN_LEVEL = 30;

/** The full-enforcement wave gate for a profile (god: deep-endgame 60; level: level-ceiling floor 30). */
export function completenessAssertMin(profile: SoakProfileName): number {
  return profile === "level" ? COMPLETENESS_ASSERT_MIN_LEVEL : COMPLETENESS_ASSERT_MIN;
}

/** Where the cross-run PROBABILISTIC union ledger lives (the god profile's canonical path). */
export const COVERAGE_LEDGER_PATH = path.resolve(process.cwd(), "dev-logs", "coop-soak", "coverage-ledger.json");

/**
 * The PROBABILISTIC union ledger path for a profile. The god profile keeps the canonical
 * {@linkcode COVERAGE_LEDGER_PATH} (byte-identical to today); the level profile uses a SEPARATE ledger so
 * its distinct probabilistic set (the faint surfaces are guaranteed, not probabilistic, under "level") is
 * never mixed into the god union.
 */
export function coverageLedgerPath(profile: SoakProfileName): string {
  return profile === "level"
    ? path.resolve(process.cwd(), "dev-logs", "coop-soak", "coverage-ledger-level.json")
    : COVERAGE_LEDGER_PATH;
}

/** How many recent deep runs the PROBABILISTIC union is taken over. */
const COMPLETENESS_LEDGER_WINDOW = 7;

/** The ledger must have at least this many deep runs before a PROBABILISTIC miss is a hard RED (else WARN). */
const COMPLETENESS_LEDGER_MATURE = 7;

interface LedgerRun {
  ts: string;
  seed: number;
  wavesCompleted: number;
  surfaces: string[];
}

// ---------------------------------------------------------------------------
// The report (logSoakCoverage) - the cold-surface list is the deliverable.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-console
const log = (line: string): void => console.log(line);

/** Sort a surface-key set for stable, readable logging. */
function sorted(keys: Iterable<string>): string[] {
  return [...keys].sort();
}

/**
 * Print the full coverage report: what was hit per dimension, which GUARANTEED / PROBABILISTIC surfaces
 * are cold, and the LOUD per-surface UNDRIVABLE skip-count list (each with its follow-up task). NEVER
 * silent - every undrivable surface is named. Called for every run (report-only + enforce).
 */
export function logSoakCoverage(hits: SoakHitSet, profile: SoakProfileName = "god"): void {
  const hit = hitSurfaces(hits);
  const expected = expectedSurfaces();
  const guaranteed = guaranteedSurfaces(profile);
  const probabilistic = probabilisticSurfaces(profile);

  log(`[coop-soak-coverage] ===== CO-OP SOAK COMPLETENESS REPORT (profile=${profile}) =====`);
  log(
    `[coop-soak-coverage] HIT modes=[${sorted(hit)
      .filter(k => k.startsWith("mode:"))
      .map(k => k.slice(5))
      .join(", ")}]`,
  );
  log(`[coop-soak-coverage] HIT kinds=[${sorted(hits.kinds).join(", ")}]`);
  log(`[coop-soak-coverage] HIT bands=[${sorted(hits.bands).join(", ")}]`);
  log(`[coop-soak-coverage] HIT situations=[${sorted(hits.situations).join(", ")}]`);
  log(`[coop-soak-coverage] HIT operations=[${sorted(hits.operations).join(", ")}]`);
  log(
    `[coop-soak-coverage] HIT uiRelays=[${[...hits.uiRelays]
      .map(mode => UiMode[mode])
      .sort()
      .join(", ")}]`,
  );
  log(`[coop-soak-coverage] HIT uiOperations=[${sorted(hits.uiOperations).join(", ")}]`);

  // GUARANTEED status.
  const guaranteedCold = sorted(guaranteed).filter(s => !hit.has(s));
  const guaranteedHit = sorted(guaranteed).filter(s => hit.has(s));
  log(`[coop-soak-coverage] GUARANTEED hit ${guaranteedHit.length}/${guaranteed.size}: [${guaranteedHit.join(", ")}]`);
  if (guaranteedCold.length > 0) {
    log(`[coop-soak-coverage] 🔴 GUARANTEED COLD (regression if enforcing): [${guaranteedCold.join(", ")}]`);
  }

  // PROBABILISTIC status (this run).
  const probHit = sorted(probabilistic).filter(s => hit.has(s));
  const probCold = sorted(probabilistic).filter(s => !hit.has(s));
  log(
    `[coop-soak-coverage] PROBABILISTIC hit this run ${probHit.length}/${probabilistic.size}: [${probHit.join(", ")}]`,
  );
  if (probCold.length > 0) {
    log(`[coop-soak-coverage] PROBABILISTIC cold this run (ledger union covers across runs): [${probCold.join(", ")}]`);
  }

  // UNDRIVABLE loud skip-count list - NEVER silent.
  log(`[coop-soak-coverage] UNDRIVABLE (${KNOWN_UNDRIVABLE.size} deliberate omissions, each with a follow-up task):`);
  for (const key of sorted(KNOWN_UNDRIVABLE.keys())) {
    const entry = KNOWN_UNDRIVABLE.get(key)!;
    const observed = hit.has(key) ? " [OBSERVED => ENFORCEMENT RED until this edge is promoted]" : "";
    log(`[coop-soak-coverage]   SKIP ${key} - ${entry.reason} => FOLLOW-UP: ${entry.followupTask}${observed}`);
  }

  // Any EXPECTED surface not in any of the three buckets (the anti-silent-drop signal).
  const unclassified = sorted(expected).filter(
    s => !KNOWN_UNDRIVABLE.has(s) && !guaranteed.has(s) && !probabilistic.has(s),
  );
  if (unclassified.length > 0) {
    log(
      `[coop-soak-coverage] 🔴 UNCLASSIFIED (in a registry but neither driven nor declared undrivable): [${unclassified.join(", ")}]`,
    );
  }
  log("[coop-soak-coverage] ===========================================");
}

// ---------------------------------------------------------------------------
// The ledger (cross-run PROBABILISTIC union).
// ---------------------------------------------------------------------------

function readLedger(ledgerPath: string): LedgerRun[] {
  try {
    if (!fs.existsSync(ledgerPath)) {
      return [];
    }
    const raw = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    return Array.isArray(raw) ? (raw as LedgerRun[]) : [];
  } catch {
    // A corrupt ledger must never break the soak - start fresh (the union is only a soft PROBABILISTIC gate).
    return [];
  }
}

function appendLedger(ledgerPath: string, run: LedgerRun): LedgerRun[] {
  const all = readLedger(ledgerPath);
  all.push(run);
  // Keep a bounded tail (a couple of windows of history is plenty).
  const kept = all.slice(-COMPLETENESS_LEDGER_WINDOW * 2);
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, JSON.stringify(kept, null, 2), "utf8");
  } catch {
    // Best-effort: a write failure must not fail the soak (the ledger is a cross-run convenience).
  }
  return kept;
}

// ---------------------------------------------------------------------------
// The assertion.
// ---------------------------------------------------------------------------

/** Options for {@linkcode assertSoakCompleteness}. */
export interface SoakCompletenessOptions {
  /** How many waves the run actually surveyed (the enforcement gate reads this). */
  wavesCompleted: number;
  /** The run seed (named in every RED so a cold surface is replayable). */
  seed: number;
  /**
   * The party PROFILE (#832). Selects the GUARANTEED/PROBABILISTIC split (the faint channel is GUARANTEED
   * under "level"), the enforcement wave gate (level: 30, god: 60), the ledger path, and the ALWAYS-ON
   * level faint-channel check. Defaults to "god" (today's behavior).
   */
  profile?: SoakProfileName;
  /** Where the cross-run PROBABILISTIC union ledger lives. Defaults to the profile's ledger path. */
  ledgerPath?: string;
}

/** Enforce deterministic UI-operation registry contradictions independently of soak depth. */
function assertObservedUiOperationContracts(
  hits: SoakHitSet,
  expected: ReadonlySet<string>,
  opts: SoakCompletenessOptions,
): void {
  const observedKeys = sorted(hits.uiOperations).map(pair => `uiOperation:${pair}`);
  const undeclared = observedKeys.filter(key => !expected.has(key));
  const stillUndrivable = observedKeys.filter(key => KNOWN_UNDRIVABLE.has(key));
  const reds: string[] = [];
  if (undeclared.length > 0) {
    reds.push(
      `UNDECLARED UI-OPERATION EDGE: production observed ${undeclared.length} edge(s) absent from `
        + `COOP_OPERATION_UI_CONTRACTS; review and declare or remove the call chain: [${undeclared.join(", ")}]`,
    );
  }
  if (stillUndrivable.length > 0) {
    reds.push(
      `OBSERVED UI-OPERATION STILL UNDRIVABLE: the run drove ${stillUndrivable.length} edge(s) that remain `
        + "exempt; delete each exemption and classify it as GUARANTEED/PROBABILISTIC with a continuous "
        + `watcher-apply assertion: [${stillUndrivable.join(", ")}]`,
    );
  }
  if (reds.length > 0) {
    throw new Error(
      `[coop-soak-coverage] UI-OPERATION CONTRACT FAILED (seed ${opts.seed}, ${opts.wavesCompleted} waves):\n`
        + reds.map(red => `  - ${red}`).join("\n"),
    );
  }
}

/**
 * THE BACKSTOP. Enforces (when the run is deep enough) that:
 *   1. The three classification buckets (UNDRIVABLE / GUARANTEED / PROBABILISTIC) EXACTLY partition the
 *      EXPECTED set derived from the registries - any EXPECTED surface in NONE of them is a RED
 *      ("in a registry but neither driven nor declared undrivable - classify it"). This is what makes a
 *      newly-added mirrored mode / relay kind / seq band auto-red.
 *   2. Every GUARANTEED surface was HIT (else a RED naming the cold surface + dimension + seed).
 *   3. Every PROBABILISTIC surface is covered by the cross-run UNION ledger (a hard RED once the ledger is
 *      mature, a loud WARN before that).
 *
 * GATING: the full depth-dependent enforcement runs only when wavesCompleted >= the PROFILE's gate (god:
 * 60; level: 30). Below that it is REPORT-ONLY for cold expected surfaces. Observed registry contradictions
 * are ALWAYS enforced: an observed UI -> operation edge absent from the declared contract is a RED, as is
 * an observed edge still classified as undrivable. A run that ends via a runEnded terminal at >= the gate
 * STILL enforces (the guaranteed cadence surfaces were all hit by that depth). Throws an Error on a RED (the
 * vitest test fails with the exact surfaces + seed).
 *
 * 🔴 #832 LEVEL-PROFILE FAINT CHANNEL: under "level" the faint surfaces are the profile's whole reason to
 * exist, so they are enforced at ANY depth (BEFORE the gate check) - a level run that ends without them is
 * a RED even if it stopped short of the full gate.
 */
export function assertSoakCompleteness(hits: SoakHitSet, opts: SoakCompletenessOptions): void {
  const profile = opts.profile ?? "god";
  const guaranteed = guaranteedSurfaces(profile);
  const probabilistic = probabilisticSurfaces(profile);
  const gate = completenessAssertMin(profile);
  const ledgerPath = opts.ledgerPath ?? coverageLedgerPath(profile);
  const hit = hitSurfaces(hits);
  const expected = expectedSurfaces();

  // Registry contradictions are deterministic evidence, not depth-dependent coverage. Enforce them in
  // EVERY run (including the shallow PR survey): an unexpected edge means production reached a call chain
  // the reviewed contract does not describe, while an observed-undrivable edge means the exemption is stale
  // and must be promoted to a real journey assertion rather than remaining a permanent skip.
  assertObservedUiOperationContracts(hits, expected, opts);

  // 🔴 #832 LEVEL FAINT CHANNEL (always-on, gate-independent): the level party is BUILT to faint reliably,
  // so the faint/switch/replace machinery (#845-#848 - the richest desync surface) MUST have been exercised.
  // Enforce it before the depth gate so even a level run that ended shy of the full gate still reds if the
  // faint channel went cold. NEVER made green by narrowing - a level run with no faints is a real regression.
  if (profile === "level") {
    const faintCold = sorted(FAINT_PROMOTABLE).filter(s => expected.has(s) && !hit.has(s));
    if (faintCold.length > 0) {
      throw new Error(
        `[coop-soak-coverage] COMPLETENESS BACKSTOP FAILED (profile=level, seed ${opts.seed}, ${opts.wavesCompleted} waves):\n`
          + `  - LEVEL FAINT CHANNEL COLD: the level party is built to FAINT reliably, but ${faintCold.length} `
          + "faint surface(s) went unexercised - the profile's whole point is to GUARANTEE the faint/switch/"
          + `replace machinery (#845-#848). RED, not a narrowing (replay SOAK_SEED=${opts.seed} SOAK_PROFILE=level): `
          + `[${faintCold.join(", ")}]`,
      );
    }
  }

  // Below the gate: report-only. Do NOT touch the ledger (keep the union window to DEEP runs only).
  if (opts.wavesCompleted < gate) {
    log(
      `[coop-soak-coverage] REPORT-ONLY (profile=${profile}, surveyed ${opts.wavesCompleted} < ${gate} waves): coverage logged, nothing enforced.`,
    );
    return;
  }

  log(
    `[coop-soak-coverage] ENFORCING (profile=${profile}, surveyed ${opts.wavesCompleted} >= ${gate} waves, seed ${opts.seed}).`,
  );

  const reds: string[] = [];

  // (1) PARTITION / anti-silent-drop: every EXPECTED surface must be classified.
  const unclassified = sorted(expected).filter(
    s => !KNOWN_UNDRIVABLE.has(s) && !guaranteed.has(s) && !probabilistic.has(s),
  );
  if (unclassified.length > 0) {
    reds.push(
      `ANTI-SILENT-DROP: ${unclassified.length} surface(s) are in a registry but neither driven nor declared `
        + "undrivable - CLASSIFY each (add to KNOWN_UNDRIVABLE with a follow-up task, or to GUARANTEED / "
        + `PROBABILISTIC): [${unclassified.join(", ")}]`,
    );
  }
  // A classification key that names a surface NOT in EXPECTED is stale (a registry entry was removed) - warn.
  const staleClassified = sorted(new Set([...guaranteed, ...probabilistic, ...KNOWN_UNDRIVABLE.keys()])).filter(
    s => !expected.has(s),
  );
  if (staleClassified.length > 0) {
    log(
      `[coop-soak-coverage] ! STALE classification keys (no longer in any registry - prune): [${staleClassified.join(", ")}]`,
    );
  }

  // (2) GUARANTEED: every one must be hit.
  const guaranteedCold = sorted(guaranteed).filter(s => expected.has(s) && !hit.has(s));
  if (guaranteedCold.length > 0) {
    reds.push(
      `GUARANTEED COLD: ${guaranteedCold.length} surface(s) that MUST be hit in a ${opts.wavesCompleted}-wave `
        + `run were not driven (a real regression - replay SOAK_SEED=${opts.seed}): [${guaranteedCold.join(", ")}]`,
    );
  }

  // (3) PROBABILISTIC: assert the cross-run UNION over the last window of DEEP runs (this run appended).
  const kept = appendLedger(ledgerPath, {
    ts: new Date().toISOString(),
    seed: opts.seed,
    wavesCompleted: opts.wavesCompleted,
    surfaces: [...hit],
  });
  const window = kept.slice(-COMPLETENESS_LEDGER_WINDOW);
  const union = new Set<string>();
  for (const run of window) {
    for (const s of run.surfaces) {
      union.add(s);
    }
  }
  const probCold = sorted(probabilistic).filter(s => expected.has(s) && !union.has(s));
  if (probCold.length > 0) {
    if (window.length >= COMPLETENESS_LEDGER_MATURE) {
      reds.push(
        `PROBABILISTIC COLD (union over the last ${window.length} deep runs): ${probCold.length} surface(s) `
          + "have been cold across every recent run - investigate whether the seed space stopped reaching them "
          + `(replay SOAK_SEED=${opts.seed}): [${probCold.join(", ")}]`,
      );
    } else {
      log(
        `[coop-soak-coverage] ⚠ PROBABILISTIC cold across the ${window.length} ledger run(s) so far (need ${COMPLETENESS_LEDGER_MATURE} `
          + `to enforce; WARN only): [${probCold.join(", ")}]`,
      );
    }
  }

  if (reds.length > 0) {
    throw new Error(
      `[coop-soak-coverage] COMPLETENESS BACKSTOP FAILED (seed ${opts.seed}, ${opts.wavesCompleted} waves):\n`
        + reds.map(r => `  - ${r}`).join("\n"),
    );
  }
  log(`[coop-soak-coverage] ✅ COMPLETENESS BACKSTOP PASSED (seed ${opts.seed}).`);
}
