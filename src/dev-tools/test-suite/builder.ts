/*
 * Elite Redux — in-game SCENARIO BUILDER overlay. *** TRACKED — STAGING ONLY ***
 *
 * Opened from the Dev Scenarios picker. A plain-DOM form (same pattern as the
 * scenario banner / Send Logs button - never touches the Phaser mode stack)
 * that composes a ScenarioSpec: run state, player party, enemy side, items and
 * battle-start state. From there:
 *   - LAUNCH drops straight into the configured battle (same rails as the
 *     hand-written scenarios),
 *   - COPY CODE serializes the spec to a share code anyone can paste back in
 *     (with a pinned seed the repro is roll-for-roll identical),
 *   - scenarios can be SAVED locally (localStorage) for quick re-runs.
 */

import { allChallenges } from "#data/challenge";
import { allMoves, allSpecies, modifierTypes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { Challenges } from "#enums/challenges";
import { Nature } from "#enums/nature";
import { StatusEffect } from "#enums/status-effect";
import { TrainerType } from "#enums/trainer-type";
import { WeatherType } from "#enums/weather-type";
import {
  buildDevScenario,
  decodeScenarioSpec,
  emptyScenarioSpec,
  encodeScenarioSpec,
  type ScenarioSpec,
  type SpecEnemyMon,
  type SpecItemRow,
  type SpecMon,
} from "./scenario-spec";
import type { DevScenario } from "./scenarios";

export interface BuilderDeps {
  /** Launch a scenario through the suite's normal rails; true on success. */
  launch: (scenario: DevScenario) => boolean;
  /** Record the active share code so Send Logs embeds it. */
  setShareCode: (code: string | null) => void;
  /**
   * Restore the Phaser dev-scenario picker. The picker's OPTION_SELECT is
   * cleared while this DOM form is open (so it doesn't fight the form for
   * keyboard input), which leaves the game with no active UI mode. Closing the
   * form WITHOUT launching must re-open the picker, or the game softlocks.
   */
  closeMenu: () => void;
}

const SAVED_KEY = "er-dev-saved-scenarios";
const PANEL_ID = "er-dev-scenario-builder";

// --- name <-> id catalogs (built lazily from the live tables) -----------------

let catalogs: {
  speciesByName: Map<string, ScenarioSpeciesOption>;
  speciesNameById: Map<number, string>;
  speciesLabelByKey: Map<string, string>;
  speciesLabels: string[];
  moveByName: Map<string, number>;
  moveNameById: Map<number, string>;
} | null = null;

export interface ScenarioSpeciesOption {
  label: string;
  species: number;
  formIndex: number;
}

function speciesFormKey(species: number, formIndex: number): string {
  return `${species}:${formIndex}`;
}

function formLabel(formName: string, formKey: string): string {
  const explicit = formName.trim();
  if (explicit) {
    return explicit;
  }
  return formKey
    .split("-")
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Build the staff picker from the fully initialized live registry, including every form. */
export function buildScenarioSpeciesOptions(): ScenarioSpeciesOption[] {
  const options: ScenarioSpeciesOption[] = [];
  for (const species of allSpecies) {
    if (!species?.name) {
      continue;
    }
    options.push({ label: species.name, species: species.speciesId, formIndex: 0 });
    species.forms?.forEach((form, formIndex) => {
      if (!form?.formKey) {
        return;
      }
      const suffix = formLabel(form.formName, form.formKey);
      if (suffix) {
        options.push({ label: `${species.name} (${suffix})`, species: species.speciesId, formIndex });
      }
    });
  }
  return options;
}

function getCatalogs() {
  if (catalogs) {
    return catalogs;
  }
  const speciesByName = new Map<string, ScenarioSpeciesOption>();
  const speciesNameById = new Map<number, string>();
  const speciesLabelByKey = new Map<string, string>();
  const speciesOptions = buildScenarioSpeciesOptions();
  for (const option of speciesOptions) {
    if (option.formIndex === 0 && !speciesNameById.has(option.species)) {
      speciesNameById.set(option.species, option.label);
    }
    speciesLabelByKey.set(speciesFormKey(option.species, option.formIndex), option.label);
    if (!speciesByName.has(option.label.toLowerCase())) {
      speciesByName.set(option.label.toLowerCase(), option);
    }
  }
  const moveByName = new Map<string, number>();
  const moveNameById = new Map<number, string>();
  allMoves.forEach((m, id) => {
    if (id > 0 && m?.name) {
      moveNameById.set(id, m.name);
      if (!moveByName.has(m.name.toLowerCase())) {
        moveByName.set(m.name.toLowerCase(), id);
      }
    }
  });
  catalogs = {
    speciesByName,
    speciesNameById,
    speciesLabelByKey,
    speciesLabels: speciesOptions.map(option => option.label),
    moveByName,
    moveNameById,
  };
  return catalogs;
}

function enumOptions(enumObj: Record<string, unknown>, noneLabel?: string): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  if (noneLabel) {
    out.push({ label: noneLabel, value: 0 });
  }
  for (const [name, value] of Object.entries(enumObj)) {
    if (typeof value === "number" && value > 0) {
      out.push({ label: name, value });
    }
  }
  return out;
}

function ensureDatalist(id: string, names: Iterable<string>): void {
  const existing = document.getElementById(id);
  const dl = existing?.tagName === "DATALIST" ? (existing as HTMLDataListElement) : document.createElement("datalist");
  dl.replaceChildren();
  if (dl !== existing) {
    dl.id = id;
  }
  const frag = document.createDocumentFragment();
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    frag.appendChild(opt);
  }
  dl.appendChild(frag);
  if (existing && dl !== existing) {
    existing.replaceWith(dl);
  } else if (!existing) {
    document.body.appendChild(dl);
  }
}

