/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { getFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { getMoodyCoordinatorBarrier } from "#data/elite-redux/moody/moody-coordinator-combat-state";
import { getMoodyEnemyBoonLoadout } from "#data/elite-redux/moody/moody-enemy";
import {
  getMoodyFormationHudSnapshot,
  type MoodyFormationHudPokemonSnapshot,
} from "#data/elite-redux/moody/moody-formation-game-adapter";
import { deserializeMoodyRuntimeFieldState } from "#data/elite-redux/moody/moody-runtime-field-adapter";
import { getCurrentMoodyLiveProjection } from "#data/elite-redux/moody/moody-runtime-live-adapter";
import { getMoodyModeState, MOODY_BOON_BY_ID, MOODY_CURSE_BY_ID } from "#data/elite-redux/moody/moody-state";
import { UiMode } from "#enums/ui-mode";
import {
  createMoodyBattleHud,
  type MoodyBattleHudComponent,
  type MoodyBattleHudModel,
} from "#ui/moody/moody-battle-hud";
import { getMoodyLivePresentationSnapshot } from "#ui/moody/moody-live-presentation";
import type { MoodyFeedEntry, MoodyTrackerChipModel } from "#ui/moody/moody-presentation";

const BATTLE_MODES = new Set([UiMode.MESSAGE, UiMode.COMMAND, UiMode.FIGHT, UiMode.BALL, UiMode.TARGET_SELECT]);

export interface MoodyActiveBattlerUiSource {
  readonly pokemonId: number;
  readonly name: string;
}

export interface MoodyActiveBattlerOverlay {
  readonly pokemonId: number;
  readonly tracker: MoodyTrackerChipModel;
  readonly hpOverlay: NonNullable<MoodyBattleHudModel["hpOverlay"]>;
}

function compactMarkLabel(key: string): string {
  const label = key.split(":").at(-1) ?? key;
  return label.replace(/[_-]+/g, " ");
}

function debtDueLabel(dueTurn: number | undefined, currentTurn: number): string | undefined {
  if (dueTurn == null || !Number.isFinite(dueTurn)) {
    return;
  }
  const remaining = Math.floor(dueTurn) - currentTurn;
  if (remaining <= 0) {
    return "due now";
  }
  return `due in ${remaining} turn${remaining === 1 ? "" : "s"}`;
}

export function buildMoodyActiveBattlerOverlays(
  activeBattlers: readonly MoodyActiveBattlerUiSource[],
  fieldNumbers: Readonly<Record<string, number>>,
  formationSnapshots: readonly MoodyFormationHudPokemonSnapshot[],
  apexSegmentsByPokemon: Readonly<Record<string, readonly number[]>>,
  currentTurn: number,
  coordinatorBarriers: Readonly<Record<string, number>> = {},
): MoodyActiveBattlerOverlay[] {
  const formationByPokemon = new Map(formationSnapshots.map(snapshot => [snapshot.pokemonId, snapshot]));
  return activeBattlers.flatMap(active => {
    const formation = formationByPokemon.get(active.pokemonId);
    const fieldBarrier = Object.entries(fieldNumbers)
      .filter(([key]) => key.endsWith(`:runtime-barrier:pokemon:${active.pokemonId}:amount`))
      .reduce((total, [, amount]) => total + amount, 0);
    const barrier = fieldBarrier + (formation?.barrier ?? 0) + (coordinatorBarriers[String(active.pokemonId)] ?? 0);
    const damageDebt = fieldNumbers[`persistent:deferred-pain:pokemon:${active.pokemonId}:debt`] ?? 0;
    const dueTurn = fieldNumbers[`persistent:deferred-pain:pokemon:${active.pokemonId}:due`];
    const dueLabel = damageDebt > 0 ? debtDueLabel(dueTurn, currentTurn) : undefined;
    const revivalCharges = apexSegmentsByPokemon[String(active.pokemonId)]?.length ?? 0;
    const marks = Object.entries(formation?.marks ?? {}).filter(
      ([, value]) => value !== false && value !== 0 && value !== "",
    );
    if (barrier <= 0 && damageDebt <= 0 && revivalCharges <= 0 && marks.length === 0) {
      return [];
    }

    const values: string[] = [];
    if (barrier > 0) {
      values.push(`barrier ${Math.round(barrier)}`);
    }
    if (damageDebt > 0) {
      values.push(`debt ${Math.round(damageDebt)}${dueLabel == null ? "" : ` (${dueLabel})`}`);
    }
    if (revivalCharges > 0) {
      values.push(`APEX x${revivalCharges}`);
    }
    if (marks.length > 0) {
      values.push(`${marks.length} mark${marks.length === 1 ? "" : "s"}`);
    }
    const markDetail = marks.map(([key, value]) => `${compactMarkLabel(key)}: ${String(value)}`).join("\n");
    return [
      {
        pokemonId: active.pokemonId,
        tracker: {
          id: `active-overlay:${active.pokemonId}`,
          label: active.name,
          value: values.join(" / "),
          urgency: damageDebt > 0 && dueTurn != null && dueTurn <= currentTurn ? "critical" : "normal",
          pinned: true,
          ...(markDetail.length === 0 ? {} : { detail: markDetail }),
        },
        hpOverlay: {
          ...(barrier > 0 ? { barrier } : {}),
          ...(damageDebt > 0 ? { damageDebt, ...(dueLabel == null ? {} : { debtDueLabel: dueLabel }) } : {}),
          ...(revivalCharges > 0 ? { revivalGlyph: "APEX", revivalCharges } : {}),
        },
      },
    ];
  });
}

/**
 * UI-owned bridge between live Moody state and the non-modal battle surfaces.
 * Mechanics may push exact trigger rows or a richer HUD model without coupling
 * the reusable Phaser components to battle phases.
 */
export class MoodyRuntimeUi {
  private readonly hud: MoodyBattleHudComponent;
  private readonly feed: MoodyFeedEntry[] = [];
  private feedOrder = 0;
  private readonly lastProgressByEffect = new Map<string, string>();
  private overrideModel: MoodyBattleHudModel | null = null;

  constructor() {
    this.hud = createMoodyBattleHud(0, 54, 120);
    this.hud.container.setDepth(90);
    globalScene.uiContainer.add(this.hud.container);
  }

  pushTrigger(label: string): void {
    const clean = label.trim();
    if (clean.length === 0) {
      return;
    }
    this.feed.push({ order: ++this.feedOrder, label: clean });
    if (this.feed.length > 12) {
      this.feed.splice(0, this.feed.length - 12);
    }
  }

  setModel(model: MoodyBattleHudModel | null): void {
    this.overrideModel = model;
  }

  toggleTriggerFeed(): void {
    this.hud.toggleFeed();
  }

  refresh(mode: UiMode): void {
    const enabled = getFunModeConfig().moodyMode;
    const state = enabled ? getMoodyModeState() : null;
    const visible = state != null && globalScene.currentBattle != null && BATTLE_MODES.has(mode);
    if (!visible) {
      this.hud.container.setVisible(false);
      return;
    }

    this.captureProgressChanges(state);
    const model = this.overrideModel ?? this.buildLiveModel(state);
    this.applyBattlerDecorations(state, model);
    this.hud.render(model);
  }

  destroy(): void {
    this.hud.container.destroy(true);
  }

  private captureProgressChanges(state: NonNullable<ReturnType<typeof getMoodyModeState>>): void {
    const liveIds = new Set<string>();
    for (const boon of state.boons) {
      liveIds.add(boon.instanceId);
      const current = JSON.stringify({ progress: boon.progress ?? {}, dormant: boon.dormant === true });
      const previous = this.lastProgressByEffect.get(boon.instanceId);
      if (previous != null && previous !== current) {
        const name = MOODY_BOON_BY_ID.get(boon.boonId)?.name ?? boon.boonId;
        const counters = Object.entries(boon.progress?.counters ?? {});
        const detail =
          counters.length === 0
            ? boon.dormant
              ? "dormant"
              : "state changed"
            : `${counters.at(-1)![0]} ${counters.at(-1)![1]}`;
        this.pushTrigger(`${name}: ${detail}`);
      }
      this.lastProgressByEffect.set(boon.instanceId, current);
    }
    for (const instanceId of this.lastProgressByEffect.keys()) {
      if (!liveIds.has(instanceId)) {
        this.lastProgressByEffect.delete(instanceId);
      }
    }
  }

  private buildLiveModel(state: NonNullable<ReturnType<typeof getMoodyModeState>>): MoodyBattleHudModel {
    const enemy = getMoodyEnemyBoonLoadout();
    const rules: string[] = [];
    for (const curse of state.curses) {
      rules.push(`CURSE: ${MOODY_CURSE_BY_ID.get(curse.curseId)?.name ?? curse.curseId}`);
    }
    const globalRules = state.boons.filter(boon => {
      const kind = MOODY_BOON_BY_ID.get(boon.boonId)?.targetKind;
      return !boon.dormant && (kind === "rule" || kind === "field" || kind === "team");
    });
    for (const globalRule of globalRules) {
      rules.push(MOODY_BOON_BY_ID.get(globalRule.boonId)?.name ?? globalRule.boonId);
    }
    if (enemy != null && enemy.boons.length > 0) {
      rules.push(`ENEMY MOOD: ${enemy.boons.length} line${enemy.boons.length === 1 ? "" : "s"}`);
    }

    const numbers = state.fieldRuntime == null ? {} : deserializeMoodyRuntimeFieldState(state.fieldRuntime).numbers;
    const coordinatorBarriers = Object.fromEntries(
      globalScene.getPlayerField(true).map(pokemon => [String(pokemon.id), getMoodyCoordinatorBarrier(pokemon.id)]),
    );
    const activeOverlays = buildMoodyActiveBattlerOverlays(
      globalScene.getPlayerField(true).map(pokemon => ({ pokemonId: pokemon.id, name: pokemon.getNameToRender() })),
      numbers,
      getMoodyFormationHudSnapshot().activePlayer,
      getCurrentMoodyLiveProjection()?.progression.apexSegmentsByPokemon ?? {},
      globalScene.currentBattle.turn,
      coordinatorBarriers,
    );
    const trackers: MoodyTrackerChipModel[] = activeOverlays.map(overlay => overlay.tracker);
    const presentation = getMoodyLivePresentationSnapshot();
    const bounty = presentation?.bounty;
    if (bounty != null) {
      const bountyTracker: MoodyTrackerChipModel = {
        id: `bounty:${bounty.id}`,
        label: `BOUNTY: ${bounty.name}`,
        value: bounty.progressLabel,
        urgency: bounty.status === "failed" ? "critical" : bounty.status === "complete" ? "normal" : "warning",
        pinned: true,
      };
      if (bounty.detail != null) {
        bountyTracker.detail = bounty.detail;
      }
      trackers.push(bountyTracker);
    }
    for (const tracker of presentation?.trackers ?? []) {
      trackers.push({
        id: tracker.id,
        label: tracker.label,
        value: tracker.value,
        urgency: tracker.urgency ?? "normal",
        pinned: tracker.pinned ?? false,
        ...(tracker.detail == null ? {} : { detail: tracker.detail }),
      });
    }
    for (const marker of presentation?.curseMarkers ?? []) {
      rules.push(`CURSE MARK: ${marker.label}`);
      trackers.push({
        id: `curse-marker:${marker.id}`,
        label: marker.label,
        value: marker.pokemonId == null ? "active" : `Pokemon ${marker.pokemonId}`,
        urgency: marker.urgency ?? "warning",
        pinned: marker.urgency === "critical",
        detail: marker.detail,
      });
    }
    for (const boon of state.boons) {
      const counters = Object.entries(boon.progress?.counters ?? {});
      if (counters.length === 0) {
        continue;
      }
      const name = MOODY_BOON_BY_ID.get(boon.boonId)?.name ?? boon.boonId;
      const [counter, value] = counters[0];
      trackers.push({
        id: boon.instanceId,
        label: name,
        value: `${counter}: ${value}`,
        urgency: boon.dormant ? "warning" : "normal",
        pinned: false,
      });
    }

    const hpOverlay = activeOverlays[0]?.hpOverlay;
    return {
      ruleLines: rules,
      trackers,
      feed: this.feed.slice(-12),
      ...(hpOverlay == null ? {} : { hpOverlay }),
      hpOverlays: activeOverlays.map(overlay => ({
        pokemonId: overlay.pokemonId,
        pokemonName: overlay.tracker.label,
        ...overlay.hpOverlay,
      })),
    };
  }

  private applyBattlerDecorations(
    state: NonNullable<ReturnType<typeof getMoodyModeState>>,
    model: MoodyBattleHudModel,
  ): void {
    const playerField = globalScene.getPlayerField(true);
    const overlays = new Map((model.hpOverlays ?? []).map(overlay => [overlay.pokemonId, overlay]));
    if (model.hpOverlay != null && model.hpOverlays == null && playerField[0] != null) {
      overlays.set(playerField[0].id, {
        pokemonId: playerField[0].id,
        pokemonName: playerField[0].getNameToRender(),
        ...model.hpOverlay,
      });
    }
    for (const pokemon of playerField) {
      const partySlot = globalScene.getPlayerParty().findIndex(candidate => candidate.id === pokemon.id);
      const targetedBoons = state.boons.filter(
        boon => boon.target?.pokemonIds?.includes(pokemon.id) || boon.target?.partySlots?.includes(partySlot),
      );
      const targetedCurses = state.curses.filter(
        curse => curse.target?.pokemonIds?.includes(pokemon.id) || curse.target?.partySlots?.includes(partySlot),
      );
      const overlay = overlays.get(pokemon.id);
      const runtimeEffects =
        (overlay?.barrier ?? 0) > 0 || (overlay?.damageDebt ?? 0) > 0 || (overlay?.revivalCharges ?? 0) > 0 ? 1 : 0;
      pokemon.getBattleInfo().setMoodyPresentation({
        effectCount: targetedBoons.length + targetedCurses.length + runtimeEffects,
        curseCount: targetedCurses.length,
        barrier: overlay?.barrier ?? 0,
        maxHp: pokemon.getMaxHp(),
        hpRatio: pokemon.getHpRatio(true),
      });
    }
  }
}
