
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { dispatchBespoke } from "#data/elite-redux/archetype-dispatcher";
import { initAbilities } from "#data/abilities/init-abilities";
import { initEliteReduxCustomAbilities } from "#data/elite-redux/init-elite-redux-custom-abilities";

// Pokerogue's ability table needs init before the dispatcher can resolve
// references to vanilla AbAttrs in some wires.
try {
  initAbilities();
  initEliteReduxCustomAbilities();
} catch (e) {
  // Some inits depend on global scene; tolerate failure here — the
  // dispatcher itself doesn't need scene at construct time.
}

const bespoke = Object.values(ER_ABILITY_ARCHETYPES).filter(e => e.archetype === "bespoke");
const results = [];
for (const entry of bespoke) {
  if (entry.erAbilityId === 0) continue;
  try {
    const res = dispatchBespoke(entry.erAbilityId);
    const attrCount = res.attrs?.length ?? 0;
    const status =
      attrCount > 0 ? "WIRED" : res.skipReason ? "SKIP" : "EMPTY";
    const constructorNames = (res.attrs ?? []).map(a => a.constructor?.name ?? "?").join(",");
    results.push({
      erId: entry.erAbilityId,
      status,
      attrCount,
      constructorNames,
      skipReason: res.skipReason ?? "",
    });
  } catch (err) {
    results.push({
      erId: entry.erAbilityId,
      status: "ERROR",
      attrCount: 0,
      constructorNames: "",
      skipReason: err instanceof Error ? err.message : String(err),
    });
  }
}
console.log(JSON.stringify(results));