// --- tiny DOM helpers ----------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style?: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (style) {
    Object.assign(node.style, style);
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function styledButton(label: string, bg: string): HTMLButtonElement {
  const b = el("button", {
    padding: "5px 9px",
    font: "12px/1.2 monospace",
    color: "#fff",
    background: bg,
    border: "1px solid #fff",
    borderRadius: "5px",
    cursor: "pointer",
  });
  b.textContent = label;
  return b;
}

function textInput(width: string, placeholder = "", listId?: string): HTMLInputElement {
  const i = el("input", {
    width,
    font: "12px/1.2 monospace",
    background: "#1e1e2a",
    color: "#fff",
    border: "1px solid #555",
    borderRadius: "4px",
    padding: "3px 5px",
  });
  i.type = "text";
  i.placeholder = placeholder;
  i.spellcheck = false;
  if (listId) {
    i.setAttribute("list", listId);
  }
  return i;
}

function numInput(width: string, placeholder = ""): HTMLInputElement {
  const i = textInput(width, placeholder);
  i.type = "number";
  return i;
}

function selectInput(options: { label: string; value: number | string }[], width = "auto"): HTMLSelectElement {
  const s = el("select", {
    width,
    font: "12px/1.2 monospace",
    background: "#1e1e2a",
    color: "#fff",
    border: "1px solid #555",
    borderRadius: "4px",
    padding: "3px 4px",
  });
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = String(opt.value);
    o.textContent = opt.label;
    s.appendChild(o);
  }
  return s;
}

function labelWrap(text: string, control: HTMLElement): HTMLLabelElement {
  const l = el("label", {
    display: "inline-flex",
    gap: "4px",
    alignItems: "center",
    margin: "2px 8px 2px 0",
    font: "11px/1.3 monospace",
    color: "#bbb",
  });
  l.append(text, control);
  return l;
}

function section(title: string, open = false): { wrap: HTMLDetailsElement; body: HTMLDivElement } {
  const wrap = el("details", { margin: "6px 0", border: "1px solid #333", borderRadius: "6px", padding: "4px 8px" });
  wrap.open = open;
  const summary = el("summary", { cursor: "pointer", fontWeight: "bold", color: "#fff" }, title);
  const body = el("div", { padding: "6px 0 2px" });
  wrap.append(summary, body);
  return { wrap, body };
}

// --- mon row (shared by party + custom enemy party) ------------------------------

interface MonRow {
  root: HTMLDivElement;
  read: () => (SpecEnemyMon & { speciesName: string }) | null;
  fill: (mon: Partial<SpecEnemyMon>) => void;
}

