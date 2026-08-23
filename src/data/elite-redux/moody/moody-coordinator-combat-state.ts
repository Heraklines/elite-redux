import {
  hydrateMoodyCoordinatorState,
  persistMoodyCoordinatorState,
} from "#data/elite-redux/moody/moody-runtime-coordinator";
import type { MoodyRuntimeState, MoodyRuntimeValue } from "#data/elite-redux/moody/moody-runtime-meta";
import { getMoodyModeSaveData, getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";

const spectralPowerByPokemon = new Map<number, number>();

function commit(save: MoodyModeSaveData): void {
  const live = getMoodyModeState() as MoodyModeSaveData | null;
  if (live == null) {
    return;
  }
  live.boons = structuredClone(save.boons);
  live.curses = structuredClone(save.curses);
}

export function getMoodyCoordinatorEffectState(effectId: string): MoodyRuntimeState | null {
  const save = getMoodyModeSaveData();
  return save == null
    ? null
    : (hydrateMoodyCoordinatorState(save).effects.find(effect => effect.effectId === effectId)?.state ?? null);
}

export function updateMoodyCoordinatorEffectValues(
  effectId: string,
  update: (values: Readonly<Record<string, MoodyRuntimeValue>>) => Readonly<Record<string, MoodyRuntimeValue>>,
): boolean {
  const save = getMoodyModeSaveData();
  if (save == null) {
    return false;
  }
  const coordinator = hydrateMoodyCoordinatorState(save);
  let found = false;
  const effects = coordinator.effects.map(effect => {
    if (effect.effectId !== effectId) {
      return effect;
    }
    found = true;
    return {
      ...effect,
      state: {
        ...effect.state,
        values: update(effect.state?.values ?? {}),
      },
    };
  });
  if (found) {
    commit(persistMoodyCoordinatorState(save, { effects }));
  }
  return found;
}

export function resetMoodyCoordinatorEffectCounter(effectId: string, counterId: string): boolean {
  const save = getMoodyModeSaveData();
  if (save == null) {
    return false;
  }
  const coordinator = hydrateMoodyCoordinatorState(save);
  let found = false;
  const effects = coordinator.effects.map(effect => {
    if (effect.effectId !== effectId) {
      return effect;
    }
    found = true;
    return {
      ...effect,
      state: {
        ...effect.state,
        counters: { ...effect.state?.counters, [counterId]: 0 },
      },
    };
  });
  if (found) {
    commit(persistMoodyCoordinatorState(save, { effects }));
  }
  return found;
}

function numberRecord(value: MoodyRuntimeValue | undefined): Record<string, number> {
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

interface QueuedPower {
  readonly multiplier: number;
  readonly charges: number;
}

function runtimeRecord(value: MoodyRuntimeValue | undefined): Readonly<Record<string, MoodyRuntimeValue>> | null {
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as Readonly<Record<string, MoodyRuntimeValue>>;
}

function queuedPowerRecord(value: MoodyRuntimeValue | undefined): Record<string, QueuedPower> {
  const record = runtimeRecord(value);
  if (record == null) {
    return {};
  }
  const result: Record<string, QueuedPower> = {};
  for (const [pokemonId, raw] of Object.entries(record)) {
    const queued = runtimeRecord(raw);
    if (queued == null) {
      continue;
    }
    const multiplier = Number(queued.multiplier);
    const charges = Number(queued.charges);
    if (Number.isFinite(multiplier) && Number.isFinite(charges) && multiplier > 1 && charges > 0) {
      result[pokemonId] = { multiplier, charges: Math.floor(charges) };
    }
  }
  return result;
}

export function setMoodyCoordinatorSpectralPower(pokemonId: number, multiplier: number): void {
  spectralPowerByPokemon.set(pokemonId, Math.max(0, multiplier));
}

export function clearMoodyCoordinatorSpectralPower(pokemonId: number): void {
  spectralPowerByPokemon.delete(pokemonId);
}

export function getMoodyCoordinatorSpectralPower(pokemonId: number): number {
  return spectralPowerByPokemon.get(pokemonId) ?? 1;
}

export function grantMoodyCoordinatorBarrier(pokemonId: number, amount: number): void {
  const added = Math.max(0, Math.floor(amount));
  if (added === 0) {
    return;
  }
  updateMoodyCoordinatorEffectValues("pressure-valve", values => {
    const barriers = numberRecord(values.barriersByPokemon);
    barriers[String(pokemonId)] = (barriers[String(pokemonId)] ?? 0) + added;
    return { ...values, barriersByPokemon: barriers };
  });
}

export function grantMoodySetCollectorBarrier(pokemonId: number, amount: number): void {
  const added = Math.max(0, Math.floor(amount));
  if (added === 0) {
    return;
  }
  updateMoodyCoordinatorEffectValues("set-collector", values => {
    const barriers = numberRecord(values.barriersByPokemon);
    barriers[String(pokemonId)] = (barriers[String(pokemonId)] ?? 0) + added;
    return { ...values, barriersByPokemon: barriers };
  });
}

export function getMoodyCoordinatorBarrier(pokemonId: number): number {
  const id = String(pokemonId);
  return (
    (numberRecord(getMoodyCoordinatorEffectState("pressure-valve")?.values?.barriersByPokemon)[id] ?? 0)
    + (numberRecord(getMoodyCoordinatorEffectState("set-collector")?.values?.barriersByPokemon)[id] ?? 0)
  );
}

export function absorbMoodyCoordinatorBarrier(pokemonId: number, damage: number, simulated: boolean): number {
  const totalBarrier = getMoodyCoordinatorBarrier(pokemonId);
  if (totalBarrier <= 0 || damage <= 0) {
    return damage;
  }
  const absorbed = Math.min(totalBarrier, damage);
  if (!simulated) {
    let remainingAbsorption = absorbed;
    for (const effectId of ["pressure-valve", "set-collector"]) {
      if (remainingAbsorption <= 0) {
        break;
      }
      updateMoodyCoordinatorEffectValues(effectId, values => {
        const barriers = numberRecord(values.barriersByPokemon);
        const id = String(pokemonId);
        const available = barriers[id] ?? 0;
        const consumed = Math.min(available, remainingAbsorption);
        remainingAbsorption -= consumed;
        const remaining = available - consumed;
        if (remaining > 0) {
          barriers[id] = remaining;
        } else {
          delete barriers[id];
        }
        return { ...values, barriersByPokemon: barriers };
      });
    }
  }
  return damage - absorbed;
}

export function queueMoodyCoordinatorMovePower(pokemonId: number, multiplier: number, charges: number): void {
  if (charges <= 0 || multiplier <= 1) {
    return;
  }
  updateMoodyCoordinatorEffectValues("pressure-valve", values => {
    const queued = queuedPowerRecord(values.queuedMovePowerByPokemon);
    const previous = queued[String(pokemonId)];
    queued[String(pokemonId)] = {
      multiplier: Math.max(previous?.multiplier ?? 1, multiplier),
      charges: (previous?.charges ?? 0) + Math.floor(charges),
    };
    return { ...values, queuedMovePowerByPokemon: queued as unknown as MoodyRuntimeValue };
  });
}

export function consumeMoodyCoordinatorMovePower(pokemonId: number, simulated: boolean): number {
  const queued = queuedPowerRecord(getMoodyCoordinatorEffectState("pressure-valve")?.values?.queuedMovePowerByPokemon)[
    String(pokemonId)
  ];
  if (queued == null) {
    return 1;
  }
  if (!simulated) {
    updateMoodyCoordinatorEffectValues("pressure-valve", values => {
      const allQueued = queuedPowerRecord(values.queuedMovePowerByPokemon);
      if (queued.charges > 1) {
        allQueued[String(pokemonId)] = { ...queued, charges: queued.charges - 1 };
      } else {
        delete allQueued[String(pokemonId)];
      }
      return { ...values, queuedMovePowerByPokemon: allQueued as unknown as MoodyRuntimeValue };
    });
  }
  return queued.multiplier;
}

export function recordMoodyCoordinatorMortalWound(pokemonId: number): void {
  updateMoodyCoordinatorEffectValues("mortal-wounds", values => {
    const wounded = Array.isArray(values.mortallyWoundedPokemonIds) ? values.mortallyWoundedPokemonIds.map(String) : [];
    return { ...values, mortallyWoundedPokemonIds: [...new Set([...wounded, String(pokemonId)])] };
  });
}

export function isMoodyCoordinatorReviveAllowed(pokemonId: number): boolean {
  const wounded = getMoodyCoordinatorEffectState("mortal-wounds")?.values?.mortallyWoundedPokemonIds;
  return !Array.isArray(wounded) || !wounded.map(String).includes(String(pokemonId));
}
