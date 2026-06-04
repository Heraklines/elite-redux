import { MAX_EGG_COUNT } from "#data/egg";
import { GachaType } from "#enums/gacha-types";
import { VoucherType } from "#system/voucher";

/**
 * Player-configurable settings that control how the egg queue is automatically
 * refilled after each hatch wave. Persisted on {@link GameData}.
 */
export interface AutoEggRestockSettings {
  enabled: boolean;
  targetCount: number;
  gachaType: GachaType;
  perVoucher: Record<VoucherType, boolean>;
}

/** Conservative, opt-in defaults. Auto-restock is disabled until the player turns it on. */
export function defaultAutoEggRestockSettings(): AutoEggRestockSettings {
  return {
    enabled: false,
    targetCount: 50,
    gachaType: GachaType.LEGENDARY,
    perVoucher: {
      [VoucherType.REGULAR]: true,
      [VoucherType.PLUS]: true,
      [VoucherType.PREMIUM]: true,
      [VoucherType.GOLDEN]: false,
    },
  };
}

/**
 * Merge a (possibly partial / older-save) settings blob with the current defaults,
 * clamping {@link AutoEggRestockSettings.targetCount} to a safe range.
 */
export function mergeAutoEggRestockSettings(
  partial: Partial<AutoEggRestockSettings> | undefined,
): AutoEggRestockSettings {
  const d = defaultAutoEggRestockSettings();
  if (!partial) {
    return d;
  }
  return {
    enabled: partial.enabled ?? d.enabled,
    targetCount: Math.max(0, Math.min(MAX_EGG_COUNT, partial.targetCount ?? d.targetCount)),
    gachaType: partial.gachaType ?? d.gachaType,
    perVoucher: { ...d.perVoucher, ...(partial.perVoucher ?? {}) },
  };
}