function monRow(index: number, withLevel: boolean): MonRow {
  const { speciesLabelByKey, speciesNameById } = getCatalogs();
  const root = el("div", {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    alignItems: "center",
    padding: "3px 0",
    borderBottom: "1px dashed #333",
  });
  const species = textInput("180px", `mon ${index + 1} species or form`, "er-builder-species");
  const form = numInput("44px", "form");
  species.addEventListener("change", () => {
    const selected = getCatalogs().speciesByName.get(species.value.trim().toLowerCase());
    if (selected) {
      form.value = selected.formIndex > 0 ? String(selected.formIndex) : "";
      species.style.borderColor = "#555";
    }
  });
  const ability = selectInput(
    [
      { label: "Ability 1", value: 0 },
      { label: "Ability 2", value: 1 },
      { label: "Hidden", value: 2 },
    ],
    "86px",
  );
  const nature = selectInput(enumOptions(Nature as unknown as Record<string, unknown>, "HARDY"), "92px");
  const shiny = selectInput(
    [
      { label: "normal", value: 0 },
      { label: "shiny", value: 1 },
      { label: "shiny t2", value: 2 },
      { label: "shiny t3", value: 3 },
    ],
    "78px",
  );
  const level = numInput("52px", "lvl");
  const boss = el("input") as HTMLInputElement;
  boss.type = "checkbox";
  const moves = [0, 1, 2, 3].map(i => textInput("110px", `move ${i + 1}`, "er-builder-moves"));
  root.append(species, form, ability, nature, shiny);
  if (withLevel) {
    root.append(level, labelWrap("boss", boss));
  }
  root.append(...moves);

  const read = () => {
    const name = species.value.trim();
    if (!name) {
      return null;
    }
    const { speciesByName, moveByName } = getCatalogs();
    const selected = speciesByName.get(name.toLowerCase());
    species.style.borderColor = selected === undefined ? "#c0392b" : "#555";
    if (selected === undefined) {
      return null;
    }
    const moveIds: number[] = [];
    for (const m of moves) {
      const mv = m.value.trim();
      if (!mv) {
        m.style.borderColor = "#555";
        continue;
      }
      const mid = moveByName.get(mv.toLowerCase());
      m.style.borderColor = mid === undefined ? "#c0392b" : "#555";
      if (mid !== undefined) {
        moveIds.push(mid);
      }
    }
    const shinyTier = Number(shiny.value);
    return {
      speciesName: name,
      species: selected.species,
      formIndex: form.value.trim() === "" ? selected.formIndex : Number(form.value) || 0,
      abilitySlot: Number(ability.value) || 0,
      nature: Number(nature.value) || 0,
      moves: moveIds.length > 0 ? moveIds : undefined,
      shiny: shinyTier > 0,
      variant: shinyTier > 0 ? shinyTier - 1 : 0,
      level: withLevel ? Number(level.value) || undefined : undefined,
      isBoss: withLevel ? boss.checked : undefined,
    };
  };
  const fill = (mon: Partial<SpecEnemyMon>) => {
    const formIndex = mon.formIndex ?? 0;
    species.value =
      mon.species === undefined
        ? ""
        : (speciesLabelByKey.get(speciesFormKey(mon.species, formIndex))
          ?? speciesNameById.get(mon.species)
          ?? String(mon.species));
    form.value = mon.formIndex ? String(mon.formIndex) : "";
    ability.value = String(mon.abilitySlot ?? 0);
    nature.value = String(mon.nature ?? 0);
    shiny.value = mon.shiny ? String((mon.variant ?? 0) + 1) : "0";
    level.value = mon.level ? String(mon.level) : "";
    boss.checked = !!mon.isBoss;
    const { moveNameById } = getCatalogs();
    moves.forEach((m, i) => {
      const id = mon.moves?.[i];
      m.value = id === undefined ? "" : (moveNameById.get(id) ?? String(id));
    });
  };
  return { root, read, fill };
}

// --- the overlay ------------------------------------------------------------------

