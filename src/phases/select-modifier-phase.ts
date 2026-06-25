import { consumePendingDevShop } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import {
  COOP_INTERACTION_LEAVE,
  COOP_INTERACTION_REROLL,
  type CoopInteractionChoice,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  getCoopUiMirror,
} from "#data/elite-redux/coop/coop-runtime";
import { erBalanceArr, erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { erScrapMagnetExtraRewards } from "#data/elite-redux/er-relics";
import { BattleType } from "#enums/battle-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import type { ModifierTier } from "#enums/modifier-tier";
import { UiMode } from "#enums/ui-mode";
import type { Modifier } from "#modifiers/modifier";
import {
  ExtraModifierModifier,
  HealShopCostModifier,
  PokemonHeldItemModifier,
  TempExtraModifierModifier,
} from "#modifiers/modifier";
import type { CustomModifierSettings, ModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import {
  ErLearnersShroomModifierType,
  FusePokemonModifierType,
  getPlayerModifierTypeOptions,
  getPlayerShopModifierTypeOptionsForWave,
  PokemonAbilityModifierType,
  PokemonAddMoveSlotModifierType,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonPpRestoreModifierType,
  PokemonPpUpModifierType,
  RememberMoveModifierType,
  regenerateModifierPoolThresholds,
  TmModifierType,
} from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { SHOP_OPTIONS_ROW_LIMIT } from "#ui/modifier-select-ui-handler";
import { PartyOption, PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

export type ModifierSelectCallback = (rowCursor: number, cursor: number) => boolean;

// Co-op (#633): action-type codes packed as data[0] of a relayed reward choice, so the
// WATCHER can route a pick whose `choice` alone is ambiguous (reward vs shop both carry a
// cursor; lock vs transfer both carry 0). REROLL / LEAVE are distinguished by the sentinel
// `choice` value itself and carry no data code.
const COOP_ACT_REWARD = 0;
const COOP_ACT_SHOP = 1;
const COOP_ACT_TRANSFER = 2;
const COOP_ACT_LOCK = 3;
/** How long the WATCHER waits for the owner's next reward pick before leaving (never hangs).
 *  20min: "wait for the human" - a slow shopper must never trip the watcher's premature leave
 *  (which would land the watcher in the next wave while the owner is still shopping = desync). */
const COOP_REWARD_WAIT_MS = 1_200_000;

export class SelectModifierPhase extends BattlePhase {
  public readonly phaseName = "SelectModifierPhase";
  private rerollCount: number;
  private modifierTiers?: ModifierTier[] | undefined;
  private customModifierSettings?: CustomModifierSettings | undefined;
  private isCopy: boolean;

  private typeOptions: ModifierTypeOption[];

  // ---- Co-op alternating reward shop (#633) ----
  /** True only on the WATCHER's phase: it replays the owner's relayed picks with NO interactive UI. */
  private coopWatcher = false;
  /** Owner-side: the selection captured at row/cursor time, relayed once the party target resolves. */
  private coopPendingKind: "reward" | "shop" | null = null;
  private coopPendingCursor = 0;
  private coopPendingRow = 0;
  /** Watcher-side: the owner's relayed party-target slot + sub-option for the pick being replayed. */
  private coopRelayedSlot = -1;
  private coopRelayedOption = 0;
  /** The interaction-turn counter observed when THIS shop opened (#633). Makes the
   *  alternation advance idempotent: the advance only fires while the counter is still
   *  at this value, so the owner's terminal + the watcher's terminal + a reconcile
   *  broadcast can't double-count this one interaction. -1 = solo / not captured. */
  private coopInteractionStart = -1;

  constructor(
    rerollCount = 0,
    modifierTiers?: ModifierTier[],
    customModifierSettings?: CustomModifierSettings,
    isCopy = false,
  ) {
    super();

    this.rerollCount = rerollCount;
    this.modifierTiers = modifierTiers;
    this.customModifierSettings = customModifierSettings;
    this.isCopy = isCopy;
  }

  start() {
    super.start();

    if (!this.isPlayer()) {
      return false;
    }

    // Co-op (#633): the reward screen ALTERNATES full control - the player whose turn
    // it is drives it; the partner WATCHES and mirrors the relayed picks against its
    // own identical pool (same seed -> identical options/prices/money). Resolved once
    // here; solo / non-coop keeps the original flow untouched.
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    // Capture the alternation counter this shop opened on, so its terminal advance is
    // idempotent (both clients advance locally now; this stops a double-count) (#633).
    if (coopController != null && this.coopInteractionStart < 0) {
      this.coopInteractionStart = coopController.interactionCounter();
    }

    // Dev test-suite "start in the store" scenarios stage guaranteed reward
    // options (e.g. a Rare Candy, or a Form-Change Item that resolves to a
    // single-mon party's mega stone). consumePendingDevShop() returns null in
    // production / clean checkout, so this is inert there. Consumed by the FIRST
    // reward screen after the scenario's opening battle. NEVER in co-op: it would
    // inject non-deterministic content onto one client and desync the shared pool.
    if (coopController == null) {
      const devShop = consumePendingDevShop();
      if (devShop && devShop.length > 0) {
        this.customModifierSettings = {
          ...(this.customModifierSettings ?? {}),
          guaranteedModifierTypeFuncs: [
            ...(this.customModifierSettings?.guaranteedModifierTypeFuncs ?? []),
            ...devShop,
          ],
          fillRemaining: true,
        };
      }
    }

    if (!this.rerollCount && !this.isCopy) {
      this.updateSeed();
    } else if (this.rerollCount) {
      globalScene.reroll = false;
    }

    const party = globalScene.getPlayerParty();
    if (!this.isCopy) {
      regenerateModifierPoolThresholds(party, this.getPoolType(), this.rerollCount);
    }
    const modifierCount = this.getModifierCount();

    this.typeOptions = this.getModifierTypeOptions(modifierCount);

    const modifierSelectCallback = (rowCursor: number, cursor: number) => {
      if (rowCursor < 0 || cursor < 0) {
        globalScene.ui.showText(i18next.t("battle:skipItemQuestion"), null, () => {
          globalScene.ui.setOverlayMode(
            UiMode.CONFIRM,
            () => {
              globalScene.ui.revertMode();
              globalScene.ui.setMode(UiMode.MESSAGE);
              // Co-op (#633): relay the skip to the watcher, then advance the turn.
              this.coopEndMirror();
              this.coopRelaySend(COOP_INTERACTION_LEAVE, undefined, "skip");
              super.end();
              this.coopAdvanceInteraction();
            },
            () => this.resetModifierSelect(modifierSelectCallback),
          );
        });
        return false;
      }

      switch (rowCursor) {
        // Execute one of the options from the bottom row
        case 0:
          switch (cursor) {
            case 0:
              return this.rerollModifiers();
            case 1:
              return this.openModifierTransferScreen(modifierSelectCallback);
            // Check the party, pass a callback to restore the modifier select screen.
            case 2:
              globalScene.ui.setModeWithoutClear(UiMode.PARTY, PartyUiMode.CHECK, -1, () => {
                this.resetModifierSelect(modifierSelectCallback);
              });
              return true;
            case 3:
              return this.toggleRerollLock();
            default:
              return false;
          }
        // Pick an option from the rewards
        case 1:
          return this.selectRewardModifierOption(cursor, modifierSelectCallback);
        // Pick an option from the shop
        default: {
          return this.selectShopModifierOption(rowCursor, cursor, modifierSelectCallback);
        }
      }
    };

    // Co-op (#633): only the player whose alternating turn it is drives the reward
    // screen; the partner watches and mirrors the relayed picks. Solo / non-coop falls
    // straight through to the normal interactive screen below.
    if (coopController != null) {
      // Dev / hotseat (SpoofGuest) path: the stand-in partner has no screen to drive an
      // interaction, so the local human (host) OWNS every reward screen. Only a REAL peer
      // alternates control. The counter still advances so persistence stays coherent.
      const spoofed = getCoopRuntime()?.spoof != null;
      // Co-op (#633): the OWNER is resolved from the counter PINNED when this shop opened
      // (coopInteractionStart), NOT the live counter - an inbound reconcile broadcast can
      // bump the live counter mid-interaction, which would flip the owner/seq calc and make
      // the watcher follow a seq the owner stopped sending on ("cursor at the wrong spots").
      if (spoofed || coopController.isLocalOwnerAtCounter(this.coopInteractionStart)) {
        console.log(
          `[coop-reward] OWNER drives reward screen (start=${this.coopInteractionStart} role=${coopController.role} spoof=${spoofed} wave=${globalScene.currentBattle?.waveIndex})`,
        );
        this.resetModifierSelect(modifierSelectCallback);
        // Co-op (#633): relay our cursor so the partner's screen mirrors it live.
        this.coopBeginMirror("owner");
      } else {
        console.log(
          `[coop-reward] WATCHER waits for partner's reward picks (start=${this.coopInteractionStart} role=${coopController.role} wave=${globalScene.currentBattle?.waveIndex})`,
        );
        void this.startCoopWatch();
      }
      return;
    }

    this.resetModifierSelect(modifierSelectCallback);
  }

  // Pick a modifier from among the rewards and apply it
  private selectRewardModifierOption(cursor: number, modifierSelectCallback: ModifierSelectCallback): boolean {
    if (this.typeOptions.length === 0) {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.MESSAGE);
      // Co-op (#633): no reward to pick is the same as leaving - relay + advance.
      this.coopEndMirror();
      this.coopRelaySend(COOP_INTERACTION_LEAVE, undefined, "skip");
      super.end();
      this.coopAdvanceInteraction();
      return true;
    }
    const modifierType = this.typeOptions[cursor].type;
    // Co-op (#633): capture the free-reward pick so it is relayed to the watcher once
    // any party target / sub-option is resolved (or immediately for a non-party item).
    this.coopBeginPending("reward", cursor, 1);
    return this.applyChosenModifier(modifierType, -1, modifierSelectCallback);
  }

  // Pick a modifier from the shop and apply it
  private selectShopModifierOption(
    rowCursor: number,
    cursor: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): boolean {
    const shopOptions = getPlayerShopModifierTypeOptionsForWave(
      globalScene.currentBattle.waveIndex,
      globalScene.getWaveMoneyAmount(1),
    );
    const shopOption =
      shopOptions[
        rowCursor > 2 || shopOptions.length <= SHOP_OPTIONS_ROW_LIMIT ? cursor : cursor + SHOP_OPTIONS_ROW_LIMIT
      ];
    const modifierType = shopOption.type;
    // Apply Black Sludge to healing item cost
    const healingItemCost = new NumberHolder(shopOption.cost);
    globalScene.applyModifier(HealShopCostModifier, true, healingItemCost);
    const cost = healingItemCost.value;

    if (globalScene.money < cost && !Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
      globalScene.ui.playError();
      return false;
    }

    // Co-op (#633): capture the shop purchase (row+cursor identify the option on the
    // watcher's identical stock) so it is relayed once any party target is resolved.
    this.coopBeginPending("shop", cursor, rowCursor);
    return this.applyChosenModifier(modifierType, cost, modifierSelectCallback);
  }

  /**
   * The UiMode the shop returns to after the party-target menu closes.
   * BiomeShopPhase (#440) overrides this to UiMode.BIOME_SHOP so the bespoke
   * grid re-appears after assigning a held item / TM, instead of the vanilla
   * reward screen.
   */
  protected getModifierSelectMode(): UiMode {
    return UiMode.MODIFIER_SELECT;
  }

  // Apply a chosen modifier: do an effect or open the party menu
  protected applyChosenModifier(
    modifierType: ModifierType,
    cost: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): boolean {
    if (modifierType instanceof PokemonModifierType) {
      if (modifierType instanceof FusePokemonModifierType) {
        this.openFusionMenu(modifierType, cost, modifierSelectCallback);
      } else {
        this.openModifierMenu(modifierType, cost, modifierSelectCallback);
      }
    } else {
      // Co-op (#633): a non-party item resolves immediately - relay the pick now (the
      // party-target items relay from their menu callbacks once the slot is chosen).
      this.coopFlushPending([]);
      this.applyModifier(modifierType.newModifier()!, cost);
    }
    return cost === -1;
  }

  // Reroll rewards
  private rerollModifiers() {
    const rerollCost = this.getRerollCost(globalScene.lockModifierTiers);
    if (rerollCost < 0 || globalScene.money < rerollCost) {
      globalScene.ui.playError();
      return false;
    }
    // Co-op (#633): relay the reroll so the watcher rerolls its identical pool too. Sent
    // before the new phase is unshifted; the watcher reaches this same method on replay
    // (where the send is a no-op, since the watcher is not the interaction owner).
    this.coopRelaySend(COOP_INTERACTION_REROLL, undefined, "reroll");
    globalScene.reroll = true;
    globalScene.phaseManager.unshiftNew(
      "SelectModifierPhase",
      this.rerollCount + 1,
      this.typeOptions.map(o => o.type?.tier).filter(t => t !== undefined) as ModifierTier[],
    );
    globalScene.ui.clearText();
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
    if (!Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
      globalScene.money -= rerollCost;
      globalScene.updateMoneyText();
      globalScene.animateMoneyChanged(false);
    }
    globalScene.playSound("se/buy");
    return true;
  }

  // Transfer modifiers among party pokemon
  private openModifierTransferScreen(modifierSelectCallback: ModifierSelectCallback) {
    globalScene.ui.setModeWithoutClear(
      UiMode.PARTY,
      PartyUiMode.MODIFIER_TRANSFER,
      -1,
      (fromSlotIndex: number, itemIndex: number, itemQuantity: number, toSlotIndex: number) => {
        if (
          toSlotIndex !== undefined
          && fromSlotIndex < 6
          && toSlotIndex < 6
          && fromSlotIndex !== toSlotIndex
          && itemIndex > -1
        ) {
          // Co-op (#633): relay the resolved transfer so the watcher mirrors it on its
          // identical party (same held items), then apply it locally.
          this.coopRelaySend(0, [COOP_ACT_TRANSFER, fromSlotIndex, itemIndex, itemQuantity, toSlotIndex], "transfer");
          this.applyTransfer(fromSlotIndex, itemIndex, itemQuantity, toSlotIndex);
        } else {
          this.resetModifierSelect(modifierSelectCallback);
        }
      },
      PartyUiHandler.FilterItemMaxStacks,
    );
    return true;
  }

  /**
   * Apply a held-item transfer (shared by the owner's transfer-menu callback and the
   * watcher's replay). Pure state mutation - no reward-screen UI - so it is safe to run
   * on the watcher (which has no MODIFIER_SELECT open). Co-op (#633).
   */
  private applyTransfer(fromSlotIndex: number, itemIndex: number, itemQuantity: number, toSlotIndex: number): void {
    const party = globalScene.getPlayerParty();
    if (fromSlotIndex >= 6 || toSlotIndex >= 6 || fromSlotIndex === toSlotIndex || itemIndex < 0) {
      return;
    }
    const itemModifiers = globalScene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && m.isTransferable && m.pokemonId === party[fromSlotIndex].id,
    ) as PokemonHeldItemModifier[];
    const itemModifier = itemModifiers[itemIndex];
    if (itemModifier == null) {
      return;
    }
    globalScene.tryTransferHeldItemModifier(
      itemModifier,
      party[toSlotIndex],
      true,
      itemQuantity,
      undefined,
      undefined,
      false,
    );
  }

  // Toggle reroll lock
  private toggleRerollLock() {
    const rerollCost = this.getRerollCost(globalScene.lockModifierTiers);
    if (rerollCost < 0) {
      // Reroll lock button is also disabled when reroll is disabled
      if (!this.coopWatcher) {
        globalScene.ui.playError();
      }
      return false;
    }
    globalScene.lockModifierTiers = !globalScene.lockModifierTiers;
    // Co-op (#633): relay the lock toggle (engine state the next pool generation reads).
    this.coopRelaySend(0, [COOP_ACT_LOCK], "lock");
    // The WATCHER has no MODIFIER_SELECT handler open - mutate the flag only, skip UI.
    if (!this.coopWatcher) {
      const uiHandler = globalScene.ui.getHandler() as ModifierSelectUiHandler;
      uiHandler.setRerollCost(this.getRerollCost(globalScene.lockModifierTiers));
      uiHandler.updateLockRaritiesText();
      uiHandler.updateRerollCostText();
    }
    return false;
  }

  /**
   * Apply the effects of the chosen modifier
   * @param modifier - The modifier to apply
   * @param cost - The cost of the modifier if it was purchased, or -1 if selected as the modifier reward
   * @param playSound - Whether the 'obtain modifier' sound should be played when adding the modifier.
   */
  protected applyModifier(modifier: Modifier, cost = -1, playSound = false): void {
    const result = globalScene.addModifier(modifier, false, playSound, undefined, undefined, cost);
    // Queue a copy of this phase when applying a TM, Memory Mushroom, or ER
    // Learner's Shroom. If the player selects one of these, then escapes out of
    // the move-learn without consuming it, they are returned to the shop in the
    // same state. The Learner's Shroom (#404) is modeled on remember-move
    // (LearnMoveType.MEMORY) and was missing here, so backing out of its
    // move-select consumed it without granting a move (#25). The successful-learn
    // cleanup (learn-move-phase MEMORY branch) removes this copy.
    const queuesContinuation =
      modifier.type instanceof RememberMoveModifierType
      || modifier.type instanceof TmModifierType
      || modifier.type instanceof ErLearnersShroomModifierType;
    if (queuesContinuation) {
      globalScene.phaseManager.unshiftPhase(this.copy());
    }

    if (cost !== -1 && !(modifier.type instanceof RememberMoveModifierType)) {
      if (result) {
        if (!Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
          globalScene.money -= cost;
          globalScene.updateMoneyText();
          globalScene.animateMoneyChanged(false);
        }
        globalScene.playSound("se/buy");
        // Co-op (#633): the WATCHER has no MODIFIER_SELECT handler open (it shows a
        // "partner is choosing" message) - the money is still deducted above to stay in
        // sync, but the reward-screen cost text must NOT be touched (it would crash on
        // the message handler). The OWNER and solo path repaint as before.
        if (!this.coopWatcher) {
          (globalScene.ui.getHandler() as ModifierSelectUiHandler).updateCostText();
        }
      } else {
        globalScene.ui.playError();
      }
    } else {
      // Co-op (#633): the reward screen is closing - stop mirroring the cursor (a queued
      // move-learn continuation re-opens it via the copy phase, which re-begins the mirror).
      this.coopEndMirror();
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.MESSAGE);
      super.end();
      // Co-op (#633): picking a free reward that does NOT queue a move-learn
      // continuation ends the whole interaction -> advance the alternation turn
      // (host-authoritative; a no-op off the host / outside co-op).
      if (!queuesContinuation) {
        this.coopAdvanceInteraction();
      }
    }
  }

  // Opens the party menu specifically for fusions
  protected openFusionMenu(
    modifierType: PokemonModifierType,
    cost: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): void {
    const party = globalScene.getPlayerParty();
    // Co-op (#633) WATCHER: apply the owner's relayed fusion pair (from + splice slot)
    // directly, never opening the party UI on a mon it does not drive.
    if (this.coopWatcher) {
      const modifier = modifierType.newModifier(party[this.coopRelayedSlot], party[this.coopRelayedOption]);
      if (modifier != null) {
        this.applyModifier(modifier, cost, true);
      }
      return;
    }
    globalScene.ui.setModeWithoutClear(
      UiMode.PARTY,
      PartyUiMode.SPLICE,
      -1,
      (fromSlotIndex: number, spliceSlotIndex: number) => {
        if (
          spliceSlotIndex !== undefined
          && fromSlotIndex < 6
          && spliceSlotIndex < 6
          && fromSlotIndex !== spliceSlotIndex
        ) {
          globalScene.ui.setMode(this.getModifierSelectMode(), this.isPlayer()).then(() => {
            // Co-op (#633): relay the resolved fusion pair so the watcher mirrors it.
            this.coopFlushPending([fromSlotIndex, spliceSlotIndex]);
            const modifier = modifierType.newModifier(party[fromSlotIndex], party[spliceSlotIndex])!; //TODO: is the bang correct?
            this.applyModifier(modifier, cost, true);
          });
        } else {
          this.resetModifierSelect(modifierSelectCallback);
        }
      },
      modifierType.selectFilter,
    );
  }

  // Opens the party menu to apply one of various modifiers
  protected openModifierMenu(
    modifierType: PokemonModifierType,
    cost: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): void {
    const pokemonModifierType = modifierType as PokemonModifierType;
    const isMoveModifier = modifierType instanceof PokemonMoveModifierType;
    const isAbilityModifier = modifierType instanceof PokemonAbilityModifierType;
    const isTmModifier = modifierType instanceof TmModifierType;
    // The Move Slot Expander also uses the relearn move-picker: the player
    // chooses which learnable move fills the new 5th slot.
    const isRememberMoveModifier =
      modifierType instanceof RememberMoveModifierType || modifierType instanceof PokemonAddMoveSlotModifierType;
    // ER Learner's Shroom (#404): same flow as remember-move, but the party UI
    // lists the species' EGG MOVES instead of learnable level moves.
    const isErLearnersShroom = modifierType instanceof ErLearnersShroomModifierType;
    const isPpRestoreModifier =
      modifierType instanceof PokemonPpRestoreModifierType || modifierType instanceof PokemonPpUpModifierType;
    const partyUiMode = isMoveModifier
      ? PartyUiMode.MOVE_MODIFIER
      : isAbilityModifier
        ? PartyUiMode.ABILITY_MODIFIER
        : isTmModifier
          ? PartyUiMode.TM_MODIFIER
          : isRememberMoveModifier
            ? PartyUiMode.REMEMBER_MOVE_MODIFIER
            : isErLearnersShroom
              ? PartyUiMode.ER_LEARNERS_SHROOM_MODIFIER
              : PartyUiMode.MODIFIER;
    const tmMoveId = isTmModifier ? (modifierType as TmModifierType).moveId : undefined;
    // Co-op (#633) WATCHER: apply the owner's relayed target slot + sub-option directly,
    // never opening the party UI on a mon it does not drive.
    if (this.coopWatcher) {
      const modifier = this.buildPokemonModifier(modifierType, this.coopRelayedSlot, this.coopRelayedOption);
      if (modifier != null) {
        this.applyModifier(modifier, cost, true);
      }
      return;
    }
    globalScene.ui.setModeWithoutClear(
      UiMode.PARTY,
      partyUiMode,
      -1,
      (slotIndex: number, option: PartyOption) => {
        if (slotIndex < 6) {
          globalScene.ui.setMode(this.getModifierSelectMode(), this.isPlayer()).then(() => {
            // Co-op (#633): relay the resolved target slot + sub-option to the watcher.
            this.coopFlushPending([slotIndex, option]);
            const modifier = this.buildPokemonModifier(modifierType, slotIndex, option);
            this.applyModifier(modifier!, cost, true); // TODO: is the bang correct?
          });
        } else {
          this.resetModifierSelect(modifierSelectCallback);
        }
      },
      pokemonModifierType.selectFilter,
      modifierType instanceof PokemonMoveModifierType
        ? (modifierType as PokemonMoveModifierType).moveSelectFilter
        : undefined,
      tmMoveId,
      isPpRestoreModifier,
    );
  }

  // Function that determines how many reward slots are available
  private getModifierCount(): number {
    const modifierCountHolder = new NumberHolder(3);
    globalScene.applyModifiers(ExtraModifierModifier, true, modifierCountHolder);
    globalScene.applyModifiers(TempExtraModifierModifier, true, modifierCountHolder);

    // ER relic (#439): Scrap Magnet - trainer battles have a 25% chance to drop one
    // extra reward option. The roll is cached per wave so rerolls/copies are stable.
    if (globalScene.currentBattle?.battleType === BattleType.TRAINER) {
      modifierCountHolder.value += erScrapMagnetExtraRewards();
    }

    // ER (#134): the EARNED extra reward slots (Golden Ball / Greater Golden Ball /
    // Scrap Magnet, i.e. the bump above the base 3) must SURVIVE a bundled/guaranteed
    // reward override - otherwise the Greater Golden Ball silently does nothing in every
    // customModifierSettings reward (mystery encounters, the Bargain, fixed battles, LLM
    // victory bundles). Capture them before the override and re-add after (paired with
    // the fill change in getPlayerModifierTypeOptions so the extra slots are generated).
    const earnedExtraRewards = Math.max(0, modifierCountHolder.value - 3);

    // If custom modifiers are specified, overrides default item count
    if (this.customModifierSettings) {
      const newItemCount =
        (this.customModifierSettings.guaranteedModifierTiers?.length ?? 0)
        + (this.customModifierSettings.guaranteedModifierTypeOptions?.length ?? 0)
        + (this.customModifierSettings.guaranteedModifierTypeFuncs?.length ?? 0);
      if (this.customModifierSettings.fillRemaining) {
        const originalCount = modifierCountHolder.value;
        modifierCountHolder.value = originalCount > newItemCount ? originalCount : newItemCount;
      } else {
        modifierCountHolder.value = newItemCount + earnedExtraRewards;
      }
    }

    return modifierCountHolder.value;
  }

  // Function that resets the reward selection screen,
  // e.g. after pressing cancel in the party ui or while learning a move
  protected resetModifierSelect(modifierSelectCallback: ModifierSelectCallback) {
    globalScene.ui.setMode(
      UiMode.MODIFIER_SELECT,
      this.isPlayer(),
      this.typeOptions,
      modifierSelectCallback,
      this.getRerollCost(globalScene.lockModifierTiers),
    );
  }

  updateSeed(): void {
    globalScene.resetSeed();
  }

  isPlayer(): boolean {
    return true;
  }

  getRerollCost(lockRarities: boolean): number {
    let baseValue = 0;
    if (Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
      return baseValue;
    }
    // Editor-tunable (vanilla.shop.rerollTierValues / rerollBase).
    if (lockRarities) {
      const tierValues = erBalanceArr("vanilla.shop.rerollTierValues");
      for (const opt of this.typeOptions) {
        baseValue += tierValues[opt.type.tier ?? 0] ?? tierValues.at(-1) ?? 0;
      }
    } else {
      baseValue = erBalanceNum("vanilla.shop.rerollBase");
    }

    let multiplier = 1;
    if (this.customModifierSettings?.rerollMultiplier != null) {
      if (this.customModifierSettings.rerollMultiplier < 0) {
        // Completely overrides reroll cost to -1 and early exits
        return -1;
      }

      // Otherwise, continue with custom multiplier
      multiplier = this.customModifierSettings.rerollMultiplier;
    }

    const baseMultiplier = Math.min(
      Math.ceil(globalScene.currentBattle.waveIndex / 10) * baseValue * 2 ** this.rerollCount * multiplier,
      Number.MAX_SAFE_INTEGER,
    );

    // Apply Black Sludge to reroll cost
    const modifiedRerollCost = new NumberHolder(baseMultiplier);
    globalScene.applyModifier(HealShopCostModifier, true, modifiedRerollCost);
    return modifiedRerollCost.value;
  }

  getPoolType(): ModifierPoolType {
    return ModifierPoolType.PLAYER;
  }

  getModifierTypeOptions(modifierCount: number): ModifierTypeOption[] {
    return getPlayerModifierTypeOptions(
      modifierCount,
      globalScene.getPlayerParty(),
      globalScene.lockModifierTiers ? this.modifierTiers : undefined,
      this.customModifierSettings,
    );
  }

  copy(): SelectModifierPhase {
    return globalScene.phaseManager.create(
      "SelectModifierPhase",
      this.rerollCount,
      this.modifierTiers,
      {
        guaranteedModifierTypeOptions: this.typeOptions,
        rerollMultiplier: this.customModifierSettings?.rerollMultiplier,
        allowLuckUpgrades: false,
      },
      true,
    );
  }

  addModifier(modifier: Modifier): boolean {
    return globalScene.addModifier(modifier, false, true);
  }

  // ==========================================================================
  // Co-op alternating reward shop (#633). The OWNER drives the normal UI and relays
  // each pick; the WATCHER runs startCoopWatch() (no interactive UI) and replays the
  // picks against its own identical pool. Same seed -> identical options/prices/money,
  // so only the CHOICE (index + resolved party target) crosses the wire. All gated by
  // isCoop + a live controller, so the solo path is byte-for-byte unaffected.
  // ==========================================================================

  /** Build the modifier for a resolved party-target pick (shared by the owner's menu
   *  callback and the watcher's direct replay) - mirrors the openModifierMenu dispatch. */
  private buildPokemonModifier(modifierType: PokemonModifierType, slotIndex: number, option: number): Modifier | null {
    const target = globalScene.getPlayerParty()[slotIndex];
    if (target == null) {
      return null;
    }
    if (modifierType instanceof PokemonMoveModifierType) {
      return modifierType.newModifier(target, option - PartyOption.MOVE_1);
    }
    if (modifierType instanceof PokemonAbilityModifierType) {
      return modifierType.newModifier(target, option - PartyOption.ABILITY_SLOT_0);
    }
    if (
      modifierType instanceof RememberMoveModifierType
      || modifierType instanceof PokemonAddMoveSlotModifierType
      || modifierType instanceof ErLearnersShroomModifierType
    ) {
      return modifierType.newModifier(target, option);
    }
    return modifierType.newModifier(target);
  }

  /** OWNER only: relay one reward-screen pick to the watcher on this interaction's seq.
   *  The seq + owner check are PINNED to the counter this shop opened on (#633): the live
   *  counter can be bumped mid-interaction by an inbound reconcile broadcast, which would
   *  send a later pick on a DIFFERENT seq than the watcher's captured await seq (the watcher
   *  then stops following the owner's picks - the live cursor/relay desync). */
  private coopRelaySend(choice: number, data: number[] | undefined, label: string): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    if (controller == null || !controller.isLocalOwnerAtCounter(this.coopInteractionStart)) {
      return;
    }
    getCoopInteractionRelay()?.sendInteractionChoice(this.coopInteractionStart, label, choice, data);
  }

  /** Advance the alternating-interaction turn once the reward screen is left for good.
   *  BOTH clients advance LOCALLY (deterministic, lockstep) - the old host-only broadcast
   *  raced the next interaction's synchronous start and froze the ME watcher. Idempotent
   *  via the counter this shop opened on, so the owner's terminal, the watcher's terminal,
   *  and the reconcile broadcast can't double-count. */
  private coopAdvanceInteraction(): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    // Co-op (#633): when this reward shop is the END-OF-MYSTERY-ENCOUNTER reward (an ME is still
    // active), the encounter OWNS the single alternation advance (fired by PostMysteryEncounterPhase),
    // so the embedded shop must NOT advance too - else the turn counter double-advances and the
    // owner/watcher calc desyncs. A normal wave shop has no active ME, so it advances as usual.
    if (globalScene.currentBattle.mysteryEncounter != null) {
      return;
    }
    const controller = getCoopController();
    if (controller == null) {
      return;
    }
    const from = this.coopInteractionStart >= 0 ? this.coopInteractionStart : undefined;
    console.log(
      `[coop-reward] advance interaction (role=${controller.role} from=${this.coopInteractionStart} counter=${controller.interactionCounter()})`,
    );
    controller.advanceInteraction(from);
  }

  /** OWNER: stash the current reward/shop selection so it is relayed once the party
   *  target (if any) resolves. No-op for the watcher (it applies the relayed target). */
  private coopBeginPending(kind: "reward" | "shop", cursor: number, row: number): void {
    const controller = globalScene.gameMode.isCoop ? getCoopController() : null;
    // Pinned-counter owner check (#633): same stability rule as coopRelaySend.
    if (controller?.isLocalOwnerAtCounter(this.coopInteractionStart)) {
      this.coopPendingKind = kind;
      this.coopPendingCursor = cursor;
      this.coopPendingRow = row;
    } else {
      this.coopPendingKind = null;
    }
  }

  /** OWNER: relay the stashed selection now that the resolved `extra` (party slot +
   *  sub-option, or empty for a non-party item) is known. */
  private coopFlushPending(extra: number[]): void {
    if (this.coopPendingKind == null) {
      return;
    }
    const data =
      this.coopPendingKind === "shop" ? [COOP_ACT_SHOP, this.coopPendingRow, ...extra] : [COOP_ACT_REWARD, ...extra];
    this.coopRelaySend(this.coopPendingCursor, data, this.coopPendingKind);
    this.coopPendingKind = null;
  }

  /**
   * Co-op (#633) live-cursor mirror seq for THIS reward screen. Combines the interaction
   * turn with the reroll count so each reroll round gets its own cursor stream (stale
   * cosmetic buttons from a prior round can never leak in). Owner and watcher compute it
   * identically from the counter PINNED when the shop opened (coopInteractionStart) + the
   * rerollCount on the re-created phase - NEVER the live counter, which an inbound reconcile
   * broadcast can bump mid-interaction (that drift desynced the owner/watcher seqs and is
   * exactly the "watcher's cursor at the wrong spots" regression).
   */
  private coopMirrorSeq(): number {
    if (getCoopController() == null || this.coopInteractionStart < 0) {
      return -1;
    }
    return this.coopInteractionStart * 64 + Math.min(this.rerollCount, 63);
  }

  /**
   * Co-op (#633): begin mirroring the top-level reward-screen cursor. The OWNER relays each
   * button; the WATCHER replays them onto its identical screen. Bound to MODIFIER_SELECT, so
   * it auto-goes-inert while a sub-menu (party target / fusion) is open and resumes on
   * return. Hard no-op outside a live co-op run.
   */
  private coopBeginMirror(role: "owner" | "watcher"): void {
    if (!globalScene.gameMode.isCoop || getCoopController() == null) {
      return;
    }
    getCoopUiMirror()?.beginSession(role, UiMode.MODIFIER_SELECT, this.coopMirrorSeq());
  }

  /** Co-op (#633): stop mirroring (interaction left / rerolled / timed out). No-op in solo. */
  private coopEndMirror(): void {
    if (globalScene.gameMode.isCoop) {
      getCoopUiMirror()?.endSession();
    }
  }

  /** WATCHER: open the SAME reward screen the owner drives (read-only, cursor-mirrored) and
   *  apply the owner's relayed picks against this client's identical pool until they leave. */
  private async startCoopWatch(): Promise<void> {
    this.coopWatcher = true;
    const controller = getCoopController();
    const relay = getCoopInteractionRelay();
    if (controller == null || relay == null) {
      // No live session: fail safe by leaving the screen so the run never hangs.
      await globalScene.ui.setMode(UiMode.MESSAGE);
      super.end();
      return;
    }
    // Open the SAME reward screen the owner drives (identical seeded options/prices/money),
    // with a NO-OP callback: the watcher's local input is blocked at the UI layer, replayed
    // owner buttons only move the cursor, and the AUTHORITATIVE outcome is the relayed action
    // loop below. The watcher's apply path never touches this handler (all `!coopWatcher`
    // guarded), so the open screen is purely a cosmetic, cursor-mirrored projection.
    await globalScene.ui.setMode(
      UiMode.MODIFIER_SELECT,
      this.isPlayer(),
      this.typeOptions,
      () => false,
      this.getRerollCost(globalScene.lockModifierTiers),
    );
    this.coopBeginMirror("watcher");
    // Await on the PINNED interaction counter (#633), matching the owner's pinned send seq.
    // Reading the live counter here would let an inbound reconcile broadcast (which can bump
    // it mid-interaction) move our await seq off the owner's send seq -> we'd stop receiving
    // the owner's picks and hang ("watcher stuck / cursor at the wrong spots").
    const seq = this.coopInteractionStart;
    for (;;) {
      const action = await relay.awaitInteractionChoice(seq, COOP_REWARD_WAIT_MS);
      if (action == null) {
        console.log("[coop-reward] WATCHER timed out waiting for partner -> leaving reward screen");
        this.coopEndMirror();
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
        this.coopAdvanceInteraction();
        return;
      }
      if (this.applyRelayedRewardAction(action)) {
        return;
      }
    }
  }

  /**
   * WATCHER: apply one relayed reward-screen action against the identical pool.
   * Returns true when this phase is finished (terminal pick / skip / reroll-handoff),
   * false to keep waiting for the next pick (shop buy / lock / transfer).
   */
  private applyRelayedRewardAction(action: CoopInteractionChoice): boolean {
    const noop: ModifierSelectCallback = () => false;
    if (action.choice === COOP_INTERACTION_LEAVE) {
      this.coopEndMirror();
      globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
      this.coopAdvanceInteraction();
      return true;
    }
    if (action.choice === COOP_INTERACTION_REROLL) {
      // rerollModifiers unshifts a fresh SelectModifierPhase (which re-enters watch on the
      // same interaction seq, but a NEW mirror seq since rerollCount bumps) and ends this
      // one - so end this round's cursor stream before the new screen opens.
      this.coopEndMirror();
      this.rerollModifiers();
      return true;
    }
    const data = action.data ?? [];
    const act = data[0];
    if (act === COOP_ACT_LOCK) {
      this.toggleRerollLock();
      return false;
    }
    if (act === COOP_ACT_TRANSFER) {
      this.applyTransfer(data[1], data[2], data[3], data[4]);
      return false;
    }
    if (act === COOP_ACT_REWARD) {
      this.coopRelayedSlot = data[1] ?? -1;
      this.coopRelayedOption = data[2] ?? 0;
      this.selectRewardModifierOption(action.choice, noop);
      return true;
    }
    if (act === COOP_ACT_SHOP) {
      this.coopRelayedSlot = data[2] ?? -1;
      this.coopRelayedOption = data[3] ?? 0;
      this.selectShopModifierOption(data[1], action.choice, noop);
      return false;
    }
    console.log(`[coop-reward] WATCHER ignoring unknown reward action choice=${action.choice} data=${data.join(",")}`);
    return false;
  }
}
