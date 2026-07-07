import { consumePendingDevShop } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import {
  COOP_INTERACTION_LEAVE,
  COOP_INTERACTION_REROLL,
  type CoopInteractionChoice,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { coopGiveMonToPartner } from "#data/elite-redux/coop/coop-party-ops";
import { getCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { reconstructRewardOptions, serializeRewardOptions } from "#data/elite-redux/coop/coop-reward-options";
import {
  coopMeInProgress,
  getCoopController,
  getCoopInteractionRelay,
  getCoopNetcodeMode,
  getCoopRendezvous,
  getCoopRuntime,
  getCoopUiMirror,
} from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_ACT_CHECK,
  COOP_CHECK_OP_FORM_ITEM,
  COOP_CHECK_OP_GIVE,
  COOP_CHECK_OP_RELEASE,
  COOP_CHECK_OP_RENAME,
  COOP_CHECK_OP_REORDER,
  COOP_CHECK_OP_UNPAUSE_EVO,
  COOP_CHECK_OP_UNSPLICE,
} from "#data/elite-redux/coop/coop-shop-check-relay";
import { erBalanceArr, erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import {
  erMerchantsSealExtraSlots,
  erMerchantsSealRerollMultiplier,
  erScrapMagnetExtraRewards,
} from "#data/elite-redux/er-relics";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { BattleType } from "#enums/battle-type";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import type { ModifierTier } from "#enums/modifier-tier";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { Modifier } from "#modifiers/modifier";
import {
  ExtraModifierModifier,
  HealShopCostModifier,
  PokemonFormChangeItemModifier,
  PokemonHeldItemModifier,
  TempExtraModifierModifier,
} from "#modifiers/modifier";
import type { CustomModifierSettings, ModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import {
  ErAbilityCapsuleModifierType,
  ErLearnersShroomModifierType,
  ErTmCaseModifierType,
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

/** Co-op (#698): trailing wire marker. The two ints after it are [COOP_MONEY_TAG, hostMoney],
 *  appended by the OWNER to a relayed spend action (reroll / shop buy / reward buy) so the
 *  WATCHER sets money host-authoritatively instead of recomputing its own (divergent) cost.
 *  0x4d4f ('MO'); only stripped when it sits at data[len-2], and every producer appends exactly
 *  the [TAG, money] pair, so it cannot collide with a legitimate trailing positional value. */
const COOP_MONEY_TAG = 0x4d4f;

/** Co-op (#633): decode a relayed CHECK-team op code to a greppable name for the watcher-apply
 *  diagnostic log in {@linkcode SelectModifierPhase.applyRelayedCheckOp}. Logging-only / pure. */
function coopCheckOpName(op: number): string {
  switch (op) {
    case COOP_CHECK_OP_REORDER:
      return "REORDER";
    case COOP_CHECK_OP_GIVE:
      return "GIVE";
    case COOP_CHECK_OP_RELEASE:
      return "RELEASE";
    case COOP_CHECK_OP_UNSPLICE:
      return "UNSPLICE";
    case COOP_CHECK_OP_RENAME:
      return "RENAME";
    case COOP_CHECK_OP_UNPAUSE_EVO:
      return "UNPAUSE_EVO";
    case COOP_CHECK_OP_FORM_ITEM:
      return "FORM_ITEM";
    default:
      return "UNKNOWN";
  }
}
// Co-op (#633 B9b): the "Check Team" party-mutation action code + op codes live in the engine-free
// coop-shop-check-relay module so the owner relay (here) and the per-mutation source hooks
// (PartyUiHandler) share them without a phase<->handler import cycle. Why they are load-bearing for
// the per-turn checksum (coop-battle-checksum.ts): `party` order/length + `speciesId`
// (REORDER/GIVE/RELEASE), `formIndex` (FORM_ITEM/UNSPLICE), `abilityId` (UNSPLICE), and the
// persistent `modifiers` multiset (RELEASE strips held items) are ALL hashed, so an unrelayed
// owner-only mutation flips the hash -> resync storm. The NON-hashed residuals (`coopOwner` from
// GIVE, `pauseEvolutions`, `nickname`) heal via the ME-terminal `applyCoopMeMonFields` path + the
// future B4 bench snapshot, but are relayed too so the common path never even diverges.
/** How long the WATCHER waits for the owner's next reward pick before leaving (never hangs).
 *  20min: "wait for the human" - a slow shopper must never trip the watcher's premature leave
 *  (which would land the watcher in the next wave while the owner is still shopping = desync). */
const COOP_REWARD_WAIT_MS = 1_200_000;

/**
 * Co-op (#633 / #828): inside an AUTHORITATIVE mystery encounter the embedded reward shop's two
 * authorities SPLIT (they coincide for every normal wave shop, so this is null outside an ME):
 *  - OPTION authority (roll the pool + STREAM it, vs adopt the streamed list): ALWAYS the HOST. The
 *    host is the SOLE ME engine; the guest diverted into CoopReplayMePhase never ran the encounter, so
 *    a guest-rolled pool would diverge (party luck + a diverged shared RNG cursor) from the rewards the
 *    host actually grants. So the HOST rolls + streams and the GUEST adopts the list, regardless of who
 *    OWNS the ME. THIS is the only thing the override controls.
 *  - PICK authority (drive the interactive pick + relay it, vs apply the relayed pick) is resolved
 *    SEPARATELY by the existing {@linkcode isLocalOwnerAtCounter} alternation on the shop's PINNED
 *    counter - which inside an ME EQUALS the ME's pinned counter, so it already resolves to the ME
 *    OWNER. So the pick needs NO override: the ME owner drives + relays, the other side applies.
 *
 * The #828 fix: the maintainer OWNED a guest-side ME but the relic/reward pick behaved as the host's,
 * because the OLD override forced BOTH authorities to the host. Splitting them keeps the correct (host)
 * option source AND hands the interactive pick to the ME owner, reusing the wave-shop owner/watcher
 * machinery: the option owner (host) streams; the pick owner (ME owner) drives + relays; the pick
 * watcher (the other side) applies. On a guest-owned ME the HOST is the option OWNER but the pick
 * WATCHER, and the GUEST is the option WATCHER (adopts) but the pick OWNER (drives) - the two axes
 * genuinely split, and the phase handles both combinations below.
 *
 * Returns the OPTION authority: `true` => THIS client rolls + streams the pool; `false` => THIS client
 * adopts the streamed list; `null` => no override (normal wave shop: the counter-parity owner rolls its
 * own pool, byte-identical to before). The spoof/hotseat path (local human owns everything) is null too.
 */
function coopMeRewardOptionOwnerOverride(): boolean | null {
  if (!globalScene.gameMode.isCoop || getCoopNetcodeMode() !== "authoritative") {
    return null;
  }
  if (!coopMeInProgress()) {
    return null;
  }
  if (getCoopRuntime()?.spoof != null) {
    return null; // hotseat: the local human owns everything (unchanged)
  }
  return getCoopController()?.role === "host";
}

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
  /**
   * Co-op (#828) OPTION axis (distinct from the pick axis {@linkcode coopWatcher}): true => this client
   * ADOPTS the owner's streamed reward-option list; false => it ROLLED its own + streams it. For a
   * normal wave shop the option axis == the pick axis; inside a guest-owned ME they SPLIT (the HOST
   * rolls+streams even though it WATCHES the pick, and the GUEST adopts even though it OWNS the pick).
   * Set in {@linkcode start}; read by {@linkcode startCoopWatch} to skip the adopt when this client is
   * the option owner (the host on a guest-owned ME keeps its own rolled+streamed list).
   */
  private coopAdoptsOptions = false;
  /** Owner-side: the selection captured at row/cursor time, relayed once the party target resolves. */
  private coopPendingKind: "reward" | "shop" | null = null;
  private coopPendingCursor = 0;
  private coopPendingRow = 0;
  /** Watcher-side: the owner's relayed party-target slot + sub-option for the pick being replayed. */
  private coopRelayedSlot = -1;
  private coopRelayedOption = 0;
  /** Watcher-side (#698): the host's authoritative money AFTER this relayed spend, streamed on the
   *  relay message. -1 = none streamed (older host / non-spend action) -> the watcher keeps its own
   *  deduction (current behavior, no regression). Reset to -1 after each apply so it cannot bleed. */
  private coopRelayedMoney = -1;
  /** Owner-side (#698): the post-spend money to stream with the next relay send, or -1 to append
   *  nothing. Transient: set just before the spend's relay send, consumed + reset inside it. */
  private coopOwnerPostMoney = -1;
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

    // Co-op (#633 / #828): the OPTION authority (roll+stream vs adopt). Inside an authoritative ME this
    // is forced to the HOST (the sole engine); outside an ME it is null and the counter-parity owner
    // rolls. The PICK authority (drive vs watch) is resolved SEPARATELY below from the pinned counter -
    // inside an ME that pinned counter IS the ME counter, so the pick naturally goes to the ME OWNER.
    // Hoisted so the pick-resolution branch below shares the same option decision.
    const optionOwnerOverride = coopMeRewardOptionOwnerOverride();

    // Co-op (#633 Fix #2 / #828): is THIS client the OPTION WATCHER of this reward interaction (it
    // ADOPTS the streamed list instead of rolling)? A local roll would (a) diverge from the owner's
    // pool (party luck changes the number of seeded upgrade draws getNewModifierTypeOption consumes)
    // and (b) shift the shared RNG cursor differently, so the option watcher adopts the owner's streamed
    // list (coopAdoptOwnerRewardOptions). For a normal wave shop this is the pick watcher; inside a
    // guest-owned ME it is the HOST (option owner) that ROLLS and the GUEST (option watcher) that adopts,
    // even though the GUEST OWNS the pick. The spoof/hotseat path has no real peer, so the local human
    // always rolls (never an option watcher).
    const coopIsWatcher =
      coopController != null
      && getCoopRuntime()?.spoof == null
      && (optionOwnerOverride == null
        ? !coopController.isLocalOwnerAtCounter(this.coopInteractionStart)
        : !optionOwnerOverride); // authoritative ME: forced option owner=host => the guest adopts
    // Remember the option axis for startCoopWatch (the host on a guest-owned ME watches the pick but is
    // the option OWNER, so it must NOT adopt - it keeps its own rolled+streamed list).
    this.coopAdoptsOptions = coopIsWatcher;

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

    // Co-op WATCHER (#633 Fix #2): do NOT roll the pool - that would consume luck-divergent
    // seeded draws and shift this client's RNG cursor away from the owner's. Start empty;
    // startCoopWatch() fills typeOptions from the owner's streamed list before the screen opens.
    this.typeOptions = coopIsWatcher ? [] : this.getModifierTypeOptions(modifierCount);

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
              // #record-replay (single-player): capture the reward-shop LEAVE (no-op unless recording / in co-op).
              recordSinglePlayerInteraction("skip", COOP_INTERACTION_LEAVE);
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
              return this.openCheckTeamScreen(modifierSelectCallback);
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
      // Co-op (#633): the PICK OWNER is resolved from the counter PINNED when this shop opened
      // (coopInteractionStart), NOT the live counter - an inbound reconcile broadcast can bump the
      // live counter mid-interaction, which would flip the owner/seq calc and make the watcher follow
      // a seq the owner stopped sending on ("cursor at the wrong spots"). #828: this is the natural
      // alternation with NO override - inside an ME the pinned counter IS the ME counter, so it already
      // resolves to the ME OWNER (the old override forcing host=owner is gone; only the OPTION axis is
      // forced to the host now, via coopIsWatcher above).
      const ownsThisShop = coopController.isLocalOwnerAtCounter(this.coopInteractionStart);
      const parity = ((this.coopInteractionStart % 2) + 2) % 2;
      coopLog(
        "reward",
        `owner/watcher decision: pinnedStart=${this.coopInteractionStart} liveCounter=${coopController.interactionCounter()} parity=${parity} role=${coopController.role} pick=${spoofed || ownsThisShop ? "OWNER" : "WATCHER"} option=${coopIsWatcher ? "ADOPT" : "ROLL"} spoof=${spoofed}`,
      );
      // Co-op (#633 Fix #2 / #828): the OPTION OWNER streams its rolled list so the option WATCHER
      // adopts it instead of re-rolling (party luck / a diverged ME engine would diverge the pool + the
      // shared RNG cursor). For a normal wave shop the option owner == the pick owner; inside a
      // guest-owned ME the HOST is the option owner but the pick WATCHER, so stream here - BEFORE the
      // pick branch - whenever we rolled (!coopIsWatcher), regardless of the pick role. Not sent in the
      // spoof/hotseat path (no real peer watcher).
      if (!coopIsWatcher && !spoofed) {
        this.coopSendRewardOptions();
      }
      // #839 shop-pick-commit barrier: BOTH clients ARRIVE at the shop the instant they reach it. The
      // owner is allowed to walk all the way TO the shop, but must not COMMIT a pick until the partner
      // has ALSO reached it (the reciprocal guard the reward-shop asymmetry lacked: the owner could
      // finish the fight + enter the NEXT fight while the partner was still finishing the previous one).
      this.coopShopArrive();
      if (spoofed || ownsThisShop) {
        coopLog(
          "reward",
          `OWNER drives reward screen (start=${this.coopInteractionStart} role=${coopController.role} spoof=${spoofed} adoptsOptions=${coopIsWatcher} wave=${globalScene.currentBattle?.waveIndex})`,
        );
        // The OWNER WAITS at the barrier until the partner reaches the shop, THEN opens the pickable
        // screen (a dead partner resolves the wait via the anti-hang timeout so the owner never hangs).
        void this.coopOpenOwnerShopAfterBarrier(modifierSelectCallback, coopIsWatcher, spoofed);
      } else {
        coopLog(
          "reward",
          `WATCHER waits for partner's reward picks (start=${this.coopInteractionStart} role=${coopController.role} wave=${globalScene.currentBattle?.waveIndex})`,
        );
        // #800 (live "it's not letting me pick anything"): the mirrored screen looks EXACTLY like
        // the watcher's own, so blocked input reads as a bug. Say whose turn it is, plainly.
        try {
          globalScene.ui.showText(
            `${coopController.partnerName ?? "Your partner"}'s turn: they are picking the rewards. Your picks come next screen.`,
            null,
            undefined,
            4000,
          );
        } catch {
          /* cosmetic */
        }
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
      // #record-replay (single-player): no reward to pick is a LEAVE (no-op unless recording / in co-op).
      recordSinglePlayerInteraction("skip", COOP_INTERACTION_LEAVE);
      super.end();
      this.coopAdvanceInteraction();
      return true;
    }
    const modifierType = this.typeOptions[cursor].type;
    // Co-op (#633): capture the free-reward pick so it is relayed to the watcher once
    // any party target / sub-option is resolved (or immediately for a non-party item).
    this.coopBeginPending("reward", cursor, 1);
    // #record-replay (single-player): capture the reward pick (the chosen option row). Recorded at the
    // decision point (behavior-preserving passive push); a hard no-op unless recording / in co-op. A
    // party-target reward's resolved slot is a DOCUMENTED replay-gap (the loader picks a non-party reward).
    recordSinglePlayerInteraction("reward", cursor);
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
    // #854: an out-of-range relayed shop cursor (a stale/superseded pick, or a pool divergence) must
    // NEVER crash the WATCHER on `shopOption.type` of undefined (the reward-branch sibling of the
    // out-of-range guard in applyRelayedRewardAction). On the watcher, ignore it + keep waiting for the
    // authoritative terminal; the owner path can't produce this from real UI, but degrade safely there too.
    if (shopOption == null) {
      if (this.coopWatcher) {
        coopWarn(
          "reward",
          `WATCHER ignoring OUT-OF-RANGE relayed shop cursor row=${rowCursor} cursor=${cursor} (stock=${shopOptions.length}) `
            + "- stale/divergent pick; keep waiting for the authoritative terminal (#854)",
        );
        return false;
      }
      globalScene.ui.playError();
      return false;
    }
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
      this.coopFlushPending([], cost);
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
    globalScene.reroll = true;
    globalScene.phaseManager.unshiftNew(
      "SelectModifierPhase",
      this.rerollCount + 1,
      this.typeOptions.map(o => o.type?.tier).filter(t => t !== undefined) as ModifierTier[],
    );
    globalScene.ui.clearText();
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
    if (!Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
      if (this.coopWatcher && this.coopAdoptsOptions && this.coopRelayedMoney >= 0) {
        // Co-op (#698): the OWNER is authoritative - SET the streamed post-reroll money instead of
        // recomputing/subtracting (avoids per-client cost divergence + double-deduct after a resync).
        // #828: only a TRUE watcher (it also ADOPTS the owner's options) adopts the relayed money; the
        // HOST as a guest-owned-ME reward pick WATCHER is the option OWNER + the authoritative engine, so
        // it deducts its OWN money (a mid-ME host money change the stale guest never saw is not lost).
        globalScene.money = this.coopRelayedMoney;
      } else {
        globalScene.money -= rerollCost;
      }
      globalScene.updateMoneyText();
      globalScene.animateMoneyChanged(false);
    }
    // Co-op (#633/#698): relay the reroll so the watcher rerolls its identical pool too. Sent
    // AFTER the deduction above so the streamed money is the POST-reroll authoritative value (the
    // watcher reaches this same method on replay, where the send is a no-op since it is not the
    // interaction owner). coopOwnerPostMoney is read + reset inside coopRelaySend.
    this.coopOwnerPostMoney = Overrides.WAIVE_ROLL_FEE_OVERRIDE ? -1 : Math.trunc(globalScene.money);
    this.coopRelaySend(COOP_INTERACTION_REROLL, undefined, "reroll");
    // #record-replay (single-player): capture the reroll (a fresh SelectModifierPhase follows with its
    // own reward/skip interaction). No-op unless recording / in co-op.
    recordSinglePlayerInteraction("reroll", COOP_INTERACTION_REROLL);
    globalScene.playSound("se/buy");
    return true;
  }

  /**
   * Open the shop's "Check Team" (PARTY/CHECK) sub-screen. Co-op (#633 B9b): the WATCHER must
   * NEVER open PARTY - the shop mirror session is bound to MODIFIER_SELECT, so opening PARTY
   * un-blocks the watcher's local input and would let it mutate the shared party off-script. It
   * stays on its watch loop and applies the owner's relayed CHECK ops (applyRelayedCheckOp)
   * instead. `coopWatcher` is true ONLY on the watcher (false in solo / host-owner / lockstep),
   * so this open is byte-identical to the previous inline `case 2:` everywhere but the watcher.
   */
  private openCheckTeamScreen(modifierSelectCallback: ModifierSelectCallback): boolean {
    if (this.coopWatcher) {
      // WATCHER short-circuit: never open PARTY/CHECK (would un-block local input + let the
      // watcher mutate the shared party off-script). It stays on its watch loop and applies the
      // owner's relayed CHECK ops instead. Only reached in co-op on the watcher.
      coopLog("party", `WATCHER openCheckTeam SHORT-CIRCUIT seq=${this.coopInteractionStart} (stays on watch loop)`);
      return true;
    }
    globalScene.ui.setModeWithoutClear(UiMode.PARTY, PartyUiMode.CHECK, -1, () => {
      this.resetModifierSelect(modifierSelectCallback);
    });
    return true;
  }

  /**
   * Co-op (#633 B9b): called by PartyUiHandler (via coopReportCheckToPhase) when an OWNER
   * "Check Team" party mutation resolves, to relay it on this shop's pinned interaction seq.
   * Hard no-op off the pinned owner / outside co-op (coopRelaySend gates on isLocalOwnerAtCounter).
   * `op` is a COOP_CHECK_OP_*; `data` is its payload (slots / codepoints / form index).
   */
  public coopReportCheckMutation(op: number, data: number[]): void {
    this.coopRelaySend(0, [COOP_ACT_CHECK, op, ...data], "check");
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
    // #record-replay (single-player): capture the reroll-lock toggle (engine state the next reward-pool
    // roll reads, so a faithful replay must reproduce it). No-op unless recording / in co-op.
    recordSinglePlayerInteraction("lock", 0, [COOP_ACT_LOCK]);
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
    //
    // The ER Ability Capsule joins this list: its apply() unshifts ErAbilityCapsulePhase
    // (the option-select + run-unlock innate sub-picker), which runs BEFORE this copy and
    // removes it (tryRemovePhase) only once a choice is committed - so backing out of the
    // capsule's choice / sub-picker re-offers the capsule, identical to #25.
    const queuesContinuation =
      modifier.type instanceof RememberMoveModifierType
      || modifier.type instanceof TmModifierType
      || modifier.type instanceof ErLearnersShroomModifierType
      || modifier.type instanceof ErTmCaseModifierType
      || modifier.type instanceof ErAbilityCapsuleModifierType;
    if (queuesContinuation) {
      globalScene.phaseManager.unshiftPhase(this.copy());
    }

    if (cost !== -1 && !(modifier.type instanceof RememberMoveModifierType)) {
      if (result) {
        if (!Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
          if (this.coopWatcher && this.coopAdoptsOptions && this.coopRelayedMoney >= 0) {
            // Co-op (#698): the OWNER is authoritative - SET the streamed post-buy money instead of
            // recomputing/subtracting (avoids per-client cost divergence + double-deduct after a resync).
            // #828: only a TRUE watcher (it also ADOPTS the owner's options) adopts the relayed money; the
            // HOST as a guest-owned-ME reward pick WATCHER is the option OWNER + the authoritative engine,
            // so it deducts its OWN money (a mid-ME host money change the stale guest never saw is not lost).
            globalScene.money = this.coopRelayedMoney;
          } else {
            globalScene.money -= cost;
          }
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
            this.coopFlushPending([fromSlotIndex, spliceSlotIndex], cost);
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
    // ER TM Case: same flow as remember-move, but the party UI lists the mon's
    // compatible-TM moves it can still learn.
    const isErTmCase = modifierType instanceof ErTmCaseModifierType;
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
              : isErTmCase
                ? PartyUiMode.ER_TM_CASE_MODIFIER
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
            this.coopFlushPending([slotIndex, option], cost);
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

    // ER relic (#439): Merchant's Seal - every reward screen offers one extra item
    // slot (mirrors Scrap Magnet, but on EVERY battle, not just trainers).
    modifierCountHolder.value += erMerchantsSealExtraSlots();

    // ER Construction Site (#439 §3): the busy work site grants one extra reward
    // slot on every battle here (mirrors Merchant's Seal, but biome-gated). Folded
    // into the "earned" bump below so it survives a guaranteed/bundled override.
    modifierCountHolder.value += getErBiomeRule(globalScene.arena.biomeId)?.extraRewardSlots ?? 0;

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
    // ER relic (#439): Merchant's Seal halves the reroll cost. Applied last so it
    // composes with the wave/rerollCount scaling and any Black-Sludge adjustment;
    // floored to a whole ₽. 1x (untouched) unless the relic is held.
    return Math.floor(modifiedRerollCost.value * erMerchantsSealRerollMultiplier());
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

  /**
   * Co-op (#633 B9c): the shop seq + watcher flag that the just-resolved ER ability-picker
   * pick belongs to, so the picker phase it unshifts routes its outcome through the SAME relay
   * seq this shop is pinned to. Read by the three picker modifiers' `apply()` (modifier.ts) off
   * the LIVE SelectModifierPhase at unshift time and threaded into the picker phase's constructor
   * - per-INSTANCE (never a process-global static), so two ability buys in one shop each carry
   * their own context. Solo / host-owner / lockstep: no controller => `seq=-1`, so the picker's
   * relayEnd() no-ops and the picker opens exactly as today (byte-identical).
   */
  public coopAbilityContext(): { seq: number; watcher: boolean } {
    const inCoop = globalScene.gameMode.isCoop && getCoopController() != null;
    const ctx = inCoop ? { seq: this.coopInteractionStart, watcher: this.coopWatcher } : { seq: -1, watcher: false };
    if (inCoop) {
      // Only log when actually in a live co-op shop (solo / lockstep => seq=-1, no log) so this
      // threads cleanly into the picker phase: the picker outcome relay is keyed by this seq.
      coopLog(
        "ability",
        `abilityContext threaded seq=${ctx.seq} role=${ctx.watcher ? "watcher" : "owner"} (picker routes outcome on this seq)`,
      );
    }
    return ctx;
  }

  copy(): SelectModifierPhase {
    const copied = globalScene.phaseManager.create(
      "SelectModifierPhase",
      this.rerollCount,
      this.modifierTiers,
      {
        // The continuation copy re-shows the SAME options the player is mid-selecting
        // (back-out safe, #25). `guaranteedModifierTypeOptions` ALREADY contains the
        // earned extra slots (Golden Ball / Scrap Magnet / Merchant's Seal / etc.), so
        // `fillRemaining: true` is REQUIRED: it sizes the screen to max(naturalCount,
        // theseOptions) = theseOptions. Without it, getModifierCount's #134 branch adds
        // `earnedExtraRewards` ON TOP of an option list that already includes them, so
        // every item-use -> back-out grew the slot count by G (the Golden Ball bonus)
        // without bound.
        guaranteedModifierTypeOptions: this.typeOptions,
        fillRemaining: true,
        rerollMultiplier: this.customModifierSettings?.rerollMultiplier,
        allowLuckUpgrades: false,
      },
      true,
    );
    // Co-op (#837): the continuation copy MUST inherit the SAME pinned interaction counter this shop
    // opened on. Without it the copy starts at -1 and, if its own terminal ever advances (a backed-out
    // continuation picker re-shows + leaves the copy), coopAdvanceInteraction fires an UNPINNED
    // (from=undefined) advance that unconditionally bumps + broadcasts the counter on the APPLIER only
    // (the live "advance interaction from=-1 counter 11 -> 12"), while the real from-pinned commit
    // no-ops - so the partner DEFERS the broadcast and lags N-behind, wedging the next battle. Pinned
    // here, the copy's terminal advance is from-pinned + idempotent (a duplicate no-ops on both sides).
    copied.coopInteractionStart = this.coopInteractionStart;
    return copied;
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
      || modifierType instanceof ErTmCaseModifierType
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
    // Past the co-op + pinned-owner fence: this client OWNS this shop interaction and is the
    // relay source. Log the exact send (seq + label + choice + payload) so the watcher's apply
    // can be matched against it in the captured log. Hot-ish (per reward action) - guard the
    // string build behind isCoopDebug().
    // Co-op (#698): for a money-moving pick the owner stashes its POST-spend authoritative money in
    // coopOwnerPostMoney just before this send; append it as a trailing [COOP_MONEY_TAG, money] pair
    // so the watcher sets money verbatim (the watcher strips it before its positional decode). The
    // tag rides the EXISTING message - no new packet / await. Consume + reset so it can't bleed.
    let wire = data;
    if (this.coopOwnerPostMoney >= 0) {
      wire = [...(data ?? []), COOP_MONEY_TAG, Math.trunc(this.coopOwnerPostMoney)];
    }
    this.coopOwnerPostMoney = -1;
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `OWNER send seq=${this.coopInteractionStart} kind=${label} choice=${choice} data=[${wire?.join(",") ?? ""}] role=${controller.role}`,
      );
    }
    getCoopInteractionRelay()?.sendInteractionChoice(this.coopInteractionStart, label, choice, wire);
  }

  /** OWNER (#633 Fix #2): stream the rolled reward-option list for THIS reroll round so the
   *  watcher rebuilds it instead of re-rolling (luck-divergent pool / RNG-cursor poisoning).
   *  Keyed by the pinned interaction counter + this reroll round (matches the watcher await). */
  private coopSendRewardOptions(): void {
    if (this.coopInteractionStart < 0) {
      return;
    }
    try {
      const serialized = serializeRewardOptions(this.typeOptions);
      coopLog(
        "reward",
        `OWNER streams reward options (start=${this.coopInteractionStart} reroll=${this.rerollCount} count=${serialized.length} ids=[${serialized.map(o => o.id).join(",")}])`,
      );
      getCoopInteractionRelay()?.sendRewardOptions(this.coopInteractionStart, this.rerollCount, serialized);
    } catch {
      /* a serialize/send failure must never break the owner's reward screen */
    }
  }

  /** WATCHER (#633 Fix #2): replace our locally-rolled options with the owner's streamed list
   *  for THIS reroll round. On timeout / unknown id, keep our own list (never hangs). */
  private async coopAdoptOwnerRewardOptions(): Promise<void> {
    if (this.coopInteractionStart < 0) {
      return;
    }
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      return;
    }
    try {
      coopLog(
        "reward",
        `WATCHER awaiting owner reward options (start=${this.coopInteractionStart} reroll=${this.rerollCount} localCount=${this.typeOptions.length})`,
      );
      const serialized = await relay.awaitRewardOptions(
        this.coopInteractionStart,
        this.rerollCount,
        COOP_REWARD_WAIT_MS,
      );
      if (serialized == null) {
        coopLog(
          "reward",
          `WATCHER got no owner options (timeout/null) -> keeping local roll (count=${this.typeOptions.length})`,
        );
        return;
      }
      const rebuilt = reconstructRewardOptions(serialized, globalScene.getPlayerParty());
      if (rebuilt == null) {
        coopLog("reward", "WATCHER could not reconstruct owner's options -> keeping local roll");
      } else {
        coopLog(
          "reward",
          `WATCHER ADOPTED owner reward options (was=${this.typeOptions.length} now=${rebuilt.length} ids=[${serialized.map(o => o.id).join(",")}])`,
        );
        this.typeOptions = rebuilt;
      }
    } catch {
      /* an await/reconstruct failure leaves our own list in place; never hang */
    }
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
    // Co-op (#633): when this reward shop is the END-OF-MYSTERY-ENCOUNTER reward, the encounter OWNS
    // the single alternation advance (fired by PostMysteryEncounterPhase). The embedded shop must NOT
    // advance too - else the counter double-advances and the owner/watcher calc desyncs into a
    // DUPLICATE reward screen. Keyed to the STABLE ME pin (coopMeInProgress), not
    // `currentBattle.mysteryEncounter`: under the authoritative divert the ME phases can settle out of
    // order and transiently null that field, which let the shop slip past the old guard. The pin is set
    // at ME entry and cleared only at the true ME terminal, so it can never be missed. A normal wave
    // shop has no active ME, so it advances as usual (solo/lockstep byte-identical).
    if (coopMeInProgress()) {
      return;
    }
    const controller = getCoopController();
    if (controller == null) {
      return;
    }
    // Co-op (#837): NEVER fire an UNPINNED advance in a live co-op run. Every real co-op interaction
    // pins coopInteractionStart in start() (and a continuation copy now inherits it, above), so a -1
    // here is a SPURIOUS terminal on a phase that never opened as an interaction owner/watcher. An
    // unpinned advanceInteraction(undefined) is non-idempotent: it unconditionally bumps + broadcasts
    // the counter on THIS client only (the partner DEFERS the broadcast and lags N-behind), wedging the
    // next battle ("after browsing the market i suddenly cannot choose a move"). Skip it LOUDLY - a
    // from-pinned advance on the legitimate terminal keeps both clients lockstep.
    if (this.coopInteractionStart < 0) {
      coopWarn(
        "reward",
        `advance interaction SKIP unpinned (role=${controller.role} coopInteractionStart=-1 counter=${controller.interactionCounter()}) `
          + "- refusing an asymmetric UNPINNED advance (#837); a from-pinned terminal advances both clients",
      );
      return;
    }
    const from = this.coopInteractionStart;
    const before = controller.interactionCounter();
    controller.advanceInteraction(from);
    coopLog(
      "reward",
      `advance interaction (role=${controller.role} from=${this.coopInteractionStart} counter ${before} -> ${controller.interactionCounter()})`,
    );
    // #788 v2 (ENABLED): whoever finishes this menu first WAITS ON SCREEN for the partner's
    // advance broadcast - the full lockstep gate ("i can still move past the shop without my
    // partner"). Re-enabled after the #789-class fixes made BOTH sides advance the counter on
    // EVERY interaction terminal (shop leave/pick, capsule, TM/shroom, market), so the gate's
    // awaited broadcast now always arrives promptly - the original harness failures predated
    // that symmetry. The v1 barrier (EncounterPhase defers the party sync) stays as backstop.
    globalScene.phaseManager.unshiftNew("CoopPartnerSyncPhase");
  }

  /**
   * Co-op (#839): the shop-pick-commit rendezvous point for THIS interaction, or null when there is no
   * pinned counter / wave. Both clients compute it identically from the wave + the PINNED interaction
   * counter (never the live counter), so a mid-interaction reconcile can't move it.
   */
  private coopShopPoint(): string | null {
    const wave = globalScene.currentBattle?.waveIndex ?? -1;
    if (this.coopInteractionStart < 0 || wave < 0) {
      return null;
    }
    return `shop:${wave}:${this.coopInteractionStart}`;
  }

  /**
   * Co-op (#839): signal (idempotently) that THIS client has REACHED the shop. Sent by BOTH the owner
   * and the watcher on entry, so the owner's barrier unblocks the moment the partner arrives. Hard
   * no-op outside a live co-op run / in the hotseat-spoof path (no real partner to rendezvous with).
   */
  private coopShopArrive(): void {
    if (!globalScene.gameMode.isCoop || getCoopRuntime()?.spoof != null) {
      return;
    }
    const point = this.coopShopPoint();
    const rendezvous = getCoopRendezvous();
    if (point != null && rendezvous != null) {
      rendezvous.arrive(point);
    }
  }

  /**
   * Co-op (#839): the OWNER waits at the shop-pick-commit barrier until the partner has ALSO reached the
   * shop, THEN opens the pickable screen. A dead/stuck partner resolves the wait via the anti-hang
   * timeout (LOUD WARN) so the owner never hangs. Never throws - a barrier failure still opens the screen.
   */
  private async coopOpenOwnerShopAfterBarrier(
    modifierSelectCallback: ModifierSelectCallback,
    coopIsWatcher: boolean,
    spoofed: boolean,
  ): Promise<void> {
    await this.coopAwaitShopBarrier(spoofed);
    if (coopIsWatcher) {
      // #828 guest pick-owner on a guest-owned ME: it does NOT roll (the HOST is the sole ME engine +
      // streamed the pool), so ADOPT the host's streamed options first, THEN open the owner screen.
      await this.startCoopOwnerAdoptOptions(modifierSelectCallback);
      return;
    }
    this.resetModifierSelect(modifierSelectCallback);
    // Co-op (#633): relay our cursor so the partner's screen mirrors it live.
    this.coopBeginMirror("owner");
  }

  /** Co-op (#839): block until the partner reaches the shop (or the anti-hang timeout fires). */
  private async coopAwaitShopBarrier(spoofed: boolean): Promise<void> {
    try {
      if (spoofed) {
        return; // hotseat: no real partner to wait for
      }
      const rendezvous = getCoopRendezvous();
      const point = this.coopShopPoint();
      if (rendezvous == null || point == null) {
        return;
      }
      coopLog("rendezvous", `shop-pick-commit barrier AWAIT ${point}`);
      const result = await rendezvous.awaitPartner(point, getCoopRendezvousWaitMs());
      if (result.timedOut) {
        coopWarn(
          "rendezvous",
          `shop-pick-commit barrier ${point} TIMED OUT - partner never reached the shop; opening pick screen anyway (anti-hang)`,
        );
      } else if (result.crossPoint !== undefined) {
        // #847 CROSS-POINT: the partner is parked at another sync point (e.g. a phantom next command) and
        // will never reach this shop barrier. Open the pick screen now - the catch-up machinery reconciles.
        // INFO, not the anti-hang WARN (no dead partner, no 60s wait).
        coopLog(
          "rendezvous",
          `shop-pick-commit barrier ${point} CROSS-POINT release (partner at ${result.crossPoint}); opening pick screen`,
        );
      }
    } catch (e) {
      coopWarn("rendezvous", "shop-pick-commit barrier threw (handled, opening screen)", e);
    }
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
   *  sub-option, or empty for a non-party item) is known. `cost` (#698) is the shop price the
   *  owner is ABOUT to deduct (-1 = free reward, no spend); the post-spend money is streamed so
   *  the watcher sets it verbatim. The flush runs BEFORE the applyModifier deduction, so the
   *  post value is computed inline (money - cost) here rather than read live. */
  private coopFlushPending(extra: number[], cost = -1): void {
    if (this.coopPendingKind == null) {
      return;
    }
    const data =
      this.coopPendingKind === "shop" ? [COOP_ACT_SHOP, this.coopPendingRow, ...extra] : [COOP_ACT_REWARD, ...extra];
    // Stream post-spend money only for an actual paid pick (cost > 0). Free rewards (cost -1/0)
    // and WAIVE_ROLL_FEE_OVERRIDE deduct nothing, so leave coopOwnerPostMoney at -1 -> no tag ->
    // the watcher keeps its own (also-nothing) deduction.
    this.coopOwnerPostMoney =
      cost > 0 && !Overrides.WAIVE_ROLL_FEE_OVERRIDE ? Math.trunc(globalScene.money - cost) : -1;
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
    // Past the co-op fence: log which cursor-mirror role this client took + the mirror seq, so the
    // owner's relay stream and the watcher's replay can be paired in the captured log.
    coopLog(
      "interaction",
      `mirror begin role=${role} mirrorSeq=${this.coopMirrorSeq()} interactionStart=${this.coopInteractionStart} reroll=${this.rerollCount}`,
    );
    getCoopUiMirror()?.beginSession(role, UiMode.MODIFIER_SELECT, this.coopMirrorSeq());
  }

  /** Co-op (#633): stop mirroring (interaction left / rerolled / timed out). No-op in solo. */
  private coopEndMirror(): void {
    if (globalScene.gameMode.isCoop) {
      getCoopUiMirror()?.endSession();
    }
  }

  /**
   * Co-op (#828) GUEST pick-owner on a guest-owned ME: the HOST is the sole ME engine, so it rolled +
   * streamed the reward pool. ADOPT that exact list (never re-roll - the guest never ran the ME engine,
   * so its pool + the shared RNG cursor would diverge), THEN open the interactive owner screen + relay
   * the pick exactly like a normal owner (this.coopWatcher stays false - it DRIVES). Only reached when
   * this client OWNS the ME reward PICK but ADOPTS the options (the split axes); the normal owner rolls
   * + drives synchronously in start() and never lands here.
   */
  private async startCoopOwnerAdoptOptions(modifierSelectCallback: ModifierSelectCallback): Promise<void> {
    await this.coopAdoptOwnerRewardOptions();
    this.resetModifierSelect(modifierSelectCallback);
    // Co-op (#633): relay our cursor so the partner (the pick watcher) mirrors it live.
    this.coopBeginMirror("owner");
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
    // Co-op (#633 Fix #2 / #828): adopt the owner's EXACT rolled option list instead of the one we
    // rolled in start() - party luck changes the number of seeded upgrade draws, so our local pool (and
    // the shared RNG cursor) could diverge from the owner's. We wait briefly for the owner's streamed
    // list; on timeout / unknown id we keep our own (divergent but no hang). SKIPPED when we are the
    // option OWNER (the HOST on a guest-owned ME, #828): it ROLLED + STREAMED its own authoritative list
    // and only WATCHES the guest's pick, so it keeps that list rather than adopting (there is no other
    // streamer - it IS the streamer).
    if (this.coopAdoptsOptions) {
      await this.coopAdoptOwnerRewardOptions();
    }
    // Open the SAME reward screen the owner drives (identical options/prices/money - now
    // guaranteed identical by the adopted list), with a NO-OP callback: the watcher's local
    // input is blocked at the UI layer, replayed owner buttons only move the cursor, and the
    // AUTHORITATIVE outcome is the relayed action loop below. The watcher's apply path never
    // touches this handler (all `!coopWatcher` guarded), so the open screen is purely a
    // cosmetic, cursor-mirrored projection.
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
        coopLog("reward", "WATCHER timed out waiting for partner -> leaving reward screen");
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
    // Co-op (#698): peel the trailing [COOP_MONEY_TAG, hostMoney] pair (if the owner appended it)
    // off the data BEFORE the positional decode below, so the existing slot/opt indices are read
    // exactly as today. An older host that does not append it leaves coopRelayedMoney at -1, so the
    // watcher falls back to its own deduction (current behavior, no regression). Consumed by
    // rerollModifiers / applyModifier set-verbatim; reset to -1 at every return so it can't bleed.
    let relayedMoney = -1;
    let data = action.data ?? [];
    if (data.length >= 2 && data.at(-2) === COOP_MONEY_TAG) {
      relayedMoney = data.at(-1) ?? -1;
      data = data.slice(0, -2);
    }
    this.coopRelayedMoney = relayedMoney;
    const actCode = data.length > 0 ? data[0] : undefined;
    const actName =
      actCode === COOP_ACT_REWARD
        ? "REWARD"
        : actCode === COOP_ACT_SHOP
          ? "SHOP"
          : actCode === COOP_ACT_TRANSFER
            ? "TRANSFER"
            : actCode === COOP_ACT_LOCK
              ? "LOCK"
              : actCode === COOP_ACT_CHECK
                ? "CHECK"
                : action.choice === COOP_INTERACTION_LEAVE
                  ? "LEAVE"
                  : action.choice === COOP_INTERACTION_REROLL
                    ? "REROLL"
                    : "?";
    coopLog(
      "reward",
      `WATCHER applying relayed action seq=${this.coopInteractionStart} act=${actName} choice=${action.choice} data=${action.data === undefined ? "-" : `[${action.data.join(",")}]`}`,
    );
    if (action.choice === COOP_INTERACTION_LEAVE) {
      this.coopRelayedMoney = -1;
      this.coopEndMirror();
      globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
      this.coopAdvanceInteraction();
      return true;
    }
    if (action.choice === COOP_INTERACTION_REROLL) {
      // rerollModifiers unshifts a fresh SelectModifierPhase (which re-enters watch on the
      // same interaction seq, but a NEW mirror seq since rerollCount bumps) and ends this
      // one - so end this round's cursor stream before the new screen opens. rerollModifiers
      // reads coopRelayedMoney (set above) to set money host-authoritatively (#698).
      this.coopEndMirror();
      this.rerollModifiers();
      this.coopRelayedMoney = -1;
      return true;
    }
    const act = data[0];
    if (act === COOP_ACT_LOCK) {
      this.coopRelayedMoney = -1;
      this.toggleRerollLock();
      return false;
    }
    if (act === COOP_ACT_TRANSFER) {
      this.coopRelayedMoney = -1;
      this.applyTransfer(data[1], data[2], data[3], data[4]);
      return false;
    }
    if (act === COOP_ACT_REWARD) {
      // #854: a relayed reward cursor OUT OF RANGE of this client's adopted option pool is a wire
      // anomaly - a stale/superseded pick left buffered on the reward seq (the live 'stuck after a
      // mystery event' capture: a phantom `choice=4 data=[0]` sat in the reward inbox when the post-ME
      // shop watch armed, while the ADOPTED pool held only 2 options), or a genuine pool divergence.
      // Applying it read `typeOptions[cursor].type` of undefined and CRASHED the watcher
      // (unhandledrejection) - killing the reward-shop phase FOREVER: the guest stranded a wave behind
      // AND the reward-cursor uiMirror never closed (it overlaid the continuing game). Ignore it LOUDLY
      // and keep waiting for the authoritative terminal (the owner's LEAVE, or the ME 9M terminal), which
      // the cosmetic mirror is subordinate to - mirroring the uiMirror drain's #852 "never kill the
      // watcher" defense-in-depth.
      if (action.choice < 0 || action.choice >= this.typeOptions.length) {
        this.coopRelayedMoney = -1;
        coopWarn(
          "reward",
          `WATCHER ignoring OUT-OF-RANGE relayed reward cursor=${action.choice} (pool=${this.typeOptions.length}) `
            + "- stale/divergent pick; keep waiting for the authoritative terminal (#854)",
        );
        return false;
      }
      this.coopRelayedSlot = data[1] ?? -1;
      this.coopRelayedOption = data[2] ?? 0;
      // coopRelayedMoney (set above) drives applyModifier's set-verbatim for a PAID reward (#698);
      // -1 (free reward / older host) falls back to the unchanged deduction.
      this.selectRewardModifierOption(action.choice, noop);
      this.coopRelayedMoney = -1;
      return true;
    }
    if (act === COOP_ACT_SHOP) {
      this.coopRelayedSlot = data[2] ?? -1;
      this.coopRelayedOption = data[3] ?? 0;
      // coopRelayedMoney (set above) drives applyModifier's set-verbatim for the buy (#698).
      this.selectShopModifierOption(data[1], action.choice, noop);
      this.coopRelayedMoney = -1;
      return false;
    }
    if (act === COOP_ACT_CHECK) {
      // CHECK ops are NON-terminal: the owner is still in the shop. Apply against our identical
      // party and keep watching for the next relayed pick / op / leave.
      this.coopRelayedMoney = -1;
      this.applyRelayedCheckOp(data[1], data.slice(2));
      return false;
    }
    this.coopRelayedMoney = -1;
    coopWarn("reward", `WATCHER ignoring unknown reward action choice=${action.choice} data=${data.join(",")}`);
    return false;
  }

  /**
   * WATCHER (#633 B9b): reproduce one OWNER "Check Team" party mutation against this client's
   * identical party. Each op resolves its target by SLOT INDEX against the pre-op party - which
   * is guaranteed identical on both sides because every CHECK op is relayed and applied in the
   * same FIFO order on this seq, so neither side mutates ahead of the other. The effect mirrors
   * the owner's exact code path (the same wrappers / the same form-change trigger), so the hashed
   * fields converge.
   */
  /**
   * Co-op (#633 B9b) WATCHER: the SAME ordered + filtered form-change-item modifier list the OWNER's
   * PartyUiHandler.getFormChangeItemsModifiers(pokemon) produced, so the relayed index resolves to
   * the SAME modifier. Replicated here (not called on the handler) because the watcher has no
   * PartyUiHandler open. The base order is acquisition order (findModifiers = a stable .filter over
   * globalScene.modifiers, kept identical across clients by FIFO-relayed acquisitions); the
   * Necrozma / active-form filter branches mirror the handler verbatim. Keep in lockstep with
   * PartyUiHandler.getFormChangeItemsModifiers.
   */
  private coopFormChangeItemsModifiers(mon: PlayerPokemon): PokemonFormChangeItemModifier[] {
    let mods = globalScene.findModifiers(
      m => m instanceof PokemonFormChangeItemModifier && m.pokemonId === mon.id,
    ) as PokemonFormChangeItemModifier[];
    const ultraNecrozmaModifiers = mods.filter(m => m.active && m.formChangeItem === FormChangeItem.ULTRANECROZIUM_Z);
    if (ultraNecrozmaModifiers.length > 0) {
      return ultraNecrozmaModifiers;
    }
    if (mods.find(m => m.active)) {
      mods = mods.filter(m => m.active || m.formChangeItem === FormChangeItem.ULTRANECROZIUM_Z);
    } else if (mon.species.speciesId === SpeciesId.NECROZMA) {
      mods = mods.filter(m => m.formChangeItem !== FormChangeItem.ULTRANECROZIUM_Z);
    }
    return mods;
  }

  private applyRelayedCheckOp(op: number, rest: number[]): void {
    const party = globalScene.getPlayerParty();
    // WATCHER applies one relayed owner CHECK-team mutation against its identical party. Log the
    // decoded op + payload + the pre-op party length so a divergence in this stream is visible.
    // Only the watcher reaches this (the owner mutates via its own PartyUiHandler), so unguarded.
    coopLog(
      "party",
      `WATCHER applyCheckOp op=${coopCheckOpName(op)}(${op}) rest=[${rest.join(",")}] partyLen=${party.length}`,
    );
    switch (op) {
      case COOP_CHECK_OP_REORDER: {
        const [src, dst] = rest;
        if (src < party.length && dst < party.length) {
          [party[src], party[dst]] = [party[dst], party[src]];
        }
        return;
      }
      case COOP_CHECK_OP_GIVE: {
        // Mirrors the owner's PartyUiHandler GIVE_TO_PARTNER: flip coopOwner + re-interleave the
        // party so the field leads stay host/guest (coopGiveMonToPartner). Slot resolved pre-op.
        const mon = party[rest[0]];
        if (mon != null) {
          coopGiveMonToPartner(mon);
        }
        return;
      }
      case COOP_CHECK_OP_RELEASE: {
        // Reproduce the owner's doRelease effect EXACTLY: strip the released mon's held-item
        // modifiers AND splice it out, so the hashed `modifiers` multiset + `party` both converge.
        // (Using a look-alike removal API that skips removePartyMemberModifiers would leave the
        // released mon's items in our modifier set -> a checksum mismatch -> a resync.)
        const slot = rest[0];
        if (party[slot] != null) {
          void globalScene.removePartyMemberModifiers(slot);
          const removed = party.splice(slot, 1)[0];
          removed.destroy();
        }
        return;
      }
      case COOP_CHECK_OP_UNSPLICE: {
        const mon = party[rest[0]];
        if (mon?.isFusion()) {
          // Async on BOTH sides (the owner's unfuse() is also .then-chained); a brief one-side
          // window self-heals via the per-turn checksum. Do NOT try to make it synchronous.
          void mon.unfuse();
        }
        return;
      }
      case COOP_CHECK_OP_RENAME: {
        const mon = party[rest[0]];
        if (mon != null) {
          mon.nickname = String.fromCodePoint(...rest.slice(1));
          void mon.updateInfo();
        }
        return;
      }
      case COOP_CHECK_OP_UNPAUSE_EVO: {
        const mon = party[rest[0]];
        if (mon != null) {
          mon.pauseEvolutions = !mon.pauseEvolutions;
        }
        return;
      }
      case COOP_CHECK_OP_FORM_ITEM: {
        // Mirror the owner's PartyUiHandler form-change-item toggle. The owner resolved the
        // modifier as getFormChangeItemsModifiers(mon)[formItemIndex]; that ordering is the
        // acquisition order of globalScene.modifiers (findModifiers is a stable .filter), which is
        // identical across clients because every persistent-modifier acquisition is relayed and
        // applied in the same FIFO order (PersistentModifier.add is a deterministic append). So
        // the SAME predicate + index resolves the SAME modifier here. We query the form-change-item
        // modifiers directly (the watcher has no PartyUiHandler open), toggle .active, and fire the
        // identical SpeciesFormChangeItemTrigger so formIndex converges.
        const mon = party[rest[0]] as PlayerPokemon | undefined;
        if (mon != null) {
          const formMods = this.coopFormChangeItemsModifiers(mon);
          const modifier = formMods[rest[1]];
          if (modifier != null) {
            modifier.active = !modifier.active;
            globalScene.triggerPokemonFormChange(mon, SpeciesFormChangeItemTrigger, false, true);
          }
        }
        return;
      }
    }
  }
}
