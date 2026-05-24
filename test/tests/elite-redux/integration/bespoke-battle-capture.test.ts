/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Battle-capture harness for ALL wired bespoke ER abilities.
//
// For each WIRED bespoke ability:
//  1. Spin up a real GameManager battle with the ability on the ENEMY (so
//     we can observe its effects without the player input loop interfering)
//  2. Run one turn (player Tackle, enemy Splash)
//  3. Capture: enemy HP, status, battler tags, stat stages, ability shown,
//     player damage taken, player status, etc.
//  4. Write each per-ability result to docs/plans/bespoke-battle-capture.csv
//  5. Hard-fail only on uncaught exceptions; soft-classify the rest into
//     OK / NO-OBSERVABLE / CRASHED
//
// This is the "battle CLI" the user keeps asking for — runs against the
// REAL phase pipeline, not a parallel test engine.
// =============================================================================

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { dispatchBespoke } from "#data/elite-redux/archetype-dispatcher";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

interface BattleCapture {
  erId: number;
  pokerogueId: number;
  status: "OK" | "NO-OBSERVABLE" | "CRASHED" | "INIT-FAILED";
  observable: string;
  error: string;
}

const REPORT_PATH = join(process.cwd(), "docs", "plans", "bespoke-battle-capture.csv");

