import { globalScene } from "#app/global-scene";
import { PersistentModifier } from "#modifiers/modifier";
import type { GeneratedPersistentModifierType, ModifierType } from "#modifiers/modifier-type";
import { getModifierTypeFuncById, ModifierTypeGenerator } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";

/**
 * Runtime modifier types which cannot live in the static modifier-type table.
 *
 * A few ER held-item families have one concrete type per runtime variant (for
 * example one Ward Stone type per tier and one resist berry per damage type).
 * They still need the exact same `typeId -> factory` round trip as a static
 * modifier: co-op snapshots and session saves both reconstruct through
 * {@linkcode ModifierData.toModifier}. Keep that extension point here, at the
 * reconstruction boundary, instead of teaching every caller about ER types.
 */
const modifierDataTypeFactories = new Map<string, ModifierTypeFunc>();

/** Register (or refresh during HMR) a dynamic modifier-type factory. */
export function registerModifierDataTypeFactory(typeId: string, factory: ModifierTypeFunc): void {
  if (typeof typeId !== "string" || typeId.trim().length === 0) {
    throw new Error("Cannot register a ModifierData factory without a stable typeId");
  }
  if (getModifierTypeFuncById(typeId)) {
    throw new Error(`ModifierData extension typeId '${typeId}' collides with the static modifier registry`);
  }
  modifierDataTypeFactories.set(typeId, factory);
}

/** Resolve a static or dynamically registered modifier-type factory. */
export function getModifierDataTypeFactory(typeId: string): ModifierTypeFunc | undefined {
  return getModifierTypeFuncById(typeId) ?? modifierDataTypeFactories.get(typeId);
}

export class ModifierData {
  public player: boolean;
  public typeId: string;
  public typePregenArgs: any[];
  public args: any[];
  public stackCount: number;

  public className: string;

  constructor(source: PersistentModifier | any, player: boolean) {
    const sourceModifier = source instanceof PersistentModifier ? (source as PersistentModifier) : null;
    this.player = player;
    this.typeId = sourceModifier ? sourceModifier.type.id : source.typeId;
    if (sourceModifier) {
      if ("getPregenArgs" in source.type) {
        this.typePregenArgs = (source.type as GeneratedPersistentModifierType).getPregenArgs();
      }
    } else if (source.typePregenArgs) {
      this.typePregenArgs = source.typePregenArgs;
    }
    this.args = sourceModifier ? sourceModifier.getArgs() : source.args || [];
    this.stackCount = source.stackCount;
    this.className = sourceModifier ? sourceModifier.constructor.name : source.className;
  }

  toModifier(_constructor: any): PersistentModifier | null {
    const typeFunc = getModifierDataTypeFactory(this.typeId);
    if (!typeFunc) {
      return null;
    }

    try {
      let type: ModifierType | null = typeFunc();
      type.id = this.typeId;

      if (type instanceof ModifierTypeGenerator) {
        type = (type as ModifierTypeGenerator).generateType(
          this.player ? globalScene.getPlayerParty() : globalScene.getEnemyField(),
          this.typePregenArgs,
        );
      }

      const ret = Reflect.construct(
        _constructor,
        ([type] as any[]).concat(this.args).concat(this.stackCount),
      ) as PersistentModifier;

      if (ret.stackCount > ret.getMaxStackCount()) {
        ret.stackCount = ret.getMaxStackCount();
      }

      return ret;
    } catch (err) {
      console.error(err);
      return null;
    }
  }
}