export function openScenarioBuilder(deps: BuilderDeps): void {
  if (typeof document === "undefined") {
    return;
  }
  document.getElementById(PANEL_ID)?.remove();
  // Custom species and injected forms are registered during ER initialization.
  // Rebuild on every open so an early/stale builder visit cannot permanently hide them.
  catalogs = null;
  const { speciesLabels, moveNameById } = getCatalogs();
  ensureDatalist("er-builder-species", speciesLabels);
  ensureDatalist("er-builder-moves", moveNameById.values());
  ensureDatalist("er-builder-items", Object.keys(modifierTypes));

  const panel = el("div", {
    position: "fixed",
    top: "8px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "99999",
    width: "min(900px, 96vw)",
    maxHeight: "92vh",
    overflowY: "auto",
    padding: "10px 14px",
    font: "12px/1.4 monospace",
    color: "#fff",
    background: "rgba(14,14,22,0.97)",
    border: "1px solid #b3245c",
    borderRadius: "8px",
  });
  panel.id = PANEL_ID;

  const title = el("div", { fontWeight: "bold", fontSize: "14px", marginBottom: "4px" }, "🧪 Scenario Builder");
  const status = el("div", { color: "#d8aa3a", minHeight: "16px", margin: "4px 0" });
  const setStatus = (msg: string, ok = false) => {
    status.textContent = msg;
    status.style.color = ok ? "#2fae66" : "#d8aa3a";
  };
  panel.append(title, status);

  // ---- meta ----
  const meta = section("Name & notes", true);
  const nameIn = textInput("220px", "scenario name (shows in the banner)");
  const notesIn = el("textarea", {
    width: "100%",
    minHeight: "34px",
    font: "12px/1.3 monospace",
    background: "#1e1e2a",
    color: "#fff",
    border: "1px solid #555",
    borderRadius: "4px",
  }) as HTMLTextAreaElement;
  notesIn.placeholder = "what to do / what to expect (testers read this)";
  meta.body.append(labelWrap("Name", nameIn), notesIn);

  // ---- run ----
  const run = section("Run (wave, biome, weather, seed, difficulty, challenges)", true);
  const waveIn = numInput("64px", "wave");
  const levelIn = numInput("60px", "level");
  const moneyIn = numInput("80px", "money");
  const seedIn = textInput("190px", "seed (pin for exact repro)");
  const biomeSel = selectInput(
    [{ label: "(any biome)", value: -1 }, ...enumOptions(BiomeId as unknown as Record<string, unknown>)],
    "150px",
  );
  const weatherSel = selectInput(
    enumOptions(WeatherType as unknown as Record<string, unknown>, "(no weather)"),
    "140px",
  );
  const diffSel = selectInput(
    ["ace", "youngster", "elite", "hell"].map(d => ({ label: d, value: d })),
    "100px",
  );
  const doubleChk = el("input") as HTMLInputElement;
  doubleChk.type = "checkbox";
  run.body.append(
    labelWrap("Wave", waveIn),
    labelWrap("Party level", levelIn),
    labelWrap("Money", moneyIn),
    labelWrap("Biome", biomeSel),
    labelWrap("Weather", weatherSel),
    labelWrap("Difficulty", diffSel),
    labelWrap("Double", doubleChk),
    labelWrap("Seed", seedIn),
  );
  // Challenge rows (up to 3).
  const challengeOpts = [
    { label: "(none)", value: 0 },
    ...allChallenges.map(c => ({ label: Challenges[c.id] ?? String(c.id), value: c.id })),
  ];
  const challengeRows = [0, 1, 2].map(() => {
    const sel = selectInput(challengeOpts, "210px");
    const val = numInput("48px", "val");
    val.value = "1";
    return { sel, val };
  });
  const chWrap = el("div", { marginTop: "4px" });
  chWrap.append("Challenges: ", ...challengeRows.flatMap(r => [r.sel, r.val, el("span", { marginRight: "8px" }, " ")]));
  run.body.append(chWrap);

  // ---- party ----
  const party = section("Player party (up to 6)", true);
  const partyRows = [0, 1, 2, 3, 4, 5].map(i => monRow(i, false));
  party.body.append(...partyRows.map(r => r.root));

  // ---- enemy ----
  const enemy = section("Enemy side", true);
  const kindSel = selectInput(
    [
      { label: "wild mon", value: "wild" },
      { label: "trainer class", value: "trainer" },
      { label: "custom enemy party", value: "party" },
    ],
    "170px",
  );
  const wildRow = monRow(0, true);
  const wildStatus = selectInput(
    enumOptions(StatusEffect as unknown as Record<string, unknown>, "(no status)"),
    "120px",
  );
  const wildSegments = numInput("52px", "segs");
  const wildWrap = el("div");
  wildWrap.append(wildRow.root, labelWrap("Status", wildStatus), labelWrap("Boss segments", wildSegments));
  const trainerSel = selectInput(
    enumOptions(TrainerType as unknown as Record<string, unknown>, "(pick trainer)"),
    "220px",
  );
  const trainerWrap = el("div");
  trainerWrap.append(
    labelWrap("Trainer class", trainerSel),
    el("span", { color: "#888" }, " roster comes from difficulty + seed"),
  );
  const enemyPartyRows = [0, 1, 2, 3, 4, 5].map(i => monRow(i, true));
  const enemyPartyWrap = el("div");
  enemyPartyWrap.append(
    el(
      "div",
      { color: "#888", margin: "2px 0" },
      "Slot-by-slot enemies. Wild waves use the first 1-2; trainer waves replace the generated team.",
    ),
    ...enemyPartyRows.map(r => r.root),
  );
  const syncEnemyKind = () => {
    const k = kindSel.value;
    wildWrap.style.display = k === "wild" ? "block" : "none";
    trainerWrap.style.display = k === "trainer" ? "block" : "none";
    enemyPartyWrap.style.display = k === "party" ? "block" : "none";
  };
  kindSel.addEventListener("change", syncEnemyKind);
  enemy.body.append(labelWrap("Kind", kindSel), wildWrap, trainerWrap, enemyPartyWrap);
  syncEnemyKind();

  // ---- items ----
  const items = section("Items (player held / modifiers / guaranteed shop)");
  const heldIn = textInput(
    "96%",
    "held items, comma separated modifierTypes keys e.g. LEFTOVERS, FOCUS_BAND x2",
    "er-builder-items",
  );
  const modsIn = textInput("96%", "player modifiers e.g. EXP_SHARE x3, MEGA_BRACELET", "er-builder-items");
  const shopIn = textInput("96%", "guaranteed first-shop items e.g. RARE_CANDY, FORM_CHANGE_ITEM", "er-builder-items");
  items.body.append(
    labelWrap("Held", heldIn),
    el("br"),
    labelWrap("Mods", modsIn),
    el("br"),
    labelWrap("Shop", shopIn),
  );

  // ---- battle start ----
  const start = section("Battle start (stages, HP%, status)");
  const stageLabels = ["Atk", "Def", "SpA", "SpD", "Spe", "Acc", "Eva"];
  const mkStageRow = (who: string) => {
    const inputs = stageLabels.map(l => {
      const i = numInput("42px", l);
      i.title = `${who} ${l} stage (-6..6)`;
      return i;
    });
    const row = el("div", { margin: "2px 0" });
    row.append(`${who} stages: `, ...inputs);
    return { row, inputs };
  };
  const pStages = mkStageRow("Player");
  const eStages = mkStageRow("Enemy");
  const pHp = numInput("52px", "%");
  const eHp = numInput("52px", "%");
  const pStatus = selectInput(enumOptions(StatusEffect as unknown as Record<string, unknown>, "(none)"), "110px");
  const eStatus = selectInput(enumOptions(StatusEffect as unknown as Record<string, unknown>, "(none)"), "110px");
  start.body.append(
    pStages.row,
    eStages.row,
    labelWrap("Player HP%", pHp),
    labelWrap("Enemy HP%", eHp),
    labelWrap("Player status", pStatus),
    labelWrap("Enemy status", eStatus),
  );

  panel.append(meta.wrap, run.wrap, party.wrap, enemy.wrap, items.wrap, start.wrap);

  // ---- read the form into a spec -------------------------------------------------
  const parseItemList = (raw: string): SpecItemRow[] =>
    raw
      .split(",")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const m = part.match(/^([A-Za-z0-9_]+)(?:\s*x\s*(\d+))?$/i);
        return m ? { name: m[1].toUpperCase(), count: m[2] ? Number(m[2]) : undefined } : { name: part.toUpperCase() };
      });

  const readSpec = (): ScenarioSpec | null => {
    const spec = emptyScenarioSpec();
    spec.name = nameIn.value.trim();
    spec.notes = notesIn.value.trim();
    spec.run = {
      wave: Number(waveIn.value) || undefined,
      level: Number(levelIn.value) || undefined,
      money: Number(moneyIn.value) || undefined,
      seed: seedIn.value.trim() || undefined,
      biome: Number(biomeSel.value) >= 0 ? Number(biomeSel.value) : undefined,
      weather: Number(weatherSel.value) || undefined,
      double: doubleChk.checked || undefined,
      difficulty: diffSel.value as "youngster" | "ace" | "elite" | "hell",
      challenges: challengeRows
        .filter(r => Number(r.sel.value) > 0)
        .map(r => ({ id: Number(r.sel.value), value: Number(r.val.value) || 1 })),
    };
    const partyMons = partyRows.map(r => r.read()).filter((m): m is NonNullable<ReturnType<MonRow["read"]>> => !!m);
    if (partyMons.length === 0) {
      setStatus("Add at least one player mon (species name from the list).");
      return null;
    }
    spec.party = partyMons.map(({ speciesName: _n, level: _l, isBoss: _b, ...mon }) => mon as SpecMon);
    const kind = kindSel.value as "wild" | "trainer" | "party";
    if (kind === "wild") {
      const w = wildRow.read();
      if (w) {
        const { speciesName: _n, ...wild } = w;
        spec.enemy = {
          kind,
          wild: {
            ...wild,
            status: Number(wildStatus.value) || undefined,
            bossSegments: Number(wildSegments.value) || undefined,
          },
        };
      } else {
        spec.enemy = { kind };
      }
    } else if (kind === "trainer") {
      if (!Number(trainerSel.value)) {
        setStatus("Pick a trainer class (or switch the enemy kind).");
        return null;
      }
      spec.enemy = { kind, trainerType: Number(trainerSel.value) };
    } else {
      const mons = enemyPartyRows.map(r => r.read()).filter((m): m is NonNullable<ReturnType<MonRow["read"]>> => !!m);
      if (mons.length === 0) {
        setStatus("Add at least one custom enemy mon (or switch the enemy kind).");
        return null;
      }
      spec.enemy = { kind, party: mons.map(({ speciesName: _n, ...mon }) => mon) };
    }
    spec.items = {
      held: parseItemList(heldIn.value),
      modifiers: parseItemList(modsIn.value),
      shop: parseItemList(shopIn.value).map(i => i.name),
    };
    const stages = (inputs: HTMLInputElement[]) => inputs.map(i => Number(i.value) || 0);
    spec.start = {
      playerStages: stages(pStages.inputs),
      enemyStages: stages(eStages.inputs),
      playerHpPct: Number(pHp.value) || undefined,
      enemyHpPct: Number(eHp.value) || undefined,
      playerStatus: Number(pStatus.value) || undefined,
      enemyStatus: Number(eStatus.value) || undefined,
    };
    return spec;
  };

  // ---- fill the form from a spec --------------------------------------------------
  const fillForm = (spec: ScenarioSpec): void => {
    nameIn.value = spec.name ?? "";
    notesIn.value = spec.notes ?? "";
    waveIn.value = spec.run?.wave ? String(spec.run.wave) : "";
    levelIn.value = spec.run?.level ? String(spec.run.level) : "";
    moneyIn.value = spec.run?.money ? String(spec.run.money) : "";
    seedIn.value = spec.run?.seed ?? "";
    biomeSel.value = String(spec.run?.biome ?? -1);
    weatherSel.value = String(spec.run?.weather ?? 0);
    diffSel.value = spec.run?.difficulty ?? "ace";
    doubleChk.checked = !!spec.run?.double;
    challengeRows.forEach((r, i) => {
      const ch = spec.run?.challenges?.[i];
      r.sel.value = String(ch?.id ?? 0);
      r.val.value = String(ch?.value ?? 1);
    });
    partyRows.forEach((r, i) => r.fill(spec.party[i] ?? {}));
    const kind = spec.enemy?.kind ?? "wild";
    kindSel.value = kind;
    syncEnemyKind();
    if (spec.enemy?.wild) {
      wildRow.fill(spec.enemy.wild);
      wildStatus.value = String(spec.enemy.wild.status ?? 0);
      wildSegments.value = spec.enemy.wild.bossSegments ? String(spec.enemy.wild.bossSegments) : "";
    }
    trainerSel.value = String(spec.enemy?.trainerType ?? 0);
    enemyPartyRows.forEach((r, i) => r.fill(spec.enemy?.party?.[i] ?? {}));
    const fmtItems = (rows?: SpecItemRow[]) =>
      (rows ?? []).map(r => (r.count && r.count > 1 ? `${r.name} x${r.count}` : r.name)).join(", ");
    heldIn.value = fmtItems(spec.items?.held);
    modsIn.value = fmtItems(spec.items?.modifiers);
    shopIn.value = (spec.items?.shop ?? []).join(", ");
    pStages.inputs.forEach((i, n) => {
      i.value = spec.start?.playerStages?.[n] ? String(spec.start.playerStages[n]) : "";
    });
    eStages.inputs.forEach((i, n) => {
      i.value = spec.start?.enemyStages?.[n] ? String(spec.start.enemyStages[n]) : "";
    });
    pHp.value = spec.start?.playerHpPct ? String(spec.start.playerHpPct) : "";
    eHp.value = spec.start?.enemyHpPct ? String(spec.start.enemyHpPct) : "";
    pStatus.value = String(spec.start?.playerStatus ?? 0);
    eStatus.value = String(spec.start?.enemyStatus ?? 0);
  };

  // ---- saved scenarios -------------------------------------------------------------
  const savedWrap = section("Saved scenarios (this browser)");
  const renderSaved = () => {
    savedWrap.body.innerHTML = "";
    let saved: Record<string, string> = {};
    try {
      saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}") as Record<string, string>;
    } catch {
      saved = {};
    }
    const names = Object.keys(saved);
    if (names.length === 0) {
      savedWrap.body.append(el("span", { color: "#888" }, "none yet - build one and hit Save"));
      return;
    }
    for (const name of names) {
      const row = el("div", { display: "flex", gap: "6px", alignItems: "center", margin: "2px 0" });
      const loadBtn = styledButton(name, "#2a4d6e");
      loadBtn.addEventListener("click", () => {
        const spec = decodeScenarioSpec(saved[name]);
        if ("error" in spec) {
          setStatus(spec.error);
          return;
        }
        fillForm(spec);
        setStatus(`Loaded "${name}".`, true);
      });
      const delBtn = styledButton("✕", "#5c2430");
      delBtn.addEventListener("click", () => {
        delete saved[name];
        localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
        renderSaved();
      });
      row.append(loadBtn, delBtn);
      savedWrap.body.append(row);
    }
  };
  renderSaved();
  panel.append(savedWrap.wrap);

  // ---- actions ----------------------------------------------------------------------
  const actions = el("div", { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" });
  const launchBtn = styledButton("🚀 Launch", "#1f7a3d");
  launchBtn.addEventListener("click", () => {
    const spec = readSpec();
    if (!spec) {
      return;
    }
    const { scenario, postLaunch } = buildDevScenario(spec);
    deps.setShareCode(encodeScenarioSpec(spec));
    panel.remove();
    if (deps.launch(scenario)) {
      postLaunch();
    } else {
      // Launch failed (e.g. setup threw) - restore the picker instead of
      // leaving the player in a modeless limbo.
      deps.closeMenu();
    }
  });
  const copyBtn = styledButton("📋 Copy share code", "#2a4d6e");
  copyBtn.addEventListener("click", () => {
    const spec = readSpec();
    if (!spec) {
      return;
    }
    const code = encodeScenarioSpec(spec);
    navigator.clipboard
      ?.writeText(code)
      .then(() => setStatus("Share code copied - paste it into a bug report or another browser.", true))
      .catch(() => {
        window.prompt("Copy the share code:", code);
      });
  });
  const pasteBtn = styledButton("📥 Import code", "#6e5a2a");
  pasteBtn.addEventListener("click", () => {
    const code = window.prompt("Paste a scenario share code (ERS1.…):", "") ?? "";
    if (!code.trim()) {
      return;
    }
    const spec = decodeScenarioSpec(code);
    if ("error" in spec) {
      setStatus(spec.error);
      return;
    }
    fillForm(spec);
    setStatus("Code imported - review and Launch.", true);
  });
  const saveBtn = styledButton("💾 Save", "#444");
  saveBtn.addEventListener("click", () => {
    const spec = readSpec();
    if (!spec) {
      return;
    }
    const name = spec.name?.trim() || window.prompt("Name this scenario:", "") || "";
    if (!name) {
      return;
    }
    let saved: Record<string, string> = {};
    try {
      saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}") as Record<string, string>;
    } catch {
      saved = {};
    }
    saved[name] = encodeScenarioSpec(spec);
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    renderSaved();
    setStatus(`Saved "${name}" locally.`, true);
  });
  const closeBtn = styledButton("Close", "#5c2430");
  closeBtn.addEventListener("click", () => {
    panel.remove();
    deps.closeMenu();
  });
  actions.append(launchBtn, copyBtn, pasteBtn, saveBtn, closeBtn);
  panel.append(actions);

  document.body.appendChild(panel);
}