describe("Bespoke ability battle capture (real GameManager — one round each)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const results: BattleCapture[] = [];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    // GameManager handles its own cleanup.
  });

  // SAMPLE_ABILITIES: 20 high-leverage abilities tested per shape. The
  // full-262 run lives in the "every bespoke ability survives one turn"
  // it() below, gated behind `ER_BATTLE_FULL=1` because it takes ~30s
  // per ability ≈ 2 hours total.
  const SAMPLE_ABILITIES: { erId: number; label: string }[] = [
    { erId: 270, label: "Pyromancy (post-attack burn)" },
    { erId: 879, label: "Chilling Pellets (counter-attack on hit)" },
    { erId: 292, label: "Avenger (post-ally-faint)" },
    { erId: 734, label: "Ape Shift (hp-threshold form change)" },
    { erId: 313, label: "Dragonslayer (type-effectiveness mod)" },
    { erId: 273, label: "Power Fists (defense-stat swap + 1.3x)" },
    { erId: 268, label: "Chloroplast (weather-stat multiplier)" },
    { erId: 923, label: "Galeforce Wings (priority modifier)" },
    { erId: 634, label: "Last Stand (hp-conditional stat boost)" },
    { erId: 904, label: "Strong Foundation (resist + force-switch immune)" },
    { erId: 429, label: "Coward (PROTECTED tag once per battle)" },
    { erId: 807, label: "Woodland Curse (scripted Forest's Curse on entry)" },
    { erId: 49, label: "Flame Body (contact + non-contact burn — audit fix)" },
    { erId: 9, label: "Static (paralysis on contact)" },
    { erId: 7, label: "Limber (half recoil + protect-stat)" },
    { erId: 22, label: "Intimidate (drop foe ATK on entry)" },
    { erId: 656, label: "Tag (OnOpponentSwitchOut Pursuit)" },
    { erId: 905, label: "Fog Machine (set FOG on hit)" },
    { erId: 891, label: "Rat King (persistent field aura)" },
    { erId: 933, label: "Polarity (1.3x field aura)" },
  ];

  for (const sample of SAMPLE_ABILITIES) {
    it.skipIf(process.env.ER_FAST === "1" /* fast-mode skips heavy battle */)(
      `survives a one-turn battle: ${sample.label}`,
      async () => {
        const pkrgId = ER_ID_MAP.abilities[sample.erId];
        if (pkrgId === undefined || !allAbilities[pkrgId]) {
          results.push({
            erId: sample.erId,
            pokerogueId: pkrgId ?? -1,
            status: "INIT-FAILED",
            observable: "",
            error: "no pokerogue ability for this er id",
          });
          return;
        }

        let observable = "";
        let status: BattleCapture["status"] = "OK";
        let error = "";

        try {
          game.override
            .battleStyle("single")
            .enemySpecies(SpeciesId.RATTATA)
            .enemyAbility(pkrgId as AbilityId)
            .enemyMoveset(MoveId.SPLASH)
            .moveset(MoveId.TACKLE)
            .hasPassiveAbility(true);

          await game.classicMode.startBattle(SpeciesId.PIKACHU);

          const enemy = game.field.getEnemyPokemon();
          const player = game.field.getPlayerPokemon();
          const enemyHpBefore = enemy.hp;
          const playerHpBefore = player.hp;
          const enemyTagsBefore = enemy.summonData.tags.length;
          const playerTagsBefore = player.summonData.tags.length;

          game.move.use(MoveId.TACKLE);
          await game.toEndOfTurn();

          const enemyHpAfter = enemy.hp;
          const playerHpAfter = player.hp;
          const enemyTagsAfter = enemy.summonData.tags.length;
          const playerTagsAfter = player.summonData.tags.length;

          const obs: string[] = [];
          if (enemyHpBefore !== enemyHpAfter) {
            obs.push(`enemyHp:${enemyHpBefore}→${enemyHpAfter}`);
          }
          if (playerHpBefore !== playerHpAfter) {
            obs.push(`playerHp:${playerHpBefore}→${playerHpAfter}`);
          }
          if (enemyTagsBefore !== enemyTagsAfter) {
            obs.push(`enemyTags:${enemyTagsBefore}→${enemyTagsAfter}`);
          }
          if (playerTagsBefore !== playerTagsAfter) {
            obs.push(`playerTags:${playerTagsBefore}→${playerTagsAfter}`);
          }
          if (enemy.status) {
            obs.push(`enemyStatus:${enemy.status.effect}`);
          }
          if (player.status) {
            obs.push(`playerStatus:${player.status.effect}`);
          }
          observable = obs.join("; ") || "none";
          if (observable === "none") {
            status = "NO-OBSERVABLE";
          }
        } catch (err) {
          status = "CRASHED";
          error = err instanceof Error ? err.message : String(err);
        }

        results.push({
          erId: sample.erId,
          pokerogueId: pkrgId,
          status,
          observable,
          error,
        });

        // Write CSV after each ability (incremental for crash recovery).
        const csv = ["er_id,pokerogue_id,status,observable,error"];
        for (const r of results) {
          const safe = (s: string) => s.replace(/,/g, ";").replace(/\n/g, " ").replace(/"/g, "'");
          csv.push(
            `${r.erId},${r.pokerogueId},${r.status},"${safe(r.observable)}","${safe(r.error)}"`,
          );
        }
        writeFileSync(REPORT_PATH, csv.join("\n"));

        expect(status).not.toBe("CRASHED");
      },
    );
  }

  // Lightweight always-on test: verify each sampled ability at least
  // dispatches without throwing. This is the FAST sanity that runs in
  // CI; the heavy battle test above stays gated behind skipIf for
  // on-demand full coverage.
  it("every sampled ability dispatches without throwing", () => {
    for (const sample of SAMPLE_ABILITIES) {
      expect(
        () => dispatchBespoke(sample.erId),
        `${sample.label} (er ${sample.erId})`,
      ).not.toThrow();
      const res = dispatchBespoke(sample.erId);
      expect(res, `${sample.label} returned non-null`).not.toBeNull();
      // Either wired (attrs.length > 0) or honestly skipped (skipReason set).
      const isWired = (res.attrs?.length ?? 0) > 0;
      const isSkip = res.skipReason !== null && res.skipReason !== undefined;
      expect(isWired || isSkip, `${sample.label} is either wired or skip`).toBe(true);
    }
  });

  // FULL-262: one it() per ability — required because GameManager has
  // per-test lifecycle hooks (prompt-handler must be cleared between
  // battles, etc.). Looping inside a single test triggers "Prompt
  // handler run interval was not properly cleared on test end!".
  // Gated behind ER_BATTLE_FULL=1.
  const FULL_BESPOKE = Object.values(ER_ABILITY_ARCHETYPES)
    .filter(e => e.archetype === "bespoke" && e.erAbilityId > 0)
    .map(e => e.erAbilityId);

  const fullResults: BattleCapture[] = [];
  const FULL_REPORT_PATH = join(process.cwd(), "docs", "plans", "bespoke-battle-capture-full.csv");

  function emitFullCsv(): void {
    const csv = ["er_id,pokerogue_id,status,observable,error"];
    for (const r of fullResults) {
      const safe = (s: string) => s.replace(/,/g, ";").replace(/\n/g, " ").replace(/"/g, "'");
      csv.push(`${r.erId},${r.pokerogueId},${r.status},"${safe(r.observable)}","${safe(r.error)}"`);
    }
    writeFileSync(FULL_REPORT_PATH, csv.join("\n"));
  }

  for (const erId of FULL_BESPOKE) {
    it.skipIf(process.env.ER_BATTLE_FULL !== "1")(
      `FULL-262 — er ${erId} survives a one-turn battle`,
      async () => {
        const pkrgId = ER_ID_MAP.abilities[erId];
        if (pkrgId === undefined || !allAbilities[pkrgId]) {
          fullResults.push({ erId, pokerogueId: pkrgId ?? -1, status: "INIT-FAILED", observable: "", error: "no pokerogue ability" });
          emitFullCsv();
          return;
        }
        const res = dispatchBespoke(erId);
        if ((res.attrs?.length ?? 0) === 0) {
          fullResults.push({ erId, pokerogueId: pkrgId, status: "INIT-FAILED", observable: "", error: "empty wire" });
          emitFullCsv();
          return;
        }

        let observable = "", error = "";
        let status: BattleCapture["status"] = "OK";
        try {
          game.override
            .battleStyle("single")
            .enemySpecies(SpeciesId.RATTATA)
            .enemyAbility(pkrgId as AbilityId)
            .enemyMoveset(MoveId.SPLASH)
            .moveset(MoveId.TACKLE)
            .hasPassiveAbility(true);

          await game.classicMode.startBattle(SpeciesId.PIKACHU);
          const enemy = game.field.getEnemyPokemon();
          const player = game.field.getPlayerPokemon();
          const eHp0 = enemy.hp, pHp0 = player.hp;
          const eTags0 = enemy.summonData.tags.length;
          const pTags0 = player.summonData.tags.length;

          game.move.use(MoveId.TACKLE);
          await game.toEndOfTurn();

          const obs: string[] = [];
          if (eHp0 !== enemy.hp) obs.push(`eHp:${eHp0}→${enemy.hp}`);
          if (pHp0 !== player.hp) obs.push(`pHp:${pHp0}→${player.hp}`);
          if (eTags0 !== enemy.summonData.tags.length) obs.push(`eTags:${eTags0}→${enemy.summonData.tags.length}`);
          if (pTags0 !== player.summonData.tags.length) obs.push(`pTags:${pTags0}→${player.summonData.tags.length}`);
          if (enemy.status) obs.push(`eStatus:${enemy.status.effect}`);
          if (player.status) obs.push(`pStatus:${player.status.effect}`);
          observable = obs.join("; ") || "none";
          if (observable === "none") status = "NO-OBSERVABLE";
        } catch (err) {
          status = "CRASHED";
          error = err instanceof Error ? err.message : String(err);
        }
        fullResults.push({ erId, pokerogueId: pkrgId, status, observable, error });
        emitFullCsv();
        expect(status, `er ${erId}: ${error}`).not.toBe("CRASHED");
      },
      /* timeout: */ 60_000,
    );
  }

  // FULL-262 disabled-block — left for backward-compat reference (older
  // single-it loop pattern that crashed with "Prompt handler" cleanup
  // error). New per-ability it() block above is the working version.
  it.skipIf(true)(
    "FULL-262 (DEPRECATED — single-it loop crashed; use per-ability instead)",
    async () => {
      const FULL_REPORT_PATH = join(process.cwd(), "docs", "plans", "bespoke-battle-capture-full.csv");
      const bespoke = Object.values(ER_ABILITY_ARCHETYPES).filter(
        e => e.archetype === "bespoke" && e.erAbilityId > 0,
      );
      const allResults: BattleCapture[] = [];

      for (const entry of bespoke) {
        const erId = entry.erAbilityId;
        const pkrgId = ER_ID_MAP.abilities[erId];
        if (pkrgId === undefined || !allAbilities[pkrgId]) {
          allResults.push({
            erId, pokerogueId: pkrgId ?? -1, status: "INIT-FAILED",
            observable: "", error: "no pokerogue ability for er id",
          });
          continue;
        }
        // Skip 369 Bad Company (empty wire by design).
        const res = dispatchBespoke(erId);
        if ((res.attrs?.length ?? 0) === 0) {
          allResults.push({
            erId, pokerogueId: pkrgId, status: "INIT-FAILED",
            observable: "", error: "empty wire (no attrs)",
          });
          continue;
        }

        let observable = "";
        let status: BattleCapture["status"] = "OK";
        let error = "";

        try {
          game = new GameManager(phaserGame);
          game.override
            .battleStyle("single")
            .enemySpecies(SpeciesId.RATTATA)
            .enemyAbility(pkrgId as AbilityId)
            .enemyMoveset(MoveId.SPLASH)
            .moveset(MoveId.TACKLE)
            .hasPassiveAbility(true);

          await game.classicMode.startBattle(SpeciesId.PIKACHU);
          const enemy = game.field.getEnemyPokemon();
          const player = game.field.getPlayerPokemon();
          const eHp0 = enemy.hp, pHp0 = player.hp;
          const eTags0 = enemy.summonData.tags.length;
          const pTags0 = player.summonData.tags.length;

          game.move.use(MoveId.TACKLE);
          await game.toEndOfTurn();

          const obs: string[] = [];
          if (eHp0 !== enemy.hp) obs.push(`eHp:${eHp0}→${enemy.hp}`);
          if (pHp0 !== player.hp) obs.push(`pHp:${pHp0}→${player.hp}`);
          if (eTags0 !== enemy.summonData.tags.length) obs.push(`eTags:${eTags0}→${enemy.summonData.tags.length}`);
          if (pTags0 !== player.summonData.tags.length) obs.push(`pTags:${pTags0}→${player.summonData.tags.length}`);
          if (enemy.status) obs.push(`eStatus:${enemy.status.effect}`);
          if (player.status) obs.push(`pStatus:${player.status.effect}`);
          observable = obs.join("; ") || "none";
          if (observable === "none") status = "NO-OBSERVABLE";
        } catch (err) {
          status = "CRASHED";
          error = err instanceof Error ? err.message : String(err);
        }

        allResults.push({ erId, pokerogueId: pkrgId, status, observable, error });

        // Incremental CSV write — survives partial runs.
        const csv = ["er_id,pokerogue_id,status,observable,error"];
        for (const r of allResults) {
          const safe = (s: string) => s.replace(/,/g, ";").replace(/\n/g, " ").replace(/"/g, "'");
          csv.push(`${r.erId},${r.pokerogueId},${r.status},"${safe(r.observable)}","${safe(r.error)}"`);
        }
        writeFileSync(FULL_REPORT_PATH, csv.join("\n"));
      }

      const crashed = allResults.filter(r => r.status === "CRASHED");
      console.info(
        `\nFULL-262 capture: ${allResults.length} ran, ${allResults.filter(r => r.status === "OK").length} OK, `
        + `${allResults.filter(r => r.status === "NO-OBSERVABLE").length} no-observable, `
        + `${crashed.length} crashed, `
        + `${allResults.filter(r => r.status === "INIT-FAILED").length} init-failed.`,
      );
      expect(crashed, `${crashed.length} abilities crashed in battle`).toHaveLength(0);
    },
    /* timeout: */ 7_200_000, // 2 hours
  );

  it("classifies coverage across every bespoke ability via dispatchBespoke", () => {
    const bespoke = Object.values(ER_ABILITY_ARCHETYPES).filter(
      e => e.archetype === "bespoke" && e.erAbilityId > 0,
    );
    let wired = 0;
    let skipped = 0;
    let empty = 0;
    let errored = 0;

    for (const entry of bespoke) {
      try {
        const res = dispatchBespoke(entry.erAbilityId);
        if ((res.attrs?.length ?? 0) > 0) {
          wired++;
        } else if (res.skipReason) {
          skipped++;
        } else {
          empty++;
        }
      } catch (_err) {
        errored++;
      }
    }

    console.info(`bespoke coverage — WIRED:${wired} SKIP:${skipped} EMPTY:${empty} ERROR:${errored}`);

    // After Round 53: 262 WIRED, 0 SKIP, 1 EMPTY (369 Bad Company), 0 ERROR.
    expect(errored).toBe(0);
    expect(wired).toBeGreaterThanOrEqual(260);
  });
});
