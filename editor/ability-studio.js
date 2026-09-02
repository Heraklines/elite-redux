(() => {
  const labels = {
    "on-entry": "On entry",
    "after-attack": "After landing a move",
    "after-hit": "After being hit",
    "after-ko": "After knocking out a foe",
    "end-turn": "At the end of each turn",
    "after-faint": "After the holder faints",
    holder: "Holder",
    other: "Other Pokemon",
    "holder-side": "Holder and allies",
    "opposing-side": "All foes",
    "holder-hp": "Holder HP",
    "holder-status": "Holder status",
    "other-status": "Other Pokemon status",
    weather: "Weather",
    terrain: "Terrain",
    move: "Move filter",
    "stat-stage": "Change stat stages",
    status: "Apply status",
    "heal-percent": "Heal max HP",
    "cure-status": "Cure status",
    "set-weather": "Set weather",
    "set-terrain": "Set terrain",
    "move-power": "Move power multiplier",
    "received-damage": "Incoming damage multiplier",
    "stat-multiplier": "Calculated stat multiplier",
    priority: "Move priority change",
  };

  let state = {};
  let baseline = {};
  let selected = null;
  let mode = "assignments";
  let listQuery = "";
  let primitiveCatalog = null;
  let baseAbilities = [];
  let mechanicCatalog = [];
  let mechanicsByAbility = new Map();
  let componentCatalog = [];
  let componentsByAbility = new Map();
  let componentsBySource = new Map();
  let componentConditionsByKey = new Map();
  let componentEffectsByKey = new Map();
  let moveCatalog = [];
  let movesById = new Map();
  let movesByName = new Map();
  let componentInsertTarget = null;
  let componentSearchView = { key: "", abilityLimit: 8, effectLimit: 32, partLimit: 80 };
  let studioDrag = null;
  let community = false;
  let callbacks = {};
  let aiEndpoint = "";
  let loadSavedBlueprints = null;
  let savedBlueprintRefresh = null;
  let savedBlueprintRefreshAt = 0;
  let aiAbortController = null;
  let aiRefreshTimer = null;
  let aiState = {
    prompt: "",
    running: false,
    activity: [],
    usage: null,
    error: "",
    requestId: null,
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const pretty = value =>
    labels[value]
    || String(value)
      .replaceAll("_", " ")
      .replaceAll("-", " ")
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const option = (value, selectedValue, text = pretty(value)) =>
    `<option value="${esc(value)}"${value === selectedValue ? " selected" : ""}>${esc(text)}</option>`;
  const selectOptions = (values, current, allowAny = false) =>
    `${allowAny ? option("", current, "Any") : ""}${values.map(value => option(value, current)).join("")}`;
  const currentEntry = () => (selected && state[selected] ? state[selected] : null);
  const visibleEntries = () =>
    Object.entries(state)
      .filter(([, value]) => value)
      .sort(([, a], [, b]) => a.name.localeCompare(b.name));

  function notify(render = false) {
    callbacks.onCatalogChange?.(getCustomCatalog());
    callbacks.onChange?.();
    if (render) {
      callbacks.render?.();
    } else {
      refreshInspector();
    }
  }

  function refreshInspector() {
    const root = document.querySelector(".as-inspector");
    const entry = currentEntry();
    if (!root) {
      return;
    }
    const allIds = new Set(getAbilityCatalog().map(ability => ability.id));
    root.innerHTML = entry
      ? renderInspector(entry, validateEntry(selected, entry, allIds))
      : `${renderAiAssistant()}<div class="as-panel"><h3>Ability Studio</h3><p class="muted">No ability selected.</p></div>`;
  }

  function scheduleAiRefresh() {
    if (aiRefreshTimer) {
      return;
    }
    aiRefreshTimer = window.setTimeout(() => {
      aiRefreshTimer = null;
      if (!aiState.running && document.activeElement?.matches?.("[data-as-ai-prompt]")) {
        scheduleAiRefresh();
        return;
      }
      refreshInspector();
    }, 80);
  }

  function aiActivity(type, text, append = false) {
    if (!text) {
      return;
    }
    const last = aiState.activity.at(-1);
    if (append && last?.type === type) {
      last.text += text;
    } else if (!append || last?.text !== text) {
      aiState.activity.push({ type, text });
      aiState.activity = aiState.activity.slice(-12);
    }
    scheduleAiRefresh();
  }

  async function aiRequest(path, body = {}, signal) {
    if (!aiEndpoint) {
      throw new Error("The Ability Builder service is not configured");
    }
    const response = await fetch(`${aiEndpoint}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Ability Builder request failed (${response.status})`);
    }
    return response;
  }

  function compactAiParameter(parameter, optionSetIndex) {
    const compact = Object.fromEntries(
      ["path", "label", "rawValue", "control", "editable", "optional", "min", "max"]
        .filter(key => Object.hasOwn(parameter, key))
        .map(key => [key, parameter[key]]),
    );
    if (!Object.hasOwn(compact, "rawValue") && Object.hasOwn(parameter, "value")) {
      compact.value = parameter.value;
    }
    if (Array.isArray(parameter.options) && parameter.options.length > 0) {
      compact.optionsRef = optionSetIndex(parameter.options);
    }
    return compact;
  }

  function compactAiComponentRule(rule, optionSetIndex) {
    return {
      label: rule.label,
      source: rule.source,
      hook: {
        id: rule.hook.id,
        label: rule.hook.label,
        mode: rule.hook.mode,
      },
      parameters: (rule.parameters || [])
        .filter(parameter => parameter.editable)
        .map(parameter => compactAiParameter(parameter, optionSetIndex)),
      conditions: (rule.conditions || []).map(condition => ({
        label: condition.label,
        kind: condition.kind,
        required: condition.required,
        source: condition.source,
      })),
      effects: (rule.effects || []).map(effect => ({
        label: effect.label,
        kind: effect.kind,
        scope: effect.scope,
        source: effect.source,
      })),
    };
  }

  function aiComponentContext() {
    const componentOptionSets = [];
    const optionSetIds = new Map();
    const optionSetIndex = options => {
      const key = JSON.stringify(options);
      if (!optionSetIds.has(key)) {
        optionSetIds.set(key, componentOptionSets.length);
        componentOptionSets.push(options);
      }
      return optionSetIds.get(key);
    };
    const componentCandidates = componentCatalog.map(ability => ({
      id: ability.id,
      name: ability.name,
      description: ability.description,
      rules: (ability.rules || []).map(rule => compactAiComponentRule(rule, optionSetIndex)),
    }));
    return { componentCandidates, componentOptionSets };
  }

  function aiAbilityContext() {
    return getAbilityCatalog().map(ability => ({
      id: ability.id,
      name: ability.name,
      description: ability.description || ability.desc || "",
    }));
  }

  function aiMoveContext() {
    return moveCatalog.map(move => ({
      id: move.id,
      name: move.name,
      type: move.type,
      category: move.category,
      power: move.power,
    }));
  }

  function cleanAiFilter(filter) {
    return Object.fromEntries(
      Object.entries(filter || {}).filter(([, value]) => value !== null && value !== undefined && value !== ""),
    );
  }

  function cleanAiRuntimeSource(source, part) {
    if (!source || !Number.isInteger(Number(source.abilityId)) || !source.parameterOverrides) {
      return;
    }
    for (const [path, value] of Object.entries(source.parameterOverrides)) {
      const parameter = runtimeParameter(source, part, path);
      if (parameter && Object.hasOwn(parameter, "rawValue") && eq(value, parameter.rawValue)) {
        delete source.parameterOverrides[path];
      }
    }
    if (Object.keys(source.parameterOverrides).length === 0) {
      source.parameterOverrides = undefined;
    }
  }

  function normalizeAiBlueprint(raw) {
    const blueprint = clone(raw || {});
    blueprint.version = primitiveCatalog.schemaVersion;
    blueprint.id = nextId();
    blueprint.name = String(blueprint.name || "Generated Ability")
      .trim()
      .slice(0, 40);
    blueprint.description = String(blueprint.description || "Generated ability draft.")
      .trim()
      .slice(0, 500);
    blueprint.generation = Number.isInteger(blueprint.generation) ? blueprint.generation : 9;
    blueprint.includes = Array.isArray(blueprint.includes) ? blueprint.includes.map(Number) : [];
    blueprint.mechanics = Array.isArray(blueprint.mechanics) ? blueprint.mechanics : [];
    blueprint.componentRules = Array.isArray(blueprint.componentRules) ? blueprint.componentRules : [];
    const migratedMechanics = [];
    const componentRuleKeys = new Set(blueprint.componentRules.map(rule => rule.key));
    blueprint.mechanics = blueprint.mechanics.filter((reference, index) => {
      if (!resolveComponent(reference) || !componentEffectsByKey.has(componentSourceKey(reference))) {
        return true;
      }
      let ruleKey = `ai-mechanic-${index + 1}`;
      while (componentRuleKeys.has(ruleKey)) {
        ruleKey = `${ruleKey}-migrated`;
      }
      componentRuleKeys.add(ruleKey);
      migratedMechanics.push({
        key: ruleKey,
        prerequisiteHooks: [],
        hook: {
          abilityId: reference.abilityId,
          attrIndex: reference.attrIndex,
          attrType: reference.attrType,
        },
        chance: 100,
        conditionLogic: "all",
        conditions: [],
        effects: [clone(reference)],
      });
      return false;
    });
    blueprint.componentRules.push(...migratedMechanics);
    blueprint.rules = Array.isArray(blueprint.rules) ? blueprint.rules : [];
    blueprint.modifiers = Array.isArray(blueprint.modifiers) ? blueprint.modifiers : [];
    blueprint.flags = blueprint.flags && typeof blueprint.flags === "object" ? blueprint.flags : {};
    blueprint.componentRules.forEach((rule, index) => {
      rule.key ||= `component-${index + 1}`;
      rule.prerequisiteHooks ||= [];
      rule.conditionLogic ||= "all";
      rule.conditions ||= [];
      rule.effects ||= [];
      rule.conditions.forEach(condition => {
        if (condition.kind !== "ability" || condition.conditionIndex === null) {
          condition.conditionIndex = undefined;
        }
      });
      [...rule.prerequisiteHooks, rule.hook].forEach(source => cleanAiRuntimeSource(source, "hook"));
      rule.conditions.forEach(source => cleanAiRuntimeSource(source, "condition"));
      rule.effects.forEach(source => cleanAiRuntimeSource(source, "effect"));
    });
    blueprint.rules.forEach((rule, index) => {
      rule.key ||= `rule-${index + 1}`;
      rule.conditionLogic ||= "all";
      rule.conditions ||= [];
      rule.effects ||= [];
      rule.conditions.forEach(condition => {
        if (condition.filter) {
          condition.filter = cleanAiFilter(condition.filter);
        }
        Object.keys(condition).forEach(key => condition[key] == null && delete condition[key]);
      });
      rule.effects.forEach(effect => {
        Object.keys(effect).forEach(key => effect[key] == null && delete effect[key]);
      });
    });
    blueprint.modifiers.forEach(modifier => {
      if (modifier.filter) {
        modifier.filter = cleanAiFilter(modifier.filter);
      }
      Object.keys(modifier).forEach(key => modifier[key] == null && delete modifier[key]);
    });
    return blueprint;
  }

  function installAiBlueprint(result) {
    const blueprint = normalizeAiBlueprint(result.blueprint);
    const key = uniqueKey(blueprint.name);
    const allIds = new Set([...getAbilityCatalog().map(ability => ability.id), blueprint.id]);
    const errors = validateEntry(key, blueprint, allIds);
    if (errors.length > 0) {
      throw new Error(`Generated draft did not pass Ability Studio validation: ${errors.join("; ")}`);
    }
    state[key] = blueprint;
    selected = key;
    aiActivity("result", result.explanation || `Created ${blueprint.name}`);
    notify(true);
  }

  function handleAiEvent(event) {
    if (event.type === "status") {
      aiActivity("status", event.message);
    } else if (event.type === "reasoning") {
      aiActivity("reasoning", event.delta, true);
    } else if (event.type === "usage") {
      aiState.usage = event.usage;
      scheduleAiRefresh();
    } else if (event.type === "error") {
      aiState.error = event.message || "Ability generation failed";
      scheduleAiRefresh();
    } else if (event.type === "result") {
      installAiBlueprint(event);
    }
  }

  async function generateAiAbility() {
    const prompt = aiState.prompt.trim();
    if (prompt.length < 3 || aiState.running) {
      if (prompt.length < 3) {
        aiState.error = "Describe the ability first";
        refreshInspector();
      }
      return;
    }
    aiState.running = true;
    aiState.error = "";
    aiState.activity = [];
    aiState.usage = null;
    aiState.requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    aiAbortController = new AbortController();
    refreshInspector();
    try {
      const { componentCandidates, componentOptionSets } = aiComponentContext();
      const response = await aiRequest(
        "/generate",
        {
          requestId: aiState.requestId,
          prompt,
          primitiveCatalog,
          abilityIndex: aiAbilityContext(),
          componentCandidates,
          componentOptionSets,
          moveIndex: aiMoveContext(),
        },
        aiAbortController.signal,
      );
      if (!response.body) {
        throw new Error("The Ability Builder returned an empty response");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            handleAiEvent(JSON.parse(line));
          }
        }
      }
      if (buffer.trim()) {
        handleAiEvent(JSON.parse(buffer));
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        aiState.error = error.message || String(error);
      }
    } finally {
      aiState.running = false;
      aiAbortController = null;
      refreshInspector();
    }
  }

  async function cancelAiAbility() {
    if (!aiState.running) {
      return;
    }
    const requestId = aiState.requestId;
    aiAbortController?.abort();
    aiState.running = false;
    aiActivity("status", "Generation cancelled");
    await aiRequest("/cancel", { requestId }).catch(() => {});
    refreshInspector();
  }

  function aiUsageLabel() {
    const usage = aiState.usage;
    if (!usage || typeof usage !== "object") {
      return "";
    }
    const total = usage.totalTokens ?? usage.total_tokens ?? usage.total;
    return Number.isFinite(total) ? `${Number(total).toLocaleString()} tokens` : "Usage updated";
  }

  function renderAiAssistant() {
    const activity =
      aiState.activity.length > 0
        ? aiState.activity
            .map(item => `<li class="${esc(item.type)}"><span aria-hidden="true"></span><p>${esc(item.text)}</p></li>`)
            .join("")
        : '<li class="empty"><p>Describe an ability to assemble a draft from existing mechanics.</p></li>';
    return `<section class="as-ai as-panel" aria-label="Agent Ability Builder"><div class="as-ai-heading"><h3>Agent Ability Builder</h3></div><textarea rows="5" maxlength="4000" aria-label="Describe the ability to build" placeholder="Example: After landing a contact Fire move, burn the target; if it burns, raise the holder's Speed by 1." data-as-ai-prompt${aiState.running ? " disabled" : ""}>${esc(aiState.prompt)}</textarea><div class="as-ai-controls">${aiState.running ? '<button type="button" class="danger" data-as-action="ai-cancel">Stop</button>' : '<button type="button" class="primary" data-as-action="ai-generate">Build draft</button>'}</div><div class="as-ai-activity"><div><b>${aiState.running ? "BUILDING" : "ACTIVITY"}</b><span>${esc(aiUsageLabel())}</span></div><ol>${activity}</ol></div>${aiState.error ? `<p class="as-ai-error">${esc(aiState.error)}</p>` : ""}</section>`;
  }

  function nextId() {
    const used = new Set(visibleEntries().map(([, entry]) => entry.id));
    for (let id = primitiveCatalog.idRange[0]; id <= primitiveCatalog.idRange[1]; id++) {
      if (!used.has(id)) {
        return id;
      }
    }
    throw new Error("No Ability Studio ids remain");
  }

  function uniqueKey(name) {
    const root =
      String(name || "new-ability")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "new-ability";
    let key = root;
    let suffix = 2;
    while (Object.hasOwn(state, key)) {
      key = `${root.slice(0, 40 - String(suffix).length - 1)}-${suffix++}`;
    }
    return key;
  }

  function newRule(rules) {
    const used = new Set(rules.map(rule => rule.key));
    let index = 1;
    while (used.has(`rule-${index}`)) {
      index++;
    }
    return {
      key: `rule-${index}`,
      trigger: "after-attack",
      chance: 100,
      conditionLogic: "all",
      conditions: [{ kind: "move", filter: { damaging: true } }],
      effects: [{ kind: "stat-stage", target: "holder", stat: "ATK", stages: 1 }],
    };
  }

  function newAbility(name = "New Ability") {
    return {
      version: primitiveCatalog.schemaVersion,
      id: nextId(),
      name,
      description: "Describe the complete battle effect.",
      generation: 9,
      includes: [],
      mechanics: [],
      componentRules: [],
      rules: [],
      modifiers: [],
      flags: {},
    };
  }

  function defaultCondition(kind) {
    switch (kind) {
      case "holder-hp":
        return { kind, maxPercent: 50 };
      case "holder-status":
      case "other-status":
        return { kind, status: "NONE" };
      case "weather":
        return { kind, weather: "RAIN" };
      case "terrain":
        return { kind, terrain: "ELECTRIC" };
      default:
        return { kind: "move", filter: { damaging: true } };
    }
  }

  function triggerHasMove(trigger) {
    return !["on-entry", "after-ko", "end-turn"].includes(trigger);
  }

  function triggerHasOther(trigger) {
    return !["on-entry", "end-turn"].includes(trigger);
  }

  function defaultEffect(kind, trigger = "after-attack") {
    const otherTarget = triggerHasOther(trigger) ? "other" : "holder";
    switch (kind) {
      case "status":
        return { kind, target: otherTarget, status: "BURN" };
      case "heal-percent":
        return { kind, target: "holder", percent: 25 };
      case "cure-status":
        return { kind, target: "holder", status: "ANY" };
      case "set-weather":
        return { kind, weather: "RAIN" };
      case "set-terrain":
        return { kind, terrain: "ELECTRIC" };
      default:
        return { kind: "stat-stage", target: "holder", stat: "ATK", stages: 1 };
    }
  }

  function defaultModifier(kind) {
    switch (kind) {
      case "received-damage":
        return { kind, multiplier: 0.75, filter: { damaging: true } };
      case "stat-multiplier":
        return { kind, stat: "ATK", multiplier: 1.5 };
      case "priority":
        return { kind, amount: 1, filter: { damaging: true } };
      default:
        return { kind: "move-power", multiplier: 1.3, filter: { damaging: true } };
    }
  }

  function moveFilterHtml(filter, prefix) {
    const damaging = filter.damaging === undefined ? "" : String(filter.damaging);
    return `<div class="as-filter-grid">
      <label><span>Type</span><select aria-label="Move type" data-as-filter="type" ${prefix}>${selectOptions(primitiveCatalog.types, filter.type || "", true)}</select></label>
      <label><span>Category</span><select aria-label="Move category" data-as-filter="category" ${prefix}>${selectOptions(primitiveCatalog.categories, filter.category || "", true)}</select></label>
      <label><span>Move family</span><select aria-label="Move family" data-as-filter="flag" ${prefix}>${selectOptions(primitiveCatalog.moveFlags, filter.flag || "", true)}</select></label>
      <label><span>Damage</span><select aria-label="Damage class" data-as-filter="damaging" ${prefix}>${option("", damaging, "Any")}${option("true", damaging, "Damaging")}${option("false", damaging, "Status")}</select></label>
    </div>`;
  }

  function conditionHtml(condition, ruleIndex, conditionIndex) {
    const prefix = `data-as-rule="${ruleIndex}" data-as-condition="${conditionIndex}"`;
    let fields = "";
    if (condition.kind === "holder-hp") {
      fields = `<div class="as-inline-fields"><label><span>Min HP %</span><input type="number" min="0" max="100" value="${condition.minPercent ?? ""}" data-as-condition-field="minPercent" ${prefix}></label><label><span>Max HP %</span><input type="number" min="0" max="100" value="${condition.maxPercent ?? ""}" data-as-condition-field="maxPercent" ${prefix}></label></div>`;
    } else if (condition.kind === "holder-status" || condition.kind === "other-status") {
      fields = `<label><span>Status</span><select data-as-condition-field="status" ${prefix}>${option("NONE", condition.status, "No status")}${selectOptions(primitiveCatalog.statuses, condition.status)}</select></label>`;
    } else if (condition.kind === "weather") {
      fields = `<label><span>Weather</span><select data-as-condition-field="weather" ${prefix}>${selectOptions(primitiveCatalog.weathers, condition.weather)}</select></label>`;
    } else if (condition.kind === "terrain") {
      fields = `<label><span>Terrain</span><select data-as-condition-field="terrain" ${prefix}>${selectOptions(primitiveCatalog.terrains, condition.terrain)}</select></label>`;
    } else {
      fields = moveFilterHtml(condition.filter || {}, prefix);
    }
    return `<div class="as-condition-block"><select class="as-kind-select" data-as-condition-kind aria-label="Condition type" ${prefix}>${selectOptions(primitiveCatalog.conditionKinds, condition.kind)}</select>${fields}<button type="button" class="icon danger" title="Remove condition" aria-label="Remove condition" data-as-action="remove-condition" ${prefix}>×</button></div>`;
  }

  function effectHtml(effect, ruleIndex, effectIndex) {
    const prefix = `data-as-rule="${ruleIndex}" data-as-effect="${effectIndex}"`;
    let fields = "";
    if (effect.kind === "stat-stage") {
      fields = `<div class="as-inline-fields"><label><span>Target</span><select data-as-effect-field="target" ${prefix}>${selectOptions(primitiveCatalog.targets, effect.target)}</select></label><label><span>Stat</span><select data-as-effect-field="stat" ${prefix}>${selectOptions(primitiveCatalog.stats, effect.stat)}</select></label><label><span>Stages</span><input type="number" min="-6" max="6" value="${effect.stages}" data-as-effect-field="stages" ${prefix}></label></div>`;
    } else if (effect.kind === "status") {
      fields = `<div class="as-inline-fields"><label><span>Target</span><select data-as-effect-field="target" ${prefix}>${selectOptions(primitiveCatalog.targets, effect.target)}</select></label><label><span>Status</span><select data-as-effect-field="status" ${prefix}>${selectOptions(primitiveCatalog.statuses, effect.status)}</select></label></div>`;
    } else if (effect.kind === "heal-percent") {
      fields = `<div class="as-inline-fields"><label><span>Target</span><select data-as-effect-field="target" ${prefix}>${selectOptions(primitiveCatalog.targets, effect.target)}</select></label><label><span>Max HP %</span><input type="number" min="1" max="100" value="${effect.percent}" data-as-effect-field="percent" ${prefix}></label></div>`;
    } else if (effect.kind === "cure-status") {
      fields = `<div class="as-inline-fields"><label><span>Target</span><select data-as-effect-field="target" ${prefix}>${selectOptions(primitiveCatalog.targets, effect.target)}</select></label><label><span>Status</span><select data-as-effect-field="status" ${prefix}>${option("ANY", effect.status, "Any status")}${selectOptions(primitiveCatalog.statuses, effect.status)}</select></label></div>`;
    } else if (effect.kind === "set-weather") {
      fields = `<label><span>Weather</span><select data-as-effect-field="weather" ${prefix}>${selectOptions(primitiveCatalog.weathers, effect.weather)}</select></label>`;
    } else {
      fields = `<label><span>Terrain</span><select data-as-effect-field="terrain" ${prefix}>${selectOptions(primitiveCatalog.terrains, effect.terrain)}</select></label>`;
    }
    return `<div class="as-effect-block"><select class="as-kind-select" data-as-effect-kind aria-label="Effect type" ${prefix}>${selectOptions(primitiveCatalog.effectKinds, effect.kind)}</select>${fields}<div class="as-effect-actions"><button type="button" class="icon" title="Move effect up" aria-label="Move effect up" data-as-action="effect-up" ${prefix}>↑</button><button type="button" class="icon" title="Move effect down" aria-label="Move effect down" data-as-action="effect-down" ${prefix}>↓</button><button type="button" class="icon danger" title="Remove effect" aria-label="Remove effect" data-as-action="remove-effect" ${prefix}>×</button></div></div>`;
  }

  function conditionConnectorHtml(rule, kind, index) {
    const logic = rule.conditionLogic === "any" ? "OR" : "AND";
    return `<button type="button" class="as-connector" title="Switch between AND and OR" data-as-action="toggle-condition-logic" data-as-rule-kind="${kind}" data-as-rule="${index}">${logic}</button>`;
  }

  function simplePartSearchHtml(part, ruleIndex, placeholder) {
    const id = `as-simple-${part}-${ruleIndex}`;
    return `<div class="as-part-picker as-simple-search"><input id="${id}" type="search" role="combobox" aria-autocomplete="list" aria-controls="${id}-results" aria-expanded="false" aria-label="${esc(placeholder)}" autocomplete="off" placeholder="${esc(placeholder)}" data-as-action="open-simple-search" data-as-simple-search data-as-simple-part="${part}" data-as-rule="${ruleIndex}"><div id="${id}-results" class="as-part-results as-include-results" role="listbox" hidden></div></div>`;
  }

  function componentPartSearchHtml(part, ruleIndex, placeholder) {
    const id = `as-component-${part}-${ruleIndex}`;
    return `<div class="as-part-picker as-mechanic-search"><input id="${id}" type="search" role="combobox" aria-autocomplete="list" aria-controls="${id}-results" aria-expanded="false" aria-label="${esc(placeholder)}" autocomplete="off" placeholder="${esc(placeholder)}" data-as-action="open-mechanic-search" data-as-mechanic-search data-as-component-part="${part}" data-as-component-rule="${ruleIndex}"><div id="${id}-results" class="as-mechanic-results as-part-results as-include-results" role="listbox" hidden></div></div>`;
  }

  function emptyRuleHtml() {
    return `<article class="as-rule-card as-runtime-card as-component-card as-empty-rule-card" aria-label="New rule">
      <header><span class="as-rule-number" aria-hidden="true">1</span><span class="as-builder-label when">WHEN</span><div class="as-hook-control">${componentPartSearchHtml("new-hook", -1, "Search WHEN triggers…")}</div></header>
      <div class="as-builder-row"><span class="as-builder-label if">IF</span><div class="as-builder-control"><div class="as-part-picker"><input type="search" aria-label="Search IF conditions" placeholder="Choose WHEN first…" disabled></div></div></div>
      <div class="as-builder-row"><span class="as-builder-label chance">CHANCE</span><label class="as-chance"><input aria-label="Rule chance percent" type="number" value="100" disabled><b>%</b></label></div>
      <div class="as-builder-row as-effect-chain-row"><span class="as-builder-label do">DO</span><div class="as-builder-control as-effect-chain"><div class="as-part-picker"><input type="search" aria-label="Search DO or THEN effects" placeholder="Choose WHEN first…" disabled></div></div></div>
      <div class="as-builder-row as-effect-chain-row"><span class="as-builder-label then">THEN</span><div class="as-builder-control as-effect-chain"><div class="as-part-picker"><input type="search" aria-label="Search subsequent effects" placeholder="Choose WHEN first…" disabled></div></div></div>
    </article>`;
  }

  function ruleHtml(rule, index) {
    const conditions =
      rule.conditions.length > 0
        ? rule.conditions
            .map(
              (condition, conditionIndex) =>
                `${conditionIndex > 0 ? conditionConnectorHtml(rule, "simple", index) : ""}${conditionHtml(condition, index, conditionIndex)}`,
            )
            .join("")
        : '<span class="as-always">Always</span>';
    const firstEffect = rule.effects[0] ? effectHtml(rule.effects[0], index, 0) : "";
    const laterEffects = rule.effects
      .slice(1)
      .map(
        (effect, offset) =>
          `<div class="as-builder-row as-effect-chain-row"><span class="as-builder-label then">THEN</span><div class="as-builder-control as-effect-chain">${effectHtml(effect, index, offset + 1)}</div></div>`,
      )
      .join("");
    const effectSearch = simplePartSearchHtml(
      "effect",
      index,
      firstEffect ? "Search THEN effects…" : "Search DO effects…",
    );
    return `<article class="as-rule-card" aria-label="Rule ${index + 1}">
      <header><span class="as-rule-number" aria-hidden="true">${index + 1}</span><span class="as-builder-label when">WHEN</span><div class="as-hook-control"><strong>${esc(pretty(rule.trigger))}</strong>${simplePartSearchHtml("trigger", index, "Search triggers…")}</div><div class="as-rule-actions"><button type="button" class="icon" title="Move rule up" aria-label="Move rule up" data-as-action="rule-up" data-as-rule="${index}">↑</button><button type="button" class="icon" title="Move rule down" aria-label="Move rule down" data-as-action="rule-down" data-as-rule="${index}">↓</button><button type="button" class="icon danger" title="Delete rule" aria-label="Delete rule" data-as-action="remove-rule" data-as-rule="${index}">×</button></div></header>
      <div class="as-builder-row"><span class="as-builder-label if">IF</span><div class="as-builder-control as-condition-flow">${conditions}${simplePartSearchHtml("condition", index, "Search conditions…")}</div></div>
      <div class="as-builder-row"><span class="as-builder-label chance">CHANCE</span><label class="as-chance"><input aria-label="Rule ${index + 1} chance percent" type="number" min="1" max="100" value="${rule.chance}" data-as-rule-field="chance" data-as-rule="${index}"><b>%</b></label></div>
      <div class="as-builder-row as-effect-chain-row"><span class="as-builder-label do">DO</span><div class="as-builder-control as-effect-chain">${firstEffect || effectSearch}</div></div>
      ${laterEffects}${firstEffect ? `<div class="as-builder-row as-effect-chain-row"><span class="as-builder-label then">THEN</span><div class="as-builder-control as-effect-chain">${effectSearch}</div></div>` : ""}
    </article>`;
  }

  function includeRuleHtml(id, number) {
    return `<article class="as-rule-card as-reference-card" aria-label="Included ability ${esc(abilityName(id))}"><header><span class="as-rule-number" aria-hidden="true">${number}</span><span class="as-builder-label include">INCLUDE EXISTING ABILITY</span><button type="button" class="icon danger as-reference-remove" title="Remove included ability" aria-label="Remove ${esc(abilityName(id))}" data-as-action="remove-include" data-as-id="${id}">×</button></header><div class="as-reference-value"><b>${esc(abilityName(id))}</b><span>#${id}</span></div></article>`;
  }

  function componentPrimitiveConditionHtml(condition, ruleIndex, conditionIndex) {
    const prefix = `data-as-component-rule="${ruleIndex}" data-as-component-condition="${conditionIndex}"`;
    let fields = "";
    if (condition.kind === "holder-hp") {
      fields = `<div class="as-inline-fields"><label><span>Min HP %</span><input type="number" min="0" max="100" value="${condition.minPercent ?? ""}" data-as-component-condition-field="minPercent" ${prefix}></label><label><span>Max HP %</span><input type="number" min="0" max="100" value="${condition.maxPercent ?? ""}" data-as-component-condition-field="maxPercent" ${prefix}></label></div>`;
    } else if (condition.kind === "holder-status" || condition.kind === "other-status") {
      fields = `<label><span>Status</span><select data-as-component-condition-field="status" ${prefix}>${option("NONE", condition.status, "No status")}${selectOptions(primitiveCatalog.statuses, condition.status)}</select></label>`;
    } else if (condition.kind === "weather") {
      fields = `<label><span>Weather</span><select data-as-component-condition-field="weather" ${prefix}>${selectOptions(primitiveCatalog.weathers, condition.weather)}</select></label>`;
    } else if (condition.kind === "terrain") {
      fields = `<label><span>Terrain</span><select data-as-component-condition-field="terrain" ${prefix}>${selectOptions(primitiveCatalog.terrains, condition.terrain)}</select></label>`;
    } else {
      fields = moveFilterHtml(condition.filter || {}, prefix);
    }
    return `<div class="as-condition-block as-runtime-condition" draggable="true" data-as-drag-part="condition" data-as-drag-rule="${ruleIndex}" data-as-drag-index="${conditionIndex}" data-as-drop-part="condition" data-as-drop-rule="${ruleIndex}" data-as-drop-index="${conditionIndex}"><span class="as-drag-grip" aria-hidden="true">⠿</span><select class="as-kind-select" data-as-component-condition-kind aria-label="Condition type" ${prefix}>${selectOptions(primitiveCatalog.conditionKinds, condition.kind)}</select>${fields}<button type="button" class="icon danger" title="Remove condition" aria-label="Remove ${esc(pretty(condition.kind))}" data-as-action="remove-component-condition" ${prefix}>×</button></div>`;
  }

  function componentPrimitiveEffectHtml(effect, ruleIndex, effectIndex) {
    const prefix = `data-as-component-rule="${ruleIndex}" data-as-component-effect="${effectIndex}"`;
    let fields = "";
    if (effect.kind === "stat-stage") {
      fields = `<div class="as-inline-fields"><label><span>Target</span><select data-as-component-effect-field="target" ${prefix}>${selectOptions(primitiveCatalog.targets, effect.target)}</select></label><label><span>Stat</span><select data-as-component-effect-field="stat" ${prefix}>${selectOptions(primitiveCatalog.stats, effect.stat)}</select></label><label><span>Stages</span><input type="number" min="-6" max="6" value="${effect.stages}" data-as-component-effect-field="stages" ${prefix}></label></div>`;
    } else if (effect.kind === "status") {
      fields = `<div class="as-inline-fields"><label><span>Target</span><select data-as-component-effect-field="target" ${prefix}>${selectOptions(primitiveCatalog.targets, effect.target)}</select></label><label><span>Status</span><select data-as-component-effect-field="status" ${prefix}>${selectOptions(primitiveCatalog.statuses, effect.status)}</select></label></div>`;
    } else if (effect.kind === "heal-percent") {
      fields = `<div class="as-inline-fields"><label><span>Target</span><select data-as-component-effect-field="target" ${prefix}>${selectOptions(primitiveCatalog.targets, effect.target)}</select></label><label><span>Max HP %</span><input type="number" min="1" max="100" value="${effect.percent}" data-as-component-effect-field="percent" ${prefix}></label></div>`;
    } else if (effect.kind === "cure-status") {
      fields = `<div class="as-inline-fields"><label><span>Target</span><select data-as-component-effect-field="target" ${prefix}>${selectOptions(primitiveCatalog.targets, effect.target)}</select></label><label><span>Status</span><select data-as-component-effect-field="status" ${prefix}>${option("ANY", effect.status, "Any status")}${selectOptions(primitiveCatalog.statuses, effect.status)}</select></label></div>`;
    } else if (effect.kind === "set-weather") {
      fields = `<label><span>Weather</span><select data-as-component-effect-field="weather" ${prefix}>${selectOptions(primitiveCatalog.weathers, effect.weather)}</select></label>`;
    } else {
      fields = `<label><span>Terrain</span><select data-as-component-effect-field="terrain" ${prefix}>${selectOptions(primitiveCatalog.terrains, effect.terrain)}</select></label>`;
    }
    return `<div class="as-chain-item" draggable="true" data-as-drag-part="effect" data-as-drag-rule="${ruleIndex}" data-as-drag-index="${effectIndex}" data-as-drop-part="effect" data-as-drop-rule="${ruleIndex}" data-as-drop-index="${effectIndex}"><span class="as-drag-grip" aria-hidden="true">⠿</span><div class="as-effect-block"><select class="as-kind-select" data-as-component-effect-kind aria-label="Effect type" ${prefix}>${selectOptions(primitiveCatalog.effectKinds, effect.kind)}</select>${fields}</div><button type="button" class="icon danger as-component-part-remove" title="Remove effect" aria-label="Remove ${esc(pretty(effect.kind))}" data-as-action="remove-component-effect" ${prefix}>×</button></div>`;
  }

  function componentRuleHtml(rule, index, number) {
    const sourceRule = resolveComponent(rule.hook);
    const trigger = sourceRule?.hook.label || rule.hook.attrType;
    const prerequisiteHooks = rule.prerequisiteHooks || [];
    const triggerStack = [...prerequisiteHooks, rule.hook]
      .map((hook, hookIndex) => {
        const hookRule = resolveComponent(hook);
        const label = hookIndex === prerequisiteHooks.length ? trigger : hookRule?.hook.label || hook.attrType;
        const remove =
          hookIndex < prerequisiteHooks.length
            ? `<button type="button" class="icon danger" title="Remove chained trigger" aria-label="Remove ${esc(label)}" data-as-action="remove-prerequisite-hook" data-as-component-rule="${index}" data-as-hook="${hookIndex}">×</button>`
            : '<span class="as-terminal-hook">RUN</span>';
        return `${hookIndex > 0 ? '<span class="as-when-connector">THEN</span>' : ""}<div class="as-when-item" draggable="true" data-as-drag-part="hook" data-as-drag-rule="${index}" data-as-drag-index="${hookIndex}" data-as-drop-part="hook" data-as-drop-rule="${index}" data-as-drop-index="${hookIndex}"><span class="as-drag-grip" aria-hidden="true">⠿</span><strong class="as-runtime-trigger">${esc(label)}</strong>${remove}</div>`;
      })
      .join("");
    const conditions =
      rule.conditions.length > 0
        ? rule.conditions
            .map((condition, conditionIndex) => {
              if (!isRuntimeComponent(condition)) {
                return `${conditionIndex > 0 ? conditionConnectorHtml(rule, "component", index) : ""}${componentPrimitiveConditionHtml(condition, index, conditionIndex)}`;
              }
              const definition = componentConditionsByKey.get(componentConditionKey(condition));
              const label = definition?.label || `${condition.attrType} condition`;
              return `${conditionIndex > 0 ? conditionConnectorHtml(rule, "component", index) : ""}<div class="as-runtime-condition as-runtime-configurable" draggable="true" data-as-drag-part="condition" data-as-drag-rule="${index}" data-as-drag-index="${conditionIndex}" data-as-drop-part="condition" data-as-drop-rule="${index}" data-as-drop-index="${conditionIndex}"><span class="as-drag-grip" aria-hidden="true">⠿</span><div class="as-runtime-component-copy"><b>${esc(label)}</b><small>${esc(condition.kind)}</small>${runtimeParametersHtml(condition, "condition", index, conditionIndex)}</div><button type="button" class="icon danger" title="Remove condition" aria-label="Remove ${esc(label)}" data-as-action="remove-component-condition" data-as-component-rule="${index}" data-as-component-condition="${conditionIndex}">×</button></div>`;
            })
            .join("")
        : '<span class="as-always">Always</span>';
    const effectHtml = (effect, effectIndex) => {
      if (!isRuntimeComponent(effect)) {
        return componentPrimitiveEffectHtml(effect, index, effectIndex);
      }
      const definition = componentEffectsByKey.get(componentSourceKey(effect));
      const label = definition?.label || effect.attrType;
      return `<div class="as-chain-item" draggable="true" data-as-drag-part="effect" data-as-drag-rule="${index}" data-as-drag-index="${effectIndex}" data-as-drop-part="effect" data-as-drop-rule="${index}" data-as-drop-index="${effectIndex}"><span class="as-drag-grip" aria-hidden="true">⠿</span><div class="as-runtime-effect as-runtime-configurable"><div class="as-runtime-component-copy"><b>${esc(label)}</b><small>${esc(effect.attrType)}</small>${runtimeParametersHtml(effect, "effect", index, effectIndex)}</div></div><button type="button" class="icon danger as-component-part-remove" title="Remove effect" aria-label="Remove ${esc(label)}" data-as-action="remove-component-effect" data-as-component-rule="${index}" data-as-component-effect="${effectIndex}">×</button></div>`;
    };
    const firstEffect = rule.effects[0] ? effectHtml(rule.effects[0], 0) : "";
    const laterEffects = rule.effects
      .slice(1)
      .map(
        (effect, offset) =>
          `<div class="as-builder-row as-effect-chain-row"><span class="as-builder-label then">THEN</span><div class="as-effect-chain" data-as-drop-part="effect" data-as-drop-rule="${index}" data-as-drop-index="${offset + 1}">${effectHtml(effect, offset + 1)}</div></div>`,
      )
      .join("");
    const effectSearch = componentPartSearchHtml(
      "effect",
      index,
      firstEffect ? "Search THEN effects…" : "Search DO effects…",
    );
    return `<article class="as-rule-card as-runtime-card as-component-card" aria-label="Rule ${index + 1}" data-as-drop-part="rule" data-as-drop-rule="${index}"><header><span class="as-rule-number as-rule-drag" draggable="true" data-as-drag-part="rule" data-as-drag-rule="${index}" aria-label="Move rule">${number}</span><span class="as-builder-label when">WHEN</span><div class="as-hook-control as-when-stack" data-as-drop-part="hook" data-as-drop-rule="${index}">${triggerStack}${componentPartSearchHtml("hook", index, "Add WHEN to this chain…")}</div><button type="button" class="icon danger as-reference-remove" title="Remove rule" aria-label="Remove rule" data-as-action="remove-component-rule" data-as-component-rule="${index}">×</button></header><div class="as-builder-row"><span class="as-builder-label if">IF</span><div class="as-runtime-conditions" data-as-drop-part="condition" data-as-drop-rule="${index}" data-as-drop-index="${rule.conditions.length}">${conditions}${componentPartSearchHtml("condition", index, "Search IF conditions…")}</div></div><div class="as-builder-row"><span class="as-builder-label chance">CHANCE</span><label class="as-chance"><input aria-label="Rule ${index + 1} chance percent" type="number" min="1" max="100" value="${rule.chance}" data-as-component-rule-field="chance" data-as-component-rule="${index}"><b>%</b></label></div><div class="as-builder-row as-effect-chain-row"><span class="as-builder-label do">DO</span><div class="as-effect-chain" data-as-drop-part="effect" data-as-drop-rule="${index}" data-as-drop-index="0">${firstEffect || effectSearch}</div></div>${laterEffects}${firstEffect ? `<div class="as-builder-row as-effect-chain-row"><span class="as-builder-label then">THEN</span><div class="as-effect-chain" data-as-drop-part="effect" data-as-drop-rule="${index}" data-as-drop-index="${rule.effects.length}">${effectSearch}</div></div>` : ""}<div class="as-rule-fork"><button type="button" data-as-action="fork-component-rule" data-as-component-rule="${index}">+ Fork outcome</button></div></article>`;
  }

  function mechanicRuleHtml(reference, index, number) {
    const mechanic = resolveMechanic(reference);
    const component = resolveComponent(reference);
    const trigger = component?.hook.label || mechanic?.trigger || "Runtime hook";
    const label = component?.label || mechanic?.label || reference.attrType;
    const conditions = component?.conditions ?? [];
    const conditionHtml =
      conditions.length > 0
        ? conditions
            .map(
              condition =>
                `<span class="as-runtime-condition"><b>${esc(condition.label)}</b><small>${esc(condition.kind)}</small></span>`,
            )
            .join("")
        : '<span class="as-always">Always</span>';
    return `<article class="as-rule-card as-runtime-card" aria-label="${esc(label)} from ${esc(abilityName(reference.abilityId))}"><header><span class="as-rule-number" aria-hidden="true">${number}</span><span class="as-builder-label when">WHEN</span><strong class="as-runtime-trigger">${esc(trigger)}</strong><button type="button" class="icon danger as-reference-remove" title="Remove runtime mechanic" aria-label="Remove ${esc(label)}" data-as-action="remove-mechanic" data-as-mechanic="${index}">×</button></header><div class="as-builder-row"><span class="as-builder-label if">IF</span><div class="as-runtime-conditions">${conditionHtml}</div></div><div class="as-builder-row"><span class="as-builder-label include">FROM</span><div class="as-runtime-source"><b>${esc(abilityName(reference.abilityId))}</b><span>#${reference.abilityId}</span></div></div><div class="as-builder-row"><span class="as-builder-label do">DO</span><div class="as-runtime-effect"><b>${esc(label)}</b><small>${esc(reference.attrType)}${conditions.length > 0 ? " · GATED" : ""}</small></div></div></article>`;
  }

  function modifierHtml(modifier, index, number) {
    const prefix = `data-as-modifier="${index}"`;
    let fields = "";
    if (modifier.kind === "stat-multiplier") {
      fields = `<div class="as-inline-fields"><label><span>Stat</span><select data-as-modifier-field="stat" ${prefix}>${selectOptions(primitiveCatalog.statMultiplierStats, modifier.stat)}</select></label><label><span>Multiplier</span><input type="number" min="0.1" max="4" step="0.05" value="${modifier.multiplier}" data-as-modifier-field="multiplier" ${prefix}></label></div>`;
    } else {
      const valueField = modifier.kind === "priority" ? "amount" : "multiplier";
      const value = modifier[valueField];
      fields = `<label><span>${modifier.kind === "priority" ? "Priority stages" : "Multiplier"}</span><input type="number" ${modifier.kind === "priority" ? 'min="-7" max="7" step="1"' : 'min="0.1" max="4" step="0.05"'} value="${value}" data-as-modifier-field="${valueField}" ${prefix}></label>${moveFilterHtml(modifier.filter || {}, prefix)}`;
    }
    return `<article class="as-rule-card as-modifier" aria-label="Passive modifier ${index + 1}"><header><span class="as-rule-number" aria-hidden="true">${number}</span><span class="as-builder-label always">ALWAYS</span><select class="as-trigger-select" data-as-modifier-kind aria-label="Modifier kind" ${prefix}>${selectOptions(primitiveCatalog.modifierKinds, modifier.kind)}</select><button type="button" class="icon danger as-reference-remove" title="Remove modifier" aria-label="Remove modifier" data-as-action="remove-modifier" ${prefix}>×</button></header><div class="as-modifier-body">${fields}</div></article>`;
  }

  function moveFilterSummary(filter) {
    const parts = [];
    if (filter.damaging === true) {
      parts.push("is damaging");
    }
    if (filter.damaging === false) {
      parts.push("is a status move");
    }
    if (filter.type) {
      parts.push(`is ${pretty(filter.type)}-type`);
    }
    if (filter.category) {
      parts.push(`is ${pretty(filter.category)}`);
    }
    if (filter.flag) {
      parts.push(`belongs to ${pretty(filter.flag)}`);
    }
    return parts.length > 0 ? `the move ${parts.join(" and ")}` : "any move is used";
  }

  function conditionSummary(condition) {
    if (condition.kind === "move") {
      return moveFilterSummary(condition.filter || {});
    }
    if (condition.kind === "holder-hp") {
      if (condition.minPercent !== undefined && condition.maxPercent !== undefined) {
        return `the holder has ${condition.minPercent}-${condition.maxPercent}% HP`;
      }
      if (condition.minPercent !== undefined) {
        return `the holder has at least ${condition.minPercent}% HP`;
      }
      return `the holder has at most ${condition.maxPercent}% HP`;
    }
    if (condition.kind === "holder-status") {
      return `the holder's status is ${pretty(condition.status)}`;
    }
    if (condition.kind === "other-status") {
      return `the other Pokemon's status is ${pretty(condition.status)}`;
    }
    if (condition.kind === "weather") {
      return `the weather is ${pretty(condition.weather)}`;
    }
    return `the terrain is ${pretty(condition.terrain)}`;
  }

  function effectTarget(target) {
    return {
      holder: "the holder",
      other: "the other Pokemon",
      "holder-side": "the holder and its allies",
      "opposing-side": "all opposing Pokemon",
    }[target];
  }

  function effectSummary(effect) {
    if (effect.kind === "stat-stage") {
      return `${effect.stages > 0 ? "raise" : "lower"} ${effectTarget(effect.target)}'s ${pretty(effect.stat)} by ${Math.abs(effect.stages)} stage${Math.abs(effect.stages) === 1 ? "" : "s"}`;
    }
    if (effect.kind === "status") {
      return `inflict ${pretty(effect.status)} on ${effectTarget(effect.target)}`;
    }
    if (effect.kind === "heal-percent") {
      return `heal ${effectTarget(effect.target)} for ${effect.percent}% of maximum HP`;
    }
    if (effect.kind === "cure-status") {
      return `cure ${pretty(effect.status)} from ${effectTarget(effect.target)}`;
    }
    if (effect.kind === "set-weather") {
      return `set the weather to ${pretty(effect.weather)}`;
    }
    return `set the terrain to ${pretty(effect.terrain)}`;
  }

  function ruleSummary(rule) {
    const trigger = {
      "on-entry": "When this Pokemon enters battle",
      "after-attack": "After this Pokemon lands a move",
      "after-hit": "After this Pokemon is hit",
      "after-ko": "After this Pokemon knocks out a foe",
      "end-turn": "At the end of each turn",
      "after-faint": "After this Pokemon faints",
    }[rule.trigger];
    const joiner = rule.conditionLogic === "any" ? " or " : " and ";
    const conditions = rule.conditions.length > 0 ? `, if ${rule.conditions.map(conditionSummary).join(joiner)}` : "";
    const chance = rule.chance < 100 ? `, it has a ${rule.chance}% chance to ` : ", it will ";
    return `${trigger}${conditions}${chance}${rule.effects.map(effectSummary).join(", then ")}.`;
  }

  function modifierSummary(modifier) {
    if (modifier.kind === "stat-multiplier") {
      return `${pretty(modifier.stat)} is multiplied by ${modifier.multiplier}.`;
    }
    const filter = modifierFilterSummary(modifier.filter || {});
    const subject = `${filter[0].toUpperCase()}${filter.slice(1)}`;
    if (modifier.kind === "priority") {
      return `${subject} receive ${modifier.amount > 0 ? "+" : ""}${modifier.amount} priority.`;
    }
    if (modifier.kind === "move-power") {
      return `${subject} have their power multiplied by ${modifier.multiplier}.`;
    }
    return `Damage this Pokemon takes from ${filter[0].toLowerCase()}${filter.slice(1)} is multiplied by ${modifier.multiplier}.`;
  }

  function modifierFilterSummary(filter) {
    const parts = [];
    if (filter.damaging === true) {
      parts.push("damaging");
    } else if (filter.damaging === false) {
      parts.push("status");
    }
    if (filter.type) {
      parts.push(`${pretty(filter.type)}-type`);
    }
    if (filter.category) {
      parts.push(pretty(filter.category));
    }
    const subject = parts.length > 0 ? `${parts.join(" ")} moves` : "All moves";
    return filter.flag ? `${subject} in the ${pretty(filter.flag)} family` : subject;
  }

  function summary(entry) {
    return [
      ...entry.rules.map(ruleSummary),
      ...entry.componentRules.map(rule => {
        const source = resolveComponent(rule.hook);
        const prerequisiteText = (rule.prerequisiteHooks || [])
          .map(hook => resolveComponent(hook)?.hook.label || hook.attrType)
          .join(", then ");
        const joiner = rule.conditionLogic === "any" ? " or " : " and ";
        const conditionText =
          rule.conditions.length > 0
            ? rule.conditions
                .map(condition =>
                  isRuntimeComponent(condition)
                    ? componentConditionsByKey.get(componentConditionKey(condition))?.label || condition.attrType
                    : conditionSummary(condition),
                )
                .join(joiner)
            : "always";
        const effectText = rule.effects
          .map(effect =>
            isRuntimeComponent(effect)
              ? componentEffectsByKey.get(componentSourceKey(effect))?.label || effect.attrType
              : effectSummary(effect),
          )
          .join(", then ");
        const triggerText = [prerequisiteText, source?.hook.label || rule.hook.attrType]
          .filter(Boolean)
          .join(", then ");
        return `${triggerText}, if ${conditionText}: ${effectText}.`;
      }),
      ...entry.modifiers.map(modifierSummary),
      ...entry.mechanics.map(reference => {
        const mechanic = resolveMechanic(reference);
        return mechanic
          ? `${mechanic.trigger}: ${mechanic.label} from ${abilityName(reference.abilityId)}.`
          : `Runtime mechanic from ${abilityName(reference.abilityId)}.`;
      }),
      ...entry.includes.map(id => `Additionally, this Pokemon has every effect of ${abilityName(id)}.`),
    ];
  }

  function abilityName(id) {
    return getAbilityCatalog().find(ability => ability.id === Number(id))?.name || `Ability #${id}`;
  }

  function resolveMechanic(reference) {
    return mechanicsByAbility
      .get(Number(reference.abilityId))
      ?.mechanics.find(
        mechanic => mechanic.index === Number(reference.attrIndex) && mechanic.type === reference.attrType,
      );
  }

  function componentSourceKey(source) {
    if (!source || !Number.isInteger(Number(source.abilityId))) {
      return `primitive:${JSON.stringify(source)}`;
    }
    return `${source.abilityId}:${source.attrIndex}:${source.attrType}`;
  }

  function componentInstanceKey(source) {
    const overrides = Object.entries(source?.parameterOverrides || {}).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `${componentSourceKey(source)}:${JSON.stringify(overrides)}`;
  }

  function componentConditionKey(reference) {
    return `${componentSourceKey(reference)}:${reference.kind}:${reference.conditionIndex ?? ""}`;
  }

  function runtimeParameters(reference, part) {
    const rule = resolveComponent(reference);
    if (!rule) {
      return [];
    }
    if (part === "effect") {
      return componentEffectsByKey.get(componentSourceKey(reference))?.parameters || rule.parameters || [];
    }
    return rule.parameters || [];
  }

  function runtimeParameter(reference, part, path) {
    return runtimeParameters(reference, part).find(parameter => parameter.path === path || parameter.key === path);
  }

  function parameterValue(reference, parameter) {
    const path = parameter.path || parameter.key;
    return Object.hasOwn(reference.parameterOverrides || {}, path)
      ? reference.parameterOverrides[path]
      : parameter.rawValue;
  }

  function parameterOptionValue(value) {
    return `${typeof value === "number" ? "n" : "s"}:${value}`;
  }

  function parseParameterOption(value) {
    if (value.startsWith("n:")) {
      return Number(value.slice(2));
    }
    return value.slice(2);
  }

  function moveLabel(id) {
    const move = movesById.get(Number(id));
    return move ? `${move.name} #${move.id}` : Number.isInteger(Number(id)) ? `Move #${id}` : "";
  }

  function parseMove(value) {
    const normalized = String(value || "").trim();
    const explicitId = normalized.match(/#(\d+)$/)?.[1] || (/^\d+$/.test(normalized) ? normalized : "");
    if (explicitId && movesById.has(Number(explicitId))) {
      return Number(explicitId);
    }
    return movesByName.get(normalized.toLowerCase())?.id;
  }

  function abilityLabel(id) {
    const ability = componentsByAbility.get(Number(id));
    return ability ? `${ability.name} #${ability.id}` : Number.isInteger(Number(id)) ? `Ability #${id}` : "";
  }

  function parseAbility(value) {
    const normalized = String(value || "").trim();
    const explicitId = normalized.match(/#(\d+)$/)?.[1] || (/^\d+$/.test(normalized) ? normalized : "");
    if (explicitId && componentsByAbility.has(Number(explicitId))) {
      return Number(explicitId);
    }
    return componentCatalog.find(ability => ability.name.toLowerCase() === normalized.toLowerCase())?.id;
  }

  function runtimeMoveSearchHtml(value, parameter, prefix, part, ruleIndex, itemIndex) {
    const id = `as-move-${part}-${ruleIndex}-${itemIndex}-${encodeURIComponent(parameter.path || parameter.key)}`;
    return `<span class="as-runtime-search"><input id="${id}" type="search" role="combobox" aria-autocomplete="list" aria-controls="${id}-results" aria-expanded="false" aria-label="${esc(parameter.label)}" autocomplete="off" value="${esc(value)}" placeholder="Search a move..." data-as-action="open-move-search" data-as-move-search ${prefix}><span id="${id}-results" class="as-include-results as-runtime-move-results" role="listbox" hidden></span></span>`;
  }

  function renderRuntimeMoveSearch(input) {
    closeOtherSearches(input);
    const results = document.getElementById(input.getAttribute("aria-controls"));
    if (!results) {
      return;
    }
    const text = input.dataset.asRuntimeControl === "move-list" ? input.value.split(";").at(-1) : input.value;
    const query = text
      .trim()
      .toLowerCase()
      .replace(/#(?=\d)/g, "");
    const matches = moveCatalog.filter(move => searchMatches(`${move.name} ${move.id}`.toLowerCase(), query));
    results.innerHTML =
      matches.length > 0
        ? matches
            .map(
              move =>
                `<button type="button" role="option" data-as-action="choose-runtime-move" data-as-input="${input.id}" data-as-id="${move.id}"><b>${esc(move.name)}</b><span>#${move.id}</span><small>${esc([move.type, move.category, move.power > 0 ? `${move.power} BP` : ""].filter(Boolean).join(" / "))}</small></button>`,
            )
            .join("")
        : '<span class="as-include-empty">No matching moves</span>';
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openBelow = below >= 240 || below >= above;
    const height = Math.max(40, Math.min(340, openBelow ? below : above));
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
    Object.assign(results.style, {
      width: `${width}px`,
      maxHeight: `${height}px`,
      left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
      top: openBelow ? `${rect.bottom + 4}px` : "auto",
      bottom: openBelow ? "auto" : `${window.innerHeight - rect.top + 4}px`,
    });
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function closeRuntimeMoveSearch() {
    document.querySelectorAll("[data-as-move-search]").forEach(input => {
      input.setAttribute("aria-expanded", "false");
      const results = document.getElementById(input.getAttribute("aria-controls"));
      if (results) {
        results.hidden = true;
      }
    });
  }

  function handleKeyDown(event) {
    const input = event.target.closest(".as-runtime-search")?.querySelector("[data-as-move-search]");
    if (!input) {
      return false;
    }
    const results = document.getElementById(input.getAttribute("aria-controls"));
    if (event.key === "Escape") {
      event.preventDefault();
      closeRuntimeMoveSearch();
      input.focus();
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.hidden) {
        renderRuntimeMoveSearch(input);
      }
      const choices = [...results.querySelectorAll('[role="option"]')];
      const index = choices.indexOf(event.target);
      const next =
        event.key === "ArrowDown"
          ? Math.min(index + 1, choices.length - 1)
          : index <= 0
            ? choices.length - 1
            : index - 1;
      choices[next]?.focus();
      return true;
    }
    if (event.key === "Enter" && event.target === input && !results.hidden) {
      event.preventDefault();
      results.querySelector('[role="option"]')?.click();
      return true;
    }
    return false;
  }

  function runtimeAbilityDatalistHtml() {
    return `<datalist id="as-runtime-abilities">${componentCatalog
      .map(ability => `<option value="${esc(`${ability.name} #${ability.id}`)}"></option>`)
      .join("")}</datalist>`;
  }

  function runtimeParameterControl(reference, parameter, part, ruleIndex, itemIndex) {
    if (!parameter.editable || parameter.control === "fixed") {
      return "";
    }
    const path = parameter.path || parameter.key;
    const value = parameterValue(reference, parameter);
    const overridden = Object.hasOwn(reference.parameterOverrides || {}, path);
    const prefix = `data-as-runtime-parameter="${esc(path)}" data-as-runtime-part="${part}" data-as-component-rule="${ruleIndex}" data-as-runtime-index="${itemIndex}" data-as-runtime-control="${esc(parameter.control)}"`;
    const sourceValue = parameter.rawValue === undefined ? "default" : parameter.value;
    let control = "";
    if (parameter.control === "ability") {
      control = `<input type="search" list="as-runtime-abilities" value="${esc(value == null ? "" : abilityLabel(value))}" placeholder="Search an ability…" ${prefix}>`;
    } else if (parameter.control === "move") {
      control = runtimeMoveSearchHtml(
        value == null ? "" : moveLabel(value),
        parameter,
        prefix,
        part,
        ruleIndex,
        itemIndex,
      );
    } else if (parameter.control === "move-list") {
      const moveValues = Array.isArray(value) ? value.map(moveLabel).join("; ") : "";
      control = runtimeMoveSearchHtml(moveValues, parameter, prefix, part, ruleIndex, itemIndex);
    } else if (parameter.control === "number" || parameter.control === "number-list") {
      const numberValue = Array.isArray(value) ? value.join(", ") : (value ?? "");
      const limits =
        parameter.control === "number"
          ? `type="number"${parameter.min === undefined ? "" : ` min="${parameter.min}"`}${parameter.max === undefined ? "" : ` max="${parameter.max}"`}${parameter.step === undefined ? "" : ` step="${parameter.step}"`}`
          : 'type="text"';
      control = `<input ${limits} value="${esc(numberValue)}" placeholder="${esc(parameter.optional ? "None / move default" : sourceValue)}" ${prefix}>`;
    } else if (parameter.control === "boolean") {
      control = `<select ${prefix}><option value="__source__"${overridden ? "" : " selected"}>Source: ${esc(sourceValue)}</option><option value="true"${overridden && value === true ? " selected" : ""}>Yes</option><option value="false"${overridden && value === false ? " selected" : ""}>No</option></select>`;
    } else if (parameter.control === "select") {
      const choices = (parameter.options || [])
        .map(choice => {
          const token = parameterOptionValue(choice.value);
          return `<option value="${esc(token)}"${overridden && value === choice.value ? " selected" : ""}>${esc(choice.label)}</option>`;
        })
        .join("");
      control = `<select ${prefix}><option value="__source__"${overridden ? "" : " selected"}>Source: ${esc(sourceValue)}</option>${parameter.optional ? `<option value="__none__"${overridden && value === null ? " selected" : ""}>None</option>` : ""}${choices}</select>`;
    } else if (parameter.control === "multi-select") {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      const choices = (parameter.options || [])
        .map(
          choice =>
            `<option value="${esc(parameterOptionValue(choice.value))}"${selected.has(String(choice.value)) ? " selected" : ""}>${esc(choice.label)}</option>`,
        )
        .join("");
      control = `<select multiple size="3" ${prefix}>${choices}</select>`;
    } else if (parameter.control === "text") {
      control = `<input type="text" value="${esc(value ?? "")}" ${prefix}>`;
    }
    return `<label class="as-runtime-parameter"><span>${esc(parameter.label)}</span><span class="as-runtime-parameter-control">${control}${overridden ? `<button type="button" class="icon" title="Restore source value" aria-label="Restore source value for ${esc(parameter.label)}" data-as-action="reset-runtime-parameter" ${prefix}>↺</button>` : ""}</span></label>`;
  }

  function runtimeParametersHtml(reference, part, ruleIndex, itemIndex) {
    const controls = runtimeParameters(reference, part)
      .map(parameter => runtimeParameterControl(reference, parameter, part, ruleIndex, itemIndex))
      .filter(Boolean)
      .join("");
    return controls ? `<div class="as-runtime-parameters">${controls}</div>` : "";
  }

  function resolveComponent(reference) {
    if (!reference || !Number.isInteger(Number(reference.abilityId))) {
      return;
    }
    return componentsBySource.get(componentSourceKey(reference));
  }

  function runtimeHookSupports(targetHook, sourceHook) {
    if (!targetHook || !sourceHook) {
      return false;
    }
    const available = new Set(targetHook.context || []);
    return (sourceHook.context || []).every(value => available.has(value));
  }

  function runtimeEffectSupports(targetHook, sourceHook) {
    if (!targetHook || !sourceHook) {
      return false;
    }
    const available = new Set(targetHook.context || []);
    return (sourceHook.effectContext || sourceHook.context || []).every(value => available.has(value));
  }

  function componentEffectSupports(targetRule, effectSource) {
    const targetHook = resolveComponent(targetRule?.hook)?.hook;
    const sourceRule = resolveComponent(effectSource);
    const effect = componentEffectsByKey.get(componentSourceKey(effectSource));
    return !!targetHook && !!sourceRule && !!effect;
  }

  function isRuntimeComponent(value) {
    return !!value && Number.isInteger(Number(value.abilityId));
  }

  function nextComponentRuleKey(entry) {
    const used = new Set(entry.componentRules.map(rule => rule.key));
    let index = 1;
    while (used.has(`component-${index}`)) {
      index++;
    }
    return `component-${index}`;
  }

  function componentRuleFromCatalog(entry, rule) {
    return {
      key: nextComponentRuleKey(entry),
      prerequisiteHooks: [],
      hook: clone(rule.hook.source),
      chance: 100,
      conditionLogic: "all",
      conditions: rule.conditions.map(condition => ({ ...clone(condition.source), kind: condition.kind })),
      effects: rule.effects.map(effect => clone(effect.source)),
    };
  }

  function componentRuleFromHook(entry, rule) {
    return {
      key: nextComponentRuleKey(entry),
      prerequisiteHooks: [],
      hook: clone(rule.hook.source),
      chance: 100,
      conditionLogic: "all",
      conditions: [],
      effects: [],
    };
  }

  function prepareLoadedBlueprint(entry) {
    entry.mechanics ||= [];
    entry.componentRules ||= [];
    entry.rules ||= [];
    entry.modifiers ||= [];
    entry.rules.forEach(rule => {
      rule.conditionLogic ||= "all";
    });
    entry.componentRules.forEach(rule => {
      rule.conditionLogic ||= "all";
      rule.prerequisiteHooks ||= [];
    });
    return entry;
  }

  async function refreshSavedBlueprints(force = false) {
    if (!loadSavedBlueprints) {
      return false;
    }
    if (savedBlueprintRefresh) {
      return savedBlueprintRefresh;
    }
    if (!force && Date.now() - savedBlueprintRefreshAt < 5000) {
      return false;
    }
    savedBlueprintRefreshAt = Date.now();
    savedBlueprintRefresh = Promise.resolve(loadSavedBlueprints())
      .then(source => {
        if (!source || typeof source !== "object" || Array.isArray(source)) {
          return false;
        }
        let changed = false;
        for (const [key, value] of Object.entries(source)) {
          if (Object.hasOwn(state, key) || !value || typeof value !== "object" || Array.isArray(value)) {
            continue;
          }
          const entry = prepareLoadedBlueprint(clone(value));
          state[key] = entry;
          baseline[key] = clone(entry);
          changed = true;
        }
        if (changed) {
          callbacks.onCatalogChange?.(getCustomCatalog());
          callbacks.onChange?.();
        }
        return changed;
      })
      .catch(() => false)
      .finally(() => {
        savedBlueprintRefresh = null;
      });
    return savedBlueprintRefresh;
  }

  function renderIncludeSearch(input, refreshed = false) {
    closeOtherSearches(input);
    const entry = currentEntry();
    const results = input.closest(".as-include-search")?.querySelector(".as-include-results");
    if (!entry || !results) {
      return;
    }
    const query = input.value.trim().toLowerCase();
    const matches = getAbilityCatalog()
      .filter(ability => ability.id !== entry.id && !entry.includes.includes(ability.id))
      .filter(ability => {
        const haystack = `${ability.name} ${ability.description || ability.desc || ""}`.toLowerCase();
        return query.length === 0 || haystack.includes(query);
      })
      .slice(0, 12);
    results.innerHTML =
      matches.length > 0
        ? matches
            .map(
              ability =>
                `<button type="button" role="option" data-as-action="choose-include" data-as-id="${ability.id}"><b>${esc(ability.name)}</b><span>#${ability.id}</span><small>${esc(ability.description || ability.desc || "")}</small></button>`,
            )
            .join("")
        : '<div class="as-include-empty">No matching abilities</div>';
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!refreshed) {
      void refreshSavedBlueprints().then(changed => {
        if (changed && input.isConnected && input.getAttribute("aria-expanded") === "true") {
          renderIncludeSearch(input, true);
        }
      });
    }
  }

  function closeIncludeSearch() {
    const results = document.querySelector("#as-include-results");
    const input = document.querySelector("[data-as-include-search]");
    if (results) {
      results.hidden = true;
    }
    input?.setAttribute("aria-expanded", "false");
  }

  function closeOtherSearches(activeInput) {
    document.querySelectorAll('[role="combobox"][aria-expanded="true"]').forEach(input => {
      if (input === activeInput) {
        return;
      }
      input.setAttribute("aria-expanded", "false");
      const resultsId = input.getAttribute("aria-controls");
      if (resultsId) {
        const results = document.getElementById(resultsId);
        if (results) {
          results.hidden = true;
        }
      }
    });
    if (!activeInput.hasAttribute("data-as-mechanic-search")) {
      componentInsertTarget = null;
    }
  }

  function searchMatches(haystack, query) {
    const explicitRegex = query.match(/^\/(.+)\/([imsu]*)$/);
    if (explicitRegex) {
      try {
        return new RegExp(explicitRegex[1], explicitRegex[2]).test(haystack);
      } catch {
        return false;
      }
    }
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (
      terms.length === 0
      || terms.every(term => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(haystack))
    );
  }

  function componentHaystack(ability, rule) {
    return [
      ability.name,
      ability.description,
      rule.label,
      rule.summary,
      rule.scope,
      ...(rule.parameters || []).flatMap(parameter => [parameter.label, parameter.value]),
      rule.source.attrType,
      rule.hook.id,
      rule.hook.label,
      ...(rule.hook.context || []),
      ...rule.conditions.flatMap(condition => [
        condition.label,
        condition.summary,
        condition.kind,
        condition.sourceOwner,
      ]),
      ...rule.effects.flatMap(effect => [
        effect.label,
        effect.summary,
        effect.kind,
        effect.scope,
        effect.sourceOwner,
        ...(effect.parameters || []).flatMap(parameter => [parameter.label, parameter.value]),
      ]),
    ]
      .join(" ")
      .toLowerCase();
  }

  function componentSearchRow(ability, rule) {
    const conditionText =
      rule.conditions.length > 0 ? rule.conditions.map(condition => condition.label).join(" AND ") : "Always";
    const effectText = rule.effects.map(effect => effect.label).join("; ");
    const parameters = (rule.parameters || []).map(parameter => `${parameter.label}: ${parameter.value}`).join(" · ");
    return `<button type="button" class="as-component-result" role="option" data-as-action="choose-component-rule" data-as-id="${ability.id}" data-as-index="${rule.source.attrIndex}" data-as-type="${esc(rule.source.attrType)}"><span class="as-component-flow"><span><b>WHEN</b>${esc(rule.hook.label)}</span><span><b>IF</b>${esc(conditionText)}</span><span><b>DO</b>${esc(effectText)}</span></span><span class="as-component-meta">${rule.scope === "package" ? "<strong>PACKAGE</strong>" : ""}<span>${esc(rule.summary || rule.source.attrType)}</span>${parameters ? `<small>${esc(parameters)}</small>` : ""}</span></button>`;
  }

  function prepareComponentSearchView(query) {
    const target = componentInsertTarget
      ? `${componentInsertTarget.kind}:${componentInsertTarget.ruleIndex}`
      : "component";
    const key = `${target}:${query}`;
    if (componentSearchView.key !== key) {
      componentSearchView = { key, abilityLimit: 8, effectLimit: 32, partLimit: 80 };
    }
  }

  function componentResultFooter(kind, visible, total) {
    if (visible >= total) {
      return "";
    }
    return `<button type="button" class="as-search-more" data-as-action="expand-component-results" data-as-result-kind="${kind}">Show more (${visible} of ${total})</button>`;
  }

  function renderSimpleSearch(input) {
    closeOtherSearches(input);
    const results = input.closest(".as-simple-search")?.querySelector(".as-part-results");
    const part = input.dataset.asSimplePart;
    if (!results || !part) {
      return;
    }
    const values =
      part === "trigger"
        ? primitiveCatalog.triggers
        : part === "condition"
          ? primitiveCatalog.conditionKinds
          : primitiveCatalog.effectKinds;
    const query = input.value.trim().toLowerCase();
    const rule = currentEntry()?.rules[Number(input.dataset.asRule)];
    const compatibleValues =
      part !== "condition" || !rule
        ? values
        : values.filter(
            value =>
              (value !== "move" || triggerHasMove(rule.trigger))
              && (value !== "other-status" || triggerHasOther(rule.trigger)),
          );
    const matches = compatibleValues.filter(value => searchMatches(`${pretty(value)} ${value}`.toLowerCase(), query));
    results.innerHTML =
      matches.length > 0
        ? `<div class="as-simple-part-screen"><header><b>${part === "trigger" ? "CHOOSE WHEN" : part === "condition" ? "ADD IF CONDITION" : "ADD DO / THEN EFFECT"}</b></header>${matches.map(value => `<button type="button" role="option" data-as-action="choose-simple-${part}" data-as-value="${esc(value)}" data-as-rule="${input.dataset.asRule}"><b>${esc(pretty(value))}</b></button>`).join("")}</div>`
        : `<div class="as-include-empty">No matching ${esc(part)}s</div>`;
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function groupedComponentHooks(candidates) {
    const groups = new Map();
    for (const { ability, rule } of candidates) {
      let group = groups.get(rule.hook.id);
      if (!group) {
        group = { ability, rule, count: 0, abilityNames: new Set() };
        groups.set(rule.hook.id, group);
      }
      group.count++;
      group.abilityNames.add(ability.name);
      if (rule.source.attrType === rule.hook.id && group.rule.source.attrType !== group.rule.hook.id) {
        group.ability = ability;
        group.rule = rule;
      }
    }
    return [...groups.values()].sort(
      (left, right) =>
        Number(right.rule.hook.mode === "event") - Number(left.rule.hook.mode === "event")
        || right.count - left.count
        || left.rule.hook.label.localeCompare(right.rule.hook.label),
    );
  }

  function uniqueMatches(items, keyOf) {
    const seen = new Set();
    return items.filter(item => {
      const key = keyOf(item);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function componentEffectSemanticKey(candidate) {
    const parameters = (candidate.effect.parameters || candidate.rule.parameters || []).map(parameter => [
      parameter.path || parameter.key,
      Object.hasOwn(parameter, "rawValue") ? parameter.rawValue : parameter.value,
      parameter.control,
    ]);
    const source = candidate.effect.sourceSpecific ? componentSourceKey(candidate.effect.source) : "shared";
    return `${candidate.effect.kind}:${candidate.effect.source.attrType}:${JSON.stringify(parameters)}:${source}`;
  }

  function fanoutSection(title, matches, renderItem) {
    const limit = Math.max(16, Math.floor(componentSearchView.partLimit / 3));
    const visible = matches.slice(0, limit);
    return `<section><header><b>${esc(title)}</b><span>${matches.length}</span></header><div>${
      visible.length > 0 ? visible.map(renderItem).join("") : '<p class="as-fanout-empty">No matches</p>'
    }${componentResultFooter("part", visible.length, matches.length)}</div></section>`;
  }

  function fanoutHtml(partName, query, channels, renderItem) {
    return `<div class="as-search-fanout"><header><b>${esc(partName)}</b><span>Search: ${esc(query)}</span></header><div>${channels
      .map(channel => fanoutSection(channel.title, channel.matches, renderItem))
      .join("")}</div></div>`;
  }

  function showComponentResults(input, results, fanout) {
    results.classList.toggle("as-fanout-results", fanout);
    if (fanout) {
      const rect = input.getBoundingClientRect();
      const desiredHeight = Math.min(480, window.innerHeight - 24);
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const openBelow = below >= Math.min(280, desiredHeight) || below >= above;
      const panelHeight = Math.min(desiredHeight, Math.max(180, openBelow ? below : above));
      const top = openBelow ? rect.bottom + 4 : rect.top - panelHeight - 4;
      results.style.setProperty("--as-picker-top", `${Math.max(12, top)}px`);
      results.style.setProperty("--as-picker-height", `${panelHeight}px`);
    } else {
      results.style.removeProperty("--as-picker-top");
      results.style.removeProperty("--as-picker-height");
    }
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function componentHookResultHtml({ rule, count, abilityNames }) {
    const names = [...abilityNames].slice(0, 4);
    return `<button type="button" role="option" data-as-action="choose-component-hook" data-as-id="${rule.hook.source.abilityId}" data-as-index="${rule.hook.source.attrIndex}" data-as-type="${esc(rule.hook.source.attrType)}"><b>${esc(rule.hook.label)}</b><span>${count} existing mechanic${count === 1 ? "" : "s"}</span><small>${esc(names.join(" · "))}</small></button>`;
  }

  function componentConditionResultHtml({ ability, condition, primitive, compatible = true, reason = "" }) {
    if (primitive) {
      return `<button type="button" data-as-action="choose-component-primitive-condition" data-as-value="${esc(primitive)}"><b>${esc(pretty(primitive))}</b><span>Configurable IF primitive</span><small>Independent condition</small></button>`;
    }
    const conditionIndex = condition.source.conditionIndex;
    const parameters = componentParameterSummary(condition.parameters);
    const details = compatible
      ? [parameters, condition.summary || condition.sourceOwner].filter(Boolean).join(" · ")
      : reason;
    return `<button type="button" data-as-action="choose-component-condition" data-as-id="${condition.source.abilityId}" data-as-index="${condition.source.attrIndex}" data-as-type="${esc(condition.source.attrType)}" data-as-kind="${condition.kind}"${conditionIndex === undefined ? "" : ` data-as-condition-index="${conditionIndex}"`}${compatible ? "" : ` disabled title="${esc(reason)}"`}><b>${esc(condition.label)}</b><span>${esc(ability.name)} #${ability.id}</span><small>${esc(details)}</small></button>`;
  }

  function componentParameterSummary(parameters = []) {
    return parameters
      .filter(parameter => parameter.control !== "fixed")
      .slice(0, 5)
      .map(parameter => `${parameter.label}: ${Object.hasOwn(parameter, "rawValue") ? parameter.value : "default"}`)
      .join(" · ");
  }

  function componentEffectResultHtml({ ability, effect, primitive, compatible = true, reason = "" }) {
    if (primitive) {
      return `<button type="button" data-as-action="choose-component-primitive-effect" data-as-value="${esc(primitive)}"><b>${esc(pretty(primitive))}</b><span>Configurable DO / THEN primitive</span><small>Independent effect</small></button>`;
    }
    const parameters = componentParameterSummary(effect.parameters);
    const details = compatible
      ? [parameters, effect.summary || effect.sourceOwner].filter(Boolean).join(" · ")
      : reason;
    return `<button type="button" data-as-action="choose-component-effect" data-as-id="${effect.source.abilityId}" data-as-index="${effect.source.attrIndex}" data-as-type="${esc(effect.source.attrType)}"${compatible ? "" : ` disabled title="${esc(reason)}"`}><b>${esc(effect.label)}</b><span>${esc(ability.name)} #${ability.id}</span><small>${esc(details)}</small></button>`;
  }

  function renderComponentPartSearch(input, results, entry, query) {
    if (!componentInsertTarget) {
      return false;
    }
    if (componentInsertTarget.kind === "hook" || componentInsertTarget.kind === "new-hook") {
      const targetRule = entry.componentRules[componentInsertTarget.ruleIndex];
      const selectedHookIds = new Set(
        targetRule
          ? [...(targetRule.prerequisiteHooks || []), targetRule.hook]
              .map(source => resolveComponent(source)?.hook.id)
              .filter(Boolean)
          : [],
      );
      const candidates = componentCatalog
        .filter(ability => ability.id !== entry.id)
        .flatMap(ability => ability.rules.map(rule => ({ ability, rule })))
        .filter(({ rule }) => !selectedHookIds.has(rule.hook.id));
      const allHooks = groupedComponentHooks(candidates);
      if (query) {
        const channels = [
          {
            title: "WHEN names",
            matches: groupedComponentHooks(
              candidates.filter(({ rule }) => searchMatches(`${rule.hook.label} ${rule.hook.id}`.toLowerCase(), query)),
            ),
          },
          {
            title: "Ability names",
            matches: groupedComponentHooks(
              candidates.filter(({ ability }) => searchMatches(ability.name.toLowerCase(), query)),
            ),
          },
          {
            title: "Ability descriptions",
            matches: groupedComponentHooks(
              candidates.filter(({ ability }) => searchMatches((ability.description || "").toLowerCase(), query)),
            ),
          },
        ];
        results.innerHTML = fanoutHtml(
          componentInsertTarget.kind === "new-hook" ? "ADD RULE: CHOOSE WHEN" : "ADD WHEN TO CHAIN",
          query,
          channels,
          componentHookResultHtml,
        );
      } else {
        const matches = allHooks.slice(0, componentSearchView.partLimit);
        results.innerHTML = `<div class="as-part-screen"><header><b>${componentInsertTarget.kind === "new-hook" ? "ADD RULE: CHOOSE WHEN" : "ADD WHEN TO CHAIN"} (${allHooks.length})</b><span>${candidates.length} existing mechanics grouped into ${allHooks.length} triggers</span></header>${matches.map(componentHookResultHtml).join("")}${componentResultFooter("part", matches.length, allHooks.length)}</div>`;
      }
      showComponentResults(input, results, !!query);
      return true;
    }
    const targetRule = entry.componentRules[componentInsertTarget.ruleIndex];
    const targetHook = targetRule && resolveComponent(targetRule.hook)?.hook;
    if (!targetRule || !targetHook) {
      componentInsertTarget = null;
      return false;
    }
    if (componentInsertTarget.kind === "condition") {
      const selected = new Set(
        targetRule.conditions
          .filter(isRuntimeComponent)
          .map(reference => componentConditionsByKey.get(componentConditionKey(reference))?.id)
          .filter(Boolean),
      );
      const candidates = uniqueMatches(
        componentCatalog
          .flatMap(ability =>
            ability.rules.flatMap(rule => rule.conditions.map(condition => ({ ability, rule, condition }))),
          )
          .filter(({ condition }) => !selected.has(condition.id)),
        ({ condition }) => condition.id,
      ).map(candidate => {
        const observed = candidate.condition.kind === "event" && !runtimeHookSupports(targetHook, candidate.rule.hook);
        return {
          ...candidate,
          condition: observed
            ? {
                ...candidate.condition,
                summary: `Observed when "${candidate.rule.hook.label}" occurs, then used as an IF gate for this rule. ${candidate.condition.summary}`,
              }
            : candidate.condition,
          compatible: true,
          reason: "",
        };
      });
      const primitives = primitiveCatalog.conditionKinds.map(primitive => ({ primitive }));
      if (query) {
        results.innerHTML = fanoutHtml(
          `ADD IF CONDITION · ${targetHook.label}`,
          query,
          [
            {
              title: "Condition names",
              matches: [
                ...primitives.filter(({ primitive }) =>
                  searchMatches(`${pretty(primitive)} ${primitive}`.toLowerCase(), query),
                ),
                ...candidates.filter(({ condition }) =>
                  searchMatches(
                    `${condition.label} ${condition.kind} ${condition.sourceOwner} ${condition.source.attrType}`.toLowerCase(),
                    query,
                  ),
                ),
              ],
            },
            {
              title: "Ability names",
              matches: candidates.filter(({ ability }) => searchMatches(ability.name.toLowerCase(), query)),
            },
            {
              title: "Ability descriptions",
              matches: candidates.filter(({ ability }) =>
                searchMatches((ability.description || "").toLowerCase(), query),
              ),
            },
          ],
          componentConditionResultHtml,
        );
      } else {
        const matches = [...primitives, ...candidates].slice(0, componentSearchView.partLimit);
        results.innerHTML = `<div class="as-part-screen"><header><b>ADD IF CONDITION (${primitives.length + candidates.length})</b><span>All reusable conditions; event gates can be observed across WHEN hooks</span></header>${matches.map(componentConditionResultHtml).join("")}${componentResultFooter("part", matches.length, primitives.length + candidates.length)}</div>`;
      }
    } else {
      const selected = new Set(targetRule.effects.filter(isRuntimeComponent).map(componentInstanceKey));
      const candidates = uniqueMatches(
        componentCatalog.flatMap(ability =>
          ability.rules.flatMap(rule => rule.effects.map(effect => ({ ability, rule, effect }))),
        ),
        componentEffectSemanticKey,
      )
        .filter(({ effect }) => !selected.has(componentInstanceKey(effect.source)))
        .map(candidate => {
          const compatible = componentEffectSupports(targetRule, candidate.effect.source);
          const armed = compatible && !runtimeEffectSupports(targetHook, candidate.rule.hook);
          const persistentCapability = candidate.effect.kind === "capability";
          return {
            ...candidate,
            effect: armed
              ? {
                  ...candidate.effect,
                  summary: persistentCapability
                    ? `Activated by "${targetHook.label}" for the rest of the battle. ${candidate.effect.summary}`
                    : `Armed by "${targetHook.label}", then consumed the next time "${candidate.rule.hook.label}" occurs. ${candidate.effect.summary}`,
                }
              : candidate.effect,
            compatible,
            reason: "",
          };
        });
      const primitives = primitiveCatalog.effectKinds.map(primitive => ({ primitive }));
      if (query) {
        results.innerHTML = fanoutHtml(
          `ADD DO / THEN EFFECT · ${targetHook.label}`,
          query,
          [
            {
              title: "Effect names",
              matches: [
                ...primitives.filter(({ primitive }) =>
                  searchMatches(`${pretty(primitive)} ${primitive}`.toLowerCase(), query),
                ),
                ...candidates.filter(({ effect }) =>
                  searchMatches(
                    `${effect.label} ${effect.kind} ${effect.scope} ${effect.sourceOwner} ${effect.source.attrType} ${(effect.parameters || []).flatMap(parameter => [parameter.label, parameter.value]).join(" ")}`.toLowerCase(),
                    query,
                  ),
                ),
              ],
            },
            {
              title: "Ability names",
              matches: candidates.filter(({ ability }) => searchMatches(ability.name.toLowerCase(), query)),
            },
            {
              title: "Ability descriptions",
              matches: candidates.filter(({ ability }) =>
                searchMatches((ability.description || "").toLowerCase(), query),
              ),
            },
          ],
          componentEffectResultHtml,
        );
      } else {
        const matches = [...primitives, ...candidates].slice(0, componentSearchView.partLimit);
        results.innerHTML = `<div class="as-part-screen"><header><b>ADD DO / THEN EFFECT (${primitives.length + candidates.length})</b><span>All reusable effects; hook-bound actions are armed for their next native event</span></header>${matches.map(componentEffectResultHtml).join("")}${componentResultFooter("part", matches.length, primitives.length + candidates.length)}</div>`;
      }
    }
    showComponentResults(input, results, !!query);
    return true;
  }

  function renderMechanicSearch(input) {
    closeOtherSearches(input);
    const entry = currentEntry();
    const results = input.closest(".as-mechanic-search")?.querySelector(".as-mechanic-results");
    if (!entry || !results) {
      return;
    }
    if (input.dataset.asComponentPart) {
      componentInsertTarget = {
        kind: input.dataset.asComponentPart,
        ruleIndex: Number(input.dataset.asComponentRule),
      };
    }
    const query = input.value.trim().toLowerCase();
    prepareComponentSearchView(query);
    if (renderComponentPartSearch(input, results, entry, query)) {
      return;
    }
    const selectedKeys = new Set(
      [...entry.mechanics, ...entry.componentRules.map(rule => rule.hook)].map(componentSourceKey),
    );
    const availableRules = componentCatalog
      .filter(ability => ability.id !== entry.id)
      .map(ability => ({
        ability,
        rules: ability.rules.filter(rule => !selectedKeys.has(componentSourceKey(rule.source))),
      }));
    const allAbilityMatches = availableRules.filter(({ ability }) =>
      searchMatches(`${ability.name} ${ability.description}`.toLowerCase(), query),
    );
    const allDirectMatches = availableRules
      .flatMap(({ ability, rules }) =>
        rules.map(rule => ({ ability, rule, haystack: componentHaystack(ability, rule) })),
      )
      .filter(({ haystack }) => searchMatches(haystack, query))
      .filter(
        ({ ability, rule }) =>
          !allAbilityMatches.some(match => match.ability.id === ability.id && match.rules.includes(rule)),
      );
    const abilityMatches = allAbilityMatches.slice(0, componentSearchView.abilityLimit);
    const directMatches = allDirectMatches.slice(0, componentSearchView.effectLimit);
    const abilityHtml = abilityMatches
      .map(
        ({ ability, rules }) =>
          `<article class="as-ability-result"><header><div><b>${esc(ability.name)}</b><span>#${ability.id} · ${rules.length} effects</span></div>${rules.length > 0 ? `<button type="button" data-as-action="choose-component-ability" data-as-id="${ability.id}">Add all</button>` : '<span class="as-no-runtime">No runtime effect</span>'}</header><p>${esc(ability.description)}</p>${rules.length > 0 ? `<div class="as-ability-result-rules">${rules.map(rule => componentSearchRow(ability, rule)).join("")}</div>` : ""}</article>`,
      )
      .join("");
    const directHtml = directMatches
      .map(
        ({ ability, rule }) =>
          `<article class="as-direct-component"><div><b>${esc(rule.label)}</b><span>${esc(ability.name)} #${ability.id}</span></div>${componentSearchRow(ability, rule)}</article>`,
      )
      .join("");
    results.innerHTML =
      abilityHtml || directHtml
        ? `<div class="as-component-screen">${abilityHtml ? `<section><h4>ABILITIES (${allAbilityMatches.length})</h4>${abilityHtml}${componentResultFooter("abilities", abilityMatches.length, allAbilityMatches.length)}</section>` : ""}${directHtml ? `<section><h4>MATCHING EFFECTS (${allDirectMatches.length})</h4>${directHtml}${componentResultFooter("effects", directMatches.length, allDirectMatches.length)}</section>` : ""}</div>`
        : '<div class="as-include-empty">No matching hooks, conditions, or effects</div>';
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function closeMechanicSearch() {
    document.querySelectorAll(".as-mechanic-results").forEach(results => {
      results.hidden = true;
    });
    document.querySelectorAll("[data-as-mechanic-search]").forEach(input => {
      input.setAttribute("aria-expanded", "false");
    });
    componentInsertTarget = null;
  }

  function closeSimpleSearch() {
    document.querySelectorAll(".as-simple-search .as-part-results").forEach(results => {
      results.hidden = true;
    });
    document.querySelectorAll("[data-as-simple-search]").forEach(input => {
      input.setAttribute("aria-expanded", "false");
    });
  }

  function validateRuntimeParameters(reference, part, label, errors) {
    for (const [path, value] of Object.entries(reference.parameterOverrides || {})) {
      const parameter = runtimeParameter(reference, part, path);
      if (!parameter?.editable) {
        errors.push(`${label}: parameter ${path} cannot be changed`);
        continue;
      }
      if (value === null) {
        if (!parameter.optional) {
          errors.push(`${label}: parameter ${path} cannot be empty`);
        }
        continue;
      }
      if (parameter.control === "ability" && (!Number.isInteger(value) || !componentsByAbility.has(value))) {
        errors.push(`${label}: ${parameter.label} is not a valid ability`);
      } else if (parameter.control === "move" && (!Number.isInteger(value) || !movesById.has(value))) {
        errors.push(`${label}: ${parameter.label} is not a valid move`);
      } else if (
        parameter.control === "move-list"
        && (!Array.isArray(value) || value.some(item => !Number.isInteger(item) || !movesById.has(item)))
      ) {
        errors.push(`${label}: ${parameter.label} contains an invalid move`);
      } else if (
        parameter.control === "number"
        && (typeof value !== "number"
          || !Number.isFinite(value)
          || (parameter.min !== undefined && value < parameter.min)
          || (parameter.max !== undefined && value > parameter.max))
      ) {
        errors.push(`${label}: ${parameter.label} is outside its valid range`);
      } else if (
        parameter.control === "number-list"
        && (!Array.isArray(value)
          || value.length === 0
          || value.some(
            item =>
              typeof item !== "number"
              || !Number.isFinite(item)
              || (parameter.min !== undefined && item < parameter.min)
              || (parameter.max !== undefined && item > parameter.max),
          ))
      ) {
        errors.push(`${label}: ${parameter.label} contains an invalid number`);
      } else if (parameter.control === "boolean" && typeof value !== "boolean") {
        errors.push(`${label}: ${parameter.label} must be Yes or No`);
      } else if (parameter.control === "text" && typeof value !== "string") {
        errors.push(`${label}: ${parameter.label} must be text`);
      } else if (parameter.control === "select" && !parameter.options?.some(option => option.value === value)) {
        errors.push(`${label}: ${parameter.label} is invalid`);
      } else if (
        parameter.control === "multi-select"
        && (!Array.isArray(value) || value.some(item => !parameter.options?.some(option => option.value === item)))
      ) {
        errors.push(`${label}: ${parameter.label} contains an invalid option`);
      }
    }
  }

  function validateEntry(key, entry, allIds) {
    const errors = [];
    if (!/^[a-z0-9-]{2,48}$/.test(key)) {
      errors.push("Internal key is invalid");
    }
    if (!entry.name || entry.name.trim().length < 2 || entry.name.length > 40) {
      errors.push("Name must be 2-40 characters");
    }
    if (!entry.description || entry.description.trim().length < 2 || entry.description.length > 500) {
      errors.push("Description must be 2-500 characters");
    }
    if (
      !Number.isInteger(entry.id)
      || entry.id < primitiveCatalog.idRange[0]
      || entry.id > primitiveCatalog.idRange[1]
    ) {
      errors.push("Reserved ability id is invalid");
    }
    if (
      entry.includes.length
        + entry.mechanics.length
        + entry.componentRules.length
        + entry.rules.length
        + entry.modifiers.length
      === 0
    ) {
      errors.push("Add an included ability, mechanic, rule, or modifier");
    }
    if (entry.includes.includes(entry.id)) {
      errors.push("An ability cannot include itself");
    }
    for (const id of entry.includes) {
      if (!allIds.has(id)) {
        errors.push(`Included ability ${id} does not exist`);
      }
    }
    for (const reference of entry.mechanics) {
      if (reference.abilityId === entry.id) {
        errors.push("An ability cannot reuse its own runtime mechanics");
      } else if (!resolveMechanic(reference)) {
        errors.push(
          `Runtime mechanic ${reference.attrType} #${reference.attrIndex} from ability ${reference.abilityId} does not exist`,
        );
      }
    }
    const componentRuleKeys = new Set();
    entry.componentRules.forEach((rule, index) => {
      const number = index + 1;
      if (!rule.key || componentRuleKeys.has(rule.key)) {
        errors.push(`Component rule ${number}: key must be unique`);
      }
      componentRuleKeys.add(rule.key);
      if (!(rule.chance >= 1 && rule.chance <= 100)) {
        errors.push(`Component rule ${number}: chance must be 1-100`);
      }
      if (!["all", "any"].includes(rule.conditionLogic || "all")) {
        errors.push(`Component rule ${number}: condition logic is invalid`);
      }
      const hook = resolveComponent(rule.hook);
      if (!hook) {
        errors.push(`Component rule ${number}: WHEN source does not exist`);
        return;
      }
      const prerequisiteHooks = rule.prerequisiteHooks || [];
      const prerequisiteIds = new Set();
      for (const prerequisite of prerequisiteHooks) {
        const prerequisiteRule = resolveComponent(prerequisite);
        if (!prerequisiteRule) {
          errors.push(`Component rule ${number}: chained WHEN source does not exist`);
        } else if (prerequisiteIds.has(prerequisiteRule.hook.id) || prerequisiteRule.hook.id === hook.hook.id) {
          errors.push(`Component rule ${number}: chained WHEN triggers must be distinct`);
        }
        prerequisiteIds.add(prerequisiteRule?.hook.id);
      }
      const sources = [...prerequisiteHooks, rule.hook, ...rule.conditions, ...rule.effects].filter(isRuntimeComponent);
      if (sources.some(source => source.abilityId === entry.id)) {
        errors.push(`Component rule ${number}: cannot reference itself`);
      }
      if (rule.effects.length === 0) {
        errors.push(`Component rule ${number}: add at least one effect`);
      }
      [...prerequisiteHooks, rule.hook].forEach(source =>
        validateRuntimeParameters(source, "hook", `Component rule ${number} WHEN`, errors),
      );
      for (const condition of rule.conditions) {
        if (!isRuntimeComponent(condition)) {
          continue;
        }
        if (!componentConditionsByKey.has(componentConditionKey(condition))) {
          errors.push(`Component rule ${number}: IF source does not exist`);
        }
        validateRuntimeParameters(condition, "condition", `Component rule ${number} IF`, errors);
      }
      for (const effect of rule.effects) {
        if (!isRuntimeComponent(effect)) {
          continue;
        }
        if (!componentEffectsByKey.has(componentSourceKey(effect))) {
          errors.push(`Component rule ${number}: DO source does not exist`);
        }
        validateRuntimeParameters(effect, "effect", `Component rule ${number} DO`, errors);
      }
    });
    const ruleKeys = new Set();
    entry.rules.forEach((rule, index) => {
      if (!rule.key || ruleKeys.has(rule.key)) {
        errors.push(`Rule ${index + 1}: key must be unique`);
      }
      ruleKeys.add(rule.key);
      if (!(rule.chance >= 1 && rule.chance <= 100)) {
        errors.push(`Rule ${index + 1}: chance must be 1-100`);
      }
      if (!["all", "any"].includes(rule.conditionLogic || "all")) {
        errors.push(`Rule ${index + 1}: condition logic is invalid`);
      }
      if (rule.effects.length === 0) {
        errors.push(`Rule ${index + 1}: add at least one effect`);
      }
      if (
        (rule.trigger === "on-entry" || rule.trigger === "after-ko" || rule.trigger === "end-turn")
        && rule.conditions.some(
          condition =>
            condition.kind === "move"
            || ((rule.trigger === "on-entry" || rule.trigger === "end-turn") && condition.kind === "other-status"),
        )
      ) {
        errors.push(`Rule ${index + 1}: trigger does not provide the selected condition context`);
      }
      if (
        (rule.trigger === "on-entry" || rule.trigger === "end-turn")
        && rule.effects.some(effect => effect.target === "other")
      ) {
        errors.push(`Rule ${index + 1}: trigger cannot target Other Pokemon`);
      }
      rule.effects.forEach(effect => {
        if (
          effect.kind === "stat-stage"
          && (!Number.isInteger(effect.stages) || effect.stages === 0 || Math.abs(effect.stages) > 6)
        ) {
          errors.push(`Rule ${index + 1}: stat stages must be a non-zero integer from -6 to 6`);
        }
        if (effect.kind === "heal-percent" && !(effect.percent >= 1 && effect.percent <= 100)) {
          errors.push(`Rule ${index + 1}: healing must be 1-100%`);
        }
      });
    });
    return errors;
  }

  function cycleErrors() {
    const byId = new Map(visibleEntries().map(([, entry]) => [entry.id, entry]));
    const errors = [];
    const done = new Set();
    const visit = (entry, stack) => {
      if (stack.has(entry.id)) {
        errors.push(`${entry.name}: ability references form a cycle`);
        return;
      }
      if (done.has(entry.id)) {
        return;
      }
      const next = new Set(stack);
      next.add(entry.id);
      [
        ...entry.includes,
        ...entry.mechanics.map(reference => reference.abilityId),
        ...entry.componentRules.flatMap(rule => [
          rule.hook.abilityId,
          ...rule.conditions.filter(isRuntimeComponent).map(condition => condition.abilityId),
          ...rule.effects.filter(isRuntimeComponent).map(effect => effect.abilityId),
        ]),
      ].forEach(id => {
        const included = byId.get(id);
        if (included) {
          visit(included, next);
        }
      });
      done.add(entry.id);
    };
    byId.forEach(entry => visit(entry, new Set()));
    return errors;
  }

  function allValidationErrors() {
    const entries = visibleEntries();
    const allIds = new Set([...baseAbilities.map(ability => ability.id), ...entries.map(([, entry]) => entry.id)]);
    const errors = [];
    const ids = new Map();
    const names = new Map();
    for (const [key, entry] of entries) {
      errors.push(...validateEntry(key, entry, allIds).map(error => `${entry.name}: ${error}`));
      if (ids.has(entry.id)) {
        errors.push(`${entry.name}: id duplicates ${ids.get(entry.id)}`);
      } else {
        ids.set(entry.id, entry.name);
      }
      const normalized = entry.name.trim().toLowerCase();
      if (names.has(normalized)) {
        errors.push(`${entry.name}: name duplicates ${names.get(normalized)}`);
      } else {
        names.set(normalized, entry.name);
      }
    }
    return [...errors, ...cycleErrors()];
  }

  function renderContent(root) {
    const entries = visibleEntries();
    if (!selected || !state[selected]) {
      selected = entries[0]?.[0] || null;
    }
    const entry = currentEntry();
    const allIds = new Set(getAbilityCatalog().map(ability => ability.id));
    const entryCycleErrors = entry ? cycleErrors().filter(error => error.startsWith(`${entry.name}:`)) : [];
    const errors = entry ? [...validateEntry(selected, entry, allIds), ...entryCycleErrors] : [];
    root.innerHTML = `<div class="as-shell">
      <aside class="as-list" aria-label="Created abilities"><div class="as-list-head"><button type="button" class="primary as-new-ability" data-as-action="new-ability">+ New ability</button><label class="as-list-search"><span aria-hidden="true">⌕</span><input aria-label="Search authored abilities" placeholder="Search abilities…" value="${esc(listQuery)}" data-as-list-search></label><div class="as-list-meta"><b>Created abilities</b><span>${entries.length} total</span></div></div><div class="as-list-scroll">${
        entries.length > 0
          ? entries
              .map(([key, ability]) => {
                const ready = validateEntry(key, ability, allIds).length === 0;
                const hay = `${ability.name} ${ability.description}`.toLowerCase();
                return `<button type="button" class="as-ability-row${key === selected ? " active" : ""}${eq(ability, baseline[key]) ? "" : " dirty"}"${key === selected ? ' aria-current="true"' : ""}${listQuery && !hay.includes(listQuery) ? " hidden" : ""} data-as-action="select" data-as-key="${esc(key)}" data-as-hay="${esc(hay)}"><span class="as-ability-mark" aria-hidden="true">◆</span><span class="as-ability-copy"><b>${esc(ability.name)}</b><small>#${ability.id} · ${ability.rules.length + ability.includes.length + ability.mechanics.length + ability.componentRules.length + ability.modifiers.length} blocks</small></span><span class="as-state ${ready ? "ready" : "draft"}">${ready ? "READY" : "DRAFT"}</span></button>`;
              })
              .join("")
          : '<div class="as-list-empty">No authored abilities yet.</div>'
      }</div></aside>
      <main class="as-workspace" aria-label="Ability editor">${entry ? renderEntry(entry, errors) : '<div class="as-welcome"><h2>Create an ability</h2><p>Build it from existing ability packages, passive modifiers, and triggered effect chains.</p><button type="button" class="primary" data-as-action="new-ability">Create first ability</button></div>'}</main>
      <aside class="as-inspector" aria-label="Builder, summary, and validation">${entry ? renderInspector(entry, errors) : `${renderAiAssistant()}<div class="as-panel"><h3>Ability Studio</h3><p class="muted">No ability selected.</p></div>`}</aside>
      ${runtimeAbilityDatalistHtml()}
    </div>`;
  }

  function renderEntry(entry) {
    const rules = entry.rules.map(ruleHtml);
    const componentRules = entry.componentRules.map((rule, index) =>
      componentRuleHtml(rule, index, rules.length + index + 1),
    );
    const mechanics = entry.mechanics.map((reference, index) =>
      mechanicRuleHtml(reference, index, rules.length + componentRules.length + index + 1),
    );
    const includes = entry.includes.map((id, index) =>
      includeRuleHtml(id, rules.length + componentRules.length + mechanics.length + index + 1),
    );
    const modifierOffset = rules.length + componentRules.length + mechanics.length + includes.length;
    const modifiers = entry.modifiers.map((modifier, index) =>
      modifierHtml(modifier, index, modifierOffset + index + 1),
    );
    const blocks = [...rules, ...componentRules, ...mechanics, ...includes, ...modifiers];
    return `<section class="as-entry">
      <section class="as-details"><div class="as-section-title"><h3>ABILITY DETAILS</h3><div class="as-entry-actions"><button type="button" data-as-action="duplicate">Duplicate</button><button type="button" class="danger" data-as-action="delete-ability">Delete</button></div></div><div class="as-details-grid"><label><span>Name</span><input class="as-name" maxlength="40" aria-label="Ability name" value="${esc(entry.name)}" data-as-field="name"></label><label><span>Internal ID</span><input aria-label="Internal ability ID" value="${esc(selected)}" readonly></label><label class="as-description"><span>Description</span><textarea maxlength="500" rows="2" aria-label="Ability description" data-as-field="description">${esc(entry.description)}</textarea></label></div></section>
      <section class="as-compose"><div class="as-section-title"><h3>RULES</h3>${blocks.length > 0 ? `<div class="as-rule-create" data-as-drop-part="new-rule">${componentPartSearchHtml("new-hook", -1, "Add rule: search WHEN triggers…")}</div>` : ""}</div><div class="as-rules">${blocks.length > 0 ? blocks.join("") : emptyRuleHtml()}</div><div class="as-rule-adders"><div class="as-include-picker"><div class="as-include-search"><input id="as-include-picker" type="search" role="combobox" aria-autocomplete="list" aria-controls="as-include-results" aria-expanded="false" aria-label="Search existing abilities" autocomplete="off" placeholder="Search whole ability packages…" data-as-action="open-include-search" data-as-include-search><div id="as-include-results" class="as-include-results" role="listbox" hidden></div></div><button type="button" data-as-action="add-include">+ Include ability</button></div><button type="button" data-as-action="add-modifier">+ Always modifier</button></div></section>
    </section>`;
  }

  function renderInspector(entry, errors) {
    const lines = summary(entry);
    const flags = [
      ["ignorable", "Ignored by Mold Breaker effects"],
      ["unsuppressable", "Cannot be suppressed"],
      ["uncopiable", "Cannot be copied"],
      ["unreplaceable", "Cannot be replaced"],
      ["bypassFaint", "Can trigger while fainted"],
    ];
    const allIds = new Set(getAbilityCatalog().map(ability => ability.id));
    const checks = [
      [
        entry.rules.length
          + entry.includes.length
          + entry.mechanics.length
          + entry.componentRules.length
          + entry.modifiers.length
          > 0,
        "At least one mechanic is defined",
      ],
      [entry.rules.every(rule => primitiveCatalog.triggers.includes(rule.trigger)), "All rules have a WHEN trigger"],
      [!errors.some(error => error.includes("context")), "All IF conditions fit their trigger"],
      [
        !errors.some(error => error.includes("effect") || error.includes("stages") || error.includes("healing")),
        "All DO/THEN effects are valid",
      ],
      [entry.rules.every(rule => rule.chance >= 1 && rule.chance <= 100), "Chance values are within 1-100%"],
      [entry.includes.every(id => allIds.has(id)), "Included ability references resolve"],
      [entry.mechanics.every(reference => !!resolveMechanic(reference)), "Runtime mechanic references resolve"],
      [
        entry.componentRules.every(
          rule =>
            !!resolveComponent(rule.hook)
            && rule.conditions.every(
              condition =>
                !isRuntimeComponent(condition) || componentConditionsByKey.has(componentConditionKey(condition)),
            )
            && rule.effects.every(
              effect => !isRuntimeComponent(effect) || componentEffectsByKey.has(componentSourceKey(effect)),
            ),
        ),
        "Component hook, IF, and DO references resolve",
      ],
      [!errors.some(error => error.includes("cycle")), "No circular ability references"],
    ];
    return `${renderAiAssistant()}<div class="as-panel"><span class="as-eyebrow">MECHANICS SUMMARY</span><h3>${esc(entry.name)}</h3><div class="as-summary">${lines.length > 0 ? lines.map(line => `<p>${esc(line)}</p>`).join("") : '<p class="muted">No mechanics yet.</p>'}</div></div>
      <div class="as-panel"><span class="as-eyebrow">VALIDATION</span><div class="as-checklist">${checks.map(([pass, text]) => `<div class="${pass ? "pass" : "fail"}"><span aria-hidden="true">${pass ? "✓" : "!"}</span><p>${esc(text)}</p></div>`).join("")}</div>${errors.length > 0 ? `<ul class="as-errors">${errors.map(error => `<li>${esc(error)}</li>`).join("")}</ul>` : ""}</div>
      <div class="as-panel"><span class="as-eyebrow">ABILITY FLAGS</span><div class="as-flags">${flags.map(([key, text]) => `<label><input type="checkbox" data-as-flag="${key}"${entry.flags?.[key] ? " checked" : ""}><span>${esc(text)}</span></label>`).join("")}</div></div>`;
  }

  function getCustomCatalog() {
    return visibleEntries().map(([, entry]) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      hay: `${entry.name} ${entry.description}`.toLowerCase(),
      studio: true,
    }));
  }

  function getAbilityCatalog() {
    const customIds = new Set(getCustomCatalog().map(ability => ability.id));
    const baseIds = new Set(baseAbilities.map(ability => ability.id));
    const runtimeAbilities = mechanicCatalog
      .filter(ability => !baseIds.has(ability.id))
      .map(ability => ({
        id: ability.id,
        name: ability.name,
        description: ability.description,
        hay: `${ability.name} ${ability.description}`.toLowerCase(),
      }));
    return [
      ...baseAbilities.filter(ability => !customIds.has(ability.id)),
      ...runtimeAbilities.filter(ability => !customIds.has(ability.id)),
      ...getCustomCatalog(),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  function updateFilter(filter, field, value) {
    if (value === "") {
      delete filter[field];
    } else if (field === "damaging") {
      filter[field] = value === "true";
    } else {
      filter[field] = value;
    }
  }

  function runtimeReferenceForElement(entry, element) {
    const rule = entry.componentRules[Number(element.dataset.asComponentRule)];
    if (!rule) {
      return;
    }
    if (element.dataset.asRuntimePart === "condition") {
      return rule.conditions[Number(element.dataset.asRuntimeIndex)];
    }
    if (element.dataset.asRuntimePart === "effect") {
      return rule.effects[Number(element.dataset.asRuntimeIndex)];
    }
  }

  function updateRuntimeParameter(reference, parameter, element) {
    const path = parameter.path || parameter.key;
    const control = parameter.control;
    const inputValue = element.value;
    if (inputValue === "__source__") {
      delete reference.parameterOverrides?.[path];
    } else {
      let value;
      if (control === "ability") {
        value = parseAbility(inputValue);
        if (value === undefined) {
          if (inputValue.trim() !== "" || !parameter.optional) {
            return false;
          }
          value = null;
        }
      } else if (control === "move") {
        value = parseMove(inputValue);
        if (value === undefined) {
          if (inputValue.trim() !== "" || !parameter.optional) {
            return false;
          }
          value = null;
        }
      } else if (control === "move-list") {
        const labels = inputValue
          .split(";")
          .map(item => item.trim())
          .filter(Boolean);
        const moves = labels.map(parseMove);
        if (moves.some(move => move === undefined)) {
          return false;
        }
        value = moves.length > 0 ? moves : parameter.optional ? null : [];
      } else if (control === "number") {
        if (inputValue === "") {
          if (!parameter.optional) {
            return false;
          }
          value = null;
        } else {
          value = Number(inputValue);
          if (!Number.isFinite(value)) {
            return false;
          }
        }
      } else if (control === "number-list") {
        const tokens = inputValue
          .split(",")
          .map(item => item.trim())
          .filter(Boolean);
        const numbers = tokens.map(Number);
        if (numbers.some(value => !Number.isFinite(value))) {
          return false;
        }
        if (numbers.length === 0) {
          if (!parameter.optional) {
            return false;
          }
          value = null;
        } else {
          value = numbers;
        }
      } else if (control === "boolean") {
        value = inputValue === "true";
      } else if (control === "select") {
        value = inputValue === "__none__" ? null : parseParameterOption(inputValue);
      } else if (control === "multi-select") {
        const values = [...element.selectedOptions].map(item => parseParameterOption(item.value));
        value = values.length > 0 ? values : parameter.optional ? null : [];
      } else if (control === "text") {
        value = inputValue;
      } else {
        return false;
      }
      reference.parameterOverrides ||= {};
      reference.parameterOverrides[path] = value;
    }
    if (reference.parameterOverrides && Object.keys(reference.parameterOverrides).length === 0) {
      reference.parameterOverrides = undefined;
    }
    return true;
  }

  function handleInput(element) {
    if (element.hasAttribute("data-as-move-search")) {
      renderRuntimeMoveSearch(element);
    }
    if (element.hasAttribute("data-as-ai-prompt")) {
      aiState.prompt = element.value;
      aiState.error = "";
      return true;
    }
    if (element.hasAttribute("data-as-list-search")) {
      listQuery = element.value.trim().toLowerCase();
      document.querySelectorAll(".as-ability-row").forEach(row => {
        row.hidden = listQuery.length > 0 && !row.dataset.asHay.includes(listQuery);
      });
      return true;
    }
    if (element.hasAttribute("data-as-include-search")) {
      renderIncludeSearch(element);
      return true;
    }
    if (element.hasAttribute("data-as-mechanic-search")) {
      renderMechanicSearch(element);
      return true;
    }
    if (element.hasAttribute("data-as-simple-search")) {
      renderSimpleSearch(element);
      return true;
    }
    const entry = currentEntry();
    if (!entry || !element.closest(".as-shell")) {
      return false;
    }
    let rerender = false;
    if (element.dataset.asField) {
      entry[element.dataset.asField] = element.value;
    } else if (element.dataset.asRuntimeParameter) {
      const reference = runtimeReferenceForElement(entry, element);
      const parameter = reference
        ? runtimeParameter(reference, element.dataset.asRuntimePart, element.dataset.asRuntimeParameter)
        : undefined;
      if (!reference || !parameter || !updateRuntimeParameter(reference, parameter, element)) {
        return true;
      }
    } else if (element.dataset.asFlag) {
      entry.flags ||= {};
      entry.flags[element.dataset.asFlag] = element.checked;
    } else if (element.dataset.asComponentRuleField) {
      const rule = entry.componentRules[Number(element.dataset.asComponentRule)];
      rule[element.dataset.asComponentRuleField] = Number(element.value);
    } else if (element.hasAttribute("data-as-component-condition-kind")) {
      const rule = entry.componentRules[Number(element.dataset.asComponentRule)];
      rule.conditions[Number(element.dataset.asComponentCondition)] = defaultCondition(element.value);
      rerender = true;
    } else if (element.dataset.asComponentConditionField) {
      const condition =
        entry.componentRules[Number(element.dataset.asComponentRule)].conditions[
          Number(element.dataset.asComponentCondition)
        ];
      const field = element.dataset.asComponentConditionField;
      if (element.value === "" && (field === "minPercent" || field === "maxPercent")) {
        delete condition[field];
      } else {
        condition[field] = field === "minPercent" || field === "maxPercent" ? Number(element.value) : element.value;
      }
    } else if (element.hasAttribute("data-as-component-effect-kind")) {
      const rule = entry.componentRules[Number(element.dataset.asComponentRule)];
      rule.effects[Number(element.dataset.asComponentEffect)] = defaultEffect(element.value, "on-entry");
      rerender = true;
    } else if (element.dataset.asComponentEffectField) {
      const effect =
        entry.componentRules[Number(element.dataset.asComponentRule)].effects[
          Number(element.dataset.asComponentEffect)
        ];
      const field = element.dataset.asComponentEffectField;
      effect[field] = ["stages", "percent"].includes(field) ? Number(element.value) : element.value;
    } else if (element.dataset.asRuleField) {
      const rule = entry.rules[Number(element.dataset.asRule)];
      rule[element.dataset.asRuleField] =
        element.dataset.asRuleField === "chance" ? Number(element.value) : element.value;
      rerender = element.dataset.asRuleField === "trigger";
    } else if (element.hasAttribute("data-as-condition-kind")) {
      const rule = entry.rules[Number(element.dataset.asRule)];
      rule.conditions[Number(element.dataset.asCondition)] = defaultCondition(element.value);
      rerender = true;
    } else if (element.dataset.asConditionField) {
      const condition = entry.rules[Number(element.dataset.asRule)].conditions[Number(element.dataset.asCondition)];
      const field = element.dataset.asConditionField;
      if (element.value === "" && (field === "minPercent" || field === "maxPercent")) {
        delete condition[field];
      } else {
        condition[field] = field === "minPercent" || field === "maxPercent" ? Number(element.value) : element.value;
      }
    } else if (element.hasAttribute("data-as-effect-kind")) {
      const rule = entry.rules[Number(element.dataset.asRule)];
      rule.effects[Number(element.dataset.asEffect)] = defaultEffect(element.value, rule.trigger);
      rerender = true;
    } else if (element.dataset.asEffectField) {
      const effect = entry.rules[Number(element.dataset.asRule)].effects[Number(element.dataset.asEffect)];
      const field = element.dataset.asEffectField;
      effect[field] = ["stages", "percent"].includes(field) ? Number(element.value) : element.value;
    } else if (element.hasAttribute("data-as-modifier-kind")) {
      entry.modifiers[Number(element.dataset.asModifier)] = defaultModifier(element.value);
      rerender = true;
    } else if (element.dataset.asModifierField) {
      const modifier = entry.modifiers[Number(element.dataset.asModifier)];
      const field = element.dataset.asModifierField;
      modifier[field] = ["amount", "multiplier"].includes(field) ? Number(element.value) : element.value;
    } else if (element.dataset.asFilter) {
      const ruleIndex = element.dataset.asRule;
      const componentRuleIndex = element.dataset.asComponentRule;
      const modifierIndex = element.dataset.asModifier;
      const owner =
        componentRuleIndex === undefined
          ? ruleIndex === undefined
            ? entry.modifiers[Number(modifierIndex)]
            : entry.rules[Number(ruleIndex)].conditions[Number(element.dataset.asCondition)]
          : entry.componentRules[Number(componentRuleIndex)].conditions[Number(element.dataset.asComponentCondition)];
      owner.filter ||= {};
      updateFilter(owner.filter, element.dataset.asFilter, element.value);
    } else {
      return false;
    }
    notify(rerender);
    return true;
  }

  function swap(array, index, offset) {
    const next = index + offset;
    if (next < 0 || next >= array.length) {
      return;
    }
    [array[index], array[next]] = [array[next], array[index]];
  }

  function componentRuleHookIds(rule) {
    return new Set(
      [...(rule.prerequisiteHooks || []), rule.hook].map(source => resolveComponent(source)?.hook.id).filter(Boolean),
    );
  }

  function componentRuleHooks(rule) {
    return [...(rule.prerequisiteHooks || []), rule.hook];
  }

  function setComponentRuleHooks(rule, hooks) {
    rule.prerequisiteHooks = hooks.slice(0, -1);
    rule.hook = hooks.at(-1);
  }

  function canDropStudioPart(part, targetRuleIndex) {
    const entry = currentEntry();
    const sourceRule = entry?.componentRules[studioDrag?.ruleIndex];
    const targetRule = entry?.componentRules[targetRuleIndex];
    if (!entry || !sourceRule || !targetRule) {
      return false;
    }
    if (part === "rule") {
      return studioDrag.part === "rule" && studioDrag.ruleIndex !== targetRuleIndex;
    }
    if (part === "hook" || part === "new-rule") {
      return (
        studioDrag.part === "hook"
        && (studioDrag.ruleIndex !== targetRuleIndex || componentRuleHooks(sourceRule).length > 1)
      );
    }
    if (part === "condition" && studioDrag.part === "condition") {
      const condition = sourceRule.conditions[studioDrag.index];
      const definition =
        condition && isRuntimeComponent(condition)
          ? componentConditionsByKey.get(componentConditionKey(condition))
          : undefined;
      return (
        !!condition
        && !targetRule.conditions.some(
          (item, index) =>
            componentConditionKey(item) === componentConditionKey(condition)
            && (studioDrag.ruleIndex !== targetRuleIndex || studioDrag.index !== index),
        )
        && (!isRuntimeComponent(condition) || !!definition)
      );
    }
    if (part === "effect" && studioDrag.part === "effect") {
      const effect = sourceRule.effects[studioDrag.index];
      return (
        !!effect
        && !targetRule.effects.some(
          (item, index) =>
            componentInstanceKey(item) === componentInstanceKey(effect)
            && (studioDrag.ruleIndex !== targetRuleIndex || studioDrag.index !== index),
        )
        && (!isRuntimeComponent(effect) || componentEffectSupports(targetRule, effect))
      );
    }
    return false;
  }

  function handleDragStart(event) {
    const source = event.target.closest?.("[data-as-drag-part]");
    if (!source || !currentEntry()) {
      return false;
    }
    studioDrag = {
      part: source.dataset.asDragPart,
      ruleIndex: Number(source.dataset.asDragRule),
      index: Number(source.dataset.asDragIndex),
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "ability-studio");
    source.classList.add("as-dragging");
    return true;
  }

  function handleDragOver(event) {
    const zone = event.target.closest?.("[data-as-drop-part]");
    if (!zone || !studioDrag) {
      return false;
    }
    const part = zone.dataset.asDropPart;
    const targetRuleIndex = Number(zone.dataset.asDropRule);
    if (part === "new-rule" ? studioDrag.part !== "hook" : !canDropStudioPart(part, targetRuleIndex)) {
      return false;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".as-drop-active").forEach(element => element.classList.remove("as-drop-active"));
    zone.classList.add("as-drop-active");
    return true;
  }

  function handleDrop(event) {
    const zone = event.target.closest?.("[data-as-drop-part]");
    const entry = currentEntry();
    if (!zone || !entry || !studioDrag) {
      return false;
    }
    const part = zone.dataset.asDropPart;
    const targetRuleIndex = Number(zone.dataset.asDropRule);
    if (part !== "new-rule" && !canDropStudioPart(part, targetRuleIndex)) {
      return false;
    }
    event.preventDefault();
    const sourceRule = entry.componentRules[studioDrag.ruleIndex];
    if (part === "rule") {
      const [rule] = entry.componentRules.splice(studioDrag.ruleIndex, 1);
      const insertAt = studioDrag.ruleIndex < targetRuleIndex ? targetRuleIndex - 1 : targetRuleIndex;
      entry.componentRules.splice(insertAt, 0, rule);
    } else if (part === "hook" || part === "new-rule") {
      const sourceHooks = componentRuleHooks(sourceRule);
      const source = sourceHooks[studioDrag.index];
      if (part === "new-rule") {
        const catalogRule = resolveComponent(source);
        if (catalogRule) {
          const rule = componentRuleFromHook(entry, catalogRule);
          entry.componentRules.splice(studioDrag.ruleIndex + 1, 0, rule);
          if (sourceHooks.length > 1) {
            sourceHooks.splice(studioDrag.index, 1);
            setComponentRuleHooks(sourceRule, sourceHooks);
          }
        }
      } else {
        const targetRule = entry.componentRules[targetRuleIndex];
        const sourceHookId = resolveComponent(source)?.hook.id;
        if (studioDrag.ruleIndex === targetRuleIndex) {
          const [hook] = sourceHooks.splice(studioDrag.index, 1);
          let insertAt = Number(zone.dataset.asDropIndex);
          if (!Number.isInteger(insertAt)) {
            insertAt = sourceHooks.length;
          }
          if (studioDrag.index < insertAt) {
            insertAt--;
          }
          sourceHooks.splice(Math.max(0, Math.min(insertAt, sourceHooks.length)), 0, hook);
          setComponentRuleHooks(sourceRule, sourceHooks);
        } else if (sourceHookId && !componentRuleHookIds(targetRule).has(sourceHookId)) {
          const targetHooks = componentRuleHooks(targetRule);
          let insertAt = Number(zone.dataset.asDropIndex);
          if (!Number.isInteger(insertAt)) {
            insertAt = targetHooks.length;
          }
          targetHooks.splice(Math.max(0, Math.min(insertAt, targetHooks.length)), 0, clone(source));
          setComponentRuleHooks(targetRule, targetHooks);
          if (sourceHooks.length > 1) {
            sourceHooks.splice(studioDrag.index, 1);
            setComponentRuleHooks(sourceRule, sourceHooks);
          } else if (sourceRule.conditions.length === 0 && sourceRule.effects.length === 0) {
            entry.componentRules.splice(studioDrag.ruleIndex, 1);
          }
        }
      }
    } else {
      const sourceArray = part === "condition" ? sourceRule.conditions : sourceRule.effects;
      const targetRule = entry.componentRules[targetRuleIndex];
      const targetArray = part === "condition" ? targetRule.conditions : targetRule.effects;
      const [item] = sourceArray.splice(studioDrag.index, 1);
      let insertAt = Number(zone.dataset.asDropIndex);
      if (!Number.isInteger(insertAt)) {
        insertAt = targetArray.length;
      }
      if (sourceArray === targetArray && studioDrag.index < insertAt) {
        insertAt--;
      }
      targetArray.splice(Math.max(0, Math.min(insertAt, targetArray.length)), 0, item);
    }
    handleDragEnd();
    notify(true);
    return true;
  }

  function handleDragEnd() {
    studioDrag = null;
    document.querySelectorAll(".as-dragging, .as-drop-active").forEach(element => {
      element.classList.remove("as-dragging", "as-drop-active");
    });
    return true;
  }

  function handleClick(event) {
    const button = event.target.closest("[data-as-action]");
    if (!button) {
      if (!event.target.closest(".as-runtime-search")) {
        closeRuntimeMoveSearch();
      }
      if (!event.target.closest(".as-include-picker")) {
        closeIncludeSearch();
      }
      if (!event.target.closest(".as-mechanic-picker")) {
        closeMechanicSearch();
      }
      if (!event.target.closest(".as-simple-search")) {
        closeSimpleSearch();
      }
      return false;
    }
    const action = button.dataset.asAction;
    const entry = currentEntry();
    if (action === "open-move-search") {
      renderRuntimeMoveSearch(button);
      return true;
    }
    if (action === "choose-runtime-move") {
      const input = document.getElementById(button.dataset.asInput);
      if (!input || !entry) {
        return true;
      }
      const label = moveLabel(Number(button.dataset.asId));
      const values = input.value
        .split(";")
        .slice(0, -1)
        .map(value => value.trim())
        .filter(Boolean);
      input.value = input.dataset.asRuntimeControl === "move-list" ? [...values, label].join("; ") : label;
      handleInput(input);
      closeRuntimeMoveSearch();
      input.focus();
      return true;
    }
    if (action === "ai-generate") {
      generateAiAbility();
      return true;
    }
    if (action === "ai-cancel") {
      cancelAiAbility();
      return true;
    }
    if (action === "open-include-search") {
      renderIncludeSearch(button);
      return true;
    }
    if (action === "open-mechanic-search") {
      renderMechanicSearch(button);
      return true;
    }
    if (action === "open-simple-search") {
      renderSimpleSearch(button);
      return true;
    }
    if (action === "expand-component-results") {
      const input = button.closest(".as-mechanic-search")?.querySelector("[data-as-mechanic-search]");
      if (button.dataset.asResultKind === "abilities") {
        componentSearchView.abilityLimit += 24;
      } else if (button.dataset.asResultKind === "effects") {
        componentSearchView.effectLimit += 80;
      } else {
        componentSearchView.partLimit += 160;
      }
      if (input) {
        renderMechanicSearch(input);
      }
      return true;
    }
    if (action === "new-ability") {
      const key = uniqueKey("new-ability");
      state[key] = newAbility();
      selected = key;
    } else if (action === "select") {
      selected = button.dataset.asKey;
    } else if (!entry) {
      return false;
    } else if (action === "reset-runtime-parameter") {
      const reference = runtimeReferenceForElement(entry, button);
      if (reference?.parameterOverrides) {
        delete reference.parameterOverrides[button.dataset.asRuntimeParameter];
        if (Object.keys(reference.parameterOverrides).length === 0) {
          reference.parameterOverrides = undefined;
        }
      }
    } else if (action === "duplicate") {
      const key = uniqueKey(`${entry.name}-copy`);
      state[key] = { ...clone(entry), id: nextId(), name: `${entry.name} Copy` };
      selected = key;
    } else if (action === "delete-ability") {
      if (!window.confirm(`Delete ${entry.name}?`)) {
        return true;
      }
      if (Object.hasOwn(baseline, selected)) {
        state[selected] = null;
      } else {
        delete state[selected];
      }
      selected = visibleEntries()[0]?.[0] || null;
    } else if (action === "add-include") {
      const value = document.querySelector("#as-include-picker")?.value.trim().toLowerCase();
      const ability = getAbilityCatalog().find(candidate => candidate.name.trim().toLowerCase() === value);
      if (ability && ability.id !== entry.id && !entry.includes.includes(ability.id)) {
        entry.includes.push(ability.id);
      }
    } else if (action === "choose-include") {
      const id = Number(button.dataset.asId);
      if (id !== entry.id && !entry.includes.includes(id)) {
        entry.includes.push(id);
      }
    } else if (action === "choose-mechanic") {
      const reference = {
        abilityId: Number(button.dataset.asId),
        attrIndex: Number(button.dataset.asIndex),
        attrType: button.dataset.asType,
      };
      if (
        reference.abilityId !== entry.id
        && !entry.mechanics.some(
          mechanic =>
            mechanic.abilityId === reference.abilityId
            && mechanic.attrIndex === reference.attrIndex
            && mechanic.attrType === reference.attrType,
        )
      ) {
        entry.mechanics.push(reference);
      }
    } else if (action === "choose-component-rule") {
      const source = {
        abilityId: Number(button.dataset.asId),
        attrIndex: Number(button.dataset.asIndex),
        attrType: button.dataset.asType,
      };
      const rule = resolveComponent(source);
      if (rule && source.abilityId !== entry.id) {
        entry.componentRules.push(componentRuleFromCatalog(entry, rule));
      }
    } else if (action === "choose-component-hook") {
      const source = {
        abilityId: Number(button.dataset.asId),
        attrIndex: Number(button.dataset.asIndex),
        attrType: button.dataset.asType,
      };
      const catalogRule = resolveComponent(source);
      if (catalogRule && source.abilityId !== entry.id) {
        if (componentInsertTarget?.kind === "new-hook") {
          entry.componentRules.push(componentRuleFromHook(entry, catalogRule));
        } else {
          const ruleIndex = componentInsertTarget?.ruleIndex;
          if (Number.isInteger(ruleIndex) && entry.componentRules[ruleIndex]) {
            const targetRule = entry.componentRules[ruleIndex];
            const hooks = componentRuleHooks(targetRule);
            hooks.push(source);
            setComponentRuleHooks(targetRule, hooks);
          }
        }
      }
      componentInsertTarget = null;
    } else if (action === "choose-component-condition") {
      const rule = entry.componentRules[componentInsertTarget?.ruleIndex];
      if (rule) {
        const reference = {
          abilityId: Number(button.dataset.asId),
          attrIndex: Number(button.dataset.asIndex),
          attrType: button.dataset.asType,
          kind: button.dataset.asKind,
        };
        if (button.dataset.asConditionIndex !== undefined) {
          reference.conditionIndex = Number(button.dataset.asConditionIndex);
        }
        if (!rule.conditions.some(condition => componentConditionKey(condition) === componentConditionKey(reference))) {
          rule.conditions.push(reference);
        }
      }
      componentInsertTarget = null;
    } else if (action === "choose-component-primitive-condition") {
      const rule = entry.componentRules[componentInsertTarget?.ruleIndex];
      if (rule) {
        rule.conditions.push(defaultCondition(button.dataset.asValue));
      }
      componentInsertTarget = null;
    } else if (action === "choose-component-effect") {
      const rule = entry.componentRules[componentInsertTarget?.ruleIndex];
      if (rule) {
        const reference = {
          abilityId: Number(button.dataset.asId),
          attrIndex: Number(button.dataset.asIndex),
          attrType: button.dataset.asType,
        };
        if (!rule.effects.some(effect => componentSourceKey(effect) === componentSourceKey(reference))) {
          rule.effects.push(reference);
        }
      }
      componentInsertTarget = null;
    } else if (action === "choose-component-primitive-effect") {
      const rule = entry.componentRules[componentInsertTarget?.ruleIndex];
      if (rule) {
        rule.effects.push(defaultEffect(button.dataset.asValue, "on-entry"));
      }
      componentInsertTarget = null;
    } else if (action === "choose-component-ability") {
      const ability = componentsByAbility.get(Number(button.dataset.asId));
      for (const rule of ability?.rules ?? []) {
        if (
          rule.source.abilityId !== entry.id
          && !entry.componentRules.some(
            componentRule => componentSourceKey(componentRule.hook) === componentSourceKey(rule.source),
          )
        ) {
          entry.componentRules.push(componentRuleFromCatalog(entry, rule));
        }
      }
    } else if (action === "remove-include") {
      entry.includes = entry.includes.filter(id => id !== Number(button.dataset.asId));
    } else if (action === "remove-mechanic") {
      entry.mechanics.splice(Number(button.dataset.asMechanic), 1);
    } else if (action === "remove-component-rule") {
      entry.componentRules.splice(Number(button.dataset.asComponentRule), 1);
    } else if (action === "remove-prerequisite-hook") {
      entry.componentRules[Number(button.dataset.asComponentRule)].prerequisiteHooks.splice(
        Number(button.dataset.asHook),
        1,
      );
    } else if (action === "fork-component-rule") {
      const ruleIndex = Number(button.dataset.asComponentRule);
      const rule = entry.componentRules[ruleIndex];
      const sourceRule = rule && resolveComponent(rule.hook);
      if (rule && sourceRule) {
        const fork = componentRuleFromHook(entry, sourceRule);
        fork.prerequisiteHooks = clone(rule.prerequisiteHooks || []);
        entry.componentRules.splice(ruleIndex + 1, 0, fork);
      }
    } else if (action === "remove-component-condition") {
      entry.componentRules[Number(button.dataset.asComponentRule)].conditions.splice(
        Number(button.dataset.asComponentCondition),
        1,
      );
    } else if (action === "remove-component-effect") {
      entry.componentRules[Number(button.dataset.asComponentRule)].effects.splice(
        Number(button.dataset.asComponentEffect),
        1,
      );
    } else if (action === "toggle-condition-logic") {
      const rules = button.dataset.asRuleKind === "component" ? entry.componentRules : entry.rules;
      const rule = rules[Number(button.dataset.asRule)];
      rule.conditionLogic = rule.conditionLogic === "any" ? "all" : "any";
    } else if (action === "choose-simple-trigger") {
      const rule = entry.rules[Number(button.dataset.asRule)];
      rule.trigger = button.dataset.asValue;
      if (!triggerHasMove(rule.trigger)) {
        rule.conditions = rule.conditions.filter(condition => condition.kind !== "move");
      }
      if (!triggerHasOther(rule.trigger)) {
        rule.conditions = rule.conditions.filter(condition => condition.kind !== "other-status");
        rule.effects = rule.effects.filter(effect => effect.target !== "other");
      }
    } else if (action === "choose-simple-condition") {
      entry.rules[Number(button.dataset.asRule)].conditions.push(defaultCondition(button.dataset.asValue));
    } else if (action === "choose-simple-effect") {
      const rule = entry.rules[Number(button.dataset.asRule)];
      rule.effects.push(defaultEffect(button.dataset.asValue, rule.trigger));
    } else if (action === "add-rule") {
      entry.rules.push(newRule(entry.rules));
    } else if (action === "remove-rule") {
      entry.rules.splice(Number(button.dataset.asRule), 1);
    } else if (action === "rule-up" || action === "rule-down") {
      swap(entry.rules, Number(button.dataset.asRule), action === "rule-up" ? -1 : 1);
    } else if (action === "add-condition") {
      entry.rules[Number(button.dataset.asRule)].conditions.push(defaultCondition("move"));
    } else if (action === "remove-condition") {
      entry.rules[Number(button.dataset.asRule)].conditions.splice(Number(button.dataset.asCondition), 1);
    } else if (action === "add-effect") {
      const rule = entry.rules[Number(button.dataset.asRule)];
      rule.effects.push(defaultEffect("stat-stage", rule.trigger));
    } else if (action === "remove-effect") {
      entry.rules[Number(button.dataset.asRule)].effects.splice(Number(button.dataset.asEffect), 1);
    } else if (action === "effect-up" || action === "effect-down") {
      const effects = entry.rules[Number(button.dataset.asRule)].effects;
      swap(effects, Number(button.dataset.asEffect), action === "effect-up" ? -1 : 1);
    } else if (action === "add-modifier") {
      entry.modifiers.push(defaultModifier("move-power"));
    } else if (action === "remove-modifier") {
      entry.modifiers.splice(Number(button.dataset.asModifier), 1);
    } else {
      return false;
    }
    notify(true);
    return true;
  }

  function buildDelta() {
    const errors = allValidationErrors();
    const delta = {};
    const keys = new Set([...Object.keys(state), ...Object.keys(baseline)]);
    for (const key of keys) {
      const value = state[key];
      if (value === null) {
        if (baseline[key] !== undefined) {
          delta[key] = null;
        }
      } else if (!eq(value, baseline[key])) {
        delta[key] = clone(value);
      }
    }
    return { delta, errors };
  }

  function init(options) {
    primitiveCatalog = options.catalog;
    baseAbilities = options.abilities || [];
    moveCatalog = Array.isArray(options.moves) ? options.moves : [];
    movesById = new Map(moveCatalog.map(move => [Number(move.id), move]));
    movesByName = new Map(moveCatalog.map(move => [String(move.name).trim().toLowerCase(), move]));
    mechanicCatalog = Array.isArray(options.mechanics) ? options.mechanics : [];
    mechanicsByAbility = new Map(mechanicCatalog.map(ability => [ability.id, ability]));
    componentCatalog =
      Array.isArray(options.components) && options.components.length > 0
        ? options.components
        : mechanicCatalog.map(ability => ({
            ...ability,
            rules: ability.mechanics.map(mechanic => ({
              id: `ability-${ability.id}-${mechanic.type}-${mechanic.index + 1}`,
              label: mechanic.label,
              summary: mechanic.summary || `${mechanic.label}. In ${ability.name}: ${ability.description}`,
              scope: mechanic.scope || "primitive",
              parameters: mechanic.parameters || [],
              source: { abilityId: ability.id, attrIndex: mechanic.index, attrType: mechanic.type },
              hook: {
                id: mechanic.type,
                label: mechanic.trigger,
                mode: "event",
                contract: mechanic.type,
                context: ["holder", "runtime event state"],
                source: { abilityId: ability.id, attrIndex: mechanic.index, attrType: mechanic.type },
              },
              conditions: mechanic.conditioned
                ? [
                    {
                      id: `ability-${ability.id}-${mechanic.type}-${mechanic.index + 1}-condition`,
                      label: `${mechanic.label} condition`,
                      summary: `${mechanic.label} must satisfy its source runtime condition. ${ability.description}`,
                      kind: "event",
                      sourceOwner: mechanic.type,
                      required: true,
                      source: { abilityId: ability.id, attrIndex: mechanic.index, attrType: mechanic.type },
                    },
                  ]
                : [],
              effects: [
                {
                  id: `ability-${ability.id}-${mechanic.type}-${mechanic.index + 1}-effect`,
                  label: mechanic.label,
                  summary: mechanic.summary || `${mechanic.label}. In ${ability.name}: ${ability.description}`,
                  scope: mechanic.scope || "primitive",
                  parameters: mechanic.parameters || [],
                  kind: "effect",
                  sourceOwner: mechanic.type,
                  source: { abilityId: ability.id, attrIndex: mechanic.index, attrType: mechanic.type },
                },
              ],
            })),
          }));
    componentsByAbility = new Map(componentCatalog.map(ability => [ability.id, ability]));
    componentsBySource = new Map(
      componentCatalog.flatMap(ability => ability.rules.map(rule => [componentSourceKey(rule.source), rule])),
    );
    componentConditionsByKey = new Map(
      componentCatalog.flatMap(ability =>
        ability.rules.flatMap(rule =>
          rule.conditions.map(condition => [
            componentConditionKey({ ...condition.source, kind: condition.kind }),
            condition,
          ]),
        ),
      ),
    );
    componentEffectsByKey = new Map(
      componentCatalog.flatMap(ability =>
        ability.rules.flatMap(rule => rule.effects.map(effect => [componentSourceKey(effect.source), effect])),
      ),
    );
    community = !!options.community;
    callbacks = options.callbacks || {};
    aiEndpoint = String(options.aiEndpoint || "").replace(/\/$/, "");
    loadSavedBlueprints = typeof options.loadSavedBlueprints === "function" ? options.loadSavedBlueprints : null;
    savedBlueprintRefresh = null;
    savedBlueprintRefreshAt = 0;
    aiAbortController?.abort();
    aiAbortController = null;
    aiState = {
      prompt: "",
      running: false,
      activity: [],
      usage: null,
      error: "",
      requestId: null,
    };
    const source = options.blueprints && typeof options.blueprints === "object" ? options.blueprints : {};
    state = clone(source);
    for (const entry of Object.values(state)) {
      if (entry) {
        prepareLoadedBlueprint(entry);
      }
    }
    baseline = clone(state);
    selected = visibleEntries()[0]?.[0] || null;
    listQuery = "";
    if (community) {
      mode = "assignments";
    }
    callbacks.onCatalogChange?.(getCustomCatalog());
  }

  window.erAbilityStudio = {
    init,
    available: () => !community && !!primitiveCatalog,
    mode: () => mode,
    setMode(value) {
      mode = value === "studio" && !community ? "studio" : "assignments";
      callbacks.render?.();
    },
    renderContent,
    handleInput,
    handleClick,
    handleKeyDown,
    closeRuntimeMoveSearch,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    buildDelta,
    markSaved() {
      baseline = clone(state);
    },
    dirtyCount() {
      return Object.keys(buildDelta().delta).length;
    },
    getCustomCatalog,
    getAbilityCatalog,
    refreshSavedBlueprints,
  };
})();
