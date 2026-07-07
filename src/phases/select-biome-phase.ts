import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import {
  clearCoopBiomeInteractionStart,
  coopBiomeInteractionInProgress,
  coopBiomeInteractionStartValue,
  coopBiomePickerAutoResolvesInTest,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_BIOME_WAIT_MS } from "#data/elite-redux/coop/coop-interaction-relay";
import { getCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import {
  advanceCoopInteractionForContinuation,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRendezvous,
  getCoopRuntime,
  getCoopUiMirror,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_BIOME_PICK_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import {
  type ErRouteNode,
  erBiomeRoutingActive,
  getErPendingNodes,
  getErPrevBiome,
  rollErNextBiomeNodes,
} from "#data/elite-redux/er-biome-routing";
import { consumeMapTravelTarget } from "#data/elite-redux/er-map-nodes";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import { BiomeId } from "#enums/biome-id";
import { ChallengeType } from "#enums/challenge-type";
import { UiMode } from "#enums/ui-mode";
import { MapModifier, MoneyInterestModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, getBiomeName, randSeedInt, randSeedItem } from "#utils/common";
import { enumValueToKey } from "#utils/enums";

export class SelectBiomePhase extends BattlePhase {
  public readonly phaseName = "SelectBiomePhase";

  /**
   * Co-op (#848): the interaction counter to advance ONCE at the terminal, or -1 when this
   * transition ticks no alternation counter. Set when this phase participates in a biome
   * interaction: a chained crossroads-Leave (always, so the deferred crossroads terminal lands
   * here) or a multi-node World-Map pick (pinned at the picker). A purely-deterministic natural
   * transition with no picker leaves it -1 and never ticks the shared counter.
   */
  private coopAdvancePinned = -1;
  /** Co-op (#848): whether this phase completes a deferred crossroads-Leave interaction. */
  private coopChained = false;

  start() {
    super.start();

    globalScene.resetSeed();

    const gameMode = globalScene.gameMode;
    const currentBiome = globalScene.arena.biomeId;
    const currentWaveIndex = globalScene.currentBattle.waveIndex;
    const nextWaveIndex = currentWaveIndex + 1;

    // Co-op (#848): a crossroads LEAVE deferred its owner-alternated terminal to this phase (the
    // whole Stay/Leave->biome decision is ONE interaction). Adopt its pin so this phase advances the
    // shared counter exactly once at its terminal, whatever biome path it resolves through below.
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    // #848 test-scoped: under vitest (unless the test drives the picker) the biome pick auto-resolves like
    // the pre-#848 co-op bypass - see the guarded return below. In that mode this phase must NOT tick the
    // interaction counter (the authoritative soak's driver never runs the guest's biome pick, so a tick
    // would advance the host alone and breach two-engine LOCKSTEP), so skip adopting the chained pin.
    const coopAutoResolve = coopController != null && coopBiomePickerAutoResolvesInTest();
    if (coopController != null && !coopAutoResolve && coopBiomeInteractionInProgress()) {
      this.coopChained = true;
      this.coopAdvancePinned = coopBiomeInteractionStartValue();
    }

    if (
      (gameMode.isClassic && gameMode.isWaveFinal(nextWaveIndex + 9))
      || (gameMode.isDaily && gameMode.isWaveFinal(nextWaveIndex))
      || (gameMode.hasShortBiomes && !(nextWaveIndex % 50))
    ) {
      this.setNextBiomeAndEnd(BiomeId.END);
      return;
    }

    // ER (#486): a travel event (The Storm / Ultra Wormhole / Echo Chamber) may
    // have set a destination from a revealed map node. Honor it for this single
    // transition, ahead of the normal biome links - but never over the run finale
    // (handled above, which returns before we consume the target).
    const travelTarget = consumeMapTravelTarget();
    if (travelTarget != null) {
      this.setNextBiomeAndEnd(travelTarget);
      return;
    }

    // #848 test-scoped: auto-resolve the biome DETERMINISTICALLY off the just-reset shared wave seed with
    // NO counter tick (coopAdvancePinned stays -1), exactly like the pre-#848 co-op bypass - so the
    // driver-based soak (which does not drive the guest's biome pick) stays in two-engine lockstep. The
    // real owner/watcher/mirror picker below runs in production + the opted-in duo test.
    if (coopAutoResolve) {
      this.setNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
      return;
    }

    // ER (#486): the branching World Map graph. Build the next-biome node set
    // (base links + 50%-rolled unexpected adjacents, minus the biome we came
    // from, with reveal gated by Map Upgrade tier) and let the player choose.
    if (erBiomeRoutingActive()) {
      // Reuse the nodes rolled + shown on the map when this biome was entered, so
      // the chooser matches the overlay. Fall back to a fresh roll (e.g. run start).
      const pending = getErPendingNodes();
      const nodes = pending.length > 0 ? pending : rollErNextBiomeNodes(currentBiome, getErPrevBiome());
      const revealed = nodes.filter(n => n.revealed);
      if (revealed.length > 1) {
        // Co-op (#848): the ER World Map route pick is an owner-alternated, MIRRORED interaction -
        // the OWNER drives the real picker + streams its cursor, the WATCHER opens a read-only copy
        // and adopts the owner's relayed biome. Restore the CORE mechanic co-op used to amputate.
        if (coopController != null) {
          // #858: the counter is pinned INSIDE coopBiomePickFlow, AFTER the boundary barrier (for a natural
          // pick) - never here, where a partner racing ahead from the preceding biome-shop interaction could
          // drift it. A chained crossroads-Leave already set coopAdvancePinned above (its crossroads entry
          // barriered) and coopBiomePickFlow keeps it.
          void this.coopBiomePickFlow(coopController, revealed, currentBiome);
          return;
        }
        // Present the choice as the branching World Map node picker (#486). Only the
        // REVEALED nodes are offered - the extra (green) "upgrade" node appears ONLY
        // when a Map Upgrade item actually reveals it; we no longer surface locked
        // "???" placeholders, so a player with no Map Upgrade never sees an
        // upgrade slot (the #542 fix for "I get the map-upgrade node regardless").
        // Use the full World Map screen (journey chain + biome thumbnails) as the
        // route chooser, in pick mode - the same view the J hotkey shows, but here
        // the onward tiles are selectable (#486: "let me pick from the world map").
        globalScene.ui.setMode(UiMode.ER_MAP, {
          nodes: revealed,
          origin: currentBiome,
          onSelect: (biome: BiomeId) => {
            // #record-replay (single-player): capture the World-Map biome pick (no-op unless recording).
            recordSinglePlayerInteraction("biome", biome);
            this.setNextBiomeAndEnd(biome);
          },
        });
      } else {
        this.setNextBiomeAndEnd(revealed[0].biome);
      }
      return;
    }

    if (gameMode.hasRandomBiomes) {
      this.setNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
      return;
    }

    const { biomeLinks } = allBiomes.get(currentBiome);
    if (biomeLinks.length > 1) {
      const biomes: BiomeId[] = biomeLinks
        .filter(b => !Array.isArray(b) || !randSeedInt(b[1]))
        .map(b => (Array.isArray(b) ? b[0] : b));

      // Co-op (#848): the vanilla biome-link picker is NOT the ER World Map; rather than open an
      // unmirrored prompt in co-op, auto-resolve it deterministically (both clients share the wave
      // seed, so randSeedItem lands identically). No alternation tick (no picker shown).
      if (coopController == null && biomes.length > 1 && globalScene.findModifier(m => m instanceof MapModifier)) {
        const biomeSelectItems = biomes.map(b => {
          return {
            label: getBiomeName(b),
            handler: () => {
              globalScene.ui.setMode(UiMode.MESSAGE);
              // #record-replay (single-player): capture the biome-link pick (no-op unless recording).
              recordSinglePlayerInteraction("biome", b);
              this.setNextBiomeAndEnd(b);
              return true;
            },
          } satisfies OptionSelectItem as OptionSelectItem;
        });
        globalScene.ui.setMode(UiMode.OPTION_SELECT, {
          options: biomeSelectItems,
          delay: 1000,
        });
      } else {
        this.setNextBiomeAndEnd(randSeedItem(biomes));
      }
      return;
    }

    if (biomeLinks.length === 1) {
      if (Array.isArray(biomeLinks[0])) {
        console.warn(
          "Biomes with a link to a single other biome should not have a weight assigned to the link.\n",
          "Biome:",
          enumValueToKey(BiomeId, allBiomes.get(currentBiome).biomeId),
          "| Links:",
          biomeLinks,
        );
        // @ts-expect-error: failsafe for invalid biome links structure
        biomeLinks[0] = biomeLinks[0][0];
      }
      this.setNextBiomeAndEnd(biomeLinks[0] as BiomeId);
      return;
    }

    this.setNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
  }

  // ---------------------------------------------------------------------------
  // Co-op (#848) owner-alternated + mirrored ER World Map route pick.
  // ---------------------------------------------------------------------------

  /** Decide owner vs watcher off the pinned interaction counter and branch. */
  private async coopBiomePickFlow(
    controller: CoopSessionController,
    revealed: ErRouteNode[],
    origin: BiomeId,
  ): Promise<void> {
    // #848 test-scoped: a headless multi-wave test never picks a World-Map node. Under vitest (unless the
    // test drives the picker) AUTO-RESOLVE SYNCHRONOUSLY + deterministically on BOTH engines (generateNext
    // Biome off the just-reset shared wave seed -> identical biome -> both advance the pinned counter once,
    // staying in lockstep). Synchronous by design: an async relay/timer here would resume OUTSIDE the two-
    // engine harness's per-client ctx swap and advance the wrong engine. Production keeps the real
    // owner/watcher picker below with no timeout. (start() already returned for auto-resolve, so this branch
    // is defensive; it runs BEFORE the #858 boundary barrier to keep the auto-resolve path synchronous.)
    if (coopBiomePickerAutoResolvesInTest()) {
      const biome = this.generateNextBiome(globalScene.currentBattle.waveIndex + 1);
      coopLog("reward", `biome pick AUTO-RESOLVE (vitest, picker not driven) -> biome=${BiomeId[biome]} (#848)`);
      this.setNextBiomeAndEnd(biome);
      return;
    }
    const spoofed = getCoopRuntime()?.spoof != null;
    // #858 BOUNDARY BARRIER: for a NATURAL biome-end pick (NOT chained from a crossroads Leave - that already
    // barriered at its own crossroads entry) the preceding every-10-waves biome-shop interaction must
    // terminate on BOTH clients before this interaction pins its counter. Same one-sided-fallback ->
    // biome-divergence guard as the crossroads (see ErCrossroadsPhase.coopAwaitBoundaryBarrier): a partner
    // that finished the shop and raced ahead could otherwise drift the lagging client's counter (the
    // coop-session pendingRemote fold) past this interaction, mismatching the relay seq and forcing a
    // one-sided deterministic fallback. Skipped when chained (already barriered) or spoofed (no real peer).
    if (!this.coopChained && !spoofed) {
      await this.coopAwaitBoundaryBarrier();
    }
    if (this.coopAdvancePinned < 0) {
      // Natural biome-end multi-node pick: pin its own counter AFTER the boundary barrier, in lockstep.
      this.coopAdvancePinned = controller.interactionCounter();
    }
    const pinned = this.coopAdvancePinned;
    const owns = spoofed || controller.isLocalOwnerAtCounter(pinned);
    coopLog(
      "reward",
      `biome pick owner/watcher decision: pinnedStart=${pinned} role=${controller.role} spoof=${spoofed} chained=${this.coopChained} -> ${owns ? "OWNER" : "WATCHER"} (#848)`,
    );
    if (owns) {
      this.coopBiomePickOwner(revealed, origin, pinned);
    } else {
      await this.coopBiomePickWatch(revealed, origin, pinned);
    }
  }

  /**
   * Co-op (#858): the reciprocal boundary barrier between the preceding biome-shop interaction and a NATURAL
   * biome-end pick. Blocks until the partner has ALSO reached this wave's biome choice (both left the shop),
   * so neither pins the interaction counter while the other still holds the shop. The point derives from the
   * WAVE only (never the drifting counter), so both compute it identically. A dead partner resolves via the
   * anti-hang timeout (LOUD WARN) so this never strands the run. Never throws.
   */
  private async coopAwaitBoundaryBarrier(): Promise<void> {
    try {
      const rendezvous = getCoopRendezvous();
      const wave = globalScene.currentBattle?.waveIndex ?? -1;
      if (rendezvous == null || wave < 0) {
        return;
      }
      const point = `biomepick:${wave}`;
      coopLog("rendezvous", `biome-pick boundary barrier RENDEZVOUS ${point} (#858)`);
      const result = await rendezvous.rendezvous(point, getCoopRendezvousWaitMs());
      if (result.timedOut) {
        coopWarn(
          "rendezvous",
          `biome-pick boundary barrier ${point} TIMED OUT - partner never left the shop; proceeding (anti-hang) (#858)`,
        );
      } else if (result.crossPoint !== undefined) {
        coopLog(
          "rendezvous",
          `biome-pick boundary barrier ${point} CROSS-POINT release (partner at ${result.crossPoint}); proceeding (#858)`,
        );
      }
    } catch (e) {
      coopWarn("rendezvous", "biome-pick boundary barrier threw (handled, proceeding) (#858)", e);
    }
  }

  /** OWNER: drive the real ER_MAP picker + stream its cursor; relay the chosen biome, then apply. */
  private coopBiomePickOwner(revealed: ErRouteNode[], origin: BiomeId, pinned: number): void {
    const mirrorSeq = COOP_BIOME_PICK_SEQ_BASE + pinned;
    globalScene.ui.setMode(UiMode.ER_MAP, {
      nodes: revealed,
      origin,
      onSelect: (biome: BiomeId) => {
        getCoopUiMirror()?.endSession();
        this.coopBiomeOwnerCommit(revealed, pinned, biome);
      },
    });
    // Relay the owner's live cursor to the watcher's read-only copy (cosmetic; truth = the relay).
    getCoopUiMirror()?.beginSession("owner", UiMode.ER_MAP, mirrorSeq);
  }

  /** OWNER terminal: relay the chosen biome (index + id), then apply it. */
  private coopBiomeOwnerCommit(revealed: ErRouteNode[], pinned: number, biome: BiomeId): void {
    const idx = revealed.findIndex(n => n.biome === biome);
    try {
      // Relay both the index AND the biome id: the watcher applies the biome verbatim, so a
      // divergent revealed-list order could never land it in a different biome than the owner.
      getCoopInteractionRelay()?.sendInteractionChoice(COOP_BIOME_PICK_SEQ_BASE + pinned, "biomePick", idx, [biome]);
      coopLog("reward", `biome pick OWNER commit biome=${BiomeId[biome]} idx=${idx} pinnedStart=${pinned} (#848)`);
    } catch {
      coopWarn("reward", "biome pick OWNER relay send threw (handled - watcher heals on timeout) (#848)");
    }
    this.setNextBiomeAndEnd(biome);
  }

  /** WATCHER: open a read-only mirrored copy, await the owner's biome, apply it authoritatively. (Not
   *  reached under the vitest auto-resolve - coopBiomePickFlow resolves synchronously before the split.) */
  private async coopBiomePickWatch(revealed: ErRouteNode[], origin: BiomeId, pinned: number): Promise<void> {
    const mirrorSeq = COOP_BIOME_PICK_SEQ_BASE + pinned;
    try {
      await globalScene.ui.setMode(UiMode.ER_MAP, {
        nodes: revealed,
        origin,
        // Read-only: a replayed owner ACTION must never resolve the watcher against its own cursor.
        // The awaited relay below is the sole authority.
        onSelect: () => {
          /* cosmetic no-op */
        },
      });
      getCoopUiMirror()?.beginSession("watcher", UiMode.ER_MAP, mirrorSeq);
    } catch {
      coopWarn("reward", "biome pick WATCHER map failed to open (still awaiting relay) (#848)");
    }
    const relay = getCoopInteractionRelay();
    const res =
      relay == null ? null : await relay.awaitInteractionChoice(COOP_BIOME_PICK_SEQ_BASE + pinned, COOP_BIOME_WAIT_MS);
    getCoopUiMirror()?.endSession();
    let biome: BiomeId;
    if (res != null && res.data != null && res.data.length > 0) {
      biome = res.data[0] as BiomeId;
      coopLog("reward", `biome pick WATCHER: owner biome=${BiomeId[biome]} received pinnedStart=${pinned} (#848)`);
    } else if (res != null && res.choice >= 0 && res.choice < revealed.length) {
      biome = revealed[res.choice].biome;
      coopLog("reward", `biome pick WATCHER: owner idx=${res.choice} -> biome=${BiomeId[biome]} (#848)`);
    } else {
      // ANTI-HANG (#848): disconnect / stall backstop. Fall back to the SAME deterministic roll both
      // clients compute off the just-reset shared wave seed, so the fallback cannot desync.
      biome = this.generateNextBiome(globalScene.currentBattle.waveIndex + 1);
      coopWarn(
        "reward",
        `biome pick WATCHER: owner pick TIMEOUT/disconnect -> deterministic fallback biome=${BiomeId[biome]} (#848)`,
      );
    }
    // Tear the map back down before the biome-switch flow runs, then apply.
    await globalScene.ui.setMode(UiMode.MESSAGE);
    this.setNextBiomeAndEnd(biome);
  }

  private generateNextBiome(waveIndex: number): BiomeId {
    return waveIndex % 50 === 0 ? BiomeId.END : globalScene.generateRandomBiome(waveIndex);
  }

  private setNextBiomeAndEnd(nextBiome: BiomeId): void {
    const gameMode = globalScene.gameMode;
    const currentWaveIndex = globalScene.currentBattle.waveIndex;
    const nextWaveIndex = currentWaveIndex + 1;

    // ER (#486): with variable biome length the biome start is no longer at %10+1,
    // and SelectBiomePhase runs at every REAL biome transition (pushed when
    // isNewBiome()). Money interest still fires per biome start under the gate;
    // vanilla / daily / endless only reach this block at %10===1.
    if (erBiomeRoutingActive() || nextWaveIndex % 10 === 1) {
      globalScene.applyModifiers(MoneyInterestModifier, true);
      // ER: the biome REST (full heal, or its challenge-substituted reward) is on the
      // every-10-GLOBAL-wave cadence - NOT on every World-Map biome leave. With
      // variable biome length / Crossroads a biome can END off the 10-wave boundary;
      // healing there handed out a free full-heal "just for leaving the biome". Gate
      // it to the 10-wave tick (a biome-ending x0 wave). Mid-biome x0 waves heal via
      // VictoryPhase (#504, which skips biome-ending waves so there is no double-heal).
      if (nextWaveIndex % 10 === 1) {
        const healStatus = new BooleanHolder(true);
        applyChallenges(ChallengeType.PARTY_HEAL, healStatus);
        if (healStatus.value) {
          globalScene.phaseManager.unshiftNew("PartyHealPhase", false);
        } else {
          globalScene.phaseManager.unshiftNew(
            "SelectModifierPhase",
            undefined,
            undefined,
            gameMode.isFixedBattle(currentWaveIndex)
              ? gameMode.getFixedBattle(currentWaveIndex)?.customModifierRewardSettings
              : undefined,
          );
        }
      }
    }
    globalScene.phaseManager.unshiftNew("SwitchBiomePhase", nextBiome);
    // Co-op (#848): terminate the biome interaction with the single from-pinned advance (idempotent,
    // #837). Fires when this phase participated in an interaction: a chained crossroads-Leave (always)
    // or a multi-node World-Map pick. A purely-deterministic natural transition never ticks the counter.
    if (this.coopAdvancePinned >= 0) {
      advanceCoopInteractionForContinuation(this.coopAdvancePinned);
      if (this.coopChained) {
        clearCoopBiomeInteractionStart();
      }
    }
    this.end();
  }
}
